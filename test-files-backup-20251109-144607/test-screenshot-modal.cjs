const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    console.log('🔐 Logging in...');
    await page.goto('https://dids.amdy.io/login');
    await page.waitForLoadState('networkidle');

    await page.fill('input[type="email"]', 'client@test3.com');
    await page.fill('input[type="password"]', 'password123');
    await page.click('button[type="submit"]');

    console.log('⏳ Waiting for dashboard...');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    console.log('📋 Navigating to DID Management...');
    await page.goto('https://dids.amdy.io/did-management');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(3000);

    console.log('🔍 Searching for DID +12097999082...');
    await page.fill('input[placeholder*="Search"]', '12097999082');
    await page.waitForTimeout(2000);

    console.log('📱 Clicking on the reputation bar to open modal...');
    const reputationBar = await page.locator('text=35').first();
    await reputationBar.click();
    await page.waitForTimeout(3000);

    console.log('📸 Taking screenshot of modal...');
    await page.screenshot({ path: 'test-screenshot-modal-final.png', fullPage: true });

    // Check if screenshot link exists
    const screenshotLink = await page.locator('text=/View Screenshot/i');
    const hasScreenshotLink = await screenshotLink.count() > 0;

    console.log('\n📊 Modal Analysis:');
    if (hasScreenshotLink) {
      console.log('✅ Screenshot link found in modal!');
      const linkHref = await screenshotLink.first().getAttribute('href');
      console.log(`🔗 Screenshot URL: ${linkHref}`);
    } else {
      console.log('❌ Screenshot link NOT found in modal');
    }

    // Check modal content
    const modalContent = await page.locator('[role="dialog"]').textContent();
    console.log('\n📋 Modal contains:');
    console.log('  • Score: 35%', modalContent.includes('35%') ? '✅' : '❌');
    console.log('  • Negative status', modalContent.includes('Negative') ? '✅' : '❌');
    console.log('  • Last checked time:', modalContent.includes('ago') || modalContent.includes('Just now') ? '✅' : '❌');
    console.log('  • Screenshot section:', modalContent.includes('Screenshot') ? '✅' : '❌');

  } catch (error) {
    console.error('❌ Test failed:', error);
    await page.screenshot({ path: 'test-screenshot-modal-error.png', fullPage: true });
  } finally {
    await browser.close();
  }
})();
