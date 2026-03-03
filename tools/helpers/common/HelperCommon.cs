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
        Func<string> getSchema)
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

        string line;
        while ((line = stdin.ReadLine()) != null)
        {
            line = line.Trim();
            if (line.Length == 0) continue;

            string id     = HcJson.GetString(line, "id")     ?? "";
            string action = HcJson.GetString(line, "action") ?? "";
            string target = HcJson.GetString(line, "target") ?? "";

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
