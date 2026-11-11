# MCP Best-Practice Enhancements - Implementation Specification

**Date**: 2026-11-11
**Target**: `components/server/src/server/mcpServer.ts`
**Based on**: MCP compliance audit findings in `docs/qa/MCP_OUTPUT_FORMAT_COMPLIANCE_AUDIT.md`

---

## Enhancement 1: Progress Notifications for Long-Running Operations

### Objective
Add MCP progress notifications for operations exceeding 10 seconds to prevent AI client timeouts and provide visibility into operation status.

### MCP Spec Reference
MCP supports `notifications/progress` events via SSE stream:
```
event: message
data: {"jsonrpc":"2.0","method":"notifications/progress","params":{"progressToken":"<token>","progress":<current>,"total":<total>}}
```

### Design

#### 1.1 Progress Token Generation
- Generate unique progress token per long-running tool call
- Include token in initial response or tool call parameters
- Use `crypto.randomBytes(8).toString('hex')` for token generation

#### 1.2 Operations to Monitor
| Action | Threshold | Progress Metric |
|--------|-----------|----------------|
| FETCH_WEBPAGE_RENDER | > 5000ms | Phase: "connecting", "rendering", "extracting" |
| EXEC_CMD | > 10000ms | Elapsed time + "running" status |
| FS_WRITE (large files > 1MB) | > 3000ms | Bytes written / total |
| SCREENSHOT | > 5000ms | "capturing" status |

#### 1.3 Implementation Approach

**Option A: Inline progress tracking (RECOMMENDED)**
```typescript
// In handleToolsCall, wrap long operations with progress emitter
private async executeWithProgress(
  operation: () => Promise<any>,
  actionName: string,
  thresholdMs: number
): Promise<any> {
  const startTime = Date.now();
  const progressToken = crypto.randomBytes(8).toString('hex');
  
  // Emit initial progress
  this.emitProgress(progressToken, 0, 100, `Starting ${actionName}...`);
  
  const result = await operation();
  const elapsed = Date.now() - startTime;
  
  if (elapsed > thresholdMs) {
    this.emitProgress(progressToken, 100, 100, `${actionName} completed in ${elapsed}ms`);
  }
  
  return result;
}

private emitProgress(token: string, progress: number, total: number, message: string) {
  for (const sseStream of this.sseClients.values()) {
    if (!sseStream.destroyed) {
      const payload = {
        jsonrpc: '2.0',
        method: 'notifications/progress',
        params: { progressToken: token, progress, total, message }
      };
      sseStream.write(`event: message\ndata: ${JSON.stringify(payload)}\n\n`);
    }
  }
}
```

**Option B: Phase-based progress for FETCH operations**
```typescript
// For FETCH_WEBPAGE_RENDER with explicit phase reporting
const phases = ['connecting', 'rendering', 'extracting'];
for (const phase of phases) {
  this.emitProgress(token, phases.indexOf(phase) * 33, 100, phase);
  // ... execute phase
}
```

### Acceptance Criteria
- [ ] Long-running operations emit progress notifications via SSE
- [ ] Progress notifications include current progress, total, and human-readable message
- [ ] No progress notifications for operations completing within threshold
- [ ] Progress notifications are only sent to SSE clients (not plain JSON-RPC)
- [ ] Existing functionality is not affected

---

## Enhancement 2: Response Annotations for AI Client Hints

### Objective
Add `annotations` field to content items providing AI clients with metadata about the response (audience, priority, role hints).

### MCP Spec Reference
```json
{
  "type": "text",
  "text": "...",
  "annotations": {
    "audience": ["user", "assistant"],
    "priority": 0.8,
    "role": "result" | "error" | "hint" | "diagnostic"
  }
}
```

### Design

#### 2.1 Annotation Strategy by Response Type

| Response Type | audience | priority | role |
|---------------|----------|----------|------|
| Standard success | ["assistant"] | 1.0 | "result" |
| Screenshot image | ["assistant"] | 1.0 | "result" |
| Screenshot text summary | ["assistant"] | 0.5 | "diagnostic" |
| Error response | ["assistant"] | 1.0 | "error" |
| Warning/escalation | ["assistant", "user"] | 0.8 | "hint" |
| listHelpers compact | ["assistant"] | 0.7 | "result" |
| listHelpers full | ["assistant"] | 0.9 | "result" |

