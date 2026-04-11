import * as http from 'http';
import * as url from 'url';
import { AutomationEngine } from '../engine/automationEngine';
import { UIObject, ActionResult, QueryOptions } from '../types';

export class HttpServer {
  private server: http.Server | null = null;
  private automationEngine: AutomationEngine;
  private port: number = 3456;

  constructor(automationEngine: AutomationEngine, port?: number) {
    this.automationEngine = automationEngine;
    if (typeof port === 'number' && !Number.isNaN(port)) {
      this.port = port;
    }
  }

  /**
   * Start the HTTP server
   */
  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => {
        this.handleRequest(req, res);
      });

      this.server.listen(this.port, '127.0.0.1', () => {
        console.log(`HTTP API Server started on http://127.0.0.1:${this.port}`);
        resolve();
      });

      this.server.on('error', (error) => {
        console.error('HTTP Server error:', error);
        reject(error);
      });
    });
  }

  /**
   * Stop the HTTP server
   */
  stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          console.log('HTTP API Server stopped');
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  /**
   * Main request handler
   */
  private async handleRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    const parsedUrl = url.parse(req.url || '', true);
    const pathname = parsedUrl.pathname || '';
    const query = parsedUrl.query;

    // Enable CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Content-Type', 'application/json');

    // Handle OPTIONS requests
    if (req.method === 'OPTIONS') {
      res.writeHead(200);
      res.end();
      return;
    }

    try {
      // Route handling
      if (pathname === '/api/queryTree' && req.method === 'POST') {
        await this.handleQueryTree(req, res);
      } else if (pathname === '/api/clickElement' && req.method === 'POST') {
        await this.handleClickElement(req, res);
      } else if (pathname === '/api/setProperty' && req.method === 'POST') {
        await this.handleSetProperty(req, res);
      } else if (pathname === '/api/readProperty' && req.method === 'POST') {
        await this.handleReadProperty(req, res);
      } else if (pathname === '/api/getProviders' && req.method === 'GET') {
        await this.handleGetProviders(req, res);
      } else if (pathname === '/health' && req.method === 'GET') {
        res.writeHead(200);
      res.end(JSON.stringify({ 
        status: 'ok', 
        message: 'AI Automation API is running',
        version: '0.1.1',
        timestamp: new Date().toISOString()
      }));
      } else {
        res.writeHead(404);
        res.end(JSON.stringify({ error: 'Endpoint not found' }));
      }
    } catch (error) {
      console.error('Request handler error:', error);
      res.writeHead(500);
      res.end(JSON.stringify({ error: 'Internal server error', details: String(error) }));
    }
  }

  /**
   * Handle POST /api/queryTree
   * Body: { providerName: string, targetId: string, options?: QueryOptions }
   */
  private async handleQueryTree(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    const body = await this.readBody(req);
    const { providerName, targetId, options } = JSON.parse(body);

    try {
      const tree = await this.automationEngine.queryTree(providerName, targetId, options);
      res.writeHead(200);
      res.end(JSON.stringify({ success: true, data: tree }));
    } catch (error) {
      res.writeHead(400);
      res.end(JSON.stringify({ success: false, error: String(error) }));
    }
  }

  /**
   * Handle POST /api/clickElement
   * Body: { providerName: string, elementId: string }
   */
  private async handleClickElement(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    const body = await this.readBody(req);
    const { providerName, elementId } = JSON.parse(body);

    try {
      const result = await this.automationEngine.clickElement(providerName, elementId);
      res.writeHead(200);
      res.end(JSON.stringify({ success: true, data: result }));
    } catch (error) {
      res.writeHead(400);
      res.end(JSON.stringify({ success: false, error: String(error) }));
    }
  }

  /**
   * Handle POST /api/setProperty
   * Body: { providerName: string, elementId: string, property: string, value: any }
   */
  private async handleSetProperty(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    const body = await this.readBody(req);
    const { providerName, elementId, property, value } = JSON.parse(body);

    try {
      const result = await this.automationEngine.setProperty(
        providerName,
        elementId,
        property,
        value
      );
      res.writeHead(200);
      res.end(JSON.stringify({ success: true, data: result }));
    } catch (error) {
      res.writeHead(400);
      res.end(JSON.stringify({ success: false, error: String(error) }));
    }
  }

  /**
   * Handle POST /api/readProperty
   * Body: { providerName: string, elementId: string, property: string }
   */
  private async handleReadProperty(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    const body = await this.readBody(req);
    const { providerName, elementId, property } = JSON.parse(body);

    try {
      const value = await this.automationEngine.readProperty(
        providerName,
        elementId,
        property
      );
      res.writeHead(200);
      res.end(JSON.stringify({ success: true, data: value }));
    } catch (error) {
      res.writeHead(400);
      res.end(JSON.stringify({ success: false, error: String(error) }));
    }
  }

  /**
   * Handle GET /api/getProviders
   */
  private async handleGetProviders(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    try {
      const providers = await this.automationEngine.getAvailableProviders();
      res.writeHead(200);
      res.end(JSON.stringify({ success: true, data: providers }));
    } catch (error) {
      res.writeHead(400);
      res.end(JSON.stringify({ success: false, error: String(error) }));
    }
  }

  /**
   * Utility to read request body
   */
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
