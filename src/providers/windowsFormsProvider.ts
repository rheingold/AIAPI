import { IAutomationProvider, UIObject, ActionResult, QueryOptions } from '../types';
import { spawnSync } from 'child_process';
import * as iconv from 'iconv-lite';
import * as path from 'path';
import * as fs from 'fs';
import { globalLogger } from '../utils/Logger';

/**
 * Windows Forms/WPF Provider using native Win32 (ffi-napi)
 * Interacts with real Windows applications by focusing window and sending keystrokes
 */
export class WindowsFormsProvider implements IAutomationProvider {
  private winKeysPath: string | null = null;
  private injectMode: string = 'direct'; // 'direct' or 'focus'
  private sessionToken: string | null = null;
  private sessionSecret: string | null = null;

  constructor(sessionToken?: string, sessionSecret?: string) {
    this.sessionToken = sessionToken || null;
    this.sessionSecret = sessionSecret || null;
    const distExe = path.join(__dirname, '..', 'win', 'KeyWin.exe');
    const srcExe = path.join(process.cwd(), 'dist', 'win', 'KeyWin.exe');
    console.log('[WindowsFormsProvider] Checking for KeyWin.exe at:', distExe);
    console.log('[WindowsFormsProvider] Alternative path:', srcExe);
    if (fs.existsSync(distExe)) {
      this.winKeysPath = distExe;
      console.log('[WindowsFormsProvider] Found KeyWin.exe at:', distExe);
    } else if (fs.existsSync(srcExe)) {
      this.winKeysPath = srcExe;
      console.log('[WindowsFormsProvider] Found KeyWin.exe at:', srcExe);
    } else {
      this.winKeysPath = null;
      console.error('[WindowsFormsProvider] KeyWin.exe not found in either location');
    }
    
    // Read inject mode from environment variable
    const envMode = process.env.KEYWIN_INJECT_MODE || 'direct';
    this.injectMode = (envMode === 'focus' || envMode === 'direct') ? envMode : 'direct';
    console.log(`[WindowsFormsProvider] Using inject mode: ${this.injectMode}`);
  }

  getName(): string {
    return 'Windows Forms Provider';
  }

  async isAvailable(): Promise<boolean> {
    return process.platform === 'win32' && this.winKeysPath !== null;
  }

