const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    console.log('🔐 Logging in...');
    await page.goto('https://dids.amdy.io/login');
    await page.waitForLoadState('networkidle');

    await page.fill('input[type="email"]', 'client@test3.com');
    await page.fill('input[type="password"]', 'password123');
    await page.click('button[type="submit"]');

    console.log('⏳ Waiting for dashboard...');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    console.log('📋 Navigating to DID Management...');
    await page.goto('https://dids.amdy.io/did-management');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(3000);

    console.log('📸 Taking screenshot...');
    await page.screenshot({ path: 'test-did-count.png', fullPage: true });

    // Check the pagination text at the bottom
    const paginationText = await page.locator('text=/Showing.*of.*DIDs/i').first();
    const text = await paginationText.textContent();
    console.log(`\n📊 Pagination Info: ${text}`);

    // Extract total count
    const match = text.match(/of (\d+)/);
    if (match) {
      const totalDIDs = parseInt(match[1]);
      console.log(`\n✅ Total DIDs loaded: ${totalDIDs}`);

      if (totalDIDs >= 400) {
        console.log('🎉 SUCCESS: All DIDs are being fetched!');
      } else if (totalDIDs === 25) {
        console.log('❌ FAIL: Still only fetching 25 DIDs (default limit)');
      } else {
        console.log(`⚠️  WARNING: Fetched ${totalDIDs} DIDs (expected ~400+)`);
      }
    }

  } catch (error) {
    console.error('❌ Test failed:', error);
    await page.screenshot({ path: 'test-did-count-error.png', fullPage: true });
  } finally {
    await browser.close();
  }
})();
