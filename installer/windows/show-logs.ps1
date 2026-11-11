param(
    [Parameter(Mandatory = $true)][string]$LogPath
)

$Host.UI.RawUI.WindowTitle = 'KTVibes Logs'
Write-Host "Following $LogPath"
Write-Host 'Close this window to stop viewing logs. KTVibes will keep running.'
Write-Host ''

while (-not (Test-Path -LiteralPath $LogPath -PathType Leaf)) {
    Start-Sleep -Milliseconds 250
}
Get-Content -LiteralPath $LogPath -Encoding UTF8 -Tail 100 -Wait
