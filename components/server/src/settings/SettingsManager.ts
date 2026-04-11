/**
 * settings/SettingsManager.ts
 *
 * Factory and runtime wrapper for ISettingsAdapter.
 *
 * Usage:
 *   const mgr = await SettingsManager.create('./config/dashboard-settings.json');
 *   const port = await mgr.get<number>('mcpPort') ?? 3457;
 *   await mgr.set('auth.mode', 'password');
 *
 * On startup the manager reads the bootstrap JSON file to discover `settingsSource`.
 * If settingsSource = "db" it then opens the DB adapter and uses that adapter
 * for all subsequent reads/writes.  The local JSON file remains the source of the
 * DB connection config so it is always needed at startup.
 */

import * as path from 'path';
import { ISettingsAdapter, SettingsSourceConfig } from './types';
import { JsonSettingsAdapter } from './adapters/JsonSettingsAdapter';
import { DbSettingsAdapter } from './adapters/DbSettingsAdapter';
import { globalLogger } from '../utils/Logger';

const TAG = 'SettingsManager';

export class SettingsManager {
  private adapter: ISettingsAdapter;
  /** The bootstrap JSON adapter is always available for reading DB config */
  private readonly bootstrapAdapter: JsonSettingsAdapter;

  private constructor(bootstrapAdapter: JsonSettingsAdapter, activeAdapter: ISettingsAdapter) {
    this.bootstrapAdapter = bootstrapAdapter;
    this.adapter = activeAdapter;
  }

  /**
   * Create and initialise a SettingsManager.
   *
   * @param jsonFilePath  Path to the local dashboard-settings.json (bootstrap config).
   */
  static async create(jsonFilePath?: string): Promise<SettingsManager> {
    const resolved = path.resolve(
      jsonFilePath ?? './config/dashboard-settings.json',
    );

    const bootstrap = new JsonSettingsAdapter(resolved);
    await bootstrap.initialize();

    const src = (await bootstrap.get<string>('settingsSource')) ?? 'json';

    if (src === 'db') {
      const dbCfg = await bootstrap.get<SettingsSourceConfig['db']>('db');
      if (!dbCfg) {
        globalLogger.warn(TAG, 'settingsSource = "db" but no db.* configuration found — falling back to JSON');
        return new SettingsManager(bootstrap, bootstrap);
      }
      try {
        const dbAdapter = new DbSettingsAdapter(dbCfg);
        await dbAdapter.initialize();
        globalLogger.info(TAG, `Using DB settings adapter (${dbCfg.type} @ ${dbCfg.host})`);
        return new SettingsManager(bootstrap, dbAdapter);
      } catch (err) {
        globalLogger.error(TAG, `DB settings adapter failed to initialise: ${(err as Error).message} — falling back to JSON`);
        return new SettingsManager(bootstrap, bootstrap);
      }
    }

    globalLogger.info(TAG, `Using JSON settings adapter (${resolved})`);
    return new SettingsManager(bootstrap, bootstrap);
  }

  // ─── Forwarding API ──────────────────────────────────────────────────────

  async load(): Promise<Record<string, unknown>> {
    return this.adapter.load();
  }

  async save(settings: Record<string, unknown>): Promise<void> {
    return this.adapter.save(settings);
  }

  async get<T = unknown>(key: string): Promise<T | undefined> {
    return this.adapter.get<T>(key);
  }

  async set(key: string, value: unknown): Promise<void> {
    return this.adapter.set(key, value);
  }

  async close(): Promise<void> {
    if (this.adapter !== this.bootstrapAdapter) {
      await this.adapter.close?.();
    }
    // We don't close the bootstrap JSON adapter — it has no pool.
  }
}
