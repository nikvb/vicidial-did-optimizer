const { chromium } = require('playwright');

async function testRegistrationFlow() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  // Capture console logs
  page.on('console', msg => {
    if (msg.type() === 'log' || msg.type() === 'error') {
      console.log('Browser:', msg.text());
    }
  });

  // Capture network requests
  page.on('request', request => {
    if (request.url().includes('/api/')) {
      const auth = request.headers()['authorization'];
      console.log(`API Request: ${request.method()} ${request.url()}`);
      console.log(`  Auth header: ${auth ? auth.substring(0, 30) + '...' : 'NONE'}`);
    }
  });

  page.on('response', response => {
    if (response.url().includes('/api/')) {
      console.log(`API Response: ${response.status()} ${response.url()}`);
    }
  });

  try {
    const timestamp = Date.now();
    const email = `testuser${timestamp}@example.com`;

    console.log('1. Navigating to register page...');
    await page.goto('https://dids.amdy.io/register', { waitUntil: 'networkidle' });

    console.log('2. Filling registration form...');
    await page.fill('input[name="firstName"]', 'TestFirst');
    await page.fill('input[name="lastName"]', 'TestLast');
    await page.fill('input[name="email"]', email);
    await page.fill('input[name="password"]', 'password123');
    await page.fill('input[name="confirmPassword"]', 'password123');
    await page.check('input[name="agreeTerms"]');

    console.log('3. Submitting registration...');
    await page.click('button[type="submit"]');

    // Wait for redirect to dashboard
    await page.waitForURL('**/dashboard**', { timeout: 15000 });
    console.log('4. Redirected to dashboard');

    // Check localStorage
    const token = await page.evaluate(() => localStorage.getItem('token'));
    const user = await page.evaluate(() => localStorage.getItem('user'));
    console.log('5. localStorage token:', token ? token.substring(0, 30) + '...' : 'NONE');
    console.log('5. localStorage user:', user ? JSON.parse(user).email : 'NONE');

    // Wait for dashboard to load
    await page.waitForTimeout(3000);

    // Check for errors
    const bodyText = await page.textContent('body');
    if (bodyText.includes('Access token required') || bodyText.includes('Unauthorized')) {
      console.log('6. ❌ ERROR: Auth error found on dashboard');
    } else {
      console.log('6. ✅ No auth errors on dashboard');
    }

    // Take screenshot
    await page.screenshot({ path: '/home/na/didapi/registration-flow-test.png', fullPage: true });
    console.log('7. Screenshot saved');

  } catch (error) {
    console.error('Test error:', error.message);
    await page.screenshot({ path: '/home/na/didapi/registration-flow-error.png', fullPage: true });
  } finally {
    await browser.close();
  }
}

testRegistrationFlow();
