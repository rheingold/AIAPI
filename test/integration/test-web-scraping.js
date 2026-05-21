/**
 * Quick test to verify web scraping functionality
 */

const { AutomationEngine } = require('./dist/engine/automationEngine');
const { WebScrapingClient } = require('./dist/engine/webScrapingClient');

async function testWebScraping() {
  console.log('🧪 Testing Web Scraping Implementation...\n');
  
  try {
    // Test 1: Direct WebScrapingClient test
    console.log('📡 Test 1: Direct WebScrapingClient');
    const webClient = new WebScrapingClient();
    
    // Test with a simple HTTP endpoint
    const result1 = await webClient.fetchWebpage('http://httpbin.org/json', {
      timeout: 10000
    });
    
    console.log(`✅ Direct client test: ${result1.success ? 'SUCCESS' : 'FAILED'}`);
    if (result1.success) {
      console.log(`   Status: ${result1.statusCode}`);
      console.log(`   Content length: ${result1.content ? result1.content.length : 0} chars`);
    } else {
      console.log(`   Error: ${result1.error}`);
    }
    
    // Test 2: AutomationEngine integration
    console.log('\n🔧 Test 2: AutomationEngine integration');
    const engine = new AutomationEngine();
    
    const result2 = await engine.fetchWebpage('http://httpbin.org/user-agent', {
      timeout: 10000
    });
    
    console.log(`✅ Engine integration test: ${result2.success ? 'SUCCESS' : 'FAILED'}`);
    if (result2.success) {
      console.log(`   Status: ${result2.statusCode}`);
      console.log(`   Content preview: ${result2.content ? result2.content.substring(0, 100) : 'No content'}...`);
    } else {
      console.log(`   Error: ${result2.error}`);
    }
    
    // Test 3: Rate limiting
    console.log('\n🛡️ Test 3: Rate limiting');
    console.log('Making 3 rapid requests to test rate limiting...');
    
    for (let i = 1; i <= 3; i++) {
      const startTime = Date.now();
      const result = await webClient.fetchWebpage('http://httpbin.org/delay/0');
      const duration = Date.now() - startTime;
      
      console.log(`   Request ${i}: ${result.success ? 'SUCCESS' : 'RATE LIMITED'} (${duration}ms)`);
      if (!result.success && result.error.includes('rate limit')) {
        console.log(`   Rate limit working correctly: ${result.error}`);
        break;
      }
    }
    
    // Test 4: Security filters
    console.log('\n🔒 Test 4: Security filtering');
    
    // Configure strict security
    webClient.setSecurityFilter({
      allowedDomains: ['httpbin.org'],
      maxContentLength: 1000,
      rateLimiting: {
        maxRequestsPerMinute: 1,
        maxRequestsPerDomain: 1,
        cooldownPeriodMs: 2000
      }
    });
    
    // Test blocked domain
    const blockedResult = await webClient.fetchWebpage('https://example.com');
    console.log(`✅ Domain filter test: ${!blockedResult.success ? 'BLOCKED (correct)' : 'FAILED TO BLOCK'}`);
    
    console.log('\n🎉 Web scraping implementation test completed!');
    
  } catch (error) {
    console.error('❌ Test failed with error:', error);
  }
}

// Run the test
testWebScraping().then(() => {
  console.log('\n✨ Test execution finished');
  process.exit(0);
}).catch((error) => {
  console.error('❌ Test execution failed:', error);
  process.exit(1);
});