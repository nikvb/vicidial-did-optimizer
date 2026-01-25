const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  page.on('response', async (response) => {
    if (response.url().includes('billing/subscription')) {
      console.log(`\n📡 Subscription API: ${response.status()}`);
      try {
        const body = await response.json();
        console.log('Has perDidPricing:', !!body.data?.subscription?.perDidPricing);
        console.log('Has gracePeriod:', !!body.data?.subscription?.gracePeriod);
        console.log('Plan:', body.data?.subscription?.plan);
        console.log('Status:', body.data?.subscription?.status);
      } catch (e) {}
    }
  });

  try {
    // NOTE: We can't login as a Google OAuth user without credentials
    // So I'll test with our test user to verify the fix works in general
    console.log('Testing billing page after fix...');
    await page.goto('https://dids.amdy.io/login');
    await page.fill('input[type="email"]', 'client@test3.com');
    await page.fill('input[type="password"]', 'password123');
    await page.click('button[type="submit"]');
    await page.waitForURL('**/dashboard', { timeout: 10000 });

    await page.goto('https://dids.amdy.io/billing');
    await page.waitForTimeout(3000);

    const errorVisible = await page.isVisible('text=Error Loading Billing');
    const contentVisible = await page.isVisible('text=Current Subscription');

    console.log(`\n✅ Billing page loaded: ${contentVisible}`);
    console.log(`❌ Error visible: ${errorVisible}`);

    if (contentVisible && !errorVisible) {
      console.log('\n✓ BILLING PAGE WORKS!');
    } else {
      console.log('\n✗ Still has errors');
    }

    await page.screenshot({ path: 'billing-fixed-test.png', fullPage: true });

  } catch (error) {
    console.error('Test error:', error);
  } finally {
    await browser.close();
  }
})();
