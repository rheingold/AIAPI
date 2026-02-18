"use strict";
/**
 * SignatureVerifier - Verifies Windows Authenticode signatures
 *
 * Uses Windows sigcheck.exe (Sysinternals) or PowerShell Get-AuthenticodeSignature
 * to verify that binaries are properly signed.
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.SignatureVerifier = void 0;
const cp = __importStar(require("child_process"));
const util = __importStar(require("util"));
const execFile = util.promisify(cp.execFile);
class SignatureVerifier {
    /**
     * Verify the signature of a Windows executable
     * @param exePath Absolute path to the executable
     * @returns SignatureResult with verification details
     */
    async verifySignature(exePath) {
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
        }
        catch (error) {
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
    async isMicrosoftSigned(exePath) {
        const result = await this.verifySignature(exePath);
        if (!result.isValid) {
            return false;
        }
        const microsoftSigners = [
            'CN=Microsoft Corporation',
            'CN=Microsoft Windows',
            'O=Microsoft Corporation'
        ];
        return microsoftSigners.some(ms => result.signer?.includes(ms) || result.issuer?.includes(ms));
    }
}
exports.SignatureVerifier = SignatureVerifier;
//# sourceMappingURL=SignatureVerifier.js.map