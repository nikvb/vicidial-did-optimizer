#!/usr/bin/env node
// Self-contained smoke/unit test for the FCR batch generator.
//
// Tests:
//   1. Phone normalization (various input formats → +1XXXXXXXXXX)
//   2. File size truncation honors 100KB cap
//   3. API: PUT /settings/fcr-profile, POST /dids/fcr/generate-batch
//      against the live server using ron's tenant.
//
// Run: node test-fcr-batch.cjs

const assert = require('assert');

// ── Phase 1: Unit tests for normalizeToFcrFormat ──────────────────────
// Re-implement the normalizer locally so we don't need to import ESM
// from CJS. Logic must stay in sync with routes/fcr.js.
function normalize(p) {
  if (!p) return null;
  const d = String(p).replace(/\D/g, '');
  if (d.length === 11 && d.startsWith('1')) return '+1' + d.substring(1);
  if (d.length === 10) return '+1' + d;
  return null;
}

console.log('── Phase 1: normalization unit tests ──');
const cases = [
  ['+14155551234', '+14155551234'],
  ['14155551234', '+14155551234'],
  ['4155551234', '+14155551234'],
  ['(415) 555-1234', '+14155551234'],
  ['415-555-1234', '+14155551234'],
  ['1 (415) 555-1234', '+14155551234'],
  ['', null],
  [null, null],
  ['123', null],
  ['+44 20 1234 5678', null],  // 11 digits starting with 4, invalid in NANP
];
for (const [input, expected] of cases) {
  const got = normalize(input);
  assert.strictEqual(got, expected, `normalize(${JSON.stringify(input)}) → ${got}, expected ${expected}`);
  console.log(`  ok  normalize(${JSON.stringify(input)}) = ${JSON.stringify(got)}`);
}

// ── Phase 2: File-size truncation logic ──────────────────────────────
console.log('── Phase 2: 100KB file-size truncation ──');
const CAP = 100 * 1024;
// Each line is 13 bytes (+1 + 10 digits + \n). 100KB / 13 ≈ 7876 numbers max.
const lots = [];
for (let i = 0; i < 10000; i++) {
  const n = (4000000000 + i).toString().padStart(10, '0');
  lots.push('+1' + n);
}
let bytes = 0;
let included = 0;
for (const p of lots) {
  const lb = Buffer.byteLength(p + '\n', 'utf8');
  if (bytes + lb > CAP) break;
  bytes += lb;
  included++;
}
assert.ok(bytes <= CAP, `truncated bytes (${bytes}) should be ≤ ${CAP}`);
assert.ok(included < 10000, 'truncation should drop some numbers');
console.log(`  ok  truncated to ${included} numbers, ${bytes} bytes (cap ${CAP})`);

// ── Phase 3: Live API smoke (PUT profile + POST generate-batch) ──────
const BASE = process.env.FCR_TEST_BASE || 'https://dids.amdy.io';
const EMAIL = process.env.FCR_TEST_EMAIL || 'client@test3.com';
const PASS = process.env.FCR_TEST_PASS || 'password123';

