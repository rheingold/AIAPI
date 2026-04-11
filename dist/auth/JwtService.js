"use strict";
/**
 * auth/JwtService.ts
 *
 * Thin wrapper around JSON Web Tokens for session persistence.
 *
 * Falls back to a manual HS256 implementation when the `jsonwebtoken` package
 * is not installed, so the server starts without additional npm installs.
 * For production use, install: npm install jsonwebtoken @types/jsonwebtoken
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
exports.JwtService = void 0;
const crypto = __importStar(require("crypto"));
const Logger_1 = require("../utils/Logger");
const TAG = 'JwtService';
class JwtService {
    constructor(cfg) {
        this.cfg = cfg;
    }
    sign(payload) {
        const now = Math.floor(Date.now() / 1000);
        const full = {
            ...payload,
            iat: now,
            exp: now + this.cfg.expiryMinutes * 60,
        };
        return this.manualSign(full);
    }
    verify(token) {
        try {
            return this.manualVerify(token);
        }
        catch (err) {
            Logger_1.globalLogger.debug(TAG, `JWT verify failed: ${err.message}`);
            return null;
        }
    }
    toAuthContext(payload, authMode) {
        return {
            authenticated: true,
            effectiveRoles: [...payload.roles, ...payload.externalGroups],
            authMode,
            jwtToken: this.sign(payload),
        };
    }
    // ─── Manual HS256 implementation ────────────────────────────────────────
    manualSign(payload) {
        const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
        const body = b64url(JSON.stringify(payload));
        const sig = this.hmac(`${header}.${body}`);
        return `${header}.${body}.${sig}`;
    }
    manualVerify(token) {
        const parts = token.split('.');
        if (parts.length !== 3)
            throw new Error('Malformed JWT');
        const [header, body, sig] = parts;
        const expected = this.hmac(`${header}.${body}`);
        if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
            throw new Error('Signature mismatch');
        }
        const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
        const now = Math.floor(Date.now() / 1000);
        if (payload.exp < now)
            throw new Error('Token expired');
        return payload;
    }
    hmac(data) {
        return crypto.createHmac('sha256', this.cfg.secret).update(data).digest('base64url');
    }
}
exports.JwtService = JwtService;
function b64url(s) {
    return Buffer.from(s).toString('base64url');
}
//# sourceMappingURL=JwtService.js.map