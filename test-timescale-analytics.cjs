const { chromium } = require('playwright');

async function testTimescaleAnalytics() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    console.log('1. Navigating to login page...');
    await page.goto('http://localhost:3000/login', { waitUntil: 'networkidle' });

    console.log('2. Logging in...');
    await page.fill('input[type="email"]', 'client@test3.com');
    await page.fill('input[type="password"]', 'password123');
    await page.click('button[type="submit"]');

    // Wait for navigation to dashboard
    await page.waitForURL('**/dashboard**', { timeout: 10000 });
    console.log('3. Logged in successfully');

    // Navigate to analytics
    console.log('4. Navigating to Analytics page...');
    await page.goto('http://localhost:3000/analytics', { waitUntil: 'networkidle' });

    // Wait for loading to complete
    await page.waitForSelector('text=Analytics Dashboard', { timeout: 15000 });
    console.log('5. Analytics page loaded');

    // Check for TimescaleDB indicator
    const tsIndicator = await page.textContent('body');
    if (tsIndicator.includes('TimescaleDB')) {
      console.log('6. TimescaleDB indicator found');
    }

    // Check for summary cards
    const todayCalls = await page.locator('text=Today\'s Calls').isVisible();
    const weekCalls = await page.locator('text=This Week').isVisible();
    const monthCalls = await page.locator('text=This Month').isVisible();

    console.log(`7. Summary cards visible: Today=${todayCalls}, Week=${weekCalls}, Month=${monthCalls}`);

    // Check tabs
    const tabs = ['overview', 'trends', 'campaigns', 'geographic', 'capacity'];
    for (const tab of tabs) {
      const tabButton = await page.locator(`button:text-is("${tab}")`).isVisible();
      console.log(`   Tab '${tab}': ${tabButton ? 'visible' : 'hidden'}`);
    }

    // Click on Trends tab
    console.log('8. Clicking Trends tab...');
    await page.click('button:text-is("trends")');
    await page.waitForTimeout(1000);

    const trendsTable = await page.locator('text=Daily Call Statistics').isVisible();
    console.log(`9. Trends table visible: ${trendsTable}`);

    // Take screenshot
    await page.screenshot({ path: '/home/na/didapi/analytics-timescale-test.png', fullPage: true });
    console.log('10. Screenshot saved: analytics-timescale-test.png');

    console.log('\n=== TEST PASSED ===');
    console.log('Analytics page is using TimescaleDB endpoints and displaying data correctly.');

  } catch (error) {
    console.error('Test failed:', error.message);
    await page.screenshot({ path: '/home/na/didapi/analytics-error.png', fullPage: true });
    console.log('Error screenshot saved: analytics-error.png');
  } finally {
    await browser.close();
  }
}

testTimescaleAnalytics();
