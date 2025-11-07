const { chromium } = require('playwright');

async function testAuthAndDataIsolation() {
  const browser = await chromium.launch({
    headless: true, // Run in headless mode
    timeout: 60000
  });

  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 }
  });

  const page = await context.newPage();
  console.log('🚀 Starting authentication and data isolation test...');

  try {
    // Navigate to the application
    console.log('📍 Navigating to http://api3.amdy.io:3000...');
    await page.goto('http://api3.amdy.io:3000', {
      waitUntil: 'networkidle',
      timeout: 30000
    });
    await page.screenshot({ path: 'auth-test-1-landing.png' });

    // Check if already logged in or need to login
    const isLoggedIn = await page.evaluate(() => {
      return window.location.pathname.includes('/dashboard');
    });

    if (!isLoggedIn) {
      console.log('🔐 User not logged in, checking login page...');

      // Navigate to login
      const loginLink = await page.locator('a[href="/login"], button:has-text("Sign In")').first();
      if (await loginLink.isVisible()) {
        await loginLink.click();
        await page.waitForURL('**/login**', { timeout: 10000 });
      } else {
        await page.goto('http://api3.amdy.io:3000/login');
      }

      await page.screenshot({ path: 'auth-test-2-login-page.png' });

      console.log('⚠️  Manual Google OAuth login required');
      console.log('📝 Instructions:');
      console.log('   1. Click "Continue with Google" button');
      console.log('   2. Sign in with 2218pleasantllc@gmail.com');
      console.log('   3. Dashboard should redirect after login');
    }

    // Make direct API call to check authentication
    console.log('\n📊 Checking authentication status via API...');
    const authCheckResponse = await page.evaluate(async () => {
      try {
        const response = await fetch('http://api3.amdy.io:5000/api/v1/auth/check', {
          credentials: 'include',
          headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json'
          }
        });
        const data = await response.json();
        return {
          status: response.status,
          authenticated: data.authenticated,
          user: data.user
        };
      } catch (error) {
        return { error: error.message };
      }
    });

    console.log('🔍 Auth check response:', JSON.stringify(authCheckResponse, null, 2));

    if (authCheckResponse.authenticated && authCheckResponse.user) {
      console.log('✅ User authenticated as:', authCheckResponse.user.email);
      console.log('   Tenant ID:', authCheckResponse.user.tenant);

      // Check dashboard stats via API
      console.log('\n📊 Fetching dashboard statistics...');
      const dashboardStats = await page.evaluate(async () => {
        try {
          const response = await fetch('http://api3.amdy.io:5000/api/v1/dashboard/stats', {
            credentials: 'include',
            headers: {
              'Accept': 'application/json',
              'Content-Type': 'application/json'
            }
          });
          return await response.json();
        } catch (error) {
          return { error: error.message };
        }
      });

      console.log('📊 Dashboard Stats:', JSON.stringify(dashboardStats, null, 2));

      if (dashboardStats) {
        const { callsToday, totalCalls, activeDids, inactiveDids } = dashboardStats;

        console.log('\n📈 Data Summary for', authCheckResponse.user.email + ':');
        console.log('   - Calls Today:', callsToday || 0);
        console.log('   - Total Calls:', totalCalls || 0);
        console.log('   - Active DIDs:', activeDids || 0);
        console.log('   - Inactive DIDs:', inactiveDids || 0);

        // Check for data isolation issue
        if (callsToday === 10434 || totalCalls === 10434) {
          console.log('\n❌ DATA ISOLATION ERROR!');
          console.log('   User is seeing data from another tenant (client@test3.com)');
          console.log('   This is a critical security issue!');
        } else if (authCheckResponse.user.email === '2218pleasantllc@gmail.com' && totalCalls === 0) {
          console.log('\n✅ Data isolation working correctly!');
          console.log('   2218pleasantllc@gmail.com sees 0 calls (as expected for new tenant)');
          console.log('   No data leak from client@test3.com tenant');
        } else {
          console.log('\n✅ User sees only their tenant data');
        }
      }

      // Try to navigate to dashboard
      console.log('\n📍 Navigating to dashboard...');
      await page.goto('http://api3.amdy.io:3000/dashboard', {
        waitUntil: 'networkidle',
        timeout: 30000
      });

      await page.waitForTimeout(2000);
      await page.screenshot({ path: 'auth-test-3-dashboard.png' });

      // Check for visible stats on page
      const pageStats = await page.evaluate(() => {
        const stats = {};
        const statElements = document.querySelectorAll('[class*="metric"], [class*="stat"], h2, h3, p');
        statElements.forEach(el => {
          const text = el.textContent;
          if (text && text.includes('Calls')) {
            stats.calls = text;
          }
          if (text && text.includes('10,434') || text.includes('10434')) {
            stats.wrongData = true;
          }
        });
        return stats;
      });

      console.log('\n📄 Page statistics:', pageStats);

      if (pageStats.wrongData) {
        console.log('❌ Dashboard UI shows wrong tenant data (10,434 calls)!');
      } else {
        console.log('✅ Dashboard UI shows correct tenant data');
      }

    } else {
      console.log('⚠️  User not authenticated');
      console.log('\n📝 To complete authentication:');
      console.log('   1. The browser window is still open');
      console.log('   2. Click "Continue with Google"');
      console.log('   3. Sign in with 2218pleasantllc@gmail.com');
      console.log('   4. Check if dashboard shows 0 calls (not 10,434)');
    }

    // Keep browser open for manual verification
    console.log('\n⏸️  Keeping browser open for 20 seconds for manual verification...');
    await page.waitForTimeout(20000);

  } catch (error) {
    console.error('❌ Test error:', error.message);
    await page.screenshot({ path: 'auth-test-error.png' });
  }

  await browser.close();
  console.log('\n✅ Test completed');
}

// Run the test
testAuthAndDataIsolation().catch(console.error);