@echo off
REM =============================================================================
REM AIAPI - Uninstall Windows Service
REM =============================================================================
REM This script removes the AIAPI Windows Service.
REM Run this file as Administrator (right-click -> "Run as administrator").
REM =============================================================================

echo.
echo ========================================
echo  AIAPI Service Uninstallation
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

REM Check if service exists
sc.exe query AIAPIService >nul 2>&1
if %errorLevel% neq 0 (
    echo [INFO] Service 'AIAPIService' is not installed. Nothing to uninstall.
    echo.
    pause
    exit /b 0
)

REM Stop the service
echo [INFO] Stopping service...
net stop AIAPIService
if %errorLevel% neq 0 (
    echo [WARN] Service stop failed. Trying force stop...
    sc.exe stop AIAPIService >nul 2>&1
    timeout /t 5 /nobreak >nul
)
echo [OK] Service stopped.

REM Uninstall the service
echo [INFO] Uninstalling service...
if exist "aiapi-service.exe" (
    aiapi-service.exe uninstall
) else (
    sc.exe delete AIAPIService >nul 2>&1
)
if %errorLevel% neq 0 (
    echo [ERROR] Service uninstallation failed.
    echo.
    pause
    exit /b 1
)
echo [OK] Service uninstalled.

echo.
echo ========================================
echo  Uninstallation Complete
echo ========================================
echo.
echo The AIAPIService has been removed.
echo Files in this directory are preserved.
echo.
pause
