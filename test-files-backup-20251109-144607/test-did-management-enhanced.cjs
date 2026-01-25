const { chromium } = require('playwright');

async function testDIDManagementEnhanced() {
  console.log('🚀 Testing DID Management page with enhanced validation...');

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  // Monitor console and errors
  page.on('console', msg => {
    console.log(`🖥️  CONSOLE ${msg.type()}: ${msg.text()}`);
  });

  page.on('pageerror', error => {
    console.log(`❌ PAGE ERROR: ${error.message}`);
  });

  const requests = [];
  page.on('request', request => {
    if (request.url().includes('/api/')) {
      requests.push(request.url());
      console.log(`📤 API REQUEST: ${request.method()} ${request.url()}`);
    }
  });

  let didApiResponse = null;
  page.on('response', response => {
    if (response.url().includes('/api/')) {
      console.log(`📥 API RESPONSE: ${response.status()} ${response.url()}`);
      if (response.url().includes('/dids') && !response.url().includes('stats')) {
        response.text().then(body => {
          if (body) {
            console.log(`📋 DID API RESPONSE BODY: ${body.substring(0, 1000)}`);
            try {
              didApiResponse = JSON.parse(body);
            } catch (e) {
              console.log('Failed to parse DID response');
            }
          }
        }).catch(err => console.log(`📋 Could not read response body: ${err.message}`));
      }
    }
  });

  try {
    // Navigate to login
    console.log('📍 Navigating to http://api3.amdy.io:3000/login');
    await page.goto('http://api3.amdy.io:3000/login', { waitUntil: 'networkidle' });

    // Fill login form
    console.log('📝 Filling login form');
    await page.fill('input[type="email"]', 'client@test3.com');
    await page.fill('input[type="password"]', 'password123');

    // Submit login
    console.log('🔐 Submitting login form');
    await page.click('button[type="submit"]');
    await page.waitForURL('**/dashboard', { timeout: 10000 });

    console.log('📍 Successfully logged in, navigating to DID Management');

    // Navigate to DID Management page
    await page.click('text=DID Management');
    await page.waitForURL('**/did-management', { timeout: 10000 });

    console.log('📍 On DID Management page, waiting for DIDs to load...');

    // Wait for API calls and data to load
    await page.waitForTimeout(5000);

    // Check if DIDs are loaded
    const didRows = await page.locator('table tbody tr').count();
    console.log(`📊 Number of DID rows found: ${didRows}`);

    if (didRows > 0) {
      // Test 1: Check if phone numbers are now displayed
      const phoneNumbers = await page.locator('table tbody tr td:nth-child(2)').allInnerText();
      console.log(`📱 Phone numbers in first column:`, phoneNumbers.slice(0, 3));

      const hasPhoneNumbers = phoneNumbers.some(text => text.includes('+') || text.match(/\d{10}/));
      console.log(`✅ Phone numbers displayed: ${hasPhoneNumbers}`);

      // Test 2: Check if "Never" is reduced in Last Used column
      const lastUsedValues = await page.locator('table tbody tr td:nth-child(7)').allInnerText();
      console.log(`⏰ Last used values:`, lastUsedValues.slice(0, 3));

      const neverCount = lastUsedValues.filter(text => text === 'Never').length;
      const totalRows = lastUsedValues.length;
      console.log(`📊 "Never" count: ${neverCount}/${totalRows} (${Math.round(neverCount/totalRows*100)}%)`);

      // Test 3: Test eye icon functionality (view details)
      console.log('👁️ Testing eye icon functionality...');
      const firstEyeIcon = page.locator('table tbody tr:first-child button[title="View Details"]');

      if (await firstEyeIcon.isVisible()) {
        console.log('✅ Eye icon found, clicking...');
        await firstEyeIcon.click();

        // Wait for modal to appear
        await page.waitForSelector('.fixed.inset-0', { timeout: 3000 });
        const isModalVisible = await page.locator('.fixed.inset-0').isVisible();
        console.log(`👁️ Details modal opened: ${isModalVisible}`);

        if (isModalVisible) {
          // Check modal content
          const modalTitle = await page.locator('h3:has-text("DID Details:")').textContent();
          console.log(`📋 Modal title: ${modalTitle}`);

          // Check if phone number is displayed in modal
          const modalPhoneNumber = await page.locator('dd:has-text("+")').first().textContent();
          console.log(`📱 Modal phone number: ${modalPhoneNumber}`);

          // Check reputation section
          const reputationScore = await page.locator('text="Score"').locator('..').locator('dd').textContent();
          console.log(`⭐ Reputation score in modal: ${reputationScore}`);

          // Close modal
          await page.click('button[class*="text-gray-400"]');
          await page.waitForTimeout(1000);

          console.log('✅ Eye icon functionality test completed successfully');
        } else {
          console.log('❌ Modal failed to open');
        }
      } else {
        console.log('❌ Eye icon not found');
      }

      // Test 4: Verify reputation data
      if (didApiResponse && didApiResponse.data) {
        const firstDid = didApiResponse.data[0];
        console.log('🔍 API Response Analysis:');
        console.log(`  - Phone: ${firstDid.number}`);
        console.log(`  - Last Used: ${firstDid.lastUsed}`);
        console.log(`  - Reputation Score: ${firstDid.reputation?.score}`);
        console.log(`  - Location: ${firstDid.location?.city}, ${firstDid.location?.state}`);
      }
    }

    // Take screenshot
    await page.screenshot({ path: 'test-did-management-enhanced.png' });
    console.log('✅ Screenshot saved: test-did-management-enhanced.png');

    console.log(`📊 Total API requests captured: ${requests.length}`);

    await browser.close();
    console.log('✅ Enhanced DID Management test completed successfully');

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    await page.screenshot({ path: 'test-did-management-enhanced-error.png' });
    console.log('✅ Error screenshot saved: test-did-management-enhanced-error.png');
    await browser.close();
  }
}

testDIDManagementEnhanced();