// tools/helpers/common/HelperCommon.cs
// ─────────────────────────────────────────────────────────────────────────────
// Shared helper boilerplate — compiled *into* every helper .exe, NOT a DLL.
// This preserves binary integrity: changing this file changes the .exe hash.
//
// Provides:
//   HcJson          — minimal JSON string-value extractor and escaper
//   HelperCommon    — stdin listener loop, flag helpers
//
// Usage in build scripts:
//   csc /target:exe /out:HelperWin.exe HelperWin.cs tools\helpers\common\HelperCommon.cs [...]
//
// C# 5 / .NET 4.0 compatible.  No string interpolation, no nameof(), no
// inline 'out var', no expression-bodied members, no null-conditional ?. 
// ─────────────────────────────────────────────────────────────────────────────

using System;
using System.Text;
using System.Runtime.InteropServices;

// ── HcJson ───────────────────────────────────────────────────────────────────
/// <summary>
/// Minimal hand-rolled JSON helpers — no NuGet, no System.Text.Json.
/// Sufficient for the flat JSON objects used by the helper wire protocol.
/// </summary>
public static class HcJson
{
    // ── GetString ─────────────────────────────────────────────────────────────
    /// <summary>
    /// Extract a string value from a flat JSON object.
    /// Handles basic JSON string-escape sequences: \", \\, \/, \n, \r, \t, \b,
    /// \f, \uXXXX.
    /// Returns null if the key is absent or its value is not a JSON string.
    /// </summary>
    public static string GetString(string json, string key)
    {
        if (json == null || key == null) return null;

        // Search for "key" token
        string needle = "\"" + key + "\"";
        int ki = json.IndexOf(needle, StringComparison.Ordinal);
        if (ki < 0) return null;

        // Find colon separator
        int colon = json.IndexOf(':', ki + needle.Length);
        if (colon < 0) return null;

        // Skip whitespace after colon
        int pos = colon + 1;
        while (pos < json.Length &&
               (json[pos] == ' ' || json[pos] == '\t' || json[pos] == '\r' || json[pos] == '\n'))
            pos++;

        // Value must start with a quote
        if (pos >= json.Length || json[pos] != '"') return null;

        // Collect characters until the closing unescaped quote
        var sb = new StringBuilder();
        int i = pos + 1;
        while (i < json.Length && json[i] != '"')
        {
            if (json[i] == '\\' && i + 1 < json.Length)
            {
                i++;
                switch (json[i])
                {
                    case '"':  sb.Append('"');  break;
                    case '\\': sb.Append('\\'); break;
                    case '/':  sb.Append('/');  break;
                    case 'n':  sb.Append('\n'); break;
                    case 'r':  sb.Append('\r'); break;
                    case 't':  sb.Append('\t'); break;
                    case 'b':  sb.Append('\b'); break;
                    case 'f':  sb.Append('\f'); break;
                    case 'u':
                        if (i + 4 < json.Length)
                        {
                            string hex = json.Substring(i + 1, 4);
                            int code;
                            if (int.TryParse(hex,
                                System.Globalization.NumberStyles.HexNumber,
                                null, out code))
                                sb.Append((char)code);
                            i += 4;
                        }
                        break;
                    default:
                        sb.Append(json[i]);
                        break;
                }
            }
            else
            {
                sb.Append(json[i]);
            }
            i++;
        }

        return sb.ToString();
    }

    // ── EscapeStr ─────────────────────────────────────────────────────────────
    /// <summary>
    /// Escape a raw string for embedding as a JSON string value.
    /// The returned string does NOT include the surrounding double-quotes.
    /// </summary>
    public static string EscapeStr(string s)
    {
        if (s == null) return "";
        var sb = new StringBuilder(s.Length + 8);
        foreach (char c in s)
        {
            switch (c)
            {
                case '"':  sb.Append("\\\""); break;
                case '\\': sb.Append("\\\\"); break;
                case '\n': sb.Append("\\n");  break;
                case '\r': sb.Append("\\r");  break;
                case '\t': sb.Append("\\t");  break;
                case '\b': sb.Append("\\b");  break;
                case '\f': sb.Append("\\f");  break;
                default:
                    if (c < 0x20)
                        sb.Append("\\u" + ((int)c).ToString("X4"));
                    else
                        sb.Append(c);
                    break;
            }
        }
        return sb.ToString();
    }

    // ── GetBool ───────────────────────────────────────────────────────────────
    /// <summary>
    /// Extract a boolean value from a flat JSON object.
    /// Returns true/false for JSON true/false literals; returns null if the key
    /// is absent or its value is not a bare boolean token.
    /// </summary>
    public static bool? GetBool(string json, string key)
    {
        if (json == null || key == null) return null;
        string needle = "\"" + key + "\"";
        int ki = json.IndexOf(needle, StringComparison.Ordinal);
        if (ki < 0) return null;
        int colon = json.IndexOf(':', ki + needle.Length);
        if (colon < 0) return null;
        int pos = colon + 1;
        while (pos < json.Length &&
               (json[pos] == ' ' || json[pos] == '\t' || json[pos] == '\r' || json[pos] == '\n'))
            pos++;
        if (pos + 4 <= json.Length && json.Substring(pos, 4) == "true")  return true;
        if (pos + 5 <= json.Length && json.Substring(pos, 5) == "false") return false;
        return null;
    }

