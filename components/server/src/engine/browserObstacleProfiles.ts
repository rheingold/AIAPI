/**
 * browserObstacleProfiles.ts
 *
 * Data-driven rule engine for detecting "obstacle" pages during
 * FETCH_WEBPAGE_RENDER (captchas, bot-check interstitials, login walls,
 * consent gates, etc.). Profiles are NOT hardcoded — they are loaded from
 * config/browser-obstacles.json, a plain data file the user can freely
 * add to / edit / disable without touching code.
 *
 * See CONVENTIONS.md §5.7 for the documented config file + profile schema.
 */

import * as fs from 'fs';
import * as path from 'path';

export interface ObstacleProfile {
  id: string;
  description: string;
  /** Regex (as a string) tested against the rendered document HTML. Case-insensitive. */
  htmlRegex: string;
  /** Whether resolving this obstacle requires a visible/interactive browser window. Default: true. */
  requiresVisible?: boolean;
  /** Max time (ms) to wait for the user to clear the obstacle before giving up. Default: 300000 (5 min). */
  waitForUserMaxMs?: number;
  /** Poll interval (ms) while waiting for the obstacle to clear. Default: 2000. */
  pollIntervalMs?: number;
  /** Set to false to disable this profile without deleting it. Default: true. */
  enabled?: boolean;
}

interface ObstacleConfigFile {
  profiles?: ObstacleProfile[];
}

let cachedProfiles: ObstacleProfile[] | null = null;
let cachedMtimeMs: number | null = null;

function resolveConfigPath(): string {
  const isPkg = typeof (process as any).pkg !== 'undefined';
  const base = isPkg ? path.dirname(process.execPath) : path.resolve(__dirname, '..', '..');
  return path.resolve(base, 'config', 'browser-obstacles.json');
}

/**
 * Load obstacle profiles from config/browser-obstacles.json, with a small
 * in-memory cache invalidated on file mtime change (so the file can be
 * edited live without restarting the server).
 */
export function loadObstacleProfiles(): ObstacleProfile[] {
  const configPath = resolveConfigPath();
  try {
    const stat = fs.statSync(configPath);
    if (cachedProfiles && cachedMtimeMs === stat.mtimeMs) {
      return cachedProfiles;
    }
    const raw = fs.readFileSync(configPath, 'utf8');
    const parsed: ObstacleConfigFile = JSON.parse(raw);
    cachedProfiles = (parsed.profiles ?? []).filter(p => p.enabled !== false);
    cachedMtimeMs = stat.mtimeMs;
    return cachedProfiles;
  } catch {
    // Missing/unreadable/invalid config file — no obstacle detection, not a fatal error.
    return [];
  }
}

/**
 * Test `html` against all enabled obstacle profiles; returns the first
 * matching profile, or null if none match.
 */
export function detectObstacle(html: string, profiles?: ObstacleProfile[]): ObstacleProfile | null {
  if (!html) return null;
  const list = profiles ?? loadObstacleProfiles();
  for (const profile of list) {
    try {
      const re = new RegExp(profile.htmlRegex, 'i');
      if (re.test(html)) {
        return profile;
      }
    } catch {
      // Malformed regex in a user-edited profile — skip it, don't crash the render.
      continue;
    }
  }
  return null;
}
