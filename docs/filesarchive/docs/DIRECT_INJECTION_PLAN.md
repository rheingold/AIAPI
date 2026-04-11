# Direct Input Injection Implementation Plan

## Problem
Current implementation:
1. Focuses window with `SetForegroundWindow()`
2. Sends keys via `SendKeys.SendWait()` to the **active window**
3. Race condition: another window could steal focus between steps 1-2
4. Mouse clicks via `SendInput()` go to system-wide queue

## Solution: Direct Window Message Injection

### Keyboard Input
Instead of `SendKeys.SendWait()`, use:
- **`PostMessage(hwnd, WM_KEYDOWN, virtualKey, lParam)`**
- **`PostMessage(hwnd, WM_CHAR, charCode, lParam)`**
- **`PostMessage(hwnd, WM_KEYUP, virtualKey, lParam)`**

This sends keyboard messages **directly to the target window's message queue**, bypassing focus entirely.

### Mouse Input
Instead of `SetCursorPos() + SendInput()`, use:
- **`PostMessage(hwnd, WM_LBUTTONDOWN, MK_LBUTTON, MAKELPARAM(x, y))`**
- **`PostMessage(hwnd, WM_LBUTTONUP, 0, MAKELPARAM(x, y))`**

Coordinates are **window-relative**, not screen coordinates!

### Implementation Steps

1. **Add P/Invoke declarations**:
```csharp
[DllImport("user32.dll", CharSet = CharSet.Auto)]
static extern IntPtr SendMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);

[DllImport("user32.dll", CharSet = CharSet.Auto)]
static extern bool PostMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);

[DllImport("user32.dll")]
static extern bool ScreenToClient(IntPtr hWnd, ref POINT lpPoint);

[DllImport("user32.dll")]
static extern short VkKeyScan(char ch);

[StructLayout(LayoutKind.Sequential)]
public struct POINT {
    public int X;
    public int Y;
}
```

2. **Define Windows Messages**:
```csharp
const uint WM_KEYDOWN = 0x0100;
const uint WM_KEYUP = 0x0101;
const uint WM_CHAR = 0x0102;
const uint WM_LBUTTONDOWN = 0x0201;
const uint WM_LBUTTONUP = 0x0202;
const uint WM_RBUTTONDOWN = 0x0204;
const uint WM_RBUTTONUP = 0x0205;
const uint MK_LBUTTON = 0x0001;
```

3. **Implement DirectSendKeys()**:
```csharp
static void DirectSendKeys(IntPtr hwnd, string text)
{
    foreach (char c in text)
    {
        // For simple alphanumeric
        if (char.IsLetterOrDigit(c) || char.IsPunctuation(c))
        {
            short vk = VkKeyScan(c);
            byte virtualKey = (byte)(vk & 0xFF);
            byte shiftState = (byte)(vk >> 8);
            
            // Handle shift modifier
            if ((shiftState & 1) != 0)
            {
                PostMessage(hwnd, WM_KEYDOWN, (IntPtr)0x10, IntPtr.Zero); // VK_SHIFT
            }
            
            PostMessage(hwnd, WM_KEYDOWN, (IntPtr)virtualKey, IntPtr.Zero);
            PostMessage(hwnd, WM_CHAR, (IntPtr)c, IntPtr.Zero);
            PostMessage(hwnd, WM_KEYUP, (IntPtr)virtualKey, IntPtr.Zero);
            
            if ((shiftState & 1) != 0)
            {
                PostMessage(hwnd, WM_KEYUP, (IntPtr)0x10, IntPtr.Zero);
            }
        }
    }
}
```

4. **Implement DirectMouseClick()**:
```csharp
static void DirectMouseClick(IntPtr hwnd, int screenX, int screenY)
{
    // Convert screen coordinates to window-relative
    POINT pt = new POINT { X = screenX, Y = screenY };
    ScreenToClient(hwnd, ref pt);
    
    int lParam = (pt.Y << 16) | (pt.X & 0xFFFF);
    
    PostMessage(hwnd, WM_LBUTTONDOWN, (IntPtr)MK_LBUTTON, (IntPtr)lParam);
    System.Threading.Thread.Sleep(10);
    PostMessage(hwnd, WM_LBUTTONUP, IntPtr.Zero, (IntPtr)lParam);
}
```

### Benefits
✅ **No focus required** - window doesn't need to be active  
✅ **Race-condition free** - messages go directly to target  
✅ **Safer testing** - won't accidentally type in wrong window  
✅ **Background operation** - can work with minimized windows (depending on app)  
✅ **More reliable** - no dependency on window manager state  

### Limitations
⚠️ Some apps filter messages from `PostMessage` (security measure)  
⚠️ UWP apps may require different approach  
⚠️ Games using DirectInput won't see these messages  
⚠️ Window must still exist and be responsive  

### Hybrid Approach (Recommended)
Keep **both** methods:
- **Direct injection** (default) - safer, no focus needed
- **SendKeys/SendInput** (fallback) - for apps that filter PostMessage
- Add flag: `--use-focus-mode` to enable legacy behavior

### Special Keys Mapping
```csharp
static uint GetVirtualKeyCode(string keyName)
{
    switch (keyName.ToUpper())
    {
        case "ENTER": return 0x0D;
        case "TAB": return 0x09;
        case "ESC": case "ESCAPE": return 0x1B;
        case "BACK": case "BACKSPACE": return 0x08;
        case "DELETE": return 0x2E;
        case "LEFT": return 0x25;
        case "UP": return 0x26;
        case "RIGHT": return 0x27;
        case "DOWN": return 0x28;
        // ... etc
        default: return 0;
    }
}
```

## Implementation Order
1. ✅ Add P/Invoke declarations
2. ✅ Implement DirectSendKeys for simple text
3. ✅ Add special key handling (Enter, Tab, etc.)
4. ✅ Implement DirectMouseClick with coordinate conversion
5. ✅ Add command-line flag to choose mode
6. ✅ Test with Calculator, Notepad
7. ✅ Add fallback logic if PostMessage fails
8. ✅ Update documentation

---
**Status**: Ready to implement
**Priority**: HIGH - significant reliability improvement
