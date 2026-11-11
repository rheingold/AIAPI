# MCP Output Format Compliance Audit

**Date**: 2026-11-11
**Mode**: Architect (ARCH)
**Scope**: All MCP tool response paths in `mcpServer.ts` — success responses, error responses, tool schemas
**Reference**: MCP 2024-11-05 protocol specification

---

## Executive Summary

The recent SCREENSHOT fix (introducing `buildContentItems()` with proper `type: 'image'` content items) was a **correct and necessary MCP compliance improvement**. However, the audit reveals that the rest of the MCP output paths are **mostly compliant** with several areas where responses are functional but could be improved for better AI client understanding.

**Overall Compliance Score: GOOD (minor improvements recommended)**

---

## 1. MCP Specification Reference

The MCP protocol (2024-11-05) specifies that `tools/call` responses must follow this structure:

### Success Response:
```json
{
  "jsonrpc": "2.0",
  "id": "<request_id>",
  "result": {
    "content": [
      { "type": "text", "text": "..." },
      { "type": "image", "data": "<base64>", "mimeType": "image/png" },
      { "type": "resource", ... }
    ],
    "_meta": { ... }  // optional
  }
}
```

### Error Response:
```json
{
  "jsonrpc": "2.0",
  "id": "<request_id>",
  "error": {
    "code": <integer>,
    "message": "<string>",
    "data": { ... }  // optional - structured error context
  }
}
```

### Tool Schema (tools/list):
```json
{
  "name": "<string>",
  "description": "<string>",
  "inputSchema": { /* JSON Schema object */ }
}
```

---

## 2. Success Response Path Analysis

### 2.1 Response Wrapper (Lines 1767-1779)

**Current Code:**
```typescript
const cleanResult = MCPServer.sanitiseResultForWire(result);
const contentItems = MCPServer.buildContentItems(cleanResult, result);
return {
  jsonrpc: '2.0',
  id,
  result: {
    content: contentItems,
  },
};
```

**Compliance: ✅ COMPLIANT**
- Wraps result in `content: [...]` array
- Uses `buildContentItems()` for proper content type detection
- Sanitizes internal fields before wire serialization

### 2.2 buildContentItems() Method (Lines 1882-1946)

**Current Behavior:**
| Scenario | Output | MCP Compliant? |
|----------|--------|----------------|
| Screenshot with valid base64 | `[ { type: 'image', data, mimeType }, { type: 'text', text: '<summary JSON>' } ]` | ✅ YES |
| Screenshot without valid base64 | `[ { type: 'text', text: '<full JSON>' } ]` | ✅ YES |
| Non-screenshot result | `[ { type: 'text', text: '<full JSON>' } ]` | ✅ YES |
| Null result | `[ { type: 'text', text: 'null' } ]` | ✅ YES |
| Array result | `[ { type: 'text', text: '<JSON>' } ]` | ✅ YES |

**Compliance: ✅ COMPLIANT**

**Strengths:**
- Properly detects screenshot results and emits `type: 'image'` with `mimeType: 'image/png'`
- Includes lightweight text summary alongside image data (prevents AI client confusion)
- Graceful fallback to text-only when no image data found
- Validates base64 format with regex before emitting

### 2.3 Sanitization (Lines 1854-1866)

**Current Behavior:**
- Strips `_bridgeError` and `_isScreenshot` internal fields
- Recursive traversal of nested objects/arrays

**Compliance: ✅ COMPLIANT**
- Prevents internal state leakage to AI clients
- Maintains data integrity for public fields

---

## 3. Error Response Path Analysis

### 3.1 createErrorResponse() (Lines 1820-1824)

**Current Code:**
```typescript
private createErrorResponse(id: any, code: number, message: string, data?: Record<string, unknown>): any {
  const errObj: Record<string, unknown> = { code, message };
  if (data && Object.keys(data).length > 0) errObj.data = data;
  return { jsonrpc: '2.0', id, error: errObj };
}
```

