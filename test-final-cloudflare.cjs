const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  // Track all requests to see what the frontend is doing
  page.on('request', request => {
    if (request.url().includes('endpoint.amdy.io') || request.url().includes('/api/')) {
      console.log('🌐 REQUEST:', request.method(), request.url());
    }
  });

  // Track all responses
  page.on('response', response => {
    if (response.url().includes('endpoint.amdy.io') || response.url().includes('/api/')) {
      console.log('📡 RESPONSE:', response.url(), response.status());
    }
  });

  // Enable console logging from the browser
  page.on('console', msg => {
    if (msg.text().includes('Dashboard') || msg.text().includes('stats') || msg.text().includes('activeDIDs') || msg.text().includes('API') || msg.text().includes('error')) {
      console.log('🖥️  Browser console:', msg.text());
    }
  });

  // Track network failures
  page.on('requestfailed', request => {
    console.log('❌ REQUEST FAILED:', request.url(), request.failure());
  });

  try {
    console.log('1. Testing direct API call to verify Cloudflare proxy...');
    const apiResponse = await page.evaluate(async () => {
      try {
        const response = await fetch('https://endpoint.amdy.io/api/v1/dashboard/stats');
        const data = await response.json();
        return { success: true, data };
      } catch (error) {
        return { success: false, error: error.message };
      }
    });
    console.log('Direct API test result:', apiResponse.success ? '✅ Success' : '❌ Failed', JSON.stringify(apiResponse, null, 2));

    console.log('2. Going to login page...');
    await page.goto('https://dids.amdy.io/login');
    await page.waitForTimeout(3000);

    console.log('3. Filling in credentials...');
    await page.fill('input[type="email"], input[name="email"], input[id="email"]', 'client@test3.com');
    await page.fill('input[type="password"], input[name="password"], input[id="password"]', 'password123');

    console.log('4. Clicking submit button...');
    const submitButton = await page.locator('button[type="submit"], button:has-text("Sign in"), button:has-text("Login")').first();
    await submitButton.click();

    console.log('5. Waiting for login response...');
    await page.waitForTimeout(5000);

    console.log('6. Current URL after login:', page.url());

    if (!page.url().includes('/dashboard')) {
      console.log('⚠️  Not on dashboard, navigating manually...');
      await page.goto('https://dids.amdy.io/dashboard');
      await page.waitForTimeout(3000);
    }

    console.log('7. On dashboard page, waiting for API calls...');
    await page.waitForTimeout(8000);

    console.log('8. Current URL:', page.url());

    // Check dashboard content
    const dashboardContent = await page.textContent('body');
    if (dashboardContent.includes('DID Stats') || dashboardContent.includes('Dashboard') || dashboardContent.includes('Total DIDs')) {
      console.log('✅ Found dashboard content');
    } else {
      console.log('❌ No dashboard content found');
    }

    // Look for specific dashboard elements
    const statsElements = await page.locator('[class*="stats"], [class*="dashboard"], [data-testid*="stats"], .card, .stat').count();
    console.log('9. Found', statsElements, 'potential stats elements');

    // Check if data is loaded
    const hasNumbers = /\d+/.test(dashboardContent);
    console.log('10. Dashboard contains numbers (data loaded):', hasNumbers ? '✅ Yes' : '❌ No');

    console.log('11. Taking screenshot...');
    await page.screenshot({ path: '/tmp/final-cloudflare-test.png', fullPage: true });

    // Test the DIDs page as well
    console.log('12. Testing DIDs page...');
    await page.goto('https://dids.amdy.io/dids');
    await page.waitForTimeout(5000);

    const didsContent = await page.textContent('body');
    if (didsContent.includes('DID') || didsContent.includes('Phone')) {
      console.log('✅ DIDs page loaded successfully');
    } else {
      console.log('❌ DIDs page not loading properly');
    }

  } catch (error) {
    console.error('❌ Error during test:', error);
    await page.screenshot({ path: '/tmp/final-cloudflare-error.png', fullPage: true });
  }

  await browser.close();
})();