const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    console.log('🔍 Testing DID Selection Across Pagination\n');

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

    // Find the "Select All" checkbox in the header
    const selectAllCheckbox = await page.$('input[type="checkbox"]:first-of-type, th input[type="checkbox"], [role="columnheader"] input[type="checkbox"]');

    if (selectAllCheckbox) {
      console.log('✅ Found "Select All" checkbox');

      // Check if it's already checked
      const isChecked = await selectAllCheckbox.isChecked();
      console.log(`📋 Select All checkbox state: ${isChecked ? 'CHECKED' : 'UNCHECKED'}`);

      // Click the Select All checkbox if not checked
      if (!isChecked) {
        await selectAllCheckbox.click();
        await page.waitForTimeout(1000);
        console.log('✅ Clicked "Select All" checkbox');
      }

      // Count selected checkboxes on page 1
      const selectedCheckboxes = await page.$$('input[type="checkbox"]:checked');
      console.log(`📊 Page 1: ${selectedCheckboxes.length} checkboxes selected`);

      // Find and click the next page button
      const nextPageButton = await page.$('button[aria-label="Next page"], button:has-text("Next"), [aria-label*="next"], .pagination button:last-child, button[title*="next"]');

      if (nextPageButton) {
        const isNextDisabled = await nextPageButton.isDisabled();
        if (!isNextDisabled) {
          console.log('🔄 Going to next page...');
          await nextPageButton.click();
          await page.waitForTimeout(3000); // Wait for page to load

          // Count selected checkboxes on page 2
          const selectedCheckboxesPage2 = await page.$$('input[type="checkbox"]:checked');
          console.log(`📊 Page 2: ${selectedCheckboxesPage2.length} checkboxes selected`);

          // Check if the Select All checkbox is still checked
          const selectAllCheckedPage2 = await page.$('input[type="checkbox"]:first-of-type:checked');
          console.log(`📋 Page 2 Select All state: ${selectAllCheckedPage2 ? 'CHECKED' : 'UNCHECKED'}`);

          if (selectedCheckboxesPage2.length === 0) {
            console.log('❌ ISSUE FOUND: No DIDs selected on page 2 after "Select All"');
            console.log('🔧 This indicates the selection only applies to the current page');
          } else {
            console.log('✅ DIDs remain selected on page 2');
          }

          // Go back to page 1 to check if selections persist
          const prevPageButton = await page.$('button[aria-label="Previous page"], button:has-text("Previous"), [aria-label*="previous"], .pagination button:first-child, button[title*="previous"]');
          if (prevPageButton && !await prevPageButton.isDisabled()) {
            console.log('🔄 Going back to page 1...');
            await prevPageButton.click();
            await page.waitForTimeout(3000);

            const selectedCheckboxesPage1Return = await page.$$('input[type="checkbox"]:checked');
            console.log(`📊 Page 1 (return): ${selectedCheckboxesPage1Return.length} checkboxes selected`);
          }

        } else {
          console.log('ℹ️  Next page button is disabled (only one page of data)');
        }
      } else {
        console.log('❌ Could not find next page button');

        // Try alternative selectors for pagination
        const paginationElements = await page.$$('[class*="pagination"], [class*="pager"], button[class*="next"], [role="navigation"]');
        console.log(`🔍 Found ${paginationElements.length} potential pagination elements`);
      }

    } else {
      console.log('❌ Could not find "Select All" checkbox');

      // Try to find any checkboxes
      const allCheckboxes = await page.$$('input[type="checkbox"]');
      console.log(`🔍 Found ${allCheckboxes.length} total checkboxes on page`);

      if (allCheckboxes.length > 0) {
        console.log('✅ Found individual checkboxes, testing manual selection...');

        // Select first few individual checkboxes
        for (let i = 0; i < Math.min(3, allCheckboxes.length); i++) {
          await allCheckboxes[i].click();
          await page.waitForTimeout(500);
        }

        const manualSelected = await page.$$('input[type="checkbox"]:checked');
        console.log(`📊 Manually selected: ${manualSelected.length} checkboxes`);
      }
    }

    // Take screenshot for verification
    await page.screenshot({ path: 'did-selection-test.png', fullPage: true });
    console.log('📸 Screenshot saved as did-selection-test.png');

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    await page.screenshot({ path: 'did-selection-error.png', fullPage: true });
  } finally {
    await browser.close();
  }
})();