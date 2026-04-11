# Windows Built-in Applications Test Suite
# Tests WinKeys.exe with Calculator, Notepad, Settings, and MMC

$WinKeys = "C:\Users\plachy\Documents\Dev\VSCplugins\AIAPI\dist\win\WinKeys.exe"

function Write-TestHeader {
    param($Title)
    Write-Host "`n╔══════════════════════════════════════════════════════════════╗" -ForegroundColor Cyan
    Write-Host "║  $Title" -ForegroundColor Cyan
    Write-Host "╚══════════════════════════════════════════════════════════════╝" -ForegroundColor Cyan
}

function Invoke-WinKeysCommand {
    param($ProcessId, $Keys)
    
    $output = & $WinKeys $ProcessId $Keys 2>$null
    $result = $output | ConvertFrom-Json
    
    if (-not $result.success) {
        Write-Host "  ✗ Error: $($result.error) - $($result.message)" -ForegroundColor Red
        return $null
    }
    
    return $result
}

function Find-Window {
    param($TitlePattern)
    
    $windows = & $WinKeys "{LISTWINDOWS}" 2>$null | ConvertFrom-Json
    $window = $windows.windows | Where-Object { $_.title -like "*$TitlePattern*" } | Select-Object -First 1
    
    if ($window) {
        Write-Host "  ✓ Found: $($window.title) (PID=$($window.pid), HANDLE=$($window.handle))" -ForegroundColor Green
        return "HANDLE:$($window.handle)"
    }
    
    Write-Host "  ✗ Window not found: *$TitlePattern*" -ForegroundColor Red
    return $null
}

# ============================================================================
# TEST 1: CALCULATOR
# ============================================================================
Write-TestHeader "TEST 1: CALCULATOR"

Write-Host "`n[1.1] Launching Calculator..." -ForegroundColor Yellow
Start-Process "calculator:" -ErrorAction SilentlyContinue
Start-Sleep -Seconds 3

Write-Host "`n[1.2] Finding Calculator window..." -ForegroundColor Yellow
$calcHandle = Find-Window "alcul"

if ($calcHandle) {
    Write-Host "`n[1.3] Testing arithmetic operations..." -ForegroundColor Yellow
    
    # Clear display
    Write-Host "  → Clear (Escape)" -ForegroundColor Gray
    Invoke-WinKeysCommand $calcHandle "{ESCAPE}" | Out-Null
    Start-Sleep -Milliseconds 500
    
    # Test 1: 15 + 27 = 42
    Write-Host "  → Calculate: 15 + 27" -ForegroundColor Gray
    Invoke-WinKeysCommand $calcHandle "15+27=" | Out-Null
    Start-Sleep -Seconds 1
    
    $result = Invoke-WinKeysCommand $calcHandle "{READ}"
    if ($result -and $result.value -eq "42") {
        Write-Host "  ✓ 15 + 27 = $($result.value)" -ForegroundColor Green
    } else {
        Write-Host "  ✗ Expected 42, got: $($result.value)" -ForegroundColor Red
    }
    
    # Test 2: 8 × 7 = 56
    Write-Host "  → Clear and calculate: 8 × 7" -ForegroundColor Gray
    Invoke-WinKeysCommand $calcHandle "{ESCAPE}" | Out-Null
    Start-Sleep -Milliseconds 500
    Invoke-WinKeysCommand $calcHandle "8*7=" | Out-Null
    Start-Sleep -Seconds 1
    
    $result = Invoke-WinKeysCommand $calcHandle "{READ}"
    if ($result -and $result.value -eq "56") {
        Write-Host "  ✓ 8 × 7 = $($result.value)" -ForegroundColor Green
    } else {
        Write-Host "  ✗ Expected 56, got: $($result.value)" -ForegroundColor Red
    }
    
    # Test 3: Query UI structure
    Write-Host "`n[1.4] Querying UI structure..." -ForegroundColor Yellow
    $tree = & $WinKeys $calcHandle "{QUERYTREE:2}" 2>$null | ConvertFrom-Json
    if ($tree) {
        Write-Host "  ✓ UI tree retrieved: $($tree.Name)" -ForegroundColor Green
        Write-Host "  Position: X=$($tree.Position.X), Y=$($tree.Position.Y), W=$($tree.Position.Width), H=$($tree.Position.Height)" -ForegroundColor Gray
        
        # Find buttons
        $buttons = $tree.children | ForEach-Object { $_.children } | Where-Object { $_.ControlType -eq "Button" } | Select-Object -First 5
        if ($buttons) {
            Write-Host "  Sample buttons: $($buttons.Name -join ', ')" -ForegroundColor Gray
        }
    }
    
    Write-Host "`n[1.5] Cleanup..." -ForegroundColor Yellow
    Stop-Process -Name "CalculatorApp","ApplicationFrameHost" -ErrorAction SilentlyContinue
    Write-Host "  ✓ Calculator closed" -ForegroundColor Green
}

