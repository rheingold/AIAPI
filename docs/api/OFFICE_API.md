# OFFICE_API.md — Office Helper Command Reference

Covers `MSOfficeWin.exe` (Microsoft Office, Windows COM) and `LibreOfficeWin.exe`
(LibreOffice / Apache OpenOffice, Windows UNO COM bridge / UNO socket).

Both helpers share the same wire protocol and command vocabulary.
They are discovered automatically by `HelperRegistry` via `--api-schema`.

---

## Target Strings

| Target string | Resolves to |
|---|---|
| `word` / `writer` | Active Word / Writer document |
| `excel` / `calc` | Active Excel / Calc spreadsheet |
| `powerpoint` / `impress` | Active PowerPoint / Impress presentation |
| `DOCNAME:<name>` | Search all open docs for matching title (substring) |
| `PROC:WINWORD.EXE` | Active document in that process |

---

## Commands

### `LISTDOCS`
List all open documents across all three app types.

```json
{ "target": "word", "action": "LISTDOCS" }
```
**Response:**
```json
{ "success": true, "result": "[{\"name\":\"Doc1.docx\",\"app\":\"word\",\"path\":\"C:\\...\"},...]" }
```

---

### `QUERYTREE` — Document structure
Returns the document element tree as JSON.

```json
{ "target": "word", "action": "QUERYTREE" }
{ "target": "excel", "action": "QUERYTREE" }
{ "target": "powerpoint", "action": "QUERYTREE" }
```

**Word** response tree: `Document → paragraphs[] + bookmarks[]`  
**Excel** response tree: `Workbook → Sheets → Cells (capped at 200)`  
**PowerPoint** response tree: `Presentation → Slides → Shapes`

---

### `READ` — Read content
```json
{ "target": "word",        "action": "READ", "parameter": "body/para[2]" }
{ "target": "word",        "action": "READ", "parameter": "bookmark:MyBookmark" }
{ "target": "excel",       "action": "READ", "parameter": "Sheet1!B3" }
{ "target": "excel",       "action": "READ", "parameter": "B3" }
{ "target": "powerpoint",  "action": "READ", "parameter": "slide[1]/shape[Title]" }
{ "target": "powerpoint",  "action": "READ", "parameter": "slide[2]/shape[2]" }
```

Path formats accepted:

| App | Path | Description |
|---|---|---|
| Word/Writer | `body/para[N]` | Paragraph N (1-based) |
| Word/Writer | `body/para[N]/text` | Same |
| Word/Writer | `bookmark:Name` or `body/bookmark[@name='Name']` | Named bookmark |
| Excel/Calc | `A1`, `B3` | Cell address (active sheet) |
| Excel/Calc | `Sheet1!A1` | Cell on named sheet |
| Excel/Calc | `body/sheet[@name='Q1']/cell[@addr='B2']` | Canonical form |
| PowerPoint/Impress | `slide[N]` | All text on slide N |
| PowerPoint/Impress | `slide[N]/shape[Title]` | Shape by name |
| PowerPoint/Impress | `slide[N]/shape[N]` | Shape by index |

---

### `WRITE` — Write content
```json
{ "target": "word",       "action": "WRITE", "parameter": "body/para[3]|Hello world" }
{ "target": "excel",      "action": "WRITE", "parameter": "A1|=B2+C2" }
{ "target": "powerpoint", "action": "WRITE", "parameter": "slide[1]/shape[Title]|Big headline" }
```
Format: `path|value`

---

### `FORMAT` — Apply formatting

**Current (Phase 1):** paragraph style names only.  
**Phase 2:** full character + paragraph property key=value pairs (see below).

```json
{ "target": "word",   "action": "FORMAT", "parameter": "body/para[1]|Heading 1" }
{ "target": "writer", "action": "FORMAT", "parameter": "body/para[2]|bold=true|fontSize=14" }
```

Format: `path|key=value[|key=value...]`

If no `=` is present the entire right-hand side is treated as a style name (backward compat).

