import * as vscode from 'vscode';
import * as http from 'http';
import { MCPServer } from './server/mcpServer';
import { HttpServerWithDashboard } from './server/httpServerWithDashboard';
import { loadCryptoCredentials } from './security/loadCryptoCredentials';
import { globalLogger } from './utils/Logger';

let mcpServer: MCPServer | undefined;
let dashboardServer: HttpServerWithDashboard | undefined;
let statusBarItem: vscode.StatusBarItem | undefined;
let outputChannel: vscode.OutputChannel | undefined;

/**
 * VS Code extension activation -- starts the full AIAPI server stack.
 *
 * Mirrors start-mcp-server.ts but adapted for the VS Code host:
 *  - no process.exit() on failure  =>  show error message and return
 *  - no readline stdin prompt      =>  loadCryptoCredentials returns null (non-TTY)
 *  - process.chdir(extensionPath)  =>  all relative paths resolve inside the VSIX
 *  - status bar item + output channel replace bare console.log
 */
export async function activate(context: vscode.ExtensionContext): Promise<void> {
  process.chdir(context.extensionPath);

  outputChannel = vscode.window.createOutputChannel('AIAPI');
  context.subscriptions.push(outputChannel);

  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  statusBarItem.text = '$(rocket) AIAPI: starting...';
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);

  const log = (msg: string): void => {
    outputChannel!.appendLine(msg);
    // eslint-disable-next-line no-console
    console.log(msg);
  };

  log('AIAPI: activating...');

  const cfg = vscode.workspace.getConfiguration('aiAutomation');
  const mcpPort = cfg.get<number>('mcpPort', 3457);
  const dashboardPort = mcpPort + 1;

  try {
    const pkBytes = await loadCryptoCredentials().catch(() => null);

    mcpServer = new MCPServer(undefined, mcpPort, pkBytes ?? undefined);
    await mcpServer.start();
    log('MCP server running on http://127.0.0.1:' + mcpPort);

    const sessionTokenManager = (mcpServer as any).sessionTokenManager;
    const engine = (mcpServer as any).automationEngine;
    const helperRegistry = mcpServer.getHelperRegistry();

    dashboardServer = new HttpServerWithDashboard(
      engine,
      sessionTokenManager,
      dashboardPort,
      helperRegistry,
    );
    await dashboardServer.initAuth();
    await dashboardServer.start();
    log('Dashboard running on http://127.0.0.1:' + dashboardPort);

    statusBarItem.text = '$(rocket) AIAPI :' + mcpPort;
    statusBarItem.tooltip =
      'MCP: http://127.0.0.1:' + mcpPort + '\nDashboard: http://127.0.0.1:' + dashboardPort + '\nClick to open dashboard';
    statusBarItem.command = 'aiAutomation.openDashboard';

    globalLogger.info('system', 'AIAPI activated (MCP :' + mcpPort + ', dashboard :' + dashboardPort + ')');
  } catch (error: any) {
    const msg = 'AIAPI failed to start: ' + (error?.message ?? String(error));
    log('ERROR: ' + msg);
    statusBarItem.text = '$(error) AIAPI: failed';
    vscode.window.showErrorMessage(msg);
    return;
  }

  const mcpCallTool = vscode.commands.registerCommand(
    'extension.mcp.callTool',
    (params: { tool: string; arguments: Record<string, unknown> }) =>
      callMcpToolLocal(mcpPort, params.tool, params.arguments),
  );

  const mcpListTools = vscode.commands.registerCommand(
    'extension.mcp.listTools',
    () => listMcpToolsLocal(mcpPort),
  );

  const openDashboard = vscode.commands.registerCommand(
    'aiAutomation.openDashboard',
    () => vscode.env.openExternal(vscode.Uri.parse('http://127.0.0.1:' + dashboardPort)),
  );

  context.subscriptions.push(mcpCallTool, mcpListTools, openDashboard);
}

export async function deactivate(): Promise<void> {
  try {
    if (dashboardServer) {
      await dashboardServer.stop();
      dashboardServer = undefined;
    }
    if (mcpServer) {
      await mcpServer.stop();
      mcpServer = undefined;
    }
  } catch (_e) {
    // best-effort
  }
  outputChannel?.appendLine('AIAPI: deactivated');
  outputChannel?.dispose();
  outputChannel = undefined;
}

function callMcpToolLocal(
  port: number,
  toolName: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      jsonrpc: '2.0',
      id: Date.now(),
      method: 'tools/call',
      params: { name: toolName, arguments: args },
    });
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        method: 'POST',
        path: '/',
        headers: {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(body),
        },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk: Buffer) => { data += chunk; });
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            if (parsed.error) {
              reject(new Error(parsed.error.message ?? JSON.stringify(parsed.error)));
            } else {
              resolve(parsed.result);
            }
          } catch (e) {
            reject(e);
          }
        });
      },
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function listMcpToolsLocal(port: number): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      jsonrpc: '2.0',
      id: Date.now(),
      method: 'tools/list',
      params: {},
    });
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        method: 'POST',
        path: '/',
        headers: {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(body),
        },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk: Buffer) => { data += chunk; });
        res.on('end', () => {
          try {
            resolve(JSON.parse(data).result);
          } catch (e) {
            reject(e);
          }
        });
      },
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}