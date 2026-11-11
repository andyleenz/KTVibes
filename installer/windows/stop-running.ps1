param(
    [Parameter(Mandatory = $true)][string]$InstallDir
)

$ErrorActionPreference = 'Stop'
$InstallDir = [IO.Path]::GetFullPath($InstallDir).TrimEnd('\')
$uvPath = [IO.Path]::GetFullPath((Join-Path $InstallDir 'tools\uv\uv.exe'))
$trayScript = [IO.Path]::GetFullPath((Join-Path $InstallDir 'installer\tray.ps1'))
$cmdScript = [IO.Path]::GetFullPath((Join-Path $InstallDir 'KTVibes.cmd'))

function Get-KTVibesProcesses {
    Get-CimInstance Win32_Process | Where-Object {
        $commandLine = [string]$_.CommandLine
        $executable = [string]$_.ExecutablePath
        ($_.Name -match '^(powershell|pwsh|cmd|uv)\.exe$') -and (
            ($commandLine -and ($commandLine.IndexOf($trayScript, [StringComparison]::OrdinalIgnoreCase) -ge 0 -or
                                $commandLine.IndexOf($cmdScript, [StringComparison]::OrdinalIgnoreCase) -ge 0)) -or
            ($executable -and [string]::Equals($executable, $uvPath, [StringComparison]::OrdinalIgnoreCase))
        )
    }
}

$processes = @(Get-KTVibesProcesses)
$trayProcesses = @($processes | Where-Object {
    $_.Name -match '^(powershell|pwsh)\.exe$' -and
    ([string]$_.CommandLine).IndexOf($trayScript, [StringComparison]::OrdinalIgnoreCase) -ge 0
})

# Stop the tray parent first so its cmd/uv server process tree is stopped with it.
foreach ($process in $trayProcesses) {
    & taskkill.exe /PID $process.ProcessId /T /F 2>$null | Out-Null
}

Start-Sleep -Milliseconds 500

# Also stop an app-local uv process if it was launched outside the tray process tree.
foreach ($process in @(Get-KTVibesProcesses)) {
    if ([string]::Equals([string]$process.ExecutablePath, $uvPath, [StringComparison]::OrdinalIgnoreCase)) {
        & taskkill.exe /PID $process.ProcessId /T /F 2>$null | Out-Null
    }
}

$deadline = [DateTime]::UtcNow.AddSeconds(15)
do {
    $remaining = @(Get-KTVibesProcesses)
    if ($remaining.Count -eq 0) { exit 0 }
    Start-Sleep -Milliseconds 250
} while ([DateTime]::UtcNow -lt $deadline)

Write-Error 'KTVibes processes are still running from the selected installation folder.'
exit 1
