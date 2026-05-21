// MSOfficeWin.exe — Microsoft Office automation helper for AIAPI
// Controls Word, Excel, PowerPoint via COM late-binding (dynamic).
// No Office PIA DLLs required at compile time; only Microsoft.CSharp.dll for `dynamic`.
//
// Part of the Office helper family:
//   MSOfficeWin.exe  — Microsoft Office on Windows (this file)
//   WPSOfficeWin.exe — WPS Office on Windows (future)
//   MSOfficeMac      — Microsoft Office on macOS (future, .NET 6+)
//   LibreOfficeWin   — LibreOffice on Windows via UNO COM bridge (future)
//   LibreOfficeLin   — LibreOffice on Linux via UNO socket (future)
//   LibreOfficeMac   — LibreOffice on macOS via UNO socket (future)
//   iWorksMac        — Apple iWork (Pages/Numbers/Keynote) on macOS (future)
//
// Usage:
//   MSOfficeWin.exe --api-schema
//   MSOfficeWin.exe <target> <{COMMAND[:param]}>
//   MSOfficeWin.exe --listen-stdin [--persistent]
//
// Target formats:
//   excel              — first running Excel instance
//   word               — first running Word instance
//   powerpoint         — first running PowerPoint instance
//   DOCNAME:<name>     — search all apps for document with matching Name
//   PROC:<exe>         — map WINWORD.EXE/EXCEL.EXE/POWERPNT.EXE to app type

using System;
using System.Collections.Generic;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;

namespace MSOfficeWin
{
    class Program
    {
        // ──────────────────────────────────────────────────────────────────────
        //  Win32 P/Invoke declarations
        // ──────────────────────────────────────────────────────────────────────

        [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr hWnd);
        [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
        [DllImport("kernel32.dll")] static extern bool ProcessIdToSessionId(uint dwProcessId, out uint pSessionId);
        [DllImport("kernel32.dll")] static extern uint WTSGetActiveConsoleSessionId();

        // ── QA-3: Session 0 detection ─────────────────────────────────────────
        static bool IsSession0()
        {
            try {
                uint sid = 0;
                ProcessIdToSessionId((uint)System.Diagnostics.Process.GetCurrentProcess().Id, out sid);
                return sid == 0;
            } catch { return false; }
        }
        static string BuildSessionWarning(string operation)
        {
            uint cs = WTSGetActiveConsoleSessionId();
            string sessionLabel = cs == uint.MaxValue ? "N/A (no user logged in)" : cs.ToString();
            return "MSOfficeWin is running in Windows Session 0 (service context). "
                + operation + " cannot access COM objects from Session 0 — the COM Running Object Table is per-session. "
                + "User's Word/Excel/PowerPoint instances are in Session " + sessionLabel + " and are not visible from Session 0. "
                + "Fix: use VSIX dev mode (port 3457) or Task Scheduler interactive task. "
                + "See docs/specs/SESSION0_ISOLATION.md for details.";
        }

        // ──────────────────────────────────────────────────────────────────────
        //  Entry point
        // ──────────────────────────────────────────────────────────────────────

        static int Main(string[] args)
        {
            try
            {
                if (args.Length == 0)
                {
                    Console.Error.WriteLine("Usage: MSOfficeWin.exe --api-schema");
                    Console.Error.WriteLine("       MSOfficeWin.exe <target> <{COMMAND[:param]}>");
                    Console.Error.WriteLine("       MSOfficeWin.exe --listen-stdin [--persistent]");
                    return 1;
                }

                if (args[0] == "--api-schema")
                {
                    Console.WriteLine(GetApiSchema());
                    return 0;
                }

                if (args[0] == "--version")
                {
                    Console.WriteLine("MSOfficeWin.exe 1.0.0");
                    return 0;
                }

                // ── stdin-pipe mode (HelperRegistry) ──────────────────────────
                if (args[0] == "--listen-stdin")
                {
                    bool skipAuth = string.Equals(
                        Environment.GetEnvironmentVariable("SKIP_SESSION_AUTH"),
                        "true", StringComparison.OrdinalIgnoreCase);
                    var authState = HelperCommon.RunAuthHandshake(skipAuth);

                    bool persistent = HelperCommon.HasFlag(args, "--persistent");
                    return HelperCommon.RunStdinListener(persistent, DispatchCommand, GetApiSchema, authState);
                }

                // ── HTTP listener mode ─────────────────────────────────────────
                {
                    string listenPort = HelperCommon.GetFlagValue(args, "--listen-port");
                    if (listenPort != null)
                    {
                        int port = 0;
                        if (listenPort.Length == 0 ||
                            !int.TryParse(listenPort, out port) || port <= 0 || port > 65535)
                        {
                            Console.Error.WriteLine("MSOfficeWin: --listen-port requires a valid port number");
                            return 1;
                        }
                        return HelperCommon.RunHttpListener(port, DispatchCommand, GetApiSchema);
                    }
                }

                // ── Named pipe listener mode ───────────────────────────────────
                {
                    string pipeName = HelperCommon.GetFlagValue(args, "--listen-pipe");
                    if (pipeName != null)
                    {
                        if (pipeName.Length == 0)
                        {
                            Console.Error.WriteLine("MSOfficeWin: --listen-pipe requires a pipe name");
                            return 1;
                        }
                        return HelperCommon.RunNamedPipeListener(pipeName, DispatchCommand, GetApiSchema);
                    }
                }

                // ── inject-mode (HelperRegistry callCommand) ──────────────────
                if (args[0] == "--inject-mode=direct" && args.Length >= 2)
                {
                    string tmpFile = args[1];
                    if (!System.IO.File.Exists(tmpFile))
                    {
                        Console.Error.WriteLine("AIAPI: inject-mode file not found: " + tmpFile);
                        return 1;
                    }
                    string[] lines = System.IO.File.ReadAllLines(tmpFile);
                    string tgt = lines.Length > 0 ? lines[0].Trim() : "";
                    string act = lines.Length > 1 ? lines[1].Trim() : "";
                    DispatchCommand(tgt, act);
                    return 0;
                }

                // ── Direct command: OfficeWin.exe <target> <{COMMAND:param}> ──
                if (args.Length >= 2)
                {
                    DispatchCommand(args[0], args[1]);
                    return 0;
                }

                Console.Error.WriteLine("MSOfficeWin.exe: invalid arguments");
                return 1;
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine("MSOfficeWin fatal: " + ex.Message);
                return 1;
            }
        }

        // ──────────────────────────────────────────────────────────────────────
        //  Command dispatch
        // ──────────────────────────────────────────────────────────────────────

        static void DispatchCommand(string target, string action)
        {
            // QA-3: ALL MSOfficeWin commands require COM ROT access which is per-session.
            // Session 0 (Windows Service context) cannot see user's running Office instances.
            if (IsSession0())
            {
                string sw = BuildSessionWarning(DetermineCommandType(action));
                Console.Error.WriteLine("AIAPI SESSION0 WARNING: MSOfficeWin cannot access COM objects from Session 0 (COM ROT is per-session). All Office automation commands require running in the user's interactive session.");
                Console.WriteLine("{\"success\":false,\"error\":\"Session 0: MSOfficeWin cannot reach user Office instances — COM ROT is per-session.\",\"_sessionWarning\":\"" + JsonEscape(sw) + "\"}");
                return;
            }

            // Strip optional SCROLL_ prefix added by HelperCommon when scroll=true.
            // Office helpers work via COM and don't have a screen-scroll concept,
            // so the flag is silently consumed here.
            if (action.Length > 8 && action.StartsWith("{SCROLL_", StringComparison.OrdinalIgnoreCase))
                action = "{" + action.Substring(8);

            string cmdType = DetermineCommandType(action);

            // Commands that don't need a resolved document
            if (cmdType == "LISTDOCS")
            {
                CmdListDocs();
                return;
            }

            // NEWDOC starts the app itself — run before ResolveDocument
            if (cmdType == "NEWDOC")
            {
                string at = NormaliseAppType(target);
                CmdNewDoc(at);
                return;
            }

            // FOCUS brings the app window to the foreground (cooperative/showcase mode)
            if (cmdType == "FOCUS")
            {
                string at = NormaliseAppType(target);
                CmdFocus(at);
                return;
            }

            // All other commands need an active document
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

                case "EXEC_MACRO":
                    CmdExecMacro(doc, appType, ExtractParam(action, "EXEC_MACRO") ?? "");
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
        //  COM target resolution
        // ──────────────────────────────────────────────────────────────────────

        /// <summary>
        /// Returns normalised app type ("excel", "word", "powerpoint") from a target string.
        /// </summary>
        static string NormaliseAppType(string target)
        {
            if (string.IsNullOrEmpty(target)) return "excel";
            if (target.StartsWith("PROC:", StringComparison.OrdinalIgnoreCase))
            {
                string proc = target.Substring(5).ToUpperInvariant();
                if (proc.Contains("EXCEL"))  return "excel";
                if (proc.Contains("WORD") || proc.Contains("WINWORD")) return "word";
                if (proc.Contains("POWERPNT") || proc.Contains("PPT"))  return "powerpoint";
                return "";
            }
            return target.ToLowerInvariant();
        }

        /// <summary>
        /// Resolves a target string to an active Office document COM object.
        /// Returns (doc, appType) where appType is "excel", "word", or "powerpoint".
        /// doc is the ActiveDocument / ActiveWorkbook / ActivePresentation as dynamic.
        /// </summary>
        static dynamic ResolveDocument(string target, out string appType)
        {
            appType = "";
            if (string.IsNullOrEmpty(target)) target = "excel";

            // Normalise PROC: abbreviations
            if (target.StartsWith("PROC:", StringComparison.OrdinalIgnoreCase))
            {
                string proc = target.Substring(5).ToUpperInvariant();
                if (proc.Contains("EXCEL"))  target = "excel";
                else if (proc.Contains("WORD") || proc.Contains("WINWORD")) target = "word";
                else if (proc.Contains("POWERPNT") || proc.Contains("PPT")) target = "powerpoint";
                else { return null; }
            }

            // DOCNAME: search all running apps
            if (target.StartsWith("DOCNAME:", StringComparison.OrdinalIgnoreCase))
            {
                string docName = target.Substring(8);
                foreach (string at in new[] { "excel", "word", "powerpoint" })
                {
                    dynamic app = TryGetApp(at);
                    if (app == null) continue;
                    dynamic found = FindDocByName(app, at, docName);
                    if (found != null) { appType = at; return found; }
                }
                return null;
            }

            target = target.ToLowerInvariant();
            appType = target;

            dynamic officeApp = TryGetApp(target);
            if (officeApp == null) return null;

            try
            {
                switch (target)
                {
                    case "excel":      return officeApp.ActiveWorkbook;
                    case "word":       return officeApp.ActiveDocument;
                    case "powerpoint": return officeApp.ActivePresentation;
                    default:           return null;
                }
            }
            catch { return null; }
        }

        static dynamic TryGetApp(string appType)
        {
            string progId = AppTypeToProgId(appType);
            if (progId == null) return null;
            try
            {
                return Marshal.GetActiveObject(progId);
            }
            catch (COMException) { return null; }
            catch (Exception)    { return null; }
        }

        static string AppTypeToProgId(string appType)
        {
            switch (appType.ToLowerInvariant())
            {
                case "excel":      return "Excel.Application";
                case "word":       return "Word.Application";
                case "powerpoint": return "PowerPoint.Application";
                default:           return null;
            }
        }

        static dynamic FindDocByName(dynamic app, string appType, string docName)
        {
            try
            {
                dynamic docs = null;
                switch (appType)
                {
                    case "excel":      docs = app.Workbooks;    break;
                    case "word":       docs = app.Documents;    break;
                    case "powerpoint": docs = app.Presentations; break;
                }
                if (docs == null) return null;
                int count = docs.Count;
                for (int i = 1; i <= count; i++)
                {
                    dynamic d = docs.Item(i);
                    string name = (string)d.Name;
                    if (string.Equals(name, docName, StringComparison.OrdinalIgnoreCase))
                        return d;
                }
            }
            catch { }
            return null;
        }

        // ──────────────────────────────────────────────────────────────────────
        //  LISTDOCS
        // ──────────────────────────────────────────────────────────────────────

        static void CmdListDocs()
        {
            var sb = new StringBuilder();
            sb.Append("[");
            bool first = true;

            foreach (string appType in new[] { "excel", "word", "powerpoint" })
            {
                dynamic app = TryGetApp(appType);
                if (app == null) continue;
                try
                {
                    dynamic docs = null;
                    switch (appType)
                    {
                        case "excel":      docs = app.Workbooks;     break;
                        case "word":       docs = app.Documents;     break;
                        case "powerpoint": docs = app.Presentations; break;
                    }
                    if (docs == null) continue;
                    int count = docs.Count;
                    for (int i = 1; i <= count; i++)
                    {
                        dynamic d = docs.Item(i);
                        string name = "";
                        string path = "";
                        bool saved  = true;
                        try { name = (string)d.Name;  } catch { }
                        try { path = (string)d.Path;  } catch { }
                        try { saved = (bool)d.Saved;  } catch { }

                        if (!first) sb.Append(",");
                        sb.Append("{");
                        sb.Append("\"app\":\"").Append(appType).Append("\"");
                        sb.Append(",\"name\":\"").Append(JsonEscape(name)).Append("\"");
                        sb.Append(",\"path\":\"").Append(JsonEscape(path)).Append("\"");
                        sb.Append(",\"saved\":").Append(saved ? "true" : "false");
                        sb.Append("}");
                        first = false;
                    }
                }
                catch { }
            }

            sb.Append("]");
            Console.WriteLine("{\"success\":true,\"result\":" + sb + "}");
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
                    case "excel":      tree = QueryTreeExcel(doc, depth); break;
                    case "word":       tree = QueryTreeWord(doc, depth);  break;
                    case "powerpoint": tree = QueryTreePowerPoint(doc, depth); break;
                    default:           tree = "{}"; break;
                }
                Console.WriteLine("{\"success\":true,\"result\":" + tree + "}");
            }
            catch (Exception ex)
            {
                Console.WriteLine("{\"success\":false,\"error\":\"QUERYTREE failed: "
                    + JsonEscape(ex.Message) + "\"}");
            }
        }

