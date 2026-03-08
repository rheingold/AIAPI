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
import { HelperRegistry } from '../helpers/HelperRegistry';
import { XmlScenarioLoader, RawXmlStep, executeXmlScenario as runXmlScenario } from '../scenario/xmlScenarioLoader';

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
  private requestCount: number = 0;
  private startTime: number = Date.now();
  private sessions: Map<string, DashboardSession> = new Map();
  private securityPolicy: SecurityPolicy | null = null;
  private verboseLogging: boolean = true; // Enabled by default
  private config: any = {}; // Configuration storage
  private processHashCache: Map<string, { hash: string; mtimeMs: number }> = new Map();
  private readonly settingsFilePath: string = path.resolve(process.cwd(), 'config', 'dashboard-settings.json');

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
      appTemplatesDir: './apptemplates',
      testSessionDir: './test-sessions',
    };
    
    // Register this dashboard as log receiver
    globalLogger.onLog((level, source, message) => {
      this.log(level, source, message);
    });

    // Load persisted settings from disk (overrides defaults)
    this.loadConfigFromDisk();
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
        const configData = fs.readFileSync(configPath, 'utf8');
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
    ];

    // Also allow /api/appTemplates/* GET prefix without auth;
    // POST run endpoints (/api/appTemplates/{app}/scenarios/{id}/run) require auth.
    if (pathname.startsWith('/api/appTemplates/') && !pathname.endsWith('/run')) {
      return false;
    }

    return !publicEndpoints.includes(pathname);
  }

  /**
   * Broadcast message to all WebSocket clients
   */
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
      // Check authentication for protected endpoints
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
      if (pathname === '/api/filters' && req.method === 'GET') {
        return this.handleGetFilters(req, res);
      }
      if (pathname === '/api/filters' && req.method === 'POST') {
        return this.handleSaveFilters(req, res);
      }
      if (pathname === '/api/filters/test' && req.method === 'POST') {
        return this.handleTestFilter(req, res);
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

      // 404 Not Found
      res.writeHead(404);
      res.end(JSON.stringify({ error: 'Endpoint not found' }));
    } catch (error) {
      this.log('error', 'http', `Request handler error: ${error}`);
      res.writeHead(500);
      res.end(JSON.stringify({ error: 'Internal server error', details: String(error) }));
    }
  }

  /**
   * Serve static files from /static directory
   */
  private serveStaticFile(filename: string, res: http.ServerResponse): void {
    const staticDir = path.join(__dirname, '../../static');
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
      this.log('error', 'auth', `Login error: ${error}`);
      res.writeHead(500);
      res.end(JSON.stringify({ success: false, error: String(error) }));
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
      const configData = fs.readFileSync(configPath, 'utf8');
      const config = JSON.parse(configData);

      res.writeHead(200);
      res.end(JSON.stringify({ success: true, data: config }));
    } catch (error) {
      this.log('error', 'config', `Failed to read config: ${error}`);
      res.writeHead(500);
      res.end(JSON.stringify({ success: false, error: String(error) }));
    }
  }

  /**
   * PUT /api/config
   * Update configuration with security validation
   */
  private async handlePutConfig(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    try {
      const body = await this.readBody(req);
      const newConfig = JSON.parse(body);

      if (this.verboseLogging) {
        this.logJSON('debug', 'config', 'Config update request', newConfig);
      }

      // Validate security policy fields
      if (typeof newConfig.requireTargetSignature !== 'boolean' && newConfig.requireTargetSignature !== undefined) {
        throw new Error('requireTargetSignature must be a boolean');
      }
      if (typeof newConfig.requireOSEnforcement !== 'boolean' && newConfig.requireOSEnforcement !== undefined) {
        throw new Error('requireOSEnforcement must be a boolean');
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
      this.log('error', 'config', `Failed to save config: ${error}`);
      res.writeHead(500);
      res.end(JSON.stringify({ success: false, error: String(error) }));
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
        res.writeHead(500);
        res.end(JSON.stringify({ success: false, error: String(err) }));
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
        res.writeHead(500);
        res.end(JSON.stringify({ success: false, error: String(e) }));
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
  /**
   * GET /api/appTemplates
   * Lists all available app templates (subdirectories of appTemplatesDir).
   */
  private handleListAppTemplates(_req: http.IncomingMessage, res: http.ServerResponse): void {
    try {
      const templatesDir = path.resolve(
        process.cwd(),
        this.config.appTemplatesDir || './apptemplates'
      );
      if (!fs.existsSync(templatesDir)) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, apps: [] }));
        return;
      }
      const entries = fs.readdirSync(templatesDir, { withFileTypes: true });
      const apps = entries
        .filter(e => e.isDirectory())
        .map(e => {
          const hasTree      = fs.existsSync(path.join(templatesDir, e.name, 'tree.xml'));
          const hasScenarios = fs.existsSync(path.join(templatesDir, e.name, 'scenarios.xml'));
          let scenarioCount: number | null = null;
          if (hasScenarios) {
            try {
              const xml = fs.readFileSync(path.join(templatesDir, e.name, 'scenarios.xml'), 'utf8');
              scenarioCount = (xml.match(/<Scenario\s/g) ?? []).length;
            } catch { /* ignore */ }
          }
          return { name: e.name, hasTree, hasScenarios, scenarioCount };
        });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, apps }));
    } catch (error) {
      this.log('error', 'appTemplates', `Failed to list app templates: ${error}`);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: String(error) }));
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
    const templatesDir = path.resolve(
      process.cwd(),
      this.config.appTemplatesDir || './apptemplates'
    );
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
      this.log('error', 'appTemplates', `Failed to read ${fileKey}.xml for ${appName}: ${error}`);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: String(error) }));
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
    const templatesDir = path.resolve(process.cwd(), this.config.appTemplatesDir || './apptemplates');
    const loader = new XmlScenarioLoader(templatesDir);
    try {
      const info = loader.listScenarios(appName);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: true, app: appName, scenarios: info.scenarios }));
    } catch (err) {
      this.log('error', 'appTemplates', `listScenarios ${appName}: ${err}`);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: String(err) }));
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
    const templatesDir = path.resolve(process.cwd(), this.config.appTemplatesDir || './apptemplates');
    const loader = new XmlScenarioLoader(templatesDir);
    try {
      const raw = loader.loadRaw(appName, scenarioId);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: true, ...raw }));
    } catch (err) {
      this.log('error', 'appTemplates', `loadRaw ${appName}/${scenarioId}: ${err}`);
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: String(err) }));
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
    let payload: { label?: string; steps?: RawXmlStep[] };
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
    const templatesDir = path.resolve(process.cwd(), this.config.appTemplatesDir || './apptemplates');
    const loader = new XmlScenarioLoader(templatesDir);
    try {
      loader.save(appName, scenarioId, payload.label ?? scenarioId, payload.steps);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, app: appName, scenarioId }));
    } catch (err) {
      this.log('error', 'appTemplates', `saveScenario ${appName}/${scenarioId}: ${err}`);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: String(err) }));
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
        const templatesDir = path.resolve(
          process.cwd(),
          this.config.appTemplatesDir || './apptemplates',
        );
        const loader   = new XmlScenarioLoader(templatesDir);
        const scenario = loader.load(appName, scenarioId);
        const registry = this.helperRegistry!;
        const result   = await runXmlScenario({
          scenario,
          params:  parsed.params  ?? {},
          verbose: parsed.verbose ?? false,
          callFn:  (helper, target, command, parameter) =>
                     registry.callCommand(helper, target, command, parameter),
        });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      } catch (error) {
        this.log('error', 'appTemplates', `Scenario run failed — ${appName}/${scenarioId}: ${error}`);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: String(error) }));
      }
    });
    req.on('error', (e) => {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: String(e) }));
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
      this.log('error', 'scenarios', `Failed to list scenarios: ${error}`);
      res.writeHead(500);
      res.end(JSON.stringify({ success: false, error: String(error) }));
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
      this.log('error', 'scenarios', `Failed to run scenario: ${error}`);
      res.writeHead(500);
      res.end(JSON.stringify({ success: false, error: String(error) }));
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
      res.end(JSON.stringify({ success: false, error: String(error) }));
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
      res.end(JSON.stringify({ success: false, error: String(error) }));
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
      res.end(JSON.stringify({ success: false, error: String(error) }));
    }
  }

  private async handleGetProviders(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    try {
      const providers = await this.automationEngine.getAvailableProviders();
      res.writeHead(200);
      res.end(JSON.stringify({ success: true, data: providers }));
    } catch (error) {
      res.writeHead(400);
      res.end(JSON.stringify({ success: false, error: String(error) }));
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
      this.log('error', 'automation', `launchProcess failed: ${error}`);
      res.writeHead(400);
      res.end(JSON.stringify({ success: false, error: String(error) }));
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
      this.log('error', 'settings', `Failed to save settings: ${error}`);
      res.writeHead(500);
      res.end(JSON.stringify({ success: false, error: String(error) }));
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
      this.log('error', 'settings', `Validation error: ${error}`);
      res.writeHead(500);
      res.end(JSON.stringify({ error: String(error) }));
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
   * POST /api/filters
   * Saves the advanced security filter list
   * Body: { filters: FilterRule[] }
   */
  /**
   * Match a glob pattern (supports * and ?) against text — case-insensitive
   */
  private wildcardMatch(pattern: string, text: string): boolean {
    if (!pattern || pattern === '*') return true;
    const safe = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
    return new RegExp(`^${safe}$`, 'i').test(text);
  }

  /**
   * POST /api/filters/test  — dry-run: which filter would fire for given inputs?
   */
  private async handleTestFilter(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    try {
      const body = await this.readBody(req);
      const { process: proc, helper, command, parameter } = JSON.parse(body);
      const filters: any[] = this.config.advancedFilters || [];

      // Strip {BRACES} from command if present, matching same logic as mcpServer
      const cmdType = (command || '').replace(/^\{|\}$/g, '');

      let verdict: 'ALLOW' | 'DENY' = 'ALLOW'; // permissive default
      let matchedFilter: any = null;
      let reason = 'No rule matched — default ALLOW';

      for (const f of filters) {
        if (!this.wildcardMatch(f.process || '*', proc || '')) continue;
        const filterCmd = (f.command || '*').replace(/^\{|\}$/g, '');
        if (filterCmd !== '*' && !this.wildcardMatch(filterCmd, cmdType)) continue;
        if (!this.wildcardMatch(f.pattern || '*', parameter || '')) continue;
        // Also check helper if set
        if (f.helper && f.helper !== '*' && !this.wildcardMatch(f.helper, helper || '')) continue;

        matchedFilter = f;
        if (f.action === 'deny') {
          verdict = 'DENY';
          reason = `Matched DENY rule #${f.id}: ${f.description || f.action + ' ' + f.process + ' → ' + f.helper + '::' + f.command + '/' + f.pattern}`;
          break; // DENY wins
        } else {
          verdict = 'ALLOW';
          reason = `Matched ALLOW rule #${f.id}: ${f.description || f.action + ' ' + f.process + ' → ' + f.helper + '::' + f.command + '/' + f.pattern}`;
          // Don't break — a later DENY could override
        }
      }

      res.writeHead(200);
      res.end(JSON.stringify({ success: true, verdict, reason, matchedFilter }));
    } catch (error) {
      res.writeHead(500);
      res.end(JSON.stringify({ success: false, error: String(error) }));
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
      res.writeHead(500);
      res.end(JSON.stringify({ success: false, error: String(err) }));
    }
  }

  private async handleSaveFilters(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    try {
      const body = await this.readBody(req);
      const { filters } = JSON.parse(body);

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
      this.log('error', 'security', `Failed to save filters: ${error}`);
      res.writeHead(500);
      res.end(JSON.stringify({ success: false, error: String(error) }));
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
      this.log('error', 'security', `Token generation failed: ${error}`);
      res.writeHead(500);
      res.end(JSON.stringify({ success: false, error: String(error) }));
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
      this.log('error', 'settings', `Failed to change directory: ${error}`);
      res.writeHead(400);
      res.end(JSON.stringify({ success: false, error: String(error) }));
    }
  }
}
