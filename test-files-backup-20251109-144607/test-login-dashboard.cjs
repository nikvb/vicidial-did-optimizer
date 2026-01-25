const { chromium } = require('playwright');
const path = require('path');

async function testLoginAndDashboard() {
  console.log('🚀 Starting login and dashboard test...');

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 }
  });
  const page = await context.newPage();

  try {
    console.log('📍 Navigating to https://dids.amdy.io/login');
    await page.goto('https://dids.amdy.io/login', { waitUntil: 'networkidle' });
    await page.screenshot({ path: 'login-page.png' });
    console.log('✅ Screenshot saved: login-page.png');

    // Fill login form
    console.log('📝 Filling login form with client@test3.com');
    await page.fill('input[type="email"]', 'client@test3.com');
    await page.fill('input[type="password"]', 'password123');
    await page.screenshot({ path: 'login-filled.png' });
    console.log('✅ Screenshot saved: login-filled.png');

    // Submit login
    console.log('🔐 Submitting login form');
    await page.click('button[type="submit"]');

    // Wait for navigation or response
    await page.waitForTimeout(3000);
    await page.screenshot({ path: 'after-login.png' });
    console.log('✅ Screenshot saved: after-login.png');

    // Check current URL
    const currentUrl = page.url();
    console.log('📍 Current URL:', currentUrl);

    // Try to navigate to dashboard
    console.log('📊 Navigating to dashboard');
    await page.goto('https://dids.amdy.io/dashboard', { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);
    await page.screenshot({ path: 'dashboard-page.png' });
    console.log('✅ Screenshot saved: dashboard-page.png');

    // Check for any error messages or loading states
    const errorMessages = await page.$$eval('[class*="error"], [class*="Error"]',
      elements => elements.map(el => el.textContent)
    );
    if (errorMessages.length > 0) {
      console.log('❌ Error messages found:', errorMessages);
    }

    // Check for loading states
    const loadingElements = await page.$$eval('[class*="loading"], [class*="Loading"], [class*="spinner"]',
      elements => elements.map(el => el.textContent)
    );
    if (loadingElements.length > 0) {
      console.log('⏳ Loading elements found:', loadingElements);
    }

    // Try to navigate to DID management
    console.log('📞 Navigating to DID management');
    await page.goto('https://dids.amdy.io/dids', { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);
    await page.screenshot({ path: 'dids-page.png' });
    console.log('✅ Screenshot saved: dids-page.png');

    // Check network requests for API calls
    console.log('🌐 Monitoring network requests...');
    const requests = [];
    page.on('request', request => {
      if (request.url().includes('/api/')) {
        requests.push({
          url: request.url(),
          method: request.method()
        });
      }
    });

    // Refresh dashboard to capture API calls
    await page.goto('https://dids.amdy.io/dashboard', { waitUntil: 'networkidle' });
    await page.waitForTimeout(3000);
    await page.screenshot({ path: 'dashboard-final.png' });
    console.log('✅ Screenshot saved: dashboard-final.png');

    console.log('📡 API requests captured:', requests);

    // Check console logs for errors
    const logs = [];
    page.on('console', msg => {
      if (msg.type() === 'error') {
        logs.push(msg.text());
      }
    });

    if (logs.length > 0) {
      console.log('🐛 Console errors:', logs);
    }

    console.log('✅ Test completed successfully');

  } catch (error) {
    console.error('❌ Test failed:', error);
    await page.screenshot({ path: 'error-screenshot.png' });
    console.log('✅ Error screenshot saved: error-screenshot.png');
  } finally {
    await browser.close();
  }
}

testLoginAndDashboard();