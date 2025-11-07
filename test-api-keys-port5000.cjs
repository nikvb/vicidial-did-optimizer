const { chromium } = require('playwright');

(async () => {
  console.log('🚀 Testing API Keys on PORT 5000 (Production Build)...');

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
    // Step 1: Login to port 5000
    console.log('1. 🔐 Logging in to port 5000...');
    await page.goto('http://api3.amdy.io:5000/login');
    await page.waitForTimeout(2000);

    await page.fill('input[type="email"]', 'client@test3.com');
    await page.fill('input[type="password"]', 'password123');
    await page.click('button[type="submit"]');
    await page.waitForURL('**/dashboard', { timeout: 10000 });

    // Step 2: Go to Settings on port 5000
    console.log('2. ⚙️ Navigating to Settings on port 5000...');
    await page.goto('http://api3.amdy.io:5000/settings');
    await page.waitForTimeout(3000);

    // Step 3: Click API Keys tab
    console.log('3. 🔑 Clicking API Keys tab...');
    await page.click('text=API Keys');
    await page.waitForTimeout(5000);

    // Step 4: Check for API keys
    console.log('4. 📋 Checking for API keys content...');

    // Take screenshot
    await page.screenshot({ path: 'api-keys-port5000.png' });
    console.log('📸 Screenshot saved: api-keys-port5000.png');

    // Check for API keys heading
    const hasApiKeysHeading = await page.locator('h3:has-text("API Keys")').isVisible();
    console.log(`📋 API Keys heading visible: ${hasApiKeysHeading ? '✅' : '❌'}`);

    // Check for Create button
    const createButton = await page.locator('button:has-text("Create")').isVisible();
    console.log(`➕ Create button visible: ${createButton ? '✅' : '❌'}`);

    // Check for existing API keys list
    const apiKeysList = await page.locator('.divide-y li').count();
    console.log(`🔑 API keys in list: ${apiKeysList}`);

    // Check if there's a loading state or actual data
    const pageText = await page.textContent('body');
    if (pageText.includes('Loading')) {
      console.log('⏳ Page still loading...');
    }
    if (pageText.includes('No API keys')) {
      console.log('📝 "No API keys" message - UI is working but empty state');
    }
    if (apiKeysList > 0) {
      console.log('✅ API keys are visible in the list!');
    }

    // Check for VICIdial integration section
    const hasVicidialSection = await page.locator('h4:has-text("VICIdial Integration")').isVisible();
    console.log(`🔧 VICIdial integration section: ${hasVicidialSection ? '✅' : '❌'}`);

    console.log('🎉 Port 5000 API Keys test completed!');

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    await page.screenshot({ path: 'api-keys-port5000-error.png' });
  }

  await browser.close();
  console.log('🏁 Test completed');
})();