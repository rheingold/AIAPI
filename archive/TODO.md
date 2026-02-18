# Project TODO List

## Platform Support Expansion

### Binary Naming Convention
Following the pattern: `Key{Platform}.exe` or `{Feature}{Platform}.exe`

**Automation Binaries (Key* series):**
- [x] `KeyWin.exe` - Windows UI automation (completed)
- [ ] `KeyMac` - macOS UI automation
- [ ] `KeyLin` - Linux UI automation (X11/Wayland)

**Office Automation Binaries (Off* series):**
- [ ] `OffWin.exe` - Microsoft Office automation on Windows
- [ ] `OffLibreWin.exe` - LibreOffice automation on Windows
- [ ] `OffLibreLin` - LibreOffice automation on Linux

**Browser Automation Binaries (Brow* series):**
- [ ] `BrowWin.exe` - Browser automation on Windows (CDP/WebDriver)
- [ ] `BrowMac` - Browser automation on macOS
- [ ] `BrowLin` - Browser automation on Linux

---

## Feature Enhancements

### 1. ChatScripts - Reusable Task Definitions

**Goal:** Enable users to define and save complex automation workflows without repeatedly querying window topology or prompting AI step-by-step.

**Concept:**
- **Saved by user (custom)**: Users can record/save their own automation sequences
- **Preset scripts**: Provide common task templates out-of-the-box
- **Natural language descriptions**: Scripts include human-readable task descriptions
- **Parameterization**: Scripts can accept variables (e.g., "Open file {filename} in Notepad")

**Use Cases:**
- "Open Calculator, calculate 25% tip on {amount}, copy result"
- "Create new Word document, insert template {template_name}, save as {filename}"
- "Search for {query} in browser, capture first 3 results"

**Implementation Ideas:**
```json
{
  "chatScript": {
    "name": "Calculate Tip",
    "description": "Open calculator and compute tip percentage",
    "parameters": {
      "amount": {"type": "number", "description": "Bill amount"},
      "tipPercent": {"type": "number", "default": 15}
    },
    "steps": [
      {"action": "launch", "executable": "calc.exe"},
      {"action": "findWindow", "processName": "calc"},
      {"action": "sendKeys", "keys": "{amount}*{tipPercent}%="},
      {"action": "readText", "storeAs": "tipAmount"},
      {"action": "close"}
    ]
  }
}
```

**Storage:**
- User scripts: `~/.aiapi/chatscripts/user/`
- Preset scripts: `~/.aiapi/chatscripts/presets/`
- JSON format with versioning support

**Benefits:**
- Reduce repetitive AI prompting
- Faster execution (no topology discovery needed)
- Consistent behavior across sessions
- Shareable between users/teams

---

### 2. AppStructs - Application Structure Metadata

**Goal:** Maintain rich metadata about application UI structures to enable intelligent automation without constant re-discovery.

**Concept:**
- **Saved from first discovery**: Cache window topology after initial query
- **Pre-existing definitions**: Ship with known app structures (Calculator, Notepad, Office)
- **Combinable/layered**: Multiple files can describe different aspects:
  - Generic structure (works for all versions)
  - Specific for subversion/build (e.g., Windows Calculator version 10.x vs 11.x)
  - User-configured workspaces (custom toolbars, plugins)
- **Website cache**: Dedicated folder for web app structures
- **Version management**: Track multiple versions over time
- **Context explanations**: Natural language + token vectors for AI consumption

**File Structure:**
```
~/.aiapi/appstructs/
  ├── generic/
  │   ├── calculator.json          # Universal Calculator structure
  │   ├── notepad.json             # Universal Notepad structure
  │   └── office-word.json         # Generic Word structure
  ├── specific/
  │   ├── calculator-win11.json    # Windows 11 specific
  │   ├── calculator-win10.json    # Windows 10 specific
  │   └── vscode-1.85.json         # VS Code 1.85.x specific
  ├── user/
  │   ├── myide-workspace.json     # User's IDE customization
  │   └── browser-extensions.json  # Browser with specific extensions
  └── websites/
      ├── github.com-v2024.json    # GitHub UI structure
      ├── stackoverflow.com.json   # StackOverflow structure
      └── gmail.com-2024-02.json   # Gmail (February 2024 version)
```

**AppStruct JSON Format:**
```json
{
  "appstruct": {
    "name": "Windows Calculator",
    "version": "10.2103.8.0",
    "platform": "Windows 11",
    "type": "native",
    "contexts": {
      "natural": [
        "Scientific calculator with standard operations",
        "Contains number pad (0-9), operators (+,-,*,/), equals button",
        "Top display shows current calculation",
        "Mode switcher allows Standard, Scientific, Programmer views"
      ],
      "tokenVectors": {
        "model": "text-embedding-ada-002",
        "vectors": [
          [0.012, -0.034, 0.056, "..."]
        ]
      }
    },
    "hierarchy": {
      "root": {
        "automationId": "CalculatorWindow",
        "className": "Windows.UI.Core.CoreWindow",
        "children": [
          {
            "automationId": "NumberPad",
            "buttons": [
              {"name": "Zero", "automationId": "num0Button", "position": {"x": 50, "y": 400}},
              {"name": "One", "automationId": "num1Button", "position": {"x": 50, "y": 350}}
            ]
          },
          {
            "automationId": "OperatorPanel",
            "buttons": [
              {"name": "Plus", "automationId": "plusButton"},
              {"name": "Equals", "automationId": "equalButton"}
            ]
          }
        ]
      }
    },
    "metadata": {
      "discoveredAt": "2026-02-15T10:30:00Z",
      "discoveredBy": "user",
      "lastVerified": "2026-02-15T14:22:00Z",
      "confidence": 0.95
    }
  }
}
```

**Combining Multiple AppStructs:**
1. Load generic structure (base)
2. Apply specific version overrides (if OS/version matches)
3. Apply user customizations (if present)
4. Result: Complete, accurate structure for current environment

**Website-Specific Features:**
- Retrieve from website if `/.well-known/appstruct.json` exists
- Support versioning: `appstruct-v1.2.json`, `appstruct-latest.json`
- Semantic versioning for compatibility checks

**Context Formats:**
- **Natural language**: Human-readable descriptions for LLM consumption
- **Token vectors**: Pre-computed embeddings for specific neural networks
- **Standard formats**: Support multiple NN architectures (OpenAI, Anthropic, custom)
- **Contextual hints**: Common workflows, keyboard shortcuts, accessibility info

**Benefits:**
- Dramatically faster automation (no discovery phase)
- Offline operation (cached structures)
- Version-aware automation (adapt to app updates)
- AI-optimized (pre-computed embeddings save tokens)
- Shareable knowledge base (community-contributed structures)

**Implementation Priorities:**
1. Define AppStruct JSON schema
2. Build discovery tool (scan app, generate AppStruct)
3. Implement layering/combination logic
4. Create preset library (common apps)
5. Add website retrieval support
6. Integrate with ScenarioReplayer

---

## Implementation Notes

**Next Steps:**
1. Complete KeyWin.exe testing and documentation
2. Research macOS UI automation APIs (Accessibility API, AppleScript)
3. Research Linux automation (xdotool, ydotool, AT-SPI)
4. Design ChatScript execution engine
5. Design AppStruct schema and storage format
6. Prototype AppStruct discovery tool

**Dependencies:**
- ChatScripts depend on stable automation binaries
- AppStructs enhance ChatScripts with UI intelligence
- Both features benefit from multi-platform support

---

**Last Updated:** 2026-02-15
