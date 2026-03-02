# UI Element Identification Best Practices

## Overview

When automating Windows UI applications, **how you identify elements** is critical for creating stable, maintainable automation scripts. This guide explains the priority order and best practices.

---

## Identifier Priority (Best to Worst)

### 1. ✅ **AutomationId** (RECOMMENDED)
```javascript
// KeyWin output: element.id = "num4Button"
elementId: '{CLICKID:num4Button}'
```

**Pros:**
- ✅ Stable across app versions
- ✅ Stable across localizations (EN/CS/DE)
- ✅ Unique within a window
- ✅ Designed specifically for automation

**Cons:**
- ⚠️ May not be set for all controls (depends on developer)

**Use when:** Always your first choice if available

---

### 2. ⚠️ **Name** (FALLBACK ONLY)
```javascript
// KeyWin output: element.name = "Čtyři"
elementId: '{CLICKNAME:Čtyři}'
```

**Pros:**
- ✅ Usually available for most controls

**Cons:**
- ❌ Changes with localization
  - Czech: "Kalkulačka" 
  - English: "Calculator"
- ❌ May not be unique
- ❌ May change in app updates

**Use when:** ID is not available, but document the localization dependency

---

### 3. ❌ **Type** (AVOID FOR TARGETING)
```javascript
// KeyWin output: element.type = "ControlType.Button"
```

**Pros:**
- ✅ Always available

**Cons:**
- ❌ Not unique (many buttons have same type)
- ❌ Cannot be used alone for targeting

**Use when:** Only for filtering or querying, never for direct targeting

---

### 4. ❌ **Position** (NEVER USE)
```javascript
// element.position = {x: 100, y: 200}
```

**Cons:**
- ❌ Changes with window size
- ❌ Changes with screen resolution
- ❌ Changes with DPI settings
- ❌ Completely unreliable

**Use when:** Never for targeting, only for visual validation

---

## Window Identification

### ✅ **HANDLE:** Prefix (RECOMMENDED)
```javascript
targetId: 'HANDLE:7931232'
```

**Pros:**
- ✅ Direct window handle lookup
- ✅ Fastest method
- ✅ No ambiguity

**Cons:**
- ⚠️ Transient (changes on app restart)
- ⚠️ Cannot be saved in scenarios

**Use when:** In live automation scripts, obtained from `listWindows()`

---

### ✅ **Process Name** (RECOMMENDED FOR SCENARIOS)
```javascript
targetId: 'CalculatorApp'
targetId: 'notepad'
```

**Pros:**
- ✅ Stable across sessions
- ✅ Simple and readable
- ✅ Works with multiple windows (finds first match)

**Cons:**
- ⚠️ May match wrong window if multiple instances
- ⚠️ Slightly slower than HANDLE

**Use when:** In saved scenarios, for general targeting

---

### ⚠️ **PID:** Prefix (AVOID)
```javascript
targetId: 'PID:12345'
```

**Cons:**
- ❌ Transient (changes every launch)
- ❌ Cannot be used in saved scenarios
- ❌ No advantages over HANDLE

**Use when:** Debugging only

---

## Practical Examples

### Example 1: Click Calculator Button by ID
```javascript
// ✅ BEST: Using AutomationId
await mcpCall('clickElement', {
  providerName: 'windows-forms',
  elementId: 'HANDLE:7931232:{CLICKID:num4Button}'
});

// ⚠️ ACCEPTABLE: Using Name (if ID not available)
await mcpCall('clickElement', {
  providerName: 'windows-forms',
  elementId: 'CalculatorApp:{CLICKNAME:Čtyři}'
});

// ❌ BAD: Sending keystrokes (fragile, timing-dependent)
await mcpCall('clickElement', {
  providerName: 'windows-forms',
  elementId: 'CalculatorApp:4'
});
```

---

### Example 2: Query UI Tree
```javascript
// ✅ BEST: Using handle from listWindows()
const windows = await mcpCall('listWindows', { providerName: 'windows-forms' });
const calc = windows.data.find(w => w.processName.includes('Calc'));

const tree = await mcpCall('queryTree', {
  providerName: 'windows-forms',
  targetId: `HANDLE:${calc.handle}`,
  options: { depth: 5 }
});

// Then find elements by ID
const num4Button = findElementById(tree.data, 'num4Button');
```

---

### Example 3: Read Property from Specific Element
```javascript
// ✅ BEST: Using element ID to read specific control
await mcpCall('readProperty', {
  providerName: 'windows-forms',
  elementId: 'HANDLE:7931232:CalculatorResults',
  propertyName: 'Name'
});

// ❌ BAD: Reading from window (gets window title, not display value)
await mcpCall('readProperty', {
  providerName: 'windows-forms',
  elementId: 'CalculatorApp',
  propertyName: 'Text'
});
```

---

## Dashboard Visualization

The dashboard UI tree browser now highlights identifiers by priority:

```
▼ ControlType.Button [ID: num4Button] Čtyři
                     ↑                ↑
                 PRIMARY ID       SECONDARY NAME
                 (green badge)    (gray text)
```

- **Green badge**: AutomationId - use this in scripts
- **Gray text**: Name - fallback if ID not available
- **Gray small**: Type - for reference only

---

## Updated Test Script

See `test-calculator-with-ids.js` for a complete example demonstrating:
1. Launching Calculator
2. Finding window handle
3. Querying UI tree
4. Finding elements by ID
5. Clicking buttons using {CLICKID:xxx}
6. Reading results from specific elements

---

## Migration Guide

### Old Style (Keystroke-based)
```javascript
// ❌ Fragile - depends on focus, timing, keyboard layout
await mcpCall('clickElement', {
  providerName: 'windows-forms',
  elementId: 'CalculatorApp:4*8='
});
```

### New Style (ID-based)
```javascript
// ✅ Stable - directly targets specific controls
await mcpCall('clickElement', {
  providerName: 'windows-forms',
  elementId: 'HANDLE:7931232:{CLICKID:num4Button}'
});
await mcpCall('clickElement', {
  providerName: 'windows-forms',
  elementId: 'HANDLE:7931232:{CLICKID:multiplyButton}'
});
await mcpCall('clickElement', {
  providerName: 'windows-forms',
  elementId: 'HANDLE:7931232:{CLICKID:num8Button}'
});
await mcpCall('clickElement', {
  providerName: 'windows-forms',
  elementId: 'HANDLE:7931232:{CLICKID:equalButton}'
});
```

---

## Summary

| Identifier | Stability | Uniqueness | Localization | Priority | Use Case |
|------------|-----------|------------|--------------|----------|----------|
| **AutomationId** | ✅ Excellent | ✅ Unique | ✅ Stable | 1st | Always use when available |
| **Name** | ⚠️ Medium | ⚠️ Maybe | ❌ Changes | 2nd | Fallback only, document locale |
| **Type** | ✅ Excellent | ❌ Not unique | ✅ Stable | - | Filtering/querying only |
| **Position** | ❌ Volatile | ❌ Not unique | ❌ Changes | - | Never for targeting |
| **HANDLE:** | ⚠️ Session only | ✅ Unique | ✅ N/A | 1st | Live scripts |
| **Process Name** | ✅ Excellent | ⚠️ First match | ✅ Stable | 2nd | Saved scenarios |
| **PID:** | ❌ Transient | ✅ Unique | ✅ N/A | - | Debugging only |

---

**Remember**: The goal is to write automation that works across:
- ✅ Different Windows versions
- ✅ Different app versions  
- ✅ Different languages/locales
- ✅ Different screen resolutions
- ✅ App restarts and window repositioning

**Always prefer AutomationId when available!**
