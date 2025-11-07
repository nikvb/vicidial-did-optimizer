const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  // Track all requests to see what the frontend is doing
  page.on('request', request => {
    if (request.url().includes('/api/')) {
      console.log('🌐 REQUEST:', request.method(), request.url());
    }
  });

  // Track all responses
  page.on('response', response => {
    if (response.url().includes('/api/')) {
      console.log('📡 RESPONSE:', response.url(), response.status());
    }
  });

  // Enable console logging from the browser
  page.on('console', msg => {
    if (msg.text().includes('Dashboard') || msg.text().includes('stats') || msg.text().includes('activeDIDs') || msg.text().includes('API')) {
      console.log('🖥️  Browser console:', msg.text());
    }
  });

  // Track network failures
  page.on('requestfailed', request => {
    if (request.url().includes('/api/')) {
      console.log('❌ REQUEST FAILED:', request.url(), request.failure());
    }
  });

  try {
    console.log('1. Testing direct API call to see if it works...');
    const apiResponse = await page.evaluate(async () => {
      try {
        const response = await fetch('http://api3.amdy.io:5000/api/v1/dashboard/stats');
        const data = await response.json();
        return { success: true, data };
      } catch (error) {
        return { success: false, error: error.message };
      }
    });
    console.log('Direct API test result:', apiResponse.success ? '✅ Success' : '❌ Failed', apiResponse);

    console.log('2. Now going to actual dashboard page...');
    await page.goto('https://dids.amdy.io/dashboard');
    await page.waitForTimeout(5000);

    console.log('3. Checking for dashboard content...');
    const dashboardContent = await page.textContent('body');
    if (dashboardContent.includes('DID Stats') || dashboardContent.includes('Dashboard')) {
      console.log('✅ Found dashboard content');
    } else {
      console.log('❌ No dashboard content found');
    }

    console.log('4. Taking screenshot...');
    await page.screenshot({ path: '/tmp/dashboard-v2.png', fullPage: true });

  } catch (error) {
    console.error('❌ Error during test:', error);
    await page.screenshot({ path: '/tmp/dashboard-error-v2.png', fullPage: true });
  }

  await browser.close();
})();