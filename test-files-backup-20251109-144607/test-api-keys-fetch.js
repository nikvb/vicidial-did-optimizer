#!/usr/bin/env node

/**
 * Test script to verify API keys fetch is working
 */

import axios from 'axios';

const API_URL = 'http://api3.amdy.io:5000/api/v1';

async function testApiKeys() {
  try {
    console.log('🔑 Testing API Keys Fetch\n');
    console.log('================================');

    // Step 1: Login to get fresh token
    console.log('1️⃣ Logging in as client@test3.com...');
    const loginResponse = await axios.post(`${API_URL}/auth/login`, {
      email: 'client@test3.com',
      password: 'password123'
    });

    if (!loginResponse.data.data?.tokens?.accessToken) {
      console.error('❌ Login failed - no token received');
      console.log('Login response:', loginResponse.data);
      return;
    }

    const token = loginResponse.data.data.tokens.accessToken;
    console.log('✅ Login successful!');
    console.log('   Token:', token.substring(0, 30) + '...');
    console.log('   User:', loginResponse.data.data.user.email);
    console.log('   Role:', loginResponse.data.data.user.role);

    // Step 2: Fetch API keys
    console.log('\n2️⃣ Fetching API keys...');
    const apiKeysResponse = await axios.get(`${API_URL}/tenants/api-keys`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });

    console.log('✅ API Keys fetched successfully!');
    console.log('\n📊 Response:');
    console.log('   Success:', apiKeysResponse.data.success);
    console.log('   Tenant:', apiKeysResponse.data.tenant?.name || 'N/A');
    console.log('   Total API Keys:', apiKeysResponse.data.data?.length || 0);

    if (apiKeysResponse.data.data && apiKeysResponse.data.data.length > 0) {
      console.log('\n🔑 API Keys List:');
      apiKeysResponse.data.data.forEach((key, index) => {
        console.log(`\n   ${index + 1}. ${key.name}`);
        console.log(`      Key: ${key.key.substring(0, 30)}...`);
        console.log(`      Active: ${key.isActive}`);
        console.log(`      Permissions: ${key.permissions.join(', ')}`);
        console.log(`      Created: ${new Date(key.createdAt).toLocaleDateString()}`);
        console.log(`      Last Used: ${key.lastUsed ? new Date(key.lastUsed).toLocaleDateString() : 'Never'}`);
      });
    } else {
      console.log('\n⚠️ No API keys found');
    }

    console.log('\n================================');
    console.log('✨ Test completed successfully!');

  } catch (error) {
    console.error('\n❌ Test failed!');
    if (error.response) {
      console.error('   Status:', error.response.status);
      console.error('   Message:', error.response.data?.message || error.response.statusText);
      console.error('   Data:', JSON.stringify(error.response.data, null, 2));
    } else {
      console.error('   Error:', error.message);
    }
  }
}

// Run the test
testApiKeys();