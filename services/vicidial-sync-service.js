/**
 * VICIdial DID Inventory Sync Service
 *
 * Pulls DID inventory from a tenant's VICIdial server via the NON_AGENT API
 * and reconciles it against the didapi DID collection for that tenant.
 *
 * --- IMPORTANT VICIdial API REALITY CHECK ---
 *
 * Canonical VICIdial 2.14+ (vicidial.org / inktel fork) NON_AGENT API does
 * NOT ship a "list all DIDs" function. Verified by reading the source:
 *   - https://raw.githubusercontent.com/inktel/Vicidial/master/www/vicidial/non_agent_api.php
 *   - https://vicidial.org/docs/NON-AGENT_API.txt
 *
 * Functions present that touch DIDs:
 *   - did_log_export   — exports vicidial_did_log rows (the inbound CALL log)
 *   - add_did          — adds a row to vicidial_inbound_dids   (some forks)
 *   - update_did       — updates a row in vicidial_inbound_dids (some forks)
 *   - phone_number_log — call history for a given phone number (some forks)
 *
 * There is NO did_list / list_dids / in_dids_export function in the
 * canonical source. Some commercial forks (masterfermin02 wrapper docs, etc.)
 * mention add_did/update_did but still no inventory list.
 *
 * Because of this we offer two sync modes:
 *
 *   1) 'did_log_discovery' (DEFAULT, works on every VICIdial install)
 *      Calls did_log_export over a lookback window (configurable, default
 *      30 days), parses the pipe-delimited response, and treats every
 *      unique caller_id_number value as a DID that exists on the
 *      customer's server.
 *      Limitation: only finds DIDs that have RECEIVED inbound traffic in
 *      the window. Completely idle DIDs are invisible.
 *
 *   2) 'api_list' (OPT-IN, requires custom fork)
 *      Calls a customer-configured function name (didSyncApiListFunction
 *      on VICIdialSetting). We do NOT hardcode a function name because
 *      none exists upstream. If the function name is empty or VICIdial
 *      returns ERROR, we surface the error to the user.
 *      Expected response: pipe-delimited rows where column 1 is the DID.
 *
 * The service NEVER deletes DIDs — it marks missing ones as inactive so
 * the customer can re-activate manually if discovery missed them.
 */

import axios from 'axios';
import https from 'https';
import mongoose from 'mongoose';

import VICIdialSetting from '../models/VICIdialSetting.js';
import DID from '../models/DID.js';
import Tenant from '../models/Tenant.js';
import User from '../models/User.js';
import AuditLog from '../models/AuditLog.js';

const HTTPS_AGENT = new https.Agent({ rejectUnauthorized: false });
const HTTP_TIMEOUT_MS = 30_000;

/**
 * Build the non_agent_api.php URL from a hostname (allows full URL or host).
 */
function buildApiUrl(hostname) {
  if (!hostname) return null;
  const trimmed = hostname.trim().replace(/\/+$/, '');
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    return `${trimmed}/vicidial/non_agent_api.php`;
  }
  return `https://${trimmed}/vicidial/non_agent_api.php`;
}

/**
 * Heuristic check for ERROR / auth / IP-block responses from VICIdial.
 * Returns a normalized { code, message } object if it's an error, else null.
 */
function detectApiError(rawBody) {
  if (!rawBody || typeof rawBody !== 'string') return null;
  const body = rawBody.trim();

  // Bad credentials. VICIdial echoes the password back, so we don't pass
  // the body through to the user verbatim.
  if (body.includes('Login incorrect') || body.includes('|BAD|')) {
    return { code: 'AUTH', message: 'VICIdial rejected the username/password.' };
  }
  if (body.includes('IP NOT IN ALLOWED LIST') || body.includes('ip_address NOT ALLOWED')) {
    return { code: 'IP_NOT_ALLOWED', message: 'Our server IP is not in the VICIdial API allowed list.' };
  }
  if (body.includes('USER DOES NOT HAVE PERMISSION') || body.includes('PERMISSION')) {
    return { code: 'PERMISSION', message: 'The VICIdial API user is missing the permission required for this function.' };
  }
  // VICIdial returns lines that start with ERROR: ... — but did_log_export
  // legitimately returns "NOTICE:" preambles, so we only fail on a leading ERROR.
  const firstLine = body.split('\n', 1)[0] || '';
  if (/^ERROR:/i.test(firstLine.trim())) {
    return { code: 'API_ERROR', message: firstLine.trim().slice(0, 200) };
  }
  return null;
}