        static string QueryTreeExcel(dynamic wb, int depth)
        {
            var sb = new StringBuilder();
            string wbName = "";
            string wbPath = "";
            try { wbName = (string)wb.Name; } catch { }
            try { wbPath = (string)wb.Path; } catch { }

            sb.Append("{");
            sb.Append("\"id\":\"workbook\",\"type\":\"Workbook\"");
            sb.Append(",\"name\":\"").Append(JsonEscape(wbName)).Append("\"");
            sb.Append(",\"properties\":{\"path\":\"").Append(JsonEscape(wbPath)).Append("\"}");
            sb.Append(",\"actions\":[\"READ\",\"WRITE\",\"SAVE\",\"EXPORT\",\"EXEC_MACRO\"]");

            if (depth >= 2)
            {
                sb.Append(",\"children\":[");
                bool firstSheet = true;
                try
                {
                    dynamic sheets = wb.Worksheets;
                    int count = sheets.Count;
                    for (int i = 1; i <= count; i++)
                    {
                        dynamic sheet = sheets.Item(i);
                        string sheetName = "";
                        string usedRange = "";
                        int sheetIdx = i;
                        try { sheetName = (string)sheet.Name; } catch { }
                        try
                        {
                            dynamic ur = sheet.UsedRange;
                            string addr = (string)ur.Address;
                            // Normalize $A$1:$D$10 → A1:D10
                            usedRange = addr.Replace("$", "");
                        }
                        catch { }

                        if (!firstSheet) sb.Append(",");
                        sb.Append("{");
                        sb.Append("\"id\":\"sheet_").Append(i).Append("\"");
                        sb.Append(",\"type\":\"Worksheet\"");
                        sb.Append(",\"name\":\"").Append(JsonEscape(sheetName)).Append("\"");
                        sb.Append(",\"properties\":{\"index\":").Append(sheetIdx);
                        sb.Append(",\"usedRange\":\"").Append(JsonEscape(usedRange)).Append("\"}");
                        sb.Append(",\"actions\":[\"READ\",\"WRITE\"]");

                        // Depth 3: enumerate cells in used range (capped at 200)
                        if (depth >= 3 && !string.IsNullOrEmpty(usedRange))
                        {
                            sb.Append(",\"children\":[");
                            bool firstCell = true;
                            try
                            {
                                dynamic ur = sheet.UsedRange;
                                int rows = ur.Rows.Count;
                                int cols = ur.Columns.Count;
                                int cellLimit = 200;
                                int cellCount = 0;
                                for (int r = 1; r <= rows && cellCount < cellLimit; r++)
                                {
                                    for (int c = 1; c <= cols && cellCount < cellLimit; c++)
                                    {
                                        dynamic cell = ur.Cells(r, c);
                                        string addr2  = ((string)cell.Address).Replace("$", "");
                                        string val    = "";
                                        string formula = "";
                                        try { val = FormatCellValue(cell.Value2); } catch { }
                                        try { formula = (string)cell.Formula; if (formula == val) formula = ""; } catch { }

                                        if (!firstCell) sb.Append(",");
                                        sb.Append("{");
                                        sb.Append("\"id\":\"cell_").Append(addr2).Append("\"");
                                        sb.Append(",\"type\":\"Cell\"");
                                        sb.Append(",\"name\":\"").Append(addr2).Append("\"");
                                        sb.Append(",\"value\":\"").Append(JsonEscape(val)).Append("\"");
                                        sb.Append(",\"properties\":{\"formula\":\"").Append(JsonEscape(formula)).Append("\"}");
                                        sb.Append(",\"actions\":[\"READ\",\"WRITE\"]");
                                        sb.Append("}");
                                        firstCell = false;
                                        cellCount++;
                                    }
                                }
                            }
                            catch { }
                            sb.Append("]");
                        }

                        sb.Append("}");
                        firstSheet = false;
                    }
                }
                catch { }
                sb.Append("]");
            }

            sb.Append("}");
            return sb.ToString();
        }

