# Platform UI Technology Coverage & Architecture Proposal

> **Status:** Addendum to TODO.md — will be promoted to a full architectural spec when F-3
> (Platform Portability) moves out of backlog.
>
> **Purpose:**
> 1. Enumerate every UI accessibility / automation technology across all target platforms.
> 2. State current coverage in `KeyWin.exe` (and sibling helpers).
> 3. Propose a unified architectural model that minimises the number of MCP commands and
>    helper switches regardless of which platform or UI stack is targeted.

---

## Part 1 — UI Technology Taxonomy

### Legend
| Symbol | Meaning |
|--------|---------|
| ✅ | Fully implemented in current helper |
| 🟡 | Partially implemented / fallback path only |
| ❌ | Not implemented |
| 🔵 | Architectural proposal item (future) |

---

### 1.1 Windows

#### Win32 / Classic (Win3.1 – Win11)
| Technology | Layer | KeyWin.exe coverage |
|---|---|---|
| `WM_GETTEXT` / `EnumChildWindows` | Lowest — any HWND | ✅ Used in `GetEditControlForDirectInject` |
| `GetDlgItemText` / `SendMessage WM_SETTEXT` | Dialog controls | ✅ `SendMessage` family present |
| `PostMessage WM_CHAR` | Character-level input | ✅ Classic fallback path |
| `EM_REPLACESEL` / `EM_SETSEL` (RichEdit) | Rich edit controls | ✅ Used for Win11 Notepad RichEditD2DPT |
| `SendInput` (keyboard / mouse) | HID-level synthetic input | ✅ `SendInputKeys` path |
| MSAA `IAccessible` | Accessibility COM, Win95+ | ❌ Not yet used |
| **UI Automation (UIA)** | Modern accessibility, Vista+ | ✅ Primary tree-read + pattern path |
| — `ControlType.*` tree walk | UIA node enumeration | ✅ `FindFirst` / `FindAll` with conditions |
| — `ValuePattern.SetValue` | Text set, WPF / UWP | ✅ Attempted first in Document path |
| — `TextPattern.DocumentRange.Select` | Text selection | ✅ Used for `{CTRL+A}` |
| — `InvokePattern.Invoke` | Button / menu item click | ✅ Used for UIA Undo menu |
| — `ExpandCollapsePattern` | Menus / tree nodes | ✅ Used for Edit-menu undo |
| — `SelectionItemPattern` | List / combo selection | ✅ Via `CLICKID` / `SET` commands |
| — `TogglePattern` | Checkboxes | ✅ `CHECK` / `UNCHECK` commands |
| `FindWindowEx` | Child HWND by class name | ✅ Finds `Edit`, `RichEdit` |

#### WinForms (.NET)
| Technology | KeyWin.exe coverage |
|---|---|
| Exposes native HWNDs → UIA providers | ✅ Covered by UIA path above |

#### WPF (Windows Presentation Foundation — DirectX rendered)
| Technology | KeyWin.exe coverage |
|---|---|
| UIA via `AutomationPeer` — no NativeWindowHandle per control | 🟡 Tree-read works; `NativeWindowHandle=0` means EM_REPLACESEL silently fails |
| `ValuePattern.SetValue` | ✅ Correct path — now tried first |
| `TextPattern` | ✅ Works |
| SendInput reaches WPF window | ✅ WPF processes WM_KEYDOWN normally |

#### WinUI 3 / UWP / XAML Island (Win10+)
| Technology | KeyWin.exe coverage |
|---|---|
| `ApplicationFrameWindow` outer HWND enumeration | ✅ |
| `RichEditD2DPT` inner HWND — `EM_REPLACESEL` | ✅ Text injection with single undo entry |
| `EM_SETSEL` to mirror Win32 selection | ✅ After `TextPattern.Select()` |
| `TextPattern.DocumentRange.Select` | ✅ `{CTRL+A}` |
| SendInput modifier keys (Ctrl+A / Ctrl+Z) | ❌ Silently ignored by XAML island |
| UIA Edit-menu Undo via `ExpandCollapse` + `Invoke` | ✅ `{CTRL+Z}` |

