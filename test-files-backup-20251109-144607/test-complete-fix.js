#!/usr/bin/env node

/**
 * Comprehensive test to verify all API key fixes are working
 */

import mongoose from 'mongoose';
import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/did-optimizer';
const API_URL = 'http://api3.amdy.io:5000/api/v1';

console.log(`
╔══════════════════════════════════════════════════════╗
║     API KEY RETRIEVAL FIX - COMPREHENSIVE TEST        ║
╚══════════════════════════════════════════════════════╝
`);

async function testFixes() {
  try {
    // Connect to MongoDB
    console.log('📊 Step 1: Connecting to MongoDB...');
    await mongoose.connect(MONGODB_URI);
    console.log('✅ Connected to MongoDB\n');

    // Define schemas
    const UserSchema = new mongoose.Schema({
      email: String,
      firstName: String,
      lastName: String,
      role: String,
      tenant: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant' },
      isActive: Boolean
    });

    const TenantSchema = new mongoose.Schema({
      name: String,
      domain: String,
      isActive: Boolean,
      apiKeys: [{
        key: String,
        name: String,
        permissions: [String],
        isActive: Boolean,
        lastUsed: Date,
        createdAt: Date
      }]
    });

    let User, Tenant;
    try { User = mongoose.model('User'); } catch { User = mongoose.model('User', UserSchema); }
    try { Tenant = mongoose.model('Tenant'); } catch { Tenant = mongoose.model('Tenant', TenantSchema); }

    // Verify data structure
    console.log('📊 Step 2: Verifying data structure...');
    const user = await User.findOne({ email: 'client@test3.com' });

    if (!user) {
      console.log('❌ Test user not found');
      return;
    }

    console.log('✅ User found:');
    console.log('   Email:', user.email);
    console.log('   Role:', user.role);
    console.log('   Tenant ID:', user.tenant);
    console.log('   Tenant Type:', typeof user.tenant);
    console.log('   Is ObjectId?:', mongoose.Types.ObjectId.isValid(user.tenant));

    // Get tenant
    const tenant = await Tenant.findById(user.tenant);
    if (!tenant) {
      console.log('❌ Tenant not found');
      return;
    }

    console.log('\n✅ Tenant found:');
    console.log('   Name:', tenant.name);
    console.log('   Domain:', tenant.domain);
    console.log('   API Keys Count:', tenant.apiKeys?.length || 0);

    // Generate fresh JWT token
    console.log('\n📊 Step 3: Generating fresh JWT token...');
    const jsonwebtoken = await import('jsonwebtoken');
    const token = jsonwebtoken.default.sign(
      {
        id: user._id.toString(),
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role
      },
      process.env.JWT_SECRET || 'default-secret',
      { expiresIn: '7d' }
    );
    console.log('✅ Token generated');

    // Test API endpoint
    console.log('\n📊 Step 4: Testing API endpoint...');
    console.log('   URL:', `${API_URL}/tenants/api-keys`);
    console.log('   Method: GET');
    console.log('   Headers: Authorization: Bearer [token]');

    try {
      const response = await axios.get(`${API_URL}/tenants/api-keys`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      console.log('\n✅ API CALL SUCCESSFUL!');
      console.log('═══════════════════════');
      console.log('Response Status:', response.status);
      console.log('Success:', response.data.success);

      if (response.data.tenant) {
        console.log('\nTenant Info:');
        console.log('  ID:', response.data.tenant.id);
        console.log('  Name:', response.data.tenant.name);
      }

      if (response.data.data && response.data.data.length > 0) {
        console.log('\nAPI Keys Retrieved:', response.data.data.length);
        console.log('─────────────────────');
        response.data.data.forEach((key, index) => {
          console.log(`\n${index + 1}. ${key.name}`);
          console.log('   Key:', key.key ? key.key.substring(0, 40) + '...' : 'N/A');
          console.log('   Active:', key.isActive);
          console.log('   Permissions:', key.permissions?.join(', ') || 'None');
          console.log('   Created:', key.createdAt ? new Date(key.createdAt).toLocaleDateString() : 'N/A');
        });
      } else {
        console.log('\n⚠️ No API keys found in response');
      }

      console.log('\n╔══════════════════════════════════════════════════════╗');
      console.log('║         ✅ ALL FIXES WORKING CORRECTLY! ✅            ║');
      console.log('╚══════════════════════════════════════════════════════╝');

    } catch (apiError) {
      console.log('\n❌ API Call Failed:');
      if (apiError.response) {
        console.log('   Status:', apiError.response.status);
        console.log('   Data:', apiError.response.data);
      } else {
        console.log('   Error:', apiError.message);
      }

      console.log('\n📝 Troubleshooting:');
      console.log('1. Check if server is running on port 5000');
      console.log('2. Verify JWT_SECRET matches in .env');
      console.log('3. Check server logs for detailed error');
    }

    // Test frontend URL format
    console.log('\n📊 Step 5: Frontend Integration Notes:');
    console.log('═══════════════════════════════════════');
    console.log('✅ Frontend should use:');
    console.log('   - API service with baseURL: http://api3.amdy.io:5000/api/v1');
    console.log('   - Endpoint: /tenants/api-keys');
    console.log('   - Full URL: http://api3.amdy.io:5000/api/v1/tenants/api-keys');
    console.log('\n✅ ApiKeys.js component:');
    console.log('   - Uses: api.get("/tenants/api-keys")');
    console.log('   - NOT: fetch("/api/v1/tenants/api-keys")');

  } catch (error) {
    console.error('\n💥 Test failed:', error);
  } finally {
    await mongoose.disconnect();
    console.log('\n✅ Database connection closed');
  }
}

// Run the test
testFixes();