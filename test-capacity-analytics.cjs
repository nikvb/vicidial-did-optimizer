const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  // Capture console logs
  page.on('console', msg => {
    if (msg.type() === 'error') {
      console.log('🔴 Browser Error:', msg.text());
    }
  });

  // Capture network requests
  page.on('response', async response => {
    if (response.url().includes('/api/v1/analytics')) {
      console.log(`📡 API ${response.status()}: ${response.url()}`);
      if (!response.ok()) {
        try {
          const text = await response.text();
          console.log(`  Response: ${text}`);
        } catch(e) {}
      }
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

    console.log('📊 Navigating to Analytics page...');
    await page.goto('https://dids.amdy.io/analytics');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(5000); // Wait for all API calls

    console.log('📸 Taking screenshot...');
    await page.screenshot({ path: 'test-capacity-analytics.png', fullPage: true });

    // Check for capacity section
    const capacitySection = await page.locator('text=/Capacity Planning/i');
    const hasCapacitySection = await capacitySection.count() > 0;

    console.log('\n📋 Analytics Page Analysis:');
    console.log(`  ✓ Capacity Planning section: ${hasCapacitySection ? '✅ Found' : '❌ Not found'}`);

    // Check for warnings
    const warningBadge = await page.locator('text=/Critical|Warning/i');
    const hasWarnings = await warningBadge.count() > 0;
    console.log(`  ✓ Capacity warnings: ${hasWarnings ? '✅ Displayed' : 'ℹ️  None'}`);

    // Check for recommendations
    const recommendations = await page.locator('text=/Purchase Recommendations/i');
    const hasRecommendations = await recommendations.count() > 0;
    console.log(`  ✓ Purchase recommendations: ${hasRecommendations ? '✅ Displayed' : 'ℹ️  None'}`);

    // Check for area code table
    const areaCodeTable = await page.locator('text=/Top Area Codes/i');
    const hasAreaCodeTable = await areaCodeTable.count() > 0;
    console.log(`  ✓ Area code traffic table: ${hasAreaCodeTable ? '✅ Displayed' : '❌ Not found'}`);

    // Get page content to check for specific metrics
    const content = await page.content();

    console.log('\n📊 Metrics Check:');
    console.log(`  ✓ System capacity overview: ${content.includes('System Capacity Overview') ? '✅' : '❌'}`);
    console.log(`  ✓ Total DIDs metric: ${content.includes('Total DIDs') ? '✅' : '❌'}`);
    console.log(`  ✓ Utilization percentage: ${content.includes('Utilization') ? '✅' : '❌'}`);

    console.log('\n✅ Test completed successfully!');
    console.log('📷 Screenshot saved to: test-capacity-analytics.png');

  } catch (error) {
    console.error('❌ Test failed:', error);
    await page.screenshot({ path: 'test-capacity-analytics-error.png', fullPage: true });
  } finally {
    await browser.close();
  }
})();
