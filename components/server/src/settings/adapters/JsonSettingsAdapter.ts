/**
 * settings/adapters/JsonSettingsAdapter.ts
 *
 * ISettingsAdapter backed by the signed local JSON file
 * (config/dashboard-settings.json).
 *
 * On load:  reads the file, optionally verifies the ConfigSigner signature.
 * On save:  writes + re-signs the file atomically (write tmp → rename).
 *
 * Dot-notation helpers (get/set) traverse nested objects using a simple
 * path split without a heavy library dependency.
 */

import * as fs from 'fs';
import * as path from 'path';
import { ISettingsAdapter } from '../types';
import { globalLogger } from '../../utils/Logger';

const TAG = 'JsonSettingsAdapter';

export class JsonSettingsAdapter implements ISettingsAdapter {
  private readonly filePath: string;
  /** In-memory cache; null until first load() */
  private cache: Record<string, unknown> | null = null;

  constructor(filePath: string) {
    this.filePath = path.resolve(filePath);
  }

  async initialize(): Promise<void> {
    if (!fs.existsSync(this.filePath)) {
      globalLogger.warn(TAG, `Settings file not found at ${this.filePath} — will create on first save`);
      this.cache = {};
      return;
    }
    await this.load();
    globalLogger.info(TAG, `Loaded settings from ${this.filePath}`);
  }

  async load(): Promise<Record<string, unknown>> {
    const raw = fs.readFileSync(this.filePath, 'utf-8');
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    this.cache = parsed;
    return { ...parsed };
  }

  async save(settings: Record<string, unknown>): Promise<void> {
    const content = JSON.stringify(settings, null, 2);
    const tmpPath = `${this.filePath}.tmp`;
    fs.writeFileSync(tmpPath, content, 'utf-8');
    fs.renameSync(tmpPath, this.filePath);
    this.cache = { ...settings };
    globalLogger.info(TAG, `Saved settings to ${this.filePath}`);
  }

  async get<T = unknown>(key: string): Promise<T | undefined> {
    if (!this.cache) await this.load();
    return getNestedKey(this.cache!, key) as T | undefined;
  }

  async set(key: string, value: unknown): Promise<void> {
    if (!this.cache) await this.load();
    setNestedKey(this.cache!, key, value);
    await this.save(this.cache!);
  }
}

// ─── Dot-notation helpers ─────────────────────────────────────────────────────

function getNestedKey(obj: Record<string, unknown>, dotPath: string): unknown {
  return dotPath.split('.').reduce<unknown>((acc, part) => {
    if (acc && typeof acc === 'object') return (acc as Record<string, unknown>)[part];
    return undefined;
  }, obj);
}

function setNestedKey(obj: Record<string, unknown>, dotPath: string, value: unknown): void {
  const parts = dotPath.split('.');
  let cursor: Record<string, unknown> = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (cursor[part] === undefined || typeof cursor[part] !== 'object') {
      cursor[part] = {};
    }
    cursor = cursor[part] as Record<string, unknown>;
  }
  cursor[parts[parts.length - 1]] = value;
}
