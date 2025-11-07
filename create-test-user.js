import dotenv from 'dotenv';
dotenv.config();

import mongoose from 'mongoose';
import { Resend } from 'resend';
import crypto from 'crypto';
import User from './models/User.js';
import Tenant from './models/Tenant.js';

const resend = new Resend(process.env.RESEND_API_KEY);

async function createTestUser() {
  try {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/did-optimizer');
    console.log('✅ Connected to MongoDB');

    // Check if user already exists
    let user = await User.findOne({ email: 'nick1@724c.com' });
    
    if (user) {
      console.log('⚠️ User already exists, updating verification token...');
      
      // Generate new verification token
      const emailVerificationToken = crypto.randomBytes(32).toString('hex');
      user.emailVerificationToken = emailVerificationToken;
      user.isEmailVerified = false;
      await user.save();
      
      console.log('✅ Updated user with new verification token');
      
      // Send verification email
      const frontendUrl = process.env.FRONTEND_URL || 'http://api3.amdy.io:5000';
      const verificationUrl = `${frontendUrl}/verify-email?token=${emailVerificationToken}`;

      const result = await resend.emails.send({
        from: process.env.FROM_EMAIL || 'DID Optimizer <noreply@amdy.io>',
        to: 'nick1@724c.com',
        subject: 'Verify your DID Optimizer account',
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2>Welcome to DID Optimizer, ${user.firstName}!</h2>
            <p>Thank you for registering. Please verify your email address by clicking the button below:</p>
            <a href="${verificationUrl}" style="display: inline-block; background-color: #4052B5; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; margin: 20px 0;">
              Verify Email Address
            </a>
            <p>Or copy and paste this link into your browser:</p>
            <p style="color: #666; word-break: break-all;">${verificationUrl}</p>
            <p style="color: #999; font-size: 12px; margin-top: 40px;">
              If you didn't create an account, you can safely ignore this email.
            </p>
          </div>
        `
      });

      console.log('✅ Verification email sent!');
      console.log('📧 Email ID:', result.data.id);
      console.log('🔗 Verification URL:', verificationUrl);
    } else {
      console.log('❌ User does not exist. Please register through the signup form first.');
    }

    await mongoose.connection.close();
    console.log('✅ Done');
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

createTestUser();
