const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    console.log('🤖 Testing AI DID Bot Implementation\n');

    // Login first
    await page.goto('http://localhost:5000/login');
    await page.fill('input[type="email"]', 'client@test3.com');
    await page.fill('input[type="password"]', 'password123');
    await page.click('button[type="submit"]');
    await page.waitForURL('**/dashboard', { timeout: 10000 });
    console.log('✅ Successfully logged in');

    // Navigate to DID Management
    await page.goto('http://localhost:5000/did-management');
    await page.waitForTimeout(2000);
    console.log('📊 Navigated to DID Management page');

    // Look for AI Assistant button
    const aiButton = await page.$('button:has-text("AI Assistant")');
    if (aiButton) {
      console.log('✅ AI Assistant button found!');

      // Click AI Assistant button
      await aiButton.click();
      await page.waitForTimeout(1000);

      // Check if AI bot modal appeared
      const aiModal = await page.$('[class*="fixed inset-0"]');
      if (aiModal) {
        console.log('✅ AI Bot modal opened successfully!');

        // Check for AI bot components
        const chatHeader = await page.$('text=AI DID Management Assistant');
        const messageInput = await page.$('input[placeholder*="Ask me to manage"]');
        const quickActions = await page.$$('button:has-text("Show DID statistics")');

        if (chatHeader) console.log('✅ AI bot header found');
        if (messageInput) console.log('✅ Message input found');
        if (quickActions.length > 0) console.log('✅ Quick action buttons found');

        // Try to send a test message
        if (messageInput) {
          await messageInput.fill('Show me current DID statistics');
          await page.keyboard.press('Enter');
          console.log('📤 Test message sent to AI bot');
          await page.waitForTimeout(2000);
        }

        // Take screenshot
        await page.screenshot({ path: 'ai-bot-test.png', fullPage: true });
        console.log('📸 Screenshot saved as ai-bot-test.png');

      } else {
        console.log('❌ AI Bot modal did not open');
      }
    } else {
      console.log('❌ AI Assistant button not found');
    }

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    await page.screenshot({ path: 'ai-bot-error.png', fullPage: true });
  } finally {
    await browser.close();
  }
})();