const { chromium } = require('playwright');

(async () => {
  console.log('🚀 Testing Settings Page and API Key Functionality...');

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  // Track all requests to API
  page.on('request', request => {
    if (request.url().includes('/api/')) {
      console.log('🌐 REQUEST:', request.method(), request.url());
    }
  });

  // Track all responses from API
  page.on('response', response => {
    if (response.url().includes('/api/')) {
      console.log('📡 RESPONSE:', response.url(), response.status());
    }
  });

  // Enable console logging
  page.on('console', msg => {
    if (msg.text().includes('[')) {
      console.log('Browser console:', msg.text());
    }
  });

  try {
    // Step 1: Navigate to login page
    console.log('1. 📍 Navigating to login page...');
    await page.goto('http://api3.amdy.io:3000/login');
    await page.waitForTimeout(2000);

    // Step 2: Login
    console.log('2. 🔐 Logging in as client@test3.com...');
    await page.fill('input[type="email"], input[name="email"], input[id="email"]', 'client@test3.com');
    await page.fill('input[type="password"], input[name="password"], input[id="password"]', 'password123');

    const submitButton = await page.locator('button[type="submit"], button:has-text("Sign in"), button:has-text("Login")').first();
    await submitButton.click();

    // Wait for login to complete
    await page.waitForURL('**/dashboard', { timeout: 10000 });
    console.log('✅ Successfully logged in and reached dashboard');

    // Step 3: Navigate to Settings page
    console.log('3. ⚙️ Navigating to Settings page...');

    // Look for Settings link in navigation
    const settingsLink = page.locator('text=Settings').first();
    if (await settingsLink.isVisible()) {
      await settingsLink.click();
    } else {
      // Try clicking a settings icon or menu
      const settingsIcon = page.locator('[data-testid="settings"], .settings, button:has-text("Settings")').first();
      if (await settingsIcon.isVisible()) {
        await settingsIcon.click();
      } else {
        // Navigate directly to settings URL
        await page.goto('http://api3.amdy.io:3000/settings');
      }
    }

    await page.waitForTimeout(3000);
    console.log('📍 Current URL:', page.url());

    // Step 4: Look for API Keys section
    console.log('4. 🔑 Looking for API Keys section...');

    // Take screenshot of settings page
    await page.screenshot({ path: 'settings-page.png' });
    console.log('📸 Screenshot saved: settings-page.png');

    // Check for API keys section
    const apiKeysSection = page.locator('text=API Keys, text=API Key, text=API Token').first();
    if (await apiKeysSection.isVisible()) {
      console.log('✅ Found API Keys section');

      // Look for existing API keys
      const existingKeys = await page.locator('.api-key, .token, [data-testid="api-key"]').count();
      console.log(`📋 Found ${existingKeys} existing API keys`);

      // Look for "Create" or "Add" button
      const createButton = page.locator('button:has-text("Create"), button:has-text("Add"), button:has-text("New"), button:has-text("Generate")').first();
      if (await createButton.isVisible()) {
        console.log('5. ➕ Found Create API Key button, clicking...');
        await createButton.click();
        await page.waitForTimeout(2000);

        // Take screenshot of create dialog
        await page.screenshot({ path: 'api-key-create.png' });
        console.log('📸 Screenshot saved: api-key-create.png');

        // Fill in API key details if form appears
        const nameField = page.locator('input[name="name"], input[placeholder*="name"], input[placeholder*="Name"]').first();
        if (await nameField.isVisible()) {
          console.log('📝 Filling API key name...');
          await nameField.fill('Test API Key');

          // Look for submit button
          const submitBtn = page.locator('button:has-text("Create"), button:has-text("Generate"), button:has-text("Save")').first();
          if (await submitBtn.isVisible()) {
            await submitBtn.click();
            await page.waitForTimeout(2000);
            console.log('✅ API key creation attempted');
          }
        }
      } else {
        console.log('❌ No Create API Key button found');
      }
    } else {
      console.log('❌ No API Keys section found on page');

      // Check what's actually on the page
      const pageContent = await page.textContent('body');
      console.log('📄 Page content preview:', pageContent.substring(0, 500));
    }

    // Step 5: Check for any error messages
    const errorMessages = await page.locator('.error, .alert-danger, [role="alert"]').count();
    if (errorMessages > 0) {
      console.log(`⚠️ Found ${errorMessages} error messages on page`);
      const firstError = await page.locator('.error, .alert-danger, [role="alert"]').first().textContent();
      console.log('Error text:', firstError);
    }

    // Final screenshot
    await page.screenshot({ path: 'settings-final.png' });
    console.log('📸 Final screenshot saved: settings-final.png');

  } catch (error) {
    console.error('❌ Test failed:', error);
    await page.screenshot({ path: 'settings-error.png' });
    console.log('📸 Error screenshot saved: settings-error.png');
  }

  await browser.close();
  console.log('🏁 Test completed');
})();