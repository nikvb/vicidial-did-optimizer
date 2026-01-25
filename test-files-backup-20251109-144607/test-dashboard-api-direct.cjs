const { chromium } = require('playwright');

(async () => {
  console.log('🔍 Testing Dashboard API Directly...');

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  // Track all requests and responses
  page.on('request', request => {
    console.log('🌐 REQUEST:', request.method(), request.url());
  });

  page.on('response', response => {
    console.log('📡 RESPONSE:', response.url(), response.status());
    if (response.url().includes('/api/v1/dashboard/stats')) {
      response.text().then(text => {
        console.log('📄 DASHBOARD STATS RESPONSE:', text.substring(0, 500));
      });
    }
  });

  try {
    // Step 1: Login to get valid session
    console.log('1. 🔐 Logging in...');
    await page.goto('http://api3.amdy.io:5000/login');
    await page.waitForTimeout(2000);

    await page.fill('input[type="email"]', 'client@test3.com');
    await page.fill('input[type="password"]', 'password123');
    await page.click('button[type="submit"]');
    await page.waitForURL('**/dashboard', { timeout: 10000 });

    // Step 2: Make direct API call to dashboard stats
    console.log('2. 📊 Making direct API call to dashboard stats...');

    const response = await page.evaluate(async () => {
      try {
        const token = localStorage.getItem('token');
        console.log('Token found:', !!token);

        const response = await fetch('/api/v1/dashboard/stats', {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          }
        });

        const responseText = await response.text();

        return {
          status: response.status,
          statusText: response.statusText,
          headers: Object.fromEntries(response.headers.entries()),
          body: responseText
        };
      } catch (error) {
        return {
          error: error.message,
          stack: error.stack
        };
      }
    });

    console.log('✅ Direct API Response:', JSON.stringify(response, null, 2));

    // Step 3: Check browser console for errors
    console.log('3. 🔍 Checking browser console...');

    const consoleLogs = [];
    page.on('console', msg => {
      consoleLogs.push(`${msg.type()}: ${msg.text()}`);
    });

    await page.reload();
    await page.waitForTimeout(3000);

    console.log('📝 Browser Console Logs:');
    consoleLogs.forEach(log => console.log('  ', log));

  } catch (error) {
    console.error('❌ Test failed:', error.message);
  }

  await browser.close();
  console.log('🏁 Direct API test completed');
})();