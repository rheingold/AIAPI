# LINUX_MAC_PORTING.md — Guide to reimplementing AIAPI helpers on Linux / macOS

This document is the primary reference for implementing the Linux and macOS helper
executables.  The TypeScript MCP server (`src/`) is already cross-platform and requires
no changes.  Only the **helper executables** (`dist/helpers/`) are platform-specific.

---

## Architecture overview (platform-agnostic parts)

```
AI agent
   │  JSON-RPC over HTTP (port 3457)
   ▼
start-mcp-server.ts          ← TypeScript, Node 18+, no OS API calls
  └─ HelperRegistry.ts       ← spawns helpers, passes JSON over stdin pipe
       ├─ KeyWin.exe  ──┐
       ├─ BrowserWin.exe ├─ Windows only
       ├─ MSOfficeWin.exe┘
       ├─ KeyLin          ─── Linux (to implement)
       ├─ KeyMac          ─── macOS (to implement)
       ├─ BrowserLin      ─── same binary as BrowserWin (CDP is cross-platform!)
       └─ LibreOfficeLin  ─── Linux/macOS (UNO socket, same protocol as LibreOfficeWin)
```

`HelperRegistry.ts` interacts with every helper through the **same stdin pipe protocol** —
JSON lines in, JSON lines out.  The `HelperCommon.cs` source handles the wire protocol
and is compiled into each .exe; on Linux/macOS the helpers can be written in any language
that can read/write JSON lines from stdin/stdout.

---

## Wire protocol (unchanged on all platforms)

See `CONVENTIONS.md §2.7` for the full spec.  Short summary:

**Request (server → helper):**
```json
{"id":"1","target":"writer","action":"READ","path":"body/para[2]","value":""}
```

**Response (helper → server):**
```json
{"id":"1","success":true,"result":"Hello world"}
```

**Required built-in actions** (handled before any command dispatch):
```
{"action":"_schema"}        → returns --api-schema JSON
{"action":"_ping"}          → {"success":true,"pong":true}
{"action":"_exit"}          → clean shutdown
{"action":"_auth_hello",...} → auth handshake step 1 (see auth section)
```

The server sends `--listen-stdin --persistent` as CLI args.  The helper should loop
reading JSON lines from stdin until `_exit` arrives or stdin closes.

---

## Helper: KeyLin / KeyMac — UI automation

### Windows API → Linux equivalent

| Windows | Linux | macOS |
|---|---|---|
| `UIAutomation` (UIA) | AT-SPI2 (`libatspi`) | Accessibility API (`AXUIElement`) |
| `FindWindow` / `EnumWindows` | `xdotool`, `wmctrl`, `libxcb` | `CGWindowListCopyWindowInfo` |
| `SetForegroundWindow` | `_NET_ACTIVE_WINDOW` (EWMH) via `xdotool windowactivate` | `[NSApp activateIgnoringOtherApps:]` |
| `SendInput` (keyboard) | `xdotool key` / `XSendEvent` on Wayland: `libei` / `uinput` | `CGEventPost` |
| `SendInput` (mouse) | `xdotool mousemove click` / `XTest` | `CGEventPost` (CGEventCreateMouseEvent) |
| `GetWindowText` | `xdotool getwindowname` / AT-SPI2 `atspi_accessible_get_name()` | `AXUIElementCopyAttributeValue(kAXTitleAttribute)` |

### AT-SPI2 (Linux — recommended approach)

AT-SPI2 is the standard Linux accessibility API used by GNOME, KDE, XFCE.

```c
// C example (compile with: gcc -o KeyLin KeyLin.c $(pkg-config --cflags --libs atspi-2))
#include <atspi/atspi.h>

atspi_init();
AtspiAccessible *desktop = atspi_get_desktop(0);
int n = atspi_accessible_get_child_count(desktop, NULL);
for (int i = 0; i < n; i++) {
    AtspiAccessible *app = atspi_accessible_get_child_at_index(desktop, i, NULL);
    // query name, role, children...
}
```