#### Electron / CEF (Chrome Embedded Framework)
| Technology | KeyWin.exe coverage |
|---|---|
| Outer Win32 HWND enumeration / LISTWINDOWS | ✅ |
| CDP via WebSocket | ✅ Handled by **BrowserWin.exe** (not KeyWin) |
| UIA ARIA-mapped tree (limited) | 🟡 Readable; unreliable for input |

#### Legacy IE / WebBrowser control (`IHTMLDocument2`)
| Technology | KeyWin.exe coverage |
|---|---|
| In-process COM DOM | ❌ Not implemented |

---

### 1.2 Linux

#### X11 (Xorg)
| Technology | KeyWin.exe coverage |
|---|---|
| `XQueryTree` / `XGetWindowProperty` | ❌ Linux helper not started |
| `XSendEvent` (KeyPress / ButtonPress) | ❌ |
| AT-SPI2 D-Bus (`org.a11y.atspi.*`) | ❌ |

#### Wayland
| Technology | KeyWin.exe coverage |
|---|---|
| AT-SPI2 D-Bus (app-side, same as X11) | ❌ |
| `wlr-virtual-keyboard-unstable-v1` / `ydotool` | ❌ |
| `zwp_input_method_v2` (IME text insert) | ❌ |

---

### 1.3 macOS

#### macOS X / macOS (2001+, Cocoa / AppKit)
| Technology | KeyWin.exe coverage |
|---|---|
| AX API (`AXUIElement*`) | ❌ macOS helper not started |
| AppleScript / GUI Scripting | ❌ |
| `CGEventPost` (Quartz) | ❌ |

#### SwiftUI / Mac-Catalyst
| Technology | KeyWin.exe coverage |
|---|---|
| Partial AX API | ❌ |
| WKWebView via Safari Remote Debugging / CDP | ❌ |

---

### 1.4 Java (cross-platform — Swing / AWT / JavaFX)
| Technology | KeyWin.exe coverage |
|---|---|
| Java Access Bridge (Windows, `jab.dll`) | ❌ — JAB-to-UIA bridge means `javax.accessibility` partially reachable via UIA on Windows |
| AT-SPI2 bridge (Linux) | ❌ |
| `javax.accessibility.AccessibleText` | ❌ |

---

### 1.5 Android
| Technology | Helper coverage |
|---|---|
| UiAutomator2 (`UiObject2`) | ❌ No mobile helper |
| `AccessibilityService` API | ❌ |
| ADB `input tap/text/keyevent` | ❌ |
| CDP via ADB port-forward (WebView / Chrome) | ❌ |

---

### 1.6 Web Browsers (cross-platform)
| Technology | Helper coverage |
|---|---|
| CDP — Chrome / Chromium / Edge (Blink) | ✅ **BrowserWin.exe** |
| Firefox Remote Debugging Protocol | ❌ |
| WebDriver BiDi (W3C, 2023+) | ❌ |
| Apple Safari Remote Debugging | ❌ |
| WebDriver / Selenium (W3C) | ❌ |

---

## Part 2 — What KeyWin.exe Does Today (dispatch flow)

```
SENDKEYS / READ / CLICK / etc.
        │
        ▼
 Resolve target HWND
  ├─ HANDLE:<hex>   → direct
  ├─ PAGE:<title>   → FindWindow by title
  └─ SYSTEM         → desktop root
        │
        ▼
 hasSpecialTokens?
  │
  ├─ NO (plain text)
  │   ├─ 1. Find ControlType.Document descendant
  │   │      → try ValuePattern.SetValue()          [WPF, UWP]
  │   │      → fallback EM_REPLACESEL to RichEdit    [Win32, WinUI3]
  │   ├─ 2. Find ControlType.Edit descendant
  │   │      → ValuePattern.SetValue()  OR  SendMessage EM_REPLACESEL
  │   └─ 3. Fallback: SendInput character-by-character
  │
  └─ YES (has { } tokens)
      ├─ {CTRL+A}  → TextPattern.Select + EM_SETSEL  [UIA + Win32]
      ├─ {CTRL+Z}  → UIA Edit-menu expand+invoke     [menu-bar apps]
      ├─ {ENTER},{TAB},{Fn},…
      │      → SendInput VK sequence  [standard Win32/WPF]
      └─ UNRECOGNISED → PostMessage WM_CHAR loop     [last resort]
```

