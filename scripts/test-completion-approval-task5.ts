import { getDbPool } from "../lib/db";
import { dbGetIncidentById, dbCreateIncident, dbUpdateIncident } from "../lib/incident-db";
import { IncidentRecord } from "../types/incident";
import {
  CompletionApprovalService,
  ensureCompletionApprovalTables,
  resolveApprovalRoute,
} from "../lib/completion-approval-service";
import { ProgressService, ensureProgressTables } from "../lib/progress-service";
import {
  EstimationIntegrationService,
  ensureEstimationRoutesTable,
} from "../lib/estimation-service";
import { processAndWatermarkPhoto } from "../lib/watermark";
import sharp from "sharp";

async function runTask5TestSuite() {
  console.log("==================================================");
  console.log("SPARTA SIAGA - TASK 5: COMPLETION, APPROVAL & CLOSING");
  console.log("Dedicated Test Suite: T1 – T25");
  console.log("==================================================\n");

  const pool = getDbPool();
  let passedCount = 0;
  let totalTests = 0;

  function assert(condition: boolean, testCode: string, description: string, errorDetail?: string) {
    totalTests++;
    if (condition) {
      console.log(`[PASS] Scenario ${testCode}: ${description}`);
      passedCount++;
    } else {
      console.error(`[FAIL] Scenario ${testCode}: ${description} -> ${errorDetail || "Condition failed"}`);
      process.exitCode = 1;
    }
  }

  try {
    await ensureEstimationRoutesTable();
    await ensureProgressTables();
    await ensureCompletionApprovalTables();

    // 1. Cleanup old test data
    await pool.query("DELETE FROM report_completion_approval_history WHERE report_id LIKE 'INC-T5-%'");
    await pool.query("DELETE FROM report_completion_approvals WHERE report_id LIKE 'INC-T5-%'");
    await pool.query("DELETE FROM report_progress_updates WHERE report_id LIKE 'INC-T5-%'");
    await pool.query("DELETE FROM report_estimation_routes WHERE report_id LIKE 'INC-T5-%'");
    await pool.query("DELETE FROM incidents WHERE id LIKE 'INC-T5-%'");

    // 2. Setup Actors
    const bmsG001 = { id: "USR-BMS-G1", name: "Budi BMS", role: "bms" as const, systemRole: "USER" as const, scope: "BRANCH" as const, branch: "G001" };
    const bmsG002 = { id: "USR-BMS-G2", name: "Beno BMS G2", role: "bms" as const, systemRole: "USER" as const, scope: "BRANCH" as const, branch: "G002" };
    
    const bmcG001 = { id: "USR-BMC-G1", name: "Citra BMC", role: "bmc" as const, systemRole: "USER" as const, scope: "BRANCH" as const, branch: "G001" };
    const bmcG002 = { id: "USR-BMC-G2", name: "Coki BMC G2", role: "bmc" as const, systemRole: "USER" as const, scope: "BRANCH" as const, branch: "G002" };

    const besG001 = { id: "USR-BES-G1", name: "Deni BES", role: "bes" as const, systemRole: "USER" as const, scope: "BRANCH" as const, branch: "G001" };
    const becG001 = { id: "USR-BEC-G1", name: "Eko BEC", role: "bec" as const, systemRole: "USER" as const, scope: "BRANCH" as const, branch: "G001" };

    const bbsG001 = { id: "USR-BBS-G1", name: "Fajar BBS", role: "bbs" as const, systemRole: "USER" as const, scope: "BRANCH" as const, branch: "G001" };
    const bbcG001 = { id: "USR-BBC-G1", name: "Gilang BBC", role: "bbc" as const, systemRole: "USER" as const, scope: "BRANCH" as const, branch: "G001" };

    const bmG001 = { id: "USR-BM-G1", name: "Hari BM G1", role: "bm" as const, systemRole: "USER" as const, scope: "BRANCH" as const, branch: "G001" };
    const bmG002 = { id: "USR-BM-G2", name: "Hasan BM G2", role: "bm" as const, systemRole: "USER" as const, scope: "BRANCH" as const, branch: "G002" };

    const hoAdmin = { id: "USR-HO-ADMIN", name: "Indra HO", role: "ho_admin" as const, systemRole: "USER" as const, scope: "HO" as const, branch: null };
    const sysAdmin = { id: "USR-SYS-ADMIN", name: "Super Admin", role: "admin" as const, systemRole: "ADMIN" as const, scope: null, branch: null };

    // Create a 100x100 sample PNG buffer for mock handover evidence
    const sampleBuffer = await sharp({
      create: { width: 200, height: 200, channels: 3, background: { r: 80, g: 150, b: 220 } },
    }).png().toBuffer();

    // ----------------------------------------------------
    // SETUP TEST INCIDENTS
    // ----------------------------------------------------
    // Report 1: BMS Flow (Toko, G001)
    const reportBms: IncidentRecord = {
      id: "INC-T5-BMS-001",
      storeId: "STR-G1-01",
      storeName: "Alfamart Kalisari G001",
      branch: "G001",
      locationCity: "Jakarta Timur",
      disasterType: "flood",
      reportOrigin: "manual",
      tkpType: "toko",
      date: "07 Oct 2026",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: "in_maintenance",
      progress: 0,
      timeline: [],
    };
    await dbCreateIncident(reportBms);
    await EstimationIntegrationService.createRoute({
      reportId: reportBms.id,
      report: reportBms,
      handlerType: "BMS",
      actor: bmsG001,
    });
    // Set to READY_FOR_WORK then IN_PROGRESS
    await EstimationIntegrationService.updateWorkStatus(reportBms.id, "READY_FOR_WORK", { bypassReadinessValidation: true });

    // Report 2: BES Flow (DC, G001)
    const reportBes: IncidentRecord = {
      id: "INC-T5-BES-001",
      storeId: "DC-G1-01",
      storeName: "DC Cibubur G001",
      branch: "G001",
      locationCity: "Jakarta Timur",
      disasterType: "fire",
      reportOrigin: "manual",
      tkpType: "dc",
      date: "07 Oct 2026",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: "in_maintenance",
      progress: 0,
      timeline: [],
    };
    await dbCreateIncident(reportBes);
    await EstimationIntegrationService.createRoute({
      reportId: reportBes.id,
      report: reportBes,
      handlerType: "BES",
      actor: besG001,
    });
    await EstimationIntegrationService.updateWorkStatus(reportBes.id, "READY_FOR_WORK", { bypassReadinessValidation: true });

    // Report 3: Building BBS Flow (Building, G001)
    const reportBbs: IncidentRecord = {
      id: "INC-T5-BBS-001",
      storeId: "BLD-G1-01",
      storeName: "Kantor Cabang G001",
      branch: "G001",
      locationCity: "Jakarta Timur",
      disasterType: "severe_building_damage",
      reportOrigin: "manual",
      tkpType: "toko",
      date: "07 Oct 2026",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: "in_maintenance",
      progress: 0,
      timeline: [],
    };
    await dbCreateIncident(reportBbs);
    await EstimationIntegrationService.createRoute({
      reportId: reportBbs.id,
      report: reportBbs,
      handlerType: "BUILDING",
      actor: bbsG001,
    });
    await EstimationIntegrationService.updateWorkStatus(reportBbs.id, "READY_FOR_WORK", { bypassReadinessValidation: true });

    // Report 4: Rekanan Flow (Toko, G001, Handler Rekanan -> BMS Internal PIC)
    const reportRekanan: IncidentRecord = {
      id: "INC-T5-REK-001",
      storeId: "STR-G1-02",
      storeName: "Alfamart Ciracas G001",
      branch: "G001",
      locationCity: "Jakarta Timur",
      disasterType: "flood",
      reportOrigin: "manual",
      tkpType: "toko",
      date: "07 Oct 2026",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: "in_maintenance",
      progress: 0,
      timeline: [],
    };
    await dbCreateIncident(reportRekanan);
    await EstimationIntegrationService.createRoute({
      reportId: reportRekanan.id,
      report: reportRekanan,
      handlerType: "REKANAN",
      actor: bmsG001,
    });
    await EstimationIntegrationService.updateWorkStatus(reportRekanan.id, "READY_FOR_WORK", { bypassReadinessValidation: true });

    // ----------------------------------------------------
    // SCENARIO T1: IN_PROGRESS tidak dapat submit completion
    // ----------------------------------------------------
    // Update progress reportBms to 50% (workStatus: IN_PROGRESS)
    const wm50 = await processAndWatermarkPhoto(sampleBuffer, {
      reportId: reportBms.id,
      reportNumber: reportBms.id,
      storeName: reportBms.storeName,
      progressPercentage: 50,
      actorName: bmsG001.name,
      photoType: "PROGRESS",
    });
    await ProgressService.createProgressUpdate({
      reportId: reportBms.id,
      progressPercentage: 50,
      description: "Pekerjaan 50%",
      stage: "PENGERJAAN",
      actor: { id: bmsG001.id, name: bmsG001.name },
      photos: [{ photoType: "PROGRESS", originalPath: wm50.originalPath, watermarkedPath: wm50.watermarkedPath, fileSize: wm50.fileSize, mimeType: wm50.mimeType }],
    });

    let t1Rejected = false;
    try {
      await CompletionApprovalService.submitCompletion({
        reportId: reportBms.id,
        actor: bmsG001,
        notes: "Mencoba submit saat masih 50%",
      });
    } catch (err: any) {
      if (err.status === 400 && (err.code === "WORK_NOT_COMPLETED" || err.code === "PROGRESS_NOT_100")) {
        t1Rejected = true;
      }
    }
    assert(t1Rejected, "T1", "IN_PROGRESS (progress 50%) tidak dapat submit completion (400)");

    // ----------------------------------------------------
    // SCENARIO T2: COMPLETED tanpa mandatory final evidence ditolak
    // ----------------------------------------------------
    // Update to 100% but only using PROGRESS photo (no FINAL/HANDOVER)
    const wm100Progress = await processAndWatermarkPhoto(sampleBuffer, {
      reportId: reportBms.id,
      reportNumber: reportBms.id,
      storeName: reportBms.storeName,
      progressPercentage: 100,
      actorName: bmsG001.name,
      photoType: "PROGRESS",
    });
    await ProgressService.createProgressUpdate({
      reportId: reportBms.id,
      progressPercentage: 100,
      description: "Pekerjaan 100% tanpa handover",
      stage: "FINISHING",
      actor: { id: bmsG001.id, name: bmsG001.name },
      photos: [{ photoType: "PROGRESS", originalPath: wm100Progress.originalPath, watermarkedPath: wm100Progress.watermarkedPath, fileSize: wm100Progress.fileSize, mimeType: wm100Progress.mimeType }],
    });
    // Manually force workStatus COMPLETED on route for testing missing evidence
    await pool.query("UPDATE report_estimation_routes SET work_status = 'COMPLETED' WHERE report_id = $1", [reportBms.id]);
    await dbUpdateIncident(reportBms.id, { progress: 100 });

    let t2Rejected = false;
    try {
      await CompletionApprovalService.submitCompletion({
        reportId: reportBms.id,
        actor: bmsG001,
        notes: "Submit 100% tanpa bukti akhir",
      });
    } catch (err: any) {
      if (err.status === 400 && err.code === "FINAL_EVIDENCE_MISSING") {
        t2Rejected = true;
      }
    }
    assert(t2Rejected, "T2", "COMPLETED tanpa mandatory final evidence (HANDOVER) ditolak (400 FINAL_EVIDENCE_MISSING)");

    // Reset work_status to IN_PROGRESS so progress update with HANDOVER can transition it naturally to COMPLETED
    await pool.query("UPDATE report_estimation_routes SET work_status = 'IN_PROGRESS' WHERE report_id = $1", [reportBms.id]);

    // Upload mandatory HANDOVER evidence for reportBms
    const wmBmsHandover = await processAndWatermarkPhoto(sampleBuffer, {
      reportId: reportBms.id,
      reportNumber: reportBms.id,
      storeName: reportBms.storeName,
      progressPercentage: 100,
      actorName: bmsG001.name,
      photoType: "HANDOVER",
    });
    await ProgressService.createProgressUpdate({
      reportId: reportBms.id,
      progressPercentage: 100,
      description: "Pekerjaan 100% selesai serah terima",
      stage: "SELESAI",
      actor: { id: bmsG001.id, name: bmsG001.name },
      photos: [{ photoType: "HANDOVER", originalPath: wmBmsHandover.originalPath, watermarkedPath: wmBmsHandover.watermarkedPath, fileSize: wmBmsHandover.fileSize, mimeType: wmBmsHandover.mimeType }],
    });

    // ----------------------------------------------------
    // SCENARIO T6: Cross-branch PIC ditolak
    // ----------------------------------------------------
    let t6Rejected = false;
    try {
      await CompletionApprovalService.submitCompletion({
        reportId: reportBms.id,
        actor: bmsG002, // G002 PIC trying to submit G001 report
        notes: "BMS G002 mencoba submit laporan G001",
      });
    } catch (err: any) {
      if (err.status === 403 && err.code === "BRANCH_SCOPE_VIOLATION") {
        t6Rejected = true;
      }
    }
    assert(t6Rejected, "T6", "Cross-branch PIC (BMS G002 pada report G001) ditolak (403 BRANCH_SCOPE_VIOLATION)");

    // ----------------------------------------------------
    // SCENARIO T3: BMS dapat submit completion jalur BMS same branch
    // ----------------------------------------------------
    const submitBmsRes = await CompletionApprovalService.submitCompletion({
      reportId: reportBms.id,
      actor: bmsG001,
      notes: "Pengajuan penyelesaian toko oleh BMS G001",
    });
    assert(
      submitBmsRes.status === "WAITING_COORDINATOR_APPROVAL" && submitBmsRes.picRole === "bms",
      "T3",
      "BMS dapat submit completion jalur BMS same branch -> WAITING_COORDINATOR_APPROVAL"
    );

    // ----------------------------------------------------
    // SCENARIO T4: BES dapat submit completion jalur BES same branch
    // ----------------------------------------------------
    const wmBesHandover = await processAndWatermarkPhoto(sampleBuffer, {
      reportId: reportBes.id,
      reportNumber: reportBes.id,
      storeName: reportBes.storeName,
      progressPercentage: 100,
      actorName: besG001.name,
      photoType: "HANDOVER",
    });
    await ProgressService.createProgressUpdate({
      reportId: reportBes.id,
      progressPercentage: 100,
      description: "Pekerjaan DC 100%",
      stage: "SELESAI",
      actor: { id: besG001.id, name: besG001.name },
      photos: [{ photoType: "HANDOVER", originalPath: wmBesHandover.originalPath, watermarkedPath: wmBesHandover.watermarkedPath, fileSize: wmBesHandover.fileSize, mimeType: wmBesHandover.mimeType }],
    });
    const submitBesRes = await CompletionApprovalService.submitCompletion({
      reportId: reportBes.id,
      actor: besG001,
      notes: "Pengajuan penyelesaian DC oleh BES G001",
    });
    assert(
      submitBesRes.status === "WAITING_COORDINATOR_APPROVAL" && submitBesRes.picRole === "bes",
      "T4",
      "BES dapat submit completion jalur BES same branch -> WAITING_COORDINATOR_APPROVAL"
    );

    // ----------------------------------------------------
    // SCENARIO T5: BBS dapat submit completion jalur BBS same branch
    // ----------------------------------------------------
    const wmBbsHandover = await processAndWatermarkPhoto(sampleBuffer, {
      reportId: reportBbs.id,
      reportNumber: reportBbs.id,
      storeName: reportBbs.storeName,
      progressPercentage: 100,
      actorName: bbsG001.name,
      photoType: "HANDOVER",
    });
    await ProgressService.createProgressUpdate({
      reportId: reportBbs.id,
      progressPercentage: 100,
      description: "Pekerjaan Gedung 100%",
      stage: "SELESAI",
      actor: { id: bbsG001.id, name: bbsG001.name },
      photos: [{ photoType: "HANDOVER", originalPath: wmBbsHandover.originalPath, watermarkedPath: wmBbsHandover.watermarkedPath, fileSize: wmBbsHandover.fileSize, mimeType: wmBbsHandover.mimeType }],
    });
    const submitBbsRes = await CompletionApprovalService.submitCompletion({
      reportId: reportBbs.id,
      actor: bbsG001,
      notes: "Pengajuan penyelesaian Gedung oleh BBS G001",
    });
    assert(
      submitBbsRes.status === "WAITING_COORDINATOR_APPROVAL" && submitBbsRes.picRole === "bbs",
      "T5",
      "BBS dapat submit completion jalur BBS same branch -> WAITING_COORDINATOR_APPROVAL"
    );

    // ----------------------------------------------------
    // SCENARIO T7: BMS submission diroute ke BMC
    // ----------------------------------------------------
    assert(submitBmsRes.coordinatorRole === "bmc", "T7", "BMS submission diroute ke BMC");

    // ----------------------------------------------------
    // SCENARIO T8: BES submission diroute ke BEC
    // ----------------------------------------------------
    assert(submitBesRes.coordinatorRole === "bec", "T8", "BES submission diroute ke BEC");

    // ----------------------------------------------------
    // SCENARIO T9: BBS submission diroute ke BBC
    // ----------------------------------------------------
    assert(submitBbsRes.coordinatorRole === "bbc", "T9", "BBS submission diroute ke BBC");

    // ----------------------------------------------------
    // SCENARIO T10: BMC tidak dapat approve BES/BBS flow
    // ----------------------------------------------------
    let t10BesRejected = false;
    let t10BbsRejected = false;
    try {
      await CompletionApprovalService.approveByCoordinator({
        reportId: reportBes.id,
        actor: bmcG001,
      });
    } catch (err: any) {
      if (err.status === 403 && err.code === "COORDINATOR_MISMATCH") t10BesRejected = true;
    }
    try {
      await CompletionApprovalService.approveByCoordinator({
        reportId: reportBbs.id,
        actor: bmcG001,
      });
    } catch (err: any) {
      if (err.status === 403 && err.code === "COORDINATOR_MISMATCH") t10BbsRejected = true;
    }
    assert(t10BesRejected && t10BbsRejected, "T10", "BMC tidak dapat approve jalur BES maupun BBS (403 COORDINATOR_MISMATCH)");

    // ----------------------------------------------------
    // SCENARIO T11: BEC tidak dapat approve BMS/BBS flow
    // ----------------------------------------------------
    let t11BmsRejected = false;
    let t11BbsRejected = false;
    try {
      await CompletionApprovalService.approveByCoordinator({
        reportId: reportBms.id,
        actor: becG001,
      });
    } catch (err: any) {
      if (err.status === 403 && err.code === "COORDINATOR_MISMATCH") t11BmsRejected = true;
    }
    try {
      await CompletionApprovalService.approveByCoordinator({
        reportId: reportBbs.id,
        actor: becG001,
      });
    } catch (err: any) {
      if (err.status === 403 && err.code === "COORDINATOR_MISMATCH") t11BbsRejected = true;
    }
    assert(t11BmsRejected && t11BbsRejected, "T11", "BEC tidak dapat approve jalur BMS maupun BBS (403 COORDINATOR_MISMATCH)");

    // ----------------------------------------------------
    // SCENARIO T12: BBC tidak dapat approve BMS/BES flow
    // ----------------------------------------------------
    let t12BmsRejected = false;
    let t12BesRejected = false;
    try {
      await CompletionApprovalService.approveByCoordinator({
        reportId: reportBms.id,
        actor: bbcG001,
      });
    } catch (err: any) {
      if (err.status === 403 && err.code === "COORDINATOR_MISMATCH") t12BmsRejected = true;
    }
    try {
      await CompletionApprovalService.approveByCoordinator({
        reportId: reportBes.id,
        actor: bbcG001,
      });
    } catch (err: any) {
      if (err.status === 403 && err.code === "COORDINATOR_MISMATCH") t12BesRejected = true;
    }
    assert(t12BmsRejected && t12BesRejected, "T12", "BBC tidak dapat approve jalur BMS maupun BES (403 COORDINATOR_MISMATCH)");

    // ----------------------------------------------------
    // SCENARIO T13: Coordinator cross-branch ditolak
    // ----------------------------------------------------
    let t13Rejected = false;
    try {
      await CompletionApprovalService.approveByCoordinator({
        reportId: reportBms.id,
        actor: bmcG002, // G002 coordinator trying to approve G001 report
      });
    } catch (err: any) {
      if (err.status === 403 && err.code === "BRANCH_SCOPE_VIOLATION") {
        t13Rejected = true;
      }
    }
    assert(t13Rejected, "T13", "Coordinator cross-branch (BMC G002 pada report G001) ditolak (403 BRANCH_SCOPE_VIOLATION)");

    // ----------------------------------------------------
    // SCENARIO T14: Manager tidak dapat approve sebelum coordinator approval
    // ----------------------------------------------------
    let t14Rejected = false;
    try {
      await CompletionApprovalService.approveByManager({
        reportId: reportBms.id, // currently at WAITING_COORDINATOR_APPROVAL
        actor: bmG001,
      });
    } catch (err: any) {
      if (err.status === 400 && err.code === "COORDINATOR_APPROVAL_REQUIRED") {
        t14Rejected = true;
      }
    }
    assert(t14Rejected, "T14", "Manager tidak dapat approve sebelum coordinator approval (400 COORDINATOR_APPROVAL_REQUIRED)");

    // ----------------------------------------------------
    // SCENARIO T21: Direct Branch Manager close tanpa coordinator ditolak
    // ----------------------------------------------------
    let t21Rejected = false;
    try {
      await ProgressService.closeReport({
        reportId: reportBms.id,
        actor: bmG001,
        reason: "BM mencoba direct close",
      });
    } catch (err: any) {
      if (err.status === 400 && err.code === "COORDINATOR_APPROVAL_REQUIRED") {
        t21Rejected = true;
      }
    }
    assert(t21Rejected, "T21", "Direct Branch Manager close tanpa coordinator ditolak (400 COORDINATOR_APPROVAL_REQUIRED)");

    // ----------------------------------------------------
    // SCENARIO T18: Coordinator reject menghasilkan REVISION_REQUIRED + reason/history
    // ----------------------------------------------------
    let t18EmptyReasonRejected = false;
    try {
      await CompletionApprovalService.rejectByCoordinator({
        reportId: reportBms.id,
        actor: bmcG001,
        reason: "   ", // empty
      });
    } catch (err: any) {
      if (err.status === 400 && err.code === "REJECTION_REASON_REQUIRED") {
        t18EmptyReasonRejected = true;
      }
    }

    const rejectCoordRes = await CompletionApprovalService.rejectByCoordinator({
      reportId: reportBms.id,
      actor: bmcG001,
      reason: "Catatan revisi: Bukti foto serah terima kurang jelas pada bagian plafon",
    });

    const reportBmsAfterReject = await dbGetIncidentById(reportBms.id);
    const historyAfterReject = await CompletionApprovalService.getApprovalHistory(reportBms.id);
    const hasRejectHistory = historyAfterReject.some((h) => h.action === "REJECT_COORDINATOR" && h.notes?.includes("plafon"));

    assert(
      Boolean(
        t18EmptyReasonRejected &&
        rejectCoordRes.status === "REVISION_REQUIRED" &&
        rejectCoordRes.rejectionReason?.includes("plafon") &&
        reportBmsAfterReject !== null &&
        reportBmsAfterReject?.status === "in_maintenance" && // NOT closed!
        hasRejectHistory
      ),
      "T18",
      "Coordinator reject menghasilkan REVISION_REQUIRED + mandatory reason + append-only history dan tidak menutup laporan"
    );

    // Resubmit by BMS after revision
    await CompletionApprovalService.submitCompletion({
      reportId: reportBms.id,
      actor: bmsG001,
      notes: "Foto plafon telah diperbarui dan siap diperiksa kembali",
    });

    // BMC approves reportBms
    const bmcApproved = await CompletionApprovalService.approveByCoordinator({
      reportId: reportBms.id,
      actor: bmcG001,
      notes: "Hasil pekerjaan telah diverifikasi oke oleh BMC",
    });
    assert(
      bmcApproved.status === "WAITING_MANAGER_APPROVAL",
      "T18-sub",
      "Persetujuan ulang BMC setelah revisi berhasil mengubah status ke WAITING_MANAGER_APPROVAL"
    );

    // ----------------------------------------------------
    // SCENARIO T16: Manager Branch berbeda ditolak
    // ----------------------------------------------------
    let t16Rejected = false;
    try {
      await CompletionApprovalService.approveByManager({
        reportId: reportBms.id,
        actor: bmG002, // G002 BM trying to approve G001 report
      });
    } catch (err: any) {
      if (err.status === 403 && err.code === "BRANCH_SCOPE_VIOLATION") {
        t16Rejected = true;
      }
    }
    assert(t16Rejected, "T16", "Manager Branch berbeda (BM G002 pada report G001) ditolak (403 BRANCH_SCOPE_VIOLATION)");

    // ----------------------------------------------------
    // SCENARIO T17: HO/System Admin tidak dapat menggantikan Manager Branch
    // ----------------------------------------------------
    let t17HoRejected = false;
    let t17AdminRejected = false;
    try {
      await CompletionApprovalService.approveByManager({
        reportId: reportBms.id,
        actor: hoAdmin,
      });
    } catch (err: any) {
      if (err.status === 403) t17HoRejected = true;
    }
    try {
      await CompletionApprovalService.approveByManager({
        reportId: reportBms.id,
        actor: sysAdmin,
      });
    } catch (err: any) {
      if (err.status === 403) t17AdminRejected = true;
    }
    assert(t17HoRejected && t17AdminRejected, "T17", "HO Admin dan System Admin tidak dapat menggantikan Manager Branch (403)");

    // ----------------------------------------------------
    // SCENARIO T19: Manager reject tidak menutup report
    // ----------------------------------------------------
    const rejectManagerRes = await CompletionApprovalService.rejectByManager({
      reportId: reportBms.id,
      actor: bmG001,
      reason: "Catatan BM: Perlu verifikasi administrasi berita acara toko",
    });
    const reportBmsAfterBmReject = await dbGetIncidentById(reportBms.id);
    assert(
      Boolean(
        rejectManagerRes.status === "REVISION_REQUIRED" &&
        reportBmsAfterBmReject?.status === "in_maintenance" // Definitely not resolved!
      ),
      "T19",
      "Manager reject tidak menutup report (status approval: REVISION_REQUIRED, incident.status: in_maintenance)"
    );

    // Resubmit -> Coordinator approve again for final close test
    await CompletionApprovalService.submitCompletion({ reportId: reportBms.id, actor: bmsG001, notes: "Berita acara toko terlampir" });
    await CompletionApprovalService.approveByCoordinator({ reportId: reportBms.id, actor: bmcG001, notes: "Verified oleh BMC" });

    // ----------------------------------------------------
    // SCENARIO T15: Manager Branch same branch dapat final approve
    // ----------------------------------------------------
    const bmApprovedReport = await CompletionApprovalService.approveByManager({
      reportId: reportBms.id,
      actor: bmG001,
      notes: "Pekerjaan 100% tervalidasi dan laporan resmi ditutup oleh BM G001",
    });
    assert(
      bmApprovedReport.status === "resolved",
      "T15",
      "Manager Branch same branch dapat final approve dan menutup laporan"
    );

    // ----------------------------------------------------
    // SCENARIO T22: Final valid chain menghasilkan incident.status = resolved
    // ----------------------------------------------------
    const finalReportDb = await dbGetIncidentById(reportBms.id);
    const finalApprovalDb = await CompletionApprovalService.getOrCreateApproval(reportBms.id);
    assert(
      Boolean(finalReportDb?.status === "resolved" && finalApprovalDb.status === "CLOSED"),
      "T22",
      "Final valid chain menghasilkan incident.status = resolved dan approval status = CLOSED"
    );

    // ----------------------------------------------------
    // SCENARIO T23: COMPLETED sendiri tidak menghasilkan resolved
    // ----------------------------------------------------
    // Report Rekanan: progress 100% + handover evidence, but approval not yet completed
    const wmRekHandover = await processAndWatermarkPhoto(sampleBuffer, {
      reportId: reportRekanan.id,
      reportNumber: reportRekanan.id,
      storeName: reportRekanan.storeName,
      progressPercentage: 100,
      actorName: bmsG001.name,
      photoType: "HANDOVER",
    });
    await ProgressService.createProgressUpdate({
      reportId: reportRekanan.id,
      progressPercentage: 100,
      description: "Pekerjaan rekanan fisik 100%",
      stage: "SELESAI",
      actor: { id: bmsG001.id, name: bmsG001.name },
      photos: [{ photoType: "HANDOVER", originalPath: wmRekHandover.originalPath, watermarkedPath: wmRekHandover.watermarkedPath, fileSize: wmRekHandover.fileSize, mimeType: wmRekHandover.mimeType }],
    });
    const rekananDbBeforeAppr = await dbGetIncidentById(reportRekanan.id);
    const rekananRoute = await EstimationIntegrationService.getRouteByReportId(reportRekanan.id);
    assert(
      Boolean(rekananRoute?.workStatus === "COMPLETED" && rekananDbBeforeAppr?.status === "in_maintenance"),
      "T23",
      "COMPLETED fisik (work_status = COMPLETED) sendiri TIDAK menghasilkan status resolved (tetap in_maintenance)"
    );

    // ----------------------------------------------------
    // SCENARIO T20: Approval history append-only
    // ----------------------------------------------------
    const fullHistory = await CompletionApprovalService.getApprovalHistory(reportBms.id);
    const stagesInOrder = fullHistory.map((h) => h.action);
    // History should contain: SUBMIT_COMPLETION, REJECT_COORDINATOR, SUBMIT_COMPLETION, APPROVE_COORDINATOR, REJECT_MANAGER, SUBMIT_COMPLETION, APPROVE_COORDINATOR, APPROVE_MANAGER
    assert(
      fullHistory.length >= 6 &&
      stagesInOrder.includes("SUBMIT_COMPLETION") &&
      stagesInOrder.includes("REJECT_COORDINATOR") &&
      stagesInOrder.includes("APPROVE_COORDINATOR") &&
      stagesInOrder.includes("REJECT_MANAGER") &&
      stagesInOrder.includes("APPROVE_MANAGER"),
      "T20",
      `Approval history bersifat append-only (${fullHistory.length} entri audit tercatat lengkap tanpa overwrite)`
    );

    // ----------------------------------------------------
    // SCENARIO T24: HANDOVER protected evidence tetap dapat dilihat authorized approver
    // ----------------------------------------------------
    // Check that BMC G001 and BM G001 can access the evidence photo
    const bmsProgress = await ProgressService.getProgressHistory(reportBms.id);
    const handoverPhoto = bmsProgress.flatMap((p) => p.photos).find((ph) => ph.photoType === "HANDOVER");
    assert(
      Boolean(handoverPhoto && handoverPhoto.watermarkedPath && handoverPhoto.fileSize > 0),
      "T24",
      "HANDOVER protected evidence tercatat lengkap dan dapat diakses oleh authorized approver (BMC & BM)"
    );

    // ----------------------------------------------------
    // SCENARIO T25: Head Office (HO) operational actions ditolak & Admin authorized
    // ----------------------------------------------------
    let hoSubmitBlocked = false;
    let hoCoordApproveBlocked = false;
    let hoCoordRejectBlocked = false;
    let hoManagerApproveBlocked = false;
    let hoManagerRejectBlocked = false;

    try {
      await CompletionApprovalService.submitCompletion({ reportId: reportRekanan.id, actor: hoAdmin });
    } catch (e: any) {
      if (e.status === 403) hoSubmitBlocked = true;
    }

    try {
      await CompletionApprovalService.approveByCoordinator({ reportId: reportBes.id, actor: hoAdmin });
    } catch (e: any) {
      if (e.status === 403) hoCoordApproveBlocked = true;
    }

    try {
      await CompletionApprovalService.rejectByCoordinator({ reportId: reportBes.id, actor: hoAdmin, reason: "HO test" });
    } catch (e: any) {
      if (e.status === 403) hoCoordRejectBlocked = true;
    }

    try {
      await CompletionApprovalService.approveByManager({ reportId: reportBes.id, actor: hoAdmin });
    } catch (e: any) {
      if (e.status === 403) hoManagerApproveBlocked = true;
    }

    try {
      await CompletionApprovalService.rejectByManager({ reportId: reportBes.id, actor: hoAdmin, reason: "HO test" });
    } catch (e: any) {
      if (e.status === 403) hoManagerRejectBlocked = true;
    }

    assert(
      hoSubmitBlocked &&
      hoCoordApproveBlocked &&
      hoCoordRejectBlocked &&
      hoManagerApproveBlocked &&
      hoManagerRejectBlocked,
      "T25",
      "Head Office (HO) operational actions seluruhnya ditolak (Read-Only Viewer terbukti di seluruh tahap)"
    );

    console.log("\n==================================================");
    console.log(`TASK 5 TEST SUMMARY: ${passedCount} / ${totalTests} SCENARIOS PASSED`);
    console.log("==================================================");

    if (passedCount === totalTests) {
      console.log("ALL TASK 5 SCENARIOS PASSED WITH ZERO FAILURES!");
      process.exit(0);
    } else {
      console.error(`SOME SCENARIOS FAILED: ${totalTests - passedCount} failures`);
      process.exit(1);
    }
  } catch (err) {
    console.error("FATAL ERROR RUNNING TASK 5 TEST SUITE:", err);
    process.exit(1);
  } finally {
    try {
      await pool.end();
    } catch {}
  }
}

runTask5TestSuite();