/**
 * Format a Date as VICIdial-friendly YYYY-MM-DD.
 */
function toYMD(d) {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Normalize a phone number coming from VICIdial into the same shape we
 * store in the DID collection. VICIdial DIDs are usually stored as bare
 * 10-digit NANP numbers (e.g. "4155551234") or with leading 1 ("14155551234").
 * The DID model match regex is permissive (`/^[\+]?[1-9][\d\s\-()]*$/`), but
 * the {phoneNumber, tenantId} unique index means we need a stable format.
 *
 * Rule: strip everything non-digit, then return:
 *   - "+1XXXXXXXXXX" for 10 or 11 digit NANP
 *   - "+XXXXXXXXXXX" for anything else >= 8 digits
 *   - null for garbage
 */
export function normalizePhoneNumber(raw) {
  if (!raw) return null;
  const digits = String(raw).replace(/\D/g, '');
  if (digits.length < 8) return null;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return `+${digits}`;
}

/**
 * Parse a pipe-delimited body from VICIdial.
 * Skips the SUCCESS:/NOTICE: header line and any blank lines.
 * Returns an array of arrays (one inner array per data row).
 */
export function parsePipeDelimited(body) {
  if (!body || typeof body !== 'string') return [];
  const lines = body.split(/\r?\n/);
  const rows = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    // Skip status header lines.
    if (/^(SUCCESS|NOTICE|ERROR):/i.test(trimmed)) continue;
    // Skip a header row when present (column names contain '_id').
    if (!trimmed.includes('|')) continue;
    rows.push(trimmed.split('|'));
  }
  return rows;
}

/**
 * From a did_log_export response, return a deduped list of normalized DID
 * phone numbers. did_log_export columns vary by VICIdial version; we look
 * for the caller_id_number column which holds the DID that was dialed.
 *
 * Documented header (vicidial 2.14): uniqueid|caller_id|call_date|...
 * In practice the field that maps to the DID number is `caller_id_number`
 * (or `caller_id` depending on stage=tab vs csv vs pipe). We accept either.
 */
export function extractDidsFromDidLog(body) {
  if (!body || typeof body !== 'string') return [];
  const lines = body.split(/\r?\n/);
  let headerIdx = -1;
  let dataLines = [];

  // Find header line (contains "caller_id" and pipes).
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (!t) continue;
    if (/^(SUCCESS|NOTICE):/i.test(t)) continue;
    if (t.includes('|') && /caller_id/i.test(t)) {
      headerIdx = i;
      dataLines = lines.slice(i + 1);
      break;
    }
  }

  let headers = null;
  if (headerIdx >= 0) {
    headers = lines[headerIdx].trim().split('|').map(h => h.trim().toLowerCase());
  } else {
    // No header — assume the response is pure data rows where the DID is
    // in column 2 (uniqueid|caller_id_number|call_date|...).
    dataLines = lines.filter(l => l.trim() && l.includes('|'));
  }

  const colIdx = (() => {
    if (!headers) return 1; // fallback
    // Prefer caller_id_number, then caller_id.
    const preferred = ['caller_id_number', 'callerid_number', 'caller_id'];
    for (const name of preferred) {
      const i = headers.indexOf(name);
      if (i !== -1) return i;
    }
    return 1; // last-ditch fallback
  })();

  const set = new Set();
  for (const line of dataLines) {
    const t = line.trim();
    if (!t || !t.includes('|')) continue;
    if (/^(SUCCESS|NOTICE|ERROR):/i.test(t)) continue;
    const cols = t.split('|');
    const candidate = cols[colIdx];
    const normalized = normalizePhoneNumber(candidate);
    if (normalized) set.add(normalized);
  }
  return [...set];
}

/**
 * For api_list mode: parse customer-supplied list response. We expect the
 * DID to be in column 1 of each pipe-delimited row. Description is taken
 * from column 2 if present.
 */
