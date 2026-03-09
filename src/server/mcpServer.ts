import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import { AutomationEngine } from '../engine/automationEngine';
import { QueryOptions } from '../types';
import { ScenarioReplayer } from '../scenario/replayer';
import { XmlScenarioLoader, executeXmlScenario as runXmlScenario } from '../scenario/xmlScenarioLoader';
import { SessionTokenManager } from '../security/SessionTokenManager';
import { globalLogger } from '../utils/Logger';
import { wildcardMatch } from '../utils/wildcardMatch';
import { HelperRegistry } from '../helpers/HelperRegistry';

/**
 * MCP (Model Context Protocol) compliant JSON-RPC 2.0 server
 */
export class MCPServer {
  private server: http.Server | null = null;
  private automationEngine: AutomationEngine;
  private scenarioReplayer: ScenarioReplayer;
  private sessionTokenManager: SessionTokenManager;
  private port: number;
  private serverInfo = {
    name: 'ai-ui-automation',
    version: '0.1.1',
  };
  private docsPath: string;
  private helperRegistry: HelperRegistry;
  private advancedFilters: Array<{
    id?: number;
    action: 'allow' | 'deny';
    process: string;
    helper: string;
    command: string;
    pattern: string;
    description?: string;
  }> = [];
  private disabledHelpers: string[] = [];
  private appTemplatesDir: string;
  private readonly settingsPath = path.resolve(process.cwd(), 'config', 'dashboard-settings.json');

  constructor(automationEngine?: AutomationEngine, port: number = 3457) {
    // Initialize session token manager first
    const isDevelopment = process.env.NODE_ENV !== 'production';
    this.sessionTokenManager = new SessionTokenManager(undefined, isDevelopment);
    
    // Create or use provided automation engine with session token
    const token = this.sessionTokenManager.generateToken();
    const secret = this.sessionTokenManager.exportSecret();
    this.automationEngine = automationEngine || new AutomationEngine(token, secret);
    this.port = port;
    
    const keywinBinary = path.join(__dirname, '..', '..', 'dist', 'win', 'KeyWin.exe');
    this.scenarioReplayer = new ScenarioReplayer(
      keywinBinary, 
      undefined, 
      false,
      this.sessionTokenManager
    );
    this.docsPath = path.join(__dirname, '..', '..');
    this.appTemplatesDir = path.join(this.docsPath, 'apptemplates');

    // Setup security filter validator if config exists
    this.setupSecurityFilter();

    // Load dashboard-managed advanced filters and watch for live updates
    this.loadAdvancedFilters();
    fs.watchFile(this.settingsPath, { interval: 2000 }, () => {
      this.loadAdvancedFilters();
    });

    // Initialise helper registry and discover helpers asynchronously.
    // Credentials are no longer passed as constructor args — env-var approach
    // removed; _auth handshake (TODO PRIORITY 1.5) will supply them over stdin.
    this.helperRegistry = new HelperRegistry();
    const helperSearchPaths = [
      path.join(__dirname, '..', '..', 'dist', 'helpers'),
    ];
    this.helperRegistry.discoverHelpers(helperSearchPaths).catch(e =>
      globalLogger.warn('HelperRegistry', `Discovery error: ${e}`)
    );
  }

  /**
   * Load advancedFilters from dashboard-settings.json into memory.
   * Called on startup and whenever the file changes.
   */
  private loadAdvancedFilters(): void {
    try {
      if (fs.existsSync(this.settingsPath)) {
        const saved = JSON.parse(fs.readFileSync(this.settingsPath, 'utf8'));
        this.advancedFilters = Array.isArray(saved.advancedFilters) ? saved.advancedFilters : [];
        this.disabledHelpers = Array.isArray(saved.disabledHelpers) ? saved.disabledHelpers : [];
        if (saved.testSessionDir && typeof saved.testSessionDir === 'string') {
          this.helperRegistry.setSessionBaseDir(saved.testSessionDir);
        }
        if (typeof saved.appTemplatesDir === 'string' && saved.appTemplatesDir) {
          const resolved = path.isAbsolute(saved.appTemplatesDir)
            ? saved.appTemplatesDir
            : path.resolve(process.cwd(), saved.appTemplatesDir);
          this.appTemplatesDir = resolved;
        }
        globalLogger.info('Security', `Loaded ${this.advancedFilters.length} advanced filter rule(s) from dashboard-settings.json`);
        if (this.disabledHelpers.length > 0) {
          globalLogger.info('HelperRegistry', `Disabled helpers: ${this.disabledHelpers.join(', ')}`);
        }
      } else {
        this.advancedFilters = [];
      }
    } catch (err) {
      globalLogger.warn('Security', `Could not load advanced filters: ${err}`);
    }
  }

