/**
 * SignatureVerifier - Verifies Windows Authenticode signatures
 *
 * Uses Windows sigcheck.exe (Sysinternals) or PowerShell Get-AuthenticodeSignature
 * to verify that binaries are properly signed.
 */
export interface SignatureResult {
    isSigned: boolean;
    isValid: boolean;
    signer?: string;
    issuer?: string;
    error?: string;
}
export declare class SignatureVerifier {
    /**
     * Verify the signature of a Windows executable
     * @param exePath Absolute path to the executable
     * @returns SignatureResult with verification details
     */
    verifySignature(exePath: string): Promise<SignatureResult>;
    /**
     * Verify that an executable is signed by Microsoft
     * @param exePath Absolute path to the executable
     * @returns true if signed by Microsoft and valid
     */
    isMicrosoftSigned(exePath: string): Promise<boolean>;
}
//# sourceMappingURL=SignatureVerifier.d.ts.map