#### Accepted style names (locale-independent)

| English name | Word constant | LibreOffice equivalent |
|---|---|---|
| `Normal` | `wdStyleNormal` (-1) | `Default Paragraph Style` |
| `Heading 1` … `Heading 9` | -2 … -10 | `Heading 1` … `Heading 9` |
| `Title` | -71 | `Title` |
| `Subtitle` | -75 | `Subtitle` |
| `Body Text` | -67 | `Body Text` |
| `List Bullet` | -49 | `List Bullet` |
| `List Number` | -53 | `List Number` |
| `Quote` | -181 | `Quotations` |
| `Intense Quote` | -182 | `Quotations` |
| `Caption` | -35 | `Caption` |
| `Strong` | -97 | *(character style, not paragraph)* |
| `Emphasis` | -89 | *(character style, not paragraph)* |
| `No Spacing` | -158 | `Default Paragraph Style` |

#### Character property keys (Phase 2)

Applied to the full paragraph range (start → end of paragraph).

| Key | Values | Notes |
|---|---|---|
| `bold` | `true` / `false` | |
| `italic` | `true` / `false` | |
| `underline` | `true` / `false` | |
| `strikethrough` | `true` / `false` | |
| `allCaps` | `true` / `false` | |
| `smallCaps` | `true` / `false` | |
| `fontName` | string | e.g. `Calibri`, `Times New Roman` |
| `fontSize` | float (pt) | e.g. `12`, `14.5` |
| `color` | `#RRGGBB` hex | Character foreground colour |
| `highlight` | colour name or `#RRGGBB` | Named: `yellow`, `green`, `cyan`, `magenta`, `red`, `darkBlue`, `darkRed`, `darkGreen`, `darkCyan`, `none` |
| `charSpacingPt` | float (pt) | Character tracking / letter-spacing |

#### Paragraph property keys (Phase 2)

| Key | Values | Notes |
|---|---|---|
| `style` | style name string | Paragraph style (see table above) |
| `alignment` | `left` / `center` / `right` / `justify` | |
| `spaceBeforePt` | float (pt) | Space before paragraph |
| `spaceAfterPt` | float (pt) | Space after paragraph |
| `lineSpacing` | float (multiple) or `exactPt:<N>` | `1.0`, `1.5`, `2.0`; or `exactPt:14` for exact 14 pt |
| `indentLeftCm` | float (cm) | Left indent (converted to pt/µm internally) |
| `indentRightCm` | float (cm) | Right indent |
| `indentFirstLineCm` | float (cm) | First-line indent (positive = indent, negative = hanging) |

**Unit conversions used internally:**
- Word COM: pt (`1 cm = 28.35 pt`)
- LibreOffice UNO: µm (`1 pt ≈ 352.7 µm`)

---

### `NEWDOC` — Create new document
```json
{ "target": "word",       "action": "NEWDOC" }
{ "target": "excel",      "action": "NEWDOC" }
{ "target": "powerpoint", "action": "NEWDOC" }
{ "target": "writer",     "action": "NEWDOC" }
{ "target": "calc",       "action": "NEWDOC" }
{ "target": "impress",    "action": "NEWDOC" }
```
Starts the application if not already running. Returns `{"success":true,"result":"created","name":"<window title>"}`.

#### LibreOffice Impress — template chooser dialog

When `target=impress`, LibreOffice may display a **"Select Template" / "New Presentation"**
modal dialog (Win32 class `SALSUBFRAME`, no `WS_MAXIMIZEBOX`) before the blank presentation
window is ready.

`LibreOfficeWin.exe` automatically attempts to dismiss it via `WM_CLOSE` + `VK_ESCAPE`
during the NEWDOC poll loop.  If the dialog persists after `NEWDOC` returns, the AI **must**
dismiss it via **`KeyWin.exe`**:

1. `KeyWin LISTWINDOWS target=SYSTEM` — find a `soffice.bin` window whose title does **not**
   contain "LibreOffice", "Impress", "Calc", "Writer", or "OpenOffice"
   (that is the dialog; `SALSUBFRAME` class + no `WS_MAXIMIZEBOX`).
2. `KeyWin SENDKEYS {ESC} target=HANDLE:<hwnd>` — cancels the chooser → blank presentation.
   Alternatively `{ENTER}` to accept the default template.

> **Architecture note:** this dialog is a plain OS window — it is not addressable via the
> UNO document bridge.  Interaction **must** go through `KeyWin.exe`.  The apptemplate
> `apptemplates/libreoffice/scenarios.xml` (scenario id=`newdoc-impress` and
> `dismiss-transient-dialog`) contains the canonical step sequence.

---

### `SAVE` / `EXPORT` — Save or export
```json
{ "target": "word", "action": "SAVE" }
{ "target": "word", "action": "SAVE", "parameter": "pdf" }
{ "target": "word", "action": "EXPORT:pdf" }
{ "target": "excel", "action": "SAVE", "parameter": "/path/to/report.pdf" }
```
- No parameter → save in native format (`.docx` / `.xlsx` / `.pptx` / `.odt` / `.ods` / `.odp`)
- `pdf` or `<path>.pdf` → PDF export

---

### `EXEC_MACRO` — Run VBA macro (MS Office only; Excel confirmed)
```json
{ "target": "excel", "action": "EXEC_MACRO", "parameter": "Module1.MyMacro" }
```
Macros for Word/PowerPoint are a Phase 2 item.

---

### `FIND` — Text search (Word/Writer, Phase 2)
```json
{ "target": "word", "action": "FIND", "parameter": "quarterly report" }
```
Returns the paragraph index of the first occurrence.

---

### `FOCUS` — Bring window to foreground
```json
{ "target": "word", "action": "FOCUS" }
```
Use before any visible interaction (cooperate/showcase mode).

---

## LibreOffice-specific: `RELAUNCH` / `LAUNCH` (Phase 2)

LibreOffice 24+ has removed the COM bridge (`com.sun.star.ServiceManager`).
Use the UNO socket connection instead. The helper must start or restart LibreOffice
with the `--accept` flag.

```json
{ "target": "writer", "action": "{RELAUNCH}" }
{ "target": "writer", "action": "{RELAUNCH:2002}" }
{ "target": "writer", "action": "{LAUNCH:calc}" }
{ "target": "writer", "action": "{LAUNCH:impress:2003}" }
```

| Command | Behaviour |
|---|---|
| `{RELAUNCH}` | Save all open docs, close LibreOffice, restart with `--accept` on port 2002 |
| `{RELAUNCH:N}` | Same, use port N |
| `{LAUNCH:app}` | If socket not reachable, start LibreOffice `--app` with `--accept`; if already reachable, return running port |
| `{LAUNCH:app:N}` | Same, explicit port N |

The `--api-schema` for `LibreOfficeWin.exe` includes `officeRelaunchSupported: true`,
`officeConnectMode: "uno-socket"`, and a plain-text note the AI can read:

> *"If a LibreOffice/OpenOffice window is open but unreachable, call `{RELAUNCH}` or
> `{LAUNCH:<app>}` to restart it with the UNO debug port enabled. Open documents are
> saved automatically before restart."*

---

## Error Codes

| `error` field | Meaning |
|---|---|
| `"target_not_found"` | No open document matching the target string |
| `"path_not_found"` | Path resolves to nothing (e.g. `para[99]` when doc has 5 paragraphs) |
| `"read_failed"` | Object found but `.Text`/`.Value2` threw |
| `"write_failed"` | Object found but assignment threw |
| `"format_failed"` | FORMAT property could not be set |
| `"macro_failed"` | VBA macro raised an error |
| `"SECURITY_FILTER_DENY"` | SecurityLib blocked the action |
| `"uno_not_reachable"` | LibreOffice socket not available; call `{RELAUNCH}` |