        static string QueryTreeWord(dynamic doc, int depth)
        {
            var sb = new StringBuilder();
            string docName = "";
            string docPath = "";
            int wordCount = 0;
            int paraCount = 0;
            try { docName  = (string)doc.Name;                   } catch { }
            try { docPath  = (string)doc.Path;                   } catch { }
            try { wordCount = (int)doc.Words.Count;              } catch { }
            try { paraCount = (int)doc.Paragraphs.Count;         } catch { }

            sb.Append("{");
            sb.Append("\"id\":\"doc\",\"type\":\"Document\"");
            sb.Append(",\"name\":\"").Append(JsonEscape(docName)).Append("\"");
            sb.Append(",\"properties\":{");
            sb.Append("\"path\":\"").Append(JsonEscape(docPath)).Append("\"");
            sb.Append(",\"wordCount\":").Append(wordCount);
            sb.Append(",\"paragraphCount\":").Append(paraCount);
            sb.Append("}");
            sb.Append(",\"actions\":[\"READ\",\"WRITE\",\"SAVE\",\"EXPORT\"]");

            if (depth >= 2)
            {
                sb.Append(",\"children\":[");
                bool firstChild = true;

                // Paragraphs (cap at 100)
                try
                {
                    dynamic paras = doc.Paragraphs;
                    int total = paras.Count;
                    int limit = Math.Min(total, 100);
                    for (int i = 1; i <= limit; i++)
                    {
                        dynamic para = paras.Item(i);
                        string text = "";
                        string style = "";
                        try { text  = ((string)para.Range.Text).TrimEnd('\r', '\n', '\a'); } catch { }
                        try { style = (string)para.Style.NameLocal; } catch { }

                        if (!firstChild) sb.Append(",");
                        sb.Append("{");
                        sb.Append("\"id\":\"para_").Append(i).Append("\"");
                        sb.Append(",\"type\":\"Paragraph\"");
                        sb.Append(",\"name\":\"Paragraph ").Append(i).Append("\"");
                        sb.Append(",\"value\":\"").Append(JsonEscape(TruncateStr(text, 120))).Append("\"");
                        sb.Append(",\"properties\":{\"index\":").Append(i);
                        sb.Append(",\"style\":\"").Append(JsonEscape(style)).Append("\"}");
                        sb.Append(",\"actions\":[\"READ\",\"WRITE\"]");
                        sb.Append("}");
                        firstChild = false;
                    }
                    if (total > limit)
                    {
                        if (!firstChild) sb.Append(",");
                        sb.Append("{\"id\":\"para_more\",\"type\":\"Ellipsis\",\"name\":\"...(")
                          .Append(total - limit).Append(" more paragraphs)\",\"value\":\"\"}");
                    }
                }
                catch { }

                // Bookmarks
                try
                {
                    dynamic bmarks = doc.Bookmarks;
                    int bcount = bmarks.Count;
                    for (int i = 1; i <= bcount; i++)
                    {
                        dynamic bm = bmarks.Item(i);
                        string bmName = (string)bm.Name;
                        if (!firstChild) sb.Append(",");
                        sb.Append("{");
                        sb.Append("\"id\":\"bookmark_").Append(JsonEscape(bmName)).Append("\"");
                        sb.Append(",\"type\":\"Bookmark\"");
                        sb.Append(",\"name\":\"").Append(JsonEscape(bmName)).Append("\"");
                        sb.Append(",\"actions\":[\"READ\",\"WRITE\"]");
                        sb.Append("}");
                        firstChild = false;
                    }
                }
                catch { }

                sb.Append("]");
            }

            sb.Append("}");
            return sb.ToString();
        }

        static string QueryTreePowerPoint(dynamic pres, int depth)
        {
            var sb = new StringBuilder();
            string presName = "";
            string presPath = "";
            int slideCount = 0;
            try { presName  = (string)pres.Name;         } catch { }
            try { presPath  = (string)pres.Path;         } catch { }
            try { slideCount = (int)pres.Slides.Count;   } catch { }

            sb.Append("{");
            sb.Append("\"id\":\"presentation\",\"type\":\"Presentation\"");
            sb.Append(",\"name\":\"").Append(JsonEscape(presName)).Append("\"");
            sb.Append(",\"properties\":{\"path\":\"").Append(JsonEscape(presPath)).Append("\"");
            sb.Append(",\"slideCount\":").Append(slideCount).Append("}");
            sb.Append(",\"actions\":[\"READ\",\"WRITE\",\"SAVE\",\"EXPORT\"]");

            if (depth >= 2)
            {
                sb.Append(",\"children\":[");
                bool firstSlide = true;
                try
                {
                    dynamic slides = pres.Slides;
                    int count = slides.Count;
                    for (int i = 1; i <= count; i++)
                    {
                        dynamic slide = slides.Item(i);
                        string slideTitle = "";
                        int shapeCount = 0;
                        try
                        {
                            // Try to get the title shape
                            dynamic titleShape = slide.Shapes.Title;
                            slideTitle = (string)titleShape.TextFrame.TextRange.Text;
                        }
                        catch { }
                        try { shapeCount = (int)slide.Shapes.Count; } catch { }

                        if (!firstSlide) sb.Append(",");
                        sb.Append("{");
                        sb.Append("\"id\":\"slide_").Append(i).Append("\"");
                        sb.Append(",\"type\":\"Slide\"");
                        sb.Append(",\"name\":\"Slide ").Append(i).Append("\"");
                        sb.Append(",\"value\":\"").Append(JsonEscape(slideTitle)).Append("\"");
                        sb.Append(",\"properties\":{\"index\":").Append(i);
                        sb.Append(",\"shapeCount\":").Append(shapeCount).Append("}");
                        sb.Append(",\"actions\":[\"READ\",\"WRITE\"]");

                        if (depth >= 3)
                        {
                            sb.Append(",\"children\":[");
                            bool firstShape = true;
                            try
                            {
                                dynamic shapes = slide.Shapes;
                                int sc = shapes.Count;
                                for (int si = 1; si <= sc; si++)
                                {
                                    dynamic shape = shapes.Item(si);
                                    string shapeName = "";
                                    string shapeText = "";
                                    try { shapeName = (string)shape.Name;                        } catch { }
                                    try { shapeText = (string)shape.TextFrame.TextRange.Text;    } catch { }

                                    if (!firstShape) sb.Append(",");
                                    sb.Append("{");
                                    sb.Append("\"id\":\"slide_").Append(i).Append("_shape_").Append(si).Append("\"");
                                    sb.Append(",\"type\":\"Shape\"");
                                    sb.Append(",\"name\":\"").Append(JsonEscape(shapeName)).Append("\"");
                                    sb.Append(",\"value\":\"").Append(JsonEscape(shapeText)).Append("\"");
                                    sb.Append(",\"actions\":[\"READ\",\"WRITE\"]");
                                    sb.Append("}");
                                    firstShape = false;
                                }
                            }
                            catch { }
                            sb.Append("]");
                        }

                        sb.Append("}");
                        firstSlide = false;
                    }
                }
                catch { }
                sb.Append("]");
            }

            sb.Append("}");
            return sb.ToString();
        }