    // ── GetInt ────────────────────────────────────────────────────────────────
    /// <summary>
    /// Extract an integer value from a flat JSON object.
    /// Returns null if the key is absent or its value is not a JSON integer token.
    /// </summary>
    public static int? GetInt(string json, string key)
    {
        if (json == null || key == null) return null;
        string needle = "\"" + key + "\"";
        int ki = json.IndexOf(needle, StringComparison.Ordinal);
        if (ki < 0) return null;
        int colon = json.IndexOf(':', ki + needle.Length);
        if (colon < 0) return null;
        int pos = colon + 1;
        while (pos < json.Length &&
               (json[pos] == ' ' || json[pos] == '\t' || json[pos] == '\r' || json[pos] == '\n'))
            pos++;
        int start = pos;
        if (pos < json.Length && (json[pos] == '-' || json[pos] == '+')) pos++;
        while (pos < json.Length && json[pos] >= '0' && json[pos] <= '9') pos++;
        if (pos == start) return null;
        int result;
        if (int.TryParse(json.Substring(start, pos - start), out result)) return result;
        return null;
    }

    // ── Err ───────────────────────────────────────────────────────────────────
    /// <summary>Build a {"success":false,"error":"msg"} JSON line.</summary>
    public static string Err(string id, string msg)
    {
        string idPart = string.IsNullOrEmpty(id)
            ? ""
            : "\"id\":\"" + EscapeStr(id) + "\",";
        return "{" + idPart + "\"success\":false,\"error\":\"" + EscapeStr(msg) + "\"}";
    }
}

// ── IdInjectingWriter ─────────────────────────────────────────────────────────
/// <summary>
/// A TextWriter wrapper that injects  "id":"&lt;CurrentId&gt;"  into every
/// JSON-object response line (lines starting with '{') before writing to the
/// inner writer.  Set CurrentId to the request id before each command dispatch.
/// Lines that already contain the "id" key are passed through unchanged.
/// Non-JSON lines (not starting with '{') are also passed through unchanged.
///
/// This gives us id-correlation on every response (success AND error) without
/// touching a single Console.WriteLine inside the individual command handlers.
/// </summary>
public sealed class IdInjectingWriter : System.IO.TextWriter
{
    private readonly System.IO.TextWriter _inner;
    private readonly StringBuilder _buf = new StringBuilder();

    /// <summary>The request id injected into the next response line(s). Set before each dispatch.</summary>
    public string CurrentId = "";

    /// <summary>
    /// 32-byte HKDF session key for HMAC signing; null when auth is inactive or SKIP_SESSION_AUTH=true.
    /// When non-null every JSON response line is signed: <c>,"hmac":"&lt;hex&gt;"</c> appended.
    /// </summary>
    public byte[] SessionKey = null;

    public IdInjectingWriter(System.IO.TextWriter inner) { _inner = inner; }

    public override Encoding Encoding { get { return _inner.Encoding; } }

    // Buffer char-by-char; flush at each newline.
    public override void Write(char value)
    {
        if (value == '\n')
            FlushBuf();
        else if (value != '\r')
            _buf.Append(value);
    }

    public override void Write(string value)
    {
        if (value == null) return;
        foreach (char c in value) Write(c);
    }

    public override void WriteLine(string value)
    {
        Write(value);
        FlushBuf();
    }

    public override void WriteLine()
    {
        FlushBuf();
    }

    private void FlushBuf()
    {
        string line = _buf.ToString();
        _buf.Clear();

        // Inject id into JSON objects when id is set and not already present.
        if (line.Length > 0 && line[0] == '{'
            && !string.IsNullOrEmpty(CurrentId)
            && line.IndexOf("\"id\"", StringComparison.Ordinal) < 0)
        {
            line = "{\"id\":\"" + HcJson.EscapeStr(CurrentId) + "\"," + line.Substring(1);
        }

        // Append HMAC signature when session key is active and line is a JSON object.
        if (SessionKey != null && line.Length > 0 && line[0] == '{' && line[line.Length - 1] == '}')
        {
            string hmac = SecurityLib.HmacSha256Hex(SessionKey, line);
            line = line.Substring(0, line.Length - 1) + ",\"hmac\":\"" + hmac + "\"}";
        }
        _inner.WriteLine(line);
        _inner.Flush();
    }

    protected override void Dispose(bool disposing)
    {
        if (_buf.Length > 0) FlushBuf();
        if (disposing) _inner.Dispose();
        base.Dispose(disposing);
    }
}

// ── AuthState ────────────────────────────────────────────────────────────────
/// <summary>
/// Holds authentication state produced by the _auth_hello → _auth → _auth_ok
/// handshake between a helper .exe and the MCP server.
///
/// When SKIP_SESSION_AUTH=true (current dev default), only SkippedAuth is set.
/// Full crypto (HKDF session key) requires SecurityLib — set SessionKey to null
/// until that integration is complete.
/// </summary>
public class AuthState
{
    /// <summary>True once the full _auth handshake completed and _auth_ok was sent.</summary>
    public bool Authenticated;
    /// <summary>True when SKIP_SESSION_AUTH=true bypassed the handshake.</summary>
    public bool SkippedAuth;
    /// <summary>32-byte helper-side nonce sent in _auth_hello.</summary>
    public byte[] HelperNonce;
    /// <summary>32-byte server-side nonce received in _auth.</summary>
    public byte[] ServerNonce;
    /// <summary>Raw PKCS#8 private key bytes received in _auth (base64-decoded).</summary>
    public byte[] PkBytes;
    /// <summary>security/config.json path received in _auth.</summary>
    public string SecurityConfigPath;
    /// <summary>
    /// HKDF-derived session key (32 bytes). Null until SecurityLib integration.
    /// Both sides derive: HKDF-SHA256(pk, SHA256(serverNonce||helperNonce), "AIAPI-v1-session")
    /// </summary>
    public byte[] SessionKey;
}

