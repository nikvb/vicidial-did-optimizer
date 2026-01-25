const { chromium } = require('playwright');

async function testCapacityTenant() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

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
    await page.waitForTimeout(2000);

    // Click on Capacity tab
    console.log('5. Clicking Capacity tab...');
    await page.click('button:text-is("capacity")');
    await page.waitForTimeout(2000);

    // Get the Total DIDs number from the capacity section
    const pageContent = await page.textContent('body');

    // Look for Total DIDs value
    const totalDIDsMatch = pageContent.match(/Total DIDs\s*(\d[\d,]*)/);
    if (totalDIDsMatch) {
      const totalDIDs = totalDIDsMatch[1].replace(/,/g, '');
      console.log(`6. Total DIDs shown in Capacity: ${totalDIDs}`);

      if (parseInt(totalDIDs) <= 1001) {
        console.log('   ✅ Correct! Shows only tenant DIDs (~1000), not all 14,258');
      } else {
        console.log('   ❌ ERROR: Showing system-wide DIDs instead of tenant!');
      }
    } else {
      console.log('6. Could not find Total DIDs value');
    }

    // Take screenshot
    await page.screenshot({ path: '/home/na/didapi/capacity-tenant-test.png', fullPage: true });
    console.log('7. Screenshot saved: capacity-tenant-test.png');

    console.log('\n=== TEST COMPLETE ===');

  } catch (error) {
    console.error('Test error:', error.message);
    await page.screenshot({ path: '/home/na/didapi/capacity-tenant-error.png', fullPage: true });
    console.log('Error screenshot saved');
  } finally {
    await browser.close();
  }
}

testCapacityTenant();
