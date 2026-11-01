using System;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Threading;
using System.Reflection;
using System.Text.RegularExpressions;
using System.Windows.Forms;
using Microsoft.Win32;

internal static class LunaUninstallProgram
{
    [STAThread]
    private static int Main(string[] args)
    {
        if (args.Length == 2 && args[0] == "--remove") return RemoveInstalledFiles(args[1]);
        string directory = Path.GetDirectoryName(Application.ExecutablePath);
        bool silent = Array.Exists(args, value => String.Equals(value, "--silent", StringComparison.OrdinalIgnoreCase));
        if (!silent && MessageBox.Show("确定要卸载 Luna Browser 吗？\n你的浏览资料会保留。", "Luna Browser", MessageBoxButtons.YesNo, MessageBoxIcon.Question) != DialogResult.Yes) return 0;
        if (!File.Exists(Path.Combine(directory, ".luna-install-files"))) return 1;
        foreach (Process process in Process.GetProcessesByName("luna")) { try { if (Path.GetFullPath(process.MainModule.FileName).StartsWith(Path.GetFullPath(directory) + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase)) { if (!silent) MessageBox.Show("请先关闭 Luna Browser，然后重新运行卸载程序。", "Luna Browser", MessageBoxButtons.OK, MessageBoxIcon.Information); return 1; } } catch { } finally { process.Dispose(); } }
        string helper = Path.Combine(Path.GetTempPath(), "Luna-Uninstall-" + Guid.NewGuid().ToString("N") + ".exe");
        File.Copy(Application.ExecutablePath, helper);
        Process.Start(new ProcessStartInfo { FileName = helper, Arguments = "--remove " + Convert.ToBase64String(Encoding.UTF8.GetBytes(directory)), CreateNoWindow = true, UseShellExecute = false });
        bool testMode = Environment.GetEnvironmentVariable("LUNA_INSTALLER_TEST") == "1";
        string desktop = testMode ? Environment.GetEnvironmentVariable("LUNA_INSTALLER_TEST_DESKTOP") : Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory);
        string programs = testMode ? Environment.GetEnvironmentVariable("LUNA_INSTALLER_TEST_STARTMENU") : Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.StartMenu), "Programs");
        if (!String.IsNullOrEmpty(desktop)) DeleteOwnedShortcut(Path.Combine(desktop, "Luna Browser.lnk"), directory);
        if (!String.IsNullOrEmpty(programs)) { DeleteOwnedShortcut(Path.Combine(programs, "Luna Browser", "Luna Browser.lnk"), directory); try { Directory.Delete(Path.Combine(programs, "Luna Browser"), false); } catch { } }
        string testKey = Environment.GetEnvironmentVariable("LUNA_INSTALLER_TEST_REGISTRY") ?? "";
        string keyName = testMode ? (Regex.IsMatch(testKey, @"\ALuna Browser Test [a-zA-Z0-9-]+\z") ? "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\" + testKey : null) : "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Luna Browser";
        if (keyName != null) try {
            using (RegistryKey key = Registry.CurrentUser.OpenSubKey(keyName)) {
                if (key != null && String.Equals(key.GetValue("InstallLocation") as string, directory, StringComparison.OrdinalIgnoreCase)) Registry.CurrentUser.DeleteSubKeyTree(keyName, false);
            }
        } catch { }
        return 0;
    }

    private static int RemoveInstalledFiles(string encodedDirectory)
    {
        try {
            string directory = Path.GetFullPath(Encoding.UTF8.GetString(Convert.FromBase64String(encodedDirectory)));
            string prefix = directory.TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
            string manifest = Path.Combine(directory, ".luna-install-files");
            string[] files = File.ReadAllLines(manifest);
            Thread.Sleep(750);
            foreach (string relative in files) {
                if (String.IsNullOrWhiteSpace(relative) || Path.IsPathRooted(relative) || relative.Contains(":")) return 1;
                string file = Path.GetFullPath(Path.Combine(directory, relative));
                if (!file.StartsWith(prefix, StringComparison.OrdinalIgnoreCase)) return 1;
                string parent = Path.GetDirectoryName(file);
                while (parent != null && parent.StartsWith(prefix, StringComparison.OrdinalIgnoreCase)) {
                    if ((File.GetAttributes(parent) & FileAttributes.ReparsePoint) != 0) return 1;
                    parent = Path.GetDirectoryName(parent);
                }
                for (int attempt = 0; ; attempt++) {
                    try { if (File.Exists(file)) File.Delete(file); break; }
                    catch { if (attempt == 20) throw; Thread.Sleep(250); }
                }
            }
            File.Delete(manifest);
            foreach (string relative in files) {
                string parent = Path.GetDirectoryName(Path.Combine(directory, relative));
                while (parent != null && parent.StartsWith(prefix, StringComparison.OrdinalIgnoreCase)) {
                    try { Directory.Delete(parent, false); } catch { break; }
                    parent = Path.GetDirectoryName(parent);
                }
            }
            try { Directory.Delete(directory, false); } catch { }
            return 0;
        } catch { return 1; }
        finally {
            ProcessStartInfo cleanup = new ProcessStartInfo { FileName = "cmd.exe", Arguments = "/d /c ping 127.0.0.1 -n 2 > nul & del /q \"%LUNA_UNINSTALL_HELPER%\"", CreateNoWindow = true, UseShellExecute = false };
            cleanup.EnvironmentVariables["LUNA_UNINSTALL_HELPER"] = Application.ExecutablePath;
            Process.Start(cleanup);
        }
    }

    private static void DeleteOwnedShortcut(string file, string directory)
    {
        if (!File.Exists(file)) return;
        object shell = null, shortcut = null;
        try {
            Type type = Type.GetTypeFromProgID("WScript.Shell"); shell = Activator.CreateInstance(type);
            shortcut = type.InvokeMember("CreateShortcut", BindingFlags.InvokeMethod, null, shell, new object[] { file });
            string target = (string)shortcut.GetType().InvokeMember("TargetPath", BindingFlags.GetProperty, null, shortcut, null);
            if (String.Equals(Path.GetFullPath(target), Path.Combine(directory, "luna.exe"), StringComparison.OrdinalIgnoreCase)) File.Delete(file);
        } catch { }
        finally {
            if (shortcut != null) System.Runtime.InteropServices.Marshal.ReleaseComObject(shortcut);
            if (shell != null) System.Runtime.InteropServices.Marshal.ReleaseComObject(shell);
        }
    }

}