#### 2.2 Implementation in buildContentItems()

```typescript
private static buildContentItems(
  cleanResult: unknown,
  rawResult: unknown,
): Array<{ type: string; text?: string; data?: string; mimeType?: string; annotations?: any }> {
  const items: Array<...> = [];
  
  // For screenshot results
  if (imageBase64) {
    items.push({
      type: 'image',
      data: imageBase64,
      mimeType: 'image/png',
      annotations: {
        audience: ['assistant'],
        priority: 1.0,
        role: 'result'
      }
    });
    
    items.push({
      type: 'text',
      text: JSON.stringify(summary, null, 2),
      annotations: {
        audience: ['assistant'],
        priority: 0.5,
        role: 'diagnostic'
      }
    });
  }
  
  // For standard results
  items.push({
    type: 'text',
    text: JSON.stringify(cleanResult, null, 2),
    annotations: {
      audience: ['assistant'],
      priority: this.calculatePriority(cleanResult),
      role: this.determineRole(cleanResult)
    }
  });
}

private static calculatePriority(result: unknown): number {
  if (!result) return 0.3;
  const obj = result as any;
  if (obj?.success === false) return 0.9; // errors are high priority
  if (obj?._escalated) return 0.8; // escalations need attention
  return 1.0; // normal success
}

private static determineRole(result: unknown): string {
  const obj = result as any;
  if (obj?.success === false) return 'error';
  if (obj?._escalated) return 'hint';
  if (obj?._sessionWarning) return 'diagnostic';
  return 'result';
}
```

### Acceptance Criteria
- [ ] All content items include `annotations` field
- [ ] Priority values reflect response importance (0.0 - 1.0)
- [ ] Role correctly identifies response type
- [ ] Screenshot text summaries marked as lower priority than image data
- [ ] Error/warning responses marked with appropriate role

---

## Enhancement 3: Structured Error Data for Common Failure Modes

### Objective
Add structured error context in the `data` field of error responses to help AI clients understand failure modes and potential recovery actions.

### Design

#### 3.1 Error Context Schema

```typescript
interface StructuredErrorData {
  // Whether the operation can be retried
  retryable?: boolean;
  
  // Suggested action for the AI client
  suggestedAction?: string;
  
  // Original command/action that failed
  failedAction?: string;
  
  // Target that was being accessed
  failedTarget?: string;
  
  // Category of error for programmatic handling
  category?: 'permission' | 'network' | 'timeout' | 'not_found' | 'invalid_input' | 'security' | 'internal';
  
  // Correlation ID for debugging
  correlationId?: string;
}
```

#### 3.2 Error Category Mapping

| Error Pattern | category | retryable | suggestedAction |
|---------------|----------|-----------|-----------------|
| File not found | "not_found" | false | "Verify file path exists" |
| Permission denied | "permission" | false | "Check file permissions or use admin token" |
| Network timeout | "timeout" | true | "Retry with increased timeout" |
| DNS resolution failed | "network" | false | "Verify URL is correct and reachable" |
| Security filter blocked | "security" | false | "Request admin token or adjust security policy" |
| Helper not found | "not_found" | false | "Use listHelpers to see available helpers" |
| Invalid action | "invalid_input" | false | "Check action name spelling and available actions" |
| Internal server error | "internal" | true | "Retry or contact administrator with correlation ID" |

#### 3.3 Implementation in createErrorResponse()

