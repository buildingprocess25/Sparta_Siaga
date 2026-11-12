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
import { GET as getAhoAggregationsRoute } from "../app/api/aho/route";
import { GET as getAhoStoreDetailRoute } from "../app/api/aho/stores/[storeCode]/route";
import { signSession } from "../lib/jwt";
import { dbUpsertUser } from "../lib/user-db";
import { closeDbPool } from "../lib/db";

async function runComprehensiveTests() {
  console.log("=================================================================");
  console.log("SPARTA SIAGA — PETA MONITORING LAYER TIKET AHO COMPREHENSIVE QA");
  console.log("=================================================================\n");

  // ---------------------------------------------------------------------------
  // A. Database Connection & Pooling Tests
  // ---------------------------------------------------------------------------
  console.log(">>> [SECTION A] Database Connection, Pooling & Security Constraints");
  const pool = getMaintenanceDbPool();
  assert(pool, "Maintenance database pool must exist");

  // Verify pool options without logging credentials
  // @ts-ignore
  const poolOptions = pool.options;
  assert.equal(poolOptions.max, 2, "Pool max connections must be strictly 2");
  assert.equal(poolOptions.connectionTimeoutMillis, 5000, "Connection timeout must be 5000ms");
  assert.equal(poolOptions.statement_timeout, 10000, "Statement timeout must be 10000ms");
  console.log(" [PASS] Dedicated pool created with max: 2, connectionTimeout: 5s, queryTimeout: 10s.");

  // Test read-only query execution
  const client = await pool.connect();
  try {
    const permTest = await client.query(`
      SELECT table_name, privilege_type 
      FROM information_schema.table_privileges 
      WHERE table_name = 'MasterAhoTicket' AND grantee = 'siaga_aho_reader';
    `);
    const privileges = permTest.rows.map((r) => r.privilege_type);
    console.log(" [INFO] siaga_aho_reader privileges on MasterAhoTicket:", privileges.join(", "));
    assert(privileges.includes("SELECT"), "Must have SELECT privilege on MasterAhoTicket");
    assert(!privileges.includes("INSERT"), "Must NOT have INSERT privilege");
    assert(!privileges.includes("UPDATE"), "Must NOT have UPDATE privilege");
    assert(!privileges.includes("DELETE"), "Must NOT have DELETE privilege");
    console.log(" [PASS] Read-only privilege confirmed: only SELECT granted.");
  } finally {
    client.release();
  }

  // ---------------------------------------------------------------------------
  // B. Aggregation Query & Cache (5-Minute TTL)
  // ---------------------------------------------------------------------------
  console.log("\n>>> [SECTION B] Aggregation Query & Server-Side 5-Minute Cache");
  const t0 = Date.now();
  const aggData1 = await getMasterAhoAggregations(true);
  const dur1 = Date.now() - t0;
  console.log(` [PASS] Live query executed in ${dur1}ms.`);
  console.log(`        - Total stores with active tickets : ${aggData1.totalStoresWithTickets}`);
  console.log(`        - Total active tickets             : ${aggData1.totalActiveTickets}`);
  console.log(`        - Latest ticket update timestamp   : ${aggData1.lastUpdated}`);
  assert(aggData1.totalStoresWithTickets > 0, "Expected > 0 stores with tickets");
  assert(aggData1.totalActiveTickets >= aggData1.totalStoresWithTickets, "Total tickets >= stores count");

  // Verify memory cache
  const t2 = Date.now();
  const aggData2 = await getMasterAhoAggregations(false);
  const dur2 = Date.now() - t2;
  console.log(` [PASS] In-memory cache hit executed in ${dur2}ms.`);
  assert(dur2 <= 5, "Cached retrieval should be under 5ms");
  assert.equal(aggData2.totalActiveTickets, aggData1.totalActiveTickets, "Cached data must match fresh data");

  // ---------------------------------------------------------------------------
  // C. Store Detail & Personnel Contract (Kondisi A vs Kondisi B)
  // ---------------------------------------------------------------------------
  console.log("\n>>> [SECTION C] Store Detail & Personnel Resolution (Kondisi A)");
  const sampleStore = Object.keys(aggData1.counts)[0];
  const detail = await getAhoStoreDetail(sampleStore);

  console.log(` [PASS] Store detail retrieved for [${sampleStore}]:`);
  console.log(`        - Active tickets count : ${detail.totalActive}`);
  console.log(`        - Sample ticket problemNo: ${detail.tickets[0]?.problemNo}`);
  console.log(`        - Sample ticket status   : ${detail.tickets[0]?.status}`);
  console.log(`        - Sample ticket branch   : ${detail.tickets[0]?.branchName || detail.tickets[0]?.branchCode}`);
  assert(detail.tickets.length > 0, "Sample store must have tickets");
  assert(["New", "Progress"].includes(detail.tickets[0].status), "Status must be New or Progress");

  // Personnel contract check
  console.log(" [PASS] Personnel contract (Kondisi A - Hak akses belum diperluas):");
  assert.equal(detail.personnel.availability, "not_configured");
  assert.equal(detail.personnel.bms, null);
  assert.equal(detail.personnel.bmc, null);
  assert.equal(detail.personnel.bnmManager, null);
  assert(detail.personnel.message.includes("Data belum tersedia"));
  console.log(`        - Personnel availability : ${detail.personnel.availability}`);
  console.log(`        - BMS                    : ${detail.personnel.bms ?? "Data belum tersedia"}`);
  console.log(`        - BMC                    : ${detail.personnel.bmc ?? "Data belum tersedia"}`);
  console.log(`        - BnM Manager            : ${detail.personnel.bnmManager ?? "Data belum tersedia"}`);

  // Store without active tickets
  const emptyDetail = await getAhoStoreDetail("STORE_SAFE_NO_TICKET_999");
  console.log(" [PASS] Store with 0 active tickets handled gracefully:");
  assert.equal(emptyDetail.totalActive, 0);
  assert.equal(emptyDetail.tickets.length, 0);
  assert.equal(emptyDetail.personnel.availability, "not_configured");
  console.log(`        - Tickets array: empty (0 active)`);
  console.log(`        - Personnel contract still present`);

  // ---------------------------------------------------------------------------
  // D. Percentage Formula & Color Thresholds
  // ---------------------------------------------------------------------------
  console.log("\n>>> [SECTION D] Percentage Formula & Color Thresholds (siaga-aho-map-guide.md)");
  // Formula: (Toko bertiket / Total toko) * 100%
  // Example from guide: Total: 100, Bertiket: 23, Total tiket: 38 -> Result: 23%, NOT 38%
  const pct1 = calculateAhoPercentage(100, 23);
  assert.equal(pct1, 23, "Percentage must be 23% based on distinct stores with tickets");
  const label1 = formatAhoBadgeLabel(100, 23);
  assert.equal(label1, "23% (23/100)", "Label format must be 23% (23/100)");
  console.log(` [PASS] Calculation formula: 23/100 = ${pct1}% (Label: ${label1})`);

  // Color thresholds (Section 9 Restored Standard AHO Palette):
  // > 70%     : Red    (#dc2626)
  // 50% - 70% : Orange (#f97316)
  // 20% - <50%: Yellow (#facc15)
  // < 20%     : Green  (#16a34a)
  assert.equal(getAhoColor(71).color, "#dc2626");
  assert.equal(getAhoColor(70.001).color, "#dc2626");
  assert.equal(getAhoColor(70).color, "#f97316");
  assert.equal(getAhoColor(50).color, "#f97316");
  assert.equal(getAhoColor(49.99).color, "#facc15");
  assert.equal(getAhoColor(20).color, "#facc15");
  assert.equal(getAhoColor(19.99).color, "#16a34a");
  assert.equal(getAhoColor(0).color, "#16a34a");
  console.log(" [PASS] All color boundary thresholds verified: >70% Red (#dc2626), 50-70% Orange (#f97316), 20-<50% Yellow (#facc15), <20% Green (#16a34a).");

  // ---------------------------------------------------------------------------
  // E. Authenticated API Endpoints
  // ---------------------------------------------------------------------------
  console.log("\n>>> [SECTION E] Authenticated API Endpoints (/api/aho & /api/aho/stores/[storeCode])");
  // 1. Unauthenticated -> 401
  const unauthRes = await getAhoAggregationsRoute(new Request("http://localhost:3004/api/aho"));
  assert.equal(unauthRes.status, 401, "Expected 401 for unauthenticated request");
  console.log(" [PASS] GET /api/aho without cookie returns 401 Unauthorized.");

  // 2. Authenticated -> 200
  await dbUpsertUser({
    id: "usr_qa_aho",
    nik: "QA_AHO_01",
    name: "QA AHO Tester",
    systemRole: "USER",
    businessRole: "bms",
    scope: "BRANCH",
    branch: "CIKOKOL",
    status: "ACTIVE",
  });
  const token = await signSession({ id: "usr_qa_aho", nik: "QA_AHO_01", systemRole: "USER" });

  const authRes = await getAhoAggregationsRoute(
    new Request("http://localhost:3004/api/aho", {
      headers: { cookie: `siaga_session=${token}` },
    })
  );
  assert.equal(authRes.status, 200, "Expected 200 OK");
  const authPayload = await authRes.json();
  assert.equal(authPayload.success, true);
  assert(authPayload.totalActiveTickets > 0);
  console.log(" [PASS] GET /api/aho with valid session returns 200 OK and valid JSON.");

  // 3. Store detail endpoint
  const storeRes = await getAhoStoreDetailRoute(
    new Request(`http://localhost:3004/api/aho/stores/${sampleStore}`, {
      headers: { cookie: `siaga_session=${token}` },
    }),
    { params: Promise.resolve({ storeCode: sampleStore }) }
  );
  assert.equal(storeRes.status, 200, "Expected 200 OK");
  const storePayload = await storeRes.json();
  assert.equal(storePayload.success, true);
  assert.equal(storePayload.data.storeCode, sampleStore.toUpperCase());
  assert.equal(storePayload.data.personnel.availability, "not_configured");
  console.log(` [PASS] GET /api/aho/stores/${sampleStore} returns 200 OK with tickets & personnel.`);

  // ---------------------------------------------------------------------------
  // Clean up
  // ---------------------------------------------------------------------------
  await pool.end();
  await closeDbPool();

  console.log("\n=================================================================");
  console.log("ALL AHO INTEGRATION & SECURITY TESTS PASSED WITH 100% SUCCESS!");
  console.log("=================================================================\n");
}

runComprehensiveTests().catch((err) => {
  console.error("FATAL ERROR IN COMPREHENSIVE TESTS:", err);
  process.exit(1);
});

