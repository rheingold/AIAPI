/**
 * Automation Scenario Schema v1
 * JSON-based declarative automation format for Windows UI testing
 */
export interface AutomationScenario {
    $schema: string;
    name: string;
    description: string;
    version: string;
    variables: Record<string, any>;
    steps: ScenarioStep[];
}
export interface ScenarioStep {
    id: number;
    action: StepAction;
    params: Record<string, any>;
    description: string;
    assert?: AssertionRule;
}
export type StepAction = "launchProcess" | "findWindow" | "sendKeys" | "readValue" | "queryTree" | "click" | "clickByName" | "closeProcess" | "wait" | "setVariable" | "log";
export interface AssertionRule {
    notNull?: string;
    equals?: {
        actual: string;
        expected: any;
    };
    contains?: {
        value: string;
        substring: string;
    };
    greaterThan?: {
        value: string;
        threshold: number;
    };
}
export interface ScenarioExecutionContext {
    variables: Map<string, any>;
    keywinBinary: string;
    mcpServerUrl?: string;
    verbose: boolean;
}
export interface StepResult {
    stepId: number;
    success: boolean;
    output?: any;
    error?: string;
    duration: number;
}
export interface ScenarioResult {
    scenarioName: string;
    success: boolean;
    steps: StepResult[];
    duration: number;
    failedStep?: number;
}
//# sourceMappingURL=types.d.ts.map