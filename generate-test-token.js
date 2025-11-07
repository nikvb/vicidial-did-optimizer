#!/usr/bin/env node

/**
 * Generate a fresh JWT token for testing
 */

import mongoose from 'mongoose';
import jsonwebtoken from 'jsonwebtoken';
import dotenv from 'dotenv';

dotenv.config();

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/did-optimizer';

async function generateToken() {
  try {
    await mongoose.connect(MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    // Get User model
    const UserSchema = new mongoose.Schema({
      email: String,
      firstName: String,
      lastName: String,
      role: String,
      tenant: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant' }
    });

    let User;
    try {
      User = mongoose.model('User');
    } catch {
      User = mongoose.model('User', UserSchema);
    }

    // Find the test user
    const user = await User.findOne({ email: 'client@test3.com' });

    if (!user) {
      console.error('❌ User not found');
      process.exit(1);
    }

    console.log('👤 User found:', user.email);

    // Generate fresh token
    const token = jsonwebtoken.sign(
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

    console.log('\n✅ Fresh JWT Token Generated:');
    console.log('================================');
    console.log(token);
    console.log('================================');
    console.log('\nUse this token in Authorization header:');
    console.log('Authorization: Bearer', token);

    // Test the API endpoint with this token
    console.log('\n📋 Test Command:');
    console.log(`curl -X GET "http://api3.amdy.io:5000/api/v1/tenants/api-keys" -H "Authorization: Bearer ${token}"`);

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await mongoose.disconnect();
  }
}

generateToken();