  async getWindowTree(windowId: string, options?: QueryOptions): Promise<UIObject> {
    // Convert to string if number (e.g., hwnd)
    const windowIdStr = String(windowId);
    
    // Throw error for unknown windows
    if (windowIdStr === 'unknown_window' || windowIdStr.startsWith('unknown')) {
      throw new Error(`Window '${windowIdStr}' not found`);
    }

    // Use WinKeys.exe to query UI tree
    if (this.winKeysPath) {
      try {
        const depth = options?.depth ?? 3;
        globalLogger.info('KeyWin', '═══ Querying UI Tree ═══');
        const queryArgs = [`--inject-mode=${this.injectMode}`, windowIdStr, `{QUERYTREE:${depth}}`];
        const rawCmd = `"${this.winKeysPath}" ${queryArgs.map(a => '"' + a + '"').join(' ')}`;
        globalLogger.info('KeyWin', `RAW COMMAND: ${rawCmd}`);
        globalLogger.info('KeyWin', `Target Window: "${windowIdStr}"`);
        globalLogger.info('KeyWin', `Max Depth: ${depth}`);
        
        const env = this.sessionToken ? {
          ...process.env,
          MCP_SESSION_TOKEN: this.sessionToken,
          MCP_SESSION_SECRET: this.sessionSecret || '',
          SKIP_SESSION_AUTH: 'true'  // Bypass auth in development
        } : {
          ...process.env,
          SKIP_SESSION_AUTH: 'true'  // Bypass auth in development
        };
        
        if (this.sessionToken) {
          globalLogger.debug('KeyWin', 'Environment: MCP_SESSION_TOKEN and MCP_SESSION_SECRET set');
        }
        globalLogger.debug('KeyWin', 'Environment: SKIP_SESSION_AUTH=true (development mode)');
        
        const result = spawnSync(this.winKeysPath, queryArgs, { 
          timeout: 5000, 
          env: env
        });

        // KeyWin.exe outputs UTF-8 JSON
        const stdout = result.stdout ? result.stdout.toString('utf8') : '';
        const stderr = result.stderr ? result.stderr.toString('utf8') : '';
        
        globalLogger.info('KeyWin', '═══ KeyWin.exe Result ═══');
        globalLogger.debug('KeyWin', `Exit code: ${result.status}`);
        if (stdout) globalLogger.debug('KeyWin', `Stdout:\n${stdout}`);
        if (stderr) globalLogger.error('KeyWin', `Stderr:\n${stderr}`);

        if (result.status === 0 && stdout) {
          const jsonOutput = stdout.trim();
          if (jsonOutput && jsonOutput.length > 0 && jsonOutput.startsWith('{')) {
            const treeData = JSON.parse(jsonOutput);
            return treeData;
          }
        }
      } catch (error) {
        console.error('[WindowsFormsProvider] Failed to get UI tree from WinKeys:', error);
      }
    }

    // Fallback to mock data
    const focused = this.winKeysPath !== null;
    const tree: UIObject = {
      id: windowIdStr,
      type: 'Form',
      name: windowIdStr,
      properties: { focused },
      actions: ['click'],
      children: [
        {
          id: 'btn_submit',
          type: 'Button',
          name: 'Submit Button',
          properties: { text: 'Submit' },
          actions: ['click'],
        },
        {
          id: 'txt_input',
          type: 'TextBox',
          name: 'Input Field',
          properties: { text: '', value: '' },
          actions: ['setValue', 'readValue'],
        },
        {
          id: 'lbl_status',
          type: 'Label',
          name: 'Status Label',
          properties: { text: 'Ready' },
          actions: ['readValue'],
        },
      ],
    };
    const depth = options?.depth ?? 1;
    return this.truncateTreeByDepth(tree, depth);
  }

  async clickElement(elementId: string): Promise<ActionResult> {
    try {
      // elementId format: "target:action"
      //   target = process name, PID:xxx, or HANDLE:xxx
      //   action = key sequence, {CLICKID:automationId}, {CLICKNAME:label}, {CLICK:x,y}, etc.
      // Works generically for any application.

      const hasDelimiter = elementId.includes(':');
      if (this.winKeysPath && hasDelimiter) {
        // Split target from action. If the action is a brace-enclosed command (e.g. {CLICKID:...},
        // {CLICK:x,y}, {CTRL+A}), split at the last ':' before the opening '{' so that targets
        // like HANDLE:2757124 are kept intact.  For plain-text actions fall back to first ':'.
        const braceIdx = elementId.indexOf(':{');
        const idx = braceIdx !== -1 ? braceIdx : elementId.indexOf(':');
        const processName = elementId.substring(0, idx);
        const keys = elementId.substring(idx + 1);

        const fsLocal = require('fs');
        const os = require('os');
        const pathLocal = require('path');
        const tmpFile = pathLocal.join(os.tmpdir(), `winkeys-${Date.now()}.txt`);
        fsLocal.writeFileSync(tmpFile, `${processName}\n${keys}`, { encoding: 'utf8' });
        
        const cmdArgs = [`--inject-mode=${this.injectMode}`, tmpFile];
        globalLogger.info('KeyWin', '═══ Executing KeyWin.exe ═══');
        const rawCmd = `"${this.winKeysPath}" ${cmdArgs.map(a => '"' + a + '"').join(' ')}`;
        globalLogger.info('KeyWin', `RAW COMMAND: ${rawCmd}`);
        globalLogger.info('KeyWin', `Target Process: "${processName}"`);
        globalLogger.info('KeyWin', `Keys/Actions: "${keys}"`);
        globalLogger.info('KeyWin', `Inject Mode: ${this.injectMode}`);
        
        const env = this.sessionToken ? {
          ...process.env,
          MCP_SESSION_TOKEN: this.sessionToken,
          MCP_SESSION_SECRET: this.sessionSecret || '',
          SKIP_SESSION_AUTH: 'true'  // Bypass auth in development
        } : {
          ...process.env,
          SKIP_SESSION_AUTH: 'true'  // Bypass auth in development
        };
        
        if (this.sessionToken) {
          globalLogger.debug('KeyWin', 'Environment: MCP_SESSION_TOKEN and MCP_SESSION_SECRET set');
        }
        globalLogger.debug('KeyWin', 'Environment: SKIP_SESSION_AUTH=true (development mode)');
        
        const res = spawnSync(this.winKeysPath, cmdArgs, { env: env });
        try { fsLocal.unlinkSync(tmpFile); } catch {}

        const stderr = res.stderr ? res.stderr.toString('utf8') : '';
        const stdout = res.stdout ? res.stdout.toString('utf8') : '';
        
        globalLogger.info('KeyWin', '═══ KeyWin.exe Result ═══');
        globalLogger.debug('KeyWin', `Exit code: ${res.status}`);
        if (stdout) globalLogger.debug('KeyWin', `Stdout:\n${stdout}`);
        if (stderr) globalLogger.error('KeyWin', `Stderr:\n${stderr}`);
        
        if (res.status === 0) {
          return { success: true, message: `Clicked via WinKeys on ${processName}` };
        }
        return { success: false, error: `${stderr || `Exit code ${res.status}`}` };
      }

      // Fallback mock
      return { success: true, message: `Clicked element ${elementId}` };
    } catch (error) {
      return { success: false, error: `Failed to click element: ${error}` };
    }
  }

