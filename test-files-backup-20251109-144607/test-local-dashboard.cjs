const { chromium } = require('playwright');

async function testLocalDashboard() {
  console.log('🚀 Starting LOCAL login and dashboard test...');

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  // Monitor network requests
  const requests = [];
  page.on('request', request => {
    if (request.url().includes('/api/')) {
      requests.push({
        url: request.url(),
        method: request.method()
      });
    }
  });

  try {
    // Navigate to LOCAL development server
    console.log('📍 Navigating to http://localhost:3000/login');
    await page.goto('http://localhost:3000/login', { waitUntil: 'networkidle' });
    await page.screenshot({ path: 'local-login-page.png' });
    console.log('✅ Screenshot saved: local-login-page.png');

    // Fill login form
    console.log('📝 Filling login form with client@test3.com');
    await page.fill('input[type="email"]', 'client@test3.com');
    await page.fill('input[type="password"]', 'password123');
    await page.screenshot({ path: 'local-login-filled.png' });
    console.log('✅ Screenshot saved: local-login-filled.png');

    // Submit login
    console.log('🔐 Submitting login form');
    await page.click('button[type="submit"]');
    await page.waitForURL('**/dashboard', { timeout: 10000 });
    await page.screenshot({ path: 'local-after-login.png' });
    console.log('✅ Screenshot saved: local-after-login.png');
    console.log('📍 Current URL:', page.url());

    // Wait for dashboard to load
    console.log('📊 Waiting for dashboard to load');
    await page.waitForTimeout(3000);
    await page.screenshot({ path: 'local-dashboard-page.png' });
    console.log('✅ Screenshot saved: local-dashboard-page.png');

    // Navigate to DID management
    console.log('📞 Navigating to DID management');
    await page.click('a[href="/did-management"]');
    await page.waitForURL('**/did-management', { timeout: 5000 });
    await page.waitForTimeout(3000);
    await page.screenshot({ path: 'local-dids-page.png' });
    console.log('✅ Screenshot saved: local-dids-page.png');

    // Wait a bit more for any network requests
    console.log('🌐 Monitoring network requests...');
    await page.waitForTimeout(2000);
    await page.screenshot({ path: 'local-dashboard-final.png' });
    console.log('✅ Screenshot saved: local-dashboard-final.png');

    console.log('📡 API requests captured:', requests);

    await browser.close();
    console.log('✅ Test completed successfully');

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    await page.screenshot({ path: 'local-error.png' });
    console.log('✅ Error screenshot saved: local-error.png');
    await browser.close();
  }
}

testLocalDashboard();