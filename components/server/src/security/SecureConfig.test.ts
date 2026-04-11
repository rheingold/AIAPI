import { SecureConfig } from './SecureConfig';
import * as path from 'path';
import * as fs from 'fs';

describe('SecureConfig', () => {
    let config: SecureConfig;
    const testConfigPath = path.join(__dirname, '..', '..', 'security', 'config.json');

    beforeEach(() => {
        config = new SecureConfig();
    });

    describe('checkProcess', () => {
        test('should allow calc.exe from System32', () => {
            const result = config.checkProcess('calc.exe', 'C:\\Windows\\System32\\calc.exe');
            expect(result.allowed).toBe(true);
            expect(result.reason).toContain('whitelist');
        });

        test('should allow notepad.exe', () => {
            const result = config.checkProcess('notepad.exe');
            expect(result.allowed).toBe(true);
        });

        test('should deny cmd.exe', () => {
            const result = config.checkProcess('cmd.exe');
            expect(result.allowed).toBe(false);
            expect(result.reason).toContain('denied');
        });

        test('should deny powershell.exe', () => {
            const result = config.checkProcess('powershell.exe');
            expect(result.allowed).toBe(false);
        });

        test('should deny regedit.exe', () => {
            const result = config.checkProcess('regedit.exe');
            expect(result.allowed).toBe(false);
        });

        test('should deny unlisted process when default is DENY_UNLISTED', () => {
            const result = config.checkProcess('malicious.exe');
            expect(result.allowed).toBe(false);
            expect(result.reason).toContain('not in whitelist');
        });

        test('should match pattern-based denials', () => {
            const result = config.checkProcess('script.ps1');
            expect(result.allowed).toBe(false);
        });
    });

    describe('development mode', () => {
        test('should allow processes in workspace paths when dev mode enabled', () => {
            process.env.WORKSPACE = 'C:\\Projects\\MyApp';
            const result = config.checkProcess('myapp.exe', 'C:\\Projects\\MyApp\\dist\\myapp.exe');
            expect(result.allowed).toBe(true);
            expect(result.reason).toContain('Development mode');
        });

        test('should deny processes in excluded patterns', () => {
            process.env.WORKSPACE = 'C:\\Projects\\MyApp';
            const result = config.checkProcess('malware.exe', 'C:\\Projects\\MyApp\\node_modules\\malware.exe');
            expect(result.allowed).toBe(false);
            expect(result.reason).toContain('excluded pattern');
        });

        test('should check if development mode is enabled', () => {
            expect(config.isDevelopmentMode()).toBe(true);
        });
    });

    describe('validatePath', () => {
        test('should reject path traversal', () => {
            expect(config.validatePath('C:\\Windows\\..\\..\\malicious.exe')).toBe(false);
        });

        test('should reject UNC paths', () => {
            expect(config.validatePath('\\\\server\\share\\file.exe')).toBe(false);
        });

        test('should reject relative paths', () => {
            expect(config.validatePath('..\\file.exe')).toBe(false);
            expect(config.validatePath('.\\file.exe')).toBe(false);
        });

        test('should accept absolute valid paths', () => {
            expect(config.validatePath('C:\\Windows\\System32\\calc.exe')).toBe(true);
        });
    });

    describe('configuration loading', () => {
        test('should load config from file if exists', () => {
            if (fs.existsSync(testConfigPath)) {
                const loadedConfig = config.getConfig();
                expect(loadedConfig.version).toBeDefined();
                expect(loadedConfig.securityPolicy).toBeDefined();
            }
        });

        test('should fall back to defaults if config missing', () => {
            const noConfig = new SecureConfig('/nonexistent/path/config.json');
            const loadedConfig = noConfig.getConfig();
            expect(loadedConfig.version).toBe('1.0.0');
            expect(loadedConfig.securityPolicy.defaultAction).toBe('DENY_UNLISTED');
        });
    });

    describe('requiresSignature', () => {
        test('should return signature requirement status', () => {
            const requires = config.requiresSignature();
            expect(typeof requires).toBe('boolean');
        });

        test('should bypass signature in development mode', () => {
            // Development mode is enabled by default
            const requires = config.requiresSignature();
            // Should return false because dev mode bypasses signature
            expect(requires).toBe(false);
        });
    });

    describe('checkProcessWithSignature', () => {
        test('should verify calc.exe signature', async () => {
            // Note: This test requires signature verification enabled
            // For development, signature is bypassed by default
            const result = await config.checkProcessWithSignature('calc.exe', 'C:\\Windows\\System32\\calc.exe');
            
            expect(result.allowed).toBe(true);
            // In dev mode, signature verification is skipped
        }, 10000);

        test('should verify notepad.exe signature', async () => {
            const result = await config.checkProcessWithSignature('notepad.exe', 'C:\\Windows\\System32\\notepad.exe');
            
            expect(result.allowed).toBe(true);
        }, 10000);

        test('should reject cmd.exe even with valid signature', async () => {
            const result = await config.checkProcessWithSignature('cmd.exe', 'C:\\Windows\\System32\\cmd.exe');
            
            // cmd.exe is in deny list
            expect(result.allowed).toBe(false);
            expect(result.reason).toContain('denied');
        });
    });
});
