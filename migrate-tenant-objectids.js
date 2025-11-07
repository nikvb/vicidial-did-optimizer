#!/usr/bin/env node

/**
 * Migration script to convert User.tenant from String to ObjectId
 * This ensures data consistency after updating the schema
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/did-optimizer';

// Define schemas to match server-full.js
const UserSchema = new mongoose.Schema({
  email: String,
  password: String,
  firstName: String,
  lastName: String,
  role: String,
  isActive: Boolean,
  isEmailVerified: Boolean,
  lastLogin: Date,
  tenant: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant' },
  googleId: String,
  googlePhoto: String,
  createdAt: Date
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
  }],
  rotationState: {
    currentIndex: Number,
    lastReset: Date,
    usedDidsInCycle: [String]
  }
});

async function migrate() {
  try {
    console.log('🔌 Connecting to MongoDB...');
    await mongoose.connect(MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    // Get or create models
    let User, Tenant;

    try {
      User = mongoose.model('User');
    } catch {
      User = mongoose.model('User', UserSchema);
    }

    try {
      Tenant = mongoose.model('Tenant');
    } catch {
      Tenant = mongoose.model('Tenant', TenantSchema);
    }

    console.log('\n📊 Starting migration...\n');

    // Get all users
    const users = await User.find({}).lean();
    console.log(`Found ${users.length} users to check`);

    let migratedCount = 0;
    let alreadyCorrectCount = 0;
    let noTenantCount = 0;
    let errorCount = 0;

    for (const user of users) {
      try {
        // Skip if no tenant
        if (!user.tenant) {
          console.log(`⚠️ User ${user.email} has no tenant - skipping`);
          noTenantCount++;
          continue;
        }

        // Check if tenant is already an ObjectId
        if (mongoose.Types.ObjectId.isValid(user.tenant) && typeof user.tenant === 'object') {
          console.log(`✓ User ${user.email} already has ObjectId tenant`);
          alreadyCorrectCount++;
          continue;
        }

        // Convert string to ObjectId
        if (typeof user.tenant === 'string') {
          console.log(`🔄 Converting tenant for user ${user.email} from String to ObjectId`);

          // Verify the tenant exists
          const tenantExists = await Tenant.findById(user.tenant);
          if (!tenantExists) {
            console.log(`  ❌ Tenant ${user.tenant} not found for user ${user.email}`);
            errorCount++;
            continue;
          }

          // Update the user
          await User.updateOne(
            { _id: user._id },
            { $set: { tenant: mongoose.Types.ObjectId(user.tenant) } }
          );

          console.log(`  ✅ Successfully migrated user ${user.email}`);
          migratedCount++;
        }
      } catch (error) {
        console.error(`  ❌ Error processing user ${user.email}:`, error.message);
        errorCount++;
      }
    }

    console.log('\n📈 Migration Summary:');
    console.log('═══════════════════════════');
    console.log(`✅ Successfully migrated: ${migratedCount} users`);
    console.log(`✓  Already correct: ${alreadyCorrectCount} users`);
    console.log(`⚠️  No tenant: ${noTenantCount} users`);
    console.log(`❌ Errors: ${errorCount} users`);
    console.log(`📊 Total processed: ${users.length} users`);

    // Verify the migration
    console.log('\n🔍 Verifying migration...');
    const stringTenants = await User.find({
      tenant: { $type: 'string' }
    }).countDocuments();

    if (stringTenants > 0) {
      console.log(`⚠️ Warning: ${stringTenants} users still have string tenant IDs`);
    } else {
      console.log('✅ All users have proper ObjectId tenant references');
    }

  } catch (error) {
    console.error('💥 Migration failed:', error);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    console.log('\n✅ Database connection closed');
  }
}

// Run the migration
migrate().then(() => {
  console.log('\n✨ Migration completed successfully');
  process.exit(0);
}).catch((error) => {
  console.error('\n💥 Migration failed:', error);
  process.exit(1);
});