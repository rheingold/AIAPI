/**
 * browserRenderClient.ts
 *
 * Implements the NativeWin `FETCH_WEBPAGE_RENDER` action: fetches a URL by
 * actually rendering it in a real (CDP-enabled) browser instance via the
 * existing BrowserWin helper, then extracts the fully-JS-rendered DOM
 * (document.documentElement.outerHTML) instead of the raw HTTP response body.
 *
 * Intended for JavaScript-heavy / dynamically-rendered pages (SPAs) where the
 * plain fetch_webpage (NativeWin FETCH_WEBPAGE) HTTP client only sees the
 * pre-render HTML shell.
 *
 * Per the "interactive-by-default" requirement, the browser is launched
 * visible (not headless) unless the caller explicitly requests headless mode
 * — this ensures the render happens in the user's own interactive session
 * (via HelperDaemon's automatic Session 0 -> WinSvcBridge routing) and is
 * visible on their screen, matching the behaviour of all other helpers.
 */

import { HelperRegistry } from '../helpers/HelperRegistry';
import { detectObstacle, ObstacleProfile } from './browserObstacleProfiles';

export interface RenderWebpageOptions {
  /** Browser to use: 'chrome' | 'msedge' | 'brave' | 'firefox' | 'opera'. Default: 'chrome'. */
  browser?: string;
  /** Render headless (invisible) instead of the default visible/interactive window. */
  headless?: boolean;
  /** Max time (ms) to wait for LAUNCH/NAVIGATE/EXEC calls. Default: 20000. */
  timeoutMs?: number;
  /** Extra settle time (ms) after navigation before extracting the DOM, to let async JS finish rendering. Default: 1500. */
  waitMs?: number;
  /** Optional CSS selector — if given, returns that element's outerHTML instead of the whole document. */
  selector?: string;
  /**
   * Detect captcha/login/consent obstacles (via config/browser-obstacles.json
   * profiles) and, when the browser is visible, pause for the user to resolve
   * them before continuing. Default: true.
   */
  detectObstacles?: boolean;
  /**
   * Bypass WinSvcBridge / interactive Session 0 routing entirely (spawn
   * BrowserWin directly, even as a Windows Service) instead of using the
   * shared interactive-by-default daemon. For headless/background scraping
   * that must not depend on — or disturb — the logged-in user's desktop.
   * Has no effect outside Session 0 (harmless elsewhere). Obstacle detection
   * cannot pause for user input in this mode — see `detectObstacles`.
   * Default: false.
   */
  background?: boolean;
}

export interface ObstacleInfo {
  id: string;
  description: string;
  waitedMs: number;
  cleared: boolean;
}

export interface RenderWebpageResult {
  success: boolean;
  url: string;
  browser: string;
  headless: boolean;
  html?: string;
  length?: number;
  error?: string;
  obstacle?: ObstacleInfo;
}

/**
 * Render `url` in a real browser (via BrowserWin) and return the resulting DOM source.
 */
