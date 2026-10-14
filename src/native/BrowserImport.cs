using System;
using System.Text;
using System.Security.Cryptography;
using System.Web.Script.Serialization;
class BrowserImport {
  static int Main() {
    try {
      Console.InputEncoding = Encoding.UTF8; Console.OutputEncoding = new UTF8Encoding(false);
      string input = Console.In.ReadToEnd(); if (input.Length > 32000000) return 1;
      var serializer = new JavaScriptSerializer { MaxJsonLength = 32000000 };
      var values = serializer.Deserialize<string[]>(input); if (values == null || values.Length > 5000) return 1;
      var result = new string[values.Length];
      for (int i=0; i<values.Length; i++) {
        byte[] plain = null;
        try { var encrypted = Convert.FromBase64String(values[i]); if (encrypted.Length > 65536) continue;
          plain = ProtectedData.Unprotect(encrypted, null, DataProtectionScope.CurrentUser); result[i] = Convert.ToBase64String(plain);
        } catch { result[i] = null; } finally { if (plain != null) Array.Clear(plain, 0, plain.Length); }
      }
      Console.Write(serializer.Serialize(result)); return 0;
    } catch { return 1; }
  }
}
