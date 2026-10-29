/**
 * SPARTA SIAGA — Phase 1 Business Rules & Report Lifecycle Verification Suite
 *
 * Validates:
 * 1. Data separation: Real BMKG/USGS earthquakes, preliminary branch reports, BnM confirmed reports.
 * 2. Workflow enforcement: field inspection + photographic evidence required before BnM confirmation.
 * 3. Decision branches:
 *    - Damaged -> confirmed_affected (published to HO, maintenance workflow unlocked)
 *    - Safe -> confirmed_safe (published to HO, archived to history, no maintenance)
 *    - Clarification Requested -> clarification_requested (returned to branch, NOT published to HO)
 *    - Rejected -> forbidden for earthquakes.
 * 4. Removal of automatic earthquake exception (both manual and auto-earthquake reports treated equally).
 * 5. Head Office (HO) strictly read-only across all endpoints, mutations, attachments, exports, and history.
 * 6. Role separation, branch isolation, and distinction between initial BnM confirmation and final Case Close.
 * 7. Auditable approval events recorded for future Phase 3 Auto Email integration.
 */

import assert from "node:assert/strict";
import { canAccessReport, canAccessReportAsync, getReportAccessSql } from "../lib/report-access-policy";
import { canViewReport, canApproveAsBm, canCloseReport, isReportVisibleToHo, UserContext } from "../lib/report-permissions";
import { isEvidencePhotoLinked } from "../lib/inspection-photo-access";
import { canApproveAsBmAsync, canSubmitInspectionAsync } from "../lib/permission-service";
import { deriveWorkflowActions } from "../lib/workflow-actions";
import { IncidentRecord, HISTORY_STATUSES, isHistoryStatus, isActiveStatus } from "../types/incident";
import {
  recordReportApprovalEvent,
  getRecordedApprovalEvents,
  clearRecordedApprovalEvents,
} from "../lib/approval-event-service";

console.log("==========================================================================");
console.log("  SPARTA SIAGA — PHASE 1: BUSINESS RULES & REPORT LIFECYCLE TEST SUITE    ");
console.log("==========================================================================");

