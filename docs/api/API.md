# API Reference - AI UI Automation Plugin

## Overview

The plugin exposes a unified API for querying and controlling UI elements across multiple applications. This document provides detailed specifications for all API methods.

---

## Universal Address Grammar

Every call in this system addresses a target through a **hierarchical container + element** address. The five MCP call fields (`helper`, `proc`, `action`, `path`, `value`) map to distinct layers of that hierarchy.

### Conceptual full address

```
//[L0: helper]  //[L1: OS process]  //[L2: sub-window]  //[L3: document/tab]  //element-path
    ↑ tool name    ↑────────────────── proc ────────────────────────────────↑    ↑── path ──↑
```

| MCP field | Layer | Role |
|-----------|-------|------|
| `helper` | **L0** | Automation domain — which C# binary (`MSOfficeWin` / `KeyWin` / `BrowserWin`). Implicit in the tool name. |
| `proc` | **L1–L3** | Container chain: OS process → optional sub-window → optional document/tab. `//`-separated `[key:val]` brackets. |
| `action` | — | Command verb (`FORMAT` `READ` `WRITE` `CLICKID` `SENDKEYS` …) |
| `path` | **L4+** | Element address within the resolved container. Pure XPath-style — no container info here. |
| `value` | — | Payload to write, apply, or send to the addressed element. |

### `proc` — container hierarchy filter

`proc` is a sequence of `//`-separated `[key:val;key:val]` bracket levels.  
Levels are written from outermost (L1 OS) to innermost (L3 document). Absent levels default to the helper's active/foreground instance.

**Formal grammar:**

```
proc          ::=  level ( '//' level )*   |  bare-process-name
level         ::=  '[' filter-list ']'
filter-list   ::=  filter ( ';' filter )*
filter        ::=  key ':' raw-value       -- raw-value ends at first ']'
                                           -- slashes inside raw-value are safe (no escaping needed)
```

**Level keys:**

| Level | Keys | Examples |
|-------|------|---------|
| L1 — OS process | `pid` `handle` `hwnd` `procname` `sha256` `sha512` `title` | `[pid:1234]` `[procname:WINWORD*]` `[handle:0xABCD]` |
| L2 — sub-window | `subwindowhandle` `frame` `pane` | `[subwindowhandle:0x2A4]` `[frame:main]` |
| L3 — document/tab | `docname` `url` `tabid` `page` | `[docname:Budget.xlsx]` `[url:https://github.com/pulls]` `[tabid:3]` |

**Examples:**

```
"[pid:1234]"                                            single level (L1 only)
"[procname:WINWORD.EXE]//[docname:Budget.xlsx]"         L1 + L3 (skip L2)
"[pid:8800]//[url:https://github.com/pulls]"            L1 + L3 (URL with slashes — safe inside [])
"[pid:123]//[subwindowhandle:0x2A4]//[tabid:3]"         L1 + L2 + L3 (full chain)
"[sha256:abc;procname:WINWORD.EXE]//[docname:Payroll*]" L1 multi-filter + L3
```

### `path` — element address (L4+)

Pure XPath-style steps addressing an element **inside** the already-identified container.  
`//` here has its normal XPath meaning (descendant-or-self axis), not a level separator.

```
"//body/para[20]"                           Word — 20th paragraph
"//body/bookmark[@name='Summary']"          Word — named bookmark
"//sheet[@name='Q1']/cell[@addr='B2:D5']"   Excel — range in named sheet
"//slide[2]/shape[@name='Title']"           PowerPoint — shape on slide 2
"//Button[@id='num1Button']"                UIA Win32 — AutomationId
"//*[@id='compose']"                        Browser — CSS #id equivalent
```

### Escaping

No escaping is needed for `/` or `//` inside bracket values. The `//` level separator only appears *between* a closing `]` and the next opening `[`. Everything between `[` and `]` is a raw value:

```
[url:https://office.google.com/spreadsheets/d/abc]   ← slashes inside [] are inert
          ↑ safe: part of raw-value; parser closes at ]
```

### Complete call example

```jsonc
{
  "jsonrpc": "2.0", "id": 42,
  "method":  "tools/call",
  "params": {
    "name": "MSOfficeWin",
    "arguments": {
      "proc":   "[procname:WINWORD.EXE]//[docname:Budget.xlsx]",
      "action": "FORMAT",
      "path":   "//body/para[20]",
      "value":  "Heading 2"
    }
  }
}
```

