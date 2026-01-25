const { chromium } = require('playwright');

(async () => {
  console.log('🧪 Testing VICIdial Installation Page - Structure verification...\n');

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    await page.goto('https://dids.amdy.io/installation/vicidial', { waitUntil: 'networkidle' });

    // Get page title
    const title = await page.title();
    console.log('📄 Page Title:', title);

    // Check for main heading
    const mainHeading = await page.textContent('h1, h2').catch(() => null);
    console.log('📋 Main Heading:', mainHeading);

    // Get all code blocks
    const codeBlocks = await page.evaluate(() => {
      const codes = Array.from(document.querySelectorAll('code'));
      return codes.map((code, idx) => ({
        index: idx,
        text: code.textContent.substring(0, 100) + (code.textContent.length > 100 ? '...' : ''),
        hasChown: code.textContent.includes('chown')
      }));
    });

    console.log(`\n📊 Found ${codeBlocks.length} code blocks`);

    let totalChown = 0;
    codeBlocks.forEach(block => {
      if (block.hasChown) {
        totalChown++;
        console.log(`❌ Block ${block.index} contains chown:`);
        console.log(`   ${block.text}`);
      }
    });

    if (totalChown === 0) {
      console.log('✅ No code blocks contain chown commands');
    } else {
      console.log(`\n❌ Found ${totalChown} code blocks with chown commands`);
    }

    // Check for chmod commands
    const chmodBlocks = codeBlocks.filter(b => b.text.includes('chmod'));
    console.log(`\n✅ Found ${chmodBlocks.length} code blocks with chmod commands`);

    // Get all visible text
    const bodyText = await page.evaluate(() => document.body.innerText);
    const hasChownInText = bodyText.includes('chown asterisk');

    console.log(`\n🔍 Full page text search:`);
    console.log(`   Contains "chown asterisk": ${hasChownInText ? '❌ YES' : '✅ NO'}`);

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await browser.close();
  }
})();