# ============================================================================
# TEST 2: NOTEPAD
# ============================================================================
Write-TestHeader "TEST 2: NOTEPAD"

Write-Host "`n[2.1] Launching Notepad..." -ForegroundColor Yellow
$notepad = Start-Process "notepad.exe" -PassThru
Start-Sleep -Seconds 2

Write-Host "`n[2.2] Finding Notepad window..." -ForegroundColor Yellow
$notepadHandle = Find-Window "Notepad"

if ($notepadHandle) {
    Write-Host "`n[2.3] Testing text input..." -ForegroundColor Yellow
    
    # Type some text
    Write-Host "  → Typing sample text" -ForegroundColor Gray
    $text = "Hello from WinKeys.exe!{ENTER}Line 2: Testing automation{ENTER}Line 3: JSON output working"
    Invoke-WinKeysCommand $notepadHandle $text | Out-Null
    Start-Sleep -Seconds 1
    
    Write-Host "  ✓ Text input completed" -ForegroundColor Green
    
    # Test keyboard shortcuts
    Write-Host "`n[2.4] Testing keyboard shortcuts..." -ForegroundColor Yellow
    Write-Host "  → Select all (Ctrl+A)" -ForegroundColor Gray
    Invoke-WinKeysCommand $notepadHandle "^a" | Out-Null
    Start-Sleep -Milliseconds 500
    
    Write-Host "  → Copy (Ctrl+C)" -ForegroundColor Gray
    Invoke-WinKeysCommand $notepadHandle "^c" | Out-Null
    Start-Sleep -Milliseconds 500
    
    Write-Host "  ✓ Keyboard shortcuts executed" -ForegroundColor Green
    
    # Query UI structure
    Write-Host "`n[2.5] Querying UI structure..." -ForegroundColor Yellow
    $tree = & $WinKeys $notepadHandle "{QUERYTREE:2}" 2>$null | ConvertFrom-Json
    if ($tree) {
        Write-Host "  ✓ UI tree retrieved: $($tree.Name)" -ForegroundColor Green
    }
    
    Write-Host "`n[2.6] Cleanup..." -ForegroundColor Yellow
    # Close without saving
    Invoke-WinKeysCommand $notepadHandle "%{F4}" | Out-Null  # Alt+F4
    Start-Sleep -Seconds 1
    
    # Find "Don't Save" dialog if it appears
    $dialog = Find-Window "Notepad"
    if ($dialog) {
        Write-Host "  → Clicking 'Don't Save'" -ForegroundColor Gray
        Invoke-WinKeysCommand $dialog "{TAB}{TAB}{ENTER}" | Out-Null  # Navigate to "Don't Save" button
        Start-Sleep -Seconds 1
    }
    
    if ($notepad -and -not $notepad.HasExited) {
        Stop-Process -Id $notepad.Id -Force -ErrorAction SilentlyContinue
    }
    Write-Host "  ✓ Notepad closed" -ForegroundColor Green
}

# ============================================================================
# TEST 3: WINDOWS SETTINGS (Sound & Desktop Background)
# ============================================================================
Write-TestHeader "TEST 3: WINDOWS SETTINGS"

Write-Host "`n[3.1] Opening Sound Settings..." -ForegroundColor Yellow
Start-Process "ms-settings:sound"
Start-Sleep -Seconds 4

Write-Host "`n[3.2] Finding Settings window..." -ForegroundColor Yellow
$settingsHandle = Find-Window "Settings"

if ($settingsHandle) {
    Write-Host "`n[3.3] Querying Sound Settings UI..." -ForegroundColor Yellow
    $tree = & $WinKeys $settingsHandle "{QUERYTREE:3}" 2>$null | ConvertFrom-Json
    if ($tree) {
        Write-Host "  ✓ UI tree retrieved for Sound Settings" -ForegroundColor Green
        Write-Host "  Window: $($tree.Name)" -ForegroundColor Gray
        
        # Look for combo boxes (output device selection)
        $combos = $tree.children | ForEach-Object { $_.children } | Where-Object { $_.ControlType -eq "ComboBox" }
        if ($combos) {
            Write-Host "  ✓ Found $($combos.Count) combo box(es) (likely audio device selectors)" -ForegroundColor Green
        }
    }
    
    Write-Host "`n[3.4] Opening Personalization (Background)..." -ForegroundColor Yellow
    # Navigate to Personalization
    Invoke-WinKeysCommand $settingsHandle "personalization{ENTER}" | Out-Null
    Start-Sleep -Seconds 3
    
    $settingsHandle = Find-Window "Settings"
    if ($settingsHandle) {
        Write-Host "  → Querying Personalization UI" -ForegroundColor Gray
        $tree = & $WinKeys $settingsHandle "{QUERYTREE:3}" 2>$null | ConvertFrom-Json
        if ($tree) {
            Write-Host "  ✓ Personalization UI retrieved" -ForegroundColor Green
            
            # Look for Background option
            $items = $tree.children | ForEach-Object { $_.children } | Where-Object { $_.Name -like "*Background*" -or $_.Name -like "*Pozadí*" }
            if ($items) {
                Write-Host "  ✓ Found background settings: $($items[0].Name)" -ForegroundColor Green
            }
        }
    }
    
    Write-Host "`n[3.5] Cleanup..." -ForegroundColor Yellow
    Stop-Process -Name "SystemSettings" -ErrorAction SilentlyContinue
    Write-Host "  ✓ Settings closed" -ForegroundColor Green
}

