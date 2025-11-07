const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  // Track all requests to see what the frontend is doing
  page.on('request', request => {
    if (request.url().includes('/api/')) {
      console.log('🌐 REQUEST:', request.method(), request.url());
      console.log('🔗 Headers:', request.headers());
    }
  });

  // Track all responses
  page.on('response', response => {
    if (response.url().includes('/api/')) {
      console.log('📡 RESPONSE:', response.url(), response.status());
    }
  });

  // Enable console logging from the browser
  page.on('console', msg => {
    console.log('🖥️  Browser console:', msg.text());
  });

  // Track network failures
  page.on('requestfailed', request => {
    if (request.url().includes('/api/')) {
      console.log('❌ REQUEST FAILED:', request.url(), request.failure());
    }
  });

  try {
    console.log('1. First login...');
    await page.goto('https://dids.amdy.io/login');
    await page.waitForTimeout(2000);

    // Login
    await page.fill('input[type="email"], input[name="email"], input[id="email"]', 'client@test3.com');
    await page.fill('input[type="password"], input[name="password"], input[id="password"]', 'password123');

    const submitButton = await page.locator('button[type="submit"], button:has-text("Sign in"), button:has-text("Login")').first();
    await submitButton.click();

    console.log('2. Waiting for login redirect...');
    await page.waitForTimeout(3000);

    console.log('3. Current URL after login:', page.url());

    if (!page.url().includes('/dashboard')) {
      console.log('⚠️  Not on dashboard, navigating manually...');
      await page.goto('https://dids.amdy.io/dashboard');
      await page.waitForTimeout(3000);
    }

    console.log('4. On dashboard page, waiting for API calls...');
    await page.waitForTimeout(5000);

    console.log('5. Current URL:', page.url());

    // Check if we can see any dashboard stats in the DOM
    const statsElement = await page.locator('[data-testid="dashboard-stats"], .stats, .dashboard-stats').first();
    if (await statsElement.count() > 0) {
      console.log('✅ Found stats element in DOM');
    } else {
      console.log('❌ No stats element found in DOM');
    }

    console.log('6. Taking screenshot for debugging...');
    await page.screenshot({ path: '/tmp/dashboard-debug.png', fullPage: true });

  } catch (error) {
    console.error('❌ Error during test:', error);
    await page.screenshot({ path: '/tmp/dashboard-error.png', fullPage: true });
  }

  await browser.close();
})();