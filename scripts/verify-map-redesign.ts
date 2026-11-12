import fs from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";

const BASE_URL = "http://localhost:3004";

async function dismissPrompt(page: any) {
  const later = page.locator('button:has-text("Nanti Saja"), button:has-text("Tutup"), button:has-text("Mengerti")');
  if (await later.first().isVisible().catch(() => false)) {
    await later.first().click().catch(() => {});
    await page.waitForTimeout(300);
  }
}

async function main() {
  console.log("==================================================================");
  console.log("SPARTA SIAGA — MAP MARKER & AHO LEGEND PLAYWRIGHT VERIFICATION");
  console.log("==================================================================");
  const screenshotDir = path.resolve(process.cwd(), "artifacts/map-redesign-verification");
  fs.mkdirSync(screenshotDir, { recursive: true });

  const edgePath = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
  const launchOptions: any = { headless: true };
  if (fs.existsSync(edgePath)) launchOptions.executablePath = edgePath;

  const browser = await chromium.launch(launchOptions);
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });

  await context.addInitScript(() => {
    localStorage.setItem("sparta_notif_permission_prompted", "true");
    localStorage.setItem("sparta_siaga_welcome_dismissed", "true");
    localStorage.setItem("sparta_read_notif_ids", "[]");
  });

  const page = await context.newPage();

  // Authentication via Quick Login
  console.log(">>> [AUTH] Performing Quick Login as System Administrator...");
  await page.goto(`${BASE_URL}/login`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2000);
  const quickLoginBtn = page.locator("button:has-text('Masuk sebagai System Administrator')");
  await quickLoginBtn.click();
  await page.waitForTimeout(2500);

  console.log(">>> [STEP 1] Navigating to http://localhost:3004/monitoring...");
  await page.goto(`${BASE_URL}/monitoring`, { waitUntil: "domcontentloaded", timeout: 30000 });
  await dismissPrompt(page);
  await page.waitForTimeout(3500);

  // 1. Initial State: Mode Kejadian (AHO layer button MUST NOT be visible)
  console.log(">>> [1/10] Mode Kejadian: Verifying mode isolation...");
  const ahoInKejadian = await page.getByRole("button", { name: /Tiket AHO/i }).isVisible().catch(() => false);
  console.log(`  • AHO visible in Kejadian mode: ${ahoInKejadian} (Expected: false)`);
  await page.screenshot({ path: path.join(screenshotDir, "01-mode-kejadian.png"), fullPage: false });
  console.log("  [SAVED] 01-mode-kejadian.png");

  // 2. Mode Toko (Standar Layer) - Zoom <= 7 (Cabang Aggregation)
  console.log(">>> [2/10] Mode Toko: Standar Cabang Markers (Zoom <= 7)...");
  const tokoTab = page.locator("button[role='tab']").filter({ hasText: /Toko/i });
  await tokoTab.click();
  await page.waitForTimeout(3000);

  // Set map zoom to 5
  await page.evaluate(() => {
    const map = (window as any).__SPARTA_MAP__;
    if (map) map.setView([-2.5, 118.0], 5);
  });
  await page.waitForTimeout(2000);

  const branchCount = await page.locator(".sparta-branch-marker").count();
  console.log(`  • Found ${branchCount} branch flag markers at Zoom 5`);
  await page.screenshot({ path: path.join(screenshotDir, "02-cabang-standar-zoom5.png"), fullPage: false });
  console.log("  [SAVED] 02-cabang-standar-zoom5.png");

  // 3. Mode Toko (AHO Layer) - Zoom <= 7 (Cabang AHO Flags & Contextual Legend)
  console.log(">>> [3/10] Mode Toko: AHO Cabang Markers & Legend (Zoom <= 7)...");
  const ahoLayerBtn = page.getByRole("button", { name: /Tiket AHO/i }).first();
  await ahoLayerBtn.click();
  await page.waitForTimeout(4000); // Allow AHO data to load

  const legendVisible = await page.locator("text=Legenda Tiket AHO").isVisible().catch(() => false);
  const legendAggregateTitle = await page.locator("text=Persentase Toko Bertiket").isVisible().catch(() => false);
  console.log(`  • AHO Legend visible: ${legendVisible}, Aggregate title: ${legendAggregateTitle}`);
  await page.screenshot({ path: path.join(screenshotDir, "03-cabang-aho-zoom5.png"), fullPage: false });
  console.log("  [SAVED] 03-cabang-aho-zoom5.png");

  // 4. Zoom to 9 over Java (AHO Clusters with Donut)
  console.log(">>> [4/10] Mode Toko: AHO Circular Clusters with SVG Donut (Zoom 9)...");
  await page.evaluate(() => {
    const map = (window as any).__SPARTA_MAP__;
    if (map) map.setView([-6.9, 107.6], 9);
  });
  await page.waitForTimeout(3000);

  const ahoClusterCount = await page.locator(".sparta-cluster-aho").count();
  console.log(`  • Found ${ahoClusterCount} AHO donut clusters at Zoom 9`);
  await page.screenshot({ path: path.join(screenshotDir, "04-cluster-aho-zoom9.png"), fullPage: false });
  console.log("  [SAVED] 04-cluster-aho-zoom9.png");

  // 5. Standard Mode Clusters at Zoom 9
  console.log(">>> [5/10] Mode Toko: Standar Circular Clusters (Zoom 9)...");
  const allLayerBtn = page.getByRole("button", { name: /Semua/i }).first();
  await allLayerBtn.click();
  await page.waitForTimeout(2500);

  const stdClusterCount = await page.locator(".sparta-cluster-std").count();
  console.log(`  • Found ${stdClusterCount} standard circular clusters at Zoom 9`);
  await page.screenshot({ path: path.join(screenshotDir, "05-cluster-standar-zoom9.png"), fullPage: false });
  console.log("  [SAVED] 05-cluster-standar-zoom9.png");

  // 6. Standard Mode Individual Stores at Zoom 14 (Teardrop Location Pins)
  console.log(">>> [6/10] Mode Toko: Standar Teardrop Store Pins (Zoom 14)...");
  await page.evaluate(() => {
    const map = (window as any).__SPARTA_MAP__;
    if (map) map.setView([-6.9175, 107.6191], 14);
  });
  await page.waitForTimeout(3000);

  const storePinCount = await page.locator(".sparta-store-pin").count();
  console.log(`  • Found ${storePinCount} teardrop store pins at Zoom 14`);
  await page.screenshot({ path: path.join(screenshotDir, "06-toko-standar-zoom14.png"), fullPage: false });
  console.log("  [SAVED] 06-toko-standar-zoom14.png");

  // 7. AHO Mode Individual Stores at Zoom 14 (Red/Green Pins & Individual Legend)
  console.log(">>> [7/10] Mode Toko: AHO Individual Store Pins & Adaptive Legend (Zoom 14)...");
  await ahoLayerBtn.click();
  await page.waitForTimeout(3000);

  const ahoLegendIndividual = await page.locator("text=Toko Individual").isVisible().catch(() => false);
  console.log(`  • AHO Legend adapted to individual store mode: ${ahoLegendIndividual} (Expected: true)`);
  await page.screenshot({ path: path.join(screenshotDir, "07-toko-aho-zoom14.png"), fullPage: false });
  console.log("  [SAVED] 07-toko-aho-zoom14.png");

  // 8. Click Marker -> Opens Right Detail Panel (No popup duplicate)
  console.log(">>> [8/10] Marker Click: Opening Right Detail Panel...");
  const firstPin = page.locator(".sparta-store-pin").first();
  if (await firstPin.isVisible().catch(() => false)) {
    await firstPin.click();
    await page.waitForTimeout(1500);
  }
  const rightPanelVisible = await page.locator("text=Informasi Lokasi").isVisible().catch(() => false);
  const leafletPopupVisible = await page.locator(".leaflet-popup").isVisible().catch(() => false);
  console.log(`  • Right Detail Panel visible: ${rightPanelVisible}, Leaflet popup visible: ${leafletPopupVisible} (Expected popup: false)`);
  await page.screenshot({ path: path.join(screenshotDir, "08-marker-click-detail-panel.png"), fullPage: false });
  console.log("  [SAVED] 08-marker-click-detail-panel.png");

  // 9. Mode DC: Facility Markers with Warehouse Icon
  console.log(">>> [9/10] Mode DC: Facility Markers with Warehouse Icon...");
  const dcTab = page.locator("button[role='tab']").filter({ hasText: /DC/i });
  await dcTab.click();
  await page.waitForTimeout(2500);

  // Set view to Jakarta/Java DC region
  await page.evaluate(() => {
    const map = (window as any).__SPARTA_MAP__;
    if (map) map.setView([-6.2, 106.8], 9);
  });
  await page.waitForTimeout(2500);

  const dcCount = await page.locator(".sparta-dc-facility").count();
  console.log(`  • Found ${dcCount} DC facility markers`);
  // Click first DC marker to verify right detail panel
  const firstDc = page.locator(".sparta-dc-facility").first();
  if (await firstDc.isVisible().catch(() => false)) {
    await firstDc.click();
    await page.waitForTimeout(1000);
  }
  await page.screenshot({ path: path.join(screenshotDir, "09-dc-facility-marker.png"), fullPage: false });
  console.log("  [SAVED] 09-dc-facility-marker.png");

  // 10. AHO Legend Collapsible State & Dense Java Region
  console.log(">>> [10/10] Collapsible Legend & Dense Java Region...");
  await tokoTab.click();
  await page.waitForTimeout(1500);
  await ahoLayerBtn.click();
  await page.waitForTimeout(2000);

  // Collapse the legend
  const collapseBtn = page.getByRole("button", { name: /Ciutkan Legenda/i });
  if (await collapseBtn.isVisible().catch(() => false)) {
    await collapseBtn.click();
    await page.waitForTimeout(800);
  }
  const collapsedPillVisible = await page.getByRole("button", { name: /Buka Legenda Tiket AHO/i }).isVisible().catch(() => false);
  console.log(`  • Collapsed legend pill visible: ${collapsedPillVisible} (Expected: true)`);

  await page.screenshot({ path: path.join(screenshotDir, "10-legend-collapsed.png"), fullPage: false });
  console.log("  [SAVED] 10-legend-collapsed.png");

  await browser.close();
  console.log("\n==================================================================");
  console.log("ALL 10 VERIFICATION SCENARIOS COMPLETED & SCREENSHOTS SAVED!");
  console.log("==================================================================");
}

main().catch((err) => {
  console.error("Verification failed:", err);
  process.exit(1);
});
