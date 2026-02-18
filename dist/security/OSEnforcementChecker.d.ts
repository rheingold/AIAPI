/**
 * OS Enforcement Checker for Windows Code Signing Verification
 *
 * Verifies that binaries are properly signed and trusted by the OS:
 * - Check digital signatures using Windows Get-AuthenticodeSignature
 * - Verify certificate thumbprint matches expected value
 * - Check if certificate is in Trusted Publishers store
 * - Detect WDAC/AppLocker enforcement status
 */
export declare class OSEnforcementChecker {
    private developmentMode;
    constructor(developmentMode?: boolean);
    /**
     * Check if OS-level code signing enforcement is active (WDAC/AppLocker)
     * @returns Promise with enforcement status
     */
    checkEnforcementActive(): Promise<{
        active: boolean;
        details: string;
    }>;
    /**
     * Check Windows Defender Application Control status
     */
    private checkWDAC;
    /**
     * Check AppLocker enforcement status
     */
    private checkAppLocker;
    /**
     * Verify binary signature and certificate
     * @param binaryPath Path to binary to verify
     * @param expectedThumbprint Optional expected certificate thumbprint
     * @returns Verification result
     */
    verifyBinarySignature(binaryPath: string, expectedThumbprint?: string): Promise<{
        valid: boolean;
        signed: boolean;
        trusted: boolean;
        thumbprint?: string;
        details: string;
    }>;
    /**
     * Verify certificate is in Trusted Publishers store
     * @param thumbprint Certificate thumbprint to check
     */
    isCertificateTrusted(thumbprint: string): Promise<{
        trusted: boolean;
        details: string;
    }>;
    /**
     * Run PowerShell script and return output
     */
    private runPowerShell;
}
//# sourceMappingURL=OSEnforcementChecker.d.ts.map