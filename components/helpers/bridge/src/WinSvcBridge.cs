// WinSvcBridge.cs
// ================================================================================
// Thin Session-0 -> User-Session helper launcher/proxy.
//
// Problem: When AIAPI runs as a Windows Service it lives in Session 0
// (non-interactive). All child processes inherit Session 0, so helpers
// (KeyWin.exe, BrowserWin.exe, ...) cannot reach the user desktop.
//
// Solution: WinSvcBridge.exe uses WTSQueryUserToken + CreateProcessAsUser to
// launch the real helper in the active user session (Session 1+), then acts as a
// transparent stdin/stdout relay between the service and the helper, keeping the
// existing JSON-line wire protocol completely unchanged.
//
// Usage (from HelperRegistry.ts):
//   WinSvcBridge.exe <helper.exe> [args...]
//
// The bridge:
//   1. Determines the active console session via WTSGetActiveConsoleSessionId()
//   2. Opens the user token with WTSQueryUserToken()
//   3. Calls CreateProcessAsUser() to start <helper.exe> in the user session,
//      with inherited stdin/stdout/stderr handles.
//   4. Pumps data: stdin->child stdin, child stdout->stdout, child stderr->stderr.
//   5. Exits with the child process exit code.
//
// Privilege requirement: the service must run as LocalSystem (the default for
// Windows services). LocalSystem has SE_TCB_PRIVILEGE implicitly when calling
// WTSQueryUserToken -- no explicit privilege escalation is needed beyond running
// as a service.
//
// Build: tools\build-bridge.ps1  (uses .NET Framework 4 csc.exe)
// ================================================================================

using System;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Win32.SafeHandles;

class WinSvcBridge
{
    // -- P/Invoke: WTS ---------------------------------------------------------

    [DllImport("kernel32.dll")]
    static extern uint WTSGetActiveConsoleSessionId();

    [DllImport("Wtsapi32.dll", SetLastError = true)]
    static extern bool WTSQueryUserToken(uint sessionId, out IntPtr phToken);

    [DllImport("Wtsapi32.dll", SetLastError = true)]
    static extern bool WTSEnumerateSessions(
        IntPtr hServer, uint Reserved, uint Version,
        out IntPtr ppSessionInfo, out uint pCount);

    [DllImport("Wtsapi32.dll")]
    static extern void WTSFreeMemory(IntPtr pMemory);

    [StructLayout(LayoutKind.Sequential)]
    struct WTS_SESSION_INFO
    {
        public uint SessionId;
        public IntPtr pWinStationName;
        public int State; // WTSConnectState: 0=Active, 4=Disconnected
    }

    // Returns the user token for the best available active session.
    // First tries the physical console session; if WTSQueryUserToken fails for it
    // (e.g. because the user is connected via RDP and the console is empty),
    // enumerates all sessions and returns the first Active one.
    // Returns IntPtr.Zero on total failure.
    static IntPtr GetActiveUserToken(out uint winSessionId)
    {
        winSessionId = 0;

        // Try the console session first
        uint consoleSid = WTSGetActiveConsoleSessionId();
        if (consoleSid != 0xFFFFFFFF)
        {
            IntPtr tok = IntPtr.Zero;
            if (WTSQueryUserToken(consoleSid, out tok))
            {
                winSessionId = consoleSid;
                return tok;
            }
        }

        // Console session failed (e.g. user connected via RDP while console is empty).
        // Enumerate all sessions and find the first Active one with a valid user token.
        IntPtr pInfo = IntPtr.Zero;
        uint count = 0;
        if (!WTSEnumerateSessions(IntPtr.Zero, 0, 1, out pInfo, out count))
            return IntPtr.Zero;

        try
        {
            int structSize = Marshal.SizeOf(typeof(WTS_SESSION_INFO));
            for (uint i = 0; i < count; i++)
            {
                IntPtr cur = new IntPtr(pInfo.ToInt64() + i * structSize);
                var info = (WTS_SESSION_INFO)Marshal.PtrToStructure(cur, typeof(WTS_SESSION_INFO));
                // WTSActive == 0 — skip session 0 (service session)
                if (info.State == 0 && info.SessionId != 0)
                {
                    IntPtr tok = IntPtr.Zero;
                    if (WTSQueryUserToken(info.SessionId, out tok))
                    {
                        winSessionId = info.SessionId;
                        return tok;
                    }
                }
            }
        }
        finally
        {
            WTSFreeMemory(pInfo);
        }

        return IntPtr.Zero;
    }