**Enabling AT-SPI2 in the target app:**  Most GTK and Qt apps enable it automatically.
For Electron apps: set `ACCESSIBILITY_ENABLED=1` env var or use `--force-renderer-accessibility`.

**QUERYTREE** implementation: use `atspi_accessible_get_child_at_index()` recursively.
Return the same JSON schema as `KeyWin.exe`: `{id, type, name, position, properties, actions, children}`.

**CLICKID**: `atspi_action_do_action(elem, 0)` or use `AtspiComponent.grab_focus()` + click via `XTest`.

**SENDKEYS**: prefer `atspi_generate_keyboard_event()` or `xdotool key <keysym>`.

**Wayland note:** `XTest` and `xdotool` work on XWayland.  For native Wayland, use
`libei` (input emulation) or the `wlr-virtual-pointer` / `zwp_virtual_keyboard` protocols.
Recommend writing a thin `xdotool`/`ydotool` wrapper first, then adding native Wayland
support when the xdotool path proves insufficient.

### macOS Accessibility API

```objc
// Objective-C example
AXUIElementRef systemWide = AXUIElementCreateSystemWide();
CFArrayRef windows;
AXUIElementCopyAttributeValue(systemWide, kAXWindowsAttribute, (CFTypeRef*)&windows);
```

**Enable assistive access:**  The app calling the API must be granted Accessibility
permission in System Preferences → Privacy & Security → Accessibility.
For CLI tools: `tccutil reset Accessibility` + user grant, or use an entitlement.

**SENDKEYS:** `CGEventPost(kCGHIDEventTap, CGEventCreateKeyboardEvent(...))`.

**Mouse:** `CGEventPost(kCGHIDEventTap, CGEventCreateMouseEvent(...))`.

### Recommended implementation language

| Option | Pros | Cons |
|---|---|---|
| **C / C++** | Thin binary, no runtime, easiest P/Invoke from SecurityLib | Verbose |
| **Python** (+ `pyatspi`) | Fast to write, `pyatspi` wraps AT-SPI2 cleanly | Requires Python runtime |
| **Go** | Single static binary, cross-compile from Windows | AT-SPI2 bindings less mature |
| **C# / .NET 6+** | Code-share with `HelperCommon.cs`; same language as Windows helpers | Larger runtime |

**Recommendation:** C# / .NET 6+ is the lowest-friction option since `HelperCommon.cs`
can be reused verbatim.  The only platform-specific code is the AT-SPI2 / AX API calls.
Use P/Invoke from C# to call `libatspi.so` / `HIServices.framework`.

---

## Helper: BrowserLin / BrowserMac — browser automation

**No changes needed.**  The CDP (Chrome DevTools Protocol) implementation in `BrowserWin.cs`
uses raw TCP WebSocket — it is already 100% cross-platform.

The only Windows-specific code in `BrowserWin.cs` is:
- `{FOCUS}`: `SetForegroundWindow` → replace with `xdotool windowactivate $WID`  / `osascript`
- `{LAUNCH}`: browser exe paths → update scan paths for Linux (`/usr/bin/google-chrome`, etc.)
  and macOS (`/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`)
- `{PAGESOURCE}`: clipboard trick uses `SendKeys Ctrl+U/C` → use xdotool on Linux / `pbpaste` on macOS

Everything else (CDP JSON-RPC, WebSocket framing, `QUERYTREE`/`CLICKID`/`FILL`/`EXEC_JS`) works
unchanged.

**Browser exe paths — Linux:**
```
/usr/bin/google-chrome
/usr/bin/google-chrome-stable
/usr/bin/chromium
/usr/bin/chromium-browser
/usr/bin/brave-browser
/opt/brave.com/brave/brave-browser
/usr/bin/microsoft-edge
~/.local/share/applications/*.desktop  ← parse Exec= line
```

**Browser exe paths — macOS:**
```
/Applications/Google Chrome.app/Contents/MacOS/Google Chrome
/Applications/Chromium.app/Contents/MacOS/Chromium
/Applications/Brave Browser.app/Contents/MacOS/Brave Browser
/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge
~/Applications/*.app/Contents/MacOS/*  ← scan
```

