const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();

  // Enable console logging
  page.on('console', msg => {
    if (msg.type() === 'error') {
      console.log('Browser console error:', msg.text());
    }
  });

  page.on('response', response => {
    if (response.url().includes('/api/v1/tenants/api-keys')) {
      console.log(`📡 API Keys endpoint: ${response.status()} ${response.url()}`);
    }
    if (response.url().includes('/rotation-rules')) {
      console.log(`📡 Rotation Rules endpoint: ${response.status()} ${response.url()}`);
    }
  });

  try {
    console.log('1️⃣ Navigating to login page...');
    await page.goto('http://api3.amdy.io:5000/login', { waitUntil: 'networkidle' });

    console.log('2️⃣ Filling login credentials...');
    await page.fill('input[name="email"]', 'admin@amdy.io');
    await page.fill('input[name="password"]', 'Admin123!');

    console.log('3️⃣ Submitting login form...');
    await page.click('button[type="submit"]');

    // Wait for navigation to dashboard
    await page.waitForURL('**/dashboard', { timeout: 10000 });
    console.log('✅ Login successful! Now on dashboard');

    // Navigate to Settings page
    console.log('4️⃣ Navigating to Settings page...');
    await page.goto('http://api3.amdy.io:5000/settings', { waitUntil: 'networkidle' });

    // Check if Settings page loaded
    const settingsTitle = await page.textContent('h2');
    console.log(`📄 Settings page title: ${settingsTitle}`);

    // Click on API Keys tab
    console.log('5️⃣ Clicking on API Keys tab...');
    await page.click('button:has-text("API Keys")', { timeout: 5000 });

    // Wait for API keys content to load
    await page.waitForTimeout(2000);

    // Check if API keys are displayed
    const apiKeysContent = await page.locator('text=/VICIdial|API Key|did_/').count();
    if (apiKeysContent > 0) {
      console.log('✅ API Keys loaded successfully!');

      // Get the API key details
      const keyName = await page.locator('td:has-text("VICIdial")').first().textContent().catch(() => null);
      const keyValue = await page.locator('code:has-text("did_")').first().textContent().catch(() => null);

      if (keyName) console.log(`   - Key Name: ${keyName}`);
      if (keyValue) console.log(`   - Key Value: ${keyValue.substring(0, 20)}...`);
    } else {
      console.log('❌ API Keys did not load properly');

      // Check for error messages
      const errorMessage = await page.locator('text=/error|failed|unable/i').first().textContent().catch(() => null);
      if (errorMessage) {
        console.log(`   Error found: ${errorMessage}`);
      }
    }

    // Check for Rotation Rules tab
    console.log('6️⃣ Checking Rotation Rules tab...');
    const rotationTab = await page.locator('button:has-text("Rotation Rules")').count();
    if (rotationTab > 0) {
      await page.click('button:has-text("Rotation Rules")');
      await page.waitForTimeout(1000);
      console.log('✅ Rotation Rules tab accessible');
    }

    // Take a screenshot for verification
    await page.screenshot({ path: 'settings-api-keys-fixed.png', fullPage: true });
    console.log('📸 Screenshot saved: settings-api-keys-fixed.png');

  } catch (error) {
    console.error('❌ Error during test:', error.message);
    await page.screenshot({ path: 'settings-error-fixed.png' });
    console.log('📸 Error screenshot saved: settings-error-fixed.png');
  } finally {
    await browser.close();
    console.log('🏁 Test completed');
  }
})();