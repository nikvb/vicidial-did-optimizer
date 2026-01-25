const puppeteer = require('puppeteer');

async function testAuthAndDataIsolation() {
  const browser = await puppeteer.launch({
    headless: false, // Show browser for debugging
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  console.log('🚀 Starting authentication and data isolation test...');

  try {
    // Navigate to the application
    console.log('📍 Navigating to http://api3.amdy.io:3000...');
    await page.goto('http://api3.amdy.io:3000', { waitUntil: 'networkidle2' });
    await page.screenshot({ path: 'auth-test-1-landing.png' });

    // Click login button
    console.log('🔐 Clicking login button...');
    await page.waitForSelector('a[href="/login"]', { timeout: 10000 });
    await page.click('a[href="/login"]');
    await page.waitForNavigation({ waitUntil: 'networkidle2' });
    await page.screenshot({ path: 'auth-test-2-login-page.png' });

    // Look for Google OAuth button
    console.log('🔍 Looking for Google OAuth button...');
    const googleButton = await page.waitForSelector('button:has-text("Continue with Google"), a:has-text("Continue with Google"), [href*="/api/v1/auth/google"]', { timeout: 10000 });

    if (googleButton) {
      console.log('✅ Found Google OAuth button');
      await page.screenshot({ path: 'auth-test-3-oauth-button.png' });

      // Click would normally trigger OAuth flow
      console.log('⚠️  Google OAuth flow requires manual interaction');
      console.log('📝 To test manually:');
      console.log('   1. Click "Continue with Google" button');
      console.log('   2. Complete Google sign-in with 2218pleasantllc@gmail.com');
      console.log('   3. Check if redirected to dashboard');
      console.log('   4. Verify dashboard shows 0 calls (not 10,434)');
    }

    // Alternative: Check if already logged in via cookies/session
    console.log('\n📊 Checking authentication status via API...');
    const cookies = await page.cookies();

    // Make API call to check auth status
    const authCheckResponse = await page.evaluate(async () => {
      try {
        const response = await fetch('http://api3.amdy.io:5000/api/v1/auth/check', {
          credentials: 'include'
        });
        return {
          status: response.status,
          data: await response.json()
        };
      } catch (error) {
        return { error: error.message };
      }
    });

    console.log('🔍 Auth check response:', authCheckResponse);

    // If authenticated, check dashboard data
    if (authCheckResponse.status === 200 && authCheckResponse.data.authenticated) {
      console.log('✅ User is authenticated as:', authCheckResponse.data.user.email);

      // Navigate to dashboard
      console.log('📊 Navigating to dashboard...');
      await page.goto('http://api3.amdy.io:3000/dashboard', { waitUntil: 'networkidle2' });
      await page.screenshot({ path: 'auth-test-4-dashboard.png' });

      // Check for call stats
      const callStats = await page.evaluate(() => {
        const statsElements = document.querySelectorAll('[class*="metric"], [class*="stat"], [class*="calls"]');
        const stats = [];
        statsElements.forEach(el => {
          const text = el.textContent;
          if (text && text.match(/\d+/)) {
            stats.push(text);
          }
        });
        return stats;
      });

      console.log('📊 Dashboard statistics found:', callStats);

      // Check if showing incorrect data (10,434 calls)
      const hasIncorrectData = callStats.some(stat => stat.includes('10,434') || stat.includes('10434'));

      if (hasIncorrectData) {
        console.log('❌ ERROR: Dashboard showing data from another tenant (10,434 calls)');
        console.log('   This indicates a data isolation issue!');
      } else {
        console.log('✅ Dashboard appears to show correct tenant data');
        console.log('   No signs of the 10,434 calls from client@test3.com');
      }

      // Make API call to verify data isolation
      console.log('\n🔍 Verifying data isolation via API...');
      const dashboardData = await page.evaluate(async () => {
        try {
          const response = await fetch('http://api3.amdy.io:5000/api/v1/dashboard/stats', {
            credentials: 'include'
          });
          return {
            status: response.status,
            data: await response.json()
          };
        } catch (error) {
          return { error: error.message };
        }
      });

      console.log('📊 Dashboard API response:', JSON.stringify(dashboardData, null, 2));

      if (dashboardData.data) {
        const { callsToday, totalCalls, activeDids } = dashboardData.data;
        console.log(`\n📈 Data Summary for ${authCheckResponse.data.user.email}:`);
        console.log(`   - Calls Today: ${callsToday || 0}`);
        console.log(`   - Total Calls: ${totalCalls || 0}`);
        console.log(`   - Active DIDs: ${activeDids || 0}`);

        if (callsToday === 10434 || totalCalls === 10434) {
          console.log('\n❌ CRITICAL: User seeing another tenant\'s data!');
          console.log('   Expected: 0 calls (new tenant)');
          console.log('   Actual: 10,434 calls (from client@test3.com)');
        } else {
          console.log('\n✅ Data isolation working correctly!');
          console.log('   User only sees their own tenant data');
        }
      }
    } else {
      console.log('⚠️  User not authenticated - manual OAuth login required');
      console.log('📝 Instructions:');
      console.log('   1. Open http://api3.amdy.io:3000 in browser');
      console.log('   2. Click "Sign In" → "Continue with Google"');
      console.log('   3. Sign in with 2218pleasantllc@gmail.com');
      console.log('   4. Check dashboard for correct data (should show 0 calls)');
    }

    // Keep browser open for manual testing
    console.log('\n⏸️  Keeping browser open for 30 seconds for manual verification...');
    await page.waitForTimeout(30000);

  } catch (error) {
    console.error('❌ Test error:', error.message);
    await page.screenshot({ path: 'auth-test-error.png' });
  }

  await browser.close();
  console.log('✅ Test completed');
}

// Run the test
testAuthAndDataIsolation().catch(console.error);