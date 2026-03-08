// BrowserWin.exe — Browser automation helper for AIAPI
// Communicates with Chromium browsers via Chrome DevTools Protocol (CDP).
// Usage:
//   BrowserWin.exe --api-schema
//   BrowserWin.exe <targetBrowser> <command> [--port <debugPort>]
//
// Commands use the same {COMMAND:param} envelope as KeyWin.exe.
// A running Chrome/Edge instance with --remote-debugging-port=<port> is required
// for all commands except --api-schema and {LISTBROWSERS}.
//
// NOTE: CDP WebSocket communication uses System.Net.WebSockets.ClientWebSocket
// which requires .NET 4.5+ and Windows 8+.  This file targets .NET 4.5.

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Net;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Net.Sockets;
using System.Windows.Automation;

namespace BrowserWin
{
    class Program
    {
        // ──────────────────────────────────────────────────────────────────────
        //  Entry point
        // ──────────────────────────────────────────────────────────────────────

        static int Main(string[] args)
        {
            try
            {
                if (args.Length == 0)
                {
                    Console.Error.WriteLine("Usage: BrowserWin.exe --api-schema");
                    Console.Error.WriteLine("       BrowserWin.exe <browser> <{COMMAND:param}> [--port <debugPort>]");
                    return 1;
                }

                if (args[0] == "--api-schema")
                {
                    OutputApiSchema();
                    return 0;
                }

                if (args[0] == "--version")
                {
                    Console.WriteLine("BrowserWin.exe 1.0.0");
                    return 0;
                }

                // ── HelperRegistry stdin-pipe mode (replaces inject-mode tmpFile) ─
                // HelperRegistry writes one JSON line to stdin and reads one JSON line
                // from stdout.  Format:
                //   {"id":"1","target":"brave:9222","action":"{NAVIGATE:https://x.com}"}
                // Built-in _schema and _exit are handled by HelperCommon.RunStdinListener.
                // For a regular command we re-invoke Main() with [target, action] args
                // so the existing dispatch path handles it without code duplication.
                if (args[0] == "--listen-stdin")
                {
                    // Auth handshake must happen before RunStdinListener.
                    // When SKIP_SESSION_AUTH=true (dev default), RunAuthHandshake returns
                    // immediately without reading any bytes from stdin.
                    bool skipAuth = string.Equals(
                        System.Environment.GetEnvironmentVariable("SKIP_SESSION_AUTH"),
                        "true", StringComparison.OrdinalIgnoreCase);
                    HelperCommon.RunAuthHandshake(skipAuth);

                    bool persistent = HelperCommon.HasFlag(args, "--persistent");
                    return HelperCommon.RunStdinListener(persistent, DispatchCommand, GetApiSchema);
                }

                // ── HTTP listener mode (--listen-port=N) ──────────────────────
                // Spawns an HTTP/1.1 loopback listener; same JSON protocol as stdin.
                // Example: BrowserWin.exe --listen-port=3461
                {
                    string listenPort = HelperCommon.GetFlagValue(args, "--listen-port");
                    if (listenPort != null)
                    {
                        int port = 0;
                        if (listenPort.Length == 0 ||
                            !int.TryParse(listenPort, out port) || port <= 0 || port > 65535)
                        {
                            Console.Error.WriteLine("AIAPI: --listen-port requires a valid port number (1-65535)");
                            return 1;
                        }
                        return HelperCommon.RunHttpListener(port, DispatchCommand, GetApiSchema);
                    }
                }

                // ── Named pipe listener mode (--listen-pipe=Name or --listen-pipe=\\.\pipe\Name) ──
                // Accepts one client at a time; reconnects automatically after each disconnect.
                // Example: BrowserWin.exe --listen-pipe=AIAPI_BrowserWin
                {
                    string pipeName = HelperCommon.GetFlagValue(args, "--listen-pipe");
                    if (pipeName != null)
                    {
                        if (pipeName.Length == 0)
                        {
                            Console.Error.WriteLine("AIAPI: --listen-pipe requires a pipe name");
                            return 1;
                        }
                        return HelperCommon.RunNamedPipeListener(pipeName, DispatchCommand, GetApiSchema);
                    }
                }

                // ── HelperRegistry inject-mode (same contract as KeyWin.exe) ──
                // HelperRegistry.callCommand() writes a temp file:
                //   line 1: target  (e.g. "brave", "msedge", "brave:9223")
                //   line 2: action  (e.g. "{NAVIGATE:https://example.com}")
                // and spawns:  BrowserWin.exe --inject-mode=direct <tmpFile>
                if (args[0] == "--inject-mode=direct" && args.Length >= 2)
                {
                    string tmpFile = args[1];
                    if (!System.IO.File.Exists(tmpFile))
                    {
                        Console.Error.WriteLine("ERROR: temp file not found: " + tmpFile);
                        return 1;
                    }
                    string[] lines = System.IO.File.ReadAllLines(tmpFile, Encoding.UTF8);
                    if (lines.Length < 2)
                    {
                        Console.Error.WriteLine("ERROR: temp file must have 2 lines (target / command)");
                        return 1;
                    }
                    // target format: "brave", "msedge", "chrome", or "brave:9223"
                    string rawTarget = lines[0].Trim();
                    string injCmd    = lines[1].Trim();
                    int injPort      = 9222;
                    string injBrowser = rawTarget;
                    int colonIdx = rawTarget.LastIndexOf(':');
                    if (colonIdx > 0)
                    {
                        string portPart = rawTarget.Substring(colonIdx + 1);
                        int parsedPort;
                        if (int.TryParse(portPart, out parsedPort))
                        {
                            injPort    = parsedPort;
                            injBrowser = rawTarget.Substring(0, colonIdx);
                        }
                    }
                    return ExecuteCommand(injBrowser, injCmd, injPort);
                }

                // ── Direct CLI invocation ───────────────────────────────────
                // Expected: BrowserWin.exe <browser[:port]> <{COMMAND:param}>
                if (args.Length < 2)
                {
                    Console.Error.WriteLine("ERROR: Expected: BrowserWin.exe <browser[:port]> <{COMMAND:param}>");
                    return 1;
                }

                // Parse optional port from target (e.g. "brave:9223")
                string targetBrowser = args[0];
                string command       = args[1];
                int    debugPort     = 9222;
                int    tColon        = targetBrowser.LastIndexOf(':');
                if (tColon > 0)
                {
                    string tp = targetBrowser.Substring(tColon + 1);
                    int tp2;
                    if (int.TryParse(tp, out tp2))
                    {
                        debugPort     = tp2;
                        targetBrowser = targetBrowser.Substring(0, tColon);
                    }
                }

                // --port flag overrides the colon syntax
                for (int i = 2; i < args.Length; i++)
                {
                    if (args[i] == "--port" && i + 1 < args.Length)
                    {
                        int.TryParse(args[i + 1], out debugPort);
                        i++;
                    }
                }

                return ExecuteCommand(targetBrowser, command, debugPort);
            }
            catch (Exception ex)
            {
                OutputError("Unhandled exception: " + ex.Message);
                return 2;
            }
        }

        // ──────────────────────────────────────────────────────────────────────
        //  Command dispatch
        // ──────────────────────────────────────────────────────────────────────

        /// <summary>
        /// Parses the "browser[:port]" target string and routes directly to
        /// ExecuteCommand — used as the Action&lt;string,string&gt; delegate by all
        /// transport listeners (stdin, HTTP, named-pipe).  Avoids the overhead
        /// of re-invoking Main() for every command in daemon mode.
        /// </summary>
        static void DispatchCommand(string target, string action)
        {
            string browser = target;
            int    port    = 9222;
            int    colon   = target.LastIndexOf(':');
            if (colon > 0)
            {
                string portStr = target.Substring(colon + 1);
                int    parsed;
                if (int.TryParse(portStr, out parsed))
                {
                    port    = parsed;
                    browser = target.Substring(0, colon);
                }
            }
            ExecuteCommand(browser, action, port);
        }

        static int ExecuteCommand(string browser, string command, int port)
        {
            string cmdType = DetermineCommandType(command);

            // Commands that never need CDP
            if (cmdType == "LISTBROWSERS") return CmdListBrowsers();
            if (cmdType == "KILL")         return CmdKill(browser);
            if (cmdType == "LISTWINDOWS")
            {
                Console.WriteLine(WinUtils.ListWindowsJson());
                return 0;
            }

            // LAUNCH: start browser with --remote-debugging-port (or detect existing).
            // Handles its own CDP/UIA logic internally.
            if (cmdType == "LAUNCH") return CmdLaunch(browser, ExtractParam(command, "LAUNCH"), port);

            // SENDKEYS / PAGESOURCE are UIA-only
            if (cmdType == "SENDKEYS" || cmdType == "PAGESOURCE")
                return ExecuteCommandUIA(browser, command);

            // For all other commands: try CDP first, fall back to UIA when no debug port
            string targetId;
            bool hasCdp = TryGetActiveTarget(port, out targetId);

            if (!hasCdp)
            {
                Console.Error.WriteLine("DEBUG: CDP unavailable on port " + port
                    + " — falling back to UIA window-message mode");
                return ExecuteCommandUIA(browser, command);
            }

            // CDP path
            switch (cmdType)
            {
                case "NAVIGATE":
                    return CmdNavigate(ExtractParam(command, "NAVIGATE"), port);

                case "QUERYTREE":
                    string depthStr = ExtractParam(command, "QUERYTREE");
                    int depth = string.IsNullOrEmpty(depthStr) ? 3 : int.Parse(depthStr);
                    return CmdQueryTree(port, depth);

                case "READ":
                    return CmdRead(port);

                case "CLICKID":
                    return CmdClickById(ExtractParam(command, "CLICKID"), port);

                case "CLICKNAME":
                    return CmdClickByText(ExtractParam(command, "CLICKNAME"), port);

                case "FILL":
                    return CmdFill(ExtractDoubleParam(command, "FILL"), port);

                case "READELEM":
                    return CmdReadElem(ExtractParam(command, "READELEM"), port);

                case "EXEC":
                    return CmdExec(ExtractParam(command, "EXEC"), port);

                case "SCREENSHOT":
                    return CmdScreenshot(ExtractParam(command, "SCREENSHOT"), port);

                case "NEWPAGE":
                    return CmdNewPage(ExtractParam(command, "NEWPAGE"), port);

                case "COOKIES":
                    return CmdCookies(ExtractParam(command, "COOKIES"), port);

                case "KEYDOWN":
                    return CmdKeyDown(ExtractParam(command, "KEYDOWN"), port);

                case "KEYUP":
                    return CmdKeyUp(ExtractParam(command, "KEYUP"), port);

                case "KEYPRESS":
                    return CmdKeyPress(ExtractParam(command, "KEYPRESS"), port);

                case "RIGHTCLICK":
                    return CmdRightClick(ExtractParam(command, "RIGHTCLICK"), port);

                case "DBLCLICK":
                    return CmdDblClick(ExtractParam(command, "DBLCLICK"), port);

                case "HOVER":
                    return CmdHover(ExtractParam(command, "HOVER"), port);

                case "CHECK":
                    return CmdCheck(ExtractParam(command, "CHECK"), port);

                case "UNCHECK":
                    return CmdUncheck(ExtractParam(command, "UNCHECK"), port);

                case "MOUSEDOWN":
                    return CmdMouseDown(ExtractParam(command, "MOUSEDOWN"), port);

                case "MOUSEUP":
                    return CmdMouseUp(ExtractParam(command, "MOUSEUP"), port);

                default:
                    OutputError("Unknown command: " + command);
                    return 1;
            }
        }

        // ──────────────────────────────────────────────────────────────────────
        //  UIA fallback  (no CDP debug port required)
        // ──────────────────────────────────────────────────────────────────────

