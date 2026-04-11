"use strict";
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
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.SettingsManager = void 0;
const path = __importStar(require("path"));
const JsonSettingsAdapter_1 = require("./adapters/JsonSettingsAdapter");
const DbSettingsAdapter_1 = require("./adapters/DbSettingsAdapter");
const Logger_1 = require("../utils/Logger");
const TAG = 'SettingsManager';
class SettingsManager {
    constructor(bootstrapAdapter, activeAdapter) {
        this.bootstrapAdapter = bootstrapAdapter;
        this.adapter = activeAdapter;
    }
    /**
     * Create and initialise a SettingsManager.
     *
     * @param jsonFilePath  Path to the local dashboard-settings.json (bootstrap config).
     */
    static async create(jsonFilePath) {
        const resolved = path.resolve(jsonFilePath ?? './config/dashboard-settings.json');
        const bootstrap = new JsonSettingsAdapter_1.JsonSettingsAdapter(resolved);
        await bootstrap.initialize();
        const src = (await bootstrap.get('settingsSource')) ?? 'json';
        if (src === 'db') {
            const dbCfg = await bootstrap.get('db');
            if (!dbCfg) {
                Logger_1.globalLogger.warn(TAG, 'settingsSource = "db" but no db.* configuration found — falling back to JSON');
                return new SettingsManager(bootstrap, bootstrap);
            }
            try {
                const dbAdapter = new DbSettingsAdapter_1.DbSettingsAdapter(dbCfg);
                await dbAdapter.initialize();
                Logger_1.globalLogger.info(TAG, `Using DB settings adapter (${dbCfg.type} @ ${dbCfg.host})`);
                return new SettingsManager(bootstrap, dbAdapter);
            }
            catch (err) {
                Logger_1.globalLogger.error(TAG, `DB settings adapter failed to initialise: ${err.message} — falling back to JSON`);
                return new SettingsManager(bootstrap, bootstrap);
            }
        }
        Logger_1.globalLogger.info(TAG, `Using JSON settings adapter (${resolved})`);
        return new SettingsManager(bootstrap, bootstrap);
    }
    // ─── Forwarding API ──────────────────────────────────────────────────────
    async load() {
        return this.adapter.load();
    }
    async save(settings) {
        return this.adapter.save(settings);
    }
    async get(key) {
        return this.adapter.get(key);
    }
    async set(key, value) {
        return this.adapter.set(key, value);
    }
    async close() {
        if (this.adapter !== this.bootstrapAdapter) {
            await this.adapter.close?.();
        }
        // We don't close the bootstrap JSON adapter — it has no pool.
    }
}
exports.SettingsManager = SettingsManager;
//# sourceMappingURL=SettingsManager.js.map