const { chromium } = require('playwright');

(async () => {
  console.log('🚀 Testing Dashboard with Reputation-Filtered DIDs...');

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  // Track API requests
  page.on('request', request => {
    if (request.url().includes('/api/')) {
      console.log('🌐 REQUEST:', request.method(), request.url());
    }
  });

  page.on('response', response => {
    if (response.url().includes('/api/')) {
      console.log('📡 RESPONSE:', response.url(), response.status());
    }
  });

  try {
    // Step 1: Login
    console.log('1. 🔐 Logging in as client@test3.com...');
    await page.goto('http://api3.amdy.io:5000/login');
    await page.waitForTimeout(2000);

    await page.fill('input[type="email"]', 'client@test3.com');
    await page.fill('input[type="password"]', 'password123');
    await page.click('button[type="submit"]');

    // Wait for redirect to dashboard
    await page.waitForURL('**/dashboard', { timeout: 10000 });
    console.log('✅ Login successful - redirected to dashboard');

    // Step 2: Check dashboard loading
    console.log('2. 📊 Checking dashboard data loading...');

    // Wait for dashboard stats API call
    const statsResponse = await page.waitForResponse(
      response => response.url().includes('/api/v1/dashboard/stats') && response.status() === 200,
      { timeout: 10000 }
    );

    console.log('✅ Dashboard stats API call successful');

    // Step 3: Check dashboard content
    console.log('3. 🔍 Checking dashboard content...');

    await page.waitForTimeout(3000); // Wait for content to load

    // Take screenshot
    await page.screenshot({ path: 'dashboard-with-reputation.png' });
    console.log('📸 Dashboard screenshot saved: dashboard-with-reputation.png');

    // Check for dashboard elements
    const welcomeMessage = await page.locator('text=Welcome back').isVisible();
    console.log(`👋 Welcome message visible: ${welcomeMessage ? '✅' : '❌'}`);

    // Check for DID statistics cards
    const didCards = await page.locator('.bg-white.shadow, .bg-gray-50, [class*="card"]').count();
    console.log(`📊 Dashboard cards found: ${didCards}`);

    // Check for any error messages
    const errorMessage = await page.locator('text=Failed to load').isVisible();
    if (errorMessage) {
      console.log('❌ Error message found: "Failed to load dashboard data"');

      // Try to refresh the page
      console.log('🔄 Refreshing page to retry...');
      await page.reload();
      await page.waitForTimeout(3000);

      await page.screenshot({ path: 'dashboard-after-refresh.png' });
      console.log('📸 After refresh screenshot saved');
    } else {
      console.log('✅ No error messages found');
    }

    // Step 4: Check sidebar navigation
    console.log('4. 🧭 Testing navigation...');

    const sidebarItems = await page.locator('nav a, nav button').count();
    console.log(`🔗 Sidebar navigation items: ${sidebarItems}`);

    // Check if DID Management is accessible
    const didManagementLink = await page.locator('text=DID Management').isVisible();
    console.log(`📞 DID Management link visible: ${didManagementLink ? '✅' : '❌'}`);

    // Check if Settings is accessible
    const settingsLink = await page.locator('text=Settings').isVisible();
    console.log(`⚙️ Settings link visible: ${settingsLink ? '✅' : '❌'}`);

    // Step 5: Test DID Management page briefly
    if (didManagementLink) {
      console.log('5. 📞 Testing DID Management page...');
      await page.click('text=DID Management');
      await page.waitForTimeout(3000);

      await page.screenshot({ path: 'did-management-reputation.png' });
      console.log('📸 DID Management screenshot saved');

      // Check if DIDs are loading
      const didTable = await page.locator('table, .divide-y, [role="table"]').isVisible();
      console.log(`📋 DID table visible: ${didTable ? '✅' : '❌'}`);
    }

    // Step 6: Check user profile
    console.log('6. 👤 Checking user profile...');
    const userProfile = await page.locator('text=test1 test, text=CLIENT').isVisible();
    console.log(`👤 User profile visible: ${userProfile ? '✅' : '❌'}`);

    console.log('🎉 Dashboard test with reputation filtering completed!');

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    await page.screenshot({ path: 'dashboard-test-error.png' });
    console.log('📸 Error screenshot saved: dashboard-test-error.png');
  }

  await browser.close();
  console.log('🏁 Test completed');
})();