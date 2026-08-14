/**
 * Unit tests for the VICIdial sync service parsing helpers.
 *
 * Pure-function tests — no DB, no HTTP. Run with:
 *   node services/vicidial-sync-service.test.js
 *
 * Exits non-zero on the first failure. Kept dependency-free on purpose so it
 * can run anywhere without adding a test-runner to the project.
 */
import assert from 'node:assert/strict';
import {
  normalizePhoneNumber,
  parsePipeDelimited,
  extractDidsFromDidLog,
  parseApiListResponse,
} from './vicidial-sync-service.js';

let failed = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`  ok  ${name}`);
  } catch (err) {
    failed++;
    console.error(`  FAIL ${name}`);
    console.error(`    ${err.message}`);
  }
}

console.log('normalizePhoneNumber');
test('10-digit NANP -> +1XXXXXXXXXX', () => {
  assert.equal(normalizePhoneNumber('4155551234'), '+14155551234');
});
test('11-digit leading 1 -> +1XXXXXXXXXX', () => {
  assert.equal(normalizePhoneNumber('14155551234'), '+14155551234');
});
test('strips formatting', () => {
  assert.equal(normalizePhoneNumber('(415) 555-1234'), '+14155551234');
});
test('too short -> null', () => {
  assert.equal(normalizePhoneNumber('1234'), null);
});
test('empty -> null', () => {
  assert.equal(normalizePhoneNumber(''), null);
  assert.equal(normalizePhoneNumber(null), null);
  assert.equal(normalizePhoneNumber(undefined), null);
});
test('international preserved', () => {
  assert.equal(normalizePhoneNumber('442071838750'), '+442071838750');
});

console.log('parsePipeDelimited');
test('strips SUCCESS header line', () => {
  const body = `SUCCESS: did log for 2025-08-20
uniqueid|caller_id_number|call_date
12345.1|4155551234|2025-08-20 14:51:00
12345.2|4155557777|2025-08-20 14:55:00`;
  const rows = parsePipeDelimited(body);
  assert.equal(rows.length, 3);
  assert.deepEqual(rows[1], ['12345.1', '4155551234', '2025-08-20 14:51:00']);
});
test('ignores blank lines and non-pipe lines', () => {
  const body = `SUCCESS: ok\n\nplain text line\nA|B|C\n`;
  const rows = parsePipeDelimited(body);
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0], ['A', 'B', 'C']);
});

console.log('extractDidsFromDidLog');
test('finds caller_id_number column and dedupes', () => {
  const body = `SUCCESS: did log for 2025-08-20
uniqueid|caller_id_number|call_date|phone_number
1.1|4155551234|2025-08-20 14:51:00|9991112222
1.2|4155551234|2025-08-20 14:52:00|9991113333
1.3|4155557777|2025-08-20 14:53:00|9991114444`;
  const dids = extractDidsFromDidLog(body);
  assert.equal(dids.length, 2);
  assert.ok(dids.includes('+14155551234'));
  assert.ok(dids.includes('+14155557777'));
});
test('falls back to caller_id column when caller_id_number absent', () => {
  const body = `SUCCESS: did log
uniqueid|caller_id|call_date
1.1|4155551234|2025-08-20 14:51:00`;
  const dids = extractDidsFromDidLog(body);
  assert.deepEqual(dids, ['+14155551234']);
});
test('falls back to column index 1 when no header', () => {
  const body = `1.1|4155551234|2025-08-20 14:51:00
1.2|4155551234|2025-08-20 14:52:00`;
  const dids = extractDidsFromDidLog(body);
  assert.deepEqual(dids, ['+14155551234']);
});
test('drops garbage numbers', () => {
  const body = `uniqueid|caller_id_number|call_date
1|123|2025-08-20
2|abc|2025-08-20
3|4155551234|2025-08-20`;
  const dids = extractDidsFromDidLog(body);
  assert.deepEqual(dids, ['+14155551234']);
});
test('empty body -> empty array', () => {
  assert.deepEqual(extractDidsFromDidLog(''), []);
  assert.deepEqual(extractDidsFromDidLog(null), []);
});

console.log('parseApiListResponse');
test('parses DID|description rows', () => {
  const body = `SUCCESS: dids
did_number|did_description|campaign_id
4155551234|Main inbound|CAMP01
4155557777|Sales line|CAMP02`;
  const out = parseApiListResponse(body);
  assert.equal(out.length, 2);
  assert.equal(out[0].phoneNumber, '+14155551234');
  assert.equal(out[0].description, 'Main inbound');
  assert.equal(out[1].phoneNumber, '+14155557777');
});
test('skips lines where col 0 is non-numeric (header)', () => {
  const body = `did_number|did_description
4155551234|Real DID`;
  const out = parseApiListResponse(body);
  assert.equal(out.length, 1);
});
test('dedupes repeated DIDs', () => {
  const body = `did_number|did_description|campaign_id
4155551234|Inbound|CAMP01
4155551234|Inbound dup|CAMP02`;
  const out = parseApiListResponse(body);
  assert.equal(out.length, 1);
});

console.log('');
if (failed === 0) {
  console.log('ALL TESTS PASSED');
  process.exit(0);
} else {
  console.error(`${failed} TEST(S) FAILED`);
  process.exit(1);
}
