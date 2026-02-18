#!/usr/bin/env node

import * as path from 'path';
import { ScenarioReplayer } from './scenario/replayer';

async function main() {
    const args = process.argv.slice(2);

    if (args.length === 0) {
        console.log('Usage: run-scenario <scenario.json> [--verbose]');
        console.log('');
        console.log('Example:');
        console.log('  node dist/run-scenario.js scenarios/calculator-basic.json --verbose');
        process.exit(1);
    }

    const scenarioPath = args[0];
    const verbose = args.includes('--verbose') || args.includes('-v');

    const winkeysBinary = path.join(__dirname, '..', 'dist', 'win', 'WinKeys.exe');

    const replayer = new ScenarioReplayer(winkeysBinary, undefined, verbose);

    try {
        console.log(`Loading scenario: ${scenarioPath}`);
        const scenario = replayer.loadScenario(scenarioPath);

        const result = await replayer.executeScenario(scenario);

        console.log('\n=== SCENARIO RESULT ===');
        console.log(`Name: ${result.scenarioName}`);
        console.log(`Success: ${result.success ? '✓' : '✗'}`);
        console.log(`Duration: ${result.duration}ms`);
        console.log(`Steps: ${result.steps.length}`);
        
        if (!result.success) {
            console.log(`Failed at step: ${result.failedStep}`);
            const failedStep = result.steps.find(s => s.stepId === result.failedStep);
            if (failedStep) {
                console.log(`Error: ${failedStep.error}`);
            }
            process.exit(1);
        }

        console.log('\n✓✓✓ All steps passed\n');
        process.exit(0);

    } catch (error: any) {
        console.error('✗ Fatal error:', error.message);
        process.exit(1);
    }
}

main();
