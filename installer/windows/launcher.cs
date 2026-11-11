using System;
using System.Diagnostics;
using System.IO;
using System.Windows.Forms;

internal static class Launcher
{
    [STAThread]
    private static void Main()
    {
        string appDir = AppDomain.CurrentDomain.BaseDirectory;
        try
        {
            var start = new ProcessStartInfo
            {
                FileName = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System),
                    @"WindowsPowerShell\v1.0\powershell.exe"),
                Arguments = "-NoProfile -STA -ExecutionPolicy Bypass -File \"" +
                    Path.Combine(appDir, @"installer\tray.ps1") + "\"" +
                    (Environment.GetCommandLineArgs().Length > 1 && Environment.GetCommandLineArgs()[1] == "--background" ? " -BackgroundLaunch" : ""),
                WorkingDirectory = appDir,
                UseShellExecute = false,
                CreateNoWindow = true
            };
            using (Process process = Process.Start(start)) { }
        }
        catch (Exception error)
        {
            MessageBox.Show("Could not start KTVibes: " + error.Message, "KTVibes",
                MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
    }
}
