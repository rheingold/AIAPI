Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
using System.Diagnostics;
using System.Collections.Generic;

public class WinEnum {
    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
    [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
    [DllImport("user32.dll")] public static extern int GetWindowTextLength(IntPtr h);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
    [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr h, int nIndex);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
    [DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr h, uint uCmd);
    [DllImport("user32.dll")] public static extern IntPtr GetParent(IntPtr h);
    [DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr h, EnumWindowsProc cb, IntPtr lp);
    [DllImport("user32.dll")] static extern int GetClassName(IntPtr h, StringBuilder s, int n);

    public delegate bool EnumWindowsProc(IntPtr h, IntPtr lp);

    public const int GWL_STYLE   = -16;
    public const int GWL_EXSTYLE = -20;
    public const uint WS_MAXIMIZEBOX  = 0x00010000;
    public const uint WS_MINIMIZEBOX  = 0x00020000;
    public const uint WS_CAPTION      = 0x00C00000;
    public const uint WS_SYSMENU      = 0x00080000;
    public const uint WS_THICKFRAME   = 0x00040000;
    public const uint WS_DLGFRAME     = 0x00400000;
    public const uint WS_BORDER       = 0x00800000;
    public const uint WS_POPUP        = 0x80000000;
    public const uint WS_EX_DLGMODAL  = 0x00000001;
    public const uint WS_EX_TOOLWINDOW= 0x00000080;

    public static List<string> Snapshot(int pid) {
        var results = new List<string>();
        EnumWindows((h, lp) => {
            uint wpid;
            GetWindowThreadProcessId(h, out wpid);
            if ((int)wpid != pid) return true;
            if (!IsWindowVisible(h)) return true;

            var title = new StringBuilder(512);
            GetWindowText(h, title, 512);
            var cls   = new StringBuilder(128);
            GetClassName(h, cls, 128);

            int style   = GetWindowLong(h, GWL_STYLE);
            int exStyle = GetWindowLong(h, GWL_EXSTYLE);
            uint us = (uint)style;
            uint ue = (uint)exStyle;

            bool hasMaxBox   = (us & WS_MAXIMIZEBOX) != 0;
            bool hasMinBox   = (us & WS_MINIMIZEBOX) != 0;
            bool hasCaption  = (us & WS_CAPTION)     != 0;
            bool hasSysMenu  = (us & WS_SYSMENU)     != 0;
            bool hasThick    = (us & WS_THICKFRAME)  != 0;
            bool hasDlgFrame = (us & WS_DLGFRAME)    != 0;
            bool hasPopup    = (us & WS_POPUP)        != 0;

            var info = string.Format(
                "HWND=0x{0:X8}  MaxBox={1}  MinBox={2}  Caption={3}  SysMenu={4}  Thick={5}  DlgFrame={6}  Popup={7}  Style=0x{8:X8}  Title=[{9}]  Class=[{10}]",
                h.ToInt64(), hasMaxBox?1:0, hasMinBox?1:0, hasCaption?1:0, hasSysMenu?1:0, hasThick?1:0, hasDlgFrame?1:0, hasPopup?1:0, us, title, cls);
            results.Add(info);
            return true;
        }, IntPtr.Zero);
        return results;
    }
}
"@

# Launch Impress (no existing doc - forces template dialog)
$soffice = "C:\Program Files\LibreOffice\program\soffice.exe"
if (-not (Test-Path $soffice)) {
    $soffice = (Get-ChildItem "C:\Program Files*\LibreOffice*\program\soffice.exe" -EA SilentlyContinue | Select -First 1).FullName
}
Write-Host "Launching: $soffice"
$proc = Start-Process -FilePath $soffice -ArgumentList "--impress" -PassThru
Write-Host "Launch PID: $($proc.Id)"

# Poll for 30 seconds, snapshot every 2 seconds — collect ALL soffice PIDs
for ($i=0; $i -lt 15; $i++) {
    Start-Sleep 2
    # soffice.bin is the real process owning windows (soffice.exe is launcher)
    $sofPids = @(Get-Process -Name "soffice*" -EA SilentlyContinue | Select-Object -ExpandProperty Id)
    Write-Host "=== t=$($i*2+2)s  soffice PIDs: $sofPids ==="
    foreach ($spid in $sofPids) {
        $wins = [WinEnum]::Snapshot($spid)
        foreach ($w in $wins) { Write-Host "  PID=$spid  $w" }
    }
}
