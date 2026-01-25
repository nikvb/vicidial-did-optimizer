const { chromium } = require('playwright');

(async () => {
  console.log('🧪 Testing VICIdial Dialplan Instructions Update...\\n');

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
    console.log('✅ Login successful\\n');

    // Step 2: Navigate to VICIdial settings
    console.log('2️⃣  Navigating to VICIdial settings...');
    await page.goto('https://dids.amdy.io/settings');
    await page.waitForLoadState('networkidle');
    await page.click('button:has-text("VICIdial")');
    await page.waitForTimeout(2000);
    console.log('✅ VICIdial tab loaded\\n');

    // Step 3: Check for correct instructions
    console.log('3️⃣  Verifying dialplan instructions...');

    const hasStep3 = await page.locator('text=Step 3: Configure Dialplan in VICIdial Admin').count() > 0;
    console.log(`   📋 Step 3 (Configure Dialplan): ${hasStep3 ? '✅' : '❌'}`);

    const hasAdminCarriers = await page.locator('text=Admin → Carriers').count() > 0;
    console.log(`   📋 "Admin → Carriers" instruction: ${hasAdminCarriers ? '✅' : '❌'}`);

    const hasDialplanEntry = await page.locator('text=Dialplan Entry').count() > 0;
    console.log(`   📋 "Dialplan Entry" mentioned: ${hasDialplanEntry ? '✅' : '❌'}`);

    const hasAGICommand = await page.locator('text=/AGI\\(vicidial-did-optimizer\\.agi\\)/').count() > 0;
    console.log(`   📋 AGI command present: ${hasAGICommand ? '✅' : '❌'}`);

    const hasDoNotEdit = await page.locator('text=/Do NOT edit.*extensions\\.conf/i').count() > 0;
    console.log(`   📋 Warning about extensions.conf: ${hasDoNotEdit ? '✅' : '❌'}`);

    const hasChownCommand = await page.locator('text=/chown asterisk/').count() > 0;
    console.log(`   📋 No chown asterisk command: ${!hasChownCommand ? '✅' : '❌ (should be removed)'}`);

    const hasRootNote = await page.locator('text=/VICIdial runs as root/i').count() > 0;
    console.log(`   📋 Root note present: ${hasRootNote ? '✅' : '❌'}\\n`);

    // Step 4: Check step numbers
    const hasStep4 = await page.locator('text=Step 4: Verify').count() > 0;
    console.log('4️⃣  Verifying step numbers...');
    console.log(`   📋 Step 4 (Verify & Troubleshoot): ${hasStep4 ? '✅' : '❌'}`);

    const hasStep5 = await page.locator('text=Step 5: Install Call Results Sync').count() > 0;
    console.log(`   📋 Step 5 (Call Results Sync): ${hasStep5 ? '✅' : '❌'}\\n`);

    // Step 5: Take screenshot
    console.log('5️⃣  Taking screenshot...');
    await page.screenshot({ path: '/home/na/didapi/vicidial-dialplan-update.png', fullPage: true });
    console.log('📸 Screenshot saved: vicidial-dialplan-update.png\\n');

    // Summary
    const allPassed = hasStep3 && hasAdminCarriers && hasDialplanEntry &&
                      hasAGICommand && hasDoNotEdit && !hasChownCommand &&
                      hasRootNote && hasStep4 && hasStep5;

    console.log('═══════════════════════════════════════════════════════════');
    if (allPassed) {
      console.log('✅ All tests PASSED!\\n');
      console.log('Summary:');
      console.log('  ✓ Step 3: Configure Dialplan in VICIdial Admin');
      console.log('  ✓ Correct instructions for Admin → Carriers');
      console.log('  ✓ Warning about NOT editing extensions.conf');
      console.log('  ✓ chown command removed');
      console.log('  ✓ VICIdial runs as root note added');
      console.log('  ✓ Steps renumbered correctly (3, 4, 5)');
    } else {
      console.log('⚠️  Some tests failed - see details above\\n');
    }
    console.log('═══════════════════════════════════════════════════════════\\n');

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    await page.screenshot({ path: '/home/na/didapi/vicidial-dialplan-error.png', fullPage: true });
    console.log('📸 Error screenshot saved: vicidial-dialplan-error.png\\n');
    throw error;
  } finally {
    await browser.close();
  }
})();
