# Architecture Overview

## System Design

```
┌─────────────────────────────────────────────────────────────────┐
│                      VS Code Editor                             │
│                                                                  │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │            VS Code Extension (TypeScript)                 │  │
│  │  - Command Handlers                                       │  │
│  │  - Webview Panels                                         │  │
│  │  - User Interactions                                      │  │
│  └────────────────────┬────────────────────────────────────┘  │
│                       │                                         │
└───────────────────────┼─────────────────────────────────────────┘
                        │
                        ▼
        ┌───────────────────────────────┐
        │   Automation Engine           │
        │ ┌─────────────────────────┐   │
        │ │  Request Router         │   │
        │ │  Caching Layer          │   │
        │ │  Logging System         │   │
        │ │  Error Handling         │   │
        │ └─────────────────────────┘   │
        └────────┬──────────┬──────────┬┘
                 │          │          │
      ┌──────────▼───┐ ┌────▼─────────┐ ┌──────────▼────┐
      │   Windows    │ │   Web UI     │ │    Office     │
      │    Forms     │ │  Provider    │ │   Providers   │
      │   Provider   │ │(Playwright)  │ │ (Word, Excel, │
      │ (DLL Bridge) │ │              │ │ PowerPoint)   │
      └──────────┬───┘ └────┬─────────┘ └──────────┬────┘
                 │          │                       │
      ┌──────────▼─────┐    │          ┌────────────▼──────┐
      │ .NET DLL       │    │          │  .NET DLL         │
      │ - UIAutomation │    │          │ - COM Interop     │
      │ - Win32 API    │    │          │ - Office Object   │
      │                │    │          │   Model           │
      └──────────┬─────┘    │          └────────────┬──────┘
                 │          │                       │
      ┌──────────▼──────────▼────────────────────────▼─────┐
      │                                                    │
      │  Windows OS & Applications                        │
      │  ┌──────────────┐  ┌────────────────────────┐    │
      │  │ Windows Forms│  │ Browser (Puppeteer)    │    │
      │  │ WPF Apps     │  │ Web Applications       │    │
      │  └──────────────┘  └────────────────────────┘    │
      │  ┌────────────────────────────────────────────┐   │
      │  │ Office Applications                        │   │
      │  │ - Microsoft Word                           │   │
      │  │ - Microsoft Excel                          │   │
      │  │ - Microsoft PowerPoint                     │   │
      │  └────────────────────────────────────────────┘   │
      │                                                    │
      └────────────────────────────────────────────────────┘
```

---

## Module Breakdown

### Core Types (`src/types.ts`)
**Responsibility:** Define all TypeScript interfaces and enums

**Key Types:**
- `UIObject`: Universal representation of UI elements
- `ActionResult`: Standardized action response
- `IAutomationProvider`: Interface all providers must implement
- `AutomationTargetType`: Enum of supported target types
- `QueryOptions`: Configuration for tree queries
- `LogEntry`: Audit log entries

**Design Principle:** Single Source of Truth for type definitions

---

### Providers Layer

#### WindowsFormsProvider (`src/providers/windowsFormsProvider.ts`)
**Responsibility:** Automate Windows Forms and WPF applications

**Key Features:**
- Reads UI tree from .NET applications
- Navigates parent-child hierarchies
- Implements click, input, and property access
- Uses C# DLL via FFI for native interop

**Mock Data:**
- Sample Form with Button, TextBox, Label controls
- Demonstrates tree structure for testing

**Production Integration:**
- Replace mock implementation with DLL calls
- Use `ffi-napi` or `edge-js` for .NET bridge
- Leverage UIAutomation framework for element discovery

---

#### WebUIProvider (`src/providers/webUIProvider.ts`)
**Responsibility:** Automate browser-based applications

**Key Features:**
- DOM tree inspection using Playwright
- JavaScript evaluation for property access
- Element interaction (click, fill, etc.)
- Position and style capture

**Capabilities:**
- Automatic browser initialization
- CSS selector-based element targeting
- Deep DOM traversal with depth control
- Interactive element detection

**Browser Support:** Chromium (via Playwright)

---

