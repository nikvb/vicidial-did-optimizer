const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    console.log("🔍 Debugging DID Management Page");

    // Enable console and error monitoring
    page.on("console", msg => {
      console.log(`📝 Console [${msg.type()}]:`, msg.text());
    });

    page.on("pageerror", error => {
      console.log("❌ Page Error:", error.message);
    });

    page.on("response", response => {
      if (response.url().includes("/api/") || response.url().includes("/dids")) {
        console.log(`🌐 API Response: ${response.status()} ${response.url()}`);
      }
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

    // Check page title and content
    const title = await page.title();
    console.log(`📄 Page title: ${title}`);

    // Check if page has content
    const bodyText = await page.$eval("body", el => el.textContent).catch(() => "No body text");
    console.log(`📝 Body text length: ${bodyText.length} characters`);

    // Check for specific elements
    const elements = {
      "DID Management heading": "h1:has-text(\"DID Management\")",
      "DataTable container": ".did-datatable-container",
      "Select All Pages button": "button:has-text(\"Select All Pages\")",
      "Any table": "table",
      "Any button": "button",
      "Loading spinner": "[class*=\"spin\"], .animate-spin",
      "Error message": "[class*=\"error\"], .text-red"
    };

    console.log("🔍 Checking for page elements:");
    for (const [name, selector] of Object.entries(elements)) {
      const element = await page.$(selector);
      if (element) {
        const text = await element.textContent().catch(() => "");
        console.log(`✅ Found ${name}: "${text.slice(0, 100)}"${text.length > 100 ? "..." : ""}`);
      } else {
        console.log(`❌ Missing ${name}`);
      }
    }

    // Check network requests
    console.log("🌐 Waiting for any pending network requests...");
    await page.waitForTimeout(3000);

    // Get all text content for analysis
    const allText = await page.$eval("body", el => el.textContent).catch(() => "");
    if (allText.trim().length === 0) {
      console.log("❌ Page appears to be completely empty");
    } else if (allText.trim().length < 100) {
      console.log(`⚠️  Page has very little content: "${allText.trim()}"`);
    } else {
      console.log(`✅ Page has content (${allText.length} characters)`);
      // Show first 200 chars of content
      console.log(`📄 First 200 chars: "${allText.slice(0, 200)}..."`);
    }

    // Check for React app mount
    const reactRoot = await page.$("#root");
    if (reactRoot) {
      const reactContent = await reactRoot.textContent().catch(() => "");
      console.log(`⚛️  React root has ${reactContent.length} characters`);
    } else {
      console.log("❌ No React root found");
    }

    // Take screenshot for debugging
    await page.screenshot({ path: "did-management-debug.png", fullPage: true });
    console.log("📸 Screenshot saved as did-management-debug.png");

    // Check if we can navigate to the other DID page
    console.log("🔄 Trying alternative DID page at /dids...");
    await page.goto("https://dids.amdy.io/dids");
    await page.waitForTimeout(3000);

    const didsPageText = await page.$eval("body", el => el.textContent).catch(() => "");
    console.log(`📄 /dids page has ${didsPageText.length} characters`);

    await page.screenshot({ path: "dids-page-debug.png", fullPage: true });
    console.log("📸 /dids page screenshot saved as dids-page-debug.png");

  } catch (error) {
    console.error("❌ Test failed:", error.message);
    await page.screenshot({ path: "did-management-error.png", fullPage: true });
  } finally {
    await browser.close();
  }
})();
