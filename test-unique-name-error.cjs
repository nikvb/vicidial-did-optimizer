const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  // Capture POST responses
  page.on('response', async (response) => {
    if (response.url().includes('api-keys') && response.request().method() === 'POST') {
      console.log(`\n📡 ${response.status()} ${response.url()}`);

      const contentType = response.headers()['content-type'];
      console.log('Content-Type:', contentType);

      try {
        const body = await response.json();
        console.log('✅ JSON Response:', JSON.stringify(body, null, 2));
      } catch (e) {
        const text = await response.text();
        console.log('❌ Non-JSON Response:', text.substring(0, 500));
      }
    }
  });

  try {
    console.log('Login...');
    await page.goto('https://dids.amdy.io/login');
    await page.fill('input[type="email"]', 'client@test3.com');
    await page.fill('input[type="password"]', 'password123');
    await page.click('button[type="submit"]');
    await page.waitForURL('**/dashboard', { timeout: 10000 });

    await page.goto('https://dids.amdy.io/settings');
    await page.waitForTimeout(2000);

    const uniqueName = 'UniqueTest' + Date.now();
    console.log(`\nTesting with UNIQUE name: ${uniqueName}`);

    await page.click('button:has-text("Create API Key")');
    await page.waitForTimeout(500);
    await page.fill('input[placeholder*="VICIdial"]', uniqueName);
    await page.click('button:has-text("Create Key")');
    await page.waitForTimeout(3000);

    const errorVisible = await page.isVisible('.bg-red-50');
    const modalVisible = await page.isVisible('text=API Key Created Successfully!');

    console.log(`\nResult: Error=${errorVisible}, Success=${modalVisible}`);

    if (errorVisible) {
      const errorText = await page.textContent('.bg-red-50');
      console.log('ERROR:', errorText.trim());
    }

    await page.screenshot({ path: 'unique-name-test.png', fullPage: true });

  } catch (error) {
    console.error('Test error:', error);
  } finally {
    await browser.close();
  }
})();
