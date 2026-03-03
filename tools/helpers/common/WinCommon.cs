// tools/helpers/common/WinCommon.cs
// ─────────────────────────────────────────────────────────────────────────────
// Win32 P/Invokes, UIA helpers and input utilities shared between KeyWin.exe
// and BrowserWin.exe.  Compiled into each executable as source — NOT a DLL.
// Adding this file to a csc compile command "mixes" the code into the output
// assembly without any runtime DLL loading or additional files to deploy.
//
// C# 5 / .NET 4.0 compatible (no string interpolation, no nameof(), no ?.,
// no inline 'out var', no expression-bodied members).
//
// References required by callers:
//   /r:UIAutomationClient.dll
//   /r:UIAutomationTypes.dll
//   /r:WindowsBase.dll
//   /r:System.Windows.Forms.dll   (for SendKeys in DirectSendKeys)
// ─────────────────────────────────────────────────────────────────────────────

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Windows.Automation;

/// <summary>
/// Static utility class with Win32/UIA helpers shared across helper executables.
/// Compiled directly into every consumer — no separate DLL.
/// </summary>
public static class WinUtils
{
    // ── P/Invoke declarations ─────────────────────────────────────────────────

    [DllImport("user32.dll")]
    public static extern bool SetForegroundWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);

    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);

    [DllImport("user32.dll")]
    public static extern int GetWindowTextLength(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern bool IsWindowVisible(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern int GetWindowThreadProcessId(IntPtr hWnd, out int lpdwProcessId);

    [DllImport("user32.dll")]
    public static extern uint SendInput(uint nInputs,
        [MarshalAs(UnmanagedType.LPArray), In] INPUT[] pInputs, int cbSize);

    [DllImport("user32.dll")]
    public static extern bool SetCursorPos(int X, int Y);

    [DllImport("user32.dll", CharSet = CharSet.Auto)]
    public static extern IntPtr SendMessage(IntPtr hWnd, uint Msg,
        IntPtr wParam, IntPtr lParam);

    [DllImport("user32.dll", CharSet = CharSet.Auto)]
    public static extern bool PostMessage(IntPtr hWnd, uint Msg,
        IntPtr wParam, IntPtr lParam);

    [DllImport("user32.dll")]
    public static extern bool ScreenToClient(IntPtr hWnd, ref POINT lpPoint);

    [DllImport("user32.dll")]
    public static extern short VkKeyScan(char ch);

    [DllImport("user32.dll", SetLastError = true)]
    public static extern IntPtr FindWindowEx(IntPtr parentHandle, IntPtr childAfter,
        string className, string windowTitle);

    public delegate bool EnumChildProc(IntPtr hwnd, IntPtr lParam);

    [DllImport("user32.dll")]
    public static extern bool EnumChildWindows(IntPtr parent, EnumChildProc callback,
        IntPtr lParam);

    [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
    public static extern int GetClassName(IntPtr hWnd, StringBuilder lpClassName,
        int nMaxCount);

    // ── Structures ────────────────────────────────────────────────────────────

    [StructLayout(LayoutKind.Sequential)]
    public struct POINT
    {
        public int X;
        public int Y;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct INPUT
    {
        public uint type;
        public MOUSEINPUT mi;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct MOUSEINPUT
    {
        public int   dx;
        public int   dy;
        public uint  mouseData;
        public uint  dwFlags;
        public uint  time;
        public IntPtr dwExtraInfo;
    }

    // ── Constants ─────────────────────────────────────────────────────────────

    public const uint INPUT_MOUSE         = 0;
    public const uint MOUSEEVENTF_LEFTDOWN = 0x0002;
    public const uint MOUSEEVENTF_LEFTUP   = 0x0004;

    public const uint WM_KEYDOWN   = 0x0100;
    public const uint WM_KEYUP     = 0x0101;
    public const uint WM_CHAR      = 0x0102;
    public const uint WM_LBUTTONDOWN = 0x0201;
    public const uint WM_LBUTTONUP   = 0x0202;
    public const uint MK_LBUTTON   = 0x0001;

    public const byte VK_SHIFT    = 0x10;
    public const byte VK_CONTROL  = 0x11;
    public const byte VK_MENU     = 0x12;   // Alt
    public const byte VK_RETURN   = 0x0D;
    public const byte VK_TAB      = 0x09;
    public const byte VK_ESCAPE   = 0x1B;
    public const byte VK_BACK     = 0x08;
    public const byte VK_DELETE   = 0x2E;
    public const byte VK_LEFT     = 0x25;
    public const byte VK_UP       = 0x26;
    public const byte VK_RIGHT    = 0x27;
    public const byte VK_DOWN     = 0x28;

    // Chromium render-widget class names used to find the keyboard target HWND
    public static readonly string[] ChromiumRenderClasses = new[]
    {
        "Chrome_RenderWidgetHostHWND",
        "CefBrowserWindow",
    };

    // ── Window search ─────────────────────────────────────────────────────────

    // EnumWindows callback state (static for the delegate signature requirement)
    static IntPtr _foundHwndForProcess  = IntPtr.Zero;
    static int    _targetProcessId      = 0;

    static bool _enumWindowForProcess(IntPtr hWnd, IntPtr lParam)
    {
        int pid;
        GetWindowThreadProcessId(hWnd, out pid);
        if (pid == _targetProcessId && IsWindowVisible(hWnd))
        {
            var sb = new StringBuilder(256);
            GetWindowText(hWnd, sb, 256);
            if (!string.IsNullOrWhiteSpace(sb.ToString()))
            {
                _foundHwndForProcess = hWnd;
                return false; // stop enumeration
            }
        }
        return true;
    }

    /// <summary>
    /// Locate the main window HWND for <paramref name="processNameOrId"/>.
    /// Supports:
    ///   "notepad"              — process name (without .exe)
    ///   "notepad.exe"          — process name with .exe suffix
    ///   "PID:12345"            — numeric process id
    ///   "HANDLE:67890"         — raw window handle (decimal)
    ///   "brave", "msedge" …    — browser process names
    /// </summary>
    public static IntPtr FindWindowByProcessName(string processNameOrId)
    {
        if (string.IsNullOrEmpty(processNameOrId)) return IntPtr.Zero;
        try
        {
            // PID:nnnnn
            if (processNameOrId.StartsWith("PID:", StringComparison.OrdinalIgnoreCase))
            {
                int pid;
                if (int.TryParse(processNameOrId.Substring(4), out pid))
                    return FindWindowByPid(pid);
                return IntPtr.Zero;
            }

            // HANDLE:nnnnn
            if (processNameOrId.StartsWith("HANDLE:", StringComparison.OrdinalIgnoreCase))
            {
                long handle;
                if (long.TryParse(processNameOrId.Substring(7), out handle))
                {
                    IntPtr hwnd = new IntPtr(handle);
                    if (IsWindowVisible(hwnd)) return hwnd;
                }
                return IntPtr.Zero;
            }

            // Process name
            string processName = processNameOrId;
            if (processName.EndsWith(".exe", StringComparison.OrdinalIgnoreCase))
                processName = processName.Substring(0, processName.Length - 4);

            Process[] processes = Process.GetProcessesByName(processName);
            Console.Error.WriteLine("DEBUG[WinUtils]: " + processes.Length
                + " process(es) named '" + processName + "'");

            foreach (var p in processes)
            {
                IntPtr hwnd = p.MainWindowHandle;
                Console.Error.WriteLine("DEBUG[WinUtils]: pid=" + p.Id + " MainWindowHandle=" + hwnd);
                if (hwnd != IntPtr.Zero) return hwnd;

                // Fallback: enumerate all windows for this PID
                _targetProcessId     = p.Id;
                _foundHwndForProcess = IntPtr.Zero;
                EnumWindows(_enumWindowForProcess, IntPtr.Zero);
                if (_foundHwndForProcess != IntPtr.Zero) return _foundHwndForProcess;
            }

            // Last resort: window whose title contains the process name
            IntPtr titleMatch = FindWindowByPartialTitle(processName);
            if (titleMatch != IntPtr.Zero)
            {
                Console.Error.WriteLine("DEBUG[WinUtils]: Title fallback handle=" + titleMatch);
                return titleMatch;
            }

            return IntPtr.Zero;
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine("DEBUG[WinUtils]: FindWindowByProcessName error: " + ex.Message);
            return IntPtr.Zero;
        }
    }

    /// <summary>Find the main window for a numeric process id.</summary>
    public static IntPtr FindWindowByPid(int pid)
    {
        try
        {
            Process p = Process.GetProcessById(pid);
            IntPtr hwnd = p.MainWindowHandle;
            if (hwnd != IntPtr.Zero) return hwnd;

            _targetProcessId     = pid;
            _foundHwndForProcess = IntPtr.Zero;
            EnumWindows(_enumWindowForProcess, IntPtr.Zero);
            return _foundHwndForProcess;
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine("DEBUG[WinUtils]: FindWindowByPid error: " + ex.Message);
            return IntPtr.Zero;
        }
    }

    /// <summary>
    /// Find any visible top-level window whose title contains
    /// <paramref name="titleSearch"/> (case-insensitive).
    /// </summary>
    public static IntPtr FindWindowByPartialTitle(string titleSearch)
    {
        IntPtr match = IntPtr.Zero;
        EnumWindows((hWnd, lParam) =>
        {
            if (!IsWindowVisible(hWnd)) return true;
            var sb = new StringBuilder(256);
            GetWindowText(hWnd, sb, 256);
            string title = sb.ToString();
            if (string.IsNullOrWhiteSpace(title)) return true;
            if (title.IndexOf(titleSearch, StringComparison.OrdinalIgnoreCase) >= 0)
            {
                match = hWnd;
                Console.Error.WriteLine("DEBUG[WinUtils]: Title match '" + title + "'");
                return false; // stop
            }
            return true;
        }, IntPtr.Zero);
        return match;
    }

    // ── LISTWINDOWS ───────────────────────────────────────────────────────────

    /// <summary>
    /// Returns a compact JSON string listing all visible top-level windows:
    ///   {"success":true,"windows":[{"handle":N,"title":"...","pid":N}, ...]}
    /// </summary>
    public static string ListWindowsJson()
    {
        var windows = new List<string>();
        EnumWindows((h, lParam) =>
        {
            if (IsWindowVisible(h))
            {
                int len = GetWindowTextLength(h);
                if (len > 0)
                {
                    var sb = new StringBuilder(len + 1);
                    GetWindowText(h, sb, sb.Capacity);
                    string title = sb.ToString();
                    int pid;
                    GetWindowThreadProcessId(h, out pid);
                    windows.Add("{\"handle\":" + h.ToInt64()
                        + ",\"title\":\"" + EscapeJson(title)
                        + "\",\"pid\":" + pid + "}");
                }
            }
            return true;
        }, IntPtr.Zero);
        return "{\"success\":true,\"windows\":["
            + string.Join(",", windows.ToArray()) + "]}";
    }

    // ── Chromium render widget ────────────────────────────────────────────────

    /// <summary>
    /// Find the Chrome_RenderWidgetHostHWND (the surface that receives keyboard
    /// input in Chromium-based browsers) inside a top-level browser window HWND.
    /// Returns IntPtr.Zero when the window is not a Chromium browser.
    /// </summary>
    public static IntPtr FindRenderWidgetHwnd(IntPtr topHwnd)
    {
        IntPtr found = IntPtr.Zero;
        EnumChildWindows(topHwnd, (child, _) =>
        {
            var sb = new StringBuilder(256);
            GetClassName(child, sb, 256);
            string cls = sb.ToString();
            foreach (var rc in ChromiumRenderClasses)
            {
                if (cls.IndexOf(rc, StringComparison.OrdinalIgnoreCase) >= 0)
                {
                    found = child;
                    return false; // stop
                }
            }
            return true;
        }, IntPtr.Zero);
        return found;
    }

    // ── JSON ──────────────────────────────────────────────────────────────────

    /// <summary>Escape a string for safe embedding as a JSON string value (no surrounding quotes).</summary>
    public static string EscapeJson(string text)
    {
        if (string.IsNullOrEmpty(text)) return "";
        return text
            .Replace("\\", "\\\\")
            .Replace("\"", "\\\"")
            .Replace("\n", "\\n")
            .Replace("\r", "\\r")
            .Replace("\t", "\\t");
    }

    // ── UIA: Query UI tree ────────────────────────────────────────────────────

    /// <summary>
    /// Return a JSON string representing the UIA element tree of <paramref name="hwnd"/>
    /// to the specified depth.  Output schema mirrors BrowserWin CDP QUERYTREE so that
    /// the same MCP engine can process results from both modes.
    /// </summary>
    public static string QueryUITree(IntPtr hwnd, int maxDepth)
    {
        try
        {
            var root = AutomationElement.FromHandle(hwnd);
            var tree = BuildTreeJson(root, 0, maxDepth);
            // Wrap in QUERYTREE envelope
            return "{\"success\":true,\"command\":\"QUERYTREE\",\"mode\":\"uia\","
                + "\"depth\":" + maxDepth + ",\"tree\":" + tree + "}";
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine("DEBUG[WinUtils]: QueryUITree error: " + ex.Message);
            return "{\"success\":false,\"error\":\"" + EscapeJson(ex.Message) + "\"}";
        }
    }

    /// <summary>Recursively serialise a UIA element to JSON.</summary>
    public static string BuildTreeJson(AutomationElement element, int currentDepth, int maxDepth)
    {
        if (element == null || currentDepth > maxDepth) return "null";

        var sb = new StringBuilder();
        sb.Append("{");
        sb.Append("\"id\":\""   + EscapeJson(element.Current.AutomationId) + "\",");
        sb.Append("\"type\":\"" + EscapeJson(element.Current.ControlType.ProgrammaticName) + "\",");
        sb.Append("\"name\":\"" + EscapeJson(element.Current.Name) + "\",");

        try
        {
            System.Windows.Rect rect = element.Current.BoundingRectangle;
            if (!double.IsInfinity(rect.X) && !double.IsInfinity(rect.Y))
            {
                sb.Append("\"position\":{\"x\":" + (int)rect.X
                    + ",\"y\":" + (int)rect.Y
                    + ",\"width\":" + (int)rect.Width
                    + ",\"height\":" + (int)rect.Height + "},");
            }
        }
        catch { }

        sb.Append("\"properties\":{\"isEnabled\":"
            + (element.Current.IsEnabled  ? "true" : "false") + ","
            + "\"isOffscreen\":"
            + (element.Current.IsOffscreen ? "true" : "false") + "},");

        sb.Append("\"actions\":[");
        var patterns = element.GetSupportedPatterns();
        var actions  = new List<string>();
        if (Array.IndexOf(patterns, InvokePattern.Pattern) >= 0)
            actions.Add("\"click\"");
        if (Array.IndexOf(patterns, ValuePattern.Pattern) >= 0)
        {
            actions.Add("\"setValue\"");
            actions.Add("\"readValue\"");
        }
        if (Array.IndexOf(patterns, TextPattern.Pattern) >= 0)
            actions.Add("\"setText\"");
        sb.Append(string.Join(",", actions.ToArray()));
        sb.Append("]");

        // Include ValuePattern value (current content of text inputs, address bar, etc.)
        if (Array.IndexOf(patterns, ValuePattern.Pattern) >= 0)
        {
            try
            {
                var vp2 = element.GetCurrentPattern(ValuePattern.Pattern) as ValuePattern;
                if (vp2 != null)
                {
                    string elemVal = vp2.Current.Value;
                    if (elemVal != null)
                        sb.Append(",\"value\":\"" + EscapeJson(elemVal) + "\"");
                }
            }
            catch { }
        }

        if (currentDepth < maxDepth)
        {
            try
            {
                var walker   = new TreeWalker(Condition.TrueCondition);
                var child    = walker.GetFirstChild(element);
                var children = new List<string>();
                while (child != null)
                {
                    children.Add(BuildTreeJson(child, currentDepth + 1, maxDepth));
                    child = walker.GetNextSibling(child);
                }
                if (children.Count > 0)
                {
                    sb.Append(",\"children\":[");
                    sb.Append(string.Join(",", children.ToArray()));
                    sb.Append("]");
                }
            }
            catch { }
        }

        sb.Append("}");
        return sb.ToString();
    }

    // ── UIA: Read text content ────────────────────────────────────────────────

    /// <summary>
    /// Read the primary text value from a window (Document, Edit, or Text control).
    /// Returns null when nothing readable is found.
    /// </summary>
    public static string ReadDisplayText(IntPtr hwnd)
    {
        try
        {
            var root = AutomationElement.FromHandle(hwnd);
            AutomationElement display = null;

            // Calculator-specific: prefer CalculatorResults AutomationId
            var condId = new PropertyCondition(AutomationElement.AutomationIdProperty, "CalculatorResults");
            display = root.FindFirst(TreeScope.Descendants, condId);

            if (display == null)
            {
                var condDoc = new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.Document);
                display = root.FindFirst(TreeScope.Descendants, condDoc);
            }
            if (display == null)
            {
                var condEdit = new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.Edit);
                display = root.FindFirst(TreeScope.Descendants, condEdit);
            }
            if (display == null)
            {
                var condText = new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.Text);
                display = root.FindFirst(TreeScope.Descendants, condText);
            }

            if (display != null)
            {
                try
                {
                    var vp = display.GetCurrentPattern(ValuePattern.Pattern) as ValuePattern;
                    if (vp != null)
                    {
                        string rawVal = vp.Current.Value;
                        if (rawVal != null)
                        {
                            string autoId = display.Current.AutomationId ?? "";
                            if (autoId == "CalculatorResults")
                            {
                                var m = Regex.Match(rawVal, @"[\d\+\-\*/\.,\(\)eE]+$");
                                if (m.Success) return m.Value.Trim();
                            }
                            return rawVal;
                        }
                    }
                }
                catch { }

                string name = display.Current.Name;
                if (!string.IsNullOrWhiteSpace(name))
                {
                    string autoId2 = display.Current.AutomationId ?? "";
                    if (autoId2 == "CalculatorResults")
                    {
                        var m = Regex.Match(name, @"[\d\+\-\*/\.,\(\)eE]+$");
                        if (m.Success) return m.Value.Trim();
                    }
                    return name;
                }
            }
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine("DEBUG[WinUtils]: ReadDisplayText error: " + ex.Message);
        }
        return null;
    }

    // ── UIA: Read / focus element by AutomationId or Name ────────────────────

    /// <summary>
    /// Find an automation element by AutomationId (matches HTML id in browsers) or
    /// Name property, and return its ValuePattern value — or its Name as fallback.
    /// Returns null when the element is not found or has no readable content.
    /// </summary>
    public static string ReadElementValue(AutomationElement root, string selector)
    {
        if (root == null || string.IsNullOrEmpty(selector)) return null;
        AutomationElement elem = null;
        // 1. AutomationId — matches the HTML `id` attribute in Chromium browsers
        try
        {
            var cond = new PropertyCondition(AutomationElement.AutomationIdProperty, selector);
            elem = root.FindFirst(TreeScope.Descendants, cond);
        }
        catch { }
        // 2. UIA Name property
        if (elem == null)
        {
            try
            {
                var cond = new PropertyCondition(AutomationElement.NameProperty, selector);
                elem = root.FindFirst(TreeScope.Descendants, cond);
            }
            catch { }
        }
        // 3. By associated label text (ARIA for= / LabeledBy)
        if (elem == null)
            elem = FindElementByLabel(root, selector);
        if (elem == null) return null;
        try
        {
            var vp = elem.GetCurrentPattern(ValuePattern.Pattern) as ValuePattern;
            if (vp != null) return vp.Current.Value;
        }
        catch { }
        try { return elem.Current.Name; }
        catch { }
        return null;
    }

    /// <summary>
    /// Walk all descendants and find an element whose LabeledBy element has a Name
    /// matching labelText (case-insensitive).  This covers &lt;label for="id"&gt; associations
    /// that Firefox and Edge expose via ARIA→UIA bridging.
    /// </summary>
    public static AutomationElement FindElementByLabel(AutomationElement root, string labelText)
    {
        if (root == null || string.IsNullOrEmpty(labelText)) return null;
        try
        {
            var all = root.FindAll(TreeScope.Descendants, Condition.TrueCondition);
            foreach (AutomationElement el in all)
            {
                try
                {
                    AutomationElement labeled = el.Current.LabeledBy;
                    if (labeled != null)
                    {
                        string lname = labeled.Current.Name ?? "";
                        if (lname.Equals(labelText, StringComparison.OrdinalIgnoreCase)
                            || lname.IndexOf(labelText, StringComparison.OrdinalIgnoreCase) >= 0)
                            return el;
                    }
                }
                catch { }
            }
        }
        catch { }
        return null;
    }

    /// <summary>
    /// Find an element by AutomationId, Name, or label association (in that priority order)
    /// and set its value using ValuePattern — fires native UIA value-change so the page
    /// JS (React/Vue/etc.) sees the change.  Returns true on success.
    /// </summary>
    public static bool FillElement(AutomationElement root, string selector, string value)
    {
        if (root == null || string.IsNullOrEmpty(selector)) return false;
        AutomationElement elem = null;

        // 1. By AutomationId (= HTML id attribute in Firefox/Chrome with a11y enabled)
        try
        {
            var c = new PropertyCondition(AutomationElement.AutomationIdProperty, selector);
            elem = root.FindFirst(TreeScope.Descendants, c);
        }
        catch { }

        // 2. By UIA Name property
        if (elem == null)
        {
            try
            {
                var c = new PropertyCondition(AutomationElement.NameProperty, selector);
                elem = root.FindFirst(TreeScope.Descendants, c);
            }
            catch { }
        }

        // 3. By associated label text (LabeledBy property — ARIA for= link)
        if (elem == null)
            elem = FindElementByLabel(root, selector);

        if (elem == null) return false;

        // Try ValuePattern.SetValue — direct, no caret movement side-effects
        try
        {
            var vp = elem.GetCurrentPattern(ValuePattern.Pattern) as ValuePattern;
            if (vp != null && !vp.Current.IsReadOnly)
            {
                elem.SetFocus();
                Thread.Sleep(50);
                vp.SetValue(value);
                return true;
            }
        }
        catch { }

        // Fallback: click to focus then type via keyboard
        try
        {
            System.Windows.Rect rect = elem.Current.BoundingRectangle;
            if (!double.IsInfinity(rect.X) && rect.Width > 0 && rect.Height > 0)
            {
                int cx = (int)(rect.X + rect.Width  / 2);
                int cy = (int)(rect.Y + rect.Height / 2);
                SendMouseClick(cx, cy);
                Thread.Sleep(150);
                // Select all existing text, then type replacement
                System.Windows.Forms.SendKeys.SendWait("^a");
                Thread.Sleep(50);
                // Escape SendKeys special characters before typing the value
                string escaped = value
                    .Replace("{", "{{}}")
                    .Replace("}", "{}}")
                    .Replace("+", "{+}")
                    .Replace("^", "{^}")
                    .Replace("%", "{%}")
                    .Replace("~", "{~}")
                    .Replace("(", "{(}")
                    .Replace(")", "{)}");
                System.Windows.Forms.SendKeys.SendWait(escaped);
                return true;
            }
        }
        catch { }

        return false;
    }

    /// <summary>
    /// Focus or click an element identified by AutomationId, Name, or associated label text.
    /// For buttons/links: uses InvokePattern.
    /// For inputs, selects, etc.: fires a real SendInput mouse click at the
    /// element's bounding-rectangle centre so the element actually gets focus.
    /// </summary>
    public static bool FocusOrClickElement(AutomationElement root, string selector)
    {
        if (root == null || string.IsNullOrEmpty(selector)) return false;
        AutomationElement elem = null;
        try
        {
            var cond = new PropertyCondition(AutomationElement.AutomationIdProperty, selector);
            elem = root.FindFirst(TreeScope.Descendants, cond);
        }
        catch { }
        if (elem == null)
        {
            try
            {
                var cond = new PropertyCondition(AutomationElement.NameProperty, selector);
                elem = root.FindFirst(TreeScope.Descendants, cond);
            }
            catch { }
        }
        // 3. By associated label text (ARIA for= / LabeledBy in UIA)
        if (elem == null)
            elem = FindElementByLabel(root, selector);
        if (elem == null) return false;
        // Try InvokePattern — works for buttons and links
        try
        {
            var ip = elem.GetCurrentPattern(InvokePattern.Pattern) as InvokePattern;
            if (ip != null) { ip.Invoke(); return true; }
        }
        catch { }
        // Fall back to real mouse click at the element's centre
        try
        {
            System.Windows.Rect rect = elem.Current.BoundingRectangle;
            if (!double.IsInfinity(rect.X) && rect.Width > 0 && rect.Height > 0)
            {
                int cx = (int)(rect.X + rect.Width  / 2);
                int cy = (int)(rect.Y + rect.Height / 2);
                SendMouseClick(cx, cy);
                Thread.Sleep(80);
                return true;
            }
        }
        catch { }
        return false;
    }

    // ── UIA: Click by ID / Name ───────────────────────────────────────────────

    /// <summary>
    /// Invoke a button-like UIA element by AutomationId or Name.
    /// Tries exact AutomationId match, then exact Name match, then case-insensitive
    /// substring search across all Button descendants.
    /// </summary>
    public static bool InvokeButtonByName(AutomationElement root, string buttonIdentifier)
    {
        try
        {
            var btnCond    = new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.Button);
            var allButtons = root.FindAll(TreeScope.Descendants, btnCond);
            Console.Error.WriteLine("DEBUG[WinUtils]: " + allButtons.Count + " buttons for '" + buttonIdentifier + "'");

            // 1. Exact AutomationId match
            var idCond  = new PropertyCondition(AutomationElement.AutomationIdProperty, buttonIdentifier);
            var combId  = new AndCondition(idCond, btnCond);
            var button  = root.FindFirst(TreeScope.Descendants, combId);

            // 2. Exact Name match
            if (button == null)
            {
                var nameCond = new PropertyCondition(AutomationElement.NameProperty, buttonIdentifier);
                var combName = new AndCondition(nameCond, btnCond);
                button = root.FindFirst(TreeScope.Descendants, combName);
            }

            // 3. Case-insensitive search over all buttons
            if (button == null)
            {
                foreach (AutomationElement btn in allButtons)
                {
                    string id   = btn.Current.AutomationId;
                    string name = btn.Current.Name;
                    if ((!string.IsNullOrEmpty(id)   && id.Equals(buttonIdentifier,   StringComparison.OrdinalIgnoreCase)) ||
                        (!string.IsNullOrEmpty(name) && name.Equals(buttonIdentifier, StringComparison.OrdinalIgnoreCase)))
                    {
                        button = btn;
                        break;
                    }
                }
            }

            if (button != null)
            {
                var invokePattern = button.GetCurrentPattern(InvokePattern.Pattern) as InvokePattern;
                if (invokePattern != null)
                {
                    invokePattern.Invoke();
                    Console.Error.WriteLine("DEBUG[WinUtils]: Invoked '" + buttonIdentifier + "'");
                    return true;
                }
            }
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine("DEBUG[WinUtils]: InvokeButtonByName error: " + ex.Message);
        }
        return false;
    }

    /// <summary>Click a Button element by its UIA Name using real mouse input.</summary>
    public static bool ClickElementByName(IntPtr hwnd, string name)
    {
        try
        {
            var root     = AutomationElement.FromHandle(hwnd);
            var condName = new PropertyCondition(AutomationElement.NameProperty,
                name, PropertyConditionFlags.IgnoreCase);
            var condBtn  = new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.Button);
            var cond     = new AndCondition(condName, condBtn);
            var el       = root.FindFirst(TreeScope.Descendants, cond);
            if (el == null)
            {
                Console.Error.WriteLine("DEBUG[WinUtils]: ClickByName not found: " + name);
                return false;
            }
            var rect = el.Current.BoundingRectangle;
            int cx   = (int)(rect.Left + rect.Width  / 2);
            int cy   = (int)(rect.Top  + rect.Height / 2);
            Console.Error.WriteLine("DEBUG[WinUtils]: ClickByName '" + name + "' at " + cx + "," + cy);
            SendMouseClick(cx, cy);
            return true;
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine("DEBUG[WinUtils]: ClickByName error: " + ex.Message);
            return false;
        }
    }

    // ── Mouse input ───────────────────────────────────────────────────────────

    /// <summary>Move the cursor and synthesise a left click using SendInput.</summary>
    public static void SendMouseClick(int x, int y)
    {
        SetCursorPos(x, y);
        INPUT[] inputs = new INPUT[2];
        inputs[0].type     = INPUT_MOUSE;
        inputs[0].mi.dwFlags = MOUSEEVENTF_LEFTDOWN;
        inputs[1].type     = INPUT_MOUSE;
        inputs[1].mi.dwFlags = MOUSEEVENTF_LEFTUP;
        SendInput((uint)inputs.Length, inputs, Marshal.SizeOf(typeof(INPUT)));
        Console.Error.WriteLine("DEBUG[WinUtils]: SendMouseClick at " + x + "," + y);
    }

    /// <summary>
    /// Post WM_LBUTTONDOWN/UP messages directly to <paramref name="hwnd"/>
    /// using window-relative client coordinates converted from screen coordinates.
    /// Use when SendInput is unreliable (e.g. the window is partially off-screen).
    /// </summary>
    public static void DirectMouseClick(IntPtr hwnd, int screenX, int screenY)
    {
        POINT pt = new POINT { X = screenX, Y = screenY };
        if (!ScreenToClient(hwnd, ref pt)) { pt.X = screenX; pt.Y = screenY; }
        Console.Error.WriteLine("DEBUG[WinUtils]: DirectMouseClick hwnd=" + hwnd
            + " screen(" + screenX + "," + screenY + ") -> client(" + pt.X + "," + pt.Y + ")");
        int lParam = (pt.Y << 16) | (pt.X & 0xFFFF);
        PostMessage(hwnd, WM_LBUTTONDOWN, (IntPtr)MK_LBUTTON, (IntPtr)lParam);
        Thread.Sleep(50);
        PostMessage(hwnd, WM_LBUTTONUP, IntPtr.Zero, (IntPtr)lParam);
    }

    // ── Key injection ─────────────────────────────────────────────────────────

    /// <summary>Map a key-name token (upper-case) to its Win32 virtual-key code.</summary>
    public static uint GetVirtualKeyCode(string keyName)
    {
        switch (keyName.ToUpper())
        {
            case "ENTER":                      return VK_RETURN;
            case "TAB":                        return VK_TAB;
            case "ESC":   case "ESCAPE":       return VK_ESCAPE;
            case "BACK":  case "BACKSPACE":    return VK_BACK;
            case "DELETE": case "DEL":         return VK_DELETE;
            case "LEFT":                       return VK_LEFT;
            case "UP":                         return VK_UP;
            case "RIGHT":                      return VK_RIGHT;
            case "DOWN":                       return VK_DOWN;
            case "HOME":                       return 0x24;
            case "END":                        return 0x23;
            case "PGUP":  case "PAGEUP":       return 0x21;
            case "PGDN":  case "PAGEDOWN":     return 0x22;
            case "SHIFT":                      return VK_SHIFT;
            case "CONTROL": case "CTRL":       return VK_CONTROL;
            case "ALT":   case "MENU":         return VK_MENU;
            default:                           return 0;
        }
    }

    /// <summary>
    /// Translate our token notation ({CTRL+A}, {ENTER}, {TAB} …) to
    /// System.Windows.Forms.SendKeys notation (^a, {ENTER}, {TAB} …).
    /// Plain text characters are passed through with SendKeys special chars
    /// (+, ^, %, ~, (, ), {, }) escaped as e.g. {+}.
    /// </summary>
    public static string TranslateToSendKeys(string keys)
    {
        var sb = new StringBuilder();
        for (int i = 0; i < keys.Length; i++)
        {
            if (keys[i] == '{')
            {
                int close = keys.IndexOf('}', i);
                if (close > i)
                {
                    string token = keys.Substring(i + 1, close - i - 1).ToUpper();
                    i = close;

                    // Modifier+key combos: {CTRL+A}, {CTRL+END}, {SHIFT+HOME}, {ALT+F4}
                    int plus = token.IndexOf('+');
                    if (plus > 0)
                    {
                        string mod  = token.Substring(0, plus);
                        string key2 = token.Substring(plus + 1);
                        char modChar =
                            (mod == "CTRL" || mod == "CONTROL") ? '^' :
                            mod == "SHIFT"                      ? '+' :
                            mod == "ALT"                        ? '%' : '\0';
                        if (modChar != '\0')
                        {
                            if (key2.Length == 1)
                                sb.Append(modChar).Append(char.ToLower(key2[0]));
                            else
                                sb.Append(modChar).Append('{').Append(key2).Append('}');
                            continue;
                        }
                    }

                    // Pass-through single-key tokens
                    switch (token)
                    {
                        case "ENTER":                       sb.Append("{ENTER}");     break;
                        case "TAB":                         sb.Append("{TAB}");       break;
                        case "ESC": case "ESCAPE":          sb.Append("{ESC}");       break;
                        case "BACK": case "BACKSPACE":      sb.Append("{BACKSPACE}"); break;
                        case "DELETE": case "DEL":          sb.Append("{DELETE}");    break;
                        case "HOME":                        sb.Append("{HOME}");      break;
                        case "END":                         sb.Append("{END}");       break;
                        case "LEFT":                        sb.Append("{LEFT}");      break;
                        case "RIGHT":                       sb.Append("{RIGHT}");     break;
                        case "UP":                          sb.Append("{UP}");        break;
                        case "DOWN":                        sb.Append("{DOWN}");      break;
                        default:                            sb.Append(token.ToLower()); break;
                    }
                    continue;
                }
            }

            // Literal character — escape SendKeys special chars
            char c = keys[i];
            switch (c)
            {
                case '+': sb.Append("{+}"); break;
                case '^': sb.Append("{^}"); break;
                case '%': sb.Append("{%}"); break;
                case '~': sb.Append("{~}"); break;
                case '(': sb.Append("{(}"); break;
                case ')': sb.Append("{)}"); break;
                case '{': sb.Append("{{}"); break;
                case '}': sb.Append("{}}"); break;
                default:  sb.Append(c);    break;
            }
        }
        return sb.ToString();
    }

    // ── DirectSendKeys ────────────────────────────────────────────────────────

    static IntPtr _getEditControl(IntPtr hwnd)
    {
        IntPtr editCtrl = FindWindowEx(hwnd, IntPtr.Zero, "Edit", null);
        if (editCtrl != IntPtr.Zero) return editCtrl;
        editCtrl = FindWindowEx(hwnd, IntPtr.Zero, "RichEdit", null);
        if (editCtrl != IntPtr.Zero) return editCtrl;

        try
        {
            var root = AutomationElement.FromHandle(hwnd);
            var docCond  = new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.Document);
            var docEl    = root.FindFirst(TreeScope.Descendants, docCond);
            if (docEl != null)
            {
                IntPtr docHwnd = new IntPtr(docEl.Current.NativeWindowHandle);
                if (docHwnd != IntPtr.Zero) return docHwnd;
            }
            var editCond = new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.Edit);
            var editEl   = root.FindFirst(TreeScope.Descendants, editCond);
            if (editEl != null)
            {
                IntPtr editHwnd = new IntPtr(editEl.Current.NativeWindowHandle);
                if (editHwnd != IntPtr.Zero) return editHwnd;
            }
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine("DEBUG[WinUtils]: _getEditControl UIA error: " + ex.Message);
        }
        return hwnd;
    }

    /// <summary>
    /// Inject keystroke <paramref name="keys"/> into <paramref name="hwnd"/>.
    ///
    /// Strategy:
    ///   1. Plain text without special tokens → try ValuePattern.SetValue (UIA, no focus needed).
    ///   2. Tokens present ({ENTER}, {CTRL+A} etc.) → bring to foreground + SendKeys.SendWait.
    ///   3. Fallback → PostMessage char-by-char to the edit control HWND.
    /// </summary>
    public static void DirectSendKeys(IntPtr hwnd, string keys)
    {
        Console.Error.WriteLine("DEBUG[WinUtils]: DirectSendKeys hwnd=" + hwnd + " keys='" + keys + "'");
        bool hasSpecialTokens = keys.Contains("{") && keys.Contains("}");

        if (!hasSpecialTokens)
        {
            // Path 1: ValuePattern — works without window focus
            try
            {
                var root = AutomationElement.FromHandle(hwnd);

                var docCond = new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.Document);
                var docEl   = root.FindFirst(TreeScope.Descendants, docCond);
                if (docEl != null)
                {
                    var vp = docEl.GetCurrentPattern(ValuePattern.Pattern) as ValuePattern;
                    if (vp != null && !vp.Current.IsReadOnly)
                    {
                        vp.SetValue((vp.Current.Value ?? "") + keys);
                        Console.Error.WriteLine("DEBUG[WinUtils]: ValuePattern set (Document)");
                        return;
                    }
                }

                var editCond = new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.Edit);
                var editEl   = root.FindFirst(TreeScope.Descendants, editCond);
                if (editEl != null)
                {
                    var vp = editEl.GetCurrentPattern(ValuePattern.Pattern) as ValuePattern;
                    if (vp != null && !vp.Current.IsReadOnly)
                    {
                        vp.SetValue((vp.Current.Value ?? "") + keys);
                        Console.Error.WriteLine("DEBUG[WinUtils]: ValuePattern set (Edit)");
                        return;
                    }
                }
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine("DEBUG[WinUtils]: ValuePattern path failed: " + ex.Message);
            }
        }
        else
        {
            // Path 2: SendKeys.SendWait — handles {ENTER}, {CTRL+*} etc.
            Console.Error.WriteLine("DEBUG[WinUtils]: Special tokens → SendKeys.SendWait");
            SetForegroundWindow(hwnd);
            Thread.Sleep(200);
            string sk = TranslateToSendKeys(keys);
            Console.Error.WriteLine("DEBUG[WinUtils]: SendKeys translated: " + sk);
            try { System.Windows.Forms.SendKeys.SendWait(sk); }
            catch (Exception ex) { Console.Error.WriteLine("DEBUG[WinUtils]: SendKeys error: " + ex.Message); }
            return;
        }

        // Path 3: PostMessage char-by-char (classic Win32 edit controls)
        Console.Error.WriteLine("DEBUG[WinUtils]: PostMessage char-by-char fallback");
        IntPtr targetHwnd = _getEditControl(hwnd);

        for (int i = 0; i < keys.Length; i++)
        {
            char c = keys[i];

            if (c == '{')
            {
                int closeBrace = keys.IndexOf('}', i);
                if (closeBrace > i)
                {
                    string special   = keys.Substring(i + 1, closeBrace - i - 1);
                    int    plusIndex = special.IndexOf('+');

                    if (plusIndex > 0)
                    {
                        string modifier  = special.Substring(0, plusIndex).ToUpper();
                        string remainder = special.Substring(plusIndex + 1);
                        uint modVk = 0;
                        if (modifier == "CTRL" || modifier == "CONTROL") modVk = VK_CONTROL;
                        else if (modifier == "SHIFT")                    modVk = VK_SHIFT;
                        else if (modifier == "ALT")                      modVk = VK_MENU;

                        if (modVk != 0)
                        {
                            uint keyVk = GetVirtualKeyCode(remainder);
                            if (keyVk == 0 && remainder.Length == 1)
                                keyVk = (uint)char.ToUpper(remainder[0]);
                            if (keyVk != 0)
                            {
                                SetForegroundWindow(hwnd);
                                Thread.Sleep(30);
                                PostMessage(targetHwnd, WM_KEYDOWN, (IntPtr)modVk, IntPtr.Zero);
                                PostMessage(targetHwnd, WM_KEYDOWN, (IntPtr)keyVk, IntPtr.Zero);
                                Thread.Sleep(30);
                                PostMessage(targetHwnd, WM_KEYUP, (IntPtr)keyVk, IntPtr.Zero);
                                PostMessage(targetHwnd, WM_KEYUP, (IntPtr)modVk, IntPtr.Zero);
                                Thread.Sleep(50);
                                i = closeBrace;
                                continue;
                            }
                        }
                    }

                    uint vk = GetVirtualKeyCode(special);
                    if (vk != 0)
                    {
                        PostMessage(targetHwnd, WM_KEYDOWN, (IntPtr)vk, IntPtr.Zero);
                        Thread.Sleep(10);
                        PostMessage(targetHwnd, WM_KEYUP, (IntPtr)vk, IntPtr.Zero);
                        i = closeBrace;
                        continue;
                    }
                }
            }

            if (c == '=')
            {
                PostMessage(targetHwnd, WM_KEYDOWN, (IntPtr)VK_RETURN, IntPtr.Zero);
                Thread.Sleep(10);
                PostMessage(targetHwnd, WM_KEYUP, (IntPtr)VK_RETURN, IntPtr.Zero);
                continue;
            }
            if (c == '\n' || c == '\r')
            {
                PostMessage(targetHwnd, WM_KEYDOWN, (IntPtr)VK_RETURN, IntPtr.Zero);
                Thread.Sleep(10);
                PostMessage(targetHwnd, WM_KEYUP, (IntPtr)VK_RETURN, IntPtr.Zero);
                continue;
            }

            short vkResult  = VkKeyScan(c);
            byte  virtualKey = (byte)(vkResult & 0xFF);
            byte  shiftState = (byte)((vkResult >> 8) & 0xFF);

            if (shiftState == 0)
            {
                PostMessage(targetHwnd, WM_CHAR, (IntPtr)c, IntPtr.Zero);
                Thread.Sleep(10);
            }
            else
            {
                if ((shiftState & 1) != 0) PostMessage(targetHwnd, WM_KEYDOWN, (IntPtr)VK_SHIFT,   IntPtr.Zero);
                if ((shiftState & 2) != 0) PostMessage(targetHwnd, WM_KEYDOWN, (IntPtr)VK_CONTROL, IntPtr.Zero);
                if ((shiftState & 4) != 0) PostMessage(targetHwnd, WM_KEYDOWN, (IntPtr)VK_MENU,    IntPtr.Zero);
                PostMessage(targetHwnd, WM_KEYDOWN, (IntPtr)virtualKey, IntPtr.Zero);
                PostMessage(targetHwnd, WM_CHAR,    (IntPtr)c,          IntPtr.Zero);
                Thread.Sleep(10);
                PostMessage(targetHwnd, WM_KEYUP, (IntPtr)virtualKey, IntPtr.Zero);
                if ((shiftState & 4) != 0) PostMessage(targetHwnd, WM_KEYUP, (IntPtr)VK_MENU,    IntPtr.Zero);
                if ((shiftState & 2) != 0) PostMessage(targetHwnd, WM_KEYUP, (IntPtr)VK_CONTROL, IntPtr.Zero);
                if ((shiftState & 1) != 0) PostMessage(targetHwnd, WM_KEYUP, (IntPtr)VK_SHIFT,   IntPtr.Zero);
            }
        }
        Console.Error.WriteLine("DEBUG[WinUtils]: DirectSendKeys completed");
    }
}
