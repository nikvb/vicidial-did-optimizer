const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    console.log('🚀 Testing DID Management - Last Usage Date Fix');

    // Go to the login page
    await page.goto('http://localhost:5000/login');
    console.log('📄 Navigated to login page');

    // Login with test credentials
    await page.fill('input[type="email"]', 'client@test3.com');
    await page.fill('input[type="password"]', 'password123');
    await page.click('button[type="submit"]');
    console.log('🔑 Login form submitted');

    // Wait for redirect to dashboard
    await page.waitForURL('**/dashboard', { timeout: 10000 });
    console.log('✅ Successfully logged in and redirected to dashboard');

    // Navigate to DID Management
    await page.click('a[href="/did-management"]');
    await page.waitForURL('**/did-management', { timeout: 10000 });
    console.log('📊 Navigated to DID Management page');

    // Wait for DIDs to load
    await page.waitForSelector('table', { timeout: 10000 });
    console.log('📋 DID table loaded');

    // Check if any DIDs have lastUsed dates displayed
    const didRows = await page.$$('tbody tr');
    console.log(`📞 Found ${didRows.length} DIDs in the table`);

    let foundLastUsedDate = false;
    for (let i = 0; i < Math.min(didRows.length, 5); i++) {
      const row = didRows[i];
      const lastUsedText = await row.textContent();

      // Look for "Last:" text which indicates a lastUsed date
      if (lastUsedText.includes('Last:')) {
        console.log(`✅ DID ${i + 1}: Found lastUsed date - ${lastUsedText.match(/Last: [^\n]+/)?.[0] || 'unknown format'}`);
        foundLastUsedDate = true;
      } else {
        console.log(`❌ DID ${i + 1}: No lastUsed date found`);
      }
    }

    if (foundLastUsedDate) {
      console.log('✅ SUCCESS: Last usage dates are being displayed!');
    } else {
      console.log('❌ ISSUE: No last usage dates found in the table');
    }

    // Take a screenshot for verification
    await page.screenshot({ path: 'did-management-usage-test.png', fullPage: true });
    console.log('📸 Screenshot saved as did-management-usage-test.png');

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    await page.screenshot({ path: 'did-management-error.png', fullPage: true });
    console.log('📸 Error screenshot saved as did-management-error.png');
  } finally {
    await browser.close();
  }
})();