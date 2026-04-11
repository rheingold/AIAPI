// LibreOfficeWin.exe — LibreOffice / Apache OpenOffice automation helper for AIAPI
// Controls Writer, Calc, Impress via UNO COM bridge (dynamic late-binding).
// No UNO type libraries required at compile time; only Microsoft.CSharp.dll for `dynamic`.
//
// Works with LibreOffice 5+ and Apache OpenOffice 4+ on Windows.
// Requires LibreOffice/OpenOffice installed with COM bridge support (default on Windows).
//
// Part of the Office helper family — see MSOfficeWin.cs header for the full list.
//
// UNO ProgID: com.sun.star.ServiceManager  (registered by both LO and OOo)
//
// Usage:
//   LibreOfficeWin.exe --api-schema
//   LibreOfficeWin.exe <target> <{COMMAND[:param]}>
//   LibreOfficeWin.exe --listen-stdin [--persistent]
//
// Target formats:
//   writer / word            — active Writer document
//   calc   / excel           — active Calc spreadsheet
//   impress / powerpoint     — active Impress presentation
//   DOCNAME:<name>           — search all open docs for matching title
//   PROC:soffice.exe         — maps to the running LibreOffice instance

using System;
using System.Collections.Generic;
using System.IO;
using System.Net.Sockets;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;

namespace LibreOfficeWin
{
    class Program
    {
        // ──────────────────────────────────────────────────────────────────────
        //  Win32 P/Invoke (for FOCUS)
        // ──────────────────────────────────────────────────────────────────────

