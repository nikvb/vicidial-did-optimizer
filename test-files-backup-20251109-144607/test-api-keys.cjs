async function testAPIKeys() {
  try {
    // First login to get token
    console.log('1. Logging in as client@test3.com...');
    const loginResponse = await fetch('http://api3.amdy.io:5000/api/v1/auth/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email: 'client@test3.com',
        password: 'password123'
      })
    });

    const loginData = await loginResponse.json();
    console.log('Login response:', loginData);

    if (!loginData.data || !loginData.data.tokens) {
      console.error('Login failed - no tokens returned');
      return;
    }

    const token = loginData.data.tokens.accessToken;
    console.log('Token received:', token.substring(0, 20) + '...');

    // Now test the API keys endpoint
    console.log('\n2. Testing API keys endpoint with token...');
    const apiKeysResponse = await fetch('http://api3.amdy.io:5000/api/v1/tenants/api-keys', {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json'
      }
    });

    const apiKeysData = await apiKeysResponse.json();
    console.log('API Keys response:', JSON.stringify(apiKeysData, null, 2));

    // Also test without token (should fail)
    console.log('\n3. Testing API keys endpoint without token (should fail)...');
    const noAuthResponse = await fetch('http://api3.amdy.io:5000/api/v1/tenants/api-keys', {
      method: 'GET',
      headers: {
        'Accept': 'application/json'
      }
    });

    const noAuthData = await noAuthResponse.json();
    console.log('No auth response:', JSON.stringify(noAuthData, null, 2));

  } catch (error) {
    console.error('Error:', error);
  }
}

testAPIKeys();