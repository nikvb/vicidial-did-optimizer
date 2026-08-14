// Public, no-auth tools — designed as lead-gen surfaces.
// Currently: free DID Reputation Checker.

import express from 'express';
import rateLimit from 'express-rate-limit';
import reputationService from '../services/reputation-service.js';

const router = express.Router();

// 5 checks per IP per day — generous enough to demo, tight enough to prevent abuse.
// We deliberately don't share the global /api limiter because that one excludes the
// VICIdial server IP and we want public-tools rate-limited regardless of origin.
const checkLimiter = rateLimit({
  windowMs: 24 * 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'rate_limited',
    message: 'You\'ve used your 5 free checks for today. Sign up for unlimited lookups + bulk import.',
  },
});

/**
 * POST /api/v1/public/check-did
 * Body: { phoneNumber: string }
 * Returns: { phoneNumber, normalized, status, score, robokiller, blacklisted, lastChecked }
 *
 * No auth. IP rate-limited to 5/day. Always returns 200 on bad input with `error` field
 * to make the UI dead simple.
 */
router.post('/check-did', checkLimiter, async (req, res) => {
  const raw = (req.body?.phoneNumber || '').toString().trim();
  if (!raw) {
    return res.status(400).json({ error: 'missing_phone', message: 'phoneNumber is required' });
  }

  // Normalize: strip non-digits, drop leading 1
  const digits = raw.replace(/\D/g, '');
  const normalized = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
  if (normalized.length !== 10) {
    return res.status(400).json({
      error: 'invalid_phone',
      message: 'Enter a 10-digit US number (e.g. 4155551234 or +1 415 555 1234).',
    });
  }

  try {
    // Re-use the same reputation engine that powers the dialer — cached when warm,
    // fetched live when stale. This is the actual value-prop in action.
    const rep = await reputationService.getReputation(normalized, false);

    // Pick a public-safe subset. Don't leak internal IDs, checkCount, blacklistedAt, etc.
    const rk = rep?.robokillerData || {};
    const score = typeof rep?.reputationScore === 'number' ? rep.reputationScore : null;

    // Derive a user-friendly status from the score + RK status.
    let status = 'unknown';
    let summary = 'No reputation signal yet — number appears clean.';
    if (rep?.isBlacklisted) {
      status = 'blacklisted';
      summary = 'This number is currently flagged in our blacklist. It\'s being rested until reputation recovers.';
    } else if (rk.reputationStatus === 'Negative' || (score !== null && score < 30)) {
      status = 'negative';
      summary = 'Carriers and/or spam apps have flagged this number. Expect low answer rates.';
    } else if (rk.reputationStatus === 'Neutral' || (score !== null && score < 70)) {
      status = 'neutral';
      summary = 'Mixed signal. Number is usable but worth monitoring.';
    } else if (rk.reputationStatus === 'Positive' || (score !== null && score >= 70)) {
      status = 'positive';
      summary = 'Healthy reputation. Carrier-side and spam-app signals are clean.';
    }

    return res.json({
      phoneNumber: raw,
      normalized,
      status,
      summary,
      score,
      blacklisted: Boolean(rep?.isBlacklisted),
      robokiller: {
        reputationStatus: rk.reputationStatus || 'Unknown',
        robokillerStatus: rk.robokillerStatus || 'Unknown',
        spamScore: typeof rk.spamScore === 'number' ? rk.spamScore : null,
        userReports: rk.userReports || 0,
      },
      lastChecked: rep?.lastChecked || null,
    });
  } catch (err) {
    console.error('public-tools /check-did error:', err.message);
    return res.status(500).json({
      error: 'lookup_failed',
      message: 'Reputation lookup temporarily unavailable. Try again in a moment.',
    });
  }
});

// ---------------------------------------------------------------------------
// AI Concierge — OpenRouter-backed help assistant for the docs / help page.
// Grounded in the knowledge base below; instructed to stay on-topic and to
// escalate to support when unsure. No auth. IP rate-limited.
// ---------------------------------------------------------------------------

const conciergeLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 40,                  // 40 messages/IP/hour
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'rate_limited',
    reply: 'You\'ve hit the hourly limit for the assistant. Please email support@amdy.io or try again later.',
  },
});

const CONCIERGE_SYSTEM_PROMPT = `You are the DID Optimizer Concierge, the setup and support assistant for the VICIdial DID Optimizer (a phone-number rotation service for VICIdial call centers, at dids.amdy.io).

Answer ONLY questions about the DID Optimizer: installation, VICIdial integration, DID management, reputation, billing, and troubleshooting. If asked anything off-topic, briefly decline and steer back. Be concise, practical, and friendly. Use short paragraphs or bullet points. When you give a command, show it in a code block. Never invent features, prices, or endpoints that are not in the knowledge below — if you don't know, say so and point the user to support@amdy.io or https://dids.amdy.io/contact.

KNOWLEDGE BASE

WHAT IT IS
- Intelligent DID (caller-ID / phone number) rotation for VICIdial. Picks the best DID per outbound call using a per-tenant ML model, live reputation, carrier FAS signals, and local-presence area-code matching.
- VICIdial-native. No rip-and-replace. Installs in about a minute via one script.

INSTALL (run on the VICIdial server as root; API key from Settings -> API Keys):
  curl -fsSL https://download.amdy.io/install-agi.sh | sudo bash -s YOUR_API_KEY
The installer is idempotent (safe to re-run). It installs two AGI scripts, fetches /etc/asterisk/dids.conf with your key, writes a fail-open [did-optimizer] dialplan context and #includes it, injects the h hangup handler so call results report back, and reloads Asterisk.
After install, set fallback_did= (blank) in /etc/asterisk/dids.conf so failed lookups fall back cleanly to VICIdial's own caller ID.

VICIdial API USER (needed for campaign + DID sync via NON_AGENT API):
- User Level: 8
- Password: alphanumeric ONLY (VICIdial silently strips special characters like ! @ # $ &).
- User Group: a REAL group that has campaigns (e.g. ADMIN or MANAGERS). NOT ---ALL---.
- API options: Agent API Access = 1, API Only User = 1, API Allowed Functions = ALL_FUNCTIONS.
- Also enable: view_reports = 1, campaign_detail = 1, modify_inbound_dids = 1.
- Whitelist our IP 65.21.161.173 under Admin -> IP Lists.
Full guide: https://dids.amdy.io/docs/vicidial-api-user-setup.md

DIALPLAN (fail-open): the installer writes context [did-optimizer]. It sets CALLERID only when a real DID (>= 10 digits, not the placeholder) is returned; on any failure or timeout (capped at 3s) it leaves VICIdial's caller ID untouched, so a call is never blocked. Final step in VICIdial Admin: route the campaign's outbound calls into [did-optimizer], keeping the campaign's normal Outbound Caller ID as the fallback.

DID MANAGEMENT / UPLOADS: Add DIDs in the portal (DID Management) via Add DID, Bulk Upload (CSV), or Advanced Loader. Each upload can carry a Batch identifier (label) so you can filter and manage that group later. A Batch column and Batch filter appear in the DID table. You can Export Selected DIDs to CSV.

FREE DID REPUTATION CHECKER: A public tool on the site checks any US number's reputation (RoboKiller spam label + score) with no login. Limited to 5 checks/IP/day. Inside the portal, DID Management has an unlimited checker plus bulk import.

FCR / SPAM-LIKELY REGISTRATION: The Free Caller Registry (FCR) lets you register your numbers with the major analytics providers (First Orion, Hiya, TNS) that drive "Spam Likely" labels, to reduce mislabeling. The portal has an FCR section to manage these submissions.

VERIFY IT'S LIVE:
1. Settings -> VICIdial Integration -> Test Connection reports the VICIdial version.
2. Sync Campaigns / Sync DIDs return counts > 0.
3. Place a test call on a campaign routed into [did-optimizer]; it connects normally.

TROUBLESHOOTING
- "Synced 0 campaigns" / "0 campaigns visible": the API user is in the ---ALL--- placeholder group. Move it to a real group whose allowed_campaigns is -ALL-CAMPAIGNS- (e.g. ADMIN or MANAGERS).
- "Permission denied - grant campaigns_list": set view_reports = 1 on the API user AND on its user_group (the API checks both).
- "Invalid Username/Password" from the dialer: VICIdial stripped special characters from the password. Reset it using only letters and digits, then paste that exact string into Settings.
- Calls dial but the DID never changes: the campaign isn't routed into [did-optimizer], or fallback_did is non-empty. Fix routing and set fallback_did= empty.
- Reinstall / repair: re-run the install one-liner (idempotent).

HOW SELECTION WORKS: per-call scoring across (1) per-tenant ML model trained on your own AMD call outcomes and retrained nightly, (2) live RoboKiller reputation (flagged numbers avoided), (3) carrier FAS (burned DIDs auto-rested), (4) local presence (area-code/state match). If the model is disabled or the API is unreachable, selection falls back to VICIdial's normal caller-ID logic; no call is ever blocked.

SUPPORT: support@amdy.io or https://dids.amdy.io/contact.`;

