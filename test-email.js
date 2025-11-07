import dotenv from 'dotenv';
dotenv.config();

import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

async function sendTestEmail() {
  try {
    console.log('📧 Sending test email...');
    console.log('API Key:', process.env.RESEND_API_KEY ? 'Configured ✅' : 'Missing ❌');
    console.log('From:', process.env.FROM_EMAIL);
    console.log('To: nick1@724c.com');
    
    const testToken = 'test-verification-token-123';
    const frontendUrl = process.env.FRONTEND_URL || 'http://api3.amdy.io:5000';
    const verificationUrl = `${frontendUrl}/verify-email?token=${testToken}`;

    const result = await resend.emails.send({
      from: process.env.FROM_EMAIL || 'DID Optimizer <noreply@amdy.io>',
      to: 'nick1@724c.com',
      subject: 'Test: Verify your DID Optimizer account',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2>Welcome to DID Optimizer, Nick!</h2>
          <p>This is a test email. Thank you for registering. Please verify your email address by clicking the button below:</p>
          <a href="${verificationUrl}" style="display: inline-block; background-color: #4052B5; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; margin: 20px 0;">
            Verify Email Address
          </a>
          <p>Or copy and paste this link into your browser:</p>
          <p style="color: #666; word-break: break-all;">${verificationUrl}</p>
          <p style="color: #999; font-size: 12px; margin-top: 40px;">
            This is a test email from the DID Optimizer system.
          </p>
        </div>
      `
    });

    console.log('✅ Email sent successfully!');
    console.log('📧 Result:', JSON.stringify(result, null, 2));
  } catch (error) {
    console.error('❌ Failed to send email:', error);
    console.error('Error details:', JSON.stringify(error, Object.getOwnPropertyNames(error), 2));
  }
}

sendTestEmail();
