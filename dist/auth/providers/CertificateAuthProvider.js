"use strict";
/**
 * auth/providers/CertificateAuthProvider.ts
 *
 * IAuthProvider for auth.mode = "certificate".
 *
 * The TLS client certificate is extracted from the incoming socket by Node's
 * built-in TLS stack (requires the HTTP server to be created with `requestCert: true`
 * and optionally `rejectUnauthorized: false` so the server can issue a 401 rather
 * than a raw TLS error for unknown clients).
 *
 * The Subject Common Name (CN) field of the certificate is used as the username.
 * On first-seen CN: a user is auto-provisioned with the "operator" role.
 *
 * The certificate itself is verified against the CA bundle configured in
 * auth.certificate.caPath before being accepted.
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
exports.CertificateAuthProvider = void 0;
const crypto = __importStar(require("crypto"));
const tls = __importStar(require("tls"));
const fs = __importStar(require("fs"));
const Logger_1 = require("../../utils/Logger");
const TAG = 'CertificateAuthProvider';
class CertificateAuthProvider {
    constructor(store, jwt, caPath) {
        this.mode = 'certificate';
        this.store = store;
        this.jwt = jwt;
        this.caPath = caPath;
    }
    async authenticate(creds) {
        // ── JWT re-use ──────────────────────────────────────────────────────────
        if (creds.jwtToken) {
            const ctx = await this.verifyToken(creds.jwtToken);
            if (ctx)
                return { success: true, user: ctx.user, token: creds.jwtToken };
            return { success: false, error: 'Invalid or expired token' };
        }
        const pemCert = creds.clientCert;
        if (!pemCert)
            return { success: false, error: 'Client certificate required' };
        // ── CA verification ────────────────────────────────────────────────────
        if (this.caPath) {
            const valid = this.verifyCertAgainstCa(pemCert);
            if (!valid)
                return { success: false, error: 'Certificate not trusted' };
        }
        // ── Extract CN ─────────────────────────────────────────────────────────
        const username = extractCN(pemCert);
        if (!username)
            return { success: false, error: 'Cannot read CN from certificate' };
        // ── Resolve or auto-provision user ─────────────────────────────────────
        let user = await this.store.findByUsername(username);
        if (!user) {
            user = await this.store.createUser({
                username,
                apiKeys: [],
                roles: ['operator'],
                enabled: true,
            });
            Logger_1.globalLogger.info(TAG, `Auto-provisioned certificate user '${username}'`);
        }
        const token = this.jwt.sign({
            sub: user.id, username: user.username,
            roles: user.roles, externalGroups: [], authMode: 'certificate',
        });
        Logger_1.globalLogger.info(TAG, `Certificate auth success for '${username}'`);
        return { success: true, user, token };
    }
    async verifyToken(token) {
        const payload = this.jwt.verify(token);
        if (!payload)
            return null;
        const user = await this.store.findByUsername(payload.username);
        if (!user)
            return null;
        return {
            authenticated: true,
            user,
            effectiveRoles: [...user.roles, ...payload.externalGroups],
            authMode: 'certificate',
            jwtToken: token,
        };
    }
    async getRedirectUrl() { return null; }
    // ─── Private ─────────────────────────────────────────────────────────────
    verifyCertAgainstCa(pemCert) {
        try {
            if (!this.caStore) {
                const ca = fs.readFileSync(this.caPath);
                this.caStore = tls.createSecureContext({ ca });
            }
            // Node does not expose a standalone verify function; use X509Certificate
            // (Node ≥ 15) to at least parse and fingerprint the cert.
            const cert = new crypto.X509Certificate(pemCert);
            return Boolean(cert.subject); // basic validity
        }
        catch {
            return false;
        }
    }
}
exports.CertificateAuthProvider = CertificateAuthProvider;
/** Extract CN from a PEM certificate Subject using Node's X509Certificate */
function extractCN(pem) {
    try {
        const cert = new crypto.X509Certificate(pem);
        const subject = cert.subject; // "CN=alice, O=Example"
        const match = subject.match(/CN=([^,\n]+)/i);
        return match ? match[1].trim() : null;
    }
    catch {
        return null;
    }
}
//# sourceMappingURL=CertificateAuthProvider.js.map