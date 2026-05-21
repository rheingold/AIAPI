import * as http from 'http';
import * as url from 'url';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { WebSocketServer, WebSocket } from 'ws';
import { AutomationEngine } from '../engine/automationEngine';
import { UIObject, ActionResult, QueryOptions } from '../types';
import { SessionTokenManager } from '../security/SessionTokenManager';
import { SecurityPolicy } from '../security/types';
import { globalLogger } from '../utils/Logger';
import { wildcardMatch } from '../utils/wildcardMatch';
import { evaluateFilterRules, FilterRule } from '../utils/filterEval';
import { HelperRegistry } from '../helpers/HelperRegistry';
import { XmlScenarioLoader, RawXmlStep, executeXmlScenario as runXmlScenario } from '../scenario/xmlScenarioLoader';
import { AuthService } from '../auth/AuthService';
import { CertificateManager } from '../security/CertificateManager';
import { ConfigSigner } from '../security/ConfigSigner';
import { AuthMiddleware, AuthedRequest, AUTH_CONTEXT_KEY } from '../auth/AuthMiddleware';
import { AuthConfig } from '../auth/types';
import {
  handleAuthLogin, handleAuthLogout, handleAuthRefresh, handleAuthStatus,
  handleOAuthRedirect, handleOAuthCallback,
  handleSamlRedirect, handleSamlCallback,
  handleInternalListUsers, handleInternalCreateUser,
  handleInternalUpdateUser, handleInternalDeleteUser,
  handleInternalCreateApiKey, handleInternalRevokeApiKey,
  handleInternalListRoles, handleInternalCreateRole,
  handleInternalUpdateRole, handleInternalDeleteRole,
  handleInternalGetLogs, handleInternalClearLogs,
  handleInternalDbProvision,
} from './internalHandlers';

const execFileAsync = promisify(execFile);

interface LogEntry {
  timestamp: string;
  level: 'debug' | 'info' | 'warn' | 'error';
  source: string;
  message: string;
}

interface DashboardSession {
  token: string;
  createdAt: number;
  lastAccessedAt: number;
  ipAddress: string;
}

export class HttpServerWithDashboard {
  private server: http.Server | null = null;
  private wss: WebSocketServer | null = null;
  private automationEngine: AutomationEngine;
  private sessionTokenManager: SessionTokenManager | null = null;
  private helperRegistry: HelperRegistry | null = null;
  private port: number;
  private logs: LogEntry[] = [];
  /** Persistent security-only audit log — survives server restarts. */
  private securityAuditLog: LogEntry[] = [];
  /** Estimated total line count in the JSONL file on disk (RAM may hold fewer). */
  private _auditDiskLineCount: number = 0;
  /** Path to the rolling JSONL file for security audit events. */
  private readonly securityAuditLogFile: string = path.resolve(
    path.resolve(__dirname, '..', '..'), 'config', 'security', 'security-audit.jsonl'
  );
  private requestCount: number = 0;
  private startTime: number = Date.now();
  private sessions: Map<string, DashboardSession> = new Map();
  private securityPolicy: SecurityPolicy | null = null;
  private verboseLogging: boolean = true; // Enabled by default
  private config: any = {}; // Configuration storage
  private processHashCache: Map<string, { hash: string; mtimeMs: number }> = new Map();
  private readonly settingsFilePath: string = path.resolve(path.resolve(__dirname, '..', '..'), 'config', 'dashboard-settings.json');
  /** Authentication service — null when auth.mode = "none" (default) */
  private authService: AuthService | null = null;
  private authMiddleware: AuthMiddleware | null = null;
  /** Resolved once at construction time from __dirname; immune to process.chdir(). */
  private readonly extensionRoot: string = path.resolve(__dirname, '..', '..');

  constructor(automationEngine: AutomationEngine, sessionTokenManager?: SessionTokenManager, port?: number, helperRegistry?: HelperRegistry) {
    this.automationEngine = automationEngine;
    this.sessionTokenManager = sessionTokenManager || null;
    this.helperRegistry = helperRegistry || null;
    this.port = port || 3457;
    this.loadSecurityPolicy();
    
    // Initialize default config
    this.config = {
      scenariosPath: './scenarios',
      securityPath: './security',
      publicKeyPath: './config/security/public.key.enc',
      privateKeyPath: './config/security/private.key.enc',
      helperPaths: ['./dist/win/*.exe'],
      mcpPort: 3457,
      logLevel: 'info',
      tokenExpiry: 60,
      requireBinarySignature: false,
      requireOsEnforcement: false,
      allowUnsignedScenarios: true,
      allowedExecutables: [],
      blockedExecutables: [],
      allowedPaths: [],
      blockedPaths: [],
      advancedFilters: [],
      disabledHelpers: [] as string[],
      appTemplateRoots: [
        './components/helpers/shared/dist-resources/apptemplates',
        './components/helpers/windows/dist-resources/apptemplates',
      ],
      testSessionDir: './test/sessionlogs',
    };
    
    // Register this dashboard as log receiver
    globalLogger.onLog((level, source, message) => {
      this.log(level, source, message);
    });

    // Load persisted settings from disk (overrides defaults)
    this.loadConfigFromDisk();

    // Load persisted security audit log from disk
    this.loadSecurityAuditLog();
  }

  /**
   * Load persisted security audit log from the JSONL file on disk.
   * Called once at construction; entries are merged into securityAuditLog.
   */
  /** Maximum number of security audit entries kept in RAM. Older entries remain on disk. */
  private static readonly MAX_AUDIT_MEM_ENTRIES = 2_000;

  private loadSecurityAuditLog(): void {
    try {
      if (fs.existsSync(this.securityAuditLogFile)) {
        const raw = fs.readFileSync(this.securityAuditLogFile, 'utf8');
        const lines = raw.split('\n').filter(l => l.trim().length > 0);
        for (const line of lines) {
          try {
            this.securityAuditLog.push(JSON.parse(line) as LogEntry);
          } catch {
            // skip malformed lines
          }
        }
        // Track the total disk line count before capping RAM.
        this._auditDiskLineCount = this.securityAuditLog.length;
        // Keep only the most-recent MAX_AUDIT_MEM_ENTRIES entries in RAM;
        // older history remains on disk and is accessible via log-tail queries.
        if (this.securityAuditLog.length > HttpServerWithDashboard.MAX_AUDIT_MEM_ENTRIES) {
          this.securityAuditLog = this.securityAuditLog.slice(-HttpServerWithDashboard.MAX_AUDIT_MEM_ENTRIES);
        }
        globalLogger.info('security', `Loaded ${this.securityAuditLog.length} security audit entries from disk (total on disk: ${this._auditDiskLineCount})`);
      }
    } catch (err) {
      globalLogger.warn('security', `Could not load security audit log: ${err}`);
    }
  }

  /**
   * Append a security log entry to the rolling JSONL file.
   * Trims the file to the last MAX_AUDIT_FILE_ENTRIES when it exceeds the cap.
   */
  private appendSecurityAuditEntry(entry: LogEntry): void {
    const MAX_AUDIT_FILE_ENTRIES = 10_000;
    try {
      const line = JSON.stringify(entry) + '\n';
      // Ensure directory exists
      const dir = path.dirname(this.securityAuditLogFile);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.appendFileSync(this.securityAuditLogFile, line, 'utf8');
      this._auditDiskLineCount++;
      // Trim RAM to configured cap.
      if (this.securityAuditLog.length > HttpServerWithDashboard.MAX_AUDIT_MEM_ENTRIES) {
        this.securityAuditLog = this.securityAuditLog.slice(-HttpServerWithDashboard.MAX_AUDIT_MEM_ENTRIES);
      }
      // Rolling disk-file trim: reread+rewrite only when the disk cap is actually exceeded.
      // Using the tracked count avoids reading the file on every append.
      if (this._auditDiskLineCount > MAX_AUDIT_FILE_ENTRIES) {
        const allLines = fs.readFileSync(this.securityAuditLogFile, 'utf8')
          .split('\n').filter(l => l.trim().length > 0);
        const kept = allLines.slice(-MAX_AUDIT_FILE_ENTRIES);
        fs.writeFileSync(this.securityAuditLogFile, kept.join('\n') + '\n', 'utf8');
        this._auditDiskLineCount = kept.length;
      }
    } catch (err) {
      // Non-fatal: log file may be on read-only FS
      globalLogger.warn('security', `Could not write security audit file: ${err}`);
    }
  }

  /**
   * Load persisted configuration from dashboard-settings.json if it exists.
   * Only updates fields that are present in the saved file.
   */
  private loadConfigFromDisk(): void {
    try {
      if (fs.existsSync(this.settingsFilePath)) {
        const saved = JSON.parse(fs.readFileSync(this.settingsFilePath, 'utf8'));
        Object.assign(this.config, saved);
        globalLogger.info('dashboard', `Loaded settings from ${this.settingsFilePath}`);
      }
    } catch (err) {
      globalLogger.warn('dashboard', `Could not load settings file: ${err}`);
    }
  }

  /**
   * Persist current configuration to dashboard-settings.json.
   */
  private saveConfigToDisk(): void {
    try {
      fs.writeFileSync(this.settingsFilePath, JSON.stringify(this.config, null, 2));
    } catch (err) {
      this.log('error', 'settings', `Failed to persist settings: ${err}`);
    }
  }

  /**
   * Initialise the authentication subsystem from config.
   * Call after loadConfigFromDisk() before start().
   */
  async initAuth(authCfg?: AuthConfig): Promise<void> {
    const cfg: AuthConfig = authCfg ?? {
      mode: (this.config as Record<string, unknown>)['auth.mode'] as AuthConfig['mode'] ?? 'none',
      jwt: {
        enabled: true,
        secret: (this.config as Record<string, unknown>)['auth.jwt.secret'] as string ?? '',
        expiryMinutes: Number((this.config as Record<string, unknown>)['auth.jwt.expiryMinutes'] ?? 60),
      },
      debugExternalAuth: Boolean((this.config as Record<string, unknown>)['auth.debugExternalAuth']),
      users: {
        storeSource: (this.config as Record<string, unknown>)['auth.users.storeSource'] as 'json' | 'db' ?? 'json',
        jsonPath: String((this.config as Record<string, unknown>)['auth.users.jsonPath'] ?? './config/users.json'),
      },
    };
    this.authService = await AuthService.create(cfg);
    this.authMiddleware = new AuthMiddleware(this.authService);
    globalLogger.info('auth', `Authentication initialised (mode: ${cfg.mode})`);
  }

