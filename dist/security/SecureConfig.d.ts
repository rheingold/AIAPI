import { SecurityConfig, ProcessCheckResult } from './types';
export declare class SecureConfig {
    private config;
    private configPath;
    private signatureVerifier;
    constructor(configPath?: string);
    private loadConfig;
    private validateConfig;
    private getDefaultConfig;
    /**
     * Check if a process is allowed to be automated
     */
    checkProcess(processName: string, processPath?: string): ProcessCheckResult;
    private checkDevelopmentAllowedPaths;
    private checkDenyList;
    private checkAllowList;
    private matchesRule;
    private pathsMatch;
    /**
     * Validate path for security (prevent traversal attacks)
     */
    validatePath(targetPath: string): boolean;
    /**
     * Get current configuration
     */
    getConfig(): SecurityConfig;
    /**
     * Check if development mode is enabled
     */
    isDevelopmentMode(): boolean;
    /**
     * Check if signature verification is required
     */
    requiresSignature(): boolean;
    /**
     * Verify process signature (async version of checkProcess)
     * @param processName Process name (e.g. "calc.exe")
     * @param processPath Full path to the executable
     * @returns ProcessCheckResult with signature validation
     */
    checkProcessWithSignature(processName: string, processPath?: string): Promise<ProcessCheckResult>;
}
//# sourceMappingURL=SecureConfig.d.ts.map