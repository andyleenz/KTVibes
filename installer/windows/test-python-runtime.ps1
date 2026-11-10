$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'python-runtime.ps1')

function Assert-Condition([bool]$Condition, [string]$Message) {
    if (-not $Condition) { throw $Message }
}

$uv = (Get-Command uv -ErrorAction Stop).Source
$testRoot = Join-Path ([IO.Path]::GetTempPath()) ('KTVibes upgrade test ' + [guid]::NewGuid().ToString('N'))
$pythonDir = Join-Path $testRoot 'tools\python'
$env:UV_PYTHON_INSTALL_DIR = $pythonDir
$env:UV_PROJECT_ENVIRONMENT = Join-Path $testRoot '.venv'
$env:UV_PYTHON_INSTALL_BIN = '0'
$env:UV_CACHE_DIR = Join-Path $testRoot '.uv-cache'
$venvPython = Join-Path $testRoot '.venv\Scripts\python.exe'
$marker = Join-Path $testRoot '.venv\preserve-on-upgrade.txt'
$cacheMarker = Join-Path $testRoot 'cache\preserve.txt'
$project = @'
[project]
name = "ktvibes-upgrade-smoke"
version = "0.0.0"
requires-python = "==3.12.*"
dependencies = []
'@

try {
    New-Item -ItemType Directory -Force $pythonDir, (Join-Path $testRoot 'cache') | Out-Null
    Set-Content -LiteralPath (Join-Path $testRoot 'pyproject.toml') -Value $project -Encoding UTF8
    Set-Content -LiteralPath $cacheMarker -Value 'songs and models must survive'
    $install = Invoke-LoggedUv $uv @('python', 'install', '3.12')
    Assert-Condition ($install.ExitCode -eq 0) 'Initial runtime provisioning failed.'
    $lock = Invoke-LoggedUv $uv @('lock', '--project', $testRoot, '--python', '3.12')
    Assert-Condition ($lock.ExitCode -eq 0) 'Smoke project lock failed.'

    Write-Host 'Scenario: first installation in a custom path containing spaces'
    Sync-PrivatePythonEnvironment $uv $testRoot $pythonDir
    Write-Host 'Scenario: installed environment runs without the minor-version junction'
    $link = Join-Path $pythonDir 'cpython-3.12-windows-x86_64-none'
    [IO.Directory]::Delete($link, $false)
    Assert-Condition (Test-PrivateInterpreter $uv $venvPython) 'New environment still requires the minor-version junction.'
    $run = Invoke-LoggedUv $uv @('run', '--project', $testRoot, '--locked', '--no-dev', '--no-python-downloads', 'python', '-c', 'import sys; print(sys.prefix)')
    Assert-Condition ($run.ExitCode -eq 0) 'Application startup through uv still requires the minor-version junction.'
    Set-Content -LiteralPath $marker -Value 'healthy environment reused'
    Write-Host 'Scenario: repeat installation preserves a healthy environment'
    Sync-PrivatePythonEnvironment $uv $testRoot $pythonDir
    Assert-Condition (Test-Path -LiteralPath $marker) 'Healthy venv was unnecessarily rebuilt.'

    Write-Host 'Scenario: migrate a legacy junction-based environment'
    $physicalPython = Find-PrivatePython $uv $pythonDir
    $legacy = Invoke-LoggedUv $uv @('venv', '--clear', '--no-python-downloads', '--python', '3.12', (Join-Path $testRoot '.venv'))
    Assert-Condition ($legacy.ExitCode -eq 0) 'Legacy environment provisioning failed.'
    $legacyConfig = Get-Content -LiteralPath (Join-Path $testRoot '.venv\pyvenv.cfg') -Raw
    Assert-Condition ($legacyConfig -match '(?im)^home\s*=\s*.*[\\/]cpython-3\.12-windows-x86_64-none\s*$') 'Fixture did not reproduce a legacy junction-based environment.'
    Sync-PrivatePythonEnvironment $uv $testRoot $pythonDir
    [IO.Directory]::Delete($link, $false)
    Assert-Condition (Test-PrivateInterpreter $uv $venvPython) 'Migrated environment still requires the minor-version junction.'
    # Recreate the alias before the next scenario deliberately breaks it.
    Repair-PythonMinorLink $uv $pythonDir $physicalPython

    Write-Host 'Scenario: dangling Python minor-version junction'
    [IO.Directory]::Delete($link, $false)
    $missingTarget = Join-Path $testRoot 'removed-python-target'
    New-Item -ItemType Directory -Path $missingTarget | Out-Null
    New-Item -ItemType Junction -Path $link -Target $missingTarget | Out-Null
    [IO.Directory]::Delete($missingTarget, $false)
    Sync-PrivatePythonEnvironment $uv $testRoot $pythonDir
    Assert-Condition (Test-PrivateInterpreter $uv (Join-Path $link 'python.exe')) 'Minor-version junction was not repaired.'

    Write-Host 'Scenario: unusable existing virtual environment is rebuilt'
    Move-Item -LiteralPath $venvPython -Destination ($venvPython + '.disabled')
    Sync-PrivatePythonEnvironment $uv $testRoot $pythonDir
    Assert-Condition (-not (Test-Path -LiteralPath $marker)) 'Invalid venv was not rebuilt.'
    Assert-Condition (Test-PrivateInterpreter $uv $venvPython) 'Rebuilt interpreter is unusable.'

    Write-Host 'Scenario: dependency failure restores the previous environment'
    Set-Content -LiteralPath $marker -Value 'restore this environment'
    Move-Item -LiteralPath $venvPython -Destination ($venvPython + '.disabled')
    Set-Content -LiteralPath (Join-Path $testRoot 'pyproject.toml') -Value ($project.Replace('0.0.0', '0.0.1')) -Encoding UTF8
    $failed = $false
    try { Sync-PrivatePythonEnvironment $uv $testRoot $pythonDir } catch { $failed = $true }
    Assert-Condition $failed 'Expected locked dependency synchronization to fail.'
    Assert-Condition (Test-Path -LiteralPath $marker) 'Previous venv was not restored.'
    Assert-Condition (Test-Path -LiteralPath ($venvPython + '.disabled')) 'Restored environment contents changed.'
    Assert-Condition ((Get-Content -LiteralPath $cacheMarker) -eq 'songs and models must survive') 'Application cache changed.'
    Assert-Condition (@(Get-ChildItem -LiteralPath $testRoot -Filter '.venv-backup-*').Count -eq 0) 'Unexpected backup remains after restoration.'
    Write-Host 'All Windows Python upgrade smoke checks passed.'
}
finally {
    if (Test-Path -LiteralPath $testRoot) { Remove-Item -LiteralPath $testRoot -Recurse -Force }
}

# The rollback scenario deliberately leaves a failing native uv exit code behind.
# Report success only after every assertion and cleanup above has completed.
exit 0
