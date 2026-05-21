/**
 * server/internalHandlers.ts
 *
 * REST endpoint handlers for the _internal pseudo-helper (CONVENTIONS.md §6.3).
 *
 * All handlers require an AuthContext with appropriate _internal permissions.
 * They are registered in httpServerWithDashboard.ts under /api/auth/* and
 * /api/_internal/*.
 *
 * Exported as plain async functions so they can be called from the main router
 * and unit-tested independently.
 */

import * as http from 'http';
import * as crypto from 'crypto';
import { AuthService } from '../auth/AuthService';
import { AuthMiddleware, AuthedRequest, AUTH_CONTEXT_KEY } from '../auth/AuthMiddleware';
import { User, AuthCredentials } from '../auth/types';
import { generateApiKey } from '../auth/stores/JsonUserStore';
import { DbProvisioner } from '../db/DbProvisioner';
import { DbConfig } from '../settings/types';
import { globalLogger } from '../utils/Logger';

const TAG = 'InternalHandlers';

// ─── Shared helpers ───────────────────────────────────────────────────────────

async function readBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf-8'))); }
      catch { resolve({}); }
    });
    req.on('error', reject);
  });
}

function json(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function forbidden(res: http.ServerResponse, operation: string): void {
  json(res, 403, { error: 'Forbidden', detail: `Operation '${operation}' requires elevated role` });
}

function notFound(res: http.ServerResponse, id: string): void {
  json(res, 404, { error: 'Not Found', id });
}

// ─── Auth endpoints ───────────────────────────────────────────────────────────

/** POST /api/auth/login — body: { username, password } | { apiKey } */
export async function handleAuthLogin(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  authService: AuthService,
): Promise<void> {
  const body = await readBody(req) as { username?: string; password?: string; apiKey?: string };
  const creds: AuthCredentials = {
    username: body.username,
    password: body.password,
    apiKey: body.apiKey,
  };
  const result = await authService.authenticate(creds);
  if (result.success) {
    // Set cookie for browser sessions
    if (result.token) {
      res.setHeader('Set-Cookie', `aiapi_session=${result.token}; HttpOnly; SameSite=Strict; Path=/`);
    }
    json(res, 200, { token: result.token, username: result.user?.username, roles: result.user?.roles });
  } else {
    json(res, 401, { error: result.error ?? 'Authentication failed' });
  }
}

/** POST /api/auth/logout */
export function handleAuthLogout(
  _req: http.IncomingMessage,
  res: http.ServerResponse,
): void {
  res.setHeader('Set-Cookie', 'aiapi_session=; Max-Age=0; Path=/');
  json(res, 200, { ok: true });
}

/** POST /api/auth/refresh — body: { token } OR Authorization: Bearer <token> OR aiapi_session cookie */
export async function handleAuthRefresh(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  authService: AuthService,
): Promise<void> {
  // Accept token from JSON body, Authorization header, or existing session cookie
  const body = await readBody(req) as { token?: string };
  const headerToken = String(req.headers['authorization'] ?? '').replace(/^Bearer\s+/i, '');
  const cookieToken = (req.headers['cookie'] ?? '')
    .split(';')
    .map((c) => c.trim())
    .find((c) => c.startsWith('aiapi_session='))
    ?.slice('aiapi_session='.length);
  const oldToken = body.token || headerToken || cookieToken;
  if (!oldToken) {
    json(res, 400, { error: 'token required in body, Authorization header, or session cookie' });
    return;
  }
  const newToken = authService.refreshToken(oldToken);
  if (!newToken) {
    json(res, 401, { error: 'Token invalid or expired — please log in again' });
    return;
  }
  res.setHeader('Set-Cookie', `aiapi_session=${newToken}; HttpOnly; SameSite=Strict; Path=/`);
  json(res, 200, { token: newToken });
}

/** GET /api/auth/status */
export function handleAuthStatus(
  req: AuthedRequest,
  res: http.ServerResponse,
): void {
  const ctx = req[AUTH_CONTEXT_KEY];
  if (!ctx?.authenticated) {
    json(res, 401, { authenticated: false });
    return;
  }
  json(res, 200, {
    authenticated: true,
    username: ctx.user?.username,
    roles: ctx.effectiveRoles,
    authMode: ctx.authMode,
  });
}

/** GET /api/auth/oauth/redirect */
export async function handleOAuthRedirect(
  _req: http.IncomingMessage,
  res: http.ServerResponse,
  authService: AuthService,
): Promise<void> {
  const redirectUrl = await authService.getRedirectUrl();
  if (!redirectUrl) {
    json(res, 400, { error: 'OAuth not configured' });
    return;
  }
  res.writeHead(302, { Location: redirectUrl });
  res.end();
}

/** GET /api/auth/oauth/callback?code=…&state=… */
export async function handleOAuthCallback(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  authService: AuthService,
): Promise<void> {
  const u = new URL(req.url!, `http://${req.headers.host ?? 'localhost'}`);
  const code = u.searchParams.get('code') ?? undefined;
  const state = u.searchParams.get('state') ?? undefined;
  const result = await authService.authenticate({ oauthCode: code, oauthState: state });
  if (result.success && result.token) {
    res.setHeader('Set-Cookie', `aiapi_session=${result.token}; HttpOnly; SameSite=Strict; Path=/`);
    json(res, 200, { token: result.token, username: result.user?.username });
  } else {
    json(res, 401, { error: result.error });
  }
}

/** GET /api/auth/saml/redirect */
export async function handleSamlRedirect(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  authService: AuthService,
): Promise<void> {
  const relayState = new URL(req.url!, `http://${req.headers.host ?? 'localhost'}`).searchParams.get('relayState') ?? undefined;
  const redirectUrl = await authService.getRedirectUrl(relayState);
  if (!redirectUrl) {
    json(res, 400, { error: 'SAML not configured' });
    return;
  }
  res.writeHead(302, { Location: redirectUrl });
  res.end();
}

/** POST /api/auth/saml/callback — body: SAMLResponse (application/x-www-form-urlencoded) */
export async function handleSamlCallback(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  authService: AuthService,
): Promise<void> {
  const body = await readRawBody(req);
  const params = new URLSearchParams(body);
  const samlResponse = params.get('SAMLResponse') ?? undefined;
  const relayState = params.get('RelayState') ?? undefined;
  const result = await authService.authenticate({ samlResponse, samlRelayState: relayState });
  if (result.success && result.token) {
    res.setHeader('Set-Cookie', `aiapi_session=${result.token}; HttpOnly; SameSite=Strict; Path=/`);
    json(res, 200, { token: result.token, username: result.user?.username });
  } else {
    json(res, 401, { error: result.error });
  }
}

// ─── User management (/api/_internal/users) ───────────────────────────────────

/** GET /api/_internal/users */
export async function handleInternalListUsers(
  req: AuthedRequest,
  res: http.ServerResponse,
  authService: AuthService,
): Promise<void> {
  const ctx = req[AUTH_CONTEXT_KEY];
  if (!AuthMiddleware.hasInternalPermission(ctx, 'access')) {
    forbidden(res, 'access'); return;
  }
  const users = await authService.listUsers();
  // Never expose password hashes
  json(res, 200, users.map(sanitize));
}

/** POST /api/_internal/users */
export async function handleInternalCreateUser(
  req: AuthedRequest,
  res: http.ServerResponse,
  authService: AuthService,
): Promise<void> {
  const ctx = req[AUTH_CONTEXT_KEY];
  if (!AuthMiddleware.hasInternalPermission(ctx, 'settings_change')) {
    forbidden(res, 'settings_change'); return;
  }
  const body = await readBody(req) as Partial<User> & { password?: string };
  if (!body.username) { json(res, 400, { error: 'username required' }); return; }

  let passwordHash: string | undefined;
  if (body.password) {
    const { importBcrypt, hashFallback } = await import('../auth/stores/JsonUserStore');
    const bcrypt = await importBcrypt();
    passwordHash = bcrypt
      ? await bcrypt.hash(body.password, 12)
      : hashFallback(body.password);
  }

  const user = await authService.createUser({
    username: body.username,
    passwordHash,
    apiKeys: [],
    roles: body.roles ?? [],
    enabled: body.enabled ?? true,
  });
  json(res, 201, sanitize(user));
}

/** PUT /api/_internal/users/:id */
export async function handleInternalUpdateUser(
  req: AuthedRequest,
  res: http.ServerResponse,
  authService: AuthService,
  id: string,
): Promise<void> {
  const ctx = req[AUTH_CONTEXT_KEY];
  if (!AuthMiddleware.hasInternalPermission(ctx, 'settings_change')) {
    forbidden(res, 'settings_change'); return;
  }
  const body = await readBody(req) as Partial<User> & { password?: string };
  const patch: Partial<Omit<User, 'id'>> = {};
  if (body.roles) patch.roles = body.roles;
  if (body.enabled !== undefined) patch.enabled = body.enabled;
  if (body.password) {
    const { importBcrypt, hashFallback } = await import('../auth/stores/JsonUserStore');
    const bcrypt = await importBcrypt();
    patch.passwordHash = bcrypt
      ? await bcrypt.hash(body.password, 12)
      : hashFallback(body.password);
  }
  try {
    const updated = await authService.updateUser(id, patch);
    json(res, 200, sanitize(updated));
  } catch (e) {
    notFound(res, id);
  }
}

/** DELETE /api/_internal/users/:id */
export async function handleInternalDeleteUser(
  req: AuthedRequest,
  res: http.ServerResponse,
  authService: AuthService,
  id: string,
): Promise<void> {
  const ctx = req[AUTH_CONTEXT_KEY];
  if (!AuthMiddleware.hasInternalPermission(ctx, 'settings_change')) {
    forbidden(res, 'settings_change'); return;
  }
  try {
    await authService.deleteUser(id);
    json(res, 200, { ok: true });
  } catch {
    notFound(res, id);
  }
}

/** POST /api/_internal/users/:id/apikeys */
export async function handleInternalCreateApiKey(
  req: AuthedRequest,
  res: http.ServerResponse,
  authService: AuthService,
  userId: string,
): Promise<void> {
  const ctx = req[AUTH_CONTEXT_KEY];
  if (!AuthMiddleware.hasInternalPermission(ctx, 'settings_change')) {
    forbidden(res, 'settings_change'); return;
  }
  const body = await readBody(req) as { label?: string };
  const { raw, record } = generateApiKey();
  record.label = body.label ?? '';

  const user = await authService.findByUsername(userId) ??
    (await authService.listUsers()).find(u => u.id === userId);
  if (!user) { notFound(res, userId); return; }

  user.apiKeys.push(record);
  await authService.updateUser(user.id, { apiKeys: user.apiKeys });
  // Return the raw key ONCE — it is never stored in plaintext
  json(res, 201, { id: record.id, label: record.label, rawKey: raw, createdAt: record.createdAt });
}

/** DELETE /api/_internal/users/:id/apikeys/:keyId */
export async function handleInternalRevokeApiKey(
  req: AuthedRequest,
  res: http.ServerResponse,
  authService: AuthService,
  userId: string,
  keyId: string,
): Promise<void> {
  const ctx = req[AUTH_CONTEXT_KEY];
  if (!AuthMiddleware.hasInternalPermission(ctx, 'settings_change')) {
    forbidden(res, 'settings_change'); return;
  }
  const user = (await authService.listUsers()).find(u => u.id === userId);
  if (!user) { notFound(res, userId); return; }
  const before = user.apiKeys.length;
  user.apiKeys = user.apiKeys.filter(k => k.id !== keyId);
  if (user.apiKeys.length === before) { notFound(res, keyId); return; }
  await authService.updateUser(user.id, { apiKeys: user.apiKeys });
  json(res, 200, { ok: true });
}

// ─── Role management (/api/_internal/roles) ────────────────────────────────────

/** GET /api/_internal/roles */
export async function handleInternalListRoles(
  req: AuthedRequest,
  res: http.ServerResponse,
  authService: AuthService,
): Promise<void> {
  const ctx = req[AUTH_CONTEXT_KEY];
  if (!AuthMiddleware.hasInternalPermission(ctx, 'access')) {
    forbidden(res, 'access'); return;
  }
  json(res, 200, await authService.listRoles());
}

/** POST /api/_internal/roles */
export async function handleInternalCreateRole(
  req: AuthedRequest,
  res: http.ServerResponse,
  authService: AuthService,
): Promise<void> {
  const ctx = req[AUTH_CONTEXT_KEY];
  if (!AuthMiddleware.hasInternalPermission(ctx, 'settings_change')) {
    forbidden(res, 'settings_change'); return;
  }
  const body = await readBody(req) as { name?: string; description?: string; permissions?: unknown[] };
  if (!body.name) { json(res, 400, { error: 'name required' }); return; }
  const role = await authService.upsertRole({
    name: body.name,
    description: body.description,
    permissions: (body.permissions ?? []) as import('../auth/types').Permission[],
  });
  json(res, 201, role);
}

/** PUT /api/_internal/roles/:id */
export async function handleInternalUpdateRole(
  req: AuthedRequest,
  res: http.ServerResponse,
  authService: AuthService,
  id: string,
): Promise<void> {
  const ctx = req[AUTH_CONTEXT_KEY];
  if (!AuthMiddleware.hasInternalPermission(ctx, 'settings_change')) {
    forbidden(res, 'settings_change'); return;
  }
  const body = await readBody(req) as { name?: string; description?: string; permissions?: unknown[] };
  const existing = (await authService.listRoles()).find(r => r.id === id);
  if (!existing) { notFound(res, id); return; }
  const updated = await authService.upsertRole({
    name: body.name ?? existing.name,
    description: body.description ?? existing.description,
    permissions: (body.permissions ?? existing.permissions) as import('../auth/types').Permission[],
  });
  json(res, 200, updated);
}

/** DELETE /api/_internal/roles/:id */
export async function handleInternalDeleteRole(
  req: AuthedRequest,
  res: http.ServerResponse,
  authService: AuthService,
  id: string,
): Promise<void> {
  const ctx = req[AUTH_CONTEXT_KEY];
  if (!AuthMiddleware.hasInternalPermission(ctx, 'settings_change')) {
    forbidden(res, 'settings_change'); return;
  }
  try {
    await authService.deleteRole(id);
    json(res, 200, { ok: true });
  } catch {
    notFound(res, id);
  }
}

// ─── Logs (/api/_internal/logs) ───────────────────────────────────────────────

/** GET /api/_internal/logs — returns the in-memory log buffer */
export function handleInternalGetLogs(
  req: AuthedRequest,
  res: http.ServerResponse,
  logs: Array<{ timestamp: string; level: string; source: string; message: string }>,
): void {
  const ctx = req[AUTH_CONTEXT_KEY];
  if (!AuthMiddleware.hasInternalPermission(ctx, 'access_logs')) {
    forbidden(res, 'access_logs'); return;
  }
  json(res, 200, { logs });
}

/** DELETE /api/_internal/logs */
export function handleInternalClearLogs(
  req: AuthedRequest,
  res: http.ServerResponse,
  logs: Array<unknown>,
): void {
  const ctx = req[AUTH_CONTEXT_KEY];
  if (!AuthMiddleware.hasInternalPermission(ctx, 'settings_change')) {
    forbidden(res, 'settings_change'); return;
  }
  logs.splice(0);
  json(res, 200, { ok: true });
}

/**
 * POST /api/_internal/db/provision
 *
 * Request body:
 * {
 *   adminDb?: DbConfig,    // DDL/admin connection (for createDb=true)
 *   targetDb:  DbConfig,   // AIAPI application database
 *   createDb?: boolean,    // create DB if it doesn't exist (requires adminDb)
 *   seed?:     boolean     // seed default roles + admin user if users table empty
 * }
 *
 * Requires `_internal / settings_change` permission.
 * Can be called during initial setup or at any time from the dashboard
 * "Auth Backend" panel to apply schema migrations or re-seed.
 */
export async function handleInternalDbProvision(
  req: AuthedRequest,
  res: http.ServerResponse,
): Promise<void> {
  const ctx = req[AUTH_CONTEXT_KEY];
  if (!AuthMiddleware.hasInternalPermission(ctx, 'settings_change')) {
    forbidden(res, 'settings_change'); return;
  }

  let body: {
    adminDb?: DbConfig;
    targetDb?: DbConfig;
    createDb?: boolean;
    seed?: boolean;
  };
  try {
    const raw = await readRawBody(req);
    body = raw ? JSON.parse(raw) : {};
  } catch {
    json(res, 400, { error: 'Invalid JSON body' }); return;
  }

  if (!body.targetDb) {
    json(res, 400, { error: 'targetDb is required' }); return;
  }

  try {
    const result = await DbProvisioner.provision({
      adminCfg: body.adminDb,
      targetCfg: body.targetDb,
      createDb: body.createDb ?? false,
      seed: body.seed ?? false,
    });
    globalLogger.info('DbProvision',
      `Provision ${result.ok ? 'succeeded' : 'had errors'}: ` +
      result.steps.map(s => `${s.step}=${s.status}`).join(', '));
    json(res, result.ok ? 200 : 500, result);
  } catch (e: unknown) {
    globalLogger.error('DbProvision', `Unexpected error: ${e}`);
    json(res, 500, { error: 'Provision failed', detail: String(e) });
  }
}

// ─── Private utility ──────────────────────────────────────────────────────────

/** Remove passwordHash from user objects before sending over the wire */
function sanitize(user: User): Omit<User, 'passwordHash'> & { passwordHash?: never } {
  const { passwordHash: _ph, ...rest } = user;
  void _ph;
  return rest;
}

async function readRawBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    req.on('error', reject);
  });
}
