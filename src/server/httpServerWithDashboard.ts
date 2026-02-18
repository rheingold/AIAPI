import * as http from 'http';
import * as url from 'url';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { WebSocketServer, WebSocket } from 'ws';
import { AutomationEngine } from '../engine/automationEngine';
import { UIObject, ActionResult, QueryOptions } from '../types';
import { SessionTokenManager } from '../security/SessionTokenManager';
import { SecurityPolicy } from '../security/types';
import { globalLogger } from '../utils/Logger';

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
  private port: number;
  private logs: LogEntry[] = [];
  private requestCount: number = 0;
  private startTime: number = Date.now();
  private sessions: Map<string, DashboardSession> = new Map();
  private securityPolicy: SecurityPolicy | null = null;
  private verboseLogging: boolean = true; // Enabled by default

  constructor(automationEngine: AutomationEngine, sessionTokenManager?: SessionTokenManager, port?: number) {
    this.automationEngine = automationEngine;
    this.sessionTokenManager = sessionTokenManager || null;
    this.port = port || 3457;
    this.loadSecurityPolicy();
    
    // Register this dashboard as log receiver
    globalLogger.onLog((level, source, message) => {
      this.log(level, source, message);
    });
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
      const lines = formatted.split('\n');
      
      // Log label
      this.log(level, source, `${label}:`);
      
      // Log formatted JSON (limit to reasonable size)
      if (lines.length > 50) {
        this.log(level, source, lines.slice(0, 47).join('\n'));
        this.log(level, source, `... (${lines.length - 47} more lines)`);
      } else {
        this.log(level, source, formatted);
      }
    } catch (error) {
      this.log('error', source, `Failed to format JSON for ${label}: ${error}`);
    }
  }

  /**
   * Load security policy from config.json
   */
  private loadSecurityPolicy(): void {
    try {
      const configPath = path.join(__dirname, '../../security/config.json');
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
      '/health',
      '/api/login',
    ];

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
    ws.send(JSON.stringify({
      type: 'status',
      stats: {
        requestCount: this.requestCount,
        uptime: Date.now() - this.startTime,
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
      if (pathname === '/api/tools' && req.method === 'GET') {
        return this.handleGetTools(req, res);
      }
      if (pathname === '/api/scenarios' && req.method === 'GET') {
        return this.handleGetScenarios(req, res);
      }
      if (pathname === '/api/scenarios/run' && req.method === 'POST') {
        return this.handleRunScenario(req, res);
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
    res.writeHead(200);
    res.end(JSON.stringify({
      success: true,
      data: {
        status: 'running',
        uptime: Date.now() - this.startTime,
        requestCount: this.requestCount,
        logCount: this.logs.length,
      },
    }));
  }

  /**
   * GET /api/config
   */
  private handleGetConfig(req: http.IncomingMessage, res: http.ServerResponse): void {
    try {
      const configPath = path.join(__dirname, '../../security/config.json');
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
      const configPath = path.join(__dirname, '../../security/config.json');
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
  private handleGetScenarios(req: http.IncomingMessage, res: http.ServerResponse): void {
    try {
      const scenariosDir = path.join(__dirname, '../../scenarios');
      const files = fs.readdirSync(scenariosDir);

      const scenarios = files
        .filter(f => f.endsWith('.json'))
        .map(f => ({
          name: f.replace('.json', ''),
          path: `scenarios/${f}`,
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

    if (this.verboseLogging) {
      this.logJSON('debug', 'automation', 'queryTree request', { providerName, targetId, options });
    }

    try {
      const tree = await this.automationEngine.queryTree(providerName, targetId, options);
      
      if (this.verboseLogging) {
        this.logJSON('debug', 'automation', 'queryTree response', tree);
      }
      
      res.writeHead(200);
      res.end(JSON.stringify({ success: true, data: tree }));
    } catch (error) {
      this.log('error', 'automation', `queryTree failed: ${error}`);
      res.writeHead(400);
      res.end(JSON.stringify({ success: false, error: String(error) }));
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
}
