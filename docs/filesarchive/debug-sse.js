// Debug script for SSE handling
const http = require('http');
const { MCPServer } = require('./components/server/src/server/mcpServer');

async function debugSSE() {
  try {
    console.log('Starting server...');
    const server = new MCPServer(undefined, 3459);
    await server.start();
    
    console.log('Testing SSE endpoint with explicit Accept header...');
    
    // Test HTTP request to get SSE endpoint
    const req = http.request({
      hostname: '127.0.0.1',
      port: 3459,
      method: 'GET', 
      path: '/sse',
      headers: {
        'Accept': 'text/event-stream'
      }
    }, (res) => {
      console.log('Status:', res.statusCode);
      console.log('Content-Type header:', res.headers['content-type']);
      console.log('All headers:', res.headers);
      
      if (res.headers['content-type'] && res.headers['content-type'].includes('text/event-stream')) {
        console.log('✅ SSE content-type is correct');
      } else {
        console.log('❌ SSE content-type is incorrect');
      }
      
      // Read response data
      let data = '';
      res.on('data', (chunk) => {
        data += chunk.toString();
      });
      
      res.on('end', () => {
        console.log('Response body:', data);
        server.stop();
      });
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

debugSSE();