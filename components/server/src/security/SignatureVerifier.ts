/**
 * SignatureVerifier - Verifies Windows Authenticode signatures
 * 
 * Uses Windows sigcheck.exe (Sysinternals) or PowerShell Get-AuthenticodeSignature
 * to verify that binaries are properly signed.
 */

import * as cp from 'child_process';
import * as path from 'path';
import * as util from 'util';

const execFile = util.promisify(cp.execFile);

export interface SignatureResult {
    isSigned: boolean;
    isValid: boolean;
    signer?: string;
    issuer?: string;
    error?: string;
}

export class SignatureVerifier {
    /**
     * Verify the signature of a Windows executable
     * @param exePath Absolute path to the executable
     * @returns SignatureResult with verification details
     */
    async verifySignature(exePath: string): Promise<SignatureResult> {
        try {
            // Use PowerShell Get-AuthenticodeSignature
            const psScript = `
                $sig = Get-AuthenticodeSignature -FilePath "${exePath.replace(/\\/g, '\\\\')}"
                $result = @{
                    Status = $sig.Status.ToString()
                    SignerCertificate = if ($sig.SignerCertificate) { 
                        @{
                            Subject = $sig.SignerCertificate.Subject
                            Issuer = $sig.SignerCertificate.Issuer
                        }
                    } else { $null }
                }
                $result | ConvertTo-Json -Compress
            `;

            const { stdout } = await execFile('powershell.exe', [
                '-NoProfile',
                '-NonInteractive',
                '-Command',
                psScript
            ]);

            const result = JSON.parse(stdout.trim());

            // Valid statuses: Valid, NotSigned, HashMismatch, NotTrusted, UnknownError
            const isValid = result.Status === 'Valid';
            const isSigned = result.Status !== 'NotSigned';

            return {
                isSigned,
                isValid,
                signer: result.SignerCertificate?.Subject,
                issuer: result.SignerCertificate?.Issuer
            };
        } catch (error) {
            return {
                isSigned: false,
                isValid: false,
                error: error instanceof Error ? error.message : String(error)
            };
        }
    }

    /**
     * Verify that an executable is signed by Microsoft
     * @param exePath Absolute path to the executable
     * @returns true if signed by Microsoft and valid
     */
    async isMicrosoftSigned(exePath: string): Promise<boolean> {
        const result = await this.verifySignature(exePath);
        if (!result.isValid) {
            return false;
        }

        const microsoftSigners = [
            'CN=Microsoft Corporation',
            'CN=Microsoft Windows',
            'O=Microsoft Corporation'
        ];

        return microsoftSigners.some(ms => 
            result.signer?.includes(ms) || result.issuer?.includes(ms)
        );
    }
}
