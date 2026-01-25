const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    console.log('🔍 Testing DataTable Row Click and Sorting\n');

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

    // Look for the actual DataTable structure (not standard table)
    const dataTableContainer = await page.$('.did-datatable-container, [data-testid="datatable"], div:has(th):has(td)');
    if (dataTableContainer) {
      console.log('✅ Found DataTable container');
    } else {
      console.log('❌ DataTable container not found');
    }

    // Look for table headers (th elements)
    const headers = await page.$$('th');
    console.log(`Found ${headers.length} table headers`);

    // Look for table body rows
    const bodyRows = await page.$$('tbody tr, div[role="row"]');
    console.log(`Found ${bodyRows.length} body rows`);

    if (bodyRows.length > 0) {
      console.log('\n🖱️ Testing row click for DID details popup...');

      // Get the first row
      const firstRow = bodyRows[0];
      
      // Get phone number from first row
      const phoneElement = await firstRow.$('td:nth-child(2), div:nth-child(2)');
      const phoneText = phoneElement ? await phoneElement.textContent() : 'Unknown';
      console.log(`📞 First row phone: ${phoneText}`);

      // Click on the first row
      await firstRow.click();
      await page.waitForTimeout(2000);

      // Check for any modal/popup
      const modals = await page.$$('[class*="fixed"], [class*="modal"], [role="dialog"]');
      console.log(`Found ${modals.length} potential modal elements`);

      let modalFound = false;
      for (let i = 0; i < modals.length; i++) {
        const modal = modals[i];
        const isVisible = await modal.isVisible();
        if (isVisible) {
          const modalText = await modal.textContent();
          if (modalText.includes('DID') || modalText.includes('Details') || modalText.includes('Phone')) {
            console.log(`✅ DID Details modal found! Content: ${modalText.substring(0, 100)}...`);
            modalFound = true;
            
            // Try to close modal
            const closeBtn = await modal.$('button:has-text("Close"), button[aria-label="Close"]');
            if (closeBtn) {
              await closeBtn.click();
              console.log('✅ Modal closed');
            }
            break;
          }
        }
      }

      if (!modalFound) {
        console.log('❌ No DID details modal found after row click');
      }

      // Test sorting by clicking headers
      console.log('\n🔄 Testing column sorting...');
      
      if (headers.length > 0) {
        // Try clicking "Last Used" header
        for (let i = 0; i < headers.length; i++) {
          const headerText = await headers[i].textContent();
          if (headerText.includes('Last Used')) {
            console.log('📋 Found "Last Used" header, clicking...');
            await headers[i].click();
            await page.waitForTimeout(2000);
            console.log('✅ Clicked Last Used header for sorting');
            break;
          }
        }
      }

    } else {
      console.log('❌ No table rows found');
    }

    await page.screenshot({ path: 'simple-datatable-test.png', fullPage: true });
    console.log('\n📸 Screenshot saved as simple-datatable-test.png');

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    await page.screenshot({ path: 'simple-datatable-error.png', fullPage: true });
  } finally {
    await browser.close();
  }
})();
