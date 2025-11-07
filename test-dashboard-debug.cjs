const { chromium } = require('playwright');

async function testDashboardWithLogs() {
  console.log('🚀 Starting dashboard debug test...');

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  // Capture console logs
  page.on('console', msg => {
    console.log(`🖥️  CONSOLE ${msg.type()}: ${msg.text()}`);
  });

  // Capture JavaScript errors
  page.on('pageerror', error => {
    console.log(`❌ PAGE ERROR: ${error.message}`);
  });

  // Monitor network requests and responses
  const requests = [];
  page.on('request', request => {
    if (request.url().includes('/api/')) {
      requests.push({
        url: request.url(),
        method: request.method(),
        headers: request.headers()
      });
      console.log(`📤 API REQUEST: ${request.method()} ${request.url()}`);
    }
  });

  page.on('response', response => {
    if (response.url().includes('/api/')) {
      console.log(`📥 API RESPONSE: ${response.status()} ${response.url()}`);
      response.text().then(body => {
        if (body) {
          console.log(`📋 RESPONSE BODY: ${body.substring(0, 500)}`);
        }
      }).catch(err => console.log(`📋 Could not read response body: ${err.message}`));
    }
  });

  try {
    // Navigate to login
    console.log('📍 Navigating to https://dids.amdy.io/login');
    await page.goto('https://dids.amdy.io/login', { waitUntil: 'networkidle' });

    // Fill login form
    console.log('📝 Filling login form');
    await page.fill('input[type="email"]', 'client@test3.com');
    await page.fill('input[type="password"]', 'password123');

    // Submit login
    console.log('🔐 Submitting login form');
    await page.click('button[type="submit"]');
    await page.waitForURL('**/dashboard', { timeout: 10000 });

    console.log('📍 Successfully logged in, now on dashboard');

    // Wait for potential API calls and errors
    console.log('⏳ Waiting for dashboard to load and make API calls...');
    await page.waitForTimeout(5000);

    // Check if error message is visible
    const errorMessage = await page.locator('text="Failed to load dashboard data"').isVisible();
    console.log(`🚨 Error message visible: ${errorMessage}`);

    // Take final screenshot
    await page.screenshot({ path: 'debug-dashboard.png' });
    console.log('✅ Screenshot saved: debug-dashboard.png');

    console.log(`📊 Total API requests captured: ${requests.length}`);
    requests.forEach((req, i) => {
      console.log(`  ${i + 1}. ${req.method} ${req.url}`);
    });

    await browser.close();
    console.log('✅ Debug test completed');

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    await page.screenshot({ path: 'debug-error.png' });
    console.log('✅ Error screenshot saved: debug-error.png');
    await browser.close();
  }
}

testDashboardWithLogs();