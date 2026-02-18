import { AutomationEngine } from './engine/automationEngine';
import { MCPServer } from './server/mcpServer';
import { HttpServerWithDashboard } from './server/httpServerWithDashboard';
import { ConfigSigner } from './security/ConfigSigner';
import { IntegrityChecker } from './security/IntegrityChecker';
import { globalLogger } from './utils/Logger';
import * as path from 'path';
import * as fs from 'fs';

async function performSecurityChecks(): Promise<boolean> {
  console.log('\n=== Security Initialization ===');
  
  const securityDir = path.join(process.cwd(), 'security');
  const configPath = path.join(securityDir, 'config.json');
  
  // Check if security is configured
  if (!fs.existsSync(configPath)) {
    console.log('⚠ No security configuration found - running in INSECURE mode');
    console.log('  Run security setup to enable protection');
    return true; // Allow startup without security for development
  }

  const signer = new ConfigSigner(securityDir);
  const checker = new IntegrityChecker();

  // Check for dev bypass
  if (process.env.SKIP_SECURITY === 'true') {
    console.log('⚠ WARNING: Security checks BYPASSED (SKIP_SECURITY=true)');
    console.log('  This should NEVER be used in production!');
    return true;
  }

  try {
    // Step 1: Verify configuration signature
    console.log('1. Verifying configuration signature...');
    const password = process.env.SECURITY_PASSWORD || '';
    
    if (!password && !process.env.SKIP_CONFIG_SIGNATURE) {
      console.error('✗ ERROR: SECURITY_PASSWORD not set');
      console.error('  Set environment variable or use SKIP_CONFIG_SIGNATURE=true for dev');
      return false;
    }

    const configResult = signer.verifyConfig(password);
    if (!configResult.valid) {
      console.error('✗ Configuration verification FAILED:', configResult.error);
      return false;
    }
    console.log('  ✓ Configuration signature valid');

    // Step 2: Verify binary integrity
    console.log('2. Verifying binary integrity...');
    const integrityResult = checker.verifyAll(configResult.config);
    
    if (!integrityResult.allValid && !integrityResult.bypassed) {
      console.error('✗ Binary integrity check FAILED');
      integrityResult.results.filter(r => !r.valid).forEach(r => {
        console.error(`  - ${r.binary}: ${r.error}`);
      });
      return false;
    }
    
    if (integrityResult.bypassed) {
      console.log('  ⚠ Binary integrity check bypassed');
    } else {
      console.log(`  ✓ Binary integrity verified (${integrityResult.results.length} binaries)`);
    }

    console.log('\n✓ Security checks PASSED - Server is secure');
    return true;

  } catch (error: any) {
    console.error('✗ Security check error:', error.message);
    return false;
  }
}

async function main() {
  const port = Number(process.env.MCP_PORT || 3457);
  
  // Perform security checks
  const securityPassed = await performSecurityChecks();
  
  if (!securityPassed) {
    console.error('\n❌ SERVER STARTUP BLOCKED - Security verification failed');
    console.error('   Cannot start server with compromised security');
    process.exit(1);
  }

  console.log('\n=== Starting MCP Server ===');
  // Create server without engine - it will create its own with session token
  const server = new MCPServer(undefined, port);

  await server.start();
  // eslint-disable-next-line no-console
  console.log(`✓ MCP server running on http://127.0.0.1:${port}`);
  console.log('  Ready to accept automation requests');

  // Start dashboard on a separate port - use the SAME engine as MCP server
  console.log('\n=== Starting Dashboard ===');
  const dashboardPort = port + 1; // e.g., 3458 if MCP is on 3457
  // Get the shared AutomationEngine and SessionTokenManager from MCP server
  const sessionTokenManager = (server as any).sessionTokenManager;
  const engine = (server as any).automationEngine;
  globalLogger.debug('system', `Dashboard will use the same AutomationEngine as MCP Server`);
  const dashboard = new HttpServerWithDashboard(engine, sessionTokenManager, dashboardPort);
  await dashboard.start();
  console.log('');
  
  // Test logging to verify dashboard connection
  globalLogger.info('system', '✓ MCP Server and Dashboard are both running');
  globalLogger.info('system', '✓ JSON-RPC request/response logging is enabled');

  // Keep process alive
  let shuttingDown = false;
  process.on('SIGINT', async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    // eslint-disable-next-line no-console
    console.log('\nShutting down servers...');
    await server.stop();
    await dashboard.stop();
    process.exit(0);
  });

  // Keep the process running indefinitely
  setInterval(() => {}, 1000); // Keep alive with periodic no-op
  await new Promise(() => {}); // Never resolves
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Failed to start standalone MCP server:', err);
  process.exit(1);
});
