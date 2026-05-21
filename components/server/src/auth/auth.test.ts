/**
 * auth/auth.test.ts
 *
 * Unit tests for:
 *   - JwtService  (sign / verify / expiry / tamper detection / refreshToken)
 *   - PasswordAuthProvider (correct password, wrong password, unknown user)
 *   - ApiKeyAuthProvider   (valid key, revoked/unknown key, JWT re-use)
 *   - AuthService          (factory + refreshToken round-trip)
 *
 * All tests are pure-unit — no HTTP, no disk I/O.
 * IUserStore is faked in-memory; no bcrypt hashes needed for JwtService tests.
 */

import * as crypto from 'crypto';
import { JwtService } from './JwtService';
import { PasswordAuthProvider } from './providers/PasswordAuthProvider';
import { ApiKeyAuthProvider } from './providers/ApiKeyAuthProvider';
import { OAuthProvider } from './providers/OAuthProvider';
import { SamlProvider } from './providers/SamlProvider';
import { CertificateAuthProvider } from './providers/CertificateAuthProvider';
import { JwtConfig, JwtPayload, AuthMode, IUserStore, User, ApiKeyRecord, OAuthConfig, SamlConfig, AuthConfig } from './types';
import { AuthService } from './AuthService';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeJwt(overrides: Partial<JwtConfig> = {}): JwtService {
  return new JwtService({
    enabled: true,
    secret: 'test-secret-do-not-use-in-prod',
    expiryMinutes: 60,
    ...overrides,
  });
}

function testPayload(overrides: Partial<Omit<JwtPayload, 'iat' | 'exp'>> = {}): Omit<JwtPayload, 'iat' | 'exp'> {
  return {
    sub: 'u1',
    username: 'alice',
    roles: ['admin'],
    externalGroups: [],
    authMode: 'password' as AuthMode,
    ...overrides,
  };
}

