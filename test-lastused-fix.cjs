const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    console.log('🚀 Testing LastUsed Date Fix\n');

    // Login
    await page.goto('http://localhost:5000/login');
    await page.fill('input[type="email"]', 'client@test3.com');
    await page.fill('input[type="password"]', 'password123');
    await page.click('button[type="submit"]');
    await page.waitForURL('**/dashboard', { timeout: 10000 });
    console.log('✅ Successfully logged in');

    // Navigate to DID Management
    await page.goto('http://localhost:5000/did-management');
    await page.waitForTimeout(3000);
    console.log('📊 Navigated to DID Management page');

    // Check for table
    const tables = await page.$$('table');
    console.log(`Found ${tables.length} table(s) on the page`);

    if (tables.length > 0) {
      console.log('✅ DataTable is rendering!');

      // Get the first few rows and check last used dates
      const rows = await page.$$('tbody tr');
      console.log(`Found ${rows.length} DIDs in the table\n`);

      console.log('🔍 Checking "Last Used" dates (should now show current dates):');

      for (let i = 0; i < Math.min(rows.length, 5); i++) {
        const row = rows[i];
        const rowText = await row.textContent();

        // Extract DID number
        const didMatch = rowText.match(/\+1\d{10}/);
        const didNumber = didMatch ? didMatch[0] : 'Unknown DID';

        // Look for time patterns
        const timePatterns = [
          /Just now/i,
          /\d+m ago/i,
          /\d+h ago/i,
          /\d+ days? ago/i,
          /\d+ months? ago/i,
          /Never/i
        ];

        let lastUsed = 'Not found';
        for (const pattern of timePatterns) {
          const match = rowText.match(pattern);
          if (match) {
            lastUsed = match[0];
            break;
          }
        }

        console.log(`  ${didNumber}: ${lastUsed}`);

        // Check if it's showing current dates vs October dates
        if (lastUsed.includes('days ago')) {
          const daysMatch = lastUsed.match(/(\d+) days? ago/);
          if (daysMatch) {
            const days = parseInt(daysMatch[1]);
            if (days < 10) {
              console.log(`    ✅ Recent usage (${days} days ago) - Fix working!`);
            } else {
              console.log(`    ⚠️ Still showing older data (${days} days ago)`);
            }
          }
        } else if (lastUsed.includes('h ago') || lastUsed.includes('m ago') || lastUsed === 'Just now') {
          console.log(`    ✅ Very recent usage - Fix working perfectly!`);
        }
      }
    } else {
      console.log('❌ No DataTable found');
    }

    await page.screenshot({ path: 'lastused-fix-test.png', fullPage: true });
    console.log('\n📸 Screenshot saved as lastused-fix-test.png');

  } catch (error) {
    console.error('❌ Test failed:', error.message);
  } finally {
    await browser.close();
  }
})();