        // ══════════════════════════════════════════════════════════════════════
        //  ComPathWalker — canonical XPath-like path evaluator for Office COM
        // ══════════════════════════════════════════════════════════════════════
        //
        //  Segment grammar (CONVENTIONS.md §2.3):
        //    bare          body
        //    indexed       para[3]   slide[2]   shape[1]
        //    attributed    cell[@addr='A1']   sheet[@name='Q1']
        //                  bookmark[@name='Ref']   shape[@name='Title']
        //
        //  Supported tags:
        //    Word        body | para | bookmark
        //    Excel       sheet | cell | range
        //    PowerPoint  slide | shape | text

        struct PathSegment
        {
            public string Tag;       // lower-cased tag name
            public string AttrName;  // e.g. "addr", "name" — null if none
            public string AttrValue; // the quoted value — null if none
            public int    Index;     // 1-based; 0 = not set
        }

        static readonly Regex RxSegIdx  = new Regex(@"^(\w+)\[(\d+)\]$",            RegexOptions.Compiled);
        static readonly Regex RxSegAttr = new Regex(@"^(\w+)\[@(\w+)='([^']*)'\]$", RegexOptions.Compiled);

        static PathSegment ParsePathSegment(string seg)
        {
            var m = RxSegIdx.Match(seg);
            if (m.Success)
                return new PathSegment
                {
                    Tag   = m.Groups[1].Value.ToLowerInvariant(),
                    Index = int.Parse(m.Groups[2].Value)
                };
            var m2 = RxSegAttr.Match(seg);
            if (m2.Success)
                return new PathSegment
                {
                    Tag       = m2.Groups[1].Value.ToLowerInvariant(),
                    AttrName  = m2.Groups[2].Value.ToLowerInvariant(),
                    AttrValue = m2.Groups[3].Value
                };
            return new PathSegment { Tag = seg.Trim().ToLowerInvariant() };
        }

        /// <summary>
        /// Walk <paramref name="root"/> along the canonical <paramref name="canonicalPath"/>
        /// and return the leaf COM object.
        /// Sets <paramref name="finalTag"/> to the lower-cased last segment tag so callers
        /// can choose the correct read/write COM API (para → Range.Text, cell → Value2, etc.).
        /// </summary>
        static dynamic ComPathEval(dynamic root, string canonicalPath, out string finalTag)
        {
            finalTag = "";
            if (string.IsNullOrEmpty(canonicalPath))
                return root;

            dynamic obj = root;
            foreach (string part in canonicalPath.Split(new[] { '/' }, StringSplitOptions.RemoveEmptyEntries))
            {
                var seg = ParsePathSegment(part);
                finalTag = seg.Tag;
                obj = ComPathStep(obj, seg);
            }
            return obj;
        }

        static dynamic ComPathStep(dynamic obj, PathSegment seg)
        {
            switch (seg.Tag)
            {
                // ── Word ──────────────────────────────────────────────────────
                case "body":
                    return obj.Content;                         // Document → Range

                case "para":
                {
                    int n = seg.Index > 0 ? seg.Index
                          : (seg.AttrName == "n" && !string.IsNullOrEmpty(seg.AttrValue)
                             ? int.Parse(seg.AttrValue) : 1);
                    return obj.Paragraphs.Item(n);              // Document/Range → Paragraph
                }

                case "bookmark":
                {
                    string bmName = seg.AttrName == "name" ? seg.AttrValue : (seg.AttrValue ?? "");
                    return obj.Bookmarks(bmName);               // Document → Bookmark
                }

                // ── Excel ─────────────────────────────────────────────────────
                case "sheet":
                case "worksheet":
                {
                    if (seg.AttrName == "name" && !string.IsNullOrEmpty(seg.AttrValue))
                        return obj.Worksheets(seg.AttrValue);   // Workbook → Worksheet (by name)
                    if (seg.Index > 0)
                        return obj.Worksheets(seg.Index);       // Workbook → Worksheet (by index)
                    return obj.ActiveSheet;
                }

                case "cell":
                case "range":
                {
                    string addr = seg.AttrName == "addr" ? seg.AttrValue : seg.AttrValue;
                    if (string.IsNullOrEmpty(addr))
                        throw new Exception("ComPathWalker: cell/range requires @addr attribute");
                    try   { return obj.Range(addr); }           // Worksheet → Range
                    catch { return obj.ActiveSheet.Range(addr); }// Workbook fallback
                }

                // ── PowerPoint ────────────────────────────────────────────────
                case "slide":
                {
                    int n = seg.Index > 0 ? seg.Index
                          : (seg.AttrName == "n" && !string.IsNullOrEmpty(seg.AttrValue)
                             ? int.Parse(seg.AttrValue) : 1);
                    return obj.Slides.Item(n);                  // Presentation → Slide
                }

                case "shape":
                {
                    if (seg.Index > 0)
                        return obj.Shapes.Item(seg.Index);
                    if (seg.AttrName == "name" && !string.IsNullOrEmpty(seg.AttrValue))
                        return obj.Shapes(seg.AttrValue);
                    int shapeNum;
                    if (!string.IsNullOrEmpty(seg.AttrValue) &&
                        int.TryParse(seg.AttrValue, out shapeNum))
                        return obj.Shapes.Item(shapeNum);
                    return obj.Shapes.Item(1);
                }

                case "text":
                case "textframe":
                    return obj.TextFrame.TextRange;             // Shape → TextRange

                default:
                    throw new Exception("ComPathWalker: unsupported tag '" + seg.Tag
                        + "'. Supported: body, para, bookmark, sheet, cell, slide, shape, text");
            }
        }

        /// <summary>
        /// Extract 1-based paragraph index from a canonical path such as
        /// "para[3]", "body/para[3]", or "body/para[@n='3']".
        /// Returns 0 if the path does not address a paragraph.
        /// </summary>
        static int TryParaIndex(string path)
        {
            var m = Regex.Match(path, @"(?:^|/)para\[(\d+)\]$");
            if (m.Success) return int.Parse(m.Groups[1].Value);
            var m2 = Regex.Match(path, @"(?:^|/)para\[@n='(\d+)'\]$");
            if (m2.Success) return int.Parse(m2.Groups[1].Value);
            return 0;
        }

        /// <summary>
        /// Extract bookmark name from "bookmark[@name='X']" anywhere in the path.
        /// Returns null if the path does not contain a bookmark segment.
        /// </summary>
        static string TryBookmarkName(string path)
        {
            var m = Regex.Match(path, @"bookmark\[@name='([^']+)'\]");
            return m.Success ? m.Groups[1].Value : null;
        }

        // ──────────────────────────────────────────────────────────────────────
        //  READ
        // ──────────────────────────────────────────────────────────────────────
        //  Excel:       {READ:cell[@addr='A1']}  {READ:sheet[@name='Q1']/cell[@addr='B2:C5']}
        //  Word:        {READ:body}  {READ:body/para[3]}  {READ:bookmark[@name='MyMark']}
        //  PowerPoint:  {READ:slide[2]}  {READ:slide[2]/shape[@name='Title']}

