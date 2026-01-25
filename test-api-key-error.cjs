const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  // Listen to all console messages
  page.on('console', msg => {
    console.log('BROWSER CONSOLE:', msg.type(), msg.text());
  });

  // Listen to all network responses
  page.on('response', async (response) => {
    if (response.url().includes('api-keys')) {
      console.log(`\n📡 API Response: ${response.status()} ${response.url()}`);
      try {
        const body = await response.json();
        console.log('Response body:', JSON.stringify(body, null, 2));
      } catch (e) {
        const text = await response.text();
        console.log('Response text:', text);
      }
    }
  });

  try {
    console.log('1. Navigating to login page...');
    await page.goto('https://dids.amdy.io/login', { waitUntil: 'networkidle' });

    console.log('2. Logging in...');
    await page.fill('input[type="email"]', 'client@test3.com');
    await page.fill('input[type="password"]', 'password123');
    await page.click('button[type="submit"]');
    await page.waitForURL('**/dashboard', { timeout: 10000 });
    console.log('✓ Login successful');

    console.log('3. Navigating to Settings...');
    await page.goto('https://dids.amdy.io/settings', { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);

    console.log('4. Clicking Create API Key button...');
    await page.click('button:has-text("Create API Key")');
    await page.waitForTimeout(1000);

    console.log('5. Filling out form with test data...');
    await page.fill('input[placeholder*="VICIdial"]', 'Test Error Key');
    await page.screenshot({ path: 'error-test-before-create.png', fullPage: true });

    console.log('6. Submitting form...');
    await page.click('button:has-text("Create Key")');

    // Wait for either success modal or error message
    console.log('7. Waiting for response...');
    await page.waitForTimeout(3000);

    // Check for error message
    const errorVisible = await page.isVisible('.bg-red-50');
    if (errorVisible) {
      const errorText = await page.textContent('.bg-red-50');
      console.error('\n❌ ERROR MESSAGE:', errorText);
    }

    // Check for success modal
    const modalVisible = await page.isVisible('text=API Key Created Successfully!');
    console.log(`\nSuccess modal visible: ${modalVisible}`);
    console.log(`Error message visible: ${errorVisible}`);

    await page.screenshot({ path: 'error-test-after-create.png', fullPage: true });

    // Check browser console for errors
    console.log('\n8. Checking for JavaScript errors...');

  } catch (error) {
    console.error('❌ Test error:', error);
    await page.screenshot({ path: 'error-test-exception.png', fullPage: true });
  } finally {
    await browser.close();
  }
})();
