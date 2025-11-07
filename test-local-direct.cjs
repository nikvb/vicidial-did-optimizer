const { chromium } = require('playwright');

async function testLocalDirect() {
  console.log('🚀 Testing localhost:3000 directly...');

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  // Monitor console and errors
  page.on('console', msg => {
    console.log(`🖥️  CONSOLE ${msg.type()}: ${msg.text()}`);
  });

  page.on('pageerror', error => {
    console.log(`❌ PAGE ERROR: ${error.message}`);
  });

  const requests = [];
  page.on('request', request => {
    if (request.url().includes('/api/')) {
      requests.push(request.url());
      console.log(`📤 API REQUEST: ${request.method()} ${request.url()}`);
    }
  });

  page.on('response', response => {
    if (response.url().includes('/api/')) {
      console.log(`📥 API RESPONSE: ${response.status()} ${response.url()}`);
    }
  });

  try {
    // Test direct localhost:3000
    console.log('📍 Testing http://localhost:3000/login');
    await page.goto('http://localhost:3000/login', { waitUntil: 'networkidle' });
    await page.screenshot({ path: 'test-localhost-login.png' });

    // Fill and submit login
    await page.fill('input[type="email"]', 'client@test3.com');
    await page.fill('input[type="password"]', 'password123');
    await page.click('button[type="submit"]');

    await page.waitForURL('**/dashboard', { timeout: 10000 });
    console.log('📍 Reached dashboard at:', page.url());

    // Wait for API calls
    await page.waitForTimeout(5000);
    await page.screenshot({ path: 'test-localhost-dashboard.png' });

    // Check for error message
    const errorMessage = await page.locator('text="Failed to load dashboard data"').isVisible();
    console.log(`🚨 Error message visible: ${errorMessage}`);

    console.log(`📊 API requests: ${requests.length}`);
    requests.forEach(req => console.log(`  - ${req}`));

    await browser.close();
    console.log('✅ Local test completed');

  } catch (error) {
    console.error('❌ Local test failed:', error.message);
    await page.screenshot({ path: 'test-localhost-error.png' });
    await browser.close();
  }
}

testLocalDirect();