**Current weaknesses:**
1. `{CTRL+Z}` Edit-menu path only works for apps that expose a menu bar with an "Edit" item.
   Apps without a menu (WPF dialogs, Chrome, WinUI 3 settings) fall through to `SendInput Ctrl+Z`
   — which works for them, but if they also have the XAML-island problem, undo is silently lost.
2. `EM_REPLACESEL` is the right move for RichEdit but will be silently ignored by non-RichEdit
   Document hosts (fixed: `ValuePattern.SetValue` is now tried first).
3. No adaptive detection of which strategy worked — caller cannot retry.

---

## Part 3 — Architectural Proposal: Unified Input Strategy Layer

### Design goal
> **One set of MCP commands, one helper wire protocol — zero switches visible to the scenario author.**
> The helper auto-detects the correct internal strategy per target and per action verb.

### 3.1 Proposed helper internal architecture

```
┌──────────────────────────────────────────────────────────────────┐
│  Helper wire protocol (stdin/stdout JSON, unchanged)             │
│  Commands: SENDKEYS · READ · CLICK · QUERYTREE · LAUNCH · …     │
└──────────────────────────┬───────────────────────────────────────┘
                           │
                    ┌──────▼──────────────────────────┐
                    │  TargetResolver                  │
                    │  HANDLE: / PAGE: / SYSTEM / …    │
                    │  → resolves to TargetContext      │
                    └──────┬──────────────────────────┘
                           │
                    ┌──────▼──────────────────────────┐
                    │  UiBackendDetector               │
                    │  Reads TargetContext once,        │
                    │  produces BackendCapabilities:    │
                    │  ┌────────────────────────────┐  │
                    │  │ hasUIA: bool               │  │
                    │  │ hasValuePattern: bool       │  │
                    │  │ hasTextPattern: bool        │  │
                    │  │ hasRichEditHwnd: bool       │  │
                    │  │ hasMenuBar: bool            │  │
                    │  │ isXamlIsland: bool          │  │
                    │  │ acceptsSendInput: bool      │  │  ← probe: synthetic keystroke + listen
                    │  │ platform: Win32|WPF|WinUI3  │  │
                    │  │           |Electron|…       │  │
                    │  └────────────────────────────┘  │
                    └──────┬──────────────────────────┘
                           │  cached per HWND session
                           ▼
          ┌────────────────────────────────────────────────────┐
          │  ActionDispatcher  (strategy table)                │
          │                                                    │
          │  SENDKEYS plain text:                             │
          │    if hasValuePattern          → ValuePattern      │
          │    elif hasRichEditHwnd        → EM_REPLACESEL     │
          │    elif acceptsSendInput       → SendInput chars   │
          │    else                        → PostMessage WM_CHAR│
          │                                                    │
          │  SENDKEYS {CTRL+A}:                               │
          │    if hasTextPattern           → TextPattern.Select │
          │      + if hasRichEditHwnd      → EM_SETSEL mirror  │
          │    elif acceptsSendInput       → SendInput Ctrl+A  │
          │                                                    │
          │  SENDKEYS {CTRL+Z}:                               │
          │    if hasMenuBar               → UIA menu Undo     │
          │    elif acceptsSendInput       → SendInput Ctrl+Z  │
          │                                                    │
          │  CLICK:                                            │
          │    if hasUIA + InvokePattern   → InvokePattern     │
          │    elif acceptsSendInput       → SendInput click   │
          │    else                        → PostMessage WM_*  │
          │                                                    │
          │  READ:                                             │
          │    if hasTextPattern           → TextPattern       │
          │    elif hasValuePattern        → ValuePattern      │
          │    else                        → WM_GETTEXT        │
          └────────────────────────────────────────────────────┘
```

### 3.2 Cross-platform compatibility — same interface, different internals

