const { chromium } = require('playwright');
const fs = require('fs');

(async () => {
  console.log('🧪 Testing Config Generation with API Key...\n');

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

    // Step 2: Navigate to Settings → VICIdial
    console.log('2️⃣  Navigating to VICIdial settings...');
    await page.goto('https://dids.amdy.io/settings');
    await page.waitForLoadState('networkidle');
    await page.click('button:has-text("VICIdial")');
    await page.waitForTimeout(1000);
    console.log('✅ VICIdial tab loaded\n');

    // Step 3: Check if API Keys exist first
    console.log('3️⃣  Checking for API Keys...');
    await page.goto('https://dids.amdy.io/settings');
    await page.click('button:has-text("API Keys")');
    await page.waitForTimeout(1000);

    const hasApiKeys = await page.locator('.api-key-item, [data-testid="api-key"]').count() > 0;
    console.log(`   📋 Existing API Keys found: ${hasApiKeys ? 'Yes ✅' : 'No ❌'}`);

    if (!hasApiKeys) {
      console.log('   📝 Creating test API key...');
      const hasCreateButton = await page.locator('button:has-text("Create API Key")').count() > 0;
      if (hasCreateButton) {
        await page.click('button:has-text("Create API Key")');
        await page.waitForTimeout(500);
        await page.fill('input[placeholder*="key name"], input[placeholder*="Key Name"]', 'VICIdial Integration Key');
        await page.click('button[type="submit"]:has-text("Create")');
        await page.waitForTimeout(2000);
        console.log('   ✅ Test API key created\n');
      }
    }

    // Step 4: Go back to VICIdial and download config
    console.log('4️⃣  Downloading configuration file...');
    await page.goto('https://dids.amdy.io/settings');
    await page.click('button:has-text("VICIdial")');
    await page.waitForTimeout(1000);

    // Set up download listener
    const downloadPromise = page.waitForEvent('download', { timeout: 10000 });

    // Click download button
    await page.click('button:has-text("Download dids.conf")');

    // Wait for download
    const download = await downloadPromise;
    const downloadPath = '/tmp/dids.conf';
    await download.saveAs(downloadPath);
    console.log(`✅ Downloaded: ${downloadPath}\n`);

    // Step 5: Read and verify config file
    console.log('5️⃣  Verifying configuration file...');
    const configContent = fs.readFileSync(downloadPath, 'utf8');

    // Check for placeholder
    const hasPlaceholder = configContent.includes('YOUR_API_KEY_HERE');
    console.log(`   📋 Has placeholder (should be NO): ${hasPlaceholder ? '❌ YES' : '✅ NO'}`);

    // Check for real API key (starts with did_)
    const hasRealApiKey = configContent.match(/api_key=did_[a-f0-9]{64}/);
    console.log(`   📋 Has real API key (did_...): ${hasRealApiKey ? '✅ YES' : '❌ NO'}`);

    // Extract API key
    const apiKeyMatch = configContent.match(/api_key=(.+)/);
    if (apiKeyMatch) {
      const extractedKey = apiKeyMatch[1].trim();
      console.log(`   📋 Extracted API key: ${extractedKey.substring(0, 12)}... (${extractedKey.length} chars)`);

      if (extractedKey.startsWith('did_')) {
        console.log(`   ✅ API key format valid\n`);
      } else {
        console.log(`   ❌ API key format invalid\n`);
      }
    }

    // Check for other required fields
    const hasApiBaseUrl = configContent.includes('api_base_url=https://dids.amdy.io');
    const hasFallbackDid = configContent.includes('fallback_did=');
    const hasLogFile = configContent.includes('log_file=/var/log/astguiclient/did-optimizer.log');

    console.log('6️⃣  Checking configuration fields...');
    console.log(`   📋 API Base URL: ${hasApiBaseUrl ? '✅' : '❌'}`);
    console.log(`   📋 Fallback DID: ${hasFallbackDid ? '✅' : '❌'}`);
    console.log(`   📋 Log File Path: ${hasLogFile ? '✅' : '❌'}`);

    // Show sample of config
    console.log('\n7️⃣  Configuration file preview:');
    const lines = configContent.split('\n');
    const relevantLines = lines.filter(line =>
      line.includes('api_') || line.includes('fallback_did') || line.includes('log_file')
    ).slice(0, 5);
    console.log('   ───────────────────────────────────────');
    relevantLines.forEach(line => console.log(`   ${line}`));
    console.log('   ───────────────────────────────────────\n');

    // Summary
    const allPassed = !hasPlaceholder && hasRealApiKey && hasApiBaseUrl && hasFallbackDid && hasLogFile;

    if (allPassed) {
      console.log('✅ All tests passed! API key is automatically inserted.\n');
    } else {
      console.log('⚠️  Some tests failed - see details above\n');
    }

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    await page.screenshot({ path: '/home/na/didapi/config-generation-error.png', fullPage: true });
    console.log('📸 Error screenshot saved: config-generation-error.png\n');
    throw error;
  } finally {
    await browser.close();
  }
})();
