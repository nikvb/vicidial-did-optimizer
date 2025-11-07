const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    console.log("🔍 Verifying DID Management Page After Frontend Rebuild");

    // Enable console and error monitoring
    page.on("console", msg => {
      console.log(`📝 Console [${msg.type()}]:`, msg.text());
    });

    page.on("pageerror", error => {
      console.log("❌ Page Error:", error.message);
    });

    // Login
    console.log("🔑 Logging in...");
    await page.goto("https://dids.amdy.io/login");
    await page.fill("input[type=\"email\"]", "client@test3.com");
    await page.fill("input[type=\"password\"]", "password123");
    await page.click("button[type=\"submit\"]");
    await page.waitForURL("**/dashboard", { timeout: 10000 });
    console.log("✅ Successfully logged in");

    // Navigate to DID Management
    console.log("📊 Navigating to /did-management...");
    await page.goto("https://dids.amdy.io/did-management");
    await page.waitForTimeout(5000);

    // Check if page loads without JavaScript errors
    const title = await page.title();
    console.log(`📄 Page title: ${title}`);

    // Check for React app content
    const bodyText = await page.$eval("body", el => el.textContent).catch(() => "No body text");
    const hasContent = bodyText.length > 100;
    console.log(`📝 Page has ${bodyText.length} characters of content`);

    if (hasContent) {
      console.log("✅ Page loaded successfully with content");

      // Check for key elements
      const elements = {
        "DID Management heading": "h1:has-text(\"DID Management\")",
        "DataTable": "table, [role=\"table\"]",
        "Select All Pages button": "button:has-text(\"Select All Pages\")",
        "Pagination": "[aria-label*=\"page\"], .pagination, button:has-text(\"Next\")"
      };

      console.log("🔍 Checking for key elements:");
      for (const [name, selector] of Object.entries(elements)) {
        const element = await page.$(selector);
        if (element) {
          console.log(`✅ Found ${name}`);
        } else {
          console.log(`❌ Missing ${name}`);
        }
      }

      // Check pagination options
      const paginationSelector = await page.$("select[aria-label*=\"rows per page\"], select:has(option[value=\"10\"]), select:has(option[value=\"25\"])");
      if (paginationSelector) {
        const options = await page.$$eval("select[aria-label*=\"rows per page\"] option, select:has(option[value=\"10\"]) option",
          opts => opts.map(opt => opt.value || opt.textContent).filter(Boolean));
        console.log("✅ Pagination options found:", options);
      } else {
        console.log("❌ Pagination selector not found");
      }

    } else {
      console.log("❌ Page appears to have minimal content - may still be showing error");
      console.log(`First 200 chars: "${bodyText.slice(0, 200)}"`);
    }

    // Take screenshot
    await page.screenshot({ path: "did-management-verification.png", fullPage: true });
    console.log("📸 Screenshot saved as did-management-verification.png");

  } catch (error) {
    console.error("❌ Verification failed:", error.message);
    await page.screenshot({ path: "did-management-verification-error.png", fullPage: true });
  } finally {
    await browser.close();
  }
})();