// ── HelperCommon ─────────────────────────────────────────────────────────────
/// <summary>
/// Shared CLI-flag helpers and stdin listener loop.
/// Compiled into each helper .exe — never loaded at runtime as a separate DLL.
/// </summary>
public static class HelperCommon
{
    // ── HasFlag ───────────────────────────────────────────────────────────────
    /// <summary>Returns true if args contains the exact flag string (case-insensitive).</summary>
    public static bool HasFlag(string[] args, string flag)
    {
        if (args == null || flag == null) return false;
        foreach (string a in args)
            if (string.Equals(a, flag, StringComparison.OrdinalIgnoreCase))
                return true;
        return false;
    }

    // ── GetFlagValue ──────────────────────────────────────────────────────────
    /// <summary>
    /// Returns the value part of a "--key=value" flag from args[], or null if
    /// the flag is not present.  Lookup is case-insensitive.
    /// Example: GetFlagValue(args, "--listen-port") returns "3460" for an arg
    /// "--listen-port=3460".  Returns "" (empty string) for a bare "--listen-port".
    /// </summary>
    public static string GetFlagValue(string[] args, string flag)
    {
        if (args == null || flag == null) return null;
        string prefix = flag.TrimEnd('=') + "=";
        foreach (string a in args)
        {
            if (string.Equals(a, flag, StringComparison.OrdinalIgnoreCase))
                return "";           // bare flag present, no value
            if (a != null && a.StartsWith(prefix, StringComparison.OrdinalIgnoreCase))
                return a.Substring(prefix.Length);
        }
        return null;
    }

    // ── ParseArgs ─────────────────────────────────────────────────────────────
    /// <summary>
    /// Parse all "--key[=value]" flags from args[] into a dictionary.
    /// Keys are lower-cased and stripped of leading "--".
    /// Bare flags ("--persistent") map to the value "true".
    /// Non-flag arguments (not starting with "--") are ignored.
    /// </summary>
    public static System.Collections.Generic.Dictionary<string, string>
        ParseArgs(string[] args)
    {
        var result = new System.Collections.Generic.Dictionary<string, string>(
            StringComparer.OrdinalIgnoreCase);
        if (args == null) return result;
        foreach (string a in args)
        {
            if (a == null || !a.StartsWith("--")) continue;
            int eq = a.IndexOf('=');
            if (eq < 0)
            {
                string k = a.Substring(2).ToLowerInvariant();
                result[k] = "true";
            }
            else
            {
                string k = a.Substring(2, eq - 2).ToLowerInvariant();
                result[k] = a.Substring(eq + 1);
            }
        }
        return result;
    }

    // ── RunAuthHandshake ──────────────────────────────────────────────────────
    /// <summary>
    /// Performs the _auth_hello → _auth → _auth_ok exchange on stdin/stdout.
    ///
    /// Must be called from each helper's main() in the --listen-stdin branch,
    /// BEFORE calling RunStdinListener().  Both methods independently wrap
    /// Console.OpenStandardInput/Output() — sequential execution on the same
    /// underlying OS pipe handle is safe with no leftover buffering.
    ///
    /// When skipAuth is true (SKIP_SESSION_AUTH env var = "true"), returns
    /// immediately with AuthState.SkippedAuth = true so the rest of the helper
    /// operates without change.
    ///
    /// If the exchange fails (stdin closes, wrong action received), exits with
    /// exit code 78 (SECURITY_TAMPER sentinel).
    /// </summary>
    public static AuthState RunAuthHandshake(bool skipAuth)
    {
        var state = new AuthState();
        if (skipAuth) { state.SkippedAuth = true; return state; }

        var utf8   = new System.Text.UTF8Encoding(false);   // no BOM
        var reader = new System.IO.StreamReader(Console.OpenStandardInput(),  utf8);
        var writer = new System.IO.StreamWriter(Console.OpenStandardOutput(), utf8) { AutoFlush = true };

        // 1. Compute self SHA-256 (exe path from executing assembly).
        string exeHash = "";
        try
        {
            string exePath = System.Reflection.Assembly.GetExecutingAssembly().Location;
            using (var sha = System.Security.Cryptography.SHA256.Create())
            using (var fs  = System.IO.File.OpenRead(exePath))
            {
                byte[] h = sha.ComputeHash(fs);
                var sb = new System.Text.StringBuilder(64);
                foreach (byte b in h) sb.Append(b.ToString("x2"));
                exeHash = sb.ToString();
            }
        }
        catch { /* non-fatal — send empty hash */ }

        // 2. Generate 32-byte helper nonce.
        var nonce = new byte[32];
        using (var rng = new System.Security.Cryptography.RNGCryptoServiceProvider())
            rng.GetBytes(nonce);
        state.HelperNonce = nonce;

        // 3. Send _auth_hello.
        writer.WriteLine(
            "{\"action\":\"_auth_hello\",\"helperNonce\":\"" +
            HcJson.EscapeStr(Convert.ToBase64String(nonce)) +
            "\",\"exeHash\":\"" + HcJson.EscapeStr(exeHash) + "\",\"dllHash\":\"\"}");

        // 4. Read _auth response (blocking — server drives timing).
        string authLine = reader.ReadLine();
        if (authLine == null)
        {
            Console.Error.WriteLine("AIAPI: stdin closed before _auth — exiting (78).");
            System.Environment.Exit(78);
        }

        string authAction = HcJson.GetString(authLine, "action") ?? "";
        if (!string.Equals(authAction, "_auth", StringComparison.Ordinal))
        {
            Console.Error.WriteLine("AIAPI: expected _auth, got: " +
                authLine.Substring(0, Math.Min(120, authLine.Length)));
            System.Environment.Exit(78);
        }

        // 5. Parse fields from _auth.
        string pkB64       = HcJson.GetString(authLine, "pk")            ?? "";
        string srvNonceB64 = HcJson.GetString(authLine, "serverNonce")   ?? "";
        state.SecurityConfigPath = HcJson.GetString(authLine, "securityConfig") ?? "";
        try { state.PkBytes     = Convert.FromBase64String(pkB64);       } catch { state.PkBytes     = new byte[0]; }
        try { state.ServerNonce = Convert.FromBase64String(srvNonceB64); } catch { state.ServerNonce = new byte[0]; }

        // sec_load(); derive session key via HKDF-SHA256 (SecurityLib)
        if (state.PkBytes != null && state.PkBytes.Length > 0 &&
            !string.IsNullOrEmpty(state.SecurityConfigPath))
        {
            try
            {
                int loadRc = SecurityLib.SecLoad(state.PkBytes, state.SecurityConfigPath);
                if (loadRc < 0)
                {
                    Console.Error.WriteLine("AIAPI: sec_load failed (" + loadRc + ") — exiting (78).");
                    System.Environment.Exit(78);
                }

                // Derive session key: HKDF-SHA256(pk, SHA256(serverNonce||helperNonce), "AIAPI-v1-session")
                byte[] saltSrc = SecurityLib.Concat(state.ServerNonce, state.HelperNonce);
                byte[] saltHash = SecurityLib.Sha256Bytes(saltSrc);
                var key = new byte[32];
                int hkdfRc = SecurityLib.SecHkdf(state.PkBytes, saltHash, "AIAPI-v1-session", key);
                if (hkdfRc != 0)
                {
                    Console.Error.WriteLine("AIAPI: sec_hkdf_sha256 failed (" + hkdfRc + ") — exiting (78).");
                    System.Environment.Exit(78);
                }
                state.SessionKey = key;

                // Validate this helper's own binary signature against config.json.
                // DllNotFoundException cannot occur here — DLL already loaded via SecLoad.
                SecurityLib.ValidateSelfOrExit();
            }
            catch (DllNotFoundException)
            {
                // SecurityLib.dll not built yet — security enforcement unavailable.
                // Log a warning and continue without session key (same as SKIP_SESSION_AUTH).
                Console.Error.WriteLine("AIAPI: WARNING — SecurityLib.dll not found; " +
                    "security filter enforcement disabled. " +
                    "Build SecurityLib.dll to enable native security.");
            }
            catch (BadImageFormatException ex)
            {
                Console.Error.WriteLine("AIAPI: WARNING — SecurityLib.dll architecture mismatch: " +
                    ex.Message + "; security enforcement disabled.");
            }
        }

        // 6. Send _auth_ok.
        writer.WriteLine("{\"action\":\"_auth_ok\"}");
        state.Authenticated = true;
        return state;
    }

