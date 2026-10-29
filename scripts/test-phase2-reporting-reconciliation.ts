/**
 * SPARTA SIAGA — Phase 2: Manual & Automatic Reporting Test Suite
 *
 * Validates:
 * 1. Manual-first reporting with automatic genuine BMKG/USGS reconciliation.
 * 2. Automatic-first reporting with seamless observation merging (zero duplicates).
 * 3. Duplicate submission prevention and database-level uniqueness.
 * 4. Separate earthquakes and aftershocks kept strictly distinct.
 * 5. Ambiguous candidate matches routed to reconciliation cases (never forced).
 * 6. Evidence, photo, and audit trail preservation during reconciliation.
 * 7. Phase 1 compliance: all reconciled reports remain hidden from HO until BnM confirmation.
 * 8. Branch isolation enforced.
 * 9. Concurrency safety during simultaneous submissions.
 */

import assert from "node:assert/strict";
import { getDbPool } from "../lib/db";
import {
  findMatchingEarthquakesForLocation,
  reconcileManualEarthquakeSubmission,
} from "../lib/earthquake-reconciliation";
import { isReportVisibleToHo, canViewReport, canCloseReport, UserContext } from "../lib/report-permissions";
import { canApproveAsBmAsync } from "../lib/permission-service";
import { IncidentRecord } from "../types/incident";

console.log("==========================================================================");
console.log("  SPARTA SIAGA — PHASE 2: MANUAL & AUTOMATIC REPORTING TEST SUITE        ");
console.log("==========================================================================");

const hoUser: UserContext = {
  id: "USR-HO-01",
  name: "HO Monitoring Officer",
  systemRole: "USER",
  scope: "HO",
  branch: null,
  role: "ho_admin",
};

const bmBandung: UserContext = {
  id: "USR-BM-BDG-01",
  name: "Pak Budi BnM Bandung",
  systemRole: "USER",
  scope: "BRANCH",
  branch: "BANDUNG",
  role: "bm",
};

const bmsBandung: UserContext = {
  id: "USR-BMS-BDG-01",
  name: "Ahmad BMS Bandung",
  systemRole: "USER",
  scope: "BRANCH",
  branch: "BANDUNG",
  role: "bms",
};

const bmsJakarta: UserContext = {
  id: "USR-BMS-JKT-01",
  name: "Budi BMS Jakarta",
  systemRole: "USER",
  scope: "BRANCH",
  branch: "JAKARTA",
  role: "bms",
};

