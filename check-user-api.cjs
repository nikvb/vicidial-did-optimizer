const mongoose = require('mongoose');

// MongoDB connection
const MONGODB_URI = 'mongodb://127.0.0.1:27017/did-optimizer';

// Define schemas to match server-full.js
const userSchema = new mongoose.Schema({
  email: String,
  password: String,
  firstName: String,
  lastName: String,
  role: String,
  isActive: Boolean,
  isEmailVerified: Boolean,
  lastLogin: Date,
  tenant: String,
  tenantId: mongoose.Schema.Types.ObjectId,
  googleId: String,
  name: String,
  photo: String
}, { timestamps: true });

const tenantSchema = new mongoose.Schema({
  name: String,
  domain: String,
  isActive: Boolean,
  plan: String,
  apiKeys: [{
    key: String,
    name: String,
    permissions: [String],
    isActive: Boolean,
    createdAt: Date,
    lastUsed: Date,
    expiresAt: Date
  }],
  rotationState: {
    currentIndex: Number,
    lastReset: Date,
    usedDidsInCycle: [String]
  },
  settings: Object,
  createdBy: mongoose.Schema.Types.ObjectId
}, { timestamps: true });

const apiKeySchema = new mongoose.Schema({
  tenantId: mongoose.Schema.Types.ObjectId,
  key: String,
  name: String,
  permissions: [String],
  isActive: Boolean,
  lastUsed: Date,
  expiresAt: Date,
  createdBy: mongoose.Schema.Types.ObjectId
}, { timestamps: true });

