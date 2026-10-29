/**
 * SPARTA SIAGA — Report Lifecycle & Automatic History Test Suite
 * 
 * Verifies:
 * 1. Automatic 24-hour reminder to responsible branch (idempotent, single reminder)
 * 2. Automatic 48-hour expiration to expired_unhandled (Tidak Ditindaklanjuti)
 * 3. Preservation of original verification, evidence, and audit trail without dummy classification
 * 4. Exception guard: Valid initial inspection prevents expiration
 * 5. Exception guard: Active workflow states (clarification, pending approval, maintenance, revision, close) stay active
 * 6. History vs Active classification and consistent server-side filtering
 * 7. HO visibility and branch authorization compliance
 */

import { getDbPool, closeDbPool } from "../lib/db";
import { dbCreateIncident, dbGetIncidentById, dbDeleteIncident } from "../lib/incident-db";
import { processReportLifecycles, hasValidInitialInspection } from "../lib/report-lifecycle-service";
import { IncidentRecord, isHistoryStatus, isActiveStatus } from "../types/incident";
import { getStandardizedOperationalStatus } from "../lib/operational-status";
import { reportStatusLabel } from "../lib/ho-report-monitoring";
import { isReportVisibleToHo } from "../lib/report-permissions";
import { getReportAccessSql } from "../lib/report-access-policy";