#### OfficeProvider (`src/providers/officeProvider.ts`)
**Responsibility:** Automate Microsoft Office applications

**Supported Applications:**
1. **Excel**
   - Workbook/Worksheet/Cell hierarchy
   - Cell properties (value, formula, format)
   - Row/column operations

2. **Word**
   - Document/Paragraph hierarchy
   - Paragraph and text properties
   - Section management

3. **PowerPoint**
   - Presentation/Slide/Shape hierarchy
   - Shape properties and positioning
   - Text and formatting

**Mock Data:**
- Representative object models for each application
- Sample data structure for testing and development

**Production Integration:**
- COM Interop via C# DLL
- Direct object model access
- Full Office automation capabilities

---

### Automation Engine (`src/engine/automationEngine.ts`)
**Responsibility:** Central coordination of all providers

**Key Responsibilities:**

1. **Provider Management**
   - Initialize and manage all providers
   - Route requests to appropriate provider
   - Handle provider unavailability

2. **Request Processing**
   - Tree queries with depth control
   - Element interaction (click, setProperty, readProperty)
   - Error handling and validation

3. **Performance Optimization**
   - Object caching (LRU, max 100 items)
   - Cache statistics and management
   - Automatic cache eviction

4. **Audit Logging**
   - Comprehensive action logging
   - Success/failure tracking
   - Log retrieval and management
   - Log retention (max 1000 entries)

**Request Flow:**
```
Client Request
    ↓
Validation
    ↓
Provider Lookup
    ↓
Cache Check
    ↓
Provider Execution
    ↓
Response + Log
```

---

### VS Code Extension (`src/extension.ts`)
**Responsibility:** Bridge between user and automation engine

**Features:**
1. **Command Registration**
   - `aiAutomation.inspectWindow`: Tree inspection
   - `aiAutomation.clickElement`: Click actions
   - `aiAutomation.setProperty`: Property modification
   - `aiAutomation.readProperty`: Property reading

2. **User Interface**
   - Quick pick for provider selection
   - Input boxes for parameters
   - Webview panel for tree visualization
   - Result messages and error handling

3. **Tree Visualization**
   - Hierarchical tree display
   - Expandable/collapsible nodes
   - Property and action display
   - Interactive HTML panel

---

## Data Flow

### Tree Query Flow
```
User → Command Handler
  ↓
Ask for Provider Selection
  ↓
Ask for Target ID/Selector
  ↓
AutomationEngine.queryTree()
  ├─ Check Cache
  ├─ If Hit: Return from cache
  ├─ If Miss: Call Provider.getWindowTree()
  │   ├─ Windows Forms → .NET DLL
  │   ├─ Web UI → Playwright
  │   └─ Office → C# DLL
  ├─ Return Response
  └─ Cache Result & Log
  ↓
Display in Webview Panel
```

### Action Execution Flow
```
User → Select Action (Click/SetProperty/ReadProperty)
  ↓
Input Parameters
  ↓
AutomationEngine.executeAction()
  ├─ Validate Provider
  ├─ Call Provider Method
  ├─ Provider Executes on Target
  ├─ Collect Result
  └─ Log Action
  ↓
Display Result to User
```

---

## Caching Strategy

### LRU Cache Implementation
```
┌─────────────────────────────────────────┐
│  Caching Layer (Max 100 items)          │
├─────────────────────────────────────────┤
│                                          │
│  Key: "provider:targetId"                │
│  Value: UIObject                         │
│                                          │
│  Eviction: LRU when full                 │
│  Clear: Manual or on cache overflow      │
│                                          │
└─────────────────────────────────────────┘
```

**Benefits:**
- Reduces provider calls for repeated queries
- Improves response time
- Minimizes DLL/COM interop overhead
- Automatic management with size limits

**Cache Key Format:**
```
"windows-forms:form_main"
"office-excel:workbook_main"
"web-ui:#main-form"
```

---

## Error Handling

### Error Categories

1. **Provider Errors**
   - Provider not found
   - Provider unavailable
   - Invalid provider operations

2. **Target Errors**
   - Window/document not found
   - Element not found
   - Invalid selector syntax

3. **Operation Errors**
   - Property not supported
   - Action failed
   - Invalid parameters

