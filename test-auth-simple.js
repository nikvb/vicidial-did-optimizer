#!/usr/bin/env node

/**
 * Simple authentication test for API keys endpoint
 */

import https from 'https';
import http from 'http';

const API_URL = 'http://api3.amdy.io:5000';

console.log('🔐 Testing Authentication for API Keys Route\n');
console.log('============================================\n');

// Step 1: Login
console.log('1️⃣ Logging in as client@test3.com...');

const loginData = JSON.stringify({
  email: 'client@test3.com',
  password: 'password123'
});

const loginOptions = {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': loginData.length
  }
};

const loginReq = http.request(`${API_URL}/api/v1/auth/login`, loginOptions, (res) => {
  let data = '';

  res.on('data', (chunk) => {
    data += chunk;
  });

  res.on('end', () => {
    try {
      const response = JSON.parse(data);

      if (res.statusCode !== 200) {
        console.log('❌ Login failed!');
        console.log('   Status:', res.statusCode);
        console.log('   Response:', response);
        return;
      }

      const token = response.data?.tokens?.accessToken;

      if (!token) {
        console.log('❌ No token in response!');
        console.log('   Response:', JSON.stringify(response, null, 2));
        return;
      }

      console.log('✅ Login successful!');
      console.log('   Token:', token.substring(0, 30) + '...');
      console.log('   User:', response.data?.user?.email);
      console.log('   Role:', response.data?.user?.role);

      // Step 2: Fetch API keys
      console.log('\n2️⃣ Fetching API keys with token...');

      const apiKeysOptions = {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      };

      const apiKeysReq = http.request(`${API_URL}/api/v1/tenants/api-keys`, apiKeysOptions, (apiRes) => {
        let apiData = '';

        apiRes.on('data', (chunk) => {
          apiData += chunk;
        });

        apiRes.on('end', () => {
          try {
            const apiResponse = JSON.parse(apiData);

            console.log('\n📊 API Keys Response:');
            console.log('   Status:', apiRes.statusCode);
            console.log('   Success:', apiResponse.success);

            if (apiRes.statusCode !== 200) {
              console.log('❌ API call failed!');
              console.log('   Message:', apiResponse.message);
              console.log('   Full response:', JSON.stringify(apiResponse, null, 2));
              return;
            }

            console.log('✅ API Keys retrieved successfully!');
            console.log('   Total keys:', apiResponse.data?.length || 0);

            if (apiResponse.data && apiResponse.data.length > 0) {
              console.log('\n🔑 API Keys:');
              apiResponse.data.forEach((key, index) => {
                console.log(`\n   ${index + 1}. ${key.name}`);
                console.log(`      Key: ${key.key}`);
                console.log(`      Active: ${key.isActive}`);
                console.log(`      Permissions: ${key.permissions?.join(', ')}`);
                console.log(`      Created: ${key.createdAt}`);
                console.log(`      Last Used: ${key.lastUsed || 'Never'}`);
              });
            } else {
              console.log('\n⚠️  No API keys found');
            }

            console.log('\n============================================');
            console.log('✨ Test completed successfully!');

          } catch (error) {
            console.log('❌ Error parsing API keys response:', error.message);
            console.log('   Raw data:', apiData);
          }
        });
      });

      apiKeysReq.on('error', (error) => {
        console.log('❌ API keys request error:', error.message);
      });

      apiKeysReq.end();

    } catch (error) {
      console.log('❌ Error parsing login response:', error.message);
      console.log('   Raw data:', data);
    }
  });
});

loginReq.on('error', (error) => {
  console.log('❌ Login request error:', error.message);
});

loginReq.write(loginData);
loginReq.end();