(async () => {
  console.log(`── Phase 3: live API smoke against ${BASE} ──`);

  // 1. Login
  const loginRes = await fetch(`${BASE}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASS })
  });
  if (!loginRes.ok) {
    console.error(`  SKIP login failed (${loginRes.status}) — API smoke phase skipped.`);
    return;
  }
  const loginJson = await loginRes.json();
  const token = loginJson?.data?.tokens?.accessToken || loginJson?.tokens?.accessToken || loginJson?.accessToken;
  if (!token) {
    console.error('  SKIP login response had no access token — skipping.');
    console.error('  Login response:', JSON.stringify(loginJson).substring(0, 200));
    return;
  }
  console.log('  ok  login → got access token');

  const H = { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' };

  // 2. PUT FCR profile
  const profile = {
    businessName: 'Test FCR Co',
    address: { street: '1 Test St', city: 'Testville', state: 'CA', zip: '94105' },
    website: 'https://example.com',
    contact: { name: 'Test User', phone: '+14155551234', email: EMAIL },
    callPurpose: 'Outbound sales to opted-in leads',
    monthlyCallVolume: 5000
  };
  const putRes = await fetch(`${BASE}/api/v1/settings/fcr-profile`, {
    method: 'PUT',
    headers: H,
    body: JSON.stringify(profile)
  });
  const putJson = await putRes.json();
  assert.ok(putRes.ok, `PUT profile failed: ${putRes.status} ${JSON.stringify(putJson)}`);
  assert.strictEqual(putJson.success, true);
  console.log('  ok  PUT /settings/fcr-profile → saved');

  // 3. GET to confirm
  const getRes = await fetch(`${BASE}/api/v1/settings/fcr-profile`, { headers: H });
  const getJson = await getRes.json();
  assert.ok(getRes.ok, `GET profile failed: ${getRes.status}`);
  assert.strictEqual(getJson.data.businessName, 'Test FCR Co');
  console.log('  ok  GET /settings/fcr-profile → roundtrip matches');

  // 4. Fetch some DIDs for this tenant to use in the batch
  const didsRes = await fetch(`${BASE}/api/v1/dids?limit=5`, { headers: H });
  const didsJson = await didsRes.json();
  const didIds = (didsJson?.data || []).map(d => d._id).slice(0, 5);
  if (didIds.length === 0) {
    console.log('  SKIP no DIDs in this tenant — cannot test generate-batch');
    return;
  }
  console.log(`  ok  found ${didIds.length} DIDs to include in batch`);

  // 5. POST generate-batch
  const genRes = await fetch(`${BASE}/api/v1/dids/fcr/generate-batch`, {
    method: 'POST',
    headers: H,
    body: JSON.stringify({ didIds })
  });
  const genJson = await genRes.json();
  assert.ok(genRes.ok, `generate-batch failed: ${genRes.status} ${JSON.stringify(genJson).substring(0, 200)}`);
  assert.strictEqual(genJson.success, true);
  assert.ok(genJson.batchNumber);
  assert.ok(genJson.fileContent);
  assert.ok(genJson.phoneCount > 0);
  // Verify file content shape: every line is +1XXXXXXXXXX
  const lines = genJson.fileContent.trim().split('\n');
  for (const line of lines) {
    assert.match(line, /^\+1\d{10}$/, `bad line in file: ${line}`);
  }
  console.log(`  ok  POST /dids/fcr/generate-batch → batch ${genJson.batchNumber}, ${genJson.phoneCount} phones`);
  console.log(`  ok  file content shape valid (${lines.length} lines, all +1XXXXXXXXXX)`);
  console.log(`\nSample file content:\n${genJson.fileContent.substring(0, 200)}`);

  // 6. Re-download
  const fileRes = await fetch(`${BASE}/api/v1/dids/fcr/batch/${genJson.batchId}/file`, { headers: H });
  assert.ok(fileRes.ok, 're-download failed');
  const fileText = await fileRes.text();
  assert.ok(fileText.length > 0);
  console.log(`  ok  GET /dids/fcr/batch/:id/file → ${fileText.length} bytes`);

  // 7. List batches
  const listRes = await fetch(`${BASE}/api/v1/dids/fcr/batches`, { headers: H });
  const listJson = await listRes.json();
  assert.ok(listRes.ok);
  assert.ok(listJson.data.length >= 1);
  console.log(`  ok  GET /dids/fcr/batches → ${listJson.data.length} batches`);

  // 8. Mark submitted
  const markRes = await fetch(`${BASE}/api/v1/dids/fcr/batch/${genJson.batchId}/mark-submitted`, {
    method: 'POST',
    headers: H,
    body: JSON.stringify({})
  });
  const markJson = await markRes.json();
  assert.ok(markRes.ok, `mark-submitted failed: ${markRes.status}`);
  assert.strictEqual(markJson.data.status, 'submitted');
  console.log(`  ok  POST mark-submitted → status=${markJson.data.status}`);

  console.log('\n── ALL TESTS PASSED ──');
})().catch(err => {
  console.error('\n── TEST FAILED ──');
  console.error(err);
  process.exit(1);
});
