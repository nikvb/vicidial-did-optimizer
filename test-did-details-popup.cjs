const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    console.log('🔍 Testing DID Details Popup and Sorting\n');

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

    // Check for table headers (react-data-table-component uses th elements)
    const headers = await page.$$('th');
    console.log(`Found ${headers.length} table header(s) on the page`);

    if (headers.length > 0) {
      console.log('✅ DataTable is rendering!');

      // Test sorting functionality
      console.log('\n🔄 Testing sorting functionality...');

      // Try to click on "Last Used" column header to sort
      const lastUsedHeader = await page.$('th:has-text("Last Used")');
      if (lastUsedHeader) {
        console.log('📋 Found "Last Used" header, clicking to sort...');
        await lastUsedHeader.click();
        await page.waitForTimeout(2000);
        console.log('✅ Clicked sort on Last Used column');
      }

      // Test row clicking for details popup
      console.log('\n🖱️ Testing row click for details popup...');

      // Wait for rows to load
      await page.waitForSelector('tbody tr', { timeout: 5000 });
      const rows = await page.$$('tbody tr');
      console.log(`Found ${rows.length} data rows`);

      if (rows.length > 0) {
        console.log('🖱️ Clicking on first row...');
        await rows[0].click();
        await page.waitForTimeout(1000);

        // Check if details modal appeared
        const detailsModal = await page.$('[class*="fixed inset-0"]:has-text("DID Details")');
        if (detailsModal) {
          console.log('✅ DID Details modal opened successfully!');

          // Check modal content
          const didNumber = await page.$('text=DID Details:');
          if (didNumber) {
            const modalContent = await didNumber.textContent();
            console.log(`📞 Modal shows: ${modalContent}`);
          }

          // Close modal
          const closeButton = await page.$('button:has-text("Close")');
          if (closeButton) {
            await closeButton.click();
            console.log('✅ Modal closed successfully');
          }
        } else {
          console.log('❌ DID Details modal did not open');

          // Try clicking elsewhere in the row (not on checkbox)
          console.log('🔄 Trying to click on phone number cell...');
          const phoneCell = await rows[0].$('td:nth-child(2)'); // Phone number column
          if (phoneCell) {
            await phoneCell.click();
            await page.waitForTimeout(1000);

            const detailsModal2 = await page.$('[class*="fixed inset-0"]:has-text("DID Details")');
            if (detailsModal2) {
              console.log('✅ DID Details modal opened on second attempt!');
            } else {
              console.log('❌ DID Details modal still not opening');
            }
          }
        }
      } else {
        console.log('❌ No data rows found');
      }

      // Test AI Assistant button
      console.log('\n🤖 Testing AI Assistant button...');
      const aiButton = await page.$('button:has-text("AI Assistant")');
      if (aiButton) {
        console.log('✅ AI Assistant button found!');
        await aiButton.click();
        await page.waitForTimeout(1000);

        const aiModal = await page.$('[class*="fixed inset-0"]:has-text("AI DID Management Assistant")');
        if (aiModal) {
          console.log('✅ AI Bot modal opened successfully!');

          // Close AI modal
          const closeAiButton = await page.$('button[aria-label="Close"] svg, button:has(svg[class*="w-6 h-6"])');
          if (closeAiButton) {
            await closeAiButton.click();
            console.log('✅ AI modal closed');
          }
        } else {
          console.log('❌ AI Bot modal did not open');
        }
      } else {
        console.log('❌ AI Assistant button not found');
      }

    } else {
      console.log('❌ No DataTable headers found');
    }

    await page.screenshot({ path: 'did-details-test.png', fullPage: true });
    console.log('\n📸 Screenshot saved as did-details-test.png');

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    await page.screenshot({ path: 'did-details-error.png', fullPage: true });
  } finally {
    await browser.close();
  }
})();