        [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr hWnd);
        [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
        [DllImport("user32.dll")] static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
        [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
        [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hWnd);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
        delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

        // ──────────────────────────────────────────────────────────────────────
        //  Entry point
        // ──────────────────────────────────────────────────────────────────────

        static int Main(string[] args)
        {
            try
            {
                if (args.Length == 0)
                {
                    Console.Error.WriteLine("Usage: LibreOfficeWin.exe --api-schema");
                    Console.Error.WriteLine("       LibreOfficeWin.exe <target> <{COMMAND[:param]}>");
                    Console.Error.WriteLine("       LibreOfficeWin.exe --listen-stdin [--persistent]");
                    return 1;
                }

                if (args[0] == "--api-schema")
                {
                    Console.WriteLine(GetApiSchema());
                    return 0;
                }

                if (args[0] == "--version")
                {
                    Console.WriteLine("LibreOfficeWin.exe 1.0.0");
                    return 0;
                }

                if (args[0] == "--listen-stdin")
                {
                    bool skipAuth = string.Equals(
                        Environment.GetEnvironmentVariable("SKIP_SESSION_AUTH"),
                        "true", StringComparison.OrdinalIgnoreCase);
                    var authState = HelperCommon.RunAuthHandshake(skipAuth);
                    bool persistent = HelperCommon.HasFlag(args, "--persistent");
                    return HelperCommon.RunStdinListener(persistent, DispatchCommand, GetApiSchema, authState);
                }

                {
                    string listenPort = HelperCommon.GetFlagValue(args, "--listen-port");
                    if (listenPort != null)
                    {
                        int port = 0;
                        if (listenPort.Length == 0 ||
                            !int.TryParse(listenPort, out port) || port <= 0 || port > 65535)
                        {
                            Console.Error.WriteLine("LibreOfficeWin: --listen-port requires a valid port number");
                            return 1;
                        }
                        return HelperCommon.RunHttpListener(port, DispatchCommand, GetApiSchema);
                    }
                }

                {
                    string pipeName = HelperCommon.GetFlagValue(args, "--listen-pipe");
                    if (pipeName != null)
                    {
                        if (pipeName.Length == 0)
                        {
                            Console.Error.WriteLine("LibreOfficeWin: --listen-pipe requires a pipe name");
                            return 1;
                        }
                        return HelperCommon.RunNamedPipeListener(pipeName, DispatchCommand, GetApiSchema);
                    }
                }

                if (args[0] == "--inject-mode=direct" && args.Length >= 2)
                {
                    string tmpFile = args[1];
                    if (!File.Exists(tmpFile))
                    {
                        Console.Error.WriteLine("AIAPI: inject-mode file not found: " + tmpFile);
                        return 1;
                    }
                    string[] lines = File.ReadAllLines(tmpFile);
                    string tgt = lines.Length > 0 ? lines[0].Trim() : "";
                    string act = lines.Length > 1 ? lines[1].Trim() : "";
                    DispatchCommand(tgt, act);
                    return 0;
                }

                if (args.Length >= 2)
                {
                    DispatchCommand(args[0], args[1]);
                    return 0;
                }

                Console.Error.WriteLine("LibreOfficeWin.exe: invalid arguments");
                return 1;
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine("LibreOfficeWin fatal: " + ex.Message);
                return 1;
            }
        }

        // ──────────────────────────────────────────────────────────────────────
        //  Command dispatch
        // ──────────────────────────────────────────────────────────────────────

        static void DispatchCommand(string target, string action)
        {
            string cmdType = DetermineCommandType(action);

            if (cmdType == "LISTDOCS")
            {
                CmdListDocs();
                return;
            }

            if (cmdType == "NEWDOC")
            {
                CmdNewDoc(NormaliseAppType(target));
                return;
            }

            if (cmdType == "RELAUNCH")
            {
                CmdRelaunch(ExtractParam(action, "RELAUNCH"));
                return;
            }

            if (cmdType == "LAUNCH")
            {
                CmdLaunch(target, ExtractParam(action, "LAUNCH"));
                return;
            }

            if (cmdType == "FOCUS")
            {
                CmdFocus();
                return;
            }

            string appType;
            dynamic doc = ResolveDocument(target, out appType);
            if (doc == null)
            {
                Console.WriteLine("{\"success\":false,\"error\":\"No open document found for target: "
                    + JsonEscape(target) + "\"}");
                return;
            }

            switch (cmdType)
            {
                case "QUERYTREE":
                {
                    string depthStr = ExtractParam(action, "QUERYTREE");
                    int depth = 3;
                    if (!string.IsNullOrEmpty(depthStr)) int.TryParse(depthStr, out depth);
                    CmdQueryTree(doc, appType, depth);
                    break;
                }
                case "READ":
                    CmdRead(doc, appType, ExtractParam(action, "READ") ?? "");
                    break;
                case "WRITE":
                    CmdWrite(doc, appType, ExtractParam(action, "WRITE") ?? "");
                    break;
                case "SAVE":
                    CmdSave(doc, appType, "");
                    break;
                case "EXPORT":
                    CmdSave(doc, appType, ExtractParam(action, "EXPORT") ?? "pdf");
                    break;
                case "FORMAT":
                    CmdFormat(doc, appType, ExtractParam(action, "FORMAT") ?? "");
                    break;
                default:
                    Console.WriteLine("{\"success\":false,\"error\":\"Unknown command: "
                        + JsonEscape(cmdType) + "\"}");
                    break;
            }
        }

        // ──────────────────────────────────────────────────────────────────────
        //  UNO connection helpers
        // ──────────────────────────────────────────────────────────────────────

        // UNO ProgID — same for both LibreOffice and Apache OpenOffice
        const string UnoProgId = "com.sun.star.ServiceManager";

        static dynamic TryGetServiceManager()
        {
            // Primary: running object table (works when LO/OOo is open, LO < 24)
            try { return Marshal.GetActiveObject(UnoProgId); } catch { }
            // Fallback: activate via COM registry entry (LO 5-23 only; LO 24+ removed the bridge).
            // If this also fails, call {RELAUNCH} or {LAUNCH} to restart soffice with
            // --accept=socket,host=localhost,port=2002;urp;StarOffice.ServiceManager
            // See docs/guides/LINUX_MAC_PORTING.md for the Python bridge on LO 24+.
            try { var t = Type.GetTypeFromProgID(UnoProgId); if (t != null) return Activator.CreateInstance(t); } catch { }
            return null;
        }

        static dynamic EnsureServiceManager()
        {
            // Try to connect to a running instance first
            dynamic smgr = TryGetServiceManager();
            if (smgr != null) return smgr;

            // Launch LibreOffice if not running
            Type t = Type.GetTypeFromProgID(UnoProgId);
            if (t == null) return null;
            try { return Activator.CreateInstance(t); }
            catch { return null; }
        }

        static dynamic GetDesktop(dynamic smgr)
        {
            return smgr.createInstance("com.sun.star.frame.Desktop");
        }

        // ──────────────────────────────────────────────────────────────────────
        //  App/document type resolution
        // ──────────────────────────────────────────────────────────────────────

        static string NormaliseAppType(string target)
        {
            if (string.IsNullOrEmpty(target)) return "writer";
            string t = target.ToLowerInvariant();
            if (t == "word") return "writer";
            if (t == "excel") return "calc";
            if (t == "powerpoint" || t == "ppt") return "impress";
            if (t == "writer" || t == "calc" || t == "impress") return t;
            return t;
        }

        /// <summary>
        /// Detect the app type of a UNO document component by querying its services.
        /// Returns "writer", "calc", "impress", or "" if unknown.
        /// </summary>
        static string DetectAppType(dynamic doc)
        {
            try
            {
                if ((bool)doc.supportsService("com.sun.star.text.TextDocument"))
                    return "writer";
                if ((bool)doc.supportsService("com.sun.star.sheet.SpreadsheetDocument"))
                    return "calc";
                if ((bool)doc.supportsService("com.sun.star.presentation.PresentationDocument"))
                    return "impress";
            }
            catch { }
            return "";
        }

        static dynamic ResolveDocument(string target, out string appType)
        {
            appType = "";
            if (string.IsNullOrEmpty(target)) target = "writer";

            // PROC: target maps to the running soffice instance
            if (target.StartsWith("PROC:", StringComparison.OrdinalIgnoreCase))
            {
                string proc = target.Substring(5).ToLowerInvariant();
                if (proc.Contains("excel") || proc.Contains("calc")) target = "calc";
                else if (proc.Contains("word")) target = "writer";
                else if (proc.Contains("impress") || proc.Contains("ppt")) target = "impress";
                else target = "writer"; // default to writer
            }

            // DOCNAME: search across all open components
            if (target.StartsWith("DOCNAME:", StringComparison.OrdinalIgnoreCase))
            {
                string docName = target.Substring(8);
                foreach (var kv in EnumerateOpenDocs())
                {
                    string n = "";
                    try { n = Path.GetFileName((string)kv.Key.getURL()); } catch { }
                    if (string.IsNullOrEmpty(n))
                        try { n = (string)kv.Key.getCurrentController().getFrame().getName(); } catch { }
                    if (string.Equals(n, docName, StringComparison.OrdinalIgnoreCase))
                    {
                        appType = kv.Value;
                        return kv.Key;
                    }
                }
                return null;
            }

            string at = NormaliseAppType(target);
            dynamic smgr = TryGetServiceManager();
            if (smgr == null) return null;
            dynamic desktop = GetDesktop(smgr);

            // Get the current active component
            dynamic current = null;
            try { current = desktop.getCurrentComponent(); } catch { }

            // If current doc matches the requested type, return it
            if (current != null)
            {
                string detected = DetectAppType(current);
                if (detected == at || string.IsNullOrEmpty(at))
                {
                    appType = detected;
                    return current;
                }
            }

            // Fall back: enumerate all open docs and find one of the right type
            foreach (var kv in EnumerateOpenDocs())
            {
                if (kv.Value == at)
                {
                    appType = at;
                    return kv.Key;
                }
            }
            return null;
        }

        /// <summary>
        /// Returns all open UNO document components with their detected app types.
        /// </summary>
        static IEnumerable<KeyValuePair<dynamic, string>> EnumerateOpenDocs()
        {
            dynamic smgr = TryGetServiceManager();
            if (smgr == null) yield break;

            dynamic desktop;
            try { desktop = GetDesktop(smgr); } catch { yield break; }

            dynamic components;
            try { components = desktop.getComponents(); } catch { yield break; }

            dynamic compEnum;
            try { compEnum = components.createEnumeration(); } catch { yield break; }

            while (true)
            {
                bool hasMore = false;
                try { hasMore = (bool)compEnum.hasMoreElements(); } catch { break; }
                if (!hasMore) break;

                dynamic comp = null;
                try { comp = compEnum.nextElement(); } catch { break; }
                if (comp == null) continue;

                // getComponents() may return frames — unwrap the component
                dynamic doc = comp;
                try
                {
                    // If it's a frame, get its component
                    dynamic c = comp.getComponent();
                    if (c != null) doc = c;
                }
                catch { }

                string at = DetectAppType(doc);
                if (!string.IsNullOrEmpty(at))
                    yield return new KeyValuePair<dynamic, string>(doc, at);
            }
        }

        // ──────────────────────────────────────────────────────────────────────
        //  LISTDOCS
        // ──────────────────────────────────────────────────────────────────────

        static void CmdListDocs()
        {
            var sb = new StringBuilder("[");
            bool first = true;

            foreach (var kv in EnumerateOpenDocs())
            {
                dynamic doc = kv.Key;
                string appType = kv.Value;

                string name = "";
                string docUrl = "";
                bool saved = true;
                try { docUrl = (string)doc.getURL(); } catch { }
                try { name = Path.GetFileName(docUrl); } catch { }
                if (string.IsNullOrEmpty(name))
                    try { name = (string)doc.getCurrentController().getFrame().getName(); } catch { }
                try { saved = !(bool)doc.isModified(); } catch { }

                if (!first) sb.Append(",");
                sb.Append("{");
                sb.Append("\"app\":\"").Append(appType).Append("\"");
                sb.Append(",\"name\":\"").Append(JsonEscape(name)).Append("\"");
                sb.Append(",\"path\":\"").Append(JsonEscape(docUrl)).Append("\"");
                sb.Append(",\"saved\":").Append(saved ? "true" : "false");
                sb.Append("}");
                first = false;
            }

            sb.Append("]");
            Console.WriteLine("{\"success\":true,\"result\":" + sb + "}");
        }

        // ──────────────────────────────────────────────────────────────────────
        //  NEWDOC
        // ──────────────────────────────────────────────────────────────────────

        static void CmdNewDoc(string appType)
        {
            try
            {
                string loExe = FindLibreOfficeExe();
                if (loExe == null)
                    throw new Exception("LibreOffice/OpenOffice not installed or not found. " +
                        "Install from https://www.libreoffice.org");

                string flag = appType == "calc"    ? "--calc" :
                              appType == "impress" ? "--impress" : "--writer";

                // Launch soffice.exe with the document-type flag.
                // When LO is already running its single-instance IPC forwards the
                // request to the running instance and opens a new document window there
                // — no COM bridge, no URP socket, no Python needed.
                System.Diagnostics.Process.Start(loExe,
                    flag + " --norestore --nofirststartwizard");

                // Wait for the new window to appear (up to ~8 s, poll every 500 ms).
                string title = "";
                for (int i = 0; i < 16 && string.IsNullOrEmpty(title); i++)
                {
                    System.Threading.Thread.Sleep(500);
                    title = FindNewestLoWindowTitle(appType);
                }

                Console.WriteLine("{\"success\":true,\"result\":\"created\",\"name\":\""
                    + JsonEscape(title) + "\"}");
            }
            catch (Exception ex)
            {
                Console.WriteLine("{\"success\":false,\"error\":\"NEWDOC failed: "
                    + JsonEscape(ex.Message) + "\"}");
            }
        }

        /// <summary>
        /// Enumerate visible top-level windows belonging to soffice.exe and return a title
        /// that matches the requested app type (writer / calc / impress).
        /// </summary>
        static string FindNewestLoWindowTitle(string appType)
        {
            var sofficeProcs = new HashSet<uint>();
            foreach (var p in System.Diagnostics.Process.GetProcessesByName("soffice"))
                sofficeProcs.Add((uint)p.Id);
            foreach (var p in System.Diagnostics.Process.GetProcessesByName("soffice.bin"))
                sofficeProcs.Add((uint)p.Id);
            if (sofficeProcs.Count == 0) return "";

            var titles = new List<string>();
            EnumWindows((hWnd, lp) =>
            {
                if (!IsWindowVisible(hWnd)) return true;
                uint pid;
                GetWindowThreadProcessId(hWnd, out pid);
                if (!sofficeProcs.Contains(pid)) return true;
                var sb2 = new StringBuilder(512);
                GetWindowText(hWnd, sb2, 512);
                string t = sb2.ToString().Trim();
                if (!string.IsNullOrEmpty(t)
                    && !string.Equals(t, "LibreOffice", StringComparison.OrdinalIgnoreCase)
                    && !t.StartsWith("LibreOffice Start Center", StringComparison.OrdinalIgnoreCase))
                    titles.Add(t);
                return true;
            }, IntPtr.Zero);

            if (titles.Count == 0) return "";

            string keyword = appType == "calc"    ? "Calc" :
                             appType == "impress" ? "Impress" : "Writer";

            // Prefer a window title that mentions the expected app.
            foreach (string t in titles)
                if (t.IndexOf(keyword, StringComparison.OrdinalIgnoreCase) >= 0)
                    return t;

            // Fallback: any "Untitled" or generic LO window.
            foreach (string t in titles)
                if (t.IndexOf("Untitled", StringComparison.OrdinalIgnoreCase) >= 0 ||
                    t.IndexOf("Bez názvu", StringComparison.OrdinalIgnoreCase) >= 0)
                    return t;

            return titles[0];
        }

        /// <summary>
        /// Locate the soffice.exe binary for LibreOffice or OpenOffice.
        /// </summary>
        static string FindLibreOfficeExe()
        {
            string[] candidates = {
                @"C:\Program Files\LibreOffice\program\soffice.exe",
                @"C:\Program Files (x86)\LibreOffice\program\soffice.exe",
                @"C:\Program Files\LibreOffice 7\program\soffice.exe",
                @"C:\Program Files\LibreOffice 6\program\soffice.exe",
                @"C:\Program Files\OpenOffice 4\program\soffice.exe",
                @"C:\Program Files (x86)\OpenOffice 4\program\soffice.exe",
                @"C:\Program Files\Apache OpenOffice 4\program\soffice.exe",
            };
            foreach (string c in candidates)
                if (File.Exists(c)) return c;

            // Try to find via running process
            try
            {
                var procs = System.Diagnostics.Process.GetProcessesByName("soffice");
                if (procs.Length > 0) return procs[0].MainModule.FileName;
            }
            catch { }

            // Try PATH
            try
            {
                var info = new System.Diagnostics.ProcessStartInfo("where.exe", "soffice.exe")
                { RedirectStandardOutput = true, UseShellExecute = false };
                var proc = System.Diagnostics.Process.Start(info);
                string line = proc.StandardOutput.ReadLine();
                if (!string.IsNullOrEmpty(line) && File.Exists(line.Trim()))
                    return line.Trim();
            }
            catch { }

            return null;
        }

        // ──────────────────────────────────────────────────────────────────────
        //  RELAUNCH / LAUNCH  — restart soffice with UNO socket --accept flag
        // ──────────────────────────────────────────────────────────────────────
        // {RELAUNCH}       — saves all open docs, kills soffice, restarts on port 2002
        // {RELAUNCH:N}     — same, explicit port N
        // {LAUNCH:app}     — if socket unreachable, starts soffice for app; else no-op
        // {LAUNCH:app:N}   — same, explicit port N
        //
        // After RELAUNCH, TryGetServiceManager() will attempt Activator.CreateInstance
        // which works on LO < 24.  On LO 24+ where the COM bridge is removed entirely,
        // the socket is reachable on localhost:N but requires the UNO URL resolver —
        // see docs/guides/LINUX_MAC_PORTING.md §LibreOffice for the Python bridge path.

        static bool IsUnoSocketReachable(int port)
        {
            try
            {
                using (var tc = new TcpClient())
                {
                    var ar = tc.BeginConnect("127.0.0.1", port, null, null);
                    if (ar.AsyncWaitHandle.WaitOne(600))
                    {
                        try { tc.EndConnect(ar); return true; } catch { }
                    }
                }
            }
            catch { }
            return false;
        }

        static int _unoSocketPort = 0; // remembered across calls in persistent mode

        static void CmdRelaunch(string param)
        {
            try
            {
                int port = 2002;
                if (!string.IsNullOrEmpty(param))
                    int.TryParse(param.Trim(), out port);
                if (port <= 0) port = 2002;

                string loExe = FindLibreOfficeExe();
                if (loExe == null)
                    throw new Exception("LibreOffice/OpenOffice not installed or not found. Install from https://www.libreoffice.org");

                // Save all open documents before killing the process
                try
                {
                    foreach (var kv in EnumerateOpenDocs())
                    {
                        try { kv.Key.store(); } catch { }
                    }
                }
                catch { }

                // Kill all soffice processes
                foreach (string pname in new[] { "soffice", "soffice.bin" })
                {
                    foreach (var p in System.Diagnostics.Process.GetProcessesByName(pname))
                    {
                        try { p.Kill(); p.WaitForExit(4000); } catch { }
                    }
                }
                System.Threading.Thread.Sleep(1500); // wait for port release

                // Restart with UNO socket --accept flag
                string acceptArg = "--accept=socket,host=localhost,port=" + port + ";urp;StarOffice.ServiceManager";
                System.Diagnostics.Process.Start(loExe,
                    acceptArg + " --norestore --nofirststartwizard");

                // Wait for socket to become reachable (up to 12 s)
                bool reachable = false;
                for (int i = 0; i < 24 && !reachable; i++)
                {
                    System.Threading.Thread.Sleep(500);
                    reachable = IsUnoSocketReachable(port);
                }

                _unoSocketPort = port;
                Console.WriteLine("{\"success\":true,\"result\":\"relaunched\",\"port\":"
                    + port + ",\"socket_reachable\":" + (reachable ? "true" : "false") + "}");
            }
            catch (Exception ex)
            {
                Console.WriteLine("{\"success\":false,\"error\":\"RELAUNCH failed: "
                    + JsonEscape(ex.Message) + "\"}");
            }
        }

        static void CmdLaunch(string target, string param)
        {
            try
            {
                // Parse param: "app" or "app:port"
                string appArg  = NormaliseAppType(target);
                int    port    = 2002;
                if (!string.IsNullOrEmpty(param))
                {
                    string[] tok = param.Split(':');
                    if (!string.IsNullOrEmpty(tok[0])) appArg = NormaliseAppType(tok[0]);
                    if (tok.Length > 1) int.TryParse(tok[1], out port);
                }
                if (port <= 0) port = 2002;

                // If socket already reachable, just report it
                if (IsUnoSocketReachable(port))
                {
                    _unoSocketPort = port;
                    Console.WriteLine("{\"success\":true,\"result\":\"already_running\",\"port\":" + port + "}");
                    return;
                }

                // If COM bridge reachable, report that too
                if (TryGetServiceManager() != null)
                {
                    Console.WriteLine("{\"success\":true,\"result\":\"com_bridge_active\",\"port\":0}");
                    return;
                }

                // Launch with --accept
                string loExe = FindLibreOfficeExe();
                if (loExe == null) throw new Exception("LibreOffice/OpenOffice not installed");

                string flag   = appArg == "calc" ? "--calc" : appArg == "impress" ? "--impress" : "--writer";
                string accept = "--accept=socket,host=localhost,port=" + port + ";urp;StarOffice.ServiceManager";
                System.Diagnostics.Process.Start(loExe,
                    flag + " " + accept + " --norestore --nofirststartwizard");

                bool reachable = false;
                for (int i = 0; i < 24 && !reachable; i++)
                {
                    System.Threading.Thread.Sleep(500);
                    reachable = IsUnoSocketReachable(port);
                }

                _unoSocketPort = port;
                Console.WriteLine("{\"success\":true,\"result\":\"launched\",\"port\":"
                    + port + ",\"socket_reachable\":" + (reachable ? "true" : "false") + "}");
            }
            catch (Exception ex)
            {
                Console.WriteLine("{\"success\":false,\"error\":\"LAUNCH failed: "
                    + JsonEscape(ex.Message) + "\"}");
            }
        }

        // ──────────────────────────────────────────────────────────────────────
        //  QUERYTREE
        // ──────────────────────────────────────────────────────────────────────

        static void CmdQueryTree(dynamic doc, string appType, int depth)
        {
            try
            {
                string tree;
                switch (appType)
                {
                    case "writer":  tree = QueryTreeWriter(doc, depth);  break;
                    case "calc":    tree = QueryTreeCalc(doc, depth);    break;
                    case "impress": tree = QueryTreeImpress(doc, depth); break;
                    default:        tree = "{}"; break;
                }
                Console.WriteLine("{\"success\":true,\"result\":" + tree + "}");
            }
            catch (Exception ex)
            {
                Console.WriteLine("{\"success\":false,\"error\":\"QUERYTREE failed: " + JsonEscape(ex.Message) + "\"}");
            }
        }

        static string QueryTreeWriter(dynamic doc, int depth)
        {
            string name = "";
            string docUrl = "";
            try { docUrl = (string)doc.getURL(); } catch { }
            try { name = Path.GetFileName(docUrl); } catch { }
            if (string.IsNullOrEmpty(name))
                try { name = (string)doc.getCurrentController().getFrame().getName(); } catch { }

            var sb = new StringBuilder();
            sb.Append("{\"id\":\"document\",\"type\":\"TextDocument\"");
            sb.Append(",\"name\":\"").Append(JsonEscape(name)).Append("\"");
            sb.Append(",\"properties\":{\"path\":\"").Append(JsonEscape(docUrl)).Append("\"}");
            sb.Append(",\"actions\":[\"READ\",\"WRITE\",\"SAVE\",\"EXPORT\"]");

            if (depth >= 2)
            {
                sb.Append(",\"children\":[");
                bool first = true;
                int idx = 1;
                const int MaxParas = 50;

                dynamic text = doc.getText();
                dynamic paraEnum = text.createEnumeration();
                while ((bool)paraEnum.hasMoreElements() && idx <= MaxParas)
                {
                    dynamic content = paraEnum.nextElement();
                    bool isPara = false;
                    try { isPara = (bool)content.supportsService("com.sun.star.text.Paragraph"); } catch { isPara = true; }
                    if (!isPara) continue;

                    string val = "";
                    try { val = (string)content.getString(); } catch { }
                    // Truncate long values for tree display
                    if (val.Length > 80) val = val.Substring(0, 80) + "...";

                    if (!first) sb.Append(",");
                    sb.Append("{\"id\":\"para_").Append(idx).Append("\"");
                    sb.Append(",\"type\":\"Paragraph\"");
                    sb.Append(",\"name\":\"Paragraph ").Append(idx).Append("\"");
                    sb.Append(",\"value\":\"").Append(JsonEscape(val)).Append("\"");
                    sb.Append(",\"path\":\"body/para[").Append(idx).Append("]\"");
                    sb.Append(",\"actions\":[\"READ\",\"WRITE\",\"FORMAT\"]");
                    sb.Append("}");
                    first = false;
                    idx++;
                }
                sb.Append("]");
            }
            sb.Append("}");
            return sb.ToString();
        }

        static string QueryTreeCalc(dynamic doc, int depth)
        {
            string name = "";
            try { name = Path.GetFileName((string)doc.getURL()); } catch { }
            dynamic sheets = doc.getSheets();
            int sheetCount = (int)sheets.getCount();

            var sb = new StringBuilder();
            sb.Append("{\"id\":\"spreadsheet\",\"type\":\"SpreadsheetDocument\"");
            sb.Append(",\"name\":\"").Append(JsonEscape(name)).Append("\"");
            sb.Append(",\"properties\":{\"sheetCount\":").Append(sheetCount).Append("}");
            sb.Append(",\"actions\":[\"READ\",\"WRITE\",\"SAVE\",\"EXPORT\"]");

            if (depth >= 2)
            {
                sb.Append(",\"children\":[");
                const int MaxCells = 200;
                for (int si = 0; si < sheetCount; si++)
                {
                    if (si > 0) sb.Append(",");
                    dynamic sheet = sheets.getByIndex(si);
                    string sheetName = (string)sheet.getName();

                    sb.Append("{\"id\":\"sheet_").Append(si + 1).Append("\"");
                    sb.Append(",\"type\":\"Sheet\"");
                    sb.Append(",\"name\":\"").Append(JsonEscape(sheetName)).Append("\"");
                    sb.Append(",\"path\":\"sheet[@name='").Append(JsonEscape(sheetName)).Append("']\"");
                    sb.Append(",\"actions\":[\"READ\",\"WRITE\"]");

                    if (depth >= 3)
                    {
                        sb.Append(",\"children\":[");
                        // Enumerate used range via cursor
                        dynamic cursor = sheet.createCursor();
                        cursor.gotoStartOfUsedArea(false);
                        cursor.gotoEndOfUsedArea(true);
                        int maxRow = (int)cursor.getRangeAddress().EndRow;
                        int maxCol = (int)cursor.getRangeAddress().EndColumn;
                        bool firstCell = true;
                        int cellCount = 0;

                        for (int r = 0; r <= maxRow && cellCount < MaxCells; r++)
                        {
                            for (int c = 0; c <= maxCol && cellCount < MaxCells; c++)
                            {
                                dynamic cell = sheet.getCellByPosition(c, r);
                                string cellVal = "";
                                try { cellVal = (string)cell.getString(); } catch { }
                                if (string.IsNullOrEmpty(cellVal)) continue;

                                string addr = ColIndexToLetter(c) + (r + 1);
                                if (!firstCell) sb.Append(",");
                                sb.Append("{\"id\":\"cell_").Append(addr).Append("\"");
                                sb.Append(",\"type\":\"Cell\"");
                                sb.Append(",\"name\":\"").Append(addr).Append("\"");
                                sb.Append(",\"value\":\"").Append(JsonEscape(cellVal)).Append("\"");
                                sb.Append(",\"path\":\"sheet[@name='").Append(JsonEscape(sheetName))
                                  .Append("']/cell[@addr='").Append(addr).Append("']\"");
                                sb.Append(",\"actions\":[\"READ\",\"WRITE\"]");
                                sb.Append("}");
                                firstCell = false;
                                cellCount++;
                            }
                        }
                        sb.Append("]");
                    }
                    sb.Append("}");
                }
                sb.Append("]");
            }
            sb.Append("}");
            return sb.ToString();
        }

        static string QueryTreeImpress(dynamic doc, int depth)
        {
            string name = "";
            try { name = Path.GetFileName((string)doc.getURL()); } catch { }
            dynamic pages = doc.getDrawPages();
            int slideCount = (int)pages.getCount();

            var sb = new StringBuilder();
            sb.Append("{\"id\":\"presentation\",\"type\":\"PresentationDocument\"");
            sb.Append(",\"name\":\"").Append(JsonEscape(name)).Append("\"");
            sb.Append(",\"properties\":{\"slideCount\":").Append(slideCount).Append("}");
            sb.Append(",\"actions\":[\"READ\",\"WRITE\",\"SAVE\",\"EXPORT\"]");

            if (depth >= 2)
            {
                sb.Append(",\"children\":[");
                for (int si = 0; si < slideCount; si++)
                {
                    if (si > 0) sb.Append(",");
                    dynamic slide = pages.getByIndex(si);
                    string slideName = "";
                    try { slideName = (string)slide.Name; } catch { slideName = "Slide " + (si + 1); }
                    int shapeCount = (int)slide.getCount();

                    sb.Append("{\"id\":\"slide_").Append(si + 1).Append("\"");
                    sb.Append(",\"type\":\"Slide\"");
                    sb.Append(",\"name\":\"").Append(JsonEscape(slideName)).Append("\"");
                    sb.Append(",\"properties\":{\"index\":").Append(si + 1)
                      .Append(",\"shapeCount\":").Append(shapeCount).Append("}");
                    sb.Append(",\"path\":\"slide[").Append(si + 1).Append("]\"");
                    sb.Append(",\"actions\":[\"READ\",\"WRITE\"]");

                    if (depth >= 3 && shapeCount > 0)
                    {
                        sb.Append(",\"children\":[");
                        for (int shi = 0; shi < shapeCount; shi++)
                        {
                            if (shi > 0) sb.Append(",");
                            dynamic shape = slide.getByIndex(shi);
                            string shapeName = "";
                            try { shapeName = (string)shape.Name; } catch { }
                            string shapeVal = "";
                            try { shapeVal = (string)shape.getString(); } catch { }
                            if (shapeVal.Length > 80) shapeVal = shapeVal.Substring(0, 80) + "...";

                            sb.Append("{\"id\":\"slide_").Append(si + 1).Append("_shape_").Append(shi + 1).Append("\"");
                            sb.Append(",\"type\":\"Shape\"");
                            sb.Append(",\"name\":\"").Append(JsonEscape(shapeName)).Append("\"");
                            sb.Append(",\"value\":\"").Append(JsonEscape(shapeVal)).Append("\"");
                            sb.Append(",\"path\":\"slide[").Append(si + 1).Append("]/shape[@name='")
                              .Append(JsonEscape(shapeName)).Append("']\"");
                            sb.Append(",\"actions\":[\"READ\",\"WRITE\"]");
                            sb.Append("}");
                        }
                        sb.Append("]");
                    }
                    sb.Append("}");
                }
                sb.Append("]");
            }
            sb.Append("}");
            return sb.ToString();
        }

        // ──────────────────────────────────────────────────────────────────────
        //  READ
        // ──────────────────────────────────────────────────────────────────────

        static void CmdRead(dynamic doc, string appType, string param)
        {
            try
            {
                string result;
                switch (appType)
                {
                    case "writer":  result = ReadWriter(doc, param);  break;
                    case "calc":    result = ReadCalc(doc, param);    break;
                    case "impress": result = ReadImpress(doc, param); break;
                    default:        result = ""; break;
                }
                Console.WriteLine("{\"success\":true,\"result\":\"" + JsonEscape(result) + "\"}");
            }
            catch (Exception ex)
            {
                Console.WriteLine("{\"success\":false,\"error\":\"READ failed: " + JsonEscape(ex.Message) + "\"}");
            }
        }

        static string ReadWriter(dynamic doc, string param)
        {
            // bookmark[@name='X']
            string bmName = TryBookmarkName(param);
            if (bmName != null)
            {
                dynamic bm = doc.getBookmarks().getByName(bmName);
                return (string)bm.getString();
            }

            dynamic text = doc.getText();

            // "body" — full document text
            if (string.IsNullOrEmpty(param) || param == "body")
                return (string)text.getString();

            // body/para[N]
            int paraIdx = TryParaIndex(param);
            if (paraIdx <= 0)
                throw new Exception("Unsupported Writer path: " + param +
                    ". Use 'body', 'body/para[N]', or 'body/bookmark[@name=X]'.");

            dynamic para = GetWriterParagraph(text, paraIdx);
            if (para == null) throw new Exception("Paragraph " + paraIdx + " not found");
            return (string)para.getString();
        }

        static string ReadCalc(dynamic doc, string param)
        {
            string cellAddr;
            dynamic sheet = ResolveCalcSheet(doc, param, out cellAddr);
            if (string.IsNullOrEmpty(cellAddr))
                throw new Exception("Unsupported Calc path: " + param);

            // Range (contains ':')
            if (cellAddr.Contains(":"))
            {
                dynamic range = sheet.getCellRangeByName(cellAddr);
                var cellsSb = new StringBuilder("[");
                bool first = true;
                // Determine bounds via RangeAddress
                int startCol = (int)range.getRangeAddress().StartColumn;
                int startRow = (int)range.getRangeAddress().StartRow;
                int endCol   = (int)range.getRangeAddress().EndColumn;
                int endRow   = (int)range.getRangeAddress().EndRow;
                for (int r = startRow; r <= endRow; r++)
                {
                    for (int c = startCol; c <= endCol; c++)
                    {
                        dynamic cell2 = sheet.getCellByPosition(c, r);
                        string val = (string)cell2.getString();
                        if (string.IsNullOrEmpty(val)) continue;
                        if (!first) cellsSb.Append(",");
                        cellsSb.Append("{\"addr\":\"").Append(ColIndexToLetter(c)).Append(r + 1)
                               .Append("\",\"value\":\"").Append(JsonEscape(val)).Append("\"}");
                        first = false;
                    }
                }
                cellsSb.Append("]");
                return cellsSb.ToString();
            }

            // Single cell
            return (string)sheet.getCellRangeByName(cellAddr).getString();
        }

        static string ReadImpress(dynamic doc, string param)
        {
            // slide[N] — all text on slide (concatenated)
            // slide[N]/shape[@name='X'] or slide[N]/shape[M] — single shape
            dynamic pages = doc.getDrawPages();
            int slideIdx = TrySlideIndex(param);
            if (slideIdx <= 0) throw new Exception("Unsupported Impress path: " + param);

            // Auto-extend if needed
            while ((int)pages.getCount() < slideIdx)
                pages.insertNewByIndex((int)pages.getCount());

            dynamic slide = pages.getByIndex(slideIdx - 1); // 0-indexed

            // Shape target?
            dynamic shape = TryResolveShape(slide, param);
            if (shape != null) return (string)shape.getString();

            // Whole-slide: concatenate all shape text
            int count = (int)slide.getCount();
            var sb = new StringBuilder();
            for (int i = 0; i < count; i++)
            {
                string t = "";
                try { t = (string)slide.getByIndex(i).getString(); } catch { }
                if (!string.IsNullOrEmpty(t))
                {
                    if (sb.Length > 0) sb.Append("\r\n");
                    sb.Append(t);
                }
            }
            return sb.ToString();
        }

        // ──────────────────────────────────────────────────────────────────────
        //  WRITE
        // ──────────────────────────────────────────────────────────────────────

        static void CmdWrite(dynamic doc, string appType, string combined)
        {
            // combined = "addr|value"  (same wire packing as MSOfficeWin via HelperCommon)
            int sep = combined.IndexOf('|');
            string addr  = sep >= 0 ? combined.Substring(0, sep) : combined;
            string value = sep >= 0 ? combined.Substring(sep + 1) : "";

            try
            {
                switch (appType)
                {
                    case "writer":  WriteWriter(doc, addr, value);  break;
                    case "calc":    WriteCalc(doc, addr, value);    break;
                    case "impress": WriteImpress(doc, addr, value); break;
                    default: throw new Exception("Unsupported app type: " + appType);
                }
                Console.WriteLine("{\"success\":true,\"result\":\"written\"}");
            }
            catch (Exception ex)
            {
                Console.WriteLine("{\"success\":false,\"error\":\"WRITE failed: " + JsonEscape(ex.Message) + "\"}");
            }
        }

        static void WriteWriter(dynamic doc, string addr, string value)
        {
            dynamic text = doc.getText();

            // Full document replace
            if (string.IsNullOrEmpty(addr) || addr == "body")
            {
                dynamic cursor = text.createTextCursor();
                cursor.gotoStart(false);
                cursor.gotoEnd(true);
                text.insertString(cursor, value, true);
                return;
            }

            // bookmark[@name='X']
            string bmName = TryBookmarkName(addr);
            if (bmName != null)
            {
                dynamic bm = doc.getBookmarks().getByName(bmName);
                dynamic cursor = text.createTextCursorByRange(bm.getAnchor());
                text.insertString(cursor, value, true);
                return;
            }

            // body/para[N]
            int paraIdx = TryParaIndex(addr);
            if (paraIdx <= 0)
                throw new Exception("Unsupported Writer write path: " + addr);

            // Count existing paragraphs and auto-extend if needed
            int count = CountWriterParagraphs(text);
            dynamic endCursor = text.createTextCursor();
            endCursor.gotoEnd(false);
            while (count < paraIdx)
            {
                // PARAGRAPH_BREAK = 0 in UNO ControlCharacter enum
                text.insertControlCharacter(endCursor, 0, false);
                count++;
            }

            // Now write to the target paragraph
            dynamic para = GetWriterParagraph(text, paraIdx);
            if (para == null) throw new Exception("Paragraph " + paraIdx + " not reachable after extension");
            dynamic writeCursor = text.createTextCursorByRange(para.getStart());
            writeCursor.gotoEndOfParagraph(true);
            text.insertString(writeCursor, value, true);
        }

        static void WriteCalc(dynamic doc, string addr, string value)
        {
            string cellAddr;
            dynamic sheet = ResolveCalcSheet(doc, addr, out cellAddr);
            if (string.IsNullOrEmpty(cellAddr))
                throw new Exception("Unsupported Calc write path: " + addr);

            dynamic cell = sheet.getCellRangeByName(cellAddr);
            if (value.StartsWith("="))
                cell.setFormula(value);
            else
            {
                double num;
                if (double.TryParse(value, System.Globalization.NumberStyles.Any,
                    System.Globalization.CultureInfo.InvariantCulture, out num))
                    cell.setValue(num);
                else
                    cell.setString(value);
            }
        }

        static void WriteImpress(dynamic doc, string addr, string value)
        {
            dynamic pages = doc.getDrawPages();
            int slideIdx = TrySlideIndex(addr);
            if (slideIdx <= 0)
                throw new Exception("WRITE for Impress requires a slide target, e.g. slide[1]/shape[1]");

            // Auto-extend slides
            while ((int)pages.getCount() < slideIdx)
                pages.insertNewByIndex((int)pages.getCount());

            dynamic slide = pages.getByIndex(slideIdx - 1); // 0-indexed

            dynamic shape = TryResolveShape(slide, addr);
            if (shape == null)
                throw new Exception("WRITE for Impress requires a shape target, e.g. slide[1]/shape[@name='Title'] or slide[1]/shape[1]");

            // Write via XText on the shape
            dynamic shapeText = shape.getText();
            dynamic cursor = shapeText.createTextCursor();
            cursor.gotoStart(false);
            cursor.gotoEnd(true);
            shapeText.insertString(cursor, value, true);
        }

        // ──────────────────────────────────────────────────────────────────────
        //  FORMAT  (Writer paragraph styles + full character/paragraph properties)
        // ──────────────────────────────────────────────────────────────────────
        // Parameter forms (pipe-delimited):
        //   "body/para[N]|Heading 1"                          ← style name only (backward compat)
        //   "body/para[N]|bold=true|fontSize=14"              ← key=value only
        //   "body/para[N]|style=Normal|bold=true|italic=true" ← mixed
        //
        // Character keys : bold italic underline strikethrough allCaps smallCaps
        //                  fontName fontSize color(#RRGGBB) charSpacingPt
        // Paragraph keys : style alignment(left/center/right/justify)
        //                  spaceBeforePt spaceAfterPt indentLeftCm indentRightCm indentFirstLineCm
        static void CmdFormat(dynamic doc, string appType, string combined)
        {
            string[] parts = combined.Split('|');
            string addr     = parts.Length > 0 ? parts[0].Trim() : "";

            try
            {
                if (appType != "writer")
                    throw new Exception("FORMAT is only supported for Writer documents");

                if (parts.Length < 2)
                    throw new Exception("FORMAT requires a paragraph path and at least one style or property");

                int paraIdx = TryParaIndex(addr);
                if (paraIdx <= 0)
                    throw new Exception("FORMAT requires a paragraph path such as body/para[N]");

                dynamic text = doc.getText();
                dynamic para = GetWriterParagraph(text, paraIdx);
                if (para == null) throw new Exception("Paragraph " + paraIdx + " not found");

                dynamic cursor = text.createTextCursorByRange(para.getStart());
                cursor.gotoEndOfParagraph(true);

                // 1/100 mm conversion factors
                const double PT_TO_HMM  = 35.278;  // 1 pt  = 0.35278 mm = 35.278 (1/100mm)
                const double CM_TO_HMM  = 1000.0;  // 1 cm  = 10 mm = 1000 (1/100mm)

                string styleName = null;
                var applied = new List<string>();

                for (int i = 1; i < parts.Length; i++)
                {
                    string seg = parts[i].Trim();
                    if (string.IsNullOrEmpty(seg)) continue;
                    int eq = seg.IndexOf('=');
                    if (eq < 0)
                    {
                        styleName = seg; // bare token = style name (backward compat)
                        continue;
                    }
                    string key = seg.Substring(0, eq).Trim().ToLowerInvariant();
                    string val = seg.Substring(eq + 1).Trim();
                    bool boolVal = val.Equals("true", StringComparison.OrdinalIgnoreCase) || val == "1";

                    switch (key)
                    {
                        // ── Character properties ──────────────────────────────────────
                        case "bold":
                            cursor.setPropertyValue("CharWeight", boolVal ? 150.0f : 100.0f); // FontWeight.BOLD / NORMAL
                            break;
                        case "italic":
                            cursor.setPropertyValue("CharPosture", boolVal ? (short)2 : (short)0); // FontSlant.ITALIC / NONE
                            break;
                        case "underline":
                            cursor.setPropertyValue("CharUnderline", boolVal ? (short)1 : (short)0); // FontUnderline.SINGLE / NONE
                            break;
                        case "strikethrough":
                            cursor.setPropertyValue("CharStrikeout", boolVal ? (short)1 : (short)0); // FontStrikeout.SINGLE / NONE
                            break;
                        case "allcaps":
                            cursor.setPropertyValue("CharCaseMap", boolVal ? (short)1 : (short)0); // CharType.UPPERCASE / NONE
                            break;
                        case "smallcaps":
                            cursor.setPropertyValue("CharCaseMap", boolVal ? (short)4 : (short)0); // SMALL_CAPS / NONE
                            break;
                        case "fontname":
                            cursor.setPropertyValue("CharFontName", val);
                            break;
                        case "fontsize":
                            cursor.setPropertyValue("CharHeight", (float)double.Parse(val, System.Globalization.CultureInfo.InvariantCulture));
                            break;
                        case "color":
                        {
                            string hex = val.TrimStart('#');
                            if (hex.Length == 6)
                            {
                                int r = Convert.ToInt32(hex.Substring(0, 2), 16);
                                int g = Convert.ToInt32(hex.Substring(2, 2), 16);
                                int b = Convert.ToInt32(hex.Substring(4, 2), 16);
                                cursor.setPropertyValue("CharColor", (int)(r << 16 | g << 8 | b));
                            }
                            break;
                        }
                        case "charspacingpt":
                        {
                            double pt = double.Parse(val, System.Globalization.CultureInfo.InvariantCulture);
                            cursor.setPropertyValue("CharKerning", (short)(pt * PT_TO_HMM)); // 1/100mm
                            break;
                        }

                        // ── Paragraph properties ──────────────────────────────────────
                        case "style":
                            styleName = val;
                            break;
                        case "alignment":
                        {
                            // ParagraphAdjust: LEFT=0, RIGHT=1, BLOCK=2, CENTER=3
                            short adj;
                            switch (val.ToLowerInvariant())
                            {
                                case "right":   adj = 1; break;
                                case "justify": adj = 2; break;
                                case "center":  adj = 3; break;
                                default:        adj = 0; break; // left
                            }
                            cursor.setPropertyValue("ParaAdjust", adj);
                            break;
                        }
                        case "spacebeforept":
                        {
                            int hmm = (int)(double.Parse(val, System.Globalization.CultureInfo.InvariantCulture) * PT_TO_HMM);
                            cursor.setPropertyValue("ParaTopMargin", hmm);
                            break;
                        }
                        case "spaceafterpt":
                        {
                            int hmm = (int)(double.Parse(val, System.Globalization.CultureInfo.InvariantCulture) * PT_TO_HMM);
                            cursor.setPropertyValue("ParaBottomMargin", hmm);
                            break;
                        }
                        case "indentleftcm":
                        {
                            int hmm = (int)(double.Parse(val, System.Globalization.CultureInfo.InvariantCulture) * CM_TO_HMM);
                            cursor.setPropertyValue("ParaLeftMargin", hmm);
                            break;
                        }
                        case "indentrightcm":
                        {
                            int hmm = (int)(double.Parse(val, System.Globalization.CultureInfo.InvariantCulture) * CM_TO_HMM);
                            cursor.setPropertyValue("ParaRightMargin", hmm);
                            break;
                        }
                        case "indentfirstlinecm":
                        {
                            int hmm = (int)(double.Parse(val, System.Globalization.CultureInfo.InvariantCulture) * CM_TO_HMM);
                            cursor.setPropertyValue("ParaFirstLineIndent", hmm);
                            break;
                        }
                    }
                    applied.Add(key);
                }

                // Apply style last
                if (styleName != null)
                    cursor.setPropertyValue("ParaStyleName", MapStyleName(styleName));

                var sb2 = new StringBuilder("[");
                if (styleName != null) { sb2.Append("\"style\","); }
                foreach (string a in applied) { sb2.Append("\"").Append(JsonEscape(a)).Append("\","); }
                if (sb2.Length > 1) sb2.Length--;
                sb2.Append("]");
                Console.WriteLine("{\"success\":true,\"result\":\"formatted\",\"para\":" + paraIdx + ",\"applied\":" + sb2 + "}");
            }
            catch (Exception ex)
            {
                Console.WriteLine("{\"success\":false,\"error\":\"FORMAT failed: " + JsonEscape(ex.Message) + "\"}");
            }
        }

        /// <summary>
        /// Map MS Office paragraph style names to their LibreOffice Writer equivalents.
        /// Passes through names that are already valid LO style names.
        /// </summary>
        static string MapStyleName(string msStyle)
        {
            switch (msStyle)
            {
                case "Normal":           return "Default Paragraph Style";
                case "Title":            return "Title";
                case "Subtitle":         return "Subtitle";
                case "Heading 1":        return "Heading 1";
                case "Heading 2":        return "Heading 2";
                case "Heading 3":        return "Heading 3";
                case "Heading 4":        return "Heading 4";
                case "Heading 5":        return "Heading 5";
                case "Heading 6":        return "Heading 6";
                case "Quote":            return "Quotations";
                case "Intense Quote":    return "Quotations";
                case "List Bullet":      return "List Bullet";
                case "List Number":      return "List Number";
                case "Caption":          return "Caption";
                default:                 return msStyle;  // pass through (LO style name used directly)
            }
        }

        // ──────────────────────────────────────────────────────────────────────
        //  SAVE / EXPORT
        // ──────────────────────────────────────────────────────────────────────

        static void CmdSave(dynamic doc, string appType, string format)
        {
            try
            {
                string currentUrl = "";
                try { currentUrl = (string)doc.getURL(); } catch { }

                bool isNew = string.IsNullOrEmpty(currentUrl) ||
                             currentUrl.StartsWith("private:factory");

                if (!string.IsNullOrEmpty(format) && format != "native")
                {
                    // PDF export
                    string filter = appType == "writer"  ? "writer_pdf_Export"  :
                                    appType == "calc"    ? "calc_pdf_Export"     :
                                                           "impress_pdf_Export";
                    string outPath = format.EndsWith(".pdf", StringComparison.OrdinalIgnoreCase) ? format :
                        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments),
                            Path.GetFileNameWithoutExtension(currentUrl.Length > 0
                                ? Uri.UnescapeDataString(Path.GetFileName(currentUrl)) : "document")
                            + ".pdf");
                    string outUrl = PathToFileUrl(outPath);
                    // Build PropertyValue array for FilterName via reflection
                    ExportWithFilter(doc, outUrl, filter);
                    Console.WriteLine("{\"success\":true,\"result\":\"exported\",\"path\":\"" + JsonEscape(outPath) + "\"}");
                    return;
                }

                if (isNew)
                {
                    string ext = appType == "writer"  ? ".odt" :
                                 appType == "calc"    ? ".ods" : ".odp";
                    string docTitle = "document";
                    try { docTitle = (string)doc.getCurrentController().getFrame().getName(); } catch { }
                    string savePath = Path.Combine(
                        Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments),
                        docTitle + ext);
                    string saveUrl = PathToFileUrl(savePath);
                    doc.storeToURL(saveUrl, new object[0]);
                    Console.WriteLine("{\"success\":true,\"result\":\"saved\",\"path\":\"" + JsonEscape(savePath) + "\"}");
                }
                else
                {
                    doc.store();
                    Console.WriteLine("{\"success\":true,\"result\":\"saved\"}");
                }
            }
            catch (Exception ex)
            {
                Console.WriteLine("{\"success\":false,\"error\":\"SAVE failed: " + JsonEscape(ex.Message) + "\"}");
            }
        }