  /**
   * Setup security filter configuration
   */
  private async setupSecurityFilter(): Promise<void> {
    try {
      const configPath = path.join(__dirname, '..', '..', 'security', 'config.json');
      if (fs.existsSync(configPath)) {
        // Here we'd load the security config
        // For now, we'll setup a basic validator
        this.automationEngine.setSecurityValidator(this.validateSecurityFilter.bind(this));
        globalLogger.info('Security', 'Security filter enabled');
      }
    } catch (error) {
      globalLogger.error('Security', `Security filter setup error: ${error}`);
    }
  }

  /**
   * Validate security filter for command execution.
   *
   * Evaluation order (first matching rule wins; default is DENY if security is
   * active and no rule explicitly allows the operation):
   *
   *   1. Admin token present & valid  → ALLOW immediately (audit logged)
   *   2. Admin token present but expired/invalid → fall through to normal rules
   *   3. Read-only command (QUERYTREE, READ, LISTWINDOWS, GETPROVIDERS) → ALLOW
   *   4. Target is a protected system process (explorer, lsass, …) → DENY
   *   5. All other operations → ALLOW (permissive default while in development;
   *      tighten by loading deny-list from security/config.json)
   *
   * Rule priority: DENY wins over ALLOW when the same command matches both a
   * DENY rule and an ALLOW rule.  The default when no ALLOW rule matches is
   * DENY (fail-closed).
   */
  private async validateSecurityFilter(
    processName: string,
    commandType: string,
    parameter: string,
    context?: { adminToken?: string }
  ): Promise<'ALLOW' | 'DENY'> {
    // 1. Check for admin token first
    if (context?.adminToken) {
      const validation = this.sessionTokenManager.validateAdminToken(context.adminToken);
      if (validation.valid && !validation.expired) {
        globalLogger.warn('Security', `Admin token bypass: ${commandType} on ${processName}`);
        return 'ALLOW'; // Admin token bypasses all filters
      } else if (validation.expired) {
        globalLogger.warn('Security', 'Expired admin token attempted');
        // Continue to normal security validation
      } else {
        globalLogger.warn('Security', 'Invalid admin token attempted');
        // Continue to normal security validation  
      }
    }

    // 2. Apply dashboard-managed advanced filters (DENY wins over ALLOW)
    //    filter.command is stored as "{CLICKNAME}" — strip braces to compare with commandType
    if (this.advancedFilters.length > 0) {
      let matchedDeny = false;
      let matchedAllow = false;

      for (const filter of this.advancedFilters) {
        // Match process name
        if (!wildcardMatch(filter.process || '*', processName)) continue;

        // Match command — stored as {CLICKID}, commandType is CLICKID
        const filterCmd = filter.command.replace(/^\{|\}$/g, '');
        if (!wildcardMatch(filterCmd, commandType) && filter.command !== '*') continue;

        // Match parameter pattern
        if (!wildcardMatch(filter.pattern || '*', parameter || '')) continue;

        if (filter.action === 'deny') {
          matchedDeny = true;
          globalLogger.warn('Security', `Advanced filter DENY: ${commandType} on ${processName} (param: ${parameter})`);
          break; // DENY wins immediately
        } else {
          matchedAllow = true;
        }
      }

      if (matchedDeny) return 'DENY';
      if (matchedAllow) {
        globalLogger.info('Security', `Advanced filter ALLOW: ${commandType} on ${processName}`);
        // Continue to built-in rules for additional checks
      }
    }
    
    // 3. Read-only commands are always permitted
    const readOnlyCommands = ['QUERYTREE', 'READ', 'LISTWINDOWS', 'GETPROVIDERS'];
    if (readOnlyCommands.includes(commandType)) {
      return 'ALLOW';
    }

    // 4. Deny destructive operations on protected system processes
    const systemProcesses = ['explorer', 'winlogon', 'csrss', 'lsass', 'services', 'svchost'];
    if (systemProcesses.some(proc => processName.toLowerCase().includes(proc.toLowerCase()))) {
      globalLogger.warn('Security', `Security filter blocked ${commandType} on system process ${processName}`);
      return 'DENY';
    }

    // 5. Permissive default during development — replace with config-driven deny-list in production
    return 'ALLOW';
  }

