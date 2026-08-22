// "Log in with PayPal" (Connect with PayPal) — OAuth 2.0 authorization-code flow.
// Mirrors the Google OAuth behavior in server-full.js exactly: find-or-create
// user + tenant by verified email, then issue the same JWT pair and redirect to
// ${FRONTEND_URL}/auth/callback?token=...&refresh=...
//
// PayPal app requirements (developer.paypal.com → the live app):
//   - "Log in with PayPal" enabled, with Email + Full name profile fields
//   - Return URL: https://dids.amdy.io/api/v1/auth/paypal/callback
import express from 'express';
import jsonwebtoken from 'jsonwebtoken';
import mongoose from 'mongoose';
import crypto from 'crypto';
import User from '../models/User.js';
import Tenant from '../models/Tenant.js';

const router = express.Router();

const PAYPAL_AUTH_BASE = () => process.env.PAYPAL_MODE === 'live'
  ? 'https://www.paypal.com'
  : 'https://www.sandbox.paypal.com';
const PAYPAL_API_BASE = () => process.env.PAYPAL_MODE === 'live'
  ? 'https://api-m.paypal.com'
  : 'https://api-m.sandbox.paypal.com';

const frontendUrl = () => process.env.FRONTEND_URL || 'https://dids.amdy.io';
const callbackUrl = () => `${frontendUrl()}/api/v1/auth/paypal/callback`;

// Short-lived signed state token (CSRF protection for the OAuth round-trip)
function makeState() {
  return jsonwebtoken.sign(
    { n: crypto.randomBytes(8).toString('hex'), purpose: 'paypal_oauth' },
    process.env.JWT_SECRET || 'default-secret',
    { expiresIn: '10m' }
  );
}
function verifyState(state) {
  try {
    const d = jsonwebtoken.verify(state, process.env.JWT_SECRET || 'default-secret');
    return d.purpose === 'paypal_oauth';
  } catch {
    return false;
  }
}

// @route GET /api/v1/auth/paypal — kick off the redirect to PayPal
router.get('/', (req, res) => {
  if (!process.env.PAYPAL_CLIENT_ID) {
    return res.status(503).json({ error: 'PayPal login not configured' });
  }
  const params = new URLSearchParams({
    flowEntry: 'static',
    client_id: process.env.PAYPAL_CLIENT_ID,
    response_type: 'code',
    // Minimal scope: 'profile' requires extra app-level approval and causes
    // PayPal to bounce back without a code when not granted. Name fields are
    // nice-to-have; email is what we key accounts on.
    scope: 'openid email',
    redirect_uri: callbackUrl(),
    state: makeState()
  });
  res.redirect(`${PAYPAL_AUTH_BASE()}/connect?${params.toString()}`);
});

// @route GET /api/v1/auth/paypal/callback — code exchange + login
router.get('/callback', async (req, res) => {
  const fail = (reason) => {
    console.error(`❌ PayPal OAuth failed: ${reason}`);
    return res.redirect(`${frontendUrl()}/login?error=paypal_auth_failed`);
  };

  try {
    const { code, state } = req.query;
    if (!code) {
      // PayPal reports WHY via query params — log them so failures are diagnosable
      return fail(`no code in callback — query: ${JSON.stringify(req.query)}`);
    }
    if (!state || !verifyState(state)) return fail('bad state (CSRF check)');

    // 1) Exchange authorization code for tokens
    const basic = Buffer.from(`${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`).toString('base64');
    const tokenRes = await fetch(`${PAYPAL_API_BASE()}/v1/oauth2/token`, {
      method: 'POST',
      headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'authorization_code', code: String(code) }).toString()
    });
    if (!tokenRes.ok) return fail(`token exchange ${tokenRes.status}: ${(await tokenRes.text()).slice(0, 200)}`);
    const tokens = await tokenRes.json();
    if (!tokens.access_token) return fail('no access_token in exchange response');

    // 2) Fetch the PayPal identity profile
    const uiRes = await fetch(`${PAYPAL_API_BASE()}/v1/identity/oauth2/userinfo?schema=paypalv1.1`, {
      headers: { Authorization: `Bearer ${tokens.access_token}` }
    });
    if (!uiRes.ok) return fail(`userinfo ${uiRes.status}`);
    const profile = await uiRes.json();

    const email = (
      profile.emails?.find(e => e.primary)?.value
      || profile.emails?.[0]?.value
      || profile.email
      || ''
    ).toLowerCase().trim();
    if (!email) return fail('PayPal returned no email — enable the Email field on the app\'s Log in with PayPal settings');

    const firstName = profile.given_name || (profile.name || '').split(' ')[0] || '';
    const lastName = profile.family_name || (profile.name || '').split(' ').slice(1).join(' ') || '';

    // 3) Find-or-create user + tenant (mirrors the Google OAuth branch)
    let user = await User.findOne({ email });
    if (!user) {
      const orgName = `${firstName} ${lastName}`.trim() || email.split('@')[0];
      const emailDomain = email.split('@')[1];
      const emailUsername = email.split('@')[0];
      const autoApiKey = 'did_' + crypto.randomBytes(32).toString('hex');

      const newTenant = new Tenant({
        name: `${orgName}'s Organization`,
        domain: `${emailUsername}.${emailDomain}`,
        isActive: true,
        apiKeys: [{
          _id: new mongoose.Types.ObjectId(),
          name: 'Default API Key',
          key: autoApiKey,
          isActive: true,
          createdAt: new Date(),
          lastUsed: null,
          permissions: ['read', 'write']
        }],
        rotationState: { currentIndex: 0, lastReset: new Date(), usedDidsInCycle: [] }
      });
      const savedTenant = await newTenant.save();
      console.log('✅ New tenant created via PayPal login:', savedTenant.name);

      user = new User({
        email,
        firstName: firstName || 'PayPal',
        lastName: lastName || 'User',
        // Schema requires a password unless googleId is set; PayPal users get a
        // random unusable one (they can use "forgot password" to set a real one).
        password: crypto.randomBytes(24).toString('hex'),
        role: 'CLIENT',
        tenant: savedTenant._id,
        tenantId: savedTenant._id,
        isActive: true,
        isEmailVerified: true, // PayPal-verified identity
        authProvider: 'paypal',
        paypalPayerId: profile.payer_id || undefined
      });
      await user.save();
      console.log('✅ New user created via PayPal login:', email);
    }

    if (!user.isActive) return fail(`user ${email} is deactivated`);

    // 4) Issue the same JWT pair the Google flow issues
    const accessToken = jsonwebtoken.sign(
      { id: user._id.toString(), email: user.email, firstName: user.firstName, lastName: user.lastName, role: user.role },
      process.env.JWT_SECRET || 'default-secret',
      { expiresIn: '7d' }
    );
    const refreshToken = jsonwebtoken.sign(
      { id: user._id.toString(), type: 'refresh' },
      process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET || 'default-refresh-secret',
      { expiresIn: '30d' }
    );

    console.log('🔐 PayPal login OK for', email);
    return res.redirect(`${frontendUrl()}/auth/callback?token=${accessToken}&refresh=${refreshToken}`);
  } catch (err) {
    return fail(err.message);
  }
});

export default router;