async function runTestSuite() {
  console.log("==========================================================================");
  console.log("SPARTA SIAGA — REPORT LIFECYCLE & AUTOMATIC HISTORY VALIDATION SUITE");
  console.log("==========================================================================\n");

  const pool = getDbPool();
  let passedCount = 0;
  let totalCount = 0;

  function assert(condition: boolean, code: string, message: string, errorDetail?: string) {
    totalCount++;
    if (condition) {
      console.log(`[PASS] ${code}: ${message}`);
      passedCount++;
    } else {
      console.error(`[FAIL] ${code}: ${message} -> ${errorDetail || "Assertion failed"}`);
      process.exitCode = 1;
    }
  }

  const baseTime = new Date("2026-10-22T10:00:00.000Z");
  const testIds: string[] = [];

  try {
    // -------------------------------------------------------------------------
    // TEST 1: Unit classification helpers
    // -------------------------------------------------------------------------
    console.log("\n--- TEST 1: History vs Active Status Classification Helpers ---");
    assert(isHistoryStatus("expired_unhandled"), "H1", "expired_unhandled is classified as history");
    assert(isHistoryStatus("confirmed_safe"), "H2", "confirmed_safe is classified as history");
    assert(isHistoryStatus("rejected_invalid"), "H3", "rejected_invalid is classified as history");
    assert(isHistoryStatus("closed"), "H4", "closed is classified as history");
    assert(isHistoryStatus("resolved"), "H5", "resolved is classified as history");
    assert(isHistoryStatus("archived"), "H6", "archived is classified as history");

    assert(isActiveStatus("pending_confirmation"), "A1", "pending_confirmation is classified as active");
    assert(isActiveStatus("verifying"), "A2", "verifying is classified as active");
    assert(isActiveStatus("clarification_requested"), "A3", "clarification_requested is classified as active");
    assert(isActiveStatus("pending_bm_approval"), "A4", "pending_bm_approval is classified as active");
    assert(isActiveStatus("confirmed_affected"), "A5", "confirmed_affected is classified as active");
    assert(isActiveStatus("in_maintenance"), "A6", "in_maintenance is classified as active");
    assert(isActiveStatus("revision_requested"), "A7", "revision_requested is classified as active");
    assert(isActiveStatus("approved_pending_close"), "A8", "approved_pending_close is classified as active");

    // Display labels
    const expiredBadge = getStandardizedOperationalStatus({ status: "expired_unhandled" } as any);
    assert(expiredBadge.label === "Tidak Ditindaklanjuti", "D1", "Standardized operational status label is 'Tidak Ditindaklanjuti'");
    assert(reportStatusLabel("expired_unhandled") === "Tidak Ditindaklanjuti", "D2", "HO report monitoring status label is 'Tidak Ditindaklanjuti'");

    // -------------------------------------------------------------------------
    // TEST 2: 24-Hour Reminder (Idempotent, One Reminder to Branch)
    // -------------------------------------------------------------------------
    console.log("\n--- TEST 2: Automatic 24-Hour Reminder ---");
    const id24h = "INC-TEST-LIFE-24H";
    testIds.push(id24h);
    await dbDeleteIncident(id24h);

    // Created 26 hours ago (exceeds 24h, less than 48h)
    const created26hAgo = new Date(baseTime.getTime() - 26 * 60 * 60 * 1000).toISOString();
    const inc24h: IncidentRecord = {
      id: id24h,
      date: "21 Oct 2026",
      disasterType: "earthquake",
      reportOrigin: "automatic_earthquake",
      storeId: "STR-TEST-001",
      storeName: "Alfamart Test 24H",
      branch: "BANDUNG",
      locationCity: "Bandung",
      status: "pending_confirmation",
      progress: 0,
      createdAt: created26hAgo,
      updatedAt: created26hAgo,
      timeline: [],
    };
    await dbCreateIncident(inc24h);

    // Run lifecycle processing at baseTime
    const result1 = await processReportLifecycles({ now: baseTime, includeTestIds: true });
    assert(result1.reminderReportIds.includes(id24h), "R1", "Report exceeded 24 hours receives reminder");

    const refreshed24h = await dbGetIncidentById(id24h);
    assert(Boolean(refreshed24h?.reminder24hSentAt), "R2", "reminder24hSentAt timestamp recorded in database");
    assert(refreshed24h?.status === "pending_confirmation", "R3", "Status remains active pending_confirmation after 24h reminder");
    const has24hTimeline = refreshed24h?.timeline.some(t => Boolean((t.activity || t.label || "").includes("Pengingat Pemeriksaan 24 Jam")));
    assert(Boolean(has24hTimeline), "R4", "Audit trail timeline contains 24h reminder entry");

    // Idempotency check: running again at baseTime + 1 hour must NOT re-send reminder
    const result1Repeat = await processReportLifecycles({
      now: new Date(baseTime.getTime() + 1 * 60 * 60 * 1000),
      includeTestIds: true,
    });
    assert(!result1Repeat.reminderReportIds.includes(id24h), "R5", "Second run is idempotent: does NOT re-send duplicate reminder");

    // -------------------------------------------------------------------------
    // TEST 3: 48-Hour Automatic Expiration to expired_unhandled (Tidak Ditindaklanjuti)
    // -------------------------------------------------------------------------
    console.log("\n--- TEST 3: Automatic 48-Hour Expiration ---");
    const id48h = "INC-TEST-LIFE-48H";
    testIds.push(id48h);
    await dbDeleteIncident(id48h);

    // Created 50 hours ago (exceeds 48h)
    const created50hAgo = new Date(baseTime.getTime() - 50 * 60 * 60 * 1000).toISOString();
    const inc48h: IncidentRecord = {
      id: id48h,
      date: "20 Oct 2026",
      disasterType: "earthquake",
      reportOrigin: "automatic_earthquake",
      storeId: "STR-TEST-002",
      storeName: "Alfamart Test 48H",
      branch: "SURABAYA",
      locationCity: "Surabaya",
      status: "pending_confirmation",
      progress: 0,
      createdAt: created50hAgo,
      updatedAt: created50hAgo,
      timeline: [
        { stage: "AUTO_DETECT", label: "Deteksi Otomatis Gempa", activity: "Deteksi Otomatis Gempa", actor: "SISTEM", timestamp: "20 Oct 2026 08:00 WIB" },
      ],
    };
    await dbCreateIncident(inc48h);

    const result2 = await processReportLifecycles({ now: baseTime, includeTestIds: true });
    assert(result2.expiredReportIds.includes(id48h), "E1", "Report exceeded 48 hours is expired");

    const refreshed48h = await dbGetIncidentById(id48h);
    assert(refreshed48h?.status === "expired_unhandled", "E2", "Status transitioned to expired_unhandled");
    assert(Boolean(refreshed48h?.closedAt), "E3", "closedAt is recorded for expired report");
    assert(Boolean(refreshed48h?.expiredAt), "E4", "expiredAt timestamp recorded");

    // Preservation of verification and no dummy classification
    assert(refreshed48h?.verification === undefined || refreshed48h?.verification === null, "E5", "Unverified report is NEVER classified as safe or damaged");
    const hasExpTimeline = refreshed48h?.timeline.some(t => Boolean((t.activity || t.label || "").includes("Laporan Kedaluwarsa Otomatis")));
    assert(Boolean(hasExpTimeline), "E6", "Audit trail contains expiration entry");
    assert(refreshed48h?.timeline.length === 2, "E7", "Original audit trail entries preserved intact");

    // Idempotency: re-running does not alter already expired report
    const result2Repeat = await processReportLifecycles({
      now: new Date(baseTime.getTime() + 10 * 60 * 1000),
      includeTestIds: true,
    });
    assert(!result2Repeat.expiredReportIds.includes(id48h), "E8", "Expiration transition is idempotent and concurrency-safe");

    // -------------------------------------------------------------------------
    // TEST 4: Exception Guard — Valid Initial Inspection Submitted
    // -------------------------------------------------------------------------
    console.log("\n--- TEST 4: Exception Guard — Valid Initial Inspection Submitted ---");
    const idInspected = "INC-TEST-LIFE-INSPECTED";
    testIds.push(idInspected);
    await dbDeleteIncident(idInspected);

    // Created 60 hours ago, but inspection submitted (pending_bm_approval with inspector)
    const created60hAgo = new Date(baseTime.getTime() - 60 * 60 * 60 * 1000).toISOString();
    const incInspected: IncidentRecord = {
      id: idInspected,
      date: "19 Oct 2026",
      disasterType: "flood",
      reportOrigin: "manual",
      storeId: "STR-TEST-003",
      storeName: "Alfamart Test Inspected",
      branch: "JAKARTA",
      locationCity: "Jakarta",
      status: "pending_bm_approval",
      progress: 0,
      createdAt: created60hAgo,
      updatedAt: created60hAgo,
      verification: {
        confirmedBy: "Budi BMS",
        confirmedAt: "20 Oct 2026 14:00 WIB",
        isDamaged: true,
        condition: "damaged",
        photos: ["https://storage.example.com/photo1.jpg"],
        categories: ["Rak Barang"],
        severity: "Sedang",
      },
      timeline: [],
    };
    await dbCreateIncident(incInspected);

    assert(hasValidInitialInspection(incInspected), "G1", "Report recognized as having valid initial inspection");

    const result3 = await processReportLifecycles({ now: baseTime, includeTestIds: true });
    assert(!result3.expiredReportIds.includes(idInspected), "G2", "Report with valid initial inspection MUST NOT expire");

    const refreshedInspected = await dbGetIncidentById(idInspected);
    assert(refreshedInspected?.status === "pending_bm_approval", "G3", "Inspected report status remains pending_bm_approval");

    // -------------------------------------------------------------------------
    // TEST 5: Active Workflow States Stay Active
    // -------------------------------------------------------------------------
    console.log("\n--- TEST 5: Active Workflow Statuses Preserved ---");
    const activeWorkflowStatuses: Array<IncidentRecord["status"]> = [
      "clarification_requested",
      "confirmed_affected",
      "in_maintenance",
      "revision_requested",
      "approved_pending_close",
      "awaiting_st",
      "pending_final_approval",
    ];

    for (const st of activeWorkflowStatuses) {
      const activeId = `INC-TEST-LIFE-ACT-${st.toUpperCase().replace(/_/g, "-")}`;
      testIds.push(activeId);
      await dbDeleteIncident(activeId);

      const incActive: IncidentRecord = {
        id: activeId,
        date: "18 Oct 2026",
        disasterType: "earthquake",
        reportOrigin: "manual",
        storeId: `STR-TEST-${st}`,
        storeName: `Store ${st}`,
        branch: "MEDAN",
        locationCity: "Medan",
        status: st,
        progress: 50,
        createdAt: new Date(baseTime.getTime() - 100 * 60 * 60 * 1000).toISOString(),
        updatedAt: new Date(baseTime.getTime() - 10 * 60 * 60 * 1000).toISOString(),
        timeline: [],
      };
      await dbCreateIncident(incActive);

      const res = await processReportLifecycles({ now: baseTime, includeTestIds: true });
      assert(!res.expiredReportIds.includes(activeId), `W-${st}`, `Status ${st} remains active and never expires`);

      const ref = await dbGetIncidentById(activeId);
      assert(ref?.status === st, `W-ST-${st}`, `Status ${st} preserved in DB`);
      assert(isActiveStatus(ref?.status), `W-ACT-${st}`, `Status ${st} classified as active`);
    }

    // -------------------------------------------------------------------------
    // TEST 6: HO Visibility & Branch Authorization
    // -------------------------------------------------------------------------
    console.log("\n--- TEST 6: HO Visibility & Branch Authorization Rules ---");
    // 1. Phase 1: Unapproved automatic earthquake expired report is hidden from HO
    const autoEqExpired: IncidentRecord = {
      ...inc48h,
      status: "expired_unhandled",
      reportOrigin: "automatic_earthquake",
    };
    assert(!isReportVisibleToHo(autoEqExpired), "V1", "Phase 1: Automatic earthquake unapproved expired report is hidden from HO");

    // 2. Manual unapproved expired report: hidden from HO
    const manualExpired: IncidentRecord = {
      ...inc48h,
      status: "expired_unhandled",
      reportOrigin: "manual",
    };
    assert(!isReportVisibleToHo(manualExpired), "V2", "Manual unapproved expired report is hidden from HO");

    // 3. Server-side SQL access policy for branch
    const branchAccess = getReportAccessSql({
      systemRole: "USER",
      scope: "BRANCH",
      branch: "SURABAYA",
    });
    assert(branchAccess.clause.includes("branch"), "V3", "Branch access SQL restricts to user's responsible branch");
    assert(branchAccess.values[0] === "SURABAYA", "V4", "Branch access SQL value matches responsible branch");

    // 4. Server-side SQL access policy for HO (Phase 1: requires confirmed statuses)
    const hoAccess = getReportAccessSql({
      systemRole: "USER",
      scope: "HO",
      branch: null,
    });
    assert(!hoAccess.clause.includes("report_origin = 'automatic_earthquake'"), "V5", "Phase 1: HO access SQL excludes unapproved auto-earthquake reports");
    assert(hoAccess.clause.includes("status = ANY"), "V5b", "HO access SQL enforces post-approval statuses");

    // -------------------------------------------------------------------------
    // TEST 7: Expiration API Route Handler
    // -------------------------------------------------------------------------
    console.log("\n--- TEST 7: Expiration API Route Handler ---");
    const { POST: expirationRouteHandler } = await import("../app/api/incidents/expiration/route");
    const internalSecret = process.env.SPARTA_INTERNAL_WORKER_SECRET;
    const req = new Request("http://localhost:3000/api/incidents/expiration?simulatedNow=" + baseTime.toISOString() + "&includeTestIds=true", {
      method: "POST",
      headers: internalSecret ? { authorization: `Bearer ${internalSecret}` } : undefined,
    });
    const res = await expirationRouteHandler(req);
    assert(res.status === 200, "API-1", "Expiration API route returns HTTP 200");
    const resJson = await res.json();
    assert(resJson.success === true, "API-2", "Expiration API returns success: true");
    assert(typeof resJson.data.evaluatedCount === "number", "API-3", "Expiration API returns evaluated count");

    console.log(`\n==========================================================================`);
    console.log(`TEST RESULTS: ${passedCount}/${totalCount} assertions passed (${totalCount - passedCount} failed)`);
    console.log(`==========================================================================\n`);

  } finally {
    // Clean up test data
    console.log("Cleaning up test fixtures...");
    for (const id of testIds) {
      await dbDeleteIncident(id);
    }
    await closeDbPool();
  }

  if (passedCount !== totalCount) {
    process.exit(1);
  }
  process.exit(0);
}

runTestSuite().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
