const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    console.log('🔐 Logging in...');
    await page.goto('https://dids.amdy.io/login');
    await page.waitForLoadState('networkidle');

    await page.fill('input[type="email"]', 'client@test3.com');
    await page.fill('input[type="password"]', 'password123');
    await page.click('button[type="submit"]');

    console.log('⏳ Waiting for dashboard...');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    console.log('📋 Navigating to DID Management...');
    await page.goto('https://dids.amdy.io/did-management');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(3000);

    console.log('📸 Initial state...');
    await page.screenshot({ path: 'test-flickering-before-selection.png', fullPage: true });

    // Select all checkbox
    console.log('🔘 Clicking select all checkbox...');
    const headerCheckbox = await page.locator('thead input[type="checkbox"]').first();
    await headerCheckbox.click();
    await page.waitForTimeout(500);

    console.log('📸 After clicking select all...');
    await page.screenshot({ path: 'test-flickering-after-select-all.png', fullPage: true });

    // Wait and observe for flickering (check if bulk bar remains stable)
    console.log('⏱️  Waiting 3 seconds to check for flickering...');
    await page.waitForTimeout(3000);

    console.log('📸 After waiting (should be stable)...');
    await page.screenshot({ path: 'test-flickering-stable.png', fullPage: true });

    // Check if bulk operations bar is visible and stable
    const bulkOpsBar = await page.locator('div:has-text("selected")').filter({ hasText: /\d+ DID/ }).first();
    const isVisible = await bulkOpsBar.isVisible();

    if (isVisible) {
      const text = await bulkOpsBar.textContent();
      console.log(`✅ Bulk operations bar is visible and showing: "${text}"`);
    } else {
      console.log('❌ Bulk operations bar not found');
    }

    // Select a few individual items
    console.log('🔘 Selecting individual rows...');
    await headerCheckbox.click(); // Deselect all first
    await page.waitForTimeout(500);

    const firstCheckbox = await page.locator('tbody input[type="checkbox"]').nth(0);
    const secondCheckbox = await page.locator('tbody input[type="checkbox"]').nth(1);
    const thirdCheckbox = await page.locator('tbody input[type="checkbox"]').nth(2);

    await firstCheckbox.click();
    await page.waitForTimeout(200);
    await secondCheckbox.click();
    await page.waitForTimeout(200);
    await thirdCheckbox.click();
    await page.waitForTimeout(500);

    console.log('📸 After individual selections...');
    await page.screenshot({ path: 'test-flickering-individual-selections.png', fullPage: true });

    // Wait again to check stability
    console.log('⏱️  Waiting 3 more seconds to verify no flickering...');
    await page.waitForTimeout(3000);

    console.log('📸 Final stable state...');
    await page.screenshot({ path: 'test-flickering-final.png', fullPage: true });

    console.log('✅ Flickering test completed! Check screenshots to verify stability.');

  } catch (error) {
    console.error('❌ Test failed:', error);
    await page.screenshot({ path: 'test-flickering-error.png', fullPage: true });
  } finally {
    await browser.close();
  }
})();
