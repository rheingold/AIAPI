import { AutomationScenario, ScenarioResult } from './types';
import { SessionTokenManager } from '../security/SessionTokenManager';
export declare class ScenarioReplayer {
    private context;
    private sessionTokenManager?;
    private defaultDelays;
    constructor(keywinBinary: string, mcpServerUrl?: string, verbose?: boolean, sessionTokenManager?: SessionTokenManager);
    /**
     * Load scenario from JSON file
     */
    loadScenario(filePath: string): AutomationScenario;
    /**
     * Execute a complete scenario
     */
    executeScenario(scenario: AutomationScenario): Promise<ScenarioResult>;
    /**
     * Execute a single step
     */
    private executeStep;
    /**
     * Action implementations
     */
    private launchProcess;
    private findWindow;
    private sendKeys;
    private readValue;
    private queryTree;
    private click;
    private clickByName;
    private closeProcess;
    private wait;
    private setVariable;
    private logMessage;
    /**
     * Execute KeyWin.exe
     */
    executeKeyWin(keys: string, target?: string): Promise<any>;
    /**
     * Utilities
     */
    private getWaitTime;
    private applyStepDelay;
    private resolveVariables;
    private evaluateCondition;
    private runAssertions;
    private matchPattern;
    private sleep;
    private log;
}
//# sourceMappingURL=replayer.d.ts.map