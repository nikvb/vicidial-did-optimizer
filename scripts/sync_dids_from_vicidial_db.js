#!/usr/bin/env node
/**
 * One-way DID sync from a customer's VICIdial (or VICIdial-with-custom-DID-tables)
 * directly into our MongoDB DID collection.
 *
 * NON_AGENT API can't reach customer-customized DID tables (e.g. `did_numbers`,
 * which is what ron's customer uses to manage their 38k-DID inventory). This
 * script uses SSH + read-only mysql SELECT instead. Multi-tenant safe — every
 * row is tagged with the target tenantId; manually added DIDs are left alone.
 *
 *   node scripts/sync_dids_from_vicidial_db.js \
 *     --tenant <tenantId> \
 *     --ssh-key <path-to-key> \
 *     --ssh-host <vicidial-host> \
 *     --db-host <internal-mysql-host> \
 *     --db-user cron --db-pass 1234 --db-name asterisk \
 *     [--table did_numbers]    # default; auto-falls-back to vicidial_inbound_dids
 *     [--dry-run]
 *     [--limit N]              # cap rows for testing
 *
 * Output: a JSON summary { added, reactivated, updated, deactivated, total }.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();
const execFileP = promisify(execFile);

// --- args parsing ------------------------------------------------------------
const argv = Object.fromEntries(
  process.argv.slice(2).reduce((acc, tok, i, arr) => {
    if (tok.startsWith('--')) {
      const k = tok.slice(2);
      const v = arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : 'true';
      acc.push([k, v]);
    }
    return acc;
  }, [])
);

const need = (k) => {
  if (!argv[k] || argv[k] === 'true') {
    console.error(`✗ missing --${k}`);
    process.exit(2);
  }
  return argv[k];
};

const TENANT_ID = need('tenant');
const SSH_KEY   = need('ssh-key');
const SSH_HOST  = need('ssh-host');
const DB_HOST   = need('db-host');
const DB_USER   = need('db-user');
const DB_PASS   = need('db-pass');
const DB_NAME   = need('db-name');
const TABLE     = argv['table'] || 'did_numbers';
const DRY_RUN   = argv['dry-run'] === 'true';
const LIMIT     = argv['limit'] && argv['limit'] !== 'true' ? parseInt(argv['limit'], 10) : 0;
const SSH_USER  = argv['ssh-user'] || 'root';
const CAPACITY  = argv['capacity'] && argv['capacity'] !== 'true'
  ? parseInt(argv['capacity'], 10)
  : parseInt(process.env.DEFAULT_DID_CAPACITY || '100', 10);
// Optional: pass `--with-campaign-join` to JOIN did_numbers ↔ did_groups
// for the campaign mapping. Customer-specific; not on stock VICIdial.
const WITH_CAMPAIGN_JOIN = argv['with-campaign-join'] === 'true';

const MONGO_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/did_optimizer';

// --- mysql via ssh -----------------------------------------------------------
/**
 * Run a SELECT on the customer's VICIdial DB through ssh+mysql, return rows.
 * Output format is TSV (mysql default with --batch) — first row is headers.
 */
async function remoteSelect(sql) {
  const remoteCmd = `mysql -h ${DB_HOST} -u${DB_USER} -p${DB_PASS} ${DB_NAME} --batch --raw -e ${JSON.stringify(sql)}`;
  const { stdout, stderr } = await execFileP('ssh', [
    '-i', SSH_KEY,
    '-o', 'StrictHostKeyChecking=no',
    '-o', 'UserKnownHostsFile=/dev/null',
    `${SSH_USER}@${SSH_HOST}`,
    remoteCmd,
  ], { maxBuffer: 256 * 1024 * 1024 });
  if (stderr && !stderr.includes('Warning')) console.error('ssh stderr:', stderr.slice(0, 500));
  const lines = stdout.split('\n').filter(Boolean);
  if (lines.length === 0) return [];
  const headers = lines[0].split('\t');
  return lines.slice(1).map(line => {
    const cells = line.split('\t');
    const row = {};
    headers.forEach((h, i) => { row[h] = cells[i] === 'NULL' ? null : cells[i]; });
    return row;
  });
}

// --- schema introspection ---------------------------------------------------
/** Discover which DID column to use in the source table. */
async function pickDidColumn(table) {
  const rows = await remoteSelect(`SHOW COLUMNS FROM ${table}`);
  const names = rows.map(r => r.Field);
  // Preferred order — most-specific to least
  const candidates = ['did_number', 'did_pattern', 'phone_number', 'phone'];
  for (const c of candidates) if (names.includes(c)) return c;
  throw new Error(`No DID-bearing column found in ${table} (saw: ${names.join(', ')})`);
}