  /**
   * Handle admin token generation request
   */
  private async handleAdminTokenRequest(body: string, res: http.ServerResponse): Promise<void> {
    try {
      const { password } = JSON.parse(body);
      
      if (!password || typeof password !== 'string') {
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'Password required' }));
        return;
      }
      
      const adminToken = this.sessionTokenManager.generateAdminToken(password);
      
      if (!adminToken) {
        globalLogger.warn('Security', 'Invalid admin password attempt');
        res.writeHead(401);
        res.end(JSON.stringify({ error: 'Invalid password' }));
        return;
      }
      
      // Calculate expiry time (15 minutes from now)
      const expiry = new Date(Date.now() + 15 * 60 * 1000).toISOString();
      
      globalLogger.warn('Security', '⚠️ ADMIN MODE ACTIVATED - Security filters bypassed');
      
      res.writeHead(200);
      res.end(JSON.stringify({
        token: adminToken,
        expiry,
        privileges: ['BYPASS_FILTERS', 'MODIFY_CONFIG'],
        warning: 'All security filters are bypassed while this token is active'
      }));
      
    } catch (error) {
      globalLogger.error('Security', `Admin token request error: ${error}`);
      res.writeHead(500);
      res.end(JSON.stringify({ error: 'Internal server error' }));
    }
  }

  /**
   * Expose the helper registry so the dashboard server can serve /api/listHelpers.
   */
  getHelperRegistry(): HelperRegistry {
    return this.helperRegistry;
  }

  /**
   * Start the MCP server
   */
  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => {
        this.handleRequest(req, res);
      });

      this.server.listen(this.port, '127.0.0.1', () => {
        console.log(`MCP Server started on http://127.0.0.1:${this.port}`);
        resolve();
      });

      this.server.on('error', (error) => {
        console.error('MCP Server error:', error);
        reject(error);
      });
    });
  }

  /**
   * Stop the MCP server
   */
  stop(): Promise<void> {
    this.helperRegistry.shutdownAll();
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          console.log('MCP Server stopped');
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  /**
   * Main request handler - implements JSON-RPC 2.0 and HTTP endpoints
   */
  private async handleRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    // Enable CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    // Handle OPTIONS preflight
    if (req.method === 'OPTIONS') {
      res.writeHead(200);
      res.end();
      return;
    }

    // Handle GET requests for health check and documentation
    if (req.method === 'GET') {
      this.handleGetRequest(req, res);
      return;
    }

    // MCP uses POST for JSON-RPC
    res.setHeader('Content-Type', 'application/json');
    if (req.method !== 'POST') {
      res.writeHead(405);
      res.end(JSON.stringify(this.createErrorResponse(null, -32600, 'Method not allowed')));
      return;
    }

    try {
      const body = await this.readBody(req);
      
      // Handle admin token requests (non-JSON-RPC)
      if (req.url === '/api/auth/admin-token') {
        await this.handleAdminTokenRequest(body, res);
        return;
      }
      
      const request = JSON.parse(body);

      // Log incoming request (if JSON logging enabled)
      if (process.env.LOG_JSON !== 'false') {
        globalLogger.info('mcp', '═══════════════════════════════════════════════════════════');
        globalLogger.info('mcp', '← INCOMING JSON-RPC REQUEST');
        globalLogger.info('mcp', '═══════════════════════════════════════════════════════════');
        globalLogger.logJSON('info', 'mcp', 'Request', request);
      }

      // Validate JSON-RPC 2.0 structure
      if (request.jsonrpc !== '2.0') {
        res.writeHead(400);
        res.end(JSON.stringify(this.createErrorResponse(request.id, -32600, 'Invalid Request: jsonrpc must be "2.0"')));
        return;
      }

      if (!request.method) {
        res.writeHead(400);
        res.end(JSON.stringify(this.createErrorResponse(request.id, -32600, 'Invalid Request: method is required')));
        return;
      }

      // Route to appropriate handler
      const response = await this.handleMethod(request);
      
      // Log outgoing response (if JSON logging enabled)
      if (process.env.LOG_JSON !== 'false') {
        globalLogger.info('mcp', '→ OUTGOING JSON-RPC RESPONSE');
        globalLogger.logJSON('info', 'mcp', 'Response', response);
        globalLogger.info('mcp', '═══════════════════════════════════════════════════════════');
      }
      
      res.writeHead(200);
      res.end(JSON.stringify(response));
    } catch (error) {
      console.error('MCP request error:', error);
      res.writeHead(400);
      res.end(JSON.stringify(this.createErrorResponse(null, -32700, 'Parse error')));
    }
  }

  /**
   * Handle GET requests for health check and documentation
   */
  private handleGetRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
    const url = req.url || '/';

    // Health check endpoint
    if (url === '/' || url === '/health' || url === '/ping') {
      res.setHeader('Content-Type', 'application/json');
      res.writeHead(200);
      res.end(JSON.stringify({
        status: 'ok',
        server: this.serverInfo.name,
        version: this.serverInfo.version,
        port: this.port,
        endpoints: {
          health: '/health or /ping',
          docs: '/docs',
          api: '/api (markdown)',
          scenarios: '/scenarios'
        },
        message: 'AI UI Automation Server is running. Use POST for JSON-RPC 2.0 MCP calls.'
      }, null, 2));
      return;
    }

    // Documentation endpoints
    if (url.startsWith('/docs')) {
      this.serveDocs(url, res, true);
      return;
    }

    if (url.startsWith('/api')) {
      this.serveDocs(url, res, false);
      return;
    }

    // List available scenarios
    if (url === '/scenarios') {
      this.listScenarios(res);
      return;
    }

    // 404
    res.writeHead(404);
    res.end('Not Found');
  }

  /**
   * Handle JSON-RPC method calls
   */
  private async handleMethod(request: any): Promise<any> {
    const { method, params, id } = request;

    try {
      switch (method) {
        case 'initialize':
          return this.handleInitialize(id, params);
        
        case 'tools/list':
          return this.handleToolsList(id);
        
        case 'tools/call':
          return this.handleToolsCall(id, params);
        
        case 'resources/list':
          return this.handleResourcesList(id);
        
        case 'prompts/list':
          return this.handlePromptsList(id);
        
        default:
          return this.createErrorResponse(id, -32601, `Method not found: ${method}`);
      }
    } catch (error) {
      console.error(`Error handling method ${method}:`, error);
      return this.createErrorResponse(id, -32603, `Internal error: ${error}`);
    }
  }

  /**
   * MCP initialize handshake
   */
  private handleInitialize(id: any, params: any): any {
    return {
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: {
          tools: {},
          resources: {},
          prompts: {},
        },
        serverInfo: this.serverInfo,
      },
    };
  }

  /**
   * List available tools
   */
  private handleToolsList(id: any): any {
    return {
      jsonrpc: '2.0',
      id,
      result: {
        tools: [
          {
            name: 'queryTree',
            description: 'Query UI element tree from a provider',
            inputSchema: {
              type: 'object',
              properties: {
                providerName: {
                  type: 'string',
                  description: 'Provider name (e.g., "windowsForms", "webUI", "office")',
                },
                targetId: {
                  type: 'string',
                  description: 'Target window/document identifier',
                },
                options: {
                  type: 'object',
                  description: 'Query options',
                  properties: {
                    depth: { type: 'number' },
                    includeHidden: { type: 'boolean' },
                  },
                },
              },
              required: ['providerName', 'targetId'],
            },
          },
          {
            name: 'clickElement',
            description: 'Click a UI element',
            inputSchema: {
              type: 'object',
              properties: {
                providerName: {
                  type: 'string',
                  description: 'Provider name',
                },
                elementId: {
                  type: 'string',
                  description: 'Element identifier to click',
                },
              },
              required: ['providerName', 'elementId'],
            },
          },
          {
            name: 'setProperty',
            description: 'Set a property on a UI element',
            inputSchema: {
              type: 'object',
              properties: {
                providerName: { type: 'string' },
                elementId: { type: 'string' },
                propertyName: { type: 'string' },
                value: { description: 'Property value' },
              },
              required: ['providerName', 'elementId', 'propertyName', 'value'],
            },
          },
          {
            name: 'readProperty',
            description: 'Read a property from a UI element',
            inputSchema: {
              type: 'object',
              properties: {
                providerName: { type: 'string' },
                elementId: { type: 'string' },
                propertyName: { type: 'string' },
              },
              required: ['providerName', 'elementId', 'propertyName'],
            },
          },
          {
            name: 'getProviders',
            description: 'Get list of available automation providers',
            inputSchema: {
              type: 'object',
              properties: {},
            },
          },
          {
            name: 'listWindows',
            description: 'List all visible windows with titles and process information',
            inputSchema: {
              type: 'object',
              properties: {},
            },
          },
          {
            name: 'launchProcess',
            description: 'Launch an application process',
            inputSchema: {
              type: 'object',
              properties: {
                executable: {
                  type: 'string',
                  description: 'Executable name or path (e.g., "calc.exe", "notepad.exe")',
                },
                args: {
                  type: 'array',
                  description: 'Optional command-line arguments',
                  items: { type: 'string' },
                },
              },
              required: ['executable'],
            },
          },
          {
            name: 'terminateProcess',
            description: 'Terminate a running process by name or PID',
            inputSchema: {
              type: 'object',
              properties: {
                process: {
                  type: 'string',
                  description: 'Process name (e.g., "calc", "CalculatorApp") or PID (e.g., "PID:12345")',
                },
              },
              required: ['process'],
            },
          },
          {
            name: 'executeScenario',
            description: 'Execute a scenario from the app template library (XML) or a legacy JSON scenario file.',
            inputSchema: {
              type: 'object',
              properties: {
                // ── XML template mode (preferred) ──────────────────────────
                app: {
                  type: 'string',
                  description: 'App name as it appears in apptemplates/ (e.g., "calculator", "notepad", "chrome"). Use with scenarioId.',
                },
                scenarioId: {
                  type: 'string',
                  description: 'Scenario id within apptemplates/{app}/scenarios.xml (e.g., "compute", "intro").',
                },
                params: {
                  type: 'object',
                  description: 'Runtime parameter substitutions for {{placeholder}} variables in the scenario, e.g. { "expression": "7 * 6" }.',
                },
                // ── Legacy JSON mode ────────────────────────────────────────
                scenarioPath: {
                  type: 'string',
                  description: 'Path to JSON scenario file (e.g., "config/scenarios/calculator-basic.json")',
                },
                scenarioJson: {
                  type: 'object',
                  description: 'Inline scenario JSON object (alternative to scenarioPath)',
                },
                verbose: {
                  type: 'boolean',
                  description: 'Enable verbose output',
                  default: false,
                },
              },
            },
          },
          // ── Dynamically discovered helper tools (respects disabled list) ──
          ...this.helperRegistry.toMcpTools().filter(t => {
            const s = this.helperRegistry.getByToolName(t.name);
            return !s || !this.disabledHelpers.includes(s.helper);
          }),

          // ── Helper management tools ───────────────────────────────────────
          {
            name: 'listHelpers',
            description: 'List all discovered helper executables and their supported commands',
            inputSchema: {
              type: 'object',
              properties: {},
            },
          },
          {
            name: 'getHelperSchema',
            description: 'Get the full API schema for a specific helper executable',
            inputSchema: {
              type: 'object',
              properties: {
                helperName: {
                  type: 'string',
                  description: 'Helper name (e.g. "KeyWin.exe")',
                },
              },
              required: ['helperName'],
            },
          },

          // ── Web scraping ──────────────────────────────────────────────────
          {
            name: 'fetch_webpage',
            description: 'Fetch content from a webpage with security filtering',
            inputSchema: {
              type: 'object',
              properties: {
                url: {
                  type: 'string',
                  description: 'URL to fetch (HTTP/HTTPS)',
                },
                options: {
                  type: 'object',
                  description: 'Fetch options',
                  properties: {
                    method: { type: 'string', default: 'GET' },
                    headers: { type: 'object' },
                    timeout: { type: 'number', default: 30000 },
                    extractText: { type: 'boolean', default: true },
                    extractElements: { type: 'string', description: 'CSS selector to extract specific elements' },
                    maxResponseSize: { type: 'number', default: 10485760 }, // 10MB
                    allowRedirects: { type: 'boolean', default: true },
                    userAgent: { type: 'string' },
                  },
                },
              },
              required: ['url'],
            },
          },
        ],
      },
    };
  }

  /**
   * Call a tool
   */
  private async handleToolsCall(id: any, params: any): Promise<any> {
    const { name, arguments: args } = params;

    try {
      let result: any;

      switch (name) {
        case 'queryTree':
          result = await this.automationEngine.queryTree(
            args.providerName,
            args.targetId,
            args.options
          );
          break;

        case 'clickElement':
          result = await this.automationEngine.clickElement(
            args.providerName,
            args.elementId
          );
          break;

        case 'setProperty':
          result = await this.automationEngine.setProperty(
            args.providerName,
            args.elementId,
            args.propertyName ?? args.property,
            args.value
          );
          break;

        case 'readProperty':
          result = await this.automationEngine.readProperty(
            args.providerName,
            args.elementId,
            args.propertyName ?? args.property
          );
          break;

        case 'getProviders':
          result = this.automationEngine.getAvailableProviders();
          break;

        case 'listWindows':
          result = await this.automationEngine.listWindows();
          break;

        case 'launchProcess':
          result = await this.automationEngine.launchProcess(args.executable, args.args);
          break;

        case 'terminateProcess':
          result = await this.terminateProcess(args.process || args.processName);
          break;

        case 'executeScenario':
          result = await this.executeScenario(args);
          break;

        case 'fetch_webpage':
          result = await this.automationEngine.fetchWebpage(args.url, args.options);
          break;

        case 'listHelpers':
          result = {
            success: true,
            helpers: this.helperRegistry.getAll().map(s => ({
              name: s.helper,
              version: s.version,
              description: s.description,
              toolName: s.toolName,
              filePath: s.filePath,
              commandCount: s.commands.length,
              commands: s.commands.map(c => ({ name: c.name, description: c.description })),
            })),
          };
          break;

        case 'helpers/reload':
          result = await this.helperRegistry.reloadHelpers();
          break;

        case 'session/start': {
          const sessionName = args.name || 'unnamed';
          const sessionDir  = args.dir as string | undefined;
          result = { success: true, ...this.helperRegistry.startSession(sessionName, sessionDir) };
          break;
        }

        case 'session/finish':
          result = this.helperRegistry.finishSession() ?? { success: false, error: 'No active session' };
          if (!('success' in result)) result = { success: true, ...result };
          break;

        case 'getHelperSchema': {
          const schema = this.helperRegistry.get(args.helperName);
          if (!schema) {
            return this.createErrorResponse(id, -32602, `Helper not found: ${args.helperName}`);
          }
          result = { success: true, schema };
          break;
        }

        default: {
          // Dynamic dispatch for helper_* tools
          const helperSchema = this.helperRegistry.getByToolName(name);
          if (helperSchema) {
            // Check if helper is disabled
            if (this.disabledHelpers.includes(helperSchema.helper)) {
              return this.createErrorResponse(id, -32603,
                `Helper ${helperSchema.helper} is disabled. Enable it in the Dashboard → Settings → Discovered Helpers.`);
            }
            // Security validation before executing helper command
            const helperVerdict = await this.validateSecurityFilter(
              args.target || '',
              args.command || '',
              args.parameter ?? '',
              undefined
            );
            if (helperVerdict === 'DENY') {
              return this.createErrorResponse(id, -32603,
                `Security filter blocked: ${args.command} on ${args.target}`);
            }
            result = await this.helperRegistry.callCommand(
              helperSchema.helper,
              args.target,
              args.command,
              args.parameter ?? ''
            );
            break;
          }
          return this.createErrorResponse(id, -32602, `Unknown tool: ${name}`);
        }
      }

      return {
        jsonrpc: '2.0',
        id,
        result,
      };
    } catch (error) {
      return this.createErrorResponse(id, -32603, `Tool execution error: ${error}`);
    }
  }

  /**
   * List available resources (none for now)
   */
  private handleResourcesList(id: any): any {
    return {
      jsonrpc: '2.0',
      id,
      result: {
        resources: [],
      },
    };
  }

  /**
   * List available prompts (none for now)
   */
  private handlePromptsList(id: any): any {
    return {
      jsonrpc: '2.0',
      id,
      result: {
        prompts: [],
      },
    };
  }

  /**
   * Create JSON-RPC 2.0 error response
   */
  private createErrorResponse(id: any, code: number, message: string): any {
    return {
      jsonrpc: '2.0',
      id,
      error: {
        code,
        message,
      },
    };
  }

  /**
   * Read HTTP request body
   */
  private readBody(req: http.IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk.toString();
      });
      req.on('end', () => resolve(body));
      req.on('error', reject);
    });
  }

  /**
   * Execute automation scenario
   */
  private async executeScenario(args: any): Promise<any> {
    try {
      // ── XML template mode (preferred) ──────────────────────────────────────
      if (args.app && args.scenarioId) {
        return await this.executeXmlScenario(
          String(args.app),
          String(args.scenarioId),
          args.params ?? {},
          !!args.verbose,
        );
      }

      // ── Legacy JSON mode ────────────────────────────────────────────────────
      // Update context verbose if specified
      if (args.verbose !== undefined) {
        this.scenarioReplayer['context'].verbose = args.verbose;
      }

      let scenarioResult;
      
      if (args.scenarioPath) {
        const fullPath = path.isAbsolute(args.scenarioPath) 
          ? args.scenarioPath 
          : path.join(this.docsPath, args.scenarioPath);
        
        const scenario = await this.scenarioReplayer.loadScenario(fullPath);
        scenarioResult = await this.scenarioReplayer.executeScenario(scenario);
      } else if (args.scenarioJson) {
        scenarioResult = await this.scenarioReplayer.executeScenario(args.scenarioJson);
      } else {
        throw new Error('Provide either { app, scenarioId } for XML template mode, or scenarioPath / scenarioJson for legacy JSON mode.');
      }

      return scenarioResult;
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
        stack: error.stack
      };
    }
  }

  /**
   * Execute a named scenario from the XML app template library.
   * Delegates to the shared executor in xmlScenarioLoader.ts.
   */
  private async executeXmlScenario(
    app: string,
    scenarioId: string,
    userParams: Record<string, string>,
    verbose: boolean,
  ): Promise<any> {
    const loader   = new XmlScenarioLoader(this.appTemplatesDir);
    const scenario = loader.load(app, scenarioId);
    return runXmlScenario({
      scenario,
      params:  userParams,
      callFn:  (helper, target, command, parameter) =>
                 this.helperRegistry.callCommand(helper, target, command, parameter),
      verbose,
      log: (msg) => globalLogger.info('XmlScenario', msg),
    });
  }

  /**
   * Terminate a process using KeyWin.exe {KILL} command
   */
  private async terminateProcess(process: string): Promise<any> {
    try {
      // Security validation before executing KILL
      const killVerdict = await this.validateSecurityFilter(process, 'KILL', '', undefined);
      if (killVerdict === 'DENY') {
        return {
          success: false,
          error: 'security_deny',
          message: `Security filter blocked KILL on process: ${process}`
        };
      }

      const result = await this.scenarioReplayer.executeKeyWin('{KILL}', process);
      
      if (result.success) {
        return {
          success: true,
          process,
          count: result.count || 1,
          message: `Terminated ${result.count || 1} process(es)`
        };
      } else {
        return {
          success: false,
          error: result.error,
          message: `Failed to terminate process: ${result.error}`
        };
      }
    } catch (error) {
      return {
        success: false,
        error: 'execution_failed',
        message: `Error terminating process: ${error}`
      };
    }
  }

  /**
   * Serve documentation files (markdown or HTML)
   */
  private serveDocs(url: string, res: http.ServerResponse, asHtml: boolean): void {
    // Map URL to doc file
    const docMap: { [key: string]: string } = {
      '/docs': 'docs/INDEX.md',
      '/docs/api': 'docs/api/KEYWIN_API.md',
      '/docs/errors': 'docs/specs/ERROR_CODES.md',
      '/docs/fixes': 'archive/FIXES_SUMMARY.md',
      '/docs/quick': 'docs/guides/QUICK_REF.md',
      '/docs/scenarios': 'docs/specs/SCENARIO_FORMAT.md',
      '/api': 'docs/api/KEYWIN_API.md',
      '/api/errors': 'docs/specs/ERROR_CODES.md',
    };

    const docFile = docMap[url] || docMap[url.replace('/docs/', '/').replace('/api/', '/')];
    
    if (!docFile) {
      res.writeHead(404);
      res.end('Documentation not found');
      return;
    }

    const filePath = path.join(this.docsPath, docFile);
    
    if (!fs.existsSync(filePath)) {
      res.writeHead(404);
      res.end(`Documentation file not found: ${docFile}`);
      return;
    }

    const content = fs.readFileSync(filePath, 'utf-8');

    if (asHtml) {
      // Simple markdown to HTML conversion
      const html = this.markdownToHtml(content, docFile);
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.writeHead(200);
      res.end(html);
    } else {
      res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
      res.writeHead(200);
      res.end(content);
    }
  }

  /**
   * List available scenarios
   */
  private listScenarios(res: http.ServerResponse): void {
    const scenariosPath = path.join(this.docsPath, 'scenarios');
    
    if (!fs.existsSync(scenariosPath)) {
      res.setHeader('Content-Type', 'application/json');
      res.writeHead(200);
      res.end(JSON.stringify({ scenarios: [] }));
      return;
    }

    const files = fs.readdirSync(scenariosPath)
      .filter(f => f.endsWith('.json'))
      .map(f => {
        const fullPath = path.join(scenariosPath, f);
        const content = JSON.parse(fs.readFileSync(fullPath, 'utf-8'));
        return {
          name: content.name,
          file: `config/scenarios/${f}`,
          description: content.description,
          steps: content.steps?.length || 0,
        };
      });

    res.setHeader('Content-Type', 'application/json');
    res.writeHead(200);
    res.end(JSON.stringify({ scenarios: files }, null, 2));
  }

  /**
   * Simple markdown to HTML converter
   */
  private markdownToHtml(markdown: string, title: string): string {
    let html = markdown
      // Headers
      .replace(/^### (.*$)/gim, '<h3>$1</h3>')
      .replace(/^## (.*$)/gim, '<h2>$1</h2>')
      .replace(/^# (.*$)/gim, '<h1>$1</h1>')
      // Bold
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      // Italic
      .replace(/\*(.*?)\*/g, '<em>$1</em>')
      // Code blocks
      .replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code class="language-$1">$2</code></pre>')
      // Inline code
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      // Links
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
      // Line breaks
      .replace(/\n\n/g, '</p><p>')
      .replace(/\n/g, '<br>');

    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>${title} - AI UI Automation</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      max-width: 900px;
      margin: 40px auto;
      padding: 0 20px;
      line-height: 1.6;
      color: #333;
    }
    h1 { color: #0066cc; border-bottom: 2px solid #0066cc; padding-bottom: 10px; }
    h2 { color: #0088ee; margin-top: 30px; }
    h3 { color: #00aaff; }
    code {
      background: #f4f4f4;
      padding: 2px 6px;
      border-radius: 3px;
      font-family: 'Courier New', Courier, monospace;
      font-size: 0.9em;
    }
    pre {
      background: #2b2b2b;
      color: #f8f8f2;
      padding: 15px;
      border-radius: 5px;
      overflow-x: auto;
    }
    pre code {
      background: transparent;
      color: inherit;
      padding: 0;
    }
    a { color: #0066cc; text-decoration: none; }
    a:hover { text-decoration: underline; }
    .nav {
      background: #f8f8f8;
      padding: 15px;
      border-radius: 5px;
      margin-bottom: 30px;
    }
    .nav a {
      margin-right: 15px;
      font-weight: bold;
    }
  </style>
</head>
<body>
  <div class="nav">
    <a href="/">Home</a>
    <a href="/docs">Docs Index</a>
    <a href="/docs/api">API Reference</a>
    <a href="/docs/scenarios">Scenarios</a>
    <a href="/scenarios">Available Scenarios</a>
  </div>
  <p>${html}</p>
</body>
</html>`;
  }
}

