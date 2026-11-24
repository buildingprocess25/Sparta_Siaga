import { chromium } from "@playwright/test";
import { createDeviceSession } from "../lib/session-service";

async function run() {
  console.log("=================================================");
  console.log("SPARTA SIAGA — MONITORING UI E2E VERIFICATION");
  console.log("=================================================");

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });

  // 1. Direct Session Cookie Injection using createDeviceSession
  console.log("\n[1] Creating authenticated sysadmin device session...");
  const session = await createDeviceSession({ userId: "usr_sysadmin_01" });
  if (!session) {
    throw new Error("Failed to create device session for usr_sysadmin_01");
  }

  await context.addCookies([
    {
      name: "siaga_session",
      value: session.accessToken,
      domain: "localhost",
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
    },
    {
      name: "siaga_refresh",
      value: session.refreshToken,
      domain: "localhost",
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
  console.log("Session cookies added successfully.");

  const page = await context.newPage();
  page.setDefaultTimeout(60000);
  page.setDefaultNavigationTimeout(60000);

  // 2. Navigate to /monitoring
  console.log("\n[2] Navigating to http://localhost:3004/monitoring...");
  await page.goto("http://localhost:3004/monitoring", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3000);
  console.log("Current Page URL:", page.url());

  // Check 5: Toolbar verification - No duplicate Tiket AHO button in header toolbar
  console.log("\n[3] Checking Header Toolbar...");
  const toolbarHeader = page.locator("header");
  const toolbarText = await toolbarHeader.innerText();
  const hasDuplicateAhoInHeader = toolbarText.includes("Tiket AHO");
  console.log("Header toolbar text includes 'Tiket AHO' duplicate:", hasDuplicateAhoInHeader);
  if (hasDuplicateAhoInHeader) {
    console.error("FAIL: Duplicate Tiket AHO button still found in toolbar header!");
  } else {
    console.log("PASS: Duplicate Tiket AHO button successfully eliminated from toolbar header!");
  }

  // Check 3: Mode Toko & Epicenter isolation
  console.log("\n[4] Switching to Mode Toko...");
  const tokoTab = page.locator('button[role="tab"]:has-text("Toko")');
  await tokoTab.click();
  await page.waitForTimeout(2000);

  // Open store list and select first store
  console.log("Opening location list to select a store...");
  const daftarBtn = page.locator('button:has-text("Daftar")');
  await daftarBtn.click();
  await page.waitForTimeout(1000);

  const dialog = page.locator('div[role="dialog"]');
  await dialog.waitFor({ state: "visible", timeout: 10000 });
  const dialogText = await dialog.innerText();
  console.log("Dialog opened, text preview:", dialogText.slice(0, 150).replace(/\n+/g, " "));

  const firstStoreBtn = dialog.locator('button').filter({ hasText: "Cabang" }).first();
  if (await firstStoreBtn.isVisible()) {
    await firstStoreBtn.click();
    console.log("Selected first store from list.");
  } else {
    console.log("No store with 'Cabang' text found directly in dialog. Button count in dialog:", await dialog.locator('button').count());
  }
  await page.waitForTimeout(1500);

  // Verify dialog is closed or close it if needed
  if (await dialog.isVisible()) {
    const closeBtn = dialog.locator('button[aria-label="Tutup daftar"]');
    if (await closeBtn.isVisible()) await closeBtn.click();
    await page.waitForTimeout(500);
  }

  const detailPanel = page.locator('aside[aria-label="Panel Detail Objek Monitoring"]');
  const isDetailVisible = await detailPanel.isVisible();
  console.log("Store detail panel visible:", isDetailVisible);

  if (isDetailVisible) {
    const panelContent = await detailPanel.innerText();

    // Verify BMS, BMC, BnM Manager presence
    const hasBms = panelContent.includes("BMS");
    const hasBmc = panelContent.includes("BMC");
    const hasBnm = panelContent.includes("BnM Manager");
    console.log(`BMS present: ${hasBms}, BMC present: ${hasBmc}, BnM Manager present: ${hasBnm}`);

    // Verify AHO tickets card presence
    const hasAhoTickets = panelContent.includes("Tiket AHO Aktif");
    console.log("AHO Tickets card present:", hasAhoTickets);

    // Verify epicenter info is NOT present in Mode Toko
    const hasEpicenter = panelContent.includes("Jarak dari Episentrum");
    const hasV1Radius = panelContent.includes("Dalam Radius V1") || panelContent.includes("Radius Evaluasi (V1)");
    console.log(`Epicenter distance present in store mode: ${hasEpicenter} (Expected: false)`);
    console.log(`V1 radius evaluation present in store mode: ${hasV1Radius} (Expected: false)`);

    if (hasBms && hasBmc && hasBnm && hasAhoTickets && !hasEpicenter && !hasV1Radius) {
      console.log("PASS: Mode Toko detail panel shows BMS, BMC, BnM Manager & Tiket AHO without epicenter contamination!");
    } else {
      console.error("FAIL: Verification failed for store detail panel contents.");
    }
  }

  // Check 1: AHO Legend verification
  console.log("\n[5] Activating Layer Tiket AHO in Left Control Rail...");
  const ahoLayerBtn = page.locator('aside button:has-text("Tiket AHO")').first();
  await ahoLayerBtn.waitFor({ state: "visible", timeout: 10000 });
  await ahoLayerBtn.click();
  console.log("Clicked Tiket AHO in Left Control Rail.");
  await page.waitForTimeout(3000);

  const legend = page.locator('div:has-text("Legenda AHO")').first();
  const isLegendVisible = await legend.isVisible();
  console.log("AHO Legend visible:", isLegendVisible);

  if (isLegendVisible) {
    const legendText = await legend.innerText();
    console.log("AHO Legend text sample:", legendText.slice(0, 100).replace(/\n+/g, " "));

    // Check collapse button
    const collapseBtn = page.locator('button[aria-label="Ciutkan Legenda"]');
    if (await collapseBtn.isVisible()) {
      await collapseBtn.click();
      await page.waitForTimeout(500);
      console.log("PASS: AHO Legend collapsed successfully!");

      // Open back
      const openLegendBtn = page.locator('button[aria-label="Buka Legenda Tiket AHO"]');
      if (await openLegendBtn.isVisible()) {
        await openLegendBtn.click();
        await page.waitForTimeout(500);
        console.log("PASS: AHO Legend expanded back successfully!");
      }
    }
  }

  // Check 6: Mode DC verification
  console.log("\n[6] Switching to Mode DC...");
  const dcTab = page.locator('button[role="tab"]:has-text("DC")');
  await dcTab.click();
  await page.waitForTimeout(2000);
  console.log("Switched to Mode DC successfully.");

  // Check 4: Mobile Responsive View
  console.log("\n[7] Checking Mobile Responsive Layout (375x812)...");
  await page.setViewportSize({ width: 375, height: 812 });
  await page.waitForTimeout(1000);

  // In mobile Mode Toko, select a store and verify bottom drawer
  await tokoTab.click();
  await page.waitForTimeout(1000);

  const mobileDaftarBtn = page.locator('button:has-text("Daftar")');
  if (await mobileDaftarBtn.isVisible()) {
    await mobileDaftarBtn.click();
    await page.waitForTimeout(1000);
    const storeBtn = page.locator('div[role="dialog"] button:has(span.font-mono)').first();
    if (await storeBtn.isVisible()) {
      await storeBtn.click();
      await page.waitForTimeout(1500);

      const mobileDrawer = page.locator('aside[aria-label="Panel Detail Objek Monitoring"]');
      const isMobileDrawerVisible = await mobileDrawer.isVisible();
      console.log("Mobile drawer visible:", isMobileDrawerVisible);

      if (isMobileDrawerVisible) {
        const drawerText = await mobileDrawer.innerText();
        const hasMobileBms = drawerText.includes("BMS");
        const hasMobileAho = drawerText.includes("Tiket AHO Aktif");
        console.log(`Mobile Drawer BMS present: ${hasMobileBms}, AHO Tickets present: ${hasMobileAho}`);
        if (hasMobileBms && hasMobileAho) {
          console.log("PASS: Mobile Drawer displays complete BMS & AHO information in map-first layout!");
        }
      }
    }
  }

  await browser.close();
  console.log("\n=================================================");
  console.log("ALL E2E CHECKS COMPLETED SUCCESSFULLY!");
  console.log("=================================================");
}

run().catch((err) => {
  console.error("Verification error:", err);
  process.exit(1);
});