/** Minimal in-memory IUserStore for PasswordAuthProvider tests */
function makeUserStore(users: User[]): IUserStore {
  return {
    async findByUsername(username: string) { return users.find(u => u.username === username) ?? null; },
    async findByApiKeyHash(hash: string) {
      return users.find(u => u.apiKeys.some(k => k.keyHash === hash)) ?? null;
    },
    async createUser(data: Omit<User, 'id' | 'createdAt' | 'updatedAt'>) {
      const u: User = {
        ...data,
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      users.push(u);
      return u;
    },
    async updateUser(id: string, patch: Partial<Omit<User, 'id'>>) {
      const u = users.find(u => u.id === id);
      if (!u) throw new Error(`User ${id} not found`);
      Object.assign(u, patch);
      return u;
    },
    async deleteUser(id: string) {
      const idx = users.findIndex(u => u.id === id);
      if (idx >= 0) users.splice(idx, 1);
    },
    async listUsers() { return [...users]; },
    async listRoles() { return []; },
    async findRole(_name: string) { return null; },
    async upsertRole(r: any) { return { ...r, id: crypto.randomUUID() }; },
    async deleteRole(_id: string) { /* noop */ },
  };
}

/** Build a fake User with a PBKDF2-compatible passwordHash for PasswordAuthProvider tests */
async function makeUserWithPassword(username: string, password: string): Promise<User> {
  // Use the fallback PBKDF2 hasher from JsonUserStore helper
  const { hashFallback } = await import('./stores/JsonUserStore');
  const passwordHash = hashFallback(password);
  return {
    id: crypto.randomUUID(), username, passwordHash,
    roles: ['user'], apiKeys: [], enabled: true,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  };
}

/** Build a fake User with an API key (SHA-256 hash stored) */
function makeUserWithApiKey(username: string, rawKey: string): User {
  const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');
  const apiKey: ApiKeyRecord = {
    id: crypto.randomUUID(), keyHash, label: 'test-key',
    createdAt: new Date().toISOString(), lastUsedAt: undefined,
  };
  return {
    id: crypto.randomUUID(), username, passwordHash: undefined,
    roles: ['user'], apiKeys: [apiKey], enabled: true,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  };
}

// ─── JwtService tests ─────────────────────────────────────────────────────────

describe('JwtService — sign & verify', () => {
  const jwt = makeJwt();

  it('sign() returns a 3-part JWT string', () => {
    const token = jwt.sign(testPayload());
    const parts = token.split('.');
    expect(parts).toHaveLength(3);
  });

  it('verify() returns the original payload', () => {
    const payload = testPayload({ roles: ['admin', 'operator'] });
    const token = jwt.sign(payload);
    const result = jwt.verify(token);
    expect(result).not.toBeNull();
    expect(result!.username).toBe('alice');
    expect(result!.roles).toEqual(['admin', 'operator']);
    expect(result!.sub).toBe('u1');
    expect(result!.authMode).toBe('password');
  });

  it('verify() adds iat and exp to the payload', () => {
    const token = jwt.sign(testPayload());
    const result = jwt.verify(token)!;
    const now = Math.floor(Date.now() / 1000);
    expect(result.iat).toBeGreaterThanOrEqual(now - 2);
    expect(result.exp).toBeGreaterThan(now);
  });

  it('verify() returns null for a tampered payload', () => {
    const token = jwt.sign(testPayload());
    const [header, , sig] = token.split('.');
    // Swap in a different username in the body
    const fakebody = Buffer.from(JSON.stringify({
      sub: 'u1', username: 'mallory', roles: ['admin'],
      externalGroups: [], authMode: 'password',
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
    })).toString('base64url');
    const tampered = `${header}.${fakebody}.${sig}`;
    expect(jwt.verify(tampered)).toBeNull();
  });

  it('verify() returns null for a token signed with a different secret', () => {
    const jwtOther = makeJwt({ secret: 'other-secret' });
    const token = jwtOther.sign(testPayload());
    expect(jwt.verify(token)).toBeNull();
  });

  it('verify() returns null for an expired token', () => {
    // Sign a token while pretending it's 2 hours in the past so exp = (now-2h) + 1h < now
    const realNow = Date.now;
    const twoHoursAgo = Date.now() - 2 * 60 * 60 * 1000;
    Date.now = () => twoHoursAgo;
    let token: string;
    try {
      token = jwt.sign(testPayload());
    } finally {
      Date.now = realNow;
    }
    // Now verify with real clock — the token's exp is 1 hour in the past
    expect(jwt.verify(token!)).toBeNull();
  });

  it('verify() returns null for a malformed token', () => {
    expect(jwt.verify('not.a.jwt')).toBeNull();
    expect(jwt.verify('')).toBeNull();
    expect(jwt.verify('only.two')).toBeNull();
  });
});

// ─── JwtService — refreshToken ───────────────────────────────────────────────
//
// AuthService.refreshToken() is a thin wrapper around JwtService.verify() +
// JwtService.sign(). We test it entirely through JwtService so we avoid
// spinning up a JsonUserStore (which performs file I/O) in unit tests.

describe('JwtService — refreshToken behaviour', () => {
  const secret = 'refresh-test-secret';
  const jwt = makeJwt({ secret });

  /** Simulate what AuthService.refreshToken does internally */
  function refreshToken(oldToken: string): string | null {
    const payload = jwt.verify(oldToken);
    if (!payload) return null;
    return jwt.sign({
      sub:            payload.sub,
      username:       payload.username,
      roles:          payload.roles,
      externalGroups: payload.externalGroups ?? [],
      authMode:       payload.authMode,
    });
  }

  it('returns a new valid token from a valid old token', () => {
    const oldToken = jwt.sign(testPayload());
    const newToken = refreshToken(oldToken);
    expect(newToken).not.toBeNull();
    // New token must be a valid 3-part JWT and must verify correctly
    const parts = newToken!.split('.');
    expect(parts).toHaveLength(3);
    const payload = jwt.verify(newToken!);
    expect(payload).not.toBeNull();
    expect(payload!.username).toBe('alice');
  });

  it('returns null for an invalid / malformed token', () => {
    expect(refreshToken('not.a.valid.token')).toBeNull();
    expect(refreshToken('')).toBeNull();
  });

  it('preserves username and roles in the refreshed token', () => {
    const oldToken = jwt.sign(testPayload({ username: 'bob', roles: ['operator'] }));
    const newToken = refreshToken(oldToken)!;
    const parts = newToken.split('.');
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString()) as JwtPayload;
    expect(payload.username).toBe('bob');
    expect(payload.roles).toEqual(['operator']);
    expect(payload.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  it('returns null for a token signed with a different secret', () => {
    const otherJwt = makeJwt({ secret: 'different-secret' });
    const foreignToken = otherJwt.sign(testPayload());
    expect(refreshToken(foreignToken)).toBeNull();
  });
});

// ─── PasswordAuthProvider tests ───────────────────────────────────────────────

describe('PasswordAuthProvider', () => {
  let alice: User;
  let store: IUserStore;
  let provider: PasswordAuthProvider;

  beforeAll(async () => {
    alice = await makeUserWithPassword('alice', 'correct-horse-staple');
    store = makeUserStore([alice]);
    const jwt = makeJwt();
    const { PasswordAuthProvider: PAP } = await import('./providers/PasswordAuthProvider');
    provider = new PAP(store, jwt);
  });

  it('succeeds with correct password', async () => {
    const result = await provider.authenticate({ username: 'alice', password: 'correct-horse-staple' });
    expect(result.success).toBe(true);
    expect(result.user?.username).toBe('alice');
    expect(result.token).toBeDefined();
  });

  it('fails with wrong password', async () => {
    const result = await provider.authenticate({ username: 'alice', password: 'wrong-password' });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/invalid credentials/i);
    expect(result.token).toBeUndefined();
  });

  it('fails for unknown user', async () => {
    const result = await provider.authenticate({ username: 'nobody', password: 'pass' });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/invalid credentials/i);
  });

  it('fails when no credentials provided', async () => {
    const result = await provider.authenticate({});
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/required/i);
  });

  it('succeeds with a valid JWT re-use (no password check)', async () => {
    const jwt = makeJwt();
    const jwtToken = jwt.sign(testPayload({ username: 'alice', roles: alice.roles }));
    const result = await provider.authenticate({ jwtToken });
    expect(result.success).toBe(true);
    expect(result.token).toBe(jwtToken);
  });

  it('fails with an invalid JWT re-use', async () => {
    const result = await provider.authenticate({ jwtToken: 'bad.token.here' });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/invalid or expired/i);
  });
});