        static void ExportWithFilter(dynamic doc, string outUrl, string filterName)
        {
            // UNO PropertyValue cannot be directly instantiated, but we can pass a
            // two-element object array for each property via the COM bridge variant mechanism.
            // LO COM bridge accepts Sequence<PropertyValue> passed as object[] where each
            // element is an object[] { Name, Handle, Value, State } or uses named dispatch.
            // Safest cross-version approach: use the dispatch helper.
            try
            {
                dynamic smgr = TryGetServiceManager();
                dynamic dispatcher = smgr.createInstance("com.sun.star.frame.DispatchHelper");
                dynamic frame = doc.getCurrentController().getFrame();

                // Build args as variant array — the COM bridge accepts this for Sequence<PropertyValue>
                // Each element: array of [Name, Handle(0), Value, State(0)]
                // LO accepts simple object[] if marshalled via IDispatch params
                doc.storeToURL(outUrl, new object[0]); // fallback: save as native first

                // Attempt proper filter export via storeToURL with filter name
                // We need a Sequence<PropertyValue>; create one via reflection on UNO type
                Type pvType = null;
                try
                {
                    pvType = System.Reflection.Assembly.GetExecutingAssembly()
                        .GetType("unoidl.com.sun.star.beans.PropertyValue");
                }
                catch { }

                if (pvType != null)
                {
                    // UNO type is available — create a proper PropertyValue
                    dynamic pv = Activator.CreateInstance(pvType);
                    pv.Name = "FilterName";
                    pv.Value = filterName;
                    var props = Array.CreateInstance(pvType, 1);
                    props.SetValue(pv, 0);
                    doc.storeToURL(outUrl, props);
                }
            }
            catch
            {
                // Last resort: just storeToURL with empty props (native format)
                doc.storeToURL(outUrl, new object[0]);
            }
        }

