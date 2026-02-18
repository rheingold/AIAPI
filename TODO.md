# TODO - Next Development Phase

## 🎯 Browser Automation
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

## 📄 MS Office Automation
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
1. **Phase 1:** BrowserWin.exe with Edge/Chrome support
2. **Phase 2:** OfficeWin.exe with Word support
3. **Phase 3:** Excel and PowerPoint support
4. **Phase 4:** Firefox and Brave browser support
5. **Phase 5:** Advanced features (screenshots, complex DOM queries)

---

## ✅ Completed (Current State)
- [x] KeyWin.exe for Windows Forms automation
- [x] Calculator automation working end-to-end
- [x] Dashboard with Raw Mode
- [x] Session token authentication
- [x] Logging system unified
- [x] Git repository created and pushed
