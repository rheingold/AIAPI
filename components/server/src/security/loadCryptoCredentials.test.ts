/**
 * Unit tests for loadCryptoCredentials().
 *
 * Coverage:
 *   - No private key on disk → null (security not initialised)
 *   - KEY_PASSWORD env var set, correct password → Buffer of DER bytes
 *   - KEY_PASSWORD env var set, wrong password → warn + fall-through to stdin
 *   - KEY_PASSWORD env + stdin not TTY → null (non-interactive, graceful skip)
 *   - stdin not TTY, no KEY_PASSWORD → null
 *   - stdin is TTY, user submits correct password → Buffer
 *   - stdin is TTY, user presses Enter (empty answer) → null
 *   - stdin is TTY, user submits wrong password → null
 */

jest.mock('./CertificateManager');
jest.mock('readline');

import * as readline from 'readline';
import { CertificateManager } from './CertificateManager';
import { loadCryptoCredentials } from './loadCryptoCredentials';

// ── helpers ──────────────────────────────────────────────────────────────────

const FAKE_PK_BYTES = Buffer.from('deadbeef', 'hex');

/** Configure the CertificateManager mock for a given scenario. */
function mockCertManager(opts: {
  privateExists: boolean;
  correctPassword?: string;
}) {
  const keysExistMock = jest.fn().mockReturnValue({
    public: opts.privateExists,
    private: opts.privateExists,
  });
  const getRawMock = jest.fn((password: string) => {
    if (opts.correctPassword && password === opts.correctPassword) {
      return FAKE_PK_BYTES;
    }
    throw new Error('bad decrypt');
  });

  (CertificateManager as jest.MockedClass<typeof CertificateManager>).mockImplementation(
    () => ({ keysExist: keysExistMock, getRawPrivateKeyBytes: getRawMock } as any),
  );

  return { keysExistMock, getRawMock };
}

/** Build a fake readline interface that immediately calls the callback with `answer`. */
function mockReadline(answer: string) {
  const rl: any = {
    question: jest.fn((_prompt: string, cb: (a: string) => void) => cb(answer)),
    close: jest.fn(),
    _writeToOutput: jest.fn(),
  };
  (readline.createInterface as jest.Mock).mockReturnValue(rl);
  return rl;
}

// ── env / stdin helpers ───────────────────────────────────────────────────────

let savedKeyPassword: string | undefined;
let savedIsTTY: boolean | undefined;

beforeEach(() => {
  savedKeyPassword = process.env['KEY_PASSWORD'];
  delete process.env['KEY_PASSWORD'];

  savedIsTTY = (process.stdin as any).isTTY;
  Object.defineProperty(process.stdin, 'isTTY', { value: false, configurable: true });

  jest.clearAllMocks();
});

afterEach(() => {
  if (savedKeyPassword !== undefined) {
    process.env['KEY_PASSWORD'] = savedKeyPassword;
  } else {
    delete process.env['KEY_PASSWORD'];
  }
  Object.defineProperty(process.stdin, 'isTTY', { value: savedIsTTY, configurable: true });
});

// ── tests ─────────────────────────────────────────────────────────────────────

describe('loadCryptoCredentials()', () => {
  describe('no private key on disk', () => {
    it('returns null immediately', async () => {
      mockCertManager({ privateExists: false });
      const result = await loadCryptoCredentials('/fake/security');
      expect(result).toBeNull();
    });

    it('does not attempt getRawPrivateKeyBytes', async () => {
      const { getRawMock } = mockCertManager({ privateExists: false });
      await loadCryptoCredentials('/fake/security');
      expect(getRawMock).not.toHaveBeenCalled();
    });
  });

  describe('KEY_PASSWORD env var', () => {
    it('returns Buffer on correct password', async () => {
      mockCertManager({ privateExists: true, correctPassword: 'secret' });
      process.env['KEY_PASSWORD'] = 'secret';

      const result = await loadCryptoCredentials('/fake/security');
      expect(Buffer.isBuffer(result)).toBe(true);
      expect(result).toEqual(FAKE_PK_BYTES);
    });

    it('returns null when password decryption fails and stdin is not TTY', async () => {
      mockCertManager({ privateExists: true, correctPassword: 'secret' });
      process.env['KEY_PASSWORD'] = 'wrong';

      const result = await loadCryptoCredentials('/fake/security');
      expect(result).toBeNull();
    });

    it('does not open readline when env var succeeds', async () => {
      mockCertManager({ privateExists: true, correctPassword: 'secret' });
      process.env['KEY_PASSWORD'] = 'secret';
      await loadCryptoCredentials('/fake/security');
      expect(readline.createInterface).not.toHaveBeenCalled();
    });
  });

  describe('stdin not TTY', () => {
    it('returns null without KEY_PASSWORD', async () => {
      mockCertManager({ privateExists: true, correctPassword: 'secret' });
      // isTTY = false (default from beforeEach)
      const result = await loadCryptoCredentials('/fake/security');
      expect(result).toBeNull();
    });

    it('does not open readline', async () => {
      mockCertManager({ privateExists: true, correctPassword: 'secret' });
      await loadCryptoCredentials('/fake/security');
      expect(readline.createInterface).not.toHaveBeenCalled();
    });
  });

  describe('stdin is TTY (interactive prompt)', () => {
    beforeEach(() => {
      Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
    });

    it('returns Buffer when user enters correct password', async () => {
      mockCertManager({ privateExists: true, correctPassword: 'mysecret' });
      mockReadline('mysecret');

      const result = await loadCryptoCredentials('/fake/security');
      expect(Buffer.isBuffer(result)).toBe(true);
      expect(result).toEqual(FAKE_PK_BYTES);
    });

    it('returns null when user presses Enter (empty answer)', async () => {
      mockCertManager({ privateExists: true, correctPassword: 'mysecret' });
      mockReadline('');

      const result = await loadCryptoCredentials('/fake/security');
      expect(result).toBeNull();
    });

    it('returns null when user enters wrong password', async () => {
      mockCertManager({ privateExists: true, correctPassword: 'mysecret' });
      mockReadline('wrongpassword');

      const result = await loadCryptoCredentials('/fake/security');
      expect(result).toBeNull();
    });

    it('closes the readline interface after answer', async () => {
      mockCertManager({ privateExists: true, correctPassword: 'pass' });
      const rl = mockReadline('pass');

      await loadCryptoCredentials('/fake/security');
      expect(rl.close).toHaveBeenCalled();
    });

    it('calls getRawPrivateKeyBytes with the typed answer', async () => {
      const { getRawMock } = mockCertManager({ privateExists: true, correctPassword: 'typed' });
      mockReadline('typed');

      await loadCryptoCredentials('/fake/security');
      expect(getRawMock).toHaveBeenCalledWith('typed');
    });

    it('KEY_PASSWORD env var skips readline even when stdin is TTY', async () => {
      mockCertManager({ privateExists: true, correctPassword: 'envpass' });
      process.env['KEY_PASSWORD'] = 'envpass';
      mockReadline('should-not-be-called');

      await loadCryptoCredentials('/fake/security');
      expect(readline.createInterface).not.toHaveBeenCalled();
    });
  });
});