        static void CmdRead(dynamic doc, string appType, string param)
        {
            try
            {
                string result;
                switch (appType)
                {
                    case "excel":      result = ReadExcel(doc, param); break;
                    case "word":       result = ReadWord(doc, param);  break;
                    case "powerpoint": result = ReadPowerPoint(doc, param); break;
                    default:           result = ""; break;
                }
                Console.WriteLine("{\"success\":true,\"result\":\"" + JsonEscape(result) + "\"}");
            }
            catch (Exception ex)
            {
                Console.WriteLine("{\"success\":false,\"error\":\"READ failed: "
                    + JsonEscape(ex.Message) + "\"}");
            }
        }

        static string ReadExcel(dynamic wb, string param)
        {
            string finalTag;
            dynamic cells = ComPathEval(wb, param, out finalTag);
            int rows = (int)cells.Rows.Count;
            int cols = (int)cells.Columns.Count;

            if (rows == 1 && cols == 1)
                return FormatCellValue(cells.Value2);

            // Multi-cell: tab-separated columns, newline-separated rows
            var sbr = new StringBuilder();
            for (int r = 1; r <= rows; r++)
            {
                for (int c = 1; c <= cols; c++)
                {
                    if (c > 1) sbr.Append("\t");
                    try { sbr.Append(FormatCellValue(cells.Cells(r, c).Value2)); } catch { }
                }
                sbr.Append("\n");
            }
            return sbr.ToString().TrimEnd('\n');
        }

        static string ReadWord(dynamic doc, string param)
        {
            if (string.IsNullOrEmpty(param) || param == "body")
                return (string)doc.Content.Text;

            string bmName = TryBookmarkName(param);
            if (bmName != null)
            {
                dynamic bm = doc.Bookmarks(bmName);
                return (string)bm.Range.Text;
            }

            int paraIdx = TryParaIndex(param);
            if (paraIdx > 0)
            {
                dynamic para = doc.Paragraphs.Item(paraIdx);
                return ((string)para.Range.Text).TrimEnd('\r', '\n', '\a');
            }

            // Fallback: treat as bookmark name (backward compat)
            try
            {
                dynamic bm = doc.Bookmarks(param);
                return (string)bm.Range.Text;
            }
            catch { }

            return "";
        }

        static string ReadPowerPoint(dynamic pres, string param)
        {
            string finalTag;
            dynamic obj = ComPathEval(pres, param, out finalTag);

            if (finalTag == "slide" || finalTag == "")
            {
                // Concatenate all shape text in the slide
                var sbr = new StringBuilder();
                dynamic shapes = obj.Shapes;
                int sc = (int)shapes.Count;
                for (int i = 1; i <= sc; i++)
                {
                    try { sbr.AppendLine((string)shapes.Item(i).TextFrame.TextRange.Text); } catch { }
                }
                return sbr.ToString().Trim();
            }

            if (finalTag == "shape")
                return (string)obj.TextFrame.TextRange.Text;

            if (finalTag == "text" || finalTag == "textframe")
                return (string)obj.Text;

            // Generic fallback
            try { return (string)obj.TextFrame.TextRange.Text; } catch { }
            try { return (string)obj.Text; } catch { }
            return "";
        }

        // ──────────────────────────────────────────────────────────────────────
        //  WRITE
        // ──────────────────────────────────────────────────────────────────────
        //  Excel:       {WRITE:cell[@addr='A1']|Hello}
        //               {WRITE:sheet[@name='Q1']/cell[@addr='B2']|=SUM(A1:A10)}
        //  Word:        {WRITE:body|line1\nline2}
        //               {WRITE:body/para[3]|new text}
        //               {WRITE:bookmark[@name='MyMark']|new text}
        //  PowerPoint:  {WRITE:slide[2]/shape[@name='Title']|New Title}

        static void CmdWrite(dynamic doc, string appType, string param)
        {
            try
            {
                // Split on first pipe
                int pipe = param.IndexOf('|');
                if (pipe < 0)
                {
                    Console.WriteLine("{\"success\":false,\"error\":\"WRITE requires target|value format\"}");
                    return;
                }
                string addr  = param.Substring(0, pipe);
                string value = param.Substring(pipe + 1);

                switch (appType)
                {
                    case "excel":
                        WriteExcel(doc, addr, value);
                        break;
                    case "word":
                        WriteWord(doc, addr, value);
                        break;
                    case "powerpoint":
                        WritePowerPoint(doc, addr, value);
                        break;
                }
                Console.WriteLine("{\"success\":true,\"result\":\"written\"}");
            }
            catch (Exception ex)
            {
                Console.WriteLine("{\"success\":false,\"error\":\"WRITE failed: "
                    + JsonEscape(ex.Message) + "\"}");
            }
        }

        static void WriteExcel(dynamic wb, string addr, string value)
        {
            string finalTag;
            dynamic cell = ComPathEval(wb, addr, out finalTag);

            // If value starts with '=' treat as formula, otherwise as literal
            if (value.StartsWith("="))
                cell.Formula = value;
            else
            {
                double d;
                if (double.TryParse(value, System.Globalization.NumberStyles.Any,
                                    System.Globalization.CultureInfo.InvariantCulture, out d))
                    cell.Value2 = d;
                else
                    cell.Value2 = value;
            }
        }

        static void WriteWord(dynamic doc, string addr, string value)
        {
            if (addr.Equals("body", StringComparison.OrdinalIgnoreCase))
            {
                // Split on \n and write each line as a paragraph
                string[] lines = value.Split(new[] { "\\n", "\n" }, StringSplitOptions.None);
                // Clear existing content first
                doc.Content.Text = "";
                for (int i = 0; i < lines.Length; i++)
                {
                    if (i == 0)
                    {
                        // First paragraph already exists
                        doc.Paragraphs.Item(1).Range.Text = lines[0];
                    }
                    else
                    {
                        // Append a new paragraph
                        dynamic endRange = doc.Content;
                        endRange.Collapse(0); // wdCollapseEnd
                        endRange.InsertParagraphAfter();
                        endRange.Collapse(0);
                        endRange.InsertAfter(lines[i]);
                    }
                }
                return;
            }

            string bmName = TryBookmarkName(addr);
            if (bmName != null)
            {
                dynamic bm = doc.Bookmarks(bmName);
                dynamic range = bm.Range;
                range.Text = value;
                // Re-add bookmark (Word collapses it after setting text)
                doc.Bookmarks.Add(bmName, range);
                return;
            }

            int paraIdx = TryParaIndex(addr);
            if (paraIdx > 0)
            {
                // Auto-extend: add paragraphs until we reach paraIdx
                while ((int)doc.Paragraphs.Count < paraIdx)
                {
                    dynamic endRange = doc.Content;
                    endRange.Collapse(0); // wdCollapseEnd
                    endRange.InsertParagraphAfter();
                }
                dynamic para = doc.Paragraphs.Item(paraIdx);
                // Set text without overwriting the paragraph mark (\r)
                dynamic r = para.Range;
                r.MoveEnd(1, -1); // wdCharacter = 1, exclude the paragraph mark
                r.Text = value;
                return;
            }

            // Fallback: treat as bookmark name
            dynamic bm2 = doc.Bookmarks(addr);
            dynamic r2  = bm2.Range;
            r2.Text = value;
            doc.Bookmarks.Add(addr, r2);
        }

        static void WritePowerPoint(dynamic pres, string addr, string value)
        {
            // Auto-extend slides: if path targets slide[N] and N > current count,
            // add blank slides (ppLayoutText = 2) until the index is reachable.
            var slideM = System.Text.RegularExpressions.Regex.Match(addr, @"(?:^|/)slide\[(\d+)\]");
            if (slideM.Success)
            {
                int need = int.Parse(slideM.Groups[1].Value);
                while (pres.Slides.Count < need)
                    pres.Slides.Add(pres.Slides.Count + 1, 2); // ppLayoutText
            }

            string finalTag;
            dynamic obj = ComPathEval(pres, addr, out finalTag);

            if (finalTag == "slide" || finalTag == "")
                throw new Exception("WRITE for PowerPoint requires a shape target, e.g. slide[2]/shape[@name='Title']");

            obj.TextFrame.TextRange.Text = value;
        }