The `UiBackendDetector` + `ActionDispatcher` pattern is **platform-neutral by design**.
Each platform helper implements the same `IUiBackend` contract, mapping its native
accessibility concepts to the shared `BackendCapabilities` flags. The dispatcher strategy
table is written once against those flags — it never names a platform.

#### 3.2.1 Capability flag mapping across platforms

| Flag | Windows (UIA/Win32) | Linux (AT-SPI2) | macOS (AX API) |
|---|---|---|---|
| `HasUIA` | `AutomationElement.FromHandle` succeeds | `org.a11y.atspi.Accessible` reachable on D-Bus | `AXUIElementCreateApplication` returns non-null |
| `HasValuePattern` | `ValuePattern` obtainable from UIA element | AT-SPI2 `Value` interface present on element | `kAXValueAttribute` is settable (`AXIsSettable`) |
| `HasTextPattern` | `TextPattern` obtainable | AT-SPI2 `Text` interface present | `kAXSelectedTextRangeAttribute` present |
| `HasRichEditHwnd` | `FindWindowEx` finds `RichEdit`/`RichEditD2DPT` | N/A (no Win32 HWNDs) — always `false` | N/A — always `false` |
| `HasMenuBar` | `FindFirst(ControlType.MenuBar)` | AT-SPI2 role `ROLE_MENU_BAR` present as child | `AXRole == AXMenuBar` child of app element |
| `IsXamlIsland` | Root class == `ApplicationFrameWindow` | Always `false` | Always `false` |
| `AcceptsSendInput` | `!IsXamlIsland` (proxy heuristic) | `XSendEvent` trusted and `DISPLAY` set / `ydotool` socket present | `AXIsProcessTrustedWithOptions` returns true |
| `PlatformTag` | `Win32` / `WPF` / `WinUI3` / `Electron` | `GTK` / `Qt` / `Electron` / `Java` | `Cocoa` / `SwiftUI` / `Electron` |

#### 3.2.2 Strategy table — same verbs, platform-neutral conditions

The dispatcher evaluates the strategy list top-to-bottom and stops at the first `Success`.
No platform name appears in the table — only capability flags.

```
Verb: SENDKEYS (plain text)
  1. HasValuePattern == true          → SetValue(text)           [WPF, UWP, GTK Entry, AX kAXValue]
  2. HasRichEditHwnd == true          → EM_REPLACESEL            [Win32 RichEdit, WinUI3 RichEditD2DPT]
  3. AcceptsSendInput == true         → SendInput / XSendEvent / CGEventPost  character-by-character
  4. (fallback)                       → PostMessage WM_CHAR / AT-SPI2 Action "insert text" / AppleScript keystroke

Verb: SENDKEYS {CTRL+A}
  1. HasTextPattern == true           → TextPattern.Select() / AT-SPI2 Text.setSelection(0, len) / kAXSelectedTextRange = full
     + HasRichEditHwnd == true        →   mirror with EM_SETSEL(0,-1)          [Win32 only]
  2. AcceptsSendInput == true         → SendInput Ctrl+A / XSendEvent Ctrl+A / CGEventPost Ctrl+A

Verb: SENDKEYS {CTRL+Z}
  1. HasMenuBar == true               → expand Edit menu, invoke Undo item     [any platform with menu bar]
  2. AcceptsSendInput == true         → SendInput Ctrl+Z / XSendEvent Ctrl+Z / CGEventPost Ctrl+Z

Verb: READ
  1. HasTextPattern == true           → TextPattern.GetText() / AT-SPI2 Text.getText(0,-1) / kAXValue
  2. HasValuePattern == true          → ValuePattern.Current.Value / AT-SPI2 Value.getCurrentValue / kAXValue
  3. (fallback)                       → WM_GETTEXT / XGetWindowProperty / AXUIElementCopyAttributeValue(kAXTitle)

Verb: CLICK
  1. HasUIA + InvokePattern           → InvokePattern.Invoke() / AT-SPI2 Action "click" / AXPress
  2. AcceptsSendInput == true         → SendInput mouse-click / XSendEvent ButtonPress / CGEventPostMouseEvent
  3. (fallback)                       → PostMessage WM_LBUTTONDOWN+UP
```

#### 3.2.3 `PlatformTag` — used for strategy tie-breaking only

