param([Parameter(Mandatory=$true)][string]$Directory)
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class LunaDiskSize {
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern uint GetCompressedFileSizeW(string file, out uint high);
    public static ulong Measure(string file) {
        uint high;
        uint low = GetCompressedFileSizeW(file, out high);
        if (low == uint.MaxValue && Marshal.GetLastWin32Error() != 0)
            throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
        return ((ulong)high << 32) | low;
    }
}
'@
[long]$logical = 0
[long]$allocated = 0
[int]$count = 0
foreach ($file in Get-ChildItem -LiteralPath $Directory -Recurse -File -Force) {
    $logical += $file.Length
    $allocated += [LunaDiskSize]::Measure($file.FullName)
    $count++
}
[PSCustomObject]@{ logicalBytes = $logical; allocatedBytes = $allocated; fileCount = $count } | ConvertTo-Json -Compress