// ─── ApiKeyAuthProvider tests ─────────────────────────────────────────────────

describe('ApiKeyAuthProvider', () => {
  const RAW_KEY = 'super-secret-raw-api-key-123';
  let bob: User;
  let store: IUserStore;
  let provider: ApiKeyAuthProvider;

  beforeAll(async () => {
    bob = makeUserWithApiKey('bob', RAW_KEY);
    store = makeUserStore([bob]);
    const jwt = makeJwt();
    const { ApiKeyAuthProvider: AKP } = await import('./providers/ApiKeyAuthProvider');
    provider = new AKP(store, jwt);
  });

  it('succeeds with a valid API key', async () => {
    const result = await provider.authenticate({ apiKey: RAW_KEY });
    expect(result.success).toBe(true);
    expect(result.user?.username).toBe('bob');
    expect(result.token).toBeDefined();
  });

  it('fails with an unknown API key', async () => {
    const result = await provider.authenticate({ apiKey: 'not-a-valid-key' });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/invalid api key/i);
  });

  it('fails when no API key provided', async () => {
    const result = await provider.authenticate({});
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/required/i);
  });

  it('succeeds with JWT re-use', async () => {
    const jwt = makeJwt();
    const jwtToken = jwt.sign(testPayload({ username: 'bob', roles: bob.roles, authMode: 'apikey' }));
    const result = await provider.authenticate({ jwtToken });
    expect(result.success).toBe(true);
    expect(result.token).toBe(jwtToken);
  });

  it('fails with invalid JWT re-use', async () => {
    const result = await provider.authenticate({ jwtToken: 'garbage.garbage.garbage' });
    expect(result.success).toBe(false);
  });
});

// ─── OAuthProvider tests ──────────────────────────────────────────────────────

