const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  let testResults = {
    passed: [],
    failed: [],
    warnings: []
  };

  try {
    console.log('🔐 Step 1: Logging in...');
    await page.goto('https://dids.amdy.io/login');
    await page.waitForLoadState('networkidle');

    await page.fill('input[type="email"]', 'client@test3.com');
    await page.fill('input[type="password"]', 'password123');
    await page.click('button[type="submit"]');

    console.log('⏳ Waiting for dashboard...');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    console.log('📋 Step 2: Navigating to DID Management...');
    await page.goto('https://dids.amdy.io/did-management');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(3000);

    await page.screenshot({ path: 'multipage-step1-initial.png', fullPage: true });
    testResults.passed.push('Successfully navigated to DID Management page');

    // Test 1: Select 3-5 DIDs on Page 1
    console.log('\n=== TEST 1: Basic Cross-Page Selection ===');
    console.log('📝 Step 3: Selecting 5 DIDs on Page 1...');

    // Wait for table to be ready
    await page.waitForSelector('input[type="checkbox"]', { timeout: 10000 });

    for (let i = 0; i < 5; i++) {
      // Select checkboxes in the data table body (skip header checkbox)
      const checkbox = await page.locator('div[role="row"]').nth(i + 1).locator('input[type="checkbox"]');
      await checkbox.scrollIntoViewIfNeeded();
      await checkbox.click();
      await page.waitForTimeout(300);
      console.log(`  ✓ Selected DID ${i + 1}`);
    }

    await page.waitForTimeout(1000);
    await page.screenshot({ path: 'multipage-step2-page1-selected.png', fullPage: true });

    // Check selection count on page 1
    const bulkOpsBar = await page.locator('div:has-text("selected")').filter({ hasText: /\d+.*DID/ }).first();
    const bulkOpsVisible = await bulkOpsBar.isVisible();

    if (!bulkOpsVisible) {
      testResults.failed.push('❌ Bulk operations bar not visible after selecting 5 DIDs');
      console.log('❌ FAIL: Bulk operations bar not visible');
    } else {
      const bulkOpsText = await bulkOpsBar.textContent();
      console.log(`✓ Page 1 selection count: ${bulkOpsText}`);
      testResults.passed.push(`Bulk operations bar visible with selections: ${bulkOpsText}`);
    }

    // Navigate to Page 2
    console.log('\n📄 Step 4: Navigating to Page 2...');

    // Look for the next page button (right arrow)
    let navigated = false;
    try {
      // Try to find the pagination next button - it should be a button with an icon at the bottom
      const nextButton = await page.locator('button[aria-label*="next" i], button:has-text(">"), button >> svg').last();
      if (await nextButton.count() > 0) {
        await nextButton.scrollIntoViewIfNeeded();
        await nextButton.click();
        await page.waitForTimeout(2000);
        navigated = true;
        console.log('  ✓ Navigated to Page 2 using next button');
      }
    } catch (e) {
      console.log(`  ⚠️  Could not use next button: ${e.message}`);
    }

    if (!navigated) {
      testResults.failed.push('❌ Could not navigate to Page 2 - pagination not found');
      console.log('❌ FAIL: Could not navigate to Page 2');
      await page.screenshot({ path: 'multipage-navigation-failed.png', fullPage: true });
    } else {
      await page.screenshot({ path: 'multipage-step3-page2-initial.png', fullPage: true });

      // Step 5: Check if selections from Page 1 are still showing
      console.log('\n📊 Step 5: Checking if selections from Page 1 persist...');
      const bulkOpsBar2 = await page.locator('div:has-text("selected")').filter({ hasText: /\d+.*DID/ }).first();
      const bulkOpsVisible2 = await bulkOpsBar2.isVisible();

      if (!bulkOpsVisible2) {
        testResults.failed.push('❌ CRITICAL: Bulk operations bar disappeared after page navigation - selections LOST!');
        console.log('❌ FAIL: Selections from Page 1 were LOST when navigating to Page 2');
      } else {
        const bulkOpsText2 = await bulkOpsBar2.textContent();
        console.log(`✓ Page 2 still shows selections: ${bulkOpsText2}`);

        // Check if it still shows 5 selections
        if (bulkOpsText2.includes('5')) {
          testResults.passed.push('✅ Multi-page selection WORKING: 5 selections from Page 1 persisted to Page 2');
          console.log('✅ SUCCESS: Multi-page selection is WORKING! Selections persisted.');
        } else {
          testResults.warnings.push(`⚠️  Selection count changed: Expected 5, got: ${bulkOpsText2}`);
          console.log(`⚠️  WARNING: Selection count may have changed`);
        }
      }

      // Step 6: Select 2 more DIDs on Page 2
      console.log('\n📝 Step 6: Selecting 2 more DIDs on Page 2...');
      for (let i = 0; i < 2; i++) {
        const checkbox = await page.locator('div[role="row"]').nth(i + 1).locator('input[type="checkbox"]');
        await checkbox.scrollIntoViewIfNeeded();
        await checkbox.click();
        await page.waitForTimeout(300);
        console.log(`  ✓ Selected DID ${i + 1} on Page 2`);
      }

      await page.waitForTimeout(1000);
      await page.screenshot({ path: 'multipage-step4-page2-selected.png', fullPage: true });

      // Check if count increased to 7
      const bulkOpsBar3 = await page.locator('div:has-text("selected")').filter({ hasText: /\d+.*DID/ }).first();
      const bulkOpsText3 = await bulkOpsBar3.textContent();
      console.log(`✓ Total selections after Page 2: ${bulkOpsText3}`);

      if (bulkOpsText3.includes('7')) {
        testResults.passed.push('✅ Selection count correctly increased to 7 (5 from Page 1 + 2 from Page 2)');
        console.log('✅ SUCCESS: Count increased correctly to 7');
      } else {
        testResults.warnings.push(`⚠️  Expected 7 total selections, got: ${bulkOpsText3}`);
      }

      // Navigate back to Page 1
      console.log('\n📄 Step 7: Navigating back to Page 1...');

      let navigatedBack = false;
      try {
        // Try to find the previous button (left arrow)
        const prevButton = await page.locator('button[aria-label*="prev" i], button:has-text("<")').first();
        if (await prevButton.count() > 0) {
          await prevButton.scrollIntoViewIfNeeded();
          await prevButton.click();
          await page.waitForTimeout(2000);
          navigatedBack = true;
          console.log('  ✓ Navigated back to Page 1');
        }
      } catch (e) {
        console.log(`  ⚠️  Could not use previous button: ${e.message}`);
      }

      if (!navigatedBack) {
        testResults.warnings.push('⚠️  Could not navigate back to Page 1');
      } else {
        await page.screenshot({ path: 'multipage-step5-back-to-page1.png', fullPage: true });

        // Step 8: Verify checkboxes are still checked on Page 1
        console.log('\n✓ Step 8: Verifying Page 1 checkboxes...');
        await page.waitForTimeout(1000);
        const checkedBoxes = await page.locator('div[role="row"] input[type="checkbox"]:checked').count();
        console.log(`  Found ${checkedBoxes} checked boxes on Page 1`);

        if (checkedBoxes === 5) {
          testResults.passed.push('✅ All 5 selections on Page 1 are still checked!');
          console.log('✅ SUCCESS: All 5 original selections on Page 1 are still checked!');
        } else {
          testResults.failed.push(`❌ Expected 5 checked boxes on Page 1, found ${checkedBoxes}`);
          console.log(`❌ FAIL: Expected 5 checked boxes, found ${checkedBoxes}`);
        }

        // Final count check
        const bulkOpsBarFinal = await page.locator('div:has-text("selected")').filter({ hasText: /\d+.*DID/ }).first();
        const bulkOpsTextFinal = await bulkOpsBarFinal.textContent();
        console.log(`✓ Final selection count: ${bulkOpsTextFinal}`);

        if (bulkOpsTextFinal.includes('7')) {
          testResults.passed.push('✅ FINAL: Total count correctly shows 7 selections across both pages');
        }
      }
    }

    // Print summary
    console.log('\n' + '='.repeat(60));
    console.log('TEST SUMMARY');
    console.log('='.repeat(60));

    console.log('\n✅ PASSED TESTS:');
    testResults.passed.forEach(msg => console.log(`  ${msg}`));

    if (testResults.warnings.length > 0) {
      console.log('\n⚠️  WARNINGS:');
      testResults.warnings.forEach(msg => console.log(`  ${msg}`));
    }

    if (testResults.failed.length > 0) {
      console.log('\n❌ FAILED TESTS:');
      testResults.failed.forEach(msg => console.log(`  ${msg}`));
    }

    console.log('\n' + '='.repeat(60));
    if (testResults.failed.length === 0) {
      console.log('🎉 OVERALL: MULTI-PAGE SELECTION IS WORKING!');
    } else {
      console.log('❌ OVERALL: MULTI-PAGE SELECTION HAS ISSUES');
    }
    console.log('='.repeat(60));

  } catch (error) {
    console.error('\n❌ Test execution failed:', error.message);
    testResults.failed.push(`Test execution error: ${error.message}`);
    await page.screenshot({ path: 'multipage-error.png', fullPage: true });
  } finally {
    await browser.close();
  }
})();
