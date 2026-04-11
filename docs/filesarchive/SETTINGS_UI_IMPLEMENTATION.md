# AIAPI Settings UI Enhancement - Implementation Summary

## Completed Features

### 1. ✅ Working Directory Management

**Backend** (httpServerWithDashboard.ts):
- Added `currentWorkingDir` to settings response (returns `process.cwd()`)
- New API endpoint: `POST /api/workdir` with payload `{ path: string }`
- Validates directory exists before changing
- Resolves relative paths to absolute
- Updates process working directory via `process.chdir()`

**Frontend** (dashboard.html + dashboard.js):
- Current directory banner at top of Settings tab
- "Change Directory" button with async handler
- Prompts for new directory (absolute or relative)
- Calls `/api/workdir` API and updates display
- Reloads settings after directory change
- Shows success/error feedback in logs

**Usage:**
```javascript
// API call
POST /api/workdir
{ "path": "../scenarios" }

// Response
{ "success": true, "path": "C:\\Users\\plachy\\Documents\\Dev\\VSCplugins\\scenarios" }
```

---

### 2. ✅ Advanced Security Filters UI (Tree-Based)

**Design Philosophy:**
- **Filter Format:** `Helper.exe://<command>/<parameter-pattern>`
- **Examples:**
  - `KeyWin.exe://{CLICKNAME}/num*Button` - Allow number buttons only
  - `KeyWin.exe://{CLICKNAME}/closeButton*` - Block close buttons
  - `BrowserWin.exe://navigate/*://malicious.com/*` - Block malicious domains
  - `OfficeWin.exe://editCell/Sheet1!A*` - Allow only column A edits

**UI Components** (dashboard.html):
```html
<div class="filter-tree-container">
  <div class="filter-tree-header">
    <button id="btn-add-filter">➕ Add Filter</button>
    <button id="btn-import-tree">📥 Import from Live UI</button>
    <button id="btn-validate-filters">✔️ Validate</button>
  </div>
  
  <div class="filter-rules">
    <!-- Filter rule cards with ALLOW/DENY badges -->
    <div class="filter-rule-example">
      <div class="filter-rule-header">
        <span class="filter-type allow">ALLOW</span>
        <span class="filter-pattern">KeyWin.exe://{CLICKNAME}/num*Button</span>
        <div class="filter-actions">
          <button class="btn-icon">✏️</button>
          <button class="btn-icon">🗑️</button>
        </div>
      </div>
      <div class="filter-description">Allow clicking number buttons</div>
    </div>
  </div>
  
  <div class="filter-format-help">
    <!-- Pattern syntax documentation -->
  </div>
</div>
```

**Visual Design** (dashboard.css):
- `.filter-section.advanced` - Highlighted with accent border
- `.filter-rule-example` - Card-based layout
- `.filter-type.allow` - Green badge for ALLOW rules
- `.filter-type.deny` - Red badge for DENY rules
- `.filter-pattern` - Monospace font, accent color
- `.btn-tool` - Toolbar buttons with hover states
- `.btn-icon` - Icon-only action buttons
- `.filter-format-help` - Documentation panel

**Pattern Syntax:**
- `*` - Wildcard (matches any characters)
- `?` - Single character
- `[abc]` - Character class
- `{regex}` - Full regex pattern

**Placeholder Handlers** (dashboard.js):
```javascript
// Add Filter - Opens editor dialog (coming soon)
btn-add-filter -> alert with planned features

// Import from Live UI - Query running app and generate filters (coming soon)
btn-import-tree -> alert with planned features

// Validate Filters - Check syntax and test patterns (coming soon)
btn-validate-filters -> alert with planned features
```

**Legacy Basic Filters:**
- Moved to collapsible `<details>` section
- Kept for backwards compatibility
- Simple textarea lists for executables and paths
- Marked as "Legacy - Simple Lists"

---

### 3. ✅ Dynamic Helper API Discovery (Architecture Documented)

**Documented in TODO.md:**

**Helper Schema Advertisement:**
```json
{
  "helper": "KeyWin.exe",
  "version": "1.0.0",
  "commands": [
    {
      "name": "CLICKNAME",
      "description": "Click UI element by AutomationId",
      "parameters": [
        {
          "name": "target",
          "type": "string",
          "required": true,
          "description": "Process name or window handle"
        },
        {
          "name": "elementId",
          "type": "string",
          "required": true,
          "description": "AutomationId of element"
        }
      ],
      "examples": [
        "{CLICKNAME:num2Button}",
        "CalculatorApp.exe\\n{CLICKNAME:plusButton}"
      ]
    }
  ]
}
```

**MCP Server Dynamic Loading Plan:**
1. On startup, scan helper discovery path (e.g., `./dist/**/*.exe`)
2. Execute each helper with `--api-schema` flag
3. Parse JSON schema and build internal command registry
4. Generate MCP tools dynamically from schemas
5. Map MCP tool calls to helper commands

**Benefits:**
- Helpers are self-documenting
- No code changes to MCP server when adding helpers
- IntelliSense/autocomplete from schemas
- Version compatibility checking
- Extensible to custom helpers