        /// <summary>
        /// Execute a command by finding the browser window via its process name
        /// and using Windows UI Automation / Win32 messages — identical in spirit
        /// to KeyWin.exe.  This path works even when the browser is not started
        /// with --remote-debugging-port.
        /// </summary>
        static int ExecuteCommandUIA(string browser, string command)
        {
            // Locate the top-level browser window
            IntPtr hwnd = IntPtr.Zero;
            foreach (string pname in GetBrowserProcessNames(browser))
            {
                hwnd = WinUtils.FindWindowByProcessName(pname);
                if (hwnd != IntPtr.Zero) break;
            }

            if (hwnd == IntPtr.Zero)
            {
                return OutputError("uia_no_window: Cannot find a " + browser
                    + " window. Either the browser is not running, or launch it with"
                    + " --remote-debugging-port=<port> to enable CDP mode.");
            }

            Console.Error.WriteLine("DEBUG: UIA browser hwnd=" + hwnd);

            // Bring the window to the foreground so the user can see automation
            WinUtils.SetForegroundWindow(hwnd);
            Thread.Sleep(80);

            string cmdType = DetermineCommandType(command);

            switch (cmdType)
            {
                case "QUERYTREE":
                {
                    string ds = ExtractParam(command, "QUERYTREE");
                    int d = string.IsNullOrEmpty(ds) ? 3 : int.Parse(ds);
                    // QueryUITree already returns a complete JSON envelope
                    Console.WriteLine(WinUtils.QueryUITree(hwnd, d));
                    return 0;
                }

                case "READ":
                {
                    string text = WinUtils.ReadDisplayText(hwnd);
                    Console.WriteLine("{\"success\":" + (text != null ? "true" : "false")
                        + ",\"command\":\"READ\",\"mode\":\"uia\""
                        + ",\"value\":" + (text != null
                            ? "\"" + WinUtils.EscapeJson(text) + "\""
                            : "null") + "}");
                    return text != null ? 0 : 1;
                }

                case "SENDKEYS":
                {
                    // Strip optional {SENDKEYS:...} wrapper
                    string payload = ExtractParam(command, "SENDKEYS");
                    if (string.IsNullOrEmpty(payload)) payload = command;

                    // Prefer the Chromium render widget to receive keyboard input
                    IntPtr sendTarget = hwnd;
                    IntPtr renderHwnd = WinUtils.FindRenderWidgetHwnd(hwnd);
                    if (renderHwnd != IntPtr.Zero)
                    {
                        Console.Error.WriteLine("DEBUG: UIA SENDKEYS -> RenderWidget " + renderHwnd);
                        sendTarget = renderHwnd;
                    }
                    WinUtils.DirectSendKeys(sendTarget, payload);
                    Console.WriteLine("{\"success\":true,\"command\":\"SENDKEYS\",\"mode\":\"uia\"}");
                    return 0;
                }

                case "CLICKID":
                {
                    string selector = ExtractParam(command, "CLICKID");
                    var root = AutomationElement.FromHandle(hwnd);
                    // FocusOrClickElement tries InvokePattern first (buttons/links),
                    // then falls back to a real SendInput mouse click at the element centre
                    // — this correctly focuses Edit/ComboBox/etc. form inputs in browsers.
                    if (WinUtils.FocusOrClickElement(root, selector))
                    {
                        Console.WriteLine("{\"success\":true,\"command\":\"CLICKID\""
                            + ",\"mode\":\"uia\",\"selector\":\""
                            + WinUtils.EscapeJson(selector) + "\"}");
                        return 0;
                    }
                    return OutputError("uia_element_not_found: " + selector);
                }

                case "CLICKNAME":
                {
                    string name = ExtractParam(command, "CLICKNAME");
                    // Use FocusOrClickElement rather than ClickElementByName so that
                    // all control types (Edit, ComboBox, etc.) are matched — not only Buttons.
                    var root2 = AutomationElement.FromHandle(hwnd);
                    if (WinUtils.FocusOrClickElement(root2, name))
                    {
                        Console.WriteLine("{\"success\":true,\"command\":\"CLICKNAME\""
                            + ",\"mode\":\"uia\",\"name\":\""
                            + WinUtils.EscapeJson(name) + "\"}");
                        return 0;
                    }
                    return OutputError("uia_element_not_found: " + name);
                }

                case "NAVIGATE":
                {
                    // UIA navigation: Ctrl+L → focus address bar → type URL → Enter
                    string url = ExtractParam(command, "NAVIGATE");
                    if (string.IsNullOrEmpty(url))
                        return OutputError("NAVIGATE requires a URL parameter");
                    WinUtils.SetForegroundWindow(hwnd);
                    Thread.Sleep(150);
                    System.Windows.Forms.SendKeys.SendWait("^l");   // Ctrl+L
                    Thread.Sleep(300);
                    System.Windows.Forms.SendKeys.SendWait(
                        WinUtils.TranslateToSendKeys(url));
                    Thread.Sleep(100);
                    System.Windows.Forms.SendKeys.SendWait("{ENTER}");
                    Console.WriteLine("{\"success\":true,\"command\":\"NAVIGATE\""
                        + ",\"mode\":\"uia\""
                        + ",\"url\":\"" + WinUtils.EscapeJson(url) + "\"}");
                    return 0;
                }

                case "NEWPAGE":
                {
                    // UIA new-tab: Ctrl+T, optionally Ctrl+L + URL
                    WinUtils.SetForegroundWindow(hwnd);
                    Thread.Sleep(150);
                    System.Windows.Forms.SendKeys.SendWait("^t");   // Ctrl+T
                    Thread.Sleep(400);
                    string url = ExtractParam(command, "NEWPAGE");
                    if (!string.IsNullOrEmpty(url))
                    {
                        System.Windows.Forms.SendKeys.SendWait("^l");
                        Thread.Sleep(200);
                        System.Windows.Forms.SendKeys.SendWait(
                            WinUtils.TranslateToSendKeys(url));
                        Thread.Sleep(100);
                        System.Windows.Forms.SendKeys.SendWait("{ENTER}");
                    }
                    Console.WriteLine("{\"success\":true,\"command\":\"NEWPAGE\",\"mode\":\"uia\"}");
                    return 0;
                }

                case "READELEM":
                {
                    // Read the current value of a webpage form element by its HTML id
                    // (exposed as UIA AutomationId in Chromium browsers) or by Name.
                    string selector = ExtractParam(command, "READELEM");
                    if (string.IsNullOrEmpty(selector))
                        return OutputError("READELEM requires a selector: {READELEM:custname}");
                    var root = AutomationElement.FromHandle(hwnd);
                    string val = WinUtils.ReadElementValue(root, selector);
                    if (val == null)
                        return OutputError("uia_element_not_found: " + selector);
                    Console.WriteLine("{\"success\":true,\"command\":\"READELEM\",\"mode\":\"uia\""
                        + ",\"selector\":\"" + WinUtils.EscapeJson(selector) + "\""
                        + ",\"value\":\""  + WinUtils.EscapeJson(val)      + "\"}");
                    return 0;
                }

                case "FILL":
                {
                    // UIA fill: find element by id / name / label, set value via ValuePattern.
                    // Works in Firefox (full ARIA→UIA bridge) and Chrome/Brave with
                    // --force-renderer-accessibility.
                    string[] parts2 = ExtractDoubleParam(command, "FILL");
                    if (parts2 == null || parts2.Length < 2)
                        return OutputError("FILL requires selector:value — e.g. {FILL:custname:Alice}");
                    string fillSel = parts2[0];
                    string fillVal = string.Join(":", parts2, 1, parts2.Length - 1);
                    var fillRoot = AutomationElement.FromHandle(hwnd);
                    if (WinUtils.FillElement(fillRoot, fillSel, fillVal))
                    {
                        Console.WriteLine("{\"success\":true,\"command\":\"FILL\",\"mode\":\"uia\""
                            + ",\"selector\":\"" + WinUtils.EscapeJson(fillSel) + "\""
                            + ",\"value\":\""   + WinUtils.EscapeJson(fillVal) + "\"}");
                        return 0;
                    }
                    return OutputError("uia_element_not_found: " + fillSel
                        + " — browser may not expose this element via UIA."
                        + " Try --force-renderer-accessibility (Chromium) or --remote-debugging-port for CDP.");
                }

                case "KEYDOWN":
                {
                    string kdKey = ExtractParam(command, "KEYDOWN");
                    WinUtils.SetForegroundWindow(hwnd);
                    Thread.Sleep(80);
                    bool kdOk = WinUtils.SendRawKey(kdKey ?? "", false);
                    Console.WriteLine("{\"success\":" + (kdOk ? "true" : "false")
                        + ",\"command\":\"KEYDOWN\",\"key\":\""
                        + WinUtils.EscapeJson(kdKey ?? "") + "\",\"mode\":\"uia\"}");
                    return kdOk ? 0 : 1;
                }

                case "KEYUP":
                {
                    string kuKey = ExtractParam(command, "KEYUP");
                    WinUtils.SetForegroundWindow(hwnd);
                    Thread.Sleep(80);
                    bool kuOk = WinUtils.SendRawKey(kuKey ?? "", true);
                    Console.WriteLine("{\"success\":" + (kuOk ? "true" : "false")
                        + ",\"command\":\"KEYUP\",\"key\":\""
                        + WinUtils.EscapeJson(kuKey ?? "") + "\",\"mode\":\"uia\"}");
                    return kuOk ? 0 : 1;
                }

                case "KEYPRESS":
                {
                    string kpKey = ExtractParam(command, "KEYPRESS");
                    WinUtils.SetForegroundWindow(hwnd);
                    Thread.Sleep(80);
                    WinUtils.SendRawKey(kpKey ?? "", false);
                    Thread.Sleep(30);
                    WinUtils.SendRawKey(kpKey ?? "", true);
                    Console.WriteLine("{\"success\":true,\"command\":\"KEYPRESS\",\"key\":\""
                        + WinUtils.EscapeJson(kpKey ?? "") + "\",\"mode\":\"uia\"}");
                    return 0;
                }

                case "RIGHTCLICK":
                {
                    string rcCoords = ExtractParam(command, "RIGHTCLICK");
                    int? rcX = null; int? rcY = null;
                    if (!string.IsNullOrEmpty(rcCoords))
                    {
                        var rcp = rcCoords.Split(',');
                        int rx, ry;
                        if (rcp.Length == 2
                            && int.TryParse(rcp[0].Trim(), out rx)
                            && int.TryParse(rcp[1].Trim(), out ry))
                        { rcX = rx; rcY = ry; }
                    }
                    WinUtils.SendMouseRightClick(rcX, rcY);
                    Console.WriteLine("{\"success\":true,\"command\":\"RIGHTCLICK\",\"mode\":\"uia\"}");
                    return 0;
                }

                case "DBLCLICK":
                {
                    string dcCoords = ExtractParam(command, "DBLCLICK");
                    int? dcX = null; int? dcY = null;
                    if (!string.IsNullOrEmpty(dcCoords))
                    {
                        var dcp = dcCoords.Split(',');
                        int dx2, dy2;
                        if (dcp.Length == 2
                            && int.TryParse(dcp[0].Trim(), out dx2)
                            && int.TryParse(dcp[1].Trim(), out dy2))
                        { dcX = dx2; dcY = dy2; }
                    }
                    WinUtils.SendMouseDblClick(dcX, dcY);
                    Console.WriteLine("{\"success\":true,\"command\":\"DBLCLICK\",\"mode\":\"uia\"}");
                    return 0;
                }

                case "HOVER":
                {
                    string hvCoords = ExtractParam(command, "HOVER");
                    int hvX = 0; int hvY = 0;
                    if (!string.IsNullOrEmpty(hvCoords))
                    {
                        var hvp = hvCoords.Split(',');
                        int hx, hy;
                        if (hvp.Length == 2
                            && int.TryParse(hvp[0].Trim(), out hx)
                            && int.TryParse(hvp[1].Trim(), out hy))
                        { hvX = hx; hvY = hy; }
                    }
                    WinUtils.SendMouseHover(hvX, hvY);
                    Console.WriteLine("{\"success\":true,\"command\":\"HOVER\",\"mode\":\"uia\""
                        + ",\"x\":" + hvX + ",\"y\":" + hvY + "}");
                    return 0;
                }

                case "CHECK":
                {
                    string chSel = ExtractParam(command, "CHECK");
                    var chRoot = AutomationElement.FromHandle(hwnd);
                    bool chOk = WinUtils.ToggleElement(chRoot, chSel, true);
                    Console.WriteLine(chOk
                        ? "{\"success\":true,\"command\":\"CHECK\",\"mode\":\"uia\",\"selector\":\"" + JsonEscape(chSel) + "\"}"
                        : "{\"success\":false,\"command\":\"CHECK\",\"error\":\"toggle_failed\",\"selector\":\"" + JsonEscape(chSel) + "\"}");
                    return chOk ? 0 : 1;
                }

                case "UNCHECK":
                {
                    string uchSel = ExtractParam(command, "UNCHECK");
                    var uchRoot = AutomationElement.FromHandle(hwnd);
                    bool uchOk = WinUtils.ToggleElement(uchRoot, uchSel, false);
                    Console.WriteLine(uchOk
                        ? "{\"success\":true,\"command\":\"UNCHECK\",\"mode\":\"uia\",\"selector\":\"" + JsonEscape(uchSel) + "\"}"
                        : "{\"success\":false,\"command\":\"UNCHECK\",\"error\":\"toggle_failed\",\"selector\":\"" + JsonEscape(uchSel) + "\"}");
                    return uchOk ? 0 : 1;
                }

                case "MOUSEDOWN":
                {
                    string mdCoords = ExtractParam(command, "MOUSEDOWN");
                    int mdX = 0, mdY = 0;
                    if (!string.IsNullOrEmpty(mdCoords))
                    {
                        var mdp = mdCoords.Split(',');
                        int px, py;
                        if (mdp.Length == 2 && int.TryParse(mdp[0].Trim(), out px) && int.TryParse(mdp[1].Trim(), out py))
                        { mdX = px; mdY = py; }
                    }
                    WinUtils.SendMouseDown(mdX, mdY);
                    Console.WriteLine("{\"success\":true,\"command\":\"MOUSEDOWN\",\"mode\":\"uia\",\"x\":" + mdX + ",\"y\":" + mdY + "}");
                    return 0;
                }

                case "MOUSEUP":
                {
                    string muCoords = ExtractParam(command, "MOUSEUP");
                    int muX = 0, muY = 0;
                    if (!string.IsNullOrEmpty(muCoords))
                    {
                        var mup = muCoords.Split(',');
                        int px, py;
                        if (mup.Length == 2 && int.TryParse(mup[0].Trim(), out px) && int.TryParse(mup[1].Trim(), out py))
                        { muX = px; muY = py; }
                    }
                    WinUtils.SendMouseUp(muX, muY);
                    Console.WriteLine("{\"success\":true,\"command\":\"MOUSEUP\",\"mode\":\"uia\",\"x\":" + muX + ",\"y\":" + muY + "}");
                    return 0;
                }

                case "PAGESOURCE":
                {
                    // Retrieve raw HTML source without CDP:
                    //   Ctrl+U → view-source tab opens → Ctrl+A → Ctrl+C → clipboard → close tab
                    // Works on every browser with no debug port.
                    WinUtils.SetForegroundWindow(hwnd);
                    Thread.Sleep(150);
                    System.Windows.Forms.SendKeys.SendWait("^u");   // Ctrl+U
                    Thread.Sleep(1500);  // wait for view-source tab to load
                    System.Windows.Forms.SendKeys.SendWait("^a");   // Ctrl+A select all
                    Thread.Sleep(200);
                    System.Windows.Forms.SendKeys.SendWait("^c");   // Ctrl+C copy
                    Thread.Sleep(300);
                    string html = null;
                    try
                    {
                        var sta = new System.Threading.Thread(() =>
                        {
                            try { html = System.Windows.Forms.Clipboard.GetText(); } catch { }
                        });
                        sta.SetApartmentState(System.Threading.ApartmentState.STA);
                        sta.Start(); sta.Join(2000);
                    }
                    catch { }
                    // Close the view-source tab
                    System.Windows.Forms.SendKeys.SendWait("^w");
                    Thread.Sleep(200);
                    if (string.IsNullOrEmpty(html))
                        return OutputError("pagesource_empty: clipboard was empty after Ctrl+U/Ctrl+A/Ctrl+C");
                    Console.WriteLine("{\"success\":true,\"command\":\"PAGESOURCE\",\"mode\":\"uia\""
                        + ",\"length\":" + html.Length
                        + ",\"html\":\"" + WinUtils.EscapeJson(html.Length > 65536
                            ? html.Substring(0, 65536) + "...[truncated]"
                            : html) + "\"}");
                    return 0;
                }

                case "SCREENSHOT":
                    return OutputError("SCREENSHOT requires CDP mode. Start browser with --remote-debugging-port.");

                default:
                    return OutputError("Command '" + cmdType + "' is not available in UIA mode."
                        + " Start the browser with --remote-debugging-port=<port> to enable CDP mode.");
            }
        }

        /// <summary>
        /// Map a browser alias ("brave", "msedge", "chrome" …) to the list of
        /// process names that might host its main window.
        /// </summary>
        static string[] GetBrowserProcessNames(string browser)
        {
            switch (browser.ToLower())
            {
                case "brave":   return new[] { "brave" };
                case "msedge":  return new[] { "msedge", "MicrosoftEdge" };
                case "chrome":  return new[] { "chrome" };
                case "firefox": return new[] { "firefox" };
                case "opera":   return new[] { "opera" };
                default:        return new[] { browser };
            }
        }

        // ──────────────────────────────────────────────────────────────────────
        //  Command implementations
        // ──────────────────────────────────────────────────────────────────────

