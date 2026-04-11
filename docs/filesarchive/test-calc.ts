import * as vscode from 'vscode';

export async function testCalculator() {
    console.log('=== Calculator Test ===');
    
    // Test 1: Send keys
    console.log('\n1. Sending: 25+17=');
    try {
        const sendResult = await vscode.commands.executeCommand('extension.mcp.callTool', {
            tool: 'setProperty',
            arguments: {
                providerName: 'windows-forms',
                elementId: 'calc',
                propertyName: 'keys',
                value: '25+17='
            }
        });
        console.log('Send result:', sendResult);
    } catch (error) {
        console.error('Send error:', error);
    }
    
    // Wait
    await new Promise(r => setTimeout(r, 1500));
    
    // Test 2: Read result
    console.log('\n2. Reading display value...');
    try {
        const readResult = await vscode.commands.executeCommand('extension.mcp.callTool', {
            tool: 'readProperty',
            arguments: {
                providerName: 'windows-forms',
                elementId: 'calc',
                propertyName: 'value'
            }
        });
        console.log('Display value:', readResult);
        console.log('Expected: 42');
        console.log('Success:', readResult === 42 || readResult === '42');
    } catch (error) {
        console.error('Read error:', error);
    }
}

// Auto-run on extension activation
testCalculator();