---

## Helper: LibreOfficeLin / LibreOfficeMac — LibreOffice / OpenOffice

LibreOffice on Linux and macOS exposes UNO exclusively via the inter-process socket
(the Windows COM bridge does not exist on these platforms).

### Starting LibreOffice with UNO socket

```bash
soffice --headless \
  --accept="socket,host=localhost,port=2002;urp;StarOffice.ServiceManager" \
  --norestore
```

`LibreOfficeWin.cs` already has a `{RELAUNCH}` command that does this.  The same
command works verbatim on Linux/macOS — only the `soffice` executable path changes.

### UNO socket connection from C#

```csharp
// No COM bridge on Linux — use UNO URL resolver
// Requires: libuno_cppuhelpergcc3.so.3 or the .NET UNO bridge (beta)
// Simplest cross-platform approach: use UNO's built-in Python pipe via subprocess

// OR: connect via raw TCP to port 2002 and speak UNO binary protocol
// (complex; use the Java UNO bridge as reference: com.sun.star.bridge.UnoUrlResolver)
```

**Recommended cross-platform approach: Python + `unoconv` / `python-uno`**

LibreOffice ships a Python interpreter (`python` inside the LO install). Use it to
run a small Python bridge script that accepts JSON on stdin, calls UNO APIs, and
returns JSON — exactly the same wire protocol as the other helpers.

```
LibreOfficeLin (shell wrapper)
  └─ python3 lo_helper.py --listen-stdin --persistent
       └─ import uno
          desktop = CreateUnoService("com.sun.star.frame.Desktop")
          # dispatch QUERYTREE / READ / WRITE / FORMAT
```

`lo_helper.py` can be bundled in `dist/helpers/` alongside the exe helpers.

**Alternatively:** The C# implementation (`LibreOfficeWin.cs`) can target .NET 6+ and
run on Linux/macOS with the UNO COM bridge replaced by the UNO socket.  The .NET 6
build of LibreOfficeWin would:
1. Connect via `System.Net.Sockets.TcpClient` to `localhost:2002`
2. Implement the URP (UNO Remote Protocol) binary framing — or use HTTP-UNO bridge
   (LibreOffice can expose UNO over HTTP with `--accept="socket,host=localhost,port=8100;urp;..."`)

### soffice executable paths

| OS | Typical paths |
|---|---|
| Linux | `/usr/bin/soffice`, `/opt/libreoffice*/program/soffice`, `~/.local/lib/libreoffice/program/soffice` |
| macOS | `/Applications/LibreOffice.app/Contents/MacOS/soffice` |

---

## SecurityLib — cross-platform build

`tools/common/security/SecurityLib.cpp` uses only:
- `bcrypt.h` (Windows) → **BCrypt API** (Windows-specific)
- Standard C (`stdio.h`, `string.h`, `stdint.h`)

**Linux/macOS replacement for BCrypt:**  Replace the BCrypt calls with OpenSSL:

| Windows BCrypt | Linux/macOS OpenSSL |
|---|---|
| `BCryptOpenAlgorithmProvider(BCRYPT_SHA256_ALGORITHM)` | `EVP_MD_CTX_new()` + `EVP_DigestInit(ctx, EVP_sha256())` |
| `BCryptHashData` + `BCryptFinishHash` | `EVP_DigestUpdate` + `EVP_DigestFinal` |
| `BCryptCreateHash(BCRYPT_HMAC_FLAG)` | `HMAC(EVP_sha256(), ...)` |

**Build commands:**
```bash
# Linux
gcc -shared -fPIC -o SecurityLib.so SecurityLib.cpp -lssl -lcrypto -lstdc++
# or: g++ -shared -fPIC -o SecurityLib.so SecurityLib.cpp -lssl -lcrypto

# macOS
g++ -dynamiclib -o SecurityLib.dylib SecurityLib.cpp \
    -I$(brew --prefix openssl)/include \
    -L$(brew --prefix openssl)/lib -lssl -lcrypto
```

