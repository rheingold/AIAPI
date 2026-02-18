import { OSEnforcementChecker } from './OSEnforcementChecker';
import * as path from 'path';

describe('OSEnforcementChecker', () => {
    describe('constructor', () => {
        it('should create instance in production mode by default', () => {
            const checker = new OSEnforcementChecker();
            expect(checker).toBeDefined();
        });

        it('should create instance in development mode', () => {
            const checker = new OSEnforcementChecker(true);
            expect(checker).toBeDefined();
        });
    });

    describe('checkEnforcementActive', () => {
        it('should check for WDAC and AppLocker', async () => {
            const checker = new OSEnforcementChecker();
            const result = await checker.checkEnforcementActive();
            
            expect(result).toHaveProperty('active');
            expect(result).toHaveProperty('details');
            expect(typeof result.active).toBe('boolean');
            expect(typeof result.details).toBe('string');
        }, 10000);

        it('should return details about enforcement status', async () => {
            const checker = new OSEnforcementChecker();
            const result = await checker.checkEnforcementActive();
            
            // Details should mention either WDAC/AppLocker status or no enforcement
            expect(result.details.length).toBeGreaterThan(0);
            expect(
                result.details.includes('WDAC') || 
                result.details.includes('AppLocker') ||
                result.details.includes('No OS-level')
            ).toBe(true);
        }, 10000);
    });

    describe('verifyBinarySignature', () => {
        it('should verify signed Windows system binary (calc.exe)', async () => {
            const checker = new OSEnforcementChecker();
            const calcPath = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'calc.exe');
            
            const result = await checker.verifyBinarySignature(calcPath);
            
            expect(result).toHaveProperty('valid');
            expect(result).toHaveProperty('signed');
            expect(result).toHaveProperty('trusted');
            expect(result).toHaveProperty('details');
            
            // calc.exe should be signed by Microsoft
            expect(result.signed).toBe(true);
            expect(result.trusted).toBe(true); // OS binaries are trusted
        }, 10000);

        it('should return thumbprint for signed binary', async () => {
            const checker = new OSEnforcementChecker();
            const calcPath = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'calc.exe');
            
            const result = await checker.verifyBinarySignature(calcPath);
            
            if (result.signed) {
                expect(result.thumbprint).toBeDefined();
                expect(result.thumbprint).toMatch(/^[A-F0-9]+$/i);
            }
        }, 10000);

        it('should handle unsigned binary gracefully', async () => {
            const checker = new OSEnforcementChecker();
            const unsignedPath = path.join(__dirname, '..', '..', 'dist', 'win', 'KeyWin.exe');
            
            const result = await checker.verifyBinarySignature(unsignedPath);
            
            expect(result).toHaveProperty('signed');
            expect(result).toHaveProperty('details');
            // KeyWin.exe is likely unsigned in development
        }, 10000);

        it('should bypass check when SKIP_OS_ENFORCEMENT_CHECK is set', async () => {
            const originalEnv = process.env.SKIP_OS_ENFORCEMENT_CHECK;
            process.env.SKIP_OS_ENFORCEMENT_CHECK = 'true';
            
            const checker = new OSEnforcementChecker();
            const result = await checker.verifyBinarySignature('C:\\nonexistent.exe');
            
            expect(result.valid).toBe(true);
            expect(result.details).toContain('bypassed');
            
            // Restore environment
            if (originalEnv !== undefined) {
                process.env.SKIP_OS_ENFORCEMENT_CHECK = originalEnv;
            } else {
                delete process.env.SKIP_OS_ENFORCEMENT_CHECK;
            }
        }, 10000);

        it('should allow failures in development mode', async () => {
            const checker = new OSEnforcementChecker(true); // development mode
            const result = await checker.verifyBinarySignature('C:\\nonexistent.exe');
            
            // In dev mode, failures should be allowed
            expect(result.valid).toBe(true);
            expect(result.details).toContain('Development mode');
        }, 10000);

        it('should fail on nonexistent file in production mode', async () => {
            const checker = new OSEnforcementChecker(false); // production mode
            const result = await checker.verifyBinarySignature('C:\\nonexistent.exe');
            
            expect(result.valid).toBe(false);
            expect(result.signed).toBe(false);
        }, 10000);

        it('should verify thumbprint matches if provided', async () => {
            const checker = new OSEnforcementChecker();
            const calcPath = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'calc.exe');
            
            // First get the actual thumbprint
            const result1 = await checker.verifyBinarySignature(calcPath);
            
            if (result1.thumbprint) {
                // Verify with correct thumbprint
                const result2 = await checker.verifyBinarySignature(calcPath, result1.thumbprint);
                expect(result2.valid).toBe(true);
                
                // Verify with wrong thumbprint
                const wrongThumbprint = '0000000000000000000000000000000000000000';
                const result3 = await checker.verifyBinarySignature(calcPath, wrongThumbprint);
                expect(result3.valid).toBe(false);
            }
        }, 10000);
    });

    describe('isCertificateTrusted', () => {
        it('should check if certificate is in Trusted Publishers', async () => {
            const checker = new OSEnforcementChecker();
            
            // Use a dummy thumbprint
            const result = await checker.isCertificateTrusted('0000000000000000000000000000000000000000');
            
            expect(result).toHaveProperty('trusted');
            expect(result).toHaveProperty('details');
            expect(typeof result.trusted).toBe('boolean');
        }, 10000);

        it('should return false for non-existent certificate', async () => {
            const checker = new OSEnforcementChecker();
            const fakeThumbprint = 'FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF';
            
            const result = await checker.isCertificateTrusted(fakeThumbprint);
            
            expect(result.trusted).toBe(false);
            expect(result.details).toContain('not in Trusted Publishers');
        }, 10000);
    });

    describe('integration', () => {
        it('should provide complete OS enforcement status', async () => {
            const checker = new OSEnforcementChecker();
            
            // Check enforcement
            const enforcement = await checker.checkEnforcementActive();
            console.log('OS Enforcement Status:', enforcement.details);
            
            // Verify system binary
            const calcPath = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'calc.exe');
            const signature = await checker.verifyBinarySignature(calcPath);
            console.log('Calculator Signature:', signature.details);
            
            // Check certificate trust if available
            if (signature.thumbprint) {
                const trust = await checker.isCertificateTrusted(signature.thumbprint);
                console.log('Certificate Trust:', trust.details);
            }
            
            expect(enforcement).toBeDefined();
            expect(signature).toBeDefined();
        }, 15000);
    });
});
