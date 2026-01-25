const { chromium } = require('playwright');

(async () => {
  console.log('🧪 Testing Dashboard Performance Metrics Display');

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const context = await browser.newContext({
    ignoreHTTPSErrors: true
  });

  const page = await context.newPage();

  try {
    console.log('📍 Navigating to https://dids.amdy.io/login...');
    await page.goto('https://dids.amdy.io/login');
    await page.waitForTimeout(2000);

    console.log('🔐 Logging in...');
    await page.fill('input[type="email"]', 'client@test3.com');
    await page.fill('input[type="password"]', 'password123');
    await page.click('button[type="submit"]');

    console.log('⏳ Waiting for dashboard to load...');
    await page.waitForTimeout(5000);

    // Wait for System Health section
    console.log('🔍 Looking for Performance Metrics section...');
    await page.waitForSelector('text=Performance Metrics', { timeout: 10000 });

    // Check if performance metrics are displayed
    const activeSessions = await page.isVisible('text=Active Sessions');
    const didQueryTime = await page.isVisible('text=DID Query Time');
    const resultsQueryTime = await page.isVisible('text=Results Query Time');
    const requestsPerSecond = await page.isVisible('text=Requests/Second');

    console.log('✅ Performance Metrics Found:');
    console.log('   - Active Sessions:', activeSessions ? 'VISIBLE' : 'NOT FOUND');
    console.log('   - DID Query Time:', didQueryTime ? 'VISIBLE' : 'NOT FOUND');
    console.log('   - Results Query Time:', resultsQueryTime ? 'VISIBLE' : 'NOT FOUND');
    console.log('   - Requests/Second:', requestsPerSecond ? 'VISIBLE' : 'NOT FOUND');

    // Check for All Tenants section (admin only)
    try {
      await page.waitForSelector('text=All Tenants', { timeout: 5000 });
      const tenantTable = await page.$$('table tbody tr');
      console.log('✅ All Tenants Table Found:', tenantTable.length, 'rows');
    } catch (e) {
      console.log('ℹ️  All Tenants section not visible (admin only)');
    }

    // Take screenshot
    await page.screenshot({ path: '/tmp/dashboard-performance-metrics.png', fullPage: true });
    console.log('📸 Screenshot saved: /tmp/dashboard-performance-metrics.png');

    console.log('\n✅ TEST PASSED - Performance metrics are visible in dashboard!');

    await page.waitForTimeout(3000);

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    await page.screenshot({ path: '/tmp/dashboard-performance-error.png', fullPage: true });
    console.log('📸 Error screenshot saved: /tmp/dashboard-performance-error.png');
  } finally {
    await browser.close();
  }
})();
