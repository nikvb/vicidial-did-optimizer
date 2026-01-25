const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    // Login
    await page.goto('https://dids.amdy.io/login', { waitUntil: 'networkidle' });
    await page.fill('input[type="email"]', 'client@test3.com');
    await page.fill('input[type="password"]', 'password123');
    await page.click('button[type="submit"]');
    await page.waitForURL('**/dashboard', { timeout: 10000 });

    // Get token
    const token = await page.evaluate(() => localStorage.getItem('token'));

    // Test usage endpoint
    console.log('Testing /usage endpoint...');
    const response = await page.evaluate(async (token) => {
      const res = await fetch('https://dids.amdy.io/api/v1/billing/usage', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const text = await res.text();
      return { status: res.status, body: text };
    }, token);

    console.log('Status:', response.status);
    console.log('Body:', response.body);

  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await browser.close();
  }
})();
