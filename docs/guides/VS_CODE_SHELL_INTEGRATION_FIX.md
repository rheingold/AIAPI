# VSCode Shell Integration Security Warning Fix

## Problem Description

You're encountering a security warning in VSCode when shell integration tries to execute the `shellIntegration.ps1` script. This occurs because PowerShell is blocking unsigned scripts from running, even though the main execution policy is set correctly.

## Root Cause

The warning appears because VSCode's shell integration feature attempts to run its own PowerShell script (`shellIntegration.ps1`) which is not signed or trusted by your system's security policies, even though the execution policy allows unsigned scripts in general.

## Solutions

### Solution 1: Unblock the Shell Integration Script (Recommended)

1. Open Windows Explorer
2. Navigate to: `D:\plachy\Dokumenty\Dev\_ToolsVSC\f6cfa2ea24\resources\app\out\vs\workbench\contrib\terminal\common\scripts\`
3. Right-click on `shellIntegration.ps1`
4. Select "Properties"
5. At the bottom of the Properties dialog, click "Unblock" if you see an "Unblock" button
6. Click "OK"

### Solution 2: Temporarily Bypass for Current Session

If you're in a PowerShell terminal and see this warning, you can:

1. Type `R` to run once (if you trust the script)
2. Or use the PowerShell command: `Set-ExecutionPolicy -Scope Process -ExecutionPolicy RemoteSigned`

### Solution 3: Disable Shell Integration Temporarily

If you don't need shell integration features:

1. Open VSCode settings (`Ctrl+,`)
2. Search for "shell integration"
3. Disable the setting: `Terminal > Integrated > Shell Integration: Enabled`
4. Restart VSCode

### Solution 4: Configure VSCode to Use a Different Terminal Profile

Update your `.vscode/settings.json` with:

```json
{
    "terminal.integrated.profiles.windows": {
        "PowerShell": {
            "path": "PowerShell.exe",
            "args": ["-ExecutionPolicy", "Bypass"]
        }
    },
    "terminal.integrated.defaultProfile.windows": "PowerShell"
}
```

This approach ensures all PowerShell terminals use bypass policy.

## Security Considerations

- The `shellIntegration.ps1` script is part of VSCode's built-in functionality and is generally safe
- Unblocking it is the safest approach if you trust VSCode
- The shell integration provides enhanced terminal features like command detection, prompt parsing, and better integration with VSCode features

## Verification

After applying any fix:
1. Open a new PowerShell terminal in VSCode (`Ctrl+`` `)
2. Verify that no security warnings appear
3. Test running basic commands without interruption

## Alternative for Development Environments

If you're working in a restricted development environment, consider:
- Creating a script to automatically unblock VSCode's shell integration scripts
- Using a PowerShell profile that sets the appropriate execution policy for your session