export async function renderWebpage(
  helperRegistry: HelperRegistry,
  url: string,
  options: RenderWebpageOptions = {},
): Promise<RenderWebpageResult> {
  const browser   = options.browser ?? 'chrome';
  const headless  = options.headless === true; // default: visible/interactive
  const timeoutMs = options.timeoutMs ?? 20000;
  const waitMs    = options.waitMs ?? 1500;
  const background = options.background === true; // default: interactive daemon

  if (!url) {
    return { success: false, url, browser, headless, error: 'renderWebpage requires a url' };
  }

  const launchResult = await helperRegistry.callCommand(
    'BrowserWin.exe', browser, 'LAUNCH', '', headless ? 'headless' : 'visible', timeoutMs,
    '', '', false, background,
  );
  if (launchResult?.success === false) {
    return { success: false, url, browser, headless, error: `LAUNCH failed: ${launchResult.error ?? 'unknown error'}` };
  }

  // BrowserWin's NAVIGATE/EXEC default to a fixed port (9222) unless the
  // target string carries an explicit "browser:port" suffix. LAUNCH itself
  // may have picked a different port (9223+) to avoid colliding with an
  // already-running/stale instance on 9222 — without pinning the port here,
  // subsequent NAVIGATE/EXEC calls would silently talk to that unrelated
  // instance instead of the one we just launched/reused.
  const launchPort: number | undefined = launchResult?.port;
  const target = launchPort ? `${browser}:${launchPort}` : browser;

  // Interactive-by-default: a visible window that opens behind other apps is
  // useless to the user. Bring it to the foreground now (best-effort — a
  // FOCUS failure here must never abort the render itself).
  if (!headless && !background) {
    await bringBrowserToFront(helperRegistry, target, timeoutMs);

    // Best-effort: dismiss any native startup dialog/infobar Chrome may show
    // on this profile (e.g. "Restore pages?" after an unclean prior exit) —
    // these are browser chrome, not page DOM, so they cannot be detected via
    // the obstacle-detection HTML scan and would otherwise silently block
    // NAVIGATE/EXEC. ESC is a no-op when nothing is showing.
    try {
      await helperRegistry.callCommand('BrowserWin.exe', target, 'KEYPRESS', '', 'ESC', timeoutMs, '', '', false, background);
    } catch { /* non-fatal */ }
  }

  const navResult = await helperRegistry.callCommand(
    'BrowserWin.exe', target, 'NAVIGATE', '', url, timeoutMs,
    '', '', false, background,
  );
  if (navResult?.success === false) {
    return { success: false, url, browser, headless, error: `NAVIGATE failed: ${navResult.error ?? 'unknown error'}` };
  }

  if (waitMs > 0) {
    await new Promise(resolve => setTimeout(resolve, waitMs));
  }

  const script = options.selector
    ? `(function(){var e=document.querySelector(${JSON.stringify(options.selector)});return e?e.outerHTML:null;})()`
    : 'document.documentElement.outerHTML';

  const execResult = await helperRegistry.callCommand(
    'BrowserWin.exe', target, 'EXEC', '', script, timeoutMs,
    '', '', false, background,
  );
  if (execResult?.success === false) {
    return { success: false, url, browser, headless, error: `EXEC failed: ${execResult.error ?? 'unknown error'}` };
  }

  let html: string | null = execResult?.result ?? null;
  if (html === null) {
    return {
      success: false, url, browser, headless,
      error: options.selector
        ? `No element matched selector "${options.selector}"`
        : 'EXEC returned null for document.documentElement.outerHTML',
    };
  }

  const detectObstacles = options.detectObstacles !== false; // default: true
  if (detectObstacles) {
    const profile = detectObstacle(html);
    if (profile) {
      // Per the interactive-by-default requirement: if the browser is not
      // visible (headless), or is running in background/bypass mode (no
      // interactive desktop at all), we cannot let the user solve a
      // captcha/login/consent gate — fail fast and tell the caller to retry
      // interactively rather than silently hanging.
      if (headless || background) {
        const reason = background
          ? 'the browser is running in background mode (no interactive desktop)'
          : 'the browser is headless';
        return {
          success: false, url, browser, headless,
          error: `Obstacle detected ("${profile.description}") but ${reason} — retry with headless:false and background:false so the user can resolve it interactively.`,
          obstacle: { id: profile.id, description: profile.description, waitedMs: 0, cleared: false },
        };
      }

      // Re-focus the window right as the obstacle is discovered — this is the
      // moment the user actually needs to notice and act, not just at launch.
      await bringBrowserToFront(helperRegistry, target, timeoutMs);

      const waited = await waitForObstacleToClear(helperRegistry, target, script, profile, timeoutMs, background);
      if (waited.html !== null) {
        html = waited.html;
      }
      const obstacle: ObstacleInfo = {
        id: profile.id, description: profile.description,
        waitedMs: waited.waitedMs, cleared: waited.cleared,
      };
      if (!waited.cleared) {
        return {
          success: false, url, browser, headless,
          error: `Obstacle "${profile.description}" was not resolved within ${profile.waitForUserMaxMs ?? 300000}ms.`,
          obstacle,
        };
      }
      return { success: true, url, browser, headless, html: html as string, length: (html as string).length, obstacle };
    }
  }

  return { success: true, url, browser, headless, html, length: html.length };
}

/**
 * Brings the browser window to the foreground via BrowserWin's existing
 * FOCUS command, so the interactive-by-default window is actually visible
 * to the user instead of opening silently behind other apps (Windows'
 * foreground-lock/focus-steal prevention otherwise leaves a freshly spawned
 * window in the background). Best-effort: a failure here (e.g. no window
 * found yet, or Session 0 with no interactive desktop) is logged but never
 * fails the overall render.
 */
async function bringBrowserToFront(
  helperRegistry: HelperRegistry,
  browser: string,
  timeoutMs: number,
): Promise<void> {
  try {
    await helperRegistry.callCommand('BrowserWin.exe', browser, 'FOCUS', '', '', timeoutMs);
  } catch {
    // Non-fatal — window activation is a best-effort courtesy, not required for the render itself.
  }
}

/**
 * Polls the visible browser window (re-running the same extraction script)
 * until the matched obstacle profile no longer detects on the page, or the
 * profile's wait timeout elapses. Gives the user time to solve a captcha,
 * log in, or dismiss a consent gate in the interactive window.
 */
async function waitForObstacleToClear(
  helperRegistry: HelperRegistry,
  browser: string,
  script: string,
  profile: ObstacleProfile,
  timeoutMs: number,
  background: boolean = false,
): Promise<{ cleared: boolean; waitedMs: number; html: string | null }> {
  const maxWaitMs = profile.waitForUserMaxMs ?? 300000;
  const pollIntervalMs = profile.pollIntervalMs ?? 2000;
  const start = Date.now();
  let lastHtml: string | null = null;

  while (Date.now() - start < maxWaitMs) {
    await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
    const pollResult = await helperRegistry.callCommand(
      'BrowserWin.exe', browser, 'EXEC', '', script, timeoutMs, '', '', false, background,
    );
    if (pollResult?.success === false) continue;
    const polledHtml: string | null = pollResult?.result ?? null;
    if (polledHtml === null) continue;
    lastHtml = polledHtml;
    if (!detectObstacle(polledHtml, [profile])) {
      return { cleared: true, waitedMs: Date.now() - start, html: polledHtml };
    }
  }
  return { cleared: false, waitedMs: Date.now() - start, html: lastHtml };
}
