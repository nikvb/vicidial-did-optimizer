const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  // Track all requests
  page.on('request', request => {
    if (request.url().includes('/api/')) {
      console.log('🌐 REQUEST:', request.method(), request.url());
    }
  });

  // Track all responses
  page.on('response', response => {
    if (response.url().includes('/api/')) {
      console.log('📡 RESPONSE:', response.url(), response.status());
    }
  });

  // Enable console logging
  page.on('console', msg => {
    if (msg.text().includes('[AUTH')) {
      console.log('Browser console:', msg.text());
    }
  });

  try {
    console.log('1. Navigating to login page...');
    // Using port 3000 for the frontend
    await page.goto('http://api3.amdy.io:3000/login');
    await page.waitForTimeout(2000);

    console.log('2. Filling in credentials...');
    await page.fill('input[type="email"], input[name="email"], input[id="email"]', 'client@test3.com');
    await page.fill('input[type="password"], input[name="password"], input[id="password"]', 'password123');

    console.log('3. Clicking submit button...');
    const submitButton = await page.locator('button[type="submit"], button:has-text("Sign in"), button:has-text("Login")').first();
    await submitButton.click();

    console.log('4. Waiting for response...');
    await page.waitForTimeout(5000);

    console.log('5. Current URL after login:', page.url());

    // Check if we reached the dashboard
    if (page.url().includes('/dashboard')) {
      console.log('✅ Login successful - reached dashboard!');
    } else {
      console.log('❌ Login failed - still at:', page.url());

      // Take screenshot for debugging
      await page.screenshot({ path: 'login-error-api3.png' });
      console.log('📸 Screenshot saved to login-error-api3.png');

      // Check for error messages
      const errorElement = await page.locator('.error-message, .alert-danger, [role="alert"]').first();
      if (await errorElement.count() > 0) {
        const errorText = await errorElement.textContent();
        console.log('Error message found:', errorText);
      }
    }

  } catch (error) {
    console.error('Error during test:', error);
    await page.screenshot({ path: 'test-error-api3.png' });
  }

  await browser.close();
})();