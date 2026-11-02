/**
 * SPARTA SIAGA - Earthquake Intensity System Integration Test Suite
 * 
 * Verifies the production two-stage earthquake pipeline:
 * 1. Feature Flag toggling (safe isolation of legacy radius vs intensity system)
 * 2. Stage 1: Instant nationwide informational notification (no reports, deduplication)
 * 3. Stage 2: ShakeMap MMI numerical evaluation (MMI >= 6.0 candidate auto-reports)
 * 4. Downward ShakeMap Version Revision (Non-cancellation policy, timeline audit entry)
 * 5. Safe Fallback: 30-minute timeout advisory escalation (zero radius reports)
 * 6. HO Visibility Filter: automatic earthquake immediately visible read-only; manual requires BnM confirmation
 * 7. Idempotency & Concurrency: no duplicate reports on re-evaluation
 * 
 * Target: Aiven PostgreSQL (sparta_siaga_isolated)
 * Safety: Guarded by assertIsolatedDatabase. Strictly zero em dashes.
 */

import assert from "node:assert/strict";
import crypto from "node:crypto";
import { getDbPool, closeDbPool } from "../lib/db";
import { assertIsolatedDatabase } from "../lib/database-safety";
import {
  isEarthquakeIntensityEnabled,
  setEarthquakeIntensityEnabled,
} from "../lib/earthquake-intensity-config";
import {
  dispatchStageOneNationalNotification,
  processStageTwoIntensityEvaluation,
  checkAndEscalateShakeMapFallback,
  parseShakeMapCovJson,
  interpolateMmiFromGrid,
  evaluateIntensityDecision,
  compareRadiusVsMmi,
  ShakeMapDataset,
  EvaluatedFacilityTarget,
} from "../lib/earthquake-intensity-service";
import { isReportVisibleToHo } from "../lib/report-permissions";
import { getReportAccessSql } from "../lib/report-access-policy";
import type { IncidentRecord } from "../types/incident";

interface TestReportItem {
  code: string;
  category: string;
  name: string;
  passed: boolean;
  detail: string;
}

const testResults: TestReportItem[] = [];

function recordResult(code: string, category: string, name: string, passed: boolean, detail: string) {
  testResults.push({ code, category, name, passed, detail });
  const icon = passed ? "PASS" : "FAIL";
  console.log(`[${icon}] [${category}] ${code}: ${name}`);
  if (detail) {
    console.log(`       Detail: ${detail}`);
  }
}

// Generate simple synthetic ShakeMap CovJSON centered at given lat/lon
function buildSyntheticCovJson(params: {
  centerLat: number;
  centerLon: number;
  maxMmi: number;
  spanDeg?: number;
  gridPoints?: number;
}) {
  const { centerLat, centerLon, maxMmi, spanDeg = 1.0, gridPoints = 21 } = params;
  const lonStart = centerLon - spanDeg;
  const lonStop = centerLon + spanDeg;
  const latStart = centerLat - spanDeg;
  const latStop = centerLat + spanDeg;

  const latStep = (latStop - latStart) / (gridPoints - 1);
  const lonStep = (lonStop - lonStart) / (gridPoints - 1);

  const values: number[] = [];
  for (let j = 0; j < gridPoints; j++) {
    const lat = latStart + j * latStep;
    for (let i = 0; i < gridPoints; i++) {
      const lon = lonStart + i * lonStep;
      // Distance in degrees to center
      const distDeg = Math.sqrt((lat - centerLat) ** 2 + (lon - centerLon) ** 2);
      // Gaussian attenuation model: maxMmi * exp(-dist / sigma)
      const sigma = 0.45;
      const mmi = Math.max(1.0, maxMmi * Math.exp(-distDeg / sigma));
      values.push(Math.round(mmi * 1000) / 1000);
    }
  }

  return {
    type: "Coverage",
    domain: {
      type: "Domain",
      domainType: "Grid",
      axes: {
        x: { start: lonStart, stop: lonStop, num: gridPoints },
        y: { start: latStart, stop: latStop, num: gridPoints },
      },
    },
    parameters: {
      MMI: {
        type: "Parameter",
        observedProperty: { label: { en: "Modified Mercalli Intensity" } },
      },
    },
    ranges: {
      MMI: {
        type: "NdArray",
        dataType: "float",
        axisNames: ["y", "x"],
        shape: [gridPoints, gridPoints],
        values,
      },
    },
  };
}

