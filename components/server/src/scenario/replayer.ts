import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import {
    AutomationScenario,
    ScenarioStep,
    ScenarioExecutionContext,
    StepResult,
    ScenarioResult,
    AssertionRule
} from './types';
import { SessionTokenManager } from '../security/SessionTokenManager';
import { globalLogger } from '../utils/Logger';

export class ScenarioReplayer {
    private context: ScenarioExecutionContext;
    private sessionTokenManager?: SessionTokenManager;
    private defaultDelays = {
        afterLaunch: 2000,      // Wait after launching process
        afterClick: 500,        // Wait after mouse click
        afterKeys: 300,         // Wait after keyboard input
        afterClose: 1000,       // Wait after closing process
        afterQuery: 200         // Wait after UI query
    };

    constructor(
        keywinBinary: string, 
        mcpServerUrl?: string, 
        verbose: boolean = false,
        sessionTokenManager?: SessionTokenManager
    ) {
        this.context = {
            variables: new Map<string, any>(),
            keywinBinary,
            mcpServerUrl,
            verbose
        };
        this.sessionTokenManager = sessionTokenManager;
    }

    /**
     * Load scenario from JSON file
     */
    loadScenario(filePath: string): AutomationScenario {
        const content = fs.readFileSync(filePath, 'utf-8');
        return JSON.parse(content) as AutomationScenario;
    }

    /**
     * Execute a complete scenario
     */
    async executeScenario(scenario: AutomationScenario): Promise<ScenarioResult> {
        const startTime = Date.now();
        const stepResults: StepResult[] = [];

        // Initialize variables
        for (const [key, value] of Object.entries(scenario.variables)) {
            this.context.variables.set(key, value);
        }

        this.log(`\n=== Executing Scenario: ${scenario.name} ===`);
        this.log(`Description: ${scenario.description}\n`);

        for (const step of scenario.steps) {
            const stepStartTime = Date.now();
            
            try {
                // Check condition if present
                if (step.params.condition && !this.evaluateCondition(step.params.condition)) {
                    this.log(`[Step ${step.id}] Skipped (condition not met): ${step.description}`);
                    stepResults.push({
                        stepId: step.id,
                        success: true,
                        output: 'skipped',
                        duration: Date.now() - stepStartTime
                    });
                    continue;
                }

                this.log(`[Step ${step.id}] ${step.description}`);

                const result = await this.executeStep(step);
                
                // Run assertions if present
                if (step.assert) {
                    this.runAssertions(step.assert, step.id);
                }

                // Apply explicit wait if specified
                await this.applyStepDelay(step);

                stepResults.push({
                    stepId: step.id,
                    success: true,
                    output: result,
                    duration: Date.now() - stepStartTime
                });

                this.log(`  ✓ Success (${Date.now() - stepStartTime}ms)`);

            } catch (error: any) {
                this.log(`  ✗ Failed: ${error.message}`, true);
                
                stepResults.push({
                    stepId: step.id,
                    success: false,
                    error: error.message,
                    duration: Date.now() - stepStartTime
                });

                return {
                    scenarioName: scenario.name,
                    success: false,
                    steps: stepResults,
                    duration: Date.now() - startTime,
                    failedStep: step.id
                };
            }
        }

        const duration = Date.now() - startTime;
        this.log(`\n✓✓✓ Scenario completed successfully in ${duration}ms\n`);

        return {
            scenarioName: scenario.name,
            success: true,
            steps: stepResults,
            duration
        };
    }

    /**
     * Execute a single step
     */
    private async executeStep(step: ScenarioStep): Promise<any> {
        const params = this.resolveVariables(step.params);

        switch (step.action) {
            case "launchProcess":
                return await this.launchProcess(params);
            
            case "findWindow":
                return await this.findWindow(params);
            
            case "sendKeys":
                return await this.sendKeys(params);
            
            case "readValue":
                return await this.readValue(params);
            
            case "queryTree":
                return await this.queryTree(params);
            
            case "click":
                return await this.click(params);
            
            case "clickByName":
                return await this.clickByName(params);
            
            case "closeProcess":
                return await this.closeProcess(params);
            
            case "wait":
                return await this.wait(params);
            
            case "setVariable":
                return this.setVariable(params);
            
            case "log":
                return this.logMessage(params);
            
            default:
                throw new Error(`Unknown action: ${step.action}`);
        }
    }

    /**
     * Action implementations
     */
    private async launchProcess(params: any): Promise<void> {
        const proc = spawn(params.executable, [], { detached: true, stdio: 'ignore' });
        proc.unref();
        
        // Use explicit wait or default delay
        const waitMs = this.getWaitTime(params, this.defaultDelays.afterLaunch);
        await this.sleep(waitMs);
    }

