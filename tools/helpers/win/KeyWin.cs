using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Windows.Forms;
using System.Windows.Automation;
using System.Security.Cryptography;
using System.Linq;


namespace KeyWin
{
    class Program
    {
        [DllImport("user32.dll")]
        static extern bool SetForegroundWindow(IntPtr hWnd);

        [DllImport("user32.dll")]
        static extern IntPtr GetForegroundWindow();

        [DllImport("user32.dll")]
        static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);

        [DllImport("kernel32.dll")]
        static extern uint GetCurrentThreadId();

        [DllImport("user32.dll")]
        static extern bool BringWindowToTop(IntPtr hWnd);

        [DllImport("user32.dll")]
        static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);

        delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

        [DllImport("user32.dll", CharSet = CharSet.Unicode)]
        static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);

        [DllImport("user32.dll")]
        static extern int GetWindowTextLength(IntPtr hWnd);

        [DllImport("user32.dll")]
        static extern bool IsWindowVisible(IntPtr hWnd);

        [DllImport("user32.dll")]
        static extern int GetWindowThreadProcessId(IntPtr hWnd, out int lpdwProcessId);

        [DllImport("user32.dll")]
        static extern uint SendInput(uint nInputs, [MarshalAs(UnmanagedType.LPArray), In] INPUT[] pInputs, int cbSize);

        [DllImport("user32.dll")]
        static extern bool SetCursorPos(int X, int Y);

        [DllImport("user32.dll", CharSet = CharSet.Auto)]
        static extern IntPtr SendMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);

        [DllImport("user32.dll", CharSet = CharSet.Auto)]
        static extern bool PostMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);

        [DllImport("user32.dll")]
        static extern bool ScreenToClient(IntPtr hWnd, ref POINT lpPoint);

        [DllImport("user32.dll")]
        static extern short VkKeyScan(char ch);

        [StructLayout(LayoutKind.Sequential)]
        struct POINT
        {
            public int X;
            public int Y;
        }

        [StructLayout(LayoutKind.Explicit)]
        struct INPUT
        {
            [FieldOffset(0)] public uint type;
            [FieldOffset(4)] public MOUSEINPUT mi;
            [FieldOffset(4)] public KEYBDINPUT ki;
        }

        [StructLayout(LayoutKind.Sequential)]
        struct KEYBDINPUT
        {
            public ushort wVk;
            public ushort wScan;
            public uint dwFlags;
            public uint time;
            public IntPtr dwExtraInfo;
        }

        [StructLayout(LayoutKind.Sequential)]
        struct MOUSEINPUT
        {
            public int dx;
            public int dy;
            public uint mouseData;
            public uint dwFlags;
            public uint time;
            public IntPtr dwExtraInfo;
        }

        const uint INPUT_MOUSE = 0;
        const uint INPUT_KEYBOARD = 1;
        const uint MOUSEEVENTF_LEFTDOWN = 0x0002;
        const uint MOUSEEVENTF_LEFTUP = 0x0004;
        const uint MOUSEEVENTF_RIGHTDOWN = 0x0008;
        const uint MOUSEEVENTF_RIGHTUP = 0x0010;
        const uint MOUSEEVENTF_MOVE = 0x0001;
        const uint KEYEVENTF_EXTENDEDKEY = 0x0001;
        const uint KEYEVENTF_KEYUP = 0x0002;

        // Windows Messages for direct injection
        const uint WM_KEYDOWN = 0x0100;
        const uint WM_KEYUP = 0x0101;
        const uint WM_CHAR = 0x0102;
        const uint WM_LBUTTONDOWN = 0x0201;
        const uint WM_LBUTTONUP = 0x0202;
        const uint WM_RBUTTONDOWN = 0x0204;
        const uint WM_RBUTTONUP = 0x0205;
        const uint MK_LBUTTON = 0x0001;

        // Virtual Key Codes
        const byte VK_SHIFT = 0x10;
        const byte VK_CONTROL = 0x11;
        const byte VK_MENU = 0x12;  // Alt key
        const byte VK_RETURN = 0x0D;
        const ushort VK_LWIN = 0x5B;
        const ushort VK_F1 = 0x70;  // F1-F12 = 0x70-0x7B
        const ushort VK_HOME = 0x24;
        const ushort VK_END = 0x23;
        const ushort VK_PRIOR = 0x21;  // Page Up
        const ushort VK_NEXT = 0x22;   // Page Down
        const ushort VK_INSERT = 0x2D;
        const ushort VK_APPS = 0x5D;   // Context menu key

        // Command detection for security filtering
        static string DetermineCommandType(string keys)
        {
            if (string.IsNullOrEmpty(keys)) return "SENDKEYS";
            
            if (keys.StartsWith("{QUERYTREE", StringComparison.OrdinalIgnoreCase))
                return "QUERYTREE";
            if (keys.StartsWith("{CLICKID:", StringComparison.OrdinalIgnoreCase))
                return "CLICKID";
            if (keys.StartsWith("{CLICKNAME:", StringComparison.OrdinalIgnoreCase))
                return "CLICKNAME";
            if (keys.StartsWith("{CLICK:", StringComparison.OrdinalIgnoreCase))
                return "CLICK";
            if (keys.Equals("{read}", StringComparison.OrdinalIgnoreCase))
                return "READ";
            if (keys.StartsWith("{SET:", StringComparison.OrdinalIgnoreCase))
                return "SET";
            if (keys.StartsWith("{FILL:", StringComparison.OrdinalIgnoreCase))
                return "FILL";
            if (keys.StartsWith("{READELEM:", StringComparison.OrdinalIgnoreCase))
                return "READELEM";
            if (keys.Equals("{LISTWINDOWS}", StringComparison.OrdinalIgnoreCase))
                return "LISTWINDOWS";
            if (keys.Equals("{KILL}", StringComparison.OrdinalIgnoreCase))
                return "KILL";
            if (keys.Equals("{RESET}", StringComparison.OrdinalIgnoreCase))
                return "RESET";
            if (keys.Equals("{NEWDOC}", StringComparison.OrdinalIgnoreCase))
                return "NEWDOC";
            if (keys.StartsWith("{KEYDOWN:", StringComparison.OrdinalIgnoreCase))
                return "KEYDOWN";
            if (keys.StartsWith("{KEYUP:", StringComparison.OrdinalIgnoreCase))
                return "KEYUP";
            if (keys.StartsWith("{KEYPRESS:", StringComparison.OrdinalIgnoreCase))
                return "KEYPRESS";
            if (keys.StartsWith("{RIGHTCLICK:", StringComparison.OrdinalIgnoreCase))
                return "RIGHTCLICK";
            if (keys.StartsWith("{DBLCLICK:", StringComparison.OrdinalIgnoreCase))
                return "DBLCLICK";
            if (keys.StartsWith("{HOVER:", StringComparison.OrdinalIgnoreCase))
                return "HOVER";
            
            // Default: treat as keystroke input
            return "SENDKEYS";
        }

        static string ExtractParameter(string keys, string commandType)
        {
            if (string.IsNullOrEmpty(keys)) return "";
            
            switch (commandType)
            {
                case "CLICKID":
                    // Extract "buttonId" from "{CLICKID:buttonId}"
                    var matchId = Regex.Match(keys, @"\{CLICKID:(.+?)\}", RegexOptions.IgnoreCase);
                    return matchId.Success ? matchId.Groups[1].Value : "";
                
                case "CLICKNAME":
                    // Extract "Button Name" from "{CLICKNAME:Button Name}"
                    var matchName = Regex.Match(keys, @"\{CLICKNAME:(.+?)\}", RegexOptions.IgnoreCase);
                    return matchName.Success ? matchName.Groups[1].Value : "";
                
                case "CLICK":
                    // Extract coordinates from "{CLICK:x,y}"
                    var matchClick = Regex.Match(keys, @"\{CLICK:(.+?)\}", RegexOptions.IgnoreCase);
                    return matchClick.Success ? matchClick.Groups[1].Value : "";
                
                case "SET":
                    // Extract property:value from "{SET:prop:value}"
                    var matchSet = Regex.Match(keys, @"\{SET:(.+?)\}", RegexOptions.IgnoreCase);
                    return matchSet.Success ? matchSet.Groups[1].Value : "";
                
                case "QUERYTREE":
                    // Extract depth from "{QUERYTREE:N}" or return default
                    var matchTree = Regex.Match(keys, @"\{QUERYTREE:(\d+)\}", RegexOptions.IgnoreCase);
                    return matchTree.Success ? matchTree.Groups[1].Value : "3";
                
                case "SENDKEYS":
                    // Strip {SENDKEYS:text} wrapper if present (MCP protocol wraps every action)
                    var matchSK = Regex.Match(keys, @"^\{SENDKEYS:(.+)\}$", RegexOptions.IgnoreCase | RegexOptions.Singleline);
                    return matchSK.Success ? matchSK.Groups[1].Value : keys;

                case "KEYDOWN":
                case "KEYUP":
                case "KEYPRESS":
                {
                    // Extract key name from {KEYDOWN:Ctrl}, {KEYUP:Shift}, {KEYPRESS:F5}
                    string prefix = "{" + commandType + ":";
                    if (keys.StartsWith(prefix, StringComparison.OrdinalIgnoreCase) && keys.EndsWith("}"))
                        return keys.Substring(prefix.Length, keys.Length - prefix.Length - 1);
                    return "";
                }

                case "RIGHTCLICK":
                {
                    var m = Regex.Match(keys, @"\{RIGHTCLICK:(.+?)\}", RegexOptions.IgnoreCase);
                    return m.Success ? m.Groups[1].Value : "";
                }

                case "DBLCLICK":
                {
                    var m = Regex.Match(keys, @"\{DBLCLICK:(.+?)\}", RegexOptions.IgnoreCase);
                    return m.Success ? m.Groups[1].Value : "";
                }

                case "HOVER":
                {
                    var m = Regex.Match(keys, @"\{HOVER:(.+?)\}", RegexOptions.IgnoreCase);
                    return m.Success ? m.Groups[1].Value : "";
                }

                case "FILL":
                {
                    // Extract "selector:value" from "{FILL:selector:value}"
                    var m = Regex.Match(keys, @"\{FILL:(.+?)\}", RegexOptions.IgnoreCase | RegexOptions.Singleline);
                    return m.Success ? m.Groups[1].Value : "";
                }

                case "READELEM":
                {
                    // Extract selector from "{READELEM:selector}"
                    var m = Regex.Match(keys, @"\{READELEM:([^}]+)\}", RegexOptions.IgnoreCase);
                    return m.Success ? m.Groups[1].Value : "";
                }
                
                default:
                    return "*";
            }
        }
        const byte VK_TAB = 0x09;
        const byte VK_ESCAPE = 0x1B;
        const byte VK_BACK = 0x08;
        const byte VK_DELETE = 0x2E;
        const byte VK_LEFT = 0x25;
        const byte VK_UP = 0x26;
        const byte VK_RIGHT = 0x27;
        const byte VK_DOWN = 0x28;

        [DllImport("user32.dll", SetLastError = true)]
        static extern IntPtr FindWindowEx(IntPtr parentHandle, IntPtr childAfter, string className, string windowTitle);

        static IntPtr foundHwndForProcess = IntPtr.Zero;
        static int targetProcessId = 0;

        static bool EnumWindowForProcess(IntPtr hWnd, IntPtr lParam)
        {
            int pid;
            GetWindowThreadProcessId(hWnd, out pid);
            if (pid == targetProcessId && IsWindowVisible(hWnd))
            {
                StringBuilder sb = new StringBuilder(256);
                GetWindowText(hWnd, sb, 256);
                string title = sb.ToString();
                if (!string.IsNullOrWhiteSpace(title))
                {
                    foundHwndForProcess = hWnd;
                    Console.Error.WriteLine("DEBUG: Fallback found window for pid " + pid + " title: " + title);
                    return false; // stop enumeration
                }
            }
            return true; // continue
        }

        static IntPtr FindWindowByProcessName(string processNameOrId)
        {
            try
            {
                // Support PID:12345 format
                if (processNameOrId.StartsWith("PID:", StringComparison.OrdinalIgnoreCase))
                {
                    int pid;
                    if (int.TryParse(processNameOrId.Substring(4), out pid))
                    {
                        return FindWindowByPid(pid);
                    }
                    return IntPtr.Zero;
                }

                // Support HANDLE:67890 format
                if (processNameOrId.StartsWith("HANDLE:", StringComparison.OrdinalIgnoreCase))
                {
                    long handle;
                    if (long.TryParse(processNameOrId.Substring(7), out handle))
                    {
                        IntPtr hwnd = new IntPtr(handle);
                        if (IsWindowVisible(hwnd))
                        {
                            return hwnd;
                        }
                    }
                    return IntPtr.Zero;
                }

                // Original process name lookup
                string processName = processNameOrId;

                // Remove .exe if present
                if (processName.EndsWith(".exe", StringComparison.OrdinalIgnoreCase))
                {
                    processName = processName.Substring(0, processName.Length - 4);
                }

                Process[] processes = Process.GetProcessesByName(processName);
                Console.Error.WriteLine("DEBUG: Found " + processes.Length + " process(es) named '" + processName + "'");
                
                foreach (var p in processes)
                {
                    IntPtr hwnd = p.MainWindowHandle;
                    Console.Error.WriteLine("DEBUG: Process ID " + p.Id + " has main window handle: " + hwnd);

                    if (hwnd != IntPtr.Zero)
                    {
                        return hwnd;
                    }

                    // Fallback: enumerate windows belonging to this process
                    targetProcessId = p.Id;
                    foundHwndForProcess = IntPtr.Zero;
                    EnumWindows(EnumWindowForProcess, IntPtr.Zero);
                    if (foundHwndForProcess != IntPtr.Zero)
                    {
                        return foundHwndForProcess;
                    }
                }

                // Final fallback: search all windows whose title contains the process name
                // This handles UWP apps, hosted processes, and any window not returned by GetProcessesByName
                IntPtr titleHwnd = FindWindowByPartialTitle(processName);
                if (titleHwnd != IntPtr.Zero)
                {
                    Console.Error.WriteLine("DEBUG: Fallback title match handle: " + titleHwnd);
                    return titleHwnd;
                }

                return IntPtr.Zero;
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine("DEBUG: Error finding process: " + ex.Message);
                return IntPtr.Zero;
            }
        }

        static IntPtr FindWindowByPid(int pid)
        {
            try
            {
                Process p = Process.GetProcessById(pid);
                IntPtr hwnd = p.MainWindowHandle;
                
                if (hwnd != IntPtr.Zero)
                {
                    return hwnd;
                }

                // Fallback: enumerate windows for this PID
                targetProcessId = pid;
                foundHwndForProcess = IntPtr.Zero;
                EnumWindows(EnumWindowForProcess, IntPtr.Zero);
                return foundHwndForProcess;
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine("DEBUG: Error finding PID: " + ex.Message);
                return IntPtr.Zero;
            }
        }

        /// <summary>
        /// Generic: find any visible window whose title contains the given search string.
        /// Used as a fallback when process-name lookup fails (e.g. UWP apps hosted by ApplicationFrameHost).
        /// </summary>
        static IntPtr FindWindowByPartialTitle(string titleSearch)
        {
            IntPtr match = IntPtr.Zero;

            EnumWindows((hWnd, lParam) =>
            {
                if (!IsWindowVisible(hWnd)) return true;
                StringBuilder sb = new StringBuilder(256);
                GetWindowText(hWnd, sb, 256);
                string title = sb.ToString();
                if (string.IsNullOrWhiteSpace(title)) return true;

                if (title.IndexOf(titleSearch, StringComparison.OrdinalIgnoreCase) >= 0)
                {
                    match = hWnd;
                    Console.Error.WriteLine("DEBUG: Title match: '" + title + "'");
                    return false; // stop enumeration
                }
                return true;
            }, IntPtr.Zero);

            return match;
        }

        static string BuildSendKeysSequence(string keys)
        {
            // Translate friendly chars into SendKeys tokens
            var sb = new StringBuilder();
            foreach (char c in keys)
            {
                switch (c)
                {
                    case '+':
                        sb.Append("{+}"); // literal plus, since + is shift modifier in SendKeys
                        break;
                    case '=':
                        sb.Append("{ENTER}"); // treat '=' as Enter for calculator sequences
                        break;
                    case '\n':
                    case '\r':
                        sb.Append("{ENTER}");
                        break;
                    default:
                        sb.Append(c);
                        break;
                }
            }
            return sb.ToString();
        }

        static uint GetVirtualKeyCode(string keyName)
        {
            switch (keyName.ToUpper())
            {
                case "ENTER": return VK_RETURN;
                case "TAB": return VK_TAB;
                case "ESC": case "ESCAPE": return VK_ESCAPE;
                case "BACK": case "BACKSPACE": return VK_BACK;
                case "DELETE": case "DEL": return VK_DELETE;
                case "LEFT": return VK_LEFT;
                case "UP": return VK_UP;
                case "RIGHT": return VK_RIGHT;
                case "DOWN": return VK_DOWN;
                case "HOME": return 0x24;   // VK_HOME
                case "END":  return 0x23;   // VK_END
                case "PGUP": case "PAGEUP": return 0x21;  // VK_PRIOR
                case "PGDN": case "PAGEDOWN": return 0x22; // VK_NEXT
                case "SHIFT": return VK_SHIFT;
                case "CONTROL": case "CTRL": return VK_CONTROL;
                case "ALT": case "MENU": return VK_MENU;
                default: return 0;
            }
        }

        /// <summary>
        /// Translate our token notation into System.Windows.Forms.SendKeys notation.
        ///   {CTRL+A}   → ^a        {CTRL+HOME} → ^{HOME}
        ///   {CTRL+END} → ^{END}    {ENTER}     → {ENTER}
        ///   {TAB}      → {TAB}     {CTRL+Z}    → ^z
        /// Plain text characters are left as-is except SendKeys special chars +^%~(){} which are escaped.
        /// </summary>
        static string TranslateToSendKeys(string keys)
        {
            // SendKeys special chars that must be escaped when used as literals: + ^ % ~ ( ) { }
            // We process token-by-token: anything in { } is a token, rest is literal text.
            var sb = new System.Text.StringBuilder();
            for (int i = 0; i < keys.Length; i++)
            {
                if (keys[i] == '{')
                {
                    int close = keys.IndexOf('}', i);
                    if (close > i)
                    {
                        string token = keys.Substring(i + 1, close - i - 1).ToUpper();
                        i = close;  // advance past the }

                        // Modifier+key combos
                        int plus = token.IndexOf('+');
                        if (plus > 0)
                        {
                            string mod = token.Substring(0, plus);
                            string key2 = token.Substring(plus + 1);
                            char modChar = mod == "CTRL" || mod == "CONTROL" ? '^' :
                                           mod == "SHIFT" ? '+' :
                                           mod == "ALT"   ? '%' : '\0';
                            if (modChar != '\0')
                            {
                                // Single-letter keys: ^a, ^c etc.  Multi-char keys: ^{END}, ^{HOME}
                                if (key2.Length == 1)
                                    sb.Append(modChar).Append(char.ToLower(key2[0]));
                                else
                                    sb.Append(modChar).Append('{').Append(key2).Append('}');
                                continue;
                            }
                        }

                        // Known single tokens — pass through as SendKeys tokens
                        switch (token)
                        {
                            case "ENTER":     sb.Append("{ENTER}"); break;
                            case "TAB":       sb.Append("{TAB}"); break;
                            case "ESC": case "ESCAPE": sb.Append("{ESC}"); break;
                            case "BACK": case "BACKSPACE": sb.Append("{BACKSPACE}"); break;
                            case "DELETE": case "DEL": sb.Append("{DELETE}"); break;
                            case "HOME":  sb.Append("{HOME}"); break;
                            case "END":   sb.Append("{END}"); break;
                            case "LEFT":  sb.Append("{LEFT}"); break;
                            case "RIGHT": sb.Append("{RIGHT}"); break;
                            case "UP":    sb.Append("{UP}"); break;
                            case "DOWN":  sb.Append("{DOWN}"); break;
                            default:
                                // Unknown token — emit as literal letter sequence
                                sb.Append(token.ToLower());
                                break;
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
                    default:  sb.Append(c); break;
                }
            }
            return sb.ToString();
        }

        static IntPtr GetEditControlForDirectInject(IntPtr hwnd)
        {
            // Try to find Edit control (for Notepad, etc.)
            IntPtr editCtrl = FindWindowEx(hwnd, IntPtr.Zero, "Edit", null);
            if (editCtrl != IntPtr.Zero)
            {
                Console.Error.WriteLine("DEBUG: Found Edit control: " + editCtrl);
                return editCtrl;
            }
            
            // Try to find RichEdit control
            editCtrl = FindWindowEx(hwnd, IntPtr.Zero, "RichEdit", null);
            if (editCtrl != IntPtr.Zero)
            {
                Console.Error.WriteLine("DEBUG: Found RichEdit control: " + editCtrl);
                return editCtrl;
            }
            
            // Try using UI Automation to find editable control
            try
            {
                var root = AutomationElement.FromHandle(hwnd);
                
                // Try Document control first (modern Notepad, Word, etc.)
                var docCondition = new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.Document);
                var docElement = root.FindFirst(TreeScope.Descendants, docCondition);
                if (docElement != null)
                {
                    IntPtr docHwnd = new IntPtr(docElement.Current.NativeWindowHandle);
                    if (docHwnd != IntPtr.Zero)
                    {
                        Console.Error.WriteLine("DEBUG: Found Document control via UI Automation: " + docHwnd);
                        return docHwnd;
                    }
                }
                
                // Try Edit control
                var editCondition = new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.Edit);
                var editElement = root.FindFirst(TreeScope.Descendants, editCondition);
                if (editElement != null)
                {
                    IntPtr editHwnd = new IntPtr(editElement.Current.NativeWindowHandle);
                    if (editHwnd != IntPtr.Zero)
                    {
                        Console.Error.WriteLine("DEBUG: Found Edit control via UI Automation: " + editHwnd);
                        return editHwnd;
                    }
                }
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine("DEBUG: UI Automation search failed: " + ex.Message);
            }
            
            // If no Edit control found, return the original window
            Console.Error.WriteLine("DEBUG: No Edit control found, using main window");
            return hwnd;
        }

        static bool InvokeButtonByName(AutomationElement root, string buttonIdentifier)
        {
            try
            {
                // Get all buttons for debugging
                var buttonCondition = new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.Button);
                var allButtons = root.FindAll(TreeScope.Descendants, buttonCondition);
                
                Console.Error.WriteLine("DEBUG: Found " + allButtons.Count + " buttons total");
                
                // Try AutomationId first (language-independent)
                var idCondition = new PropertyCondition(AutomationElement.AutomationIdProperty, buttonIdentifier);
                var combinedCondition = new AndCondition(idCondition, buttonCondition);
                
                var button = root.FindFirst(TreeScope.Descendants, combinedCondition);
                
                if (button != null)
                {
                    Console.Error.WriteLine("DEBUG: Found button by AutomationId: " + buttonIdentifier);
                }
                else
                {
                    // Fallback: Try by Name
                    var nameCondition = new PropertyCondition(AutomationElement.NameProperty, buttonIdentifier);
                    combinedCondition = new AndCondition(nameCondition, buttonCondition);
                    button = root.FindFirst(TreeScope.Descendants, combinedCondition);
                }
                
                // Try partial match if exact fails
                if (button == null)
                {
                    Console.Error.WriteLine("DEBUG: Searching for button containing: " + buttonIdentifier);
                    foreach (AutomationElement btn in allButtons)
                    {
                        string id = btn.Current.AutomationId;
                        string name = btn.Current.Name;
                        
                        if ((!string.IsNullOrEmpty(id) && id.Equals(buttonIdentifier, StringComparison.OrdinalIgnoreCase)) ||
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
                        Console.Error.WriteLine("DEBUG: Invoked button: " + buttonIdentifier);
                        return true;
                    }
                }
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine("DEBUG: Failed to invoke button '" + buttonIdentifier + "': " + ex.Message);
            }
            return false;
        }

        // ── Browser helpers ──────────────────────────────────────────────────────

        // Window class names for Chromium-family browsers
        static readonly string[] ChromiumRenderClasses = new[]
        {
            "Chrome_RenderWidgetHostHWND",
            "CefBrowserWindow",
        };

        delegate bool EnumChildProc(IntPtr hwnd, IntPtr lParam);

        [DllImport("user32.dll")]
        static extern bool EnumChildWindows(IntPtr parent, EnumChildProc callback, IntPtr lParam);

        [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
        static extern int GetClassName(IntPtr hWnd, StringBuilder lpClassName, int nMaxCount);

        /// <summary>
        /// Find the Chromium render-widget HWND inside a browser window.
        /// This is the surface that Chrome accessibility / WM_KEY messages target.
        /// Returns IntPtr.Zero if the window is not a Chromium browser.
        /// </summary>
        static IntPtr FindRenderWidgetHwnd(IntPtr topHwnd)
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
                        return false; // stop enumeration
                    }
                }
                return true;
            }, IntPtr.Zero);
            return found;
        }

        // ── End browser helpers ───────────────────────────────────────────────

        static void DirectSendKeys(IntPtr hwnd, string keys)
        {
            Console.Error.WriteLine("DEBUG: DirectSendKeys injecting to hwnd=" + hwnd + " keys='" + keys + "'");

            // Only use ValuePattern (UIA shortcut) for pure plain text without special tokens.
            // If the input contains any {…} token (e.g. {ENTER}, {CTRL+A}), we must go through
            // the PostMessage loop so those tokens are interpreted correctly.
            bool hasSpecialTokens = keys.Contains('{') && keys.Contains('}');

            if (!hasSpecialTokens)
            {
                // Try UI Automation approach - find controls and invoke them directly (no focus needed)
                try
                {
                    var root = AutomationElement.FromHandle(hwnd);

                    // Try Document control with ValuePattern (Notepad, Word, etc.)
                    var docCondition = new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.Document);
                    var docElement = root.FindFirst(TreeScope.Descendants, docCondition);

                    if (docElement != null)
                    {
                        Console.Error.WriteLine("DEBUG: Found Document control, using ValuePattern");
                        try
                        {
                            var valuePattern = docElement.GetCurrentPattern(ValuePattern.Pattern) as ValuePattern;
                            if (valuePattern != null && !valuePattern.Current.IsReadOnly)
                            {
                                string currentValue = valuePattern.Current.Value ?? "";
                                valuePattern.SetValue(currentValue + keys);
                                Console.Error.WriteLine("DEBUG: Text set via ValuePattern");
                                return;
                            }
                        }
                        catch (InvalidOperationException)
                        {
                            Console.Error.WriteLine("DEBUG: ValuePattern not available");
                        }
                    }

                    // Try Edit control with ValuePattern
                    var editCondition = new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.Edit);
                    var editElement = root.FindFirst(TreeScope.Descendants, editCondition);

                    if (editElement != null)
                    {
                        Console.Error.WriteLine("DEBUG: Found Edit control, using ValuePattern");
                        try
                        {
                            var valuePattern = editElement.GetCurrentPattern(ValuePattern.Pattern) as ValuePattern;
                            if (valuePattern != null && !valuePattern.Current.IsReadOnly)
                            {
                                string currentValue = valuePattern.Current.Value ?? "";
                                valuePattern.SetValue(currentValue + keys);
                                Console.Error.WriteLine("DEBUG: Text set to Edit control via ValuePattern");
                                return;
                            }
                        }
                        catch (InvalidOperationException)
                        {
                            Console.Error.WriteLine("DEBUG: ValuePattern not available on Edit control");
                        }
                    }

                    Console.Error.WriteLine("DEBUG: No ValuePattern controls found, falling through to PostMessage");
                }
                catch (Exception ex)
                {
                    Console.Error.WriteLine("DEBUG: UI Automation approach failed: " + ex.Message);
                }
            }
            else
            {
                // Special tokens present: bring window to foreground and use SendKeys
                // (which handles {ENTER}, Ctrl combos, etc. natively via Windows message pump)
                Console.Error.WriteLine("DEBUG: Special tokens present — using SendKeys.SendWait with foreground focus");
                // AttachThreadInput trick: attach our thread to the foreground thread so
                // SetForegroundWindow is never silently ignored by Windows focus-stealing prevention.
                IntPtr fgWnd = GetForegroundWindow();
                int _fgPid;
                uint fgThread = (uint)GetWindowThreadProcessId(fgWnd, out _fgPid);
                uint myThread = GetCurrentThreadId();
                bool attached = fgThread != 0 && fgThread != myThread &&
                                AttachThreadInput(fgThread, myThread, true);
                Console.Error.WriteLine("DEBUG: AttachThreadInput attached=" + attached + " fgThread=" + fgThread + " myThread=" + myThread);
                SetForegroundWindow(hwnd);
                BringWindowToTop(hwnd);
                System.Threading.Thread.Sleep(150);
                if (attached) AttachThreadInput(fgThread, myThread, false);
                // Translate our {CTRL+X} notation to SendKeys notation
                // Our syntax:     {CTRL+A}  {CTRL+C} {CTRL+V} {CTRL+Z} {CTRL+S} {CTRL+END} {ENTER} {TAB}
                // SendKeys syntax: ^a        ^c       ^v       ^z       ^s       ^{END}      {ENTER} {TAB}
                string sendKeysStr = TranslateToSendKeys(keys);
                Console.Error.WriteLine("DEBUG: Translated to SendKeys: " + sendKeysStr);
                try
                {
                    System.Windows.Forms.SendKeys.SendWait(sendKeysStr);
                }
                catch (Exception ex)
                {
                    Console.Error.WriteLine("DEBUG: SendKeys failed: " + ex.Message);
                }
                return;
            }
            
            // Final fallback: PostMessage to Edit control (classic Win32 apps)
            Console.Error.WriteLine("DEBUG: Falling back to PostMessage approach");
            IntPtr targetHwnd = GetEditControlForDirectInject(hwnd);
            
            for (int i = 0; i < keys.Length; i++)
            {
                char c = keys[i];
                
                // Handle special sequences like {ENTER}, {CTRL+A}, {CTRL+C}, etc.
                if (c == '{')
                {
                    int closeBrace = keys.IndexOf('}', i);
                    if (closeBrace > i)
                    {
                        string special = keys.Substring(i + 1, closeBrace - i - 1);

                        // Check for compound Ctrl/Alt/Shift combos like CTRL+A, CTRL+END, etc.
                        int plusIndex = special.IndexOf('+');
                        if (plusIndex > 0)
                        {
                            string modifier  = special.Substring(0, plusIndex).ToUpper();
                            string remainder = special.Substring(plusIndex + 1);
                            uint modVk = 0;
                            if (modifier == "CTRL"  || modifier == "CONTROL") modVk = VK_CONTROL;
                            else if (modifier == "SHIFT") modVk = VK_SHIFT;
                            else if (modifier == "ALT")   modVk = VK_MENU;
                            if (modVk != 0)
                            {
                                uint keyVk = GetVirtualKeyCode(remainder);
                                if (keyVk == 0 && remainder.Length == 1)
                                    keyVk = (uint)char.ToUpper(remainder[0]);
                                if (keyVk != 0)
                                {
                                    SetForegroundWindow(hwnd);  // focus required for Ctrl combos
                                    System.Threading.Thread.Sleep(30);
                                    PostMessage(targetHwnd, WM_KEYDOWN, (IntPtr)modVk, IntPtr.Zero);
                                    PostMessage(targetHwnd, WM_KEYDOWN, (IntPtr)keyVk, IntPtr.Zero);
                                    System.Threading.Thread.Sleep(30);
                                    PostMessage(targetHwnd, WM_KEYUP,   (IntPtr)keyVk, IntPtr.Zero);
                                    PostMessage(targetHwnd, WM_KEYUP,   (IntPtr)modVk, IntPtr.Zero);
                                    System.Threading.Thread.Sleep(50);
                                    i = closeBrace;
                                    continue;
                                }
                            }
                        }

                        // Simple single-key token
                        uint vk = GetVirtualKeyCode(special);
                        if (vk != 0)
                        {
                            PostMessage(targetHwnd, WM_KEYDOWN, (IntPtr)vk, IntPtr.Zero);
                            System.Threading.Thread.Sleep(10);
                            PostMessage(targetHwnd, WM_KEYUP, (IntPtr)vk, IntPtr.Zero);
                            i = closeBrace;
                            continue;
                        }
                    }
                }
                
                // Handle '=' as Enter for calculator
                if (c == '=')
                {
                    PostMessage(targetHwnd, WM_KEYDOWN, (IntPtr)VK_RETURN, IntPtr.Zero);
                    System.Threading.Thread.Sleep(10);
                    PostMessage(targetHwnd, WM_KEYUP, (IntPtr)VK_RETURN, IntPtr.Zero);
                    continue;
                }
                
                // Handle newlines
                if (c == '\n' || c == '\r')
                {
                    PostMessage(targetHwnd, WM_KEYDOWN, (IntPtr)VK_RETURN, IntPtr.Zero);
                    System.Threading.Thread.Sleep(10);
                    PostMessage(targetHwnd, WM_KEYUP, (IntPtr)VK_RETURN, IntPtr.Zero);
                    continue;
                }
                
                // Regular characters
                short vkResult = VkKeyScan(c);
                byte virtualKey = (byte)(vkResult & 0xFF);
                byte shiftState = (byte)((vkResult >> 8) & 0xFF);
                
                // For most apps, WM_CHAR alone is sufficient and avoids duplication
                // Only send KeyDown/KeyUp if modifiers are needed
                if (shiftState == 0)
                {
                    // Simple character - just send WM_CHAR
                    PostMessage(targetHwnd, WM_CHAR, (IntPtr)c, IntPtr.Zero);
                    System.Threading.Thread.Sleep(10);
                }
                else
                {
                    // Character with modifiers - need full sequence
                    // Handle shift modifier
                    if ((shiftState & 1) != 0)
                    {
                        PostMessage(targetHwnd, WM_KEYDOWN, (IntPtr)VK_SHIFT, IntPtr.Zero);
                    }
                    
                    // Handle Ctrl modifier
                    if ((shiftState & 2) != 0)
                    {
                        PostMessage(targetHwnd, WM_KEYDOWN, (IntPtr)VK_CONTROL, IntPtr.Zero);
                    }
                    
                    // Handle Alt modifier
                    if ((shiftState & 4) != 0)
                    {
                        PostMessage(targetHwnd, WM_KEYDOWN, (IntPtr)VK_MENU, IntPtr.Zero);
                    }
                    
                    // Send the key
                    PostMessage(targetHwnd, WM_KEYDOWN, (IntPtr)virtualKey, IntPtr.Zero);
                    PostMessage(targetHwnd, WM_CHAR, (IntPtr)c, IntPtr.Zero);
                    System.Threading.Thread.Sleep(10);
                    PostMessage(targetHwnd, WM_KEYUP, (IntPtr)virtualKey, IntPtr.Zero);
                    
                    // Release modifiers in reverse order
                    if ((shiftState & 4) != 0)
                    {
                        PostMessage(targetHwnd, WM_KEYUP, (IntPtr)VK_MENU, IntPtr.Zero);
                    }
                    if ((shiftState & 2) != 0)
                    {
                        PostMessage(targetHwnd, WM_KEYUP, (IntPtr)VK_CONTROL, IntPtr.Zero);
                    }
                    if ((shiftState & 1) != 0)
                    {
                        PostMessage(targetHwnd, WM_KEYUP, (IntPtr)VK_SHIFT, IntPtr.Zero);
                    }
                }
            }
            
            Console.Error.WriteLine("DEBUG: DirectSendKeys completed");
        }

        static bool TryParseClick(string keys, out int? x, out int? y)
        {
            x = null; y = null;
            // Must be {CLICK:x,y} format exactly - do NOT match {CLICKID:...} or {CLICKNAME:...}
            if (!Regex.IsMatch(keys, @"^\{CLICK:\d", RegexOptions.IgnoreCase)) return false;
            int colon = keys.IndexOf(':');
            int end = keys.IndexOf('}');
            if (colon > 0 && end > colon)
            {
                var coords = keys.Substring(colon + 1, end - colon - 1).Split(',');
                int px, py;
                if (coords.Length == 2 && int.TryParse(coords[0], out px) && int.TryParse(coords[1], out py))
                {
                    x = px; y = py;
                }
            }
            return true;
        }

        static bool TryParseClickByName(string token, out string name)
        {
            name = null;
            if (!token.StartsWith("{CLICKNAME:", StringComparison.OrdinalIgnoreCase)) return false;
            int colon = token.IndexOf(':');
            int end = token.IndexOf('}');
            if (colon > 0 && end > colon)
            {
                name = token.Substring(colon + 1, end - colon - 1);
            }
            return true;
        }

        static bool ClickElementByName(IntPtr hwnd, string name)
        {
            try
            {
                var root = AutomationElement.FromHandle(hwnd);
                var condName = new PropertyCondition(AutomationElement.NameProperty, name, PropertyConditionFlags.IgnoreCase);
                var condBtn = new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.Button);
                var cond = new AndCondition(condName, condBtn);
                var el = root.FindFirst(TreeScope.Descendants, cond);
                if (el == null)
                {
                    Console.Error.WriteLine("DEBUG: ClickByName not found: " + name);
                    return false;
                }
                var rect = el.Current.BoundingRectangle;
                int cx = (int)(rect.Left + rect.Width / 2);
                int cy = (int)(rect.Top + rect.Height / 2);
                Console.Error.WriteLine("DEBUG: ClickByName '" + name + "' at " + cx + "," + cy);
                SendMouseClick(cx, cy);
                return true;
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine("DEBUG: ClickByName error: " + ex.Message);
                return false;
            }
        }

        static void DirectMouseClick(IntPtr hwnd, int? screenX, int? screenY)
        {
            if (!screenX.HasValue || !screenY.HasValue)
            {
                Console.Error.WriteLine("DEBUG: DirectMouseClick - no coordinates provided");
                return;
            }

            // Convert screen coordinates to window-relative (client) coordinates
            POINT pt = new POINT { X = screenX.Value, Y = screenY.Value };
            if (!ScreenToClient(hwnd, ref pt))
            {
                Console.Error.WriteLine("DEBUG: DirectMouseClick - ScreenToClient failed, using screen coords");
                pt.X = screenX.Value;
                pt.Y = screenY.Value;
            }

            Console.Error.WriteLine("DEBUG: DirectMouseClick hwnd=" + hwnd + " screen(" + screenX + "," + screenY + ") -> client(" + pt.X + "," + pt.Y + ")");

            // Create lParam: LOWORD=x, HIWORD=y
            int lParam = (pt.Y << 16) | (pt.X & 0xFFFF);

            // Send mouse down and up messages directly to the window
            PostMessage(hwnd, WM_LBUTTONDOWN, (IntPtr)MK_LBUTTON, (IntPtr)lParam);
            System.Threading.Thread.Sleep(50);
            PostMessage(hwnd, WM_LBUTTONUP, IntPtr.Zero, (IntPtr)lParam);

            Console.Error.WriteLine("DEBUG: DirectMouseClick completed");
        }

        static void SendMouseClick(int? x, int? y)
        {
            if (x.HasValue && y.HasValue)
            {
                SetCursorPos(x.Value, y.Value);
            }

            INPUT[] inputs = new INPUT[2];
            inputs[0].type = INPUT_MOUSE;
            inputs[0].mi.dwFlags = MOUSEEVENTF_LEFTDOWN;
            inputs[1].type = INPUT_MOUSE;
            inputs[1].mi.dwFlags = MOUSEEVENTF_LEFTUP;

            uint sent = SendInput((uint)inputs.Length, inputs, Marshal.SizeOf(typeof(INPUT)));
            Console.Error.WriteLine("DEBUG: Mouse click sent inputs=" + sent);
        }

        static void SendMouseRightClick(int? x, int? y)
        {
            if (x.HasValue && y.HasValue)
            {
                SetCursorPos(x.Value, y.Value);
                System.Threading.Thread.Sleep(30);
            }

            INPUT[] inputs = new INPUT[2];
            inputs[0].type = INPUT_MOUSE;
            inputs[0].mi.dwFlags = MOUSEEVENTF_RIGHTDOWN;
            inputs[1].type = INPUT_MOUSE;
            inputs[1].mi.dwFlags = MOUSEEVENTF_RIGHTUP;

            uint sent = SendInput((uint)inputs.Length, inputs, Marshal.SizeOf(typeof(INPUT)));
            Console.Error.WriteLine("DEBUG: Right-click sent inputs=" + sent);
        }

        static void SendMouseDblClick(int? x, int? y)
        {
            if (x.HasValue && y.HasValue)
            {
                SetCursorPos(x.Value, y.Value);
                System.Threading.Thread.Sleep(30);
            }

            INPUT[] inputs = new INPUT[4];
            for (int i = 0; i < 4; i++) inputs[i].type = INPUT_MOUSE;
            inputs[0].mi.dwFlags = MOUSEEVENTF_LEFTDOWN;
            inputs[1].mi.dwFlags = MOUSEEVENTF_LEFTUP;
            inputs[2].mi.dwFlags = MOUSEEVENTF_LEFTDOWN;
            inputs[3].mi.dwFlags = MOUSEEVENTF_LEFTUP;

            // Send first click
            SendInput(2, new INPUT[] { inputs[0], inputs[1] }, Marshal.SizeOf(typeof(INPUT)));
            System.Threading.Thread.Sleep(50);
            // Send second click (within double-click interval)
            uint sent = SendInput(2, new INPUT[] { inputs[2], inputs[3] }, Marshal.SizeOf(typeof(INPUT)));
            Console.Error.WriteLine("DEBUG: Double-click sent inputs=" + sent);
        }

        static void SendMouseHover(int x, int y)
        {
            SetCursorPos(x, y);
            // Brief pause so hover effects (tooltips) can trigger
            System.Threading.Thread.Sleep(50);
            Console.Error.WriteLine("DEBUG: Hover moved cursor to (" + x + "," + y + ")");
        }

        /// <summary>
        /// Send a raw key event via SendInput.
        /// keyName: "Ctrl", "Alt", "Shift", "Win", "F1"-"F12", "HOME", "END", "PAGEUP", "PAGEDOWN",
        ///          "INSERT", "DELETE", "ESC", "TAB", "RETURN", "ENTER", "APPS", or a single char.
        /// keyUp: true = KEYEVENTF_KEYUP, false = KEYEVENTF_KEYDOWN
        /// </summary>
        static bool SendRawKey(string keyName, bool keyUp)
        {
            ushort vk = ResolveVirtualKey(keyName);
            if (vk == 0)
            {
                Console.Error.WriteLine("DEBUG: SendRawKey unknown key: " + keyName);
                return false;
            }

            // Extended keys (arrows, F keys, Home/End, etc.) need KEYEVENTF_EXTENDEDKEY
            bool isExtended = (vk >= 0x21 && vk <= 0x28) || (vk >= 0x70 && vk <= 0x7B) ||
                              vk == 0x2D || vk == 0x2E || vk == 0x5B || vk == 0x5C || vk == 0x5D;

            uint flags = keyUp ? KEYEVENTF_KEYUP : 0u;
            if (isExtended) flags |= KEYEVENTF_EXTENDEDKEY;

            INPUT[] inp = new INPUT[1];
            inp[0].type = INPUT_KEYBOARD;
            inp[0].ki.wVk = vk;
            inp[0].ki.wScan = 0;
            inp[0].ki.dwFlags = flags;
            inp[0].ki.time = 0;
            inp[0].ki.dwExtraInfo = IntPtr.Zero;

            uint sent = SendInput(1, inp, Marshal.SizeOf(typeof(INPUT)));
            Console.Error.WriteLine("DEBUG: SendRawKey vk=0x" + vk.ToString("X2") + " up=" + keyUp + " flags=0x" + flags.ToString("X") + " sent=" + sent);
            return sent == 1;
        }

        static ushort ResolveVirtualKey(string keyName)
        {
            if (string.IsNullOrEmpty(keyName)) return 0;
            switch (keyName.Trim().ToUpperInvariant())
            {
                case "CTRL": case "CONTROL":    return (ushort)VK_CONTROL;
                case "ALT":                     return (ushort)VK_MENU;
                case "SHIFT":                   return (ushort)VK_SHIFT;
                case "WIN": case "WINDOWS":     return VK_LWIN;
                case "ENTER": case "RETURN":    return (ushort)VK_RETURN;
                case "TAB":                     return (ushort)VK_TAB;
                case "ESC": case "ESCAPE":      return (ushort)VK_ESCAPE;
                case "BACK": case "BACKSPACE":  return (ushort)VK_BACK;
                case "DEL": case "DELETE":      return (ushort)VK_DELETE;
                case "HOME":                    return VK_HOME;
                case "END":                     return VK_END;
                case "PAGEUP": case "PGUP": case "PRIOR": return VK_PRIOR;
                case "PAGEDOWN": case "PGDN": case "NEXT": return VK_NEXT;
                case "INSERT": case "INS":      return VK_INSERT;
                case "LEFT":                    return (ushort)VK_LEFT;
                case "RIGHT":                   return (ushort)VK_RIGHT;
                case "UP":                      return (ushort)VK_UP;
                case "DOWN":                    return (ushort)VK_DOWN;
                case "APPS": case "MENU":       return VK_APPS;
                case "F1":  return VK_F1;
                case "F2":  return (ushort)(VK_F1 + 1);
                case "F3":  return (ushort)(VK_F1 + 2);
                case "F4":  return (ushort)(VK_F1 + 3);
                case "F5":  return (ushort)(VK_F1 + 4);
                case "F6":  return (ushort)(VK_F1 + 5);
                case "F7":  return (ushort)(VK_F1 + 6);
                case "F8":  return (ushort)(VK_F1 + 7);
                case "F9":  return (ushort)(VK_F1 + 8);
                case "F10": return (ushort)(VK_F1 + 9);
                case "F11": return (ushort)(VK_F1 + 10);
                case "F12": return (ushort)(VK_F1 + 11);
                default:
                    // Single character — use VkKeyScan
                    if (keyName.Length == 1)
                    {
                        short result = VkKeyScan(keyName[0]);
                        if (result != -1) return (ushort)(result & 0xFF);
                    }
                    return 0;
            }
        }

        static string ReadDisplayText(IntPtr hwnd)
        {
            try
            {
                var root = AutomationElement.FromHandle(hwnd);
                AutomationElement display = null;

                // Prefer CalculatorResults AutomationId (for Calculator)
                var condId = new PropertyCondition(AutomationElement.AutomationIdProperty, "CalculatorResults");
                display = root.FindFirst(TreeScope.Descendants, condId);

                // For text editors: prefer Document control (modern Notepad, Word etc.)
                if (display == null)
                {
                    var condDoc = new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.Document);
                    var docEl = root.FindFirst(TreeScope.Descendants, condDoc);
                    if (docEl != null)
                    {
                        display = docEl;
                    }
                }

                // Fallback: Edit control (classic Notepad, WinForms TextBox)
                if (display == null)
                {
                    var condEdit = new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.Edit);
                    var editEl = root.FindFirst(TreeScope.Descendants, condEdit);
                    if (editEl != null)
                    {
                        display = editEl;
                    }
                }

                // Last resort: any Text element (Calculator fallback)
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
                            string rawValue = vp.Current.Value;
                            if (rawValue != null) // can be empty string for new document
                            {
                                // For Calculator: strip localized prefix "Display is 8" -> "8"
                                // Only apply numeric extraction if the control is CalculatorResults
                                string autoId = display.Current.AutomationId ?? "";
                                if (autoId == "CalculatorResults")
                                {
                                    var match = Regex.Match(rawValue, @"[\d\+\-\*/\.,\(\)eE]+$");
                                    if (match.Success)
                                    {
                                        return match.Value.Trim();
                                    }
                                }
                                return rawValue;
                            }
                        }
                    }
                    catch { /* fall back to Name */ }

                    // Try Name property
                    string name = display.Current.Name;
                    if (!string.IsNullOrWhiteSpace(name))
                    {
                        // Only apply numeric stripping for CalculatorResults
                        string autoId2 = display.Current.AutomationId ?? "";
                        if (autoId2 == "CalculatorResults")
                        {
                            var match = Regex.Match(name, @"[\d\+\-\*/\.,\(\)eE]+$");
                            if (match.Success)
                            {
                                return match.Value.Trim();
                            }
                        }
                        return name;
                    }
                }
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine("DEBUG: Read display error: " + ex.Message);
            }
            return null;
        }

        static string QueryUITree(IntPtr hwnd, int maxDepth)
        {
            try
            {
                var root = AutomationElement.FromHandle(hwnd);
                var tree = BuildTreeJson(root, 0, maxDepth);
                return tree;
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine("DEBUG: QueryUITree error: " + ex.Message);
                return "{\"error\":\"" + ex.Message.Replace("\"", "\\\"") + "\"}";
            }
        }

        static string BuildTreeJson(AutomationElement element, int currentDepth, int maxDepth)
        {
            if (element == null || currentDepth > maxDepth)
                return "null";

            var sb = new StringBuilder();
            sb.Append("{");
            
            // Basic properties
            sb.Append("\"id\":\"" + EscapeJson(element.Current.AutomationId) + "\",");
            sb.Append("\"type\":\"" + EscapeJson(element.Current.ControlType.ProgrammaticName) + "\",");
            sb.Append("\"name\":\"" + EscapeJson(element.Current.Name) + "\",");
            
            // Position
            try
            {
                System.Windows.Rect rect = element.Current.BoundingRectangle;
                if (!double.IsInfinity(rect.X) && !double.IsInfinity(rect.Y))
                {
                    sb.Append("\"position\":{");
                    sb.Append("\"x\":" + (int)rect.X + ",");
                    sb.Append("\"y\":" + (int)rect.Y + ",");
                    sb.Append("\"width\":" + (int)rect.Width + ",");
                    sb.Append("\"height\":" + (int)rect.Height);
                    sb.Append("},");
                }
            }
            catch { }
            
            // Properties
            sb.Append("\"properties\":{");
            sb.Append("\"isEnabled\":" + (element.Current.IsEnabled ? "true" : "false") + ",");
            sb.Append("\"isOffscreen\":" + (element.Current.IsOffscreen ? "true" : "false"));
            sb.Append("},");
            
            // Actions
            sb.Append("\"actions\":[");
            var patterns = element.GetSupportedPatterns();
            var actions = new System.Collections.Generic.List<string>();
            if (Array.IndexOf(patterns, InvokePattern.Pattern) >= 0) actions.Add("\"click\"");
            if (Array.IndexOf(patterns, ValuePattern.Pattern) >= 0) { actions.Add("\"setValue\""); actions.Add("\"readValue\""); }
            if (Array.IndexOf(patterns, TextPattern.Pattern) >= 0) actions.Add("\"setText\"");
            sb.Append(string.Join(",", actions));
            sb.Append("]");
            
            // Children
            if (currentDepth < maxDepth)
            {
                try
                {
                    var walker = new TreeWalker(Condition.TrueCondition);
                    var child = walker.GetFirstChild(element);
                    var childrenList = new System.Collections.Generic.List<string>();
                    
                    while (child != null)
                    {
                        childrenList.Add(BuildTreeJson(child, currentDepth + 1, maxDepth));
                        child = walker.GetNextSibling(child);
                    }
                    
                    if (childrenList.Count > 0)
                    {
                        sb.Append(",\"children\":[");
                        sb.Append(string.Join(",", childrenList));
                        sb.Append("]");
                    }
                }
                catch { }
            }
            
            sb.Append("}");
            return sb.ToString();
        }

        static string EscapeJson(string text)
        {
            if (string.IsNullOrEmpty(text)) return "";
            return text.Replace("\\", "\\\\").Replace("\"", "\\\"").Replace("\n", "\\n").Replace("\r", "\\r").Replace("\t", "\\t");
        }

        /// <summary>
        /// Verify session token from MCP server using HMAC-SHA256
        /// </summary>
        /// <returns>True if token is valid or bypassed, false otherwise</returns>
        static bool VerifySessionToken()
        {
            // Check for development bypass
            string skipAuth = Environment.GetEnvironmentVariable("SKIP_SESSION_AUTH");
            if (skipAuth != null && skipAuth.Equals("true", StringComparison.OrdinalIgnoreCase))
            {
                Console.Error.WriteLine("DEBUG: Session authentication bypassed (SKIP_SESSION_AUTH=true)");
                return true;
            }

            // Get token and secret from environment
            string token = Environment.GetEnvironmentVariable("MCP_SESSION_TOKEN");
            string secretHex = Environment.GetEnvironmentVariable("MCP_SESSION_SECRET");

            if (string.IsNullOrEmpty(token) || string.IsNullOrEmpty(secretHex))
            {
                Console.Error.WriteLine("ERROR: MCP session token or secret not provided");
                return false;
            }

            try
            {
                // Parse token: timestamp:nonce:hmac
                string[] parts = token.Split(':');
                if (parts.Length != 3)
                {
                    Console.Error.WriteLine("ERROR: Invalid session token format");
                    return false;
                }

                string timestampStr = parts[0];
                string nonce = parts[1];
                string providedHmac = parts[2];

                // Parse timestamp
                long timestamp;
                if (!long.TryParse(timestampStr, out timestamp))
                {
                    Console.Error.WriteLine("ERROR: Invalid session token timestamp");
                    return false;
                }

                // Check token expiry (5 seconds in production, 60 in development)
                string nodeEnv = Environment.GetEnvironmentVariable("NODE_ENV");
                bool isDevelopment = nodeEnv != "production";
                int expirySeconds = isDevelopment ? 60 : 5;

                long now = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
                long age = now - timestamp;

                if (age > expirySeconds)
                {
                    Console.Error.WriteLine(string.Format("ERROR: Session token expired (age: {0}s, max: {1}s)", age, expirySeconds));
                    return false;
                }

                if (age < -5)  // Future timestamp with clock skew tolerance
                {
                    Console.Error.WriteLine("ERROR: Session token timestamp in future");
                    return false;
                }

                // Convert secret from hex to bytes
                byte[] secret = HexStringToByteArray(secretHex);
                if (secret.Length != 32)
                {
                    Console.Error.WriteLine("ERROR: Session secret must be 32 bytes");
                    return false;
                }

                // Verify HMAC
                string message = string.Format("{0}:{1}", timestampStr, nonce);
                using (var hmac = new HMACSHA256(secret))
                {
                    byte[] messageBytes = Encoding.UTF8.GetBytes(message);
                    byte[] hashBytes = hmac.ComputeHash(messageBytes);
                    string expectedHmac = ByteArrayToHexString(hashBytes);

                    if (!expectedHmac.Equals(providedHmac, StringComparison.OrdinalIgnoreCase))
                    {
                        Console.Error.WriteLine("ERROR: Invalid session token HMAC signature");
                        return false;
                    }
                }

                Console.Error.WriteLine("DEBUG: Session token verified successfully");
                return true;
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine(string.Format("ERROR: Session token verification failed: {0}", ex.Message));
                return false;
            }
        }

        /// <summary>
        /// Convert hex string to byte array
        /// </summary>
        static byte[] HexStringToByteArray(string hex)
        {
            if (hex.Length % 2 != 0)
                throw new ArgumentException("Hex string must have even length");

            byte[] bytes = new byte[hex.Length / 2];
            for (int i = 0; i < bytes.Length; i++)
            {
                bytes[i] = Convert.ToByte(hex.Substring(i * 2, 2), 16);
            }
            return bytes;
        }

        /// <summary>
        /// Convert byte array to lowercase hex string
        /// </summary>
        static string ByteArrayToHexString(byte[] bytes)
        {
            StringBuilder sb = new StringBuilder(bytes.Length * 2);
            foreach (byte b in bytes)
            {
                sb.AppendFormat("{0:x2}", b);
            }
            return sb.ToString();
        }

        [STAThread]
        static int Main(string[] args)
        {
            // Check for API schema request
            if (args.Length > 0 && args[0] == "--api-schema")
            {
                OutputApiSchema();
                return 0;
            }

            // ── stdin-pipe mode (replaces inject-mode tmpFile protocol) ──────────
            // HelperRegistry sends one JSON line to stdin and reads one JSON line
            // from stdout.  Format:
            //   {"id":"1","target":"notepad","action":"{QUERYTREE:3}"}
            // We re-invoke Main() with synthesised [target, action] args so the
            // full existing command-dispatch runs without any code duplication.
            if (args.Length > 0 && args[0] == "--listen-stdin")
            {
                bool persistent = HelperCommon.HasFlag(args, "--persistent");
                Action<string, string> kwDispatch = (tgt, act) =>
                {
                    // Synthesise args that the normal Main() dispatch path expects:
                    //   Main(new[]{ target, action })
                    // The recursive call goes through VerifySessionToken (still
                    // uses SKIP_SESSION_AUTH=true from env in Step-1), then normal
                    // processName / keys resolution and command dispatch.
                    Main(new string[] { tgt, act });
                };
                Func<string> kwSchema = () =>
                {
                    var sb = new StringBuilder();
                    sb.Append("{\"helper\":\"KeyWin.exe\",\"version\":\"1.0.0\",");
                    sb.Append("\"description\":\"Windows UI automation helper with form controls and element manipulation\"}");
                    return sb.ToString();
                };
                return HelperCommon.RunStdinListener(persistent, kwDispatch, kwSchema);
            }

            try
            {
                // Verify session token from MCP server
                if (!VerifySessionToken())
                {
                    string errorJson = "{\"success\": false, \"error\": \"SESSION_AUTH_FAILED\", \"message\": \"Session token verification failed\"}";
                    Console.WriteLine(errorJson);
                    return 1;
                }

                string processName = null;
                string keys = null;
                string injectMode = "direct"; // default to direct injection

                // Parse command-line arguments for --inject-mode
                var argsList = new System.Collections.Generic.List<string>(args);
                for (int i = 0; i < argsList.Count; i++)
                {
                    if (argsList[i].StartsWith("--inject-mode=", StringComparison.OrdinalIgnoreCase))
                    {
                        injectMode = argsList[i].Substring(14).ToLower();
                        argsList.RemoveAt(i);
                        i--;
                    }
                    else if (argsList[i].Equals("--inject-mode", StringComparison.OrdinalIgnoreCase) && i + 1 < argsList.Count)
                    {
                        injectMode = argsList[i + 1].ToLower();
                        argsList.RemoveAt(i);
                        argsList.RemoveAt(i);
                        i--;
                    }
                }
                args = argsList.ToArray();

                // Validate inject mode
                if (injectMode != "direct" && injectMode != "focus")
                {
                    Console.Error.WriteLine("WARNING: Invalid inject-mode '" + injectMode + "', defaulting to 'direct'");
                    injectMode = "direct";
                }
                Console.Error.WriteLine("DEBUG: Using inject-mode: " + injectMode);

                // First try environment variables
                processName = Environment.GetEnvironmentVariable("KEYWIN_PROCESS");
                keys = Environment.GetEnvironmentVariable("KEYWIN_KEYS");

                // Check for {LISTWINDOWS} as single argument
                if (args.Length == 1 && args[0].Equals("{LISTWINDOWS}", StringComparison.OrdinalIgnoreCase))
                {
                    keys = args[0];
                }

                // If env vars not set, try reading from file (to handle Unicode properly)
                if (string.IsNullOrEmpty(processName) && args.Length >= 1 && System.IO.File.Exists(args[0]))
                {
                    try
                    {
                        // Use UTF-8 without BOM to properly handle files with BOM preamble
                        Encoding utf8NoBom = new System.Text.UTF8Encoding(false);
                        string[] lines = System.IO.File.ReadAllLines(args[0], utf8NoBom);
                        if (lines.Length >= 2)
                        {
                            processName = lines[0];
                            keys = lines[1];
                        }
                        Console.Error.WriteLine("DEBUG: Read from file - process: " + processName + ", keys: " + keys);
                    }
                    catch (Exception ex) { Console.Error.WriteLine("DEBUG: File read error: " + ex.Message); }
                }

                // Fallback to command-line args
                if (string.IsNullOrEmpty(processName) && args.Length >= 2)
                {
                    processName = args[0];
                    keys = args[1];
                }

                // Handle global commands that don't need a process/window
                if (keys != null && keys.Equals("{LISTWINDOWS}", StringComparison.OrdinalIgnoreCase))
                {
                    // TODO: Add security validation here
                    string commandType = DetermineCommandType(keys);
                    string parameter = ExtractParameter(keys, commandType);
                    Console.Error.WriteLine("DEBUG: Command=" + commandType + ", Parameter=" + parameter);
                    
                    var windows = new System.Collections.Generic.List<string>();
                    EnumWindows((IntPtr h, IntPtr lParam) =>
                    {
                        if (IsWindowVisible(h))
                        {
                            int length = GetWindowTextLength(h);
                            if (length > 0)
                            {
                                var sb = new StringBuilder(length + 1);
                                GetWindowText(h, sb, sb.Capacity);
                                string title = sb.ToString();
                                int pid;
                                GetWindowThreadProcessId(h, out pid);
                                windows.Add("{\"handle\":" + h.ToInt64() + ",\"title\":\"" + EscapeJson(title) + "\",\"pid\":" + pid + "}");
                            }
                        }
                        return true;
                    }, IntPtr.Zero);
                    Console.WriteLine("{\"success\":true,\"windows\":[" + string.Join(",", windows.ToArray()) + "]}");
                    return 0;
                }

                // Handle {KILL} command
                if (keys != null && keys.Equals("{KILL}", StringComparison.OrdinalIgnoreCase))
                {
                    // TODO: Add security validation here
                    string commandType = DetermineCommandType(keys);
                    string parameter = ExtractParameter(keys, commandType);
                    Console.Error.WriteLine("DEBUG: Command=" + commandType + ", Parameter=" + parameter);
                    
                    if (string.IsNullOrEmpty(processName))
                    {
                        Console.WriteLine("{\"success\":false,\"error\":\"missing_process\",\"message\":\"Process name required for KILL command\"}");
                        return 2;
                    }

                    try
                    {
                        // Support PID:12345 format
                        if (processName.StartsWith("PID:", StringComparison.OrdinalIgnoreCase))
                        {
                            int pid;
                            if (int.TryParse(processName.Substring(4), out pid))
                            {
                                var process = Process.GetProcessById(pid);
                                process.Kill();
                                process.WaitForExit(5000);
                                Console.WriteLine("{\"success\":true,\"action\":\"killed\",\"pid\":" + pid + "}");
                                return 0;
                            }
                        }

                        // Process name lookup
                        string pName = processName;
                        if (pName.EndsWith(".exe", StringComparison.OrdinalIgnoreCase))
                        {
                            pName = pName.Substring(0, pName.Length - 4);
                        }

                        Process[] processes = Process.GetProcessesByName(pName);
                        if (processes.Length == 0)
                        {
                            Console.WriteLine("{\"success\":false,\"error\":\"process_not_found\",\"target\":\"" + EscapeJson(processName) + "\"}");
                            return 1;
                        }

                        int killedCount = 0;
                        foreach (var p in processes)
                        {
                            try
                            {
                                p.Kill();
                                p.WaitForExit(2000);
                                killedCount++;
                            }
                            catch { }
                        }

                        Console.WriteLine("{\"success\":true,\"action\":\"killed\",\"process\":\"" + EscapeJson(processName) + "\",\"count\":" + killedCount + "}");
                        return 0;
                    }
                    catch (Exception ex)
                    {
                        Console.WriteLine("{\"success\":false,\"error\":\"kill_failed\",\"message\":\"" + EscapeJson(ex.Message) + "\"}");
                        return 1;
                    }
                }

                // ── {RESET} — clear single-session app state without closing it ───────────
                // Strategy: try standard AC/Clear AutomationIds first, then Ctrl+Z spam,
                // then fall back to app-specific sequences.
                if (keys != null && keys.Equals("{RESET}", StringComparison.OrdinalIgnoreCase))
                {
                    IntPtr resetHwnd = FindWindowByProcessName(processName);
                    if (resetHwnd == IntPtr.Zero)
                    {
                        Console.WriteLine("{\"success\":false,\"error\":\"window_not_found\",\"target\":\"" + EscapeJson(processName) + "\"}");
                        return 1;
                    }

                    // 1. Try clicking the AC / Clear / ClearAll automation element
                    var clearIds = new[] { "clearButton", "clearEntryButton", "ClearButton", "btnClear", "btnAC", "clearall" };
                    bool resetDone = false;
                    try
                    {
                        var rootEl = System.Windows.Automation.AutomationElement.FromHandle(resetHwnd);
                        foreach (var clearId in clearIds)
                        {
                            var found = rootEl.FindFirst(
                                System.Windows.Automation.TreeScope.Descendants,
                                new System.Windows.Automation.PropertyCondition(
                                    System.Windows.Automation.AutomationElement.AutomationIdProperty, clearId));
                            if (found != null)
                            {
                                object inv;
                                if (found.TryGetCurrentPattern(System.Windows.Automation.InvokePattern.Pattern, out inv))
                                {
                                    ((System.Windows.Automation.InvokePattern)inv).Invoke();
                                    resetDone = true;
                                    Console.WriteLine("{\"success\":true,\"action\":\"reset\",\"method\":\"clickId:" + clearId + "\"}");
                                    return 0;
                                }
                            }
                        }
                    }
                    catch { }

                    // 2. Fallback: send Escape then Ctrl+Z × 20 to undo all
                    if (!resetDone)
                    {
                        PostMessage(resetHwnd, WM_KEYDOWN, (IntPtr)0x1B, IntPtr.Zero);  // ESC
                        Thread.Sleep(100);
                        for (int i = 0; i < 20; i++)
                        {
                            PostMessage(resetHwnd, WM_KEYDOWN, (IntPtr)0x11, IntPtr.Zero);  // CTRL
                            PostMessage(resetHwnd, WM_KEYDOWN, (IntPtr)0x5A, IntPtr.Zero);  // Z
                            PostMessage(resetHwnd, WM_KEYUP,   (IntPtr)0x5A, IntPtr.Zero);
                            PostMessage(resetHwnd, WM_KEYUP,   (IntPtr)0x11, IntPtr.Zero);
                        }
                        Console.WriteLine("{\"success\":true,\"action\":\"reset\",\"method\":\"ctrl+z×20\"}");
                    }
                    return 0;
                }

                // ── {NEWDOC} — open a new document in a multi-document app (Ctrl+N) ─────
                if (keys != null && keys.Equals("{NEWDOC}", StringComparison.OrdinalIgnoreCase))
                {
                    IntPtr ndHwnd = FindWindowByProcessName(processName);
                    if (ndHwnd == IntPtr.Zero)
                    {
                        Console.WriteLine("{\"success\":false,\"error\":\"window_not_found\",\"target\":\"" + EscapeJson(processName) + "\"}");
                        return 1;
                    }

                    // Snapshot the set of visible windows belonging to this process BEFORE
                    // Ctrl+N so we can identify any NEW window that appears afterwards.
                    // This is more reliable than GetForegroundWindow() which can be stolen
                    // by the IDE/runner process (e.g. VS Code) between SendKeys and our read.
                    int ndPid;
                    GetWindowThreadProcessId(ndHwnd, out ndPid);
                    var beforeHwnds = new System.Collections.Generic.HashSet<long>();
                    EnumWindows((h, lp) =>
                    {
                        int pid;
                        GetWindowThreadProcessId(h, out pid);
                        if (pid == ndPid && IsWindowVisible(h))
                            beforeHwnds.Add(h.ToInt64());
                        return true;
                    }, IntPtr.Zero);

                    // Bring window to foreground, then send Ctrl+N via SendKeys (focus-required)
                    SetForegroundWindow(ndHwnd);
                    Thread.Sleep(200);
                    System.Windows.Forms.SendKeys.SendWait("^n");
                    Thread.Sleep(600);  // wait for new document window to appear

                    // Pick the first new visible window for the same process.
                    // Avoids the race where GetForegroundWindow() returns the IDE window.
                    IntPtr newHwnd = IntPtr.Zero;
                    string newTitle = "";
                    EnumWindows((h, lp) =>
                    {
                        int pid;
                        GetWindowThreadProcessId(h, out pid);
                        if (pid == ndPid && IsWindowVisible(h) && !beforeHwnds.Contains(h.ToInt64()))
                        {
                            var sb2 = new System.Text.StringBuilder(512);
                            GetWindowText(h, sb2, sb2.Capacity);
                            string t = sb2.ToString();
                            if (!string.IsNullOrWhiteSpace(t))
                            {
                                newHwnd  = h;
                                newTitle = t;
                                return false; // stop enumeration
                            }
                        }
                        return true;
                    }, IntPtr.Zero);

                    // Fallback: if no new top-level window appeared (e.g. Windows 11 tabbed
                    // Notepad opens a new tab inside the EXISTING window), return the original
                    // window handle — it now contains the new document/tab.
                    if (newHwnd == IntPtr.Zero)
                    {
                        newHwnd = ndHwnd;
                        var sb2 = new System.Text.StringBuilder(512);
                        GetWindowText(ndHwnd, sb2, sb2.Capacity);
                        newTitle = sb2.ToString();
                    }

                    Console.WriteLine("{\"success\":true,\"action\":\"newdoc\",\"method\":\"ctrl+n\","
                        + "\"new_window_handle\":" + newHwnd.ToInt64() + ","
                        + "\"new_window_title\":\"" + EscapeJson(newTitle) + "\"}");
                    return 0;
                }

                if (string.IsNullOrEmpty(processName) || string.IsNullOrEmpty(keys))
                {
                    Console.Error.WriteLine("Usage: WinKeys [--inject-mode=direct|focus] <ProcessId> <Keys>");
                    Console.Error.WriteLine("Options:");
                    Console.Error.WriteLine("  --inject-mode=direct  Use PostMessage for direct injection (default, safer)");
                    Console.Error.WriteLine("  --inject-mode=focus   Use SendKeys with SetForegroundWindow (legacy)");
                    Console.Error.WriteLine("  ProcessId: Process name, PID:12345, or HANDLE:67890");
                    Console.Error.WriteLine("    - Process name: 'notepad' or 'notepad.exe'");
                    Console.Error.WriteLine("    - PID: 'PID:12345' (numeric process ID)");
                    Console.Error.WriteLine("    - HANDLE: 'HANDLE:67890' (numeric window handle)");
                    Console.Error.WriteLine("  Keys: Keys to send or special command");
                    Console.Error.WriteLine("    - {READ} - Read display text");
                    Console.Error.WriteLine("    - {LISTWINDOWS} - List all windows (no ProcessId needed)");
                    Console.Error.WriteLine("    - {KILL} - Terminate process");
                    Console.Error.WriteLine("    - {QUERYTREE:N} - Query UI tree to depth N");
                    Console.Error.WriteLine("    - {CLICK:x,y} - Mouse click at coordinates");
                    Console.Error.WriteLine("    - {CLICKNAME:name} - Click element by name");
                    Console.Error.WriteLine("    - Regular keys: '3+4=' etc");
                    Console.Error.WriteLine("");
                    Console.Error.WriteLine("All output is JSON format:");
                    Console.Error.WriteLine("  Success: {\"success\":true, ...}");
                    Console.Error.WriteLine("  Failure: {\"success\":false,\"error\":\"code\",\"message\":\"...\"}");
                    Console.WriteLine("{\"success\":false,\"error\":\"invalid_usage\"}");
                    return 2;
                }

                Console.Error.WriteLine("DEBUG: Looking for process: " + processName);
                IntPtr hwnd = FindWindowByProcessName(processName);
                
                if (hwnd == IntPtr.Zero)
                {
                    Console.Error.WriteLine("Process window not found: " + processName);
                    Console.WriteLine("{\"success\":false,\"error\":\"window_not_found\",\"target\":\"" + EscapeJson(processName) + "\"}");
                    return 1;
                }

                Console.Error.WriteLine("DEBUG: Window found, handle: " + hwnd);

                // Always bring window to foreground so the user can see what is happening.
                // (Direct/PostMessage injection works without focus, but visibility is expected.)
                SetForegroundWindow(hwnd);
                System.Threading.Thread.Sleep(80);

                // Handle focus mode if requested
                if (injectMode == "focus")
                {
                    bool focusResult = SetForegroundWindow(hwnd);
                    if (!focusResult)
                    {
                        System.Threading.Thread.Sleep(200);
                        focusResult = SetForegroundWindow(hwnd);
                    }
                    Console.Error.WriteLine("DEBUG: SetForegroundWindow returned: " + focusResult);
                    
                    // Verify the window is now in foreground
                    IntPtr fgWnd = GetForegroundWindow();
                    if (fgWnd != hwnd)
                    {
                        System.Threading.Thread.Sleep(200);
                        SetForegroundWindow(hwnd);
                        fgWnd = GetForegroundWindow();
                    }
                    Console.Error.WriteLine("DEBUG: Foreground window is now: " + fgWnd + " (target was: " + hwnd + ")");
                    
                    System.Threading.Thread.Sleep(500); // Wait for window to receive focus
                }

                // Special actions
                if (keys.Equals("{READ}", StringComparison.OrdinalIgnoreCase))
                {
                    var text = ReadDisplayText(hwnd);
                    if (text == null)
                    {
                        Console.Error.WriteLine("DEBUG: Display read returned null");
                        Console.WriteLine("{\"success\":false,\"error\":\"read_failed\",\"value\":null}");
                        return 4;
                    }
                    // Output structured JSON
                    Console.WriteLine("{\"success\":true,\"value\":\"" + EscapeJson(text) + "\"}");
                    return 0;
                }

                // Query UI tree - {QUERYTREE} or {QUERYTREE:depth}
                if (keys.StartsWith("{QUERYTREE", StringComparison.OrdinalIgnoreCase))
                {
                    // TODO: Add security validation here
                    string commandType = DetermineCommandType(keys);
                    string parameter = ExtractParameter(keys, commandType);
                    Console.Error.WriteLine("DEBUG: Command=" + commandType + ", Parameter=" + parameter);
                    
                    int depth = 2; // default depth
                    var match = Regex.Match(keys, @"\{QUERYTREE:(\d+)\}", RegexOptions.IgnoreCase);
                    if (match.Success)
                    {
                        int.TryParse(match.Groups[1].Value, out depth);
                    }
                    var json = QueryUITree(hwnd, depth);
                    Console.WriteLine(json);
                    return 0;
                }

                // Handle {CLICKID:automationId} - click by AutomationId
                var clickIdMatch = Regex.Match(keys, @"\{CLICKID:([^}]+)\}", RegexOptions.IgnoreCase);
                if (clickIdMatch.Success)
                {
                    string buttonId = clickIdMatch.Groups[1].Value;
                    Console.Error.WriteLine("DEBUG: CLICKID - looking for: " + buttonId);
                    var root = AutomationElement.FromHandle(hwnd);
                    if (InvokeButtonByName(root, buttonId))
                    {
                        Console.WriteLine("{\"success\":true,\"action\":\"clickid\",\"elementId\":\"" + EscapeJson(buttonId) + "\"}");
                        return 0;
                    }
                    Console.Error.WriteLine("DEBUG: CLICKID - element not found: " + buttonId);
                    Console.WriteLine("{\"success\":false,\"error\":\"element_not_found\",\"elementId\":\"" + EscapeJson(buttonId) + "\"}");
                    return 5;
                }

                // ── KEYDOWN / KEYUP / KEYPRESS ────────────────────────────────────────
                var keyDownMatch = Regex.Match(keys, @"\{KEYDOWN:([^}]+)\}", RegexOptions.IgnoreCase);
                if (keyDownMatch.Success)
                {
                    bool ok2 = SendRawKey(keyDownMatch.Groups[1].Value, false);
                    Console.WriteLine(ok2
                        ? "{\"success\":true,\"action\":\"keydown\",\"key\":\"" + EscapeJson(keyDownMatch.Groups[1].Value) + "\"}"
                        : "{\"success\":false,\"error\":\"unknown_key\",\"key\":\"" + EscapeJson(keyDownMatch.Groups[1].Value) + "\"}");
                    return ok2 ? 0 : 6;
                }

                var keyUpMatch = Regex.Match(keys, @"\{KEYUP:([^}]+)\}", RegexOptions.IgnoreCase);
                if (keyUpMatch.Success)
                {
                    bool ok2 = SendRawKey(keyUpMatch.Groups[1].Value, true);
                    Console.WriteLine(ok2
                        ? "{\"success\":true,\"action\":\"keyup\",\"key\":\"" + EscapeJson(keyUpMatch.Groups[1].Value) + "\"}"
                        : "{\"success\":false,\"error\":\"unknown_key\",\"key\":\"" + EscapeJson(keyUpMatch.Groups[1].Value) + "\"}");
                    return ok2 ? 0 : 6;
                }

                var keyPressMatch = Regex.Match(keys, @"\{KEYPRESS:([^}]+)\}", RegexOptions.IgnoreCase);
                if (keyPressMatch.Success)
                {
                    string kpKey = keyPressMatch.Groups[1].Value;
                    bool ok2 = SendRawKey(kpKey, false);
                    System.Threading.Thread.Sleep(20);
                    bool ok3 = SendRawKey(kpKey, true);
                    bool allOk = ok2 && ok3;
                    Console.WriteLine(allOk
                        ? "{\"success\":true,\"action\":\"keypress\",\"key\":\"" + EscapeJson(kpKey) + "\"}"
                        : "{\"success\":false,\"error\":\"unknown_key\",\"key\":\"" + EscapeJson(kpKey) + "\"}");
                    return allOk ? 0 : 6;
                }

                // ── RIGHTCLICK ────────────────────────────────────────────────────────
                var rcMatch = Regex.Match(keys, @"\{RIGHTCLICK:(\d+),(\d+)\}", RegexOptions.IgnoreCase);
                if (rcMatch.Success)
                {
                    int rcx = int.Parse(rcMatch.Groups[1].Value);
                    int rcy = int.Parse(rcMatch.Groups[2].Value);
                    SendMouseRightClick(rcx, rcy);
                    Console.WriteLine("{\"success\":true,\"action\":\"rightclick\",\"x\":" + rcx + ",\"y\":" + rcy + "}");
                    return 0;
                }

                // ── DBLCLICK ──────────────────────────────────────────────────────────
                var dcMatch = Regex.Match(keys, @"\{DBLCLICK:(\d+),(\d+)\}", RegexOptions.IgnoreCase);
                if (dcMatch.Success)
                {
                    int dcx = int.Parse(dcMatch.Groups[1].Value);
                    int dcy = int.Parse(dcMatch.Groups[2].Value);
                    SendMouseDblClick(dcx, dcy);
                    Console.WriteLine("{\"success\":true,\"action\":\"dblclick\",\"x\":" + dcx + ",\"y\":" + dcy + "}");
                    return 0;
                }

                // ── HOVER ─────────────────────────────────────────────────────────────
                var hoverMatch = Regex.Match(keys, @"\{HOVER:(\d+),(\d+)\}", RegexOptions.IgnoreCase);
                if (hoverMatch.Success)
                {
                    int hx = int.Parse(hoverMatch.Groups[1].Value);
                    int hy = int.Parse(hoverMatch.Groups[2].Value);
                    SendMouseHover(hx, hy);
                    Console.WriteLine("{\"success\":true,\"action\":\"hover\",\"x\":" + hx + ",\"y\":" + hy + "}");
                    return 0;
                }

                // ── FILL ──────────────────────────────────────────────────────────────
                // Format: {FILL:selector:value}  selector = AutomationId or Name
                var fillMatch = Regex.Match(keys, @"\{FILL:([^:}]+):(.+?)\}", RegexOptions.IgnoreCase | RegexOptions.Singleline);
                if (fillMatch.Success)
                {
                    string fillSel = fillMatch.Groups[1].Value;
                    string fillVal = fillMatch.Groups[2].Value;
                    var fillRoot = AutomationElement.FromHandle(hwnd);
                    bool fillOk = WinUtils.FillElement(fillRoot, fillSel, fillVal);
                    Console.WriteLine(fillOk
                        ? "{\"success\":true,\"action\":\"fill\",\"selector\":\"" + EscapeJson(fillSel) + "\"}"
                        : "{\"success\":false,\"error\":\"fill_failed\",\"selector\":\"" + EscapeJson(fillSel) + "\"}");
                    return fillOk ? 0 : 5;
                }

                // ── READELEM ──────────────────────────────────────────────────────────
                // Format: {READELEM:selector}  selector = AutomationId or Name
                var reMatch = Regex.Match(keys, @"\{READELEM:([^}]+)\}", RegexOptions.IgnoreCase);
                if (reMatch.Success)
                {
                    string reSel = reMatch.Groups[1].Value;
                    var reRoot = AutomationElement.FromHandle(hwnd);
                    string reVal = WinUtils.ReadElementValue(reRoot, reSel);
                    if (reVal != null)
                    {
                        Console.WriteLine("{\"success\":true,\"action\":\"readelem\",\"selector\":\"" + EscapeJson(reSel) + "\",\"value\":\"" + EscapeJson(reVal) + "\"}");
                        return 0;
                    }
                    Console.WriteLine("{\"success\":false,\"error\":\"readelem_failed\",\"selector\":\"" + EscapeJson(reSel) + "\"}");
                    return 5;
                }

                int? cx, cy;
                if (TryParseClick(keys, out cx, out cy))
                {
                    if (injectMode == "direct")
                    {
                        DirectMouseClick(hwnd, cx, cy);
                    }
                    else
                    {
                        SendMouseClick(cx, cy);
                    }
                    Console.WriteLine("{\"success\":true,\"action\":\"click\",\"mode\":\"" + injectMode + "\"}");
                    return 0;
                }

                // Support multiple {CLICKNAME:foo} tokens chained, e.g. {CLICKNAME:3}{CLICKNAME:+}{CLICKNAME:4}{CLICKNAME:=}
                var clickNameMatches = Regex.Matches(keys, "\\{CLICKNAME:[^}]+\\}");
                if (clickNameMatches.Count > 0)
                {
                    // TODO: Add security validation here for each CLICKNAME
                    string commandType = DetermineCommandType(keys);
                    string parameter = ExtractParameter(keys, commandType);
                    Console.Error.WriteLine("DEBUG: Command=" + commandType + ", Parameter=" + parameter);
                    
                    bool anyClick = false;
                    foreach (Match m in clickNameMatches)
                    {
                        string nm;
                        if (TryParseClickByName(m.Value, out nm))
                        {
                            if (ClickElementByName(hwnd, nm))
                            {
                                anyClick = true;
                                System.Threading.Thread.Sleep(150);
                            }
                        }
                    }
                    if (anyClick)
                    {
                        Console.WriteLine("{\"success\":true,\"action\":\"clickname\"}");
                        return 0;
                    }
                    Console.WriteLine("{\"success\":false,\"error\":\"element_not_found\"}");
                    return 5;
                }

                // Send keystrokes based on inject mode
                if (injectMode == "direct")
                {
                    // Strip {SENDKEYS:text} wrapper from MCP protocol before injecting
                    string keysToSend = keys;
                    var skWrap = Regex.Match(keys, @"^\{SENDKEYS:(.+)\}$", RegexOptions.IgnoreCase | RegexOptions.Singleline);
                    if (skWrap.Success) keysToSend = skWrap.Groups[1].Value;
                    Console.Error.WriteLine("DEBUG: SENDKEYS payload=" + keysToSend);

                    // For browser render widgets, send input to the focused child HWND
                    IntPtr sendTarget = hwnd;
                    IntPtr renderHwnd = FindRenderWidgetHwnd(hwnd);
                    if (renderHwnd != IntPtr.Zero)
                    {
                        Console.Error.WriteLine("DEBUG: SENDKEYS -> Chrome_RenderWidgetHostHWND " + renderHwnd);
                        sendTarget = renderHwnd;
                    }

                    DirectSendKeys(sendTarget, keysToSend);
                    Console.WriteLine("{\"success\":true,\"action\":\"keys\",\"mode\":\"direct\"}");
                }
                else
                {
                    // Legacy: Use SendKeys with focus
                    string sendKeysSequence = BuildSendKeysSequence(keys);
                    Console.Error.WriteLine("DEBUG: Sending keys via SendKeys.SendWait: " + sendKeysSequence);
                    try
                    {
                        SendKeys.SendWait(sendKeysSequence);
                        Console.Error.WriteLine("DEBUG: SendKeys.SendWait completed successfully");
                        Console.WriteLine("{\"success\":true,\"action\":\"keys\",\"mode\":\"focus\"}");
                    }
                    catch (Exception ex)
                    {
                        Console.Error.WriteLine("DEBUG: SendKeys error: " + ex.Message);
                        Console.WriteLine("{\"success\":false,\"error\":\"sendkeys_failed\",\"message\":\"" + EscapeJson(ex.Message) + "\"}");
                        return 3;
                    }
                }

                return 0;
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine("FATAL ERROR: " + ex.GetType().Name + ": " + ex.Message);
                Console.Error.WriteLine("STACK: " + ex.StackTrace);
                Console.WriteLine("{\"success\":false,\"error\":\"fatal_exception\",\"type\":\"" + EscapeJson(ex.GetType().Name) + "\",\"message\":\"" + EscapeJson(ex.Message) + "\"}");
                return 128;
            }
        }

        static void OutputApiSchema()
        {
            // Simple JSON serialization without System.Text.Json (not available in older .NET)
            var sb = new StringBuilder();
            sb.AppendLine("{");
            sb.AppendLine("  \"helper\": \"KeyWin.exe\",");
            sb.AppendLine("  \"version\": \"1.1.0\",");
            sb.AppendLine("  \"description\": \"Windows UI automation via UIA/HWND. Supports two window modes:\\n    SINGLE-SESSION apps (Calculator, Paint, Minesweeper): only one window exists at a time.\\n    Use RESET to clear state before reuse instead of closing.\\n    MULTI-DOCUMENT apps (Notepad, Word, Excel, browser via UIA): can hold many open documents.\\n    Use NEWDOC to open a new document/tab within the existing window instead of relaunching.\\n    Teardown policy (default: leave_open): leave_open (window stays open), discard_doc (close active doc/tab), close_app (terminate app).\\n    Before automating, call LISTWINDOWS to discover existing instances and reuse them.\",");
            sb.AppendLine("  \"window_modes\": [");
            sb.AppendLine("    { \"mode\": \"single_session\", \"description\": \"One window; use RESET to clear state\", \"examples\": [\"calc.exe\", \"mspaint.exe\"] },");
            sb.AppendLine("    { \"mode\": \"multi_document\", \"description\": \"Many documents/tabs; use NEWDOC or open new windows\", \"examples\": [\"notepad.exe\", \"winword.exe\"] }");
            sb.AppendLine("  ],");
            sb.AppendLine("  \"teardown_policies\": [\"leave_open\", \"discard_doc\", \"close_app\"],");
            sb.AppendLine("  \"commands\": [");

            // Command definitions
            sb.AppendLine("    { \"name\": \"LISTWINDOWS\", \"description\": \"List all visible top-level windows with title, handle and PID. Always call first to discover existing instances before launching new ones.\", \"parameters\": [], \"examples\": [\"{LISTWINDOWS}\"] },");
            sb.AppendLine("    { \"name\": \"QUERYTREE\", \"description\": \"Return the UIA element tree for the target window (depth 1-8). Use to discover AutomationIds and control names before clicking.\", \"parameters\": [ { \"name\": \"depth\", \"type\": \"integer\", \"required\": false, \"default\": 3 } ], \"examples\": [\"{QUERYTREE}\", \"{QUERYTREE:5}\"] },");
            sb.AppendLine("    { \"name\": \"READ\", \"description\": \"Read the current value/text from the target window (document body, selected value, etc.).\", \"parameters\": [], \"examples\": [\"{READ}\"] },");
            sb.AppendLine("    { \"name\": \"CLICKID\", \"description\": \"Click a UI element by AutomationId (from QUERYTREE). Preferred over CLICKNAME when IDs are stable.\", \"parameters\": [ { \"name\": \"elementId\", \"type\": \"string\", \"required\": true } ], \"examples\": [\"{CLICKID:num2Button}\", \"{CLICKID:clearButton}\"] },");
            sb.AppendLine("    { \"name\": \"CLICKNAME\", \"description\": \"Click a UI element by its visible Name property. Use when no stable AutomationId is available.\", \"parameters\": [ { \"name\": \"elementName\", \"type\": \"string\", \"required\": true } ], \"examples\": [\"{CLICKNAME:Plus}\", \"{CLICKNAME:OK}\"] },");
            sb.AppendLine("    { \"name\": \"CLICK\", \"description\": \"Click at absolute screen coordinates (x,y). Use only when element IDs and names are unavailable.\", \"parameters\": [ { \"name\": \"coordinates\", \"type\": \"string\", \"required\": true } ], \"examples\": [\"{CLICK:100,200}\"] },");
            sb.AppendLine("    { \"name\": \"SENDKEYS\", \"description\": \"Send keystrokes to the target window. Supports literal text and special tokens: {ENTER}, {TAB}, {ESC}, {CTRL+A}, {CTRL+C} (copy), {CTRL+V} (paste), {CTRL+Z} (undo), {CTRL+S} (save), {DELETE}, {BACK}. Use for typing, editing, and clipboard operations.\", \"parameters\": [ { \"name\": \"keys\", \"type\": \"string\", \"required\": true } ], \"examples\": [\"Hello World\", \"Hello{ENTER}World\", \"{CTRL+A}{CTRL+C}\", \"{CTRL+V}\"] },");
            sb.AppendLine("    { \"name\": \"SET\", \"description\": \"Set a property on a UI element via ValuePattern (direct value injection, bypasses keyboard).\", \"parameters\": [ { \"name\": \"property\", \"type\": \"string\", \"required\": true }, { \"name\": \"value\", \"type\": \"string\", \"required\": true } ], \"examples\": [\"{SET:Value:Hello World}\"] },");
            sb.AppendLine("    { \"name\": \"RESET\", \"description\": \"Reset a SINGLE-SESSION app to a clean state without closing it. For Calculator: clicks the AC/Clear button. For other apps: application-specific reset. Prefer over close+relaunch to minimise side effects.\", \"parameters\": [], \"examples\": [\"{RESET}\"] },");
            sb.AppendLine("    { \"name\": \"NEWDOC\", \"description\": \"Open a new document in the target MULTI-DOCUMENT app (Ctrl+N). Use instead of launching a second process when the application already exists.\", \"parameters\": [], \"examples\": [\"{NEWDOC}\"] },");
            sb.AppendLine("    { \"name\": \"KILL\", \"description\": \"Terminate the target process. Use only when teardown_policy=close_app and explicitly confirmed.\", \"parameters\": [], \"examples\": [\"{KILL}\"] },");
            sb.AppendLine("    { \"name\": \"KEYDOWN\", \"description\": \"Hold a modifier key (SendInput KEYEVENTF_KEYDOWN). Use before other keys for chords that SENDKEYS cannot express. Always pair with KEYUP.\", \"parameters\": [ { \"name\": \"key\", \"type\": \"string\", \"required\": true } ], \"examples\": [\"{KEYDOWN:Ctrl}\", \"{KEYDOWN:Alt}\", \"{KEYDOWN:Shift}\", \"{KEYDOWN:Win}\"] },");
            sb.AppendLine("    { \"name\": \"KEYUP\", \"description\": \"Release a held modifier key (SendInput KEYEVENTF_KEYUP). Always use after a matching KEYDOWN.\", \"parameters\": [ { \"name\": \"key\", \"type\": \"string\", \"required\": true } ], \"examples\": [\"{KEYUP:Ctrl}\", \"{KEYUP:Alt}\"] },");
            sb.AppendLine("    { \"name\": \"KEYPRESS\", \"description\": \"Atomic keydown+keyup for function/navigation keys (F1-F12, HOME, END, PAGEUP, PAGEDOWN, INSERT, DELETE, ENTER, TAB, ESC, APPS, arrow keys). Not for typing printable text — use SENDKEYS for that.\", \"parameters\": [ { \"name\": \"key\", \"type\": \"string\", \"required\": true } ], \"examples\": [\"{KEYPRESS:F5}\", \"{KEYPRESS:HOME}\", \"{KEYPRESS:F11}\"] },");
            sb.AppendLine("    { \"name\": \"RIGHTCLICK\", \"description\": \"Right-click at absolute screen coordinates (x,y). Opens context menus.\", \"parameters\": [ { \"name\": \"coordinates\", \"type\": \"string\", \"required\": true } ], \"examples\": [\"{RIGHTCLICK:100,200}\"] },");
            sb.AppendLine("    { \"name\": \"DBLCLICK\", \"description\": \"Double left-click at absolute screen coordinates (x,y). Opens items and triggers default actions.\", \"parameters\": [ { \"name\": \"coordinates\", \"type\": \"string\", \"required\": true } ], \"examples\": [\"{DBLCLICK:100,200}\"] },");
            sb.AppendLine("    { \"name\": \"HOVER\", \"description\": \"Move mouse cursor to screen coordinates (x,y) without clicking. Triggers hover effects and tooltips.\", \"parameters\": [ { \"name\": \"coordinates\", \"type\": \"string\", \"required\": true } ], \"examples\": [\"{HOVER:100,200}\"] },");
            sb.AppendLine("    { \"name\": \"FILL\", \"description\": \"Set value of a UI element by AutomationId or Name (ValuePattern). Fires UIA value-change so JS frameworks see the change. Format: {FILL:selector:value}\", \"parameters\": [ { \"name\": \"selector\", \"type\": \"string\", \"required\": true, \"description\": \"AutomationId or Name of the target element\" }, { \"name\": \"value\", \"type\": \"string\", \"required\": true } ], \"examples\": [\"{FILL:searchBox:hello world}\", \"{FILL:Username:admin}\"] },");
            sb.AppendLine("    { \"name\": \"READELEM\", \"description\": \"Read the current value of a UI element by AutomationId or Name (ValuePattern or Name fallback). Format: {READELEM:selector}\", \"parameters\": [ { \"name\": \"selector\", \"type\": \"string\", \"required\": true } ], \"examples\": [\"{READELEM:searchBox}\", \"{READELEM:Username}\"] }");
            sb.AppendLine("  ]");
            sb.AppendLine("}");
            
            Console.WriteLine(sb.ToString());
        }
    }
}
