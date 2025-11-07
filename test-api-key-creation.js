import mongoose from 'mongoose';
import crypto from 'crypto';
import dotenv from 'dotenv';

dotenv.config();

// Connect to MongoDB
await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/did-optimizer');
console.log('✅ MongoDB connected');

// Define Tenant schema and model
const TenantSchema = new mongoose.Schema({
  name: String,
  domain: String,
  subdomain: String,
  isActive: Boolean,
  apiKeys: [{
    name: String,
    key: String,
    permissions: [String],
    isActive: Boolean,
    lastUsed: Date,
    createdAt: { type: Date, default: Date.now }
  }]
}, { collection: 'tenants' });

// Add generateApiKey method
TenantSchema.methods.generateApiKey = async function(name, permissions = ['read']) {
  const key = 'did_' + crypto.randomBytes(32).toString('hex');

  this.apiKeys.push({
    name,
    key,
    permissions,
    isActive: true,
    createdAt: new Date()
  });

  await this.save();
  return key;
};

const Tenant = mongoose.model('Tenant', TenantSchema);

// Find the tenant for client@test3.com
const tenant = await Tenant.findById('68c47dd70ec6f5323ce61817');
console.log('\n📌 Tenant found:', tenant.name);
console.log('📋 Current API keys:', tenant.apiKeys.length);

// Display existing API keys
console.log('\n🔑 Existing API Keys:');
tenant.apiKeys.forEach((key, index) => {
  console.log(`  ${index + 1}. ${key.name} - Active: ${key.isActive} - Created: ${key.createdAt}`);
  console.log(`     Key: ${key.key.substring(0, 20)}...`);
});

// Create a new API key
const newKeyName = 'Test API Key ' + Date.now();
const newKey = await tenant.generateApiKey(newKeyName, ['read', 'write']);

console.log('\n✅ New API Key Created:');
console.log('   Name:', newKeyName);
console.log('   Key:', newKey);
console.log('   Permissions: read, write');

// Verify it was saved
const updatedTenant = await Tenant.findById('68c47dd70ec6f5323ce61817');
console.log('\n📊 Total API keys after creation:', updatedTenant.apiKeys.length);

// Find the new key
const createdKey = updatedTenant.apiKeys.find(k => k.key === newKey);
if (createdKey) {
  console.log('✅ Key successfully saved to database');
  console.log('   ID:', createdKey._id);
  console.log('   Active:', createdKey.isActive);
}

await mongoose.disconnect();
console.log('\n👋 Done!');