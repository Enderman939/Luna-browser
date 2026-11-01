using System;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Text;

internal static class InstallerBootstrap
{
    private static int Main(string[] args)
    {
        string token = Guid.NewGuid().ToString("N");
        string archive = Path.Combine(Path.GetTempPath(), "LunaInstallerApp-" + token + ".zip");
        string root = Path.Combine(Path.GetTempPath(), "LunaSetup-" + token);
        try
        {
            using (FileStream executable = File.OpenRead(System.Reflection.Assembly.GetExecutingAssembly().Location))
            using (BinaryReader reader = new BinaryReader(executable))
            {
                if (executable.Length < 16) throw new InvalidDataException("Installer payload is missing.");
                executable.Seek(-16, SeekOrigin.End);
                long length = reader.ReadInt64();
                if (Encoding.ASCII.GetString(reader.ReadBytes(8)) != "LUNAZIP1" || length <= 0 || length > executable.Length - 16) throw new InvalidDataException("Installer payload is invalid.");
                executable.Seek(-16 - length, SeekOrigin.End);
                using (FileStream output = File.Create(archive)) {
                    byte[] buffer = new byte[1024 * 1024];
                    while (length > 0) { int read = executable.Read(buffer, 0, (int)Math.Min(buffer.Length, length)); if (read == 0) throw new EndOfStreamException(); output.Write(buffer, 0, read); length -= read; }
                }
            }
            string application = Path.Combine(root, "app");
            Directory.CreateDirectory(application);
            using (ZipArchive zip = ZipFile.OpenRead(archive))
            {
                string destination = Path.GetFullPath(application) + Path.DirectorySeparatorChar;
                foreach (ZipArchiveEntry entry in zip.Entries)
                {
                    string entryPath = entry.FullName.Replace('/', Path.DirectorySeparatorChar).Replace('\\', Path.DirectorySeparatorChar);
                    bool hasTraversal = false; foreach (string part in entryPath.Split(Path.DirectorySeparatorChar)) if (part == "..") { hasTraversal = true; break; }
                    if (Path.IsPathRooted(entryPath) || hasTraversal) throw new InvalidDataException("Unsafe installer archive entry.");
                    string resolved = Path.GetFullPath(Path.Combine(application, entryPath));
                    if (resolved == Path.GetFullPath(application) && (entry.FullName.EndsWith("/", StringComparison.Ordinal) || entry.FullName.EndsWith("\\", StringComparison.Ordinal))) continue;
                    if (!resolved.StartsWith(destination, StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("Installer archive entry escaped the temporary folder.");
                    string parent = Path.GetDirectoryName(resolved); if (!String.IsNullOrEmpty(parent)) Directory.CreateDirectory(parent);
                    if (entry.FullName.EndsWith("/", StringComparison.Ordinal) || entry.FullName.EndsWith("\\", StringComparison.Ordinal)) { Directory.CreateDirectory(resolved); continue; }
                    using (Stream input = entry.Open()) using (FileStream output = File.Create(resolved)) input.CopyTo(output);
                }
            }
            string applicationExe = Path.Combine(application, "luna.exe");
            if (!File.Exists(applicationExe)) throw new FileNotFoundException("Luna Setup application payload is incomplete.");
            ProcessStartInfo info = new ProcessStartInfo { FileName = applicationExe, WorkingDirectory = application, UseShellExecute = false };
            for (int i = 0; i < args.Length; i++) AddArgument(info, args[i]);
            using (Process child = Process.Start(info)) { child.WaitForExit(); return child.ExitCode; }
        }
        catch (Exception error)
        {
            try { File.AppendAllText(Path.Combine(Path.GetTempPath(), "luna-bootstrap-debug.log"), DateTime.UtcNow.ToString("O") + "\n" + error + "\n"); } catch { }
            return 1;
        }
        finally { try { Directory.Delete(root, true); } catch { } try { File.Delete(archive); } catch { } }
    }

    private static void AddArgument(ProcessStartInfo info, string argument)
    {
        if (info.Arguments.Length > 0) info.Arguments += " ";
        info.Arguments += Quote(argument);
    }

    private static string Quote(string value)
    {
        if (value.Length > 0 && value.IndexOfAny(new char[] { ' ', '\t', '"' }) < 0) return value;
        StringBuilder result = new StringBuilder("\""); int backslashes = 0;
        foreach (char c in value)
        {
            if (c == '\\') { backslashes++; continue; }
            if (c == '"') { result.Append('\\', backslashes * 2 + 1); result.Append(c); backslashes = 0; continue; }
            result.Append('\\', backslashes); result.Append(c); backslashes = 0;
        }
        result.Append('\\', backslashes * 2); result.Append('"'); return result.ToString();
    }
}
