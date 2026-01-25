const { chromium } = require('playwright');

async function testWelcomeName() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    console.log('1. Navigating to login page...');
    await page.goto('https://dids.amdy.io/login', { waitUntil: 'networkidle' });

    console.log('2. Logging in as test6@newdomain123.com...');
    await page.fill('input[type="email"]', 'test6@newdomain123.com');
    await page.fill('input[type="password"]', 'password123');
    await page.click('button[type="submit"]');

    await page.waitForURL('**/dashboard**', { timeout: 10000 });
    console.log('3. Logged in successfully');

    // Wait for page to load
    await page.waitForTimeout(2000);

    // Check welcome message
    const welcomeText = await page.textContent('h1, h2, .text-3xl');
    console.log('4. Welcome message:', welcomeText);

    if (welcomeText && welcomeText.includes('Test')) {
      console.log('   ✅ firstName "Test" is displayed correctly!');
    } else if (welcomeText && welcomeText.includes('!')) {
      console.log('   ❌ firstName is still missing');
    }

    // Take screenshot
    await page.screenshot({ path: '/home/na/didapi/welcome-name-test.png', fullPage: true });
    console.log('5. Screenshot saved: welcome-name-test.png');

  } catch (error) {
    console.error('Test error:', error.message);
    await page.screenshot({ path: '/home/na/didapi/welcome-name-error.png', fullPage: true });
  } finally {
    await browser.close();
  }
}

testWelcomeName();