    // ── RunHttpListener ───────────────────────────────────────────────────────
    /// <summary>
    /// HTTP/1.1 JSON command listener on loopback (127.0.0.1 / localhost).
    ///
    /// Binds to http://localhost:{port}/ and accepts POST / requests whose body
    /// is a flat JSON object:  {"id":"1","action":"...","target":"..."}
    ///
    /// Same built-in actions as the stdin protocol:
    ///   _schema — returns the helper's schema JSON
    ///   _ping   — returns {"success":true,"pong":true}
    ///   _exit   — returns {"success":true,"message":"bye"} and stops the listener
    ///
    /// GET requests to any path return {"success":true,"pong":true} (health check).
    ///
    /// Blocks (single-threaded, one call at a time) until _exit or listener error.
    /// </summary>
    public static int RunHttpListener(
        int port,
        Action<string, string> dispatch,
        Func<string> getSchema)
    {
        string prefix      = "http://localhost:" + port + "/";
        var    httpListener = new System.Net.HttpListener();
        httpListener.Prefixes.Add(prefix);
        try { httpListener.Start(); }
        catch (Exception ex)
        {
            Console.Error.WriteLine("AIAPI: RunHttpListener: cannot bind " +
                prefix + " — " + ex.Message);
            return 1;
        }
        Console.Error.WriteLine("AIAPI: HTTP listener ready on " + prefix);

        var utf8 = new System.Text.UTF8Encoding(false);  // no BOM

        while (true)
        {
            System.Net.HttpListenerContext ctx;
            try { ctx = httpListener.GetContext(); }
            catch { break; }   // listener stopped externally

            string responseJson;
            try
            {
                // ── GET → simple pong (health check / browser probing) ───────
                if (!string.Equals(ctx.Request.HttpMethod, "POST", StringComparison.OrdinalIgnoreCase))
                {
                    responseJson = "{\"success\":true,\"pong\":true}";
                }
                else
                {
                    // ── Read POST body ──────────────────────────────────────────
                    string body = "";
                    try
                    {
                        var ms = new System.IO.MemoryStream();
                        ctx.Request.InputStream.CopyTo(ms);
                        body = utf8.GetString(ms.ToArray());
                    }
                    catch { /* treat as empty */ }

                    string id     = HcJson.GetString(body, "id")     ?? "";
                    string action = HcJson.GetString(body, "action") ?? "";
                    string target = HcJson.GetString(body, "target") ?? "";
                    string hProc  = HcJson.GetString(body, "proc")   ?? "";
                    string hPath  = HcJson.GetString(body, "path")   ?? "";
                    string hValue = HcJson.GetString(body, "value")  ?? "";
                    if (hProc.Length > 0) target = hProc;

                    // ── Built-in actions ────────────────────────────────────────
                    if (action == "_schema")
                    {
                        responseJson = getSchema();
                    }
                    else if (action == "_ping")
                    {
                        responseJson = "{\"success\":true,\"pong\":true}";
                    }
                    else if (action == "_exit")
                    {
                        // Send response BEFORE stopping the listener.
                        byte[] exitBuf = utf8.GetBytes("{\"success\":true,\"message\":\"bye\"}");
                        ctx.Response.StatusCode      = 200;
                        ctx.Response.ContentType     = "application/json";
                        ctx.Response.ContentLength64 = exitBuf.Length;
                        ctx.Response.OutputStream.Write(exitBuf, 0, exitBuf.Length);
                        ctx.Response.Close();
                        httpListener.Stop();
                        return 0;
                    }
                    else if (action.Length == 0)
                    {
                        responseJson = HcJson.Err(id, "missing_action");
                    }
                    else
                    {
                        // ── Dispatch: redirect Console.Out to capture output ────
                        // dispatch() writes its JSON result to Console.Out (same
                        // contract as RunStdinListener).  We capture it via a
                        // temporary redirect and IdInjectingWriter so the "id"
                        // field is injected automatically.
                        var origOut    = Console.Out;
                        var captureSw  = new System.IO.StringWriter();
                        var injectWr   = new IdInjectingWriter(captureSw);
                        injectWr.CurrentId = id;
                        Console.SetOut(injectWr);
                        try
                        {
                            // Reject legacy packed {CMD:param} format — only bare verb + path + value accepted
                            if (action.Length > 0 && action[0] == '{')
                            {
                                Console.WriteLine(HcJson.Err(id, "legacy_{CMD:param}_format_rejected:use_bare_action+path+value"));
                                goto skipDispatch;
                            }
                            // Assemble {CMD:param} token for internal dispatch
                            {
                                string param;
                                if (hPath.Length > 0 && hValue.Length > 0)  param = hPath + "|" + hValue;
                                else if (hPath.Length > 0)                  param = hPath;
                                else if (hValue.Length > 0)                 param = hValue;
                                else                                        param = "";
                                action = param.Length > 0 ? "{" + action + ":" + param + "}" : "{" + action + "}";
                            }
                            dispatch(target, action);
                            skipDispatch:;
                        }
                        catch (Exception ex)
                        {
                            Console.WriteLine(HcJson.Err(id, ex.Message));
                        }
                        finally
                        {
                            Console.SetOut(origOut);
                        }
                        responseJson = captureSw.ToString().Trim();
                        if (responseJson.Length == 0)
                            responseJson = HcJson.Err(id, "dispatch_no_response");
                    }

                    // ── Manual id inject (covers _schema/_ping/error paths) ────
                    if (id.Length > 0
                        && responseJson.Length > 0 && responseJson[0] == '{'
                        && responseJson.IndexOf("\"id\"", StringComparison.Ordinal) < 0)
                    {
                        responseJson = "{\"id\":\"" + HcJson.EscapeStr(id) +
                            "\"," + responseJson.Substring(1);
                    }
                }
            }
            catch (Exception ex)
            {
                responseJson = "{\"success\":false,\"error\":\"internal:" +
                    HcJson.EscapeStr(ex.Message) + "\"}";
            }

            // ── Write HTTP response ─────────────────────────────────────────
            // Use 500 when the JSON body signals failure so direct HTTP callers
            // get an unambiguous error at the transport level too.
            bool httpError = responseJson.IndexOf("\"success\":false", StringComparison.Ordinal) >= 0;
            try
            {
                byte[] respBuf               = utf8.GetBytes(responseJson);
                ctx.Response.StatusCode      = httpError ? 500 : 200;
                ctx.Response.ContentType     = "application/json";
                ctx.Response.ContentLength64 = respBuf.Length;
                ctx.Response.OutputStream.Write(respBuf, 0, respBuf.Length);
            }
            catch { /* best-effort */ }
            finally
            {
                try { ctx.Response.Close(); } catch { }
            }
        }

        httpListener.Stop();
        return 0;
    }

