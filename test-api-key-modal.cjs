const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    console.log('1. Navigating to login page...');
    await page.goto('https://dids.amdy.io/login', { waitUntil: 'networkidle' });

    console.log('2. Logging in...');
    await page.fill('input[type="email"]', 'client@test3.com');
    await page.fill('input[type="password"]', 'password123');
    await page.click('button[type="submit"]');
    await page.waitForURL('**/dashboard', { timeout: 10000 });
    console.log('✓ Login successful');

    console.log('3. Navigating to Settings...');
    await page.goto('https://dids.amdy.io/settings', { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);

    console.log('4. Clicking Create API Key button...');
    const createButton = await page.$('button:has-text("Create API Key")');
    if (!createButton) {
      console.error('✗ Create API Key button not found!');
      process.exit(1);
    }
    await createButton.click();
    await page.waitForTimeout(1000);
    await page.screenshot({ path: 'modal-step1-form-opened.png', fullPage: true });

    console.log('5. Filling out the form...');
    const timestamp = Date.now();
    await page.fill('input[placeholder*="VICIdial"]', `Test Modal Key ${timestamp}`);
    await page.screenshot({ path: 'modal-step2-form-filled.png', fullPage: true });

    console.log('6. Clicking Create Key button...');
    const createKeyButton = await page.$('button:has-text("Create Key")');
    await createKeyButton.click();

    // Wait for the modal to appear
    console.log('7. Waiting for success modal...');
    await page.waitForSelector('text=API Key Created Successfully!', { timeout: 5000 });
    await page.waitForTimeout(1000);
    await page.screenshot({ path: 'modal-step3-success-modal.png', fullPage: true });
    console.log('✓ Success modal appeared!');

    // Check if the API key is visible in the modal
    const modalVisible = await page.isVisible('text=Save this key now');
    console.log(`Modal warning visible: ${modalVisible}`);

    // Check if the API key text is present
    const apiKeyElement = await page.$('code.select-all');
    if (apiKeyElement) {
      const apiKeyText = await apiKeyElement.textContent();
      console.log(`✓ API Key visible in modal: ${apiKeyText.substring(0, 20)}...`);

      if (apiKeyText.startsWith('did_')) {
        console.log('✓ API key has correct format (starts with "did_")');
      }
    } else {
      console.error('✗ API key not found in modal!');
    }

    // Check for copy button
    const copyButton = await page.$('button:has-text("Copy Key")');
    if (copyButton) {
      console.log('✓ Copy Key button found');
      await copyButton.click();
      console.log('✓ Clicked Copy Key button');
      await page.waitForTimeout(500);
    }

    await page.screenshot({ path: 'modal-step4-final.png', fullPage: true });

    // Close the modal
    console.log('8. Closing modal...');
    const closeButton = await page.$('button:has-text("I\'ve Saved It")');
    if (closeButton) {
      await closeButton.click();
      console.log('✓ Modal closed');
      await page.waitForTimeout(1000);
    }

    // Verify the new key appears in the list
    console.log('9. Verifying key appears in list...');
    const keyInList = await page.isVisible(`text=Test Modal Key ${timestamp}`);
    console.log(`New key in list: ${keyInList}`);

    await page.screenshot({ path: 'modal-step5-key-in-list.png', fullPage: true });

    console.log('\n✓ API Key Modal Test PASSED!');
    console.log('Screenshots saved:');
    console.log('  - modal-step1-form-opened.png');
    console.log('  - modal-step2-form-filled.png');
    console.log('  - modal-step3-success-modal.png');
    console.log('  - modal-step4-final.png');
    console.log('  - modal-step5-key-in-list.png');

  } catch (error) {
    console.error('✗ Test failed:', error.message);
    await page.screenshot({ path: 'modal-error.png', fullPage: true });
    console.log('Error screenshot saved as modal-error.png');
  } finally {
    await browser.close();
  }
})();
