const { chromium } = require('playwright');

(async () => {
  console.log('🧪 Testing DID Export Functionality...\n');

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    ignoreHTTPSErrors: true
  });
  const page = await context.newPage();

  // Listen for console messages and network errors
  page.on('console', msg => {
    if (msg.type() === 'error') {
      console.log('❌ Browser console error:', msg.text());
    }
  });

  page.on('response', response => {
    if (response.url().includes('/dids/export')) {
      console.log(`📡 Export request: ${response.status()} ${response.statusText()}`);
      console.log(`   URL: ${response.url()}`);
    }
  });

  try {
    // Login
    console.log('1. Logging in...');
    await page.goto('https://dids.amdy.io/login');
    await page.fill('input[type="email"]', 'client@test3.com');
    await page.fill('input[type="password"]', 'password123');
    await page.click('button[type="submit"]');
    await page.waitForURL('**/dashboard', { timeout: 10000 });
    console.log('✅ Login successful\n');

    // Navigate to DID Management
    console.log('2. Navigating to DID Management page...');
    await page.goto('https://dids.amdy.io/dids');
    await page.waitForLoadState('networkidle', { timeout: 10000 });
    console.log('✅ DID Management page loaded\n');

    // Wait for DIDs to load
    await page.waitForTimeout(2000);

    // Take screenshot before clicking export
    await page.screenshot({ path: '/tmp/before-export.png', fullPage: true });
    console.log('📸 Screenshot saved: /tmp/before-export.png\n');

    // Click Export button
    console.log('3. Clicking Export button...');
    const exportButton = page.locator('button:has-text("Export")');
    await exportButton.waitFor({ state: 'visible', timeout: 5000 });

    // Listen for download
    const downloadPromise = page.waitForEvent('download', { timeout: 5000 }).catch(() => null);

    await exportButton.click();
    console.log('✅ Export button clicked\n');

    // Wait for response
    await page.waitForTimeout(2000);

    const download = await downloadPromise;
    if (download) {
      console.log('✅ Download started!');
      console.log(`   Filename: ${download.suggestedFilename()}`);
      const path = `/tmp/${download.suggestedFilename()}`;
      await download.saveAs(path);
      console.log(`   Saved to: ${path}`);
    } else {
      console.log('❌ No download detected - checking for errors...');

      // Take screenshot after export attempt
      await page.screenshot({ path: '/tmp/after-export.png', fullPage: true });
      console.log('📸 Screenshot saved: /tmp/after-export.png');

      // Check for error alerts
      const alerts = await page.locator('[role="alert"], .alert').count();
      if (alerts > 0) {
        console.log(`⚠️ Found ${alerts} alert(s) on page`);
      }
    }

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    await page.screenshot({ path: '/tmp/export-error.png', fullPage: true });
    console.log('📸 Error screenshot saved: /tmp/export-error.png');
  } finally {
    await browser.close();
  }
})();