describe('OAuthProvider', () => {
  const OAUTH_CFG: OAuthConfig = {
    clientId: 'test-client',
    clientSecret: 'test-secret',
    authorizationUrl: 'https://idp.example.com/authorize',
    tokenUrl: 'https://idp.example.com/token',
    userInfoUrl: 'https://idp.example.com/userinfo',
    scope: 'openid email',
    callbackUrl: 'https://app.example.com/callback',
    usernamePath: 'email',
    pkce: false,
  };

  let store: IUserStore;
  let provider: OAuthProvider;
  const origFetch = (globalThis as any).fetch;

  beforeEach(() => {
    store = makeUserStore([]);
    provider = new OAuthProvider(OAUTH_CFG, store, makeJwt());
  });

  afterEach(() => {
    (globalThis as any).fetch = origFetch;
  });

  /** Replace globalThis.fetch for one token-exchange + one userInfo call */
  function mockFetch(tokenRes: Record<string, string>, userInfoRes: Record<string, unknown>): void {
    let call = 0;
    (globalThis as any).fetch = async (_url: string) => {
      const data: unknown = ++call === 1 ? tokenRes : userInfoRes;
      return { json: async () => data } as unknown as Response;
    };
  }

  it('getRedirectUrl() returns correct authorization URL', async () => {
    const url = await provider.getRedirectUrl('my-state');
    expect(url).toContain('https://idp.example.com/authorize');
    expect(url).toContain('client_id=test-client');
    expect(url).toContain('state=my-state');
    expect(url).toContain('scope=openid');
  });

  it('authenticate() auto-provisions user and returns JWT', async () => {
    mockFetch({ access_token: 'tok123' }, { email: 'alice@example.com' });
    const result = await provider.authenticate({ oauthCode: 'code-abc' });
    expect(result.success).toBe(true);
    expect(result.user?.username).toBe('alice@example.com');
    expect(result.token).toBeDefined();
  });

  it('authenticate() resolves nested usernamePath (user.email)', async () => {
    const p2 = new OAuthProvider({ ...OAUTH_CFG, usernamePath: 'user.email' }, makeUserStore([]), makeJwt());
    mockFetch({ access_token: 'tok' }, { user: { email: 'bob@nested.example' } });
    const result = await p2.authenticate({ oauthCode: 'code-nested' });
    expect(result.success).toBe(true);
    expect(result.user?.username).toBe('bob@nested.example');
  });

  it('authenticate() extracts externalGroups via groupsPath', async () => {
    const p2 = new OAuthProvider({ ...OAUTH_CFG, groupsPath: 'groups' }, makeUserStore([]), makeJwt());
    mockFetch({ access_token: 'tok' }, { email: 'carol@example.com', groups: ['admins', 'ops'] });
    const result = await p2.authenticate({ oauthCode: 'code-groups' });
    expect(result.success).toBe(true);
    expect(result.externalGroups).toEqual(['admins', 'ops']);
  });

  it('authenticate() fails when IdP token exchange returns error', async () => {
    mockFetch({ error: 'invalid_client' }, {});
    const result = await provider.authenticate({ oauthCode: 'bad-code' });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/token exchange failed/i);
  });

  it('authenticate() honours JWT re-use', async () => {
    const jwt = makeJwt();
    const user: User = {
      id: crypto.randomUUID(), username: 'alice@example.com',
      roles: ['user'], apiKeys: [], enabled: true,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    const p2 = new OAuthProvider(OAUTH_CFG, makeUserStore([user]), jwt);
    const token = jwt.sign(testPayload({ username: 'alice@example.com', authMode: 'oauth' }));
    const result = await p2.authenticate({ jwtToken: token });
    expect(result.success).toBe(true);
    expect(result.token).toBe(token);
  });
});

// ─── SamlProvider tests ───────────────────────────────────────────────────────