        // ──────────────────────────────────────────────────────────────────────
        //  SAVE / EXPORT
        // ──────────────────────────────────────────────────────────────────────

        static void CmdSave(dynamic doc, string appType, string format)
        {
            try
            {
                if (string.IsNullOrEmpty(format))
                {
                    // Plain SAVE — for a new document that has never been saved,
                    // doc.Save() opens a file-picker dialog which blocks COM.
                    // Detect this case (Path is empty) and use SaveAs2 instead.
                    string docPath = (string)doc.Path;
                    if (string.IsNullOrEmpty(docPath))
                    {
                        // Save as .docx in the Documents folder
                        string docName = System.IO.Path.GetFileNameWithoutExtension((string)doc.Name);
                        string savePath = System.IO.Path.Combine(
                            Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments),
                            docName + ".docx");
                        // wdFormatXMLDocument = 12 (.docx)
                        doc.SaveAs2(savePath, 12);
                        Console.WriteLine("{\"success\":true,\"result\":\"saved\",\"path\":\"" + JsonEscape(savePath) + "\"}");
                    }
                    else
                    {
                        doc.Save();
                        Console.WriteLine("{\"success\":true,\"result\":\"saved\"}");
                    }
                    return;
                }

                // EXPORT — build output path beside the source file
                string srcName = (string)doc.Name;
                string srcPath = (string)doc.Path;
                string baseName = System.IO.Path.GetFileNameWithoutExtension(srcName);
                string outDir   = string.IsNullOrEmpty(srcPath)
                    ? Environment.GetFolderPath(Environment.SpecialFolder.Desktop)
                    : srcPath;

                if (format.Contains("\\") || format.Contains("/"))
                {
                    // Caller provided a full path
                    outDir   = System.IO.Path.GetDirectoryName(format);
                    baseName = System.IO.Path.GetFileNameWithoutExtension(format);
                    format   = System.IO.Path.GetExtension(format).TrimStart('.').ToLowerInvariant();
                }

                string outPath = System.IO.Path.Combine(outDir, baseName + "." + format);

                switch (appType)
                {
                    case "excel":
                        if (format == "pdf")
                        {
                            // xlTypePDF = 0
                            doc.ExportAsFixedFormat(0, outPath);
                        }
                        else
                        {
                            Console.WriteLine("{\"success\":false,\"error\":\"Unsupported export format for Excel: " + JsonEscape(format) + "\"}");
                            return;
                        }
                        break;

                    case "word":
                        if (format == "pdf")
                        {
                            // wdExportFormatPDF = 17
                            doc.ExportAsFixedFormat(outPath, 17);
                        }
                        else
                        {
                            Console.WriteLine("{\"success\":false,\"error\":\"Unsupported export format for Word: " + JsonEscape(format) + "\"}");
                            return;
                        }
                        break;

                    case "powerpoint":
                        if (format == "pdf")
                        {
                            // ppSaveAsPDF = 32
                            doc.SaveAs(outPath, 32);
                        }
                        else
                        {
                            Console.WriteLine("{\"success\":false,\"error\":\"Unsupported export format for PowerPoint: " + JsonEscape(format) + "\"}");
                            return;
                        }
                        break;
                }

                Console.WriteLine("{\"success\":true,\"result\":\"exported\",\"path\":\"" + JsonEscape(outPath) + "\"}");
            }
            catch (Exception ex)
            {
                Console.WriteLine("{\"success\":false,\"error\":\"SAVE/EXPORT failed: "
                    + JsonEscape(ex.Message) + "\"}");
            }
        }

        // ──────────────────────────────────────────────────────────────────────
        //  NEWDOC
        // ──────────────────────────────────────────────────────────────────────

        static void CmdNewDoc(string appType)
        {
            try
            {
                dynamic app = TryGetApp(appType);
                if (app == null)
                {
                    // Start the application
                    string progId = AppTypeToProgId(appType);
                    if (progId == null)
                    {
                        Console.WriteLine("{\"success\":false,\"error\":\"Unknown app type: " + JsonEscape(appType) + "\"}");
                        return;
                    }
                    Type t = Type.GetTypeFromProgID(progId);
                    app = Activator.CreateInstance(t);
                }
                // Ensure the application window is visible regardless of whether we
                // just created it or attached to an already-running instance.
                app.Visible = true;

                string name = "";
                switch (appType)
                {
                    case "excel":
                    {
                        dynamic wb = app.Workbooks.Add();
                        name = (string)wb.Name;
                        break;
                    }
                    case "word":
                    {
                        dynamic doc = app.Documents.Add();
                        name = (string)doc.Name;
                        break;
                    }
                    case "powerpoint":
                    {
                        dynamic pres = app.Presentations.Add();
                        // A blank Presentation has 0 slides; add a title-layout slide so
                        // the presentation is immediately usable (ppLayoutTitle = 1).
                        pres.Slides.Add(1, 1);
                        name = (string)pres.Name;
                        break;
                    }
                }

                Console.WriteLine("{\"success\":true,\"result\":\"created\",\"name\":\"" + JsonEscape(name) + "\"}");
            }
            catch (Exception ex)
            {
                Console.WriteLine("{\"success\":false,\"error\":\"NEWDOC failed: "
                    + JsonEscape(ex.Message) + "\"}");
            }
        }

        // ──────────────────────────────────────────────────────────────────────
        //  FOCUS
        // ──────────────────────────────────────────────────────────────────────

        static void CmdFocus(string appType)
        {
            try
            {
                dynamic app = TryGetApp(appType);
                if (app == null)
                {
                    Console.WriteLine("{\"success\":false,\"error\":\"App not running: " + JsonEscape(appType) + "\"}");
                    return;
                }
                // app.Hwnd is not available on Word.Application; use ActiveWindow.Hwnd
                int hwnd = (int)app.ActiveWindow.Hwnd;
                IntPtr hWnd = new IntPtr(hwnd);
                ShowWindow(hWnd, 9);           // SW_RESTORE — unminimise before bringing to front
                SetForegroundWindow(hWnd);
                Console.WriteLine("{\"success\":true,\"result\":\"focused\",\"app\":\"" + JsonEscape(appType) + "\"}");
            }
            catch (Exception ex)
            {
                Console.WriteLine("{\"success\":false,\"error\":\"FOCUS failed: " + JsonEscape(ex.Message) + "\"}");
            }
        }