    private async findWindow(params: any): Promise<string | null> {
        // Prefer process name over title pattern (more reliable, locale-independent)
        if (params.processName) {
            // Use KeyWin.exe process name search
            // We test with {READ} to verify the window exists
            try {
                await this.executeKeyWin("{READ}", params.processName);
                
                // If successful, store the process name as the target identifier
                // KeyWin will resolve it each time via process name or title fallback
                if (params.storeAs) {
                    this.context.variables.set(params.storeAs, params.processName);
                }
                
                // Small delay to ensure window is ready
                await this.sleep(200);
                return params.processName;
            } catch (err) {
                if (!params.optional) {
                    throw new Error(`Window not found for process: ${params.processName}`);
                }
                if (params.storeAs) {
                    this.context.variables.set(params.storeAs, null);
                }
                return null;
            }
        }

        // Fall back to title pattern matching via {LISTWINDOWS}
        if (params.titlePattern) {
            const result = await this.executeKeyWin("{LISTWINDOWS}");
            const windows = result.windows;
            
            const patterns = params.titlePattern.split('|').map((p: string) => p.trim());
            
            for (const pattern of patterns) {
                const window = windows.find((w: any) => 
                    this.matchPattern(w.title, pattern)
                );
                
                if (window) {
                    const handle = `HANDLE:${window.handle}`;
                    
                    if (params.storeAs) {
                        this.context.variables.set(params.storeAs, handle);
                    }
                    
                    // Small delay to ensure window is ready
                    await this.sleep(200);
                    return handle;
                }
            }
        }

        if (params.optional) {
            if (params.storeAs) {
                this.context.variables.set(params.storeAs, null);
            }
            return null;
        }

        const searchKey = params.processName || params.titlePattern;
        throw new Error(`Window not found: ${searchKey}`);
    }

    private async sendKeys(params: any): Promise<void> {
        await this.executeKeyWin(params.keys, params.target);
        
        // Use explicit wait or default delay
        const waitMs = this.getWaitTime(params, this.defaultDelays.afterKeys);
        await this.sleep(waitMs);
    }

    private async readValue(params: any): Promise<string> {
        // Small delay before reading to ensure UI is updated
        await this.sleep(100);
        
        const result = await this.executeKeyWin("{READ}", params.target);
        const value = result.value;
        
        if (params.storeAs) {
            this.context.variables.set(params.storeAs, value);
        }
        
        return value;
    }

    private async queryTree(params: any): Promise<any> {
        const depth = params.depth || 2;
        const result = await this.executeKeyWin(`{QUERYTREE:${depth}}`, params.target);
        
        if (params.storeAs) {
            this.context.variables.set(params.storeAs, result);
        }
        
        // Small delay after querying
        await this.sleep(this.defaultDelays.afterQuery);
        return result;
    }

    private async click(params: any): Promise<void> {
        await this.executeKeyWin(`{CLICK:${params.x},${params.y}}`, params.target);
        
        // Wait for click to be processed
        await this.sleep(this.defaultDelays.afterClick);
    }

    private async clickByName(params: any): Promise<void> {
        await this.executeKeyWin(`{CLICKNAME:${params.name}}`, params.target);
        
        // Wait for click to be processed
        await this.sleep(this.defaultDelays.afterClick);
    }

    private async closeProcess(params: any): Promise<void> {
        const names = Array.isArray(params.processNames) ? params.processNames : [params.processNames];
        
        for (const name of names) {
            try {
                spawn('powershell', ['-Command', `Stop-Process -Name "${name}" -Force -ErrorAction SilentlyContinue`]);
            } catch (err) {
                // Ignore errors
            }
        }
        
        // Wait for process to close
        await this.sleep(this.defaultDelays.afterClose);
    }

    private async wait(params: any): Promise<void> {
        const waitMs = (params.seconds || 0) * 1000 + (params.milliseconds || 0);
        await this.sleep(waitMs);
    }

    private setVariable(params: any): void {
        this.context.variables.set(params.name, params.value);
    }

    private logMessage(params: any): void {
        console.log(params.message);
    }

