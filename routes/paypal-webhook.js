// PayPal webhook receiver — mounted in server-full.js BEFORE authentication
// (PayPal's POSTs carry no session; the old in-router stub 401'd before
// reaching its handler, so captures/denials/refunds were never processed).
//
// Security model (ported from the amdy.io implementation):
//   1. Body is read RAW — verification needs the exact bytes PayPal signed.
//   2. Signature verified against PayPal's /v1/notifications/verify-webhook-signature
//      using PAYPAL_WEBHOOK_ID. Unset webhook id => verification fails closed.
//   3. After a VERIFIED event, always return 200 even if our handler errors,
//      so PayPal doesn't retry forever; errors are logged for reconciliation.
//   4. Handlers are idempotent — dedupe on capture/refund id before mutating.
import express from 'express';
import Tenant from '../models/Tenant.js';
import Invoice from '../models/Invoice.js';

const router = express.Router();

function paypalApiBase() {
  return process.env.PAYPAL_MODE === 'live'
    ? 'https://api-m.paypal.com'
    : 'https://api-m.sandbox.paypal.com';
}

async function paypalAccessToken() {
  const auth = Buffer.from(`${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`).toString('base64');
  const res = await fetch(`${paypalApiBase()}/v1/oauth2/token`, {
    method: 'POST',
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials'
  });
  if (!res.ok) throw new Error(`PayPal OAuth failed: ${res.status}`);
  return (await res.json()).access_token;
}

/**
 * Verify a webhook delivery. Returns false (never throws) on any failure,
 * including a missing PAYPAL_WEBHOOK_ID — fail closed.
 */
async function verifyWebhookSignature(headers, rawBody) {
  const webhookId = process.env.PAYPAL_WEBHOOK_ID;
  if (!webhookId) {
    console.error('⚠️ PAYPAL_WEBHOOK_ID not set — webhook rejected (fail closed)');
    return false;
  }

  const required = ['paypal-transmission-id', 'paypal-transmission-time', 'paypal-cert-url', 'paypal-auth-algo', 'paypal-transmission-sig'];
  for (const h of required) {
    if (!headers[h]) return false;
  }

  try {
    const token = await paypalAccessToken();
    const res = await fetch(`${paypalApiBase()}/v1/notifications/verify-webhook-signature`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        transmission_id: headers['paypal-transmission-id'],
        transmission_time: headers['paypal-transmission-time'],
        cert_url: headers['paypal-cert-url'],
        auth_algo: headers['paypal-auth-algo'],
        transmission_sig: headers['paypal-transmission-sig'],
        webhook_id: webhookId,
        webhook_event: JSON.parse(rawBody)
      })
    });
    if (!res.ok) return false;
    const { verification_status } = await res.json();
    return verification_status === 'SUCCESS';
  } catch (err) {
    console.error('⚠️ Webhook verification error:', err.message);
    return false;
  }
}

/** Find the invoice referenced by a capture's invoice_id / custom_id. */
async function findInvoiceForCapture(resource) {
  const invoiceNumber = resource?.invoice_id
    || (resource?.custom_id?.match(/INV-\d{6}-\d{5}/) || [])[0];
  if (!invoiceNumber) return null;
  return Invoice.findOne({ invoiceNumber });
}

async function handleEvent(event) {
  const type = event.event_type;
  const resource = event.resource || {};

  switch (type) {
    case 'PAYMENT.CAPTURE.COMPLETED': {
      const invoice = await findInvoiceForCapture(resource);
      if (!invoice) { console.log(`📨 CAPTURE.COMPLETED ${resource.id}: no matching invoice — ignoring`); return; }
      // Idempotent: skip if this capture is already recorded
      if (invoice.status === 'paid' && invoice.paymentDetails?.transactionId === resource.id) return;
      if (invoice.status !== 'paid') {
        await invoice.markAsPaid(resource.id, invoice.paymentDetails?.paymentMethodId);
        console.log(`✅ Webhook: invoice ${invoice.invoiceNumber} marked paid (capture ${resource.id})`);
      }
      return;
    }

    case 'PAYMENT.CAPTURE.DENIED':
    case 'PAYMENT.CAPTURE.DECLINED': {
      const invoice = await findInvoiceForCapture(resource);
      if (!invoice) return;
      if (invoice.status !== 'failed') {
        await invoice.markAsFailed(`PayPal webhook: capture ${resource.id} ${type.split('.').pop()}`);
        console.log(`❌ Webhook: invoice ${invoice.invoiceNumber} marked failed (capture ${resource.id})`);
      }
      return;
    }

    case 'PAYMENT.CAPTURE.REFUNDED':
    case 'PAYMENT.CAPTURE.REVERSED': {
      const invoice = await findInvoiceForCapture(resource);
      if (!invoice) { console.log(`📨 ${type} ${resource.id}: no matching invoice — needs manual reconciliation`); return; }
      if (invoice.status !== 'refunded') {
        invoice.status = 'refunded';
        invoice.paymentDetails.failureReason = `Refunded/reversed via PayPal (${resource.id})`;
        await invoice.save();
        const tenant = await Tenant.findById(invoice.tenantId);
        if (tenant) {
          tenant.billing.totalPaid = Math.max(0, (tenant.billing.totalPaid || 0) - (invoice.amounts?.total || 0));
          await tenant.save();
        }
        console.log(`↩️ Webhook: invoice ${invoice.invoiceNumber} marked refunded`);
      }
      return;
    }

    case 'VAULT.PAYMENT-TOKEN.DELETED': {
      const tokenId = resource.id;
      if (!tokenId) return;
      const tenant = await Tenant.findOne({ 'billing.paymentMethods.vaultId': tokenId });
      if (!tenant) return;
      const pm = tenant.billing.paymentMethods.find(m => m.vaultId === tokenId);
      if (pm && pm.isActive) {
        pm.isActive = false;
        await tenant.save();
        console.log(`🗑️ Webhook: payment method ${pm.last4 ? '****' + pm.last4 : tokenId} deactivated for ${tenant.name} (vault token deleted)`);
      }
      return;
    }

    default:
      console.log(`📨 PayPal webhook: unhandled event ${type} — acknowledged`);
  }
}

// Raw body parser scoped to this route only.
router.post('/', express.raw({ type: '*/*' }), async (req, res) => {
  const rawBody = req.body instanceof Buffer ? req.body.toString('utf8') : JSON.stringify(req.body || {});

  const verified = await verifyWebhookSignature(req.headers, rawBody);
  if (!verified) {
    return res.status(401).json({ received: false, error: 'signature verification failed' });
  }

  let event;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return res.status(400).json({ received: false, error: 'invalid JSON' });
  }

  try {
    await handleEvent(event);
  } catch (err) {
    // Verified event, handler failed: log loudly but still 200 so PayPal
    // doesn't retry forever. Reconcile from logs.
    console.error(`💥 Webhook handler error for ${event.event_type}: ${err.message}`);
  }

  return res.status(200).json({ received: true });
});

export default router;
