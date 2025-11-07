const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    console.log('🔍 Testing Reputation Details Modal\n');

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
    await page.waitForSelector('tbody tr', { timeout: 5000 });
    const rows = await page.$$('tbody tr');
    console.log(`Found ${rows.length} data rows`);

    if (rows.length > 0) {
      // Find and click on a reputation score
      console.log('\n🎯 Looking for reputation score to click...');

      // Try to find a reputation cell with a score
      const reputationCells = await page.$$('td:has([class*="text-green"], [class*="text-yellow"], [class*="text-red"])');

      if (reputationCells.length > 0) {
        console.log(`Found ${reputationCells.length} reputation cell(s)`);

        // Get the reputation score text before clicking
        const scoreText = await reputationCells[0].textContent();
        console.log(`📊 Reputation score: ${scoreText}`);

        // Click on the first reputation score
        console.log('🖱️ Clicking on reputation score...');
        await reputationCells[0].click();
        await page.waitForTimeout(2000);

        // Check if reputation modal appeared
        const reputationModal = await page.$('[role="dialog"]:has-text("Reputation Details")');
        if (reputationModal) {
          console.log('✅ Reputation Details modal opened successfully!');

          // Check for key sections in the modal
          const sections = {
            'Overall Score': await page.$('text=/Overall Reputation Score/i'),
            'RoboKiller Status': await page.$('text=/RoboKiller Status/i'),
            'Call Statistics': await page.$('text=/Call Statistics/i'),
            'User Comments': await page.$('text=/User Comments/i'),
            'Reputation History': await page.$('text=/Reputation History/i')
          };

          console.log('\n📋 Modal sections found:');
          for (const [name, element] of Object.entries(sections)) {
            console.log(`  ${element ? '✅' : '❌'} ${name}`);
          }

          // Check RoboKiller last checked date
          const robokillerSection = await page.$('[class*="bg-gray-800"]:has-text("RoboKiller Status")');
          if (robokillerSection) {
            const lastCheckText = await robokillerSection.$('text=/Last Check/');
            if (lastCheckText) {
              const parent = await lastCheckText.$('..');
              const dateText = await parent.$('p:last-child');
              if (dateText) {
                const dateValue = await dateText.textContent();
                console.log(`\n📅 RoboKiller Last Check: ${dateValue}`);
                if (dateValue === 'Just now' || dateValue === 'Never') {
                  console.log('  ℹ️ No scan date in database');
                } else {
                  console.log('  ✅ Showing actual scan date');
                }
              }
            }
          }

          // Check for real data indicators
          const callStatsSection = await page.$('[class*="bg-gray-800"]:has-text("Call Statistics")');
          if (callStatsSection) {
            const totalCallsElement = await callStatsSection.$('text=/Total Calls/i');
            if (totalCallsElement) {
              const statsParent = await totalCallsElement.$('../..');
              const callCount = await statsParent.$('p:first-child');
              if (callCount) {
                const count = await callCount.textContent();
                console.log(`\n📞 Total Calls: ${count}`);
                if (count !== '0') {
                  console.log('  ✅ Showing real call data');
                } else {
                  console.log('  ℹ️ No call data in database');
                }
              }
            }
          }

          // Close modal
          const closeButton = await page.$('button:has-text("Close")');
          if (closeButton) {
            await closeButton.click();
            console.log('\n✅ Modal closed successfully');
          }
        } else {
          console.log('❌ Reputation Details modal did not open');
        }
      } else {
        console.log('❌ No reputation scores found in the table');
      }
    } else {
      console.log('❌ No data rows found');
    }

    await page.screenshot({ path: 'reputation-modal-test.png', fullPage: true });
    console.log('\n📸 Screenshot saved as reputation-modal-test.png');

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    await page.screenshot({ path: 'reputation-modal-error.png', fullPage: true });
  } finally {
    await browser.close();
  }
})();