/**
 * POST /api/v1/public/concierge
 * Body: { messages: [{ role: 'user'|'assistant', content: string }, ...] }
 * Returns: { reply: string }
 * No auth. IP rate-limited to 40 msgs/hour.
 */
router.post('/concierge', conciergeLimiter, async (req, res) => {
  // Prefer the dedicated concierge LLM config; fall back to the generic OpenRouter key.
  const apiKey = process.env.CONCIERGE_LLM_KEY || process.env.OPENROUTER_API_KEY;
  const apiUrl = (process.env.CONCIERGE_LLM_URL || 'https://openrouter.ai/api/v1').replace(/\/+$/, '') + '/chat/completions';
  const model = process.env.CONCIERGE_LLM_MODEL || process.env.OPENROUTER_MODEL || 'mistralai/mistral-7b-instruct:free';
  if (!apiKey) {
    return res.status(503).json({ error: 'unconfigured', reply: 'The assistant is not configured yet. Please email support@amdy.io.' });
  }

  const incoming = Array.isArray(req.body?.messages) ? req.body.messages : [];
  // Keep only well-formed user/assistant turns, cap length, cap size.
  const history = incoming
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .slice(-10)
    .map((m) => ({ role: m.role, content: m.content.slice(0, 2000) }));

  if (history.length === 0 || history[history.length - 1].role !== 'user') {
    return res.status(400).json({ error: 'no_message', reply: 'Ask me anything about setting up or using the DID Optimizer.' });
  }

  const messages = [{ role: 'system', content: CONCIERGE_SYSTEM_PROMPT }, ...history];

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30000);
    const r = await fetch(apiUrl, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://dids.amdy.io',
        'X-Title': 'DID Optimizer Concierge',
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: 0.3,
        max_tokens: 600,
      }),
    });
    clearTimeout(timer);

    if (!r.ok) {
      const body = await r.text().catch(() => '');
      console.error('concierge openrouter error:', r.status, body.slice(0, 300));
      return res.status(502).json({ error: 'upstream', reply: 'The assistant is briefly unavailable. Try again, or email support@amdy.io.' });
    }

    const data = await r.json();
    const reply = data?.choices?.[0]?.message?.content?.trim();
    if (!reply) {
      return res.status(502).json({ error: 'empty', reply: 'I couldn\'t generate a reply just now. Try rephrasing, or email support@amdy.io.' });
    }
    return res.json({ reply });
  } catch (err) {
    const msg = err.name === 'AbortError' ? 'timed out' : err.message;
    console.error('concierge error:', msg);
    return res.status(502).json({ error: 'failed', reply: 'The assistant is briefly unavailable. Try again, or email support@amdy.io.' });
  }
});

export default router;
