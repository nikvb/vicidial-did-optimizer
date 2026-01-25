const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    console.log("Testing Cross-Page Selection State Persistence Fix");

    // Login
    await page.goto("https://dids.amdy.io/login");
    await page.fill("input[type=\"email\"]", "client@test3.com");
    await page.fill("input[type=\"password\"]", "password123");
    await page.click("button[type=\"submit\"]");
    await page.waitForURL("**/dashboard", { timeout: 10000 });
    console.log("Successfully logged in");

    // Navigate to DID Management (DataTable version)
    await page.goto("https://dids.amdy.io/did-management");
    await page.waitForTimeout(5000);
    console.log("Navigated to DID Management page with DataTable");

    // Look for the Select All Pages button
    const selectAllButton = await page.$("button:has-text(\"Select All Pages\")");
    if (!selectAllButton) {
      console.log("Select All Pages button not found");
      await page.screenshot({ path: "test-cross-page-selection-fix-no-button.png", fullPage: true });
      return;
    }

    console.log("Found Select All Pages button");

    // Check initial state
    const initialRowCount = await page.$$eval("tbody tr", rows => rows.length);
    console.log("Found " + initialRowCount + " rows on current page");

    // Click Select All Pages
    await selectAllButton.click();
    await page.waitForTimeout(2000);

    // Check selection count
    const selectionInfo = await page.$eval("[class*=\"bg-blue-50\"], .bg-blue-50", el => el.textContent).catch(() => "Not found");
    console.log("Selection info after Select All Pages: " + selectionInfo);

    // Look for pagination
    const nextButton = await page.$("button:has-text(\"Next\"), [aria-label=\"Next Page\"]");
    const prevButton = await page.$("button:has-text(\"Previous\"), [aria-label=\"Previous Page\"]");

    if (!nextButton) {
      console.log("No Next button found - may be single page");
      const selectedCheckboxes = await page.$$("input[type=\"checkbox\"]:checked");
      console.log("Found " + selectedCheckboxes.length + " selected checkboxes");
      await page.screenshot({ path: "test-cross-page-selection-fix-single-page.png", fullPage: true });
      return;
    }

    console.log("Found pagination controls");

    // Check checkboxes before navigation
    const checkboxesBeforeNav = await page.$$("input[type=\"checkbox\"]:checked");
    const selectedCountBefore = checkboxesBeforeNav.length;
    console.log("Checkboxes selected on page 1: " + selectedCountBefore);

    // Navigate to next page
    if (nextButton && await nextButton.isEnabled()) {
      console.log("Clicking Next button...");
      await nextButton.click();
      await page.waitForTimeout(3000);

      // Check selection on page 2
      const checkboxesOnPage2 = await page.$$("input[type=\"checkbox\"]:checked");
      const selectedCountPage2 = checkboxesOnPage2.length;
      console.log("Checkboxes selected on page 2: " + selectedCountPage2);

      // Navigate back to previous page
      if (prevButton && await prevButton.isEnabled()) {
        console.log("Clicking Previous button...");
        await prevButton.click();
        await page.waitForTimeout(3000);

        // Check selection back on page 1
        const checkboxesBackOnPage1 = await page.$$("input[type=\"checkbox\"]:checked");
        const selectedCountBackOnPage1 = checkboxesBackOnPage1.length;
        console.log("Checkboxes selected back on page 1: " + selectedCountBackOnPage1);

        // Verify the fix
        console.log("CROSS-PAGE SELECTION PERSISTENCE TEST RESULTS:");
        console.log("============================================================");

        if (selectedCountBackOnPage1 === selectedCountBefore && selectedCountBefore > 0) {
          console.log("SUCCESS: Selection state persisted correctly!");
          console.log("   - Page 1 initial: " + selectedCountBefore + " checkboxes selected");
          console.log("   - Page 2: " + selectedCountPage2 + " checkboxes selected");
          console.log("   - Page 1 after return: " + selectedCountBackOnPage1 + " checkboxes selected");
        } else {
          console.log("ISSUE: Selection state NOT persisted correctly");
          console.log("   - Page 1 initial: " + selectedCountBefore + " checkboxes selected");
          console.log("   - Page 2: " + selectedCountPage2 + " checkboxes selected");
          console.log("   - Page 1 after return: " + selectedCountBackOnPage1 + " checkboxes selected");
        }
      } else {
        console.log("Previous button not available");
      }
    } else {
      console.log("Next button not available");
    }

    await page.screenshot({ path: "test-cross-page-selection-fix-final.png", fullPage: true });
    console.log("Final screenshot saved");

  } catch (error) {
    console.error("Test failed:", error.message);
    await page.screenshot({ path: "test-cross-page-selection-fix-error.png", fullPage: true });
  } finally {
    await browser.close();
  }
})();