**Compliance: ✅ COMPLIANT**
- Follows JSON-RPC 2.0 error response format
- Includes proper error codes (-32600, -32601, -32602, -32603)
- Supports optional `data` field for structured error context
- Correlation IDs provided for remote callers

### 3.2 Error Code Usage

| Code | Usage | MCP Standard? |
|------|-------|---------------|
| -32600 | Invalid request, method not allowed | ✅ Parse/Invalid Request |
| -32601 | Method not found (legacy tools) | ✅ Method not found |
| -32602 | Invalid params (unknown tool, unknown action) | ✅ Invalid params |
| -32603 | Internal/server errors | ✅ Internal error |

**Compliance: ✅ COMPLIANT**

### 3.3 Error Message Quality

**Current State:**
- Legacy tool calls return migration hints with replacement syntax
- Helper not found errors list available helpers
- Action not found errors list available actions
- Stack traces stripped via `stripStackLines()`
- Remote callers receive `'internal_error'` instead of full messages

**Compliance: ✅ COMPLIANT** — Better than most implementations

---

## 4. Tool Schema Analysis (tools/list)

### 4.1 Tool Definitions

All tools in [`handleToolsList()`](components/server/src/server/mcpServer.ts:630) include:

| Field | Present? | Example |
|-------|----------|---------|
| `name` | ✅ | `'AutomateUI'`, `'_System'`, `'listHelpers'` |
| `description` | ✅ | Detailed multi-sentence descriptions |
| `inputSchema` | ✅ | Full JSON Schema with `type`, `properties`, `required` |

**Compliance: ✅ COMPLIANT**

### 4.2 Input Schema Quality

**AutomateUI:**
```typescript
inputSchema: {
  type: 'object',
  properties: {
    helper: { type: 'string', enum: ['BrowserWin', 'KeyWin', ...] },
    action: { type: 'string', description: '...' },
    proc: { type: 'string', description: '...' },
    path: { type: 'string', description: '...' },
    value: { type: 'string', description: '...' },
    background: { type: 'boolean', description: '...', default: false },
  },
  required: ['helper', 'action'],
}
```

**_System:**
```typescript
inputSchema: {
  type: 'object',
  properties: {
    action: { type: 'string', enum: ['EXEC_CMD', 'FS_READ', ...] },
    proc: { type: 'string', description: '...' },
    path: { type: 'string', description: '...' },
    value: { type: 'string', description: '...' },
    background: { type: 'boolean', default: false },
  },
  required: ['action'],
}
```

**Compliance: ✅ COMPLIANT**
- Properly typed properties
- Enum values for constrained fields
- Required fields correctly specified
- Default values documented

---

## 5. Areas for IMPROVEMENT (Not Critical - Enhancements)

### 5.1 Missing: Response Annotations

**MCP Spec:** Content items can include an `annotations` field with metadata like audience, priority, or role hints.

**Current:** No annotations on any content items.

**Impact:** Low. AI clients can still process responses correctly without annotations.

**Recommendation:** Optional enhancement — add annotations for error severity, result type hints, etc.

### 5.2 Missing: Progress Notifications

**MCP Spec:** Long-running operations can emit `notifications/progress` events.

**Current:** No progress notifications for long operations (FETCH_WEBPAGE_RENDER, EXEC_CMD with long timeouts).

**Impact:** Medium. AI clients may timeout waiting for responses without progress signals.

**Recommendation:** Consider adding progress notifications for operations > 10 seconds.

### 5.3 Missing: Structured Error Data

**MCP Spec:** Error `data` field can carry structured context.

**Current:** Only correlation IDs are included for remote callers. Local callers get full error messages.

**Impact:** Low-Medium. AI clients could benefit from structured error fields like `{ retryable: true/false, suggestedAction: "..." }`.

**Recommendation:** Consider adding structured error context for common failure modes.

### 5.4 Non-Standard: _escalated field in results

**Current:** Auto-escalated FETCH_WEBPAGE results include `_escalated`, `_escalationReason` fields which start with underscore but are NOT stripped by `sanitiseResultForWire()`.

**Impact:** Low. These fields are semantically useful for AI clients to understand escalation behavior.