// --- Test Personas ---
const hoUser: UserContext = {
  id: "USR-HO-ADMIN-01",
  name: "HO Administrator",
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

const bmJakarta: UserContext = {
  id: "USR-BM-JKT-01",
  name: "Pak Hendra BnM Jakarta",
  systemRole: "USER",
  scope: "BRANCH",
  branch: "JAKARTA",
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

const besBandung: UserContext = {
  id: "USR-BES-BDG-01",
  name: "Dedi BES Bandung",
  systemRole: "USER",
  scope: "BRANCH",
  branch: "BANDUNG",
  role: "bes",
};

const sysAdmin: UserContext = {
  id: "USR-SYSADMIN-01",
  name: "Admin Nasional",
  systemRole: "ADMIN",
  scope: "BRANCH",
  branch: "BANDUNG",
  role: null,
};

// Base incident fixture
const baseReport: IncidentRecord = {
  id: "LAP-PH1-TEST-001",
  date: "2026-10-29",
  disasterType: "earthquake",
  reportOrigin: "automatic_earthquake",
  earthquakeEventId: "bmkg_20261029_001",
  storeId: "T001",
  storeName: "Alfamart Dago Bandung",
  branch: "BANDUNG",
  locationCity: "Bandung",
  tkpType: "toko",
  status: "pending_confirmation",
  progress: 0,
  fieldPhotos: [],
  timeline: [],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

async function runPhase1Tests() {
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

  console.log("\n--- SECTION 1: Automatic vs Manual Earthquake Approval Parity ---");

  await test("Unapproved auto-earthquake report is NOT visible to HO", () => {
    const unapprovedAutoEq: IncidentRecord = {
      ...baseReport,
      id: "LAP-EQ-AUTO-UNAPP",
      reportOrigin: "automatic_earthquake",
      status: "pending_confirmation",
    };
    assert.strictEqual(isReportVisibleToHo(unapprovedAutoEq), false);
    assert.strictEqual(canViewReport(hoUser, unapprovedAutoEq), false);
    assert.strictEqual(canAccessReport(hoUser, unapprovedAutoEq), false);
  });

  await test("Unapproved manual report is NOT visible to HO", () => {
    const unapprovedManual: IncidentRecord = {
      ...baseReport,
      id: "LAP-MAN-UNAPP",
      reportOrigin: "manual",
      disasterType: "flood",
      status: "pending_confirmation",
    };
    assert.strictEqual(isReportVisibleToHo(unapprovedManual), false);
    assert.strictEqual(canViewReport(hoUser, unapprovedManual), false);
    assert.strictEqual(canAccessReport(hoUser, unapprovedManual), false);
  });

  await test("Pending BM Approval status (after inspection) is still preliminary and NOT visible to HO", () => {
    const pendingBmAutoEq: IncidentRecord = {
      ...baseReport,
      id: "LAP-EQ-PENDING-BM",
      reportOrigin: "automatic_earthquake",
      status: "pending_bm_approval",
      verification: {
        confirmedBy: "Ahmad BMS",
        confirmedAt: new Date().toISOString(),
        isDamaged: true,
        photos: ["/storage/inspection_photo.jpg"],
      },
    };
    assert.strictEqual(isReportVisibleToHo(pendingBmAutoEq), false);
    assert.strictEqual(canViewReport(hoUser, pendingBmAutoEq), false);
  });

  await test("Confirmed Damaged report (approved) is published to HO", () => {
    const confirmedDamaged: IncidentRecord = {
      ...baseReport,
      id: "LAP-EQ-CONF-DAMAGED",
      reportOrigin: "automatic_earthquake",
      status: "confirmed_affected",
      verification: {
        confirmedBy: "Ahmad BMS",
        confirmedAt: new Date().toISOString(),
        isDamaged: true,
        photos: ["/storage/inspection_photo.jpg"],
        bmApproval: {
          decision: "approved",
          decidedBy: "Pak Budi BnM Bandung",
          decidedAt: new Date().toISOString(),
        },
      },
    };
    assert.strictEqual(isReportVisibleToHo(confirmedDamaged), true);
    assert.strictEqual(canViewReport(hoUser, confirmedDamaged), true);
    assert.strictEqual(canAccessReport(hoUser, confirmedDamaged), true);
  });

  await test("Confirmed Safe report (safe) is published to HO", () => {
    const confirmedSafe: IncidentRecord = {
      ...baseReport,
      id: "LAP-EQ-CONF-SAFE",
      reportOrigin: "automatic_earthquake",
      status: "confirmed_safe",
      verification: {
        confirmedBy: "Ahmad BMS",
        confirmedAt: new Date().toISOString(),
        isDamaged: false,
        photos: ["/storage/inspection_photo.jpg"],
        bmApproval: {
          decision: "safe",
          decidedBy: "Pak Budi BnM Bandung",
          decidedAt: new Date().toISOString(),
        },
      },
    };
    assert.strictEqual(isReportVisibleToHo(confirmedSafe), true);
    assert.strictEqual(canViewReport(hoUser, confirmedSafe), true);
    assert.strictEqual(canAccessReport(hoUser, confirmedSafe), true);
    assert.strictEqual(isHistoryStatus("confirmed_safe"), true);
  });

  await test("Clarification Requested report is NOT visible to HO and returned to branch", () => {
    const clarificationReq: IncidentRecord = {
      ...baseReport,
      id: "LAP-EQ-CLARIFY",
      reportOrigin: "automatic_earthquake",
      status: "clarification_requested",
      verification: {
        confirmedBy: "Ahmad BMS",
        confirmedAt: new Date().toISOString(),
        isDamaged: true,
        photos: ["/storage/inspection_photo.jpg"],
        bmApproval: {
          decision: "clarification_requested",
          decidedBy: "Pak Budi BnM Bandung",
          decidedAt: new Date().toISOString(),
          clarificationReason: "Foto kurang jelas di bagian pilar belakang",
        },
      },
    };
    assert.strictEqual(isReportVisibleToHo(clarificationReq), false);
    assert.strictEqual(canViewReport(hoUser, clarificationReq), false);
  });

  await test("Incorrectly assigned post-approval status without valid BnM confirmation is strictly HIDDEN from HO", () => {
    const fakeConfirmedReport: IncidentRecord = {
      ...baseReport,
      id: "LAP-FAKE-CONFIRMED",
      status: "in_maintenance",
      progress: 40,
      verification: undefined, // No BnM confirmation!
    };
    assert.strictEqual(isReportVisibleToHo(fakeConfirmedReport), false);
    assert.strictEqual(canViewReport(hoUser, fakeConfirmedReport), false);
    assert.strictEqual(canAccessReport(hoUser, fakeConfirmedReport), false);

    const rejectedReportWithPostStatus: IncidentRecord = {
      ...baseReport,
      id: "LAP-REJECTED-POST",
      status: "confirmed_affected",
      verification: {
        confirmedBy: "Ahmad BMS",
        confirmedAt: new Date().toISOString(),
        isDamaged: false,
        photos: ["/storage/photo.jpg"],
        bmApproval: {
          decision: "rejected",
          decidedBy: "Pak Budi BnM Bandung",
          decidedAt: new Date().toISOString(),
          rejectionReason: "Laporan tidak valid",
        },
      },
    };
    assert.strictEqual(isReportVisibleToHo(rejectedReportWithPostStatus), false);
    assert.strictEqual(canViewReport(hoUser, rejectedReportWithPostStatus), false);
  });

  console.log("\n--- SECTION 2: Workflow & Inspection Verification Guards ---");

  await test("BnM Manager CANNOT confirm without field inspection submitted", async () => {
    const uninspectedReport: IncidentRecord = {
      ...baseReport,
      status: "pending_confirmation",
      verification: undefined,
    };
    const res = await canApproveAsBmAsync(bmBandung, uninspectedReport);
    assert.strictEqual(res.authorized, false);
    assert.match(res.reason || "", /Hasil pemeriksaan lapangan wajib disubmit/);
  });

  await test("BnM Manager CANNOT confirm without photographic evidence", async () => {
    const noPhotoReport: IncidentRecord = {
      ...baseReport,
      status: "pending_bm_approval",
      verification: {
        confirmedBy: "Ahmad BMS",
        confirmedAt: new Date().toISOString(),
        isDamaged: true,
        photos: [], // Missing photos!
        evidenceDetails: [],
      },
      fieldPhotos: [],
    };
    const res = await canApproveAsBmAsync(bmBandung, noPhotoReport);
    assert.strictEqual(res.authorized, false);
    assert.match(res.reason || "", /Bukti foto pemeriksaan lapangan wajib dilampirkan/);
  });

  await test("BnM Manager CAN confirm when field inspection + photos are present", async () => {
    const readyReport: IncidentRecord = {
      ...baseReport,
      status: "pending_bm_approval",
      verification: {
        confirmedBy: "Ahmad BMS",
        confirmedAt: new Date().toISOString(),
        isDamaged: true,
        photos: ["/storage/photo1.jpg"],
      },
    };
    const res = await canApproveAsBmAsync(bmBandung, readyReport);
    assert.strictEqual(res.authorized, true);
  });

  console.log("\n--- SECTION 3: Role Separation & Branch Isolation ---");

  await test("Cross-branch BnM Manager approval is strictly DENIED", async () => {
    const bandungReport: IncidentRecord = {
      ...baseReport,
      branch: "BANDUNG",
      status: "pending_bm_approval",
      verification: {
        confirmedBy: "Ahmad BMS",
        confirmedAt: new Date().toISOString(),
        isDamaged: true,
        photos: ["/storage/photo1.jpg"],
      },
    };
    // Jakarta BM tries to approve Bandung report
    const res = await canApproveAsBmAsync(bmJakarta, bandungReport);
    assert.strictEqual(res.authorized, false);
    assert.match(res.reason || "", /hanya berwenang untuk cabangnya sendiri/);
  });

  await test("HO users CANNOT give BnM confirmation", async () => {
    const readyReport: IncidentRecord = {
      ...baseReport,
      branch: "BANDUNG",
      status: "pending_bm_approval",
      verification: {
        confirmedBy: "Ahmad BMS",
        confirmedAt: new Date().toISOString(),
        isDamaged: true,
        photos: ["/storage/photo1.jpg"],
      },
    };
    const res = await canApproveAsBmAsync(hoUser, readyReport);
    assert.strictEqual(res.authorized, false);
    assert.match(res.reason || "", /Head Office/);
  });

  await test("TKP Toko inspected by BMS; TKP DC inspected by BES", async () => {
    const tokoReport: IncidentRecord = {
      ...baseReport,
      tkpType: "toko",
      status: "pending_confirmation",
    };
    const dcReport: IncidentRecord = {
      ...baseReport,
      tkpType: "dc",
      status: "pending_confirmation",
    };

    const bmsToko = await canSubmitInspectionAsync(bmsBandung, tokoReport);
    assert.strictEqual(bmsToko.authorized, true, "BMS can inspect Toko");

    const bmsDc = await canSubmitInspectionAsync(bmsBandung, dcReport);
    assert.strictEqual(bmsDc.authorized, false, "BMS CANNOT inspect DC");

    const besDc = await canSubmitInspectionAsync(besBandung, dcReport);
    assert.strictEqual(besDc.authorized, true, "BES can inspect DC");

    const besToko = await canSubmitInspectionAsync(besBandung, tokoReport);
    assert.strictEqual(besToko.authorized, false, "BES CANNOT inspect Toko");
  });

  console.log("\n--- SECTION 4: Distinction Between Initial BnM Approval & Final Case Close ---");

  await test("Initial approval action APPROVE_INITIAL only available at pending_bm_approval", () => {
    const pendingReport: IncidentRecord = { ...baseReport, status: "pending_bm_approval" };
    const actions = deriveWorkflowActions(bmBandung, pendingReport, { canApproveInitial: true });
    assert.deepEqual(actions.map(a => a.id), ["APPROVE_INITIAL"]);
  });

  await test("CASE_CLOSE action only available at APPROVED_PENDING_CLOSE after 100% completion", () => {
    const closeReadyReport: IncidentRecord = {
      ...baseReport,
      status: "approved_pending_close",
      progress: 100,
    };
    const actions = deriveWorkflowActions(bmBandung, closeReadyReport, {
      canClose: true,
      completionStatus: "APPROVED_PENDING_CLOSE",
    });
    assert.deepEqual(actions.map(a => a.id), ["CASE_CLOSE"]);
  });

  await test("HO receives ZERO operational workflow actions", () => {
    const rep: IncidentRecord = {
      ...baseReport,
      status: "confirmed_affected",
    };
    const actions = deriveWorkflowActions(hoUser, rep, {
      canInspect: true,
      canApproveInitial: true,
      canUpdateProgress: true,
      canClose: true,
    });
    assert.deepEqual(actions, [], "HO must never have operational actions");
  });

  await test("Case Close authority belongs exclusively to BnM Manager of the same branch; HO & specialists denied", () => {
    const closeReadyReport: IncidentRecord = {
      ...baseReport,
      branch: "BANDUNG",
      status: "approved_pending_close",
      progress: 100,
    };
    assert.strictEqual(canCloseReport(bmBandung, closeReadyReport), true, "BnM Bandung CAN close");
    assert.strictEqual(canCloseReport(bmsBandung, closeReadyReport), false, "BMS CANNOT close");
    assert.strictEqual(canCloseReport(besBandung, closeReadyReport), false, "BES CANNOT close");
    assert.strictEqual(canCloseReport(hoUser, closeReadyReport), false, "HO CANNOT close (read-only)");
    assert.strictEqual(canCloseReport(bmJakarta, closeReadyReport), false, "Jakarta BnM CANNOT close Bandung case");
    assert.strictEqual(canCloseReport(sysAdmin, closeReadyReport), true, "SysAdmin has operational override");
  });

  console.log("\n--- SECTION 5: SQL Access Policies for HO & Branch ---");

  await test("HO SQL access policy excludes unapproved reports and requires post-approval statuses", () => {
    const hoSql = getReportAccessSql(hoUser, "incidents", 1);
    assert.strictEqual(
      hoSql.clause.includes("report_origin = 'automatic_earthquake'"),
      false,
      "HO access SQL must NOT contain auto-earthquake exception"
    );
    assert.strictEqual(
      hoSql.clause.includes("status = ANY($1::text[])"),
      true,
      "HO access SQL must check post-approval statuses"
    );
    assert.strictEqual(
      hoSql.clause.includes("'pending_confirmation'"),
      true,
      "HO access SQL explicitly excludes preliminary statuses"
    );
  });

  await test("Branch SQL access policy isolates records to responsible branch", () => {
    const branchSql = getReportAccessSql(bmBandung, "incidents", 1);
    assert.strictEqual(branchSql.clause.includes("LOWER(TRIM(incidents.branch)) = LOWER(TRIM($1))"), true);
    assert.deepEqual(branchSql.values, ["BANDUNG"]);
  });

  console.log("\n--- SECTION 6: Auditable Approval Event Recording (Phase 3 Hook) ---");

  await test("recordReportApprovalEvent captures structured audit payload for Auto Email integration", async () => {
    clearRecordedApprovalEvents();

    const approvalEvent = {
      eventId: "appr_test_001",
      reportId: "LAP-EQ-2026-0042",
      decision: "approved" as const,
      outcomeStatus: "confirmed_affected" as const,
      disasterType: "earthquake",
      reportOrigin: "automatic_earthquake",
      branch: "BANDUNG",
      storeId: "T001",
      storeName: "Alfamart Dago Bandung",
      locationCity: "Bandung",
      decidedBy: {
        userId: bmBandung.id,
        name: bmBandung.name,
        role: "bm",
        systemRole: bmBandung.systemRole,
      },
      decidedAt: "2026-10-29 10:00:00 WIB",
      decisionNotes: "Ditemukan retak struktur dinding, disetujui untuk perbaikan.",
      condition: "damaged" as const,
      evidenceCount: 4,
      publishedToHo: true,
      createdAt: new Date().toISOString(),
    };

    const recorded = await recordReportApprovalEvent(approvalEvent);
    assert.strictEqual(recorded.reportId, "LAP-EQ-2026-0042");
    assert.strictEqual(recorded.decision, "approved");
    assert.strictEqual(recorded.publishedToHo, true);

    const events = getRecordedApprovalEvents("LAP-EQ-2026-0042");
    assert.strictEqual(events.length, 1);
    assert.strictEqual(events[0].outcomeStatus, "confirmed_affected");
    assert.strictEqual(events[0].decidedBy.name, "Pak Budi BnM Bandung");
  });

  await test("Safe confirmation records official safe approval event", async () => {
    const safeEvent = {
      eventId: "appr_test_002",
      reportId: "LAP-EQ-2026-0043",
      decision: "safe" as const,
      outcomeStatus: "confirmed_safe" as const,
      disasterType: "earthquake",
      reportOrigin: "automatic_earthquake",
      branch: "BANDUNG",
      storeId: "T002",
      storeName: "Alfamart Riau Bandung",
      decidedBy: {
        userId: bmBandung.id,
        name: bmBandung.name,
        role: "bm",
      },
      decidedAt: "2026-10-29 10:30:00 WIB",
      decisionNotes: "Pemeriksaan selesai, toko aman dan operasional normal.",
      condition: "safe" as const,
      evidenceCount: 2,
      publishedToHo: true,
      createdAt: new Date().toISOString(),
    };

    await recordReportApprovalEvent(safeEvent);
    const events = getRecordedApprovalEvents("LAP-EQ-2026-0043");
    assert.strictEqual(events.length, 1);
    assert.strictEqual(events[0].decision, "safe");
    assert.strictEqual(events[0].outcomeStatus, "confirmed_safe");
  });

  await test("Approval event recording is idempotent and never creates duplicate approval events", async () => {
    const duplicateSafeEvent = {
      eventId: "appr_test_002_duplicate",
      reportId: "LAP-EQ-2026-0043", // Same reportId
      decision: "safe" as const,
      outcomeStatus: "confirmed_safe" as const,
      disasterType: "earthquake",
      branch: "BANDUNG",
      storeId: "T002",
      storeName: "Alfamart Riau Bandung",
      decidedBy: {
        userId: bmBandung.id,
        name: bmBandung.name,
        role: "bm",
      },
      decidedAt: "2026-10-29 10:35:00 WIB",
      condition: "safe" as const,
      evidenceCount: 2,
      publishedToHo: true,
      createdAt: new Date().toISOString(),
    };

    // Re-recording must NOT increase count
    await recordReportApprovalEvent(duplicateSafeEvent);
    const events = getRecordedApprovalEvents("LAP-EQ-2026-0043");
    assert.strictEqual(events.length, 1, "Exactly one approval event must exist per report");
  });

  console.log("\n--- SECTION 7: Specialist Inspection Evidence Association & Route Isolation ---");

  await test("Inspection evidence photos are strictly bound to report ID and protected against cross-report traversal", () => {
    const reportA: IncidentRecord = {
      ...baseReport,
      id: "LAP-REPORT-A",
      verification: {
        confirmedBy: "Ahmad BMS",
        confirmedAt: new Date().toISOString(),
        isDamaged: true,
        photos: ["/api/incidents/LAP-REPORT-A/inspection/evidence/wm_sample_photo_a.jpg"],
      },
    };

    assert.strictEqual(
      isEvidencePhotoLinked(reportA, "LAP-REPORT-A", "wm_sample_photo_a.jpg"),
      true,
      "Valid photo belonging to report A is allowed"
    );

    assert.strictEqual(
      isEvidencePhotoLinked(reportA, "LAP-REPORT-A", "wm_sample_photo_b.jpg"),
      false,
      "Photo not registered on report A must be denied"
    );

    assert.strictEqual(
      isEvidencePhotoLinked(reportA, "LAP-REPORT-B", "wm_sample_photo_a.jpg"),
      false,
      "Endpoint for report B must reject photo from report A"
    );
  });

  console.log(`\n==========================================================================`);
  console.log(`  PHASE 1 TEST RESULTS: ${passedCount}/${totalCount} TESTS PASSED (0 FAILED)`);
  console.log(`==========================================================================\n`);

  process.exit(0);
}

runPhase1Tests().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});

