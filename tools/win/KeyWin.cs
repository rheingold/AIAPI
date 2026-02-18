using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
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

        [StructLayout(LayoutKind.Sequential)]
        struct INPUT
        {
            public uint type;
            public MOUSEINPUT mi;
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
        const uint MOUSEEVENTF_LEFTDOWN = 0x0002;
        const uint MOUSEEVENTF_LEFTUP = 0x0004;

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

                // Final fallback: title hint search (for UWP windows hosted by ApplicationFrameHost)
                IntPtr titleHwnd = FindWindowByTitleHint();
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

        static IntPtr FindWindowByTitleHint()
        {
            string[] hints = { "Calculator", "Kalkula", "Kalkula\u010dka", "Calc" };
            IntPtr match = IntPtr.Zero;

            EnumWindows((hWnd, lParam) =>
            {
                if (!IsWindowVisible(hWnd)) return true;
                StringBuilder sb = new StringBuilder(256);
                GetWindowText(hWnd, sb, 256);
                string title = sb.ToString();
                if (string.IsNullOrWhiteSpace(title)) return true;

                foreach (var hint in hints)
                {
                    if (title.IndexOf(hint, StringComparison.OrdinalIgnoreCase) >= 0)
                    {
                        match = hWnd;
                        Console.Error.WriteLine("DEBUG: Title hint match: '" + title + "'");
                        return false; // stop
                    }
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
                case "SHIFT": return VK_SHIFT;
                case "CONTROL": case "CTRL": return VK_CONTROL;
                case "ALT": case "MENU": return VK_MENU;
                default: return 0;
            }
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

        static string GetButtonNameForChar(char c)
        {
            // Map characters to button AutomationId (language-independent)
            // For Calculator: num0Button, num1Button, etc.
            switch (c)
            {
                case '0': return "num0Button";
                case '1': return "num1Button";
                case '2': return "num2Button";
                case '3': return "num3Button";
                case '4': return "num4Button";
                case '5': return "num5Button";
                case '6': return "num6Button";
                case '7': return "num7Button";
                case '8': return "num8Button";
                case '9': return "num9Button";
                case '+': return "plusButton";
                case '-': return "minusButton";
                case '*': return "multiplyButton";
                case '/': return "divideButton";
                case '=': return "equalButton";
                case '.': return "decimalSeparatorButton";
                case 'C': case 'c': return "clearButton";
                default: return null;
            }
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

        static void DirectSendKeys(IntPtr hwnd, string keys)
        {
            Console.Error.WriteLine("DEBUG: DirectSendKeys injecting to hwnd=" + hwnd + " keys='" + keys + "'");
            
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
                
                // For apps with buttons (Calculator, etc.), try to invoke controls by name
                // Parse keys and find corresponding buttons
                Console.Error.WriteLine("DEBUG: No ValuePattern controls found, trying button invocation");
                bool anyInvoked = false;
                for (int i = 0; i < keys.Length; i++)
                {
                    char c = keys[i];
                    string buttonName = GetButtonNameForChar(c);
                    
                    Console.Error.WriteLine("DEBUG: Char '" + c + "' maps to button name: " + (buttonName ?? "null"));
                    
                    if (!string.IsNullOrEmpty(buttonName))
                    {
                        if (InvokeButtonByName(root, buttonName))
                        {
                            anyInvoked = true;
                            System.Threading.Thread.Sleep(50);
                        }
                    }
                }
                
                if (anyInvoked)
                {
                    Console.Error.WriteLine("DEBUG: Successfully invoked buttons via UI Automation");
                    return;
                }
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine("DEBUG: UI Automation approach failed: " + ex.Message);
            }
            
            // Final fallback: PostMessage to Edit control (classic Win32 apps)
            Console.Error.WriteLine("DEBUG: Falling back to PostMessage approach");
            IntPtr targetHwnd = GetEditControlForDirectInject(hwnd);
            
            for (int i = 0; i < keys.Length; i++)
            {
                char c = keys[i];
                
                // Handle special sequences like {ENTER}
                if (c == '{')
                {
                    int closeBrace = keys.IndexOf('}', i);
                    if (closeBrace > i)
                    {
                        string special = keys.Substring(i + 1, closeBrace - i - 1);
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
            if (!keys.StartsWith("{CLICK", StringComparison.OrdinalIgnoreCase)) return false;
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

        static string ReadDisplayText(IntPtr hwnd)
        {
            try
            {
                var root = AutomationElement.FromHandle(hwnd);
                AutomationElement display = null;

                // Prefer CalculatorResults AutomationId
                var condId = new PropertyCondition(AutomationElement.AutomationIdProperty, "CalculatorResults");
                display = root.FindFirst(TreeScope.Descendants, condId);

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
                            // Extract pure value - strip localized prefix like "Display is 8" -> "8"
                            string rawValue = vp.Current.Value;
                            if (!string.IsNullOrWhiteSpace(rawValue))
                            {
                                // Remove any non-numeric prefix (like "Display is ", "Zobrazuje se ", etc.)
                                var match = Regex.Match(rawValue, @"[\d\+\-\*/\.,\(\)eE]+$");
                                if (match.Success)
                                {
                                    return match.Value.Trim();
                                }
                                return rawValue;
                            }
                        }
                    }
                    catch { /* fall back to Name */ }

                    // Try Name property, extract numeric content
                    string name = display.Current.Name;
                    if (!string.IsNullOrWhiteSpace(name))
                    {
                        var match = Regex.Match(name, @"[\d\+\-\*/\.,\(\)eE]+$");
                        if (match.Success)
                        {
                            return match.Value.Trim();
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
                    // Direct injection via PostMessage
                    DirectSendKeys(hwnd, keys);
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
    }
}
