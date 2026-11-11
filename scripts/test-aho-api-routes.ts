import assert from "node:assert/strict";
import { GET as getAhoAggregations } from "../app/api/aho/route";
import { GET as getAhoStoreDetail } from "../app/api/aho/stores/[storeCode]/route";
import { signSession } from "../lib/jwt";
import { dbUpsertUser } from "../lib/user-db";
import { getMaintenanceDbPool } from "../lib/maintenance-aho-db";
import { closeDbPool } from "../lib/db";

async function main() {
  console.log("=== Testing AHO API Routes ===");

  // 1. Unauthenticated request to /api/aho should return 401
  console.log("1. Testing unauthenticated request to /api/aho...");
  const unauthReq = new Request("http://localhost:3004/api/aho");
  const unauthRes = await getAhoAggregations(unauthReq);
  assert.equal(unauthRes.status, 401, "Expected 401 Unauthorized");
  console.log("401 Unauthorized correctly returned without session.");

  // 2. Authenticated request to /api/aho
  console.log("2. Testing authenticated request to /api/aho with valid active user...");
  await dbUpsertUser({
    id: "usr_aho_test",
    nik: "AHO_TEST",
    name: "AHO Test User",
    systemRole: "USER",
    businessRole: "bms",
    scope: "BRANCH",
    branch: "CIKOKOL",
    status: "ACTIVE",
  });

  const token = await signSession({ id: "usr_aho_test", nik: "AHO_TEST", systemRole: "USER" });
  const authReq = new Request("http://localhost:3004/api/aho", {
    headers: { cookie: `siaga_session=${token}` },
  });
  const authRes = await getAhoAggregations(authReq);
  assert.equal(authRes.status, 200, "Expected 200 OK");
  const aggData = await authRes.json();
  assert.equal(aggData.success, true);
  assert(aggData.counts && typeof aggData.counts === "object");
  assert(aggData.totalActiveTickets > 0);
  assert(aggData.totalStoresWithTickets > 0);
  console.log("API /api/aho returned success:", {
    totalStores: aggData.totalStoresWithTickets,
    totalTickets: aggData.totalActiveTickets,
    lastUpdated: aggData.lastUpdated,
  });

  // 3. Authenticated request to /api/aho/stores/[storeCode]
  const sampleCode = Object.keys(aggData.counts)[0];
  console.log(`3. Testing authenticated request to /api/aho/stores/${sampleCode}...`);
  const storeReq = new Request(`http://localhost:3004/api/aho/stores/${sampleCode}`, {
    headers: { cookie: `siaga_session=${token}` },
  });
  const storeRes = await getAhoStoreDetail(storeReq, {
    params: Promise.resolve({ storeCode: sampleCode }),
  });
  assert.equal(storeRes.status, 200, "Expected 200 OK");
  const storeData = await storeRes.json();
  assert.equal(storeData.success, true);
  assert.equal(storeData.data.storeCode, sampleCode.toUpperCase());
  assert(storeData.data.tickets.length > 0);
  assert.equal(storeData.data.personnel.availability, "not_configured");
  console.log("API /api/aho/stores/[storeCode] returned success:", {
    storeCode: storeData.data.storeCode,
    totalActive: storeData.data.totalActive,
    personnel: storeData.data.personnel,
  });

  await getMaintenanceDbPool().end();
  await closeDbPool();
  console.log("ALL API ROUTE TESTS PASSED!");
}

main().catch((err) => {
  console.error("API route test failed:", err);
  process.exit(1);
});
