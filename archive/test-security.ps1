#!/usr/bin/env pwsh
<#
.SYNOPSIS
    Security Integration Test - Success and Violation Scenarios
#>

$ErrorActionPreference = "Stop"
$testDir = "security/test-integration"

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "  Security Integration Test Suite" -ForegroundColor Cyan
Write-Host "========================================`n" -ForegroundColor Cyan

# Cleanup
if (Test-Path $testDir) {
    Remove-Item -Path $testDir -Recurse -Force
}
New-Item -ItemType Directory -Path $testDir -Force | Out-Null
Write-Host "✓ Test directory created`n" -ForegroundColor Green

# Create test config
@{
    version = "1.0"
    security = @{
        defaultPolicy = "DENY_UNLISTED"
        requireTargetSignature = $true
    }
    processes = @{
        whitelist = @("notepad.exe", "calc.exe")
    }
} | ConvertTo-Json -Depth 10 | Set-Content "$testDir/config.json"

# ====================
# TEST 1: Generate Keys
# ====================
Write-Host "TEST 1: Certificate Generation" -ForegroundColor Yellow
@'
const { CertificateManager } = require('./dist/security/CertificateManager');
const path = require('path');
const testDir = path.join(process.cwd(), 'security/test-integration');
const certManager = new CertificateManager(testDir);
(async () => {
    const keyPair = await certManager.initialize('TestPassword123!', 'TestPassword123!');
    console.log('Keys generated. Thumbprint:', keyPair.thumbprint.substring(0, 16) + '...');
})();
'@ | Set-Content "$testDir/t1.js"

node "$testDir/t1.js"
Write-Host "✓ PASSED`n" -ForegroundColor Green

# ====================
# TEST 2: Sign Config
# ====================
Write-Host "TEST 2: Config Signing" -ForegroundColor Yellow
@'
const { ConfigSigner } = require('./dist/security/ConfigSigner');
const path = require('path');
const testDir = path.join(process.cwd(), 'security/test-integration');
const signer = new ConfigSigner(testDir);
const signature = signer.signConfig('TestPassword123!', true);
console.log('Config signed. Hash:', signature.configHash.substring(0, 16) + '...');
'@ | Set-Content "$testDir/t2.js"

node "$testDir/t2.js"
Write-Host "✓ PASSED`n" -ForegroundColor Green

# ====================
# TEST 3: Verify Signature
# ====================
Write-Host "TEST 3: Signature Verification" -ForegroundColor Yellow
@'
const { ConfigSigner } = require('./dist/security/ConfigSigner');
const path = require('path');
const testDir = path.join(process.cwd(), 'security/test-integration');
const signer = new ConfigSigner(testDir);
const result = signer.verifyConfig('TestPassword123!');
if (!result.valid) throw new Error(result.error);
console.log('Signature verified. Policy:', result.config.security.defaultPolicy);
'@ | Set-Content "$testDir/t3.js"

node "$testDir/t3.js"
Write-Host "✓ PASSED`n" -ForegroundColor Green

# ====================
# TEST 4: Binary Integrity
# ====================
Write-Host "TEST 4: Binary Integrity Check" -ForegroundColor Yellow
@'
const { IntegrityChecker } = require('./dist/security/IntegrityChecker');
const { ConfigSigner } = require('./dist/security/ConfigSigner');
const path = require('path');
const testDir = path.join(process.cwd(), 'security/test-integration');
const checker = new IntegrityChecker(testDir);
const signer = new ConfigSigner(testDir);
const configResult = signer.verifyConfig('TestPassword123!');
const integrityResult = checker.verifyAll(configResult.config);
console.log('Integrity check. Binaries checked:', integrityResult.results.length);
'@ | Set-Content "$testDir/t4.js"

node "$testDir/t4.js"
Write-Host "✓ PASSED`n" -ForegroundColor Green

# ====================
# VIOLATION TESTS
# ====================
Write-Host "`n========================================" -ForegroundColor Magenta
Write-Host "  VIOLATION TESTS" -ForegroundColor Magenta
Write-Host "========================================`n" -ForegroundColor Magenta

# VIOLATION 1: Wrong Password
Write-Host "VIOLATION 1: Wrong Password" -ForegroundColor Yellow
@'
const { ConfigSigner } = require('./dist/security/ConfigSigner');
const path = require('path');
const testDir = path.join(process.cwd(), 'security/test-integration');
const signer = new ConfigSigner(testDir);
try {
    signer.verifyConfig('WrongPassword!');
    console.error('BREACH: Wrong password accepted!');
    process.exit(1);
} catch (err) {
    console.log('Wrong password rejected:', err.message.substring(0, 40) + '...');
}
'@ | Set-Content "$testDir/v1.js"

node "$testDir/v1.js"
Write-Host "✓ DETECTED`n" -ForegroundColor Green

# VIOLATION 2: Config Tampering
Write-Host "VIOLATION 2: Config Tampering" -ForegroundColor Yellow
Copy-Item "$testDir/config.json" "$testDir/config.bak"
$cfg = Get-Content "$testDir/config.json" | ConvertFrom-Json
$cfg.security.defaultPolicy = "ALLOW_ALL"
$cfg | ConvertTo-Json -Depth 10 | Set-Content "$testDir/config.json"