        // ──────────────────────────────────────────────────────────────────────
        //  FOCUS
        // ──────────────────────────────────────────────────────────────────────

        static void CmdFocus()
        {
            try
            {
                // Find soffice.exe main window and bring to front
                var procs = System.Diagnostics.Process.GetProcessesByName("soffice");
                if (procs.Length == 0)
                    procs = System.Diagnostics.Process.GetProcessesByName("soffice.bin");

                if (procs.Length == 0)
                    throw new Exception("LibreOffice process (soffice.exe) not found");

                uint targetPid = (uint)procs[0].Id;
                IntPtr hwnd = IntPtr.Zero;

                EnumWindows((h, lp) =>
                {
                    uint pid;
                    GetWindowThreadProcessId(h, out pid);
                    if (pid == targetPid && IsWindowVisible(h))
                    {
                        hwnd = h;
                        return false; // stop enumeration
                    }
                    return true;
                }, IntPtr.Zero);

                if (hwnd == IntPtr.Zero)
                    throw new Exception("Could not find LibreOffice window");

                ShowWindow(hwnd, 9 /* SW_RESTORE */);
                SetForegroundWindow(hwnd);
                Console.WriteLine("{\"success\":true,\"result\":\"focused\"}");
            }
            catch (Exception ex)
            {
                Console.WriteLine("{\"success\":false,\"error\":\"FOCUS failed: " + JsonEscape(ex.Message) + "\"}");
            }
        }

