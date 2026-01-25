const { chromium } = require('playwright');

(async () => {
  console.log('🧪 Testing wget commands - Verifying -O flag for force overwrite...\n');

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    // Login
    console.log('🔐 Logging in...');
    await page.goto('https://dids.amdy.io/login', { waitUntil: 'networkidle' });
    await page.fill('input[type="email"]', 'client@test3.com');
    await page.fill('input[type="password"]', 'password123');
    await page.click('button[type="submit"]');
    await page.waitForURL('**/dashboard', { timeout: 10000 });
    console.log('✅ Logged in\n');

    // Test 1: VICIdial Integration Settings Page
    console.log('📄 Testing Settings → VICIdial Integration...');
    await page.goto('https://dids.amdy.io/settings?tab=vicidial', { waitUntil: 'networkidle' });

    const settingsWgetCommands = await page.evaluate(() => {
      const codeBlocks = Array.from(document.querySelectorAll('code, pre'));
      return codeBlocks
        .map(el => el.textContent)
        .filter(text => text.includes('wget'));
    });

    console.log(`Found ${settingsWgetCommands.length} wget commands:\n`);
    settingsWgetCommands.forEach((cmd, idx) => {
      const hasForceFlag = cmd.includes('wget -O');
      console.log(`${idx + 1}. ${hasForceFlag ? '✅' : '❌'} ${cmd.substring(0, 80)}...`);
    });

    // Test 2: Installation Page
    console.log('\n📄 Testing Installation Page...');
    await page.goto('https://dids.amdy.io/installation/vicidial', { waitUntil: 'networkidle' });

    const installWgetCommands = await page.evaluate(() => {
      const codeBlocks = Array.from(document.querySelectorAll('code, pre'));
      return codeBlocks
        .map(el => el.textContent)
        .filter(text => text.includes('wget'));
    });

    console.log(`\nFound ${installWgetCommands.length} wget commands:\n`);
    installWgetCommands.forEach((cmd, idx) => {
      const hasForceFlag = cmd.includes('wget -O');
      console.log(`${idx + 1}. ${hasForceFlag ? '✅' : '❌'} ${cmd.substring(0, 80)}...`);
    });

    // Summary
    const allWgetCommands = [...settingsWgetCommands, ...installWgetCommands];
    const forceFlagCount = allWgetCommands.filter(cmd => cmd.includes('wget -O')).length;
    const totalWgetCount = allWgetCommands.length;

    console.log('\n📊 Summary:');
    console.log(`Total wget commands: ${totalWgetCount}`);
    console.log(`With -O flag (force overwrite): ${forceFlagCount}`);
    console.log(`Without -O flag: ${totalWgetCount - forceFlagCount}`);

    if (forceFlagCount === totalWgetCount && totalWgetCount > 0) {
      console.log('\n✅ SUCCESS: All wget commands use -O flag for force overwrite!');
    } else {
      console.log('\n❌ FAILED: Some wget commands missing -O flag');
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await browser.close();
  }
})();
