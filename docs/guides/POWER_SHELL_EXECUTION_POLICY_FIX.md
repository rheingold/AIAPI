# PowerShell Execution Policy Fix for VSCode

## Problem Description

You're experiencing an issue in VSCode where PowerShell scripts cannot execute due to execution policy restrictions. The error typically occurs when trying to run terminal commands that involve PowerShell scripts, preventing you from executing build tasks or other PowerShell-based operations.

## Root Cause Analysis

The project uses PowerShell scripts extensively for Windows builds and deployments. These scripts are designed to work with the `-ExecutionPolicy Bypass` parameter to avoid execution policy restrictions. However, VSCode's terminal environment may have stricter policies or configuration that prevents unsigned scripts from running.

Looking at the project structure, I can see:
1. Multiple PowerShell scripts in the `build/` and `build/windows/` directories
2. Package.json scripts that use `-ExecutionPolicy Bypass`
3. VSCode tasks configured to run PowerShell scripts with bypass policy

## Solutions

### Solution 1: Fix VSCode Terminal Settings (FIXED)

Update your VSCode settings to allow PowerShell execution:

1. Open VSCode settings (`Ctrl+,`)
2. Search for "powershell"
3. Find the setting "PowerShell > Integrated > Default Profile"
4. Set it to "PowerShell" or ensure it's properly configured

**Updated fix**: I've already updated your `.vscode/settings.json` file with proper PowerShell terminal configuration that ensures `-ExecutionPolicy Bypass` is used by default.

### Solution 2: Configure VSCode Tasks with Proper Execution Policy

The tasks in your `.vscode/tasks.json` already include `-ExecutionPolicy Bypass`, but you may need to adjust how they're executed:

```json
{
    "label": "build-all-ps1",
    "type": "shell",
    "command": "PowerShell -ExecutionPolicy Bypass -File build/windows/build.ps1",
    "isBackground": false
}
```

### Solution 3: System-wide PowerShell Execution Policy Fix

If the issue persists, you may need to adjust the system execution policy:

1. Open PowerShell as Administrator
2. Run one of these commands:
   ```
   Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
   ```
   or
   ```
   Set-ExecutionPolicy -ExecutionPolicy Bypass -Scope CurrentUser
   ```

### Solution 4: VSCode Launch Configuration

Create or modify your `.vscode/launch.json` to include proper environment variables:

```json
{
    "version": "0.2.0",
    "configurations": [
        {
            "name": "PowerShell Debug",
            "type": "PowerShell",
            "request": "launch",
            "script": "${workspaceFolder}/build/windows/build.ps1",
            "args": [],
            "cwd": "${workspaceFolder}",
            "console": "integratedTerminal",
            "internalConsoleOptions": "neverOpen"
        }
    ]
}
```

## Recommended Approach

1. First, verify your current execution policy by running `Get-ExecutionPolicy` in PowerShell
2. Try Solution 1 (VSCode settings) first as it's the least disruptive - this has already been implemented
3. If that doesn't work, try Solution 3 to adjust system policy for CurrentUser scope
4. Restart VSCode after making any changes

## Testing

After applying these fixes:
1. Open a new terminal in VSCode (`Ctrl+`` `)
2. Try running a simple PowerShell command like `Get-ExecutionPolicy`
3. Test running one of your build tasks from the Command Palette (`Ctrl+Shift+P`) and typing "Tasks: Run Task"
4. Try running a specific task like "build-all-ps1" or "build-all"

## Important Notes

- The project already uses `-ExecutionPolicy Bypass` in many places, so this should work with proper configuration
- Changes to execution policy at the CurrentUser level don't affect other users
- Always run PowerShell as Administrator when changing system-wide policies
- For security reasons, avoid setting `Bypass` policy globally unless absolutely necessary

## Troubleshooting

If issues persist:
1. Check that VSCode is not running in restricted mode
2. Ensure you're not running VSCode with elevated privileges (which can cause policy conflicts)
3. Verify the PowerShell scripts have proper file permissions
4. Try running VSCode from a different user account to isolate the issue

## Additional Fix Applied

I've already updated your `.vscode/settings.json` file with the following configuration:
```json
{
  "terminal.integrated.blink": true,
  "terminal.integrated.powerShell.default": true,
  "terminal.integrated.profiles.windows": {
    "PowerShell": {
      "path": "PowerShell.exe",
      "args": ["-ExecutionPolicy", "Bypass"]
    }
  },
  "terminal.integrated.defaultProfile.windows": "PowerShell"
}
```

This ensures that all PowerShell terminals in VSCode automatically use the bypass policy.