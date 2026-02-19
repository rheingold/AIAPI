# TODO - Next Development Phase

## 🔐 Security & Configuration UI (PRIORITY 1)
**Goal:** User-friendly configuration and security management

### Testing Strategy
- [ ] **Unit Tests**: All backend services and utilities
- [ ] **Integration Tests**: MCP server endpoints, security checks
- [ ] **UI Tests**: Dashboard using AIAPI itself (dogfooding!)
  - [ ] Test configuration UI by automating browser interactions
  - [ ] Test scenario editor by creating/editing scenarios
  - [ ] Test security filters by modifying settings
  - [ ] Validate forms using DOM queries
- [ ] **End-to-End Tests**: Full workflows from UI to execution
- [ ] **Security Tests**: Penetration testing, token validation
- [ ] **Performance Tests**: Load testing, memory leaks

### Configuration UI
- [ ] Create web-based configuration interface
- [ ] Settings Management:
  - [ ] Location of scenarios folder (default: `./scenarios`)
  - [ ] Location of security folder (default: `./security`)
  - [ ] Location of key files (public.key.enc, private.key.enc)
  - [ ] Server ports (MCP, Dashboard)
  - [ ] Session token expiry settings
  - [ ] Log level configuration
  - [ ] Enable/disable security features
- [ ] Security Filters Configuration:
  - [ ] Visual editor for `.json` config security filters
  - [ ] Allowed executables list
  - [ ] Blocked executables list
  - [ ] Allowed file paths (whitelist)
  - [ ] Blocked file paths (blacklist)
  - [ ] Network restrictions
  - [ ] OS enforcement rules
- [ ] File Browser:
  - [ ] Browse for scenario files
  - [ ] Browse for key files
  - [ ] Browse for config files
- [ ] Validation:
  - [ ] Check if paths exist
  - [ ] Validate key file integrity
  - [ ] Test security configuration
  - [ ] Preview effective permissions

### Interactive Scenario Editor
- [ ] Visual scenario builder (no syntax knowledge required)
- [ ] Features:
  - [ ] Drag-and-drop step builder
  - [ ] IntelliSense-style autocomplete for:
    - [ ] Action types (launchProcess, clickElement, sendKeys, etc.)
    - [ ] Parameter names
    - [ ] Valid parameter values
  - [ ] Context-aware suggestions:
    - [ ] Available providers
    - [ ] Target process names from running apps
    - [ ] Element IDs from queried UI trees
  - [ ] Step templates:
    - [ ] Common patterns (open app, fill form, etc.)
    - [ ] Parameterized templates
  - [ ] Real-time validation:
    - [ ] Required parameters highlighted
    - [ ] Type checking
    - [ ] Dependency validation (e.g., target must be launched first)
  - [ ] Live preview:
    - [ ] JSON output preview
    - [ ] Execution flow visualization
  - [ ] Test runner:
    - [ ] Run individual steps
    - [ ] Debug mode with breakpoints
    - [ ] Variable inspection
- [ ] UI Components:
  - [ ] Action palette (searchable list of all actions)
  - [ ] Parameter forms (type-specific inputs)
  - [ ] Step reordering (drag handles)
  - [ ] Copy/paste/duplicate steps
  - [ ] Undo/redo support
- [ ] Integration:
  - [ ] Save/load from scenarios folder
  - [ ] Import existing .json scenarios
  - [ ] Export to .json format
  - [ ] Version control friendly output

### Installer & Deployment
- [ ] Windows Installer:
  - [ ] MSI installer package
  - [ ] Install to Program Files
  - [ ] Create Start Menu shortcuts
  - [ ] Desktop shortcuts (optional)
  - [ ] Windows Service installation (optional)
  - [ ] Automatic security setup wizard
  - [ ] Generate key files on first run
  - [ ] Sign config.json automatically
- [ ] Installer Features:
  - [ ] Select installation directory
  - [ ] Choose components (server, dashboard, tools)
  - [ ] Port configuration during install
  - [ ] Create Windows Firewall rules
  - [ ] Register file associations (.aiapi-scenario)
  - [ ] Add to PATH (optional)
- [ ] Uninstaller:
  - [ ] Clean removal of all files
  - [ ] Option to keep scenarios and config
  - [ ] Remove firewall rules
  - [ ] Remove service
- [ ] Auto-updater:
  - [ ] Check for updates on startup
  - [ ] Download and install updates
  - [ ] Backup before update
  - [ ] Rollback on failure

### Dashboard Enhancements
- [ ] Add "Settings" tab with configuration UI
- [ ] Add "Scenario Editor" tab
- [ ] Add "Security" tab:
  - [ ] View current security config
  - [ ] Edit security filters
  - [ ] Test security rules
  - [ ] View security logs/violations
- [ ] Add "Status" indicators:
  - [ ] Security status (enabled/disabled, valid keys)
  - [ ] Key expiry warnings
  - [ ] Configuration issues

---

## 🎯 Browser Automation (PRIORITY 2)
**Goal:** Control web browsers with DOM structure access

### BrowserWin.exe Helper
- [ ] Create `tools/browser/BrowserWin.cs`
- [ ] Support multiple browsers:
  - [ ] Microsoft Edge (Chromium)
  - [ ] Google Chrome
  - [ ] Brave Browser
  - [ ] Mozilla Firefox
