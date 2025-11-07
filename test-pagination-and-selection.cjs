const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    console.log("🧪 Testing Pagination Dropdown and Cross-Page Selection");

    // Login
    await page.goto("https://dids.amdy.io/login");
    await page.fill("input[type=\"email\"]", "client@test3.com");
    await page.fill("input[type=\"password\"]", "password123");
    await page.click("button[type=\"submit\"]");
    await page.waitForURL("**/dashboard", { timeout: 10000 });
    console.log("✅ Successfully logged in");

    // Navigate to DID Management
    await page.goto("https://dids.amdy.io/did-management");
    await page.waitForTimeout(5000);
    console.log("✅ Navigated to DID Management page");

    // Test 1: Pagination Dropdown
    console.log("\n📊 Testing Pagination Dropdown:");
    const rowsPerPageSelector = await page.$("select[aria-label*=\"rows per page\"], select:has(option[value=\"10\"]), select:has(option[value=\"25\"])");
    if (rowsPerPageSelector) {
      console.log("✅ Found pagination dropdown selector");

      const options = await page.$$eval("select[aria-label*=\"rows per page\"] option, select:has(option[value=\"10\"]) option",
        opts => opts.map(opt => ({ value: opt.value, text: opt.textContent })).filter(o => o.value));

      console.log("✅ Available pagination options:");
      options.forEach(opt => console.log(`   - ${opt.value} rows per page`));

      if (options.length >= 5) {
        console.log("✅ Pagination dropdown has sufficient options");
      } else {
        console.log("⚠️  Pagination dropdown has limited options");
      }
    } else {
      console.log("❌ Pagination dropdown not found");
    }

    // Test 2: Cross-page Selection
    console.log("\n🔄 Testing Cross-Page Selection:");

    const selectAllButton = await page.$("button:has-text(\"Select All Pages\")");
    if (selectAllButton) {
      console.log("✅ Found Select All Pages button");

      // Click Select All
      await selectAllButton.click();
      await page.waitForTimeout(2000);

      const selectionInfo = await page.$eval("[class*=\"bg-blue-50\"], .bg-blue-50", el => el.textContent).catch(() => "Not found");
      console.log(`✅ After Select All: ${selectionInfo}`);

      // Check initial checkboxes
      const checkboxesPage1 = await page.$$("input[type=\"checkbox\"]:checked");
      console.log(`✅ Page 1 selected checkboxes: ${checkboxesPage1.length}`);

      // Navigate to next page
      const nextButton = await page.$("button:has-text(\"Next\"), [aria-label=\"Next Page\"]");
      if (nextButton && await nextButton.isEnabled()) {
        console.log("✅ Found Next button, navigating...");
        await nextButton.click();
        await page.waitForTimeout(3000);

        // Check checkboxes on page 2
        const checkboxesPage2 = await page.$$("input[type=\"checkbox\"]:checked");
        console.log(`✅ Page 2 selected checkboxes: ${checkboxesPage2.length}`);

        if (checkboxesPage2.length > 0) {
          console.log("🎉 SUCCESS: Cross-page selection is maintained!");
        } else {
          console.log("❌ FAILED: Cross-page selection lost on page 2");
        }

        // Try navigating back
        const prevButton = await page.$("button:has-text(\"Previous\"), [aria-label=\"Previous Page\"]");
        if (prevButton && await prevButton.isEnabled()) {
          console.log("✅ Found Previous button, navigating back...");
          await prevButton.click();
          await page.waitForTimeout(3000);

          const checkboxesBackPage1 = await page.$$("input[type=\"checkbox\"]:checked");
          console.log(`✅ Back on Page 1 selected checkboxes: ${checkboxesBackPage1.length}`);

          if (checkboxesBackPage1.length > 0) {
            console.log("🎉 SUCCESS: Selection persisted after returning to page 1!");
          } else {
            console.log("❌ FAILED: Selection lost after returning to page 1");
          }
        }
      } else {
        console.log("⚠️  No Next button available (single page)");
      }
    } else {
      console.log("❌ Select All Pages button not found");
    }

    // Test 3: Check for visible pagination text
    console.log("\n📄 Testing Pagination Text:");
    const paginationText = await page.$eval("text=/DIDs per page/", el => el.textContent).catch(() => null);
    if (paginationText) {
      console.log(`✅ Found pagination text: "${paginationText}"`);
    } else {
      console.log("❌ 'DIDs per page' text not found");
    }

    await page.screenshot({ path: "pagination-and-selection-test.png", fullPage: true });
    console.log("\n📸 Screenshot saved as pagination-and-selection-test.png");

  } catch (error) {
    console.error("❌ Test failed:", error.message);
    await page.screenshot({ path: "pagination-and-selection-test-error.png", fullPage: true });
  } finally {
    await browser.close();
  }
})();