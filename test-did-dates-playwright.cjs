const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({
    headless: true, // Run headless since no X server
    slowMo: 100 // Slow down actions to see them
  });

  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    console.log('🚀 Testing DID Management Last Usage Dates\n');

    // Go to the login page
    await page.goto('http://localhost:5000/login');
    console.log('📄 Navigated to login page');

    // Login with credentials
    await page.fill('input[type="email"]', 'client@test3.com');
    await page.fill('input[type="password"]', 'password123');
    console.log('📝 Filled login credentials');

    // Submit the form
    await page.click('button[type="submit"]');
    console.log('🔑 Login form submitted');

    // Wait for redirect to dashboard
    await page.waitForURL('**/dashboard', { timeout: 10000 });
    console.log('✅ Successfully logged in and redirected to dashboard\n');

    // Navigate to DID Management
    await page.click('a[href="/did-management"]');
    await page.waitForURL('**/did-management', { timeout: 10000 });
    console.log('📊 Navigated to DID Management page');

    // Wait a moment for the page to load, then check what's there
    await page.waitForTimeout(3000);
    console.log('📋 Page content loaded, checking what is displayed...\n');

    // Get the full page content to see what's actually rendered
    const pageContent = await page.content();
    console.log('Page title:', await page.title());

    // Check if our DataTable components are present in the DOM
    const hasDataTable = pageContent.includes('react-data-table-component') ||
                         pageContent.includes('DataTable') ||
                         pageContent.includes('did-datatable-container');
    console.log('Has DataTable component:', hasDataTable);

    // Check for any error messages
    const errorElements = await page.$$('text="Error"');
    if (errorElements.length > 0) {
      console.log('❌ Found error messages on page');
    }

    // Try to find the table with a more flexible selector
    const tables = await page.$$('table');
    console.log(`Found ${tables.length} table(s) on the page`);

    // Get the actual data from the table
    console.log('🔍 Checking "Last Used" column values:\n');

    if (tables.length === 0) {
      console.log('❌ No tables found on the page - DataTable component not loaded!');

      // Check what is actually in the main content area
      const mainContent = await page.locator('#root').textContent();
      console.log('Main content preview:', mainContent.slice(0, 500) + '...');

      return; // Exit early if no table
    }

    // Find all rows in the table body
    const rows = await page.$$('tbody tr');
    console.log(`Found ${rows.length} DIDs in the table\n`);

    // Check the first 10 rows for last used dates
    for (let i = 0; i < Math.min(rows.length, 10); i++) {
      const row = rows[i];

      // Get the text content of the entire row
      const rowText = await row.textContent();

      // Try to find the DID number (usually starts with +1)
      const didMatch = rowText.match(/\+1\d{10}/);
      const didNumber = didMatch ? didMatch[0] : 'Unknown DID';

      // Look for time patterns (e.g., "14 days ago", "Just now", "2h ago")
      const timePatterns = [
        /Just now/i,
        /\d+m ago/i,
        /\d+h ago/i,
        /\d+ days? ago/i,
        /\d+ months? ago/i,
        /\d+ years? ago/i,
        /Today/i,
        /Yesterday/i,
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

      console.log(`  DID ${i+1}: ${didNumber}`);
      console.log(`  Last Used: ${lastUsed}`);

      // Check if it says "14 days ago"
      if (lastUsed === '14 days ago') {
        console.log(`  ⚠️ WARNING: Showing "14 days ago" - likely cached or stale data!`);
      }
      console.log('');
    }

    // Get the actual API response to compare
    console.log('📡 Fetching API data for comparison:\n');

    // Get the auth token from localStorage or cookies
    const token = await page.evaluate(() => {
      return localStorage.getItem('token') || sessionStorage.getItem('token');
    });

    if (token) {
      // Make an API call to get the actual data
      const apiResponse = await page.evaluate(async (authToken) => {
        const response = await fetch('http://localhost:5000/api/v1/dids?limit=5', {
          headers: {
            'Authorization': `Bearer ${authToken}`,
            'Content-Type': 'application/json'
          }
        });
        return response.json();
      }, token);

      console.log('API Response (first 3 DIDs):');
      if (apiResponse.data && apiResponse.data.length > 0) {
        apiResponse.data.slice(0, 3).forEach((did, index) => {
          console.log(`\n  DID ${index + 1}: ${did.number}`);
          console.log(`  lastUsed from API: ${did.lastUsed || did.usage?.lastUsed || 'null'}`);
          if (did.lastUsed || did.usage?.lastUsed) {
            const date = new Date(did.lastUsed || did.usage.lastUsed);
            console.log(`  Parsed date: ${date.toLocaleString()}`);
            const now = new Date();
            const diffMs = now - date;
            const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
            console.log(`  Days ago: ${diffDays}`);
          }
        });
      }
    } else {
      console.log('❌ Could not get auth token for API comparison');
    }

    // Take a screenshot
    await page.screenshot({ path: 'did-management-dates-test.png', fullPage: true });
    console.log('\n📸 Screenshot saved as did-management-dates-test.png');

    // Check browser console for errors
    const consoleErrors = [];
    page.on('console', msg => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });

    if (consoleErrors.length > 0) {
      console.log('\n⚠️ Browser console errors found:');
      consoleErrors.forEach(error => console.log(`  - ${error}`));
    }

  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
    await page.screenshot({ path: 'did-management-error.png', fullPage: true });
    console.log('📸 Error screenshot saved as did-management-error.png');
  } finally {
    await browser.close();
  }
})();