        // ──────────────────────────────────────────────────────────────────────
        //  FORMAT — paragraph style + full character/paragraph properties (Word)
        // ──────────────────────────────────────────────────────────────────────
        // Parameter forms (pipe-delimited):
        //   "body/para[N]|Heading 1"                          ← style name only (backward compat)
        //   "body/para[N]|bold=true|fontSize=14"              ← key=value only
        //   "body/para[N]|style=Normal|bold=true|italic=true" ← mixed
        //
        // Character keys : bold italic underline strikethrough allCaps smallCaps
        //                  fontName fontSize color(#RRGGBB) highlight charSpacingPt
        // Paragraph keys : style alignment(left/center/right/justify)
        //                  spaceBeforePt spaceAfterPt lineSpacing(mult or exactPt:N)
        //                  indentLeftCm indentRightCm indentFirstLineCm
        static void CmdFormat(dynamic doc, string appType, string param)
        {
            if (appType != "word")
            {
                Console.WriteLine("{\"success\":false,\"error\":\"FORMAT currently supports Word only\"}");
                return;
            }
            try
            {
                string[] parts = param.Split('|');
                if (parts.Length < 2)
                {
                    Console.WriteLine("{\"success\":false,\"error\":\"FORMAT requires path=body/para[N] and at least one style or property\"}");
                    return;
                }
                string addr = parts[0].Trim();
                int n = TryParaIndex(addr);
                if (n < 1)
                {
                    Console.WriteLine("{\"success\":false,\"error\":\"FORMAT: address must be a paragraph path such as body/para[1] or para[1], got: "
                        + JsonEscape(addr) + "\"}");
                    return;
                }
                int count = (int)doc.Paragraphs.Count;
                if (n > count)
                {
                    Console.WriteLine("{\"success\":false,\"error\":\"FORMAT: para " + n
                        + " does not exist (doc has " + count + " paragraphs)\"}");
                    return;
                }

                dynamic para  = doc.Paragraphs.Item(n);
                dynamic range = para.Range;
                dynamic font  = range.Font;
                dynamic pf    = para.Format;   // Paragraph.Format → ParagraphFormat (not .ParagraphFormat)
                const double CM_TO_PT = 28.3465;

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
                        case "bold":          font.Bold         = boolVal ? 1 : 0; break;
                        case "italic":        font.Italic       = boolVal ? 1 : 0; break;
                        case "underline":     font.Underline    = boolVal ? 1 : 0; break; // 1=wdUnderlineSingle
                        case "strikethrough": font.StrikeThrough = boolVal ? 1 : 0; break;
                        case "allcaps":       font.AllCaps      = boolVal ? 1 : 0; break;
                        case "smallcaps":     font.SmallCaps    = boolVal ? 1 : 0; break;
                        case "fontname":      font.Name         = val; break;
                        case "fontsize":      font.Size         = double.Parse(val, System.Globalization.CultureInfo.InvariantCulture); break;
                        case "color":
                        {
                            // #RRGGBB → Word BGR integer (B*65536 + G*256 + R)
                            string hex = val.TrimStart('#');
                            if (hex.Length == 6)
                            {
                                int r = Convert.ToInt32(hex.Substring(0, 2), 16);
                                int g = Convert.ToInt32(hex.Substring(2, 2), 16);
                                int b = Convert.ToInt32(hex.Substring(4, 2), 16);
                                font.Color = b * 65536 + g * 256 + r;
                            }
                            break;
                        }
                        case "highlight":
                            font.HighlightColorIndex = WordHighlightIndex(val);
                            break;
                        case "charspacingpt":
                            font.Spacing = double.Parse(val, System.Globalization.CultureInfo.InvariantCulture);
                            break;

                        // ── Paragraph properties ──────────────────────────────────────
                        case "style":
                            styleName = val;
                            break;
                        case "alignment":
                        {
                            // wdAlignParagraphLeft=0, Center=1, Right=2, Justify=3
                            int align;
                            switch (val.ToLowerInvariant())
                            {
                                case "center":  align = 1; break;
                                case "right":   align = 2; break;
                                case "justify": align = 3; break;
                                default:        align = 0; break; // left
                            }
                            pf.Alignment = align;
                            break;
                        }
                        case "spacebeforept":
                            pf.SpaceBefore = double.Parse(val, System.Globalization.CultureInfo.InvariantCulture);
                            break;
                        case "spaceafterpt":
                            pf.SpaceAfter = double.Parse(val, System.Globalization.CultureInfo.InvariantCulture);
                            break;
                        case "linespacing":
                        {
                            if (val.StartsWith("exactPt:", StringComparison.OrdinalIgnoreCase))
                            {
                                double pt = double.Parse(val.Substring(8), System.Globalization.CultureInfo.InvariantCulture);
                                pf.LineSpacingRule = 4; // wdLineSpaceExactly
                                pf.LineSpacing = (float)pt;
                            }
                            else
                            {
                                double mult = double.Parse(val, System.Globalization.CultureInfo.InvariantCulture);
                                if (Math.Abs(mult - 1.0) < 0.01)      { pf.LineSpacingRule = 0; } // wdLineSpaceSingle
                                else if (Math.Abs(mult - 1.5) < 0.01) { pf.LineSpacingRule = 3; } // wdLineSpace1pt5
                                else if (Math.Abs(mult - 2.0) < 0.01) { pf.LineSpacingRule = 1; } // wdLineSpaceDouble
                                else { pf.LineSpacingRule = 5; pf.LineSpacing = (float)(mult * 12); } // wdLineSpaceMultiple
                            }
                            break;
                        }
                        case "indentleftcm":
                            pf.LeftIndent = (float)(double.Parse(val, System.Globalization.CultureInfo.InvariantCulture) * CM_TO_PT);
                            break;
                        case "indentrightcm":
                            pf.RightIndent = (float)(double.Parse(val, System.Globalization.CultureInfo.InvariantCulture) * CM_TO_PT);
                            break;
                        case "indentfirstlinecm":
                            pf.FirstLineIndent = (float)(double.Parse(val, System.Globalization.CultureInfo.InvariantCulture) * CM_TO_PT);
                            break;
                    }
                    applied.Add(key);
                }

                // Apply style after char/para props so it does not reset them in advanced scenarios
                if (styleName != null)
                {
                    int? styleId = WordBuiltInStyleId(styleName);
                    if (styleId.HasValue) para.Range.Style = styleId.Value;
                    else                  para.Range.Style = styleName;
                }