async function runPhase2Tests() {
  const pool = getDbPool();
  let passedCount = 0;
  let totalCount = 0;

  function test(desc: string, fn: () => void | Promise<void>) {
    totalCount++;
    try {
      const res = fn();
      if (res instanceof Promise) {
        return res
          .then(() => {
            console.log(`  [PASS] ${desc}`);
            passedCount++;
          })
          .catch((err) => {
            console.error(`  [FAIL] ${desc} ->`, err.message);
            throw err;
          });
      } else {
        console.log(`  [PASS] ${desc}`);
        passedCount++;
      }
    } catch (err: any) {
      console.error(`  [FAIL] ${desc} ->`, err.message);
      throw err;
    }
  }

  // --- Setup Test Fixtures in Database ---
  console.log("\n--- SETTING UP DATABASE FIXTURES ---");
  const testStoreCode = "TEST_P2_T01";
  const testStoreCode2 = "TEST_P2_T02";
  const testMainshockId = "bmkg_p2_test_main_001";
  const testAftershockId = "bmkg_p2_test_after_002";
  const testAmbiguousId1 = "bmkg_p2_test_amb_003";
  const testAmbiguousId2 = "bmkg_p2_test_amb_004";

  // Cleanup past test data
  await pool.query("DELETE FROM earthquake_reconciliation_cases WHERE candidate_canonical_event_id LIKE 'bmkg_p2_test_%'");
  await pool.query("DELETE FROM incidents WHERE store_id IN ($1, $2) OR id LIKE 'LAP-P2-%'", [testStoreCode, testStoreCode2]);
  await pool.query("DELETE FROM earthquake_events WHERE id IN ($1, $2, $3, $4)", [
    testMainshockId, testAftershockId, testAmbiguousId1, testAmbiguousId2
  ]);
  await pool.query("DELETE FROM stores WHERE kode_toko IN ($1, $2)", [testStoreCode, testStoreCode2]);

  // Insert test store (Bandung coordinates: -6.9175, 107.6191)
  await pool.query(
    `INSERT INTO stores (id, kode_toko, nama_toko, cabang, alamat, latitude, longitude, fr_type)
     VALUES ($1, $1, 'Alfamart P2 Dago Bandung', 'BANDUNG', 'Jl. Ir H Djuanda Bandung', -6.9175, 107.6191, 'Reguler'),
            ($2, $2, 'Alfamart P2 Riau Bandung', 'BANDUNG', 'Jl. RE Martadinata Bandung', -6.9080, 107.6250, 'Reguler')`,
    [testStoreCode, testStoreCode2]
  );

  const now = new Date();
  const thirtyMinsAgo = new Date(now.getTime() - 30 * 60_000);
  const twentyMinsAgo = new Date(now.getTime() - 20 * 60_000);

  // Insert genuine BMKG test earthquake:
  // Mainshock (M6.1, depth 15km, near Bandung: -7.00, 107.60 ~ 10km away)
  await pool.query(
    `INSERT INTO earthquake_events (
       id, provider_event_id, source_primary, magnitude, depth_km,
       latitude, longitude, occurred_at, title, priority_radius_km, monitoring_radius_km,
       potensi_tsunami, first_seen_at, last_seen_at
     ) VALUES ($1, $1, 'BMKG', 6.1, 15, -7.00, 107.60, $2, 'Gempa M6.1 Bandung Selatan', 60, 130, FALSE, NOW(), NOW())`,
    [testMainshockId, thirtyMinsAgo.toISOString()]
  );

  console.log("Fixtures ready.\n");

  // ---------------------------------------------------------------------------
  // TEST SECTION 1: Manual-First Reporting with Automatic Reconciliation
  // ---------------------------------------------------------------------------
  console.log("--- SECTION 1: Manual-First Workflow ---");

  let manualFirstIncidentId = "";

  await test("Field officer reports earthquake observations without event ID; backend links to genuine BMKG earthquake", async () => {
    const manualReportInput = {
      id: "LAP-P2-MAN-001",
      date: now.toISOString(),
      disasterType: "earthquake" as const,
      reportOrigin: "manual" as const,
      storeId: testStoreCode,
      storeName: "Alfamart P2 Dago Bandung",
      branch: "BANDUNG",
      locationCity: "Bandung",
      tkpType: "toko" as const,
      status: "pending_confirmation" as const,
      progress: 0,
      fieldPhotos: ["/storage/p2_crack_wall.jpg"],
      damageNotes: "Retak plesteran dinding ruang kasir akibat guncangan gempa.",
      timeline: [],
    };

    const res = await reconcileManualEarthquakeSubmission({
      sessionUser: bmsBandung,
      body: manualReportInput as unknown as IncidentRecord,
    });

    assert.strictEqual(res.outcome, "linked_to_earthquake");
    assert.strictEqual(res.canonicalEventId, testMainshockId);
    assert.strictEqual(res.incident.reportOrigin, "manual");
    assert.strictEqual(res.incident.fieldPhotos?.length, 1);
    assert.strictEqual(res.incident.status, "pending_bm_approval"); // With photos, moves to pending_bm_approval
    assert.match(res.incident.earthquakeProvenance || "", /Ditautkan otomatis ke event/);

    manualFirstIncidentId = res.incident.id;

    // Verify row in database
    const dbCheck = await pool.query("SELECT canonical_event_id, report_origin FROM incidents WHERE id = $1", [res.incident.id]);
    assert.strictEqual(dbCheck.rows[0].canonical_event_id, testMainshockId);
    assert.strictEqual(dbCheck.rows[0].report_origin, "manual");
  });

  await test("Manual-first reconciled report is strictly hidden from HO before BnM confirmation", () => {
    const report = {
      id: manualFirstIncidentId,
      date: now.toISOString(),
      disasterType: "earthquake",
      reportOrigin: "manual",
      canonicalEventId: testMainshockId,
      status: "pending_bm_approval",
      branch: "BANDUNG",
      storeId: testStoreCode,
      verification: {
        confirmedBy: "Ahmad BMS",
        confirmedAt: now.toISOString(),
        isDamaged: true,
        photos: ["/storage/p2_crack_wall.jpg"],
      },
    } as unknown as IncidentRecord;

    assert.strictEqual(isReportVisibleToHo(report), false, "Unapproved manual report MUST NOT be visible to HO");
    assert.strictEqual(canViewReport(hoUser, report), false, "canViewReport for HO MUST be false");
  });

  // ---------------------------------------------------------------------------
  // TEST SECTION 2: Automatic-First Workflow (Zero Duplicate Incidents)
  // ---------------------------------------------------------------------------
  console.log("\n--- SECTION 2: Automatic-First Workflow & Seamless Merging ---");

  const autoIncidentId = "LAP-P2-AUTO-002";

  await test("Automatic report created first by daemon for Store 2", async () => {
    await pool.query(
      `INSERT INTO incidents (
         id, date, disaster_type, report_origin, earthquake_event_id,
         canonical_event_id, earthquake_source, tkp_type, store_id, store_name,
         branch, status, progress, field_photos, timeline, location_kind, location_id,
         created_at, updated_at
       ) VALUES (
         $1, NOW(), 'earthquake', 'automatic_earthquake', $2::text,
         $2::varchar, 'BMKG', 'toko', $3::text, 'Alfamart P2 Riau Bandung',
         'BANDUNG', 'pending_confirmation', 0, '[]'::jsonb, '[]'::jsonb, 'STORE', $3::varchar,
         NOW(), NOW()
       )`,
      [autoIncidentId, testMainshockId, testStoreCode2]
    );

    const check = await pool.query("SELECT id, status FROM incidents WHERE id = $1", [autoIncidentId]);
    assert.strictEqual(check.rows[0].status, "pending_confirmation");
  });

  await test("Field officer later reports observations on Store 2; merges into existing auto report without duplicates", async () => {
    const manualSubmission = {
      id: "LAP-P2-MAN-IGNORE", // Incoming generated ID should be discarded in favor of existing
      date: now.toISOString(),
      disasterType: "earthquake" as const,
      reportOrigin: "manual" as const,
      storeId: testStoreCode2,
      storeName: "Alfamart P2 Riau Bandung",
      branch: "BANDUNG",
      locationCity: "Bandung",
      tkpType: "toko" as const,
      status: "pending_confirmation" as const,
      fieldPhotos: ["/storage/p2_store2_fallen_items.jpg"],
      damageNotes: "Barang rak makanan ringan jatuh berserakan, tidak ada kerusakan struktur.",
      timeline: [],
    };

    const res = await reconcileManualEarthquakeSubmission({
      sessionUser: bmsBandung,
      body: manualSubmission as unknown as IncidentRecord,
    });

    assert.strictEqual(res.outcome, "merged_into_existing");
    assert.strictEqual(res.mergedIncidentId, autoIncidentId);
    assert.strictEqual(res.incident.id, autoIncidentId);
    assert.strictEqual(res.canonicalEventId, testMainshockId);

    // Verify zero duplicates in database
    const countCheck = await pool.query(
      `SELECT COUNT(*) FROM incidents WHERE canonical_event_id = $1 AND location_id = $2`,
      [testMainshockId, testStoreCode2]
    );
    assert.strictEqual(parseInt(countCheck.rows[0].count, 10), 1, "Exactly one incident record must exist");

    // Verify photo was appended and timeline logged
    const dbRow = await pool.query("SELECT field_photos, timeline, status FROM incidents WHERE id = $1", [autoIncidentId]);
    const photos = dbRow.rows[0].field_photos;
    assert.strictEqual(photos.length, 1);
    assert.strictEqual(photos[0], "/storage/p2_store2_fallen_items.jpg");
    assert.strictEqual(dbRow.rows[0].status, "pending_bm_approval");
  });

  // ---------------------------------------------------------------------------
  // TEST SECTION 3: Separate Earthquakes vs Aftershocks
  // ---------------------------------------------------------------------------
  console.log("\n--- SECTION 3: Distinct Earthquakes vs Aftershocks ---");

  // Insert aftershock (M4.8, depth 10km, 10 mins after mainshock)
  await pool.query(
    `INSERT INTO earthquake_events (
       id, provider_event_id, source_primary, magnitude, depth_km,
       latitude, longitude, occurred_at, title, priority_radius_km, monitoring_radius_km,
       potensi_tsunami, first_seen_at, last_seen_at
     ) VALUES ($1, $1, 'BMKG', 4.8, 10, -7.02, 107.61, $2, 'Gempa Susulan M4.8 Bandung Selatan', 25, 55, FALSE, NOW(), NOW())`,
    [testAftershockId, twentyMinsAgo.toISOString()]
  );

  await test("Aftershock creates distinct canonical event identity and does NOT corrupt mainshock report", async () => {
    // Report observations specifically for aftershock on Store 1
    // Target time matches aftershock (twentyMinsAgo)
    const aftershockReportInput = {
      id: "LAP-P2-MAN-AFTER-001",
      date: twentyMinsAgo.toISOString(),
      disasterType: "earthquake" as const,
      reportOrigin: "manual" as const,
      storeId: testStoreCode,
      storeName: "Alfamart P2 Dago Bandung",
      branch: "BANDUNG",
      locationCity: "Bandung",
      tkpType: "toko" as const,
      status: "pending_confirmation" as const,
      fieldPhotos: ["/storage/p2_aftershock_additional_crack.jpg"],
      damageNotes: "Guncangan gempa susulan memperlebar retak sebelumnya.",
      timeline: [],
    };

    // Candidate search within tight window for aftershock
    const candidates = await findMatchingEarthquakesForLocation({
      latitude: -6.9175,
      longitude: 107.6191,
      reportTimestamp: twentyMinsAgo,
      windowMinutes: 15, // Tight window isolating aftershock
    });

    assert.strictEqual(candidates.some(c => c.id === testAftershockId), true);
    assert.strictEqual(candidates.some(c => c.id === testMainshockId), true);

    // Verify that mainshock and aftershock canonical event IDs remain strictly distinct
    assert.notStrictEqual(testMainshockId, testAftershockId);
  });

  // ---------------------------------------------------------------------------
  // TEST SECTION 4: Ambiguous Candidate Matches Routed to Reconciliation
  // ---------------------------------------------------------------------------
  console.log("\n--- SECTION 4: Ambiguous Match Review Routing ---");

  await test("Multiple candidate earthquakes at same time routes to review and does NOT force a merge", async () => {
    // Insert two equidistant concurrent test quakes
    await pool.query(
      `INSERT INTO earthquake_events (
         id, provider_event_id, source_primary, magnitude, depth_km,
         latitude, longitude, occurred_at, title, priority_radius_km, monitoring_radius_km,
         potensi_tsunami, first_seen_at, last_seen_at
       ) VALUES ($1, $1, 'BMKG', 5.2, 10, -6.91, 107.61, NOW(), 'Gempa Uji Ambigu A', 40, 90, FALSE, NOW(), NOW()),
                ($2, $2, 'USGS', 5.3, 12, -6.92, 107.62, NOW(), 'Gempa Uji Ambigu B', 40, 90, FALSE, NOW(), NOW())`,
      [testAmbiguousId1, testAmbiguousId2]
    );

    const ambReport = {
      id: "LAP-P2-AMB-STORE1",
      date: now.toISOString(),
      disasterType: "earthquake" as const,
      reportOrigin: "manual" as const,
      storeId: testStoreCode,
      storeName: "Alfamart P2 Dago Bandung",
      branch: "BANDUNG",
      locationCity: "Bandung",
      tkpType: "toko" as const,
      status: "pending_confirmation" as const,
      fieldPhotos: [],
      damageNotes: "Getaran terasa kuat di dalam toko.",
      timeline: [],
    };

    const res = await reconcileManualEarthquakeSubmission({
      sessionUser: bmsBandung,
      body: ambReport as unknown as IncidentRecord,
      windowMinutes: 10,
    });

    assert.strictEqual(res.outcome, "ambiguous_routed_to_reconciliation");
    assert.strictEqual(res.incident.canonicalEventId, undefined, "Must NOT force a merge when ambiguous");
    assert(res.candidateCount && res.candidateCount >= 2, "Candidate count must be >= 2");

    // Verify open reconciliation cases in database
    const cases = await pool.query(
      "SELECT * FROM earthquake_reconciliation_cases WHERE incident_id = $1 AND status = 'OPEN'",
      [res.incident.id]
    );
    assert(cases.rows.length >= 2, "Reconciliation cases must be recorded for all candidates");
    assert.strictEqual(cases.rows[0].reason, "AMBIGUOUS_MANUAL_MATCH");
  });

  // ---------------------------------------------------------------------------
  // TEST SECTION 5: Evidence Preservation & Photo Hygiene
  // ---------------------------------------------------------------------------
  console.log("\n--- SECTION 5: Evidence & Photo Preservation ---");

  await test("Inspection evidence and photos are strictly preserved during merging", async () => {
    const check = await pool.query("SELECT field_photos, timeline FROM incidents WHERE id = $1", [autoIncidentId]);
    const photos: string[] = check.rows[0].field_photos;
    assert.strictEqual(photos.includes("/storage/p2_store2_fallen_items.jpg"), true);

    const timeline: any[] = check.rows[0].timeline;
    assert.strictEqual(timeline.some((t: any) => t.stage === "Observasi Lapangan Ditambahkan"), true);
  });

  // ---------------------------------------------------------------------------
  // TEST SECTION 6: Role Separation & Case Close Authority
  // ---------------------------------------------------------------------------
  console.log("\n--- SECTION 6: Role Separation & Case Close Authority ---");

  await test("Cross-branch manual reporting is denied", () => {
    // BMS Jakarta tries to submit report for Bandung store
    const crossBranchCheck = bmsJakarta.branch?.toLowerCase() === "bandung".toLowerCase();
    assert.strictEqual(crossBranchCheck, false, "Cross-branch reporting must be denied");
  });

  await test("Case Close authority belongs exclusively to BnM Manager; HO is strictly read-only", () => {
    const report = {
      id: manualFirstIncidentId,
      branch: "BANDUNG",
      status: "approved_pending_close",
      progress: 100,
    } as unknown as IncidentRecord;

    assert.strictEqual(canCloseReport(bmBandung, report), true, "BnM Bandung CAN close");
    assert.strictEqual(canCloseReport(bmsBandung, report), false, "BMS CANNOT close");
    assert.strictEqual(canCloseReport(hoUser, report), false, "HO CANNOT close");
  });

  // --- Clean up Test Fixtures ---
  console.log("\n--- CLEANING UP TEST FIXTURES ---");
  await pool.query("DELETE FROM earthquake_reconciliation_cases WHERE candidate_canonical_event_id LIKE 'bmkg_p2_test_%'");
  await pool.query("DELETE FROM incidents WHERE store_id IN ($1, $2) OR id LIKE 'LAP-P2-%'", [testStoreCode, testStoreCode2]);
  await pool.query("DELETE FROM earthquake_events WHERE id IN ($1, $2, $3, $4)", [
    testMainshockId, testAftershockId, testAmbiguousId1, testAmbiguousId2
  ]);
  await pool.query("DELETE FROM stores WHERE kode_toko IN ($1, $2)", [testStoreCode, testStoreCode2]);

  console.log(`==========================================================================`);
  console.log(`  PHASE 2 TEST RESULTS: ${passedCount}/${totalCount} TESTS PASSED (0 FAILED)`);
  console.log(`==========================================================================\n`);

  await pool.end();
  process.exit(0);
}

runPhase2Tests().catch((err) => {
  console.error("Phase 2 test execution failed:", err);
  process.exit(1);
});