    // ── RunNamedPipeListener ──────────────────────────────────────────────────
    /// <summary>
    /// Windows named-pipe JSON command listener.
    ///
    /// Creates a single-instance named-pipe server.  After each client
    /// disconnects the pipe is recreated so a new client can connect
    /// (multi-caller, sequential).  The server stops only when a client sends
    /// <c>{"action":"_exit"}</c>.
    ///
    /// <paramref name="pipeName"/> may be supplied as a bare name ("MyPipe") or
    /// as a full path ("\\.\pipe\MyPipe") — the prefix is stripped if present.
    ///
    /// The wire protocol is identical to the stdin listener: one JSON object
    /// per line; built-in _schema / _ping / _exit handled before dispatch.
    ///
    /// Requires System.Core.dll (System.IO.Pipes namespace, .NET 3.5+).
    /// </summary>
    public static int RunNamedPipeListener(
        string pipeName,
        Action<string, string> dispatch,
        Func<string> getSchema)
    {
        // Accept both "\\.\pipe\MyPipe" and bare "MyPipe"
        const string pfx = "\\\\.\\pipe\\";
        if (pipeName.StartsWith(pfx, StringComparison.OrdinalIgnoreCase))
            pipeName = pipeName.Substring(pfx.Length);
        if (pipeName.Length == 0)
        {
            Console.Error.WriteLine("AIAPI: RunNamedPipeListener: pipe name is empty");
            return 1;
        }

        var utf8 = new System.Text.UTF8Encoding(false);  // no BOM
        Console.Error.WriteLine("AIAPI: named pipe listener ready at \\\\.\\pipe\\" + pipeName);

        while (true)
        {
            // ── Create pipe server instance ─────────────────────────────────
            System.IO.Pipes.NamedPipeServerStream pipe;
            try
            {
                pipe = new System.IO.Pipes.NamedPipeServerStream(
                    pipeName,
                    System.IO.Pipes.PipeDirection.InOut,
                    1,   // single server instance; re-created after each disconnect
                    System.IO.Pipes.PipeTransmissionMode.Byte,
                    System.IO.Pipes.PipeOptions.None);
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine("AIAPI: RunNamedPipeListener: cannot create pipe '" +
                    pipeName + "': " + ex.Message);
                return 1;
            }

            // ── Wait for next client ────────────────────────────────────────
            try { pipe.WaitForConnection(); }
            catch (Exception ex)
            {
                Console.Error.WriteLine("AIAPI: RunNamedPipeListener: wait failed: " + ex.Message);
                try { pipe.Dispose(); } catch { }
                break;
            }

            // ── Serve client: redirect Console.Out to the pipe ─────────────
            // Same pattern as RunStdinListener — Console.Out is replaced with
            // an IdInjectingWriter that targets the pipe StreamWriter so dispatch
            // functions write directly to the connected client.
            var origOut    = Console.Out;
            var pipeWriter = new System.IO.StreamWriter(pipe, utf8) { AutoFlush = true };
            var pipeReader = new System.IO.StreamReader(pipe, utf8);
            var injectWr   = new IdInjectingWriter(pipeWriter);
            Console.SetOut(injectWr);

            bool exitReceived = false;
            try
            {
                string line;
                while ((line = pipeReader.ReadLine()) != null)
                {
                    line = line.Trim();
                    if (line.Length == 0) continue;

                    string id     = HcJson.GetString(line, "id")     ?? "";
                    string action = HcJson.GetString(line, "action") ?? "";
                    string target = HcJson.GetString(line, "target") ?? "";
                    string hProc  = HcJson.GetString(line, "proc")   ?? "";
                    string hPath  = HcJson.GetString(line, "path")   ?? "";
                    string hValue = HcJson.GetString(line, "value")  ?? "";
                    if (hProc.Length > 0) target = hProc;

                    injectWr.CurrentId = id;

                    if (action == "_schema")
                    {
                        try { Console.WriteLine(getSchema()); }
                        catch (Exception ex) { Console.WriteLine(HcJson.Err(id, "schema_error: " + ex.Message)); }
                    }
                    else if (action == "_ping")
                    {
                        Console.WriteLine("{\"success\":true,\"pong\":true}");
                    }
                    else if (action == "_exit")
                    {
                        Console.WriteLine("{\"success\":true,\"message\":\"bye\"}");
                        exitReceived = true;
                        break;
                    }
                    else if (action.Length == 0)
                    {
                        Console.WriteLine(HcJson.Err(id, "missing_action"));
                    }
                    else
                    {
                        // Reject legacy packed {CMD:param} format
                        if (action.Length > 0 && action[0] == '{')
                        {
                            Console.WriteLine(HcJson.Err(id, "legacy_{CMD:param}_format_rejected:use_bare_action+path+value"));
                        }
                        else
                        {
                            // Assemble {CMD:param} token for internal dispatch
                            string param;
                            if (hPath.Length > 0 && hValue.Length > 0)  param = hPath + "|" + hValue;
                            else if (hPath.Length > 0)                  param = hPath;
                            else if (hValue.Length > 0)                 param = hValue;
                            else                                        param = "";
                            action = param.Length > 0 ? "{" + action + ":" + param + "}" : "{" + action + "}";
                            try   { dispatch(target, action); }
                            catch (Exception ex) { Console.WriteLine(HcJson.Err(id, ex.Message)); }
                        }
                    }
                }
            }
            catch { /* client disconnected mid-stream */ }
            finally
            {
                Console.SetOut(origOut);
                try { pipe.Disconnect(); } catch { }
                try { pipe.Dispose();    } catch { }
            }

            if (exitReceived) return 0;
            // Client disconnected — loop back and accept the next client
        }

        return 0;
    }

