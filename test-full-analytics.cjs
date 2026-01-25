const { chromium } = require('playwright');

async function testFullAnalytics() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  // Capture console logs and network errors
  page.on('console', msg => {
    if (msg.type() === 'error') {
      console.log('Browser error:', msg.text());
    }
  });

  page.on('response', response => {
    if (!response.ok() && response.url().includes('/api/')) {
      console.log(`API Error: ${response.status()} ${response.url()}`);
    }
  });

  try {
    console.log('1. Navigating to login page...');
    await page.goto('https://dids.amdy.io/login', { waitUntil: 'networkidle' });

    console.log('2. Logging in as client@test3.com...');
    await page.fill('input[type="email"]', 'client@test3.com');
    await page.fill('input[type="password"]', 'password123');
    await page.click('button[type="submit"]');

    await page.waitForURL('**/dashboard**', { timeout: 10000 });
    console.log('3. Logged in successfully');

    console.log('4. Navigating to Analytics page...');
    await page.goto('https://dids.amdy.io/analytics', { waitUntil: 'networkidle' });
    await page.waitForTimeout(3000);

    // Check for error messages
    const bodyText = await page.textContent('body');

    if (bodyText.includes('ACCESS TOKEN') || bodyText.includes('token required') || bodyText.includes('Unauthorized')) {
      console.log('5. ❌ ERROR: Token/Auth error found on page');
    } else {
      console.log('5. ✅ No auth errors found');
    }

    // Check capacity section
    const capacityMatch = bodyText.match(/Total DIDs\s*(\d[\d,]*)/);
    if (capacityMatch) {
      const totalDIDs = capacityMatch[1].replace(/,/g, '');
      console.log(`6. Total DIDs in Capacity: ${totalDIDs}`);

      if (parseInt(totalDIDs) <= 1001) {
        console.log('   ✅ Correct tenant filtering');
      } else {
        console.log('   ❌ Showing system-wide data!');
      }
    }

    // Take screenshot
    await page.screenshot({ path: '/home/na/didapi/full-analytics-test.png', fullPage: true });
    console.log('7. Screenshot saved: full-analytics-test.png');

    console.log('\n=== TEST COMPLETE ===');

  } catch (error) {
    console.error('Test error:', error.message);
    await page.screenshot({ path: '/home/na/didapi/full-analytics-error.png', fullPage: true });
    console.log('Error screenshot saved');
  } finally {
    await browser.close();
  }
}

testFullAnalytics();
