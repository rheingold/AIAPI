import * as vscode from 'vscode';
import { AutomationEngine } from './engine/automationEngine';
import * as path from 'path';
import { HttpServer } from './server/httpServer';
import { MCPServer } from './server/mcpServer';
import { UIObject, ActionResult } from './types';

let automationEngine: AutomationEngine;
let httpServer: HttpServer;
let mcpServer: MCPServer;

/**
 * VS Code extension activation
 */
export function activate(context: vscode.ExtensionContext) {
  console.log('AI UI Automation plugin activated');

  // Auto-test Calculator with MCP@IPC
  setTimeout(async () => {
    try {
      console.log('\n=== AUTO TEST: Calculator 25+17= ===');
      const sendResult = await vscode.commands.executeCommand('extension.mcp.callTool', {
        tool: 'setProperty',
        arguments: {
          providerName: 'windows-forms',
          elementId: 'calc',
          propertyName: 'keys',
          value: '25+17='
        }
      });
      console.log('Keys sent:', sendResult);
      
      await new Promise(r => setTimeout(r, 1000));
      
      const readResult = await vscode.commands.executeCommand('extension.mcp.callTool', {
        tool: 'readProperty',
        arguments: {
          providerName: 'windows-forms',
          elementId: 'calc',
          propertyName: 'value'
        }
      });
      console.log('Calculator display:', readResult);
      console.log('Expected: 42');
      console.log('Match:', readResult === 42 || readResult === '42' || String(readResult).includes('42'));
    } catch (error) {
      console.error('Auto-test error:', error);
    }
  }, 2000);

  try {
    automationEngine = new AutomationEngine();
    console.log('AutomationEngine initialized successfully');

    const cfg = vscode.workspace.getConfiguration('aiAutomation');
    const enableLegacyHttp = cfg.get<boolean>('enableLegacyHttp', false);
    const httpPort = cfg.get<number>('httpPort', 3456);
    const mcpPort = cfg.get<number>('mcpPort', 3457);

    // Start legacy HTTP API server only if enabled (default off)
    if (enableLegacyHttp) {
      httpServer = new HttpServer(automationEngine, httpPort);
      httpServer.start().catch((error) => {
        console.error('Failed to start HTTP server:', error);
        vscode.window.showErrorMessage(`HTTP API Server failed to start: ${error}`);
      });
    } else {
      console.log('Legacy HTTP server disabled by configuration');
    }

    // Start MCP server (port 3457) with a short retry to avoid silent failures
    const startMcp = async (attempt = 1): Promise<void> => {
      try {
        mcpServer = new MCPServer(automationEngine, mcpPort);
        await mcpServer.start();
        console.log(`MCP server listening on http://127.0.0.1:${mcpPort}`);
      } catch (error) {
        console.error('Failed to start MCP server (attempt ' + attempt + '):', error);
        if (attempt < 3) {
          setTimeout(() => startMcp(attempt + 1), 500);
        } else {
          vscode.window.showErrorMessage(`MCP Server failed to start: ${error}`);
        }
      }
    };
    startMcp().catch((err) => console.error('MCP start fatal:', err));


    // ==================== MCP@IPC Commands (Native VS Code Interface) ====================
    // These commands allow AI assistants to call MCP tools directly via VS Code IPC
    // No HTTP overhead, <1ms latency, native integration

    /**
     * Command: extension.mcp.callTool
     * Maps VS Code command calls directly to AutomationEngine methods
     * No duplication - calls same engine instance as HTTP endpoint
     */
    let mcpCallToolCommand = vscode.commands.registerCommand(
      'extension.mcp.callTool',
      async (params: any) => {
        try {
          const { tool, arguments: args } = params;

          if (!tool || !args) {
            throw new Error('Missing tool name or arguments');
          }

          // Direct mapping to AutomationEngine methods
          // Same implementation as MCP@HTTP endpoint - no duplication
          let result: any;

          switch (tool) {
            case 'queryTree':
              result = await automationEngine.queryTree(
                args.providerName,
                args.targetId,
                args.options
              );
              break;

            case 'clickElement':
              result = await automationEngine.clickElement(args.providerName, args.elementId);
              break;

            case 'setProperty':
              result = await automationEngine.setProperty(
                args.providerName,
                args.elementId,
                args.propertyName || args.property,
                args.value
              );
              break;

            case 'readProperty':
              result = await automationEngine.readProperty(
                args.providerName,
                args.elementId,
                args.propertyName || args.property
              );
              break;

            case 'getProviders':
              result = await automationEngine.getAvailableProviders();
              break;

            case 'getCacheStats':
              result = automationEngine.getCacheStats();
              break;

            case 'clearCache':
              automationEngine.clearCache();
              result = { success: true, message: 'Cache cleared' };
              break;

            case 'getLogs':
              result = automationEngine.getLogs();
              break;

            case 'clearLogs':
              automationEngine.clearLogs();
              result = { success: true, message: 'Logs cleared' };
              break;

            default:
              throw new Error(`Unknown tool: ${tool}`);
          }

          return result;
        } catch (error) {
          console.error(`MCP@IPC Error in ${params?.tool}:`, error);
          throw error;
        }
      }
    );

    /**
     * Command: extension.mcp.listTools
     * Returns list of available MCP tools
     * Used for tool discovery
     */
    let mcpListToolsCommand = vscode.commands.registerCommand(
      'extension.mcp.listTools',
      async () => {
        return {
          tools: [
            { name: 'queryTree', description: 'Get UI tree from provider' },
            { name: 'clickElement', description: 'Click an element' },
            { name: 'setProperty', description: 'Set element property' },
            { name: 'readProperty', description: 'Read element property' },
            { name: 'getProviders', description: 'List available providers' },
            { name: 'getCacheStats', description: 'Get cache statistics' },
            { name: 'clearCache', description: 'Clear object cache' },
            { name: 'getLogs', description: 'Get action logs' },
            { name: 'clearLogs', description: 'Clear logs' },
          ],
        };
      }
    );

    console.log('MCP@IPC commands registered (extension.mcp.callTool, extension.mcp.listTools)');
    // ==================== End MCP@IPC Commands ====================

    // Add MCP@IPC commands to subscriptions
    context.subscriptions.push(mcpCallToolCommand, mcpListToolsCommand);

    // Configure asset paths (e.g., PowerShell script)
    try {
      const psPath = path.join(context.extensionPath, 'dist', 'server', 'windowsAutomation.ps1');
      automationEngine.configureAssets({ windowsAutomationScript: psPath });
      console.log('Configured Windows automation script path:', psPath);
    } catch (e) {
      console.warn('Could not configure Windows automation script path:', e);
    }
  } catch (error) {
    console.error('Failed to initialize AutomationEngine:', error);
    vscode.window.showErrorMessage(`Extension failed to load: ${error}`);
    return;
  }

  // Register command: Inspect Window
  let inspectCommand = vscode.commands.registerCommand(
    'aiAutomation.inspectWindow',
    async () => {
      const providerName = await promptUserSelectProvider('Select provider to inspect:');
      if (!providerName) return;

      const targetId = await vscode.window.showInputBox({
        prompt: 'Enter window/document ID (or press Enter for default)',
        value: 'form_main',
      });
      if (targetId === undefined) return;

      try {
        const tree = await automationEngine.queryTree(providerName, targetId);
        displayTreeInPanel(tree);
        vscode.window.showInformationMessage('Window tree retrieved successfully');
      } catch (error) {
        vscode.window.showErrorMessage(`Failed to inspect window: ${error}`);
      }
    }
  );

  // Register command: Click Element
  let clickCommand = vscode.commands.registerCommand(
    'aiAutomation.clickElement',
    async () => {
      const providerName = await promptUserSelectProvider('Select provider:');
      if (!providerName) return;

      const elementId = await vscode.window.showInputBox({
        prompt: 'Enter element ID',
        value: 'btn_submit',
      });
      if (!elementId) return;

      try {
        const result = await automationEngine.clickElement(providerName, elementId);
        displayActionResult(result);
      } catch (error) {
        vscode.window.showErrorMessage(`Failed to click element: ${error}`);
      }
    }
  );

  // Register command: Set Property
  let setPropertyCommand = vscode.commands.registerCommand(
    'aiAutomation.setProperty',
    async () => {
      const providerName = await promptUserSelectProvider('Select provider:');
      if (!providerName) return;

      const elementId = await vscode.window.showInputBox({
        prompt: 'Enter element ID',
      });
      if (!elementId) return;

      const property = await vscode.window.showInputBox({
        prompt: 'Enter property name',
      });
      if (!property) return;

      const value = await vscode.window.showInputBox({
        prompt: 'Enter property value',
      });
      if (value === undefined) return;

      try {
        const result = await automationEngine.setProperty(
          providerName,
          elementId,
          property,
          value
        );
        displayActionResult(result);
      } catch (error) {
        vscode.window.showErrorMessage(`Failed to set property: ${error}`);
      }
    }
  );

  // Register command: Read Property
  let readPropertyCommand = vscode.commands.registerCommand(
    'aiAutomation.readProperty',
    async () => {
      const providerName = await promptUserSelectProvider('Select provider:');
      if (!providerName) return;

      const elementId = await vscode.window.showInputBox({
        prompt: 'Enter element ID',
      });
      if (!elementId) return;

      const property = await vscode.window.showInputBox({
        prompt: 'Enter property name',
      });
      if (!property) return;

      try {
        const value = await automationEngine.readProperty(providerName, elementId, property);
        vscode.window.showInformationMessage(`${property} = ${JSON.stringify(value)}`);
      } catch (error) {
        vscode.window.showErrorMessage(`Failed to read property: ${error}`);
      }
    }
  );

  context.subscriptions.push(inspectCommand, clickCommand, setPropertyCommand, readPropertyCommand);
  
  // MCP@IPC commands are registered above in activate() and automatically added to context
  // Commands: extension.mcp.callTool, extension.mcp.listTools
}

