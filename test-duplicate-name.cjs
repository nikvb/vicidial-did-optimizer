const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  // Listen to network responses
  page.on('response', async (response) => {
    if (response.url().includes('api-keys')) {
      console.log(`\n📡 ${response.status()} ${response.url()}`);
      try {
        const body = await response.json();
        console.log('Response:', JSON.stringify(body, null, 2));
      } catch (e) {}
    }
  });

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

    // Try 1: Create with name "sdsdf" (similar to existing "sdfsdf")
    console.log('\n=== TEST 1: Try creating key with name similar to existing one ===');
    await page.click('button:has-text("Create API Key")');
    await page.waitForTimeout(500);
    await page.fill('input[placeholder*="VICIdial"]', 'sdsdf');
    await page.screenshot({ path: 'dup-test-1-before.png', fullPage: true });
    await page.click('button:has-text("Create Key")');
    await page.waitForTimeout(3000);

    const error1 = await page.isVisible('.bg-red-50');
    const modal1 = await page.isVisible('text=API Key Created Successfully!');
    console.log(`Result: Error=${error1}, Success=${modal1}`);

    if (error1) {
      const errorText = await page.textContent('.bg-red-50');
      console.log(`ERROR MESSAGE: ${errorText}`);
    }
    await page.screenshot({ path: 'dup-test-1-after.png', fullPage: true });

    // Close modal if it appeared
    if (modal1) {
      await page.click('button:has-text("I\'ve Saved It")');
      await page.waitForTimeout(500);
    } else {
      await page.click('button:has-text("Cancel")');
      await page.waitForTimeout(500);
    }

    // Try 2: Create with exact duplicate name
    console.log('\n=== TEST 2: Try creating key with EXACT duplicate name ===');
    await page.click('button:has-text("Create API Key")');
    await page.waitForTimeout(500);
    await page.fill('input[placeholder*="VICIdial"]', 'sdfsdf'); // Exact match to existing
    await page.screenshot({ path: 'dup-test-2-before.png', fullPage: true });
    await page.click('button:has-text("Create Key")');
    await page.waitForTimeout(3000);

    const error2 = await page.isVisible('.bg-red-50');
    const modal2 = await page.isVisible('text=API Key Created Successfully!');
    console.log(`Result: Error=${error2}, Success=${modal2}`);

    if (error2) {
      const errorText = await page.textContent('.bg-red-50');
      console.log(`ERROR MESSAGE: ${errorText}`);
    }
    await page.screenshot({ path: 'dup-test-2-after.png', fullPage: true });

    if (modal2) {
      await page.click('button:has-text("I\'ve Saved It")');
    } else if (!error2) {
      await page.click('button:has-text("Cancel")');
    }

    // Try 3: Create with unique name
    console.log('\n=== TEST 3: Try creating key with UNIQUE name ===');
    const uniqueName = 'Unique Key ' + Date.now();
    await page.waitForTimeout(500);
    await page.click('button:has-text("Create API Key")');
    await page.waitForTimeout(500);
    await page.fill('input[placeholder*="VICIdial"]', uniqueName);
    await page.screenshot({ path: 'dup-test-3-before.png', fullPage: true });
    await page.click('button:has-text("Create Key")');
    await page.waitForTimeout(3000);

    const error3 = await page.isVisible('.bg-red-50');
    const modal3 = await page.isVisible('text=API Key Created Successfully!');
    console.log(`Result: Error=${error3}, Success=${modal3}`);

    await page.screenshot({ path: 'dup-test-3-after.png', fullPage: true });

    console.log('\n=== SUMMARY ===');
    console.log(`Similar name "sdsdf": ${error1 ? 'FAILED' : 'SUCCESS'}`);
    console.log(`Exact duplicate "sdfsdf": ${error2 ? 'FAILED' : 'SUCCESS'}`);
    console.log(`Unique name: ${error3 ? 'FAILED' : 'SUCCESS'}`);

  } catch (error) {
    console.error('Test error:', error);
    await page.screenshot({ path: 'dup-test-error.png', fullPage: true });
  } finally {
    await browser.close();
  }
})();
