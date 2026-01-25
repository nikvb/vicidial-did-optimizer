const { chromium } = require('playwright');

async function testLocalDIDManagement() {
  console.log('🚀 Testing local DID Management page...');

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  // Monitor console and errors
  page.on('console', msg => {
    console.log(`🖥️  CONSOLE ${msg.type()}: ${msg.text()}`);
  });

  page.on('pageerror', error => {
    console.log(`❌ PAGE ERROR: ${error.message}`);
  });

  const requests = [];
  page.on('request', request => {
    if (request.url().includes('/api/')) {
      requests.push(request.url());
      console.log(`📤 API REQUEST: ${request.method()} ${request.url()}`);
    }
  });

  page.on('response', response => {
    if (response.url().includes('/api/')) {
      console.log(`📥 API RESPONSE: ${response.status()} ${response.url()}`);
      response.text().then(body => {
        if (body && response.url().includes('/dids')) {
          console.log(`📋 DID API RESPONSE BODY: ${body.substring(0, 1000)}`);
        }
      }).catch(err => console.log(`📋 Could not read response body: ${err.message}`));
    }
  });

  try {
    // Navigate to local login
    console.log('📍 Navigating to http://localhost:3000/login');
    await page.goto('http://localhost:3000/login', { waitUntil: 'networkidle' });

    // Fill login form
    console.log('📝 Filling login form');
    await page.fill('input[type="email"]', 'client@test3.com');
    await page.fill('input[type="password"]', 'password123');

    // Submit login
    console.log('🔐 Submitting login form');
    await page.click('button[type="submit"]');
    await page.waitForURL('**/dashboard', { timeout: 10000 });

    console.log('📍 Successfully logged in, navigating to DID Management');

    // Navigate to DID Management page
    await page.click('text=DID Management');
    await page.waitForURL('**/did-management', { timeout: 10000 });

    console.log('📍 On DID Management page, waiting for DIDs to load...');

    // Wait for API calls and data to load
    await page.waitForTimeout(8000);

    // Check if DIDs are loaded
    const didRows = await page.locator('table tbody tr').count();
    console.log(`📊 Number of DID rows found: ${didRows}`);

    // Check for error messages
    const errorMessage = await page.locator('text="Failed to load DIDs"').isVisible();
    console.log(`🚨 Error message visible: ${errorMessage}`);

    // Check for loading state
    const isLoading = await page.locator('text="Loading"').isVisible();
    console.log(`⏳ Loading state visible: ${isLoading}`);

    // Look for phone numbers in the table
    const phoneNumberCells = await page.locator('table tbody tr td:first-child').all();
    const phoneNumbers = [];
    for (const cell of phoneNumberCells) {
      const text = await cell.textContent();
      if (text && text.trim()) phoneNumbers.push(text.trim());
    }
    console.log(`📱 Phone numbers found (first 5): ${phoneNumbers.slice(0, 5).join(', ')}`);

    // Check DID count display
    try {
      const didCountText = await page.locator('text=/\\d+ DIDs?/').textContent();
      console.log(`🔢 DID count display: ${didCountText || 'Not found'}`);
    } catch (e) {
      console.log('🔢 DID count display: Could not find count element');
    }

    // Take screenshot
    await page.screenshot({ path: '/home/na/didapi/test-local-did-management.png' });
    console.log('✅ Screenshot saved: test-local-did-management.png');

    console.log(`📊 Total API requests captured: ${requests.length}`);
    requests.forEach((req, i) => {
      console.log(`  ${i + 1}. ${req}`);
    });

    await browser.close();
    console.log('✅ Local DID Management test completed');

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    await page.screenshot({ path: '/home/na/didapi/test-local-did-management-error.png' });
    console.log('✅ Error screenshot saved: test-local-did-management-error.png');
    await browser.close();
  }
}

testLocalDIDManagement();