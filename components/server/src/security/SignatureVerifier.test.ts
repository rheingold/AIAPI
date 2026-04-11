import { SignatureVerifier } from './SignatureVerifier';
import * as path from 'path';

describe('SignatureVerifier', () => {
    let verifier: SignatureVerifier;

    beforeEach(() => {
        verifier = new SignatureVerifier();
    });

    describe('verifySignature', () => {
        test('should verify calc.exe is signed by Microsoft', async () => {
            const calcPath = 'C:\\Windows\\System32\\calc.exe';
            const result = await verifier.verifySignature(calcPath);
            
            expect(result.isSigned).toBe(true);
            expect(result.isValid).toBe(true);
            expect(result.signer).toContain('Microsoft');
        }, 10000); // Allow 10s for signature verification

        test('should verify notepad.exe is signed by Microsoft', async () => {
            const notepadPath = 'C:\\Windows\\System32\\notepad.exe';
            const result = await verifier.verifySignature(notepadPath);
            
            expect(result.isSigned).toBe(true);
            expect(result.isValid).toBe(true);
            expect(result.signer).toContain('Microsoft');
        }, 10000);

        test('should detect unsigned executable', async () => {
            // Test with our own KeyWin.exe (unsigned in development)
            const keywinPath = path.join(process.cwd(), 'dist', 'win', 'KeyWin.exe');
            const result = await verifier.verifySignature(keywinPath);
            
            // In development, KeyWin.exe should be unsigned
            expect(result.isSigned).toBe(false);
            expect(result.isValid).toBe(false);
        }, 10000);

        test('should handle non-existent file', async () => {
            const result = await verifier.verifySignature('C:\\NonExistent\\fake.exe');
            
            expect(result.isValid).toBe(false);
            expect(result.error).toBeDefined();
        });
    });

    describe('isMicrosoftSigned', () => {
        test('should confirm calc.exe is Microsoft signed', async () => {
            const calcPath = 'C:\\Windows\\System32\\calc.exe';
            const isMSSigned = await verifier.isMicrosoftSigned(calcPath);
            
            expect(isMSSigned).toBe(true);
        }, 10000);

        test('should confirm notepad.exe is Microsoft signed', async () => {
            const notepadPath = 'C:\\Windows\\System32\\notepad.exe';
            const isMSSigned = await verifier.isMicrosoftSigned(notepadPath);
            
            expect(isMSSigned).toBe(true);
        }, 10000);

        test('should reject unsigned executable', async () => {
            const keywinPath = path.join(process.cwd(), 'dist', 'win', 'KeyWin.exe');
            const isMSSigned = await verifier.isMicrosoftSigned(keywinPath);
            
            expect(isMSSigned).toBe(false);
        }, 10000);
    });
});
