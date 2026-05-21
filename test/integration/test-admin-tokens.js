/**
 * Test admin token functionality
 */

const { SessionTokenManager } = require('../../dist/src/security/SessionTokenManager');

function testAdminTokens() {
  console.log('🧪 Testing Admin Token Implementation...\n');
  
  try {
    // Create a test session manager
    const sessionManager = new SessionTokenManager(Buffer.from('a'.repeat(64), 'hex'), true);
    
    // Test 1: Valid admin token generation
    console.log('📝 Test 1: Valid admin token generation');
    process.env.ADMIN_PASSWORD = 'testpass123';
    
    const adminToken = sessionManager.generateAdminToken('testpass123');
    console.log(`✅ Admin token generated: ${adminToken ? 'SUCCESS' : 'FAILED'}`);
    
    if (adminToken) {
      console.log(`   Token length: ${adminToken.length} chars`);
      console.log(`   Token preview: ${adminToken.substring(0, 32)}...`);
    }
    
    // Test 2: Invalid password
    console.log('\n🚫 Test 2: Invalid password');
    const invalidToken = sessionManager.generateAdminToken('wrongpass');
    console.log(`✅ Invalid password rejected: ${!invalidToken ? 'SUCCESS' : 'FAILED'}`);
    
    // Test 3: Token validation
    if (adminToken) {
      console.log('\n🔍 Test 3: Token validation');
      const validation = sessionManager.validateAdminToken(adminToken);
      console.log(`✅ Token validation: ${validation.valid ? 'SUCCESS' : 'FAILED'}`);
      console.log(`   Expired: ${validation.expired}`);
      console.log(`   Privileges: ${validation.data?.privileges?.join(', ')}`);
      console.log(`   Type: ${validation.data?.type}`);
    }
    
    // Test 4: Invalid token format
    console.log('\n❌ Test 4: Invalid token format');
    const invalidValidation = sessionManager.validateAdminToken('invalid-token-format');
    console.log(`✅ Invalid token rejected: ${!invalidValidation.valid ? 'SUCCESS' : 'FAILED'}`);
    
    // Test 5: Token expiry check
    console.log('\n⏰ Test 5: Token expiry logic');
    const shortToken = sessionManager.generateAdminToken('testpass123', 0.01); // 0.6 seconds
    
    if (shortToken) {
      const immediateValidation = sessionManager.validateAdminToken(shortToken);
      console.log(`✅ Fresh token valid: ${immediateValidation.valid ? 'SUCCESS' : 'FAILED'}`);
      
      // Wait a bit and test again
      setTimeout(() => {
        const expiredValidation = sessionManager.validateAdminToken(shortToken);
        console.log(`✅ Expired token rejected: ${!expiredValidation.valid && expiredValidation.expired ? 'SUCCESS' : 'FAILED'}`);
        console.log('\n🎉 Admin token implementation test completed!');
      }, 1000);
    }
    
  } catch (error) {
    console.error('❌ Test failed with error:', error);
  }
}

// Run the test
testAdminTokens();