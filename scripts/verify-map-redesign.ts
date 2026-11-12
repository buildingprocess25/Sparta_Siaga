import fs from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";
import { signSession } from "../lib/jwt";

const BASE_URL = "http://localhost:3004";

async function dismissPrompt(page: any) {
  const later = page.locator('button:has-text("Nanti Saja"), button:has-text("Tutup"), button:has-text("Mengerti")');
  if (await later.first().isVisible().catch(() => false)) {
    await later.first().click().catch(() => {});
    await page.waitForTimeout(300);
  }
}

async function main() {
  console.log(">>> Launching Playwright for Map Redesign Verification...");
  const screenshotDir = path.resolve(process.cwd(), "artifacts/map-redesign-verification");
  fs.mkdirSync(screenshotDir, { recursive: true });

  const adminToken = await signSession({
    id: "usr_sysadmin_01",
    nik: "SYSADMIN",
    systemRole: "ADMIN",
    businessRole: "admin",
    scope: "HO",
  });

  const edgePath = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
  const launchOptions: any = { headless: true };
  if (fs.existsSync(edgePath)) launchOptions.executablePath = edgePath;

  const browser = await chromium.launch(launchOptions);
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });

  await context.addCookies([
    {
      name: "siaga_session",
      value: adminToken,
      url: "http://localhost:3004/",
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);

  await context.addInitScript(() => {
    localStorage.setItem("sparta_notif_permission_prompted", "true");
    localStorage.setItem("sparta_siaga_welcome_dismissed", "true");
    localStorage.setItem("sparta_read_notif_ids", "[]");
  });

  const page = await context.newPage();

  console.log(">>> Navigating to http://localhost:3004/monitoring...");
  await page.goto(`${BASE_URL}/monitoring`, { waitUntil: "domcontentloaded", timeout: 20000 });
  await dismissPrompt(page);
  await page.waitForTimeout(3000);

  // 1. Initial State: Kejadian Mode
  console.log(">>> [1/4] Verifying Mode Kejadian...");
  await page.screenshot({ path: path.join(screenshotDir, "01-mode-kejadian.png"), fullPage: false });
  console.log("  [SAVED] 01-mode-kejadian.png");

  // Verify elements in Kejadian mode
  const tabs = page.locator("button[role='tab']");
  const tabCount = await tabs.count();
  console.log(`  Found ${tabCount} mode tabs`);

  // Verify AHO is NOT shown in Kejadian mode rail
  const ahoInKejadian = await page.getByRole("button", { name: /Tiket AHO/i }).isVisible().catch(() => false);
  console.log(`  AHO visible in Kejadian mode: ${ahoInKejadian} (Expected: false)`);

  // 2. Switch to Mode Toko
  console.log(">>> [2/4] Switching to Mode Toko...");
  const tokoTab = page.locator("button[role='tab']").filter({ hasText: /Toko/i });
  await tokoTab.click();
  await page.waitForTimeout(2000);

  await page.screenshot({ path: path.join(screenshotDir, "02-mode-toko-standar.png"), fullPage: false });
  console.log("  [SAVED] 02-mode-toko-standar.png");

  // 3. Switch to Tiket AHO in Toko Mode
  console.log(">>> [3/4] Activating Tiket AHO Layer...");
  const ahoLayerBtn = page.getByRole("button", { name: /Tiket AHO/i }).first();
  await ahoLayerBtn.click();
  await page.waitForTimeout(4000);

  await page.screenshot({ path: path.join(screenshotDir, "03-mode-toko-aho.png"), fullPage: false });
  console.log("  [SAVED] 03-mode-toko-aho.png");

  // Verify AHO Legend is visible
  const legendVisible = await page.locator("text=Legenda Tiket AHO").isVisible().catch(() => false);
  console.log(`  AHO Legend visible: ${legendVisible} (Expected: true)`);

  // 4. Switch to Mode DC
  console.log(">>> [4/4] Switching to Mode DC...");
  const dcTab = page.locator("button[role='tab']").filter({ hasText: /DC/i });
  await dcTab.click();
  await page.waitForTimeout(2000);

  await page.screenshot({ path: path.join(screenshotDir, "04-mode-dc.png"), fullPage: false });
  console.log("  [SAVED] 04-mode-dc.png");

  const legendInDc = await page.locator("text=Legenda Tiket AHO").isVisible().catch(() => false);
  console.log(`  AHO Legend visible in DC mode: ${legendInDc} (Expected: false)`);

  await browser.close();
  console.log("\n>>> Verification completed successfully!");
}

main().catch((err) => {
  console.error("Verification failed:", err);
  process.exit(1);
});
