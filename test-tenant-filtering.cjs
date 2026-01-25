const { chromium } = require('playwright');

async function testTenantFiltering() {
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

    // Wait for navigation to dashboard
    await page.waitForURL('**/dashboard**', { timeout: 10000 });
    console.log('3. Logged in successfully');

    // Navigate to DID Management
    console.log('4. Navigating to DID Management page...');
    await page.goto('https://dids.amdy.io/did-management', { waitUntil: 'networkidle' });

    // Wait for the page to load
    await page.waitForTimeout(3000);

    // Check for total DID count indicator
    const pageContent = await page.textContent('body');

    // Look for the total count in pagination or table header
    const totalMatch = pageContent.match(/of\s+(\d+)/);
    if (totalMatch) {
      console.log(`5. Total DIDs shown: ${totalMatch[1]}`);
      const totalShown = parseInt(totalMatch[1]);
      if (totalShown === 1001) {
        console.log('   ✅ Correct! Shows only tenant DIDs (1001), not all 14,258');
      } else if (totalShown > 1001) {
        console.log('   ❌ ERROR: Showing more than tenant DIDs!');
      } else {
        console.log(`   ℹ️ Shows ${totalShown} DIDs`);
      }
    }

    // Take screenshot
    await page.screenshot({ path: '/home/na/didapi/tenant-filtering-test.png', fullPage: true });
    console.log('6. Screenshot saved: tenant-filtering-test.png');

    // Check pagination info
    const paginationText = await page.locator('.pagination, [class*="pagination"], .MuiTablePagination-root').textContent().catch(() => null);
    if (paginationText) {
      console.log('7. Pagination info:', paginationText.substring(0, 100));
    }

    console.log('\n=== TEST COMPLETE ===');

  } catch (error) {
    console.error('Test error:', error.message);
    await page.screenshot({ path: '/home/na/didapi/tenant-filtering-error.png', fullPage: true });
    console.log('Error screenshot saved: tenant-filtering-error.png');
  } finally {
    await browser.close();
  }
}

testTenantFiltering();