describe('SamlProvider', () => {
  const SAML_CFG: SamlConfig = {
    entryPoint: 'https://idp.example.com/sso',
    issuer: 'https://app.example.com',
    cert: 'PLACEHOLDER',           // not used by fallback parser
    callbackUrl: 'https://app.example.com/saml/callback',
    usernamePath: 'nameID',
    signatureAlgorithm: 'sha256',
  };

  /**
   * Build a minimal SAML XML that parseSimple() can digest.
   * Each group is a SEPARATE <saml:Attribute Name="groups"> element so that
   * parseSimple's global regex (which re-searches for 'Name="groups"' each
   * iteration) picks up every value.
   */
  function makeSamlXml(nameId: string, groups: string[] = []): string {
    const groupAttrs = groups.length
      ? groups.map(g =>
          `<saml:Attribute Name="groups"><saml:AttributeValue>${g}</saml:AttributeValue></saml:Attribute>`
        ).join('\n      ')
      : '';
    return [
      '<?xml version="1.0"?>',
      '<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol"',
      '  xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion">',
      '  <saml:Assertion>',
      '    <saml:Subject><saml:NameID>',
      `      ${nameId}`,
      '    </saml:NameID></saml:Subject>',
      '    <saml:AttributeStatement>',
      `      ${groupAttrs}`,
      '    </saml:AttributeStatement>',
      '  </saml:Assertion>',
      '</samlp:Response>',
    ].join('\n');
  }

  function b64(xml: string): string { return Buffer.from(xml).toString('base64'); }

  let store: IUserStore;
  let provider: SamlProvider;

  beforeEach(() => {
    store = makeUserStore([]);
    provider = new SamlProvider(SAML_CFG, store, makeJwt());
  });

  it('getRedirectUrl() includes SAMLRequest and starts with entryPoint', async () => {
    const url = await provider.getRedirectUrl('relay1');
    expect(url).toContain('https://idp.example.com/sso');
    expect(url).toContain('SAMLRequest=');
  });

  it('authenticate() auto-provisions user from nameID (fallback parser)', async () => {
    const xml = makeSamlXml('alice@saml.example');
    const result = await provider.authenticate({ samlResponse: b64(xml) });
    expect(result.success).toBe(true);
    expect(result.user?.username).toBe('alice@saml.example');
    expect(result.token).toBeDefined();
  });

  it('authenticate() extracts externalGroups via groupsPath', async () => {
    const p2 = new SamlProvider({ ...SAML_CFG, groupsPath: 'groups' }, makeUserStore([]), makeJwt());
    const xml = makeSamlXml('bob@saml.example', ['saml-admin', 'saml-ops']);
    const result = await p2.authenticate({ samlResponse: b64(xml) });
    expect(result.success).toBe(true);
    expect(result.externalGroups).toEqual(['saml-admin', 'saml-ops']);
  });

  it('authenticate() fails when SAMLResponse is missing', async () => {
    const result = await provider.authenticate({});
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/missing/i);
  });

  it('authenticate() honours JWT re-use', async () => {
    const jwt = makeJwt();
    const user: User = {
      id: crypto.randomUUID(), username: 'carol@saml.example',
      roles: [], apiKeys: [], enabled: true,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    const p2 = new SamlProvider(SAML_CFG, makeUserStore([user]), jwt);
    const token = jwt.sign(testPayload({ username: 'carol@saml.example', authMode: 'saml' }));
    const result = await p2.authenticate({ jwtToken: token });
    expect(result.success).toBe(true);
    expect(result.token).toBe(token);
  });
});

// ─── CertificateAuthProvider tests ────────────────────────────────────────────

