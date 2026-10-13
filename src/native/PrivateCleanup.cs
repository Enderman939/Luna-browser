using System;
using System.Diagnostics;
using System.IO;
using System.Text.RegularExpressions;
using System.Threading;

internal static class PrivateCleanup {
    [STAThread]
    private static void Main(string[] args) {
        try {
            int owner;
            if (args.Length != 2 || !Int32.TryParse(args[1], out owner) || owner <= 0) return;
            string root = Path.GetFullPath(args[0]);
            if (Path.GetFileName(root) != "private-sessions") return;
            // Detached windowless process survives owner crashes. Only directories
            // named for this owner are removed; other browser processes are untouched.
            try { using (Process process = Process.GetProcessById(owner)) process.WaitForExit(); }
            catch (ArgumentException) { /* Owner already exited. */ }
            if (!Directory.Exists(root)) return;
            Regex owned = new Regex("^" + owner + "-[a-f0-9-]{36}$");
            foreach (string directory in Directory.GetDirectories(root)) {
                if (!owned.IsMatch(Path.GetFileName(directory))) continue;
                if ((File.GetAttributes(directory) & FileAttributes.ReparsePoint) != 0) continue;
                for (int attempt = 0; attempt < 20; attempt++) {
                    try { Directory.Delete(directory, true); break; }
                    catch (IOException) { Thread.Sleep(300); }
                    catch (UnauthorizedAccessException) { Thread.Sleep(300); }
                }
            }
        } catch { /* Startup recovery retries owned stale directories. */ }
    }
}
