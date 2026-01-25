const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  // Capture console logs
  page.on('console', msg => {
    if (msg.type() === 'error') {
      console.log('❌ CONSOLE ERROR:', msg.text());
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
    await page.waitForTimeout(2000);

    console.log('💳 Clicking Add Payment Method...');
    await page.click('button:has-text("Add Payment Method")');
    await page.waitForTimeout(1000);

    console.log('📝 Filling out card details...');
    await page.fill('input[placeholder*="Card number" i]', '4111111111111111');
    await page.fill('input[placeholder*="MM" i]', '12');
    await page.fill('input[placeholder*="YYYY" i]', '2028');
    await page.fill('input[placeholder*="CVV" i]', '123');
    await page.fill('input[placeholder*="First" i]', 'John');
    await page.fill('input[placeholder*="Last" i]', 'Doe');
    await page.fill('input[placeholder*="Street" i]', '123 Main St');
    await page.fill('input[placeholder*="City" i]', 'San Francisco');
    await page.fill('input[placeholder*="State" i]', 'CA');
    await page.fill('input[placeholder*="ZIP" i]', '94102');

    console.log('🚀 Submitting card...');
    await page.click('button:has-text("Add Payment Method"):not([disabled])');

    // Wait for response
    await page.waitForTimeout(5000);

    // Check for success or error messages
    const successMsg = await page.locator('text=/success|added/i').first().textContent().catch(() => null);
    const errorMsg = await page.locator('text=/error|failed/i').first().textContent().catch(() => null);

    if (successMsg) {
      console.log('✅ SUCCESS:', successMsg);
    } else if (errorMsg) {
      console.log('❌ ERROR:', errorMsg);
    } else {
      console.log('⏳ No clear success/error message found');
    }

    // Take screenshot
    await page.screenshot({ path: 'test-vault-result.png', fullPage: true });
    console.log('📸 Screenshot saved as test-vault-result.png');

  } catch (error) {
    console.error('❌ Test error:', error.message);
    await page.screenshot({ path: 'test-vault-error.png', fullPage: true });
  } finally {
    await browser.close();
  }
})();