describe('CertificateAuthProvider', () => {
  /**
   * Self-signed RSA cert generated for testing (CN=TestUser, O=TestOrg).
   * Generated by: openssl req -x509 -newkey rsa:2048 -keyout /dev/null -out - -days 3650 -nodes -subj "/CN=TestUser/O=TestOrg"
   */
  const TEST_CERT_PEM = [
    '-----BEGIN CERTIFICATE-----',
    'MIIDKzCCAhOgAwIBAgIUbI/eLS0XCOPj+dAm58cguyqA3AgwDQYJKoZIhvcNAQEL',
    'BQAwJTERMA8GA1UEAwwIVGVzdFVzZXIxEDAOBgNVBAoMB1Rlc3RPcmcwHhcNMjYw',
    'NDE0MDkyOTExWhcNMzYwNDExMDkyOTExWjAlMREwDwYDVQQDDAhUZXN0VXNlcjEQ',
    'MA4GA1UECgwHVGVzdE9yZzCCASIwDQYJKoZIhvcNAQEBBQADggEPADCCAQoCggEB',
    'ANud+Gvq4Z4N2vgslL0+DfpGg4sr9htcaJqBE8VjWyAZRkGzH+fyLD2ugK0+B5Ci',
    '0mfWJbwgU9RBQM5Ox3os2cicVdgzvzQ67SkCc8Yi401Xvsk+ygaL2Ad7apeTGS6T',
    'DeaObFDRiYhC7s8ko+ZDEtO3AccidTOSUUFdUIzu2Ff2U5TMRu5480RgFCRNE4N/',
    'dh5w9ekSdmULMxzUFxopwhtzHVr2tHlQO56bPJlSB0WeLvoGJFRt3Q6Oub80gpDb',
    'GapE8013+wuopYiEF9IIx4NrzMf9tSUwxhaNyrsRfr/vVHUcGaaJRYWndh7cPI11',
    'zo60QFzMjG9A7K6AMlcWLacCAwEAAaNTMFEwHQYDVR0OBBYEFGbJldL3jpQ4WQON',
    'mismAC3WwwDoMB8GA1UdIwQYMBaAFGbJldL3jpQ4WQONmismAC3WwwDoMA8GA1Ud',
    'EwEB/wQFMAMBAf8wDQYJKoZIhvcNAQELBQADggEBAENmYwpLGnjJSGLAChNfSmCi',
    '1B72G6EJjOlv+k7O8xbgI/s0ju5aaR+X82iIfzjLAX00+yG8mKf9c9RbWWraQ0F/',
    'C8wTHGzGK42ZWzYWw43vnDfRUtIlY1zGISUFwLBs43MnFZ5gYAsmvWpVu5/6Bjyo',
    'FJdDV+d1CSzAh8Tv8OPTF1QkeqyOsjMlcasBUsgPO2xtXNtjoLrnY+AHHXcFQA0u',
    'T9KiU6H4IVsd4oNHSfFoyw2eTHMnX5znOV7H5OsGDOxFyJ1ozktFzbWJnNb8JI15',
    'EVOwP/bMVfc/8zLfS7GIvy3Wj/4K49QUv/NT7hNBXnA+IX2aFlB+OTOV0RP/9n8=',
    '-----END CERTIFICATE-----',
  ].join('\n');

  let store: IUserStore;
  let provider: CertificateAuthProvider;

  beforeEach(() => {
    store = makeUserStore([]);
    provider = new CertificateAuthProvider(store, makeJwt()); // no caPath → skip CA verify
  });

  it('authenticate() extracts CN and auto-provisions user', async () => {
    const result = await provider.authenticate({ clientCert: TEST_CERT_PEM });
    expect(result.success).toBe(true);
    expect(result.user?.username).toBe('TestUser');
    expect(result.token).toBeDefined();
  });

  it('authenticate() re-uses an existing user for the same CN', async () => {
    await provider.authenticate({ clientCert: TEST_CERT_PEM }); // first call provisions
    const users = await store.listUsers();
    expect(users).toHaveLength(1);
    await provider.authenticate({ clientCert: TEST_CERT_PEM }); // second call reuses
    expect(await store.listUsers()).toHaveLength(1);             // still only one user
  });

  it('authenticate() fails with invalid (garbage) certificate', async () => {
    const result = await provider.authenticate({ clientCert: '-----BEGIN CERTIFICATE-----\nZ2FyYmFnZQ==\n-----END CERTIFICATE-----' });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/CN|certificate/i);
  });

  it('authenticate() fails when no certificate is provided', async () => {
    const result = await provider.authenticate({});
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/required/i);
  });

  it('authenticate() honours JWT re-use', async () => {
    const jwt = makeJwt();
    const user: User = {
      id: crypto.randomUUID(), username: 'TestUser',
      roles: ['operator'], apiKeys: [], enabled: true,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    const p2 = new CertificateAuthProvider(makeUserStore([user]), jwt);
    const token = jwt.sign(testPayload({ username: 'TestUser', authMode: 'certificate' }));
    const result = await p2.authenticate({ jwtToken: token });
    expect(result.success).toBe(true);
    expect(result.token).toBe(token);
  });
});

// ─── AuthService — factory ────────────────────────────────────────────────────

