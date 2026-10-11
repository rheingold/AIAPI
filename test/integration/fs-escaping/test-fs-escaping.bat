@echo off
REM FS_Escaping Test Runner — CMD/Batch
REM Tests FS_WRITE/FS_READ escaping through the MCP server
REM Prerequisites: MCP server running on port 3457, PowerShell available
REM Run: test-fs-escaping.bat

set SERVER_URL=http://127.0.0.1:3457
set OUTPUT_DIR=%~dp0fs-escaping\output
set PASSED=0
set FAILED=0

echo ========================================================
echo   FS Escaping Tests — CMD Runner
echo ========================================================

REM Create output directory
if not exist "%OUTPUT_DIR%" mkdir "%OUTPUT_DIR%"

REM Test 1: Call PowerShell runner
echo.
echo Starting PowerShell-based FS escaping tests...
powershell -ExecutionPolicy Bypass -File "%~dp0fs-escaping\test-fs-escaping.ps1" -OutputDir "%OUTPUT_DIR%"
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo   ^> PowerShell tests had failures
) else (
    echo.
    echo   ^> PowerShell tests passed
)

REM Test 2: Direct MCP call via curl (if available)
echo.
echo Testing direct MCP call via PowerShell...
powershell -ExecutionPolicy Bypass -Command "
    $body = @{
        jsonrpc = '2.0'
        id = 1
        method = 'tools/call'
        params = @{
            name = 'AutomateUI'
            arguments = @{
                helper = '_System'
                action = 'FS_LIST'
                path = '%OUTPUT_DIR%'
            }
        }
    } | ConvertTo-Json -Depth 10 -Compress
    
    try {
        $r = Invoke-RestMethod -Uri '%SERVER_URL%' -Method Post -Body $body -ContentType 'application/json'
        if ($r.success -or $r.entries -ne $null) {
            Write-Host '  ^✅ FS_LIST via direct call succeeded' -ForegroundColor Green
        } else {
            Write-Host '  ^❌ FS_LIST returned unexpected result' -ForegroundColor Red
        }
    } catch {
        Write-Host \"  ^❌ Direct call failed: $_\" -ForegroundColor Red
    }
"

REM Test 3: Write and verify a simple file
echo.
echo Testing FS_WRITE with special characters...
powershell -ExecutionPolicy Bypass -Command "
    $body = @{
        jsonrpc = '2.0'
        id = 2
        method = 'tools/call'
        params = @{
            name = 'AutomateUI'
            arguments = @{
                helper = '_System'
                action = 'FS_WRITE'
                path = '%OUTPUT_DIR%\special.txt'
                value = 'Hello `"$world`" ^& %%special%% ^<chars^> `&ampersand`'
            }
        }
    } | ConvertTo-Json -Depth 10 -Compress
    
    $r = Invoke-RestMethod -Uri '%SERVER_URL%' -Method Post -Body $body -ContentType 'application/json'
    if ($r.success) {
        Write-Host '  ^✅ FS_WRITE with special chars succeeded' -ForegroundColor Green
        
        $file = Get-Content '%OUTPUT_DIR%\special.txt' -Raw
        if ($file -match 'world') {
            Write-Host '  ^✅ Content contains expected text' -ForegroundColor Green
        } else {
            Write-Host '  ^❌ Content missing expected text' -ForegroundColor Red
        }
    } else {
        Write-Host '  ^❌ FS_WRITE failed' -ForegroundColor Red
    }
"

echo.
echo ========================================================
echo   Tests complete
echo ========================================================

REM Cleanup
rmdir /s /q "%OUTPUT_DIR%" 2>nul
