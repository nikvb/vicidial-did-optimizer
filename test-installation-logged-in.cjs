const { chromium } = require('playwright');

(async () => {
  console.log('🧪 Testing VICIdial Installation Page (with authentication)...\n');

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    // Login first
    console.log('🔐 Logging in...');
    await page.goto('https://dids.amdy.io/login', { waitUntil: 'networkidle' });

    await page.fill('input[type="email"]', 'client@test3.com');
    await page.fill('input[type="password"]', 'password123');
    await page.click('button[type="submit"]');

    // Wait for navigation
    await page.waitForURL('**/dashboard', { timeout: 10000 });
    console.log('✅ Logged in successfully\n');

    // Now navigate to installation page
    console.log('📄 Navigating to installation page...');
    await page.goto('https://dids.amdy.io/installation/vicidial', { waitUntil: 'networkidle' });

    // Get page title
    const title = await page.title();
    console.log('Page Title:', title);

    // Check for main heading
    const headings = await page.evaluate(() => {
      const h1s = Array.from(document.querySelectorAll('h1, h2, h3'));
      return h1s.slice(0, 3).map(h => h.textContent);
    });
    console.log('Headings:', headings.join(' | '));

    // Get all code blocks
    const codeBlocks = await page.evaluate(() => {
      const codes = Array.from(document.querySelectorAll('code, pre'));
      return codes.map((code, idx) => ({
        index: idx,
        text: code.textContent.substring(0, 150) + (code.textContent.length > 150 ? '...' : ''),
        hasChown: code.textContent.toLowerCase().includes('chown')
      }));
    });

    console.log(`\n📊 Found ${codeBlocks.length} code blocks\n`);

    let totalChown = 0;
    codeBlocks.forEach(block => {
      if (block.hasChown) {
        totalChown++;
        console.log(`❌ Block ${block.index} contains chown:`);
        console.log(`   ${block.text.substring(0, 100)}`);
      }
    });

    if (totalChown === 0) {
      console.log('✅ SUCCESS: No code blocks contain chown commands');
    } else {
      console.log(`\n❌ FAILED: Found ${totalChown} code blocks with chown commands`);
    }

    // Show a few sample code blocks
    console.log('\n📋 Sample code blocks:');
    codeBlocks.slice(0, 5).forEach(block => {
      if (block.text.length > 20) {
        console.log(`\nBlock ${block.index}:`);
        console.log(block.text);
      }
    });

    // Get all visible text
    const bodyText = await page.evaluate(() => document.body.innerText);
    const hasChownInText = bodyText.toLowerCase().includes('chown asterisk');

    console.log(`\n🔍 Full page text search:`);
    console.log(`   Contains "chown asterisk": ${hasChownInText ? '❌ YES' : '✅ NO'}`);

    // Take screenshot
    await page.screenshot({ path: '/tmp/installation-page-logged-in.png', fullPage: true });
    console.log('\n📸 Screenshot saved: /tmp/installation-page-logged-in.png');

  } catch (error) {
    console.error('❌ Error:', error.message);
    await page.screenshot({ path: '/tmp/installation-error.png', fullPage: true });
  } finally {
    await browser.close();
  }
})();
