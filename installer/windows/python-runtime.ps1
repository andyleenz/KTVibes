# Shared by setup and the Windows upgrade smoke test. Compatible with PowerShell 5.1.
function Invoke-LoggedUv([string]$Uv, [string[]]$Arguments) {
    Write-Host "uv arguments: $($Arguments -join ' ')"
    # Windows PowerShell can otherwise turn native stderr into a terminating error.
    $ErrorActionPreference = 'Continue'
    $output = @(& $Uv @Arguments 2>&1)
    $code = $LASTEXITCODE
    foreach ($line in $output) { Write-Host "$line" }
    return @{ ExitCode = $code; Output = ($output -join "`n") }
}

function Test-PrivateInterpreter([string]$Uv, [string]$Executable) {
    Write-Host "Checking Python interpreter: $Executable"
    if (-not (Test-Path -LiteralPath $Executable -PathType Leaf)) { return $false }
    $result = Invoke-LoggedUv $Uv @('python', 'find', '--system', '--no-python-downloads', $Executable)
    return $result.ExitCode -eq 0
}

function Find-PrivatePython([string]$Uv, [string]$PythonDir) {
    # Inspect actual patch directories only; never recurse through managed junctions.
    $candidates = Get-ChildItem -LiteralPath $PythonDir -Directory -Force |
        Where-Object { $_.Name -match '^cpython-3\.12\.\d+-windows-x86_64-none$' -and
            -not ($_.Attributes -band [IO.FileAttributes]::ReparsePoint) } |
        Sort-Object { [version]($_.Name -replace '^cpython-([0-9.]+)-.*$', '$1') } -Descending
    foreach ($candidate in $candidates) {
        $executable = Join-Path $candidate.FullName 'python.exe'
        if (-not (Test-Path -LiteralPath $executable -PathType Leaf)) { continue }
        Write-Host "Checking physical Python binary: $executable"
        # Validate independently of uv discovery, which may encounter the broken alias.
        $ErrorActionPreference = 'Continue'
        $output = @(& $executable -I -c 'import sys; print(sys.version); print(sys.executable); sys.exit(0 if sys.version_info[:2] == (3, 12) and sys.maxsize > 2**32 else 1)' 2>&1)
        $code = $LASTEXITCODE
        foreach ($line in $output) { Write-Host "$line" }
        if ($code -eq 0) { return $executable }
    }
    return $null
}

function Repair-PythonMinorLink([string]$Uv, [string]$PythonDir, [string]$Executable) {
    $link = Join-Path $PythonDir 'cpython-3.12-windows-x86_64-none'
    $item = Get-Item -LiteralPath $link -Force -ErrorAction SilentlyContinue
    if ($item -and -not ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
        Write-Host "Leaving non-link Python directory intact: $link"
        return
    }
    if ($item -and (Test-PrivateInterpreter $Uv (Join-Path $link 'python.exe'))) { return }
    try {
        if ($item) {
            Write-Host "Removing invalid Python junction only: $link"
            [IO.Directory]::Delete($link, $false)
        }
        $target = Split-Path -Parent $Executable
        Write-Host "Creating Python junction: $link -> $target"
        New-Item -ItemType Junction -Path $link -Target $target -ErrorAction Stop | Out-Null
    }
    catch {
        # The concrete interpreter remains usable even if Windows rejects this alias.
        Write-Host "Python junction repair failed: $($_.Exception.Message). Using $Executable."
    }
}

function Sync-PrivatePythonEnvironment([string]$Uv, [string]$InstallDir, [string]$PythonDir) {
    $executable = Find-PrivatePython $Uv $PythonDir
    if (-not $executable) {
        $installed = Invoke-LoggedUv $Uv @('python', 'install', '3.12')
        $executable = Find-PrivatePython $Uv $PythonDir
        if (-not $executable) { throw "No usable private Python 3.12 interpreter after installation (exit $($installed.ExitCode))." }
    }
    Write-Host "Selected private Python: $executable"
    # A filesystem-path request permits uv's patch-upgrade junction/trampoline.
    # The complete installation key includes a patch version and selects Fixed policy.
    $pythonRequest = Split-Path -Leaf (Split-Path -Parent $executable)
    Write-Host "Pinned Python request: $pythonRequest"
    Repair-PythonMinorLink $Uv $PythonDir $executable
    if (-not (Test-PrivateInterpreter $Uv $executable)) {
        throw "uv could not query the physical Python interpreter: $executable"
    }

    $venv = Join-Path $InstallDir '.venv'
    $backup = $null
    $success = $false
    try {
        if (Test-Path -LiteralPath $venv) {
            $config = Join-Path $venv 'pyvenv.cfg'
            $usesMinorLink = $false
            if (Test-Path -LiteralPath $config) {
                Write-Host "Existing virtual environment config: $config"
                $configText = Get-Content -LiteralPath $config -Raw
                Write-Host $configText
                $usesMinorLink = $configText -match '(?im)^home\s*=\s*.*[\\/]cpython-3\.12-windows-x86_64-none\s*$'
            }
            if ($usesMinorLink -or -not (Test-PrivateInterpreter $Uv (Join-Path $venv 'Scripts\python.exe'))) {
                $backupPath = Join-Path $InstallDir ('.venv-backup-' + [guid]::NewGuid().ToString('N'))
                Write-Host "Backing up invalid or junction-based virtual environment: $backupPath"
                Move-Item -LiteralPath $venv -Destination $backupPath
                $backup = $backupPath
            }
        }
        $arguments = @('sync', '--project', $InstallDir, '--locked', '--no-dev', '--no-python-downloads', '--managed-python', '--python', $pythonRequest)
        $result = Invoke-LoggedUv $Uv $arguments
        # A failure encountered only during sync may still originate in the old venv.
        if ($result.ExitCode -ne 0 -and -not $backup -and (Test-Path -LiteralPath $venv) -and
            $result.Output -match '(?i)os error 448|Failed to query Python interpreter|failed to canonicalize') {
            $backupPath = Join-Path $InstallDir ('.venv-backup-' + [guid]::NewGuid().ToString('N'))
            Write-Host "Backing up virtual environment after interpreter failure: $backupPath"
            Move-Item -LiteralPath $venv -Destination $backupPath
            $backup = $backupPath
            $result = Invoke-LoggedUv $Uv $arguments
        }
        if ($result.ExitCode -ne 0) { throw 'Could not install KTVibes dependencies.' }
        $newConfig = Get-Content -LiteralPath (Join-Path $venv 'pyvenv.cfg') -Raw
        Write-Host "Synchronized virtual environment config:`n$newConfig"
        if ($newConfig -match '(?im)^home\s*=\s*.*[\\/]cpython-3\.12-windows-x86_64-none\s*$') {
            throw 'uv created a junction-based environment despite the pinned Python version.'
        }
        if (-not (Test-PrivateInterpreter $Uv (Join-Path $venv 'Scripts\python.exe'))) {
            throw 'The synchronized virtual environment could not be queried by uv.'
        }
        $success = $true
    }
    finally {
        if ($backup) {
            if ($success) {
                Remove-Item -LiteralPath $backup -Recurse -Force
            }
            else {
                Write-Host "Restoring previous virtual environment from: $backup"
                if (Test-Path -LiteralPath $venv) { Remove-Item -LiteralPath $venv -Recurse -Force }
                Move-Item -LiteralPath $backup -Destination $venv
            }
        }
    }
}