        // ──────────────────────────────────────────────────────────────────────
        //  LAUNCH — start a browser with --remote-debugging-port or reuse existing
        // ──────────────────────────────────────────────────────────────────────

        /// <summary>
        /// Launch a browser with --remote-debugging-port so that CDP commands work.
        /// If a CDP window for that browser is already reachable on any port in
        /// 9222..9229, return that port without spawning a new process.
        /// </summary>
        /// <param name="browser">Browser name: brave, chrome, msedge, firefox, opera…</param>
        /// <param name="mode">"visible" (default) | "headless"</param>
        /// <param name="preferredPort">Port hint from target string (e.g. brave:9222); 0 = auto</param>
        static int CmdLaunch(string browser, string mode, int preferredPort)
        {
            bool headless = (mode != null && mode.IndexOf("headless", StringComparison.OrdinalIgnoreCase) >= 0);

            // ── 1. Scan ports 9222-9229 for an already-running CDP window ──────
            int[] scanPorts = preferredPort > 0
                ? new[] { preferredPort }
                : new[] { 9222, 9223, 9224, 9225, 9226, 9227, 9228, 9229 };

            foreach (int p in scanPorts)
            {
                string existingId;
                if (TryGetActiveTarget(p, out existingId))
                {
                    // Verify the process on this port is actually our browser
                    string procName = GetBrowserProcessName(browser);
                    bool matchingProc = false;
                    try
                    {
                        // Check if any process named <browser> is listening on this port
                        // (heuristic: if CDP answers, assume it belongs to something the user intended)
                        matchingProc = Process.GetProcessesByName(procName).Length > 0;
                    }
                    catch { matchingProc = true; }

                    if (matchingProc)
                    {
                        Console.WriteLine("{\"success\":true,\"command\":\"LAUNCH\""
                            + ",\"browser\":\"" + WinUtils.EscapeJson(browser) + "\""
                            + ",\"port\":" + p
                            + ",\"reused\":true"
                            + ",\"mode\":\"cdp\"}");
                        return 0;
                    }
                }
            }

            // ── 2. Find browser executable ────────────────────────────────────
            string exePath = GetBrowserExePath(browser);
            if (exePath == null)
            {
                return OutputError("launch_not_found: Cannot find " + browser + " executable."
                    + " Install " + browser + " or add it to PATH."
                    + " Supported browsers: brave, chrome, msedge, firefox, opera.");
            }

            // ── 3. Pick a free port ───────────────────────────────────────────
            int launchPort = preferredPort > 0 ? preferredPort : 9222;
            // Bump port if already in use
            for (int attempt = 0; attempt < 8; attempt++)
            {
                string dummy;
                if (!TryGetActiveTarget(launchPort, out dummy)) break;
                launchPort++;
            }

            // ── 4. Build launch args ──────────────────────────────────────────
            string profileDir = System.IO.Path.Combine(
                System.IO.Path.GetTempPath(), "aiapi-" + browser.ToLower() + "-" + launchPort);

            string args;
            bool isFirefox = browser.IndexOf("firefox", StringComparison.OrdinalIgnoreCase) >= 0;
            if (isFirefox)
            {
                // Firefox uses --start-debugger-server <port> (no user-data-dir analogue;
                // use --profile for isolation)
                args = "--start-debugger-server " + launchPort
                     + " --profile \"" + profileDir + "\"";
                if (headless) args += " --headless";
                args += " about:blank";
            }
            else
            {
                // Chromium family
                args = "--remote-debugging-port=" + launchPort
                     + " --user-data-dir=\"" + profileDir + "\"";
                if (headless)
                    args += " --headless=new";
                else
                    args += " --no-first-run --no-default-browser-check";
                args += " about:blank";
            }

            // ── 5. Spawn process ──────────────────────────────────────────────
            Console.Error.WriteLine("DEBUG: Launching " + exePath + " " + args);
            try
            {
                var psi = new ProcessStartInfo(exePath, args)
                {
                    UseShellExecute = false,
                    CreateNoWindow  = headless,
                    WindowStyle     = headless
                        ? ProcessWindowStyle.Hidden
                        : ProcessWindowStyle.Normal
                };
                Process.Start(psi);
            }
            catch (Exception ex)
            {
                return OutputError("launch_spawn_failed: " + ex.Message + " (exe=" + exePath + ")");
            }

            // ── 6. Wait for CDP to become reachable (up to 8 s) ──────────────
            for (int i = 0; i < 32; i++)   // 32 × 250 ms = 8 s
            {
                Thread.Sleep(250);
                string newId;
                if (TryGetActiveTarget(launchPort, out newId))
                {
                    Console.WriteLine("{\"success\":true,\"command\":\"LAUNCH\""
                        + ",\"browser\":\"" + WinUtils.EscapeJson(browser) + "\""
                        + ",\"port\":" + launchPort
                        + ",\"reused\":false"
                        + ",\"headless\":" + (headless ? "true" : "false")
                        + ",\"exe\":\"" + WinUtils.EscapeJson(exePath) + "\""
                        + ",\"mode\":\"cdp\"}");
                    return 0;
                }
            }

            // Timed out — browser launched but CDP not ready (may still work for UIA)
            Console.WriteLine("{\"success\":false,\"command\":\"LAUNCH\""
                + ",\"browser\":\"" + WinUtils.EscapeJson(browser) + "\""
                + ",\"port\":" + launchPort
                + ",\"reused\":false"
                + ",\"headless\":" + (headless ? "true" : "false")
                + ",\"exe\":\"" + WinUtils.EscapeJson(exePath) + "\""
                + ",\"error\":\"cdp_timeout: browser started but CDP port not reachable after 8s."
                + " UIA commands (NAVIGATE/QUERYTREE/SENDKEYS) will still work."
                + " For CDP, ensure --remote-debugging-port flag was accepted.\"}");
            return 1;
        }

