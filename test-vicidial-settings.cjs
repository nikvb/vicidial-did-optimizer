const { chromium } = require('playwright');

(async () => {
  console.log('🧪 Testing VICIdial Integration Settings Page\n');

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    // Login
    console.log('🔐 Logging in...');
    await page.goto('https://dids.amdy.io/login', { waitUntil: 'networkidle', timeout: 30000 });
    await page.fill('input[type="email"]', 'client@test3.com');
    await page.fill('input[type="password"]', 'password123');
    await page.click('button[type="submit"]');
    await page.waitForTimeout(3000);

    // Navigate to Settings
    console.log('⚙️  Navigating to Settings page...');
    await page.goto('https://dids.amdy.io/settings', { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(2000);

    // Click on VICIdial Integration tab
    console.log('🖱️  Clicking VICIdial Integration tab...');
    await page.click('text=VICIdial Integration');
    await page.waitForTimeout(2000);

    // Verify VICIdial Integration form elements
    console.log('\n✅ Verifying VICIdial Integration Page Elements:\n');

    const hasTitle = await page.locator('text=VICIdial Integration').count() > 0;
    console.log(`  - Page title: ${hasTitle ? '✅ Found' : '❌ Not found'}`);

    const hasHostnameInput = await page.locator('input[placeholder="vicidial.example.com"]').count() > 0;
    console.log(`  - Hostname input: ${hasHostnameInput ? '✅ Found' : '❌ Not found'}`);

    const hasUsernameInput = await page.locator('input[placeholder="api_user"]').count() > 0;
    console.log(`  - Username input: ${hasUsernameInput ? '✅ Found' : '❌ Not found'}`);

    const hasPasswordInput = await page.locator('input[type="password"]').count() > 0;
    console.log(`  - Password input: ${hasPasswordInput ? '✅ Found' : '❌ Not found'}`);

    const hasConnectButton = await page.locator('button:has-text("Connect & Save")').count() > 0;
    console.log(`  - Connect button: ${hasConnectButton ? '✅ Found' : '❌ Not found'}`);

    const hasInstructions = await page.locator('text=Instructions').count() > 0;
    console.log(`  - Instructions section: ${hasInstructions ? '✅ Found' : '❌ Not found'}`);

    const hasIPAddresses = await page.locator('text=65.21.161.173').count() > 0;
    console.log(`  - IP addresses shown: ${hasIPAddresses ? '✅ Found' : '❌ Not found'}`);

    // Check if other tabs are present
    console.log('\n📋 Other Settings Tabs:');
    const hasApiKeysTab = await page.locator('text=API Keys').count() > 0;
    console.log(`  - API Keys tab: ${hasApiKeysTab ? '✅ Found' : '❌ Not found'}`);

    const hasComplianceTab = await page.locator('text=Compliance').count() > 0;
    console.log(`  - Compliance tab: ${hasComplianceTab ? '✅ Found' : '❌ Not found'}`);

    const hasPerformanceTab = await page.locator('text=Performance').count() > 0;
    console.log(`  - Performance tab: ${hasPerformanceTab ? '✅ Found' : '❌ Not found'}`);

    // Take screenshots
    console.log('\n📸 Capturing screenshots...');
    await page.screenshot({
      path: 'test-vicidial-settings.png',
      fullPage: true
    });
    console.log('  - Full page: test-vicidial-settings.png');

    console.log('\n✅ VICIdial Settings page test completed successfully!');

  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
    await page.screenshot({ path: 'test-vicidial-settings-error.png', fullPage: true });
    console.log('  - Error screenshot: test-vicidial-settings-error.png');
  } finally {
    await browser.close();
  }
})();
