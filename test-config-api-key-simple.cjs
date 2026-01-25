const { chromium } = require('playwright');
const fs = require('fs');

(async () => {
  console.log('🧪 Testing API Key Auto-Insertion in dids.conf...\\n');

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
    await page.waitForTimeout(1000);
    console.log('✅ VICIdial tab loaded\\n');

    // Step 3: Download dids.conf
    console.log('3️⃣  Downloading dids.conf...');

    // Set up download listener
    const downloadPromise = page.waitForEvent('download', { timeout: 10000 });

    // Click download button
    await page.click('button:has-text("Download dids.conf")');

    // Wait for download
    const download = await downloadPromise;
    const downloadPath = '/tmp/dids-test.conf';
    await download.saveAs(downloadPath);
    console.log(`✅ Downloaded to: ${downloadPath}\\n`);

    // Step 4: Read and verify config file
    console.log('4️⃣  Verifying configuration file...\\n');
    const configContent = fs.readFileSync(downloadPath, 'utf8');

    // Check for placeholder (should NOT exist)
    const hasPlaceholder = configContent.includes('YOUR_API_KEY_HERE');
    console.log(`   📋 Has placeholder "YOUR_API_KEY_HERE": ${hasPlaceholder ? '❌ FAIL' : '✅ PASS (not found)'}`);

    // Check for real API key (should exist and start with did_)
    const apiKeyMatch = configContent.match(/api_key=(did_[a-f0-9]{64})/);
    console.log(`   📋 Has real API key (did_...): ${apiKeyMatch ? '✅ PASS' : '❌ FAIL'}`);

    if (apiKeyMatch) {
      const extractedKey = apiKeyMatch[1];
      console.log(`   📋 Extracted API key: ${extractedKey.substring(0, 20)}... (${extractedKey.length} chars)`);
      console.log(`   📋 Key format valid (starts with did_): ${extractedKey.startsWith('did_') ? '✅ PASS' : '❌ FAIL'}`);
      console.log(`   📋 Key length valid (68 chars): ${extractedKey.length === 68 ? '✅ PASS' : '❌ FAIL'}\\n`);
    } else {
      console.log('   ❌ Could not extract API key from config\\n');
    }

    // Check other required fields
    console.log('5️⃣  Checking other configuration fields...');
    const hasApiBaseUrl = configContent.includes('api_base_url=https://dids.amdy.io');
    const hasFallbackDid = configContent.includes('fallback_did=');
    const hasLogFile = configContent.includes('log_file=/var/log/astguiclient/did-optimizer.log');

    console.log(`   📋 API Base URL: ${hasApiBaseUrl ? '✅' : '❌'}`);
    console.log(`   📋 Fallback DID: ${hasFallbackDid ? '✅' : '❌'}`);
    console.log(`   📋 Log File Path: ${hasLogFile ? '✅' : '❌'}\\n`);

    // Show preview of config
    console.log('6️⃣  Configuration file preview:');
    const lines = configContent.split('\\n');
    const relevantLines = lines.filter(line =>
      line.includes('api_') || line.includes('fallback_did') || line.includes('log_file')
    ).slice(0, 6);
    console.log('   ───────────────────────────────────────');
    relevantLines.forEach(line => console.log(`   ${line}`));
    console.log('   ───────────────────────────────────────\\n');

    // Final summary
    const allPassed = !hasPlaceholder && apiKeyMatch && hasApiBaseUrl && hasFallbackDid && hasLogFile;

    console.log('═══════════════════════════════════════════════════════════');
    if (allPassed) {
      console.log('✅ All tests PASSED! API key is automatically inserted.\\n');
      console.log('Summary:');
      console.log('  ✓ Real API key inserted (starts with did_)');
      console.log('  ✓ No placeholder text found');
      console.log('  ✓ All configuration fields present');
      console.log('  ✓ Config file ready for VICIdial installation');
    } else {
      console.log('⚠️  Some tests FAILED - see details above\\n');
      if (hasPlaceholder) console.log('  ✗ Placeholder text still present');
      if (!apiKeyMatch) console.log('  ✗ Real API key not found');
      if (!hasApiBaseUrl) console.log('  ✗ API base URL missing');
      if (!hasFallbackDid) console.log('  ✗ Fallback DID missing');
      if (!hasLogFile) console.log('  ✗ Log file path missing');
    }
    console.log('═══════════════════════════════════════════════════════════\\n');

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    await page.screenshot({ path: '/home/na/didapi/config-api-key-error.png', fullPage: true });
    console.log('📸 Error screenshot saved: config-api-key-error.png\\n');
    throw error;
  } finally {
    await browser.close();
  }
})();