---

## File Changes Summary

### Modified Files:
1. **src/server/httpServerWithDashboard.ts**
   - Added `currentWorkingDir` to settings response
   - Added `/api/workdir` endpoint handler
   - Added `handleChangeWorkDir()` method

2. **static/dashboard.html**
   - Added current directory banner with change button
   - Redesigned security filters section
   - Added advanced filter UI with tree-based layout
   - Moved basic filters to collapsible section

3. **static/dashboard.css**
   - Added styles for advanced filter components
   - Added `.filter-section.advanced` styling
   - Added `.filter-rule-example` card layout
   - Added `.filter-type` badge styles (allow/deny)
   - Added `.btn-tool` and `.btn-icon` styles

4. **static/dashboard.js**
   - Wired up working directory change button
   - Added placeholder handlers for filter buttons
   - Added informational alerts for upcoming features

5. **TODO.md**
   - Documented tree-based filter format
   - Documented dynamic helper API discovery
   - Added detailed architecture plans

---

## Next Steps (Not Yet Implemented)

### Priority 1: Complete Advanced Filters
1. **Backend Filter Storage:**
   - Add `advancedFilters` array to config
   - API endpoints: `POST /api/filters/add`, `DELETE /api/filters/:id`, `PUT /api/filters/:id`
   - Validation against helper schemas

2. **Filter Editor Dialog:**
   - Modal dialog for creating/editing filters
   - Helper dropdown (populated from discovered schemas)
   - Command dropdown (from selected helper schema)
   - Parameter pattern input with examples
   - ALLOW/DENY radio buttons
   - Description text field

3. **Import from Live UI:**
   - Connect to running process via queryTree
   - Display UI tree in interactive tree view
   - Click elements to generate filters
   - Preview generated filter rules
   - Batch import selected elements

4. **Filter Validation:**
   - Syntax validation (regex, wildcards)
   - Check helper command exists in schema
   - Test pattern matching against examples
   - Detect conflicting rules (ALLOW vs DENY)
   - Coverage report (what's allowed/blocked)

### Priority 2: Native File Dialogs
- Windows native folder picker for working directory
- File picker for key files and scenarios
- Native integration via Node.js or PowerShell

### Priority 3: Helper Schema Implementation
- Add `--api-schema` flag to KeyWin.exe
- Output JSON schema to stdout
- MCP server helper discovery on startup
- Dynamic tool generation from schemas

### Priority 4: Scenario Editor with IntelliSense
- Visual scenario builder
- Autocomplete from helper schemas
- Parameter validation
- Step-by-step execution preview

---

## Testing

**Manual Test:**
1. Start server: `npm run start-server`
2. Open dashboard: http://localhost:3458
3. Go to Settings tab
4. Click "Change Directory" button
5. Enter new path (e.g., `../scenarios`)
6. Verify directory changes in banner
7. Check logs for confirmation

**Verify Working Directory API:**
```powershell
# Test API directly
Invoke-RestMethod -Uri http://localhost:3458/api/workdir `
  -Method POST `
  -Body (@{path="../test"} | ConvertTo-Json) `
  -ContentType "application/json"
```

---

## Architecture Notes

### Filter Evaluation Order:
1. Check DENY rules first (fail-safe)
2. Check ALLOW rules
3. Default: DENY if no match

### Filter Pattern Matching:
```typescript
// Pseudo-code
function matchesFilter(command: string, params: any, filter: Filter): boolean {
  const pattern = new RegExp(filter.pattern.replace('*', '.*').replace('?', '.'));
  const commandPath = `${filter.helper}://${command}/${JSON.stringify(params)}`;
  return pattern.test(commandPath);
}
```

### Helper Discovery Path:
- Default: `./dist/**/*.exe`
- Configurable via settings: `helperPaths: string[]`
- Scan on startup and on "Reload Helpers" button

---

## UI/UX Improvements Implemented

1. **Current Working Directory Visibility:**
   - Always visible at top of Settings
   - Shows absolute path
   - One-click change with validation

2. **Advanced vs Basic Filters:**
   - Advanced filters promoted (highlighted)
   - Basic filters demoted (collapsible, faded)
   - Clear migration path

3. **Filter Rule Cards:**
   - Visual hierarchy (ALLOW green, DENY red)
   - Monospace patterns for clarity
   - Inline actions (edit, delete)
   - Descriptions for documentation

4. **Toolbar Buttons:**
   - Icon + text for clarity
   - Hover states for feedback
   - Consistent spacing and sizing

5. **Help Documentation:**
   - Inline pattern syntax reference
   - Examples embedded in UI
   - No need to reference external docs

---

## Related Documentation

- [TODO.md](TODO.md) - Full development roadmap
- [SECURITY_ARCHITECTURE.md](SECURITY_ARCHITECTURE.md) - Security design
- [START_HERE.md](START_HERE.md) - Project overview
- [API.md](API.md) - HTTP API reference

---

**Status:** Ready for testing and iteration
**Next Review:** Test working directory change, then implement filter editor dialog