`PlatformTag` is only consulted when two equally-capable strategies would produce different
results on different platforms (e.g. `EM_REPLACESEL` is Win32-only even when `HasRichEditHwnd`
is always false on Linux/macOS — the flag itself prevents the call, so `PlatformTag` is
redundant for that case). The canonical uses of `PlatformTag` are:

| Use | Condition |
|---|---|
| Wayland vs X11 input: on Wayland, `XSendEvent` is unavailable even when `DISPLAY` is bridged | `PlatformTag == Wayland` → skip `XSendEvent`, go directly to `ydotool` / `zwp_input_method` |
| macOS permission error recovery: prompt user to grant Accessibility permission | `PlatformTag == Cocoa` + `AcceptsSendInput == false` → emit helpful error |
| Electron: CDP is always better than UIA/AT-SPI2 for Electron targets | `PlatformTag == Electron` → prefer BrowserWin CDP path, not UIA |

#### 3.2.4 Helper selection — MCP server level

The MCP server (TypeScript, `HelperRegistry.ts`) selects the right helper binary at startup
based on `process.platform`. The helper's `_schema` response already carries its capability
flags as metadata. The dispatcher runs inside the helper, not in the MCP server — so the
server needs no platform knowledge either.

```
process.platform == "win32"   →  KeyWin.exe  (WinUiBackend)
process.platform == "linux"   →  KeyLin      (AtSpi2Backend)    [future]
process.platform == "darwin"  →  KeyMac      (AxApiBackend)     [future]
```

`HelperRegistry.ts` change required: `spawnHelper()` picks binary by platform, rest of
registry code is unchanged. **Zero changes to MCP command surface or scenario XML.**

### 3.3 Platform helper matrix (future build targets)

When F-3 (Platform Portability) is tackled, the **same wire protocol** is implemented by
platform-specific helper executables. The MCP server and scenario XML are untouched.

```
Platform          Helper binary        Primary stack           Input injection
────────────────  ───────────────────  ──────────────────────  ─────────────────────────
Windows           KeyWin.exe (C#/.NET) UIA + Win32 messages    SendInput / EM_REPLACESEL
Linux / X11       KeyLin (C / Python)  AT-SPI2 D-Bus           XSendEvent / ydotool
Linux / Wayland   KeyLin (Wayland)     AT-SPI2 D-Bus           ydotool / zwp_input_method
macOS             KeyMac (Swift/ObjC)  AX API / AXUIElement    CGEventPost / AppleScript
Android           KeyDroid (ADB)       UiAutomator2 / ADB      adb input tap/text
Browser (any OS)  BrowserWin.exe       CDP WebSocket           Runtime.evaluate / Input.*
Java (Windows)    KeyWin.exe (JAB)     UIA → JAB bridge        ValuePattern / SendInput
Java (Linux)      KeyLin (AT-SPI2)     AT-SPI2 bridge          XSendEvent
```

### 3.3 MCP command surface — stays the same

No new MCP tools are added for platform support. The `callHelper` tool already carries:
```json
{ "target": "HANDLE:<hex>", "command": "SENDKEYS", "parameter": "{CTRL+A}Hello" }
```
The helper binary selected at runtime is the only thing that changes. The MCP server selects
the right helper from `HelperRegistry` based on the OS/platform it detects at startup.

The scenario XML is also unaffected — `SENDKEYS`, `READ`, `CLICK`, `QUERYTREE`, `LAUNCH`,
`KILL` are the same verbs on every platform.

### 3.4 `UiBackendDetector` — probe strategy (Windows detail)

To fill `BackendCapabilities` reliably, the detector runs these cheap probes once per HWND
and caches the result for the process lifetime:

