const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    console.log('🔍 Testing DID Selection Across Pagination - Fixed Version\n');

    // Login
    await page.goto('https://dids.amdy.io/login');
    await page.fill('input[type="email"]', 'client@test3.com');
    await page.fill('input[type="password"]', 'password123');
    await page.click('button[type="submit"]');
    await page.waitForURL('**/dashboard', { timeout: 10000 });
    console.log('✅ Successfully logged in');

    // Navigate to DID Management
    await page.goto('https://dids.amdy.io/did-management');
    await page.waitForTimeout(5000);
    console.log('📊 Navigated to DID Management page');

    // Wait for table to load
    await page.waitForSelector('[role="row"]', { timeout: 10000 });
    console.log('✅ Table loaded');

    // Check initial state
    const totalDIDsText = await page.textContent('text=/Showing \\d+ to \\d+ of \\d+ DIDs/');
    console.log(`📊 ${totalDIDsText}`);

    // Find and click Select All checkbox
    const selectAllCheckbox = await page.$('input[type="checkbox"]:first-of-type');
    if (selectAllCheckbox) {
      await selectAllCheckbox.click();
      await page.waitForTimeout(1000);
      console.log('✅ Clicked "Select All" checkbox');

      // Count selected on page 1
      const selectedPage1 = await page.$$('input[type="checkbox"]:checked');
      console.log(`📊 Page 1: ${selectedPage1.length} checkboxes selected`);

      // Look for pagination controls using the exact elements from screenshot
      const nextButton = await page.$('button[aria-label="Next"], svg[class*="chevron-right"], button:has(svg[class*="chevron"]):last-child');

      if (!nextButton) {
        // Try finding the pagination container and then the next button
        const paginationArea = await page.$('text=/1-10 of 499/');
        if (paginationArea) {
          console.log('✅ Found pagination area');
          // Look for buttons near the pagination text
          const nextArrow = await page.$('button[aria-label="Go to next page"], button >> svg');
          if (nextArrow) {
            console.log('🔄 Found next button, clicking...');
            await nextArrow.click();
            await page.waitForTimeout(3000);

            // Check selections on page 2
            const selectedPage2 = await page.$$('input[type="checkbox"]:checked');
            console.log(`📊 Page 2: ${selectedPage2.length} checkboxes selected`);

            if (selectedPage2.length === 0 || selectedPage2.length === 1) {
              console.log('❌ CONFIRMED ISSUE: Selections don\'t persist across pages');
              console.log('🔧 Need to fix the Select All logic to handle all pages');
            }
          }
        }
      }

      // Try clicking the rightmost navigation button
      const allButtons = await page.$$('button');
      console.log(`🔍 Found ${allButtons.length} buttons on page`);

      // Look for buttons in the bottom area
      const bottomButtons = await page.$$('div:has(text("1-10 of 499")) button, div:has(text("Showing")) ~ * button');
      console.log(`🔍 Found ${bottomButtons.length} buttons near pagination`);

      if (bottomButtons.length > 0) {
        // Try the last button (should be next)
        const lastButton = bottomButtons[bottomButtons.length - 1];
        const isDisabled = await lastButton.isDisabled();

        if (!isDisabled) {
          console.log('🔄 Trying last pagination button...');
          await lastButton.click();
          await page.waitForTimeout(3000);

          const selectedAfterNav = await page.$$('input[type="checkbox"]:checked');
          console.log(`📊 After navigation: ${selectedAfterNav.length} checkboxes selected`);

          const newPageText = await page.textContent('text=/Showing \\d+ to \\d+ of \\d+ DIDs/');
          console.log(`📊 ${newPageText}`);
        }
      }
    }

    await page.screenshot({ path: 'pagination-selection-test.png', fullPage: true });
    console.log('📸 Screenshot saved as pagination-selection-test.png');

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    await page.screenshot({ path: 'pagination-selection-error.png', fullPage: true });
  } finally {
    await browser.close();
  }
})();