- [ ] Core Features:
  - [ ] Navigate to URL
  - [ ] Query DOM tree (XPath, CSS selectors)
  - [ ] Click elements by selector
  - [ ] Fill input fields
  - [ ] Execute JavaScript
  - [ ] Get/Set element properties
  - [ ] Take screenshots
  - [ ] Handle alerts/popups
  - [ ] Cookie management
- [ ] Integration:
  - [ ] Use Chrome DevTools Protocol (CDP) for Chromium browsers
  - [ ] Use Selenium WebDriver for Firefox fallback
  - [ ] Session token authentication
  - [ ] JSON output format matching KeyWin.exe

### WebUIProvider Enhancement
- [ ] Update `src/providers/webUIProvider.ts` to use BrowserWin.exe
- [ ] Add browser selection (edge, chrome, brave, firefox)
- [ ] DOM tree querying with depth control
- [ ] Element interaction via selectors
- [ ] JavaScript execution capability
- [ ] Screenshot capture

### Test Scenarios
- [ ] `scenarios/browser-google-search.json`
- [ ] `scenarios/browser-form-fill.json`
- [ ] `scenarios/browser-dom-navigation.json`

---

## 📄 MS Office Automation (PRIORITY 3)
**Goal:** Control Word, Excel, PowerPoint with document structure access

### OfficeWin.exe Helper
- [ ] Create `tools/office/OfficeWin.cs`
- [ ] Support MS Office applications:
  - [ ] Microsoft Word
  - [ ] Microsoft Excel
  - [ ] Microsoft PowerPoint
- [ ] Word Features:
  - [ ] Open/Create documents
  - [ ] Query document structure (paragraphs, tables, headings)
  - [ ] Insert/Modify text
  - [ ] Apply formatting (bold, italic, styles)
  - [ ] Table manipulation
  - [ ] Find/Replace text
  - [ ] Save as various formats (docx, pdf)
- [ ] Excel Features:
  - [ ] Open/Create workbooks
  - [ ] Query worksheets and cells
  - [ ] Read/Write cell values
  - [ ] Apply formulas
  - [ ] Format cells (colors, borders, fonts)
  - [ ] Charts creation
  - [ ] Named ranges
- [ ] PowerPoint Features:
  - [ ] Open/Create presentations
  - [ ] Query slide structure
  - [ ] Add/Modify slides
  - [ ] Insert text, images, shapes
  - [ ] Apply themes/layouts
  - [ ] Slide transitions
- [ ] Integration:
  - [ ] Use Office Interop APIs
  - [ ] COM automation
  - [ ] Session token authentication
  - [ ] JSON output format

### OfficeProvider Enhancement
- [ ] Update `src/providers/officeProvider.ts` to use OfficeWin.exe
- [ ] Application selection (word, excel, powerpoint)
- [ ] Document structure querying
- [ ] Content manipulation
- [ ] Format operations
- [ ] File operations (open, save, export)

### Test Scenarios
- [ ] `scenarios/word-document-edit.json`
- [ ] `scenarios/excel-data-entry.json`
- [ ] `scenarios/powerpoint-slide-creation.json`

---

## 🔧 Infrastructure Updates

### Build System
- [ ] Update `scripts/build-win-tools.ps1`:
  - [ ] Build BrowserWin.exe
  - [ ] Build OfficeWin.exe
  - [ ] Copy to dist/browser/ and dist/office/
- [ ] Add package references:
  - [ ] Selenium.WebDriver
  - [ ] Microsoft.Office.Interop.Word
  - [ ] Microsoft.Office.Interop.Excel
  - [ ] Microsoft.Office.Interop.PowerPoint

### MCP Server
- [ ] Update `src/server/mcpServer.ts`:
  - [ ] Add browser control tools
  - [ ] Add office control tools
- [ ] Update tool schemas for browser/office operations

### Documentation
- [ ] Create `BROWSER_API.md`
- [ ] Create `OFFICE_API.md`
- [ ] Update `API.md` with new tools
- [ ] Add examples to `QUICK_REF.md`

---

## 📋 Implementation Priority
1. **PRIORITY 1 - Security & Config UI:**
   - a) Configuration UI for paths and settings
   - b) Security filters visual editor
   - c) Interactive scenario editor with IntelliSense
   - d) Windows installer with auto-setup
2. **PRIORITY 2 - Browser Automation:**
   - a) BrowserWin.exe with Edge/Chrome support
   - b) DOM structure access and manipulation
   - c) Test scenarios
3. **PRIORITY 3 - Office Automation:**
   - a) OfficeWin.exe with Word support
   - b) Excel and PowerPoint support
   - c) Document structure queries
4. **PRIORITY 4 - Advanced Features:**
   - a) Firefox and Brave browser support
   - b) Screenshots and video recording
   - c) Complex DOM/document queries
   - d) AI-assisted scenario generation

---

## ✅ Completed (Current State)
- [x] KeyWin.exe for Windows Forms automation
- [x] Calculator automation working end-to-end
- [x] Dashboard with Raw Mode
- [x] Session token authentication
- [x] Logging system unified
- [x] Git repository created and pushed