    // -- P/Invoke: Process creation --------------------------------------------

    [DllImport("userenv.dll", SetLastError = true)]
    static extern bool CreateEnvironmentBlock(out IntPtr lpEnvironment,
        IntPtr hToken, bool bInherit);

    [DllImport("userenv.dll", SetLastError = true)]
    static extern bool DestroyEnvironmentBlock(IntPtr lpEnvironment);

    [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    static extern bool CreateProcessAsUser(
        IntPtr hToken,
        string lpApplicationName,
        StringBuilder lpCommandLine,
        IntPtr lpProcessAttributes,
        IntPtr lpThreadAttributes,
        bool bInheritHandles,
        uint dwCreationFlags,
        IntPtr lpEnvironment,
        string lpCurrentDirectory,
        ref STARTUPINFO lpStartupInfo,
        out PROCESS_INFORMATION lpProcessInformation);

    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool CreatePipe(out SafeFileHandle hReadPipe,
        out SafeFileHandle hWritePipe,
        ref SECURITY_ATTRIBUTES lpPipeAttributes, uint nSize);

    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool SetHandleInformation(SafeFileHandle hObject,
        uint dwMask, uint dwFlags);

    [DllImport("kernel32.dll", SetLastError = true)]
    static extern IntPtr CreateFile(
        string lpFileName, uint dwDesiredAccess, uint dwShareMode,
        IntPtr lpSecurityAttributes, uint dwCreationDisposition,
        uint dwFlagsAndAttributes, IntPtr hTemplateFile);

    [DllImport("kernel32.dll")]
    static extern IntPtr GetCurrentProcess();

    [DllImport("kernel32.dll")]
    static extern bool CloseHandle(IntPtr hObject);

    [DllImport("kernel32.dll", SetLastError = true)]
    static extern uint WaitForSingleObject(IntPtr hHandle, uint dwMilliseconds);

    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool GetExitCodeProcess(IntPtr hProcess, out uint lpExitCode);

    [StructLayout(LayoutKind.Sequential)]
    struct SECURITY_ATTRIBUTES
    {
        public uint nLength;
        public IntPtr lpSecurityDescriptor;
        public bool bInheritHandle;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct STARTUPINFO
    {
        public uint cb;
        public string lpReserved;
        public string lpDesktop;
        public string lpTitle;
        public uint dwX, dwY, dwXSize, dwYSize;
        public uint dwXCountChars, dwYCountChars;
        public uint dwFillAttribute;
        public uint dwFlags;
        public ushort wShowWindow;
        public ushort cbReserved2;
        public IntPtr lpReserved2;
        public SafeFileHandle hStdInput;
        public SafeFileHandle hStdOutput;
        public SafeFileHandle hStdError;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct PROCESS_INFORMATION
    {
        public IntPtr hProcess;
        public IntPtr hThread;
        public uint dwProcessId;
        public uint dwThreadId;
    }

    const uint CREATE_UNICODE_ENVIRONMENT = 0x00000400;
    const uint STARTF_USESTDHANDLES      = 0x00000100;
    const uint HANDLE_FLAG_INHERIT       = 0x00000001;

    // =========================================================================
    // Entry point
    // =========================================================================

    static int Main(string[] args)
    {
        if (args.Length < 1)
        {
            Console.Error.WriteLine("WinSvcBridge: usage: WinSvcBridge.exe <helper.exe> [args...]");
            Console.Error.WriteLine("              or:    WinSvcBridge.exe --launch <exe> [args...]");
            Console.Error.WriteLine("              or:    WinSvcBridge.exe --exec <exe> [args...]");
            return 1;
        }

        // --exec mode: run a command in the user session, capture stdout/stderr,
        // write JSON result {"exitCode":N,"stdout":"...","stderr":"..."} to stdout,
        // then exit.  Used by exec_cmd MCP tool to run commands in user context
        // from Session 0 (where the service runs as NT AUTHORITY\SYSTEM).
        if (args[0] == "--exec")
        {
            if (args.Length < 2)
            {
                Console.Error.WriteLine("WinSvcBridge --exec: missing executable argument");
                return 1;
            }
            string execExe = ResolveExePath(args[1]);
            var execCmd2 = new StringBuilder("\"" + execExe + "\"");
            for (int i = 2; i < args.Length; i++)
                execCmd2.Append(" " + QuoteArg(args[i]));

            uint sid2 = 0;
            IntPtr tok2 = GetActiveUserToken(out sid2);
            if (tok2 == IntPtr.Zero)
            {
                Console.Error.WriteLine("WinSvcBridge --exec: no active user session found");
                return 1;
            }
            try { return ExecInUserSession(tok2, execExe, execCmd2, sid2); }
            finally { CloseHandle(tok2); }
        }

        // --launch mode: spawn a process in the user session and exit immediately.
        // Used by launchProcess MCP tool to start GUI apps from Session 0.
        if (args[0] == "--launch")
        {
            if (args.Length < 2)
            {
                Console.Error.WriteLine("WinSvcBridge --launch: missing executable argument");
                return 1;
            }
            string launchExe = args[1];

            // Resolve bare exe names to full path by searching common system dirs.
            // CreateProcessAsUser does NOT search PATH when called from Session 0,
            // so bare names like "notepad.exe" or "mspaint.exe" must be resolved first.
            launchExe = ResolveExePath(launchExe);

            var launchCmd = new StringBuilder("\"" + launchExe + "\"");
            for (int i = 2; i < args.Length; i++)
                launchCmd.Append(" " + QuoteArg(args[i]));

            uint sid = 0;
            IntPtr tok = GetActiveUserToken(out sid);
            if (tok == IntPtr.Zero)
            {
                Console.Error.WriteLine("WinSvcBridge --launch: no active user session found");
                return 1;
            }
            try { return LaunchDetached(tok, launchExe, launchCmd, sid); }
            finally { CloseHandle(tok); }
        }

        // Resolve the helper exe path.  If a relative path is given, look in the
        // same directory as WinSvcBridge.exe (standard service layout).
        string helperExe = args[0];
        if (!Path.IsPathRooted(helperExe))
        {
            string bridgeDir = Path.GetDirectoryName(
                System.Reflection.Assembly.GetExecutingAssembly().Location);
            string candidate = Path.Combine(bridgeDir, helperExe);
            if (File.Exists(candidate)) helperExe = candidate;
        }

        // Build command line for child process
        var cmdLine = new StringBuilder("\"" + helperExe + "\"");
        for (int i = 1; i < args.Length; i++)
            cmdLine.Append(" " + QuoteArg(args[i]));

        // Determine the active user session (console or RDP, whichever is Active)
        uint sessionId = 0;
        IntPtr userToken = GetActiveUserToken(out sessionId);
        if (userToken == IntPtr.Zero)
        {
            Console.Error.WriteLine("WinSvcBridge: no active user session found (WTSQueryUserToken failed for all sessions). Launching directly.");
            return LaunchDirect(helperExe, args, 1);
        }

        try
        {
            return LaunchInUserSession(userToken, helperExe, cmdLine, sessionId);
        }
        finally
        {
            CloseHandle(userToken);
        }
    }

    // -- Resolve a bare exe name to a full path by searching system locations --

    static string ResolveExePath(string exeName)
    {
        // Already absolute — use as-is
        if (Path.IsPathRooted(exeName) && File.Exists(exeName))
            return exeName;

        // Search common Windows system directories first (PATH is not reliable
        // from Session 0 service context for user-mode apps).
        string sysRoot = Environment.GetEnvironmentVariable("SystemRoot") ?? @"C:\Windows";
        string[] searchDirs = new string[]
        {
            Path.Combine(sysRoot, "System32"),
            Path.Combine(sysRoot, "SysWOW64"),
            sysRoot,
            Path.Combine(sysRoot, "System32", "WindowsPowerShell", "v1.0"),
            // Also search PATH entries from the service environment
        };

        string name = exeName;
        if (!name.EndsWith(".exe", StringComparison.OrdinalIgnoreCase) &&
            !name.Contains("."))
            name = name + ".exe";

        foreach (string dir in searchDirs)
        {
            string candidate = Path.Combine(dir, name);
            if (File.Exists(candidate))
            {
                Console.Error.WriteLine("WinSvcBridge --launch: resolved '" + exeName + "' -> '" + candidate + "'");
                return candidate;
            }
        }

        // Fall back to PATH search via where.exe (runs in current Session 0 context)
        try
        {
            var psi = new ProcessStartInfo("where.exe", name)
            {
                UseShellExecute = false,
                RedirectStandardOutput = true,
                CreateNoWindow = true,
            };
            var proc = Process.Start(psi);
            if (proc != null)
            {
                string line = proc.StandardOutput.ReadLine();
                proc.WaitForExit();
                if (!string.IsNullOrEmpty(line) && File.Exists(line.Trim()))
                {
                    Console.Error.WriteLine("WinSvcBridge --launch: resolved via where.exe '" + exeName + "' -> '" + line.Trim() + "'");
                    return line.Trim();
                }
            }
        }
        catch (Exception whereEx)
        {
            Console.Error.WriteLine("WinSvcBridge --launch: where.exe search for '" + exeName + "' failed: " + whereEx.Message);
        }

        Console.Error.WriteLine("WinSvcBridge --launch: could not resolve '" + exeName + "', using as-is");
        return exeName;
    }

    // -- Run a command in user session, capture output, emit JSON to stdout ---

    static int ExecInUserSession(IntPtr userToken, string exePath, StringBuilder cmdLine, uint sessionId)
    {
        var saInherit = new SECURITY_ATTRIBUTES
        {
            nLength = (uint)Marshal.SizeOf(typeof(SECURITY_ATTRIBUTES)),
            lpSecurityDescriptor = IntPtr.Zero,
            bInheritHandle = true
        };

        SafeFileHandle stdoutReadParent, stdoutWriteChild;
        if (!CreatePipe(out stdoutReadParent, out stdoutWriteChild, ref saInherit, 0))
        {
            Console.Error.WriteLine("WinSvcBridge --exec: CreatePipe(stdout) failed: " + Marshal.GetLastWin32Error());
            return 1;
        }
        SetHandleInformation(stdoutReadParent, HANDLE_FLAG_INHERIT, 0);

        SafeFileHandle stderrReadParent, stderrWriteChild;
        if (!CreatePipe(out stderrReadParent, out stderrWriteChild, ref saInherit, 0))
        {
            Console.Error.WriteLine("WinSvcBridge --exec: CreatePipe(stderr) failed: " + Marshal.GetLastWin32Error());
            stdoutReadParent.Dispose(); stdoutWriteChild.Dispose();
            return 1;
        }
        SetHandleInformation(stderrReadParent, HANDLE_FLAG_INHERIT, 0);

        // stdin: open NUL device as an inheritable handle.
        // Must use a SECURITY_ATTRIBUTES with bInheritHandle=true so the child can use it.
        var saInheritNul = new SECURITY_ATTRIBUTES
        {
            nLength = (uint)Marshal.SizeOf(typeof(SECURITY_ATTRIBUTES)),
            lpSecurityDescriptor = IntPtr.Zero,
            bInheritHandle = true
        };
        IntPtr saPtr = Marshal.AllocHGlobal(Marshal.SizeOf(saInheritNul));
        Marshal.StructureToPtr(saInheritNul, saPtr, false);
        const uint GENERIC_READ2 = 0x80000000;
        const uint FILE_SHARE_RW = 0x00000003;
        const uint OPEN_EXISTING = 3;
        IntPtr nullDevHandle = CreateFile("NUL", GENERIC_READ2, FILE_SHARE_RW,
            saPtr, OPEN_EXISTING, 0, IntPtr.Zero);
        Marshal.FreeHGlobal(saPtr);
        if (nullDevHandle == new IntPtr(-1))
        {
            Console.Error.WriteLine("WinSvcBridge --exec: CreateFile(NUL) failed: " + Marshal.GetLastWin32Error());
            stdoutReadParent.Dispose(); stdoutWriteChild.Dispose();
            stderrReadParent.Dispose(); stderrWriteChild.Dispose();
            return 1;
        }
        var stdinNul = new SafeFileHandle(nullDevHandle, true);

        IntPtr envBlock = IntPtr.Zero;
        CreateEnvironmentBlock(out envBlock, userToken, true);

        // Use user profile as working dir
        string workingDir = null;
        try { workingDir = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile); } catch { }
        if (string.IsNullOrEmpty(workingDir)) workingDir = null;

        var si = new STARTUPINFO
        {
            cb        = (uint)Marshal.SizeOf(typeof(STARTUPINFO)),
            lpDesktop = "winsta0\\default",
            dwFlags   = STARTF_USESTDHANDLES,
            hStdInput  = stdinNul,
            hStdOutput = stdoutWriteChild,
            hStdError  = stderrWriteChild,
        };

        PROCESS_INFORMATION pi;
        bool created = CreateProcessAsUser(
            userToken,
            null,
            cmdLine,
            IntPtr.Zero, IntPtr.Zero,
            true,   // inherit handles so child gets the pipe ends
            CREATE_UNICODE_ENVIRONMENT,
            envBlock,
            workingDir,
            ref si,
            out pi);

        stdinNul.Dispose();

        // Close child-side pipe ends immediately
        stdoutWriteChild.Dispose();
        stderrWriteChild.Dispose();
        if (envBlock != IntPtr.Zero) DestroyEnvironmentBlock(envBlock);

        if (!created)
        {
            int err = Marshal.GetLastWin32Error();
            stdoutReadParent.Dispose();
            stderrReadParent.Dispose();
            Console.Error.WriteLine("WinSvcBridge --exec: CreateProcessAsUser failed (" + err
                + ") for exe='" + exePath + "' cmdLine='" + cmdLine + "'");
            return 1;
        }

        CloseHandle(pi.hThread);

        // Read stdout and stderr concurrently then wait for child
        SafeFileHandle capturedStdoutRead = stdoutReadParent;
        SafeFileHandle capturedStderrRead = stderrReadParent;

        var outTask = Task.Factory.StartNew<string>(() =>
        {
            try
            {
                using (var fs = new FileStream(capturedStdoutRead, FileAccess.Read, 4096, false))
                using (var sr = new StreamReader(fs, Encoding.UTF8))
                    return sr.ReadToEnd();
            }
            catch { return ""; }
        });

        var errTask = Task.Factory.StartNew<string>(() =>
        {
            try
            {
                using (var fs = new FileStream(capturedStderrRead, FileAccess.Read, 4096, false))
                using (var sr = new StreamReader(fs, Encoding.UTF8))
                    return sr.ReadToEnd();
            }
            catch { return ""; }
        });

        WaitForSingleObject(pi.hProcess, 0xFFFFFFFF);
        uint exitCode = 1;
        GetExitCodeProcess(pi.hProcess, out exitCode);
        CloseHandle(pi.hProcess);

        try { Task.WaitAll(new Task[] { outTask, errTask }, TimeSpan.FromSeconds(10)); }
        catch (Exception waitEx) { Console.Error.WriteLine("WinSvcBridge --exec: pipe drain timed out or failed: " + waitEx.Message); }
        string capturedOut = outTask.IsCompleted ? (outTask.Result ?? "") : "";
        string capturedErr = errTask.IsCompleted ? (errTask.Result ?? "") : "";

        // Emit JSON result to stdout so Node.js can parse it
        Console.WriteLine("{\"exitCode\":" + exitCode
            + ",\"stdout\":" + JsonEscape(capturedOut)
            + ",\"stderr\":" + JsonEscape(capturedErr) + "}");
        return (int)exitCode;
    }

    // -- Windows command-line argument quoting --------------------------------
    // Follows the rules used by CommandLineToArgvW:
    //   - If the arg contains no spaces, tabs, quotes or is empty, return as-is
    //     (so switches like /c, -NoProfile pass through unquoted)
    //   - Otherwise wrap in double quotes, escaping backslashes before quotes
    //     and any embedded double quotes.
    static string QuoteArg(string arg)
    {
        if (arg == null) return "\"\"";
        if (arg.Length == 0) return "\"\"";
        // If no whitespace or double-quote chars, pass through unquoted
        if (arg.IndexOfAny(new char[]{' ', '\t', '"'}) < 0)
            return arg;
        // Need quoting: escape backslashes immediately before a quote or at end
        var sb = new StringBuilder("\"");
        int slashes = 0;
        foreach (char c in arg)
        {
            if (c == '\\') { slashes++; }
            else if (c == '"')
            {
                // Each preceding backslash needs to be doubled, plus escape the quote
                sb.Append('\\', slashes * 2 + 1);
                sb.Append('"');
                slashes = 0;
            }
            else
            {
                if (slashes > 0) { sb.Append('\\', slashes); slashes = 0; }
                sb.Append(c);
            }
        }
        // Trailing backslashes before closing quote need doubling
        if (slashes > 0) sb.Append('\\', slashes * 2);
        sb.Append('"');
        return sb.ToString();
    }

    // -- Minimal JSON string escaper (no Newtonsoft dependency) ---------------

    static string JsonEscape(string s)
    {
        if (s == null) return "\"\"";
        var sb = new StringBuilder("\"");
        foreach (char c in s)
        {
            switch (c)
            {
                case '"':  sb.Append("\\\""); break;
                case '\\': sb.Append("\\\\"); break;
                case '\n': sb.Append("\\n");  break;
                case '\r': sb.Append("\\r");  break;
                case '\t': sb.Append("\\t");  break;
                default:
                    if (c < 0x20) sb.Append("\\u" + ((int)c).ToString("x4"));
                    else sb.Append(c);
                    break;
            }
        }
        sb.Append('"');
        return sb.ToString();
    }

    // -- Launch a GUI process in the user session (fire-and-forget) -----------

    static int LaunchDetached(IntPtr userToken, string exePath, StringBuilder cmdLine, uint sessionId)
    {
        IntPtr envBlock = IntPtr.Zero;
        CreateEnvironmentBlock(out envBlock, userToken, true);

        string workingDir = null;
        try { workingDir = Path.GetDirectoryName(exePath); } catch { }
        if (string.IsNullOrEmpty(workingDir)) workingDir = null;

        const uint CREATE_NEW_CONSOLE          = 0x00000010;
        const uint CREATE_UNICODE_ENVIRONMENT2 = 0x00000400;

        // SafeFileHandle fields in STARTUPINFO must never be null (the P/Invoke
        // marshaler throws ArgumentNullException for null SafeHandle values even
        // when STARTF_USESTDHANDLES is not set).  Use non-owning invalid handles.
        var nullHandle = new SafeFileHandle(IntPtr.Zero, false);

        var si = new STARTUPINFO
        {
            cb         = (uint)Marshal.SizeOf(typeof(STARTUPINFO)),
            lpDesktop  = "winsta0\\default",
            dwFlags    = 0,  // no STARTF_USESTDHANDLES -- let the process use the desktop
            hStdInput  = nullHandle,
            hStdOutput = nullHandle,
            hStdError  = nullHandle,
        };

        PROCESS_INFORMATION pi;
        bool created = CreateProcessAsUser(
            userToken,
            null,        // use cmdLine (which starts with the exe path in quotes)
            cmdLine,
            IntPtr.Zero, IntPtr.Zero,
            false,       // do NOT inherit handles
            CREATE_UNICODE_ENVIRONMENT2 | CREATE_NEW_CONSOLE,
            envBlock,
            workingDir,
            ref si,
            out pi);

        if (envBlock != IntPtr.Zero) DestroyEnvironmentBlock(envBlock);

        if (!created)
        {
            int err = Marshal.GetLastWin32Error();
            Console.Error.WriteLine("WinSvcBridge --launch: CreateProcessAsUser failed (" + err
                + ") for exe='" + exePath + "' cmdLine='" + cmdLine + "'");
            return 1;
        }

        Console.Error.WriteLine("WinSvcBridge --launch: started pid=" + pi.dwProcessId
            + " \"" + exePath + "\" in session " + sessionId);
        CloseHandle(pi.hThread);
        CloseHandle(pi.hProcess);
        return 0;
    }

    // -- Launch helper in user session with piped stdin/stdout ----------------

    static int LaunchInUserSession(IntPtr userToken, string helperExe,
        StringBuilder cmdLine, uint sessionId)
    {
        Console.Error.WriteLine("WinSvcBridge: launching " + helperExe
            + " in session " + sessionId);

        // Create pipes for stdin, stdout, stderr
        var saInherit = new SECURITY_ATTRIBUTES
        {
            nLength = (uint)Marshal.SizeOf(typeof(SECURITY_ATTRIBUTES)),
            lpSecurityDescriptor = IntPtr.Zero,
            bInheritHandle = true
        };

        // stdin pipe: parent writes -> child reads
        SafeFileHandle stdinReadChild, stdinWriteParent;
        if (!CreatePipe(out stdinReadChild, out stdinWriteParent, ref saInherit, 0))
            throw new Exception("CreatePipe(stdin) failed: " + Marshal.GetLastWin32Error());
        SetHandleInformation(stdinWriteParent, HANDLE_FLAG_INHERIT, 0);

        // stdout pipe: child writes -> parent reads
        SafeFileHandle stdoutWriteChild, stdoutReadParent;
        if (!CreatePipe(out stdoutReadParent, out stdoutWriteChild, ref saInherit, 0))
            throw new Exception("CreatePipe(stdout) failed: " + Marshal.GetLastWin32Error());
        SetHandleInformation(stdoutReadParent, HANDLE_FLAG_INHERIT, 0);

        // stderr pipe: child writes -> parent reads
        SafeFileHandle stderrWriteChild, stderrReadParent;
        if (!CreatePipe(out stderrReadParent, out stderrWriteChild, ref saInherit, 0))
            throw new Exception("CreatePipe(stderr) failed: " + Marshal.GetLastWin32Error());
        SetHandleInformation(stderrReadParent, HANDLE_FLAG_INHERIT, 0);

        // Build environment block for the user
        IntPtr envBlock = IntPtr.Zero;
        // bInherit=true merges the current-process (service-Session-0) env vars
        // into the user-session env block so that SKIP_SESSION_AUTH and other
        // control variables set by the Node.js daemon reach the child helper.
        CreateEnvironmentBlock(out envBlock, userToken, true);

        string workingDir = Path.GetDirectoryName(helperExe);

        var si = new STARTUPINFO
        {
            cb         = (uint)Marshal.SizeOf(typeof(STARTUPINFO)),
            lpDesktop  = "winsta0\\default",
            dwFlags    = STARTF_USESTDHANDLES,
            hStdInput  = stdinReadChild,
            hStdOutput = stdoutWriteChild,
            hStdError  = stderrWriteChild,
        };

        PROCESS_INFORMATION pi;
        bool created = CreateProcessAsUser(
            userToken,
            helperExe,
            cmdLine,
            IntPtr.Zero,
            IntPtr.Zero,
            true,
            CREATE_UNICODE_ENVIRONMENT,
            envBlock,
            workingDir,
            ref si,
            out pi);

        // Close child-side pipe ends in this process
        stdinReadChild.Dispose();
        stdoutWriteChild.Dispose();
        stderrWriteChild.Dispose();
        if (envBlock != IntPtr.Zero) DestroyEnvironmentBlock(envBlock);

        if (!created)
        {
            int err = Marshal.GetLastWin32Error();
            Console.Error.WriteLine("WinSvcBridge: CreateProcessAsUser failed (error " + err + ")");
            stdinWriteParent.Dispose();
            stdoutReadParent.Dispose();
            stderrReadParent.Dispose();
            return 1;
        }

        CloseHandle(pi.hThread);

        // -- Relay pump -------------------------------------------------------
        // .NET 4 compatible: local variable capture, no 'using var'

        SafeFileHandle capturedStdinWrite  = stdinWriteParent;
        SafeFileHandle capturedStdoutRead  = stdoutReadParent;
        SafeFileHandle capturedStderrRead  = stderrReadParent;

        // Stdin forwarder: Console.In -> child stdin
        var stdinForward = Task.Factory.StartNew(() =>
        {
            try
            {
                using (var fs = new FileStream(capturedStdinWrite, FileAccess.Write, 4096, false))
                using (var reader = new BinaryReader(Console.OpenStandardInput()))
                {
                    byte[] buf = new byte[4096];
                    int n;
                    while ((n = reader.Read(buf, 0, buf.Length)) > 0)
                    {
                        fs.Write(buf, 0, n);
                        fs.Flush();
                    }
                }
            }
            catch (Exception ex)
            {
                // EOF on stdin pipe is expected when parent closes; log only unexpected errors.
                if (!(ex is System.IO.IOException))
                    Console.Error.WriteLine("WinSvcBridge: stdin relay error: " + ex.Message);
            }
        });

        // Stdout forwarder: child stdout -> Console.Out
        var stdoutForward = Task.Factory.StartNew(() =>
        {
            try
            {
                using (var fs = new FileStream(capturedStdoutRead, FileAccess.Read, 4096, false))
                using (var writer = new BinaryWriter(Console.OpenStandardOutput()))
                {
                    byte[] buf = new byte[4096];
                    int n;
                    while ((n = fs.Read(buf, 0, buf.Length)) > 0)
                    {
                        writer.Write(buf, 0, n);
                        writer.Flush();
                    }
                }
            }
            catch (Exception ex)
            {
                if (!(ex is System.IO.IOException))
                    Console.Error.WriteLine("WinSvcBridge: stdout relay error: " + ex.Message);
            }
        });

        // Stderr forwarder: child stderr -> Console.Error
        var stderrForward = Task.Factory.StartNew(() =>
        {
            try
            {
                using (var fs = new FileStream(capturedStderrRead, FileAccess.Read, 4096, false))
                using (var writer = new BinaryWriter(Console.OpenStandardError()))
                {
                    byte[] buf = new byte[4096];
                    int n;
                    while ((n = fs.Read(buf, 0, buf.Length)) > 0)
                    {
                        writer.Write(buf, 0, n);
                        writer.Flush();
                    }
                }
            }
            catch (Exception ex)
            {
                if (!(ex is System.IO.IOException))
                    Console.Error.WriteLine("WinSvcBridge: stderr relay error: " + ex.Message);
            }
        });

        // Wait for child to exit
        WaitForSingleObject(pi.hProcess, 0xFFFFFFFF);

        uint exitCode = 1;
        GetExitCodeProcess(pi.hProcess, out exitCode);
        CloseHandle(pi.hProcess);

        try { Task.WaitAll(new Task[] { stdinForward, stdoutForward, stderrForward },
            TimeSpan.FromSeconds(3)); }
        catch (Exception waitEx) { Console.Error.WriteLine("WinSvcBridge: relay drain timed out: " + waitEx.Message); }

        Console.Error.WriteLine("WinSvcBridge: child exited with code " + exitCode);
        return (int)exitCode;
    }

    // -- Fallback: direct launch in current session ---------------------------

    static int LaunchDirect(string helperExe, string[] args, int firstArg)
    {
        var psi = new ProcessStartInfo
        {
            FileName        = helperExe,
            UseShellExecute = false,
        };
        // Append remaining args
        var sb = new StringBuilder();
        for (int i = firstArg; i < args.Length; i++)
        {
            if (sb.Length > 0) sb.Append(' ');
            sb.Append('"').Append(args[i].Replace("\"", "\\\"")).Append('"');
        }
        psi.Arguments = sb.ToString();

        var proc = Process.Start(psi);
        if (proc != null)
        {
            proc.WaitForExit();
            return proc.ExitCode;
        }
        return 1;
    }
}
