const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  page.on('console', msg => {
    if (msg.text().includes('plan') || msg.text().includes('Plan')) {
      console.log('BROWSER:', msg.text());
    }
  });

  try {
    console.log('1. Login...');
    await page.goto('https://dids.amdy.io/login');
    await page.fill('input[type="email"]', 'client@test2.com');
    await page.fill('input[type="password"]', 'care72345');
    await page.click('button[type="submit"]');
    await page.waitForURL('**/dashboard', { timeout: 10000 });

    console.log('2. Go to Billing...');
    await page.goto('https://dids.amdy.io/billing');
    await page.waitForTimeout(3000);

    console.log('3. Look for Change Plan button...');
    const changePlanButton = await page.$('button:has-text("Change Plan")');
    if (!changePlanButton) {
      console.log('❌ Change Plan button not found');
      await page.screenshot({ path: 'plan-no-button.png', fullPage: true });
      return;
    }
    console.log('✓ Found Change Plan button');

    console.log('4. Click Change Plan...');
    await changePlanButton.click();
    await page.waitForTimeout(2000);

    // Check what appears
    const modalVisible = await page.isVisible('text=Change Plan');
    console.log(`Modal visible: ${modalVisible}`);

    const comingLaterVisible = await page.isVisible('text=coming later');
    console.log(`"Coming later" visible: ${comingLaterVisible}`);

    if (comingLaterVisible) {
      console.log('❌ FOUND "coming later" message');
    }

    // Check for plan options
    const basicPlanVisible = await page.isVisible('text=Basic Plan');
    const professionalPlanVisible = await page.isVisible('text=Professional Plan');
    console.log(`Basic Plan visible: ${basicPlanVisible}`);
    console.log(`Professional Plan visible: ${professionalPlanVisible}`);

    await page.screenshot({ path: 'plan-change-modal.png', fullPage: true });
    console.log('Screenshot saved: plan-change-modal.png');

  } catch (error) {
    console.error('Test error:', error);
    await page.screenshot({ path: 'plan-error.png', fullPage: true });
  } finally {
    await browser.close();
  }
})();
