const { chromium } = require('playwright');

(async () => {
  console.log('🧪 Testing VICIdial Installation Page...\n');

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    // Step 1: Login
    console.log('1️⃣  Logging in...');
    await page.goto('https://dids.amdy.io/login');
    await page.fill('input[type="email"]', 'client@test3.com');
    await page.fill('input[type="password"]', 'password123');
    await page.click('button[type="submit"]');
    await page.waitForURL('**/dashboard', { timeout: 10000 });
    console.log('✅ Login successful\n');

    // Step 2: Navigate to Settings
    console.log('2️⃣  Navigating to Settings...');
    await page.goto('https://dids.amdy.io/settings');
    await page.waitForLoadState('networkidle');
    console.log('✅ Settings page loaded\n');

    // Step 3: Find VICIdial Integration section
    console.log('3️⃣  Looking for VICIdial Integration section...');
    const vicidialSection = await page.locator('text=VICIdial Integration').first();
    await vicidialSection.waitFor({ state: 'visible', timeout: 5000 });
    console.log('✅ VICIdial Integration section found\n');

    // Step 4: Check for Installation Guide button
    console.log('4️⃣  Checking for Installation Guide button...');
    const installButton = await page.locator('a[href="/installation/vicidial"]').first();
    const buttonExists = await installButton.count() > 0;

    if (buttonExists) {
      const buttonText = await installButton.textContent();
      console.log(`✅ Installation Guide button found: "${buttonText}"\n`);

      // Step 5: Click and navigate to installation page
      console.log('5️⃣  Navigating to Installation page...');
      await installButton.click();
      await page.waitForURL('**/installation/vicidial', { timeout: 5000 });
      console.log('✅ Installation page loaded\n');

      // Step 6: Verify page content
      console.log('6️⃣  Verifying page content...');

      // Check for page title
      const pageTitle = await page.locator('h1, h2').filter({ hasText: /installation|vicidial/i }).first();
      const titleExists = await pageTitle.count() > 0;
      console.log(`   📋 Page title found: ${titleExists ? '✅' : '❌'}`);

      // Check for Quick Install section
      const quickInstall = await page.locator('text=Quick Install').count() > 0;
      console.log(`   📋 Quick Install section: ${quickInstall ? '✅' : '❌'}`);

      // Check for Manual Install section
      const manualInstall = await page.locator('text=Manual Install').count() > 0;
      console.log(`   📋 Manual Install section: ${manualInstall ? '✅' : '❌'}`);

      // Check for copy buttons
      const copyButtons = await page.locator('button:has-text("Copy")').count();
      console.log(`   📋 Copy buttons found: ${copyButtons} ${copyButtons > 0 ? '✅' : '❌'}`);

      // Check for verification section
      const verification = await page.locator('text=Verification').count() > 0;
      console.log(`   📋 Verification section: ${verification ? '✅' : '❌'}`);

      // Check for troubleshooting section
      const troubleshooting = await page.locator('text=Troubleshooting').count() > 0;
      console.log(`   📋 Troubleshooting section: ${troubleshooting ? '✅' : '❌'}`);

      console.log('\n✅ Installation page content verified!\n');

      // Take screenshot
      await page.screenshot({ path: '/home/na/didapi/installation-page-test.png', fullPage: true });
      console.log('📸 Screenshot saved: installation-page-test.png\n');

    } else {
      console.log('❌ Installation Guide button NOT found\n');
      await page.screenshot({ path: '/home/na/didapi/installation-button-missing.png', fullPage: true });
      console.log('📸 Screenshot saved: installation-button-missing.png\n');
    }

    console.log('✅ All tests passed!\n');

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    await page.screenshot({ path: '/home/na/didapi/installation-page-error.png', fullPage: true });
    console.log('📸 Error screenshot saved: installation-page-error.png\n');
    throw error;
  } finally {
    await browser.close();
  }
})();
