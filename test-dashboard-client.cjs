const { chromium } = require('playwright');

(async () => {
  console.log('🚀 Starting Dashboard Test for client@test3.com...\n');

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: { width: 1920, height: 1080 }
  });

  const page = await context.newPage();

  // Enable console logging
  page.on('console', msg => console.log('PAGE LOG:', msg.text()));
  page.on('pageerror', error => console.log('PAGE ERROR:', error.message));

  try {
    // Step 1: Navigate to login page
    console.log('📍 Navigating to login page...');
    await page.goto('http://api3.amdy.io:3000/login', { waitUntil: 'networkidle', timeout: 30000 });
    await page.screenshot({ path: 'test-results/01-login-page.png' });
    console.log('✅ Login page loaded\n');

    // Step 2: Fill in login credentials
    console.log('🔐 Logging in as client@test3.com...');
    await page.fill('input[type="email"], input[name="email"]', 'client@test3.com');
    await page.fill('input[type="password"], input[name="password"]', 'password123');
    await page.screenshot({ path: 'test-results/02-credentials-filled.png' });

    // Step 3: Submit login
    console.log('📤 Submitting login form...');
    await page.click('button[type="submit"]');

    // Wait for navigation to dashboard
    await page.waitForURL('**/dashboard', { timeout: 10000 }).catch(() => {
      console.log('⚠️ URL did not change to dashboard, checking current URL...');
    });

    await page.waitForTimeout(3000);
    const currentUrl = page.url();
    console.log(`✅ Current URL: ${currentUrl}\n`);
    await page.screenshot({ path: 'test-results/03-after-login.png' });

    // Step 4: Check Dashboard Stats
    console.log('📊 Checking Dashboard Stats...');
    await page.waitForTimeout(2000);

    // Try to find stat cards
    const statCards = await page.locator('div.bg-white.overflow-hidden.shadow.rounded-lg').all();
    console.log(`Found ${statCards.length} stat cards\n`);

    // Extract all stat values
    for (let i = 0; i < statCards.length; i++) {
      const title = await statCards[i].locator('dt').textContent().catch(() => 'Unknown');
      const value = await statCards[i].locator('dd div.text-2xl').textContent().catch(() => 'N/A');
      console.log(`📈 ${title}: ${value}`);
    }

    await page.screenshot({ path: 'test-results/04-dashboard-stats.png' });
    console.log('');

    // Step 5: Navigate to DID Management
    console.log('📞 Navigating to DID Management...');

    // Try to find and click DID Management link
    const didLink = page.locator('a[href="/dids"], a:has-text("DID Management"), a:has-text("DIDs")').first();
    const didLinkExists = await didLink.count() > 0;

    if (didLinkExists) {
      await didLink.click();
      await page.waitForTimeout(3000);
      await page.screenshot({ path: 'test-results/05-did-management.png' });
      console.log('✅ Navigated to DID Management page\n');

      // Check DID Management stats
      console.log('📊 Checking DID Management Page...');

      // Look for pagination info
      const paginationText = await page.locator('text=/Showing .* of .*/').textContent().catch(() => null);
      if (paginationText) {
        console.log(`📋 Pagination: ${paginationText}`);
      }

      // Count rows in the table
      const tableRows = await page.locator('table tbody tr').count().catch(() => 0);
      console.log(`📋 Table rows visible: ${tableRows}`);

      // Try to find total count indicator
      const totalText = await page.locator('text=/Total.*DID/i, text=/of \\d+/').allTextContents();
      if (totalText.length > 0) {
        console.log(`📋 Total indicators found: ${totalText.join(', ')}`);
      }

    } else {
      console.log('⚠️ Could not find DID Management link');

      // Try navigating directly
      console.log('🔄 Trying direct navigation to /dids...');
      await page.goto('http://api3.amdy.io:3000/dids', { waitUntil: 'networkidle', timeout: 30000 });
      await page.waitForTimeout(3000);
      await page.screenshot({ path: 'test-results/05-did-management-direct.png' });

      // Check DID Management stats
      const paginationText = await page.locator('text=/Showing .* of .*/').textContent().catch(() => null);
      if (paginationText) {
        console.log(`📋 Pagination: ${paginationText}`);
      }

      const tableRows = await page.locator('table tbody tr').count().catch(() => 0);
      console.log(`📋 Table rows visible: ${tableRows}`);
    }

    await page.screenshot({ path: 'test-results/06-final-state.png' });
    console.log('');

    // Step 6: Check API Response
    console.log('🔍 Checking API Response...');
    const cookies = await context.cookies();
    const authToken = cookies.find(c => c.name === 'auth_token');

    if (authToken || await page.evaluate(() => localStorage.getItem('token'))) {
      console.log('✅ Authentication token found in cookies/localStorage\n');
    }

    console.log('✅ Test completed successfully!');

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    await page.screenshot({ path: 'test-results/error.png' });
    console.log('📸 Error screenshot saved');
  } finally {
    await browser.close();
  }
})();
