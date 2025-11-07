const { chromium } = require('playwright');

async function testPorts() {
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  try {
    const context = await browser.newContext({
      ignoreHTTPSErrors: true,
      viewport: { width: 1920, height: 1080 }
    });

    // Test Port 5000
    console.log('\n=== Testing Port 5000 (API Server) ===');
    const page5000 = await context.newPage();

    try {
      await page5000.goto('http://api3.amdy.io:5000', {
        waitUntil: 'networkidle',
        timeout: 30000
      });

      // Take screenshot
      await page5000.screenshot({ path: 'port-5000-ui.png', fullPage: true });
      console.log('Screenshot saved: port-5000-ui.png');

      // Check page title and content
      const title = await page5000.title();
      console.log(`Page Title: ${title}`);

      // Check if it's the React app
      const hasReactRoot = await page5000.locator('#root').count();
      console.log(`Has React root element: ${hasReactRoot > 0}`);

      // Check for specific UI elements
      const hasLoginButton = await page5000.locator('text=/Sign in|Log in|Get Started/i').count();
      console.log(`Has login/signup elements: ${hasLoginButton > 0}`);

      // Get page URL after any redirects
      const finalUrl = page5000.url();
      console.log(`Final URL: ${finalUrl}`);

      // Check for API endpoints by looking at network requests
      const [apiResponse] = await Promise.all([
        page5000.waitForResponse(response =>
          response.url().includes('/api/') && response.status() === 200,
          { timeout: 5000 }
        ).catch(() => null),
        page5000.reload()
      ]);

      if (apiResponse) {
        console.log(`Found API endpoint: ${apiResponse.url()}`);
      }

    } catch (error) {
      console.log(`Error accessing port 5000: ${error.message}`);

      // Try to access API health endpoint directly
      console.log('\nTrying API health endpoint...');
      const apiPage = await context.newPage();
      const healthResponse = await apiPage.goto('http://api3.amdy.io:5000/api/v1/health', {
        waitUntil: 'domcontentloaded'
      });

      if (healthResponse) {
        const healthData = await apiPage.content();
        console.log('Health endpoint response:', healthData);
      }
    }

    // Test Port 3000 for comparison
    console.log('\n=== Testing Port 3000 (React Dev Server) ===');
    const page3000 = await context.newPage();

    try {
      await page3000.goto('http://api3.amdy.io:3000', {
        waitUntil: 'networkidle',
        timeout: 30000
      });

      // Take screenshot
      await page3000.screenshot({ path: 'port-3000-ui.png', fullPage: true });
      console.log('Screenshot saved: port-3000-ui.png');

      // Check page title and content
      const title = await page3000.title();
      console.log(`Page Title: ${title}`);

      // Check if it's the React app
      const hasReactRoot = await page3000.locator('#root').count();
      console.log(`Has React root element: ${hasReactRoot > 0}`);

      // Get page URL after any redirects
      const finalUrl = page3000.url();
      console.log(`Final URL: ${finalUrl}`);

    } catch (error) {
      console.log(`Error accessing port 3000: ${error.message}`);
    }

    // Check what static files are being served from port 5000
    console.log('\n=== Checking Static File Serving on Port 5000 ===');
    const staticPage = await context.newPage();

    // Try to access common static file paths
    const staticPaths = [
      '/static/js/main.js',
      '/static/css/main.css',
      '/index.html',
      '/manifest.json',
      '/favicon.ico'
    ];

    for (const path of staticPaths) {
      try {
        const response = await staticPage.goto(`http://api3.amdy.io:5000${path}`, {
          waitUntil: 'domcontentloaded',
          timeout: 5000
        });

        if (response && response.ok()) {
          console.log(`✓ Found static file: ${path} (${response.status()})`);
        } else {
          console.log(`✗ Not found: ${path} (${response ? response.status() : 'no response'})`);
        }
      } catch (error) {
        console.log(`✗ Error accessing ${path}`);
      }
    }

    console.log('\n=== Analysis Complete ===');

  } finally {
    await browser.close();
  }
}

testPorts().catch(console.error);