| Probe | Method | Cost |
|---|---|---|
| `hasUIA` | `AutomationElement.FromHandle(hwnd)` succeeds + has children | ~2 ms |
| `hasValuePattern` | Try `GetCurrentPattern(ValuePattern.Pattern)` on Document/Edit descendant | ~1 ms |
| `hasTextPattern` | Try `GetCurrentPattern(TextPattern.Pattern)` | ~1 ms |
| `hasRichEditHwnd` | `FindWindowEx` class `"Edit"` / `"RichEdit"` / `"RichEditD2DPT"` | ~0.5 ms |
| `hasMenuBar` | `FindFirst(ControlType.MenuBar)` under root | ~1 ms |
| `isXamlIsland` | Root class name == `"ApplicationFrameWindow"` | ~0.5 ms |
| `acceptsSendInput` | Probe: send `VK_NONAME` (not a real key) to process via `AttachThreadInput`; check no error | deferred — less safe; use `isXamlIsland` as proxy instead |

Total overhead per new HWND: **~6 ms**, cached thereafter.

### 3.5 Relationship to existing ADRs

| ADR | Relevance |
|---|---|
| [ADR-004](decisions/ADR-004-persistent-daemon-model.md) | Daemon model means `UiBackendDetector` cache persists across scenario steps |
| [ADR-005](decisions/ADR-005-unified-action-addressing.md) | Unified addressing — this proposal extends it to the input backend |
| F-3 (TODO.md) | Full Linux/macOS helper builds; same wire protocol |
| N-2 (TODO.md) | Unified addressing & input model — `ActionDispatcher` is the runtime of N-2's parse output |

---

## Part 4 — Feature Checklist (for future transposition to ADR / architecture doc)

### Windows — tracked items
- [x] UIA tree walk (`QUERYTREE`, `READ`)
- [x] `ValuePattern.SetValue` (WPF, UWP)
- [x] `TextPattern.Select` / `DocumentRange`
- [x] `InvokePattern` (buttons, menu items)
- [x] `ExpandCollapsePattern` (menus, trees)
- [x] `TogglePattern` (checkboxes)
- [x] `SelectionItemPattern` (lists, combos)
- [x] `EM_REPLACESEL` to RichEdit/RichEditD2DPT (Win11 Notepad XAML island)
- [x] `EM_SETSEL` mirror for selection
- [x] `SendInput` keyboard + mouse
- [x] `PostMessage WM_CHAR` fallback
- [x] `FindWindowEx` by class name
- [x] UIA Edit-menu Undo (multi-locale)
- [ ] `UiBackendDetector` capability cache (proposed above)
- [ ] MSAA `IAccessible` fallback (Win95/98, pre-UIA apps)
- [ ] `IHTMLDocument2` (legacy IE WebBrowser control)
- [ ] `AttachThreadInput`-based focus probing

### Linux
- [ ] Helper binary (`KeyLin`) scaffold
- [ ] AT-SPI2 D-Bus `org.a11y.atspi.Accessible` tree walk
- [ ] AT-SPI2 `Text` interface (read / caret)
- [ ] AT-SPI2 `Value` interface (set)
- [ ] AT-SPI2 `Action` interface (click / activate)
- [ ] `XSendEvent` keyboard / mouse injection (X11)
- [ ] `ydotool` / `wlr-virtual-keyboard` (Wayland input)
- [ ] `zwp_input_method_v2` text insert (Wayland)

### macOS
- [ ] Helper binary (`KeyMac`) scaffold
- [ ] `AXUIElementCreateSystemWide` tree walk
- [ ] `AXUIElementPerformAction` (click / press)
- [ ] `AXUIElementSetAttributeValue` (text set)
- [ ] `CGEventPost` keyboard + mouse
- [ ] AppleScript `System Events` GUI Scripting
- [ ] Safari Remote Debugging / WebDriver BiDi

### Java
- [ ] Windows: Java Access Bridge (`jab.dll`) detection + `javax.accessibility` bridge
- [ ] Linux: AT-SPI2 path (covered by KeyLin above when JAB AT-SPI2 bridge active)

### Android
- [ ] UiAutomator2 via ADB (`adb shell uiautomator`)
- [ ] `AccessibilityService` agent APK
- [ ] CDP via `adb forward` (Chrome on Android, WebView)

### Browser (all platforms)
- [x] CDP Chrome / Chromium / Edge — **BrowserWin.exe**
- [ ] Firefox RDP / WebDriver BiDi
- [ ] Safari Remote Debugging
- [ ] Selenium/WebDriver W3C generic path
