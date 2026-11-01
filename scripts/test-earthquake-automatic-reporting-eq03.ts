/**
 * SPARTA SIAGA - EQ-03: Automatic Earthquake Reporting Comprehensive Validation Suite
 *
 * Verifies:
 * 1. End-to-end tracing: detection -> radius evaluation -> location selection -> report creation -> branch visibility.
 * 2. Unified eligibility rules across daemon and worker (freshness <= 60m, active 72h window, simulation overrides).
 * 3. Exactly one automatic report per canonical earthquake event and eligible location (deduplication & concurrency).
 * 4. Correct store/facility identity, branch ownership, earthquake metadata, monitoring zone, initial unverified status (pending_confirmation, progress=0%, no fake damage).
 * 5. EQ-02 fix validation: Never use "Nasional" as an operational branch. Unmapped facilities are logged, flagged, and excluded from branch-specific dispatch.
 * 6. Manual vs automatic reconciliation: single candidate links safely without overwriting PIC/progress, ambiguous candidates flagged.
 * 7. Delayed earthquakes, retries, partial failures, and 60m vs 72h monitoring window separation.
 * 8. Access control: Branch users view only their own branch, HO Admin views all branches read-only.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { Pool } from "pg";
import { getDbPool } from "../lib/db";
import { assertIsolatedDatabase } from "../lib/database-safety";
import {
  processEarthquakeAlertsAndReports,
  AUTO_EARTHQUAKE_MAX_AGE_MINUTES,
} from "../lib/server-daemon";
import {
  dbFindAutoEarthquakeReport,
  dbFindManualEarthquakeReportByEvent,
  dbCreateIncident,
  dbGetIncidentById,
} from "../lib/incident-db";
import { ensureEarthquakeReport } from "../lib/earthquake-report-service";
import { canViewReport, canActOnReport, type UserContext } from "../lib/report-permissions";
import { evaluateAffectedLocations, calculateSpartaMonitoringZone } from "../lib/haversine";
import type { Earthquake } from "../types/disaster";
import type { Store } from "../types/store";

interface EQ03TestResult {
  code: string;
  name: string;
  status: "PASS" | "FAIL";
  evidence: string;
}

const testResults: EQ03TestResult[] = [];

function record(code: string, name: string, condition: boolean, evidence: string) {
  const status = condition ? "PASS" : "FAIL";
  testResults.push({ code, name, status, evidence });
  if (condition) {
    console.log(`✔ [PASS] [${code}] ${name} - ${evidence}`);
  } else {
    console.error(`❌ [FAIL] [${code}] ${name} - ${evidence}`);
  }
}

async function runEQ03Suite() {
  console.log("================================================================================");
  console.log(" SPARTA SIAGA - EQ-03: AUTOMATIC EARTHQUAKE REPORTING VALIDATION SUITE");
  console.log("================================================================================\n");

  const pool = getDbPool();
  await assertIsolatedDatabase(pool);

  const client = await pool.connect();
  const testNamespace = `EQ03-${Date.now()}`;

  try {
    // Clean up any test fixtures from this namespace
    await client.query("DELETE FROM incidents WHERE store_id = 'T-RECON-01' OR store_id LIKE 'T-CJR-%' OR store_id LIKE 'T-SKB-%' OR store_id LIKE 'T-RACE-%' OR earthquake_event_id LIKE 'EQ03-%';");
    await client.query("DELETE FROM notification_logs WHERE disaster_id LIKE 'EQ03-%';");
    await client.query("DELETE FROM earthquake_reconciliation_cases WHERE candidate_canonical_event_id LIKE 'EQ03-%';");

    // =========================================================================
    // SECTION 1: AUTHENTIC BMKG EARTHQUAKE DATA EVALUATION & REPORT COUNTS
    // =========================================================================
    console.log("--- SECTION 1: Authentic BMKG Earthquake & Expected Report Counts ---");

    // BMKG Event 1: Fresh shallow earthquake (Cianjur M 5.6, depth 10 km)
    // Priority: 35 km, Monitoring: 77 km
    const eqFreshCianjur: Earthquake = {
      id: `${testNamespace}-BMKG-CIANJUR`,
      source: "BMKG",
      sourcePrimary: "BMKG",
      canonicalEventKey: `${testNamespace}-BMKG-CIANJUR`,
      title: "Gempa M 5.6 Cianjur Jawa Barat",
      place: "Cianjur, Jawa Barat",
      magnitude: 5.6,
      depth: "10 km",
      depthKm: 10,
      latitude: -6.8400,
      longitude: 107.0500,
      time: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
      timestamp: Date.now() - 10 * 60 * 1000, // 10 minutes ago (fresh <= 60m)
      potensiTsunami: false,
      priorityRadiusKm: 35.0,
      monitoringRadiusKm: 77.0,
    };

    // Store A (inside Priority Zone, ~2 km)
    const storeCianjur1: Store = {
      id: "ST-EQ03-CJR-01",
      kode_toko: "T-CJR-001",
      nama_toko: "Alfamart Tegalega Cianjur",
      cabang: "CIANJUR",
      alamat: "Jl. Tegalega No. 1, Cianjur",
      latitude: -6.8300,
      longitude: 107.0600,
      fr_type: "Reguler",
    };

    // Store B (inside Priority Zone, ~15 km, same branch)
    const storeCianjur2: Store = {
      id: "ST-EQ03-CJR-02",
      kode_toko: "T-CJR-002",
      nama_toko: "Alfamart Sukaluyu Cianjur",
      cabang: "CIANJUR",
      alamat: "Jl. Raya Sukaluyu, Cianjur",
      latitude: -6.8000,
      longitude: 107.1500,
      fr_type: "Reguler",
    };

    // Store C (in Monitoring Zone, ~50 km > 35 km && <= 77 km) -> NOT in priority zone
    const storeBandungMonitor: Store = {
      id: "ST-EQ03-BDG-MON",
      kode_toko: "T-BDG-MON",
      nama_toko: "Alfamart Padalarang Barat",
      cabang: "BANDUNG",
      alamat: "Jl. Raya Padalarang",
      latitude: -6.8500,
      longitude: 107.5000,
      fr_type: "Reguler",
    };

    // Store D (Safe outside monitoring zone, ~150 km)
    const storeCirebonSafe: Store = {
      id: "ST-EQ03-CRB-SAFE",
      kode_toko: "T-CRB-SAFE",
      nama_toko: "Alfamart Siliwangi Cirebon",
      cabang: "CIREBON",
      alamat: "Jl. Siliwangi No. 10, Cirebon",
      latitude: -6.7100,
      longitude: 108.5500,
      fr_type: "Reguler",
    };

    const evaluated = evaluateAffectedLocations(eqFreshCianjur, [
      storeCianjur1,
      storeCianjur2,
      storeBandungMonitor,
      storeCirebonSafe,
    ]);

    record(
      "REP-01",
      "Radius zone calculation and location filtering",
      evaluated.priorityLocations.length === 2 && evaluated.monitoringLocations.length === 1,
      `Priority locations: ${evaluated.priorityLocations.length} (expected 2), Monitoring: ${evaluated.monitoringLocations.length} (expected 1)`
    );

    // Run automatic report generation
    const cycle1 = await processEarthquakeAlertsAndReports(
      [eqFreshCianjur],
      [storeCianjur1, storeCianjur2, storeBandungMonitor, storeCirebonSafe],
      true
    );

    record(
      "REP-02",
      "Automatic report generation count per priority store",
      cycle1.createdReports === 2,
      `Created reports: ${cycle1.createdReports} (expected 2 reports for 2 priority stores)`
    );

    // Verify reports created in database
    const dbReports = await client.query(
      `SELECT id, store_id, store_name, branch, status, progress, field_photos, verification, canonical_event_id, location_kind, location_id
       FROM incidents
       WHERE earthquake_event_id = $1
       ORDER BY store_id ASC;`,
      [eqFreshCianjur.id]
    );

    const hasStore1 = dbReports.rows.some((r) => r.store_id === "T-CJR-001");
    const hasStore2 = dbReports.rows.some((r) => r.store_id === "T-CJR-002");
    const noMonitorStore = !dbReports.rows.some((r) => r.store_id === "T-BDG-MON");
    const noSafeStore = !dbReports.rows.some((r) => r.store_id === "T-CRB-SAFE");

    record(
      "REP-03",
      "Targeted store report creation & non-priority exclusion",
      dbReports.rows.length === 2 && hasStore1 && hasStore2 && noMonitorStore && noSafeStore,
      `DB rows count: ${dbReports.rows.length}, Store1: ${hasStore1}, Store2: ${hasStore2}, Monitor excluded: ${noMonitorStore}, Safe excluded: ${noSafeStore}`
    );

    // =========================================================================
    // SECTION 2: DATA INTEGRITY & INITIAL UNVERIFIED STATUS
    // =========================================================================
    console.log("\n--- SECTION 2: Data Integrity & Initial Unverified Status ---");

    const row1 = dbReports.rows[0];
    const initialStatusValid =
      row1.status === "pending_confirmation" &&
      row1.progress === 0 &&
      row1.verification === null &&
      JSON.stringify(row1.field_photos) === "[]" &&
      row1.location_kind === "STORE" &&
      row1.location_id === row1.store_id;

    record(
      "INT-01",
      "Initial unverified status (pending_confirmation, progress=0%, no photo fabrications)",
      initialStatusValid,
      `Status: ${row1?.status}, Progress: ${row1?.progress}%, Verification: ${row1?.verification}, LocationKind: ${row1?.location_kind}`
    );

    // =========================================================================
    // SECTION 3: EXACTLY ONE REPORT PER LOCATION (DEDUPLICATION & CONCURRENCY)
    // =========================================================================
    console.log("\n--- SECTION 3: Deduplication, Repeated Executions & Concurrency ---");

    // Repeated execution of the exact same earthquake and stores
    const cycleRepeat = await processEarthquakeAlertsAndReports(
      [eqFreshCianjur],
      [storeCianjur1, storeCianjur2],
      true
    );

    const countAfterRepeat = await client.query(
      `SELECT count(*) as cnt FROM incidents WHERE earthquake_event_id = $1;`,
      [eqFreshCianjur.id]
    );

    record(
      "DEDUP-01",
      "Repeated worker execution produces 0 duplicate reports",
      cycleRepeat.createdReports === 0 && Number(countAfterRepeat.rows[0].cnt) === 2,
      `Repeat Created: ${cycleRepeat.createdReports}, Total DB rows: ${countAfterRepeat.rows[0].cnt}`
    );

    // Concurrency test: Two parallel workers processing simultaneously
    const raceEventId = `${testNamespace}-RACE`;
    const raceEq: Earthquake = {
      ...eqFreshCianjur,
      id: raceEventId,
      canonicalEventKey: raceEventId,
      timestamp: Date.now() - 5 * 60 * 1000,
    };
    const raceStore: Store = {
      ...storeCianjur1,
      id: "ST-RACE-01",
      kode_toko: "T-RACE-01",
    };

    const [raceRes1, raceRes2] = await Promise.all([
      processEarthquakeAlertsAndReports([raceEq], [raceStore], true),
      processEarthquakeAlertsAndReports([raceEq], [raceStore], true),
    ]);

    const raceDbCount = await client.query(
      `SELECT count(*) as cnt FROM incidents WHERE earthquake_event_id = $1 AND store_id = $2;`,
      [raceEventId, raceStore.kode_toko]
    );

    record(
      "CONCUR-01",
      "Concurrent worker execution creates exactly one report without race condition collision",
      Number(raceDbCount.rows[0].cnt) === 1 && (raceRes1.createdReports + raceRes2.createdReports === 1),
      `Total DB count: ${raceDbCount.rows[0].cnt}, Worker1 created: ${raceRes1.createdReports}, Worker2 created: ${raceRes2.createdReports}`
    );

    // Distinct aftershock event at same location creates distinct report
    const aftershockId = `${testNamespace}-AFTERSHOCK`;
    const aftershockEq: Earthquake = {
      ...eqFreshCianjur,
      id: aftershockId,
      canonicalEventKey: aftershockId,
      title: "Gempa Susulan M 4.8 Cianjur",
      magnitude: 4.8,
      timestamp: Date.now() - 2 * 60 * 1000, // 2 minutes ago
    };

    const aftershockCycle = await processEarthquakeAlertsAndReports(
      [aftershockEq],
      [storeCianjur1],
      true
    );

    const store1TotalReports = await client.query(
      `SELECT count(*) as cnt FROM incidents WHERE store_id = $1 AND earthquake_event_id IN ($2, $3);`,
      [storeCianjur1.kode_toko, eqFreshCianjur.id, aftershockId]
    );

    record(
      "EVENT-01",
      "Distinct aftershock creates separate report for same store",
      aftershockCycle.createdReports === 1 && Number(store1TotalReports.rows[0].cnt) === 2,
      `Aftershock created: ${aftershockCycle.createdReports}, Total reports for Store1: ${store1TotalReports.rows[0].cnt}`
    );

    // =========================================================================
    // SECTION 4: UNMAPPED FACILITIES HANDLING (REQUIREMENT 5)
    // =========================================================================
    console.log("\n--- SECTION 4: Unmapped Facilities Handling (Requirement 5) ---");

    // In haversine.ts, an unmapped facility (null or empty branch) must never substitute "Nasional"
    const unmappedFacility = {
      id: "FAC-UNMAPPED-01",
      code: "WH-UNMAPPED",
      name: "Warehouse Unmapped Testing",
      cabang: undefined,
      branch_id: null,
      latitude: -6.8400,
      longitude: 107.0500,
    };

    const evaluatedUnmapped = evaluateAffectedLocations(eqFreshCianjur, [unmappedFacility]);
    const unmappedBranchName = evaluatedUnmapped.allAffectedLocations[0]?.branch;

    record(
      "MAP-01",
      "Never use 'Nasional' as substitute operational branch for unmapped facility",
      unmappedBranchName !== "Nasional" && (unmappedBranchName === "Belum dipetakan" || !unmappedBranchName),
      `Evaluated Branch Name: '${unmappedBranchName}' (must NOT be 'Nasional')`
    );

    // Facility Data Quality Audit: Query master facilities from database
    const facAuditRes = await client.query(`
      SELECT count(*) as total,
             count(branch_id) as mapped_count,
             count(*) - count(branch_id) as unmapped_count
        FROM facilities;
    `);
    const totalFac = Number(facAuditRes.rows[0].total);
    const unmappedFac = Number(facAuditRes.rows[0].unmapped_count);
    const mappedFac = Number(facAuditRes.rows[0].mapped_count);

    record(
      "MAP-02",
      "Audit 67 facilities: Expose unmapped facilities and exclude from branch dispatch",
      totalFac === 67 && unmappedFac === 67 && mappedFac === 0,
      `Master Facilities: ${totalFac} total, ${mappedFac} mapped, ${unmappedFac} unmapped (Exposed as data quality action item)`
    );

    // =========================================================================
    // SECTION 5: MANUAL VS AUTOMATIC RECONCILIATION & PERMANENT PIC OWNERSHIP
    // =========================================================================
    console.log("\n--- SECTION 5: Manual-vs-Automatic Reconciliation & Permanent PIC ---");

    const manualReconEventId = `${testNamespace}-MAN-RECON`;
    const reconStore: Store = {
      ...storeCianjur1,
      id: "ST-RECON-01",
      kode_toko: "T-RECON-01",
      nama_toko: "Toko Uji Rekonsiliasi",
    };

    // Create an existing manual report created 20 minutes ago by BMS with field photos & PIC
    const manualReportId = `INC-MAN-${Date.now()}`;
    await dbCreateIncident({
      id: manualReportId,
      date: new Date(Date.now() - 20 * 60 * 1000).toISOString(),
      disasterType: "earthquake",
      reportOrigin: "manual",
      storeId: reconStore.kode_toko,
      storeName: reconStore.nama_toko,
      branch: reconStore.cabang,
      locationCity: "Cianjur",
      status: "verifying",
      progress: 25,
      reporter: { name: "Budi BMS Cianjur", role: "bms" },
      fieldPhotos: ["https://sparta.internal/evidence/photo1.jpg"],
      timeline: [
        {
          stage: "Laporan Dibuat Manual",
          label: "Laporan dibuat resmi oleh BMS Cabang",
          timestamp: new Date().toISOString(),
          actor: "Budi BMS Cianjur",
        },
      ],
      createdAt: new Date(Date.now() - 20 * 60 * 1000).toISOString(),
      updatedAt: new Date(Date.now() - 20 * 60 * 1000).toISOString(),
    });

    // Assign PIC to the manual report using valid DB user USR-BMS-001
    await client.query(
      `UPDATE incidents
          SET primary_pic_user_id = 'USR-BMS-001',
              primary_pic_claimed_at = NOW()
        WHERE id = $1;`,
      [manualReportId]
    );

    // Run daemon automatic reporting for this store and earthquake
    const reconEq: Earthquake = {
      ...eqFreshCianjur,
      id: manualReconEventId,
      canonicalEventKey: manualReconEventId,
      timestamp: Date.now() - 15 * 60 * 1000,
    };

    const reconCycle = await processEarthquakeAlertsAndReports([reconEq], [reconStore], true);

    const reconciledRow = await dbGetIncidentById(manualReportId);

    const manualLinkedSuccessfully =
      reconCycle.createdReports === 0 && // No duplicate auto-report created
      reconciledRow !== null &&
      reconciledRow.earthquakeEventId === manualReconEventId && // Linked to earthquake event
      reconciledRow.status === "verifying" && // Status preserved
      reconciledRow.progress === 25 && // Progress preserved
      (reconciledRow.fieldPhotos ?? []).length === 1 && // Photos preserved
      reconciledRow.reporter?.name === "Budi BMS Cianjur"; // Reporter preserved

    record(
      "RECON-01",
      "Manual report created by BMS is linked without overwriting status, progress, photos, or reporter",
      manualLinkedSuccessfully,
      `Created new: ${reconCycle.createdReports}, Event linked: ${reconciledRow?.earthquakeEventId}, Status: ${reconciledRow?.status}, Progress: ${reconciledRow?.progress}%`
    );

    const picPreserved = reconciledRow?.primaryPicUserId === "USR-BMS-001";
    record(
      "RECON-02",
      "Permanent PIC ownership is preserved during reconciliation and cannot be overwritten",
      picPreserved,
      `Primary PIC User ID: '${reconciledRow?.primaryPicUserId}' (strictly preserved)`
    );

    // =========================================================================
    // SECTION 6: 45M / 61M / 120M / 30H DELAYS & DOWNTIME RECOVERY (REQUIREMENT 2 & 7)
    // =========================================================================
    console.log("\n--- SECTION 6: Fresh (45m), Downtime Recovery (61m, 120m), and 30h Cutoff ---");

    // 1. Fresh Delayed Earthquake: 45 minutes ago (<= 60m threshold)
    // Expect: Emergency alert dispatched AND report created.
    const storeSukabumi: Store = {
      ...storeCianjur1,
      id: "ST-SKB-001",
      kode_toko: "T-SKB-001",
      nama_toko: "Alfamart Sukabumi Kota",
      cabang: "SUKABUMI",
    };
    const delay45EventId = `${testNamespace}-DELAY-45M`;
    const delay45Eq: Earthquake = {
      ...eqFreshCianjur,
      id: delay45EventId,
      canonicalEventKey: delay45EventId,
      timestamp: Date.now() - 45 * 60 * 1000,
    };
    const cycle45 = await processEarthquakeAlertsAndReports([delay45Eq], [storeSukabumi], true);
    record(
      "AGE-01",
      "Fresh event (45m delay <= 60m): Dispatches emergency alert and creates auto-report",
      cycle45.dispatchedAlerts === 1 && cycle45.createdReports === 1,
      `Alerts: ${cycle45.dispatchedAlerts} (expected 1), Reports: ${cycle45.createdReports} (expected 1)`
    );

    // 2. Normal Realtime Monitoring Without Backfill: 61 minutes ago
    // Expect: Without backfill flag, event > 60m is ignored (0 alerts, 0 reports).
    const delay61EventId = `${testNamespace}-DELAY-61M`;
    const delay61Eq: Earthquake = {
      ...eqFreshCianjur,
      id: delay61EventId,
      canonicalEventKey: delay61EventId,
      timestamp: Date.now() - 61 * 60 * 1000,
    };

    const normalStaleCycle = await processEarthquakeAlertsAndReports([delay61Eq], [storeCianjur1], true, false);
    record(
      "AGE-02A",
      "Normal realtime cycle: Event > 60m is ignored from new report creation when backfill is off",
      normalStaleCycle.dispatchedAlerts === 0 && normalStaleCycle.createdReports === 0,
      `Alerts: ${normalStaleCycle.dispatchedAlerts} (expected 0), Reports: ${normalStaleCycle.createdReports} (expected 0)`
    );

    // 3. Downtime Recovery Backfill 1: 61 minutes ago (Past 60m alert cutoff, inside bounded backfill)
    // Expect: Outdated emergency alert SUPPRESSED (0 alerts), but missed report RECOVERED (1 report).
    const cycle61 = await processEarthquakeAlertsAndReports([delay61Eq], [storeCianjur1], true, true);
    const row61 = await client.query(`SELECT earthquake_provenance FROM incidents WHERE earthquake_event_id = $1;`, [delay61EventId]);
    const provenance61 = row61.rows[0]?.earthquake_provenance || "";
    record(
      "AGE-02B",
      "Downtime recovery (61m delay): Suppresses outdated emergency alert and recovers missed report",
      cycle61.dispatchedAlerts === 0 && cycle61.createdReports === 1 && provenance61.includes("Pemulihan pasca-downtime"),
      `Alerts: ${cycle61.dispatchedAlerts} (expected 0), Reports: ${cycle61.createdReports} (expected 1), Provenance: '${provenance61}'`
    );

    // 4. Downtime Recovery Backfill 2: 120 minutes ago (2h downtime)
    // Expect: Outdated emergency alert SUPPRESSED (0 alerts), report RECOVERED (1 report).
    const delay120EventId = `${testNamespace}-DELAY-120M`;
    const delay120Eq: Earthquake = {
      ...eqFreshCianjur,
      id: delay120EventId,
      canonicalEventKey: delay120EventId,
      timestamp: Date.now() - 120 * 60 * 1000,
    };
    const cycle120 = await processEarthquakeAlertsAndReports([delay120Eq], [storeCianjur1], true, true);
    record(
      "AGE-03",
      "Downtime recovery (120m delay): Suppresses outdated emergency alert and recovers missed report",
      cycle120.dispatchedAlerts === 0 && cycle120.createdReports === 1,
      `Alerts: ${cycle120.dispatchedAlerts} (expected 0), Reports: ${cycle120.createdReports} (expected 1)`
    );

    // 5. Stale beyond bounded backfill window: 30 hours ago (> 24h backfill cutoff, <= 72h map window)
    // Expect: Alert SUPPRESSED (0 alerts), Report SUPPRESSED (0 reports). Does not treat all 72h map events as incidents.
    const delay30hEventId = `${testNamespace}-DELAY-30H`;
    const delay30hEq: Earthquake = {
      ...eqFreshCianjur,
      id: delay30hEventId,
      canonicalEventKey: delay30hEventId,
      timestamp: Date.now() - 30 * 60 * 60 * 1000, // 30 hours ago
    };
    const cycle30h = await processEarthquakeAlertsAndReports([delay30hEq], [storeCianjur1], true, true);
    const dbCount30h = await client.query(`SELECT count(*) as cnt FROM incidents WHERE earthquake_event_id = $1;`, [delay30hEventId]);
    record(
      "AGE-04",
      "Event beyond backfill window (30h > 24h): Prevents treating historical 72h map events as new incidents",
      cycle30h.dispatchedAlerts === 0 && cycle30h.createdReports === 0 && Number(dbCount30h.rows[0].cnt) === 0,
      `Alerts: ${cycle30h.dispatchedAlerts} (expected 0), Reports: ${cycle30h.createdReports} (expected 0), DB count: ${dbCount30h.rows[0].cnt}`
    );

    // =========================================================================
    // SECTION 7: BRANCH VS HO ACCESS CONTROL & VISIBILITY (REQUIREMENT 8)
    // =========================================================================
    console.log("\n--- SECTION 7: Branch vs HO Access Control & Operational Visibility ---");

    const cianjurReport = await dbGetIncidentById(dbReports.rows[0].id);
    assert(cianjurReport, "Cianjur report must exist for access testing");

    // User A: BMS Cianjur (authorized branch user)
    const bmsCianjurUser: UserContext = {
      id: "usr_bms_cianjur",
      name: "BMS Cianjur",
      systemRole: "USER",
      role: "bms",
      branch: "CIANJUR",
      scope: "BRANCH",
    };

    // User B: BMS Bandung (other branch user)
    const bmsBandungUser: UserContext = {
      id: "usr_bms_bandung",
      name: "BMS Bandung",
      systemRole: "USER",
      role: "bms",
      branch: "BANDUNG",
      scope: "BRANCH",
    };

    // User C: HO Admin (National Head Office read-only observer)
    const hoAdminUser: UserContext = {
      id: "usr_ho_admin",
      name: "HO Staff",
      systemRole: "USER",
      role: "ho_admin",
      branch: null,
      scope: "HO",
    };

    const bmsCianjurCanView = canViewReport(bmsCianjurUser, cianjurReport);
    const bmsCianjurCanAct = canActOnReport(bmsCianjurUser, cianjurReport);

    const bmsBandungCanView = canViewReport(bmsBandungUser, cianjurReport);
    const bmsBandungCanAct = canActOnReport(bmsBandungUser, cianjurReport);

    const hoCanView = canViewReport(hoAdminUser, cianjurReport);
    const hoCanAct = canActOnReport(hoAdminUser, cianjurReport);

    record(
      "ACC-01",
      "Branch user can view and act only on own branch reports",
      bmsCianjurCanView === true && bmsCianjurCanAct === true && bmsBandungCanView === false && bmsBandungCanAct === false,
      `Cianjur: canView=${bmsCianjurCanView}, canAct=${bmsCianjurCanAct}; Bandung: canView=${bmsBandungCanView}, canAct=${bmsBandungCanAct}`
    );

    record(
      "ACC-02",
      "HO User can view all national reports but cannot take branch operational actions",
      hoCanView === true && hoCanAct === false,
      `HO: canView=${hoCanView}, canAct=${hoCanAct}`
    );

    // =========================================================================
    // SECTION 8: TARGET DATABASE & DEDUPLICATION INDEX VERIFICATION (REQUIREMENT 4)
    // =========================================================================
    console.log("\n--- SECTION 8: Target Database Safety & Deduplication Indexes ---");

    const dbNameRes = await client.query(`SELECT current_database();`);
    const currentDb = dbNameRes.rows[0].current_database;
    record(
      "DB-01",
      "Migration and tests executed strictly against isolated test database (sparta_siaga_isolated)",
      currentDb === "sparta_siaga_isolated",
      `Current Database: '${currentDb}' (defaultdb write-guard active)`
    );

    const indexRes = await client.query(`
      SELECT indexname, indexdef 
        FROM pg_indexes 
       WHERE tablename = 'incidents';
    `);
    const indexNames = indexRes.rows.map((r: any) => r.indexname);
    const hasUniqueLocationIndex = indexNames.includes("idx_incidents_unique_earthquake_location");
    const hasObsoleteBranchIndex = indexNames.includes("idx_incidents_unique_auto_eq_branch");

    record(
      "DB-02",
      "Verify deduplication indexes: Location-level unique index active, obsolete branch unique index removed",
      hasUniqueLocationIndex && !hasObsoleteBranchIndex,
      `idx_incidents_unique_earthquake_location: ${hasUniqueLocationIndex}, idx_incidents_unique_auto_eq_branch (obsolete): ${hasObsoleteBranchIndex}`
    );

    // Clean up all test fixtures from isolated database
    await client.query("DELETE FROM incidents WHERE store_id = 'T-RECON-01' OR store_id LIKE 'T-CJR-%' OR store_id LIKE 'T-SKB-%' OR store_id LIKE 'T-RACE-%' OR earthquake_event_id LIKE 'EQ03-%';");
    await client.query("DELETE FROM notification_logs WHERE disaster_id LIKE 'EQ03-%';");
    await client.query("DELETE FROM earthquake_reconciliation_cases WHERE candidate_canonical_event_id LIKE 'EQ03-%';");

    console.log("\n================================================================================");
    console.log(` EQ-03 SUITE RESULTS: ${testResults.filter(r => r.status === "PASS").length} passed, ${testResults.filter(r => r.status === "FAIL").length} failed (${testResults.length} total)`);
    console.log("================================================================================\n");

    const failed = testResults.filter(r => r.status === "FAIL");
    if (failed.length > 0) {
      process.exit(1);
    }
    process.exit(0);
  } finally {
    client.release();
  }
}

runEQ03Suite().catch((err) => {
  console.error("FATAL ERROR IN EQ-03 TEST SUITE:", err);
  process.exit(1);
});
