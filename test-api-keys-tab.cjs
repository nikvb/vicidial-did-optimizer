const { chromium } = require('playwright');

(async () => {
  console.log('🚀 Testing API Keys Tab Functionality...');

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

    // Step 3: Look for and click API Keys tab
    console.log('3. 🔑 Looking for API Keys tab...');

    // Try different selectors for API Keys
    const apiKeysSelectors = [
      'text=API Keys',
      '[data-testid="api-keys"]',
      '.api-keys',
      'button:has-text("API Keys")',
      'a:has-text("API Keys")',
      'li:has-text("API Keys")',
      '[href*="api"]',
      '[role="tab"]:has-text("API")'
    ];

    let apiKeysFound = false;
    for (const selector of apiKeysSelectors) {
      try {
        const element = page.locator(selector).first();
        if (await element.isVisible({ timeout: 1000 })) {
          console.log(`✅ Found API Keys with selector: ${selector}`);
          await element.click();
          await page.waitForTimeout(2000);
          apiKeysFound = true;
          break;
        }
      } catch (e) {
        // Continue to next selector
      }
    }

    if (!apiKeysFound) {
      console.log('❌ API Keys tab not found, checking page structure...');

      // Get all clickable elements that might be tabs
      const tabs = await page.locator('button, a, li, [role="tab"]').all();
      console.log(`📋 Found ${tabs.length} clickable elements`);

      for (let i = 0; i < Math.min(tabs.length, 20); i++) {
        try {
          const text = await tabs[i].textContent();
          if (text && text.toLowerCase().includes('api')) {
            console.log(`🎯 Found potential API tab: "${text}"`);
            await tabs[i].click();
            await page.waitForTimeout(2000);
            apiKeysFound = true;
            break;
          }
        } catch (e) {
          // Continue
        }
      }
    }

    // Step 4: Look for API key management interface
    console.log('4. 🔍 Examining API key interface...');

    await page.screenshot({ path: 'api-keys-section.png' });
    console.log('📸 Screenshot saved: api-keys-section.png');

    // Check for existing API keys
    const apiKeyElements = await page.locator('.api-key, .token, [data-testid*="api"], [class*="key"]').count();
    console.log(`📋 Found ${apiKeyElements} potential API key elements`);

    // Look for Create/Add buttons
    const createButtons = [
      'button:has-text("Create")',
      'button:has-text("Add")',
      'button:has-text("New")',
      'button:has-text("Generate")',
      '[data-testid="create-api-key"]',
      '.create-api-key',
      '[onclick*="create"]',
      '[onclick*="add"]'
    ];

    let createButtonFound = false;
    for (const selector of createButtons) {
      try {
        const button = page.locator(selector).first();
        if (await button.isVisible({ timeout: 1000 })) {
          console.log(`✅ Found Create button with selector: ${selector}`);

          // Click the create button
          await button.click();
          await page.waitForTimeout(2000);

          await page.screenshot({ path: 'api-key-create-dialog.png' });
          console.log('📸 Create dialog screenshot saved');

          createButtonFound = true;
          break;
        }
      } catch (e) {
        // Continue
      }
    }

    if (!createButtonFound) {
      console.log('❌ No Create API Key button found');
    }

    // Step 5: Check if we can see any API management functionality
    const pageText = await page.textContent('body');
    const hasApiText = pageText.toLowerCase().includes('api key') ||
                      pageText.toLowerCase().includes('api token') ||
                      pageText.toLowerCase().includes('generate') ||
                      pageText.toLowerCase().includes('create key');

    console.log(`📄 Page contains API key text: ${hasApiText}`);

    if (hasApiText) {
      console.log('✅ API key functionality appears to be present on the page');
    } else {
      console.log('❌ No API key functionality detected');
      console.log('📄 Page text sample:', pageText.substring(0, 1000));
    }

    // Final screenshot
    await page.screenshot({ path: 'api-keys-final.png' });
    console.log('📸 Final screenshot saved: api-keys-final.png');

  } catch (error) {
    console.error('❌ Test failed:', error);
    await page.screenshot({ path: 'api-keys-error.png' });
  }

  await browser.close();
  console.log('🏁 API Keys test completed');
})();