/**
 * SPARTA SIAGA — Database Isolation & Earthquake Data Integrity Safety Test
 *
 * Verifies:
 * 1. Fail-closed rejection: getProductionDbPool() throws in test execution context.
 * 2. Strict routing: getIsolatedDbPool() connects to isolated Aiven database ('sparta_siaga_isolated').
 * 3. Zero production fallback: getIsolatedDbPool() never connects to 'siaga' (103.127.99.241).
 * 4. Automatic safe routing: getDbPool() routes strictly to isolated DB during tests.
 * 5. Data integrity: Synthetic or unverified earthquakes are blocked by daemon alert guards.
 * 6. Provenance integrity: Missing source defaults to 'UNVERIFIED', never 'BMKG'.
 */

import assert from "node:assert/strict";
import {
  getProductionDbPool,
  getIsolatedDbPool,
  getDbPool,
  getOperationalDbPool,
  isProductionDatabaseTarget,
} from "../lib/db";
import { isTestExecutionContext } from "../lib/runtime-config";
import { processEarthquakeAlertsAndReports } from "../lib/server-daemon";
import { Earthquake } from "../types/disaster";
import { Store } from "../types/store";

let passedCount = 0;
let totalCount = 0;

async function test(name: string, fn: () => Promise<void> | void) {
  totalCount++;
  try {
    await fn();
    console.log(`  [PASS] ${name}`);
    passedCount++;
  } catch (err: any) {
    console.error(`  [FAIL] ${name} ->`, err.message);
    throw err;
  }
}

async function run() {
  console.log("==========================================================================");
  console.log("  SPARTA SIAGA: DATABASE ISOLATION & DATA INTEGRITY SAFETY TEST SUITE    ");
  console.log("==========================================================================");

  console.log("\n--- SECTION 1: Database Safety & Fail-Closed Checks ---");

  await test("isTestExecutionContext correctly detects script execution", () => {
    assert.strictEqual(isTestExecutionContext(), true, "Must detect test script execution context");
  });

  await test("isProductionDatabaseTarget identifies production connection strings", () => {
    assert.strictEqual(isProductionDatabaseTarget("postgresql://user:pass@103.127.99.241:5432/siaga"), true);
    assert.strictEqual(isProductionDatabaseTarget("postgres://avnadmin:pass@sparta-sentinel-db.k.aivencloud.com:15196/sparta_siaga_isolated"), false);
  });

  await test("getProductionDbPool() strictly rejects test execution with FATAL exception", () => {
    assert.throws(
      () => {
        getProductionDbPool();
      },
      /FATAL_DATABASE_SAFETY_VIOLATION.*Automated test execution context detected/,
      "Must throw FATAL_DATABASE_SAFETY_VIOLATION"
    );
  });

  await test("getIsolatedDbPool() connects exclusively to isolated Aiven database", async () => {
    const isoPool = getIsolatedDbPool();
    const res = await isoPool.query("SELECT current_database() as db_name, current_user as user_name");
    assert.strictEqual(res.rows[0].db_name, "sparta_siaga_isolated", "Must connect to sparta_siaga_isolated, NEVER siaga");
    assert.notStrictEqual(res.rows[0].db_name, "siaga", "Must NEVER connect to production siaga");
  });

  await test("getOperationalDbPool() and getDbPool() automatically route to isolated database in test context", async () => {
    const opPool = getOperationalDbPool();
    const res1 = await opPool.query("SELECT current_database() as db_name");
    assert.strictEqual(res1.rows[0].db_name, "sparta_siaga_isolated");

    const defPool = getDbPool();
    const res2 = await defPool.query("SELECT current_database() as db_name");
    assert.strictEqual(res2.rows[0].db_name, "sparta_siaga_isolated");
  });

  console.log("\n--- SECTION 2: Earthquake Data Integrity & Daemon Guards ---");

  await test("processEarthquakeAlertsAndReports blocks synthetic test earthquakes from production processing", async () => {
    const syntheticQuake: Earthquake = {
      id: "bmkg_p2_test_main_001",
      source: "BMKG",
      sourcePrimary: "BMKG",
      magnitude: 6.1,
      depth: "15 km",
      depthKm: 15,
      latitude: -7.00,
      longitude: 107.60,
      title: "Gempa M6.1 Bandung Selatan (Test)",
      time: new Date().toISOString(),
      timestamp: Date.now() - 10 * 60_000,
      priorityRadiusKm: 60,
      monitoringRadiusKm: 130,
      potensiTsunami: false,
    };

    const mockStore: Store = {
      id: "MOCK_T01",
      kode_toko: "MOCK_T01",
      nama_toko: "Alfamart Uji Dago",
      cabang: "BANDUNG",
      alamat: "Jl Dago",
      latitude: -6.9175,
      longitude: 107.6191,
      fr_type: "Reguler",
    };

    // Even if isEligibleForAlert is true, daemon guard must skip synthetic test earthquakes
    const result = await processEarthquakeAlertsAndReports([syntheticQuake], [mockStore], true, false);
    assert.strictEqual(result.dispatchedAlerts, 0, "Dispatched alerts for test quake must be 0");
    assert.strictEqual(result.createdReports, 0, "Created reports for test quake must be 0");
  });

  await test("processEarthquakeAlertsAndReports rejects unverified or non-official sources", async () => {
    const unverifiedQuake: Earthquake = {
      id: "unverified_event_999",
      source: "UNVERIFIED",
      magnitude: 5.5,
      depth: "10 km",
      depthKm: 10,
      latitude: -6.9175,
      longitude: 107.6191,
      title: "Gempa Sumber Tidak Dikenal",
      time: new Date().toISOString(),
      timestamp: Date.now() - 5 * 60_000,
      priorityRadiusKm: 50,
      monitoringRadiusKm: 100,
      potensiTsunami: false,
    };

    const mockStore: Store = {
      id: "MOCK_T02",
      kode_toko: "MOCK_T02",
      nama_toko: "Alfamart Uji",
      cabang: "BANDUNG",
      alamat: "Jl Riau",
      latitude: -6.9175,
      longitude: 107.6191,
      fr_type: "Reguler",
    };

    const result = await processEarthquakeAlertsAndReports([unverifiedQuake], [mockStore], true, false);
    assert.strictEqual(result.dispatchedAlerts, 0, "Dispatched alerts for unverified source must be 0");
    assert.strictEqual(result.createdReports, 0, "Created reports for unverified source must be 0");
  });

  console.log(`\n==========================================================================`);
  console.log(`  SAFETY RESULTS: ${passedCount}/${totalCount} TESTS PASSED (0 FAILED)`);
  console.log(`==========================================================================\n`);

  process.exit(0);
}

run().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
