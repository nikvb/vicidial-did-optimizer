const { chromium } = require('playwright');

(async () => {
  console.log('🧪 Testing DID Export Functionality (with cache clear)...\n');

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    ignoreHTTPSErrors: true
  });
  const page = await context.newPage();

  // Listen for network responses
  page.on('response', async response => {
    if (response.url().includes('/dids/export')) {
      console.log(`📡 Export request: ${response.status()} ${response.statusText()}`);
      console.log(`   URL: ${response.url()}`);

      if (response.status() === 200) {
        const contentType = response.headers()['content-type'];
        console.log(`   Content-Type: ${contentType}`);

        // Get response body
        const body = await response.body();
        console.log(`   Body size: ${body.length} bytes`);
        console.log(`   First 200 chars:\n${body.toString().substring(0, 200)}`);
      }
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

    // Navigate to DID Management with cache clear
    console.log('2. Navigating to DID Management page (clearing cache)...');
    await page.goto('https://dids.amdy.io/dids', { waitUntil: 'networkidle' });

    // Force hard reload to clear cache
    await page.reload({ waitUntil: 'networkidle' });
    console.log('✅ Page loaded and refreshed\n');

    // Wait for content to load
    await page.waitForTimeout(3000);

    // Take screenshot
    await page.screenshot({ path: '/tmp/did-management-page.png', fullPage: true });
    console.log('📸 Screenshot saved: /tmp/did-management-page.png\n');

    // Check for Export button
    console.log('3. Looking for Export button...');
    const buttons = await page.locator('button').all();
    console.log(`   Found ${buttons.length} buttons on page`);

    for (let i = 0; i < buttons.length; i++) {
      const text = await buttons[i].textContent();
      if (text) {
        console.log(`   Button ${i + 1}: "${text.trim()}"`);
      }
    }

    // Try to click Export button
    const exportButton = page.locator('button:has-text("Export")');
    const exportButtonCount = await exportButton.count();

    if (exportButtonCount === 0) {
      console.log('\n❌ Export button NOT found!');
      console.log('   The new frontend might not have been deployed correctly.');
    } else {
      console.log(`\n✅ Found ${exportButtonCount} Export button(s)`);

      // Listen for download
      console.log('\n4. Clicking Export button...');
      const downloadPromise = page.waitForEvent('download', { timeout: 10000 }).catch(() => null);

      await exportButton.first().click();
      console.log('   Export button clicked');

      // Wait for download
      const download = await downloadPromise;

      if (download) {
        console.log('\n✅ ✅ ✅ Download successful!');
        console.log(`   Filename: ${download.suggestedFilename()}`);
        const path = `/tmp/${download.suggestedFilename()}`;
        await download.saveAs(path);
        console.log(`   Saved to: ${path}`);

        // Show file contents
        const fs = require('fs');
        const contents = fs.readFileSync(path, 'utf8');
        console.log(`\n📄 CSV Contents (first 500 chars):\n${contents.substring(0, 500)}`);
      } else {
        console.log('\n⚠️ No download detected within 10 seconds');
      }
    }

  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
    await page.screenshot({ path: '/tmp/export-test-error.png', fullPage: true });
    console.log('📸 Error screenshot: /tmp/export-test-error.png');
  } finally {
    await browser.close();
  }
})();