    /**
     * Execute KeyWin.exe
     */
    public executeKeyWin(keys: string, target?: string): Promise<any> {
        return new Promise((resolve, reject) => {
            const args = target ? [target, keys] : [keys];
            
            let stdout = '';
            let stderr = '';

            // Prepare environment with session token
            const env = { ...process.env };
            
            if (this.sessionTokenManager) {
                // Generate session token and pass via environment
                const token = this.sessionTokenManager.generateToken();
                env.MCP_SESSION_TOKEN = token;
                
                // Also pass the session secret so KeyWin can verify
                env.MCP_SESSION_SECRET = this.sessionTokenManager.exportSecret();
            }

            // Log KeyWin.exe execution
            globalLogger.info('ScenarioReplayer', '═══ Executing KeyWin.exe ═══');
            globalLogger.debug('ScenarioReplayer', `Binary: ${this.context.keywinBinary}`);
            globalLogger.logJSON('debug', 'ScenarioReplayer', 'Args', args);
            if (target) {
                globalLogger.debug('ScenarioReplayer', `Target: "${target}"`);
            }
            globalLogger.debug('ScenarioReplayer', `Keys: "${keys}"`);
            globalLogger.debug('ScenarioReplayer', `Session Token: ${env.MCP_SESSION_TOKEN ? 'Present' : 'None'}`);

            const proc = spawn(this.context.keywinBinary, args, { env });

            proc.stdout.on('data', (data) => {
                stdout += data.toString();
            });

            proc.stderr.on('data', (data) => {
                stderr += data.toString();
            });

            proc.on('close', (code) => {
                globalLogger.info('ScenarioReplayer', '═══ KeyWin.exe Result ═══');
                globalLogger.debug('ScenarioReplayer', `Exit code: ${code}`);
                
                if (stderr) {
                    globalLogger.error('ScenarioReplayer', `Stderr: ${stderr}`);
                }
                
                try {
                    const result = JSON.parse(stdout);
                    
                    // Log formatted JSON response
                    globalLogger.logJSON('debug', 'ScenarioReplayer', 'Response', result);
                    
                    if (!result.success) {
                        reject(new Error(`WinKeys error: ${result.error} - ${result.message || ''}`));
                    } else {
                        resolve(result);
                    }
                } catch (err) {
                    globalLogger.debug('ScenarioReplayer', `Raw stdout: ${stdout}`);
                    reject(new Error(`Failed to parse WinKeys output: ${stdout}`));
                }
            });

            proc.on('error', (err) => {
                globalLogger.error('ScenarioReplayer', `Process error: ${err}`);
                reject(err);
            });
        });
    }

    /**
     * Utilities
     */
    private getWaitTime(params: any, defaultMs: number): number {
        if (params.waitSeconds !== undefined || params.waitMilliseconds !== undefined) {
            return (params.waitSeconds || 0) * 1000 + (params.waitMilliseconds || 0);
        }
        return defaultMs;
    }

    private async applyStepDelay(step: ScenarioStep): Promise<void> {
        // Apply explicit delay at step level if specified
        if (step.params.delayAfter) {
            const delayMs = (step.params.delayAfter.seconds || 0) * 1000 + 
                          (step.params.delayAfter.milliseconds || 0);
            if (delayMs > 0) {
                await this.sleep(delayMs);
            }
        }
    }

    private resolveVariables(params: any): any {
        if (typeof params === 'string') {
            return params.replace(/\$\{(\w+)\}/g, (_, varName) => {
                const value = this.context.variables.get(varName);
                return value !== undefined ? value : `\${${varName}}`;
            });
        }

        if (Array.isArray(params)) {
            return params.map(p => this.resolveVariables(p));
        }

        if (typeof params === 'object' && params !== null) {
            const resolved: any = {};
            for (const [key, value] of Object.entries(params)) {
                resolved[key] = this.resolveVariables(value);
            }
            return resolved;
        }

        return params;
    }

    private evaluateCondition(condition: string): boolean {
        // Simple condition evaluation: "varName != null"
        const match = condition.match(/(\w+)\s*(==|!=)\s*(.+)/);
        if (!match) return true;

        const [, varName, operator, valueStr] = match;
        const actualValue = this.context.variables.get(varName);
        const expectedValue = valueStr.trim() === 'null' ? null : valueStr.trim();

        if (operator === '==') {
            return actualValue == expectedValue;
        } else if (operator === '!=') {
            return actualValue != expectedValue;
        }

        return true;
    }

    private runAssertions(assertions: AssertionRule, stepId: number): void {
        if (assertions.notNull) {
            const value = this.context.variables.get(assertions.notNull);
            if (value === null || value === undefined) {
                throw new Error(`Assertion failed: ${assertions.notNull} is null`);
            }
        }

        if (assertions.equals) {
            const actual = this.resolveVariables(assertions.equals.actual);
            const expected = assertions.equals.expected;
            if (actual !== expected) {
                throw new Error(`Assertion failed: expected "${expected}", got "${actual}"`);
            }
        }

        if (assertions.contains) {
            const value = this.resolveVariables(assertions.contains.value);
            const substring = assertions.contains.substring;
            if (!value.includes(substring)) {
                throw new Error(`Assertion failed: "${value}" does not contain "${substring}"`);
            }
        }

        if (assertions.greaterThan) {
            const value = parseFloat(this.resolveVariables(assertions.greaterThan.value));
            const threshold = assertions.greaterThan.threshold;
            if (value <= threshold) {
                throw new Error(`Assertion failed: ${value} is not greater than ${threshold}`);
            }
        }
    }

    private matchPattern(text: string, pattern: string): boolean {
        // Simple wildcard matching
        const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$', 'i');
        return regex.test(text);
    }

    private sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    private log(message: string, isError: boolean = false): void {
        if (this.context.verbose || isError) {
            console.log(message);
        }
    }
}
