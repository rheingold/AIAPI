@echo off
REM Test batch file for FS_WRITE escaping validation
REM Focus: percent signs, carets, ampersands, pipes, redirects

REM --- Percent signs (environment variables) ---
echo Original path: %PATH%
echo Custom var: %COMPUTERNAME%\%USERNAME%
echo Literal percent: 100%% complete

REM --- Caret escaping ---
echo This has ^<angle brackets^> and ^& ampersand
echo Pipe test: cmd1 ^| cmd2 ^| cmd3

REM --- Quotes and apostrophes in arguments ---
set "msg=Hello ""world"""
echo %msg%
set "path=C:\Program Files (x86)\Some App\subdir"
echo Path: %path%

REM --- Calling other scripts with complex arguments ---
REM Simulated call - in real test this would execute
REM call other_script.bat "arg with spaces" "arg with ""quotes""" "it's tricky"
REM powershell.exe -File "C:\test\script.ps1" -Param "value with `backticks`"

REM --- Redirects ---
echo line1 > "%TEMP%\test_output.txt"
echo line2 >> "%TEMP%\test_output.txt"
echo Error redirect 2> "%TEMP%\errors.txt"

REM --- Special characters in strings ---
set "special=!@#$%%^&*()_+-=[]{}|;':""^,<>.?/"
echo Special chars: %special%

REM --- FOR loops with delimiters ---
for %%f in (*.txt) do echo Found: %%f
for /f "tokens=1,2 delims=," %%a in ("a,b,c") do echo %%a %%b

REM --- Conditional blocks ---
if exist "C:\nonexistent" (
    echo exists
) else (
    echo does not exist
)

REM --- GOTO and labels ---
goto end
:middle
echo This should not appear
:end
echo Done

REM --- Delayed expansion ---
setlocal EnableDelayedExpansion
set "counter=0"
set /a counter+=1
echo Counter: !counter!
endlocal

REM End of test batch