                var sb2 = new StringBuilder("[");
                if (styleName != null) { sb2.Append("\"style\","); }
                foreach (string a in applied) { sb2.Append("\"").Append(JsonEscape(a)).Append("\","); }
                if (sb2.Length > 1) sb2.Length--;
                sb2.Append("]");
                Console.WriteLine("{\"success\":true,\"result\":\"formatted\",\"para\":" + n + ",\"applied\":" + sb2 + "}");
            }
            catch (Exception ex)
            {
                Console.WriteLine("{\"success\":false,\"error\":\"FORMAT failed: "
                    + JsonEscape(ex.Message) + "\"}");
            }
        }

        /// <summary>
        /// Maps a highlight colour name to a WdColorIndex value for Font.HighlightColorIndex.
        /// </summary>
        static int WordHighlightIndex(string name)
        {
            switch (name.ToLowerInvariant())
            {
                case "yellow":    return 7;  // wdYellow
                case "green":     return 4;  // wdBrightGreen
                case "cyan":      return 3;  // wdCyan
                case "magenta":   return 5;  // wdPink
                case "red":       return 6;  // wdRed
                case "blue":      return 2;  // wdBlue (dark)
                case "darkblue":  return 9;  // wdDarkBlue
                case "darkred":   return 13; // wdDarkRed
                case "darkgreen": return 11; // wdDarkGreen
                case "darkcyan":  return 10; // wdDarkCyan
                case "none":      return 0;  // wdAuto (no highlight)
                default:          return 7;  // fallback: yellow
            }
        }

        /// <summary>
        /// Maps English built-in style names to WdBuiltInStyle integer constants.
        /// These are locale-independent and work on any language installation of Office.
        /// Full list: https://docs.microsoft.com/en-us/office/vba/api/word.wdbuiltinstyle
        /// </summary>
        static int? WordBuiltInStyleId(string name)
        {
            switch (name.ToLowerInvariant().Trim())
            {
                case "normal":               return -1;   // wdStyleNormal
                case "heading 1":            return -2;   // wdStyleHeading1
                case "heading 2":            return -3;   // wdStyleHeading2
                case "heading 3":            return -4;   // wdStyleHeading3
                case "heading 4":            return -5;
                case "heading 5":            return -6;
                case "heading 6":            return -7;
                case "heading 7":            return -8;
                case "heading 8":            return -9;
                case "heading 9":            return -10;
                case "title":                return -71;  // wdStyleTitle
                case "subtitle":             return -75;  // wdStyleSubtitle
                case "body text":            return -67;
                case "body text 2":          return -81;
                case "body text 3":          return -82;
                case "list bullet":          return -49;
                case "list bullet 2":        return -50;
                case "list number":          return -53;
                case "list number 2":        return -54;
                case "quote":                return -181; // wdStyleQuote
                case "intense quote":        return -182; // wdStyleIntenseQuote
                case "caption":              return -35;
                case "block text":           return -85;
                case "no spacing":           return -158;
                case "strong":               return -97;
                case "emphasis":             return -89;
                default:                     return null;
            }
        }

        // ──────────────────────────────────────────────────────────────────────
        //  EXEC_MACRO
        // ──────────────────────────────────────────────────────────────────────

        static void CmdExecMacro(dynamic doc, string appType, string macroName)
        {
            try
            {
                if (appType != "excel")
                {
                    Console.WriteLine("{\"success\":false,\"error\":\"EXEC_MACRO is only supported for Excel\"}");
                    return;
                }
                dynamic app = Marshal.GetActiveObject("Excel.Application");
                app.Run(macroName);
                Console.WriteLine("{\"success\":true,\"result\":\"macro executed: " + JsonEscape(macroName) + "\"}");
            }
            catch (Exception ex)
            {
                Console.WriteLine("{\"success\":false,\"error\":\"EXEC_MACRO failed: "
                    + JsonEscape(ex.Message) + "\"}");
            }
        }

        // ──────────────────────────────────────────────────────────────────────
        //  Helpers
        // ──────────────────────────────────────────────────────────────────────

        static string DetermineCommandType(string action)
        {
            if (string.IsNullOrEmpty(action)) return "";
            var m = Regex.Match(action, @"\{([A-Z_]+)", RegexOptions.IgnoreCase);
            return m.Success ? m.Groups[1].Value.ToUpperInvariant() : action.ToUpperInvariant();
        }

        static string ExtractParam(string cmd, string command)
        {
            var m = Regex.Match(cmd, @"\{" + command + @":(.+?)\}$", RegexOptions.IgnoreCase | RegexOptions.Singleline);
            return m.Success ? m.Groups[1].Value : null;
        }

        static string JsonEscape(string s)
        {
            if (s == null) return "";
            return s.Replace("\\", "\\\\")
                    .Replace("\"", "\\\"")
                    .Replace("\r", "\\r")
                    .Replace("\n", "\\n")
                    .Replace("\t", "\\t");
        }

        static string FormatCellValue(object v)
        {
            if (v == null) return "";
            if (v is double)   return ((double)v).ToString(System.Globalization.CultureInfo.InvariantCulture);
            if (v is bool)     return (bool)v ? "TRUE" : "FALSE";
            if (v is DateTime) return ((DateTime)v).ToString("yyyy-MM-dd HH:mm:ss");
            return v.ToString();
        }

        static string TruncateStr(string s, int maxLen)
        {
            if (s == null) return "";
            return s.Length <= maxLen ? s : s.Substring(0, maxLen) + "…";
        }

        // ──────────────────────────────────────────────────────────────────────
        //  API Schema
        // ──────────────────────────────────────────────────────────────────────

        static string GetApiSchema()
        {
            var sb = new StringBuilder();
            sb.AppendLine("{");
            sb.AppendLine("  \"helper\": \"MSOfficeWin.exe\",");
            sb.AppendLine("  \"version\": \"1.0.0\",");
            sb.AppendLine("  \"description\": \"MS Office automation via COM late-binding. Controls Word, Excel, PowerPoint.\\n"
                + "    Office must be running with at least one document open for most commands.\\n"
                + "    Workflow: LISTDOCS -> identify target -> QUERYTREE -> READ/WRITE -> SAVE.\",");
            sb.AppendLine("  \"targetDescription\": \"App name: 'excel', 'word', 'powerpoint'. Or 'DOCNAME:<filename>' to find by name, e.g. 'DOCNAME:Budget.xlsx'. Or 'PROC:EXCEL.EXE'.\",");
            sb.AppendLine("  \"commands\": [");

            sb.AppendLine("    { \"name\": \"LISTDOCS\", \"description\": \"List all open documents across Word, Excel, PowerPoint. Target can be any value (e.g. 'excel').\", \"parameters\": [], \"examples\": [\"action=LISTDOCS\"] },");

            sb.AppendLine("    { \"name\": \"QUERYTREE\", \"description\": \"Return the document structure as a JSON tree. Depth 2=sheets/paragraphs, depth 3=cells/shapes (Excel: capped at 200 cells).\","
                + " \"parameters\": [ { \"name\": \"depth\", \"type\": \"integer\", \"required\": false, \"default\": 3 } ],"
                + " \"examples\": [\"action=QUERYTREE\", \"action=QUERYTREE path=2\"] },");

            sb.AppendLine("    { \"name\": \"READ\", \"description\": \"Read a value from the document.\\n"
                + "    Excel: cell[@addr'A1'] or sheet[@name'Q1']/cell[@addr'B2:C5'].\\n"
                + "    Word: \\\"body\\\" (full text), body/para[N] (Nth paragraph), bookmark[@name'X'].\\n"
                + "    PowerPoint: slide[N] (all text on slide), slide[N]/shape[@name'Title'].\","
                + " \"parameters\": [ { \"name\": \"address\", \"type\": \"string\", \"required\": true } ],"
                + " \"examples\": [\"action=READ path=cell[@addr='A1']\", \"action=READ path=sheet[@name='Q1']/cell[@addr='B2:C5']\", \"action=READ path=body\", \"action=READ path=body/para[3]\", \"action=READ path=bookmark[@name='Summary']\", \"action=READ path=slide[1]\"] },");

            sb.AppendLine("    { \"name\": \"WRITE\", \"description\": \"Write a value to the document.\\n"
                + "    Excel: cell[@addr'A1'] or sheet[@name'Q1']/cell[@addr'B2'] (formula if value starts with =).\\n"
                + "    Word: body (full replace), body/para[N] (auto-extends), bookmark[@name'X'].\\n"
                + "    PowerPoint: slide[N]/shape[@name'Title'] or slide[N]/shape[1].\","
                + " \"parameters\": [ { \"name\": \"address_and_value\", \"type\": \"string\", \"required\": true } ],"
                + " \"examples\": [\"action=WRITE path=cell[@addr='A1'] value=Hello\", \"action=WRITE path=sheet[@name='Q1']/cell[@addr='B2'] value==SUM(A1:A10)\", \"action=WRITE path=body/para[1] value=Introduction\", \"action=WRITE path=slide[1]/shape[@name='Title'] value=My Title\"] },");

            sb.AppendLine("    { \"name\": \"SAVE\", \"description\": \"Save the active document/workbook/presentation.\", \"parameters\": [], \"examples\": [\"action=SAVE\"] },");

            sb.AppendLine("    { \"name\": \"EXPORT\", \"description\": \"Export the document to another format. Currently supported: 'pdf'. Optionally provide a full output path.\","
                + " \"parameters\": [ { \"name\": \"format\", \"type\": \"string\", \"required\": false, \"default\": \"pdf\", \"enum\": [\"pdf\"] } ],"
                + " \"examples\": [\"action=EXPORT path=pdf\", \"action=EXPORT path=C:\\\\Users\\\\me\\\\output.pdf\"] },");

            sb.AppendLine("    { \"name\": \"NEWDOC\", \"description\": \"Create a new document/workbook/presentation. Starts Office if not already running.\", \"parameters\": [], \"examples\": [\"action=NEWDOC\"] },");

            sb.AppendLine("    { \"name\": \"EXEC_MACRO\", \"description\": \"Run a named VBA macro (Excel only). The macro must already exist in the workbook.\","
                + " \"parameters\": [ { \"name\": \"macroName\", \"type\": \"string\", \"required\": true } ],"
                + " \"examples\": [\"action=EXEC_MACRO path=RefreshData\", \"action=EXEC_MACRO path=Module1.ProcessAll\"] },");

            sb.AppendLine("    { \"name\": \"FORMAT\", \"description\": \"Apply a named paragraph style to a paragraph in a Word document. Use after WRITE to style headings and body text. Path must be a paragraph address such as body/para[N] or para[N]. StyleName is a built-in Word style: 'Normal', 'Title', 'Heading 1'..'Heading 9', 'Subtitle', 'Quote', 'Intense Quote', 'List Bullet', 'List Number', 'Caption'.\","
                + " \"parameters\": [ { \"name\": \"address_and_style\", \"type\": \"string\", \"required\": true } ],"
                + " \"examples\": [\"action=FORMAT path=body/para[1] value=Title\", \"action=FORMAT path=body/para[2] value=Heading 1\", \"action=FORMAT path=body/para[3] value=Normal\"] },");

            sb.AppendLine("    { \"name\": \"FOCUS\", \"description\": \"Bring the Office application window to the foreground. Call after NEWDOC or before any visible interaction in cooperative/showcase mode so the user can see what the AI is doing. Uses ShowWindow(SW_RESTORE) + SetForegroundWindow.\", \"parameters\": [], \"examples\": [\"action=FOCUS\"] }");

            sb.AppendLine("  ]");
            sb.AppendLine("}");
            return sb.ToString();
        }
    }
}
