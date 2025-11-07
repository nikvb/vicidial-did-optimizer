const { chromium } = require('playwright');

(async () => {
  console.log('🧪 Testing VICIdial Enhanced Error Messages\n');

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

    // Test 1: Invalid hostname (DNS error)
    console.log('\n📋 Test 1: Invalid Hostname (DNS Error)');
    await page.fill('input[placeholder="vicidial.example.com"]', 'invalid-hostname-that-does-not-exist.com');
    await page.fill('input[placeholder="api_user"]', 'testuser');
    await page.fill('input[type="password"]', 'testpass');
    await page.click('button:has-text("Connect & Save")');
    await page.waitForTimeout(8000);

    // Check for error message
    const dnsErrorVisible = await page.locator('text=Hostname not found').count() > 0;
    const dnsErrorDetails = await page.locator('text=Cannot resolve hostname').count() > 0;
    console.log(`  ✓ DNS Error Message: ${dnsErrorVisible ? '✅ Displayed' : '❌ Not found'}`);
    console.log(`  ✓ DNS Error Details: ${dnsErrorDetails ? '✅ Displayed' : '❌ Not found'}`);

    // Take screenshot
    await page.screenshot({
      path: 'test-vicidial-error-dns.png',
      fullPage: true
    });
    console.log('  📸 Screenshot: test-vicidial-error-dns.png');

    // Test 2: Timeout error (using valid hostname but wrong credentials)
    console.log('\n📋 Test 2: Connection Timeout');
    await page.fill('input[placeholder="vicidial.example.com"]', '192.0.2.1'); // TEST-NET-1 (unreachable)
    await page.fill('input[placeholder="api_user"]', 'testuser');
    await page.fill('input[type="password"]', 'testpass');
    await page.click('button:has-text("Connect & Save")');
    await page.waitForTimeout(15000); // Wait for timeout

    const timeoutErrorVisible = await page.locator('text=timeout').count() > 0 ||
                                  await page.locator('text=Connection timed out').count() > 0 ||
                                  await page.locator('text=Connection timeout').count() > 0;
    console.log(`  ✓ Timeout Error: ${timeoutErrorVisible ? '✅ Displayed' : '❌ Not found'}`);

    // Take screenshot
    await page.screenshot({
      path: 'test-vicidial-error-timeout.png',
      fullPage: true
    });
    console.log('  📸 Screenshot: test-vicidial-error-timeout.png');

    // Verify error display structure
    console.log('\n📊 Verifying Error Display Structure:');
    const hasErrorIcon = await page.locator('svg').count() > 0;
    const hasErrorTitle = await page.locator('.text-red-800').count() > 0;
    const hasErrorDetails = await page.locator('.text-red-700').count() > 0;
    const hasErrorBox = await page.locator('.bg-red-50').count() > 0;

    console.log(`  - Error icon: ${hasErrorIcon ? '✅ Present' : '❌ Missing'}`);
    console.log(`  - Error title styling: ${hasErrorTitle ? '✅ Present' : '❌ Missing'}`);
    console.log(`  - Error details styling: ${hasErrorDetails ? '✅ Present' : '❌ Missing'}`);
    console.log(`  - Error box styling: ${hasErrorBox ? '✅ Present' : '❌ Missing'}`);

    console.log('\n✅ VICIdial Error Message Test Completed!');

  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
    await page.screenshot({ path: 'test-vicidial-error-messages-failed.png', fullPage: true });
    console.log('  📸 Error screenshot: test-vicidial-error-messages-failed.png');
  } finally {
    await browser.close();
  }
})();
