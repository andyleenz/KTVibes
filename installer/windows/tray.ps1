param([switch]$BackgroundLaunch)
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type -ReferencedAssemblies System.Windows.Forms,System.Drawing -TypeDefinition @'
using System.Drawing;
using System.Windows.Forms;
public sealed class KTVibesMenuRenderer : ToolStripProfessionalRenderer
{
    protected override void OnRenderMenuItemText(ToolStripItemTextRenderEventArgs e)
    {
        if (e.Item.Name != "KTVibesVersionItem") { base.OnRenderMenuItemText(e); return; }
        const TextFormatFlags flags = TextFormatFlags.NoPadding | TextFormatFlags.NoPrefix | TextFormatFlags.VerticalCenter;
        Rectangle area = e.TextRectangle;
        int x = area.Left;
        string text = e.Text;
        int arrow = text.IndexOf(" → ", System.StringComparison.Ordinal);
        int link = text.LastIndexOf("    ↗", System.StringComparison.Ordinal);
        int prefixEnd = arrow < 0 ? (link < 0 ? text.Length : link) : arrow + 3;
        Draw(e, text.Substring(0, prefixEnd), Color.Black, ref x, area, flags);
        if (arrow >= 0) Draw(e, text.Substring(arrow + 3, (link < 0 ? text.Length : link) - arrow - 3), Color.FromArgb(80, 150, 35), ref x, area, flags);
        if (link >= 0) Draw(e, text.Substring(link), Color.Black, ref x, area, flags);
    }
    private static void Draw(ToolStripItemTextRenderEventArgs e, string text, Color color, ref int x, Rectangle area, TextFormatFlags flags)
    {
        Size size = TextRenderer.MeasureText(e.Graphics, text, e.TextFont, new Size(int.MaxValue, area.Height), flags);
        TextRenderer.DrawText(e.Graphics, text, e.TextFont, new Rectangle(x, area.Top, size.Width, area.Height), color, flags);
        x += size.Width;
    }
}
'@

$appDir = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$cmdPath = Join-Path $appDir 'KTVibes.cmd'
$iconPath = Join-Path $appDir 'KTVibes.ico'
$logDir = Join-Path $appDir 'logs'
$logPath = Join-Path $logDir 'ktvibes.log'
$script:activePortFile = Join-Path $logDir 'active-port'
$script:conflictFile = Join-Path $logDir 'port-conflict'
$null = New-Item -ItemType Directory -Force -Path $logDir
$server = $null
$currentVersion = [regex]::Match((Get-Content (Join-Path $appDir 'pyproject.toml') -Raw), '(?m)^version\s*=\s*"([^"]+)"').Groups[1].Value
$releaseUrl = 'https://github.com/JeffShih-wiwynn/KTVibes/releases/latest'
$updateVersion = $null
. (Join-Path $PSScriptRoot 'network-settings.ps1')

function Start-KTVibes {
    Remove-Item -LiteralPath $script:activePortFile -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $script:conflictFile -ErrorAction SilentlyContinue
    $script:activePort = $script:networkPort
    $script:portConflict = $false
    foreach ($oldLog in @((Join-Path $logDir 'ktvibes.log.1'), (Join-Path $logDir 'ktvibes.log.2'))) {
        if ((Test-Path $oldLog) -and (Get-Item $oldLog).Length -gt 5MB) { Remove-Item -LiteralPath $oldLog -Force }
    }
    if ((Test-Path $logPath) -and (Get-Item $logPath).Length -ge 5MB) {
        $second = Join-Path $logDir 'ktvibes.log.2'
        $first = Join-Path $logDir 'ktvibes.log.1'
        Remove-Item -LiteralPath $second -Force -ErrorAction SilentlyContinue
        if (Test-Path $first) { Move-Item -LiteralPath $first -Destination $second -Force }
        Move-Item -LiteralPath $logPath -Destination $first -Force
    }
    $start = New-Object System.Diagnostics.ProcessStartInfo
    $start.FileName = $env:ComSpec
    $start.Arguments = '/c ""' + $cmdPath + '" >> "' + $logPath + '" 2>&1"'
    $start.WorkingDirectory = $appDir
    $start.UseShellExecute = $false
    $start.CreateNoWindow = $true
    $start.EnvironmentVariables['KTVIBES_PORT'] = [string]$script:networkPort
    $start.EnvironmentVariables['KTVIBES_AUTO_PORT'] = '1'
    $start.EnvironmentVariables['KTVIBES_PORT_FILE'] = $script:activePortFile
    $start.EnvironmentVariables['KTVIBES_CONFLICT_FILE'] = $script:conflictFile
    $start.EnvironmentVariables['KTVIBES_ADVERTISE_IP'] = $script:networkIP
    $start.EnvironmentVariables.Remove('KTVIBES_REMOTE_URL')
    $script:networkInstance = [Guid]::NewGuid().ToString('N')
    $start.EnvironmentVariables['KTVIBES_INSTANCE_ID'] = $script:networkInstance
    if ($script:networkBusy) { $start.EnvironmentVariables['KTVIBES_OPEN_BROWSER'] = '0' }
    $script:server = [System.Diagnostics.Process]::Start($start)
}

function Stop-KTVibes {
    if ($script:server -and -not $script:server.HasExited) {
        $stop = New-Object System.Diagnostics.ProcessStartInfo
        $stop.FileName = Join-Path $env:SystemRoot 'System32\taskkill.exe'
        $stop.Arguments = '/PID ' + $script:server.Id + ' /T /F'
        $stop.UseShellExecute = $false
        $stop.CreateNoWindow = $true
        $process = [System.Diagnostics.Process]::Start($stop)
        $process.WaitForExit()
        $process.Dispose()
    }
    $script:server = $null
}

