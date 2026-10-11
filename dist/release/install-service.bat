@echo off
REM =============================================================================
REM AIAPI - Install as Windows Service
REM =============================================================================
REM This script installs AIAPI as a Windows Service using WinSW.
REM Run this file as Administrator (right-click -> "Run as administrator").
REM
REM Service Details:
REM   Name:     AIAPIService
REM   Port:     4457 (MCP) + 4458 (Dashboard)
REM =============================================================================

echo.
echo ========================================
echo  AIAPI Service Installation
echo ========================================
echo.

REM Check for administrator privileges
net session >nul 2>&1
if %errorLevel% neq 0 (
    echo [ERROR] Administrator privileges required.
    echo   Right-click this file and select "Run as administrator".
    echo.
    pause
    exit /b 1
)
echo [OK] Running as Administrator.

REM Check if aiapi-server.exe exists
if not exist "aiapi-server.exe" (
    echo [ERROR] aiapi-server.exe not found in current directory.
    echo   Please run this script from the AIAPI release directory.
    echo.
    pause
    exit /b 1
)
echo [OK] aiapi-server.exe found.

REM Download WinSW if not present
if not exist "aiapi-service.exe" (
    echo [INFO] Downloading WinSW...
    powershell -Command "Invoke-WebRequest -Uri 'https://github.com/winsw/winsw/releases/download/v3.0.0-alpha.11/WinSW-x64.exe' -OutFile 'aiapi-service.exe' -UseBasicParsing"
    if %errorLevel% neq 0 (
        echo [ERROR] Failed to download WinSW.
        echo   Please ensure you have an internet connection.
        echo.
        pause
        exit /b 1
    )
    echo [OK] WinSW downloaded.
) else (
    echo [OK] WinSW already present.
)

REM Check if service already exists
sc.exe query AIAPIService >nul 2>&1
if %errorLevel% equ 0 (
    echo [WARN] Service 'AIAPIService' already exists.
    echo [INFO] Removing existing service...
    sc.exe stop AIAPIService >nul 2>&1
    timeout /t 3 /nobreak >nul
    sc.exe delete AIAPIService >nul 2>&1
    timeout /t 2 /nobreak >nul
    echo [OK] Existing service removed.
)

REM Install the service
echo [INFO] Installing service...
aiapi-service.exe install
if %errorLevel% neq 0 (
    echo [ERROR] Service installation failed.
    echo   Check the log files for details.
    echo.
    pause
    exit /b 1
)
echo [OK] Service installed.

REM Start the service
echo [INFO] Starting service...
net start AIAPIService
if %errorLevel% neq 0 (
    echo [WARN] Service start failed. Try starting manually with: net start AIAPIService
) else (
    echo [OK] Service started.
)

echo.
echo ========================================
echo  Installation Complete
echo ========================================
echo.
echo Service:      AIAPIService
echo MCP Server:   http://127.0.0.1:4457
echo Dashboard:    http://127.0.0.1:4458
echo Logs:         *.log files in this directory
echo.
echo To stop:      net stop AIAPIService
echo To uninstall: run uninstall-service.bat
echo.
pause
