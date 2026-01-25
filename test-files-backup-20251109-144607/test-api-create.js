import axios from 'axios';

async function testApiKeys() {
  try {
    // Login first
    console.log('🔐 Logging in...');
    const loginResponse = await axios.post('http://api3.amdy.io:5000/api/v1/auth/login', {
      email: 'client@test3.com',
      password: 'password123'
    });

    const token = loginResponse.data.data.tokens.accessToken;
    console.log('✅ Login successful');

    // Test getting API keys
    console.log('📋 Getting existing API keys...');
    const getResponse = await axios.get('http://api3.amdy.io:5000/api/v1/tenants/api-keys', {
      headers: { Authorization: `Bearer ${token}` }
    });

    console.log('✅ API Keys response:', JSON.stringify(getResponse.data, null, 2));

    // Test creating an API key
    console.log('➕ Creating new API key...');
    const createResponse = await axios.post('http://api3.amdy.io:5000/api/v1/tenants/api-keys', {
      name: 'Test API Key',
      permissions: ['read', 'write']
    }, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });

    console.log('✅ API Key created:', JSON.stringify(createResponse.data, null, 2));

  } catch (error) {
    console.error('❌ Error:', error.response?.data || error.message);
    console.error('Status:', error.response?.status);
  }
}

testApiKeys();