# Automation Scenario Format v1

JSON-based declarative format for Windows UI automation testing.

## Overview

Scenarios are JSON files that describe sequences of UI automation actions. They support:
- Variable substitution (`${variableName}`)
- Assertions (value checks)
- Conditional execution
- Automatic and explicit delays
- Process lifecycle management

## Schema

```json
{
  "$schema": "automation-scenario-v1",
  "name": "Scenario Name",
  "description": "What this scenario tests",
  "version": "1.0",
  "variables": {
    "varName": null
  },
  "steps": [...]
}
```

## Actions

### launchProcess
Starts a new process.

```json
{
  "action": "launchProcess",
  "params": {
    "executable": "calculator:",
    "waitSeconds": 3,
    "waitMilliseconds": 500
  }
}
```

**Params**:
- `executable` (required): Process to launch
- `waitSeconds` (optional): Explicit wait after launch (default: 2000ms)
- `waitMilliseconds` (optional): Additional milliseconds to wait

### findWindow
Finds a window by title pattern and stores its HANDLE.

```json
{
  "action": "findWindow",
  "params": {
    "titlePattern": "*Calc*|*alcul*",
    "storeAs": "windowHandle",
    "optional": false
  }
}
```

**Params**:
- `titlePattern` (required): Wildcard pattern(s), separated by `|`
- `storeAs` (required): Variable name to store HANDLE
- `optional` (optional): If true, don't fail if not found (stores null)

**Auto-delay**: 200ms after finding window

### sendKeys
Sends keyboard input to a window.

```json
{
  "action": "sendKeys",
  "params": {
    "target": "${windowHandle}",
    "keys": "Hello{ENTER}",
    "waitSeconds": 1,
    "waitMilliseconds": 500
  }
}
```

**Params**:
- `target` (required): Window HANDLE (use `${variable}`)
- `keys` (required): Keys to send (SendKeys format)
- `waitSeconds` (optional): Explicit wait after (default: 300ms)
- `waitMilliseconds` (optional): Additional milliseconds

**Special keys**: `{ENTER}`, `{ESCAPE}`, `{TAB}`, `^a` (Ctrl+A), etc.

**Default delay**: 300ms after sending keys

### readValue
Reads display text from a window.

```json
{
  "action": "readValue",
  "params": {
    "target": "${windowHandle}",
    "storeAs": "result"
  }
}
```

**Params**:
- `target` (required): Window HANDLE
- `storeAs` (required): Variable name to store value

**Auto-delay**: 100ms before reading to ensure UI is updated

### queryTree
Queries UI element tree structure.

```json
{
  "action": "queryTree",
  "params": {
    "target": "${windowHandle}",
    "depth": 3,
    "storeAs": "tree"
  }
}
```

**Params**:
- `target` (required): Window HANDLE
- `depth` (optional): Tree depth (default: 2)
- `storeAs` (optional): Variable name to store tree

**Default delay**: 200ms after query

### click
Clicks at specific coordinates.

```json
{
  "action": "click",
  "params": {
    "target": "${windowHandle}",
    "x": 250,
    "y": 300
  }
}
```

**Params**:
- `target` (required): Window HANDLE
- `x` (required): X coordinate
- `y` (required): Y coordinate

**Default delay**: 500ms after click

### clickByName
Clicks a UI element by name.

```json
{
  "action": "clickByName",
  "params": {
    "target": "${windowHandle}",
    "name": "Clear"
  }
}
```

**Params**:
- `target` (required): Window HANDLE
- `name` (required): Element name (Button name)

**Default delay**: 500ms after click

### closeProcess
Terminates processes.

```json
{
  "action": "closeProcess",
  "params": {
    "processNames": ["CalculatorApp", "ApplicationFrameHost"]
  }
}
```

**Params**:
- `processNames` (required): Process name(s) to terminate

**Default delay**: 1000ms after close

### wait
Explicit wait/delay.

```json
{
  "action": "wait",
  "params": {
    "seconds": 2,
    "milliseconds": 500
  }
}
```

**Params**:
- `seconds` (optional): Seconds to wait
- `milliseconds` (optional): Milliseconds to wait

### setVariable
Sets a variable value.

```json
{
  "action": "setVariable",
  "params": {
    "name": "myVar",
    "value": "someValue"
  }
}
```

### log
Outputs a log message.

```json
{
  "action": "log",
  "params": {
    "message": "Test checkpoint reached"
  }
}
```

## Delays

### Default Delays
The replayer applies automatic delays after operations:

| Action | Default Delay |
|--------|--------------|
| launchProcess | 2000ms |
| findWindow | 200ms |
| sendKeys | 300ms |
| click/clickByName | 500ms |
| closeProcess | 1000ms |
| queryTree | 200ms |
| readValue | 100ms (before) |

### Explicit Delays
Override defaults using `waitSeconds` and `waitMilliseconds`:

```json
{
  "action": "sendKeys",
  "params": {
    "target": "${handle}",
    "keys": "test",
    "waitSeconds": 2,
    "waitMilliseconds": 500
  }
}
```

### Step-Level Delays
Add delay after any step:

```json
{
  "action": "readValue",
  "params": {
    "target": "${handle}",
    "storeAs": "value",
    "delayAfter": {
      "seconds": 1,
      "milliseconds": 500
    }
  }
}
```

## Variables

### Declaration
Declare variables in the scenario header:

```json
{
  "variables": {
    "windowHandle": null,
    "result": null,
    "expectedValue": "42"
  }
}
```

### Substitution
Use `${variableName}` syntax:

```json
{
  "action": "sendKeys",
  "params": {
    "target": "${windowHandle}",
    "keys": "test"
  }
}
```

### Storage
Store action results:

```json
{
  "action": "findWindow",
  "params": {
    "titlePattern": "*Calc*",
    "storeAs": "calcHandle"
  }
}
```

## Assertions

### notNull
Checks variable is not null:

```json
{
  "assert": {
    "notNull": "windowHandle"
  }
}
```

### equals
Checks exact value match:

```json
{
  "assert": {
    "equals": {
      "actual": "${result}",
      "expected": "42"
    }
  }
}
```

### contains
Checks substring presence:

```json
{
  "assert": {
    "contains": {
      "value": "${text}",
      "substring": "success"
    }
  }
}
```

### greaterThan
Checks numeric comparison:

```json
{
  "assert": {
    "greaterThan": {
      "value": "${count}",
      "threshold": 0
    }
  }
}
```

## Conditional Execution

Use `condition` parameter to skip steps:

```json
{
  "action": "sendKeys",
  "params": {
    "target": "${dialog}",
    "keys": "{ENTER}",
    "condition": "dialog != null"
  }
}
```

**Supported operators**: `==`, `!=`

**Example**:
```json
"condition": "saveDialog != null"
"condition": "result == 42"
```

## Complete Example

```json
{
  "$schema": "automation-scenario-v1",
  "name": "Calculator Test",
  "description": "Tests calculator arithmetic",
  "version": "1.0",
  "variables": {
    "calcHandle": null,
    "result": null
  },
  "steps": [
    {
      "id": 1,
      "action": "launchProcess",
      "params": {
        "executable": "calculator:",
        "waitSeconds": 3
      },
      "description": "Launch Calculator"
    },
    {
      "id": 2,
      "action": "findWindow",
      "params": {
        "titlePattern": "*alcul*",
        "storeAs": "calcHandle"
      },
      "description": "Find window",
      "assert": {
        "notNull": "calcHandle"
      }
    },
    {
      "id": 3,
      "action": "sendKeys",
      "params": {
        "target": "${calcHandle}",
        "keys": "7+8=",
        "waitSeconds": 1
      },
      "description": "Calculate 7+8"
    },
    {
      "id": 4,
      "action": "readValue",
      "params": {
        "target": "${calcHandle}",
        "storeAs": "result"
      },
      "description": "Read result",
      "assert": {
        "equals": {
          "actual": "${result}",
          "expected": "15"
        }
      }
    },
    {
      "id": 5,
      "action": "closeProcess",
      "params": {
        "processNames": ["CalculatorApp", "ApplicationFrameHost"]
      },
      "description": "Cleanup"
    }
  ]
}
```

## Running Scenarios

### Direct Execution
```bash
node dist/run-scenario.js scenarios/calculator-basic.json --verbose
```

### Via MCP Server
The scenario replayer can also execute through the MCP server for integration testing.

## Best Practices

1. **Always use explicit waits** for operations that take time:
   - After launching processes (2-4 seconds)
   - After calculations (0.5-1 second)
   - After UI updates (0.3-0.5 seconds)

2. **Use HANDLE-based identification**: Store window handles with `findWindow` and reference with `${variableName}`

3. **Add assertions** after critical operations to validate results

4. **Use optional windows** for dialogs that may not appear:
   ```json
   {
     "action": "findWindow",
     "params": {
       "titlePattern": "*Save*",
       "storeAs": "saveDialog",
       "optional": true
     }
   }
   ```

5. **Clean up** by closing processes at the end:
   ```json
   {
     "action": "closeProcess",
     "params": {
       "processNames": ["app", "helper"]
     }
   }
   ```

6. **Use descriptive IDs and descriptions** for debugging

7. **Test incrementally**: Build scenarios step-by-step, not all at once

## Timing Guidelines

| Operation Type | Recommended Wait |
|----------------|------------------|
| Process launch | 2-4 seconds |
| Window search | 0.2-0.5 seconds |
| Button click | 0.3-0.5 seconds |
| Calculation | 0.5-1 second |
| Dialog appearance | 0.5-1 second |
| Process termination | 1-2 seconds |
| Text input | 0.2-0.3 seconds per action |
| UI query | 0.2-0.3 seconds |

**Note**: Modern Windows apps (UWP) typically need longer waits (3-5 seconds) after launch.

## Error Handling

When a step fails:
- Execution stops immediately
- `ScenarioResult.success` is `false`
- `ScenarioResult.failedStep` indicates which step failed
- Step error message is available in `StepResult.error`

## Future Enhancements

Planned features:
- Retry logic for flaky operations
- Screenshot capture on failure
- Loop/iteration support
- Conditional branches
- Subroutine calls
- Data-driven testing (CSV/JSON input)
