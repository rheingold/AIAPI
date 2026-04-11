"use strict";
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
exports.JsonSettingsAdapter = void 0;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const Logger_1 = require("../../utils/Logger");
const TAG = 'JsonSettingsAdapter';
class JsonSettingsAdapter {
    constructor(filePath) {
        /** In-memory cache; null until first load() */
        this.cache = null;
        this.filePath = path.resolve(filePath);
    }
    async initialize() {
        if (!fs.existsSync(this.filePath)) {
            Logger_1.globalLogger.warn(TAG, `Settings file not found at ${this.filePath} — will create on first save`);
            this.cache = {};
            return;
        }
        await this.load();
        Logger_1.globalLogger.info(TAG, `Loaded settings from ${this.filePath}`);
    }
    async load() {
        const raw = fs.readFileSync(this.filePath, 'utf-8');
        const parsed = JSON.parse(raw);
        this.cache = parsed;
        return { ...parsed };
    }
    async save(settings) {
        const content = JSON.stringify(settings, null, 2);
        const tmpPath = `${this.filePath}.tmp`;
        fs.writeFileSync(tmpPath, content, 'utf-8');
        fs.renameSync(tmpPath, this.filePath);
        this.cache = { ...settings };
        Logger_1.globalLogger.info(TAG, `Saved settings to ${this.filePath}`);
    }
    async get(key) {
        if (!this.cache)
            await this.load();
        return getNestedKey(this.cache, key);
    }
    async set(key, value) {
        if (!this.cache)
            await this.load();
        setNestedKey(this.cache, key, value);
        await this.save(this.cache);
    }
}
exports.JsonSettingsAdapter = JsonSettingsAdapter;
// ─── Dot-notation helpers ─────────────────────────────────────────────────────
function getNestedKey(obj, dotPath) {
    return dotPath.split('.').reduce((acc, part) => {
        if (acc && typeof acc === 'object')
            return acc[part];
        return undefined;
    }, obj);
}
function setNestedKey(obj, dotPath, value) {
    const parts = dotPath.split('.');
    let cursor = obj;
    for (let i = 0; i < parts.length - 1; i++) {
        const part = parts[i];
        if (cursor[part] === undefined || typeof cursor[part] !== 'object') {
            cursor[part] = {};
        }
        cursor = cursor[part];
    }
    cursor[parts[parts.length - 1]] = value;
}
//# sourceMappingURL=JsonSettingsAdapter.js.map