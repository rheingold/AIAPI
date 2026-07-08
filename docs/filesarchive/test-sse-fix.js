// Simple test to verify SSE content-type header handling
const http = require('http');
const { MCPServer } = require('./components/server/src/server/mcpServer');

// Test the SSE endpoint directly 
async function testSSE() {
  try {
    // Start a temporary server for testing
    const server = new MCPServer(undefined, 3458);
    await server.start();
    
    console.log('Testing SSE endpoint...');
    
    // Test HTTP request to get SSE endpoint
    const req = http.request({
      hostname: '127.0.0.1',
      port: 3458,
      method: 'GET', 
      path: '/sse',
      headers: {
        'Accept': 'text/event-stream'
      }
    }, (res) => {
      console.log('Status:', res.statusCode);
      console.log('Content-Type:', res.headers['content-type']);
      console.log('Headers:', res.headers);
      
      if (res.headers['content-type'] && res.headers['content-type'].includes('text/event-stream')) {
        console.log('✅ SSE content-type is correct');
      } else {
        console.log('❌ SSE content-type is incorrect');
      }
      
      // Clean up
      server.stop();
    });
    
    req.on('error', (err) => {
      console.error('Request error:', err);
      server.stop();
    });
    
    req.end();
  } catch (error) {
    console.error('Server error:', error);
  }
}

testSSE();