4. **System Errors**
   - DLL load failure
   - COM initialization failure
   - Browser launch failure

### Error Propagation
```
Provider Exception
    ↓
Caught by Engine
    ↓
Logged
    ↓
Converted to ActionResult or thrown
    ↓
Handled by Extension Command
    ↓
Displayed to User
```

---

## Testing Strategy

### Test Coverage

**Unit Tests:**
- Provider initialization and availability
- Tree query with depth control
- Element interaction methods
- Property read/write operations

**Integration Tests:**
- Engine routing to providers
- Cache behavior
- Log recording
- Error handling

**Test Execution:**
```bash
npm test              # Run all tests
npm test -- --watch  # Watch mode
npm test -- --coverage  # Coverage report
```

---

## Performance Characteristics

### Latency
| Operation | Time | Notes |
|-----------|------|-------|
| Query (cached) | ~1ms | Memory lookup |
| Query (Windows Forms) | ~50-100ms | DLL call overhead |
| Query (Web UI, shallow) | ~100-500ms | Browser evaluation |
| Query (Office) | ~200-1000ms | COM interop overhead |
| Click Action | ~50-200ms | Varies by target |
| Property Read/Write | ~50-200ms | Varies by target |

### Memory Usage
- Base Engine: ~5MB
- Per cached object: ~10-50KB
- Max cache (100 items): ~5MB
- Logs (1000 entries): ~2MB
- **Total: ~12-20MB typical**

---

## Extensibility Points

### Adding a New Provider

```typescript
// 1. Create provider class
export class NewTargetProvider implements IAutomationProvider {
  async getWindowTree(id: string, options?: QueryOptions): Promise<UIObject> {
    // Implementation
  }

  async clickElement(elementId: string): Promise<ActionResult> {
    // Implementation
  }

  async setProperty(elementId: string, property: string, value: any): Promise<ActionResult> {
    // Implementation
  }

  async readProperty(elementId: string, property: string): Promise<any> {
    // Implementation
  }
}

// 2. Register in AutomationEngine
this.providers.set('new-target', new NewTargetProvider());
```

### Adding a New Command

```typescript
// In extension.ts activate()
let newCommand = vscode.commands.registerCommand(
  'aiAutomation.newFeature',
  async () => {
    // Command implementation
  }
);
context.subscriptions.push(newCommand);
```

---

## Security Considerations

### Current Implementation
- Mock data only (no real automation)
- No authentication required
- No request validation beyond basic checks

### Production Considerations
1. **Action Validation**
   - Whitelist allowed operations
   - Prevent destructive actions
   - Validate target applications

2. **Access Control**
   - Authenticate user requests
   - Restrict to approved documents
   - Audit sensitive operations

3. **Sandboxing**
   - Run automation in isolated context
   - Limit system resource access
   - Monitor resource consumption

---

## Deployment

### Development Build
```bash
npm run compile
npm run watch  # For live development
```

### Production Build
```bash
npm run compile
npm run vscode:prepublish  # Optimize for publishing
```

### Distribution
```bash
vsce package  # Create .vsix file
vsce publish  # Publish to VS Code Marketplace
```

---

## Future Roadmap

### Phase 1: Foundation ✓
- Core API design
- Provider pattern implementation
- Basic automation capabilities

### Phase 2: Production Ready
- .NET DLL implementation
- Office COM integration
- Security and validation

### Phase 3: AI Integration
- JSON-RPC protocol
- Context optimization
- Multi-step orchestration

### Phase 4: Advanced Features
- Screenshot capture
- Visual element highlighting
- Machine learning for element detection
- Parallel operation support

---

## Glossary

| Term | Definition |
|------|-----------|
| **Provider** | Module implementing automation for specific target type |
| **UIObject** | Hierarchical representation of UI element |
| **Target** | Application being automated (Win Forms, Excel, etc.) |
| **Action** | Operation on UI element (click, set value, read value) |
| **Tree Query** | Request to retrieve hierarchy from target application |
| **Depth** | Maximum nesting level in returned tree |
| **Cache** | Storage of frequently accessed objects |
| **Log** | Record of executed actions for audit trail |

