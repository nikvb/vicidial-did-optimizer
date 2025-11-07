const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    console.log('🔍 Debugging Select All Pages API Call\n');

    // Enable console and network monitoring
    page.on('console', msg => {
      if (msg.type() === 'error') {
        console.log('❌ Browser Error:', msg.text());
      }
    });

    page.on('response', response => {
      if (response.url().includes('/dids/all-ids')) {
        console.log(`📡 API Response: ${response.status()} ${response.url()}`);
      }
    });

    // Login
    await page.goto('https://dids.amdy.io/login');
    await page.fill('input[type="email"]', 'client@test3.com');
    await page.fill('input[type="password"]', 'password123');
    await page.click('button[type="submit"]');
    await page.waitForURL('**/dashboard', { timeout: 10000 });
    console.log('✅ Successfully logged in');

    // Navigate to DID Management
    await page.goto('https://dids.amdy.io/did-management');
    await page.waitForTimeout(5000);
    console.log('📊 Navigated to DID Management page');

    // Check total DIDs
    const totalText = await page.textContent('text=/of \\d+ DIDs/');
    console.log(`📊 Total DIDs shown: ${totalText}`);

    // Find and click Select All Pages button
    const selectAllPagesButton = await page.$('button:has-text("Select All Pages")');
    if (selectAllPagesButton) {
      console.log('✅ Found "Select All Pages" button');

      // Listen for network requests
      const responsePromise = page.waitForResponse('**/dids/all-ids**', { timeout: 5000 }).catch(() => null);

      await selectAllPagesButton.click();
      console.log('🔄 Clicked "Select All Pages" button');

      // Wait for API response
      const response = await responsePromise;
      if (response) {
        const status = response.status();
        const responseText = await response.text();
        console.log(`📡 API Response Status: ${status}`);
        console.log(`📡 API Response: ${responseText.substring(0, 200)}...`);

        if (responseText.includes('ids')) {
          const data = JSON.parse(responseText);
          console.log(`📊 API returned ${data.ids ? data.ids.length : 'unknown'} IDs`);
        }
      } else {
        console.log('❌ No API response received');
      }

      await page.waitForTimeout(2000);

      // Check how many are selected
      const selectedText = await page.textContent('text=/\\d+ DIDs? selected/');
      console.log(`📊 Selection result: ${selectedText}`);

    } else {
      console.log('❌ "Select All Pages" button not found');
    }

    await page.screenshot({ path: 'debug-select-all.png', fullPage: true });
    console.log('📸 Screenshot saved as debug-select-all.png');

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    await page.screenshot({ path: 'debug-select-all-error.png', fullPage: true });
  } finally {
    await browser.close();
  }
})();