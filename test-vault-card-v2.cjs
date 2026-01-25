const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  // Capture network requests
  page.on('response', async (response) => {
    const url = response.url();
    if (url.includes('/billing/payment-methods/vault')) {
      console.log(`🌐 Vault API: ${response.status()}`);
      const body = await response.text().catch(() => '');
      console.log('Response:', body.substring(0, 300));
    }
  });

  // Capture console errors
  page.on('console', msg => {
    if (msg.type() === 'error') {
      console.log('❌ BROWSER ERROR:', msg.text());
    }
  });

  try {
    console.log('🔐 Logging in...');
    await page.goto('https://dids.amdy.io/login', { waitUntil: 'networkidle' });
    await page.fill('input[type="email"]', 'client@test3.com');
    await page.fill('input[type="password"]', 'password123');
    await page.click('button[type="submit"]');
    await page.waitForURL('**/dashboard', { timeout: 10000 });

    console.log('✅ Logged in! Navigating to billing...');
    await page.goto('https://dids.amdy.io/billing', { waitUntil: 'networkidle', timeout: 15000 });
    await page.waitForTimeout(3000);

    // Scroll to the form
    await page.evaluate(() => {
      window.scrollTo(0, document.body.scrollHeight);
    });
    await page.waitForTimeout(1000);

    console.log('📝 Filling out card details (form is already visible)...');

    // Fill card number (look for the actual input by placeholder or name)
    await page.fill('input[placeholder*="1234" i], input[name*="card" i]', '4111111111111111');
    await page.fill('input[placeholder*="MM" i]', '12');
    await page.fill('input[placeholder*="YYYY" i], input[placeholder*="Year" i]', '2028');
    await page.fill('input[placeholder*="CVV" i], input[placeholder*="123" i]', '123');

    // Fill name fields
    const firstNameInput = await page.locator('input').filter({ hasText: /First/i }).or(page.locator('input[placeholder*="First" i]')).first();
    await firstNameInput.fill('John');

    const lastNameInput = await page.locator('input').filter({ hasText: /Last/i }).or(page.locator('input[placeholder*="Last" i]')).first();
    await lastNameInput.fill('Doe');

    // Fill address
    await page.fill('input[placeholder*="Street" i], input[name*="street" i]', '123 Main St');
    await page.fill('input[placeholder*="City" i], input[name*="city" i]', 'San Francisco');
    await page.fill('input[placeholder*="State" i], input[value="CA"]', 'CA');
    await page.fill('input[placeholder*="ZIP" i], input[name*="zip" i]', '94102');

    console.log('🚀 Submitting card...');
    // Find and click the submit button
    await page.click('button[type="submit"]:has-text("Add Payment Method"), button:has-text("Save"), button:has-text("Submit")');

    // Wait for response
    await page.waitForTimeout(8000);

    // Take screenshot of result
    await page.screenshot({ path: 'test-vault-result.png', fullPage: true });
    console.log('📸 Screenshot saved as test-vault-result.png');

  } catch (error) {
    console.error('❌ Test error:', error.message);
    await page.screenshot({ path: 'test-vault-error.png', fullPage: true });
  } finally {
    await browser.close();
  }
})();
