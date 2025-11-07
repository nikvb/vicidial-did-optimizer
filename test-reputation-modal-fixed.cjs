const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    console.log('🔍 Testing Reputation Modal Date Formatting Fix\n');

    // Enable console and network monitoring
    page.on('console', msg => {
      if (msg.type() === 'error') {
        console.log('❌ Browser Error:', msg.text());
      }
    });

    page.on('response', response => {
      if (response.url().includes('/reputation')) {
        console.log(`📡 Reputation API Response: ${response.status()} ${response.url()}`);
      }
    });

    // Login
    await page.goto('https://dids.amdy.io/login');
    await page.fill('input[type="email"]', 'client@test3.com');
    await page.fill('input[type="password"]', 'password123');
    await page.click('button[type="submit"]');
    await page.waitForURL('**/dashboard', { timeout: 10000 });
    console.log('✅ Successfully logged in');

    // Navigate to DID Management
    await page.goto('https://dids.amdy.io/did-management');
    await page.waitForTimeout(5000);
    console.log('📊 Navigated to DID Management page');

    // Look for any DID in the table and click it
    const didRows = await page.$$('tbody tr');
    if (didRows.length > 0) {
      console.log(`📋 Found ${didRows.length} DID rows`);

      // Click the first DID row to open the modal
      await didRows[0].click();
      await page.waitForTimeout(2000);
      console.log('🔄 Clicked first DID row');

      // Look for the reputation modal
      const reputationModal = await page.$('[class*="fixed"] h3:has-text("Reputation Details")');
      if (reputationModal) {
        console.log('✅ Reputation modal opened');

        // Wait for the modal content to load
        await page.waitForTimeout(3000);

        // Check for date elements in the modal
        const dateElements = await page.$$('[class*="fixed"] text=/\\d+h ago|\\d+d ago|Just now|\\d+\\/\\d+\\/\\d+|Invalid date|Never/');
        console.log(`📅 Found ${dateElements.length} date elements in modal`);

        // Check for "Just now" text (this should be reduced after our fix)
        const justNowElements = await page.$$('text="Just now"');
        console.log(`⏰ Found ${justNowElements.length} "Just now" elements`);

        // Check for "Invalid date" text (this should not appear with our fix)
        const invalidDateElements = await page.$$('text="Invalid date"');
        console.log(`❌ Found ${invalidDateElements.length} "Invalid date" elements`);

        // Get all text content from the modal for analysis
        const modalContent = await page.$eval('[class*="fixed"]', el => el.textContent);

        // Count occurrences of different date formats
        const justNowCount = (modalContent.match(/Just now/g) || []).length;
        const relativeTimeCount = (modalContent.match(/\d+[hd] ago/g) || []).length;
        const absoluteDateCount = (modalContent.match(/\d+\/\d+\/\d+/g) || []).length;
        const invalidDateCount = (modalContent.match(/Invalid date/g) || []).length;
        const neverCount = (modalContent.match(/Never/g) || []).length;

        console.log('\n📊 Date Format Analysis:');
        console.log(`   "Just now": ${justNowCount}`);
        console.log(`   Relative time (Nh ago, Nd ago): ${relativeTimeCount}`);
        console.log(`   Absolute dates (MM/DD/YYYY): ${absoluteDateCount}`);
        console.log(`   "Invalid date": ${invalidDateCount}`);
        console.log(`   "Never": ${neverCount}`);

        // Verify the fix worked
        if (invalidDateCount === 0) {
          console.log('✅ SUCCESS: No "Invalid date" text found - date parsing fix working!');
        } else {
          console.log('❌ ISSUE: Still found "Invalid date" text - fix may not be working');
        }

        if (justNowCount < 5) {
          console.log('✅ SUCCESS: Reduced "Just now" occurrences - date validation working!');
        } else {
          console.log('⚠️  WARNING: Many "Just now" occurrences - may indicate date parsing issues');
        }

      } else {
        console.log('❌ Reputation modal not found');
      }
    } else {
      console.log('❌ No DID rows found in table');
    }

    await page.screenshot({ path: 'test-reputation-modal-fixed.png', fullPage: true });
    console.log('📸 Screenshot saved as test-reputation-modal-fixed.png');

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    await page.screenshot({ path: 'test-reputation-modal-fixed-error.png', fullPage: true });
  } finally {
    await browser.close();
  }
})();