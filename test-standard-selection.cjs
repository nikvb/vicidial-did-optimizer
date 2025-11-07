const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    console.log('🔐 Logging in...');
    await page.goto('https://dids.amdy.io/login');
    await page.waitForLoadState('networkidle');

    // Login
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

    console.log('📸 Taking screenshot of DID Management page...');
    await page.screenshot({ path: 'test-standard-selection-initial.png', fullPage: true });

    // Check if standard select all checkbox exists
    console.log('✅ Checking for standard select all checkbox...');
    const selectAllCheckbox = await page.locator('input[type="checkbox"][data-testid="select-all-rows"]').first();
    const selectAllExists = await selectAllCheckbox.count() > 0;

    if (!selectAllExists) {
      console.log('⚠️  Standard select all checkbox not found, checking alternative selectors...');
      // Try to find checkbox in table header
      const headerCheckbox = await page.locator('thead input[type="checkbox"]').first();
      const headerCheckboxExists = await headerCheckbox.count() > 0;

      if (headerCheckboxExists) {
        console.log('✅ Found select all checkbox in table header');
        await page.screenshot({ path: 'test-standard-selection-checkbox-found.png', fullPage: true });

        // Click the select all checkbox
        console.log('🔘 Clicking select all checkbox...');
        await headerCheckbox.click();
        await page.waitForTimeout(1000);
        await page.screenshot({ path: 'test-standard-selection-all-selected.png', fullPage: true });

        // Check how many rows are selected
        const selectedRows = await page.locator('tbody input[type="checkbox"]:checked').count();
        console.log(`✅ Selected ${selectedRows} rows on current page`);

        // Navigate to next page
        console.log('📄 Navigating to next page...');
        const nextButton = await page.locator('button:has-text("Next"), button[aria-label="Next Page"]').first();
        const nextButtonExists = await nextButton.count() > 0;

        if (nextButtonExists) {
          await nextButton.click();
          await page.waitForTimeout(2000);
          await page.screenshot({ path: 'test-standard-selection-page2.png', fullPage: true });

          // Check if selections from page 1 are maintained
          const bulkOpsBar = await page.locator('div:has-text("DID")').filter({ hasText: 'selected' }).first();
          const bulkOpsExists = await bulkOpsBar.count() > 0;

          if (bulkOpsExists) {
            const bulkOpsText = await bulkOpsBar.textContent();
            console.log(`✅ Bulk operations bar shows: ${bulkOpsText}`);
          }

          // Select some items on page 2
          console.log('🔘 Selecting items on page 2...');
          const firstCheckboxPage2 = await page.locator('tbody input[type="checkbox"]').first();
          await firstCheckboxPage2.click();
          await page.waitForTimeout(1000);
          await page.screenshot({ path: 'test-standard-selection-page2-selected.png', fullPage: true });

          // Navigate back to page 1
          console.log('📄 Navigating back to page 1...');
          const prevButton = await page.locator('button:has-text("Previous"), button[aria-label="Previous Page"]').first();
          await prevButton.click();
          await page.waitForTimeout(2000);
          await page.screenshot({ path: 'test-standard-selection-back-to-page1.png', fullPage: true });

          // Check if selections are still there
          const selectedRowsPage1 = await page.locator('tbody input[type="checkbox"]:checked').count();
          console.log(`✅ Page 1 has ${selectedRowsPage1} rows still selected`);

        } else {
          console.log('⚠️  Next page button not found');
        }

        console.log('✅ Standard selection test completed successfully!');
      } else {
        console.log('❌ No select all checkbox found anywhere');
        await page.screenshot({ path: 'test-standard-selection-no-checkbox.png', fullPage: true });
      }
    }

    console.log('✅ Test completed! Check the screenshots for results.');

  } catch (error) {
    console.error('❌ Test failed:', error);
    await page.screenshot({ path: 'test-standard-selection-error.png', fullPage: true });
  } finally {
    await page.waitForTimeout(5000); // Keep browser open for 5 seconds to review
    await browser.close();
  }
})();