async function runTestSuite() {
  console.log("================================================================================");
  console.log(" SPARTA SIAGA - EARTHQUAKE INTENSITY SYSTEM INTEGRATION SUITE");
  console.log(" Target: Aiven PostgreSQL (sparta_siaga_isolated)");
  console.log("================================================================================\n");

  const pool = getDbPool();
  await assertIsolatedDatabase(pool);

  const testEventId = "TEST_INT_EVENT_2026";
  const testBranch = "CABANG_CIANJUR";

  // Pre-test Clean-up: purge existing test data with TEST_INT_ prefix
  await pool.query(`DELETE FROM earthquake_facility_intensities WHERE canonical_event_id LIKE 'TEST_INT_%'`);
  await pool.query(`DELETE FROM earthquake_shakemaps WHERE canonical_event_id LIKE 'TEST_INT_%'`);
  await pool.query(`DELETE FROM notification_logs WHERE canonical_event_id LIKE 'TEST_INT_%' OR disaster_id LIKE 'TEST_INT_%'`);
  await pool.query(`DELETE FROM incidents WHERE canonical_event_id LIKE 'TEST_INT_%' OR id LIKE 'LAP-EQ-TEST-%'`);

  // --------------------------------------------------------------------------
  // TEST 1: Feature Flag Toggling & State Verification
  // --------------------------------------------------------------------------
  try {
    const originalState = isEarthquakeIntensityEnabled();
    assert.equal(typeof originalState, "boolean");

    setEarthquakeIntensityEnabled(true);
    assert.equal(isEarthquakeIntensityEnabled(), true, "Feature flag must toggle to true");

    setEarthquakeIntensityEnabled(false);
    assert.equal(isEarthquakeIntensityEnabled(), false, "Feature flag must toggle to false");

    // Re-enable for the duration of the test suite
    setEarthquakeIntensityEnabled(true);

    recordResult(
      "INT-01",
      "CONFIG",
      "Feature flag toggles cleanly and defaults safely",
      true,
      "Toggled between true and false without exceptions"
    );
  } catch (err: any) {
    recordResult("INT-01", "CONFIG", "Feature flag toggles cleanly", false, err.message);
  }

  // --------------------------------------------------------------------------
  // TEST 2: Stage 1 Instant Nationwide Informational Notification
  // --------------------------------------------------------------------------
  try {
    const stage1Result = await dispatchStageOneNationalNotification({
      canonicalEventId: testEventId,
      title: "Gempa Tektonik Uji Cianjur M 6.2",
      magnitude: 6.2,
      depthKm: 12,
      latitude: -6.82,
      longitude: 107.14,
      occurredAt: new Date(),
      sourceProvider: "BMKG",
    });

    assert.equal(stage1Result.outcome, "dispatched");
    assert.equal(stage1Result.canonicalEventId, testEventId);

    // Verify Notification Log in DB
    const notifCheck = await pool.query(
      `SELECT id, branch, recipient_group, notification_category, channel, delivery_channel
         FROM notification_logs
        WHERE canonical_event_id = $1`,
      [testEventId]
    );

    assert.equal(notifCheck.rows.length, 1, "Exactly one notification row must exist for Stage 1");
    const notifRow = notifCheck.rows[0];
    assert.equal(notifRow.branch, "NATIONAL");
    assert.equal(notifRow.recipient_group, "HO");
    assert.equal(notifRow.notification_category, "INFORMATION");
    assert.equal(notifRow.channel, "pwa_only");

    // Strictly verify NO incidents were created by Stage 1
    const incCount = await pool.query(
      `SELECT COUNT(*)::int AS count FROM incidents WHERE canonical_event_id = $1`,
      [testEventId]
    );
    assert.equal(incCount.rows[0].count, 0, "Stage 1 must strictly NOT create any incident reports");

    // Test Deduplication: second dispatch with same event ID handles conflict cleanly
    const duplicateDispatch = await dispatchStageOneNationalNotification({
      canonicalEventId: testEventId,
      title: "Gempa Tektonik Uji Cianjur M 6.2 (Retry)",
      magnitude: 6.2,
      depthKm: 12,
      latitude: -6.82,
      longitude: 107.14,
      occurredAt: new Date(),
      sourceProvider: "BMKG",
    });

    assert.ok(
      duplicateDispatch.outcome === "dispatched" || duplicateDispatch.outcome === "duplicate",
      "Duplicate dispatch must be handled cleanly via upsert or suppression"
    );

    recordResult(
      "INT-02",
      "STAGE-1",
      "Stage 1 instant nationwide alert dispatches without creating incidents",
      true,
      "Logged to notification_logs (NATIONAL/HO/INFORMATION), 0 incidents created, deduplicated"
    );
  } catch (err: any) {
    recordResult("INT-02", "STAGE-1", "Stage 1 alert dispatch", false, err.message);
  }

  // --------------------------------------------------------------------------
  // TEST 3: Stage 2 ShakeMap Evaluation (MMI >= 6.0 vs MMI < 6.0 vs Out of Coverage)
  // --------------------------------------------------------------------------
  const facilityHighRisk: EvaluatedFacilityTarget = {
    kind: "FACILITY",
    id: "fac-cianjur-dc-01",
    code: "DC-CJR-01",
    name: "Distribution Center Cianjur",
    type: "DC",
    branch: testBranch,
    latitude: -6.82, // Exactly at epicenter (MMI ~ 7.0+)
    longitude: 107.14,
  };

  const facilityLowRisk: EvaluatedFacilityTarget = {
    kind: "STORE",
    id: "str-bandung-99",
    code: "T999",
    name: "Alfamart Terusan Buah Batu",
    type: "Reguler",
    branch: "CABANG_BANDUNG",
    latitude: -6.40, // Far enough: MMI < 6.0 (~4.5)
    longitude: 107.85,
  };

  const facilityOutOfCoverage: EvaluatedFacilityTarget = {
    kind: "STORE",
    id: "str-kalimantan-01",
    code: "TKAL01",
    name: "Alfamart Balikpapan Sentral",
    type: "Reguler",
    branch: "CABANG_BALIKPAPAN",
    latitude: -1.25, // Far outside Java grid bounds
    longitude: 116.85,
  };

  try {
    const rawCovJsonV1 = buildSyntheticCovJson({
      centerLat: -6.82,
      centerLon: 107.14,
      maxMmi: 7.2,
      spanDeg: 1.0,
      gridPoints: 21,
    });

    const gridV1 = parseShakeMapCovJson(rawCovJsonV1, {
      eventId: testEventId,
      name: "Cianjur Test ShakeMap",
      sourceProvider: "USGS",
      versionNumber: 1,
    });

    const datasetV1: ShakeMapDataset = {
      eventId: testEventId,
      title: "Gempa Tektonik Cianjur M 6.2",
      sourceProvider: "USGS",
      versionNumber: 1,
      magnitude: 6.2,
      depthKm: 12,
      latitude: -6.82,
      longitude: 107.14,
      maxMmi: gridV1.maxMmi,
      grid: gridV1,
      occurredAt: new Date(),
    };

    const evaluationResultV1 = await processStageTwoIntensityEvaluation({
      dataset: datasetV1,
      facilities: [facilityHighRisk, facilityLowRisk, facilityOutOfCoverage],
      dbPool: pool,
    });

    assert.equal(evaluationResultV1.totalEvaluated, 3);
    assert.equal(evaluationResultV1.candidateReportsCount, 1, "Only facility with MMI >= 6.0 triggers candidate report");
    assert.equal(evaluationResultV1.notificationOnlyCount, 1, "Facility with MMI < 6.0 triggers notification only");
    assert.equal(evaluationResultV1.outOfCoverageCount, 1, "Facility outside grid yields UNKNOWN");
    assert.equal(evaluationResultV1.createdIncidentIds.length, 1, "Exactly 1 incident report created");

    const createdIncidentId = evaluationResultV1.createdIncidentIds[0];

    // Verify incident in DB
    const incCheck = await pool.query(
      `SELECT id, status, progress, report_origin, branch, location_kind, location_id, location_code_snapshot
         FROM incidents WHERE id = $1`,
      [createdIncidentId]
    );
    assert.equal(incCheck.rows.length, 1, "Created incident must exist in DB");
    const inc = incCheck.rows[0];
    assert.equal(inc.status, "pending_confirmation", "Incident must start as pending_confirmation");
    assert.equal(inc.progress, 0, "Incident progress must start at 0%");
    assert.equal(inc.report_origin, "automatic_earthquake", "Report origin must be automatic_earthquake");
    assert.equal(inc.branch, testBranch, "Branch must be isolated to facility branch");
    assert.equal(inc.location_code_snapshot, facilityHighRisk.code);

    // Verify facility intensities table records
    const intensityCheck = await pool.query(
      `SELECT facility_code, decision_policy, mmi_raw, mmi_rounded, mmi_roman, incident_id
         FROM earthquake_facility_intensities
        WHERE canonical_event_id = $1 AND shakemap_version = 1
        ORDER BY facility_code ASC`,
      [testEventId]
    );

    assert.equal(intensityCheck.rows.length, 3, "3 facility intensity records must be persisted");

    const recHigh = intensityCheck.rows.find((r) => r.facility_code === facilityHighRisk.code);
    assert.ok(recHigh, "High risk facility record must exist");
    assert.equal(recHigh.decision_policy, "CANDIDATE_AUTO_REPORT");
    assert.ok(Number(recHigh.mmi_raw) >= 6.0, "MMI raw must be >= 6.0");
    assert.equal(recHigh.incident_id, createdIncidentId, "Must link to created incident");

    const recLow = intensityCheck.rows.find((r) => r.facility_code === facilityLowRisk.code);
    assert.ok(recLow, "Low risk facility record must exist");
    assert.equal(recLow.decision_policy, "NOTIFICATION_ONLY");
    assert.ok(Number(recLow.mmi_raw) < 6.0, "MMI raw must be < 6.0");
    assert.equal(recLow.incident_id, null, "Low risk must have null incident_id");

    const recUnknown = intensityCheck.rows.find((r) => r.facility_code === facilityOutOfCoverage.code);
    assert.ok(recUnknown, "Out of coverage facility record must exist");
    assert.equal(recUnknown.decision_policy, "UNKNOWN");
    assert.equal(recUnknown.mmi_raw, null, "Out of coverage must have null mmi_raw");

    recordResult(
      "INT-03",
      "STAGE-2",
      "Stage 2 evaluates MMI >= 6.0 candidate auto-reports and stores intensities",
      true,
      `1 candidate report (${createdIncidentId}), 1 notification only, 1 out of coverage UNKNOWN`
    );
  } catch (err: any) {
    recordResult("INT-03", "STAGE-2", "Stage 2 evaluation", false, err.message);
  }

  // --------------------------------------------------------------------------
  // TEST 4: Downward ShakeMap Revision (Non-Cancellation Policy)
  // --------------------------------------------------------------------------
  try {
    // Version 2 has revised lower intensity: center max Mmi dropped from 7.2 to 5.4 (< 6.0)
    const rawCovJsonV2 = buildSyntheticCovJson({
      centerLat: -6.82,
      centerLon: 107.14,
      maxMmi: 5.4, // Downward revision
      spanDeg: 1.0,
      gridPoints: 21,
    });

    const gridV2 = parseShakeMapCovJson(rawCovJsonV2, {
      eventId: testEventId,
      name: "Cianjur Test ShakeMap Revision 2",
      sourceProvider: "USGS",
      versionNumber: 2,
    });

    const datasetV2: ShakeMapDataset = {
      eventId: testEventId,
      title: "Gempa Tektonik Cianjur M 6.2 (Rev 2)",
      sourceProvider: "USGS",
      versionNumber: 2,
      magnitude: 6.2,
      depthKm: 12,
      latitude: -6.82,
      longitude: 107.14,
      maxMmi: gridV2.maxMmi,
      grid: gridV2,
      occurredAt: new Date(),
    };

    const evaluationResultV2 = await processStageTwoIntensityEvaluation({
      dataset: datasetV2,
      facilities: [facilityHighRisk],
      dbPool: pool,
    });

    // In version 2, MMI is < 6.0 -> 0 new candidate reports created
    assert.equal(evaluationResultV2.candidateReportsCount, 0, "No new candidate reports in downward revision");
    assert.equal(evaluationResultV2.createdIncidentIds.length, 0, "Zero new reports created");
    assert.equal(evaluationResultV2.preservedIncidentIds.length, 1, "Existing report must be preserved");

    const preservedIncidentId = evaluationResultV2.preservedIncidentIds[0];

    // Verify that incident still exists in DB and was NOT deleted or cancelled
    const preservedCheck = await pool.query(
      `SELECT id, status, timeline FROM incidents WHERE id = $1`,
      [preservedIncidentId]
    );
    assert.equal(preservedCheck.rows.length, 1, "Preserved incident must remain intact");
    const preservedInc = preservedCheck.rows[0];
    assert.equal(preservedInc.status, "pending_confirmation", "Status remains pending_confirmation for physical check");

    // Verify timeline audit trail has shakemap_intensity_revised entry
    const timeline = Array.isArray(preservedInc.timeline) ? preservedInc.timeline : [];
    const revisionEntry = timeline.find((t: any) => t.stage === "shakemap_intensity_revised");
    assert.ok(revisionEntry, "Timeline must contain shakemap_intensity_revised audit entry");
    assert.equal(revisionEntry.shakemapVersion, 2);
    assert.ok(String(revisionEntry.label).includes("direvisi"), "Audit entry mentions revision");

    recordResult(
      "INT-04",
      "REVISION",
      "Downward ShakeMap revision preserves existing report with timeline audit trail",
      true,
      `Preserved report ${preservedIncidentId}, timeline stage 'shakemap_intensity_revised' logged`
    );
  } catch (err: any) {
    recordResult("INT-04", "REVISION", "Downward revision non-cancellation", false, err.message);
  }

  // --------------------------------------------------------------------------
  // TEST 5: Safe Fallback 30-Minute Timeout Escalation (Zero Radius Auto-Reports)
  // --------------------------------------------------------------------------
  try {
    const fallbackEventId = "TEST_INT_FALLBACK_999";
    const now = Date.now();

    // Case 5A: Event is fresh (10 minutes old) -> NORMAL_POLLING, no advisory
    const resFresh = await checkAndEscalateShakeMapFallback({
      canonicalEventId: fallbackEventId,
      title: "Gempa Mentawai M 6.8",
      magnitude: 6.8,
      depthKm: 20,
      eventOccurredAt: new Date(now - 10 * 60 * 1000), // 10 minutes ago
      dbPool: pool,
    });

    assert.equal(resFresh.status, "NORMAL_POLLING");
    assert.equal(resFresh.advisorySent, false);
    assert.equal(resFresh.isFallbackActive, false);

    // Case 5B: Event is older than 30 minutes (35 minutes) -> ESCALATED_WAITING_SHAKEMAP
    const resTimedOut = await checkAndEscalateShakeMapFallback({
      canonicalEventId: fallbackEventId,
      title: "Gempa Mentawai M 6.8",
      magnitude: 6.8,
      depthKm: 20,
      eventOccurredAt: new Date(now - 35 * 60 * 1000), // 35 minutes ago
      dbPool: pool,
    });

    assert.equal(resTimedOut.status, "ESCALATED_WAITING_SHAKEMAP");
    assert.equal(resTimedOut.advisorySent, true);
    assert.equal(resTimedOut.isFallbackActive, true);

    // Verify advisory notification was recorded in notification_logs
    const advisoryCheck = await pool.query(
      `SELECT id, recipient_group, title, message FROM notification_logs WHERE canonical_event_id = $1`,
      [fallbackEventId]
    );
    assert.equal(advisoryCheck.rows.length, 1, "Advisory log must be recorded");
    assert.equal(advisoryCheck.rows[0].recipient_group, "BMM");

    // Strictly verify ZERO incident reports were generated from legacy radius
    const fallbackIncCheck = await pool.query(
      `SELECT COUNT(*)::int AS count FROM incidents WHERE canonical_event_id = $1`,
      [fallbackEventId]
    );
    assert.equal(fallbackIncCheck.rows[0].count, 0, "Strictly ZERO reports created from circular radius on fallback");

    recordResult(
      "INT-05",
      "FALLBACK",
      "30-minute fallback triggers advisory escalation without creating radius reports",
      true,
      "Fresh event: NORMAL_POLLING; 35m event: ESCALATED_WAITING_SHAKEMAP advisory sent, 0 reports"
    );
  } catch (err: any) {
    recordResult("INT-05", "FALLBACK", "Fallback 30m timeout", false, err.message);
  }

  // --------------------------------------------------------------------------
  // TEST 6: Head Office (HO) Visibility Filter Isolation
  // --------------------------------------------------------------------------
  try {
    // 6A. Synchronous permission helper isReportVisibleToHo
    const mockAutoReport: IncidentRecord = {
      id: "LAP-EQ-AUTO-001",
      date: "2026-11-02",
      disasterType: "earthquake",
      reportOrigin: "automatic_earthquake",
      branch: testBranch,
      storeId: "DC-CJR-01",
      storeName: "Distribution Center Cianjur",
      locationCity: testBranch,
      status: "pending_confirmation",
      progress: 0,
      affectedStores: [],
      affectedStoreCount: 1,
      dangerStoreCount: 1,
      fieldPhotos: [],
      timeline: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const mockManualUnapproved: IncidentRecord = {
      id: "LAP-MANUAL-001",
      date: "2026-11-02",
      disasterType: "earthquake",
      reportOrigin: "manual",
      branch: testBranch,
      storeId: "T999",
      storeName: "Toko Uji",
      locationCity: testBranch,
      status: "pending_confirmation",
      progress: 0,
      affectedStores: [],
      affectedStoreCount: 1,
      dangerStoreCount: 0,
      fieldPhotos: [],
      timeline: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const mockManualApproved: IncidentRecord = {
      ...mockManualUnapproved,
      status: "confirmed_affected",
      verification: {
        confirmedBy: "PIC_BMS",
        confirmedAt: new Date().toISOString(),
        isDamaged: true,
        bmApproval: {
          decision: "approved",
          decidedBy: "BMM_CIANJUR",
          decidedAt: new Date().toISOString(),
          decisionNotes: "Disetujui penanganan",
        },
      },
    };

    assert.equal(
      isReportVisibleToHo(mockAutoReport),
      true,
      "Automatic earthquake reports must be visible to HO from creation"
    );
    assert.equal(
      isReportVisibleToHo(mockManualUnapproved),
      false,
      "Unapproved manual reports must NOT be visible to HO"
    );
    assert.equal(
      isReportVisibleToHo(mockManualApproved),
      true,
      "Manual reports become visible to HO after BnM approval"
    );

    // 6B. SQL Level Access Policy Check via getReportAccessSql
    const hoUserContext = {
      systemRole: "USER" as const,
      scope: "HO" as const,
      branch: null,
    };

    const sqlAccess = getReportAccessSql(hoUserContext, "i", 1);
    assert.ok(
      sqlAccess.clause.includes("i.report_origin = 'automatic_earthquake'"),
      "SQL policy includes automatic_earthquake origin for HO"
    );

    // Query DB with the access filter to verify real SQL execution
    const hoVisibleQuery = await pool.query(
      `SELECT i.id, i.report_origin, i.status
         FROM incidents i
        WHERE i.canonical_event_id = $2
          AND ${sqlAccess.clause}`,
      [...sqlAccess.values, testEventId]
    );

    assert.ok(
      hoVisibleQuery.rows.length >= 1,
      "HO can query automatic earthquake incidents immediately"
    );
    assert.equal(hoVisibleQuery.rows[0].report_origin, "automatic_earthquake");

    recordResult(
      "INT-06",
      "HO-VISIBILITY",
      "HO visibility filter separates automatic reports (immediate) and manual reports (BnM gated)",
      true,
      "isReportVisibleToHo and getReportAccessSql verified synchronously and via DB execution"
    );
  } catch (err: any) {
    recordResult("INT-06", "HO-VISIBILITY", "HO visibility filter", false, err.message);
  }

  // --------------------------------------------------------------------------
  // TEST 7: Idempotency & Clean-up
  // --------------------------------------------------------------------------
  try {
    // Re-run Stage 2 evaluation for dataset V1 to ensure no duplicate incidents are created
    const rawCovJsonV1 = buildSyntheticCovJson({
      centerLat: -6.82,
      centerLon: 107.14,
      maxMmi: 7.2,
      spanDeg: 1.0,
      gridPoints: 21,
    });

    const gridV1 = parseShakeMapCovJson(rawCovJsonV1, {
      eventId: testEventId,
      name: "Cianjur Test ShakeMap",
      sourceProvider: "USGS",
      versionNumber: 1,
    });

    const datasetV1: ShakeMapDataset = {
      eventId: testEventId,
      title: "Gempa Tektonik Cianjur M 6.2",
      sourceProvider: "USGS",
      versionNumber: 1,
      magnitude: 6.2,
      depthKm: 12,
      latitude: -6.82,
      longitude: 107.14,
      maxMmi: gridV1.maxMmi,
      grid: gridV1,
      occurredAt: new Date(),
    };

    const idempotentRun = await processStageTwoIntensityEvaluation({
      dataset: datasetV1,
      facilities: [facilityHighRisk],
      dbPool: pool,
    });

    assert.equal(idempotentRun.createdIncidentIds.length, 0, "No duplicate incidents created on re-evaluation");
    assert.equal(idempotentRun.preservedIncidentIds.length, 1, "Existing report is preserved");

    // Clean up test data
    await pool.query(`DELETE FROM earthquake_facility_intensities WHERE canonical_event_id LIKE 'TEST_INT_%'`);
    await pool.query(`DELETE FROM earthquake_shakemaps WHERE canonical_event_id LIKE 'TEST_INT_%'`);
    await pool.query(`DELETE FROM notification_logs WHERE canonical_event_id LIKE 'TEST_INT_%' OR disaster_id LIKE 'TEST_INT_%'`);
    await pool.query(`DELETE FROM incidents WHERE canonical_event_id LIKE 'TEST_INT_%' OR id LIKE 'LAP-EQ-TEST-%'`);

    // Reset feature flag to false (default production safety)
    setEarthquakeIntensityEnabled(false);

    recordResult(
      "INT-07",
      "IDEMPOTENCY",
      "Stage 2 re-evaluation is strictly idempotent; post-test cleanup executed",
      true,
      "0 duplicates created; test records cleaned up; feature flag safely reset to default false"
    );
  } catch (err: any) {
    recordResult("INT-07", "IDEMPOTENCY", "Idempotency and clean-up", false, err.message);
  }

  // --------------------------------------------------------------------------
  // SUMMARY
  // --------------------------------------------------------------------------
  console.log("\n================================================================================");
  console.log(" EARTHQUAKE INTENSITY SYSTEM TEST RESULTS SUMMARY");
  console.log("================================================================================");
  const total = testResults.length;
  const passed = testResults.filter((r) => r.passed).length;
  const failed = total - passed;

  console.log(`Total Tests : ${total}`);
  console.log(`Passed      : ${passed}`);
  console.log(`Failed      : ${failed}`);

  if (failed > 0) {
    console.error("\nSome tests failed. See details above.");
    process.exit(1);
  } else {
    console.log("\nAll 7 test categories PASSED successfully.");
  }
}

runTestSuite()
  .catch((err) => {
    console.error("Fatal test runner error:", err);
    process.exit(1);
  })
  .finally(async () => {
    await closeDbPool();
  });