    // ── RunStdinListener ──────────────────────────────────────────────────────
    /// <summary>
    /// Newline-delimited JSON stdin listener.
    ///
    /// Reads lines from Console.In. Each non-empty line must be a JSON object
    /// with at minimum an "action" field; optional "target" and "id" fields are
    /// also extracted.
    ///
    /// Built-in actions (handled BEFORE calling <paramref name="dispatch"/>):
    ///
    ///   _schema  — calls getSchema() and writes the returned JSON to Console.Out.
    ///   _exit    — writes {"success":true} and returns 0 immediately.
    ///
    /// All other actions are forwarded to <paramref name="dispatch"/>(target,action).
    /// The delegate is responsible for writing exactly one JSON line to Console.Out.
    ///
    /// Loop termination:
    ///   persistent=false (default) — exits after the first successfully dispatched
    ///     command, or on EOF/empty stream.
    ///   persistent=true            — loops until _exit is received or stdin closes
    ///     due to an OS signal.
    ///
    /// Parameters:
    ///   persistent — keep reading after the first command
    ///   dispatch   — Action(target, action): must write one JSON result line
    ///   getSchema  — Func returning the JSON schema string
    /// </summary>
    public static int RunStdinListener(
        bool persistent,
        Action<string, string> dispatch,
        Func<string> getSchema,
        AuthState authState = null)
    {
        // Use explicit UTF-8 for stdin/stdout regardless of the system code page.
        // We use stream wrappers instead of Console.InputEncoding/OutputEncoding
        // because those properties throw IOException when stdin/stdout are pipes
        // (.NET 4.0 on Windows).
        var utf8    = new System.Text.UTF8Encoding(false);   // no BOM
        var stdin   = new System.IO.StreamReader(Console.OpenStandardInput(),  utf8);
        var stdoutW = new System.IO.StreamWriter(Console.OpenStandardOutput(), utf8) { AutoFlush = true };
        // Wrap the raw UTF-8 writer with the auto-id-injector so that every
        // JSON object response gets the request "id" echoed automatically —
        // no changes needed to individual command handlers.
        var injectingWriter = new IdInjectingWriter(stdoutW);
        Console.SetOut(injectingWriter);
        // Wire the session key so outgoing responses are HMAC-signed.
        injectingWriter.SessionKey = (authState != null) ? authState.SessionKey : null;

        string line;
        while ((line = stdin.ReadLine()) != null)
        {
            line = line.Trim();
            if (line.Length == 0) continue;

            string id     = HcJson.GetString(line, "id")     ?? "";
            string action = HcJson.GetString(line, "action") ?? "";
            string target = HcJson.GetString(line, "target") ?? "";
            string hProc  = HcJson.GetString(line, "proc")   ?? "";
            string hPath  = HcJson.GetString(line, "path")   ?? "";
            string hValue = HcJson.GetString(line, "value")  ?? "";
            if (hProc.Length > 0) target = hProc;

            // ── HMAC verification (if session key established) ──────────────
            if (injectingWriter.SessionKey != null)
            {
                string hmacField = HcJson.GetString(line, "hmac") ?? "";
                if (hmacField.Length > 0)
                {
                    // The sender appended ,"hmac":"<hex>"} as the last field.
                    int hmacIdx = line.LastIndexOf(",\"hmac\":\"");
                    if (hmacIdx >= 0)
                    {
                        string body = line.Substring(0, hmacIdx) + "}";
                        string expected = SecurityLib.HmacSha256Hex(
                            injectingWriter.SessionKey,
                            System.Text.Encoding.UTF8.GetBytes(body));
                        if (!string.Equals(expected, hmacField, StringComparison.OrdinalIgnoreCase))
                        {
                            injectingWriter.CurrentId = id;
                            Console.WriteLine(HcJson.Err(id, "hmac_mismatch"));
                            if (!persistent) break;
                            continue;
                        }
                    }
                }
            }

            // Set the current request id BEFORE any writes (covers _schema, _ping, etc.)
            injectingWriter.CurrentId = id;

            // ── Built-in actions ────────────────────────────────────────────
            if (action == "_schema")
            {
                try
                {
                    Console.WriteLine(getSchema());
                }
                catch (Exception ex)
                {
                    Console.WriteLine(HcJson.Err(id, "schema_error: " + ex.Message));
                }
                if (!persistent) break;
                continue;
            }

            if (action == "_ping")
            {
                Console.WriteLine("{\"success\":true,\"pong\":true}");
                if (!persistent) break;
                continue;
            }

            if (action == "_exit")
            {
                Console.WriteLine("{\"success\":true,\"message\":\"bye\"}");
                return 0;
            }

            if (action.Length == 0)
            {
                Console.WriteLine(HcJson.Err(id, "missing_action"));
                if (!persistent) break;
                continue;
            }

            // ── Command dispatch ────────────────────────────────────────────
            // Reject legacy packed {CMD:param} format — bare verb + path + value is the only valid format
            if (action.Length > 0 && action[0] == '{')
            {
                Console.WriteLine(HcJson.Err(id, "legacy_{CMD:param}_format_rejected:use_bare_action+path+value"));
                if (!persistent) break;
                continue;
            }
            // Assemble {CMD:param} token for internal dispatch
            {
                string param;
                if (hPath.Length > 0 && hValue.Length > 0)  param = hPath + "|" + hValue;
                else if (hPath.Length > 0)                  param = hPath;
                else if (hValue.Length > 0)                 param = hValue;
                else                                        param = "";
                action = param.Length > 0 ? "{" + action + ":" + param + "}" : "{" + action + "}";
            }
            try
            {
                dispatch(target, action);
            }
            catch (Exception ex)
            {
                Console.WriteLine(HcJson.Err(id, ex.Message));
            }

            if (!persistent) break;   // one-shot: exit after first command
        }
        return 0;
    }
}

