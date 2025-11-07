async function testAPIKeysFixed() {
  try {
    // First login to get token with fixed ID format
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
    const user = loginData.data.user;
    console.log('Token received:', token.substring(0, 20) + '...');
    console.log('User ID:', user.id);
    console.log('User email:', user.email);
    console.log('Tenant ID:', user.tenant);

    // Decode the token to see what's inside
    const tokenParts = token.split('.');
    if (tokenParts.length === 3) {
      const decodedToken = JSON.parse(Buffer.from(tokenParts[1], 'base64').toString());
      console.log('\nDecoded token payload:');
      console.log('  Token user ID:', decodedToken.id);
      console.log('  Token email:', decodedToken.email);
      console.log('  Token role:', decodedToken.role);
    }

    // Now test the API keys endpoint with the corrected token
    console.log('\n2. Testing API keys endpoint with token...');
    const apiKeysResponse = await fetch('http://api3.amdy.io:5000/api/v1/tenants/api-keys', {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json'
      }
    });

    console.log('API Keys response status:', apiKeysResponse.status);
    const apiKeysData = await apiKeysResponse.json();
    console.log('API Keys response:', JSON.stringify(apiKeysData, null, 2));

    if (apiKeysData.success && apiKeysData.data) {
      console.log(`\n✅ Successfully retrieved ${apiKeysData.data.length} API keys`);
      apiKeysData.data.forEach((key, index) => {
        console.log(`  ${index + 1}. ${key.name}: ${key.key} (Active: ${key.isActive})`);
      });
    } else {
      console.log('\n❌ Failed to retrieve API keys');
    }

  } catch (error) {
    console.error('Error:', error);
  }
}

testAPIKeysFixed();