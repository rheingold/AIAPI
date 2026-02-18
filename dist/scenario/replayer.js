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
exports.ScenarioReplayer = void 0;
const child_process_1 = require("child_process");
const fs = __importStar(require("fs"));
const Logger_1 = require("../utils/Logger");
class ScenarioReplayer {
    constructor(keywinBinary, mcpServerUrl, verbose = false, sessionTokenManager) {
        this.defaultDelays = {
            afterLaunch: 2000, // Wait after launching process
            afterClick: 500, // Wait after mouse click
            afterKeys: 300, // Wait after keyboard input
            afterClose: 1000, // Wait after closing process
            afterQuery: 200 // Wait after UI query
        };
        this.context = {
            variables: new Map(),
            keywinBinary,
            mcpServerUrl,
            verbose
        };
        this.sessionTokenManager = sessionTokenManager;
    }
    /**
     * Load scenario from JSON file
     */
    loadScenario(filePath) {
        const content = fs.readFileSync(filePath, 'utf-8');
        return JSON.parse(content);
    }
    /**
     * Execute a complete scenario
     */
    async executeScenario(scenario) {
        const startTime = Date.now();
        const stepResults = [];
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
            }
            catch (error) {
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
    async executeStep(step) {
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
    async launchProcess(params) {
        const proc = (0, child_process_1.spawn)(params.executable, [], { detached: true, stdio: 'ignore' });
        proc.unref();
        // Use explicit wait or default delay
        const waitMs = this.getWaitTime(params, this.defaultDelays.afterLaunch);
        await this.sleep(waitMs);
    }
    async findWindow(params) {
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
            }
            catch (err) {
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
            const patterns = params.titlePattern.split('|').map((p) => p.trim());
            for (const pattern of patterns) {
                const window = windows.find((w) => this.matchPattern(w.title, pattern));
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
    async sendKeys(params) {
        await this.executeKeyWin(params.keys, params.target);
        // Use explicit wait or default delay
        const waitMs = this.getWaitTime(params, this.defaultDelays.afterKeys);
        await this.sleep(waitMs);
    }
    async readValue(params) {
        // Small delay before reading to ensure UI is updated
        await this.sleep(100);
        const result = await this.executeKeyWin("{READ}", params.target);
        const value = result.value;
        if (params.storeAs) {
            this.context.variables.set(params.storeAs, value);
        }
        return value;
    }
    async queryTree(params) {
        const depth = params.depth || 2;
        const result = await this.executeKeyWin(`{QUERYTREE:${depth}}`, params.target);
        if (params.storeAs) {
            this.context.variables.set(params.storeAs, result);
        }
        // Small delay after querying
        await this.sleep(this.defaultDelays.afterQuery);
        return result;
    }
    async click(params) {
        await this.executeKeyWin(`{CLICK:${params.x},${params.y}}`, params.target);
        // Wait for click to be processed
        await this.sleep(this.defaultDelays.afterClick);
    }
    async clickByName(params) {
        await this.executeKeyWin(`{CLICKNAME:${params.name}}`, params.target);
        // Wait for click to be processed
        await this.sleep(this.defaultDelays.afterClick);
    }
    async closeProcess(params) {
        const names = Array.isArray(params.processNames) ? params.processNames : [params.processNames];
        for (const name of names) {
            try {
                (0, child_process_1.spawn)('powershell', ['-Command', `Stop-Process -Name "${name}" -Force -ErrorAction SilentlyContinue`]);
            }
            catch (err) {
                // Ignore errors
            }
        }
        // Wait for process to close
        await this.sleep(this.defaultDelays.afterClose);
    }
    async wait(params) {
        const waitMs = (params.seconds || 0) * 1000 + (params.milliseconds || 0);
        await this.sleep(waitMs);
    }
    setVariable(params) {
        this.context.variables.set(params.name, params.value);
    }
    logMessage(params) {
        console.log(params.message);
    }
    /**
     * Execute KeyWin.exe
     */
    executeKeyWin(keys, target) {
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
            Logger_1.globalLogger.info('ScenarioReplayer', '═══ Executing KeyWin.exe ═══');
            Logger_1.globalLogger.debug('ScenarioReplayer', `Binary: ${this.context.keywinBinary}`);
            Logger_1.globalLogger.logJSON('debug', 'ScenarioReplayer', 'Args', args);
            if (target) {
                Logger_1.globalLogger.debug('ScenarioReplayer', `Target: "${target}"`);
            }
            Logger_1.globalLogger.debug('ScenarioReplayer', `Keys: "${keys}"`);
            Logger_1.globalLogger.debug('ScenarioReplayer', `Session Token: ${env.MCP_SESSION_TOKEN ? 'Present' : 'None'}`);
            const proc = (0, child_process_1.spawn)(this.context.keywinBinary, args, { env });
            proc.stdout.on('data', (data) => {
                stdout += data.toString();
            });
            proc.stderr.on('data', (data) => {
                stderr += data.toString();
            });
            proc.on('close', (code) => {
                Logger_1.globalLogger.info('ScenarioReplayer', '═══ KeyWin.exe Result ═══');
                Logger_1.globalLogger.debug('ScenarioReplayer', `Exit code: ${code}`);
                if (stderr) {
                    Logger_1.globalLogger.error('ScenarioReplayer', `Stderr: ${stderr}`);
                }
                try {
                    const result = JSON.parse(stdout);
                    // Log formatted JSON response
                    Logger_1.globalLogger.logJSON('debug', 'ScenarioReplayer', 'Response', result);
                    if (!result.success) {
                        reject(new Error(`WinKeys error: ${result.error} - ${result.message || ''}`));
                    }
                    else {
                        resolve(result);
                    }
                }
                catch (err) {
                    Logger_1.globalLogger.debug('ScenarioReplayer', `Raw stdout: ${stdout}`);
                    reject(new Error(`Failed to parse WinKeys output: ${stdout}`));
                }
            });
            proc.on('error', (err) => {
                Logger_1.globalLogger.error('ScenarioReplayer', `Process error: ${err}`);
                reject(err);
            });
        });
    }
    /**
     * Utilities
     */
    getWaitTime(params, defaultMs) {
        if (params.waitSeconds !== undefined || params.waitMilliseconds !== undefined) {
            return (params.waitSeconds || 0) * 1000 + (params.waitMilliseconds || 0);
        }
        return defaultMs;
    }
    async applyStepDelay(step) {
        // Apply explicit delay at step level if specified
        if (step.params.delayAfter) {
            const delayMs = (step.params.delayAfter.seconds || 0) * 1000 +
                (step.params.delayAfter.milliseconds || 0);
            if (delayMs > 0) {
                await this.sleep(delayMs);
            }
        }
    }
    resolveVariables(params) {
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
            const resolved = {};
            for (const [key, value] of Object.entries(params)) {
                resolved[key] = this.resolveVariables(value);
            }
            return resolved;
        }
        return params;
    }
    evaluateCondition(condition) {
        // Simple condition evaluation: "varName != null"
        const match = condition.match(/(\w+)\s*(==|!=)\s*(.+)/);
        if (!match)
            return true;
        const [, varName, operator, valueStr] = match;
        const actualValue = this.context.variables.get(varName);
        const expectedValue = valueStr.trim() === 'null' ? null : valueStr.trim();
        if (operator === '==') {
            return actualValue == expectedValue;
        }
        else if (operator === '!=') {
            return actualValue != expectedValue;
        }
        return true;
    }
    runAssertions(assertions, stepId) {
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
    matchPattern(text, pattern) {
        // Simple wildcard matching
        const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$', 'i');
        return regex.test(text);
    }
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
    log(message, isError = false) {
        if (this.context.verbose || isError) {
            console.log(message);
        }
    }
}
exports.ScenarioReplayer = ScenarioReplayer;
//# sourceMappingURL=replayer.js.map