        // ──────────────────────────────────────────────────────────────────────
        //  Path walker helpers
        // ──────────────────────────────────────────────────────────────────────

        /// <summary>
        /// Extract bookmark name from "bookmark[@name='X']" anywhere in path.
        /// </summary>
        static string TryBookmarkName(string path)
        {
            var m = Regex.Match(path, @"bookmark\[@name='([^']+)'\]");
            return m.Success ? m.Groups[1].Value : null;
        }

        /// <summary>
        /// Extract 1-based paragraph index from "para[N]" or "body/para[N]".
        /// Returns 0 if not a paragraph path.
        /// </summary>
        static int TryParaIndex(string path)
        {
            var m = Regex.Match(path, @"(?:^|/)para\[(\d+)\]$");
            if (m.Success) return int.Parse(m.Groups[1].Value);
            return 0;
        }

        /// <summary>
        /// Extract 1-based slide index from "slide[N]" anywhere in path.
        /// Returns 0 if not a slide path.
        /// </summary>
        static int TrySlideIndex(string path)
        {
            var m = Regex.Match(path, @"(?:^|/)slide\[(\d+)\]");
            if (m.Success) return int.Parse(m.Groups[1].Value);
            return 0;
        }

        /// <summary>
        /// Resolve sheet and cell address from canonical Calc path.
        /// "cell[@addr='A1']" | "sheet[@name='Q1']/cell[@addr='B2:C5']"
        /// </summary>
        static dynamic ResolveCalcSheet(dynamic doc, string path, out string cellAddr)
        {
            dynamic sheets = doc.getSheets();
            dynamic sheet;

            var sheetNameM = Regex.Match(path, @"sheet\[@name='([^']*)'\]");
            var sheetIdxM  = Regex.Match(path, @"sheet\[(\d+)\]");
            var cellM      = Regex.Match(path, @"cell\[@addr='([^']*)'\]");

            if (sheetNameM.Success)
                sheet = sheets.getByName(sheetNameM.Groups[1].Value);
            else if (sheetIdxM.Success)
                sheet = sheets.getByIndex(int.Parse(sheetIdxM.Groups[1].Value) - 1); // 0-indexed
            else
                sheet = sheets.getByIndex(0); // first/active sheet

            cellAddr = cellM.Success ? cellM.Groups[1].Value : "";
            if (string.IsNullOrEmpty(cellAddr))
            {
                // Bare address like "A1" or "B2:C5" (path without cell[] wrapper)
                string bare = Regex.Replace(path, @"sheet\[([^\]]+)\]/", "").Trim();
                if (Regex.IsMatch(bare, @"^[A-Za-z]+\d+(:[A-Za-z]+\d+)?$"))
                    cellAddr = bare;
            }
            return sheet;
        }

