const { chromium } = require('playwright');

(async () => {
  console.log('🧪 Testing VICIdial Config Inline Display...\\n');

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
    await page.waitForTimeout(2000); // Wait for config to load
    console.log('✅ VICIdial tab loaded\\n');

    // Step 3: Check page elements
    console.log('3️⃣  Verifying page elements...');

    // Check for Step 1 heading change
    const hasCreateConfigHeading = await page.locator('text=Step 1: Create Configuration File').count() > 0;
    console.log(`   📋 "Create Configuration File" heading: ${hasCreateConfigHeading ? '✅' : '❌'}`);

    // Check that download button is removed
    const hasDownloadButton = await page.locator('button:has-text("Download dids.conf")').count() > 0;
    console.log(`   📋 Download button removed: ${!hasDownloadButton ? '✅' : '❌'}`);

    // Check for config content display
    const hasConfigPre = await page.locator('pre:has-text("# DID Optimizer Pro Configuration")').count() > 0;
    console.log(`   📋 Config content displayed: ${hasConfigPre ? '✅' : '❌'}`);

    // Check for copy button
    const hasCopyButton = await page.locator('button:has-text("Copy")').first().isVisible();
    console.log(`   📋 Copy button present: ${hasCopyButton ? '✅' : '❌'}`);

    // Check for nano instruction
    const hasNanoInstruction = await page.locator('text=nano /etc/asterisk/dids.conf').count() > 0;
    console.log(`   📋 Nano instruction present: ${hasNanoInstruction ? '✅' : '❌'}`);

    // Check that scp instruction is removed
    const hasSCPInstruction = await page.locator('text=/scp dids.conf/').count() > 0;
    console.log(`   📋 SCP instruction removed: ${!hasSCPInstruction ? '✅' : '❌'}\\n`);

    // Step 4: Verify config content
    console.log('4️⃣  Verifying config content...');

    const configText = await page.locator('pre:has-text("# DID Optimizer Pro Configuration")').first().textContent();

    // Check for API key (should start with did_)
    const hasApiKey = configText.includes('api_key=did_');
    console.log(`   📋 API key present (did_...): ${hasApiKey ? '✅' : '❌'}`);

    // Check no placeholder
    const hasPlaceholder = configText.includes('YOUR_API_KEY_HERE');
    console.log(`   📋 No placeholder text: ${!hasPlaceholder ? '✅' : '❌'}`);

    // Check for required fields
    const hasApiBaseUrl = configText.includes('api_base_url=https://dids.amdy.io');
    const hasFallbackDid = configText.includes('fallback_did=');
    const hasLogFile = configText.includes('log_file=/var/log/astguiclient/did-optimizer.log');

    console.log(`   📋 API Base URL: ${hasApiBaseUrl ? '✅' : '❌'}`);
    console.log(`   📋 Fallback DID: ${hasFallbackDid ? '✅' : '❌'}`);
    console.log(`   📋 Log File Path: ${hasLogFile ? '✅' : '❌'}\\n`);

    // Step 5: Test copy button
    console.log('5️⃣  Testing copy button...');
    await page.locator('button:has-text("Copy")').first().click();
    await page.waitForTimeout(500);
    const copyButtonText = await page.locator('button:has-text("Copied!")').first().textContent();
    console.log(`   📋 Copy button feedback: ${copyButtonText.includes('Copied!') ? '✅' : '❌'}\\n`);

    // Step 6: Take screenshot
    console.log('6️⃣  Taking screenshot...');
    await page.screenshot({ path: '/home/na/didapi/vicidial-config-inline.png', fullPage: true });
    console.log('📸 Screenshot saved: vicidial-config-inline.png\\n');

    // Summary
    const allPassed = hasCreateConfigHeading && !hasDownloadButton && hasConfigPre &&
                      hasCopyButton && hasNanoInstruction && !hasSCPInstruction &&
                      hasApiKey && !hasPlaceholder && hasApiBaseUrl && hasFallbackDid && hasLogFile;

    console.log('═══════════════════════════════════════════════════════════');
    if (allPassed) {
      console.log('✅ All tests PASSED!\\n');
      console.log('Summary:');
      console.log('  ✓ Config displayed inline (not downloaded)');
      console.log('  ✓ Copy button working with feedback');
      console.log('  ✓ Nano instructions present');
      console.log('  ✓ SCP instructions removed');
      console.log('  ✓ Real API key inserted');
      console.log('  ✓ All configuration fields present');
    } else {
      console.log('⚠️  Some tests failed - see details above\\n');
    }
    console.log('═══════════════════════════════════════════════════════════\\n');

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    await page.screenshot({ path: '/home/na/didapi/vicidial-config-inline-error.png', fullPage: true });
    console.log('📸 Error screenshot saved: vicidial-config-inline-error.png\\n');
    throw error;
  } finally {
    await browser.close();
  }
})();
