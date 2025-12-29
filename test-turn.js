#!/usr/bin/env node

// TURN Server Test Script
// Run with: node test-turn.js

const crypto = require('crypto');

// Configuration (should match your server.js)
const TURN_SERVER_IP = '185.117.154.193';
const TURN_SECRET = 'my_secure_secret_key_2024';

// Generate TURN credentials (same as server.js)
function generateTurnCredentials() {
  const timestamp = Math.floor(Date.now() / 1000) + 86400; // 24 hours from now
  const username = `${timestamp}:zloer-user`;
  
  // Create HMAC-SHA1 signature
  const hmac = crypto.createHmac('sha1', TURN_SECRET);
  hmac.update(username);
  const password = hmac.digest('base64');
  
  return { username, password, timestamp };
}

// Test TURN server connectivity
async function testTurnServer() {
  console.log('🔧 TURN Server Connectivity Test');
  console.log('================================');
  
  const credentials = generateTurnCredentials();
  
  console.log('📋 Generated Credentials:');
  console.log(`   Username: ${credentials.username}`);
  console.log(`   Password: ${credentials.password}`);
  console.log(`   Expires: ${new Date(credentials.timestamp * 1000).toISOString()}`);
  console.log('');
  
  const turnServers = [
    {
      urls: `turn:${TURN_SERVER_IP}:3478?transport=udp`,
      username: credentials.username,
      credential: credentials.password
    },
    {
      urls: `turn:${TURN_SERVER_IP}:3478?transport=tcp`,
      username: credentials.username,
      credential: credentials.password
    },
    {
      urls: `turns:${TURN_SERVER_IP}:443?transport=tcp`,
      username: credentials.username,
      credential: credentials.password
    }
  ];
  
  console.log('🧪 Testing TURN servers:');
  turnServers.forEach((server, index) => {
    console.log(`   ${index + 1}. ${server.urls}`);
  });
  console.log('');
  
  // Basic connectivity test using curl (if available)
  const { exec } = require('child_process');
  
  console.log('🔍 Basic connectivity tests:');
  
  // Test UDP port
  exec(`nc -u -z -v ${TURN_SERVER_IP} 3478`, (error, stdout, stderr) => {
    if (error) {
      console.log(`❌ UDP 3478: Connection failed - ${error.message}`);
    } else {
      console.log(`✅ UDP 3478: Port is open`);
    }
  });
  
  // Test TCP port
  exec(`nc -z -v ${TURN_SERVER_IP} 3478`, (error, stdout, stderr) => {
    if (error) {
      console.log(`❌ TCP 3478: Connection failed - ${error.message}`);
    } else {
      console.log(`✅ TCP 3478: Port is open`);
    }
  });
  
  // Test TLS port
  exec(`nc -z -v ${TURN_SERVER_IP} 443`, (error, stdout, stderr) => {
    if (error) {
      console.log(`❌ TLS 443: Connection failed - ${error.message}`);
    } else {
      console.log(`✅ TLS 443: Port is open`);
    }
  });
  
  console.log('');
  console.log('📝 Manual Test Commands:');
  console.log('========================');
  console.log('Test UDP TURN:');
  console.log(`turnutils_uclient -T -u "${credentials.username}" -w "${credentials.password}" ${TURN_SERVER_IP}`);
  console.log('');
  console.log('Test TCP TURN:');
  console.log(`turnutils_uclient -T -t -u "${credentials.username}" -w "${credentials.password}" ${TURN_SERVER_IP}`);
  console.log('');
  console.log('Test TLS TURN:');
  console.log(`turnutils_uclient -T -S -u "${credentials.username}" -w "${credentials.password}" ${TURN_SERVER_IP} -p 443`);
  console.log('');
  console.log('💡 If turnutils_uclient is not installed:');
  console.log('   sudo apt-get install coturn-utils');
  console.log('');
  console.log('🔧 Coturn Service Commands:');
  console.log('   sudo systemctl status coturn');
  console.log('   sudo systemctl restart coturn');
  console.log('   sudo journalctl -u coturn -f');
}

// Run the test
testTurnServer().catch(console.error);