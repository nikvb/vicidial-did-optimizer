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

    console.log('📸 Initial state on Page 1...');
    await page.screenshot({ path: 'test-multipage-page1-initial.png', fullPage: true });

    // Select first 3 rows on page 1
    console.log('🔘 Selecting first 3 rows on Page 1...');
    for (let i = 0; i < 3; i++) {
      const checkbox = await page.locator('tbody input[type="checkbox"]').nth(i);
      await checkbox.click();
      await page.waitForTimeout(300);
    }

    await page.screenshot({ path: 'test-multipage-page1-selected.png', fullPage: true });

    // Check selection count
    const bulkOpsBar = await page.locator('div:has-text("selected")').filter({ hasText: /\d+ DID/ }).first();
    let selectionText = await bulkOpsBar.textContent();
    console.log(`✅ Page 1 selections: ${selectionText}`);

    // Navigate to page 2
    console.log('📄 Navigating to Page 2...');
    const nextButton = await page.locator('button').filter({ hasText: 'Next' }).or(page.locator('button[aria-label="Next Page"]'));
    const nextExists = await nextButton.count() > 0;

    if (!nextExists) {
      console.log('⚠️  Next button not found - checking pagination');
      await page.screenshot({ path: 'test-multipage-no-next-button.png', fullPage: true });

      // Try alternative pagination selector
      const pagination = await page.locator('[role="navigation"]').last();
      await pagination.screenshot({ path: 'test-multipage-pagination-debug.png' });

      // Try clicking the "2" button directly
      const page2Button = await page.locator('button:has-text("2")').first();
      if (await page2Button.count() > 0) {
        console.log('📄 Clicking page 2 button...');
        await page2Button.click();
      } else {
        console.log('❌ Cannot find page 2 navigation');
        return;
      }
    } else {
      await nextButton.first().click();
    }

    await page.waitForTimeout(2000);
    await page.screenshot({ path: 'test-multipage-page2-initial.png', fullPage: true });

    // Check if selections from page 1 are still showing in counter
    const bulkOpsBar2 = await page.locator('div:has-text("selected")').filter({ hasText: /\d+ DID/ }).first();
    const isVisible = await bulkOpsBar2.isVisible();

    if (isVisible) {
      selectionText = await bulkOpsBar2.textContent();
      console.log(`✅ Page 2 - Selections from Page 1 still showing: ${selectionText}`);
    } else {
      console.log('❌ Bulk operations bar disappeared - selections may have been lost!');
    }

    // Select 2 more rows on page 2
    console.log('🔘 Selecting 2 more rows on Page 2...');
    for (let i = 0; i < 2; i++) {
      const checkbox = await page.locator('tbody input[type="checkbox"]').nth(i);
      await checkbox.click();
      await page.waitForTimeout(300);
    }

    await page.screenshot({ path: 'test-multipage-page2-selected.png', fullPage: true });

    // Check total count (should be 5 now: 3 from page 1 + 2 from page 2)
    const bulkOpsBar3 = await page.locator('div:has-text("selected")').filter({ hasText: /\d+ DID/ }).first();
    selectionText = await bulkOpsBar3.textContent();
    console.log(`✅ Total selections after Page 2: ${selectionText}`);

    // Navigate back to page 1
    console.log('📄 Navigating back to Page 1...');
    const prevButton = await page.locator('button').filter({ hasText: 'Previous' }).or(page.locator('button[aria-label="Previous Page"]'));

    if (await prevButton.count() > 0) {
      await prevButton.first().click();
    } else {
      const page1Button = await page.locator('button:has-text("1")').first();
      await page1Button.click();
    }

    await page.waitForTimeout(2000);
    await page.screenshot({ path: 'test-multipage-back-to-page1.png', fullPage: true });

    // Verify the 3 rows on page 1 are still selected
    const selectedCheckboxes = await page.locator('tbody input[type="checkbox"]:checked').count();
    console.log(`✅ Page 1 has ${selectedCheckboxes} rows selected (should be 3)`);

    const bulkOpsBar4 = await page.locator('div:has-text("selected")').filter({ hasText: /\d+ DID/ }).first();
    selectionText = await bulkOpsBar4.textContent();
    console.log(`✅ Final selection count: ${selectionText}`);

    if (selectedCheckboxes === 3) {
      console.log('🎉 SUCCESS! Multi-page selection is working correctly!');
    } else {
      console.log(`⚠️  PARTIAL: Expected 3 selected checkboxes on page 1, got ${selectedCheckboxes}`);
    }

  } catch (error) {
    console.error('❌ Test failed:', error);
    await page.screenshot({ path: 'test-multipage-error.png', fullPage: true });
  } finally {
    await browser.close();
  }
})();
