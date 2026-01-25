import { Resend } from 'resend';

// Initialize Resend lazily to ensure env vars are loaded
let resend = null;
const getResend = () => {
  if (!resend && process.env.RESEND_API_KEY) {
    resend = new Resend(process.env.RESEND_API_KEY);
  }
  return resend;
};

const FROM_EMAIL = process.env.BILLING_EMAIL_FROM || 'billing@dids.amdy.io';

/**
 * Send invoice generated email
 */
export async function sendInvoiceEmail(invoice, tenant) {
  console.log(`📧 Sending invoice email for ${invoice.invoiceNumber} to ${tenant.name}...`);

  const emailTo = tenant.billing.emailForInvoices || (await getAdminEmail(tenant));

  try {
    const emailService = getResend();
    if (!emailService) {
      console.warn('⚠️ Resend not configured, skipping invoice email');
      return;
    }

    await emailService.emails.send({
      from: FROM_EMAIL,
      to: emailTo,
      subject: `Invoice ${invoice.invoiceNumber} - DID Optimizer Pro`,
      html: renderInvoiceTemplate(invoice, tenant)
    });

    // Update email sent timestamp
    invoice.metadata.emailSentAt = new Date();
    await invoice.save();

    console.log(`✅ Invoice email sent to ${emailTo}`);
  } catch (error) {
    console.error(`❌ Failed to send invoice email:`, error);
    // Don't throw - email failure shouldn't block billing
  }
}

/**
 * Send payment success email
 */
export async function sendPaymentSuccessEmail(invoice, tenant) {
  console.log(`📧 Sending payment success email for ${invoice.invoiceNumber}...`);

  const emailTo = tenant.billing.emailForInvoices || (await getAdminEmail(tenant));

  try {
    const emailService = getResend();
    if (!emailService) {
      console.warn('⚠️ Resend not configured, skipping payment success email');
      return;
    }

    await emailService.emails.send({
      from: FROM_EMAIL,
      to: emailTo,
      subject: `Payment Received - Invoice ${invoice.invoiceNumber}`,
      html: renderPaymentSuccessTemplate(invoice, tenant)
    });

    console.log(`✅ Payment success email sent`);
  } catch (error) {
    console.error(`❌ Failed to send payment success email:`, error);
  }
}

/**
 * Send payment failed email
 */
export async function sendPaymentFailedEmail(tenant, { attemptsRemaining, gracePeriodEnds, error }) {
  console.log(`📧 Sending payment failed email to ${tenant.name}...`);

  const emailTo = tenant.billing.emailForInvoices || (await getAdminEmail(tenant));

  try {
    const emailService = getResend();
    if (!emailService) {
      console.warn('⚠️ Resend not configured, skipping payment failed email');
      return;
    }

    await emailService.emails.send({
      from: FROM_EMAIL,
      to: emailTo,
      subject: '⚠️ Payment Failed - Action Required',
      html: renderPaymentFailedTemplate(tenant, { attemptsRemaining, gracePeriodEnds, error })
    });

    console.log(`✅ Payment failed email sent`);
  } catch (error) {
    console.error(`❌ Failed to send payment failed email:`, error);
  }
}

/**
 * Send account suspended email
 */
export async function sendAccountSuspendedEmail(tenant) {
  console.log(`📧 Sending account suspended email to ${tenant.name}...`);

  const emailTo = tenant.billing.emailForInvoices || (await getAdminEmail(tenant));

  try {
    const emailService = getResend();
    if (!emailService) {
      console.warn('⚠️ Resend not configured, skipping account suspended email');
      return;
    }

    await emailService.emails.send({
      from: FROM_EMAIL,
      to: emailTo,
      subject: '🚨 Account Suspended - Immediate Action Required',
      html: renderSuspensionTemplate(tenant)
    });

    console.log(`✅ Account suspended email sent`);
  } catch (error) {
    console.error(`❌ Failed to send suspension email:`, error);
  }
}

/**
 * Get admin email for tenant
 */
async function getAdminEmail(tenant) {
  const User = (await import('../../models/User.js')).default;
  const admin = await User.findOne({
    tenant: tenant._id,
    role: { $in: ['ADMIN', 'owner'] },
    isActive: true
  });

  return admin?.email || 'noreply@dids.amdy.io';
}

/**
 * Render invoice email template
 */
