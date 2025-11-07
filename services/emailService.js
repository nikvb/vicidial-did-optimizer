import { Resend } from 'resend';

let resend = null;

// Function to initialize Resend (called lazily when needed)
const initializeResend = () => {
  if (!resend && process.env.RESEND_API_KEY) {
    resend = new Resend(process.env.RESEND_API_KEY);
    console.log('✅ Resend email service initialized');
  } else if (!process.env.RESEND_API_KEY) {
    console.warn('⚠️  RESEND_API_KEY not found in environment variables. Email functionality will be disabled.');
  }
  return resend;
};

// Email templates
const emailTemplates = {
  emailVerification: {
    subject: 'Verify Your Email - DID Optimizer Pro',
    html: (data) => `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Verify Your Email</title>
        <style>
          body { font-family: Arial, sans-serif; margin: 0; padding: 0; background-color: #f8fafc; }
          .container { max-width: 600px; margin: 0 auto; background-color: white; }
          .header { background: linear-gradient(135deg, #2563eb 0%, #7c3aed 100%); padding: 40px 20px; text-align: center; }
          .header h1 { color: white; margin: 0; font-size: 28px; }
          .content { padding: 40px 20px; }
          .button { display: inline-block; background: #2563eb; color: white; padding: 15px 30px; text-decoration: none; border-radius: 8px; font-weight: bold; margin: 20px 0; }
          .footer { background: #1e293b; color: #94a3b8; padding: 20px; text-align: center; font-size: 14px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>DID Optimizer Pro</h1>
          </div>
          <div class="content">
            <h2>Welcome, ${data.firstName}!</h2>
            <p>Thank you for registering with DID Optimizer Pro. To complete your registration, please verify your email address by clicking the button below:</p>
            <a href="${data.verificationLink}" class="button">Verify Email Address</a>
            <p>If you didn't create an account with us, please ignore this email.</p>
            <p>This verification link will expire in 24 hours.</p>
          </div>
          <div class="footer">
            <p>&copy; 2024 DID Optimizer Pro. All rights reserved.</p>
          </div>
        </div>
      </body>
      </html>
    `
  },
  
  passwordReset: {
    subject: 'Password Reset - DID Optimizer Pro',
    html: (data) => `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Password Reset</title>
        <style>
          body { font-family: Arial, sans-serif; margin: 0; padding: 0; background-color: #f8fafc; }
          .container { max-width: 600px; margin: 0 auto; background-color: white; }
          .header { background: linear-gradient(135deg, #2563eb 0%, #7c3aed 100%); padding: 40px 20px; text-align: center; }
          .header h1 { color: white; margin: 0; font-size: 28px; }
          .content { padding: 40px 20px; }
          .button { display: inline-block; background: #dc2626; color: white; padding: 15px 30px; text-decoration: none; border-radius: 8px; font-weight: bold; margin: 20px 0; }
          .footer { background: #1e293b; color: #94a3b8; padding: 20px; text-align: center; font-size: 14px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>DID Optimizer Pro</h1>
          </div>
          <div class="content">
            <h2>Password Reset Request</h2>
            <p>Hello ${data.firstName},</p>
            <p>We received a request to reset your password. Click the button below to reset your password:</p>
            <a href="${data.resetLink}" class="button">Reset Password</a>
            <p>If you didn't request a password reset, please ignore this email.</p>
            <p>This reset link will expire in 10 minutes for security reasons.</p>
          </div>
          <div class="footer">
            <p>&copy; 2024 DID Optimizer Pro. All rights reserved.</p>
          </div>
        </div>
      </body>
      </html>
    `
  },

  welcome: {
    subject: 'Welcome to DID Optimizer Pro!',
    html: (data) => `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Welcome</title>
        <style>
          body { font-family: Arial, sans-serif; margin: 0; padding: 0; background-color: #f8fafc; }
          .container { max-width: 600px; margin: 0 auto; background-color: white; }
          .header { background: linear-gradient(135deg, #2563eb 0%, #7c3aed 100%); padding: 40px 20px; text-align: center; }
          .header h1 { color: white; margin: 0; font-size: 28px; }
          .content { padding: 40px 20px; }
          .button { display: inline-block; background: #2563eb; color: white; padding: 15px 30px; text-decoration: none; border-radius: 8px; font-weight: bold; margin: 20px 0; }
          .footer { background: #1e293b; color: #94a3b8; padding: 20px; text-align: center; font-size: 14px; }
          .feature { margin: 20px 0; padding: 15px; background: #f1f5f9; border-radius: 8px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>DID Optimizer Pro</h1>
          </div>
          <div class="content">
            <h2>Welcome aboard, ${data.firstName}!</h2>
            <p>Your account has been successfully verified and you're ready to start optimizing your DID management!</p>
            
            <div class="feature">
              <h3>🚀 Getting Started</h3>
              <p>Upload your DIDs, configure rotation rules, and start seeing improved answer rates immediately.</p>
            </div>
            
            <div class="feature">
              <h3>📊 Real-time Analytics</h3>
              <p>Monitor your performance with detailed analytics and predictive insights.</p>
            </div>
            
            <div class="feature">
              <h3>🔧 VICIdial Integration</h3>
              <p>Seamlessly integrate with your existing VICIdial setup using our API.</p>
            </div>
            
            <a href="${process.env.FRONTEND_URL}/dashboard" class="button">Go to Dashboard</a>
            
            <p>If you have any questions, our support team is here to help!</p>
          </div>
          <div class="footer">
            <p>&copy; 2024 DID Optimizer Pro. All rights reserved.</p>
          </div>
        </div>
      </body>
      </html>
    `
  }
};


