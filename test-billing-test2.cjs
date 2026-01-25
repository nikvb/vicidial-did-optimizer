const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  // Capture API responses
  page.on('response', async (response) => {
    if (response.url().includes('billing')) {
      console.log(`\n📡 ${response.status()} ${response.url()}`);
      try {
        const body = await response.json();
        if (response.url().includes('subscription')) {
          console.log('Subscription data:', JSON.stringify(body, null, 2));
        }
      } catch (e) {
        const text = await response.text();
        console.log('Error response:', text.substring(0, 200));
      }
    }
  });

  // Capture console errors
  page.on('console', msg => {
    if (msg.type() === 'error') {
      console.log('BROWSER ERROR:', msg.text());
    }
  });

  try {
    console.log('1. Login with client@test2.com...');
    await page.goto('https://dids.amdy.io/login');
    await page.fill('input[type="email"]', 'client@test2.com');
    await page.fill('input[type="password"]', 'care72345');
    await page.click('button[type="submit"]');

    try {
      await page.waitForURL('**/dashboard', { timeout: 10000 });
      console.log('✓ Login successful');
    } catch (e) {
      console.log('✗ Login failed or redirected elsewhere');
      await page.screenshot({ path: 'test2-login-failed.png', fullPage: true });
      const currentUrl = page.url();
      console.log('Current URL:', currentUrl);
      return;
    }

    console.log('\n2. Navigate to Billing page...');
    await page.goto('https://dids.amdy.io/billing');
    await page.waitForTimeout(4000);

    const errorVisible = await page.isVisible('text=Error Loading Billing');
    const contentVisible = await page.isVisible('text=Current Subscription');

    console.log(`\nError visible: ${errorVisible}`);
    console.log(`Content visible: ${contentVisible}`);

    if (errorVisible) {
      const errorText = await page.textContent('.text-red-700, .text-red-600, text=Failed to load');
      console.log(`Error message: ${errorText}`);
    }

    await page.screenshot({ path: 'test2-billing-page.png', fullPage: true });
    console.log('Screenshot saved: test2-billing-page.png');

    console.log('\n=== RESULT ===');
    if (contentVisible && !errorVisible) {
      console.log('✅ Billing page works for test2 user');
    } else if (errorVisible) {
      console.log('❌ Billing page has errors for test2 user');
    } else {
      console.log('⚠️  Unexpected state - check screenshot');
    }

  } catch (error) {
    console.error('Test error:', error);
    await page.screenshot({ path: 'test2-error.png', fullPage: true });
  } finally {
    await browser.close();
  }
})();
