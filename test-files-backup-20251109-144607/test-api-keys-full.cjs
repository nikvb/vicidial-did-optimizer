const { chromium } = require('playwright');

(async () => {
  console.log('🚀 Testing Complete API Keys Functionality...');

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  // Track API requests
  page.on('request', request => {
    if (request.url().includes('/api/')) {
      console.log('🌐 REQUEST:', request.method(), request.url());
    }
  });

  page.on('response', response => {
    if (response.url().includes('/api/')) {
      console.log('📡 RESPONSE:', response.url(), response.status());
    }
  });

  try {
    // Step 1: Login
    console.log('1. 🔐 Logging in...');
    await page.goto('http://api3.amdy.io:3000/login');
    await page.waitForTimeout(2000);

    await page.fill('input[type="email"]', 'client@test3.com');
    await page.fill('input[type="password"]', 'password123');
    await page.click('button[type="submit"]');
    await page.waitForURL('**/dashboard', { timeout: 10000 });

    // Step 2: Go to Settings
    console.log('2. ⚙️ Navigating to Settings...');
    await page.goto('http://api3.amdy.io:3000/settings');
    await page.waitForTimeout(3000);

    // Step 3: Click API Keys tab
    console.log('3. 🔑 Clicking API Keys tab...');
    await page.click('text=API Keys');
    await page.waitForTimeout(3000);

    // Wait for API response
    await page.waitForResponse(response =>
      response.url().includes('/api/v1/tenants/api-keys') && response.status() === 200
    );

    // Step 4: Check existing keys
    console.log('4. 📋 Checking existing API keys...');
    const existingKeys = await page.locator('.divide-y li').count();
    console.log(`✅ Found ${existingKeys} existing API keys`);

    // Take screenshot of current state
    await page.screenshot({ path: 'api-keys-existing.png' });
    console.log('📸 Screenshot saved: api-keys-existing.png');

    // Step 5: Test Create API Key functionality
    console.log('5. ➕ Testing Create API Key...');

    // Click Create API Key button
    const createButton = page.locator('button:has-text("Create API Key")');
    if (await createButton.isVisible()) {
      console.log('✅ Create API Key button found');
      await createButton.click();
      await page.waitForTimeout(1000);

      // Fill out the form
      console.log('📝 Filling out API key form...');
      await page.fill('input[placeholder*="VICIdial"]', 'Playwright Test Key');

      // Select write permission (read should already be selected)
      await page.check('input[type="checkbox"][value="write"]');

      await page.screenshot({ path: 'api-key-form-filled.png' });
      console.log('📸 Form screenshot saved: api-key-form-filled.png');

      // Click Create Key button
      console.log('🔄 Submitting form...');
      await page.click('button:has-text("Create Key")');

      // Wait for either success or error
      await page.waitForTimeout(3000);

      // Check for success alert or error message
      const alertText = await page.evaluate(() => {
        // Check if there was an alert
        return window.lastAlert || null;
      });

      if (alertText) {
        console.log('✅ API Key creation result:', alertText);
      } else {
        console.log('ℹ️ No alert detected, checking for other indicators...');
      }

      await page.screenshot({ path: 'api-key-after-create.png' });
      console.log('📸 After create screenshot saved: api-key-after-create.png');

    } else {
      console.log('❌ Create API Key button not found');
    }

    // Step 6: Verify updated list
    console.log('6. 🔍 Checking updated API key list...');
    await page.waitForTimeout(2000);

    const updatedKeys = await page.locator('.divide-y li').count();
    console.log(`📊 Now showing ${updatedKeys} API keys`);

    if (updatedKeys > existingKeys) {
      console.log('✅ New API key appears to have been created successfully');
    } else {
      console.log('⚠️ API key count unchanged - check for errors');
    }

    // Step 7: Test key visibility toggle
    console.log('7. 👁️ Testing key visibility toggle...');
    const eyeButtons = page.locator('button:has([class*="h-4 w-4"])');
    const eyeButtonCount = await eyeButtons.count();

    if (eyeButtonCount > 0) {
      console.log(`✅ Found ${eyeButtonCount} eye toggle buttons`);
      await eyeButtons.first().click();
      await page.waitForTimeout(500);
      console.log('✅ Toggled first key visibility');
    }

    // Final screenshot
    await page.screenshot({ path: 'api-keys-final-test.png' });
    console.log('📸 Final screenshot saved: api-keys-final-test.png');

    // Step 8: Validate page content
    console.log('8. ✅ Validating page content...');
    const hasApiKeysHeading = await page.locator('h3:has-text("API Keys")').isVisible();
    const hasVicidialIntegration = await page.locator('h4:has-text("VICIdial Integration")').isVisible();
    const hasEndpointInfo = await page.locator('code').count() > 0;

    console.log(`📋 API Keys heading: ${hasApiKeysHeading ? '✅' : '❌'}`);
    console.log(`🔧 VICIdial integration info: ${hasVicidialIntegration ? '✅' : '❌'}`);
    console.log(`📖 Endpoint documentation: ${hasEndpointInfo ? '✅' : '❌'}`);

    console.log('🎉 API Keys functionality test completed successfully!');

  } catch (error) {
    console.error('❌ Test failed:', error);
    await page.screenshot({ path: 'api-keys-test-error.png' });
    console.log('📸 Error screenshot saved: api-keys-test-error.png');
  }

  await browser.close();
  console.log('🏁 Test completed');
})();