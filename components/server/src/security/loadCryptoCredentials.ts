import { CertificateManager } from './CertificateManager';
import { globalLogger } from '../utils/Logger';
import * as path from 'path';
import * as readline from 'readline';

/**
 * Prompt for the private key password on stdin (no echo), or read from
 * the KEY_PASSWORD environment variable.
 *
 * Returns the raw PKCS#8 DER bytes of the decrypted private key in memory,
 * or null when no key file exists (security not yet initialised) or when
 * the user presses Enter without a password (graceful skip for dev use).
 *
 * Extracted to its own module so it can be unit-tested without starting the
 * full MCP server.
 */
export async function loadCryptoCredentials(
  securityDir?: string,
): Promise<Buffer | null> {
  const dir = securityDir ?? path.resolve(process.cwd(), 'security');
  const certManager = new CertificateManager(dir);
  const exists = certManager.keysExist();

  if (!exists.private) {
    // Keys not generated yet — running without credential-based HMAC.
    return null;
  }

  // 1. Try env var first (CI / unattended startup).
  const envPassword = process.env['KEY_PASSWORD'];
  if (envPassword) {
    try {
      const pkBytes = certManager.getRawPrivateKeyBytes(envPassword);
      globalLogger.info('Security', 'Loaded private key from KEY_PASSWORD env var');
      return pkBytes;
    } catch (e: any) {
      globalLogger.warn('Security', `KEY_PASSWORD: failed to decrypt private key — ${e.message}`);
      // Fall through to interactive prompt.
    }
  }

  // 2. Interactive prompt (hidden input) — only when stdin is a real terminal.
  // Skip if AIAPI_NON_INTERACTIVE is set (for service/daemon mode).
  if (!process.stdin.isTTY || process.env['AIAPI_NON_INTERACTIVE']) {
    globalLogger.info('Security',
      'stdin is not a TTY (or AIAPI_NON_INTERACTIVE set) and KEY_PASSWORD not set — running without HMAC session keys');
    return null;
  }

  return new Promise<Buffer | null>((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true,
    });

    // Suppress echoed characters; replace with '*' while password is being typed.
    const rawWrite = (rl as any)._writeToOutput as ((s: string) => void);
    let promptWritten = false;
    (rl as any)._writeToOutput = (str: string) => {
      if (!promptWritten) {
        rawWrite.call(rl, str);
        promptWritten = true;
      } else if (str === '\n' || str === '\r\n' || str === '\r') {
        rawWrite.call(rl, '\n');
      } else if (str.length === 1) {
        rawWrite.call(rl, '*');
      }
    };

    rl.question('Enter private key password (press Enter to skip): ', (answer) => {
      rl.close();
      (rl as any)._writeToOutput = rawWrite;

      if (!answer) {
        globalLogger.info('Security',
          'No password entered — helpers will run without HMAC session keys');
        resolve(null);
        return;
      }

      try {
        const pkBytes = certManager.getRawPrivateKeyBytes(answer);
        globalLogger.info('Security', 'Private key decrypted — HMAC session keys enabled');
        resolve(pkBytes);
      } catch (e: any) {
        globalLogger.warn('Security', `Password incorrect — ${e.message}; running without HMAC`);
        resolve(null);
      }
    });
  });
}