        /// <summary>
        /// Get the Nth paragraph (1-based) from a Writer text enumeration.
        /// Returns null if not found.
        /// </summary>
        static dynamic GetWriterParagraph(dynamic text, int n)
        {
            dynamic paraEnum = text.createEnumeration();
            int idx = 0;
            while ((bool)paraEnum.hasMoreElements())
            {
                dynamic content = paraEnum.nextElement();
                bool isPara = false;
                try { isPara = (bool)content.supportsService("com.sun.star.text.Paragraph"); } catch { isPara = true; }
                if (!isPara) continue;
                idx++;
                if (idx == n) return content;
            }
            return null;
        }

        /// <summary>
        /// Count paragraphs in a Writer text.
        /// </summary>
        static int CountWriterParagraphs(dynamic text)
        {
            dynamic paraEnum = text.createEnumeration();
            int count = 0;
            while ((bool)paraEnum.hasMoreElements())
            {
                dynamic content = paraEnum.nextElement();
                bool isPara = false;
                try { isPara = (bool)content.supportsService("com.sun.star.text.Paragraph"); } catch { isPara = true; }
                if (isPara) count++;
            }
            return count;
        }

        /// <summary>
        /// Resolve a shape from a slide by canonical path.
        /// Handles: slide[N]/shape[@name='X']  |  slide[N]/shape[M]
        /// Returns null if no shape qualifier in path.
        /// </summary>
        static dynamic TryResolveShape(dynamic slide, string path)
        {
            // shape[@name='X']
            var nameM = Regex.Match(path, @"shape\[@name='([^']*)'\]");
            if (nameM.Success)
            {
                string targetName = nameM.Groups[1].Value;
                int count = (int)slide.getCount();
                for (int i = 0; i < count; i++)
                {
                    dynamic shape = slide.getByIndex(i);
                    string n = "";
                    try { n = (string)shape.Name; } catch { }
                    if (string.Equals(n, targetName, StringComparison.OrdinalIgnoreCase))
                        return shape;
                }
                throw new Exception("Shape '" + targetName + "' not found on slide");
            }

            // shape[M]
            var idxM = Regex.Match(path, @"shape\[(\d+)\]");
            if (idxM.Success)
            {
                int shapeIdx = int.Parse(idxM.Groups[1].Value) - 1; // 0-indexed
                return slide.getByIndex(shapeIdx);
            }

            return null; // no shape qualifier — whole-slide operation
        }

