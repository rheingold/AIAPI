"use strict";
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
exports.SecureConfig = void 0;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const SignatureVerifier_1 = require("./SignatureVerifier");
class SecureConfig {
    constructor(configPath) {
        this.configPath = configPath || path.join(__dirname, '..', '..', 'security', 'config.json');
        this.config = this.loadConfig();
        this.signatureVerifier = new SignatureVerifier_1.SignatureVerifier();
    }
    loadConfig() {
        try {
            if (!fs.existsSync(this.configPath)) {
                console.warn(`Security config not found at ${this.configPath}, using defaults`);
                return this.getDefaultConfig();
            }
            const content = fs.readFileSync(this.configPath, 'utf-8');
            const config = JSON.parse(content);
            // Validate config
            this.validateConfig(config);
            return config;
        }
        catch (error) {
            console.error(`Failed to load security config: ${error}`);
            console.warn('Falling back to default security config');
            return this.getDefaultConfig();
        }
    }
    validateConfig(config) {
        if (!config.version) {
            throw new Error('Security config missing version');
        }
        if (!config.securityPolicy) {
            throw new Error('Security config missing securityPolicy');
        }
        if (!config.securityPolicy.defaultAction) {
            throw new Error('Security policy missing defaultAction');
        }
    }
    getDefaultConfig() {
        return {
            version: '1.0.0',
            securityPolicy: {
                defaultAction: 'DENY_UNLISTED',
                requireTargetSignature: false,
                allowedProcesses: [
                    {
                        name: 'calc.exe',
                        path: 'C:\\Windows\\System32\\calc.exe',
                        requiredSigner: 'CN=Microsoft Corporation'
                    },
                    {
                        name: 'notepad.exe',
                        path: 'C:\\Windows\\System32\\notepad.exe',
                        requiredSigner: 'CN=Microsoft Corporation'
                    }
                ],
                deniedProcesses: [
                    { name: 'cmd.exe' },
                    { name: 'powershell.exe' },
                    { name: 'regedit.exe' },
                    { pattern: '.*\\.ps1$' }
                ]
            },
            developmentMode: {
                enabled: true, // Enabled by default for development
                autoEnableWhen: 'VS Code workspace detected',
                autoDisableAfter: '2 hours inactive',
                requireApprovalForNewBinaries: false,
                maxFileAge: '1 hour',
                allowedPaths: [
                    '${WORKSPACE}/dist/**/*.exe',
                    '${WORKSPACE}/build/**/*.exe'
                ],
                excludePatterns: [
                    '**/node_modules/**',
                    '**/temp/**',
                    '**/.git/**'
                ],
                mustBeChildOfVSCodeWorkspace: true,
                auditLog: 'security/dev-approvals.log'
            }
        };
    }
    /**
     * Check if a process is allowed to be automated
     */
    checkProcess(processName, processPath) {
        // Development mode check first - but only for excluded patterns (deny)
        if (this.config.developmentMode?.enabled && processPath) {
            // Check excluded patterns in dev mode
            if (this.config.developmentMode.excludePatterns) {
                const normalizedPath = processPath.toLowerCase().replace(/\//g, '\\');
                for (const pattern of this.config.developmentMode.excludePatterns) {
                    // Simple contains check for ** patterns
                    if (pattern.includes('**')) {
                        const part = pattern.replace('**/', '').replace('/**', '').replace(/\*/g, '');
                        if (normalizedPath.includes(part.toLowerCase())) {
                            return {
                                allowed: false,
                                reason: `Path matches excluded pattern: ${pattern}`
                            };
                        }
                    }
                }
            }
        }
        // Check deny list
        const denyResult = this.checkDenyList(processName, processPath);
        if (!denyResult.allowed) {
            return denyResult;
        }
        // Development mode check for allowed paths
        if (this.config.developmentMode?.enabled && processPath) {
            const devAllow = this.checkDevelopmentAllowedPaths(processPath);
            if (devAllow) {
                return devAllow;
            }
        }
        // Check allow list
        const allowResult = this.checkAllowList(processName, processPath);
        if (allowResult.allowed) {
            return allowResult;
        }
        // Default action
        if (this.config.securityPolicy.defaultAction === 'ALLOW_ALL') {
            return {
                allowed: true,
                reason: 'Default action: ALLOW_ALL'
            };
        }
        else {
            return {
                allowed: false,
                reason: 'Process not in whitelist and default action is DENY_UNLISTED'
            };
        }
    }
    checkDevelopmentAllowedPaths(processPath) {
        if (!this.config.developmentMode?.allowedPaths) {
            return null;
        }
        const workspace = process.env.WORKSPACE || process.cwd();
        const normalizedPath = processPath.toLowerCase().replace(/\//g, '\\');
        for (const allowedPath of this.config.developmentMode.allowedPaths) {
            let expandedPath = allowedPath.replace('${WORKSPACE}', workspace).replace(/\//g, '\\');
            // Convert glob pattern to simple prefix check
            // ${WORKSPACE}/dist/**/*.exe → Check if starts with ${WORKSPACE}\dist\ and ends with .exe
            if (expandedPath.includes('**')) {
                const parts = expandedPath.split('**');
                const prefix = parts[0].toLowerCase();
                // For suffix, remove leading slash/backslash and wildcards
                let suffix = parts[parts.length - 1].toLowerCase();
                suffix = suffix.replace(/^[\\\/]+/, '').replace(/\*/g, '');
                // Path must start with prefix and end with suffix (if suffix exists)
                if (normalizedPath.startsWith(prefix)) {
                    if (suffix && normalizedPath.endsWith(suffix)) {
                        return {
                            allowed: true,
                            reason: `Development mode: Path in allowed list (${allowedPath})`
                        };
                    }
                    else if (!suffix) {
                        return {
                            allowed: true,
                            reason: `Development mode: Path in allowed list (${allowedPath})`
                        };
                    }
                }
            }
            else if (expandedPath.includes('*')) {
                // Simple wildcard - just check directory match
                const prefix = expandedPath.substring(0, expandedPath.indexOf('*')).toLowerCase();
                if (normalizedPath.startsWith(prefix)) {
                    return {
                        allowed: true,
                        reason: `Development mode: Path in allowed list (${allowedPath})`
                    };
                }
            }
            else {
                // Exact match
                if (normalizedPath === expandedPath.toLowerCase()) {
                    return {
                        allowed: true,
                        reason: `Development mode: Path in allowed list (${allowedPath})`
                    };
                }
            }
        }
        return null;
    }
    checkDenyList(processName, processPath) {
        for (const rule of this.config.securityPolicy.deniedProcesses) {
            if (this.matchesRule(processName, processPath, rule)) {
                return {
                    allowed: false,
                    reason: `Process explicitly denied`,
                    rule
                };
            }
        }
        return { allowed: true, reason: 'Not in deny list' };
    }
    checkAllowList(processName, processPath) {
        for (const rule of this.config.securityPolicy.allowedProcesses) {
            if (this.matchesRule(processName, processPath, rule)) {
                return {
                    allowed: true,
                    reason: `Process in whitelist`,
                    rule
                };
            }
        }
        return { allowed: false, reason: 'Not in whitelist' };
    }
    matchesRule(processName, processPath, rule) {
        // Check name match
        if (rule.name && processName.toLowerCase() === rule.name.toLowerCase()) {
            return true;
        }
        // Check path match
        if (rule.path && processPath && this.pathsMatch(processPath, rule.path)) {
            return true;
        }
        // Check pattern match
        if (rule.pattern) {
            const regex = new RegExp(rule.pattern, 'i');
            if (regex.test(processName) || (processPath && regex.test(processPath))) {
                return true;
            }
        }
        return false;
    }
    pathsMatch(path1, path2) {
        // Normalize paths for comparison
        const normalize = (p) => p.toLowerCase().replace(/\//g, '\\');
        return normalize(path1) === normalize(path2);
    }
    /**
     * Validate path for security (prevent traversal attacks)
     */
    validatePath(targetPath) {
        // Prevent path traversal
        if (targetPath.includes('..')) {
            return false;
        }
        // Prevent UNC paths (unless explicitly allowed)
        if (targetPath.startsWith('\\\\')) {
            return false;
        }
        // Prevent relative paths
        if (!path.isAbsolute(targetPath)) {
            return false;
        }
        return true;
    }
    /**
     * Get current configuration
     */
    getConfig() {
        return this.config;
    }
    /**
     * Check if development mode is enabled
     */
    isDevelopmentMode() {
        return this.config.developmentMode?.enabled ?? false;
    }
    /**
     * Check if signature verification is required
     */
    requiresSignature() {
        // In development mode, signature can be bypassed
        if (this.isDevelopmentMode() &&
            this.config.securityPolicy.requireTargetSignatureDevelopment === false) {
            return false;
        }
        return this.config.securityPolicy.requireTargetSignature ?? false;
    }
    /**
     * Verify process signature (async version of checkProcess)
     * @param processName Process name (e.g. "calc.exe")
     * @param processPath Full path to the executable
     * @returns ProcessCheckResult with signature validation
     */
    async checkProcessWithSignature(processName, processPath) {
        // First do the basic allow/deny check
        const basicCheck = this.checkProcess(processName, processPath);
        // If not allowed, return immediately
        if (!basicCheck.allowed) {
            return basicCheck;
        }
        // If signature verification is not required, return the basic check result
        if (!this.requiresSignature()) {
            return basicCheck;
        }
        // Signature verification required
        if (!processPath) {
            return {
                allowed: false,
                reason: 'Signature verification required but no path provided'
            };
        }
        try {
            const sigResult = await this.signatureVerifier.verifySignature(processPath);
            if (!sigResult.isValid) {
                return {
                    allowed: false,
                    reason: `Signature verification failed: ${sigResult.error || 'Invalid or missing signature'}`
                };
            }
            // Check if required signer matches (if specified in rule)
            if (basicCheck.rule?.requiredSigner) {
                const signerMatches = sigResult.signer?.includes(basicCheck.rule.requiredSigner) ||
                    sigResult.issuer?.includes(basicCheck.rule.requiredSigner);
                if (!signerMatches) {
                    return {
                        allowed: false,
                        reason: `Signature signer mismatch. Expected: ${basicCheck.rule.requiredSigner}, Got: ${sigResult.signer}`
                    };
                }
            }
            return {
                allowed: true,
                reason: `${basicCheck.reason} (Signature verified: ${sigResult.signer})`,
                rule: basicCheck.rule
            };
        }
        catch (error) {
            return {
                allowed: false,
                reason: `Signature verification error: ${error instanceof Error ? error.message : String(error)}`
            };
        }
    }
}
exports.SecureConfig = SecureConfig;
//# sourceMappingURL=SecureConfig.js.map