/** Auto-fallback: if --table doesn't exist, try vicidial_inbound_dids. */
async function pickTable() {
  const rows = await remoteSelect(`SHOW TABLES LIKE '${TABLE}'`);
  if (rows.length > 0) return TABLE;
  console.warn(`⚠ ${TABLE} not found, falling back to vicidial_inbound_dids`);
  const fallback = await remoteSelect(`SHOW TABLES LIKE 'vicidial_inbound_dids'`);
  if (fallback.length > 0) return 'vicidial_inbound_dids';
  throw new Error(`Neither ${TABLE} nor vicidial_inbound_dids exists`);
}

// --- normalization -----------------------------------------------------------
function normalizePhone(raw) {
  if (!raw) return null;
  let d = String(raw).replace(/\D/g, '');
  if (d.length === 11 && d.startsWith('1')) d = d.slice(1);
  if (d.length !== 10) return null;
  return `+1${d}`;
}

function mapRowToDid(row, didCol, tenantId, sysUserId, capacity) {
  const raw = row[didCol];
  const phone = normalizePhone(raw);
  if (!phone) return null;

  // Try to infer status: 'active' string or did_active='Y' or 'is_spam=1'
  const sourceStatus = String(row.status || row.did_active || '').toLowerCase();
  const isSpam = row.is_spam === '1' || row.is_spam === 1;
  const excluded = row.excluded_from_management === '1' || row.excluded_from_management === 1;

  const ourStatus = (sourceStatus.startsWith('active') || sourceStatus === 'y') && !excluded
    ? 'active' : 'inactive';

  const areaCode = row.area_code || (phone.startsWith('+1') ? phone.slice(2, 5) : undefined);

  // $set is for mutable fields refreshed on every sync. Must NOT include
  // tenantId or phoneNumber — those go in $setOnInsert only (Mongo forbids
  // the same path appearing in both).
  const update = {
    status: ourStatus,
    isActive: ourStatus === 'active',
    updatedBy: sysUserId,
    'metadata.source': 'vicidial-db-sync',
    'metadata.sourceTable': TABLE,
    'metadata.sourceLastSeen': new Date(),
  };

  // Pass through customer's spam signal if present — it's their internal scoring.
  // We keep our own reputation scoring authoritative, so this only lives in metadata.
  if (isSpam) update['metadata.customerFlaggedSpam'] = true;
  if (row.spam_score != null && row.spam_score !== '') {
    update['metadata.customerSpamScore'] = parseInt(row.spam_score, 10);
  }
  if (row.carrier_info) update['metadata.carrierInfo'] = row.carrier_info;
  if (areaCode) update['location.areaCode'] = areaCode;

  // Campaign id flows in from the SQL JOIN as `campaign_id_join` (we control
  // the alias). Skip empty / NULL so we don't pollute the array with junk.
  const campaignId = row.campaign_id_join || row.campaign_id;
  let campaignAssociations = null;
  if (campaignId && campaignId !== 'NULL' && String(campaignId).trim()) {
    campaignAssociations = [{
      campaignId: String(campaignId).trim(),
      priority: 5,
      addedAt: new Date(),
      addedBy: sysUserId,
    }];
  }

  const insert = {
    tenantId,
    phoneNumber: phone,
    createdBy: sysUserId,
    capacity,
  };

  return { phone, update, insert, campaignAssociations };
}

