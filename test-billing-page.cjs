const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  // Capture console errors
  page.on('console', msg => {
    if (msg.type() === 'error') {
      console.log('BROWSER ERROR:', msg.text());
    }
  });

  // Capture network responses
  page.on('response', async (response) => {
    if (response.url().includes('billing') || response.url().includes('subscription')) {
      console.log(`\n📡 ${response.status()} ${response.url()}`);
      console.log('Content-Type:', response.headers()['content-type']);

      try {
        const body = await response.json();
        console.log('Response:', JSON.stringify(body, null, 2));
      } catch (e) {
        const text = await response.text();
        console.log('Response text:', text.substring(0, 300));
      }
    }
  });

  try {
    console.log('1. Login...');
    await page.goto('https://dids.amdy.io/login');
    await page.fill('input[type="email"]', 'client@test3.com');
    await page.fill('input[type="password"]', 'password123');
    await page.click('button[type="submit"]');
    await page.waitForURL('**/dashboard', { timeout: 10000 });
    console.log('✓ Logged in');

    console.log('\n2. Navigate to Billing page...');
    await page.goto('https://dids.amdy.io/billing');
    await page.waitForTimeout(3000);

    // Check for error message
    const errorVisible = await page.isVisible('text=Error Loading Billing');
    console.log(`\nError visible: ${errorVisible}`);

    if (errorVisible) {
      const errorText = await page.textContent('text=Failed to load billing information');
      console.log(`Error message: ${errorText}`);
    }

    await page.screenshot({ path: 'billing-page-error.png', fullPage: true });
    console.log('Screenshot saved: billing-page-error.png');

  } catch (error) {
    console.error('Test error:', error);
    await page.screenshot({ path: 'billing-test-error.png', fullPage: true });
  } finally {
    await browser.close();
  }
})();
