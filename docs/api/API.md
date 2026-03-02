# API Reference - AI UI Automation Plugin

## Overview

The plugin exposes a unified API for querying and controlling UI elements across multiple applications. This document provides detailed specifications for all API methods.

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