```typescript
private createErrorResponse(
  id: any, 
  code: number, 
  message: string, 
  data?: Record<string, unknown>
): any {
  const errObj: Record<string, unknown> = { code, message };
  
  // Enhance with structured error data if not already provided
  if (!data) {
    data = this.generateStructuredErrorData(code, message);
  }
  
  if (data && Object.keys(data).length > 0) errObj.data = data;
  return { jsonrpc: '2.0', id, error: errObj };
}

private generateStructuredErrorData(code: number, message: string): StructuredErrorData {
  const data: StructuredErrorData = {
    correlationId: crypto.randomBytes(8).toString('hex')
  };
  
  // Parse message for patterns
  if (message.includes('not found') || message.includes('Unknown')) {
    data.category = 'not_found';
    data.retryable = false;
    data.suggestedAction = 'Verify target exists or check available options';
  } else if (message.includes('permission') || message.includes('denied')) {
    data.category = 'permission';
    data.retryable = false;
    data.suggestedAction = 'Check permissions or use admin token';
  } else if (message.includes('timeout') || message.includes('timed out')) {
    data.category = 'timeout';
    data.retryable = true;
    data.suggestedAction = 'Retry with increased timeout parameter';
  } else if (message.includes('Security filter')) {
    data.category = 'security';
    data.retryable = false;
    data.suggestedAction = 'Request admin token or adjust security policy';
  } else if (message.includes('Security filter') || message.includes('blocked')) {
    data.category = 'security';
    data.retryable = false;
    data.suggestedAction = 'Check security filter configuration';
  } else if (code === -32603) {
    data.category = 'internal';
    data.retryable = true;
    data.suggestedAction = 'Retry operation or contact administrator';
  }
  
  return data;
}
```

### Acceptance Criteria
- [ ] All error responses include structured `data` field
- [ ] Error categories correctly classified
- [ ] retryable flag accurately reflects recoverability
- [ ] suggestedAction provides actionable guidance
- [ ] Correlation ID included for debugging

---

## Enhancement 4: Document _escalated Fields as Public Contract

### Objective
Formalize the `_escalated`, `_escalationReason`, and `_escalationFailed` fields as documented public contract fields rather than internal underscore-prefixed fields.

### Design

#### 4.1 New Field Names (without underscore prefix)

| Old Field | New Field | Type | Description |
|-----------|-----------|------|-------------|
| `_escalated` | `escalated` | boolean | Indicates auto-escalation occurred |
| `_escalationReason` | `escalationReason` | string | Human-readable reason for escalation |
| `_escalationFailed` | `escalationError` | string \| null | Error if escalation failed |
| `_sessionWarning` | `sessionWarning` | string \| null | Session 0 warning message |
| `_note` | `note` | string \| null | Informational note |

#### 4.2 Changes Required

**mcpServer.ts - Update field names:**
```typescript
// Line ~1040: Change from _escalated to escalated
result = {
  ...result,
  content: renderResult.html,
  text: renderResult.html,
  escalated: true,                    // was _escalated
  escalationReason: `Login form detected (action: ${result.loginForm.action}, confidence: ${result.loginForm.confidence})`,  // was _escalationReason
  obstacle: renderResult.obstacle,
};

// Line ~1048: Change from _escalationFailed to escalationError
result.escalationError = renderResult.error;  // was _escalationFailed
```

**mcpServer.ts - Update sanitiseResultForWire():**
```typescript
// Remove these from the strip list since they are now public contract
if (key === '_bridgeError' || key === '_isScreenshot') continue;
// Remove: _escalated, _escalationReason, _escalationFailed, _sessionWarning, _note
```

**CONVENTIONS.md - Document public response fields:**
```markdown
### Public Response Fields

All tool responses may include these standard metadata fields:

| Field | Type | Description |
|-------|------|-------------|
| `success` | boolean | Operation success status |
| `escalated` | boolean | Auto-escalation occurred |
| `escalationReason` | string | Reason for escalation |
| `escalationError` | string \| null | Escalation failure reason |
| `sessionWarning` | string \| null | Session 0 warning |
| `note` | string \| null | Informational note |
```

### Acceptance Criteria
- [ ] All underscore-prefixed public fields renamed without underscore
- [ ] Fields removed from sanitiseResultForWire() strip list
- [ ] CONVENTIONS.md updated with public response field documentation
- [ ] All references to old field names updated throughout codebase

---

## Implementation Order

1. **Enhancement 4** (Document _escalated fields) - Simplest, lowest risk
2. **Enhancement 3** (Structured error data) - Medium complexity, high value
3. **Enhancement 2** (Response annotations) - Medium complexity, affects all responses
4. **Enhancement 1** (Progress notifications) - Highest complexity, requires SSE integration

## Testing Requirements

Each enhancement must include:
- Unit tests for new functionality
- Integration tests for end-to-end flows
- Verification that existing tests still pass
- SSE-specific tests for progress notifications

## Backward Compatibility

All changes must be **additive only**:
- New fields are optional
- Existing clients that ignore new fields will continue to work
- No breaking changes to existing response structures