/**
 * Extension deactivation
 */
export function deactivate() {
  console.log('AI UI Automation plugin deactivated');
  
  // Stop HTTP server
  if (httpServer) {
    httpServer.stop().catch((error) => {
      console.error('Error stopping HTTP server:', error);
    });
  }

  // Stop MCP server
  if (mcpServer) {
    mcpServer.stop().catch((error) => {
      console.error('Error stopping MCP server:', error);
    });
  }
}

/**
 * Prompt user to select a provider
 */
async function promptUserSelectProvider(message: string): Promise<string | undefined> {
  const providers = await automationEngine.getAvailableProviders();

  if (providers.length === 0) {
    vscode.window.showWarningMessage('No providers available');
    return undefined;
  }

  return await vscode.window.showQuickPick(providers, {
    placeHolder: message,
  });
}

/**
 * Display tree structure in a webview panel
 */
function displayTreeInPanel(tree: UIObject): void {
  const panel = vscode.window.createWebviewPanel(
    'automationTree',
    'UI Tree Inspector',
    vscode.ViewColumn.One,
    { enableScripts: true }
  );

  const treeHtml = generateTreeHtml(tree);
  panel.webview.html = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: monospace; padding: 10px; background: #1e1e1e; color: #d4d4d4; }
        .tree { margin-left: 20px; }
        .node { margin: 5px 0; }
        .type { color: #569cd6; font-weight: bold; }
        .id { color: #ce9178; }
        .property { color: #9cdcfe; }
        .action { color: #4ec9b0; }
        .expand { cursor: pointer; user-select: none; }
        .children { display: none; margin-left: 20px; }
        .children.show { display: block; }
      </style>
    </head>
    <body>
      <h2>UI Object Tree</h2>
      <div class="tree">${treeHtml}</div>
      <script>
        document.querySelectorAll('.expand').forEach(el => {
          el.addEventListener('click', (e) => {
            e.target.textContent = e.target.textContent === '▶' ? '▼' : '▶';
            e.target.parentElement.querySelector('.children').classList.toggle('show');
          });
        });
      </script>
    </body>
    </html>
  `;
}

/**
 * Recursively generate HTML for tree view
 */
function generateTreeHtml(obj: UIObject, depth: number = 0): string {
  const indent = '  '.repeat(depth);
  const hasChildren = obj.children && obj.children.length > 0;
  const expandBtn = hasChildren ? '<span class="expand">▶</span>' : '';

  let html = `
    <div class="node">
      ${expandBtn}
      <span class="type">${obj.type}</span>
      <span class="id">#${obj.id}</span>
      ${obj.name ? `<span class="property">(${obj.name})</span>` : ''}
  `;

  if (obj.properties) {
    html += `<div style="margin-left: 10px; color: #858585;">`;
    Object.entries(obj.properties).slice(0, 3).forEach(([key, val]) => {
      html += `<div>${key}: ${JSON.stringify(val).substring(0, 40)}</div>`;
    });
    html += `</div>`;
  }

  if (obj.actions) {
    html += `<div style="margin-left: 10px;">
      Actions: ${obj.actions.map(a => `<span class="action">[${a}]</span>`).join(' ')}
    </div>`;
  }

  if (hasChildren) {
    html += `<div class="children">`;
    obj.children!.forEach(child => {
      html += generateTreeHtml(child, depth + 1);
    });
    html += `</div>`;
  }

  html += `</div>`;
  return html;
}

/**
 * Display action result
 */
function displayActionResult(result: ActionResult): void {
  const message = result.success
    ? `✓ ${result.message || 'Action completed successfully'}`
    : `✗ ${result.error || result.message || 'Action failed'}`;

  if (result.success) {
    vscode.window.showInformationMessage(message);
  } else {
    vscode.window.showErrorMessage(message);
  }
}
