const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  // Capture API requests to both port 5000 and Cloudflare
  page.on('response', async (response) => {
    if (response.url().includes('api-keys') && response.request().method() === 'POST') {
      console.log(`\n📡 ${response.status()} ${response.url()}`);
      console.log('Content-Type:', response.headers()['content-type']);

      try {
        const body = await response.json();
        console.log('✅ JSON:', JSON.stringify(body, null, 2));
      } catch (e) {
        const text = await response.text();
        console.log('❌ HTML/Text:', text.substring(0, 200));
      }
    }
  });

  try {
    // Login to get session
    console.log('1. Login to get authenticated session...');
    await page.goto('https://dids.amdy.io/login');
    await page.fill('input[type="email"]', 'client@test3.com');
    await page.fill('input[type="password"]', 'password123');
    await page.click('button[type="submit"]');
    await page.waitForURL('**/dashboard', { timeout: 10000 });

    // Get cookies
    const cookies = await context.cookies();
    const sessionCookie = cookies.find(c => c.name === 'connect.sid');
    console.log('Session cookie:', sessionCookie ? 'Found' : 'Not found');

    // Test 1: Via Cloudflare (dids.amdy.io)
    console.log('\n=== TEST 1: Via Cloudflare (https://dids.amdy.io) ===');
    await page.goto('https://dids.amdy.io/settings');
    await page.waitForTimeout(2000);
    await page.click('button:has-text("Create API Key")');
    await page.waitForTimeout(500);
    await page.fill('input[placeholder*="VICIdial"]', 'sdfsdf');
    await page.click('button:has-text("Create Key")');
    await page.waitForTimeout(3000);

    // Test 2: Direct to port 5000 (api3.amdy.io:5000)
    console.log('\n=== TEST 2: Direct to port 5000 (http://api3.amdy.io:5000) ===');

    // Make direct API call using fetch from browser context
    const directResult = await page.evaluate(async () => {
      try {
        const response = await fetch('http://api3.amdy.io:5000/api/v1/tenants/api-keys', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          credentials: 'include',
          body: JSON.stringify({
            name: 'sdfsdf',
            permissions: ['read']
          })
        });

        const contentType = response.headers.get('content-type');
        const text = await response.text();

        return {
          status: response.status,
          statusText: response.statusText,
          contentType,
          body: text.substring(0, 500)
        };
      } catch (error) {
        return {
          error: error.message
        };
      }
    });

    console.log('Direct port 5000 result:');
    console.log(JSON.stringify(directResult, null, 2));

  } catch (error) {
    console.error('Test error:', error);
  } finally {
    await browser.close();
  }
})();