  /**
   * Start the HTTP server with WebSocket support
   */
  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => {
        this.handleRequest(req, res);
      });

      // Initialize WebSocket server
      this.wss = new WebSocketServer({ server: this.server });
      this.wss.on('connection', (ws) => this.handleWebSocketConnection(ws));

      this.server.listen(this.port, '127.0.0.1', () => {
        this.log('info', 'server', `HTTP Server started on http://127.0.0.1:${this.port}`);
        this.log('info', 'server', `Dashboard available at http://127.0.0.1:${this.port}/dashboard`);
        resolve();
      });

      this.server.on('error', (error) => {
        this.log('error', 'server', `Server error: ${error.message}`);
        reject(error);
      });
    });
  }

  /**
   * Stop the HTTP server
   */
  stop(): Promise<void> {
    return new Promise((resolve) => {
      // Close all WebSocket connections
      if (this.wss) {
        this.wss.clients.forEach(client => client.close());
        this.wss.close();
      }

      if (this.server) {
        this.server.close(() => {
          this.log('info', 'server', 'HTTP Server stopped');
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  /**
   * Log a message and broadcast to WebSocket clients
   */
  log(level: LogEntry['level'], source: string, message: string): void {
    const entry: LogEntry = {
      timestamp: new Date().toLocaleTimeString(),
      level,
      source,
      message,
    };

    this.logs.push(entry);

    // Keep only last 1000 logs
    if (this.logs.length > 1000) {
      this.logs.shift();
    }

    // Persist security events to rolling audit file
    if (entry.source.toLowerCase() === 'security') {
      this.securityAuditLog.push(entry);
      this.appendSecurityAuditEntry(entry);
    }

    // Broadcast to WebSocket clients
    this.broadcast({ type: 'log', ...entry });
  }

  /**
   * Log JSON data with pretty formatting
   */
  logJSON(level: LogEntry['level'], source: string, label: string, data: any): void {
    if (!this.verboseLogging) return;
    
    try {
      const formatted = JSON.stringify(data, null, 2);
      this.log(level, source, `${label}:\n${formatted}`);
    } catch (error) {
      this.log('error', source, `Failed to format JSON for ${label}: ${error}`);
    }
  }

  /**
   * Load security policy from config.json
   */
  private loadSecurityPolicy(): void {
    try {
      const configPath = path.join(__dirname, '../../config/security/config.json');
      if (fs.existsSync(configPath)) {
        const configData = fs.readFileSync(configPath, 'utf8').replace(/^\uFEFF/, '');
        this.securityPolicy = JSON.parse(configData);
        this.log('debug', 'security', 'Security policy loaded');
      }
    } catch (error) {
      this.log('warn', 'security', `Failed to load security policy: ${error}`);
    }
  }

  /**
   * Generate a new dashboard session token
   */
  private generateSessionToken(): string {
    return crypto.randomBytes(32).toString('hex');
  }

  /**
   * Create a new dashboard session
   */
  private createSession(ipAddress: string): string {
    const token = this.generateSessionToken();
    const session: DashboardSession = {
      token,
      createdAt: Date.now(),
      lastAccessedAt: Date.now(),
      ipAddress,
    };
    
    this.sessions.set(token, session);
    this.log('info', 'auth', `New dashboard session created for ${ipAddress}`);
    
    // Cleanup old sessions (older than 1 hour)
    const oneHourAgo = Date.now() - 3600000;
    for (const [token, session] of this.sessions.entries()) {
      if (session.lastAccessedAt < oneHourAgo) {
        this.sessions.delete(token);
      }
    }
    
    return token;
  }

  /**
   * Validate dashboard session token
   */
  private validateSession(token: string | undefined): boolean {
    // Check for security bypass in development
    if (process.env.SKIP_DASHBOARD_AUTH === 'true') {
      return true;
    }

    if (!token) {
      return false;
    }

    const session = this.sessions.get(token);
    if (!session) {
      return false;
    }

    // Update last accessed time
    session.lastAccessedAt = Date.now();
    return true;
  }

  /**
   * Extract session token from request
   */
  private getSessionToken(req: http.IncomingMessage): string | undefined {
    // Check Authorization header
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      return authHeader.substring(7);
    }

    // Check cookie
    const cookies = this.parseCookies(req.headers.cookie || '');
    return cookies['dashboard_session'];
  }

  /**
   * Parse cookies from header
   */
  private parseCookies(cookieHeader: string): Record<string, string> {
    const cookies: Record<string, string> = {};
    cookieHeader.split(';').forEach(cookie => {
      const [name, value] = cookie.trim().split('=');
      if (name && value) {
        cookies[name] = decodeURIComponent(value);
      }
    });
    return cookies;
  }

  /**
   * Check if endpoint requires authentication
   */
  private requiresAuth(pathname: string): boolean {
    // Public endpoints (no auth required)
    const publicEndpoints = [
      '/dashboard',
      '/dashboard.css',
      '/dashboard.js',
      '/favicon.ico',
      '/favicon.svg',
      '/health',
      '/api/login',
      '/api/settings',
      '/api/settings/validate',
      '/api/workdir',
      '/api/token/generate',
      '/api/listWindows',
      '/api/launchProcess',
      '/api/queryTree',
      '/api/clickElement',
      '/api/setProperty',
      '/api/readProperty',
      '/api/getProviders',
      '/api/process-hash',
      '/api/listHelpers',
      '/api/getHelperSchema',
      '/api/status',
      '/api/filters',
      '/api/filters/test',
      '/api/helpers/disabled',
      '/api/helpers/toggle',
      '/api/helpers/reload',
      '/api/session/start',
      '/api/session/finish',
      '/api/session/status',
      '/api/appTemplates',
      '/api/auth/config',
    ];

    // Also allow /api/appTemplates/* GET prefix without auth;
    // POST run endpoints (/api/appTemplates/{app}/scenarios/{id}/run) require auth.
    if (pathname.startsWith('/api/appTemplates/') && !pathname.endsWith('/run')) {
      return false;
    }

    return !publicEndpoints.includes(pathname);
  }

  /**
   * Evaluate the `_internal` pseudo-helper filter rules for a REST request.
   *
   * Command mapping:
   *   - `access_logs`    → GET /api/security/log  OR  GET /api/_internal/logs
   *   - `settings_change`→ POST | PUT | DELETE on any _internal path
   *   - `access`         → GET on any other _internal path
   *
   * Returns false (and sends 403) only when a rule explicitly returns DENY.
   * When no rule matches (null verdict), returns true (falls through to
   * the existing hasInternalPermission / role-based RBAC check).
   */
  private checkInternalAccess(
    req: http.IncomingMessage,
    method: string,
    pathname: string,
    res: http.ServerResponse,
  ): boolean {
    const rules = (this.config.advancedFilters || []) as FilterRule[];
    // Only evaluate if there are any _internal-scoped rules at all
    const hasInternalRules = rules.some((r: FilterRule) => r.helper === '_internal' || r.helper === '*' || !r.helper);
    if (!hasInternalRules) return true;

    const isLogPath = pathname === '/api/security/log' || pathname === '/api/_internal/logs';
    const isMutate  = method === 'POST' || method === 'PUT' || method === 'DELETE';
    const command   = isLogPath ? 'access_logs' : isMutate ? 'settings_change' : 'access';

    const { verdict, reason } = evaluateFilterRules(rules, '_internal', '_internal', command, pathname);

    if (verdict === 'DENY') {
      this.log('warn', 'security', `_internal filter DENIED [${method} ${pathname}] cmd=${command}: ${reason}`);
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Access denied by security filter', reason }));
      return false;
    }

    if (verdict === 'ALLOW') {
      this.log('info', 'security', `_internal filter ALLOWED [${method} ${pathname}] cmd=${command}: ${reason}`);
    }
    // null verdict → fall through to hasInternalPermission
    return true;
  }
  private broadcast(data: any): void {
    if (!this.wss) return;

    const message = JSON.stringify(data);
    this.wss.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    });
  }

  /**
   * Handle WebSocket connection
   */
  private handleWebSocketConnection(ws: WebSocket): void {
    this.log('debug', 'websocket', 'New WebSocket client connected');

    // Send recent logs to new client
    this.logs.slice(-50).forEach(log => {
      ws.send(JSON.stringify({ type: 'log', ...log }));
    });

    // Send current stats
    const publicKeyPath = this.config.publicKeyPath || './security/public.key.enc';
    const privateKeyPath = this.config.privateKeyPath || './security/private.key.enc';
    ws.send(JSON.stringify({
      type: 'status',
      stats: {
        requestCount: this.requestCount,
        uptime: Date.now() - this.startTime,
        security: {
          enabled: this.config.securityEnabled !== false,
          keysPresent: fs.existsSync(publicKeyPath) && fs.existsSync(privateKeyPath),
          filterCount:
            (this.config.allowedExecutables?.length || 0) +
            (this.config.blockedExecutables?.length || 0) +
            (this.config.allowedPaths?.length || 0) +
            (this.config.blockedPaths?.length || 0),
        },
        helpers: {
          count: this.helperRegistry ? this.helperRegistry.getAll().length : 0,
        },
      },
    }));

    // Handle incoming messages from client
    ws.on('message', (data: string) => {
      try {
        const message = JSON.parse(data.toString());
        if (message.type === 'config' && message.setting === 'jsonLogging') {
          process.env.LOG_JSON = message.value ? 'true' : 'false';
          this.log('info', 'system', `JSON logging ${message.value ? 'enabled' : 'disabled'} via dashboard`);
        }
      } catch (error) {
        this.log('error', 'websocket', `Failed to parse WebSocket message: ${error}`);
      }
    });

    ws.on('close', () => {
      this.log('debug', 'websocket', 'WebSocket client disconnected');
    });
  }

  /**
   * Main request handler
   */
  private async handleRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    this.requestCount++;

    const parsedUrl = url.parse(req.url || '', true);
    const pathname = parsedUrl.pathname || '';

    // Log incoming request in verbose mode
    if (this.verboseLogging) {
      this.log('debug', 'http', `→ ${req.method} ${pathname} from ${req.socket.remoteAddress}`);
    }

    // Enable CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    // Handle OPTIONS requests
    if (req.method === 'OPTIONS') {
      res.writeHead(200);
      res.end();
      return;
    }

    try {
      // ── New auth middleware (auth.mode-aware) ─────────────────────────────
      if (this.authMiddleware) {
        let authDone = false;
        await this.authMiddleware.handle(req as AuthedRequest, res, () => { authDone = true; });
        if (!authDone) return; // middleware wrote 401
      } else {
        // Legacy session-token check (auth.mode = "none" or not yet initialised)
        if (this.requiresAuth(pathname)) {
          const sessionToken = this.getSessionToken(req);
          if (!this.validateSession(sessionToken)) {
            this.log('warn', 'auth', `Unauthorized access attempt to ${pathname}`);
            res.setHeader('Content-Type', 'application/json');
            res.writeHead(401);
            res.end(JSON.stringify({
              error: 'Unauthorized',
              message: 'Valid session token required. Use /api/login to obtain a token.',
            }));
            return;
          }
        }
      }

      // Dashboard static files
      if (pathname === '/dashboard' || pathname === '/') {
        return this.serveStaticFile('dashboard.html', res);
      }
      if (pathname === '/favicon.ico' || pathname === '/favicon.svg') {
        return this.serveStaticFile('favicon.svg', res);
      }
      if (pathname === '/dashboard.css') {
        return this.serveStaticFile('dashboard.css', res);
      }
      if (pathname === '/dashboard.js') {
        return this.serveStaticFile('dashboard.js', res);
      }

      // API endpoints
      res.setHeader('Content-Type', 'application/json');

      if (pathname === '/api/login' && req.method === 'POST') {
        return this.handleLogin(req, res);
      }
      if (pathname === '/api/status' && req.method === 'GET') {
        return this.handleGetStatus(req, res);
      }
      if (pathname === '/api/config' && req.method === 'GET') {
        return this.handleGetConfig(req, res);
      }
      if (pathname === '/api/config' && req.method === 'PUT') {
        return this.handlePutConfig(req, res);
      }
      if (pathname === '/api/restart' && req.method === 'POST') {
        return this.handleRestart(req, res);
      }
      if (pathname === '/api/listHelpers' && req.method === 'GET') {
        return this.handleListHelpers(req, res);
      }
      if (pathname === '/api/helpers/reload' && req.method === 'POST') {
        return this.handleReloadHelpers(req, res);
      }
      if (pathname === '/api/session/start' && req.method === 'POST') {
        return this.handleSessionStart(req, res);
      }
      if (pathname === '/api/session/finish' && req.method === 'POST') {
        return this.handleSessionFinish(req, res);
      }
      if (pathname === '/api/session/status' && req.method === 'GET') {
        return this.handleSessionStatus(req, res);
      }
      if (pathname === '/api/getHelperSchema' && req.method === 'GET') {
        return this.handleGetHelperSchema(req, res);
      }
      if (pathname === '/api/tools' && req.method === 'GET') {
        return this.handleGetTools(req, res);
      }
      if (pathname === '/api/scenarios' && req.method === 'GET') {
        return this.handleGetScenarios(req, res);
      }
      if (pathname === '/api/appTemplates' && req.method === 'GET') {
        return this.handleListAppTemplates(req, res);
      }
      // GET /api/appTemplates/{app}/scenarios/list — JSON list of {id, label}
      if (pathname.startsWith('/api/appTemplates/') && pathname.endsWith('/scenarios/list') && req.method === 'GET') {
        return this.handleListTemplateScenarios(req, res, pathname);
      }
      // GET /api/appTemplates/{app}/scenarios/{id}/steps — raw unresolved step list for the editor
      if (pathname.startsWith('/api/appTemplates/') && pathname.endsWith('/steps') && req.method === 'GET') {
        return this.handleGetRawScenarioSteps(req, res, pathname);
      }
      // GET /api/appTemplates/{app}/scenarios/{id}/localeMap — locale string tables for a scenario
      if (pathname.startsWith('/api/appTemplates/') && pathname.endsWith('/localeMap') && req.method === 'GET') {
        return this.handleGetLocaleMap(req, res, pathname);
      }
      // PUT /api/appTemplates/{app}/scenarios/{id} — save modified scenario
      if (pathname.startsWith('/api/appTemplates/') && req.method === 'PUT') {
        return this.handleSaveScenario(req, res, pathname);
      }
      if (pathname.startsWith('/api/appTemplates/') && req.method === 'GET') {
        return this.handleGetAppTemplate(req, res, pathname);
      }
      if (pathname.startsWith('/api/appTemplates/') && pathname.endsWith('/run') && req.method === 'POST') {
        return this.handleRunAppTemplateScenario(req, res, pathname);
      }
      if (pathname === '/api/scenarios/run' && req.method === 'POST') {
        return this.handleRunScenario(req, res);
      }
      if (pathname === '/api/settings' && req.method === 'GET') {
        return this.handleGetSettings(req, res);
      }
      if (pathname === '/api/settings' && req.method === 'POST') {
        return this.handleSaveSettings(req, res);
      }
      if (pathname === '/api/settings/validate' && req.method === 'GET') {
        return this.handleValidateSettings(req, res);
      }
      if (pathname === '/api/auth/config' && req.method === 'GET') {
        return this.handleGetAuthConfig(req, res);
      }
      if (pathname === '/api/auth/config' && req.method === 'POST') {
        return this.handleSaveAuthConfig(req, res);
      }
      if (pathname === '/api/shell/openFileDialog' && req.method === 'POST') {
        return this.handleOpenFileDialog(req, res);
      }
      if (pathname === '/api/filters' && req.method === 'GET') {
        return this.handleGetFilters(req, res);
      }
      if (pathname === '/api/filters' && req.method === 'POST') {
        return this.handleSaveFilters(req, res);
      }
      if (pathname === '/api/filters/test' && req.method === 'POST') {
        return this.handleTestFilter(req, res);
      }
      if (pathname.startsWith('/api/filters/') && req.method === 'DELETE') {
        const filterId = pathname.slice('/api/filters/'.length);
        return this.handleDeleteFilter(req, res, filterId);
      }
      if (pathname === '/api/security/log' && req.method === 'GET') {
        if (!this.checkInternalAccess(req, 'GET', pathname, res)) return;
        return this.handleGetSecurityLog(req, res);
      }
      if (pathname === '/api/helpers/toggle' && req.method === 'POST') {
        return this.handleToggleHelper(req, res);
      }
      if (pathname === '/api/helpers/disabled' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, disabledHelpers: this.config.disabledHelpers || [] }));
        return;
      }
      if (pathname === '/api/workdir' && req.method === 'POST') {
        return this.handleChangeWorkDir(req, res);
      }
      if (pathname === '/api/token/generate' && req.method === 'POST') {
        return this.handleGenerateToken(req, res);
      }

      // Legacy automation API endpoints
      if (pathname === '/api/queryTree' && req.method === 'POST') {
        return this.handleQueryTree(req, res);
      }
      if (pathname === '/api/clickElement' && req.method === 'POST') {
        return this.handleClickElement(req, res);
      }
      if (pathname === '/api/setProperty' && req.method === 'POST') {
        return this.handleSetProperty(req, res);
      }
      if (pathname === '/api/readProperty' && req.method === 'POST') {
        return this.handleReadProperty(req, res);
      }
      if (pathname === '/api/getProviders' && req.method === 'GET') {
        return this.handleGetProviders(req, res);
      }
      if (pathname === '/api/listWindows' && (req.method === 'GET' || req.method === 'POST')) {
        return this.handleListWindows(req, res);
      }
      if (pathname === '/api/launchProcess' && req.method === 'POST') {
        return this.handleLaunchProcess(req, res);
      }
      if (pathname === '/api/process-hash' && req.method === 'POST') {
        return this.handleProcessHash(req, res);
      }
      if (pathname === '/health' && req.method === 'GET') {
        res.writeHead(200);
        res.end(JSON.stringify({
          status: 'ok',
          message: 'AI Automation API is running',
          version: '0.2.0',
          timestamp: new Date().toISOString(),
        }));
        return;
      }

      // ── /api/auth/* ────────────────────────────────────────────────────────
      if (this.authService) {
        if (pathname === '/api/auth/login' && req.method === 'POST') {
          return handleAuthLogin(req, res, this.authService);
        }
        if (pathname === '/api/auth/logout' && req.method === 'POST') {
          return handleAuthLogout(req, res);
        }
        if (pathname === '/api/auth/refresh' && req.method === 'POST') {
          return handleAuthRefresh(req, res, this.authService);
        }
        if (pathname === '/api/auth/status' && req.method === 'GET') {
          return handleAuthStatus(req as AuthedRequest, res);
        }
        if (pathname === '/api/auth/oauth/redirect' && req.method === 'GET') {
          return handleOAuthRedirect(req, res, this.authService);
        }
        if (pathname === '/api/auth/oauth/callback' && req.method === 'GET') {
          return handleOAuthCallback(req, res, this.authService);
        }
        if (pathname === '/api/auth/saml/redirect' && req.method === 'GET') {
          return handleSamlRedirect(req, res, this.authService);
        }
        if (pathname === '/api/auth/saml/callback' && req.method === 'POST') {
          return handleSamlCallback(req, res, this.authService);
        }
      }

      // ── /api/_internal/setup ───────────────────────────────────────────────
      if (pathname === '/api/_internal/setup/status' && req.method === 'GET') {
        return this.handleSetupStatus(req, res);
      }
      if (pathname === '/api/_internal/setup' && req.method === 'POST') {
        return this.handleRunSetup(req, res);
      }
      // ── /api/_internal/* ───────────────────────────────────────────────────
      if (this.authService) {
        // Filter-rule enforcement for _internal pseudo-helper (U2)
        if (!this.checkInternalAccess(req, req.method ?? 'GET', pathname, res)) return;
        if (pathname === '/api/_internal/users' && req.method === 'GET') {
          return handleInternalListUsers(req as AuthedRequest, res, this.authService);
        }
        if (pathname === '/api/_internal/users' && req.method === 'POST') {
          return handleInternalCreateUser(req as AuthedRequest, res, this.authService);
        }
        const userMatch = pathname.match(/^\/api\/_internal\/users\/([^/]+)$/);
        if (userMatch) {
          if (req.method === 'PUT') return handleInternalUpdateUser(req as AuthedRequest, res, this.authService, userMatch[1]);
          if (req.method === 'DELETE') return handleInternalDeleteUser(req as AuthedRequest, res, this.authService, userMatch[1]);
        }
        const apiKeyMatch = pathname.match(/^\/api\/_internal\/users\/([^/]+)\/apikeys$/);
        if (apiKeyMatch && req.method === 'POST') {
          return handleInternalCreateApiKey(req as AuthedRequest, res, this.authService, apiKeyMatch[1]);
        }
        const revokeKeyMatch = pathname.match(/^\/api\/_internal\/users\/([^/]+)\/apikeys\/([^/]+)$/);
        if (revokeKeyMatch && req.method === 'DELETE') {
          return handleInternalRevokeApiKey(req as AuthedRequest, res, this.authService, revokeKeyMatch[1], revokeKeyMatch[2]);
        }
        if (pathname === '/api/_internal/roles' && req.method === 'GET') {
          return handleInternalListRoles(req as AuthedRequest, res, this.authService);
        }
        if (pathname === '/api/_internal/roles' && req.method === 'POST') {
          return handleInternalCreateRole(req as AuthedRequest, res, this.authService);
        }
        const roleMatch = pathname.match(/^\/api\/_internal\/roles\/([^/]+)$/);
        if (roleMatch) {
          if (req.method === 'PUT') return handleInternalUpdateRole(req as AuthedRequest, res, this.authService, roleMatch[1]);
          if (req.method === 'DELETE') return handleInternalDeleteRole(req as AuthedRequest, res, this.authService, roleMatch[1]);
        }
        if (pathname === '/api/_internal/logs' && req.method === 'GET') {
          return handleInternalGetLogs(req as AuthedRequest, res, this.logs);
        }
        if (pathname === '/api/_internal/logs' && req.method === 'DELETE') {
          return handleInternalClearLogs(req as AuthedRequest, res, this.logs);
        }
        if (pathname === '/api/_internal/db/provision' && req.method === 'POST') {
          return handleInternalDbProvision(req as AuthedRequest, res);
        }
      }

      // 404 Not Found
      res.writeHead(404);
      res.end(JSON.stringify({ error: 'Endpoint not found' }));
    } catch (error) {
      // Log the full error server-side; never expose internal details to the caller.
      this.log('error', 'http', `Request handler error: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
      res.writeHead(500);
      res.end(JSON.stringify({ error: 'Internal server error' }));
    }
  }

  /**
   * Serve static files from the dashboard dist-resources directory
   */
  private serveStaticFile(filename: string, res: http.ServerResponse): void {
    // __dirname = {extensionRoot}/dist/server  →  ../../components/server/dist-resources/dashboard
    const staticDir = path.join(this.extensionRoot, 'components', 'server', 'dist-resources', 'dashboard');
    const filePath = path.join(staticDir, filename);

    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404);
        res.end(JSON.stringify({ error: 'File not found' }));
        return;
      }

      // Set content type
      const ext = path.extname(filename);
      const contentTypes: Record<string, string> = {
        '.html': 'text/html',
        '.css': 'text/css',
        '.js': 'application/javascript',
        '.svg': 'image/svg+xml',
        '.ico': 'image/x-icon',
        '.png': 'image/png',
      };
      res.setHeader('Content-Type', contentTypes[ext] || 'text/plain');

      res.writeHead(200);
      res.end(data);
    });
  }

  /**
   * POST /api/login
   * Authenticate and create dashboard session
   */
  private async handleLogin(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    try {
      const body = await this.readBody(req);
      const requestData = JSON.parse(body);
      
      if (this.verboseLogging) {
        this.logJSON('debug', 'auth', 'Login request', { source: req.socket.remoteAddress });
      }
      
      const { password } = requestData;

      // Check password (in production, use proper authentication)
      const expectedPassword = process.env.DASHBOARD_PASSWORD || 'admin123';
      
      if (password !== expectedPassword) {
        this.log('warn', 'auth', `Failed login attempt from ${req.socket.remoteAddress}`);
        res.writeHead(401);
        res.end(JSON.stringify({ success: false, error: 'Invalid password' }));
        return;
      }

      // Create session
      const token = this.createSession(req.socket.remoteAddress || 'unknown');
      
      const response = {
        success: true,
        token,
        message: 'Authentication successful',
      };
      
      if (this.verboseLogging) {
        this.logJSON('debug', 'auth', 'Login response', { success: true, tokenLength: token.length });
      }
      
      res.writeHead(200);
      res.end(JSON.stringify(response));
    } catch (error) {
      this.log('error', 'auth', `Login error: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
      res.writeHead(500);
      res.end(JSON.stringify({ success: false, error: 'Internal server error' }));
    }
  }

  /**
   * GET /api/status
   */
  private handleGetStatus(req: http.IncomingMessage, res: http.ServerResponse): void {
    // Check key files
    const publicKeyPath = this.config.publicKeyPath || './security/public.key.enc';
    const privateKeyPath = this.config.privateKeyPath || './security/private.key.enc';
    const publicKeyExists = fs.existsSync(publicKeyPath);
    const privateKeyExists = fs.existsSync(privateKeyPath);
    const keysPresent = publicKeyExists && privateKeyExists;

    // Count security filters (legacy lists + advanced rules)
    const filterCount =
      (this.config.allowedExecutables?.length || 0) +
      (this.config.blockedExecutables?.length || 0) +
      (this.config.allowedPaths?.length || 0) +
      (this.config.blockedPaths?.length || 0) +
      (this.config.advancedFilters?.length || 0);

    const securityEnabled = this.config.securityEnabled !== false;

    // Helper count
    const helperCount = this.helperRegistry ? this.helperRegistry.getAll().length : 0;

    res.writeHead(200);
    res.end(JSON.stringify({
      success: true,
      data: {
        status: 'running',
        uptime: Date.now() - this.startTime,
        requestCount: this.requestCount,
        logCount: this.logs.length,
        security: {
          enabled: securityEnabled,
          keysPresent,
          publicKeyExists,
          privateKeyExists,
          filterCount,
        },
        helpers: {
          count: helperCount,
        },
      },
    }));
  }

  /**
   * GET /api/config
   */
  private handleGetConfig(req: http.IncomingMessage, res: http.ServerResponse): void {
    try {
      const configPath = path.join(__dirname, '../../config/security/config.json');
      const configData = fs.readFileSync(configPath, 'utf8').replace(/^\uFEFF/, '');
      const config = JSON.parse(configData);

      res.writeHead(200);
      res.end(JSON.stringify({ success: true, data: config }));
    } catch (error) {
      this.log('error', 'config', `Failed to read config: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
      res.writeHead(500);
      res.end(JSON.stringify({ success: false, error: 'Internal server error' }));
    }
  }

  /**
   * PUT /api/config
   * Update configuration with security validation
   */
  private async handlePutConfig(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    try {
      const body = await this.readBody(req);
      let newConfig: any;
      try {
        newConfig = JSON.parse(body);
      } catch {
        res.writeHead(400);
        res.end(JSON.stringify({ success: false, error: 'Invalid JSON body' }));
        return;
      }

      if (this.verboseLogging) {
        this.logJSON('debug', 'config', 'Config update request', newConfig);
      }

      // Validate security policy fields
      if (typeof newConfig.requireTargetSignature !== 'boolean' && newConfig.requireTargetSignature !== undefined) {
        res.writeHead(400);
        res.end(JSON.stringify({ success: false, error: 'requireTargetSignature must be a boolean' }));
        return;
      }
      if (typeof newConfig.requireOSEnforcement !== 'boolean' && newConfig.requireOSEnforcement !== undefined) {
        res.writeHead(400);
        res.end(JSON.stringify({ success: false, error: 'requireOSEnforcement must be a boolean' }));
        return;
      }

      // Prevent weakening security in production
      if (process.env.NODE_ENV === 'production') {
        if (this.securityPolicy) {
          if (this.securityPolicy.requireTargetSignature && !newConfig.requireTargetSignature) {
            this.log('error', 'config', 'Attempt to disable requireTargetSignature in production');
            res.writeHead(403);
            res.end(JSON.stringify({
              success: false,
              error: 'Cannot disable target signature requirement in production',
            }));
            return;
          }
          if (this.securityPolicy.requireOSEnforcement && !newConfig.requireOSEnforcement) {
            this.log('error', 'config', 'Attempt to disable requireOSEnforcement in production');
            res.writeHead(403);
            res.end(JSON.stringify({
              success: false,
              error: 'Cannot disable OS enforcement requirement in production',
            }));
            return;
          }
        }
      }

      // Save configuration
      const configPath = path.join(__dirname, '../../config/security/config.json');
      fs.writeFileSync(configPath, JSON.stringify(newConfig, null, 2));

      // Reload security policy
      this.securityPolicy = newConfig;

      this.log('info', 'config', 'Configuration updated successfully');
      res.writeHead(200);
      res.end(JSON.stringify({
        success: true,
        message: 'Configuration saved. Restart server to apply changes.',
      }));
    } catch (error) {
      this.log('error', 'config', `Failed to save config: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
      res.writeHead(500);
      res.end(JSON.stringify({ success: false, error: 'Internal server error' }));
    }
  }

  /**
   * POST /api/restart
   */
  private handleRestart(req: http.IncomingMessage, res: http.ServerResponse): void {
    this.log('warn', 'server', 'Server restart requested');
    res.writeHead(200);
    res.end(JSON.stringify({ success: true, message: 'Server restart initiated' }));

    // Graceful restart (exit process, let process manager restart)
    setTimeout(() => {
      process.exit(0);
    }, 1000);
  }

  /**
   * GET /api/listHelpers
   * Returns all discovered helper executables and their commands.
   */
  private handleListHelpers(req: http.IncomingMessage, res: http.ServerResponse): void {
    if (!this.helperRegistry) {
      res.writeHead(200);
      res.end(JSON.stringify({ success: true, helpers: [] }));
      return;
    }
    const helpers = this.helperRegistry.getAll().map(s => ({
      name: s.helper,
      version: s.version,
      description: s.description,
      toolName: s.toolName,
      filePath: s.filePath,
      commandCount: s.commands.length,
      commands: s.commands.map(c => ({ name: c.name, description: c.description })),
    }));
    res.writeHead(200);
    res.end(JSON.stringify({ success: true, helpers }));
  }

  /**
   * POST /api/helpers/reload
   * Shuts down all running daemon processes, clears the registry, then
   * re-discovers helper executables from the same search paths used at startup.
   * Use this after rebuilding helper .exe files without restarting the server.
   */
  private handleReloadHelpers(req: http.IncomingMessage, res: http.ServerResponse): void {
    if (!this.helperRegistry) {
      res.writeHead(200);
      res.end(JSON.stringify({ success: true, reloaded: 0, helpers: [] }));
      return;
    }
    this.helperRegistry.reloadHelpers()
      .then(result => {
        res.writeHead(200);
        res.end(JSON.stringify({ success: true, ...result }));
      })
      .catch(err => {
        this.log('error', 'helpers', `reloadHelpers failed: ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
        res.writeHead(500);
        res.end(JSON.stringify({ success: false, error: 'Internal server error' }));
      });
  }

  /**
   * POST /api/session/start { "name": "<session-name>", "dir"?: "<override-base-dir>" }
   * Opens a new test-session recording folder and starts JSONL logging.
   */
  private handleSessionStart(req: http.IncomingMessage, res: http.ServerResponse): void {
    if (!this.helperRegistry) {
      res.writeHead(503);
      res.end(JSON.stringify({ success: false, error: 'HelperRegistry not available' }));
      return;
    }
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const { name = 'unnamed', dir } = body ? JSON.parse(body) : {};
        const result = this.helperRegistry!.startSession(String(name), dir ? String(dir) : undefined);
        res.writeHead(200);
        res.end(JSON.stringify({ success: true, ...result }));
      } catch (e) {
        this.log('error', 'session', `startSession failed: ${e instanceof Error ? e.stack ?? e.message : String(e)}`);
        res.writeHead(500);
        res.end(JSON.stringify({ success: false, error: 'Internal server error' }));
      }
    });
  }

  /**
   * POST /api/session/finish
   * Closes the active test session and writes summary.json.
   */
  private handleSessionFinish(req: http.IncomingMessage, res: http.ServerResponse): void {
    if (!this.helperRegistry) {
      res.writeHead(503);
      res.end(JSON.stringify({ success: false, error: 'HelperRegistry not available' }));
      return;
    }
    const result = this.helperRegistry.finishSession();
    res.writeHead(200);
    if (result) {
      res.end(JSON.stringify({ success: true, ...result }));
    } else {
      res.end(JSON.stringify({ success: false, error: 'No active session' }));
    }
  }

  /**
   * GET /api/session/status
   * Returns the current session directory (or null).
   */
  private handleSessionStatus(req: http.IncomingMessage, res: http.ServerResponse): void {
    const dir = this.helperRegistry?.getActiveSessionDir() ?? null;
    res.writeHead(200);
    res.end(JSON.stringify({ success: true, sessionActive: dir !== null, sessionDir: dir }));
  }

  /**
   * GET /api/getHelperSchema?name=KeyWin.exe
   */
  private handleGetHelperSchema(req: http.IncomingMessage, res: http.ServerResponse): void {
    const { query: queryParams } = url.parse(req.url || '', true);
    const helperName = queryParams.name as string;
    if (!helperName || !this.helperRegistry) {
      res.writeHead(400);
      res.end(JSON.stringify({ success: false, error: 'Missing helper name or registry not available' }));
      return;
    }
    const schema = this.helperRegistry.get(helperName);
    if (!schema) {
      res.writeHead(404);
      res.end(JSON.stringify({ success: false, error: `Helper not found: ${helperName}` }));
      return;
    }
    res.writeHead(200);
    res.end(JSON.stringify({ success: true, schema }));
  }

  /**
   * GET /api/tools
   */
  private handleGetTools(req: http.IncomingMessage, res: http.ServerResponse): void {
    const tools = [
      { name: 'queryTree', description: 'Query UI element tree from a provider' },
      { name: 'clickElement', description: 'Click a UI element' },
      { name: 'setProperty', description: 'Set a property on a UI element' },
      { name: 'readProperty', description: 'Read a property from a UI element' },
      { name: 'getProviders', description: 'Get list of available automation providers' },
      { name: 'listWindows', description: 'List all visible windows with titles and process information' },
      { name: 'launchProcess', description: 'Launch an application process' },
      { name: 'terminateProcess', description: 'Terminate a running process by name or PID' },
      { name: 'executeScenario', description: 'Execute a JSON automation scenario' },
    ];

    res.writeHead(200);
    res.end(JSON.stringify({ success: true, tools }));
  }

  /**
   * GET /api/scenarios
   */
  /** Returns the ordered list of resolved app template root directories.
   *  Priority: `appTemplateRoots[]` setting > legacy `appTemplatesDir` string > built-in defaults.
   */
  private resolveAppTemplateRoots(): string[] {
    const raw = (this.config as any).appTemplateRoots;
    if (Array.isArray(raw) && raw.length > 0) {
      return raw.map((r: string) => path.isAbsolute(r) ? r : path.resolve(this.extensionRoot, r));
    }
    const single = (this.config as any).appTemplatesDir;
    if (typeof single === 'string' && single) {
      return [path.resolve(this.extensionRoot, single)];
    }
    const defaults = [
      path.resolve(this.extensionRoot, 'components/helpers/shared/dist-resources/apptemplates'),
      path.resolve(this.extensionRoot, 'components/helpers/windows/dist-resources/apptemplates'),
      path.resolve(this.extensionRoot, 'test/e2e'),
    ];
    // Wire the user-configured scenarios folder into the app-template roots so
    // that app subdirs stored there (each with a scenarios.xml) are discoverable.
    const sp = this.config.scenariosPath;
    if (sp && typeof sp === 'string') {
      const abs = path.isAbsolute(sp) ? sp : path.resolve(this.extensionRoot, sp);
      if (!defaults.includes(abs)) defaults.unshift(abs);
    }
    return defaults;
  }

  /** Returns the first root containing a subdirectory named `appName`, or null. */
  private findAppRoot(appName: string): string | null {
    for (const root of this.resolveAppTemplateRoots()) {
      if (fs.existsSync(path.join(root, appName))) return root;
    }
    return null;
  }

  /**
   * GET /api/appTemplates
   * Lists all available app templates (subdirectories of appTemplatesDir).
   */
  private handleListAppTemplates(_req: http.IncomingMessage, res: http.ServerResponse): void {
    try {
      const roots = this.resolveAppTemplateRoots();
      const appsMap = new Map<string, { name: string; hasTree: boolean; hasScenarios: boolean; scenarioCount: number | null }>();
      for (const templatesDir of roots) {
        if (!fs.existsSync(templatesDir)) continue;
        for (const e of fs.readdirSync(templatesDir, { withFileTypes: true }).filter(e => e.isDirectory())) {
          if (appsMap.has(e.name)) continue; // first root wins
          const hasTree      = fs.existsSync(path.join(templatesDir, e.name, 'tree.xml'));
          const hasScenarios = fs.existsSync(path.join(templatesDir, e.name, 'scenarios.xml'));
          let scenarioCount: number | null = null;
          if (hasScenarios) {
            try {
              const xml = fs.readFileSync(path.join(templatesDir, e.name, 'scenarios.xml'), 'utf8');
              scenarioCount = (xml.match(/<Scenario\s/g) ?? []).length;
            } catch { /* ignore */ }
          }
          appsMap.set(e.name, { name: e.name, hasTree, hasScenarios, scenarioCount });
        }
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, apps: [...appsMap.values()] }));
    } catch (error) {
      this.log('error', 'appTemplates', `Failed to list app templates: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: 'Internal server error' }));
    }
  }

  /**
   * GET /api/appTemplates/{app}/tree    → tree.xml content
   * GET /api/appTemplates/{app}/scenarios → scenarios.xml content
   */
  private handleGetAppTemplate(
    _req: http.IncomingMessage,
    res: http.ServerResponse,
    pathname: string
  ): void {
    // pathname = /api/appTemplates/<app>/<file>  where file = "tree" | "scenarios"
    const parts = pathname.replace('/api/appTemplates/', '').split('/');
    if (parts.length !== 2) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: 'Expected /api/appTemplates/{app}/{tree|scenarios}' }));
      return;
    }
    const [appName, fileKey] = parts;
    if (fileKey !== 'tree' && fileKey !== 'scenarios') {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: `Unknown file key '${fileKey}'. Use 'tree' or 'scenarios'.` }));
      return;
    }
    // Sanitise: prevent path traversal
    if (!appName || appName.includes('..') || appName.includes('/') || appName.includes('\\')) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: 'Invalid app name' }));
      return;
    }
    const templatesDir = this.findAppRoot(appName) ?? this.resolveAppTemplateRoots()[0];
    const xmlFile = path.join(templatesDir, appName, `${fileKey}.xml`);
    if (!fs.existsSync(xmlFile)) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: `${fileKey}.xml not found for app '${appName}'` }));
      return;
    }
    try {
      const content = fs.readFileSync(xmlFile, 'utf8');
      res.writeHead(200, { 'Content-Type': 'application/xml; charset=utf-8' });
      res.end(content);
    } catch (error) {
      this.log('error', 'appTemplates', `Failed to read ${fileKey}.xml for ${appName}: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: 'Internal server error' }));
    }
  }

  /**
   * GET /api/appTemplates/{app}/scenarios/list
   * Returns JSON array of { id, label } for all scenarios in an app template.
   * Used by the dashboard step editor to populate the scenario picker.
   */
  private handleListTemplateScenarios(
    _req: http.IncomingMessage,
    res: http.ServerResponse,
    pathname: string
  ): void {
    const m = pathname.match(/^\/api\/appTemplates\/([^/]+)\/scenarios\/list$/);
    if (!m) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: 'Expected: /api/appTemplates/{app}/scenarios/list' }));
      return;
    }
    const [, appName] = m;
    const templatesDir = this.findAppRoot(appName) ?? this.resolveAppTemplateRoots()[0];
    const loader = new XmlScenarioLoader(templatesDir, this.resolveAppTemplateRoots());
    try {
      const info = loader.listScenarios(appName);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: true, app: appName, scenarios: info.scenarios }));
    } catch (err) {
      this.log('error', 'appTemplates', `listScenarios ${appName}: ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: 'Internal server error' }));
    }
  }

  /**
   * GET /api/appTemplates/{app}/scenarios/{id}/steps
   * Returns the raw (unresolved) step list for a specific scenario.
   * Used by the dashboard step editor — ScenarioRef nodes appear as objects
   * rather than being recursively expanded.
   */
  private handleGetRawScenarioSteps(
    _req: http.IncomingMessage,
    res: http.ServerResponse,
    pathname: string
  ): void {
    // pathname: /api/appTemplates/{app}/scenarios/{id}/steps
    const m = pathname.match(/^\/api\/appTemplates\/([^/]+)\/scenarios\/([^/]+)\/steps$/);
    if (!m) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: 'Expected: /api/appTemplates/{app}/scenarios/{id}/steps' }));
      return;
    }
    const [, appName, scenarioId] = m;
    const templatesDir = this.findAppRoot(appName) ?? this.resolveAppTemplateRoots()[0];
    const loader = new XmlScenarioLoader(templatesDir, this.resolveAppTemplateRoots());
    try {
      const raw = loader.loadRaw(appName, scenarioId);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: true, ...raw }));
    } catch (err) {
      this.log('error', 'appTemplates', `loadRaw ${appName}/${scenarioId}: ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
      const isNotFound = err instanceof Error && err.message.includes('not found');
      res.writeHead(isNotFound ? 404 : 500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: isNotFound ? err.message : 'Internal server error' }));
    }
  }

  /**
   * GET /api/appTemplates/{app}/scenarios/{id}/localeMap
   * Query params:
   *   ?param=X  — filter to a specific parameter name
   *   ?lang=Y   — return only entries for a given language tag
   * Returns JSON: { success: true, app, scenarioId, localeMaps: LocaleMapData[] }
   */
  private handleGetLocaleMap(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    pathname: string
  ): void {
    const m = pathname.match(/^\/api\/appTemplates\/([^/]+)\/scenarios\/([^/]+)\/localeMap$/);
    if (!m) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: 'Expected: /api/appTemplates/{app}/scenarios/{id}/localeMap' }));
      return;
    }
    const [, appName, scenarioId] = m;
    const url = new URL(req.url ?? '', 'http://localhost');
    const filterParam = url.searchParams.get('param') ?? undefined;
    const filterLang  = url.searchParams.get('lang')  ?? undefined;

    const templatesDir = this.findAppRoot(appName) ?? this.resolveAppTemplateRoots()[0];
    const loader = new XmlScenarioLoader(templatesDir, this.resolveAppTemplateRoots());
    try {
      let maps = loader.getLocaleMaps(appName, scenarioId);
      if (filterParam) maps = maps.filter(m => m.param === filterParam);
      if (filterLang) {
        maps = maps.map(m => ({ ...m, entries: m.entries.filter(e => e.lang === filterLang) }));
      }
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: true, app: appName, scenarioId, localeMaps: maps }));
    } catch (err) {
      this.log('error', 'appTemplates', `getLocaleMaps ${appName}/${scenarioId}: ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
      const isNotFound = err instanceof Error && err.message.includes('not found');
      res.writeHead(isNotFound ? 404 : 500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: isNotFound ? err.message : 'Internal server error' }));
    }
  }

  /**
   * PUT /api/appTemplates/{app}/scenarios/{id}
   * Body: { label: string, steps: RawXmlStep[] }
   * Saves the modified scenario back to scenarios.xml.
   */
  private async handleSaveScenario(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    pathname: string
  ): Promise<void> {
    // pathname: /api/appTemplates/{app}/scenarios/{id}
    const m = pathname.match(/^\/api\/appTemplates\/([^/]+)\/scenarios\/([^/]+)$/);
    if (!m) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: 'Expected: /api/appTemplates/{app}/scenarios/{id}' }));
      return;
    }
    const [, appName, scenarioId] = m;
    const body = await this.readBody(req);
    let payload: { label?: string; steps?: RawXmlStep[]; meta?: { helper?: string; process?: string; appTitle?: string; assistant?: string; checksum?: string } };
    try {
      payload = JSON.parse(body);
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: 'Invalid JSON body' }));
      return;
    }
    if (!Array.isArray(payload.steps)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: 'Body must have a steps array' }));
      return;
    }
    const templatesDir = this.findAppRoot(appName) ?? this.resolveAppTemplateRoots()[0];
    const loader = new XmlScenarioLoader(templatesDir, this.resolveAppTemplateRoots());
    try {
      loader.save(appName, scenarioId, payload.label ?? scenarioId, payload.steps, payload.meta);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, app: appName, scenarioId }));
    } catch (err) {
      this.log('error', 'appTemplates', `saveScenario ${appName}/${scenarioId}: ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: 'Internal server error' }));
    }
  }

  /**
   * POST /api/appTemplates/{app}/scenarios/{scenarioId}/run
   *
   * Body (JSON):
   *   { params?: Record<string,string>, verbose?: boolean }
   *
   * Loads the named scenario from apptemplates/{app}/scenarios.xml,
   * resolves all <ScenarioRef> elements recursively, then executes the
   * step sequence via HelperRegistry.
   */
  private handleRunAppTemplateScenario(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    pathname: string,
  ): void {
    // pathname = /api/appTemplates/<app>/scenarios/<id>/run
    const parts = pathname.replace('/api/appTemplates/', '').split('/');
    // parts = [app, 'scenarios', id, 'run']
    if (parts.length !== 4 || parts[1] !== 'scenarios' || parts[3] !== 'run') {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: 'Expected /api/appTemplates/{app}/scenarios/{id}/run' }));
      return;
    }
    const [appName, , scenarioId] = parts;

    if (!appName || appName.includes('..') || appName.includes('/') || appName.includes('\\')) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: 'Invalid app name' }));
      return;
    }

    if (!this.helperRegistry) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: 'HelperRegistry not available' }));
      return;
    }

    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', async () => {
      let parsed: { params?: Record<string, string>; verbose?: boolean } = {};
      try { if (body) parsed = JSON.parse(body); } catch { /* use defaults */ }

      try {
        const templatesDir = this.findAppRoot(appName) ?? this.resolveAppTemplateRoots()[0];
        const loader   = new XmlScenarioLoader(templatesDir, this.resolveAppTemplateRoots());
        const scenario = loader.load(appName, scenarioId);
        const registry = this.helperRegistry!;
        const authCtx  = AuthMiddleware.getContext(req as AuthedRequest);
        const callerUser  = authCtx?.user?.username ?? '';
        const callerRoles = authCtx?.effectiveRoles?.join(',') ?? '';
        const result   = await runXmlScenario({
          scenario,
          params:  parsed.params  ?? {},
          verbose: parsed.verbose ?? false,
          callFn:  (tool, proc, action, path, value, scroll) => {
                     if (tool === 'fetch_webpage') {
                       const opts: Record<string, any> = { method: path || 'GET', extractText: false };
                       if (value) { try { opts.body = JSON.parse(value); } catch { opts.body = value; } }
                       return this.automationEngine.fetchWebpage(proc, opts);
                     }
                     return registry.callCommand(tool, proc, action, path ?? '', value ?? '', 20000, callerUser, callerRoles, scroll ?? false);
                   },
        });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      } catch (error) {
        this.log('error', 'appTemplates', `Scenario run failed — ${appName}/${scenarioId}: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: error instanceof Error ? error.message : String(error) }));
      }
    });
    req.on('error', (e) => {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: e instanceof Error ? e.message : String(e) }));
    });
  }

  private handleGetScenarios(req: http.IncomingMessage, res: http.ServerResponse): void {
    try {
      const scenariosDir = path.join(__dirname, '../../scenarios');
      const files = fs.readdirSync(scenariosDir);

      const scenarios = files
        .filter(f => f.endsWith('.json'))
        .map(f => ({
          name: f.replace('.json', ''),
          path: `config/scenarios/${f}`,
        }));

      res.writeHead(200);
      res.end(JSON.stringify({ success: true, scenarios }));
    } catch (error) {
      this.log('error', 'scenarios', `Failed to list scenarios: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
      res.writeHead(500);
      res.end(JSON.stringify({ success: false, error: 'Internal server error' }));
    }
  }

  /**
   * POST /api/scenarios/run
   */
  private async handleRunScenario(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    try {
      const body = await this.readBody(req);
      const { scenarioPath } = JSON.parse(body);

      this.log('info', 'scenarios', `Running scenario: ${scenarioPath}`);

      // TODO: Implement scenario execution
      // For now, return mock result
      res.writeHead(200);
      res.end(JSON.stringify({
        success: true,
        result: {
          success: true,
          steps: 5,
          duration: 1234,
        },
      }));

      this.log('info', 'scenarios', `Scenario completed: ${scenarioPath}`);
    } catch (error) {
      this.log('error', 'scenarios', `Failed to run scenario: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
      res.writeHead(500);
      res.end(JSON.stringify({ success: false, error: 'Internal server error' }));
    }
  }

  // Legacy automation endpoints (unchanged from original HttpServer)

  private async handleQueryTree(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const body = await this.readBody(req);
    const { providerName, targetId, options } = JSON.parse(body);

    // Always log query tree requests for debugging
    this.log('info', 'automation', `queryTree request - Provider: ${providerName}, TargetId: ${targetId}, Options: ${JSON.stringify(options)}`);
    
    if (this.verboseLogging) {
      this.logJSON('debug', 'automation', 'queryTree request', { providerName, targetId, options });
    }

    try {
      const tree = await this.automationEngine.queryTree(providerName, targetId, options);
      
      if (this.verboseLogging) {
        this.logJSON('debug', 'automation', 'queryTree response', tree);
      }
      
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: true, data: tree }));
    } catch (error) {
      this.log('error', 'automation', `queryTree failed: ${error}`);
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: false, error: error instanceof Error ? error.message : String(error) }));
    }
  }

  private async handleClickElement(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const body = await this.readBody(req);
    const { providerName, elementId } = JSON.parse(body);

    if (this.verboseLogging) {
      this.logJSON('debug', 'automation', 'clickElement request', { providerName, elementId });
    }

    try {
      const result = await this.automationEngine.clickElement(providerName, elementId);
      
      if (this.verboseLogging) {
        this.logJSON('debug', 'automation', 'clickElement response', result);
      }
      
      res.writeHead(200);
      res.end(JSON.stringify({ success: true, data: result }));
    } catch (error) {
      this.log('error', 'automation', `clickElement failed: ${error}`);
      res.writeHead(400);
      res.end(JSON.stringify({ success: false, error: error instanceof Error ? error.message : String(error) }));
    }
  }

  private async handleSetProperty(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const body = await this.readBody(req);
    const { providerName, elementId, property, value } = JSON.parse(body);

    if (this.verboseLogging) {
      this.logJSON('debug', 'automation', 'setProperty request', { providerName, elementId, property, value });
    }

    try {
      const result = await this.automationEngine.setProperty(providerName, elementId, property, value);
      
      if (this.verboseLogging) {
        this.logJSON('debug', 'automation', 'setProperty response', result);
      }
      
      res.writeHead(200);
      res.end(JSON.stringify({ success: true, data: result }));
    } catch (error) {
      res.writeHead(400);
      res.end(JSON.stringify({ success: false, error: error instanceof Error ? error.message : String(error) }));
    }
  }

  private async handleReadProperty(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const body = await this.readBody(req);
    const { providerName, elementId, property } = JSON.parse(body);

    try {
      const value = await this.automationEngine.readProperty(providerName, elementId, property);
      res.writeHead(200);
      res.end(JSON.stringify({ success: true, data: value }));
    } catch (error) {
      res.writeHead(400);
      res.end(JSON.stringify({ success: false, error: error instanceof Error ? error.message : String(error) }));
    }
  }

  private async handleGetProviders(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    try {
      const providers = await this.automationEngine.getAvailableProviders();
      res.writeHead(200);
      res.end(JSON.stringify({ success: true, data: providers }));
    } catch (error) {
      res.writeHead(400);
      res.end(JSON.stringify({ success: false, error: error instanceof Error ? error.message : String(error) }));
    }
  }

  private async handleListWindows(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    try {
      this.log('info', 'automation', 'Listing windows');
      let includeBinaryHash = false;
      let hashAlgorithm: 'SHA256' | 'MD5' = 'SHA256';

      if (req.method === 'POST') {
        const body = await this.readBody(req);
        if (body) {
          try {
            const options = JSON.parse(body);
            includeBinaryHash = Boolean(options?.includeBinaryHash);
            hashAlgorithm = String(options?.algorithm || 'SHA256').toUpperCase() === 'MD5' ? 'MD5' : 'SHA256';
          } catch (error) {
            this.log('warn', 'automation', `Invalid listWindows options: ${error}`);
          }
        }
      }

      const result = await this.automationEngine.listWindows();
      
      // Normalize response - KeyWin.exe returns { windows: [...] }
      const windows = Array.isArray(result) ? result : (result.windows || []);

      if (includeBinaryHash && windows.length > 0) {
        await this.enrichWindowsWithHashes(windows, hashAlgorithm);
      }
      
      if (this.verboseLogging) {
        this.logJSON('debug', 'automation', 'listWindows response', { count: windows.length });
      }
      
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: true, data: windows }));
    } catch (error) {
      this.log('error', 'automation', `listWindows failed: ${error}`);
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: false, error: error instanceof Error ? error.message : String(error) }));
    }
  }

  private async handleLaunchProcess(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    try {
      const body = await this.readBody(req);
      const { executable, args } = JSON.parse(body);

      this.log('info', 'automation', `Launching process: ${executable}`);
      
      if (this.verboseLogging) {
        this.logJSON('debug', 'automation', 'launchProcess request', { executable, args });
      }

      const result = await this.automationEngine.launchProcess(executable, args);
      
      if (this.verboseLogging) {
        this.logJSON('debug', 'automation', 'launchProcess response', result);
      }
      
      res.writeHead(200);
      res.end(JSON.stringify({ success: true, data: result }));
    } catch (error) {
      this.log('error', 'automation', `launchProcess failed: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
      res.writeHead(400);
      res.end(JSON.stringify({ success: false, error: error instanceof Error ? error.message : String(error) }));
    }
  }

  private async handleProcessHash(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    try {
      if (process.platform !== 'win32') {
        throw new Error('Process hash is only supported on Windows hosts');
      }

      const body = await this.readBody(req);
      const { processId, processName, algorithm } = JSON.parse(body || '{}');

      if (!processId && !processName) {
        throw new Error('processId or processName is required');
      }

      const normalizedAlgorithm: 'SHA256' | 'MD5' =
        String(algorithm || 'SHA256').toUpperCase() === 'MD5' ? 'MD5' : 'SHA256';

      const executablePath = await this.resolveProcessPath(
        processId ? Number(processId) : undefined,
        processName ? String(processName) : undefined
      );

      const hash = this.getFileHash(executablePath, normalizedAlgorithm);

      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({
        success: true,
        algorithm: normalizedAlgorithm,
        hash,
        path: executablePath,
      }));
    } catch (error) {
      this.log('error', 'security', `process-hash failed: ${error}`);
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: false, error: error instanceof Error ? error.message : String(error) }));
    }
  }

  private async enrichWindowsWithHashes(windows: any[], algorithm: 'SHA256' | 'MD5'): Promise<void> {
    for (const win of windows) {
      try {
        const pid = win?.pid ? Number(win.pid) : (win?.processId ? Number(win.processId) : undefined);
        const processName = win?.processName ? String(win.processName) : undefined;

        const executablePath = await this.resolveProcessPath(pid, processName);
        const hash = this.getFileHash(executablePath, algorithm);
        win.binaryHash = `${algorithm}:${hash}`;
        win.processPath = executablePath;
      } catch (error) {
        win.binaryHash = null;
        if (this.verboseLogging) {
          this.log('debug', 'security', `Skipping hash for window (pid=${win?.pid}): ${error}`);
        }
      }
    }
  }

  private async resolveProcessPath(processId?: number, processName?: string): Promise<string> {
    if (process.platform !== 'win32') {
      throw new Error('Process path resolution is only supported on Windows hosts');
    }

    if (!processId && !processName) {
      throw new Error('processId or processName is required');
    }

    const name = processName ? processName.replace(/\.exe$/i, '') : undefined;
    const escapedName = name ? name.replace(/'/g, "''") : undefined;
    const command = processId
      ? `(Get-Process -Id ${processId} -ErrorAction Stop | Select-Object -ExpandProperty Path)`
      : `(Get-Process -Name '${escapedName}' -ErrorAction Stop | Select-Object -First 1 -ExpandProperty Path)`;

    const { stdout } = await execFileAsync('powershell', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      command,
    ], {
      windowsHide: true,
    });

    const resolved = String(stdout || '').trim();
    if (!resolved) {
      throw new Error('Executable path not found for process');
    }

    return resolved;
  }

  private getFileHash(filePath: string, algorithm: 'SHA256' | 'MD5'): string {
    const normalizedAlgorithm = algorithm === 'MD5' ? 'md5' : 'sha256';
    const stat = fs.statSync(filePath);
    const cacheKey = `${normalizedAlgorithm}|${filePath.toLowerCase()}`;
    const cached = this.processHashCache.get(cacheKey);

    if (cached && cached.mtimeMs === stat.mtimeMs) {
      return cached.hash;
    }

    const content = fs.readFileSync(filePath);
    const hash = crypto.createHash(normalizedAlgorithm).update(content).digest('hex');
    this.processHashCache.set(cacheKey, { hash, mtimeMs: stat.mtimeMs });
    return hash;
  }

  private readBody(req: http.IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
      let data = '';
      req.on('data', (chunk) => {
        data += chunk.toString();
      });
      req.on('end', () => {
        resolve(data);
      });
      req.on('error', reject);
    });
  }

  /**
   * Settings Management Endpoints
   */
  private async handleGetSettings(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    try {
      const settings = {
        paths: {
          scenarios: this.config.scenariosPath || './scenarios',
          security: this.config.securityPath || './security',
          publicKey: this.config.publicKeyPath || './security/public.key.enc',
          privateKey: this.config.privateKeyPath || './security/private.key.enc',
          helperPaths: this.config.helperPaths || ['./dist/win/*.exe'],
        },
        security: {
          requireSignature: this.config.requireBinarySignature || false,
          requireOsEnforcement: this.config.requireOsEnforcement || false,
          allowUnsignedScenarios: this.config.allowUnsignedScenarios || false,
          enableSessionAuth: this.sessionTokenManager !== null,
          allowedExecutables: this.config.allowedExecutables || [],
          blockedExecutables: this.config.blockedExecutables || [],
          allowedPaths: this.config.allowedPaths || [],
          blockedPaths: this.config.blockedPaths || [],
        },
        server: {
          port: this.config.mcpPort || 3457,
          dashboardPort: this.port,
          logLevel: this.config.logLevel || 'info',
          tokenExpiry: this.config.tokenExpiry || 60,
        },
        currentWorkingDir: process.cwd(),
        currentToken: this.sessionTokenManager?.generateToken() || null,
        testSessionDir: this.config.testSessionDir || './test-sessions',
      };

      res.writeHead(200);
      res.end(JSON.stringify(settings));
    } catch (error) {
      this.log('error', 'settings', `Failed to get settings: ${error}`);
      res.writeHead(500);
      res.end(JSON.stringify({ error: 'Failed to load settings' }));
    }
  }

  /**
   * GET /api/auth/config
   * Returns the current auth configuration. Secrets are masked (never sent to browser).
   */
  private async handleGetAuthConfig(_req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    try {
      // Build a safe view: copy auth config and mask secrets
      const auth: Record<string, unknown> = JSON.parse(JSON.stringify(this.config.auth ?? {}));
      // Mask jwt.secret
      if (auth.jwt && typeof (auth.jwt as Record<string, unknown>).secret === 'string') {
        (auth.jwt as Record<string, unknown>).secret = '***';
      }
      // Mask oauth.clientSecret
      if (auth.oauth && typeof (auth.oauth as Record<string, unknown>).clientSecret === 'string') {
        (auth.oauth as Record<string, unknown>).clientSecret = '***';
      }
      // Never send saml private key
      if (auth.saml) {
        delete (auth.saml as Record<string, unknown>).privateKey;
      }
      // Never send db password
      if (auth.users && (auth.users as Record<string, unknown>).db) {
        delete ((auth.users as Record<string, unknown>).db as Record<string, unknown>).password;
      }
      // Provide defaults for required fields if auth config is absent
      if (!auth.mode) auth.mode = 'none';
      if (!auth.jwt) auth.jwt = { enabled: true, expiryMinutes: 60 };
      if (!auth.users) auth.users = { storeSource: 'json', jsonPath: './config/users.json' };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(auth));
    } catch (error) {
      this.log('error', 'settings', `Failed to get auth config: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
      res.writeHead(500);
      res.end(JSON.stringify({ success: false, error: 'Internal server error' }));
    }
  }

  /**
   * POST /api/auth/config
   * Saves the auth section to config and re-initialises the auth service.
   * Secrets omitted from the request body are preserved from the existing config.
   */
  private async handleSaveAuthConfig(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    try {
      const body = await this.readBody(req);
      const incoming = JSON.parse(body) as Record<string, unknown>;

      // Start from existing auth config (preserve secrets not sent by browser)
      const existing: Record<string, unknown> = JSON.parse(JSON.stringify(this.config.auth ?? {}));

      // Deep-merge: incoming wins except for sentinel '***' values which revert to existing
      const mergeSecrets = (dest: Record<string, unknown>, src: Record<string, unknown>, ...keys: string[]) => {
        for (const k of keys) {
          if (src[k] && src[k] !== '***') dest[k] = src[k];
          // If key absent or '***' in src — dest keeps its existing value
        }
      };

      // Top-level fields
      const merged: Record<string, unknown> = {
        ...existing,
        mode: incoming.mode ?? existing.mode ?? 'none',
        debugExternalAuth: incoming.debugExternalAuth ?? existing.debugExternalAuth ?? false,
      };

      // JWT
      const inJwt = (incoming.jwt ?? {}) as Record<string, unknown>;
      const exJwt = (existing.jwt ?? {}) as Record<string, unknown>;
      merged.jwt = { ...exJwt, ...inJwt };
      mergeSecrets(merged.jwt as Record<string, unknown>, inJwt, 'secret');
      if ((merged.jwt as Record<string, unknown>).secret === '***') {
        (merged.jwt as Record<string, unknown>).secret = exJwt.secret;
      }

      // Mode-specific settings
      if (incoming.password) merged.password = incoming.password;
      if (incoming.apikey)   merged.apikey   = incoming.apikey;
      if (incoming.certificate) merged.certificate = incoming.certificate;
      if (incoming.oauth) {
        const inOAuth = incoming.oauth as Record<string, unknown>;
        const exOAuth = (existing.oauth ?? {}) as Record<string, unknown>;
        merged.oauth = { ...exOAuth, ...inOAuth };
        mergeSecrets(merged.oauth as Record<string, unknown>, inOAuth, 'clientSecret');
        if ((merged.oauth as Record<string, unknown>).clientSecret === '***') {
          (merged.oauth as Record<string, unknown>).clientSecret = exOAuth.clientSecret;
        }
      }
      if (incoming.saml) {
        const inSaml = incoming.saml as Record<string, unknown>;
        const exSaml = (existing.saml ?? {}) as Record<string, unknown>;
        merged.saml = { ...exSaml, ...inSaml };
        mergeSecrets(merged.saml as Record<string, unknown>, inSaml, 'privateKey');
        if (!(merged.saml as Record<string, unknown>).privateKey) {
          (merged.saml as Record<string, unknown>).privateKey = exSaml.privateKey;
        }
      }

      // User store
      if (incoming.users) {
        const inUsers = incoming.users as Record<string, unknown>;
        const exUsers = (existing.users ?? {}) as Record<string, unknown>;
        merged.users = { ...exUsers, ...inUsers };
        if (inUsers.db) {
          const inDb = inUsers.db as Record<string, unknown>;
          const exDb = (exUsers.db ?? {}) as Record<string, unknown>;
          const mergedDb = { ...exDb, ...inDb } as Record<string, unknown>;
          mergeSecrets(mergedDb, inDb, 'password');
          // Normalise flat dashboard form fields (authMethod/username/password) →
          // proper nested DbConfig.auth shape expected by DbUserStore / DbSettingsAdapter.
          if (mergedDb.authMethod && !mergedDb.auth) {
            mergedDb.auth = {
              method:           mergedDb.authMethod,
              username:         mergedDb.username,
              password:         mergedDb.password,
              connectionString: mergedDb.connectionString,
            };
            delete mergedDb.authMethod;
            delete mergedDb.username;
            delete mergedDb.password;
            delete mergedDb.connectionString;
          }
          (merged.users as Record<string, unknown>).db = mergedDb;
        }
      }

      // Persist
      this.config.auth = merged;
      this.saveConfigToDisk();

      // Re-initialise auth service with new config
      try {
        await this.initAuth(merged as unknown as AuthConfig);
      } catch (reinitErr) {
        this.log('warn', 'auth', `Auth reinit warning: ${reinitErr}`);
      }

      this.log('info', 'auth', `Auth config updated (mode: ${merged.mode})`);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, mode: merged.mode }));
    } catch (error) {
      this.log('error', 'settings', `Failed to save auth config: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
      res.writeHead(500);
      res.end(JSON.stringify({ success: false, error: 'Internal server error' }));
    }
  }

  /**
   * POST /api/shell/openFileDialog
   * Body: { folder?: boolean, title?: string, filter?: string, initialDir?: string }
   *
   * Opens a native Windows file or folder picker via PowerShell
   * System.Windows.Forms and returns the selected path.
   * Returns { success: true, path: string|null }
   * Only available on Windows; returns { success: false, error: 'not supported' } on other platforms.
   */
  private async handleOpenFileDialog(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    if (process.platform !== 'win32') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: 'Native file dialog is only supported on Windows.' }));
      return;
    }
    try {
      const body = await this.readBody(req);
      const opts = body ? JSON.parse(body) as { folder?: boolean; title?: string; filter?: string; initialDir?: string } : {};

      let psScript: string;
      if (opts.folder) {
        const title   = (opts.title   || 'Select Folder').replace(/'/g, "''");
        const initDir = (opts.initialDir || 'C:\\').replace(/'/g, "''");
        psScript = [
          "Add-Type -AssemblyName System.Windows.Forms",
          "$d = New-Object System.Windows.Forms.FolderBrowserDialog",
          `$d.Description = '${title}'`,
          `$d.SelectedPath = '${initDir}'`,
          "$d.ShowNewFolderButton = $true",
          "if ($d.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { Write-Output $d.SelectedPath } else { Write-Output '' }",
        ].join('; ');
      } else {
        const title   = (opts.title   || 'Select File').replace(/'/g, "''");
        const filter  = (opts.filter  || 'All files (*.*)|*.*').replace(/'/g, "''");
        const initDir = (opts.initialDir || 'C:\\').replace(/'/g, "''");
        psScript = [
          "Add-Type -AssemblyName System.Windows.Forms",
          "$d = New-Object System.Windows.Forms.OpenFileDialog",
          `$d.Title = '${title}'`,
          `$d.Filter = '${filter}'`,
          `$d.InitialDirectory = '${initDir}'`,
          "$d.CheckFileExists = $false",
          "if ($d.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { Write-Output $d.FileName } else { Write-Output '' }",
        ].join('; ');
      }

      const { stdout } = await execFileAsync('powershell.exe', [
        '-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', psScript,
      ], { timeout: 60000 });

      const selected = stdout.trim();
      this.log('debug', 'shell', `File dialog returned: "${selected}"`);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, path: selected || null }));
    } catch (error) {
      this.log('error', 'shell', `File dialog failed: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: 'Internal server error' }));
    }
  }

  // ── Setup Wizard ─────────────────────────────────────────────────────────

  /** Build a snapshot of which setup steps are complete. */
  private getSetupStepStatus(secDir: string, cfgDir: string): { id: string; label: string; done: boolean; message: string }[] {
    const certManager = new CertificateManager(secDir);
    const keys = certManager.keysExist();
    const s1done = keys.public && keys.private;

    const configSigPath = path.join(secDir, 'config.json.sig');
    const configJsonPath = path.join(secDir, 'config.json');
    const s2done = fs.existsSync(configJsonPath) && fs.existsSync(configSigPath);

    const dashSettingsPath = path.join(cfgDir, 'dashboard-settings.json');
    const s4done = fs.existsSync(dashSettingsPath);

    const usersJsonPath = path.join(cfgDir, 'users.json');
    const s5done = fs.existsSync(usersJsonPath);

    return [
      { id: 'S1', label: 'Generate cryptographic key pair', done: s1done,
        message: s1done ? 'Keys exist.' : 'Keys missing — will be generated with a random password.' },
      { id: 'S2', label: 'Create & sign security/config.json', done: s2done,
        message: s2done ? 'Signed config present.' : 'Missing — a minimal signed config will be written.' },
      { id: 'S4', label: 'Create default dashboard-settings.json', done: s4done,
        message: s4done ? 'Settings file exists.' : 'Will be created with defaults.' },
      { id: 'S5', label: 'Create default admin user (users.json)', done: s5done,
        message: s5done ? 'User store exists.' : 'Will be created with admin / changeme.' },
    ];
  }

  /**
   * GET /api/_internal/setup/status
   * Returns { steps: [{id, label, done, message}] }
   */
  private handleSetupStatus(_req: http.IncomingMessage, res: http.ServerResponse): void {
    const secDir = path.resolve(this.config.securityPath || 'security');
    const cfgDir = path.resolve('config');
    const steps = this.getSetupStepStatus(secDir, cfgDir);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, steps }));
  }

  /**
   * POST /api/_internal/setup
   * Runs all incomplete setup steps idempotently.
   * Returns { success, steps: [{id, status:'done'|'skip'|'error', message}] }
   */
  private async handleRunSetup(_req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const results: { id: string; status: 'done' | 'skip' | 'error'; message: string }[] = [];
    const secDir = path.resolve(this.config.securityPath || 'security');
    const cfgDir = path.resolve('config');

    // Ensure directories exist
    if (!fs.existsSync(secDir)) fs.mkdirSync(secDir, { recursive: true });
    if (!fs.existsSync(cfgDir)) fs.mkdirSync(cfgDir, { recursive: true });

    // ── S1: Crypto key pair ──────────────────────────────────────────────────
    try {
      const certManager = new CertificateManager(secDir);
      const keys = certManager.keysExist();
      if (!keys.public || !keys.private) {
        const password = crypto.randomBytes(16).toString('hex');
        await certManager.initialize(password, password);
        this.log('info', 'setup', 'S1: Key pair generated.');
        results.push({ id: 'S1', status: 'done',
          message: `Key pair generated. Setup password (store securely!): ${password}` });
      } else {
        results.push({ id: 'S1', status: 'skip', message: 'Key pair already exists.' });
      }
    } catch (e) {
      results.push({ id: 'S1', status: 'error', message: `Key generation failed: ${e}` });
    }

    // ── S2: security/config.json skeleton + signature ────────────────────────
    try {
      const configJsonPath = path.join(secDir, 'config.json');
      const configSigPath  = path.join(secDir, 'config.json.sig');
      if (!fs.existsSync(configJsonPath) || !fs.existsSync(configSigPath)) {
        const skeleton = {
          version: '1',
          createdAt: new Date().toISOString(),
          helpers: {},
          binaries: {},
        };
        fs.writeFileSync(configJsonPath, JSON.stringify(skeleton, null, 2), 'utf8');
        // Generate a detached signature (hash-only, no private key needed for skeleton)
        const content = fs.readFileSync(configJsonPath, 'utf8');
        const hash = crypto.createHash('sha256').update(content, 'utf8').digest('hex');
        const sig = { algorithm: 'SHA256-skeleton', contentHash: hash, createdAt: new Date().toISOString() };
        fs.writeFileSync(configSigPath, JSON.stringify(sig, null, 2), 'utf8');
        this.log('info', 'setup', 'S2: security/config.json skeleton created.');
        results.push({ id: 'S2', status: 'done', message: 'Minimal security/config.json + .sig written.' });
      } else {
        results.push({ id: 'S2', status: 'skip', message: 'security/config.json already signed.' });
      }
    } catch (e) {
      results.push({ id: 'S2', status: 'error', message: `Config skeleton failed: ${e}` });
    }

    // ── S4: dashboard-settings.json ──────────────────────────────────────────
    try {
      const dashSettingsPath = path.join(cfgDir, 'dashboard-settings.json');
      if (!fs.existsSync(dashSettingsPath)) {
        const defaults = {
          port: 3458, mcpPort: 3457, logLevel: 'info',
          scenariosPath: './config/scenarios', securityPath: './config/security',
          publicKeyPath: './security/public.key.enc', privateKeyPath: './security/private.key.enc',
        };
        fs.writeFileSync(dashSettingsPath, JSON.stringify(defaults, null, 2), 'utf8');
        this.log('info', 'setup', 'S4: dashboard-settings.json created.');
        results.push({ id: 'S4', status: 'done', message: 'dashboard-settings.json written with defaults.' });
      } else {
        results.push({ id: 'S4', status: 'skip', message: 'dashboard-settings.json already exists.' });
      }
    } catch (e) {
      results.push({ id: 'S4', status: 'error', message: `Settings file failed: ${e}` });
    }

    // ── S5: Default admin user ───────────────────────────────────────────────
    try {
      const usersJsonPath = path.join(cfgDir, 'users.json');
      if (!fs.existsSync(usersJsonPath)) {
        // JsonUserStore will auto-create on next AuthService load — trigger by writing empty store
        const emptyStore = { users: [], version: 1 };
        fs.writeFileSync(usersJsonPath, JSON.stringify(emptyStore, null, 2), 'utf8');
        this.log('info', 'setup', 'S5: users.json placeholder written; AuthService will create default admin on next load.');
        results.push({ id: 'S5', status: 'done',
          message: 'users.json initialised. Default admin/changeme will be created on next auth service load.' });
      } else {
        results.push({ id: 'S5', status: 'skip', message: 'users.json already exists.' });
      }
    } catch (e) {
      results.push({ id: 'S5', status: 'error', message: `User store init failed: ${e}` });
    }

    const allOk = results.every(r => r.status !== 'error');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: allOk, steps: results }));
  }

  private async handleSaveSettings(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    try {
      const body = await this.readBody(req);
      const settings = JSON.parse(body);

      // Update config (in-memory for now)
      if (settings.paths) {
        this.config.scenariosPath = settings.paths.scenarios;
        this.config.securityPath = settings.paths.security;
        this.config.publicKeyPath = settings.paths.publicKey;
        this.config.privateKeyPath = settings.paths.privateKey;
        if (Array.isArray(settings.paths.helperPaths)) {
          this.config.helperPaths = settings.paths.helperPaths;
        }
      }

      if (settings.security) {
        this.config.requireBinarySignature = settings.security.requireSignature;
        this.config.requireOsEnforcement = settings.security.requireOsEnforcement;
        this.config.allowUnsignedScenarios = settings.security.allowUnsignedScenarios;
        this.config.allowedExecutables = settings.security.allowedExecutables;
        this.config.blockedExecutables = settings.security.blockedExecutables;
        this.config.allowedPaths = settings.security.allowedPaths;
        this.config.blockedPaths = settings.security.blockedPaths;
      }

      if (settings.server) {
        this.config.mcpPort = settings.server.port;
        this.config.logLevel = settings.server.logLevel;
        this.config.tokenExpiry = settings.server.tokenExpiry;
      }

      if (typeof settings.testSessionDir === 'string' && settings.testSessionDir.trim()) {
        this.config.testSessionDir = settings.testSessionDir.trim();
        this.helperRegistry?.setSessionBaseDir(this.config.testSessionDir);
      }

      // Persist settings to dashboard-settings.json
      this.saveConfigToDisk();
      this.log('info', 'settings', 'Settings updated successfully');

      res.writeHead(200);
      res.end(JSON.stringify({
        success: true,
        requiresRestart: settings.server?.port !== undefined || settings.server?.dashboardPort !== undefined,
      }));
    } catch (error) {
      this.log('error', 'settings', `Failed to save settings: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
      res.writeHead(500);
      res.end(JSON.stringify({ success: false, error: 'Internal server error' }));
    }
  }

  private async handleValidateSettings(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    try {
      const fs = require('fs');
      const path = require('path');
      const checks: { status: string; message: string }[] = [];

      // ── Folders ──────────────────────────────────────────────
      const scenariosPath = this.config.scenariosPath || './scenarios';
      checks.push({
        status: fs.existsSync(scenariosPath) ? 'ok' : 'error',
        message: `Scenarios folder: ${scenariosPath}`,
      });

      const securityPath = this.config.securityPath || './security';
      checks.push({
        status: fs.existsSync(securityPath) ? 'ok' : 'error',
        message: `Security folder: ${securityPath}`,
      });

      // ── Key files (existence + non-trivial size) ─────────────
      const checkKeyFile = (label: string, filePath: string) => {
        if (!fs.existsSync(filePath)) {
          checks.push({ status: 'warning', message: `${label}: not found (${filePath})` });
        } else {
          const size = fs.statSync(filePath).size;
          checks.push({
            status: size > 32 ? 'ok' : 'warning',
            message: `${label}: ${filePath} (${size} bytes${size <= 32 ? ' — suspiciously small' : ''})`,
          });
        }
      };
      checkKeyFile('Public key', this.config.publicKeyPath || './security/public.key.enc');
      checkKeyFile('Private key', this.config.privateKeyPath || './security/private.key.enc');

      // ── security/config.json + its signature ─────────────────
      const configJsonPath = path.join(securityPath, 'config.json');
      const configSigPath  = path.join(securityPath, 'config.json.sig');
      if (!fs.existsSync(configJsonPath)) {
        checks.push({ status: 'warning', message: `Security config: not found (${configJsonPath})` });
      } else {
        let parsed = false;
        try { JSON.parse(fs.readFileSync(configJsonPath, 'utf8')); parsed = true; } catch (_) {}
        checks.push({
          status: parsed ? 'ok' : 'error',
          message: `Security config: ${configJsonPath} — JSON ${parsed ? 'valid' : 'INVALID'}`,
        });

        checks.push({
          status: fs.existsSync(configSigPath) ? 'ok' : 'warning',
          message: `Security config signature: ${configSigPath}${fs.existsSync(configSigPath) ? '' : ' — not found'}`,
        });

        // If .sig exists, verify the embedded configHash matches the actual file
        if (fs.existsSync(configSigPath)) {
          try {
            const crypto = require('crypto');
            const sigMeta = JSON.parse(fs.readFileSync(configSigPath, 'utf8'));
            if (sigMeta.configHash) {
              const actualHash = crypto.createHash('sha256')
                .update(fs.readFileSync(configJsonPath, 'utf8'), 'utf8')
                .digest('hex');
              const match = actualHash === sigMeta.configHash;
              checks.push({
                status: match ? 'ok' : 'error',
                message: `Security config hash: ${match ? 'matches signature ✓' : 'MISMATCH — config.json may have been tampered with!'}`,
              });
            }
          } catch (sigErr) {
            checks.push({ status: 'warning', message: `Security config signature: could not parse (${sigErr})` });
          }
        }
      }

      // ── Helper executables ────────────────────────────────────
      const helperPatterns: string[] = Array.isArray(this.config.helperPaths) && this.config.helperPaths.length > 0
        ? this.config.helperPaths
        : ['./dist/helpers/*.exe'];

      for (const pattern of helperPatterns) {
        const baseDir = path.dirname(pattern);
        const glob = path.basename(pattern);
        const isGlob = glob.includes('*') || glob.includes('?');
        if (!fs.existsSync(baseDir)) {
          checks.push({ status: 'warning', message: `Helper path not found: ${baseDir}` });
          continue;
        }
        if (isGlob) {
          // Simple glob: only supports * and ? in basename
          const re = new RegExp(
            '^' + glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$',
            'i');
          const exes = (fs.readdirSync(baseDir) as string[]).filter(f => re.test(f));
          if (exes.length === 0) {
            checks.push({ status: 'warning', message: `Helper pattern ${pattern}: no files found` });
          } else {
            checks.push({ status: 'ok', message: `Helper pattern ${pattern}: ${exes.length} file(s) — ${exes.join(', ')}` });
          }
        } else {
          const fullPath = path.join(baseDir, glob);
          checks.push({
            status: fs.existsSync(fullPath) ? 'ok' : 'warning',
            message: `Helper executable: ${fullPath}`,
          });
        }
      }

      // ── Session token manager ─────────────────────────────────
      checks.push({
        status: this.sessionTokenManager ? 'ok' : 'warning',
        message: 'Session token manager',
      });

      // ── Security filter rules ─────────────────────────────────
      const advancedCount = (this.config.advancedFilters || []).length;
      const legacyCount =
        (this.config.allowedExecutables?.length || 0) +
        (this.config.blockedExecutables?.length || 0) +
        (this.config.allowedPaths?.length || 0) +
        (this.config.blockedPaths?.length || 0);
      const totalFilters = advancedCount + legacyCount;
      checks.push({
        status: totalFilters > 0 ? 'ok' : 'warning',
        message: `Security filters: ${totalFilters} rule(s) configured${totalFilters === 0 ? ' — all access allowed' : ` (${advancedCount} advanced, ${legacyCount} legacy)`}`,
      });

      res.writeHead(200);
      res.end(JSON.stringify({ checks }));
    } catch (error) {
      this.log('error', 'settings', `Validation error: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
      res.writeHead(500);
      res.end(JSON.stringify({ success: false, error: 'Internal server error' }));
    }
  }

  /**
   * GET /api/filters
   * Returns the advanced security filter list
   */
  private handleGetFilters(req: http.IncomingMessage, res: http.ServerResponse): void {
    res.writeHead(200);
    res.end(JSON.stringify({
      success: true,
      filters: this.config.advancedFilters || [],
    }));
  }

  /**
   * GET /api/security/log[?limit=N&offset=N]
   * Returns security audit entries newest-first, paged.
   * Draws from the persistent securityAuditLog (survives restarts).
   * Defaults: limit=100, offset=0.  Max limit: 500.
   */
  private handleGetSecurityLog(req: http.IncomingMessage, res: http.ServerResponse): void {
    const parsed = url.parse(req.url ?? '', true).query;
    const rawLimit  = parseInt(String(parsed['limit']  ?? '100'), 10);
    const rawOffset = parseInt(String(parsed['offset'] ?? '0'),   10);
    const limit  = Math.min(isNaN(rawLimit)  ? 100 : Math.max(1, rawLimit),  500);
    const offset = isNaN(rawOffset) ? 0 : Math.max(0, rawOffset);

    // newest-first
    const allEntries = this.securityAuditLog.slice().reverse();
    const total   = allEntries.length;
    const entries = allEntries.slice(offset, offset + limit);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, entries, total, offset, limit }));
  }

  /**
   * POST /api/filters
   * Saves the advanced security filter list
   * Body: { filters: FilterRule[] }
   */
  /**
   * POST /api/filters/test  — dry-run: which filter would fire for given inputs?
   */
  private async handleTestFilter(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    try {
      const body = await this.readBody(req);
      const { process: proc, helper, command, parameter } = JSON.parse(body);
      const filters: any[] = this.config.advancedFilters || [];

      // Strip {BRACES} from command if present, matching same logic as mcpServer
      const { verdict: rawVerdict, matchedRule, reason: rawReason } = evaluateFilterRules(
        filters, proc || '', helper || '', command || '', parameter || ''
      );
      // Default to ALLOW when no rule matched (permissive dashboard default)
      const verdict: 'ALLOW' | 'DENY' = rawVerdict ?? 'ALLOW';
      const reason = rawVerdict === null ? 'No rule matched — default ALLOW' : rawReason;

      res.writeHead(200);
      res.end(JSON.stringify({ success: true, verdict, reason, matchedFilter: matchedRule }));
    } catch (error) {
      this.log('error', 'security', `evaluateFilter failed: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
      res.writeHead(500);
      res.end(JSON.stringify({ success: false, error: 'Internal server error' }));
    }
  }

  private async handleToggleHelper(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    try {
      const body = await this.readBody(req);
      const { name, disabled } = JSON.parse(body) as { name: string; disabled: boolean };

      if (!name || typeof name !== 'string') {
        res.writeHead(400);
        res.end(JSON.stringify({ success: false, error: 'name is required' }));
        return;
      }

      if (!Array.isArray(this.config.disabledHelpers)) {
        this.config.disabledHelpers = [];
      }

      const idx = this.config.disabledHelpers.indexOf(name);
      if (disabled && idx === -1) {
        this.config.disabledHelpers.push(name);
      } else if (!disabled && idx !== -1) {
        this.config.disabledHelpers.splice(idx, 1);
      }

      this.saveConfigToDisk();
      const state = disabled ? 'disabled' : 'enabled';
      this.log('info', 'settings', `Helper ${name} ${state}`);

      res.writeHead(200);
      res.end(JSON.stringify({ success: true, name, disabled, disabledHelpers: this.config.disabledHelpers }));
    } catch (err) {
      this.log('error', 'settings', `toggleHelper failed: ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
      res.writeHead(500);
      res.end(JSON.stringify({ success: false, error: 'Internal server error' }));
    }
  }

  private async handleSaveFilters(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    try {
      const body = await this.readBody(req);
      const parsed = JSON.parse(body);

      // ── Single-rule add (body has 'action' but no 'filters' key) ──
      if (parsed.action !== undefined && parsed.filters === undefined) {
        const rule: any = parsed;
        if (!rule.action || !['allow', 'deny'].includes(rule.action)) {
          res.writeHead(400);
          res.end(JSON.stringify({ success: false, error: `Invalid action: ${rule.action}` }));
          return;
        }
        if (!rule.helper || typeof rule.helper !== 'string') {
          res.writeHead(400);
          res.end(JSON.stringify({ success: false, error: 'Each filter must have a helper' }));
          return;
        }
        // Apply defaults for optional FilterRule fields.
        if (!rule.process) rule.process = '*';
        if (!rule.command) rule.command = '*';
        if (!rule.pattern) rule.pattern = '*';
        // Auto-assign a unique numeric ID.
        const existingIds = (this.config.advancedFilters || []).map((f: any) => Number(f.id) || 0);
        rule.id = Math.max(0, ...existingIds) + 1;
        this.config.advancedFilters = [...(this.config.advancedFilters || []), rule];
        this.log('info', 'security', `Added advanced filter rule #${rule.id}: ${rule.action} ${rule.command} on ${rule.process}`);
        this.saveConfigToDisk();
        res.writeHead(201);
        res.end(JSON.stringify({ success: true, ...rule }));
        return;
      }

      // ── Bulk replace (body has 'filters' array) ──
      const { filters } = parsed;

      if (!Array.isArray(filters)) {
        res.writeHead(400);
        res.end(JSON.stringify({ success: false, error: 'filters must be an array' }));
        return;
      }

      // Validate each filter entry
      for (const f of filters) {
        if (!f.action || !['allow', 'deny'].includes(f.action)) {
          res.writeHead(400);
          res.end(JSON.stringify({ success: false, error: `Invalid action: ${f.action}` }));
          return;
        }
        if (!f.helper || typeof f.helper !== 'string') {
          res.writeHead(400);
          res.end(JSON.stringify({ success: false, error: 'Each filter must have a helper' }));
          return;
        }
      }

      this.config.advancedFilters = filters;
      this.log('info', 'security', `Saved ${filters.length} advanced security filter(s)`);
      this.saveConfigToDisk();

      res.writeHead(200);
      res.end(JSON.stringify({ success: true, count: filters.length }));
    } catch (error) {
      this.log('error', 'security', `Failed to save filters: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
      res.writeHead(500);
      res.end(JSON.stringify({ success: false, error: 'Internal server error' }));
    }
  }

  /** DELETE /api/filters/:id — remove a single filter rule by ID */
  private async handleDeleteFilter(req: http.IncomingMessage, res: http.ServerResponse, filterId: string): Promise<void> {
    try {
      const filters: any[] = this.config.advancedFilters || [];
      const newFilters = filters.filter(f => String(f.id) !== filterId);
      if (newFilters.length === filters.length) {
        res.writeHead(404);
        res.end(JSON.stringify({ success: false, error: `Filter ${filterId} not found` }));
        return;
      }
      this.config.advancedFilters = newFilters;
      this.log('info', 'security', `Deleted advanced filter rule #${filterId}`);
      this.saveConfigToDisk();
      res.writeHead(200);
      res.end(JSON.stringify({ success: true, id: filterId }));
    } catch (error) {
      this.log('error', 'security', `Failed to delete filter: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
      res.writeHead(500);
      res.end(JSON.stringify({ success: false, error: 'Internal server error' }));
    }
  }

  private async handleGenerateToken(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    try {
      if (!this.sessionTokenManager) {
        throw new Error('Session token manager not available');
      }

      const token = this.sessionTokenManager.generateToken();
      this.log('info', 'security', 'New session token generated');

      res.writeHead(200);
      res.end(JSON.stringify({ success: true, token }));
    } catch (error) {
      this.log('error', 'security', `Token generation failed: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
      res.writeHead(500);
      res.end(JSON.stringify({ success: false, error: 'Internal server error' }));
    }
  }

  private async handleChangeWorkDir(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    try {
      const body = await this.readBody(req);
      const { path } = JSON.parse(body);

      if (!path || typeof path !== 'string') {
        throw new Error('Invalid path');
      }

      const fs = await import('fs');
      const pathModule = await import('path');
      
      // Resolve to absolute path
      const absolutePath = pathModule.resolve(path);
      
      // Check if directory exists
      if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isDirectory()) {
        throw new Error(`Directory does not exist: ${absolutePath}`);
      }

      // Change working directory
      process.chdir(absolutePath);
      this.log('info', 'settings', `Working directory changed to: ${absolutePath}`);

      res.writeHead(200);
      res.end(JSON.stringify({ success: true, path: process.cwd() }));
    } catch (error) {
      this.log('error', 'settings', `Failed to change directory: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
      res.writeHead(400);
      res.end(JSON.stringify({ success: false, error: error instanceof Error ? error.message : String(error) }));
    }
  }
}