// ── SecurityLib ───────────────────────────────────────────────────────────────
/// <summary>
/// P/Invoke bindings for SecurityLib.dll — the native C++ security enforcement
/// library.  All helpers load this DLL at startup to verify binary hashes,
/// evaluate security filter rules, and derive HKDF session keys.
///
/// Prerequisite: SecurityLib.dll must be in the same directory as the .exe,
/// or on the system PATH / DLL search path.
///
/// SEC_* constants mirror SecurityLib.h.
/// </summary>
public static class SecurityLib
{
    // ── Return codes ──────────────────────────────────────────────────────────
    public const int SEC_ALLOW              =  1;
    public const int SEC_DENY               =  0;
    public const int SEC_ASK                =  2;
    public const int SEC_ERROR_UNLOADED     = -1;
    public const int SEC_ERROR_CONFIG       = -2;
    public const int SEC_ERROR_IO           = -3;
    public const int SEC_ERROR_CRYPTO       = -4;
    public const int SEC_ERROR_SIG_MISMATCH = -5;
    public const int SEC_ERROR_BADARG       = -6;
    public const int SECURITY_TAMPER        = 77;

    // ── DllImport declarations ────────────────────────────────────────────────
    [DllImport("SecurityLib.dll", EntryPoint = "sec_load",
               CallingConvention = CallingConvention.Cdecl, CharSet = CharSet.Ansi)]
    private static extern int sec_load_impl(byte[] pkBytes, int pkLen, string configPath);

