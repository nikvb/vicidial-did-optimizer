const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  // Enable console logging
  page.on('console', msg => console.log('Browser console:', msg.text()));
  page.on('response', response => {
    if (response.url().includes('/api/')) {
      console.log('API Response:', response.url(), response.status());
    }
  });

  try {
    console.log('1. Navigating to login page...');
    await page.goto('http://localhost:3000/login');
    await page.waitForTimeout(2000);

    console.log('2. Taking screenshot of login page...');
    await page.screenshot({ path: '/tmp/login-page.png' });

    console.log('3. Filling in email...');
    await page.fill('input[type="email"], input[name="email"], input[id="email"]', 'client@test3.com');

    console.log('4. Filling in password...');
    await page.fill('input[type="password"], input[name="password"], input[id="password"]', 'password123');

    console.log('5. Taking screenshot before submit...');
    await page.screenshot({ path: '/tmp/before-submit.png' });

    console.log('6. Clicking submit button...');
    const submitButton = await page.locator('button[type="submit"], button:has-text("Sign in"), button:has-text("Login")').first();
    await submitButton.click();

    console.log('7. Waiting for navigation or error...');
    await page.waitForTimeout(3000);

    console.log('8. Current URL:', page.url());

    console.log('9. Taking screenshot after submit...');
    await page.screenshot({ path: '/tmp/after-submit.png' });

    // Check for any error messages
    const errorElements = await page.locator('.error, .alert, [role="alert"], .text-red-500').all();
    for (const error of errorElements) {
      const text = await error.textContent();
      if (text) console.log('Error found:', text);
    }

    // Check if we reached the dashboard
    if (page.url().includes('/dashboard')) {
      console.log('✓ Successfully logged in and reached dashboard!');
    } else {
      console.log('✗ Did not reach dashboard. Still at:', page.url());
    }

  } catch (error) {
    console.error('Error during test:', error);
    await page.screenshot({ path: '/tmp/error-screenshot.png' });
  }

  // Keep browser open for inspection
  console.log('Test complete. Browser will stay open for 10 seconds...');
  await page.waitForTimeout(10000);

  await browser.close();
})();