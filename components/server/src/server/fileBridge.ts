import * as fs from 'fs';
import * as path from 'path';
import { AutomationEngine } from '../engine/automationEngine';

interface JsonRpcRequest {
  jsonrpc: '2.0';
  method: string;
  params?: any;
  id?: number | string;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number | string | null;
  result?: any;
  error?: { code: number; message: string; data?: any };
}

/**
 * File-based bridge to drive the AutomationEngine using JSON-RPC requests
 * via files, enabling agents with file read/write capabilities to access
 * the same functionality as MCP without HTTP.
 */
export class FileBridge {
  private requestsDir: string;
  private responsesDir: string;
  private engine: AutomationEngine;
  private timer: NodeJS.Timeout | null = null;

  constructor(engine: AutomationEngine, baseDir: string) {
    this.engine = engine;
    this.requestsDir = path.join(baseDir, 'requests');
    this.responsesDir = path.join(baseDir, 'responses');
    this.ensureDirs();
  }

  start(intervalMs: number = 500): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.scanOnce(), intervalMs);
    // Run an immediate scan on start
    this.scanOnce();
    console.log(`[FileBridge] Started. Watching: ${this.requestsDir}`);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      console.log('[FileBridge] Stopped');
    }
  }

  private ensureDirs(): void {
    try {
      fs.mkdirSync(this.requestsDir, { recursive: true });
      fs.mkdirSync(this.responsesDir, { recursive: true });
    } catch (e) {
      console.warn('[FileBridge] Failed to create bridge folders:', e);
    }
  }

  private async scanOnce(): Promise<void> {
    let files: string[] = [];
    try {
      files = fs.readdirSync(this.requestsDir).filter(f => f.endsWith('.json'));
    } catch (e) {
      console.warn('[FileBridge] scanOnce readdir error:', e);
      return;
    }

    for (const file of files) {
      const filePath = path.join(this.requestsDir, file);
      try {
        await this.processFile(filePath);
      } catch (e) {
        console.error('[FileBridge] Failed to process', filePath, e);
      }
    }
  }

  private async processFile(filePath: string): Promise<void> {
    const content = fs.readFileSync(filePath, 'utf8');
    let req: JsonRpcRequest;
    try {
      req = JSON.parse(content);
    } catch (e) {
      this.writeResponse({
        jsonrpc: '2.0',
        id: null,
        error: { code: -32700, message: 'Parse error' },
      }, path.basename(filePath));
      fs.unlinkSync(filePath);
      return;
    }

    const res = await this.handleRequest(req);
    this.writeResponse(res, path.basename(filePath));
    // Delete the request after processing
    try { fs.unlinkSync(filePath); } catch {}
  }

  private writeResponse(res: JsonRpcResponse, requestFileName: string): void {
    const respName = requestFileName.replace(/\.json$/i, '') + '.response.json';
    const outPath = path.join(this.responsesDir, respName);
    try {
      fs.writeFileSync(outPath, JSON.stringify(res, null, 2), 'utf8');
      console.log('[FileBridge] Wrote response:', outPath);
    } catch (e) {
      console.error('[FileBridge] Failed to write response:', outPath, e);
    }
  }

  private async handleRequest(request: JsonRpcRequest): Promise<JsonRpcResponse> {
    const id = request.id ?? null;
    if (request.jsonrpc !== '2.0') {
      return { jsonrpc: '2.0', id, error: { code: -32600, message: 'Invalid Request: jsonrpc must be "2.0"' } };
    }
    if (!request.method) {
      return { jsonrpc: '2.0', id, error: { code: -32600, message: 'Invalid Request: method is required' } };
    }

    try {
      switch (request.method) {
        case 'initialize':
          return {
            jsonrpc: '2.0',
            id,
            result: {
              protocolVersion: '2024-11-05',
              capabilities: { tools: {}, resources: {}, prompts: {} },
              serverInfo: { name: 'ai-ui-automation-file-bridge', version: '0.1.1' },
            },
          };

        case 'tools/list':
          return {
            jsonrpc: '2.0',
            id,
            result: {
              tools: [
                { name: 'queryTree', description: 'Query UI element tree from a provider' },
                { name: 'clickElement', description: 'Click a UI element' },
                { name: 'setProperty', description: 'Set a property on a UI element' },
                { name: 'readProperty', description: 'Read a property from a UI element' },
                { name: 'getProviders', description: 'List providers' },
              ],
            },
          };

        case 'tools/call': {
          const { name, arguments: args } = request.params || {};
          if (!name) {
            return { jsonrpc: '2.0', id, error: { code: -32602, message: 'Missing tool name' } };
          }
          let result: any;
          switch (name) {
            case 'queryTree':
              result = await this.engine.queryTree(args.providerName, args.targetId, args.options);
              break;
            case 'clickElement':
              result = await this.engine.clickElement(args.providerName, args.elementId);
              break;
            case 'setProperty':
              result = await this.engine.setProperty(args.providerName, args.elementId, args.propertyName || args.property, args.value);
              break;
            case 'readProperty':
              result = await this.engine.readProperty(args.providerName, args.elementId, args.propertyName || args.property);
              break;
            case 'getProviders':
              result = await this.engine.getAvailableProviders();
              break;
            default:
              return { jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${name}` } };
          }
          return { jsonrpc: '2.0', id, result };
        }

        default:
          return { jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${request.method}` } };
      }
    } catch (e: any) {
      return { jsonrpc: '2.0', id, error: { code: -32603, message: `Internal error: ${e?.message ?? e}` } };
    }
  }
}