function renderInvoiceTemplate(invoice, tenant) {
  const formattedDate = new Date(invoice.createdAt).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });

  const dueDate = new Date(invoice.metadata.dueDate).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: #4052B5; color: white; padding: 20px; text-align: center; }
    .content { padding: 20px; background: #f9f9f9; }
    .invoice-details { background: white; padding: 20px; margin: 20px 0; border-radius: 8px; }
    .line-item { display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid #eee; }
    .total { font-size: 20px; font-weight: bold; color: #4052B5; padding-top: 15px; }
    .button { display: inline-block; padding: 12px 24px; background: #FF6208; color: white; text-decoration: none; border-radius: 5px; margin: 20px 0; }
    .footer { text-align: center; padding: 20px; color: #666; font-size: 12px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Invoice from DID Optimizer Pro</h1>
    </div>

    <div class="content">
      <p>Hello ${tenant.name},</p>
      <p>Your invoice for ${formattedDate} is ready.</p>

      <div class="invoice-details">
        <h2>Invoice ${invoice.invoiceNumber}</h2>
        <p><strong>Date:</strong> ${formattedDate}</p>
        <p><strong>Due Date:</strong> ${dueDate}</p>
        <p><strong>Billing Period:</strong> ${new Date(invoice.billingPeriod.start).toLocaleDateString()} - ${new Date(invoice.billingPeriod.end).toLocaleDateString()}</p>

        <hr>

        <div class="line-item">
          <span>${invoice.subscription.plan.charAt(0).toUpperCase() + invoice.subscription.plan.slice(1)} Plan</span>
          <span>$${invoice.subscription.baseFee.toFixed(2)}</span>
        </div>

        ${invoice.didCharges.extraDids > 0 ? `
        <div class="line-item">
          <span>${invoice.didCharges.extraDids} Additional DIDs × $${invoice.didCharges.perDidRate.toFixed(2)}</span>
          <span>$${invoice.didCharges.totalDidFee.toFixed(2)}</span>
        </div>
        ` : ''}

        ${invoice.amounts.tax > 0 ? `
        <div class="line-item">
          <span>Tax</span>
          <span>$${invoice.amounts.tax.toFixed(2)}</span>
        </div>
        ` : ''}

        <div class="line-item total">
          <span>Total</span>
          <span>$${invoice.amounts.total.toFixed(2)}</span>
        </div>
      </div>

      <div style="text-align: center;">
        <a href="https://dids.amdy.io/billing/invoices/${invoice._id}" class="button">View Invoice</a>
      </div>

      <p><strong>DID Usage This Period:</strong></p>
      <ul>
        <li>Active DIDs: ${invoice.didCharges.didCount}</li>
        <li>Included in Plan: ${invoice.didCharges.includedDids}</li>
        ${invoice.didCharges.extraDids > 0 ? `<li>Additional DIDs: ${invoice.didCharges.extraDids}</li>` : ''}
      </ul>

      ${tenant.billing.autoPayEnabled ? `
      <p>This invoice will be automatically charged to your payment method on file.</p>
      ` : `
      <p>Please pay this invoice by ${dueDate} to avoid service interruption.</p>
      `}
    </div>

    <div class="footer">
      <p>DID Optimizer Pro | ${FROM_EMAIL}</p>
      <p>Questions? Reply to this email or visit our <a href="https://dids.amdy.io/support">support page</a>.</p>
    </div>
  </div>
</body>
</html>
  `;
}

/**
 * Render payment success email template
 */
function renderPaymentSuccessTemplate(invoice, tenant) {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: #10b981; color: white; padding: 20px; text-align: center; }
    .content { padding: 20px; background: #f9f9f9; }
    .success-box { background: white; padding: 20px; margin: 20px 0; border-radius: 8px; border-left: 4px solid #10b981; }
    .button { display: inline-block; padding: 12px 24px; background: #4052B5; color: white; text-decoration: none; border-radius: 5px; margin: 20px 0; }
    .footer { text-align: center; padding: 20px; color: #666; font-size: 12px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>✅ Payment Received</h1>
    </div>

    <div class="content">
      <p>Hello ${tenant.name},</p>

      <div class="success-box">
        <h2>Thank you for your payment!</h2>
        <p><strong>Invoice:</strong> ${invoice.invoiceNumber}</p>
        <p><strong>Amount Paid:</strong> $${invoice.amounts.total.toFixed(2)}</p>
        <p><strong>Payment Date:</strong> ${new Date(invoice.paymentDetails.paidAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</p>
        <p><strong>Transaction ID:</strong> ${invoice.paymentDetails.transactionId}</p>
      </div>

      <p>Your account is in good standing and your service will continue uninterrupted.</p>

      <div style="text-align: center;">
        <a href="https://dids.amdy.io/billing/invoices/${invoice._id}" class="button">View Receipt</a>
      </div>
    </div>

    <div class="footer">
      <p>DID Optimizer Pro | ${FROM_EMAIL}</p>
      <p>Questions? Reply to this email or visit our <a href="https://dids.amdy.io/support">support page</a>.</p>
    </div>
  </div>
</body>
</html>
  `;
}

/**
 * Render payment failed email template
 */
function renderPaymentFailedTemplate(tenant, { attemptsRemaining, gracePeriodEnds, error }) {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: #f59e0b; color: white; padding: 20px; text-align: center; }
    .content { padding: 20px; background: #f9f9f9; }
    .warning-box { background: white; padding: 20px; margin: 20px 0; border-radius: 8px; border-left: 4px solid #f59e0b; }
    .button { display: inline-block; padding: 12px 24px; background: #FF6208; color: white; text-decoration: none; border-radius: 5px; margin: 20px 0; }
    .footer { text-align: center; padding: 20px; color: #666; font-size: 12px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>⚠️ Payment Failed</h1>
    </div>

    <div class="content">
      <p>Hello ${tenant.name},</p>

      <div class="warning-box">
        <h2>We were unable to process your payment</h2>
        <p><strong>Reason:</strong> ${error || 'Payment processing failed'}</p>
        <p><strong>Retry Attempts Remaining:</strong> ${attemptsRemaining}</p>
        <p><strong>Grace Period Ends:</strong> ${new Date(gracePeriodEnds).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</p>
      </div>

      <p><strong>What happens next?</strong></p>
      <ul>
        <li>We'll automatically retry your payment in 24 hours</li>
        <li>You have ${attemptsRemaining} retry attempts remaining</li>
        <li>Your service will continue during the grace period</li>
        <li>If all retries fail, your account will be suspended</li>
      </ul>

      <p><strong>How to fix this:</strong></p>
      <ol>
        <li>Update your payment method in the billing settings</li>
        <li>Ensure sufficient funds are available</li>
        <li>Check for expired credit cards</li>
        <li>Contact your bank if the issue persists</li>
      </ol>

      <div style="text-align: center;">
        <a href="https://dids.amdy.io/billing" class="button">Update Payment Method</a>
      </div>
    </div>

    <div class="footer">
      <p>DID Optimizer Pro | ${FROM_EMAIL}</p>
      <p>Questions? Reply to this email or visit our <a href="https://dids.amdy.io/support">support page</a>.</p>
    </div>
  </div>
</body>
</html>
  `;
}

/**
 * Render account suspension email template
 */
function renderSuspensionTemplate(tenant) {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: #ef4444; color: white; padding: 20px; text-align: center; }
    .content { padding: 20px; background: #f9f9f9; }
    .alert-box { background: white; padding: 20px; margin: 20px 0; border-radius: 8px; border-left: 4px solid #ef4444; }
    .button { display: inline-block; padding: 12px 24px; background: #FF6208; color: white; text-decoration: none; border-radius: 5px; margin: 20px 0; }
    .footer { text-align: center; padding: 20px; color: #666; font-size: 12px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>🚨 Account Suspended</h1>
    </div>

    <div class="content">
      <p>Hello ${tenant.name},</p>

      <div class="alert-box">
        <h2>Your account has been suspended</h2>
        <p><strong>Reason:</strong> ${tenant.subscription.gracePeriod.suspensionReason === 'payment_failed' ? 'Multiple failed payment attempts' : tenant.subscription.gracePeriod.suspensionReason}</p>
        <p><strong>Suspended On:</strong> ${new Date(tenant.subscription.gracePeriod.suspendedAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</p>
      </div>

      <p><strong>What this means:</strong></p>
      <ul>
        <li>Your DID optimization service is now inactive</li>
        <li>API access has been disabled</li>
        <li>No new calls will be routed through our system</li>
        <li>Your data is safe and will be retained for 30 days</li>
      </ul>

      <p><strong>How to restore your account:</strong></p>
      <ol>
        <li>Update your payment method</li>
        <li>Pay any outstanding invoices</li>
        <li>Contact our support team to reactivate</li>
      </ol>

      <div style="text-align: center;">
        <a href="https://dids.amdy.io/billing" class="button">Restore Account</a>
      </div>

      <p><strong>Need help?</strong> Our support team is ready to assist you in resolving this issue.</p>
    </div>

    <div class="footer">
      <p>DID Optimizer Pro | ${FROM_EMAIL}</p>
      <p>Questions? Reply to this email or call us at (555) 123-4567</p>
    </div>
  </div>
</body>
</html>
  `;
}

export default {
  sendInvoiceEmail,
  sendPaymentSuccessEmail,
  sendPaymentFailedEmail,
  sendAccountSuspendedEmail
};
