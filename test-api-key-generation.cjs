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

    // Wait for navigation after login
    await page.waitForURL('**/dashboard', { timeout: 10000 });
    console.log('✓ Login successful');

    console.log('3. Navigating to Settings...');
    await page.goto('https://dids.amdy.io/settings', { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);

    console.log('4. Looking for API Keys section...');
    // Check if API Keys tab/section is visible
    const apiKeysVisible = await page.isVisible('text=API Keys');
    console.log(`API Keys section visible: ${apiKeysVisible}`);

    if (apiKeysVisible) {
      // Click on API Keys tab if needed
      const apiKeysTab = await page.$('text=API Keys');
      if (apiKeysTab) {
        await apiKeysTab.click();
        await page.waitForTimeout(1000);
      }
    }

    console.log('5. Looking for Create API Key button...');
    const createButton = await page.$('button:has-text("Create API Key")');
    if (!createButton) {
      console.error('✗ Create API Key button not found!');
      await page.screenshot({ path: 'api-key-no-button.png', fullPage: true });
      console.log('Screenshot saved as api-key-no-button.png');

      // Log page content for debugging
      const pageContent = await page.content();
      console.log('\nPage HTML contains "Create API Key":', pageContent.includes('Create API Key'));
      console.log('Page HTML contains "API Keys":', pageContent.includes('API Keys'));
    } else {
      console.log('✓ Create API Key button found');

      // Click the create button
      console.log('6. Clicking Create API Key button...');
      await createButton.click();
      await page.waitForTimeout(1000);

      // Check if form appeared
      const formVisible = await page.isVisible('text=Create New API Key');
      console.log(`Create form visible: ${formVisible}`);

      if (formVisible) {
        console.log('7. Filling out the form...');
        await page.fill('input[placeholder*="VICIdial"]', 'Test API Key ' + Date.now());

        console.log('8. Clicking Create Key button...');
        const createKeyButton = await page.$('button:has-text("Create Key")');

        // Listen for network requests
        page.on('response', async (response) => {
          if (response.url().includes('api-keys')) {
            console.log(`API Response: ${response.status()} ${response.url()}`);
            try {
              const body = await response.json();
              console.log('Response body:', JSON.stringify(body, null, 2));
            } catch (e) {
              console.log('Could not parse response as JSON');
            }
          }
        });

        await createKeyButton.click();
        await page.waitForTimeout(3000);

        // Check for error messages
        const errorVisible = await page.isVisible('.bg-red-50');
        if (errorVisible) {
          const errorText = await page.textContent('.bg-red-50');
          console.error('✗ Error message:', errorText);
        }

        // Check for success (alert or new key in list)
        const dialogText = await page.evaluate(() => {
          return new Promise((resolve) => {
            setTimeout(() => resolve(null), 100);
          });
        });

        await page.screenshot({ path: 'api-key-after-create.png', fullPage: true });
        console.log('Screenshot saved as api-key-after-create.png');
      } else {
        console.error('✗ Create form did not appear');
        await page.screenshot({ path: 'api-key-no-form.png', fullPage: true });
      }
    }

    console.log('\n9. Checking current page state...');
    await page.screenshot({ path: 'api-key-final-state.png', fullPage: true });
    console.log('Final screenshot saved as api-key-final-state.png');

  } catch (error) {
    console.error('Error during test:', error);
    await page.screenshot({ path: 'api-key-error.png', fullPage: true });
    console.log('Error screenshot saved');
  } finally {
    await browser.close();
  }
})();