### Firewall rule syntax

Security filter rules use the same grammar. The `proc-filter` column is a `proc`-field value (with glob wildcards). The `path-glob` column is a `path`-field pattern.

```
ACTION  helper        proc-filter                                       command   path-glob
──────  ──────────    ──────────────────────────────────────────────    ───────   ─────────────────────────────────
ALLOW   MSOfficeWin   [procname:WINWORD.EXE]//[docname:Budget*]         FORMAT    //body/para[*]
ALLOW   BrowserWin    [pid:8800]//[url:github.com/*]                    READ      //**
DENY    MSOfficeWin   [procname:EXCEL.EXE]//[docname:Payroll*]          WRITE     //sheet[*]/cell[*]
ALLOW   KeyWin        [procname:calc.exe]                               CLICKID   //Button[@id='*Button']
DENY    KeyWin        [procname:explorer.exe]                           SENDKEYS  //**
```

---

## Common Types

### UIObject
Represents a single UI element or container.

```typescript
interface UIObject {
  id: string;
  type: string;
  name?: string;
  children?: UIObject[];
  properties?: Record<string, any>;
  actions?: string[];
  position?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes | Unique identifier within provider scope |
| `type` | string | Yes | Element type (Button, TextBox, Slide, Cell, etc.) |
| `name` | string | No | Human-readable name or class |
| `children` | UIObject[] | No | Child elements (hierarchical) |
| `properties` | object | No | Element-specific properties |
| `actions` | string[] | No | Available action names |
| `position` | object | No | X, Y, width, height (mainly for Web UI) |

---

### ActionResult
Response from executing an action.

```typescript
interface ActionResult {
  success: boolean;
  message?: string;
  updatedObject?: UIObject;
  data?: any;
  error?: string;
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `success` | boolean | Yes | Whether the action succeeded |
| `message` | string | No | Success message |
| `updatedObject` | UIObject | No | Updated object state if applicable |
| `data` | any | No | Additional response data |
| `error` | string | No | Error message if failed |

---

### QueryOptions
Options for tree queries.

```typescript
interface QueryOptions {
  depth?: number;
  includeProperties?: boolean;
  includeActions?: boolean;
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `depth` | number | 3 | Maximum tree depth to retrieve |
| `includeProperties` | boolean | true | Include element properties |
| `includeActions` | boolean | true | Include available actions |

---

## AutomationEngine API

### queryTree()

Retrieve the UI tree from a target application.

```typescript
async queryTree(
  providerName: string,
  targetId: string,
  options?: QueryOptions
): Promise<UIObject>
```

**Parameters:**
- `providerName`: One of `windows-forms`, `web-ui`, `office-excel`, `office-word`, `office-powerpoint`
- `targetId`: Window ID, DOM selector, or document ID
- `options`: Query options (optional)

**Returns:**
- `UIObject`: Root element of the tree

**Example:**
```typescript
const tree = await engine.queryTree('windows-forms', 'form_main', {
  depth: 3,
});
```

**Error Cases:**
- Provider not found → throws Error
- Target ID not found → throws Error
- Provider unavailable → throws Error

---

### clickElement()

Perform a click action on an element.

```typescript
async clickElement(
  providerName: string,
  elementId: string
): Promise<ActionResult>
```

**Parameters:**
- `providerName`: Provider name
- `elementId`: Element ID from tree

**Returns:**
- `ActionResult`: Success status and message

**Example:**
```typescript
const result = await engine.clickElement('windows-forms', 'btn_submit');
if (result.success) {
  console.log('Clicked successfully');
}
```

---

### setProperty()

Set a property value on an element.

```typescript
async setProperty(
  providerName: string,
  elementId: string,
  property: string,
  value: any
): Promise<ActionResult>
```

**Parameters:**
- `providerName`: Provider name
- `elementId`: Element ID
- `property`: Property name
- `value`: New property value

**Returns:**
- `ActionResult`: Success status

**Common Properties by Provider:**

**Windows Forms:**
- `text`: Label/button text
- `value`: TextBox value
- `enabled`: Button/control enabled state
- `visible`: Element visibility
- `foreColor`: Text color
- `backColor`: Background color

**Web UI:**
- `value`: Input field value
- `textContent`: Inner text
- `className`: CSS classes
- `style`: Inline styles
- `innerHTML`: Inner HTML

**Office:**
- Excel cells: `value`, `formula`, `format`, `borderStyle`
- Word: `text`, `style`, `alignment`, `fontSize`
- PowerPoint: `text`, `fontSize`, `fill`, `rotation`

**Example:**
```typescript
await engine.setProperty('office-excel', 'cell_A1', 'value', 'Hello');
await engine.setProperty('web-ui', 'input_name', 'value', 'John Doe');
```

---

### readProperty()

Read a property value from an element.

```typescript
async readProperty(
  providerName: string,
  elementId: string,
  property: string
): Promise<any>
```

**Parameters:**
- `providerName`: Provider name
- `elementId`: Element ID
- `property`: Property name

**Returns:**
- `any`: Property value

**Example:**
```typescript
const cellValue = await engine.readProperty('office-excel', 'cell_A1', 'value');
const inputValue = await engine.readProperty('web-ui', 'input_name', 'value');
```

---

### getAvailableProviders()

List all available providers.

```typescript
async getAvailableProviders(): Promise<string[]>
```

**Returns:**
- `string[]`: Array of provider names

**Example:**
```typescript
const providers = await engine.getAvailableProviders();
// ['windows-forms', 'web-ui', 'office-excel', 'office-word', 'office-powerpoint']
```

---

### getProvider()

Get a specific provider instance.

```typescript
getProvider(name: string): IAutomationProvider | undefined
```

**Parameters:**
- `name`: Provider name

**Returns:**
- `IAutomationProvider | undefined`: Provider instance or undefined

**Example:**
```typescript
const provider = engine.getProvider('windows-forms');
if (provider) {
  // Direct provider access
}
```

---

## Logging & Caching

### getLogs()

Retrieve action logs.

```typescript
getLogs(): LogEntry[]
```

**Returns:**
- Array of LogEntry objects

**LogEntry Structure:**
```typescript
interface LogEntry {
  timestamp: Date;
  action: string;
  success: boolean;
  details?: string;
}
```

**Example:**
```typescript
const logs = engine.getLogs();
logs.forEach(log => {
  console.log(`${log.timestamp}: ${log.action} - ${log.success ? '✓' : '✗'}`);
});
```

---

### clearLogs()

Clear all logs.

```typescript
clearLogs(): void
```

---

### getCacheStats()

Get cache statistics.

```typescript
getCacheStats(): { size: number; maxSize: number }
```

**Returns:**
- `size`: Current cached objects
- `maxSize`: Maximum cache size (100)

**Example:**
```typescript
const stats = engine.getCacheStats();
console.log(`Cache: ${stats.size}/${stats.maxSize}`);
```

---

### clearCache()

Clear object cache.

```typescript
clearCache(): void
```

---

## Provider-Specific Details

### Windows Forms Provider

**Supported Element Types:**
- Form, Button, TextBox, Label, CheckBox, RadioButton
- ListBox, ComboBox, Panel, GroupBox, TabControl
- DataGridView, TreeView, MenuStrip

**Available Actions:**
- `click`: Click button or control
- `setValue`: Set text/value
- `readValue`: Get current value
- `focus`: Set focus
- `enable`/`disable`: Control state
- `show`/`hide`: Visibility

**Default Target ID:** `form_main` (for testing)

---

### Web UI Provider

**Supported Element Types:**
- button, input, select, textarea
- div, span, p, a
- form, table, img, etc. (any HTML element)

**Available Actions:**
- `click`: Click element
- `setValue`: Set input value
- `readValue`: Get input value
- `focus`: Focus element
- `inspect`: Get element info

**Target ID Format:** CSS selector (e.g., `#myButton`, `.input-field`, `form > input`)

**Example:**
```typescript
const tree = await engine.queryTree('web-ui', '#main-form');
const input = tree.children?.find(c => c.type === 'input');
if (input) {
  await engine.setProperty('web-ui', input.id, 'value', 'test');
}
```

---

### Office Providers

#### Excel

**Element Types:**
- Workbook, Worksheet, Cell, Range
- Table, Chart, Shape

**Common Cell Properties:**
```typescript
{
  value: any;           // Cell value
  formula: string;      // Excel formula
  format: string;       // Number format
  backColor: string;    // Cell background
  borderStyle: string;  // Border style
  alignment: string;    // Text alignment
  fontSize: number;     // Font size
}
```

**Example:**
```typescript
// Get workbook tree
const wb = await engine.queryTree('office-excel', 'workbook_main');

// Set cell value
await engine.setProperty('office-excel', 'cell_A1', 'value', 100);

// Set cell format
await engine.setProperty('office-excel', 'cell_A1', 'format', 'Currency');
```

#### Word

**Element Types:**
- Document, Paragraph, Run, Table, Section
- Header, Footer, Bookmark

**Common Paragraph Properties:**
```typescript
{
  text: string;         // Paragraph text
  style: string;        // Paragraph style
  alignment: string;    // left, center, right, justify
  fontSize: number;     // Font size in points
  fontName: string;     // Font name
  bold: boolean;        // Bold state
  italic: boolean;      // Italic state
}
```

#### PowerPoint

**Element Types:**
- Presentation, Slide, Shape, TextBox
- Group, Picture, Chart, Table

**Common Slide Properties:**
```typescript
{
  layout: string;       // Slide layout name
  index: number;        // Slide position
  backgroundColor: string;
}
```

**Common Shape Properties:**
```typescript
{
  text: string;         // Shape text
  left: number;         // Left position
  top: number;          // Top position
  width: number;        // Width
  height: number;       // Height
  fill: string;         // Fill color
  rotation: number;     // Rotation in degrees
}
```

---

## Error Handling

### Common Errors

```typescript
try {
  const tree = await engine.queryTree('unknown-provider', 'id');
} catch (error) {
  // Error: Provider 'unknown-provider' not found
}

try {
  const tree = await engine.queryTree('windows-forms', 'unknown-window');
} catch (error) {
  // Error: Window with ID unknown-window not found
}
```

### Best Practices

1. Always check `result.success` before assuming action completed
2. Handle provider unavailability gracefully
3. Use try-catch for async operations
4. Log errors for debugging
5. Validate element IDs before operations

---

## Performance Considerations

1. **Depth Parameter**: Limit depth to reduce tree size
   ```typescript
   // Good: Shallow tree
   const tree = await engine.queryTree('windows-forms', 'id', { depth: 2 });
   
   // Expensive: Deep tree
   const tree = await engine.queryTree('windows-forms', 'id', { depth: 10 });
   ```

2. **Caching**: Automatic caching reduces provider calls
   ```typescript
   // First call: queries provider
   let tree = await engine.queryTree('windows-forms', 'id');
   
   // Second call: serves from cache
   tree = await engine.queryTree('windows-forms', 'id');
   ```

3. **Selective Queries**: Only request what you need
   ```typescript
   // Faster: No properties
   const tree = await engine.queryTree('web-ui', '#form', { 
     includeProperties: false,
     depth: 1 
   });
   ```

## MCP JSON-RPC Examples

The extension exposes an MCP server on http://127.0.0.1:3457. Use `tools/call` to invoke AutomationEngine methods.

### Initialize and List Tools

Request:
```json
{ "jsonrpc": "2.0", "method": "initialize", "id": 1 }
```

Request:
```json
{ "jsonrpc": "2.0", "method": "tools/list", "id": 2 }
```

### Set Property via Keys (Calculator)

Request:
```json
{
  "jsonrpc": "2.0",
  "method": "tools/call",
  "params": {
    "name": "setProperty",
    "arguments": {
      "providerName": "windows-forms",
      "elementId": "calc",
      "propertyName": "keys",
      "value": "3+4="
    }
  },
  "id": 3
}
```

Response:
```json
{ "jsonrpc": "2.0", "id": 3, "result": { "success": true } }
```

### Read Property (Calculator Display)

Request:
```json
{
  "jsonrpc": "2.0",
  "method": "tools/call",
  "params": {
    "name": "readProperty",
    "arguments": {
      "providerName": "windows-forms",
      "elementId": "calc",
      "propertyName": "value"
    }
  },
  "id": 4
}
```

Response (example):
```json
{ "jsonrpc": "2.0", "id": 4, "result": "Zobrazuje se 7" }
```

### Notepad: Type and Read Back

Request (set keys):
```json
{
  "jsonrpc": "2.0",
  "method": "tools/call",
  "params": {
    "name": "setProperty",
    "arguments": {
      "providerName": "windows-forms",
      "elementId": "notepad",
      "propertyName": "keys",
      "value": "Hello from MCP!"
    }
  },
  "id": 5
}
```

Response:
```json
{ "jsonrpc": "2.0", "id": 5, "result": { "success": true } }
```

Request (read value):
```json
{
  "jsonrpc": "2.0",
  "method": "tools/call",
  "params": {
    "name": "readProperty",
    "arguments": {
      "providerName": "windows-forms",
      "elementId": "notepad",
      "propertyName": "value"
    }
  },
  "id": 6
}
```

Response:
```json
{ "jsonrpc": "2.0", "id": 6, "result": "Hello from MCP!" }
```

Notes:
- The server accepts either `propertyName` or `property` in `arguments`.
- Typical `providerName` values: `windows-forms`, `web-ui`, `office-*`.
---
## Version History

**v0.1.0** - Initial release
- Windows Forms provider (mock)
- Web UI provider (Playwright)
- Office providers (mock)
- Core API with caching and logging

---

## Dashboard REST API

The dashboard server runs on `http://127.0.0.1:3458` by default. All write endpoints require session authentication (cookie `session` set by `POST /api/login`).

### Endpoint Summary

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/status` | no | Server status, helper count |
| GET | `/api/listHelpers` | no | Discovered helper executables |
| GET | `/api/getHelperSchema?helperName=X` | no | Full API schema for a helper |
| GET | `/api/scenarios` | no | List JSON scenario files |
| POST | `/api/scenarios/run` | yes | Execute a JSON scenario |
| GET | `/api/appTemplates` | no | List app template folders |
| GET | `/api/appTemplates/{app}/tree` | no | Return `tree.xml` for an app |
| GET | `/api/appTemplates/{app}/scenarios` | no | Return `scenarios.xml` for an app |
| POST | `/api/appTemplates/{app}/scenarios/{id}/run` | yes | Execute a named XML scenario template |
| GET | `/api/filters` | no | Current security filter rules |
| POST | `/api/filters` | yes | Save security filter rules |
| GET/POST | `/api/settings` | no/yes | Read / save dashboard settings |
| POST | `/api/session/start` | yes | Start a test session |
| POST | `/api/session/finish` | yes | Finish a test session |
| GET | `/api/session/status` | no | Active session info |

---

### `POST /api/appTemplates/{app}/scenarios/{id}/run`

Executes a named scenario from `apptemplates/{app}/scenarios.xml`.

**Path parameters:**
- `app` — app folder name (e.g. `calculator`, `notepad`, `chrome`)
- `id` — scenario `id` attribute in `scenarios.xml`

**Request body (JSON):**
```json
{
  "params": { "expression": "7 * 6" },
  "verbose": false
}
```

**Response:**
```json
{
  "success": true,
  "app": "calculator",
  "scenarioId": "compute",
  "label": "Compute Expression",
  "totalSteps": 4,
  "skippedSteps": 0,
  "failedSteps": 0,
  "vars": { "hwnd": "HANDLE:66716" },
  "steps": [
    { "step": 1, "command": "LISTWINDOWS", "success": true, "durationMs": 12 },
    { "step": 2, "command": "LAUNCH", "skipped": true },
    { "step": 3, "command": "RESET", "success": true, "durationMs": 145 },
    { "step": 4, "command": "READ", "success": true, "result": "42", "durationMs": 18 }
  ]
}
```

**`ScenarioRef` composition:** Steps defined as `<ScenarioRef ref="intro"/>` are inlined
recursively at load time. The loader resolves all references before execution.

---

### `GET /api/appTemplates`

Returns metadata for all app folders under `appTemplatesDir`.

```json
[
  {
    "name": "calculator",
    "hasTree": true,
    "hasScenarios": true,
    "scenarioCount": 3
  },
  {
    "name": "notepad",
    "hasTree": true,
    "hasScenarios": true,
    "scenarioCount": 5
  }
]
```

---

### MCP Tool: `executeScenario` — XML Template Mode

The MCP tool `executeScenario` also supports running app template scenarios:

```json
{
  "jsonrpc": "2.0",
  "method": "tools/call",
  "params": {
    "name": "executeScenario",
    "arguments": {
      "app": "calculator",
      "scenarioId": "compute",
      "params": { "expression": "7 * 6" },
      "verbose": false
    }
  }
}
```

This is equivalent to calling `POST /api/appTemplates/calculator/scenarios/compute/run`.