**P/Invoke from C# (.NET 6+):**
```csharp
[DllImport("SecurityLib")]  // .so on Linux, .dylib on macOS, .dll on Windows
static extern int sec_load(string configPath, string password);
```
.NET resolves the correct extension per platform automatically when no extension is given.

---

## HelperCommon.cs — cross-platform changes needed

The stdin pipe protocol code is cross-platform.  Items that need attention:

| Item | Windows | Linux / macOS |
|---|---|---|
| Named pipe (`--listen-pipe`) | `NamedPipeServerStream` (Win32 path `\\.\pipe\Name`) | POSIX domain socket or FIFO; `NamedPipeServerStream` with `PipeOptions.None` on .NET 6+ works on Linux with path `/tmp/aiapi-Name` |
| `Console.InputEncoding = UTF8` | OK | Already fixed: uses `StreamReader(OpenStandardInput(), UTF8)` |
| `SecurityLib.dll` load path | Same dir as .exe | Same dir; use `SecurityLib.so` / `SecurityLib.dylib` |
| `sec_validate_signature_self()` | Win32 `GetModuleFileName` | Linux: read `/proc/self/exe`; macOS: `_NSGetExecutablePath()` |

---

## Build system

### Linux CI (GitHub Actions suggestion)

```yaml
# .github/workflows/build-linux.yml
jobs:
  build-linux:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-dotnet@v4
        with: { dotnet-version: '8.x' }
      - uses: actions/setup-node@v4
        with: { node-version: '18' }
      - run: npm ci
      - run: npx tsc -p tsconfig.json
      - run: dotnet publish tools/helpers/linux/KeyLin.csproj -r linux-x64 -c Release
      - run: g++ -shared -fPIC -o dist/helpers/SecurityLib.so tools/common/security/SecurityLib.cpp -lssl -lcrypto
      - run: npx pkg dist/start-mcp-server.js --target node18-linux-x64 -o dist/release/aiapi-server-linux-x64
```

### macOS CI

```yaml
  build-macos:
    runs-on: macos-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-dotnet@v4
        with: { dotnet-version: '8.x' }
      - uses: actions/setup-node@v4
        with: { node-version: '18' }
      - run: brew install openssl
      - run: npm ci
      - run: npx tsc -p tsconfig.json
      - run: dotnet publish tools/helpers/mac/KeyMac.csproj -r osx-arm64 -c Release
      - run: g++ -dynamiclib -o dist/helpers/SecurityLib.dylib tools/common/security/SecurityLib.cpp -I$(brew --prefix openssl)/include -L$(brew --prefix openssl)/lib -lssl -lcrypto
      - run: npx pkg dist/start-mcp-server.js --target node18-macos-arm64 -o dist/release/aiapi-server-macos-arm64
```

---

## Recommended porting order

1. **`BrowserLin` / `BrowserMac`** — minimal changes (update exe paths + `{FOCUS}`). Start here.
2. **`LibreOfficeLin`** — Python UNO wrapper; doesn't require AT-SPI2; broadest use case.
3. **`KeyLin`** — C# + AT-SPI2 P/Invoke; write QUERYTREE + CLICKID first, then SENDKEYS.
4. **`KeyMac`** — C# + AXUIElement P/Invoke; same order.
5. **SecurityLib.so / .dylib** — OpenSSL port; straightforward mechanical substitution.
6. **`LibreOfficeMac`** — same as LibreOfficeLin; test on macOS CI runner.

---

## Testing on Linux/macOS

Use `tests/integration/test-full-stack-stdin.js --self-hosted` — the test runner spawns
the Node server and exercises the full stack.  No Windows-specific code in the tests.

Replace the Calculator / Notepad test targets with platform-appropriate apps:
- Linux: `gnome-calculator` (AT-SPI2), `gedit` / `kate` (text editor)
- macOS: `Calculator.app` (AXUIElement), `TextEdit.app`

The MCP JSON-RPC protocol, helper wire protocol, and all TypeScript code are identical.
Only the helper-specific command test targets need updating.
