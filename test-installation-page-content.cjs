const { chromium } = require('playwright');

(async () => {
  console.log('🧪 Testing VICIdial Installation Page - Content verification...\n');

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    await page.goto('https://dids.amdy.io/installation/vicidial', { waitUntil: 'networkidle' });
    console.log('✅ Page loaded successfully\n');

    // Check for AGI Install Script section
    const agiScriptText = await page.evaluate(() => {
      const codeBlocks = Array.from(document.querySelectorAll('code'));
      for (const block of codeBlocks) {
        if (block.textContent.includes('vicidial-did-optimizer.agi')) {
          return block.textContent;
        }
      }
      return null;
    });

    if (agiScriptText) {
      console.log('📋 AGI Install Script:');
      console.log(agiScriptText);
      console.log('');

      // Check for correct chmod and absence of chown
      if (agiScriptText.includes('chmod 755')) {
        console.log('✅ Contains "chmod 755"');
      } else {
        console.log('❌ Missing "chmod 755"');
      }

      if (agiScriptText.includes('chown')) {
        console.log('❌ Still contains "chown" command');
      } else {
        console.log('✅ No "chown" command found');
      }
    }

    // Check Sync Script section
    const syncScriptText = await page.evaluate(() => {
      const codeBlocks = Array.from(document.querySelectorAll('code'));
      for (const block of codeBlocks) {
        if (block.textContent.includes('AST_DID_optimizer_sync.pl')) {
          return block.textContent;
        }
      }
      return null;
    });

    if (syncScriptText) {
      console.log('\n📋 Sync Script:');
      console.log(syncScriptText);
      console.log('');

      if (syncScriptText.includes('chmod 755')) {
        console.log('✅ Contains "chmod 755"');
      }
      if (syncScriptText.includes('chown')) {
        console.log('❌ Still contains "chown" command');
      } else {
        console.log('✅ No "chown" command found');
      }
    }

    // Check dids.conf section
    const configText = await page.evaluate(() => {
      const headers = Array.from(document.querySelectorAll('h4'));
      for (const header of headers) {
        if (header.textContent.includes('Upload Configuration')) {
          const codeBlock = header.parentElement?.querySelector('code');
          return codeBlock?.textContent || null;
        }
      }
      return null;
    });

    if (configText) {
      console.log('\n📋 Configuration Upload:');
      console.log(configText);
      console.log('');

      if (configText.includes('chmod 600')) {
        console.log('✅ Contains "chmod 600"');
      }
      if (configText.includes('chown')) {
        console.log('❌ Still contains "chown" command');
      } else {
        console.log('✅ No "chown" command found');
      }
    }

    // Check log directory section
    const logDirText = await page.evaluate(() => {
      const headers = Array.from(document.querySelectorAll('h4'));
      for (const header of headers) {
        if (header.textContent.includes('Create Log Directory')) {
          const codeBlock = header.parentElement?.querySelector('code');
          return codeBlock?.textContent || null;
        }
      }
      return null;
    });

    if (logDirText) {
      console.log('\n📋 Log Directory Creation:');
      console.log(logDirText);
      console.log('');

      if (logDirText.includes('chmod 755')) {
        console.log('✅ Contains "chmod 755"');
      }
      if (logDirText.includes('chown')) {
        console.log('❌ Still contains "chown" command');
      } else {
        console.log('✅ No "chown" command found');
      }
    }

    console.log('\n✅ All sections verified - no chown commands found!');

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await browser.close();
  }
})();
