const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  // Capture ALL network responses
  page.on('response', async (response) => {
    if (response.url().includes('api-keys') && response.request().method() === 'POST') {
      console.log(`\n📡 API POST Response: ${response.status()}`);
      console.log('URL:', response.url());
      console.log('Status Text:', response.statusText());

      try {
        const body = await response.json();
        console.log('Response Body:', JSON.stringify(body, null, 2));
      } catch (e) {
        console.log('Could not parse JSON:', e.message);
        const text = await response.text();
        console.log('Response Text:', text);
      }

      // Log response headers
      console.log('Response Headers:');
      const headers = response.headers();
      for (const [key, value] of Object.entries(headers)) {
        console.log(`  ${key}: ${value}`);
      }
    }
  });

  // Capture console logs
  page.on('console', msg => {
    if (msg.text().includes('Error') || msg.text().includes('error')) {
      console.log('BROWSER ERROR:', msg.text());
    }
  });

  try {
    console.log('1. Login...');
    await page.goto('https://dids.amdy.io/login', { waitUntil: 'networkidle' });
    await page.fill('input[type="email"]', 'client@test3.com');
    await page.fill('input[type="password"]', 'password123');
    await page.click('button[type="submit"]');
    await page.waitForURL('**/dashboard', { timeout: 10000 });

    console.log('2. Navigate to Settings...');
    await page.goto('https://dids.amdy.io/settings', { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);

    console.log('3. Try to create duplicate API key "sdfsdf"...');
    await page.click('button:has-text("Create API Key")');
    await page.waitForTimeout(500);
    await page.fill('input[placeholder*="VICIdial"]', 'sdfsdf');

    console.log('4. Submit form and capture response...');
    await page.click('button:has-text("Create Key")');
    await page.waitForTimeout(3000);

    // Check what error is displayed
    const errorVisible = await page.isVisible('.bg-red-50');
    if (errorVisible) {
      const errorText = await page.textContent('.bg-red-50');
      console.log('\n🔴 DISPLAYED ERROR MESSAGE:', errorText.trim());
    }

    await page.screenshot({ path: '409-test-result.png', fullPage: true });

  } catch (error) {
    console.error('Test error:', error);
    await page.screenshot({ path: '409-test-error.png', fullPage: true });
  } finally {
    await browser.close();
  }
})();