        /// <summary>
        /// Locate the main browser executable on the local machine.
        /// Checks PATH first, then well-known install directories.
        /// </summary>
        static string GetBrowserExePath(string browser)
        {
            // Normalise alias
            string b = browser.ToLower().Replace("-", "").Replace(" ", "");

            // Candidate exe names and search paths per browser
            string[] exeNames;
            string[] extraPaths;
            switch (b)
            {
                case "brave":
                    exeNames   = new[] { "brave.exe" };
                    extraPaths = new[]
                    {
                        System.IO.Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                            @"BraveSoftware\Brave-Browser\Application\brave.exe"),
                        @"C:\Program Files\BraveSoftware\Brave-Browser\Application\brave.exe",
                        @"C:\Program Files (x86)\BraveSoftware\Brave-Browser\Application\brave.exe"
                    };
                    break;
                case "chrome":
                    exeNames   = new[] { "chrome.exe" };
                    extraPaths = new[]
                    {
                        System.IO.Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                            @"Google\Chrome\Application\chrome.exe"),
                        @"C:\Program Files\Google\Chrome\Application\chrome.exe",
                        @"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"
                    };
                    break;
                case "msedge":
                case "edge":
                    exeNames   = new[] { "msedge.exe" };
                    extraPaths = new[]
                    {
                        System.IO.Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles),
                            @"Microsoft\Edge\Application\msedge.exe"),
                        System.IO.Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86),
                            @"Microsoft\Edge\Application\msedge.exe"),
                        System.IO.Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                            @"Microsoft\Edge\Application\msedge.exe")
                    };
                    break;
                case "firefox":
                    exeNames   = new[] { "firefox.exe" };
                    extraPaths = new[]
                    {
                        @"C:\Program Files\Mozilla Firefox\firefox.exe",
                        @"C:\Program Files (x86)\Mozilla Firefox\firefox.exe",
                        System.IO.Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                            @"Mozilla Firefox\firefox.exe")
                    };
                    break;
                case "opera":
                    exeNames   = new[] { "opera.exe", "launcher.exe" };
                    extraPaths = new[]
                    {
                        System.IO.Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                            @"Programs\Opera\opera.exe"),
                        System.IO.Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                            @"Programs\Opera GX\launcher.exe")
                    };
                    break;
                default:
                    exeNames   = new[] { browser + ".exe", browser };
                    extraPaths = new string[0];
                    break;
            }

            // 1. Check known install paths first (most reliable)
            foreach (string p in extraPaths)
                if (System.IO.File.Exists(p)) return p;

            // 2. Search PATH environment
            string pathEnv = Environment.GetEnvironmentVariable("PATH") ?? "";
            foreach (string dir in pathEnv.Split(';'))
            {
                foreach (string exeName in exeNames)
                {
                    try
                    {
                        string full = System.IO.Path.Combine(dir.Trim(), exeName);
                        if (System.IO.File.Exists(full)) return full;
                    }
                    catch { }
                }
            }

            // 3. Check if an already-running process tells us the path
            foreach (string exeName in exeNames)
            {
                string baseName = System.IO.Path.GetFileNameWithoutExtension(exeName);
                try
                {
                    var procs = Process.GetProcessesByName(baseName);
                    foreach (var pr in procs)
                    {
                        try
                        {
                            string ppath = pr.MainModule.FileName;
                            if (!string.IsNullOrEmpty(ppath) && System.IO.File.Exists(ppath))
                                return ppath;
                        }
                        catch { }
                    }
                }
                catch { }
            }

            return null;
        }

        /// <summary>Return the main process name for a browser alias.</summary>
        static string GetBrowserProcessName(string browser)
        {
            switch (browser.ToLower())
            {
                case "brave":  return "brave";
                case "chrome": return "chrome";
                case "msedge": case "edge": return "msedge";
                case "firefox": return "firefox";
                case "opera":  return "opera";
                default:       return browser.ToLower();
            }
        }

        /// <summary>List visible browser processes on this machine.</summary>
        static int CmdListBrowsers()
        {
            // Known Chromium-family process names
            string[] chromiumNames = { "chrome", "msedge", "brave", "chromium", "opera", "firefox" };

            // ── Step 1: collect main-window processes per browser family ──────
            var mainWindowByBrowser = new Dictionary<string, List<int[]>>();  // name->[pid,...]
            var mainTitleByBrowser  = new Dictionary<string, string>();
            var totalCounts = new Dictionary<string, int>();

            foreach (string name in chromiumNames)
            {
                Process[] procs = Process.GetProcessesByName(name);
                totalCounts[name] = procs.Length;
                if (procs.Length == 0) continue;
                mainWindowByBrowser[name] = new List<int[]>();
                foreach (var p in procs)
                {
                    try
                    {
                        string title = p.MainWindowTitle;
                        if (!string.IsNullOrWhiteSpace(title))
                        {
                            mainWindowByBrowser[name].Add(new[] { p.Id });
                            if (!mainTitleByBrowser.ContainsKey(name))
                                mainTitleByBrowser[name] = title;
                        }
                    }
                    catch { }
                }
            }

            // ── Step 2: probe CDP ports 9222-9230 ONCE (not per browser) ─────
            // Each port is probed at most once; we map port → page-title.
            var cdpPorts = new Dictionary<int, string>();   // port -> active page title
            foreach (int port in new[] { 9222, 9223, 9224, 9225, 9226, 9227, 9228, 9229 })
            {
                string pageTitle;
                if (TryGetActiveTargetTitle(port, out pageTitle))
                    cdpPorts[port] = pageTitle ?? "";
            }

            // ── Step 3: pair each active CDP port with a browser ─────────────
            // Strategy: try to identify which browser owns a port by checking
            // which running browser process matches the CDP target info.
            // Fallback: assign in discovery order from mainWindowByBrowser.
            var cdpEntries = new List<string[]>();          // [name, portStr, title]
            var usedBrowsers = new HashSet<string>();

            foreach (var kv in cdpPorts)
            {
                int port = kv.Key;
                string pageTitle = kv.Value;
                // Identify browser: check which browser process is listening on this port
                // Heuristic: return the first running browser not yet assigned a port
                string matched = null;
                foreach (string name in chromiumNames)
                {
                    if (mainWindowByBrowser.ContainsKey(name) && !usedBrowsers.Contains(name))
                    { matched = name; break; }
                }
                if (matched == null)
                {
                    // All have been assigned — still report the port with name=unknown
                    cdpEntries.Add(new[] { "browser.exe", port.ToString(), pageTitle });
                }
                else
                {
                    usedBrowsers.Add(matched);
                    cdpEntries.Add(new[] { matched + ".exe", port.ToString(), pageTitle });
                }
            }

            // ── Step 4: add UIA-only entries for running browsers without CDP ─
            foreach (string name in chromiumNames)
            {
                if (!mainWindowByBrowser.ContainsKey(name)) continue;
                if (usedBrowsers.Contains(name)) continue;
                string title = mainTitleByBrowser.ContainsKey(name) ? mainTitleByBrowser[name] : "";
                if (!string.IsNullOrEmpty(title) || mainWindowByBrowser[name].Count > 0)
                    cdpEntries.Add(new[] { name + ".exe", "", title });
            }

            // ── Step 5: serialise ─────────────────────────────────────────────
            var sb = new StringBuilder();
            sb.AppendLine("{");
            sb.AppendLine("  \"success\": true,");
            sb.AppendLine("  \"command\": \"LISTBROWSERS\",");
            sb.AppendLine("  \"browsers\": [");
            for (int i = 0; i < cdpEntries.Count; i++)
            {
                string portJson = string.IsNullOrEmpty(cdpEntries[i][1]) ? "null" : cdpEntries[i][1];
                sb.Append("    {\"name\":\"" + JsonEscape(cdpEntries[i][0]) + "\""
                        + ",\"cdpPort\":" + portJson
                        + ",\"title\":\"" + JsonEscape(cdpEntries[i][2]) + "\"}");
                if (i < cdpEntries.Count - 1) sb.Append(",");
                sb.AppendLine();
            }
            sb.AppendLine("  ]");
            sb.Append("  ,\"processCounts\": {");
            bool firstPc = true;
            foreach (var kv in totalCounts)
            {
                if (kv.Value == 0) continue;
                if (!firstPc) sb.Append(",");
                sb.Append("\"" + JsonEscape(kv.Key + ".exe") + "\":" + kv.Value);
                firstPc = false;
            }
            sb.AppendLine("}");
            sb.AppendLine("}");
            Console.WriteLine(sb.ToString());
            return 0;
        }

        /// <summary>
        /// Try to reach the CDP /json endpoint on the given port; if reachable,
        /// return the title of the first active page.
        /// </summary>
        static bool TryGetActiveTargetTitle(int port, out string title)
        {
            title = null;
            try
            {
                var tcp = new System.Net.Sockets.TcpClient();
                tcp.ReceiveTimeout = 1500;
                tcp.SendTimeout    = 1500;
                if (!tcp.ConnectAsync("127.0.0.1", port).Wait(300)) { tcp.Close(); return false; }
                var stream = tcp.GetStream();
                byte[] req = System.Text.Encoding.ASCII.GetBytes(
                    "GET /json HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n");
                stream.Write(req, 0, req.Length);
                var buf = new byte[32768];
                var sb2 = new StringBuilder();
                int totalRead = 0;
                int n;
                stream.ReadTimeout = 1500;
                try { while ((n = stream.Read(buf, 0, buf.Length)) > 0) { sb2.Append(System.Text.Encoding.UTF8.GetString(buf, 0, n)); totalRead += n; if (totalRead > 16000) break; } }
                catch { }
                tcp.Close();
                string body = sb2.ToString();
                int ti = body.IndexOf("\"title\"");
                if (ti < 0) { title = ""; return true; }
                int q1 = body.IndexOf('"', ti + 8);
                int q2 = q1 >= 0 ? body.IndexOf('"', q1 + 1) : -1;
                title = (q1 >= 0 && q2 > q1) ? body.Substring(q1 + 1, q2 - q1 - 1) : "";
                return true;
            }
            catch { return false; }
        }


        /// <summary>
        /// Navigate to a URL.  Requires Chrome running with --remote-debugging-port.
        /// </summary>
        static int CmdNavigate(string url, int port)
        {
            if (string.IsNullOrEmpty(url))
                return OutputError("NAVIGATE requires a URL parameter: {NAVIGATE:https://example.com}");

            // Fetch the active page target id from /json
            string targetId;
            if (!TryGetActiveTarget(port, out targetId))
                return OutputError("Cannot reach browser DevTools on port " + port +
                    ". Start Chrome/Edge with: --remote-debugging-port=" + port);

            // Send Page.navigate via a one-shot CDP HTTP endpoint
            // (Full WebSocket CDP would be used in a complete implementation.)
            string script = "window.location.href = '" + url.Replace("'", "\\'") + "';";
            string cdpResult = CdpRuntimeEvaluate(port, targetId, script);

            Console.WriteLine("{");
            Console.WriteLine("  \"success\": true,");
            Console.WriteLine("  \"command\": \"NAVIGATE\",");
            Console.WriteLine("  \"url\": \"" + JsonEscape(url) + "\",");
            Console.WriteLine("  \"cdpResponse\": " + (cdpResult ?? "null"));
            Console.WriteLine("}");
            return 0;
        }

        /// <summary>
        /// Query the page DOM tree via CDP, producing a node schema that is
        /// structurally identical to KeyWin.exe's QUERYTREE output so that the
        /// same MCP infrastructure (automationEngine, CLICKID, CLICKNAME, etc.)
        /// works unchanged for browser targets.
        ///
        /// Node shape (mirrors KeyWin/UIAutomation):
        ///   id        — element.id  (or "#idx" path when blank)
        ///   type      — tagName + optional input type  (e.g. "INPUT[text]")
        ///   name      — aria-label || visible text (≤80 chars) || placeholder || name attr
        ///   position  — getBoundingClientRect {x,y,width,height}
        ///   properties— {isEnabled, isOffscreen, cssSelector}
        ///   actions   — ["click"] / ["setValue","readValue"] / ["navigate"] etc.
        ///   children  — recursive, up to `depth` levels, up to 12 per node
        /// </summary>
        static int CmdQueryTree(int port, int depth)
        {
            string targetId;
            if (!TryGetActiveTarget(port, out targetId))
                return OutputError("Cannot reach browser DevTools on port " + port);

            string script = "(function(root,maxDepth){"
                // ── helpers ──
                + "function esc(s){return (s||'').replace(/\\\\/g,'\\\\\\\\').replace(/\"/g,'\\\\\"').replace(/\\n/g,'\\\\n').replace(/\\r/g,'');}" 
                + "function name(el){"
                +   "var a=el.getAttribute&&el.getAttribute('aria-label');"
                +   "if(a&&a.trim())return a.trim().substring(0,80);"
                +   "var t=(el.innerText||el.textContent||'').replace(/\\s+/g,' ').trim();"
                +   "if(t)return t.substring(0,80);"
                +   "return (el.placeholder||el.name||el.alt||el.title||'').substring(0,80);"
                + "}"
                + "function acts(el){"
                +   "var tag=el.tagName,tp=(el.type||'').toLowerCase(),r=[];"
                +   "if(tag==='A'||tag==='BUTTON'||el.onclick||el.getAttribute('role')==='button')r.push('click');"
                +   "if(tag==='INPUT'&&tp!=='submit'&&tp!=='button'&&tp!=='reset')r.push('setValue','readValue');"
                +   "if(tag==='TEXTAREA'||tag==='SELECT')r.push('setValue','readValue');"
                +   "if(tag==='A'&&el.href)r.push('navigate');"
                +   "if(tag==='FORM')r.push('submit');"
                +   "return r;"
                + "}"
                + "function sel(el,idx){"
                +   "if(el.id)return '#'+el.id;"
                +   "var p=el.parentElement,s=p?Array.prototype.indexOf.call(p.children,el):0;"
                +   "return el.tagName.toLowerCase()+':nth-child('+(s+1)+')';"
                + "}"
                + "function walk(el,depth,idx){"
                +   "if(!el||depth>maxDepth)return null;"
                +   "var tag=el.tagName||(el.nodeType===3?'TEXT':'NODE');"
                +   "var tp=(el.getAttribute&&el.getAttribute('type'))||'';"
                +   "var typeStr=tp?tag+'['+tp+']':tag;"
                +   "var r=el.getBoundingClientRect?el.getBoundingClientRect():{x:0,y:0,width:0,height:0};"
                +   "var disabled=el.disabled||el.getAttribute('aria-disabled')==='true';"
                +   "var offscreen=(r.width===0&&r.height===0)||r.top<-500||r.left<-500;"
                +   "var cssS=sel(el,idx);"
                +   "var o='{';"
                +   "o+='\"id\":\"'+esc(el.id||cssS)+'\",';"
                +   "o+='\"type\":\"'+esc(typeStr)+'\",';"
                +   "o+='\"name\":\"'+esc(name(el))+'\",';"
                +   "o+='\"position\":{\"x\":'+(r.x|0)+',\"y\":'+(r.y|0)+',\"width\":'+(r.width|0)+',\"height\":'+(r.height|0)+'},';"
                +   "o+='\"properties\":{\"isEnabled\":'+(!disabled)+',' +'\"isOffscreen\":'+offscreen+',\"cssSelector\":\"'+esc(cssS)+'\"},';"
                +   "var aa=acts(el);"
                +   "o+='\"actions\":['+aa.map(function(a){return'\"'+a+'\"';}).join(',')+']';"
                +   "if(el.value!==undefined&&el.value!=='')o+=',\"value\":\"'+esc(el.value)+'\"';"
                +   "if(depth<maxDepth){"
                +     "var kids=[],max=Math.min(el.children.length,12);"
                +     "for(var i=0;i<max;i++){var c=walk(el.children[i],depth+1,i);if(c)kids.push(c);}"
                +     "if(kids.length)o+=',\"children\":['+kids.join(',')+']';"
                +   "}"
                +   "return o+'}';"
                + "}"
                + "return walk(root.body||root.documentElement,0,0);"
                + "})(document," + depth + ");";


            string result = CdpRuntimeEvaluate(port, targetId, script);

            Console.WriteLine("{");
            Console.WriteLine("  \"success\": true,");
            Console.WriteLine("  \"command\": \"QUERYTREE\",");
            Console.WriteLine("  \"depth\": " + depth + ",");
            Console.WriteLine("  \"tree\": " + (result ?? "null"));
            Console.WriteLine("}");
            return 0;
        }

        /// <summary>Read current page title, URL and basic meta.</summary>
        static int CmdRead(int port)
        {
            string targetId;
            if (!TryGetActiveTarget(port, out targetId))
                return OutputError("Cannot reach browser DevTools on port " + port);

            string script = "JSON.stringify({title:document.title,url:location.href,"
                          + "description:(document.querySelector('meta[name=description]')||{}).content||''})";
            string result = CdpRuntimeEvaluate(port, targetId, script);

            Console.WriteLine("{");
            Console.WriteLine("  \"success\": true,");
            Console.WriteLine("  \"command\": \"READ\",");
            Console.WriteLine("  \"page\": " + (result ?? "null"));
            Console.WriteLine("}");
            return 0;
        }

        /// <summary>Click element matching CSS selector.</summary>
        static int CmdClickById(string selector, int port)
        {
            if (string.IsNullOrEmpty(selector))
                return OutputError("CLICKID requires a CSS selector: {CLICKID:#myButton}");

            string targetId;
            if (!TryGetActiveTarget(port, out targetId))
                return OutputError("Cannot reach browser DevTools on port " + port);

            string script = "(function(){"
                          + "var el=document.querySelector('" + selector.Replace("'","\\'") + "');"
                          + "if(!el)return JSON.stringify({found:false});"
                          + "el.click();"
                          + "return JSON.stringify({found:true,tag:el.tagName,id:el.id});"
                          + "})()";
            string result = CdpRuntimeEvaluate(port, targetId, script);

            Console.WriteLine("{");
            Console.WriteLine("  \"success\": true,");
            Console.WriteLine("  \"command\": \"CLICKID\",");
            Console.WriteLine("  \"selector\": \"" + JsonEscape(selector) + "\",");
            Console.WriteLine("  \"result\": " + (result ?? "null"));
            Console.WriteLine("}");
            return 0;
        }

        /// <summary>Click element whose text content matches the given string.</summary>
        static int CmdClickByText(string text, int port)
        {
            if (string.IsNullOrEmpty(text))
                return OutputError("CLICKNAME requires a text value: {CLICKNAME:Submit}");

            string targetId;
            if (!TryGetActiveTarget(port, out targetId))
                return OutputError("Cannot reach browser DevTools on port " + port);

            string safe = text.Replace("\\","\\\\").Replace("'","\\'");
            // Search order:
            // 1. Button/link/submit whose visible text matches
            // 2. Label whose text matches → click the associated input (htmlFor / .control)
            // 3. Any element with aria-label matching
            string script = "(function(){"
                          + "var t='" + safe + "';"
                          + "var all=document.querySelectorAll('button,a,input[type=submit],[role=button]');"
                          + "for(var i=0;i<all.length;i++){"
                          + "  if((all[i].innerText||all[i].value||'').trim()===t){"
                          + "    all[i].click();"
                          + "    return JSON.stringify({found:true,via:'text',tag:all[i].tagName});"
                          + "  }"
                          + "}"
                          + "var labels=[].slice.call(document.querySelectorAll('label'));"
                          + "for(var j=0;j<labels.length;j++){"
                          + "  if(labels[j].textContent.trim()===t||labels[j].textContent.trim().indexOf(t)>=0){"
                          + "    var f=labels[j].htmlFor;"
                          + "    var target=f?document.getElementById(f):labels[j].control;"
                          + "    if(target){target.focus();target.click();"
                          + "      return JSON.stringify({found:true,via:'label',tag:target.tagName,id:target.id});}"
                          + "  }"
                          + "}"
                          + "var aria=[].slice.call(document.querySelectorAll('[aria-label]'));"
                          + "for(var k=0;k<aria.length;k++){"
                          + "  if(aria[k].getAttribute('aria-label')===t){"
                          + "    aria[k].focus();aria[k].click();"
                          + "    return JSON.stringify({found:true,via:'aria-label',tag:aria[k].tagName});"
                          + "  }"
                          + "}"
                          + "return JSON.stringify({found:false});"
                          + "})()";
            string result = CdpRuntimeEvaluate(port, targetId, script);

            Console.WriteLine("{");
            Console.WriteLine("  \"success\": true,");
            Console.WriteLine("  \"command\": \"CLICKNAME\",");
            Console.WriteLine("  \"text\": \"" + JsonEscape(text) + "\",");
            Console.WriteLine("  \"result\": " + (result ?? "null"));
            Console.WriteLine("}");
            return 0;
        }

        /// <summary>Fill an input field — param format: "selector:value".</summary>
        static int CmdFill(string[] parts, int port)
        {
            if (parts == null || parts.Length < 2)
                return OutputError("FILL requires selector and value: {FILL:#email:user@example.com}");

            string selector = parts[0];
            string value    = string.Join(":", parts, 1, parts.Length - 1);

            string targetId;
            if (!TryGetActiveTarget(port, out targetId))
                return OutputError("Cannot reach browser DevTools on port " + port);

            string script = "(function(){"
                          + "var el=document.querySelector('" + selector.Replace("'","\\'") + "');"
                          + "if(!el)return JSON.stringify({found:false});"
                          + "el.value='" + value.Replace("\\","\\\\").Replace("'","\\'") + "';"
                          + "el.dispatchEvent(new Event('input',{bubbles:true}));"
                          + "el.dispatchEvent(new Event('change',{bubbles:true}));"
                          + "return JSON.stringify({found:true,tag:el.tagName});"
                          + "})()";
            string result = CdpRuntimeEvaluate(port, targetId, script);

            Console.WriteLine("{");
            Console.WriteLine("  \"success\": true,");
            Console.WriteLine("  \"command\": \"FILL\",");
            Console.WriteLine("  \"selector\": \"" + JsonEscape(selector) + "\",");
            Console.WriteLine("  \"result\": " + (result ?? "null"));
            Console.WriteLine("}");
            return 0;
        }

        /// <summary>
        /// Read the current value of a form element via CDP.
        /// Selector can be a CSS selector (#id, [name=x], input[type=email]) or a label text
        /// (resolved via querySelectorAll('label') → htmlFor lookup).
        /// </summary>
        static int CmdReadElem(string selector, int port)
        {
            if (string.IsNullOrEmpty(selector))
                return OutputError("READELEM requires a selector: {READELEM:#custname}");

            string targetId;
            if (!TryGetActiveTarget(port, out targetId))
                return OutputError("Cannot reach browser DevTools on port " + port);

            string safe = selector.Replace("\\","\\\\").Replace("'","\\'");
            // Try CSS selector first; fall back to label-text search
            string script = "(function(){"
                + "var el=document.querySelector('" + safe + "');"
                + "if(!el){"
                +   "var labels=[].slice.call(document.querySelectorAll('label'));"
                +   "for(var i=0;i<labels.length;i++){"
                +     "var t=labels[i].textContent.trim();"
                +     "if(t==='" + safe + "'||t.indexOf('" + safe + "')>=0){"
                +       "var f=labels[i].htmlFor;"
                +       "el=f?document.getElementById(f):labels[i].control;"
                +       "if(el)break;"
                +     "}"
                +   "}"
                + "}"
                + "if(!el)return JSON.stringify({found:false});"
                + "var v=el.value!==undefined?el.value:(el.textContent||el.innerText||'').trim();"
                + "return JSON.stringify({found:true,tag:el.tagName,id:el.id,name:el.name||'',value:v});"
                + "})()";

            string result = CdpRuntimeEvaluate(port, targetId, script);

            // Unwrap the inner JSON so success reflects whether the element was found
            bool found = result != null && result.Contains("\"found\":true");
            Console.WriteLine("{");
            Console.WriteLine("  \"success\": " + (found ? "true" : "false") + ",");
            Console.WriteLine("  \"command\": \"READELEM\",");
            Console.WriteLine("  \"selector\": \"" + JsonEscape(selector) + "\",");
            Console.WriteLine("  \"result\": " + (result ?? "null"));
            Console.WriteLine("}");
            return found ? 0 : 1;
        }

        /// <summary>Execute arbitrary JavaScript and return the stringified result.</summary>
        static int CmdExec(string script, int port)
        {
            if (string.IsNullOrEmpty(script))
                return OutputError("EXEC requires a JavaScript expression: {EXEC:document.title}");

            string targetId;
            if (!TryGetActiveTarget(port, out targetId))
                return OutputError("Cannot reach browser DevTools on port " + port);

            string result = CdpRuntimeEvaluate(port, targetId, script);

            Console.WriteLine("{");
            Console.WriteLine("  \"success\": true,");
            Console.WriteLine("  \"command\": \"EXEC\",");
            Console.WriteLine("  \"result\": " + (result ?? "null"));
            Console.WriteLine("}");
            return 0;
        }

        /// <summary>Take a screenshot using CDP Page.captureScreenshot — saves PNG to file.</summary>
        static int CmdScreenshot(string savePath, int port)
        {
            string targetId;
            if (!TryGetActiveTarget(port, out targetId))
                return OutputError("SCREENSHOT: cannot reach browser DevTools on port " + port
                    + ". Start browser with --remote-debugging-port or call {LAUNCH} first.");

            try
            {
                string wsPath = "/devtools/page/" + targetId;
                string host   = "127.0.0.1:" + port;

                using (var tcp = new TcpClient("127.0.0.1", port))
                using (var stream = tcp.GetStream())
                using (var writer = new StreamWriter(stream, new UTF8Encoding(false)) { AutoFlush = true })
                {
                    tcp.ReceiveTimeout = 20000;  // screenshots can be slow
                    tcp.SendTimeout    = 5000;

                    // ── 1. WebSocket upgrade handshake ──────────────────────────
                    string key = Convert.ToBase64String(Guid.NewGuid().ToByteArray());
                    writer.Write("GET " + wsPath + " HTTP/1.1\r\n");
                    writer.Write("Host: " + host + "\r\n");
                    writer.Write("Upgrade: websocket\r\n");
                    writer.Write("Connection: Upgrade\r\n");
                    writer.Write("Sec-WebSocket-Key: " + key + "\r\n");
                    writer.Write("Sec-WebSocket-Version: 13\r\n");
                    writer.Write("\r\n");

                    // Drain HTTP response headers
                    var hdrBuf = new byte[4096];
                    int hRead = 0;
                    while (hRead < hdrBuf.Length)
                    {
                        int n = stream.Read(hdrBuf, hRead, hdrBuf.Length - hRead);
                        if (n == 0) break;
                        hRead += n;
                        if (Encoding.ASCII.GetString(hdrBuf, 0, hRead).Contains("\r\n\r\n")) break;
                    }

                    // ── 2. Send Page.captureScreenshot ─────────────────────────
                    string cdpMsg = "{\"id\":1,\"method\":\"Page.captureScreenshot\","
                                  + "\"params\":{\"format\":\"png\"}}";
                    byte[] wsFrame = BuildWsFrame(Encoding.UTF8.GetBytes(cdpMsg));
                    stream.Write(wsFrame, 0, wsFrame.Length);

                    // ── 3. Read WS frame header (server never masks to client) ─
                    byte[] fhdr = new byte[10];
                    int fhRead = 0;
                    while (fhRead < 2)
                    {
                        int n = stream.Read(fhdr, fhRead, 2 - fhRead);
                        if (n == 0) break;
                        fhRead += n;
                    }

                    int rawLen = fhdr[1] & 0x7F;
                    long payloadLen;
                    if (rawLen < 126)
                    {
                        payloadLen = rawLen;
                    }
                    else if (rawLen == 126)
                    {
                        while (fhRead < 4) { int nn = stream.Read(fhdr, fhRead, 4 - fhRead); if (nn == 0) break; fhRead += nn; }
                        payloadLen = (fhdr[2] << 8) | fhdr[3];
                    }
                    else // 127
                    {
                        while (fhRead < 10) { int nn = stream.Read(fhdr, fhRead, 10 - fhRead); if (nn == 0) break; fhRead += nn; }
                        payloadLen = 0;
                        for (int i = 2; i < 10; i++) payloadLen = (payloadLen << 8) | fhdr[i];
                    }

                    const long MaxScreenshot = 32L * 1024 * 1024; // 32 MB sanity limit
                    if (payloadLen > MaxScreenshot)
                        return OutputError("SCREENSHOT: response too large (" + payloadLen + " bytes)");

                    // ── 4. Read payload bytes ──────────────────────────────────
                    byte[] payload = new byte[(int)payloadLen];
                    int pRead = 0;
                    while (pRead < (int)payloadLen)
                    {
                        int n = stream.Read(payload, pRead, (int)payloadLen - pRead);
                        if (n == 0) break;
                        pRead += n;
                    }

                    string responseJson = Encoding.UTF8.GetString(payload, 0, pRead);

                    // ── 5. Extract base64 "data" field ────────────────────────
                    var m = Regex.Match(responseJson, "\"data\"\\s*:\\s*\"([A-Za-z0-9+/=]+)\"");
                    if (!m.Success)
                    {
                        var errM = Regex.Match(responseJson, "\"message\"\\s*:\\s*\"([^\"]+)\"");
                        string hint = errM.Success ? errM.Groups[1].Value
                                                   : responseJson.Substring(0, Math.Min(200, responseJson.Length));
                        return OutputError("SCREENSHOT: browser returned no image data. " + hint);
                    }

                    byte[] pngBytes = Convert.FromBase64String(m.Groups[1].Value);

                    // ── 6. Save PNG ────────────────────────────────────────────
                    if (string.IsNullOrEmpty(savePath))
                        savePath = System.IO.Path.Combine(
                            System.IO.Path.GetTempPath(),
                            "aiapi_screenshot_" + DateTime.Now.ToString("yyyyMMdd_HHmmss") + ".png");

                    System.IO.File.WriteAllBytes(savePath, pngBytes);

                    Console.WriteLine("{\"success\":true,\"command\":\"SCREENSHOT\""
                        + ",\"file\":\"" + JsonEscape(savePath) + "\""
                        + ",\"size\":" + pngBytes.Length
                        + ",\"format\":\"png\"}");
                    return 0;
                }
            }
            catch (Exception ex)
            {
                return OutputError("SCREENSHOT failed: " + ex.Message);
            }
        }

        /// <summary>Open a new tab/page.</summary>
        static int CmdNewPage(string url, int port)
        {
            // CDP: /json/new?URL  — Chrome 69+ requires PUT; older builds accept GET.
            // We try PUT first, fall back to GET.
            string targetUrl = string.IsNullOrEmpty(url) ? "about:blank" : url;
            string endpoint   = "http://127.0.0.1:" + port + "/json/new?" + targetUrl;

            try
            {
                string newTargetJson = HttpPut(endpoint);
                if (newTargetJson == null)
                    newTargetJson = HttpGet(endpoint); // fallback for older builds

                Console.WriteLine("{");
                Console.WriteLine("  \"success\": " + (newTargetJson != null ? "true" : "false") + ",");
                Console.WriteLine("  \"command\": \"NEWPAGE\",");
                Console.WriteLine("  \"target\": " + (newTargetJson ?? "null"));
                Console.WriteLine("}");
                return newTargetJson != null ? 0 : 1;
            }
            catch (Exception ex)
            {
                return OutputError("NEWPAGE failed: " + ex.Message);
            }
        }

        /// <summary>Cookie management — param: "get", "clear", or "set:name=value;domain=...".</summary>
        static int CmdCookies(string action, int port)
        {
            if (string.IsNullOrEmpty(action))
                return OutputError("COOKIES requires an action: {COOKIES:get} | {COOKIES:clear}");

            string targetId;
            if (!TryGetActiveTarget(port, out targetId))
                return OutputError("Cannot reach browser DevTools on port " + port);

            string script;
            if (action.Equals("get", StringComparison.OrdinalIgnoreCase))
                script = "document.cookie";
            else if (action.Equals("clear", StringComparison.OrdinalIgnoreCase))
                script = "(function(){"
                       + "document.cookie.split(';').forEach(function(c){"
                       + "  var n=c.trim().split('=')[0];"
                       + "  document.cookie=n+'=;expires=Thu,01 Jan 1970 00:00:00 UTC;path=/';"
                       + "});"
                       + "return 'cleared';"
                       + "})()";
            else if (action.StartsWith("set:", StringComparison.OrdinalIgnoreCase))
            {
                string cookieVal = action.Substring(4);
                script = "document.cookie='" + cookieVal.Replace("'","\\'") + "'; 'set'";
            }
            else
                return OutputError("Unknown COOKIES action: " + action + ". Expected: get | clear | set:<name=value;...>");

            string result = CdpRuntimeEvaluate(port, targetId, script);

            Console.WriteLine("{");
            Console.WriteLine("  \"success\": true,");
            Console.WriteLine("  \"command\": \"COOKIES\",");
            Console.WriteLine("  \"action\": \"" + JsonEscape(action) + "\",");
            Console.WriteLine("  \"result\": " + (result ?? "null"));
            Console.WriteLine("}");
            return 0;
        }

        /// <summary>Terminate the target browser process.</summary>
        static int CmdKill(string browser)
        {
            string procName = browser;
            if (procName.EndsWith(".exe", StringComparison.OrdinalIgnoreCase))
                procName = procName.Substring(0, procName.Length - 4);

            Process[] procs = Process.GetProcessesByName(procName);
            if (procs.Length == 0)
            {
                Console.WriteLine("{");
                Console.WriteLine("  \"success\": false,");
                Console.WriteLine("  \"command\": \"KILL\",");
                Console.WriteLine("  \"error\": \"No process found: " + JsonEscape(browser) + "\"");
                Console.WriteLine("}");
                return 1;
            }

            int killed = 0;
            foreach (var p in procs)
            {
                try { p.Kill(); killed++; } catch { }
            }

            Console.WriteLine("{");
            Console.WriteLine("  \"success\": true,");
            Console.WriteLine("  \"command\": \"KILL\",");
            Console.WriteLine("  \"killed\": " + killed);
            Console.WriteLine("}");
            return 0;
        }

        // ──────────────────────────────────────────────────────────────────────
        //  Key + mouse input commands (CDP + UIA)
        // ──────────────────────────────────────────────────────────────────────

        // ── Generic CDP WebSocket command sender ───────────────────────────────

        /// <summary>
        /// Send any CDP command (e.g. Input.dispatchKeyEvent) using the same
        /// WebSocket transport as CdpRuntimeEvaluate.
        /// </summary>
        static string CdpSendCommand(int port, string targetId, string method, string paramsJson)
        {
            try
            {
                string wsPath = "/devtools/page/" + targetId;
                string host   = "127.0.0.1:" + port;
                using (var tcp = new TcpClient("127.0.0.1", port))
                using (var stream = tcp.GetStream())
                using (var writer = new StreamWriter(stream, new UTF8Encoding(false)) { AutoFlush = true })
                {
                    tcp.ReceiveTimeout = 5000;
                    tcp.SendTimeout    = 5000;
                    string key = Convert.ToBase64String(Guid.NewGuid().ToByteArray());
                    writer.Write("GET " + wsPath + " HTTP/1.1\r\n");
                    writer.Write("Host: " + host + "\r\n");
                    writer.Write("Upgrade: websocket\r\n");
                    writer.Write("Connection: Upgrade\r\n");
                    writer.Write("Sec-WebSocket-Key: " + key + "\r\n");
                    writer.Write("Sec-WebSocket-Version: 13\r\n");
                    writer.Write("\r\n");
                    byte[] hdr = new byte[4096];
                    int hRead  = 0;
                    try
                    {
                        while (hRead < hdr.Length)
                        {
                            int n = stream.Read(hdr, hRead, hdr.Length - hRead);
                            if (n == 0) break;
                            hRead += n;
                            if (Encoding.ASCII.GetString(hdr, 0, hRead).Contains("\r\n\r\n")) break;
                        }
                    }
                    catch (System.IO.IOException) { return "timeout"; }

                    string cdpMsg  = "{\"id\":1,\"method\":\"" + method + "\",\"params\":{" + paramsJson + "}}";
                    byte[] pl      = Encoding.UTF8.GetBytes(cdpMsg);
                    byte[] framed  = BuildWsFrame(pl);
                    stream.Write(framed, 0, framed.Length);

                    tcp.ReceiveTimeout = 3000;
                    byte[] buf = new byte[16384];
                    int bRead  = 0;
                    try
                    {
                        while (bRead < buf.Length)
                        {
                            int n = stream.Read(buf, bRead, buf.Length - bRead);
                            if (n == 0) break;
                            bRead += n;
                            if (bRead >= 2)
                            {
                                int payLen2 = buf[1] & 0x7F;
                                if (payLen2 < 126 && bRead >= 2 + payLen2) break;
                                if (payLen2 == 126 && bRead >= 4)
                                { int l16 = (buf[2] << 8) | buf[3]; if (bRead >= 4 + l16) break; }
                            }
                        }
                    }
                    catch (System.IO.IOException) { /* timeout ok — short ack */ }

                    return DecodeWsFrame(buf, bRead) ?? "ok";
                }
            }
            catch (Exception ex) { return "error: " + JsonEscape(ex.Message); }
        }

        // ── Key resolution for CDP Input.dispatchKeyEvent ─────────────────────

        static void ResolveKeyForCdp(string keyName,
            out int vkCode, out string keyStr, out string codeStr, out int modBit)
        {
            modBit = 0;
            keyName = (keyName ?? "").ToUpper().Trim();
            switch (keyName)
            {
                case "CTRL": case "CONTROL":
                    vkCode = 17; keyStr = "Control"; codeStr = "ControlLeft"; modBit = 2; break;
                case "ALT": case "MENU":
                    vkCode = 18; keyStr = "Alt";     codeStr = "AltLeft";     modBit = 1; break;
                case "SHIFT":
                    vkCode = 16; keyStr = "Shift";   codeStr = "ShiftLeft";   modBit = 8; break;
                case "WIN": case "LWIN":
                    vkCode = 91; keyStr = "Meta";    codeStr = "MetaLeft";    modBit = 4; break;
                case "ENTER": case "RETURN":
                    vkCode = 13; keyStr = "Enter";     codeStr = "Enter";     break;
                case "TAB":
                    vkCode = 9;  keyStr = "Tab";       codeStr = "Tab";       break;
                case "ESC": case "ESCAPE":
                    vkCode = 27; keyStr = "Escape";    codeStr = "Escape";    break;
                case "BACK": case "BACKSPACE":
                    vkCode = 8;  keyStr = "Backspace"; codeStr = "Backspace"; break;
                case "DELETE": case "DEL":
                    vkCode = 46; keyStr = "Delete";    codeStr = "Delete";    break;
                case "HOME":
                    vkCode = 36; keyStr = "Home";      codeStr = "Home";      break;
                case "END":
                    vkCode = 35; keyStr = "End";       codeStr = "End";       break;
                case "PAGEUP": case "PGUP":
                    vkCode = 33; keyStr = "PageUp";    codeStr = "PageUp";    break;
                case "PAGEDOWN": case "PGDN":
                    vkCode = 34; keyStr = "PageDown";  codeStr = "PageDown";  break;
                case "INSERT": case "INS":
                    vkCode = 45; keyStr = "Insert";    codeStr = "Insert";    break;
                case "LEFT":
                    vkCode = 37; keyStr = "ArrowLeft";  codeStr = "ArrowLeft";  break;
                case "UP":
                    vkCode = 38; keyStr = "ArrowUp";    codeStr = "ArrowUp";    break;
                case "RIGHT":
                    vkCode = 39; keyStr = "ArrowRight"; codeStr = "ArrowRight"; break;
                case "DOWN":
                    vkCode = 40; keyStr = "ArrowDown";  codeStr = "ArrowDown";  break;
                case "APPS": case "CONTEXT":
                    vkCode = 93; keyStr = "ContextMenu"; codeStr = "ContextMenu"; break;
                case "F1":  vkCode = 112; keyStr = "F1";  codeStr = "F1";  break;
                case "F2":  vkCode = 113; keyStr = "F2";  codeStr = "F2";  break;
                case "F3":  vkCode = 114; keyStr = "F3";  codeStr = "F3";  break;
                case "F4":  vkCode = 115; keyStr = "F4";  codeStr = "F4";  break;
                case "F5":  vkCode = 116; keyStr = "F5";  codeStr = "F5";  break;
                case "F6":  vkCode = 117; keyStr = "F6";  codeStr = "F6";  break;
                case "F7":  vkCode = 118; keyStr = "F7";  codeStr = "F7";  break;
                case "F8":  vkCode = 119; keyStr = "F8";  codeStr = "F8";  break;
                case "F9":  vkCode = 120; keyStr = "F9";  codeStr = "F9";  break;
                case "F10": vkCode = 121; keyStr = "F10"; codeStr = "F10"; break;
                case "F11": vkCode = 122; keyStr = "F11"; codeStr = "F11"; break;
                case "F12": vkCode = 123; keyStr = "F12"; codeStr = "F12"; break;
                default:
                    if (keyName.Length == 1)
                    {
                        char cc = char.ToUpper(keyName[0]);
                        vkCode  = (int)cc;
                        keyStr  = keyName;
                        codeStr = "Key" + cc;
                    }
                    else
                    {
                        vkCode  = 0;
                        keyStr  = keyName;
                        codeStr = keyName;
                    }
                    break;
            }
        }

        // ── Key/mouse command implementations ─────────────────────────────────

        static int CmdKeyDown(string key, int port)
        {
            if (string.IsNullOrEmpty(key))
                return OutputError("KEYDOWN requires a key name: {KEYDOWN:Ctrl}");
            string targetId;
            bool hasCdp = TryGetActiveTarget(port, out targetId);
            if (hasCdp)
            {
                int vk; string ks; string cs; int mb;
                ResolveKeyForCdp(key, out vk, out ks, out cs, out mb);
                string p = "\"type\":\"keyDown\",\"key\":\"" + JsonEscape(ks)
                    + "\",\"code\":\"" + JsonEscape(cs)
                    + "\",\"windowsVirtualKeyCode\":" + vk
                    + ",\"modifiers\":" + mb;
                CdpSendCommand(port, targetId, "Input.dispatchKeyEvent", p);
                Console.WriteLine("{\"success\":true,\"command\":\"KEYDOWN\",\"key\":\""
                    + JsonEscape(key) + "\",\"mode\":\"cdp\"}");
            }
            else
            {
                bool ok = WinUtils.SendRawKey(key, false);
                Console.WriteLine("{\"success\":" + (ok ? "true" : "false")
                    + ",\"command\":\"KEYDOWN\",\"key\":\""
                    + JsonEscape(key) + "\",\"mode\":\"uia\"}");
            }
            return 0;
        }

        static int CmdKeyUp(string key, int port)
        {
            if (string.IsNullOrEmpty(key))
                return OutputError("KEYUP requires a key name: {KEYUP:Ctrl}");
            string targetId;
            bool hasCdp = TryGetActiveTarget(port, out targetId);
            if (hasCdp)
            {
                int vk; string ks; string cs; int mb;
                ResolveKeyForCdp(key, out vk, out ks, out cs, out mb);
                string p = "\"type\":\"keyUp\",\"key\":\"" + JsonEscape(ks)
                    + "\",\"code\":\"" + JsonEscape(cs)
                    + "\",\"windowsVirtualKeyCode\":" + vk
                    + ",\"modifiers\":0";
                CdpSendCommand(port, targetId, "Input.dispatchKeyEvent", p);
                Console.WriteLine("{\"success\":true,\"command\":\"KEYUP\",\"key\":\""
                    + JsonEscape(key) + "\",\"mode\":\"cdp\"}");
            }
            else
            {
                bool ok = WinUtils.SendRawKey(key, true);
                Console.WriteLine("{\"success\":" + (ok ? "true" : "false")
                    + ",\"command\":\"KEYUP\",\"key\":\""
                    + JsonEscape(key) + "\",\"mode\":\"uia\"}");
            }
            return 0;
        }

        static int CmdKeyPress(string key, int port)
        {
            if (string.IsNullOrEmpty(key))
                return OutputError("KEYPRESS requires a key name: {KEYPRESS:F5}");
            string targetId;
            bool hasCdp = TryGetActiveTarget(port, out targetId);
            if (hasCdp)
            {
                int vk; string ks; string cs; int mb;
                ResolveKeyForCdp(key, out vk, out ks, out cs, out mb);
                string pDown = "\"type\":\"keyDown\",\"key\":\"" + JsonEscape(ks)
                    + "\",\"code\":\"" + JsonEscape(cs)
                    + "\",\"windowsVirtualKeyCode\":" + vk
                    + ",\"modifiers\":" + mb;
                string pUp   = "\"type\":\"keyUp\",\"key\":\"" + JsonEscape(ks)
                    + "\",\"code\":\"" + JsonEscape(cs)
                    + "\",\"windowsVirtualKeyCode\":" + vk
                    + ",\"modifiers\":0";
                CdpSendCommand(port, targetId, "Input.dispatchKeyEvent", pDown);
                Thread.Sleep(30);
                CdpSendCommand(port, targetId, "Input.dispatchKeyEvent", pUp);
                Console.WriteLine("{\"success\":true,\"command\":\"KEYPRESS\",\"key\":\""
                    + JsonEscape(key) + "\",\"mode\":\"cdp\"}");
            }
            else
            {
                WinUtils.SendRawKey(key, false);
                Thread.Sleep(30);
                WinUtils.SendRawKey(key, true);
                Console.WriteLine("{\"success\":true,\"command\":\"KEYPRESS\",\"key\":\""
                    + JsonEscape(key) + "\",\"mode\":\"uia\"}");
            }
            return 0;
        }

        static int CmdRightClick(string coords, int port)
        {
            int cx = 0; int cy = 0; bool hasCoords = false;
            if (!string.IsNullOrEmpty(coords))
            {
                var cp = coords.Split(',');
                int px, py;
                if (cp.Length == 2
                    && int.TryParse(cp[0].Trim(), out px)
                    && int.TryParse(cp[1].Trim(), out py))
                { cx = px; cy = py; hasCoords = true; }
            }
            string targetId;
            bool hasCdp = TryGetActiveTarget(port, out targetId);
            if (hasCdp)
            {
                string pDown = "\"type\":\"mousePressed\",\"button\":\"right\",\"clickCount\":1"
                    + (hasCoords ? ",\"x\":" + cx + ",\"y\":" + cy : "");
                string pUp   = "\"type\":\"mouseReleased\",\"button\":\"right\",\"clickCount\":1"
                    + (hasCoords ? ",\"x\":" + cx + ",\"y\":" + cy : "");
                CdpSendCommand(port, targetId, "Input.dispatchMouseEvent", pDown);
                Thread.Sleep(30);
                CdpSendCommand(port, targetId, "Input.dispatchMouseEvent", pUp);
                Console.WriteLine("{\"success\":true,\"command\":\"RIGHTCLICK\",\"mode\":\"cdp\"}");
            }
            else
            {
                WinUtils.SendMouseRightClick(hasCoords ? (int?)cx : null, hasCoords ? (int?)cy : null);
                Console.WriteLine("{\"success\":true,\"command\":\"RIGHTCLICK\",\"mode\":\"uia\"}");
            }
            return 0;
        }

        static int CmdDblClick(string coords, int port)
        {
            int cx = 0; int cy = 0; bool hasCoords = false;
            if (!string.IsNullOrEmpty(coords))
            {
                var cp = coords.Split(',');
                int px, py;
                if (cp.Length == 2
                    && int.TryParse(cp[0].Trim(), out px)
                    && int.TryParse(cp[1].Trim(), out py))
                { cx = px; cy = py; hasCoords = true; }
            }
            string targetId;
            bool hasCdp = TryGetActiveTarget(port, out targetId);
            if (hasCdp)
            {
                string pDown = "\"type\":\"mousePressed\",\"button\":\"left\",\"clickCount\":2"
                    + (hasCoords ? ",\"x\":" + cx + ",\"y\":" + cy : "");
                string pUp   = "\"type\":\"mouseReleased\",\"button\":\"left\",\"clickCount\":2"
                    + (hasCoords ? ",\"x\":" + cx + ",\"y\":" + cy : "");
                CdpSendCommand(port, targetId, "Input.dispatchMouseEvent", pDown);
                Thread.Sleep(50);
                CdpSendCommand(port, targetId, "Input.dispatchMouseEvent", pUp);
                Console.WriteLine("{\"success\":true,\"command\":\"DBLCLICK\",\"mode\":\"cdp\"}");
            }
            else
            {
                WinUtils.SendMouseDblClick(hasCoords ? (int?)cx : null, hasCoords ? (int?)cy : null);
                Console.WriteLine("{\"success\":true,\"command\":\"DBLCLICK\",\"mode\":\"uia\"}");
            }
            return 0;
        }

        static int CmdHover(string coords, int port)
        {
            int cx = 0; int cy = 0;
            if (!string.IsNullOrEmpty(coords))
            {
                var cp = coords.Split(',');
                int px, py;
                if (cp.Length == 2
                    && int.TryParse(cp[0].Trim(), out px)
                    && int.TryParse(cp[1].Trim(), out py))
                { cx = px; cy = py; }
            }
            string targetId;
            bool hasCdp = TryGetActiveTarget(port, out targetId);
            if (hasCdp)
            {
                string p = "\"type\":\"mouseMoved\",\"x\":" + cx + ",\"y\":" + cy;
                CdpSendCommand(port, targetId, "Input.dispatchMouseEvent", p);
                Console.WriteLine("{\"success\":true,\"command\":\"HOVER\",\"mode\":\"cdp\""
                    + ",\"x\":" + cx + ",\"y\":" + cy + "}");
            }
            else
            {
                WinUtils.SendMouseHover(cx, cy);
                Console.WriteLine("{\"success\":true,\"command\":\"HOVER\",\"mode\":\"uia\""
                    + ",\"x\":" + cx + ",\"y\":" + cy + "}");
            }
            return 0;
        }

        static int CmdCheck(string selector, int port)   { return CmdSetChecked(selector, true,  port); }
        static int CmdUncheck(string selector, int port) { return CmdSetChecked(selector, false, port); }

        static int CmdSetChecked(string selector, bool doCheck, int port)
        {
            if (string.IsNullOrEmpty(selector))
                return OutputError((doCheck ? "CHECK" : "UNCHECK") + " requires a selector: {CHECK:#agree}");
            string targetId;
            bool hasCdp = TryGetActiveTarget(port, out targetId);
            string cmd = doCheck ? "CHECK" : "UNCHECK";
            if (hasCdp)
            {
                string safe = selector.Replace("\\", "\\\\").Replace("'", "\\'");
                string js = "(function(){var el=document.querySelector('" + safe + "');"
                    + "if(!el)return JSON.stringify({found:false});"
                    + "el.checked=" + (doCheck ? "true" : "false") + ";"
                    + "el.dispatchEvent(new Event('change',{bubbles:true}));"
                    + "return JSON.stringify({found:true,tag:el.tagName,checked:el.checked});"
                    + "})()";
                string result = CdpRuntimeEvaluate(port, targetId, js);
                bool found = result != null && result.Contains("\"found\":true");
                Console.WriteLine("{\"success\":" + (found ? "true" : "false") + ",\"command\":\"" + cmd
                    + "\",\"mode\":\"cdp\",\"selector\":\"" + JsonEscape(selector)
                    + "\",\"result\":" + (result != null ? result : "null") + "}");
                return found ? 0 : 1;
            }
            Console.WriteLine("{\"success\":false,\"command\":\"" + cmd
                + "\",\"error\":\"no_cdp\",\"selector\":\"" + JsonEscape(selector) + "\"}");
            return 1;
        }

        static int CmdMouseDown(string coords, int port)
        {
            int cx = 0, cy = 0;
            if (!string.IsNullOrEmpty(coords))
            {
                var cp = coords.Split(',');
                int px, py;
                if (cp.Length == 2 && int.TryParse(cp[0].Trim(), out px) && int.TryParse(cp[1].Trim(), out py))
                { cx = px; cy = py; }
            }
            string targetId;
            bool hasCdp = TryGetActiveTarget(port, out targetId);
            if (hasCdp)
            {
                string p = "\"type\":\"mousePressed\",\"button\":\"left\",\"x\":" + cx + ",\"y\":" + cy + ",\"clickCount\":1";
                CdpSendCommand(port, targetId, "Input.dispatchMouseEvent", p);
                Console.WriteLine("{\"success\":true,\"command\":\"MOUSEDOWN\",\"mode\":\"cdp\",\"x\":" + cx + ",\"y\":" + cy + "}");
            }
            else
            {
                WinUtils.SendMouseDown(cx, cy);
                Console.WriteLine("{\"success\":true,\"command\":\"MOUSEDOWN\",\"mode\":\"uia\",\"x\":" + cx + ",\"y\":" + cy + "}");
            }
            return 0;
        }

        static int CmdMouseUp(string coords, int port)
        {
            int cx = 0, cy = 0;
            if (!string.IsNullOrEmpty(coords))
            {
                var cp = coords.Split(',');
                int px, py;
                if (cp.Length == 2 && int.TryParse(cp[0].Trim(), out px) && int.TryParse(cp[1].Trim(), out py))
                { cx = px; cy = py; }
            }
            string targetId;
            bool hasCdp = TryGetActiveTarget(port, out targetId);
            if (hasCdp)
            {
                string p = "\"type\":\"mouseReleased\",\"button\":\"left\",\"x\":" + cx + ",\"y\":" + cy + ",\"clickCount\":1";
                CdpSendCommand(port, targetId, "Input.dispatchMouseEvent", p);
                Console.WriteLine("{\"success\":true,\"command\":\"MOUSEUP\",\"mode\":\"cdp\",\"x\":" + cx + ",\"y\":" + cy + "}");
            }
            else
            {
                WinUtils.SendMouseUp(cx, cy);
                Console.WriteLine("{\"success\":true,\"command\":\"MOUSEUP\",\"mode\":\"uia\",\"x\":" + cx + ",\"y\":" + cy + "}");
            }
            return 0;
        }

        // ──────────────────────────────────────────────────────────────────────
        //  CDP helpers  (HTTP-based — no WebSocket dependency for .NET 4.5)
        // ──────────────────────────────────────────────────────────────────────

        /// <summary>
        /// Retrieve the first visible page target id from the CDP HTTP endpoint.
        /// </summary>
        static bool TryGetActiveTarget(int port, out string targetId)
        {
            targetId = null;
            try
            {
                string json = HttpGet("http://127.0.0.1:" + port + "/json");
                if (json == null) return false;

                // Very lightweight regex parse — no System.Text.Json in .NET 4.5
                // Look for first "page" type target and extract its id
                var match = Regex.Match(json,
                    "\"type\"\\s*:\\s*\"page\"[^}]*\"id\"\\s*:\\s*\"([^\"]+)\"",
                    RegexOptions.Singleline);
                if (!match.Success)
                {
                    // Try reversed field order
                    match = Regex.Match(json,
                        "\"id\"\\s*:\\s*\"([^\"]+)\"[^}]*\"type\"\\s*:\\s*\"page\"",
                        RegexOptions.Singleline);
                }
                if (!match.Success) return false;

                targetId = match.Groups[1].Value;
                return true;
            }
            catch
            {
                return false;
            }
        }

        /// <summary>
        /// Evaluate a JavaScript expression in the active page using CDP's
        /// Runtime.evaluate HTTP-tunneling endpoint (/json/runtime/evaluate is
        /// NOT standard; we use the WebSocket JSON-RPC protocol encoded as a
        /// GET to /json/... for eval-only calls via the devtools "protocol" helper).
        ///
        /// In Chrome 69+ the recommended approach is a WebSocket CDP session.
        /// This implementation uses a simple synchronous TCP write/read to the
        /// WebSocket upgrade endpoint — enough for short eval calls.
        /// </summary>
        static string CdpRuntimeEvaluate(int port, string targetId, string script)
        {
            try
            {
                // Build a minimal WebSocket upgrade + CDP JSON-RPC request
                // Chrome accepts this for simple single-message exchanges
                string wsPath = "/devtools/page/" + targetId;
                string host   = "127.0.0.1:" + port;

                using (var tcp = new TcpClient("127.0.0.1", port))
                using (var stream = tcp.GetStream())
                using (var writer = new StreamWriter(stream, new UTF8Encoding(false)) { AutoFlush = true })
                {
                    // Set receive/send timeouts BEFORE any I/O so we never hang
                    // indefinitely if the browser is mid-navigation or unresponsive.
                    tcp.ReceiveTimeout = 5000;
                    tcp.SendTimeout    = 5000;

                    // HTTP upgrade handshake
                    string key = Convert.ToBase64String(
                        Guid.NewGuid().ToByteArray());
                    writer.Write("GET " + wsPath + " HTTP/1.1\r\n");
                    writer.Write("Host: " + host + "\r\n");
                    writer.Write("Upgrade: websocket\r\n");
                    writer.Write("Connection: Upgrade\r\n");
                    writer.Write("Sec-WebSocket-Key: " + key + "\r\n");
                    writer.Write("Sec-WebSocket-Version: 13\r\n");
                    writer.Write("\r\n");

                    // Read until end of HTTP headers (5 s timeout already set above)
                    byte[] buf = new byte[4096];
                    int totalRead = 0;
                    try
                    {
                        while (true)
                        {
                            int n = stream.Read(buf, totalRead, buf.Length - totalRead);
                            if (n == 0) break;
                            totalRead += n;
                            string so = Encoding.ASCII.GetString(buf, 0, totalRead);
                            if (so.Contains("\r\n\r\n")) break;
                        }
                    }
                    catch (System.IO.IOException)
                    {
                        Console.Error.WriteLine("CDP header read timeout on port " + port);
                        return "\"cdp-timeout: header read timed out\"";
                    }

                    // Send CDP Runtime.evaluate frame (WebSocket text frame, unmasked for loopback)
                    string cdpMsg = "{\"id\":1,\"method\":\"Runtime.evaluate\","
                                  + "\"params\":{\"expression\":\""
                                  + script.Replace("\\","\\\\").Replace("\"","\\\"").Replace("\n","\\n")
                                  + "\",\"returnByValue\":true}}";

                    byte[] payload  = Encoding.UTF8.GetBytes(cdpMsg);
                    byte[] wsFrame  = BuildWsFrame(payload);
                    stream.Write(wsFrame, 0, wsFrame.Length);

                    // Read response frame (5s timeout; large buffer for QUERYTREE/READ)
                    tcp.ReceiveTimeout = 5000;
                    byte[] respBuf = new byte[524288]; // 512 KB
                    int respRead = 0;
                    try
                    {
                        while (respRead < respBuf.Length)
                        {
                            int n = stream.Read(respBuf, respRead, respBuf.Length - respRead);
                            if (n == 0) break;
                            respRead += n;
                            // Check if we have a complete WS text frame
                            if (respRead >= 2)
                            {
                    int payLen = respBuf[1] & 0x7F;
                                if (payLen < 126 && respRead >= 2 + payLen) break;
                                if (payLen == 126 && respRead >= 4)
                                {
                                    int len16 = (respBuf[2] << 8) | respBuf[3];
                                    if (respRead >= 4 + len16) break;
                                }
                            }
                        }
                    }
                    catch (System.IO.IOException) { /* timeout — partial is ok */ }

                    // Decode WebSocket frame payload
                    string rawResp = DecodeWsFrame(respBuf, respRead);
                    if (rawResp == null)
                    {
                        Console.Error.WriteLine("CDP decode error: respRead=" + respRead +
                            " (check browser has --remote-debugging-port and WS masking is correct)");
                        return null;
                    }

                    // Extract .result.result.value from {"id":1,"result":{"result":{"type":"string","value":"..."}}}
                    var valueMatch = Regex.Match(rawResp,
                        "\"result\"\\s*:\\s*\\{[^}]*\"value\"\\s*:\\s*(\"(?:[^\"\\\\]|\\\\.)*\"|\\d+|true|false|null|\\{[^}]*\\}|\\[[^\\]]*\\])");
                    return valueMatch.Success ? valueMatch.Groups[1].Value : rawResp;
                }
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine("CDP eval error: " + ex.Message);
                return "\"cdp-error: " + JsonEscape(ex.Message) + "\"";
            }
        }

        // ── WebSocket frame helpers ─────────────────────────────────────────

        static byte[] BuildWsFrame(byte[] payload)
        {
            // FIN=1, opcode=1 (text), mask=1
            // RFC 6455 §5.3: client MUST mask ALL frames sent to server.
            // Chrome immediately closes the connection on unmasked client frames.
            int len = payload.Length;
            byte[] maskKey = new byte[4];
            new Random().NextBytes(maskKey);

            byte[] header;
            if (len < 126)
            {
                header = new byte[] { 0x81, (byte)(0x80 | len),
                    maskKey[0], maskKey[1], maskKey[2], maskKey[3] };
            }
            else if (len < 65536)
            {
                header = new byte[] { 0x81, (byte)(0x80 | 126),
                    (byte)(len >> 8), (byte)(len & 0xFF),
                    maskKey[0], maskKey[1], maskKey[2], maskKey[3] };
            }
            else
            {
                header = new byte[] { 0x81, (byte)(0x80 | 127),
                    0, 0, 0, 0,
                    (byte)(len >> 24), (byte)(len >> 16), (byte)(len >> 8), (byte)len,
                    maskKey[0], maskKey[1], maskKey[2], maskKey[3] };
            }

            // XOR payload with the 4-byte mask
            byte[] maskedPayload = new byte[len];
            for (int i = 0; i < len; i++)
                maskedPayload[i] = (byte)(payload[i] ^ maskKey[i % 4]);

            byte[] frame = new byte[header.Length + len];
            Buffer.BlockCopy(header, 0, frame, 0, header.Length);
            Buffer.BlockCopy(maskedPayload, 0, frame, header.Length, len);
            return frame;
        }

        static string DecodeWsFrame(byte[] buf, int totalRead)
        {
            if (totalRead < 2) return null;
            // byte 0: FIN+opcode  byte 1: MASK(bit7) + payload length
            bool masked = (buf[1] & 0x80) != 0;
            int payloadLen = buf[1] & 0x7F;
            int offset = 2;
            if (payloadLen == 126)
            {
                if (totalRead < 4) return null;
                payloadLen = (buf[2] << 8) | buf[3];
                offset = 4;
            }
            else if (payloadLen == 127)
            {
                if (totalRead < 10) return null;
                payloadLen = (int)(((uint)buf[6] << 24) | ((uint)buf[7] << 16) | ((uint)buf[8] << 8) | (uint)buf[9]);
                offset = 10;
            }

            if (masked)
            {
                if (totalRead < offset + 4 + payloadLen) return null;
                byte[] mask = new byte[] { buf[offset], buf[offset+1], buf[offset+2], buf[offset+3] };
                offset += 4;
                byte[] data2 = new byte[payloadLen];
                for (int i = 0; i < payloadLen; i++)
                    data2[i] = (byte)(buf[offset + i] ^ mask[i % 4]);
                return Encoding.UTF8.GetString(data2);
            }
            else
            {
                if (totalRead < offset + payloadLen) return null;
                return Encoding.UTF8.GetString(buf, offset, payloadLen);
            }
        }

        // ── HTTP helpers ───────────────────────────────────────────────────

        static string HttpGet(string url)
        {
            try
            {
                var req = (HttpWebRequest)WebRequest.Create(url);
                req.Timeout      = 3000;
                req.UserAgent    = "BrowserWin/1.0";
                using (var resp   = (HttpWebResponse)req.GetResponse())
                using (var reader = new StreamReader(resp.GetResponseStream(), Encoding.UTF8))
                    return reader.ReadToEnd();
            }
            catch { return null; }
        }

        static string HttpPut(string url)
        {
            try
            {
                var req         = (HttpWebRequest)WebRequest.Create(url);
                req.Method      = "PUT";
                req.Timeout     = 3000;
                req.UserAgent   = "BrowserWin/1.0";
                req.ContentType = "application/json";
                req.ContentLength = 0;
                using (var resp   = (HttpWebResponse)req.GetResponse())
                using (var reader = new StreamReader(resp.GetResponseStream(), Encoding.UTF8))
                    return reader.ReadToEnd();
            }
            catch { return null; }
        }

        // ──────────────────────────────────────────────────────────────────────
        //  Argument parsing helpers (same {COMMAND:param} format as KeyWin)
        // ──────────────────────────────────────────────────────────────────────

        static string DetermineCommandType(string cmd)
        {
            if (string.IsNullOrEmpty(cmd)) return "UNKNOWN";

            if (cmd.Equals("{LISTBROWSERS}",  StringComparison.OrdinalIgnoreCase)) return "LISTBROWSERS";
            if (cmd.Equals("{LISTWINDOWS}",   StringComparison.OrdinalIgnoreCase)) return "LISTWINDOWS";
            if (cmd.Equals("{READ}",          StringComparison.OrdinalIgnoreCase)) return "READ";
            if (cmd.Equals("{KILL}",          StringComparison.OrdinalIgnoreCase)) return "KILL";
            if (cmd.Equals("{SCREENSHOT}",    StringComparison.OrdinalIgnoreCase)) return "SCREENSHOT";
            if (cmd.Equals("{NEWPAGE}",       StringComparison.OrdinalIgnoreCase)) return "NEWPAGE";
            if (cmd.Equals("{QUERYTREE}",     StringComparison.OrdinalIgnoreCase)) return "QUERYTREE";

            if (Regex.IsMatch(cmd, @"^\{NAVIGATE:",   RegexOptions.IgnoreCase)) return "NAVIGATE";
            if (Regex.IsMatch(cmd, @"^\{QUERYTREE:",  RegexOptions.IgnoreCase)) return "QUERYTREE";
            if (Regex.IsMatch(cmd, @"^\{CLICKID:",    RegexOptions.IgnoreCase)) return "CLICKID";
            if (Regex.IsMatch(cmd, @"^\{CLICKNAME:",  RegexOptions.IgnoreCase)) return "CLICKNAME";
            if (Regex.IsMatch(cmd, @"^\{FILL:",       RegexOptions.IgnoreCase)) return "FILL";
            if (Regex.IsMatch(cmd, @"^\{EXEC:",       RegexOptions.IgnoreCase)) return "EXEC";
            if (Regex.IsMatch(cmd, @"^\{SCREENSHOT:", RegexOptions.IgnoreCase)) return "SCREENSHOT";
            if (Regex.IsMatch(cmd, @"^\{NEWPAGE:",    RegexOptions.IgnoreCase)) return "NEWPAGE";
            if (Regex.IsMatch(cmd, @"^\{COOKIES:",    RegexOptions.IgnoreCase)) return "COOKIES";
            if (Regex.IsMatch(cmd, @"^\{SENDKEYS:",   RegexOptions.IgnoreCase)) return "SENDKEYS";
            if (cmd.Equals("{READELEM}",    StringComparison.OrdinalIgnoreCase)) return "READELEM";
            if (Regex.IsMatch(cmd, @"^\{READELEM:",   RegexOptions.IgnoreCase)) return "READELEM";
            if (cmd.Equals("{PAGESOURCE}",  StringComparison.OrdinalIgnoreCase)) return "PAGESOURCE";
            if (cmd.Equals("{LAUNCH}",      StringComparison.OrdinalIgnoreCase)) return "LAUNCH";
            if (Regex.IsMatch(cmd, @"^\{LAUNCH:",     RegexOptions.IgnoreCase)) return "LAUNCH";

            if (Regex.IsMatch(cmd, @"^\{KEYDOWN:",    RegexOptions.IgnoreCase)) return "KEYDOWN";
            if (Regex.IsMatch(cmd, @"^\{KEYUP:",      RegexOptions.IgnoreCase)) return "KEYUP";
            if (Regex.IsMatch(cmd, @"^\{KEYPRESS:",   RegexOptions.IgnoreCase)) return "KEYPRESS";
            if (Regex.IsMatch(cmd, @"^\{RIGHTCLICK:", RegexOptions.IgnoreCase)) return "RIGHTCLICK";
            if (Regex.IsMatch(cmd, @"^\{DBLCLICK:",   RegexOptions.IgnoreCase)) return "DBLCLICK";
            if (Regex.IsMatch(cmd, @"^\{HOVER:",      RegexOptions.IgnoreCase)) return "HOVER";
            if (Regex.IsMatch(cmd, @"^\{CHECK:",      RegexOptions.IgnoreCase)) return "CHECK";
            if (Regex.IsMatch(cmd, @"^\{UNCHECK:",    RegexOptions.IgnoreCase)) return "UNCHECK";
            if (Regex.IsMatch(cmd, @"^\{MOUSEDOWN:",  RegexOptions.IgnoreCase)) return "MOUSEDOWN";
            if (Regex.IsMatch(cmd, @"^\{MOUSEUP:",    RegexOptions.IgnoreCase)) return "MOUSEUP";

            return "UNKNOWN";
        }

        static string ExtractParam(string cmd, string command)
        {
            var m = Regex.Match(cmd, @"\{" + command + @":(.+?)\}$", RegexOptions.IgnoreCase);
            return m.Success ? m.Groups[1].Value : null;
        }

        /// <summary>Return param split on the first colon after the command name.</summary>
        static string[] ExtractDoubleParam(string cmd, string command)
        {
            string raw = ExtractParam(cmd, command);
            if (raw == null) return null;
            int idx = raw.IndexOf(':');
            if (idx < 0) return new[] { raw };
            return new[] { raw.Substring(0, idx), raw.Substring(idx + 1) };
        }

        // ──────────────────────────────────────────────────────────────────────
        //  Output helpers
        // ──────────────────────────────────────────────────────────────────────

        static int OutputError(string message)
        {
            Console.WriteLine("{");
            Console.WriteLine("  \"success\": false,");
            Console.WriteLine("  \"error\": \"" + WinUtils.EscapeJson(message) + "\"");
            Console.WriteLine("}");
            return 1;
        }

        // JsonEscape kept as thin alias for backwards-compat with remaining call sites
        static string JsonEscape(string s) { return WinUtils.EscapeJson(s); }

        // ──────────────────────────────────────────────────────────────────────
        //  API Schema
        // ──────────────────────────────────────────────────────────────────────

        static string GetApiSchema()
        {
            var sb = new StringBuilder();
            sb.AppendLine("{");
            sb.AppendLine("  \"helper\": \"BrowserWin.exe\",");
            sb.AppendLine("  \"version\": \"1.2.0\",");
            sb.AppendLine("  \"description\": \"Browser automation via Chrome DevTools Protocol (CDP).\\n    Window mode: MULTI-SESSION - the browser holds many tabs/pages.\\n    Workflow: LISTBROWSERS -> LAUNCH (if needed) -> NEWPAGE -> NAVIGATE -> READ/QUERYTREE -> interact.\\n    Reuse the existing browser window and open a NEWPAGE instead of relaunching.\\n    Teardown policy (default: leave_open): leave_open (default), discard_tab (EXEC:window.close()), close_app (KILL).\\n    Requires browser started with --remote-debugging-port=<port>. Call LAUNCH to start with debug port automatically.\",");
            sb.AppendLine("  \"targetDescription\": \"Browser + CDP port: 'brave:9222', 'msedge:9223', 'chrome:9224'. First call LISTBROWSERS to see what is running. Default port 9222.\",");
            sb.AppendLine("  \"protocol\": \"CDP\",");
            sb.AppendLine("  \"defaultDebugPort\": 9222,");
            sb.AppendLine("  \"commands\": [");

            sb.AppendLine("    { \"name\": \"LISTBROWSERS\", \"description\": \"List all running Chromium-family browser processes (Chrome, Edge, Brave, Opera)\", \"parameters\": [], \"examples\": [\"{LISTBROWSERS}\"] },");
            sb.AppendLine("    { \"name\": \"LAUNCH\", \"description\": \"Start a browser with --remote-debugging-port so CDP commands work, or reuse an existing debug window."
                + " target='brave'/'chrome'/'msedge'/'firefox'. Optional mode param: 'visible' (default) or 'headless'."
                + " Returns port number and whether it was reused or newly launched."
                + " Call this FIRST if NEWPAGE/NAVIGATE/FILL/EXEC return CDP errors.\","
                + " \"parameters\": [ { \"name\": \"mode\", \"type\": \"string\", \"required\": false, \"default\": \"visible\","
                + "   \"enum\": [\"visible\", \"headless\"] } ], \"examples\": [\"{LAUNCH}\", \"{LAUNCH:visible}\", \"{LAUNCH:headless}\"] },");
            sb.AppendLine("    { \"name\": \"NAVIGATE\", \"description\": \"Navigate the active page to a URL\", \"parameters\": [ { \"name\": \"url\", \"type\": \"string\", \"required\": true } ], \"examples\": [\"{NAVIGATE:https://example.com}\"] },");
            sb.AppendLine("    { \"name\": \"READ\", \"description\": \"Read the current page title, URL and meta-description\", \"parameters\": [], \"examples\": [\"{READ}\"] },");
            sb.AppendLine("    { \"name\": \"QUERYTREE\", \"description\": \"Query the DOM tree up to the specified depth (default 3)\", \"parameters\": [ { \"name\": \"depth\", \"type\": \"integer\", \"required\": false, \"default\": 3 } ], \"examples\": [\"{QUERYTREE}\", \"{QUERYTREE:5}\"] },");
            sb.AppendLine("    { \"name\": \"CLICKID\", \"description\": \"Click a DOM element matching a CSS selector\", \"parameters\": [ { \"name\": \"selector\", \"type\": \"string\", \"required\": true } ], \"examples\": [\"{CLICKID:#submitBtn}\", \"{CLICKID:.login-button}\"] },");
            sb.AppendLine("    { \"name\": \"CLICKNAME\", \"description\": \"Click a button/link whose visible text matches the given string\", \"parameters\": [ { \"name\": \"text\", \"type\": \"string\", \"required\": true } ], \"examples\": [\"{CLICKNAME:Log in}\", \"{CLICKNAME:Accept all}\"] },");
            sb.AppendLine("    { \"name\": \"FILL\", \"description\": \"Set the value of an input field. Format: selector:value\", \"parameters\": [ { \"name\": \"selector\", \"type\": \"string\", \"required\": true }, { \"name\": \"value\", \"type\": \"string\", \"required\": true } ], \"examples\": [\"{FILL:#email:user@example.com}\", \"{FILL:input[name=q]:search term}\"] },");
            sb.AppendLine("    { \"name\": \"EXEC\", \"description\": \"Evaluate a JavaScript expression and return its string result\", \"parameters\": [ { \"name\": \"script\", \"type\": \"string\", \"required\": true } ], \"examples\": [\"{EXEC:document.title}\", \"{EXEC:window.scrollY}\"] },");
            sb.AppendLine("    { \"name\": \"READELEM\", \"description\": \"Read the visible text or value of a specific DOM element via CSS selector (CDP) or UIA fallback.\", \"parameters\": [ { \"name\": \"selector\", \"type\": \"string\", \"required\": true } ], \"examples\": [\"{READELEM:#result}\", \"{READELEM:input[name=total]}\"] },");
            sb.AppendLine("    { \"name\": \"SENDKEYS\", \"description\": \"Send keyboard input to the browser window (UIA). Supports special keys: {ENTER}, {TAB}, {ESC}, {CTRL+C}, etc.\", \"parameters\": [ { \"name\": \"keys\", \"type\": \"string\", \"required\": true } ], \"examples\": [\"{SENDKEYS:hello world}\", \"{SENDKEYS:{CTRL+A}{CTRL+C}}\"] },");
            sb.AppendLine("    { \"name\": \"PAGESOURCE\", \"description\": \"Retrieve the raw HTML source of the current page via Ctrl+U/Ctrl+A/Ctrl+C clipboard trick (UIA; works on every browser, no debug port required).\", \"parameters\": [], \"examples\": [\"{PAGESOURCE}\"] },");
            sb.AppendLine("    { \"name\": \"SCREENSHOT\", \"description\": \"Capture a PNG screenshot of the current browser page via CDP Page.captureScreenshot. Optional parameter: file path to save (default: %TEMP%\\\\aiapi_screenshot_<timestamp>.png). Returns the saved file path and byte size.\", \"parameters\": [ { \"name\": \"path\", \"type\": \"string\", \"required\": false } ], \"examples\": [\"{SCREENSHOT}\", \"{SCREENSHOT:C:\\\\Users\\\\me\\\\shot.png}\"] },");
            sb.AppendLine("    { \"name\": \"NEWPAGE\", \"description\": \"Open a new browser tab; optionally navigate it to a URL\", \"parameters\": [ { \"name\": \"url\", \"type\": \"string\", \"required\": false } ], \"examples\": [\"{NEWPAGE}\", \"{NEWPAGE:https://example.com}\"] },");
            sb.AppendLine("    { \"name\": \"COOKIES\", \"description\": \"Manage browser cookies. Actions: get | clear | set:<name=value;domain=...>\", \"parameters\": [ { \"name\": \"action\", \"type\": \"string\", \"required\": true } ], \"examples\": [\"{COOKIES:get}\", \"{COOKIES:clear}\", \"{COOKIES:set:SOCS=accept}\"] },");
            sb.AppendLine("    { \"name\": \"KILL\", \"description\": \"Terminate the target browser process\", \"parameters\": [], \"examples\": [\"{KILL}\"]} ,");
            sb.AppendLine("    { \"name\": \"KEYDOWN\", \"description\": \"Hold a modifier key down via CDP Input.dispatchKeyEvent (or SendInput UIA fallback). Use with KEYUP to build chords. Param: Ctrl | Alt | Shift | Win.\", \"parameters\": [ { \"name\": \"key\", \"type\": \"string\", \"required\": true } ], \"examples\": [\"{KEYDOWN:Ctrl}\", \"{KEYDOWN:Alt}\"] },");
            sb.AppendLine("    { \"name\": \"KEYUP\", \"description\": \"Release a held modifier key. Always pair with a prior KEYDOWN for the same key.\", \"parameters\": [ { \"name\": \"key\", \"type\": \"string\", \"required\": true } ], \"examples\": [\"{KEYUP:Ctrl}\", \"{KEYUP:Alt}\"] },");
            sb.AppendLine("    { \"name\": \"KEYPRESS\", \"description\": \"Atomic keydown+keyup for function or navigation keys. Supported: F1-F12, HOME, END, PAGEUP, PAGEDOWN, INSERT, DELETE, ENTER, TAB, ESC, BACK, LEFT, RIGHT, UP, DOWN, APPS.\", \"parameters\": [ { \"name\": \"key\", \"type\": \"string\", \"required\": true } ], \"examples\": [\"{KEYPRESS:F5}\", \"{KEYPRESS:HOME}\"] },");
            sb.AppendLine("    { \"name\": \"RIGHTCLICK\", \"description\": \"Right-click at screen coordinates via CDP Input.dispatchMouseEvent (or SendInput UIA fallback). Param: x,y.\", \"parameters\": [ { \"name\": \"coords\", \"type\": \"string\", \"required\": true } ], \"examples\": [\"{RIGHTCLICK:320,240}\"] },");
            sb.AppendLine("    { \"name\": \"DBLCLICK\", \"description\": \"Double left-click at screen coordinates via CDP Input.dispatchMouseEvent (or SendInput UIA fallback). Param: x,y.\", \"parameters\": [ { \"name\": \"coords\", \"type\": \"string\", \"required\": true } ], \"examples\": [\"{DBLCLICK:320,240}\"] },");
            sb.AppendLine("    { \"name\": \"HOVER\", \"description\": \"Move the cursor to screen coordinates without clicking, via CDP Input.dispatchMouseEvent (or SetCursorPos UIA fallback). Param: x,y.\", \"parameters\": [ { \"name\": \"coords\", \"type\": \"string\", \"required\": true } ], \"examples\": [\"{HOVER:320,240}\"] },");
            sb.AppendLine("    { \"name\": \"CHECK\", \"description\": \"Check a checkbox by CSS selector (CDP JS el.checked=true + change event). Falls back to UIA TogglePattern when no CDP.\", \"parameters\": [ { \"name\": \"selector\", \"type\": \"string\", \"required\": true } ], \"examples\": [\"{CHECK:#agreeTerms}\", \"{CHECK:input[name=subscribe]}\"] },");
            sb.AppendLine("    { \"name\": \"UNCHECK\", \"description\": \"Uncheck a checkbox by CSS selector (CDP JS el.checked=false + change event). Falls back to UIA TogglePattern when no CDP.\", \"parameters\": [ { \"name\": \"selector\", \"type\": \"string\", \"required\": true } ], \"examples\": [\"{UNCHECK:#newsletter}\"] },");
            sb.AppendLine("    { \"name\": \"MOUSEDOWN\", \"description\": \"Press and hold left mouse button at screen coordinates (x,y) via CDP Input.dispatchMouseEvent (or SendInput UIA fallback). Use with MOUSEUP for drag operations.\", \"parameters\": [ { \"name\": \"coords\", \"type\": \"string\", \"required\": true } ], \"examples\": [\"{MOUSEDOWN:100,200}\"] },");
            sb.AppendLine("    { \"name\": \"MOUSEUP\", \"description\": \"Release left mouse button at screen coordinates (x,y) via CDP Input.dispatchMouseEvent (or SendInput UIA fallback). Completes a drag started with MOUSEDOWN.\", \"parameters\": [ { \"name\": \"coords\", \"type\": \"string\", \"required\": true } ], \"examples\": [\"{MOUSEUP:300,400}\"] }");
            sb.AppendLine("  ]");
            sb.AppendLine("}");
            return sb.ToString();
        }

        static void OutputApiSchema() { Console.WriteLine(GetApiSchema()); }
    }
}
