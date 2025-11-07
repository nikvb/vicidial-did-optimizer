const { chromium } = require('playwright');

async function testReputationFixed() {
  console.log('🚀 Testing Reputation fix in DID details modal...');

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  // Monitor console and errors
  page.on('console', msg => {
    if (msg.type() === 'error') {
      console.log(`🖥️  CONSOLE ERROR: ${msg.text()}`);
    }
  });

  page.on('pageerror', error => {
    console.log(`❌ PAGE ERROR: ${error.message}`);
  });

  const apiResponses = [];
  page.on('response', response => {
    if (response.url().includes('/api/v1/dids') && !response.url().includes('stats')) {
      response.text().then(body => {
        if (body) {
          try {
            const data = JSON.parse(body);
            apiResponses.push(data);
            console.log(`📊 DID API Response: ${body.substring(0, 500)}...`);
          } catch (e) {
            console.log('Failed to parse DID API response');
          }
        }
      }).catch(err => console.log(`Failed to read DID response: ${err.message}`));
    }
  });

  try {
    // Navigate to login
    console.log('📍 Navigating to login page...');
    await page.goto('http://localhost:3000/login', { waitUntil: 'networkidle' });

    // Fill login form
    console.log('📝 Logging in as client@test3.com...');
    await page.fill('input[type="email"]', 'client@test3.com');
    await page.fill('input[type="password"]', 'password123');

    // Submit login
    await page.click('button[type="submit"]');
    await page.waitForURL('**/dashboard', { timeout: 10000 });

    console.log('✅ Successfully reached dashboard, navigating to DID Management...');

    // Navigate to DID Management
    await page.click('text=DID Management');
    await page.waitForURL('**/did-management', { timeout: 10000 });

    console.log('📍 On DID Management page, waiting for DIDs to load...');
    await page.waitForTimeout(5000);

    // Check if DIDs are loaded
    const didRows = await page.locator('table tbody tr').count();
    console.log(`📊 Number of DID rows found: ${didRows}`);

    if (didRows > 0) {
      console.log('👁️ Testing eye icon (View Details) functionality...');

      // Click the first eye icon
      const firstEyeIcon = page.locator('table tbody tr:first-child button[title="View Details"]');

      if (await firstEyeIcon.isVisible()) {
        console.log('✅ Eye icon found, clicking to open modal...');
        await firstEyeIcon.click();

        // Wait for modal to appear
        await page.waitForSelector('.fixed.inset-0', { timeout: 5000 });
        const isModalVisible = await page.locator('.fixed.inset-0').isVisible();
        console.log(`👁️ Details modal opened: ${isModalVisible}`);

        if (isModalVisible) {
          // Check reputation section specifically
          console.log('🔍 Checking reputation data in modal...');

          // Get reputation score
          const reputationScoreElement = page.locator('text="Score"').locator('..').locator('dd');
          const reputationScore = await reputationScoreElement.textContent();
          console.log(`⭐ Reputation Score: "${reputationScore}"`);

          // Get reputation status - look for the Status within the Reputation section
          const reputationStatusElement = page.locator('h3:has-text("Reputation")').locator('xpath=following-sibling::dl').locator('text="Status"').locator('..').locator('dd');
          const reputationStatus = await reputationStatusElement.textContent();
          console.log(`📊 Reputation Status: "${reputationStatus}"`);

          // Get last checked date
          const lastCheckedElement = page.locator('text="Last Checked"').locator('..').locator('dd');
          const lastChecked = await lastCheckedElement.textContent();
          console.log(`📅 Last Checked: "${lastChecked}"`);

          // Verify the fix
          console.log('🎯 Verifying reputation fix:');

          const scoreIsValid = reputationScore && !reputationScore.includes('0/100');
          console.log(`  ✅ Score shows real data (not 0): ${scoreIsValid}`);

          const statusIsNotUnknown = reputationStatus && reputationStatus.trim() !== 'Unknown';
          console.log(`  ✅ Status is not "Unknown": ${statusIsNotUnknown} (shows: "${reputationStatus}")`);

          const lastCheckedIsNotNever = lastChecked && lastChecked.trim() !== 'Never';
          console.log(`  ✅ Last Checked is not "Never": ${lastCheckedIsNotNever} (shows: "${lastChecked}")`);

          if (scoreIsValid && statusIsNotUnknown && lastCheckedIsNotNever) {
            console.log('🎉 REPUTATION FIX SUCCESSFUL! All fields showing real data');
          } else {
            console.log('❌ Some reputation fields still need fixing');
          }

          // Close modal
          await page.click('button[class*="text-gray-400"]');
          await page.waitForTimeout(1000);
        } else {
          console.log('❌ Modal failed to open');
        }
      } else {
        console.log('❌ Eye icon not found');
      }

      // Check API response structure
      if (apiResponses.length > 0) {
        const response = apiResponses[0];
        if (response.data && response.data.length > 0) {
          const firstDid = response.data[0];
          console.log('🔍 API Response Analysis:');
          console.log(`  - Phone: ${firstDid.number}`);
          console.log(`  - Reputation Score: ${firstDid.reputation?.score}`);
          console.log(`  - Reputation Status: ${firstDid.reputation?.status}`);
          console.log(`  - Last Checked: ${firstDid.reputation?.lastChecked}`);
        }
      }
    }

    // Take screenshot
    await page.screenshot({ path: 'test-reputation-fixed.png' });
    console.log('✅ Screenshot saved: test-reputation-fixed.png');

    await browser.close();
    console.log('✅ Reputation test completed successfully');

  } catch (error) {
    console.error('❌ Reputation test failed:', error.message);
    await page.screenshot({ path: 'test-reputation-fixed-error.png' });
    console.log('✅ Error screenshot saved: test-reputation-fixed-error.png');
    await browser.close();
  }
}

testReputationFixed();