// --- main --------------------------------------------------------------------
async function main() {
  console.log(`▶ DID sync starting`);
  console.log(`  tenant:     ${TENANT_ID}`);
  console.log(`  ssh:        ${SSH_USER}@${SSH_HOST} (key: ${SSH_KEY})`);
  console.log(`  db:         ${DB_USER}@${DB_HOST}/${DB_NAME}`);
  console.log(`  table:      ${TABLE}${LIMIT ? ` (limit ${LIMIT})` : ''}`);
  console.log(`  dry-run:    ${DRY_RUN}`);

  await mongoose.connect(MONGO_URI);
  console.log(`✓ connected to mongo`);

  const tenant = await mongoose.connection.collection('tenants').findOne({ _id: new mongoose.Types.ObjectId(TENANT_ID) });
  if (!tenant) {
    console.error(`✗ tenant ${TENANT_ID} not found`);
    process.exit(3);
  }
  console.log(`✓ tenant: ${tenant.name || tenant.email || tenant._id}`);

  // System user for createdBy — use the first admin-tier user we find
  const sysUser = await mongoose.connection.collection('users').findOne(
    { role: { $in: ['ADMIN', 'admin', 'SUPER_ADMIN'] } }, { _id: 1 }
  ) || await mongoose.connection.collection('users').findOne({}, { _id: 1 });
  if (!sysUser) {
    console.error(`✗ no user found to attribute createdBy to`);
    process.exit(4);
  }

  // Discover table + DID column
  const useTable = await pickTable();
  const didCol = await pickDidColumn(useTable);
  console.log(`✓ source: ${useTable}.${didCol}`);

  // Pull all rows. For did_numbers we know the schema is rich; for stock VICIdial
  // tables we still SELECT * because the column names differ between forks.
  // With --with-campaign-join, LEFT JOIN did_groups so each row carries its
  // campaign_id (customer-specific schema: did_numbers.group_id → did_groups.id → did_groups.campaign_id).
  const limitClause = LIMIT > 0 ? ` LIMIT ${LIMIT}` : '';
  const query = WITH_CAMPAIGN_JOIN
    ? `SELECT t.*, g.campaign_id AS campaign_id_join FROM ${useTable} t LEFT JOIN did_groups g ON t.group_id = g.id${limitClause}`
    : `SELECT * FROM ${useTable}${limitClause}`;
  console.log(`▶ ${query}`);
  const rows = await remoteSelect(query);
  console.log(`✓ fetched ${rows.length} rows`);

  // Snapshot what we currently have for this tenant *with this source tag*.
  // We only manage rows we ourselves imported; manually added DIDs are off-limits.
  const ourExisting = await mongoose.connection.collection('dids').find(
    { tenantId: new mongoose.Types.ObjectId(TENANT_ID), 'metadata.source': 'vicidial-db-sync' },
    { projection: { phoneNumber: 1, status: 1 } }
  ).toArray();
  const existingByPhone = new Map(ourExisting.map(d => [d.phoneNumber, d]));
  console.log(`✓ existing sync-managed DIDs in mongo: ${existingByPhone.size}`);

  // Build bulk ops
  const ops = [];
  const seenPhones = new Set();
  let skipped = 0;
  let withCampaign = 0;
  const tenantOid = new mongoose.Types.ObjectId(TENANT_ID);
  for (const row of rows) {
    const mapped = mapRowToDid(row, didCol, tenantOid, sysUser._id, CAPACITY);
    if (!mapped) { skipped++; continue; }
    if (seenPhones.has(mapped.phone)) continue; // dedup within a single pull
    seenPhones.add(mapped.phone);

    const updateDoc = {
      $set: mapped.update,
      $setOnInsert: mapped.insert,
    };
    // Add the campaign association if we got one from the JOIN. $addToSet
    // dedupes by full subdoc, so this is safe to re-run.
    if (mapped.campaignAssociations) {
      updateDoc.$addToSet = {
        campaignAssociations: { $each: mapped.campaignAssociations },
      };
      withCampaign++;
    }

    ops.push({
      updateOne: {
        filter: { tenantId: tenantOid, phoneNumber: mapped.phone },
        update: updateDoc,
        upsert: true,
      },
    });
  }
  console.log(`  ${withCampaign} rows carry campaign mapping from did_groups`);

  // Phones present in DB but absent from source → deactivate
  // (only ones our sync owns)
  const toDeactivate = [];
  for (const [phone, existing] of existingByPhone) {
    if (!seenPhones.has(phone) && existing.status !== 'inactive') {
      toDeactivate.push(phone);
    }
  }
  if (toDeactivate.length > 0) {
    ops.push({
      updateMany: {
        filter: {
          tenantId: new mongoose.Types.ObjectId(TENANT_ID),
          phoneNumber: { $in: toDeactivate },
          'metadata.source': 'vicidial-db-sync',
        },
        update: { $set: { status: 'inactive', isActive: false, 'metadata.sourceLastSeen': new Date() } },
      },
    });
  }

  console.log(`▶ ops: ${ops.length} upserts + (${toDeactivate.length} deactivations)`);
  if (skipped) console.log(`  ${skipped} rows skipped (no valid 10-digit US phone)`);

  if (DRY_RUN) {
    console.log(`✓ DRY RUN — no writes performed`);
    await mongoose.disconnect();
    console.log(JSON.stringify({ dryRun: true, wouldUpsert: ops.length - (toDeactivate.length > 0 ? 1 : 0), wouldDeactivate: toDeactivate.length, skipped, total: rows.length }, null, 2));
    return;
  }

  // Bulk write in chunks to keep Mongo happy
  const CHUNK = 1000;
  let added = 0, modified = 0;
  for (let i = 0; i < ops.length; i += CHUNK) {
    const chunk = ops.slice(i, i + CHUNK);
    const r = await mongoose.connection.collection('dids').bulkWrite(chunk, { ordered: false });
    added    += r.upsertedCount || 0;
    modified += r.modifiedCount || 0;
    if ((i + CHUNK) % 5000 === 0 || i + CHUNK >= ops.length) {
      console.log(`  …${Math.min(i + CHUNK, ops.length)}/${ops.length}`);
    }
  }

  await mongoose.disconnect();

  const summary = {
    table: useTable,
    didColumn: didCol,
    sourceRows: rows.length,
    upsertOps: ops.length - (toDeactivate.length > 0 ? 1 : 0),
    added,
    updatedOrReactivated: modified - toDeactivate.length, // best-effort
    deactivated: toDeactivate.length,
    skippedInvalid: skipped,
  };
  console.log(`\n✓ sync complete`);
  console.log(JSON.stringify(summary, null, 2));
}

main().catch(err => {
  console.error(`✗ sync failed:`, err);
  process.exit(1);
});