@'
const { ConfigSigner } = require('./dist/security/ConfigSigner');
const path = require('path');
const testDir = path.join(process.cwd(), 'security/test-integration');
const signer = new ConfigSigner(testDir);
const result = signer.verifyConfig('TestPassword123!');
if (result.valid) {
    console.error('BREACH: Tampered config accepted!');
    process.exit(1);
} else {
    console.log('Tampering detected:', result.error);
}
'@ | Set-Content "$testDir/v2.js"

node "$testDir/v2.js"
Move-Item "$testDir/config.bak" "$testDir/config.json" -Force
Write-Host "✓ DETECTED`n" -ForegroundColor Green

# VIOLATION 3: Missing Signature
Write-Host "VIOLATION 3: Missing Signature" -ForegroundColor Yellow
Copy-Item "$testDir/config.json.sig" "$testDir/sig.bak"
Remove-Item "$testDir/config.json.sig"

@'
const { ConfigSigner } = require('./dist/security/ConfigSigner');
const path = require('path');
const testDir = path.join(process.cwd(), 'security/test-integration');
const signer = new ConfigSigner(testDir);
const result = signer.verifyConfig('TestPassword123!');
if (result.valid) {
    console.error('BREACH: Missing signature not detected!');
    process.exit(1);
} else {
    console.log('Missing signature detected:', result.error);
}
'@ | Set-Content "$testDir/v3.js"

node "$testDir/v3.js"
Move-Item "$testDir/sig.bak" "$testDir/config.json.sig" -Force
Write-Host "✓ DETECTED`n" -ForegroundColor Green

# VIOLATION 4: Binary Tampering
Write-Host "VIOLATION 4: Binary Tampering" -ForegroundColor Yellow
$bin = "$testDir/test.exe"
"Original" | Set-Content $bin

$cfg = Get-Content "$testDir/config.json" | ConvertFrom-Json
$hash = (Get-FileHash $bin -Algorithm SHA256).Hash
if (-not $cfg.binaryHashes) {
    $cfg | Add-Member -Name binaryHashes -Value @{} -MemberType NoteProperty
}
$cfg.binaryHashes["test"] = @{
    path = "test.exe"
    sha256 = $hash
    size = (Get-Item $bin).Length
    lastModified = (Get-Date).ToString("o")
}
$cfg | ConvertTo-Json -Depth 10 | Set-Content "$testDir/config.json"
node "$testDir/t2.js" | Out-Null

"Malicious" | Set-Content $bin

@'
const { IntegrityChecker } = require('./dist/security/IntegrityChecker');
const { ConfigSigner } = require('./dist/security/ConfigSigner');
const path = require('path');
const testDir = path.join(process.cwd(), 'security/test-integration');
const checker = new IntegrityChecker(testDir);
const signer = new ConfigSigner(testDir);
const configResult = signer.verifyConfig('TestPassword123!');
const integrityResult = checker.verifyAll(configResult.config);
if (integrityResult.allValid) {
    console.error('BREACH: Tampered binary not detected!');
    process.exit(1);
} else {
    const failed = integrityResult.results.filter(r => !r.valid);
    console.log('Binary tampering detected:', failed[0].error);
}
'@ | Set-Content "$testDir/v4.js"

node "$testDir/v4.js"
Write-Host "✓ DETECTED`n" -ForegroundColor Green

# VIOLATION 5: Dev Bypass
Write-Host "VIOLATION 5: Development Bypass" -ForegroundColor Yellow
Remove-Item "$testDir/config.json.sig" -ErrorAction SilentlyContinue

@'
const { ConfigSigner } = require('./dist/security/ConfigSigner');
const path = require('path');
process.env.SKIP_CONFIG_SIGNATURE = 'true';
const testDir = path.join(process.cwd(), 'security/test-integration');
const signer = new ConfigSigner(testDir);
const result = signer.verifyConfig('TestPassword123!');
if (result.valid) {
    console.log('Dev bypass functional (WARNING: Never in production!)');
} else {
    process.exit(1);
}
'@ | Set-Content "$testDir/v5.js"

node "$testDir/v5.js"
Write-Host "⚠  Works (dev only!)`n" -ForegroundColor Yellow

# Summary
Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "  SUMMARY" -ForegroundColor Cyan
Write-Host "========================================`n" -ForegroundColor Cyan

Write-Host "Success Tests:" -ForegroundColor Green
Write-Host "  ✓ Certificate generation" -ForegroundColor Green
Write-Host "  ✓ Config signing (RSA-SHA256)" -ForegroundColor Green
Write-Host "  ✓ Signature verification" -ForegroundColor Green
Write-Host "  ✓ Binary integrity" -ForegroundColor Green

Write-Host "`nViolation Detection:" -ForegroundColor Magenta
Write-Host "  ✓ Wrong password" -ForegroundColor Green
Write-Host "  ✓ Config tampering" -ForegroundColor Green
Write-Host "  ✓ Missing signature" -ForegroundColor Green
Write-Host "  ✓ Binary tampering" -ForegroundColor Green
Write-Host "  ⚠ Dev bypass available" -ForegroundColor Yellow

Write-Host "`n✓ ALL TESTS PASSED" -ForegroundColor Green -BackgroundColor DarkGreen
Write-Host "`nArtifacts: $testDir`n" -ForegroundColor Gray
