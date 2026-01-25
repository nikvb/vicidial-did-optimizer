const { chromium } = require('playwright');

(async () => {
  console.log('🧪 Testing VICIdial Installation Page - Verifying chown removal...\n');

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    // Navigate to installation page
    console.log('📄 Navigating to https://dids.amdy.io/installation/vicidial');
    await page.goto('https://dids.amdy.io/installation/vicidial', { waitUntil: 'networkidle' });

    // Get page content
    const pageContent = await page.content();

    // Check for chown commands
    const chownMatches = pageContent.match(/chown\s+asterisk:asterisk/g);

    if (chownMatches && chownMatches.length > 0) {
      console.log('❌ FAILED: Found chown commands on page:');
      console.log(`   Found ${chownMatches.length} instances of "chown asterisk:asterisk"`);

      // Get text content to see where they are
      const bodyText = await page.evaluate(() => document.body.innerText);
      const lines = bodyText.split('\n');
      lines.forEach((line, idx) => {
        if (line.includes('chown asterisk:asterisk')) {
          console.log(`   Line ${idx}: ${line.trim()}`);
        }
      });
    } else {
      console.log('✅ SUCCESS: No chown commands found on page');
      console.log('   All "chown asterisk:asterisk" commands have been removed');
    }

    // Verify chmod commands are present instead
    const chmod755Count = (pageContent.match(/chmod\s+755/g) || []).length;
    const chmod600Count = (pageContent.match(/chmod\s+600/g) || []).length;

    console.log(`\n📊 Permission commands found:`);
    console.log(`   chmod 755: ${chmod755Count} instances`);
    console.log(`   chmod 600: ${chmod600Count} instances`);

    // Take screenshot
    await page.screenshot({ path: '/tmp/vicidial-installation-no-chown.png', fullPage: true });
    console.log('\n📸 Screenshot saved: /tmp/vicidial-installation-no-chown.png');

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await browser.close();
  }
})();
