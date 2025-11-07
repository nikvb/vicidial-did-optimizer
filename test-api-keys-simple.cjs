const { chromium } = require('playwright');

(async () => {
  console.log('🚀 Testing API Keys Page...');

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

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
    await page.waitForTimeout(5000); // Give more time for loading

    // Step 4: Check page content
    console.log('4. 📋 Checking page content...');

    // Take screenshot
    await page.screenshot({ path: 'api-keys-page-content.png' });
    console.log('📸 Screenshot saved: api-keys-page-content.png');

    // Check for API keys heading
    const hasApiKeysHeading = await page.locator('h3:has-text("API Keys")').isVisible();
    console.log(`📋 API Keys heading visible: ${hasApiKeysHeading ? '✅' : '❌'}`);

    // Check for Create button
    const createButton = await page.locator('button:has-text("Create")').isVisible();
    console.log(`➕ Create button visible: ${createButton ? '✅' : '❌'}`);

    // Check if there's a loading state or error message
    const loadingText = await page.textContent('body');
    if (loadingText.includes('Loading')) {
      console.log('⏳ Page still loading...');
    }
    if (loadingText.includes('error') || loadingText.includes('Error')) {
      console.log('❌ Error detected on page');
    }
    if (loadingText.includes('No API keys')) {
      console.log('📝 "No API keys" message found - API is working but no keys exist');
    }
    if (loadingText.includes('VICIdial')) {
      console.log('✅ VICIdial integration info present');
    }

    // Test Create button functionality
    if (createButton) {
      console.log('5. ➕ Testing Create button...');
      await page.click('button:has-text("Create")');
      await page.waitForTimeout(2000);

      // Check if form appeared
      const formVisible = await page.locator('input[placeholder*="VICIdial"], input[placeholder*="Production"]').isVisible();
      console.log(`📝 Create form visible: ${formVisible ? '✅' : '❌'}`);

      if (formVisible) {
        console.log('📋 Create form is working correctly');
        await page.screenshot({ path: 'api-keys-create-form.png' });
        console.log('📸 Create form screenshot saved');
      }
    }

    console.log('✅ API Keys page test completed');

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    await page.screenshot({ path: 'api-keys-error.png' });
  }

  await browser.close();
  console.log('🏁 Test completed');
})();