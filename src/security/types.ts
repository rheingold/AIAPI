/**
 * Security configuration types
 */

export interface SecurityPolicy {
    defaultAction: 'ALLOW_ALL' | 'DENY_UNLISTED';
    requireTargetSignature?: boolean;
    requireTargetSignatureDevelopment?: boolean;
    requireOSEnforcement?: boolean;
    expectedCertThumbprint?: string | null;
    allowedProcesses: ProcessRule[];
    deniedProcesses: ProcessRule[];
}

export interface ProcessRule {
    name?: string;
    path?: string;
    hash?: string;
    requiredSigner?: string;
    pattern?: string;
}

export interface DevelopmentMode {
    enabled: boolean;
    autoEnableWhen?: string;
    autoDisableAfter?: string;
    requireBuildProvenance?: boolean;
    requireApprovalForNewBinaries?: boolean;
    approvalValidFor?: string;
    maxFileAge?: string;
    allowedPaths?: string[];
    excludePatterns?: string[];
    auditLog?: string;
    mustBeChildOfVSCodeWorkspace?: boolean;
}

export interface SecurityConfig {
    version: string;
    securityPolicy: SecurityPolicy;
    developmentMode?: DevelopmentMode;
}

export interface ProcessCheckResult {
    allowed: boolean;
    reason: string;
    rule?: ProcessRule;
}
