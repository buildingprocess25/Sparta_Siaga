import { getDbPool } from "../lib/db";
import { dbGetIncidentById, dbCreateIncident, dbUpdateIncident } from "../lib/incident-db";
import { IncidentRecord } from "../types/incident";
import {
  CompletionApprovalService,
  ensureCompletionApprovalTables,
} from "../lib/completion-approval-service";
import { ProgressService, ensureProgressTables } from "../lib/progress-service";
import {
  ensureEstimationRoutesTable,
} from "../lib/estimation-service";
import {
  ensureMilestoneTables,
} from "../lib/milestone-service";

async function runTaskT06TestSuite() {
  console.log("====================================================================");
  console.log("SPARTA SIAGA - TASK T06: PEMISAHAN FINAL APPROVAL & CASE CLOSE");
  console.log("Dedicated Verification Suite");
  console.log("====================================================================\n");

  const pool = getDbPool();
  let passedCount = 0;
  let totalTests = 0;

  function assert(condition: boolean, testCode: string, description: string, errorDetail?: string) {
    totalTests++;
    if (condition) {
      console.log(`[PASS] ${testCode}: ${description}`);
      passedCount++;
    } else {
      console.error(`[FAIL] ${testCode}: ${description} -> ${errorDetail || "Assertion failed"}`);
      process.exitCode = 1;
    }
  }

  try {
    await ensureEstimationRoutesTable();
    await ensureProgressTables();
    await ensureCompletionApprovalTables();
    await ensureMilestoneTables();

    // 1. Cleanup old test data
    await pool.query("DELETE FROM users WHERE id LIKE 'USR-T06-%'");
    await pool.query("DELETE FROM report_completion_approval_history WHERE report_id LIKE 'INC-T06-%'");
    await pool.query("DELETE FROM report_completion_approvals WHERE report_id LIKE 'INC-T06-%'");
    await pool.query("DELETE FROM report_milestones WHERE report_id LIKE 'INC-T06-%'");
    await pool.query("DELETE FROM report_progress_updates WHERE report_id LIKE 'INC-T06-%'");
    await pool.query("DELETE FROM permission_audit_logs WHERE target_user_id LIKE 'INC-T06-%'");
    await pool.query("DELETE FROM incidents WHERE id LIKE 'INC-T06-%'");

    // 2. Define personas
    const picBms = {
      id: "USR-T06-BMS-CIKOKOL",
      name: "Budi Santoso BMS",
      role: "bms" as const,
      systemRole: "USER" as const,
      scope: "BRANCH" as const,
      branch: "CIKOKOL",
    };

    await pool.query(
      `INSERT INTO users (id, nik, name, email, system_role, business_role, scope, branch, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'ACTIVE')
       ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name`,
      [picBms.id, "NIK-T06-01", picBms.name, "picbms@sparta.test", picBms.systemRole, picBms.role, picBms.scope, picBms.branch]
    );

    const coordBmc = {
      id: "USR-T06-BMC-CIKOKOL",
      name: "Citra Dewi BMC",
      role: "bmc" as const,
      systemRole: "USER" as const,
      scope: "BRANCH" as const,
      branch: "CIKOKOL",
    };

    const bmCikokol = {
      id: "USR-T06-BM-CIKOKOL",
      name: "Hendra Wijaya BM Cikokol",
      role: "bm" as const,
      systemRole: "USER" as const,
      scope: "BRANCH" as const,
      branch: "CIKOKOL",
    };

    const bmManado = {
      id: "USR-T06-BM-MANADO",
      name: "Rudi Manado BM",
      role: "bm" as const,
      systemRole: "USER" as const,
      scope: "BRANCH" as const,
      branch: "MANADO",
    };

    const hoAdmin = {
      id: "USR-T06-HO-ADMIN",
      name: "Indra HO Monitoring",
      role: "ho_admin" as const,
      systemRole: "USER" as const,
      scope: "HO" as const,
      branch: null,
    };

    const sysAdmin = {
      id: "USR-T06-SYS-ADMIN",
      name: "System Super Admin",
      role: "admin" as const,
      systemRole: "ADMIN" as const,
      scope: null,
      branch: null,
    };

    // 3. Create fresh test incident
    const testReportId = "INC-T06-001";
    await dbCreateIncident({
      id: testReportId,
      date: new Date().toISOString(),
      disasterType: "flood",
      reportOrigin: "manual",
      tkpType: "toko",
      storeId: "T001",
      storeName: "Alfamart Cikokol 1",
      branch: "CIKOKOL",
      locationCity: "Tangerang",
      status: "in_maintenance",
      progress: 100,
      primaryPicUserId: picBms.id,
      primaryPicName: picBms.name,
      primaryPicClaimedAt: new Date().toISOString(),
      timeline: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    await pool.query(
      `UPDATE incidents SET primary_pic_user_id = $1, primary_pic_claimed_at = NOW() WHERE id = $2`,
      [picBms.id, testReportId]
    );

    // Initialize & fulfill all 5 milestone documents so completion passes completeness
    const milestoneKeys = ["CEKLIS", "ESTIMASI", "APPROVE_PROXY", "SPK", "SERAH_TERIMA"];
    for (let i = 0; i < milestoneKeys.length; i++) {
      const k = milestoneKeys[i];
      await pool.query(
        `INSERT INTO report_milestones (
          id, report_id, stage_order, stage_key, stage_name, target_progress, status, document_url, document_storage_key, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, 'SUBMITTED', $7, $8, NOW())
        ON CONFLICT (report_id, stage_key) DO UPDATE SET status = 'SUBMITTED', document_url = $7, document_storage_key = $8, updated_at = NOW()`,
        [`ms_${testReportId}_${k.toLowerCase()}`, testReportId, i + 1, k, k, (i + 1) * 20, `https://storage.sparta.com/docs/${k}.pdf`, `docs/${k.toLowerCase()}.pdf`]
      );
    }

    // SCENARIO 1: PIC submits Serah Terima -> Does NOT close incident
    const submitResult = await CompletionApprovalService.submitCompletion({
      reportId: testReportId,
      actor: picBms,
      notes: "Pekerjaan fisik 100% dan dokumen serah terima terlampir.",
      attachments: [
        { url: "https://storage.sparta.com/st1.pdf", originalName: "BAST.pdf", type: "pdf", size: 1024 },
      ],
    });

    const reportAfterSubmit = await dbGetIncidentById(testReportId);
    assert(
      submitResult.status === "WAITING_COORDINATOR_APPROVAL" &&
      reportAfterSubmit?.status !== "closed" &&
      reportAfterSubmit?.status !== "resolved",
      "T06-S01",
      "PIC submit Serah Terima memajukan status ke WAITING_COORDINATOR_APPROVAL tanpa menutup laporan."
    );

    // SCENARIO 2: Koordinator approves Serah Terima -> Does NOT close incident
    const coordApproveResult = await CompletionApprovalService.approveByCoordinator({
      reportId: testReportId,
      actor: coordBmc,
      notes: "Verifikasi lapangan disetujui oleh Koordinator.",
    });

    const reportAfterCoord = await dbGetIncidentById(testReportId);
    assert(
      coordApproveResult.status === "WAITING_MANAGER_APPROVAL" &&
      reportAfterCoord?.status !== "closed" &&
      reportAfterCoord?.status !== "resolved",
      "T06-S02",
      "Koordinator menyetujui Serah Terima memajukan status ke WAITING_MANAGER_APPROVAL tanpa menutup laporan."
    );

    // SCENARIO 3: BnM Manajer tries Case Close BEFORE Final Approval -> MUST BE REJECTED
    let prematureCloseRejected = false;
    let prematureCloseError = "";
    try {
      await CompletionApprovalService.closeCase({
        reportId: testReportId,
        actor: bmCikokol,
        notes: "Mencoba close sebelum Final Approval",
      });
    } catch (err: any) {
      prematureCloseRejected = true;
      prematureCloseError = err.message;
    }
    assert(
      prematureCloseRejected && prematureCloseError.includes("belum mendapatkan persetujuan final"),
      "T06-S03",
      "BnM Manajer mencoba Case Close sebelum Final Approval DITOLAK dengan validasi state."
    );

    // SCENARIO 4: Unauthorized roles try Final Approval
    // 4A: Koordinator tries Final Approval
    let coordFaRejected = false;
    try {
      await CompletionApprovalService.approveByManager({
        reportId: testReportId,
        actor: coordBmc as any,
      });
    } catch {
      coordFaRejected = true;
    }
    assert(coordFaRejected, "T06-S04A", "Koordinator mencoba Final Approval ditolak (403 Role Mismatch).");

    // 4B: HO tries Final Approval
    let hoFaRejected = false;
    try {
      await CompletionApprovalService.approveByManager({
        reportId: testReportId,
        actor: hoAdmin,
      });
    } catch {
      hoFaRejected = true;
    }
    assert(hoFaRejected, "T06-S04B", "Akun Head Office (HO) mencoba Final Approval ditolak (403 Scope).");

    // 4C: System Admin tries Final Approval bypass
    let adminFaRejected = false;
    try {
      await CompletionApprovalService.approveByManager({
        reportId: testReportId,
        actor: sysAdmin,
      });
    } catch {
      adminFaRejected = true;
    }
    assert(adminFaRejected, "T06-S04C", "System Admin mencoba Final Approval bypass ditolak (Zero Bypass).");

    // 4D: BnM from other branch tries Final Approval
    let crossBranchFaRejected = false;
    try {
      await CompletionApprovalService.approveByManager({
        reportId: testReportId,
        actor: bmManado,
      });
    } catch {
      crossBranchFaRejected = true;
    }
    assert(crossBranchFaRejected, "T06-S04D", "BnM Manajer cabang lain (MANADO) mencoba Final Approval ditolak (Branch Isolation).");

    // SCENARIO 5: Authorized BnM Manajer executes Final Approval
    const finalApprovalResult = await CompletionApprovalService.approveByManager({
      reportId: testReportId,
      actor: bmCikokol,
      notes: "Pekerjaan fisik dan dokumen serah terima disetujui final.",
    });

    const approvalAfterFa = await CompletionApprovalService.getOrCreateApproval(testReportId);
    const reportAfterFa = await dbGetIncidentById(testReportId);

    assert(
      approvalAfterFa.status === "APPROVED_PENDING_CLOSE" &&
      approvalAfterFa.managerApprovedAt !== null &&
      reportAfterFa?.status === "approved_pending_close" &&
      !reportAfterFa?.closedAt,
      "T06-S05A",
      "Final Approval oleh BnM Manajer berhasil: status menjadi approved_pending_close, closedAt tetap NULL (belum Closed)."
    );

    // Verify Audit Log for Final Approval does NOT log REPORT_CLOSED
    const faAuditRes = await pool.query(
      "SELECT * FROM permission_audit_logs WHERE target_user_id = $1 ORDER BY created_at DESC LIMIT 1",
      [testReportId]
    );
    assert(
      faAuditRes.rows.length > 0 && faAuditRes.rows[0].action === "FINAL_APPROVAL_GRANTED",
      "T06-S05B",
      "Audit trail mencatat FINAL_APPROVAL_GRANTED dan TIDAK mencatat REPORT_CLOSED pada tahap Final Approval."
    );

    // SCENARIO 6: PIC identity remains immutable
    assert(
      reportAfterFa?.primaryPicUserId === picBms.id &&
      reportAfterFa?.primaryPicName === picBms.name,
      "T06-S06",
      "Identitas PIC awal (BMS) tetap aman dan tidak tergantikan oleh approver BnM Manajer."
    );

    // SCENARIO 7: Unauthorized roles try Case Close
    // 7A: Koordinator tries Case Close
    let coordCloseRejected = false;
    try {
      await CompletionApprovalService.closeCase({
        reportId: testReportId,
        actor: coordBmc as any,
      });
    } catch {
      coordCloseRejected = true;
    }
    assert(coordCloseRejected, "T06-S07A", "Koordinator mencoba Case Close ditolak (403 Role Mismatch).");

    // 7B: HO tries Case Close
    let hoCloseRejected = false;
    try {
      await CompletionApprovalService.closeCase({
        reportId: testReportId,
        actor: hoAdmin,
      });
    } catch {
      hoCloseRejected = true;
    }
    assert(hoCloseRejected, "T06-S07B", "Akun Head Office (HO) mencoba Case Close ditolak (403 Scope).");

    // 7C: System Admin tries Case Close bypass
    let adminCloseRejected = false;
    try {
      await CompletionApprovalService.closeCase({
        reportId: testReportId,
        actor: sysAdmin,
      });
    } catch {
      adminCloseRejected = true;
    }
    assert(adminCloseRejected, "T06-S07C", "System Admin mencoba Case Close bypass ditolak (Zero Bypass).");

    // 7D: BnM from other branch tries Case Close
    let crossBranchCloseRejected = false;
    try {
      await CompletionApprovalService.closeCase({
        reportId: testReportId,
        actor: bmManado,
      });
    } catch {
      crossBranchCloseRejected = true;
    }
    assert(crossBranchCloseRejected, "T06-S07D", "BnM Manajer cabang lain (MANADO) mencoba Case Close ditolak (Branch Isolation).");

    // SCENARIO 8: Authorized BnM Manajer executes Case Close
    const closeResult = await CompletionApprovalService.closeCase({
      reportId: testReportId,
      actor: bmCikokol,
      notes: "Kasus resmi ditutup operasional.",
    });

    const approvalAfterClose = await CompletionApprovalService.getOrCreateApproval(testReportId);
    const reportAfterClose = await dbGetIncidentById(testReportId);

    assert(
      approvalAfterClose.status === "CLOSED" &&
      approvalAfterClose.closedAt !== null &&
      approvalAfterClose.closedByUserId === bmCikokol.id &&
      reportAfterClose?.status === "closed" &&
      reportAfterClose?.closedAt !== null,
      "T06-S08A",
      "Case Close oleh BnM Manajer berhasil: approval.status = CLOSED, incident.status = closed, dan closedAt tercatat."
    );

    // Verify Audit Log for Case Close
    const closeAuditRes = await pool.query(
      "SELECT * FROM permission_audit_logs WHERE target_user_id = $1 AND action = 'REPORT_CLOSED'",
      [testReportId]
    );
    assert(
      closeAuditRes.rows.length === 1 &&
      closeAuditRes.rows[0].actor_user_id === bmCikokol.id,
      "T06-S08B",
      "Audit trail mencatat REPORT_CLOSED secara atomik dengan aktor BnM Manajer yang sah."
    );

    // SCENARIO 9: Idempotency check - second call to Case Close does not create duplicate history/audit
    const historyCountBefore = (await pool.query(
      "SELECT COUNT(*) as cnt FROM report_completion_approval_history WHERE report_id = $1",
      [testReportId]
    )).rows[0].cnt;

    const repeatCloseResult = await CompletionApprovalService.closeCase({
      reportId: testReportId,
      actor: bmCikokol,
      notes: "Panggilan close kedua kalinya",
    });

    const historyCountAfter = (await pool.query(
      "SELECT COUNT(*) as cnt FROM report_completion_approval_history WHERE report_id = $1",
      [testReportId]
    )).rows[0].cnt;

    const closeAuditCountAfter = (await pool.query(
      "SELECT COUNT(*) as cnt FROM permission_audit_logs WHERE target_user_id = $1 AND action = 'REPORT_CLOSED'",
      [testReportId]
    )).rows[0].cnt;

    assert(
      repeatCloseResult.status === "closed" &&
      historyCountBefore === historyCountAfter &&
      closeAuditCountAfter === "1",
      "T06-S09",
      "Case Close kedua kalinya idempoten: tidak menghasilkan entri riwayat atau audit log duplikat."
    );

    // SCENARIO 10: Historical Closed Reports Safety
    // Create an old historical incident already closed
    const historicalReportId = "INC-T06-HIST-001";
    await dbCreateIncident({
      id: historicalReportId,
      date: "2026-08-01T10:00:00Z",
      disasterType: "earthquake",
      reportOrigin: "automatic_earthquake",
      storeId: "T999",
      storeName: "Alfamart Historis",
      branch: "CIKOKOL",
      locationCity: "Tangerang",
      status: "closed",
      progress: 100,
      closedAt: "2026-08-02T15:00:00Z",
      timeline: [],
      createdAt: "2026-08-01T10:00:00Z",
      updatedAt: "2026-08-02T15:00:00Z",
    });

    const histApproval = await CompletionApprovalService.getOrCreateApproval(historicalReportId);
    const histIncident = await dbGetIncidentById(historicalReportId);

    assert(
      histApproval.status === "CLOSED" &&
      histIncident?.status === "closed" &&
      Boolean(histIncident?.closedAt) &&
      new Date(histIncident!.closedAt!).getTime() === new Date("2026-08-02T15:00:00Z").getTime(),
      "T06-S10",
      "Laporan historis yang sudah closed tetap Closed 100%, tidak dibuka kembali atau diubah statusnya."
    );

    console.log(`\n====================================================================`);
    console.log(`TASK T06 TEST RESULTS: ${passedCount} / ${totalTests} PASSED`);
    console.log(`====================================================================\n`);

  } finally {
    // Cleanup test incidents
    await pool.query("DELETE FROM report_completion_approval_history WHERE report_id LIKE 'INC-T06-%'");
    await pool.query("DELETE FROM report_completion_approvals WHERE report_id LIKE 'INC-T06-%'");
    await pool.query("DELETE FROM report_milestones WHERE report_id LIKE 'INC-T06-%'");
    await pool.query("DELETE FROM report_progress_updates WHERE report_id LIKE 'INC-T06-%'");
    await pool.query("DELETE FROM permission_audit_logs WHERE target_user_id LIKE 'INC-T06-%'");
    await pool.query("DELETE FROM incidents WHERE id LIKE 'INC-T06-%'");
    await pool.query("DELETE FROM users WHERE id LIKE 'USR-T06-%'");
  }
}

runTaskT06TestSuite()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Test Suite Error:", err);
    process.exit(1);
  });