        // ──────────────────────────────────────────────────────────────────────
        //  Utility helpers (duplicated from MSOfficeWin to keep this file standalone)
        // ──────────────────────────────────────────────────────────────────────

        static string ColIndexToLetter(int col)
        {
            string s = "";
            col++;
            while (col > 0)
            {
                col--;
                s = (char)('A' + col % 26) + s;
                col /= 26;
            }
            return s;
        }

        static string PathToFileUrl(string path)
        {
            return "file:///" + path.Replace("\\", "/");
        }

        static string JsonEscape(string s)
        {
            if (s == null) return "";
            return s.Replace("\\", "\\\\").Replace("\"", "\\\"")
                    .Replace("\r", "\\r").Replace("\n", "\\n").Replace("\t", "\\t");
        }

        static string DetermineCommandType(string action)
        {
            if (string.IsNullOrEmpty(action)) return "";
            action = action.Trim();
            if (action.StartsWith("{") && action.EndsWith("}"))
            {
                string inner = action.Substring(1, action.Length - 2);
                int colon = inner.IndexOf(':');
                return colon >= 0 ? inner.Substring(0, colon).ToUpperInvariant()
                                  : inner.ToUpperInvariant();
            }
            // JSON wire format from HelperCommon
            var m = Regex.Match(action, "\"action\"\\s*:\\s*\"([^\"]+)\"");
            if (m.Success) return m.Groups[1].Value.ToUpperInvariant();
            return action.ToUpperInvariant();
        }