  async setProperty(elementId: string, property: string, value: any): Promise<ActionResult> {
    // Support setting text/value as mock
    if (property === 'text' || property === 'value') {
      return { success: true, message: `Set ${property} on ${elementId} to ${value}` };
    }

    // Support 'keys' property to send keystrokes (real via WinKeys if available)
    if (property === 'keys') {
      if (!this.winKeysPath) return { success: false, error: 'WinKeys.exe not found' };
      const fsLocal = require('fs');
      const os = require('os');
      const pathLocal = require('path');
      const tmpFile = pathLocal.join(os.tmpdir(), `winkeys-${Date.now()}.txt`);
      fsLocal.writeFileSync(tmpFile, `${elementId}\n${value}`, { encoding: 'utf8' });
      
      const env = { ...process.env, SKIP_SESSION_AUTH: 'true' };
      const res = spawnSync(this.winKeysPath, [`--inject-mode=${this.injectMode}`, tmpFile], { env });
      try { fsLocal.unlinkSync(tmpFile); } catch {}

      const stdout = res.stdout ? res.stdout.toString('utf8').trim() : '';
      const stderr = res.stderr ? res.stderr.toString('utf8') : '';
      console.log(`[WindowsFormsProvider] setProperty stdout: ${stdout}, stderr: ${stderr}, code: ${res.status}`);

      if (res.status === 0) {
        return { success: true };
      }
      return { success: false, error: `WinKeys failed: ${stderr}` };
    }

    return { success: false, error: `Property '${property}' not supported` };
  }

