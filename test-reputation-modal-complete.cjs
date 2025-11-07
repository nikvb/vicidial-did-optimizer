const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox']
  });
  const context = await browser.newContext();
  const page = await context.newPage();

  // Enable console logging
  page.on('console', msg => {
    if (msg.text().includes('📊 Reputation')) {
      console.log('🖥️ ', msg.text());
    }
  });

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
    // Find the reputation bar/score element for this DID (it shows 35%)
    const reputationBar = await page.locator('text=35').first();
    await reputationBar.click();
    await page.waitForTimeout(3000);

    console.log('📸 Taking screenshot of modal...');
    await page.screenshot({ path: 'test-reputation-modal-fixed-complete.png', fullPage: true });

    // Extract modal content
    console.log('\n📊 Modal Content Analysis:');

    // Check for "Last checked" text
    const lastCheckedElement = await page.locator('text=/Last checked:/i').first();
    if (await lastCheckedElement.count() > 0) {
      const parentElement = await lastCheckedElement.locator('..').first();
      const text = await parentElement.textContent();
      console.log('✓ Last Checked:', text);

      if (text.includes('Never')) {
        console.log('❌ BUG STILL EXISTS: Shows "Never" instead of actual date');
      } else {
        console.log('✅ FIXED: Shows actual check time');
      }
    }

    // Check reputation score
    const scoreElement = await page.locator('text=/Overall Reputation Score/i').locator('..').locator('..').first();
    if (await scoreElement.count() > 0) {
      const scoreText = await scoreElement.textContent();
      console.log('✓ Score Section:', scoreText);

      if (scoreText.includes('35')) {
        console.log('✅ Correct score displayed: 35');
      } else {
        console.log('❌ Wrong score or undefined');
      }
    }

    // Check RoboKiller section
    const robokillerSection = await page.locator('text=/RoboKiller Status/i').locator('..').locator('..').first();
    if (await robokillerSection.count() > 0) {
      const roboText = await robokillerSection.textContent();
      console.log('✓ RoboKiller Section:', roboText);

      if (roboText.includes('Negative') || roboText.includes('1')) {
        console.log('✅ Shows reputation details (Negative status, 1 report)');
      }
    }

    console.log('\n⏸️  Modal is open. Waiting 30 seconds for manual inspection...');
    await page.waitForTimeout(30000);

  } catch (error) {
    console.error('❌ Test failed:', error);
    await page.screenshot({ path: 'test-reputation-modal-error.png', fullPage: true });
  } finally {
    await browser.close();
  }
})();