describe('AuthService — create() factory', () => {
  const MIN_JWT: JwtConfig = {
    enabled: false,
    secret: 'test-secret-auth-service-factory',
    expiryMinutes: 60,
  };

  function minCfg(mode: AuthMode, extra: Partial<AuthConfig> = {}): AuthConfig {
    return {
      mode,
      jwt: MIN_JWT,
      debugExternalAuth: false,
      users: { storeSource: 'json', jsonPath: '/dev/null/nonexistent.json' },
      ...extra,
    } as AuthConfig;
  }

  // Prevent JsonUserStore from touching disk in all tests in this block
  beforeAll(async () => {
    const { JsonUserStore } = await import('./stores/JsonUserStore');
    jest.spyOn(JsonUserStore.prototype, 'initialize').mockResolvedValue(undefined as any);
    jest.spyOn(JsonUserStore.prototype, 'findByUsername').mockResolvedValue(null);
    jest.spyOn(JsonUserStore.prototype, 'findByApiKeyHash').mockResolvedValue(null);
    jest.spyOn(JsonUserStore.prototype, 'listUsers').mockResolvedValue([]);
    jest.spyOn(JsonUserStore.prototype, 'listRoles').mockResolvedValue([]);
  });

  afterAll(() => jest.restoreAllMocks());

  it('none mode: service.mode is "none" and authenticate always succeeds', async () => {
    const svc = await AuthService.create(minCfg('none'));
    expect(svc.mode).toBe('none');
    const r = await svc.authenticate({});
    expect(r.success).toBe(true);
  });

  it('password mode: service.mode is "password"', async () => {
    const svc = await AuthService.create(minCfg('password'));
    expect(svc.mode).toBe('password');
  });

  it('apikey mode: service.mode is "apikey"', async () => {
    const svc = await AuthService.create(minCfg('apikey'));
    expect(svc.mode).toBe('apikey');
  });

  it('certificate mode: service.mode is "certificate"', async () => {
    const svc = await AuthService.create(minCfg('certificate'));
    expect(svc.mode).toBe('certificate');
  });

  it('oauth mode without oauth config: throws', async () => {
    await expect(AuthService.create(minCfg('oauth'))).rejects.toThrow(/oauth/i);
  });

  it('oauth mode with oauth config: service.mode is "oauth"', async () => {
    const oauthCfg: OAuthConfig = {
      clientId: 'c', clientSecret: 's',
      authorizationUrl: 'https://idp.example.com/auth',
      tokenUrl: 'https://idp.example.com/token',
      userInfoUrl: 'https://idp.example.com/userinfo',
      scope: 'openid', callbackUrl: 'https://app.example.com/cb',
      usernamePath: 'email', pkce: false,
    };
    const svc = await AuthService.create(minCfg('oauth', { oauth: oauthCfg }));
    expect(svc.mode).toBe('oauth');
  });

  it('saml mode without saml config: throws', async () => {
    await expect(AuthService.create(minCfg('saml'))).rejects.toThrow(/saml/i);
  });

  it('unknown mode: throws', async () => {
    await expect(AuthService.create(minCfg('unknown' as AuthMode))).rejects.toThrow(/unknown/i);
  });
});

// ─── AuthService — refreshToken round-trip ────────────────────────────────────

describe('AuthService — refreshToken', () => {
  const JWT_SECRET = 'refresh-round-trip-secret';
  let svc: AuthService;

  beforeAll(async () => {
    const { JsonUserStore } = await import('./stores/JsonUserStore');
    jest.spyOn(JsonUserStore.prototype, 'initialize').mockResolvedValue(undefined as any);
    jest.spyOn(JsonUserStore.prototype, 'findByUsername').mockResolvedValue(null);
    jest.spyOn(JsonUserStore.prototype, 'findByApiKeyHash').mockResolvedValue(null);
    jest.spyOn(JsonUserStore.prototype, 'listUsers').mockResolvedValue([]);
    jest.spyOn(JsonUserStore.prototype, 'listRoles').mockResolvedValue([]);

    svc = await AuthService.create({
      mode: 'none',
      jwt: { enabled: true, secret: JWT_SECRET, expiryMinutes: 60 },
      debugExternalAuth: false,
      users: { storeSource: 'json', jsonPath: '/dev/null/nonexistent.json' },
    });
  });

  afterAll(() => jest.restoreAllMocks());

  it('returns a new valid token from a valid old token', () => {
    const jwt = makeJwt({ secret: JWT_SECRET });
    const old = jwt.sign(testPayload());
    const refreshed = svc.refreshToken(old);
    expect(refreshed).not.toBeNull();
    expect(refreshed!.split('.')).toHaveLength(3);
    expect(jwt.verify(refreshed!)).not.toBeNull();
  });

  it('preserves username and roles in the refreshed token', () => {
    const jwt = makeJwt({ secret: JWT_SECRET });
    const old = jwt.sign(testPayload({ username: 'carol', roles: ['operator'] }));
    const refreshed = svc.refreshToken(old)!;
    const payload = JSON.parse(Buffer.from(refreshed.split('.')[1], 'base64url').toString());
    expect(payload.username).toBe('carol');
    expect(payload.roles).toEqual(['operator']);
  });

  it('returns null for an expired / invalid token', () => {
    expect(svc.refreshToken('not.a.jwt')).toBeNull();
    expect(svc.refreshToken('')).toBeNull();
  });

  it('returns null for a token signed with a different secret', () => {
    const otherJwt = makeJwt({ secret: 'other-secret-xyz' });
    const token = otherJwt.sign(testPayload());
    expect(svc.refreshToken(token)).toBeNull();
  });
});
