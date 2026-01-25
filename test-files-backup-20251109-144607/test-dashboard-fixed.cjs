const { chromium } = require('playwright');

async function testDashboardFixed() {
  console.log('🚀 Testing Dashboard fix for correct DID count...');

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  // Monitor console and errors
  page.on('console', msg => {
    if (msg.type() === 'error') {
      console.log(`🖥️  CONSOLE ERROR: ${msg.text()}`);
    }
  });

  page.on('pageerror', error => {
    console.log(`❌ PAGE ERROR: ${error.message}`);
  });

  const apiResponses = [];
  page.on('response', response => {
    if (response.url().includes('/api/v1/dashboard/stats')) {
      response.text().then(body => {
        if (body) {
          console.log(`📊 Dashboard API Response: ${body}`);
          try {
            const data = JSON.parse(body);
            apiResponses.push(data);
          } catch (e) {
            console.log('Failed to parse dashboard API response');
          }
        }
      }).catch(err => console.log(`Failed to read dashboard response: ${err.message}`));
    }
  });

  try {
    // Navigate to login
    console.log('📍 Navigating to login page...');
    await page.goto('http://api3.amdy.io:3000/login', { waitUntil: 'networkidle' });

    // Fill login form
    console.log('📝 Logging in as client@test3.com...');
    await page.fill('input[type="email"]', 'client@test3.com');
    await page.fill('input[type="password"]', 'password123');

    // Submit login
    await page.click('button[type="submit"]');
    await page.waitForURL('**/dashboard', { timeout: 10000 });

    console.log('✅ Successfully reached dashboard page');

    // Wait for dashboard data to load
    await page.waitForTimeout(3000);

    // Check dashboard statistics cards
    console.log('🔍 Checking dashboard statistics...');

    // Look for Active DIDs stat card
    const activeDidsCard = page.locator('text="Active DIDs"').locator('..');
    const activeDidsExists = await activeDidsCard.isVisible();
    console.log(`📊 Active DIDs card found: ${activeDidsExists}`);

    if (activeDidsExists) {
      // Get the value displayed for Active DIDs
      const activeDidsValue = await page.locator('text="Active DIDs"').locator('..').locator('div.text-2xl').textContent();
      console.log(`📱 Active DIDs displayed: "${activeDidsValue}"`);

      // Check if it shows 501 (expected value) instead of 0
      const isCorrect = activeDidsValue && activeDidsValue.trim() !== '0';
      console.log(`✅ Shows correct value (not 0): ${isCorrect}`);

      if (activeDidsValue && activeDidsValue.includes('501')) {
        console.log('🎉 PERFECT! Dashboard shows correct 501 active DIDs');
      } else if (activeDidsValue && activeDidsValue.trim() !== '0') {
        console.log(`✅ Dashboard shows non-zero value: ${activeDidsValue}`);
      } else {
        console.log('❌ Dashboard still shows 0 - fix may not have worked');
      }
    }

    // Check other stats for completeness
    const statsCards = [
      'Calls Today',
      'Success Rate',
      'API Usage'
    ];

    for (const statName of statsCards) {
      const card = page.locator(`text="${statName}"`).locator('..');
      const exists = await card.isVisible();
      if (exists) {
        const value = await page.locator(`text="${statName}"`).locator('..').locator('div.text-2xl').textContent();
        console.log(`📊 ${statName}: ${value}`);
      }
    }

    // Check if API response was captured
    if (apiResponses.length > 0) {
      const response = apiResponses[0];
      console.log('🔍 API Response Analysis:');
      console.log(`  - Total DIDs: ${response.data?.totalDIDs}`);
      console.log(`  - Active DIDs: ${response.data?.activeDIDs}`);
      console.log(`  - API Usage: ${response.data?.apiUsage}`);
    }

    // Take screenshot
    await page.screenshot({ path: 'test-dashboard-fixed.png' });
    console.log('✅ Screenshot saved: test-dashboard-fixed.png');

    await browser.close();
    console.log('✅ Dashboard test completed successfully');

  } catch (error) {
    console.error('❌ Dashboard test failed:', error.message);
    await page.screenshot({ path: 'test-dashboard-fixed-error.png' });
    console.log('✅ Error screenshot saved: test-dashboard-fixed-error.png');
    await browser.close();
  }
}

testDashboardFixed();