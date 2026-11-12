import { chromium } from "@playwright/test";

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  console.log("1. Navigating to /login...");
  await page.goto("http://localhost:3004/login", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1000);

  console.log("2. Quick login...");
  await page.click("button:has-text('Masuk sebagai System Administrator')");
  await page.waitForTimeout(2000);

  console.log("3. Navigating to /monitoring...");
  await page.goto("http://localhost:3004/monitoring", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2000);

  console.log("4. Switching to Toko mode...");
  const tokoTab = page.locator("button[role='tab']").filter({ hasText: /Toko/i });
  await tokoTab.click();

  console.log("5. Waiting for .sparta-branch-marker to appear (after /api/stores loads)...");
  await page.waitForSelector(".sparta-branch-marker", { timeout: 15000 });
  const branchCount = await page.locator(".sparta-branch-marker").count();
  console.log(`SUCCESS! Found ${branchCount} branch flag markers on map!`);

  // Let's inspect the first 3 branch markers text
  const branches = await page.$$eval(".sparta-branch-marker", els =>
    els.slice(0, 5).map(e => e.textContent?.trim())
  );
  console.log("Sample branch markers:", branches);

  await browser.close();
}

main().catch(console.error);
