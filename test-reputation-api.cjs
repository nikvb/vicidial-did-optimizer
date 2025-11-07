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

    console.log('📡 Fetching reputation API for +12097999082...');
    const response = await page.goto('https://dids.amdy.io/api/v1/dids/12097999082/reputation');

    if (response.ok()) {
      const data = await response.json();
      console.log('\n✅ API Response:');
      console.log(JSON.stringify(data, null, 2));

      console.log('\n📊 Key Fields:');
      console.log(`Score: ${data.score}`);
      console.log(`lastChecked: ${data.lastChecked}`);
      console.log(`robokiller.status: ${data.robokiller?.status}`);
      console.log(`robokiller.lastChecked: ${data.robokiller?.lastChecked}`);
      console.log(`robokiller.category: ${data.robokiller?.category}`);
      console.log(`robokiller.reports: ${data.robokiller?.reports}`);
    } else {
      console.error(`❌ API request failed with status: ${response.status()}`);
    }

  } catch (error) {
    console.error('❌ Test failed:', error);
  } finally {
    await browser.close();
  }
})();
