"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OSEnforcementChecker = void 0;
const child_process_1 = require("child_process");
/**
 * OS Enforcement Checker for Windows Code Signing Verification
 *
 * Verifies that binaries are properly signed and trusted by the OS:
 * - Check digital signatures using Windows Get-AuthenticodeSignature
 * - Verify certificate thumbprint matches expected value
 * - Check if certificate is in Trusted Publishers store
 * - Detect WDAC/AppLocker enforcement status
 */
class OSEnforcementChecker {
    constructor(developmentMode = false) {
        this.developmentMode = developmentMode;
    }
    /**
     * Check if OS-level code signing enforcement is active (WDAC/AppLocker)
     * @returns Promise with enforcement status
     */
    async checkEnforcementActive() {
        try {
            // Check for Windows Defender Application Control (WDAC)
            const wdacStatus = await this.checkWDAC();
            // Check for AppLocker
            const appLockerStatus = await this.checkAppLocker();
            if (wdacStatus.enabled || appLockerStatus.enabled) {
                return {
                    active: true,
                    details: `WDAC: ${wdacStatus.enabled ? 'Enabled' : 'Disabled'}, AppLocker: ${appLockerStatus.enabled ? 'Enabled' : 'Disabled'}`
                };
            }
            return {
                active: false,
                details: 'No OS-level code signing enforcement detected'
            };
        }
        catch (error) {
            return {
                active: false,
                details: `Error checking enforcement: ${error instanceof Error ? error.message : String(error)}`
            };
        }
    }
    /**
     * Check Windows Defender Application Control status
     */
    async checkWDAC() {
        try {
            const script = `
                $ci = Get-CimInstance -Namespace root/Microsoft/Windows/DeviceGuard -ClassName Win32_DeviceGuard -ErrorAction SilentlyContinue
                if ($ci -and $ci.CodeIntegrityPolicyEnforcementStatus -eq 1) {
                    Write-Output "ENABLED"
                } else {
                    Write-Output "DISABLED"
                }
            `;
            const result = await this.runPowerShell(script);
            const enabled = result.trim() === 'ENABLED';
            return {
                enabled,
                details: enabled ? 'WDAC policy enforced' : 'WDAC not enforced'
            };
        }
        catch (error) {
            return {
                enabled: false,
                details: `WDAC check failed: ${error instanceof Error ? error.message : String(error)}`
            };
        }
    }
    /**
     * Check AppLocker enforcement status
     */
    async checkAppLocker() {
        try {
            const script = `
                $service = Get-Service -Name AppIDSvc -ErrorAction SilentlyContinue
                if ($service -and $service.Status -eq 'Running') {
                    $policies = Get-AppLockerPolicy -Effective -ErrorAction SilentlyContinue
                    if ($policies) {
                        Write-Output "ENABLED"
                    } else {
                        Write-Output "DISABLED"
                    }
                } else {
                    Write-Output "DISABLED"
                }
            `;
            const result = await this.runPowerShell(script);
            const enabled = result.trim() === 'ENABLED';
            return {
                enabled,
                details: enabled ? 'AppLocker policies active' : 'AppLocker not active'
            };
        }
        catch (error) {
            return {
                enabled: false,
                details: `AppLocker check failed: ${error instanceof Error ? error.message : String(error)}`
            };
        }
    }
    /**
     * Verify binary signature and certificate
     * @param binaryPath Path to binary to verify
     * @param expectedThumbprint Optional expected certificate thumbprint
     * @returns Verification result
     */
    async verifyBinarySignature(binaryPath, expectedThumbprint) {
        // Check for bypass in development
        if (process.env.SKIP_OS_ENFORCEMENT_CHECK === 'true') {
            return {
                valid: true,
                signed: true,
                trusted: true,
                details: 'OS enforcement check bypassed (SKIP_OS_ENFORCEMENT_CHECK=true)'
            };
        }
        try {
            const script = `
                $sig = Get-AuthenticodeSignature -FilePath "${binaryPath.replace(/\\/g, '\\\\')}" -ErrorAction Stop
                
                $result = @{
                    Status = $sig.Status.ToString()
                    SignatureType = if ($sig.SignatureType) { $sig.SignatureType.ToString() } else { "None" }
                    IsOSBinary = $sig.IsOSBinary
                }
                
                if ($sig.SignerCertificate) {
                    $result.Thumbprint = $sig.SignerCertificate.Thumbprint
                    $result.Subject = $sig.SignerCertificate.Subject
                    $result.Issuer = $sig.SignerCertificate.Issuer
                    
                    # Check if certificate is in Trusted Publishers store
                    $trustedCert = Get-ChildItem -Path Cert:\\LocalMachine\\TrustedPublisher -Recurse -ErrorAction SilentlyContinue | 
                        Where-Object { $_.Thumbprint -eq $sig.SignerCertificate.Thumbprint }
                    $result.InTrustedStore = [bool]$trustedCert
                }
                
                $result | ConvertTo-Json -Compress
            `;
            const output = await this.runPowerShell(script);
            const result = JSON.parse(output);
            const signed = result.Status !== 'NotSigned';
            const valid = result.Status === 'Valid';
            const trusted = result.InTrustedStore === true || result.IsOSBinary === true;
            // Check thumbprint if expected
            let thumbprintMatch = true;
            if (expectedThumbprint && result.Thumbprint) {
                thumbprintMatch = result.Thumbprint.toLowerCase() === expectedThumbprint.toLowerCase();
            }
            const details = `Status: ${result.Status}, Signed: ${signed}, Trusted: ${trusted}, Thumbprint: ${result.Thumbprint || 'N/A'}`;
            return {
                valid: valid && thumbprintMatch,
                signed,
                trusted,
                thumbprint: result.Thumbprint,
                details
            };
        }
        catch (error) {
            // In development mode, signature check failures are warnings, not errors
            if (this.developmentMode) {
                return {
                    valid: true,
                    signed: false,
                    trusted: false,
                    details: `Development mode: Signature check failed but allowed - ${error instanceof Error ? error.message : String(error)}`
                };
            }
            return {
                valid: false,
                signed: false,
                trusted: false,
                details: `Signature verification failed: ${error instanceof Error ? error.message : String(error)}`
            };
        }
    }
    /**
     * Verify certificate is in Trusted Publishers store
     * @param thumbprint Certificate thumbprint to check
     */
    async isCertificateTrusted(thumbprint) {
        try {
            const script = `
                $cert = Get-ChildItem -Path Cert:\\LocalMachine\\TrustedPublisher -Recurse -ErrorAction SilentlyContinue | 
                    Where-Object { $_.Thumbprint -eq "${thumbprint}" }
                if ($cert) {
                    Write-Output "TRUSTED"
                } else {
                    Write-Output "NOT_TRUSTED"
                }
            `;
            const result = await this.runPowerShell(script);
            const trusted = result.trim() === 'TRUSTED';
            return {
                trusted,
                details: trusted ? 'Certificate found in Trusted Publishers' : 'Certificate not in Trusted Publishers store'
            };
        }
        catch (error) {
            return {
                trusted: false,
                details: `Certificate trust check failed: ${error instanceof Error ? error.message : String(error)}`
            };
        }
    }
    /**
     * Run PowerShell script and return output
     */
    runPowerShell(script) {
        return new Promise((resolve, reject) => {
            let stdout = '';
            let stderr = '';
            const proc = (0, child_process_1.spawn)('powershell.exe', [
                '-NoProfile',
                '-NonInteractive',
                '-ExecutionPolicy', 'Bypass',
                '-Command', script
            ]);
            proc.stdout.on('data', (data) => {
                stdout += data.toString();
            });
            proc.stderr.on('data', (data) => {
                stderr += data.toString();
            });
            proc.on('close', (code) => {
                if (code !== 0) {
                    reject(new Error(`PowerShell exited with code ${code}: ${stderr}`));
                }
                else {
                    resolve(stdout);
                }
            });
            proc.on('error', (err) => {
                reject(err);
            });
        });
    }
}
exports.OSEnforcementChecker = OSEnforcementChecker;
//# sourceMappingURL=OSEnforcementChecker.js.map