$startupKey = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Software\Microsoft\Windows\CurrentVersion\Run')
$launchAtLogin = $startupKey -and $startupKey.GetValue('KTVibes')
if ($startupKey) { $startupKey.Dispose() }
if ($BackgroundLaunch) { $env:KTVIBES_OPEN_BROWSER = '0' }

$menu = New-Object System.Windows.Forms.ContextMenuStrip
$versionItem = New-Object System.Windows.Forms.ToolStripMenuItem
$menu.Renderer = New-Object KTVibesMenuRenderer
$versionItem.Name = 'KTVibesVersionItem'
$versionItem.add_Click({ if ($script:portConflict) { Show-NetworkSettings -Conflict } else { Start-Process $script:releaseUrl } })
[void]$menu.Items.Add($versionItem)
[void]$menu.Items.Add('-')
$openItem = $menu.Items.Add('Open Player')
$openItem.add_Click({ Start-Process ('http://localhost:' + $script:activePort) })
$logsItem = $menu.Items.Add('Show Logs')
$logsItem.add_Click({
    $powershell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
    $viewer = Join-Path $PSScriptRoot 'show-logs.ps1'
    $arguments = '-NoProfile -ExecutionPolicy Bypass -File "' + $viewer + '" -LogPath "' + $logPath + '"'
    Start-Process -FilePath $powershell -ArgumentList $arguments -WindowStyle Normal
})
$networkItem = $menu.Items.Add('Network Settings…')
$networkItem.add_Click({ Show-NetworkSettings })
[void]$menu.Items.Add('-')
$loginItem = New-Object System.Windows.Forms.ToolStripMenuItem('Launch at Login')
$loginItem.CheckOnClick = $true
$loginItem.Checked = [bool]$launchAtLogin
$loginItem.add_Click({
    $key = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey('Software\Microsoft\Windows\CurrentVersion\Run')
    try {
        if ($loginItem.Checked) {
            $key.SetValue('KTVibes', '"' + (Join-Path $appDir 'KTVibes.exe') + '" --background', [Microsoft.Win32.RegistryValueKind]::String)
        } else {
            $key.DeleteValue('KTVibes', $false)
        }
    } catch {
        $loginItem.Checked = -not $loginItem.Checked
        [System.Windows.Forms.MessageBox]::Show($_.Exception.Message, 'KTVibes') | Out-Null
    } finally { $key.Dispose() }
})
[void]$menu.Items.Add($loginItem)
[void]$menu.Items.Add('-')
$quitItem = $menu.Items.Add('Quit')
$quitItem.add_Click({ Stop-KTVibes; $notify.Visible = $false; $context.ExitThread() })

$versionItem.Text = "↓  Version $currentVersion    ↗"
$versionItem.Enabled = $true
$versionItem.ToolTipText = 'Open the latest KTVibes release on GitHub'

$updateTimer = New-Object System.Windows.Forms.Timer
$updateTimer.Interval = 10000
$updateTimer.add_Tick({
    if (Test-Path $script:activePortFile) {
        $candidate = Get-Content -LiteralPath $script:activePortFile -Raw -ErrorAction SilentlyContinue
        if ($candidate -match '^\s*\d+\s*$') { $script:activePort = [int]$candidate }
    }
    if ($script:server -and $script:server.HasExited -and -not (Test-Path $script:activePortFile)) {
        $script:portConflict = Test-Path $script:conflictFile
        if ($script:portConflict) { $versionItem.Text = 'Port conflict'; return }
    }
    try {
        $config = Invoke-RestMethod -Uri ('http://127.0.0.1:' + $script:activePort + '/api/config') -TimeoutSec 2
        if ($config.instance_id -ne $script:networkInstance) { return }
        if ($config.version) { $script:currentVersion = [string]$config.version }
        if ($config.update -and $config.update.version -and $config.update.url) {
            $script:updateVersion = ([string]$config.update.version).TrimStart('v')
            $script:releaseUrl = [string]$config.update.url
            $versionItem.Text = "↓  Version $script:currentVersion → $script:updateVersion    ↗"
            $versionItem.ToolTipText = "Open KTVibes $script:updateVersion on GitHub"
        } else {
            $script:updateVersion = $null
            $script:releaseUrl = 'https://github.com/JeffShih-wiwynn/KTVibes/releases/latest'
            $versionItem.Text = "↓  Version $script:currentVersion    ↗"
            $versionItem.ToolTipText = 'Open the latest KTVibes release on GitHub'
        }
    } catch { }
})

$context = New-Object System.Windows.Forms.ApplicationContext
$notify = New-Object System.Windows.Forms.NotifyIcon
$notify.Text = 'KTVibes'
$notify.Icon = New-Object System.Drawing.Icon($iconPath)
$notify.ContextMenuStrip = $menu
$notify.Visible = $true
$notify.add_DoubleClick({ Start-Process ('http://localhost:' + $script:activePort) })
try {
    Start-KTVibes
    $updateTimer.Start()
    [System.Windows.Forms.Application]::Run($context)
} finally {
    $updateTimer.Stop()
    $updateTimer.Dispose()
    Stop-KTVibes
    $notify.Dispose()
    $menu.Dispose()
    $context.Dispose()
}
