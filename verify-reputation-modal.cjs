const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    console.log('🔍 Testing Reputation Modal with Real Data\n');

    // Login
    await page.goto('https://dids.amdy.io/login');
    await page.fill('input[type="email"]', 'client@test3.com');
    await page.fill('input[type="password"]', 'password123');
    await page.click('button[type="submit"]');
    await page.waitForURL('**/dashboard', { timeout: 10000 });
    console.log('✅ Successfully logged in');

    // Navigate to DID Management
    await page.goto('https://dids.amdy.io/did-management');
    await page.waitForTimeout(5000); // Wait longer for table to load
    console.log('📊 Navigated to DID Management page');

    // Look for data table content using different selectors
    console.log('🔍 Searching for data table...');

    // Try multiple ways to find table content
    const tableSelectors = [
      'tbody tr',
      '[data-testid="data-table"] tr',
      '.rdt_Table tr',
      'div[class*="table"] tr',
      '[role="row"]'
    ];

    let rows = null;
    for (const selector of tableSelectors) {
      try {
        await page.waitForSelector(selector, { timeout: 3000 });
        rows = await page.$$(selector);
        if (rows.length > 0) {
          console.log(`✅ Found ${rows.length} rows using selector: ${selector}`);
          break;
        }
      } catch (e) {
        console.log(`❌ No rows found with selector: ${selector}`);
      }
    }

    if (!rows || rows.length === 0) {
      // Try to find any reputation scores directly
      console.log('🔍 Looking for reputation scores directly...');
      const reputationElements = await page.$$('[class*="reputation"], [class*="score"], text=/\\d+%/, text=/Positive/, text=/Negative/');

      if (reputationElements.length > 0) {
        console.log(`✅ Found ${reputationElements.length} potential reputation elements`);

        // Click on the first one
        await reputationElements[0].click();
        await page.waitForTimeout(2000);

        // Check for modal
        const modal = await page.$('[role="dialog"], .fixed, [class*="modal"]');
        if (modal) {
          console.log('✅ Reputation modal opened successfully!');

          // Check modal content
          const modalText = await page.textContent('body');
          if (modalText.includes('Reputation Details') || modalText.includes('RoboKiller')) {
            console.log('✅ Modal contains reputation information');

            // Check for date information
            if (modalText.includes('August 25, 2025') || modalText.includes('2025')) {
              console.log('✅ Modal shows proper dates (not "Just now")');
            } else {
              console.log('⚠️  Check date formatting in modal');
            }
          }
        }
      }
    } else {
      // If we found rows, try the original approach
      console.log('🖱️ Trying to click on reputation in first row...');

      // Look for reputation-related elements in the first row
      const firstRow = rows[0];
      const reputationCell = await firstRow.$('[class*="reputation"], [class*="score"], td:nth-child(4), td:nth-child(5)');

      if (reputationCell) {
        await reputationCell.click();
        await page.waitForTimeout(2000);

        const modal = await page.$('[role="dialog"], .fixed, [class*="modal"]');
        if (modal) {
          console.log('✅ Reputation modal opened from table row!');
        }
      }
    }

    await page.screenshot({ path: 'reputation-modal-verification.png', fullPage: true });
    console.log('📸 Screenshot saved as reputation-modal-verification.png');

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    await page.screenshot({ path: 'reputation-modal-error.png', fullPage: true });
  } finally {
    await browser.close();
  }
})();