const { chromium } = require('playwright');

(async () => {
  console.log('🔍 Detailed Dashboard API Test...');

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  // Capture console logs
  const consoleLogs = [];
  page.on('console', msg => {
    consoleLogs.push(`${msg.type()}: ${msg.text()}`);
  });

  try {
    // Step 1: Login
    console.log('1. 🔐 Logging in...');
    await page.goto('http://api3.amdy.io:5000/login');
    await page.waitForTimeout(2000);

    await page.fill('input[type="email"]', 'client@test3.com');
    await page.fill('input[type="password"]', 'password123');
    await page.click('button[type="submit"]');
    await page.waitForURL('**/dashboard', { timeout: 10000 });

    // Step 2: Check API response structure
    console.log('2. 📊 Testing API response structure...');

    const apiResponse = await page.evaluate(async () => {
      try {
        const token = localStorage.getItem('token');
        const response = await fetch('/api/v1/dashboard/stats', {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          }
        });

        const data = await response.json();
        console.log('Raw API Response:', JSON.stringify(data, null, 2));

        return {
          status: response.status,
          data: data,
          hasStats: !!data.stats,
          hasRecentActivity: !!data.recentActivity,
          statsKeys: data.stats ? Object.keys(data.stats) : [],
          recentActivityLength: data.recentActivity ? data.recentActivity.length : 0
        };
      } catch (error) {
        console.error('API Error:', error);
        return { error: error.message };
      }
    });

    console.log('✅ API Response Analysis:', JSON.stringify(apiResponse, null, 2));

    // Step 3: Wait and check dashboard state
    console.log('3. 🎯 Checking dashboard component state...');
    await page.waitForTimeout(5000);

    // Check for error message
    const hasError = await page.locator('text=Failed to load dashboard data').isVisible();
    console.log(`❌ Error message visible: ${hasError}`);

    // Check dashboard stats
    const activeDIDs = await page.locator('text=Active DIDs').isVisible();
    console.log(`📞 Active DIDs card visible: ${activeDIDs}`);

    // Take screenshot
    await page.screenshot({ path: 'dashboard-detailed-test.png' });
    console.log('📸 Screenshot saved: dashboard-detailed-test.png');

    // Print browser console logs
    console.log('📝 Browser Console Logs:');
    consoleLogs.forEach(log => console.log('  ', log));

  } catch (error) {
    console.error('❌ Test failed:', error.message);
  }

  await browser.close();
  console.log('🏁 Detailed test completed');
})();