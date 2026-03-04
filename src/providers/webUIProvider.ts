import { IAutomationProvider, UIObject, ActionResult, QueryOptions } from '../types';
import { spawnSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

/**
 * Web UI automation provider backed by BrowserWin.exe (CDP + UIA).
 * Supports Chrome, Edge, Brave, and Firefox via Chrome DevTools Protocol.
 * Requires the browser to be started with --remote-debugging-port=<port>.
 * Call LAUNCH via helper_BrowserWin first if the browser is not running in debug mode.
 */
export class WebUIProvider implements IAutomationProvider {
  private browserWinPath: string | null = null;

  /** e.g. 'brave', 'chrome', 'msedge', 'firefox' */
  private browser: string;

  /** CDP debug port, e.g. 9222 */
  private port: number;

  constructor(browser = 'brave', port = 9222) {
    this.browser = browser;
    this.port    = port;

    // Resolve BrowserWin.exe — check canonical dist/helpers location first
    const candidates = [
      path.join(__dirname, '..', 'helpers', 'BrowserWin.exe'),
      path.join(process.cwd(), 'dist', 'helpers', 'BrowserWin.exe'),
    ];
    for (const p of candidates) {
      if (fs.existsSync(p)) {
        this.browserWinPath = p;
        break;
      }
    }
  }

  getName(): string {
    return `Web UI Provider (BrowserWin / ${this.browser}:${this.port})`;
  }

  async isAvailable(): Promise<boolean> {
    return process.platform === 'win32' && this.browserWinPath !== null;
  }

  // ---------------------------------------------------------------------------
  // IAutomationProvider implementation
  // ---------------------------------------------------------------------------

  /**
   * Query the DOM tree to the requested depth.
   * `target` may be a browser:port string like 'brave:9222'; if omitted the
   * constructor values are used.
   */
  async getWindowTree(target: string, options?: QueryOptions): Promise<UIObject> {
    const depth  = options?.depth ?? 3;
    const result = this.runCommand(target, `{QUERYTREE:${depth}}`);
    if (result && result.tree) return result.tree as UIObject;
    // Return a minimal shell on failure so callers get a typed object
    return { id: target, type: 'browser', name: this.browser, properties: result ?? {} };
  }

  /** Click a DOM element by CSS selector (CLICKID) or visible text (CLICKNAME). */
  async clickElement(elementId: string): Promise<ActionResult> {
    // elementId starting with '#' or '.' → treat as CSS selector; otherwise text-match
    const isSelector = /^[#.\[]/.test(elementId);
    const action     = isSelector ? `{CLICKID:${elementId}}` : `{CLICKNAME:${elementId}}`;
    const result     = this.runRawCommand(this.defaultTarget(), action);
    return result?.success
      ? { success: true,  message: `Clicked '${elementId}'` }
      : { success: false, error: result?.error ?? 'click_failed' };
  }

  /**
   * Set a property on a DOM element.
   * - property === 'value'  → FILL (#selector:newValue)
   * - property === 'checked' → CHECK / UNCHECK  (#selector)
   * - anything else → EXEC (JS assignment)
   */
  async setProperty(elementId: string, property: string, value: any): Promise<ActionResult> {
    let action: string;
    if (property === 'value') {
      action = `{FILL:${elementId}:${value}}`;
    } else if (property === 'checked') {
      action = value ? `{CHECK:${elementId}}` : `{UNCHECK:${elementId}}`;
    } else {
      // Generic JS execution
      const expr = `document.querySelector('${elementId.replace(/'/g, "\\'")}').${property}=${JSON.stringify(value)}`;
      action = `{EXEC:${expr}}`;
    }
    const result = this.runRawCommand(this.defaultTarget(), action);
    return result?.success
      ? { success: true,  message: `Set ${property} on '${elementId}'` }
      : { success: false, error: result?.error ?? 'set_failed' };
  }

  /**
   * Read a property from a DOM element.
   * - property === 'value' | 'textContent' | 'innerText'  → READELEM
   * - anything else → EXEC (JS expression)
   */
  async readProperty(elementId: string, property: string): Promise<any> {
    let action: string;
    if (['value', 'textContent', 'innerText'].includes(property)) {
      action = `{READELEM:${elementId}}`;
    } else {
      const expr = `document.querySelector('${elementId.replace(/'/g, "\\'")}')?.${property}`;
      action = `{EXEC:${expr}}`;
    }
    const result = this.runRawCommand(this.defaultTarget(), action);
    return result?.value ?? result?.result ?? null;
  }

  // ---------------------------------------------------------------------------
  // Convenience helpers (beyond IAutomationProvider)
  // ---------------------------------------------------------------------------

  navigate(url: string): any {
    return this.runRawCommand(this.defaultTarget(), `{NAVIGATE:${url}}`);
  }

  exec(js: string): any {
    return this.runRawCommand(this.defaultTarget(), `{EXEC:${js}}`);
  }

  screenshot(filePath?: string): any {
    const action = filePath ? `{SCREENSHOT:${filePath}}` : `{SCREENSHOT}`;
    return this.runRawCommand(this.defaultTarget(), action);
  }

  listBrowsers(): any {
    return this.runRawCommand('SYSTEM', `{LISTBROWSERS}`);
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /** Build a "browser:port" target string from the constructor defaults. */
  private defaultTarget(): string {
    return `${this.browser}:${this.port}`;
  }

  /**
   * Run a command against an explicit target (may include browser:port).
   * Parses the raw target string first.
   */
  private runCommand(rawTarget: string, action: string): any {
    // If caller passes a full target like 'brave:9222' use it directly;
    // otherwise fall back to constructor defaults.
    const target = rawTarget && rawTarget !== 'unknown' ? rawTarget : this.defaultTarget();
    return this.runRawCommand(target, action);
  }

  /**
   * Spawn BrowserWin.exe via the inject-mode=direct temp-file protocol,
   * same as WindowsFormsProvider does for KeyWin.exe.
   */
  private runRawCommand(target: string, action: string): any {
    if (!this.browserWinPath) return { success: false, error: 'BrowserWin.exe not found' };

    const tmpFile = path.join(os.tmpdir(), `browserwin-${Date.now()}.txt`);
    try {
      fs.writeFileSync(tmpFile, `${target}\n${action}`, { encoding: 'utf8' });
      const res = spawnSync(this.browserWinPath, ['--inject-mode=direct', tmpFile], {
        timeout: 15000,
        encoding: 'utf8',
      });
      const stdout = res.stdout?.trim() ?? '';
      if (stdout && stdout.startsWith('{')) {
        try { return JSON.parse(stdout); } catch { /* fall through */ }
      }
      return { success: false, error: res.stderr?.trim() || 'no_output', rawStdout: stdout };
    } catch (err: any) {
      return { success: false, error: err.message };
    } finally {
      try { fs.unlinkSync(tmpFile); } catch { /* best-effort */ }
    }
  }
}