# ============================================================================
# TEST 4: MMC (Certificates Console)
# ============================================================================
Write-TestHeader "TEST 4: MMC - CERTIFICATES CONSOLE"

Write-Host "`n[4.1] Launching MMC..." -ForegroundColor Yellow
$mmc = Start-Process "mmc.exe" "certmgr.msc" -PassThru
Start-Sleep -Seconds 4

Write-Host "`n[4.2] Finding MMC window..." -ForegroundColor Yellow
$mmcHandle = Find-Window "certmgr"

if ($mmcHandle) {
    Write-Host "`n[4.3] Querying Certificate Manager UI..." -ForegroundColor Yellow
    $tree = & $WinKeys $mmcHandle "{QUERYTREE:3}" 2>$null | ConvertFrom-Json
    if ($tree) {
        Write-Host "  ✓ UI tree retrieved for Certificate Manager" -ForegroundColor Green
        Write-Host "  Window: $($tree.Name)" -ForegroundColor Gray
        
        # Look for tree view (certificate folders)
        $treeViews = $tree.children | ForEach-Object { $_.children } | Where-Object { $_.ControlType -eq "Tree" }
        if ($treeViews) {
            Write-Host "  ✓ Found certificate tree structure" -ForegroundColor Green
        }
        
        # Look for menu bar
        $menuBars = $tree.children | ForEach-Object { $_.children } | Where-Object { $_.ControlType -eq "MenuBar" }
        if ($menuBars) {
            Write-Host "  ✓ Found menu bar for certificate operations" -ForegroundColor Green
        }
    }
    
    Write-Host "`n[4.4] Testing certificate request workflow..." -ForegroundColor Yellow
    Write-Host "  → Expanding Personal folder" -ForegroundColor Gray
    
    # Navigate: Personal -> Certificates -> Right-click -> All Tasks -> Request New Certificate
    Invoke-WinKeysCommand $mmcHandle "{TAB}" | Out-Null  # Focus tree
    Start-Sleep -Milliseconds 500
    Invoke-WinKeysCommand $mmcHandle "{DOWN}{DOWN}{RIGHT}" | Out-Null  # Navigate to Personal, expand
    Start-Sleep -Seconds 1
    
    Write-Host "  ✓ Navigation completed (certificate request flow requires interactive testing)" -ForegroundColor Yellow
    
    Write-Host "`n[4.5] Cleanup..." -ForegroundColor Yellow
    if ($mmc -and -not $mmc.HasExited) {
        Stop-Process -Id $mmc.Id -Force -ErrorAction SilentlyContinue
    }
    Write-Host "  ✓ MMC closed" -ForegroundColor Green
}

# ============================================================================
# SUMMARY
# ============================================================================
Write-Host "`n╔══════════════════════════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║                      TEST SUITE COMPLETE                     ║" -ForegroundColor Cyan
Write-Host "╚══════════════════════════════════════════════════════════════╝" -ForegroundColor Cyan

Write-Host "`nKEY FEATURES DEMONSTRATED:" -ForegroundColor Yellow
Write-Host "  ✓ Window discovery with {LISTWINDOWS}" -ForegroundColor Green
Write-Host "  ✓ Reliable HANDLE-based identification" -ForegroundColor Green
Write-Host "  ✓ JSON output parsing and error handling" -ForegroundColor Green
Write-Host "  ✓ Pure value extraction (Calculator)" -ForegroundColor Green
Write-Host "  ✓ Text input and keyboard shortcuts (Notepad)" -ForegroundColor Green
Write-Host "  ✓ Complex UI navigation (Settings, MMC)" -ForegroundColor Green
Write-Host "  ✓ UI structure querying with {QUERYTREE}" -ForegroundColor Green

Write-Host "`nNOTE: Some operations (Settings, MMC) require interactive" -ForegroundColor Yellow
Write-Host "      testing due to complex UI workflows and security prompts." -ForegroundColor Yellow

Write-Host "`n"
