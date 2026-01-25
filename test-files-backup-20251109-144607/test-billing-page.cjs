const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    console.log('🔐 Navigating to login page...');
    await page.goto('https://dids.amdy.io/login', { waitUntil: 'networkidle' });

    console.log('📝 Filling login form...');
    await page.fill('input[type="email"]', 'client@test3.com');
    await page.fill('input[type="password"]', 'password123');

    console.log('🚀 Logging in...');
    await page.click('button[type="submit"]');
    await page.waitForURL('**/dashboard', { timeout: 10000 });

    console.log('✅ Login successful! Navigating to billing page...');
    await page.goto('https://dids.amdy.io/billing', { waitUntil: 'networkidle', timeout: 15000 });

    // Wait for billing content to load
    await page.waitForTimeout(3000);

    console.log('📸 Taking screenshot...');
    await page.screenshot({ path: 'billing-page-screenshot.png', fullPage: true });

    console.log('✅ Screenshot saved as billing-page-screenshot.png');

    // Check if billing menu is visible
    const billingMenuVisible = await page.isVisible('text=Billing');
    console.log('💳 Billing menu visible:', billingMenuVisible);

    // Check page title
    const pageTitle = await page.textContent('h1');
    console.log('📄 Page title:', pageTitle);

  } catch (error) {
    console.error('❌ Error:', error.message);
    await page.screenshot({ path: 'billing-error-screenshot.png', fullPage: true });
    console.log('📸 Error screenshot saved as billing-error-screenshot.png');
  } finally {
    await browser.close();
  }
})();