export function parseApiListResponse(body) {
  const rows = parsePipeDelimited(body);
  const out = [];
  const seen = new Set();
  for (const row of rows) {
    // Skip header rows: every column looks like a column name (lowercase
    // ascii with underscores, no digits-only fields).
    const looksLikeHeader = row.every(c => /^[a-z_][a-z0-9_]*$/i.test((c || '').trim()));
    if (looksLikeHeader) continue;
    const phone = normalizePhoneNumber(row[0]);
    if (!phone || seen.has(phone)) continue;
    seen.add(phone);
    out.push({
      phoneNumber: phone,
      description: (row[1] || '').toString().trim().slice(0, 200),
    });
  }
  return out;
}

/**
 * Internal: HTTP GET against non_agent_api.php with VICIdial standard
 * params merged in. Throws on network error; returns { status, data }.
 */
async function vicidialApiCall(settings, params) {
  const url = buildApiUrl(settings.hostname);
  if (!url) throw new Error('VICIdial hostname not configured');
  const merged = {
    user: settings.username,
    pass: settings.password,
    source: 'didoptimizer-sync',
    stage: 'pipe',
    header: 'YES',
    ...params,
  };
  const response = await axios.get(url, {
    params: merged,
    timeout: HTTP_TIMEOUT_MS,
    validateStatus: (s) => s < 500,
    httpsAgent: HTTPS_AGENT,
    responseType: 'text',
    transformResponse: [(d) => d], // keep raw text
  });
  return { status: response.status, data: typeof response.data === 'string' ? response.data : String(response.data ?? '') };
}

/**
 * Public: verify connection + report VICIdial version. Used by the
 * test-connection route. Does NOT hit the existing /test route's
 * campaigns_list path — sync needs its own permission check separately.
 */
export async function testConnection(settings) {
  const { status, data } = await vicidialApiCall(settings, { function: 'version' });
  const err = detectApiError(data);
  if (err) {
    return { ok: false, code: err.code, message: err.message, raw: data.slice(0, 300) };
  }
  // version returns: SUCCESS: 2.14-x|build|server-time
  const firstLine = (data || '').split('\n', 1)[0] || '';
  if (!/^SUCCESS:/i.test(firstLine)) {
    return { ok: false, code: 'UNEXPECTED', message: 'Unexpected response from VICIdial', raw: data.slice(0, 300) };
  }
  const versionInfo = firstLine.replace(/^SUCCESS:\s*/i, '').trim();
  return { ok: true, status, version: versionInfo };
}

/**
 * Public: fetch a normalized DID list for the configured sync mode.
 * Returns { mode, dids: [{phoneNumber, description?}], raw: <truncated> }.
 * Throws an Error on auth/network/permission problems.
 */
export async function fetchDidList(tenantIdOrSettings) {
  let settings;
  if (tenantIdOrSettings && tenantIdOrSettings._id) {
    settings = tenantIdOrSettings;
  } else {
    const tenantId = tenantIdOrSettings;
    settings = await VICIdialSetting.findOne({ tenantId });
    if (!settings) {
      const e = new Error('VICIdial not configured for this tenant');
      e.code = 'NOT_CONFIGURED';
      throw e;
    }
  }

  const mode = settings.didSyncMode || 'did_log_discovery';

  if (mode === 'api_list') {
    const fnName = (settings.didSyncApiListFunction || '').trim();
    if (!fnName) {
      const e = new Error('didSyncApiListFunction is empty — set a function name or switch to did_log_discovery mode');
      e.code = 'CONFIG';
      throw e;
    }
    const { data } = await vicidialApiCall(settings, { function: fnName });
    const err = detectApiError(data);
    if (err) {
      const e = new Error(err.message);
      e.code = err.code;
      throw e;
    }
    const dids = parseApiListResponse(data);
    return { mode, dids, raw: data.slice(0, 500) };
  }

  // did_log_discovery mode
  const lookback = Number(settings.didSyncLookbackDays) || 30;
  const today = new Date();
  const start = new Date(today.getTime() - (lookback - 1) * 24 * 60 * 60 * 1000);

  // did_log_export ACCEPTS a date_range OR query_date. We use date_range
  // because did_log_export with only query_date returns one day at a time.
  // Per vicidial source: start_date/end_date params are honored.
  const { data } = await vicidialApiCall(settings, {
    function: 'did_log_export',
    date_from: toYMD(start),
    date_to: toYMD(today),
    // Some versions only accept query_date — include it as a fallback so
    // older builds at least return the start day.
    query_date: toYMD(start),
  });

  const err = detectApiError(data);
  if (err) {
    const e = new Error(err.message);
    e.code = err.code;
    throw e;
  }

  const phoneNumbers = extractDidsFromDidLog(data);
  const dids = phoneNumbers.map(p => ({ phoneNumber: p, description: '' }));
  return { mode, dids, raw: data.slice(0, 500) };
}