async function checkUserAndAPI() {
  try {
    console.log('🔍 Connecting to MongoDB...');
    await mongoose.connect(MONGODB_URI);
    console.log('✅ Connected to MongoDB\n');

    // Get or create models
    let User, Tenant, ApiKey;

    try {
      User = mongoose.model('User');
    } catch {
      User = mongoose.model('User', userSchema);
    }

    try {
      Tenant = mongoose.model('Tenant');
    } catch {
      Tenant = mongoose.model('Tenant', tenantSchema);
    }

    try {
      ApiKey = mongoose.model('ApiKey');
    } catch {
      ApiKey = mongoose.model('ApiKey', apiKeySchema);
    }

    const EMAIL = 'client@test3.com';

    console.log('====================================');
    console.log(`📧 Checking for user: ${EMAIL}`);
    console.log('====================================\n');

    // 1. Check if user exists
    const user = await User.findOne({ email: EMAIL }).lean();

    if (user) {
      console.log('✅ USER FOUND!');
      console.log('User Details:');
      console.log('  ID:', user._id);
      console.log('  Email:', user.email);
      console.log('  Name:', user.firstName, user.lastName);
      console.log('  Role:', user.role || 'Not set');
      console.log('  Active:', user.isActive);
      console.log('  Email Verified:', user.isEmailVerified);
      console.log('  Last Login:', user.lastLogin || 'Never');
      console.log('  Tenant ID:', user.tenant || user.tenantId || 'Not assigned');
      console.log('  Created:', user.createdAt || 'Unknown');
      console.log('');

      // 2. Check for tenant if user has one
      if (user.tenant || user.tenantId) {
        const tenantId = user.tenant || user.tenantId;
        console.log('🏢 Checking tenant information...');

        const tenant = await Tenant.findById(tenantId).lean();
        if (tenant) {
          console.log('✅ TENANT FOUND!');
          console.log('Tenant Details:');
          console.log('  ID:', tenant._id);
          console.log('  Name:', tenant.name);
          console.log('  Domain:', tenant.domain);
          console.log('  Plan:', tenant.plan || 'Not set');
          console.log('  Active:', tenant.isActive);
          console.log('');

          // Check for API keys in tenant
          if (tenant.apiKeys && tenant.apiKeys.length > 0) {
            console.log('🔑 API KEYS FOUND IN TENANT:');
            tenant.apiKeys.forEach((apiKey, index) => {
              console.log(`  Key ${index + 1}:`);
              console.log(`    Name: ${apiKey.name}`);
              console.log(`    Key: ${apiKey.key}`);
              console.log(`    Active: ${apiKey.isActive}`);
              console.log(`    Permissions: ${apiKey.permissions?.join(', ') || 'None'}`);
              console.log(`    Created: ${apiKey.createdAt}`);
              console.log(`    Last Used: ${apiKey.lastUsed || 'Never'}`);
              console.log('');
            });
          } else {
            console.log('❌ No API keys found in tenant document');
          }
        } else {
          console.log('❌ Tenant not found with ID:', tenantId);
        }
      } else {
        console.log('⚠️ User has no tenant assigned');
      }

      // 3. Check for standalone API keys
      console.log('\n🔍 Checking for standalone API keys...');
      const apiKeys = await ApiKey.find({
        $or: [
          { createdBy: user._id },
          { tenantId: user.tenant || user.tenantId }
        ]
      }).lean();

      if (apiKeys && apiKeys.length > 0) {
        console.log('✅ STANDALONE API KEYS FOUND:');
        apiKeys.forEach((apiKey, index) => {
          console.log(`  Key ${index + 1}:`);
          console.log(`    Name: ${apiKey.name}`);
          console.log(`    Key: ${apiKey.key}`);
          console.log(`    Active: ${apiKey.isActive}`);
          console.log(`    Tenant ID: ${apiKey.tenantId}`);
          console.log(`    Permissions: ${apiKey.permissions?.join(', ') || 'None'}`);
          console.log(`    Created: ${apiKey.createdAt}`);
          console.log(`    Last Used: ${apiKey.lastUsed || 'Never'}`);
          console.log('');
        });
      } else {
        console.log('❌ No standalone API keys found');
      }

    } else {
      console.log(`❌ USER NOT FOUND: ${EMAIL}`);
      console.log('\n📊 Checking all users in database...');

      const allUsers = await User.find({}, 'email firstName lastName role').lean();
      console.log(`Total users in database: ${allUsers.length}`);

      if (allUsers.length > 0) {
        console.log('\nExisting users:');
        allUsers.forEach((u, index) => {
          console.log(`  ${index + 1}. ${u.email} - ${u.firstName || ''} ${u.lastName || ''} (${u.role || 'No role'})`);
        });
      } else {
        console.log('Database has no users yet.');
      }
    }

    // 4. Check environment API key
    console.log('\n====================================');
    console.log('🔐 Environment API Key Check');
    console.log('====================================');

    const envApiKey = process.env.API_KEY;
    if (envApiKey) {
      console.log('✅ API_KEY found in environment:');
      console.log(`   ${envApiKey.substring(0, 10)}...${envApiKey.substring(envApiKey.length - 10)}`);
    } else {
      console.log('❌ No API_KEY set in environment variables');

      // Check .env file
      const fs = require('fs');
      const path = require('path');
      const envPath = path.join(__dirname, '.env');

      if (fs.existsSync(envPath)) {
        const envContent = fs.readFileSync(envPath, 'utf8');
        const apiKeyMatch = envContent.match(/API_KEY=(.+)/);
        if (apiKeyMatch) {
          console.log('✅ API_KEY found in .env file:');
          const key = apiKeyMatch[1];
          console.log(`   ${key.substring(0, 10)}...${key.substring(key.length - 10)}`);
        }
      }
    }

    // 5. Summary statistics
    console.log('\n====================================');
    console.log('📊 Database Statistics');
    console.log('====================================');

    const userCount = await User.countDocuments();
    const tenantCount = await Tenant.countDocuments();
    const apiKeyCount = await ApiKey.countDocuments();

    // Check DIDs
    let DID;
    try {
      DID = mongoose.model('DID');
    } catch {
      DID = mongoose.model('DID', new mongoose.Schema({
        tenantId: String,
        phoneNumber: String,
        status: String
      }));
    }
    const didCount = await DID.countDocuments();

    console.log(`  Total Users: ${userCount}`);
    console.log(`  Total Tenants: ${tenantCount}`);
    console.log(`  Total API Keys: ${apiKeyCount}`);
    console.log(`  Total DIDs: ${didCount}`);

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await mongoose.connection.close();
    console.log('\n✅ Database connection closed');
  }
}

// Run the check
checkUserAndAPI();