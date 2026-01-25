const { chromium } = require('playwright');

(async () => {
  console.log('🧪 Testing VICIdial Installation Page (v2)...\n');

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

    // Step 2: Test direct navigation to installation page
    console.log('2️⃣  Testing direct navigation to /installation/vicidial...');
    await page.goto('https://dids.amdy.io/installation/vicidial');
    await page.waitForLoadState('networkidle');

    // Get page URL
    const currentURL = page.url();
    console.log(`   Current URL: ${currentURL}`);

    if (currentURL.includes('/installation/vicidial')) {
      console.log('✅ Successfully navigated to installation page\n');

      // Step 3: Verify page content
      console.log('3️⃣  Verifying page content...');

      // Check for main heading
      const heading = await page.locator('h1, h2').first().textContent();
      console.log(`   📋 Page heading: "${heading}"`);

      // Check for Quick Install section
      const quickInstall = await page.locator('text=Quick Install').count() > 0;
      console.log(`   📋 Quick Install section: ${quickInstall ? '✅' : '❌'}`);

      // Check for Manual Install section
      const manualInstall = await page.locator('text=Manual Install').count() > 0;
      console.log(`   📋 Manual Install section: ${manualInstall ? '✅' : '❌'}`);

      // Check for copy buttons
      const copyButtons = await page.locator('button:has-text("Copy")').count();
      console.log(`   📋 Copy buttons found: ${copyButtons}`);

      // Check for code blocks
      const codeBlocks = await page.locator('pre, code').count();
      console.log(`   📋 Code blocks found: ${codeBlocks}`);

      // Take screenshot
      await page.screenshot({ path: '/home/na/didapi/installation-page-direct.png', fullPage: true });
      console.log('\n📸 Screenshot saved: installation-page-direct.png\n');

      console.log('✅ Direct navigation test passed!\n');

    } else {
      console.log(`❌ Failed to navigate - redirected to: ${currentURL}\n`);
      await page.screenshot({ path: '/home/na/didapi/installation-page-redirect.png', fullPage: true });
      console.log('📸 Screenshot saved: installation-page-redirect.png\n');
    }

    // Step 4: Test link from Settings page
    console.log('4️⃣  Testing link from Settings page...');
    await page.goto('https://dids.amdy.io/settings');
    await page.waitForLoadState('networkidle');

    // Wait a bit for content to load
    await page.waitForTimeout(2000);

    // Take screenshot of settings page
    await page.screenshot({ path: '/home/na/didapi/settings-page-with-button.png', fullPage: true });
    console.log('   📸 Settings page screenshot: settings-page-with-button.png');

    // Look for the installation guide link with more flexible selector
    const installLinks = await page.locator('a').all();
    let foundLink = false;

    for (const link of installLinks) {
      const href = await link.getAttribute('href');
      if (href && href.includes('/installation/vicidial')) {
        foundLink = true;
        const text = await link.textContent();
        console.log(`   ✅ Found installation link: "${text.trim()}" (href: ${href})`);
        break;
      }
    }

    if (!foundLink) {
      console.log('   ❌ Installation link not found in Settings page');

      // Debug: show all links on page
      console.log('\n   🔍 All links on settings page:');
      for (const link of installLinks.slice(0, 20)) {
        const href = await link.getAttribute('href');
        const text = await link.textContent();
        if (href) {
          console.log(`      - "${text?.trim()}" → ${href}`);
        }
      }
    }

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    await page.screenshot({ path: '/home/na/didapi/installation-test-error-v2.png', fullPage: true });
    console.log('📸 Error screenshot saved: installation-test-error-v2.png\n');
    throw error;
  } finally {
    await browser.close();
  }
})();