/**
 * Diff-and-apply: reconcile fetched DIDs against the tenant's DID collection.
 *
 * - Adds new ones (status=active, source-tagged so the user can tell where
 *   it came from).
 * - Updates description / metadata.notes on existing DIDs whose
 *   metadata.source === 'vicidial-sync'.
 * - Marks DIDs that were previously vicidial-sync'd but no longer appear in
 *   the fetched set as inactive. We DO NOT delete; the user may re-activate.
 *   We also DO NOT touch DIDs added manually by the user (metadata.source
 *   missing or != 'vicidial-sync').
 *
 * @param {ObjectId|string} tenantId
 * @param {object} opts
 * @param {boolean} opts.dryRun     - if true, do not write to DB
 * @param {ObjectId|string} opts.userId - user that triggered the sync (for createdBy/updatedBy)
 */
export async function syncDidsForTenant(tenantId, opts = {}) {
  const { dryRun = false, userId = null } = opts;

  const settings = await VICIdialSetting.findOne({ tenantId });
  if (!settings) {
    const e = new Error('VICIdial not configured for this tenant');
    e.code = 'NOT_CONFIGURED';
    throw e;
  }

  // We need SOME user to attribute createdBy to (model requires it). Prefer
  // the user that triggered, else fall back to any tenant admin.
  let createdBy = userId;
  if (!createdBy) {
    const fallbackUser = await User.findOne({ tenant: tenantId, isActive: true })
      .select('_id')
      .lean();
    if (fallbackUser) createdBy = fallbackUser._id;
  }
  if (!createdBy) {
    const e = new Error('No user found to attribute synced DIDs to (tenant has no active users)');
    e.code = 'NO_USER';
    throw e;
  }

  // Pull fetched list.
  const { mode, dids, raw } = await fetchDidList(settings);
  const fetchedSet = new Set(dids.map(d => d.phoneNumber));

  // Pull all existing DIDs for this tenant in one shot.
  const existing = await DID.find({ tenantId })
    .select('_id phoneNumber status metadata.source metadata.notes')
    .lean();
  const existingMap = new Map(existing.map(d => [d.phoneNumber, d]));

  const counts = { fetched: dids.length, added: 0, updated: 0, deactivated: 0, unchanged: 0 };
  const opsLog = [];

  // --- 1) Add new DIDs ---
  for (const item of dids) {
    if (existingMap.has(item.phoneNumber)) continue;
    counts.added++;
    opsLog.push({ op: 'add', phone: item.phoneNumber });
    if (!dryRun) {
      try {
        await DID.create({
          tenantId,
          phoneNumber: item.phoneNumber,
          status: 'active',
          isActive: true,
          createdBy,
          updatedBy: createdBy,
          metadata: {
            source: 'vicidial-sync',
            notes: item.description ? `Synced from VICIdial: ${item.description}` : 'Synced from VICIdial',
          },
        });
      } catch (err) {
        // Most likely a duplicate-key race (concurrent sync). Treat as unchanged.
        if (err && err.code === 11000) {
          counts.added--;
          counts.unchanged++;
          opsLog[opsLog.length - 1].op = 'duplicate-skipped';
        } else {
          throw err;
        }
      }
    }
  }

  // --- 2) Re-activate previously-deactivated vicidial-sync DIDs that
  //        showed up again, and refresh their notes if description changed.
  for (const item of dids) {
    const existingDid = existingMap.get(item.phoneNumber);
    if (!existingDid) continue;
    const isSyncOrigin = existingDid.metadata?.source === 'vicidial-sync';
    const desiredNotes = item.description
      ? `Synced from VICIdial: ${item.description}`
      : (existingDid.metadata?.notes || 'Synced from VICIdial');
    const shouldReactivate = isSyncOrigin && existingDid.status !== 'active';
    const shouldUpdateNotes = isSyncOrigin && item.description && existingDid.metadata?.notes !== desiredNotes;
    if (shouldReactivate || shouldUpdateNotes) {
      counts.updated++;
      opsLog.push({ op: 'update', phone: item.phoneNumber, reactivated: shouldReactivate });
      if (!dryRun) {
        const set = { updatedBy: createdBy };
        if (shouldReactivate) {
          set.status = 'active';
          set.isActive = true;
        }
        if (shouldUpdateNotes) set['metadata.notes'] = desiredNotes;
        await DID.updateOne({ _id: existingDid._id }, { $set: set });
      }
    } else {
      counts.unchanged++;
    }
  }

  // --- 3) Deactivate sync-origin DIDs no longer present ---
  for (const existingDid of existing) {
    if (fetchedSet.has(existingDid.phoneNumber)) continue;
    if (existingDid.metadata?.source !== 'vicidial-sync') continue; // never touch manual DIDs
    if (existingDid.status === 'inactive') continue;
    counts.deactivated++;
    opsLog.push({ op: 'deactivate', phone: existingDid.phoneNumber });
    if (!dryRun) {
      await DID.updateOne(
        { _id: existingDid._id },
        { $set: { status: 'inactive', isActive: false, updatedBy: createdBy } }
      );
    }
  }

  // --- 4) Update VICIdialSetting bookkeeping ---
  if (!dryRun) {
    settings.lastDidSyncAt = new Date();
    settings.lastDidSyncStatus = 'success';
    settings.lastDidSyncMessage = `Synced via ${mode} (${counts.fetched} fetched, ${counts.added} added, ${counts.updated} updated, ${counts.deactivated} deactivated)`;
    settings.lastDidSyncCounts = counts;
    await settings.save();

    // Audit log entry.
    try {
      await AuditLog.create({
        tenantId,
        userId: createdBy,
        // AuditLog.action is an enum; 'system_action' is the closest fit.
        action: 'system_action',
        details: { kind: 'vicidial_did_sync', mode, counts, opsCount: opsLog.length },
      });
    } catch {
      // Audit log shape may differ across versions; never let bookkeeping fail the sync.
    }
  }

  return { mode, counts, opsLog, dryRun, raw };
}