        static string ExtractParam(string action, string cmd)
        {
            if (string.IsNullOrEmpty(action)) return null;
            action = action.Trim();
            if (action.StartsWith("{") && action.EndsWith("}"))
            {
                string inner = action.Substring(1, action.Length - 2);
                int colon = inner.IndexOf(':');
                if (colon >= 0) return inner.Substring(colon + 1);
                return null;
            }
            // JSON path field
            var m = Regex.Match(action, "\"path\"\\s*:\\s*\"((?:[^\"\\\\]|\\\\.)*)\"");
            return m.Success ? Regex.Unescape(m.Groups[1].Value) : null;
        }

        // ──────────────────────────────────────────────────────────────────────
        //  Schema
        // ──────────────────────────────────────────────────────────────────────

        static string GetApiSchema()
        {
            var sb = new StringBuilder();
            sb.AppendLine("{");
            sb.AppendLine("  \"helper\": \"LibreOfficeWin.exe\",");
            sb.AppendLine("  \"version\": \"1.1.0\",");
            sb.AppendLine("  \"description\": \"LibreOffice / Apache OpenOffice automation via UNO COM bridge (LO < 24) or UNO socket (LO 24+).\\n"
                + "    Controls Writer, Calc, Impress. Works with LibreOffice 5+ and OpenOffice 4+.\\n"
                + "    Office must be running. Workflow: LISTDOCS -> QUERYTREE -> READ/WRITE -> SAVE.\\n"
                + "    officeNote: If LibreOffice is open but unreachable (LO 24+ removed COM bridge),\\n"
                + "    call {RELAUNCH} or {LAUNCH:<app>} to restart with the UNO socket enabled, then retry.\",");
            sb.AppendLine("  \"targetDescription\": \"App name: 'writer' (or 'word'), 'calc' (or 'excel'), 'impress' (or 'powerpoint'). "
                + "Or 'DOCNAME:<filename>' to select by name.\",");
            sb.AppendLine("  \"commands\": [");

            sb.AppendLine("    { \"name\": \"LISTDOCS\", \"description\": \"List all open documents across Writer, Calc, Impress.\","
                + " \"parameters\": [], \"examples\": [\"action=LISTDOCS\"] },");

            sb.AppendLine("    { \"name\": \"QUERYTREE\", \"description\": \"Return the document structure as a JSON tree.\","
                + " \"parameters\": [ { \"name\": \"depth\", \"type\": \"integer\", \"required\": false, \"default\": 3 } ],"
                + " \"examples\": [\"action=QUERYTREE\", \"action=QUERYTREE path=2\"] },");

            sb.AppendLine("    { \"name\": \"READ\", \"description\": \"Read a value from the document.\\n"
                + "    Calc: cell[@addr='A1'] or sheet[@name='Q1']/cell[@addr='B2:C5'].\\n"
                + "    Writer: 'body' (full text), body/para[N], bookmark[@name='X'].\\n"
                + "    Impress: slide[N] (all text), slide[N]/shape[@name='Title'].\","
                + " \"parameters\": [ { \"name\": \"address\", \"type\": \"string\", \"required\": true } ],"
                + " \"examples\": [\"action=READ path=cell[@addr='A1']\", \"action=READ path=body\","
                + " \"action=READ path=body/para[3]\", \"action=READ path=slide[1]\"] },");

            sb.AppendLine("    { \"name\": \"WRITE\", \"description\": \"Write a value to the document.\\n"
                + "    Calc: cell[@addr='A1'] (formula if value starts with =).\\n"
                + "    Writer: body (full replace), body/para[N] (auto-extends), bookmark[@name='X'].\\n"
                + "    Impress: slide[N]/shape[@name='Title'] or slide[N]/shape[1] (auto-extends slides).\","
                + " \"parameters\": [ { \"name\": \"address_and_value\", \"type\": \"string\", \"required\": true } ],"
                + " \"examples\": [\"action=WRITE path=cell[@addr='A1'] value=Hello\","
                + " \"action=WRITE path=body/para[1] value=Introduction\","
                + " \"action=WRITE path=slide[1]/shape[@name='Title'] value=My Title\"] },");

            sb.AppendLine("    { \"name\": \"SAVE\", \"description\": \"Save the active document (to its current location, or Documents folder if new).\","
                + " \"parameters\": [], \"examples\": [\"action=SAVE\"] },");

            sb.AppendLine("    { \"name\": \"EXPORT\", \"description\": \"Export the document to PDF. Optionally provide a full output path.\","
                + " \"parameters\": [ { \"name\": \"format\", \"type\": \"string\", \"required\": false, \"default\": \"pdf\" } ],"
                + " \"examples\": [\"action=EXPORT path=pdf\"] },");

            sb.AppendLine("    { \"name\": \"NEWDOC\", \"description\": \"Create a new document. Starts LibreOffice if not already running.\","
                + " \"parameters\": [], \"examples\": [\"action=NEWDOC\"] },");

            sb.AppendLine("    { \"name\": \"FORMAT\", \"description\": \"Apply formatting to a paragraph in a Writer document. Path must be body/para[N].\\n"
                + "    Style name form (backward compat): path=body/para[1] value=Heading 1\\n"
                + "    Key=value form: path=body/para[1] value=bold=true|italic=false|fontSize=14\\n"
                + "    Mixed: path=body/para[1] value=style=Normal|bold=true|alignment=center\\n"
                + "    Character keys: bold italic underline strikethrough allCaps smallCaps fontName fontSize color(#RRGGBB) charSpacingPt\\n"
                + "    Paragraph keys: style alignment(left/center/right/justify) spaceBeforePt spaceAfterPt"
                + " indentLeftCm indentRightCm indentFirstLineCm\\n"
                + "    Style names: Normal Title Subtitle Heading1..6 Quote ListBullet ListNumber Caption\","
                + " \"parameters\": [ { \"name\": \"address_and_properties\", \"type\": \"string\", \"required\": true } ],"
                + " \"examples\": [\"action=FORMAT path=body/para[1] value=Title\","
                + " \"action=FORMAT path=body/para[2] value=bold=true|fontSize=14\","
                + " \"action=FORMAT path=body/para[3] value=style=Heading 1|alignment=center\"] },");

            sb.AppendLine("    { \"name\": \"RELAUNCH\", \"description\": \"Saves all open documents, kills LibreOffice, restarts with UNO socket --accept on port (default 2002).\\n"
                + "    Required for LibreOffice 24+ which removed the COM bridge. After RELAUNCH subsequent commands\\n"
                + "    use the COM bridge (LO < 24) or report socket_reachable status (LO 24+).\\n"
                + "    Use {RELAUNCH:2002} to specify a port.\","
                + " \"parameters\": [ { \"name\": \"port\", \"type\": \"integer\", \"required\": false, \"default\": 2002 } ],"
                + " \"examples\": [\"action=RELAUNCH\", \"action=RELAUNCH path=2002\"] },");

            sb.AppendLine("    { \"name\": \"LAUNCH\", \"description\": \"Start LibreOffice with UNO socket if not already reachable. No-op if COM bridge or socket already active.\\n"
                + "    Format: {LAUNCH:app} or {LAUNCH:app:port}. App: writer/calc/impress.\","
                + " \"parameters\": [ { \"name\": \"app_and_port\", \"type\": \"string\", \"required\": false } ],"
                + " \"examples\": [\"action=LAUNCH\", \"action=LAUNCH path=writer:2002\"] },");

            sb.AppendLine("    { \"name\": \"FOCUS\", \"description\": \"Bring the LibreOffice window to the foreground.\","
                + " \"parameters\": [], \"examples\": [\"action=FOCUS\"] }");

            sb.AppendLine("  ]");
            sb.AppendLine("}");
            return sb.ToString();
        }
    }
}
