const { chromium } = require('playwright');

(async () => {
  console.log('🧪 Testing Destination Area Code Analytics\n');

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  // Capture console messages
  page.on('console', msg => {
    if (msg.type() === 'error') {
      console.log('🔴 Browser Error:', msg.text());
    }
  });

  // Monitor API responses
  page.on('response', async response => {
    if (response.url().includes('/api/v1/analytics/capacity')) {
      console.log(`📡 Capacity API: ${response.status()}`);

      if (response.status() === 200) {
        try {
          const data = await response.json();
          console.log('\n📊 API Response Data:');
          console.log(`  - Total DIDs: ${data.data?.summary?.totalDIDs || 0}`);
          console.log(`  - Overall Utilization: ${data.data?.summary?.overallUtilization || 0}%`);
          console.log(`  - Area Code Stats: ${data.data?.areaCodeStats?.length || 0} entries`);
          console.log(`  - Destination Stats: ${data.data?.destinationStats?.length || 0} entries`);
          console.log(`  - Recommendations: ${data.data?.recommendations?.length || 0} total`);

          if (data.data?.destinationStats && data.data.destinationStats.length > 0) {
            console.log('\n📍 Destination Area Codes (Customer Locations):');
            data.data.destinationStats.forEach((dest, i) => {
              const status = !dest.hasDIDs ? 'NO LOCAL PRESENCE' :
                           dest.needsMore ? 'NEEDS MORE' : 'COVERED';
              console.log(`  ${i + 1}. ${dest.areaCode} (${dest.state}): ${dest.callCount} customer calls, ${dest.currentDIDCount} DIDs - ${status}`);
            });
          }

          if (data.data?.recommendations && data.data.recommendations.length > 0) {
            console.log('\n💡 Recommendations:');
            data.data.recommendations.forEach((rec, i) => {
              if (rec.type === 'destination') {
                console.log(`  ${i + 1}. [DESTINATION] ${rec.areaCode} (${rec.state}): Buy ${rec.suggestedDIDs} DIDs - ${rec.reason}`);
              } else if (rec.type === 'capacity') {
                console.log(`  ${i + 1}. [CAPACITY] ${rec.areaCode}: Buy ${rec.suggestedDIDs} DIDs - ${rec.reason}`);
              } else {
                console.log(`  ${i + 1}. [${rec.type}] ${rec.message || rec.reason}`);
              }
            });
          }
        } catch (e) {
          console.log('⚠️  Could not parse API response:', e.message);
        }
      }
    }
  });

  try {
    // Login
    console.log('🔐 Logging in...');
    await page.goto('https://dids.amdy.io/login', { waitUntil: 'networkidle', timeout: 30000 });
    await page.fill('input[type="email"]', 'client@test3.com');
    await page.fill('input[type="password"]', 'password123');
    await page.click('button[type="submit"]');
    await page.waitForTimeout(3000);

    // Navigate to Analytics
    console.log('📊 Navigating to Analytics page...');
    await page.goto('https://dids.amdy.io/analytics', { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(5000);

    // Check for page elements
    console.log('\n✅ Verifying Page Elements:');

    const hasCapacitySection = await page.locator('text=/DID Capacity by Area Code/i').count() > 0;
    console.log(`  - DID Capacity section: ${hasCapacitySection ? '✅ Found' : '❌ Not found'}`);

    const hasDestinationSection = await page.locator('text=/Customer Distribution by Area Code/i').count() > 0;
    console.log(`  - Customer Distribution section: ${hasDestinationSection ? '✅ Found' : '❌ Not found'}`);

    const hasRecommendations = await page.locator('text=/Purchase Recommendations/i').count() > 0;
    console.log(`  - Purchase Recommendations: ${hasRecommendations ? '✅ Found' : '❌ Not found'}`);

    // Count table rows
    const didCapacityRows = await page.locator('text=/DID Capacity by Area Code/i').locator('..').locator('..').locator('tbody tr').count();
    console.log(`  - DID Capacity table rows: ${didCapacityRows}`);

    const destinationRows = await page.locator('text=/Customer Distribution by Area Code/i').locator('..').locator('..').locator('tbody tr').count();
    console.log(`  - Customer Distribution table rows: ${destinationRows}`);

    // Take screenshots
    console.log('\n📸 Capturing screenshots...');
    await page.screenshot({
      path: 'test-destination-analytics.png',
      fullPage: true
    });
    console.log('  - Full page: test-destination-analytics.png');

    // Scroll to destination section if it exists
    if (hasDestinationSection) {
      await page.locator('text=/Customer Distribution by Area Code/i').scrollIntoViewIfNeeded();
      await page.waitForTimeout(1000);
      await page.screenshot({
        path: 'test-destination-analytics-focused.png',
        fullPage: false
      });
      console.log('  - Destination section: test-destination-analytics-focused.png');
    }

    console.log('\n✅ Test completed successfully!');

  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
    await page.screenshot({ path: 'test-destination-analytics-error.png', fullPage: true });
    console.log('  - Error screenshot: test-destination-analytics-error.png');
  } finally {
    await browser.close();
  }
})();
