const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    console.log('1. Login...');
    await page.goto('https://dids.amdy.io/login');
    await page.fill('input[type="email"]', 'client@test3.com');
    await page.fill('input[type="password"]', 'password123');
    await page.click('button[type="submit"]');
    await page.waitForURL('**/dashboard', { timeout: 10000 });

    console.log('2. Go to Settings...');
    await page.goto('https://dids.amdy.io/settings');
    await page.waitForTimeout(2000);

    console.log('3. Try creating duplicate API key "sdfsdf"...');
    await page.click('button:has-text("Create API Key")');
    await page.waitForTimeout(500);
    await page.fill('input[placeholder*="VICIdial"]', 'sdfsdf');
    await page.screenshot({ path: 'dup-ui-before.png', fullPage: true });

    await page.click('button:has-text("Create Key")');
    await page.waitForTimeout(3000);

    const errorVisible = await page.isVisible('.bg-red-50');
    const modalVisible = await page.isVisible('text=API Key Created Successfully!');

    console.log(`\nError visible: ${errorVisible}`);
    console.log(`Success modal visible: ${modalVisible}`);

    if (errorVisible) {
      const errorText = await page.textContent('.bg-red-50');
      console.log(`\n✅ ERROR MESSAGE DISPLAYED: "${errorText.trim()}"`);

      if (errorText.includes('already exists')) {
        console.log('✅ CORRECT: Shows specific error about duplicate name');
      } else {
        console.log('❌ WRONG: Shows generic error message');
      }
    }

    await page.screenshot({ path: 'dup-ui-after.png', fullPage: true });

    console.log('\n=== TEST RESULT ===');
    if (errorVisible && !modalVisible) {
      console.log('✅ PASSED: Duplicate name properly rejected with error message');
    } else if (modalVisible) {
      console.log('❌ FAILED: Created duplicate key (should have been rejected)');
    } else {
      console.log('❌ FAILED: No error or success feedback');
    }

  } catch (error) {
    console.error('Test error:', error);
    await page.screenshot({ path: 'dup-ui-error.png', fullPage: true });
  } finally {
    await browser.close();
  }
})();
