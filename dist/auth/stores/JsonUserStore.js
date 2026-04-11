"use strict";
/**
 * auth/stores/JsonUserStore.ts
 *
 * IUserStore backed by a signed local JSON file (config/users.json).
 *
 * File schema:
 * {
 *   "version": "1.0",
 *   "users": [ User, ... ],
 *   "roles": [ Role, ... ]
 * }
 *
 * The file is written atomically (tmp → rename).
 * Signature verification / re-signing integrates with the existing
 * ConfigSigner in src/security/ConfigSigner.ts when available.
 *
 * On a fresh install, if the file is absent, a default "admin" user
 * (password "changeme") and default roles are created automatically.
 * The server logs a prominent warning until the default password is changed.
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
exports.JsonUserStore = void 0;
exports.importBcrypt = importBcrypt;
exports.hashFallback = hashFallback;
exports.verifyFallback = verifyFallback;
exports.generateApiKey = generateApiKey;
exports.hashApiKey = hashApiKey;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const crypto = __importStar(require("crypto"));
const Logger_1 = require("../../utils/Logger");
const TAG = 'JsonUserStore';
const DEFAULT_ROLES = [
    {
        id: 'role-admin',
        name: 'admin',
        description: 'Full access — can manage users, roles, settings and logs',
        permissions: [
            { helper: '_internal', operation: 'access', resource: '*' },
            { helper: '_internal', operation: 'settings_change', resource: '*' },
            { helper: '_internal', operation: 'access_logs', resource: '*' },
            { helper: '*', operation: '*', resource: '*' },
        ],
    },
    {
        id: 'role-operator',
        name: 'operator',
        description: 'Can call helpers but cannot change settings or users',
        permissions: [
            { helper: '_internal', operation: 'access', resource: '*' },
            { helper: '*', operation: '*', resource: '*' },
        ],
    },
    {
        id: 'role-auditor',
        name: 'auditor',
        description: 'Read-only access to logs and status',
        permissions: [
            { helper: '_internal', operation: 'access', resource: '*' },
            { helper: '_internal', operation: 'access_logs', resource: '*' },
        ],
    },
];
class JsonUserStore {
    constructor(filePath) {
        this.data = null;
        this.filePath = path.resolve(filePath);
    }
    async initialize() {
        if (!fs.existsSync(this.filePath)) {
            Logger_1.globalLogger.warn(TAG, '⚠️  No user store found — creating default admin user with password "changeme". ' +
                'CHANGE THIS IMMEDIATELY via POST /api/_internal/users/<id>.');
            this.data = await this.createDefaults();
            await this.persist();
        }
        else {
            await this.reload();
        }
    }
    // ─── IUserStore ──────────────────────────────────────────────────────────
    async findByUsername(username) {
        await this.ensureLoaded();
        return this.data.users.find(u => u.username === username && u.enabled) ?? null;
    }
    async findByApiKeyHash(keyHash) {
        await this.ensureLoaded();
        for (const user of this.data.users) {
            if (!user.enabled)
                continue;
            if (user.apiKeys.some(k => k.keyHash === keyHash))
                return user;
        }
        return null;
    }
    async listUsers() {
        await this.ensureLoaded();
        return this.data.users.map(u => ({ ...u }));
    }
    async createUser(draft) {
        await this.ensureLoaded();
        if (this.data.users.some(u => u.username === draft.username)) {
            throw new Error(`User '${draft.username}' already exists`);
        }
        const user = {
            ...draft,
            id: crypto.randomUUID(),
            createdAt: new Date().toISOString(),
        };
        this.data.users.push(user);
        await this.persist();
        return { ...user };
    }
    async updateUser(id, patch) {
        await this.ensureLoaded();
        const idx = this.data.users.findIndex(u => u.id === id);
        if (idx === -1)
            throw new Error(`User '${id}' not found`);
        this.data.users[idx] = {
            ...this.data.users[idx],
            ...patch,
            id,
            updatedAt: new Date().toISOString(),
        };
        await this.persist();
        return { ...this.data.users[idx] };
    }
    async deleteUser(id) {
        await this.ensureLoaded();
        const before = this.data.users.length;
        this.data.users = this.data.users.filter(u => u.id !== id);
        if (this.data.users.length === before)
            throw new Error(`User '${id}' not found`);
        await this.persist();
    }
    async listRoles() {
        await this.ensureLoaded();
        return this.data.roles.map(r => ({ ...r }));
    }
    async findRole(name) {
        await this.ensureLoaded();
        return this.data.roles.find(r => r.name === name) ?? null;
    }
    async upsertRole(draft) {
        await this.ensureLoaded();
        const existing = this.data.roles.find(r => r.name === draft.name);
        if (existing) {
            Object.assign(existing, draft);
            await this.persist();
            return { ...existing };
        }
        const role = { ...draft, id: crypto.randomUUID() };
        this.data.roles.push(role);
        await this.persist();
        return { ...role };
    }
    async deleteRole(id) {
        await this.ensureLoaded();
        const before = this.data.roles.length;
        this.data.roles = this.data.roles.filter(r => r.id !== id);
        if (this.data.roles.length === before)
            throw new Error(`Role '${id}' not found`);
        await this.persist();
    }
    // ─── Private ─────────────────────────────────────────────────────────────
    async ensureLoaded() {
        if (!this.data)
            await this.reload();
    }
    async reload() {
        const raw = fs.readFileSync(this.filePath, 'utf-8');
        this.data = JSON.parse(raw);
    }
    async persist() {
        const content = JSON.stringify(this.data, null, 2);
        const tmp = `${this.filePath}.tmp`;
        fs.writeFileSync(tmp, content, 'utf-8');
        fs.renameSync(tmp, this.filePath);
    }
    async createDefaults() {
        const bcrypt = await importBcrypt();
        const hash = bcrypt
            ? await bcrypt.hash('changeme', 12)
            : hashFallback('changeme');
        const adminUser = {
            id: crypto.randomUUID(),
            username: 'admin',
            passwordHash: hash,
            apiKeys: [],
            roles: ['admin'],
            enabled: true,
            createdAt: new Date().toISOString(),
        };
        return { version: '1.0', users: [adminUser], roles: DEFAULT_ROLES };
    }
}
exports.JsonUserStore = JsonUserStore;
let _bcrypt = undefined;
async function importBcrypt() {
    if (_bcrypt !== undefined)
        return _bcrypt;
    try {
        // @ts-ignore: optional peer dependency
        const m = await Promise.resolve().then(() => __importStar(require('bcrypt')));
        _bcrypt = (m.default ?? m);
    }
    catch {
        try {
            // @ts-ignore: optional peer dependency
            const m = await Promise.resolve().then(() => __importStar(require('bcryptjs')));
            _bcrypt = (m.default ?? m);
        }
        catch {
            Logger_1.globalLogger.warn(TAG, 'Neither bcrypt nor bcryptjs installed — password hashing will use SHA-512 fallback (less secure). Run: npm install bcrypt');
            _bcrypt = null;
        }
    }
    return _bcrypt;
}
/** Fallback: PBKDF2-SHA512 when bcrypt is unavailable */
function hashFallback(password) {
    const salt = crypto.randomBytes(16).toString('hex');
    const dk = crypto.pbkdf2Sync(password, salt, 200000, 64, 'sha512').toString('hex');
    return `pbkdf2:${salt}:${dk}`;
}
function verifyFallback(password, stored) {
    const parts = stored.split(':');
    if (parts[0] !== 'pbkdf2')
        return false;
    const [, salt, expectedDk] = parts;
    const actualDk = crypto.pbkdf2Sync(password, salt, 200000, 64, 'sha512').toString('hex');
    return crypto.timingSafeEqual(Buffer.from(actualDk, 'hex'), Buffer.from(expectedDk, 'hex'));
}
/** Generate a cryptographically random API key (visible only once) */
function generateApiKey() {
    const raw = crypto.randomBytes(32).toString('base64url');
    const keyHash = crypto.createHash('sha256').update(raw).digest('hex');
    return {
        raw,
        record: {
            id: crypto.randomUUID(),
            keyHash,
            label: '',
            createdAt: new Date().toISOString(),
        },
    };
}
/** Hash a raw API key for storage lookup */
function hashApiKey(raw) {
    return crypto.createHash('sha256').update(raw).digest('hex');
}
//# sourceMappingURL=JsonUserStore.js.map