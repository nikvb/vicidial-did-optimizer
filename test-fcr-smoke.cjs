#!/usr/bin/env node
// Playwright headless smoke test for the FCR (Free Caller Registry) submitter.
//
// Flow:
//   1. Log in as ron@724c.com.
//   2. Go to Settings → Carrier Registration tab.
//   3. Fill out the FCR profile and save.
//   4. Go to DID Management.
//   5. Verify the FCR Status column shows on rows.
//   6. Select 5 DIDs.
//   7. Click "Generate FCR file" — expect modal.
//   8. Verify file content lines look like +1XXXXXXXXXX.
//   9. Mark batch as submitted.

const { chromium } = require('playwright');

const BASE = 'https://dids.amdy.io';
const EMAIL = 'ron@724c.com';
const PASS = 'Ron724c$Strong2026';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  // Capture file content from the generate-batch response — used to verify shape
  let lastBatchResponse = null;
  page.on('response', async (response) => {
    if (response.url().includes('/api/v1/dids/fcr/generate-batch') && response.request().method() === 'POST') {
      try {
        lastBatchResponse = await response.json();
      } catch (e) { /* may not be JSON */ }
    }
  });

  page.on('pageerror', e => console.log('PAGEERROR:', e.message));

  const results = {
    login: false,
    settingsTabVisible: false,
    profileSaved: false,
    fcrColumnVisible: false,
    batchGenerated: false,
    fileContentValid: false,
    batchPhoneCount: 0
  };

  try {
    // ── 1. Login ───────────────────────────────────────────────────
    console.log(`1. Logging in as ${EMAIL}…`);
    await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
    await page.fill('input[type="email"]', EMAIL);
    await page.fill('input[type="password"]', PASS);
    await page.click('button[type="submit"]');
    await page.waitForLoadState('networkidle', { timeout: 15000 });
    await page.waitForTimeout(2000);
    if (page.url().includes('/login')) {
      throw new Error('Still on /login after submit — auth failed');
    }
    results.login = true;
    console.log('   OK login → URL =', page.url());

    // ── 2. Open Settings → Carrier Registration ────────────────────
    console.log('2. Opening Settings → Carrier Registration…');
    await page.goto(`${BASE}/settings?tab=fcr`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);

    const tabVisible = await page.locator('button:has-text("Carrier Registration")').first().isVisible();
    results.settingsTabVisible = tabVisible;
    console.log(`   ${tabVisible ? 'OK' : 'FAIL'} Carrier Registration tab visible`);

    // Click tab to ensure active
    try { await page.click('button:has-text("Carrier Registration")'); } catch {}
    await page.waitForTimeout(1000);

    // ── 3. Fill profile and save ───────────────────────────────────
    console.log('3. Filling FCR profile…');
    await page.fill('[data-testid="fcr-business-name"]', '724c Test Co');
    await page.fill('[data-testid="fcr-street"]', '100 Test Ave');
    await page.fill('[data-testid="fcr-city"]', 'Austin');
    await page.fill('[data-testid="fcr-state"]', 'TX');
    await page.fill('[data-testid="fcr-zip"]', '78701');
    await page.fill('[data-testid="fcr-website"]', 'https://724c.com');
    await page.fill('[data-testid="fcr-contact-name"]', 'Ron Test');
    await page.fill('[data-testid="fcr-contact-phone"]', '+15125551234');
    await page.fill('[data-testid="fcr-contact-email"]', EMAIL);
    await page.fill('[data-testid="fcr-call-purpose"]', 'Outbound calls to opted-in B2B leads for software demos.');
    await page.fill('[data-testid="fcr-monthly-volume"]', '10000');
    await page.click('[data-testid="fcr-save-profile"]');
    await page.waitForTimeout(2500);
    const savedConfirm = await page.locator('text=/Profile saved at|Last updated/').first().isVisible().catch(() => false);
    results.profileSaved = savedConfirm;
    console.log(`   ${savedConfirm ? 'OK' : 'FAIL'} profile saved`);

    // ── 4. Go to DID Management and verify FCR column ──────────────
    console.log('4. Navigating to /did-management…');
    await page.goto(`${BASE}/did-management`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(8000); // table needs time to fetch + hydrate
    await page.waitForSelector('table, [role="table"], .rdt_Table', { timeout: 15000 }).catch(() => {});

    const fcrColumnHeader = await page.locator('text=FCR Status').first().isVisible().catch(() => false);
    const fcrBadge = await page.locator('[data-testid^="fcr-status-"]').first().isVisible().catch(() => false);
    results.fcrColumnVisible = fcrColumnHeader || fcrBadge;
    console.log(`   ${results.fcrColumnVisible ? 'OK' : 'FAIL'} FCR Status column/badge visible (header=${fcrColumnHeader}, badge=${fcrBadge})`);

    // ── 5. Select 5 DIDs ───────────────────────────────────────────
    console.log('5. Selecting first 5 DIDs…');
    // react-data-table-component renders <input type="checkbox"> per row.
    // The first one is select-all; skip it and select 5 rows.
    const checkboxes = await page.locator('.rdt_TableBody input[type="checkbox"]').all();
    console.log(`   found ${checkboxes.length} row checkboxes`);
    let selected = 0;
    for (const cb of checkboxes) {
      if (selected >= 5) break;
      try {
        // click() triggers React's onChange — check() may bypass it
        await cb.click({ force: true });
        selected++;
        await page.waitForTimeout(150);
      } catch (e) { /* skip */ }
    }
    console.log(`   selected ${selected} DIDs`);
    if (selected === 0) {
      console.log('   No DIDs in this tenant — skipping batch generation phase.');
    } else {
      await page.waitForTimeout(2000);
      // Wait for the bulk-action bar to appear (signals React state updated)
      await page.waitForSelector('[data-testid="fcr-generate-batch"]', { timeout: 10000 }).catch(() => {});

      // ── 6. Click Generate FCR file ──────────────────────────────
      console.log('6. Clicking Generate FCR file…');
      await page.click('[data-testid="fcr-generate-batch"]');
      await page.waitForTimeout(4000);

      if (lastBatchResponse?.success) {
        results.batchGenerated = true;
        results.batchPhoneCount = lastBatchResponse.phoneCount;
        const lines = (lastBatchResponse.fileContent || '').trim().split('\n');
        const allValid = lines.length > 0 && lines.every(l => /^\+1\d{10}$/.test(l));
        results.fileContentValid = allValid;
        console.log(`   OK batch generated: ${lastBatchResponse.batchNumber}, ${lines.length} lines`);
        console.log(`   sample line: ${lines[0]}`);
        console.log(`   ${allValid ? 'OK' : 'FAIL'} all lines match +1XXXXXXXXXX`);

        // ── 7. Mark as submitted ──────────────────────────────────
        console.log('7. Clicking Mark as submitted…');
        await page.click('[data-testid="fcr-mark-submitted"]');
        await page.waitForTimeout(2500);
      } else {
        console.log('   FAIL no successful batch response captured');
        console.log('   lastBatchResponse:', JSON.stringify(lastBatchResponse).substring(0, 300));
      }
    }

    // ── Final summary ──────────────────────────────────────────────
    console.log('\n── RESULTS ──');
    Object.entries(results).forEach(([k, v]) => console.log(`   ${v ? 'OK  ' : 'FAIL'}  ${k} = ${v}`));

    const passed = results.login && results.settingsTabVisible && results.profileSaved && results.fcrColumnVisible;
    console.log(`\n${passed ? 'PASS' : 'FAIL'} smoke test`);
    await page.screenshot({ path: '/home/na/didapi/fcr-smoke-final.png', fullPage: true });
    console.log('Screenshot: /home/na/didapi/fcr-smoke-final.png');

    await browser.close();
    process.exit(passed ? 0 : 1);

  } catch (err) {
    console.error('\nERROR:', err.message);
    console.error(err.stack);
    try { await page.screenshot({ path: '/home/na/didapi/fcr-smoke-error.png', fullPage: true }); } catch {}
    await browser.close();
    process.exit(1);
  }
})();
