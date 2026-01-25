import fetch from 'node-fetch';

async function testVaultAPI() {
  try {
    // First, login to get token
    console.log('🔐 Logging in...');
    const loginResponse = await fetch('https://dids.amdy.io/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'client@test3.com',
        password: 'password123'
      })
    });

    const loginData = await loginResponse.json();

    if (!loginData.data?.tokens?.accessToken) {
      console.log('Login response:', JSON.stringify(loginData, null, 2));
      throw new Error('Login failed - no access token');
    }

    const token = loginData.data.tokens.accessToken;
    console.log('✅ Logged in! Token:', token.substring(0, 20) + '...');

    // Test vaulting
    console.log('\n💳 Testing card vaulting...');
    const vaultResponse = await fetch('https://dids.amdy.io/api/v1/billing/payment-methods/vault', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        cardNumber: '4111111111111111',
        expiryMonth: 12,
        expiryYear: 2028,
        cvv: '123',
        billingAddress: {
          firstName: 'John',
          lastName: 'Doe',
          street: '123 Main St',
          city: 'San Francisco',
          state: 'CA',
          zipCode: '94102',
          country: 'US'
        }
      })
    });

    const vaultData = await vaultResponse.text();
    console.log('\n📊 Response Status:', vaultResponse.status);
    console.log('📄 Response Body:', vaultData);

    if (vaultResponse.ok) {
      console.log('\n✅ SUCCESS! Card vaulted successfully');
    } else {
      console.log('\n❌ FAILED! Status:', vaultResponse.status);
    }

  } catch (error) {
    console.error('\n❌ Error:', error.message);
  }
}

testVaultAPI();