    [DllImport("SecurityLib.dll", EntryPoint = "sec_load",
               CallingConvention = CallingConvention.Cdecl, CharSet = CharSet.Ansi)]
    private static extern int sec_load_null(IntPtr pkBytes, int pkLen, string configPath);

    [DllImport("SecurityLib.dll", EntryPoint = "sec_validate_signature",
               CallingConvention = CallingConvention.Cdecl, CharSet = CharSet.Ansi)]
    public static extern int sec_validate_signature(string exePath);

    [DllImport("SecurityLib.dll", EntryPoint = "sec_validate_signature_self",
               CallingConvention = CallingConvention.Cdecl)]
    public static extern int sec_validate_signature_self();

    [DllImport("SecurityLib.dll", EntryPoint = "sec_validate_action",
               CallingConvention = CallingConvention.Cdecl, CharSet = CharSet.Ansi)]
    public static extern int sec_validate_action(
        string action, string target,
        string processName, string processPath,
        string processHash, int processId);

    [DllImport("SecurityLib.dll", EntryPoint = "sec_hkdf_sha256",
               CallingConvention = CallingConvention.Cdecl, CharSet = CharSet.Ansi)]
    private static extern int sec_hkdf_sha256_impl(
        byte[] ikm, int ikmLen, byte[] salt, int saltLen,
        string info, int infoLen, byte[] outBuf, int outLen);

    [DllImport("SecurityLib.dll", EntryPoint = "sec_get_session_key",
               CallingConvention = CallingConvention.Cdecl)]
    private static extern int sec_get_session_key_impl(byte[] outBuf, int outLen);

    [DllImport("SecurityLib.dll", EntryPoint = "sec_unload",
               CallingConvention = CallingConvention.Cdecl)]
    public static extern void sec_unload();

    // ── Public wrappers ───────────────────────────────────────────────────────

    /// <summary>
    /// Load security config.  Pass pkBytes=null to skip config.json.sig verification
    /// (dev mode / SKIP_SESSION_AUTH).  Returns 0 on success, negative on error.
    /// </summary>
    public static int SecLoad(byte[] pkBytes, string configPath)
    {
        if (pkBytes == null || pkBytes.Length == 0)
            return sec_load_null(IntPtr.Zero, 0, configPath);
        return sec_load_impl(pkBytes, pkBytes.Length, configPath);
    }

    /// <summary>
    /// Derive a 32-byte HKDF-SHA256 session key.
    /// ikm  = raw private key bytes; salt = SHA256(serverNonce||helperNonce);
    /// info = "AIAPI-v1-session".
    /// Returns 0 on success and fills outKey[0..31].
    /// </summary>
    public static int SecHkdf(byte[] ikm, byte[] salt, string info, byte[] outKey)
    {
        if (ikm  == null || ikm.Length  == 0) return SEC_ERROR_BADARG;
        if (salt == null || salt.Length == 0) return SEC_ERROR_BADARG;
        if (outKey == null || outKey.Length < 32) return SEC_ERROR_BADARG;
        var infoBytes = System.Text.Encoding.UTF8.GetBytes(info ?? "");
        return sec_hkdf_sha256_impl(
            ikm,  ikm.Length,
            salt, salt.Length,
            info, infoBytes.Length,
            outKey, outKey.Length);
    }

    /// <summary>
    /// Verify this DLL's own hash against config.json and exit(77) on tamper.
    /// Call from main() BEFORE reading any stdin, AFTER sec_load().
    /// </summary>
    public static void ValidateSelfOrExit()
    {
        int r = sec_validate_signature_self();
        if (r == SECURITY_TAMPER)
        {
            Console.Error.WriteLine("AIAPI: SecurityLib tamper detected — exiting (77).");
            System.Environment.Exit(SECURITY_TAMPER);
        }
    }

    // ── Internal helpers ──────────────────────────────────────────────────────

    /// <summary>Concatenate two byte arrays.</summary>
    internal static byte[] Concat(byte[] a, byte[] b)
    {
        if (a == null && b == null) return new byte[0];
        if (a == null) return b;
        if (b == null) return a;
        var result = new byte[a.Length + b.Length];
        Buffer.BlockCopy(a, 0, result, 0, a.Length);
        Buffer.BlockCopy(b, 0, result, a.Length, b.Length);
        return result;
    }

    /// <summary>SHA-256 hash of a byte array using managed BCL (no P/Invoke).</summary>
    internal static byte[] Sha256Bytes(byte[] data)
    {
        if (data == null) return new byte[32];
        using (var sha = System.Security.Cryptography.SHA256.Create())
            return sha.ComputeHash(data);
    }

    /// <summary>
    /// HMAC-SHA256 of a UTF-8 string using managed BCL (no P/Invoke).
    /// Returns lowercase hex string.  Safe to call even when SecurityLib.dll is absent.
    /// </summary>
    internal static string HmacSha256Hex(byte[] key, string data)
    {
        return HmacSha256Hex(key, System.Text.Encoding.UTF8.GetBytes(data ?? ""));
    }

    /// <summary>
    /// HMAC-SHA256 of a byte array using managed BCL (no P/Invoke).
    /// Returns lowercase hex string.  Safe to call even when SecurityLib.dll is absent.
    /// </summary>
    internal static string HmacSha256Hex(byte[] key, byte[] data)
    {
        using (var hmac = new System.Security.Cryptography.HMACSHA256(key))
        {
            byte[] hash = hmac.ComputeHash(data ?? new byte[0]);
            var sb = new System.Text.StringBuilder(64);
            foreach (byte b in hash) sb.Append(b.ToString("x2"));
            return sb.ToString();
        }
    }
}
