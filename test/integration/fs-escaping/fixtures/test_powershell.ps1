# Test PowerShell script for FS_WRITE escaping validation
# This file contains ALL problematic character combinations for JSON transport

# --- Variables with $ ---
$greeting = "Hello, World!"
$number = 42
$path = "C:\Users\test\Documents"
$url = "https://example.com/api?key=value&foo=bar"

# --- Strings with nested quotes ---
$doubleQuoted = "She said ""hello"""
$singleQuoted = 'It''s working'
$mixedQuotes = "He said 'hi' and she said ""bye"""

# --- Backticks (PowerShell escape character) ---
$lineBreak = "line1`nline2"
$tab = "col1`tcol2"
$dollarEscape = "`$notAVariable"

# --- Here-string (multi-line with special chars) ---
$hereString = @"
This contains $variables, "quotes", 'apostrophes', and `backticks`
Paths like C:\Windows\System32 and UNC \\server\share
Symbols: < > & | @ # % ! ~ ^ { } [ ] ( )
"@

# --- Functions ---
function Test-Escaping {
    param(
        [string]$input,
        [string]$output = "default"
    )
    Write-Output "Input: $input, Output: $output"
    return $true
}

# --- Arrays and objects ---
$colors = @("red", "green", "blue")
$config = @{
    host = "localhost"
    port = 8080
    path = "/api/v1"
    query = "a=1&b=2"
}

# --- Conditional with special chars ---
if ($number -gt 0) {
    Write-Host "Positive: $number"
} elseif ($number -lt 0) {
    Write-Host "Negative: $number"  
} else {
    Write-Host "Zero"
}

# --- Subexpression ---
$calc = $(1 + 2 * 3)
Write-Output "Calculation result: $calc"

# --- Process operator ---
Get-Process | Where-Object { $_.CPU -gt 100 } | Select-Object Name, CPU

# --- Try-catch with $error ---
try {
    $result = Invoke-RestMethod -Uri "http://nonexistent.local/api" -TimeoutSec 1
} catch {
    Write-Warning "Failed: $_"
}

# --- Registry and WMI paths ---
$regPath = "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion"
$wmiQuery = "SELECT * FROM Win32_Process WHERE Name='calc.exe'"

# --- Command chaining and piping ---
"test" | ForEach-Object { $_.ToUpper() } | Out-String

# --- Regex patterns ---
$pattern = '\b[A-Z]{2,}\b'
$regex = [regex]::Match("Hello World", $pattern)

# --- Base64 and binary ---
$base64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes("hello"))

# --- URL-encoded strings ---
$encoded = "name=John%20Doe&email=test%40example.com"

# --- SQL-like strings ---
$sql = "SELECT * FROM users WHERE name = 'O''Brien' AND city = ''''New York''''"

# End of test script
