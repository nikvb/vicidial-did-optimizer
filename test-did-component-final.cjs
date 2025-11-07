const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    console.log('🔍 Testing DID Component Row Click and Sorting\n');

    // Login
    await page.goto('https://dids.amdy.io/login');
    await page.fill('input[type="email"]', 'client@test3.com');
    await page.fill('input[type="password"]', 'password123');
    await page.click('button[type="submit"]');
    await page.waitForURL('**/dashboard', { timeout: 10000 });
    console.log('✅ Successfully logged in');

    // Navigate to DID Management
    await page.goto('https://dids.amdy.io/did-management');
    await page.waitForTimeout(3000);
    console.log('📊 Navigated to DID Management page');

    // Wait for table to load
    await page.waitForSelector('tbody tr', { timeout: 10000 });
    const rows = await page.$$('tbody tr');
    console.log(`✅ Found ${rows.length} data rows in the table`);

    if (rows.length > 0) {
      console.log('\n🖱️ Testing row click for DID details popup...');

      // Get the phone number from the first row for reference
      const firstRowPhone = await rows[0].$eval('td:nth-child(2)', el => el.textContent.trim());
      console.log(`📞 First DID: ${firstRowPhone}`);

      // Click on the first row
      await rows[0].click();
      await page.waitForTimeout(2000);

      // Check for modal with various selectors
      const modalSelectors = [
        '[class*="fixed"][class*="inset-0"]',
        '.modal',
        '[role="dialog"]',
        '[aria-modal="true"]',
        'div:has-text("DID Details")',
        'div:has-text("Phone Number")'
      ];

      let modalFound = false;
      for (const selector of modalSelectors) {
        try {
          const modal = await page.$(selector);
          if (modal) {
            const isVisible = await modal.isVisible();
            if (isVisible) {
              console.log(`✅ Modal found with selector: ${selector}`);
              modalFound = true;

              // Check modal content
              const modalContent = await modal.textContent();
              console.log(`📋 Modal content preview: ${modalContent.substring(0, 200)}...`);

              // Look for close button
              const closeButton = await modal.$('button:has-text("Close"), button[aria-label="Close"], button:has(svg)');
              if (closeButton) {
                await closeButton.click();
                console.log('✅ Modal closed successfully');
              }
              break;
            }
          }
        } catch (e) {
          // Continue trying other selectors
        }
      }

      if (!modalFound) {
        console.log('❌ No modal found after row click');

        // Try clicking on specific cells
        console.log('🔄 Trying to click on phone number cell...');
        const phoneCell = await rows[0].$('td:nth-child(2)');
        if (phoneCell) {
          await phoneCell.click();
          await page.waitForTimeout(1000);

          // Check again for modal
          for (const selector of modalSelectors) {
            try {
              const modal = await page.$(selector);
              if (modal && await modal.isVisible()) {
                console.log(`✅ Modal opened after phone cell click with selector: ${selector}`);
                modalFound = true;
                break;
              }
            } catch (e) {}
          }
        }
      }

      // Test column sorting
      console.log('\n🔄 Testing column sorting...');

      // Test Last Used column sorting
      const lastUsedHeader = await page.$('th:has-text("Last Used")');
      if (lastUsedHeader) {
        console.log('📋 Clicking "Last Used" header to test sorting...');
        await lastUsedHeader.click();
        await page.waitForTimeout(2000);

        // Check if rows changed order
        const newRows = await page.$$('tbody tr');
        if (newRows.length > 0) {
          const newFirstRowPhone = await newRows[0].$eval('td:nth-child(2)', el => el.textContent.trim());
          if (newFirstRowPhone !== firstRowPhone) {
            console.log(`✅ Sorting worked! First DID changed from ${firstRowPhone} to ${newFirstRowPhone}`);
          } else {
            console.log('⚠️ Sorting may not have changed order (or data is already sorted)');
          }
        }
      }

      // Test Reputation column sorting
      const reputationHeader = await page.$('th:has-text("Reputation")');
      if (reputationHeader) {
        console.log('📋 Clicking "Reputation" header to test sorting...');
        await reputationHeader.click();
        await page.waitForTimeout(2000);
        console.log('✅ Reputation sorting clicked');
      }

    } else {
      console.log('❌ No data rows found in table');
    }

    await page.screenshot({ path: 'did-component-final-test.png', fullPage: true });
    console.log('\n📸 Screenshot saved as did-component-final-test.png');

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    await page.screenshot({ path: 'did-component-error.png', fullPage: true });
  } finally {
    await browser.close();
  }
})();