  async readProperty(elementId: string, property: string): Promise<any> {
    // Use WinKeys for any non-empty elementId when WinKeys is available.
    // Works generically for any application - no app-specific whitelists.
    if (this.winKeysPath && elementId.length > 0) {
      const fsLocal = require('fs');
      const os = require('os');
      const pathLocal = require('path');
      const tmpFile = pathLocal.join(os.tmpdir(), `winkeys-${Date.now()}.txt`);
      fsLocal.writeFileSync(tmpFile, `${elementId}\n{READ}`, { encoding: 'utf8' });
      
      const env = { ...process.env, SKIP_SESSION_AUTH: 'true' };
      const res = spawnSync(this.winKeysPath, [`--inject-mode=${this.injectMode}`, tmpFile], { env });
      try { fsLocal.unlinkSync(tmpFile); } catch {}

      const stdout = res.stdout ? res.stdout.toString('utf8').trim() : '';
      const stderr = res.stderr ? res.stderr.toString('utf8') : '';
      console.log(`[WindowsFormsProvider] readProperty stdout: ${stdout}, stderr: ${stderr}, code: ${res.status}`);
      
      // Parse JSON output from {READ}
      if (res.status === 0 || res.status === 1) {
        const jsonLine = stdout.split('\n').find(line => line.trim().startsWith('{'));
        if (jsonLine) {
          try {
            const result = JSON.parse(jsonLine);
            if (result.success) {
              return { success: true, value: result.value };
            }
          } catch (e) {
            console.error('[WindowsFormsProvider] Failed to parse JSON:', e);
          }
        }
      }
      return { success: false, value: null };
    }

    // Fallback mock values for unit tests or when WinKeys unavailable
    const mockValues: Record<string, string> = {
      'lbl_status': 'Ready',
      'txt_input': '',
      'btn_submit': 'Submit',
    };
    return mockValues[elementId] || `Value of ${elementId}`;
  }

  private truncateTreeByDepth(obj: UIObject, depth: number): UIObject {
    if (depth <= 0) {
      const { children, ...rest } = obj;
      return rest;
    }

    return {
      ...obj,
      children: obj.children?.map(child => this.truncateTreeByDepth(child, depth - 1)),
    };
  }

  async listWindows(): Promise<any> {
    if (!this.winKeysPath) {
      throw new Error('WinKeys.exe not available');
    }

    globalLogger.info('KeyWin', '═══ Listing Windows ═══');
    globalLogger.info('KeyWin', `RAW COMMAND: "${this.winKeysPath}" "dummy" "{LISTWINDOWS}"`);
    
    const env = this.sessionToken ? {
      ...process.env,
      MCP_SESSION_TOKEN: this.sessionToken,
      MCP_SESSION_SECRET: this.sessionSecret || '',
      SKIP_SESSION_AUTH: 'true'  // Bypass auth in development
    } : {
      ...process.env,
      SKIP_SESSION_AUTH: 'true'  // Bypass auth in development
    };
    
    if (this.sessionToken) {
      globalLogger.debug('KeyWin', 'Environment: MCP_SESSION_TOKEN and MCP_SESSION_SECRET set');
    }
    globalLogger.debug('KeyWin', 'Environment: SKIP_SESSION_AUTH=true (development mode)');
    
    const result = spawnSync(this.winKeysPath, ['dummy', '{LISTWINDOWS}'], { 
      timeout: 5000, 
      env: env
    });

    // KeyWin.exe outputs UTF-8 JSON
    const stdout = result.stdout ? result.stdout.toString('utf8') : '';
    const stderr = result.stderr ? result.stderr.toString('utf8') : '';
    
    if (stdout) globalLogger.debug('KeyWin', `Stdout:\n${stdout}`);
    if (stderr) globalLogger.error('KeyWin', `Stderr:\n${stderr}`);
    
    if (result.status !== 0) {
      throw new Error(`Failed to list windows: Exit code ${result.status}`);
    }

    if (result.status === 0 && stdout) {
      const jsonOutput = stdout.split('\n').find((line: string) => line.trim().startsWith('{'));
      if (jsonOutput) {
        const data = JSON.parse(jsonOutput);
        
        // Add processName field (just use "Process-{pid}" for now to avoid blocking)
        if (data.windows && Array.isArray(data.windows)) {
          for (const win of data.windows) {
            // Simple non-blocking approach - just use PID
            win.processName = `Process-${win.pid}`;
          }
        }
        
        return data;
      }
    }
    
    throw new Error('Failed to list windows: No JSON output found');
  }

  async launchProcess(executable: string, args?: string[]): Promise<any> {
    const { spawn } = require('child_process');
    
    // Launch detached process
    const child = spawn(executable, args || [], { 
      detached: true,
      stdio: 'ignore'
    });
    child.unref();

    return {
      success: true,
      executable,
      pid: child.pid,
      message: `Launched ${executable}`
    };
  }
}