export const sendEmail = async ({ to, subject, template, data, html, text }) => {
  try {
    // Initialize Resend if not already done
    const emailService = initializeResend();

    // Check if Resend is initialized
    if (!emailService) {
      console.warn('⚠️  Email service not initialized. Skipping email send.');
      return {
        id: 'mock-email-id',
        status: 'skipped',
        message: 'Email service not configured'
      };
    }

    let emailHtml = html;
    let emailSubject = subject;

    // Use template if specified
    if (template && emailTemplates[template]) {
      emailHtml = emailTemplates[template].html(data);
      emailSubject = emailSubject || emailTemplates[template].subject;
    }

    const emailData = {
      from: process.env.FROM_EMAIL || 'DID Optimizer <noreply@didoptimizer.com>',
      to: Array.isArray(to) ? to : [to],
      subject: emailSubject,
      html: emailHtml
    };

    // Add plain text if provided or extract from HTML
    if (text) {
      emailData.text = text;
    }

    const result = await emailService.emails.send(emailData);
    console.log('Email sent successfully via Resend:', result.id);
    return result;

  } catch (error) {
    console.error('Email sending failed:', error);
    throw error;
  }
};

// Helper function to extract text from HTML
const extractTextFromHtml = (html) => {
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
};

// Send bulk emails (for newsletters, announcements, etc.)
export const sendBulkEmail = async (recipients, { subject, template, data, html, text }) => {
  const results = [];
  const batchSize = 10; // Send in batches to avoid rate limiting
  
  for (let i = 0; i < recipients.length; i += batchSize) {
    const batch = recipients.slice(i, i + batchSize);
    
    const batchPromises = batch.map(recipient => 
      sendEmail({
        to: recipient.email,
        subject,
        template,
        data: { ...data, ...recipient },
        html,
        text
      }).catch(error => ({ error, recipient }))
    );
    
    const batchResults = await Promise.all(batchPromises);
    results.push(...batchResults);
    
    // Add delay between batches
    if (i + batchSize < recipients.length) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  
  return results;
};

// Validate email address
export const validateEmail = (email) => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};

// Email service health check
export const healthCheck = async () => {
  try {
    // Try to initialize Resend
    const emailService = initializeResend();

    if (!emailService) {
      return { status: 'warning', message: 'RESEND_API_KEY not configured - email functionality disabled' };
    }

    // Resend doesn't have a direct verify method, but we can check domains
    // For now, just verify the API key is present
    return { status: 'healthy', message: 'Resend email service is configured' };
  } catch (error) {
    return { status: 'unhealthy', message: error.message };
  }
};