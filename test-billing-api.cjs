const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  // Capture console logs
  page.on('console', msg => {
    if (msg.type() === 'error') {
      console.log('❌ CONSOLE ERROR:', msg.text());
    } else if (msg.text().includes('billing') || msg.text().includes('API')) {
      console.log('📝 CONSOLE:', msg.text());
    }
  });

  // Capture network requests
  page.on('response', async (response) => {
    const url = response.url();
    if (url.includes('/billing')) {
      console.log(`🌐 ${response.status()} ${url}`);
      if (response.status() !== 200) {
        try {
          const body = await response.text();
          console.log('Response body:', body.substring(0, 200));
        } catch (e) {}
      }
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
    await page.waitForTimeout(5000);

    // Check localStorage for token
    const token = await page.evaluate(() => localStorage.getItem('token'));
    console.log('🔑 Token exists:', !!token);
    if (token) {
      console.log('🔑 Token preview:', token.substring(0, 50) + '...');
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await browser.close();
  }
})();
