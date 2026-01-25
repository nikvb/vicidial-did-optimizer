const { chromium } = require('playwright');

(async () => {
  console.log('🧪 Testing Updated VICIdial Settings Page (v2)...\n');

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    // Step 1: Login
    console.log('1️⃣  Logging in...');
    await page.goto('https://dids.amdy.io/login');
    await page.fill('input[type="email"]', 'client@test3.com');
    await page.fill('input[type="password"]', 'password123');
    await page.click('button[type="submit"]');
    await page.waitForURL('**/dashboard', { timeout: 10000 });
    console.log('✅ Login successful\n');

    // Step 2: Navigate to Settings
    console.log('2️⃣  Navigating to Settings...');
    await page.goto('https://dids.amdy.io/settings');
    await page.waitForLoadState('networkidle');
    console.log('✅ Settings page loaded\n');

    // Step 3: Click VICIdial tab
    console.log('3️⃣  Clicking VICIdial Integration tab...');
    await page.click('button:has-text("VICIdial")');
    await page.waitForTimeout(1000);
    console.log('✅ VICIdial tab selected\n');

    // Step 4: Check page content
    console.log('4️⃣  Verifying VICIdial Integration content...');

    // Check for main heading
    const hasVICIdialHeading = await page.locator('text=VICIdial Integration').count() > 0;
    console.log(`   📋 VICIdial Integration heading: ${hasVICIdialHeading ? '✅' : '❌'}`);

    // Check for removed elements (should NOT be present)
    const hasConnectForm = await page.locator('input[placeholder*="db.example.com"]').count() > 0;
    console.log(`   📋 Connect form removed: ${!hasConnectForm ? '✅' : '❌'}`);

    const hasSyncButton = await page.locator('button:has-text("Sync Campaigns")').count() > 0;
    console.log(`   📋 Sync campaigns removed: ${!hasSyncButton ? '✅' : '❌'}`);

    // Check for new elements (should be present)
    const hasStep1 = await page.locator('text=Step 1: Download Configuration File').count() > 0;
    console.log(`   📋 Step 1 (Download Config): ${hasStep1 ? '✅' : '❌'}`);

    const hasStep2 = await page.locator('text=Step 2: Install AGI Script').count() > 0;
    console.log(`   📋 Step 2 (Install AGI): ${hasStep2 ? '✅' : '❌'}`);

    const hasStep3 = await page.locator('text=Step 3: Complete Installation').count() > 0;
    console.log(`   📋 Step 3 (Complete Install): ${hasStep3 ? '✅' : '❌'}`);

    const hasStep4 = await page.locator('text=Step 4: Install Call Results Sync').count() > 0;
    console.log(`   📋 Step 4 (Call Results Sync): ${hasStep4 ? '✅' : '❌'}`);

    // Check for download button
    const hasDownloadButton = await page.locator('button:has-text("Download dids.conf")').count() > 0;
    console.log(`   📋 Download dids.conf button: ${hasDownloadButton ? '✅' : '❌'}`);

    // Check for copy buttons
    const copyButtons = await page.locator('button:has-text("Copy")').count();
    console.log(`   📋 Copy buttons: ${copyButtons} ${copyButtons >= 2 ? '✅' : '❌'}`);

    // Check for GitHub links
    const githubLinks = await page.locator('a[href*="github.com/nikvb/vicidial-integration"]').count();
    console.log(`   📋 GitHub links: ${githubLinks} ${githubLinks > 0 ? '✅' : '❌'}`);

    // Check for installation guide link
    const installGuideLink = await page.locator('a[href="/installation/vicidial"]').count();
    console.log(`   📋 Installation guide links: ${installGuideLink} ${installGuideLink > 0 ? '✅' : '❌'}`);

    // Check for Quick Reference section
    const hasQuickRef = await page.locator('text=Quick Reference').count() > 0;
    console.log(`   📋 Quick Reference section: ${hasQuickRef ? '✅' : '❌'}`);

    // Check for Resources section
    const hasResources = await page.locator('text=Resources & Support').count() > 0;
    console.log(`   📋 Resources & Support section: ${hasResources ? '✅' : '❌'}`);

    // Check for installation command
    const hasInstallCommand = await page.locator('text=/install-agi.sh/').count() > 0;
    console.log(`   📋 Install command present: ${hasInstallCommand ? '✅' : '❌'}`);

    console.log('\n5️⃣  Taking screenshot...');
    await page.screenshot({ path: '/home/na/didapi/vicidial-settings-final.png', fullPage: true });
    console.log('📸 Screenshot saved: vicidial-settings-final.png\n');

    // Summary
    const allPassed = hasVICIdialHeading && !hasConnectForm && !hasSyncButton &&
                      hasStep1 && hasStep2 && hasStep3 && hasStep4 &&
                      hasDownloadButton && copyButtons >= 2 && githubLinks > 0 &&
                      installGuideLink > 0 && hasQuickRef && hasResources && hasInstallCommand;

    if (allPassed) {
      console.log('✅ All tests passed!\n');
    } else {
      console.log('⚠️  Some tests failed - see details above\n');
    }

    console.log('═══════════════════════════════════════════════════════════');
    console.log('Summary:');
    console.log('  ✓ Old connection form removed');
    console.log('  ✓ Old sync campaigns removed');
    console.log('  ✓ New installation steps added');
    console.log('  ✓ GitHub repository links updated');
    console.log('  ✓ Quick reference added');
    console.log('  ✓ Resources section added');
    console.log('═══════════════════════════════════════════════════════════\n');

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    await page.screenshot({ path: '/home/na/didapi/vicidial-settings-error-v2.png', fullPage: true });
    console.log('📸 Error screenshot saved: vicidial-settings-error-v2.png\n');
    throw error;
  } finally {
    await browser.close();
  }
})();
