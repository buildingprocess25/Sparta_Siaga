 import assert from "node:assert/strict";
import {
  getMasterAhoAggregations,
  getMasterAhoTicketsByStore,
  getStorePersonnel,
  getAhoStoreDetail,
  getMaintenanceDbPool,
} from "../lib/maintenance-aho-db";
import {
  getAhoColor,
  calculateAhoPercentage,
  formatAhoBadgeLabel,
} from "../lib/aho-utils";

async function main() {
  console.log("=== Testing Maintenance AHO Database Service & Logic ===");

  // 1. Test Aggregation Query & Cache
  console.log("1. Fetching master aggregations...");
  const t0 = Date.now();
  const agg1 = await getMasterAhoAggregations(true);
  const d0 = Date.now() - t0;
  console.log(`Aggregation fetched in ${d0}ms. Total active tickets: ${agg1.totalActiveTickets}, stores with tickets: ${agg1.totalStoresWithTickets}`);
  assert(agg1.totalStoresWithTickets > 0, "Expected at least 1 store with tickets");
  assert(agg1.totalActiveTickets >= agg1.totalStoresWithTickets, "Total tickets should be >= stores with tickets");

  // Test caching (2nd call should be < 5ms)
  const t1 = Date.now();
  const agg2 = await getMasterAhoAggregations(false);
  const d1 = Date.now() - t1;
  console.log(`Cached aggregation retrieved in ${d1}ms.`);
  assert(d1 < 10, "Cached aggregation should be retrieved instantly from memory");
  assert.equal(agg2.totalActiveTickets, agg1.totalActiveTickets, "Cached data should match");

  // 2. Test Store Ticket Details
  const sampleStoreCode = Object.keys(agg1.counts)[0];
  console.log(`2. Testing ticket details for sample store: ${sampleStoreCode}...`);
  const storeDetail = await getAhoStoreDetail(sampleStoreCode);
  console.log(`Store ${sampleStoreCode} has ${storeDetail.totalActive} active tickets.`);
  assert.equal(storeDetail.storeCode, sampleStoreCode.toUpperCase());
  assert.equal(storeDetail.totalActive, storeDetail.tickets.length);
  assert(storeDetail.tickets.length > 0, "Expected tickets for store");
  const firstTicket = storeDetail.tickets[0];
  console.log("Sample ticket:", {
    problemNo: firstTicket.problemNo,
    status: firstTicket.status,
    branchCode: firstTicket.branchCode,
    branchName: firstTicket.branchName,
    updatedAt: firstTicket.updatedAt,
  });
  assert(firstTicket.problemNo, "problemNo must be present");
  assert(["New", "Progress"].includes(firstTicket.status), "Status must be New or Progress");

  // 3. Test Personnel Contract (Kondisi A)
  console.log("3. Testing personnel contract...");
  const personnel = await getStorePersonnel(sampleStoreCode);
  assert.equal(personnel.availability, "not_configured");
  assert.equal(personnel.bms, null);
  assert.equal(personnel.bmc, null);
  assert.equal(personnel.bnmManager, null);
  assert(personnel.message.includes("Data belum tersedia"));
  console.log("Personnel contract verified (Kondisi A):", personnel);

  // 4. Test Store without tickets
  console.log("4. Testing store with no tickets (e.g. NON_EXISTENT_STORE_XYZ)...");
  const emptyStore = await getAhoStoreDetail("NON_EXISTENT_STORE_XYZ");
  assert.equal(emptyStore.totalActive, 0);
  assert.equal(emptyStore.tickets.length, 0);
  assert.equal(emptyStore.personnel.availability, "not_configured");
  console.log("Empty store handled cleanly:", emptyStore);

  // 5. Test AHO Color Thresholds & Percentages
  console.log("5. Testing color thresholds and percentage formulas...");
  // > 70% -> Merah
  assert.equal(getAhoColor(75).color, "#dc2626");
  assert.equal(getAhoColor(70.01).color, "#dc2626");
  // 50 - 70% -> Oranye
  assert.equal(getAhoColor(70).color, "#f97316");
  assert.equal(getAhoColor(50).color, "#f97316");
  // 20 - <50% -> Kuning
  assert.equal(getAhoColor(49.9).color, "#facc15");
  assert.equal(getAhoColor(20).color, "#facc15");
  // < 20% -> Hijau
  assert.equal(getAhoColor(19.99).color, "#16a34a");
  assert.equal(getAhoColor(0).color, "#16a34a");

  // Percentage formula test (Total toko: 100, bertiket: 23, total tiket: 38 -> persentase 23%, bukan 38%)
  const pct = calculateAhoPercentage(100, 23);
  assert.equal(pct, 23);
  const badgeLabel = formatAhoBadgeLabel(100, 23);
  assert.equal(badgeLabel, "23% (23/100)");
  console.log("Badge label verified:", badgeLabel);

  await getMaintenanceDbPool().end();
  console.log("ALL TESTS PASSED SUCCESSFULLY!");
}

main().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