/**
 * Mark this tenant's sync as failed (cron + manual share this).
 */
async function markSyncFailed(tenantId, err) {
  try {
    const code = err?.code || 'ERROR';
    const message = `${code}: ${err?.message || 'unknown error'}`.slice(0, 500);
    await VICIdialSetting.updateOne(
      { tenantId },
      {
        $set: {
          lastDidSyncAt: new Date(),
          lastDidSyncStatus: 'failed',
          lastDidSyncMessage: message,
        },
      }
    );
  } catch {/* swallow */}
}

/**
 * Cron entry-point: scan all tenants with didSyncEnabled=true, run sync
 * for those whose last sync is older than their didSyncIntervalMinutes.
 * Tenants are processed sequentially to avoid hammering customer servers
 * (each customer hits their own VICIdial — no shared throttle needed, but
 * sequential keeps DB load and memory bounded for the largest tenants).
 */
export async function syncAllEnabledTenants() {
  const now = Date.now();
  const candidates = await VICIdialSetting.find({ didSyncEnabled: true })
    .select('_id tenantId didSyncIntervalMinutes lastDidSyncAt')
    .lean();

  const results = { scanned: candidates.length, ran: 0, succeeded: 0, failed: 0, skipped: 0 };

  for (const c of candidates) {
    const interval = (c.didSyncIntervalMinutes || 60) * 60 * 1000;
    const last = c.lastDidSyncAt ? new Date(c.lastDidSyncAt).getTime() : 0;
    if (last && (now - last) < interval) {
      results.skipped++;
      continue;
    }
    results.ran++;
    try {
      await syncDidsForTenant(c.tenantId, { dryRun: false });
      results.succeeded++;
    } catch (err) {
      results.failed++;
      await markSyncFailed(c.tenantId, err);
      console.error(`[vicidial-sync] tenant ${c.tenantId} sync failed: ${err.message}`);
    }
  }
  return results;
}

export default {
  testConnection,
  fetchDidList,
  syncDidsForTenant,
  syncAllEnabledTenants,
  // exposed for tests
  normalizePhoneNumber,
  parsePipeDelimited,
  extractDidsFromDidLog,
  parseApiListResponse,
};