**Recommendation:** Document these fields as part of the public contract, or rename without underscore prefix.

---

## 6. Direct Helper Tools vs. AutomateUI Path Consistency

### 6.1 Screenshot Flag Setting

**AutomateUI path:** [`mcpServer.ts:1128-1130`](components/server/src/server/mcpServer.ts:1128)
```typescript
if (actionName === 'SCREENSHOT') {
  result._isScreenshot = true;
}
```

**Direct helper tool path:** [`mcpServer.ts:1746-1749`](components/server/src/server/mcpServer.ts:1746)
```typescript
if (resolved.command.toUpperCase() === 'SCREENSHOT') {
  result._isScreenshot = true;
}
```

**Compliance: ✅ CONSISTENT** — Both paths set the flag correctly.

### 6.2 Response Wrapping

Both paths converge at lines 1767-1779 using the same `buildContentItems()` wrapper.

**Compliance: ✅ CONSISTENT**

---

## 7. BrowserWin SCREENSHOT Compliance

BrowserWin SCREENSHOT follows the same path as KeyWin SCREENSHOT through `callCommand()` → result wrapper → `buildContentItems()`.

**Compliance: ✅ COMPLIANT** — Same `_isScreenshot` detection and image content emission.

---

## 8. _System Tool Response Formats

### 8.1 Standard Responses

All _System actions (EXEC_CMD, FS_READ, FS_WRITE, FS_LIST, FETCH_*) return structured objects wrapped in `content: [{ type: 'text', text: '<JSON>' }]`.

**Compliance: ✅ COMPLIANT**

### 8.2 Response Structure Examples

| Action | Success Response Structure | Notes |
|--------|---------------------------|-------|
| EXEC_CMD | `{ success, exitCode, stdout, stderr }` | Clean structured output |
| FS_READ | `{ success, content, hash?, dates?, attributes? }` | Optional metadata |
| FS_WRITE | `{ success, path, bytesWritten }` | Confirmation details |
| FS_LIST | `{ success, entries: [...] }` | Array of file entries |
| FETCH_* | `{ success, url, content, contentType }` | Content with metadata |

---

## 9. Summary Matrix

| Response Path | MCP Compliant | Notes |
|---------------|--------------|-------|
| Success (screenshot) | ✅ YES | Proper `type: 'image'` with mimeType |
| Success (standard) | ✅ YES | Proper `type: 'text'` with JSON content |
| Success (null/empty) | ✅ YES | Graceful fallback to text |
| Error (JSON-RPC) | ✅ YES | Proper codes, messages, correlation IDs |
| Error (helper failure) | ✅ YES | Converted to JSON-RPC error responses |
| Tool Schema | ✅ YES | name + description + inputSchema |
| Tool Schema (types) | ✅ YES | Proper JSON Schema with enums, required |
| Sanitization | ✅ YES | Internal fields stripped |
| Path consistency | ✅ YES | All paths use same wrapper |

---

## 10. Recommendations (Priority Ordered)

### HIGH Priority: None — Current implementation is MCP-compliant

### MEDIUM Priority:

1. **Add progress notifications** for long-running operations (FETCH_WEBPAGE_RENDER, EXEC_CMD > 10s)
2. **Document `_escalated`/`_escalationReason` fields** as public contract or rename without underscore

### LOW Priority:

3. **Add response annotations** for AI client hints (audience, priority)
4. **Add structured error data** for common failure modes (retryable, suggestedAction)

---

## 11. Conclusion

**The current MCP output format implementation is COMPLIANT with MCP 2024-11-05 specification across all response paths.**

The recent SCREENSHOT fix was the last significant compliance gap. All tool responses now:
- Wrap results in `content: [...]` arrays
- Use proper content types (`text` for data, `image` for screenshots)
- Include proper `mimeType` for image content
- Sanitize internal fields before wire serialization
- Use correct JSON-RPC 2.0 error response format
- Provide well-typed tool schemas with descriptions

The improvements recommended above are **enhancements** (not compliance fixes) that would improve the AI client experience but are not required for MCP protocol compliance.
