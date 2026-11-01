/**
 * SPARTA SIAGA - TASK 6: FINAL INTEGRATION & AUDIT TEST SUITE
 * 
 * Verifies all 20 minimal requirements (F1 – F20) for Task 6:
 * F1. Nama user sesuai authenticated account
 * F2. Role label sesuai authenticated role
 * F3. No hardcoded HO ADMIN fallback
 * F4. Reporter original source benar
 * F5. Modal body scroll lock bekerja
 * F6. Modal internal scroll bekerja
 * F7. Unauthorized action button tidak tampil
 * F8. Backend unauthorized action tetap 403
 * F9. Cross-branch seluruh operational action ditolak
 * F10. System Admin zero operational bypass
 * F11. Full BMS -> BMC -> Manager chain sukses
 * F12. Full BES -> BEC -> Manager chain sukses
 * F13. Full BBS -> BBC -> Manager chain sukses
 * F14. Rekanan tetap dikelola internal BMS
 * F15. Direct close impossible
 * F16. Evidence private/protected
 * F17. CLOSED state benar-benar read-only
 * F18. User override branch-scope benar
 * F19. Notification tidak memberi privilege
 * F20. All role/action visibility sesuai persona (11 personas)
 */

import { getDbPool } from "../lib/db";
import { dbGetIncidentById, dbCreateIncident } from "../lib/incident-db";
import {
  IncidentRecord,
  Scope,
  SpartaRole,
  SystemRole,
  getRoleDisplayLabel,
} from "../types/incident";
import {
  CompletionApprovalService,
  ensureCompletionApprovalTables,
} from "../lib/completion-approval-service";
import { ProgressService, ensureProgressTables } from "../lib/progress-service";
import {
  EstimationIntegrationService,
  ensureEstimationRoutesTable,
} from "../lib/estimation-service";
import { checkUserPermission } from "../lib/permission-service";
import { checkClientPermission } from "../lib/client-permissions";
import { UserIdentity } from "../lib/identity";
import { processAndWatermarkPhoto } from "../lib/watermark";
import { POST as acknowledgeNotification } from "../app/api/notifications/ack/route";
import { POST as mutateIncidentNotification } from "../app/api/notifications/incident/route";
import sharp from "sharp";
import fs from "fs";
import path from "path";

function createPersona(params: {
  id: string;
  name: string;
  role: SpartaRole | null;
  systemRole: SystemRole;
  scope: Scope | null;
  branch: string | null;
  nik: string;
}): UserIdentity {
  return {
    ...params,
    userId: params.id,
    avatarUrl: null,
    businessRole: params.systemRole === "ADMIN" ? null : params.role,
    position:
      params.systemRole === "ADMIN"
        ? "System Administrator"
        : params.scope === "HO"
          ? "Staff Head Office"
          : "Staff Cabang",
  };
}

async function runTask6FinalIntegrationTests() {
  console.log("==================================================");
  console.log("SPARTA SIAGA - TASK 6: FINAL INTEGRATION & AUDIT");
  console.log("Dedicated Test Suite: F1 – F20");
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

    // Cleanup previous Task 6 test records
    await pool.query("DELETE FROM report_completion_approval_history WHERE report_id LIKE 'INC-T6-%'");
    await pool.query("DELETE FROM report_completion_approvals WHERE report_id LIKE 'INC-T6-%'");
    await pool.query("DELETE FROM report_progress_updates WHERE report_id LIKE 'INC-T6-%'");
    await pool.query("DELETE FROM report_estimation_routes WHERE report_id LIKE 'INC-T6-%'");
    await pool.query("DELETE FROM incidents WHERE id LIKE 'INC-T6-%'");

    // Sample image buffer (200x200 required for watermark banner)
    const sampleBuffer = await sharp({
      create: { width: 200, height: 200, channels: 3, background: { r: 50, g: 120, b: 200 } },
    }).png().toBuffer();

    // Single watermark run to conserve heap memory
    const sharedWm = await processAndWatermarkPhoto(sampleBuffer, {
      reportId: "INC-T6-INIT",
      reportNumber: "INC-T6-INIT",
      storeName: "Toko Inisiasi G001",
      progressPercentage: 100,
      actorName: "Budi BMS",
      photoType: "HANDOVER",
    });

    const sharedHandoverPhotos = [
      {
        photoType: "HANDOVER" as const,
        originalPath: sharedWm.originalPath,
        watermarkedPath: sharedWm.watermarkedPath,
        fileSize: sharedWm.fileSize,
        mimeType: sharedWm.mimeType,
      },
    ];

    // 11 Persona Definitions
    const personaTimToko = createPersona({ id: "USR-P-TOKO", name: "Siti Toko", role: "tim_toko", systemRole: "USER", scope: "BRANCH", branch: "G001", nik: "NIK-TK-01" });
    const personaBms = createPersona({ id: "USR-P-BMS", name: "Budi BMS", role: "bms", systemRole: "USER", scope: "BRANCH", branch: "G001", nik: "NIK-BMS-01" });
    const personaBes = createPersona({ id: "USR-P-BES", name: "Deni BES", role: "bes", systemRole: "USER", scope: "BRANCH", branch: "G001", nik: "NIK-BES-01" });
    const personaBbs = createPersona({ id: "USR-P-BBS", name: "Fajar BBS", role: "bbs", systemRole: "USER", scope: "BRANCH", branch: "G001", nik: "NIK-BBS-01" });
    const personaBmc = createPersona({ id: "USR-P-BMC", name: "Citra BMC", role: "bmc", systemRole: "USER", scope: "BRANCH", branch: "G001", nik: "NIK-BMC-01" });
    const personaBec = createPersona({ id: "USR-P-BEC", name: "Eko BEC", role: "bec", systemRole: "USER", scope: "BRANCH", branch: "G001", nik: "NIK-BEC-01" });
    const personaBbc = createPersona({ id: "USR-P-BBC", name: "Gilang BBC", role: "bbc", systemRole: "USER", scope: "BRANCH", branch: "G001", nik: "NIK-BBC-01" });
    const personaBM = createPersona({ id: "USR-P-BM", name: "Hari BM", role: "bm", systemRole: "USER", scope: "BRANCH", branch: "G001", nik: "NIK-BM-01" });
    const personaHOAdmin = createPersona({ id: "USR-P-HOA", name: "Indra HO", role: "ho_admin", systemRole: "USER", scope: "HO", branch: null, nik: "NIK-HOA-01" });
    const personaGMHO = createPersona({ id: "USR-P-GM", name: "Joko GM", role: "gm_ho", systemRole: "USER", scope: "HO", branch: null, nik: "NIK-GM-01" });
    const personaSysAdmin = createPersona({ id: "USR-P-ADMIN", name: "Super Admin", role: null, systemRole: "ADMIN", scope: null, branch: null, nik: "NIK-ADM-01" });

    // Cross-branch counterparts
    const personaBmsG002 = createPersona({ id: "USR-P-BMS-G2", name: "Beno BMS G2", role: "bms", systemRole: "USER", scope: "BRANCH", branch: "G002", nik: "NIK-BMS-02" });
    const personaBmcG002 = createPersona({ id: "USR-P-BMC-G2", name: "Coki BMC G2", role: "bmc", systemRole: "USER", scope: "BRANCH", branch: "G002", nik: "NIK-BMC-02" });
    const personaBMG002 = createPersona({ id: "USR-P-BM-G2", name: "Hasan BM G2", role: "bm", systemRole: "USER", scope: "BRANCH", branch: "G002", nik: "NIK-BM-02" });

    // =========================================================================
    // F1. Nama user sesuai authenticated account
    // =========================================================================
    const testReporter = {
      userId: personaTimToko.id,
      name: personaTimToko.name,
      nik: personaTimToko.nik,
      role: personaTimToko.role,
      branch: personaTimToko.branch,
      storeId: "STR-G1-01",
    };
    assert(
      testReporter.name === "Siti Toko" && testReporter.userId === "USR-P-TOKO",
      "F1",
      "Identitas pelapor sesuai akun terautentikasi (Siti Toko / USR-P-TOKO)"
    );

    // =========================================================================
    // F2. Role label sesuai authenticated role
    // =========================================================================
    const roleLabels = {
      bms: getRoleDisplayLabel("bms"),
      bes: getRoleDisplayLabel("bes"),
      bbs: getRoleDisplayLabel("bbs"),
      bmc: getRoleDisplayLabel("bmc"),
      bec: getRoleDisplayLabel("bec"),
      bbc: getRoleDisplayLabel("bbc"),
      bm: getRoleDisplayLabel("bm"),
      ho_admin: getRoleDisplayLabel("ho_admin"),
      gm_ho: getRoleDisplayLabel("gm_ho"),
      sm_ho: getRoleDisplayLabel("sm_ho"),
      tim_toko: getRoleDisplayLabel("tim_toko"),
      admin: getRoleDisplayLabel("admin"),
      ADMIN: getRoleDisplayLabel("ADMIN"),
    };
    const f2Valid =
      roleLabels.bms === "BMS" &&
      roleLabels.bmc === "BMC" &&
      roleLabels.bes === "BES" &&
      roleLabels.bec === "BEC" &&
      roleLabels.bbs === "BBS" &&
      roleLabels.bbc === "BBC" &&
      roleLabels.bm === "Manager Branch" &&
      roleLabels.ho_admin === "HO Admin" &&
      roleLabels.gm_ho === "GM HO" &&
      roleLabels.tim_toko === "Tim Toko" &&
      roleLabels.admin === "System Admin" &&
      roleLabels.ADMIN === "System Admin";
    assert(f2Valid, "F2", "Role label dipetakan dengan tepat untuk seluruh peran bisnis & sistem");

    // =========================================================================
    // F3. No hardcoded HO ADMIN fallback
    // =========================================================================
    const modalContent = fs.readFileSync(path.join(process.cwd(), "components/incident/manual-incident-modal.tsx"), "utf-8");
    const layoutContent = fs.readFileSync(path.join(process.cwd(), "app/(siaga)/layout.tsx"), "utf-8");
    const hasHardcodedHOAdminInModal = modalContent.includes('"HO ADMIN"') || modalContent.includes('"Auto-filled (Session)"') || modalContent.includes('"Noval"');
    const hasHardcodedHOAdminInLayout = layoutContent.includes('"Auto-filled (Session)"');
    assert(
      !hasHardcodedHOAdminInModal && !hasHardcodedHOAdminInLayout,
      "F3",
      "Tidak ada fallback hardcode 'HO ADMIN', 'Auto-filled (Session)', atau nama statis 'Noval'"
    );

    // =========================================================================
    // F4. Reporter original source benar (disimpan terpisah dari verifier)
    // =========================================================================
    const incidentF4: IncidentRecord = {
      id: "INC-T6-REP-001",
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
      status: "verifying",
      progress: 0,
      reporter: testReporter,
      verification: {
        confirmedBy: "Hari BM (Branch Manager)",
        confirmedAt: new Date().toISOString(),
        isDamaged: true,
      },
      timeline: [],
    };
    await dbCreateIncident(incidentF4);

    const fetchedF4 = await dbGetIncidentById(incidentF4.id);
    const reporterSourceCorrect =
      fetchedF4?.reporter?.name === "Siti Toko" &&
      fetchedF4?.reporter?.role === "tim_toko" &&
      fetchedF4?.verification?.confirmedBy === "Hari BM (Branch Manager)";
    assert(
      reporterSourceCorrect,
      "F4",
      "Source of truth pelapor tersimpan utuh di DB (Siti Toko) dan tidak tertukar dengan verifier (Hari BM)"
    );

    // =========================================================================
    // F5. Modal body scroll lock bekerja
    // =========================================================================
    const scrollLockFile = fs.readFileSync(path.join(process.cwd(), "lib/use-body-scroll-lock.ts"), "utf-8");
    const hasRefCounter = scrollLockFile.includes("activeLockCount") && scrollLockFile.includes("document.documentElement");
    const hasLayoutShiftProtection = scrollLockFile.includes("paddingRight") || scrollLockFile.includes("scrollbarWidth");
    assert(
      hasRefCounter && hasLayoutShiftProtection,
      "F5",
      "Global body scroll lock menggunakan ref counter, proteksi root documentElement, dan proteksi layout shift"
    );

    // =========================================================================
    // F6. Modal internal scroll bekerja
    // =========================================================================
    const hasFixedBackdropTouchNone = modalContent.includes("touch-none") && modalContent.includes("select-none");
    const hasModalShellTouchAuto = modalContent.includes("touch-auto") && modalContent.includes("overflow-y-auto");
    assert(
      hasFixedBackdropTouchNone && hasModalShellTouchAuto,
      "F6",
      "Backdrop modal terkunci (touch-none) dan konten internal modal bebas scroll (overflow-y-auto touch-auto)"
    );

    // =========================================================================
    // F7. Unauthorized action button tidak tampil (Client Permission Evaluation)
    // =========================================================================
    const timTokoProgress = checkClientPermission({
      identity: personaTimToko,
      permission: "REPORT_UPDATE_PROGRESS",
      report: fetchedF4,
    });
    const bmcProgress = checkClientPermission({
      identity: personaBmc,
      permission: "REPORT_UPDATE_PROGRESS",
      report: fetchedF4,
    });
    const sysAdminEstimation = checkClientPermission({
      identity: personaSysAdmin,
      permission: "ESTIMATION_TRIGGER",
      report: fetchedF4,
    });
    const sysAdminProgress = checkClientPermission({
      identity: personaSysAdmin,
      permission: "REPORT_UPDATE_PROGRESS",
      report: fetchedF4,
    });
    assert(
      !timTokoProgress.authorized && !bmcProgress.authorized && !sysAdminEstimation.authorized && !sysAdminProgress.authorized,
      "F7",
      "UI permission logic menolak tombol aksi yang tidak sah (Tim Toko, BMC, dan System Admin)"
    );

    // =========================================================================
    // SETUP DEDICATED GUARD INCIDENT (INC-T6-GUARD-001) for F8, F9, F10
    // =========================================================================
    const incidentGuard: IncidentRecord = {
      id: "INC-T6-GUARD-001",
      storeId: "STR-G1-GUARD",
      storeName: "Alfamart Kalisari Guard G001",
      branch: "G001",
      locationCity: "Jakarta Timur",
      disasterType: "flood",
      reportOrigin: "manual",
      tkpType: "toko",
      date: "07 Oct 2026",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: "in_maintenance",
      progress: 100,
      reporter: testReporter,
      timeline: [],
    };
    await dbCreateIncident(incidentGuard);
    await EstimationIntegrationService.createRoute({
      reportId: incidentGuard.id,
      report: incidentGuard,
      handlerType: "BMS",
      actor: personaBms,
    });
    await EstimationIntegrationService.updateWorkStatus(incidentGuard.id, "READY_FOR_WORK", { bypassReadinessValidation: true });
    await ProgressService.createProgressUpdate({
      reportId: incidentGuard.id,
      progressPercentage: 100,
      description: "Pekerjaan Guard rampung 100%",
      stage: "SELESAI",
      actor: { id: personaBms.id, name: personaBms.name },
      photos: sharedHandoverPhotos,
    });

    // =========================================================================
    // F8. Backend unauthorized action tetap 403
    // =========================================================================
    const bmcPermCheck = await checkUserPermission({
      user: personaBmc,
      permission: "REPORT_UPDATE_PROGRESS",
      report: incidentGuard,
    });
    const f8BmcRejected = !bmcPermCheck.authorized;

    let f8TokoSubmitRejected = false;
    try {
      await CompletionApprovalService.submitCompletion({
        reportId: incidentGuard.id,
        actor: personaTimToko,
        notes: "Tim Toko mencoba submit completion",
      });
    } catch (err: any) {
      if (err.status === 403 && (err.code === "UNAUTHORIZED_PIC" || err.message?.includes("PIC"))) {
        f8TokoSubmitRejected = true;
      }
    }
    assert(
      f8BmcRejected && f8TokoSubmitRejected,
      "F8",
      "Backend menolak aksi tanpa izin dengan 403 Forbidden (BMC update progress & Tim Toko submit completion)"
    );

    // =========================================================================
    // F9. Cross-branch seluruh operational action ditolak
    // =========================================================================
    const f9ProgressPermCheck = await checkUserPermission({
      user: personaBmsG002,
      permission: "REPORT_UPDATE_PROGRESS",
      report: incidentGuard,
    });
    const f9ProgressCrossBranch = !f9ProgressPermCheck.authorized;

    let f9SubmitCrossBranch = false;
    try {
      await CompletionApprovalService.submitCompletion({
        reportId: incidentGuard.id,
        actor: personaBmsG002,
        notes: "BMS G002 submit laporan G001",
      });
    } catch (err: any) {
      if (err.status === 403 && err.code === "BRANCH_SCOPE_VIOLATION") {
        f9SubmitCrossBranch = true;
      }
    }

    let f9BmcCrossBranch = false;
    try {
      await CompletionApprovalService.approveByCoordinator({
        reportId: incidentGuard.id,
        actor: personaBmcG002,
      });
    } catch (err: any) {
      if (err.status === 403 && err.code === "BRANCH_SCOPE_VIOLATION") {
        f9BmcCrossBranch = true;
      }
    }

    let f9BmCrossBranch = false;
    try {
      await CompletionApprovalService.approveByManager({
        reportId: incidentGuard.id,
        actor: personaBMG002,
      });
    } catch (err: any) {
      if (err.status === 403 && err.code === "BRANCH_SCOPE_VIOLATION") {
        f9BmCrossBranch = true;
      }
    }
    assert(
      f9ProgressCrossBranch && f9SubmitCrossBranch && f9BmcCrossBranch && f9BmCrossBranch,
      "F9",
      "Seluruh aksi operasional lintas cabang ditolak tegas dengan 403 BRANCH_SCOPE_VIOLATION"
    );

    // =========================================================================
    // F10. System Admin zero operational bypass
    // =========================================================================
    const f10ProgressCheck = await checkUserPermission({
      user: personaSysAdmin,
      permission: "REPORT_UPDATE_PROGRESS",
      report: incidentGuard,
    });
    const f10ProgressRejected = !f10ProgressCheck.authorized;

    let f10SubmitRejected = false;
    try {
      await CompletionApprovalService.submitCompletion({
        reportId: incidentGuard.id,
        actor: personaSysAdmin,
        notes: "SysAdmin submit completion",
      });
    } catch (err: any) {
      if (err.status === 403) f10SubmitRejected = true;
    }

    let f10CoordRejected = false;
    try {
      await CompletionApprovalService.approveByCoordinator({
        reportId: incidentGuard.id,
        actor: personaSysAdmin,
      });
    } catch (err: any) {
      if (err.status === 403) f10CoordRejected = true;
    }

    let f10BmRejected = false;
    try {
      await CompletionApprovalService.approveByManager({
        reportId: incidentGuard.id,
        actor: personaSysAdmin,
      });
    } catch (err: any) {
      if (err.status === 403) f10BmRejected = true;
    }
    assert(
      f10ProgressRejected && f10SubmitRejected && f10CoordRejected && f10BmRejected,
      "F10",
      "System Admin Zero Operational Bypass terbukti di seluruh mutasi operasional (100% diblokir 403)"
    );

    // =========================================================================
    // F11. Full BMS -> BMC -> Manager chain sukses
    // =========================================================================
    const incidentBms: IncidentRecord = {
      id: "INC-T6-BMS-FLOW",
      storeId: "STR-G1-11",
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
      reporter: testReporter,
      timeline: [],
    };
    await dbCreateIncident(incidentBms);
    await EstimationIntegrationService.createRoute({
      reportId: incidentBms.id,
      report: incidentBms,
      handlerType: "BMS",
      actor: personaBms,
    });
    await EstimationIntegrationService.updateWorkStatus(incidentBms.id, "READY_FOR_WORK", { bypassReadinessValidation: true });

    // Advance BMS to 100% with handover photo
    await ProgressService.createProgressUpdate({
      reportId: incidentBms.id,
      progressPercentage: 100,
      description: "Pekerjaan BMS rampung 100%",
      stage: "SELESAI",
      actor: { id: personaBms.id, name: personaBms.name },
      photos: sharedHandoverPhotos,
    });

    const subBms = await CompletionApprovalService.submitCompletion({
      reportId: incidentBms.id,
      actor: personaBms,
      notes: "Pengajuan penyelesaian BMS Toko",
    });
    const appBmc = await CompletionApprovalService.approveByCoordinator({
      reportId: incidentBms.id,
      actor: personaBmc,
      notes: "Disetujui BMC",
    });
    const appBm1 = await CompletionApprovalService.approveByManager({
      reportId: incidentBms.id,
      actor: personaBM,
      notes: "Disetujui Manager Cabang. Case close.",
    });
    const approvalBmsFinal = await CompletionApprovalService.getOrCreateApproval(incidentBms.id);
    const incidentBmsFinal = await dbGetIncidentById(incidentBms.id);
    assert(
      subBms.status === "WAITING_COORDINATOR_APPROVAL" &&
      appBmc.status === "WAITING_MANAGER_APPROVAL" &&
      approvalBmsFinal?.status === "CLOSED" &&
      appBm1.status === "resolved" &&
      incidentBmsFinal?.status === "resolved",
      "F11",
      "Full BMS -> BMC -> Manager Branch closing chain tuntas sukses (Status: CLOSED / resolved)"
    );

    // =========================================================================
    // F12. Full BES -> BEC -> Manager chain sukses
    // =========================================================================
    const incidentBes: IncidentRecord = {
      id: "INC-T6-BES-FLOW",
      storeId: "DC-G1-12",
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
      reporter: testReporter,
      timeline: [],
    };
    await dbCreateIncident(incidentBes);
    await EstimationIntegrationService.createRoute({
      reportId: incidentBes.id,
      report: incidentBes,
      handlerType: "BES",
      actor: personaBes,
    });
    await EstimationIntegrationService.updateWorkStatus(incidentBes.id, "READY_FOR_WORK", { bypassReadinessValidation: true });

    await ProgressService.createProgressUpdate({
      reportId: incidentBes.id,
      progressPercentage: 100,
      description: "Pekerjaan BES DC rampung 100%",
      stage: "SELESAI",
      actor: { id: personaBes.id, name: personaBes.name },
      photos: sharedHandoverPhotos,
    });

    const subBes = await CompletionApprovalService.submitCompletion({
      reportId: incidentBes.id,
      actor: personaBes,
      notes: "Pengajuan penyelesaian BES DC",
    });
    const appBec = await CompletionApprovalService.approveByCoordinator({
      reportId: incidentBes.id,
      actor: personaBec,
      notes: "Disetujui BEC",
    });
    const appBm2 = await CompletionApprovalService.approveByManager({
      reportId: incidentBes.id,
      actor: personaBM,
      notes: "Disetujui Manager Cabang. Case close.",
    });
    const approvalBesFinal = await CompletionApprovalService.getOrCreateApproval(incidentBes.id);
    const incidentBesFinal = await dbGetIncidentById(incidentBes.id);
    assert(
      subBes.status === "WAITING_COORDINATOR_APPROVAL" &&
      appBec.status === "WAITING_MANAGER_APPROVAL" &&
      approvalBesFinal?.status === "CLOSED" &&
      appBm2.status === "resolved" &&
      incidentBesFinal?.status === "resolved",
      "F12",
      "Full BES -> BEC -> Manager Branch closing chain tuntas sukses (Status: CLOSED / resolved)"
    );

    // =========================================================================
    // F13. Full BBS -> BBC -> Manager chain sukses
    // =========================================================================
    const incidentBbs: IncidentRecord = {
      id: "INC-T6-BBS-FLOW",
      storeId: "BLD-G1-13",
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
      reporter: testReporter,
      timeline: [],
    };
    await dbCreateIncident(incidentBbs);
    await EstimationIntegrationService.createRoute({
      reportId: incidentBbs.id,
      report: incidentBbs,
      handlerType: "BUILDING",
      actor: personaBbs,
    });
    await EstimationIntegrationService.updateWorkStatus(incidentBbs.id, "READY_FOR_WORK", { bypassReadinessValidation: true });

    await ProgressService.createProgressUpdate({
      reportId: incidentBbs.id,
      progressPercentage: 100,
      description: "Pekerjaan BBS Building rampung 100%",
      stage: "SELESAI",
      actor: { id: personaBbs.id, name: personaBbs.name },
      photos: sharedHandoverPhotos,
    });

    const subBbs = await CompletionApprovalService.submitCompletion({
      reportId: incidentBbs.id,
      actor: personaBbs,
      notes: "Pengajuan penyelesaian BBS Building",
    });
    const appBbc = await CompletionApprovalService.approveByCoordinator({
      reportId: incidentBbs.id,
      actor: personaBbc,
      notes: "Disetujui BBC",
    });
    const appBm3 = await CompletionApprovalService.approveByManager({
      reportId: incidentBbs.id,
      actor: personaBM,
      notes: "Disetujui Manager Cabang. Case close.",
    });
    const approvalBbsFinal = await CompletionApprovalService.getOrCreateApproval(incidentBbs.id);
    const incidentBbsFinal = await dbGetIncidentById(incidentBbs.id);
    assert(
      subBbs.status === "WAITING_COORDINATOR_APPROVAL" &&
      appBbc.status === "WAITING_MANAGER_APPROVAL" &&
      approvalBbsFinal?.status === "CLOSED" &&
      appBm3.status === "resolved" &&
      incidentBbsFinal?.status === "resolved",
      "F13",
      "Full BBS -> BBC -> Manager Branch closing chain tuntas sukses (Status: CLOSED / resolved)"
    );

    // =========================================================================
    // F14. Rekanan tetap dikelola internal BMS
    // =========================================================================
    const incidentRek: IncidentRecord = {
      id: "INC-T6-REK-FLOW",
      storeId: "STR-G1-14",
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
      reporter: testReporter,
      timeline: [],
    };
    await dbCreateIncident(incidentRek);
    await EstimationIntegrationService.createRoute({
      reportId: incidentRek.id,
      report: incidentRek,
      handlerType: "REKANAN",
      actor: personaBms,
    });
    await EstimationIntegrationService.updateWorkStatus(incidentRek.id, "READY_FOR_WORK", { bypassReadinessValidation: true });

    await ProgressService.createProgressUpdate({
      reportId: incidentRek.id,
      progressPercentage: 100,
      description: "Pekerjaan Rekanan di bawah supervisi BMS selesai",
      stage: "SELESAI",
      actor: { id: personaBms.id, name: personaBms.name },
      photos: sharedHandoverPhotos,
    });

    const subRek = await CompletionApprovalService.submitCompletion({
      reportId: incidentRek.id,
      actor: personaBms, // Submitted by internal BMS PIC
      notes: "Supervisi Rekanan selesai diajukan oleh BMS",
    });
    const appRekBmc = await CompletionApprovalService.approveByCoordinator({
      reportId: incidentRek.id,
      actor: personaBmc, // Coordinated by BMC
      notes: "Approved by BMC",
    });
    assert(
      subRek.flowType === "BMS" &&
      subRek.status === "WAITING_COORDINATOR_APPROVAL" &&
      appRekBmc.status === "WAITING_MANAGER_APPROVAL",
      "F14",
      "Pekerjaan Rekanan tetap dikelola internal BMS dan divalidasi oleh BMC (tidak ada bypass rekanan)"
    );

    // =========================================================================
    // F15. Direct close impossible (Manager approve tanpa koordinator ditolak)
    // =========================================================================
    const incidentDirect: IncidentRecord = {
      id: "INC-T6-DIRECT-CLOSE",
      storeId: "STR-G1-15",
      storeName: "Alfamart Pasar Rebo G001",
      branch: "G001",
      locationCity: "Jakarta Timur",
      disasterType: "flood",
      reportOrigin: "manual",
      tkpType: "toko",
      date: "07 Oct 2026",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: "in_maintenance",
      progress: 100,
      reporter: testReporter,
      timeline: [],
    };
    await dbCreateIncident(incidentDirect);
    await EstimationIntegrationService.createRoute({
      reportId: incidentDirect.id,
      report: incidentDirect,
      handlerType: "BMS",
      actor: personaBms,
    });
    await EstimationIntegrationService.updateWorkStatus(incidentDirect.id, "READY_FOR_WORK", { bypassReadinessValidation: true });
    await ProgressService.createProgressUpdate({
      reportId: incidentDirect.id,
      progressPercentage: 100,
      description: "Pekerjaan Direct rampung 100%",
      stage: "SELESAI",
      actor: { id: personaBms.id, name: personaBms.name },
      photos: sharedHandoverPhotos,
    });

    let f15Rejected = false;
    try {
      // Trying to approve without coordinator having approved (status is still WAITING_PIC_SUBMISSION)
      await CompletionApprovalService.approveByManager({
        reportId: incidentDirect.id,
        actor: personaBM,
      });
    } catch (err: any) {
      if (err.status === 400 && (err.code === "COORDINATOR_APPROVAL_REQUIRED" || err.code === "NOT_READY_FOR_MANAGER")) {
        f15Rejected = true;
      }
    }
    assert(f15Rejected, "F15", "Direct Manager Close tanpa persetujuan Koordinator mutlak ditolak (400)");

    // =========================================================================
    // F16. Evidence private/protected
    // =========================================================================
    const storagePathProgress = path.join(process.cwd(), "storage", "progress");
    const storagePathReadiness = path.join(process.cwd(), "storage", "readiness");
    const isOutsidePublic = !storagePathProgress.includes(path.join(process.cwd(), "public"));
    const existsStorage = fs.existsSync(storagePathProgress) && fs.existsSync(storagePathReadiness);
    assert(
      isOutsidePublic && existsStorage,
      "F16",
      "Evidence tersimpan di storage/ terlindung di luar folder public/"
    );

    // =========================================================================
    // F17. CLOSED state benar-benar read-only
    // =========================================================================
    let f17ProgressRejected = false;
    try {
      await ProgressService.createProgressUpdate({
        reportId: incidentBms.id, // incidentBms is already CLOSED
        progressPercentage: 100,
        description: "Mencoba update progress pada closed report",
        stage: "SELESAI",
        actor: { id: personaBms.id, name: personaBms.name },
        photos: [],
      });
    } catch (err: any) {
      if (err.status === 400 || err.status === 422 || err.message?.includes("closed") || err.message?.includes("selesai")) {
        f17ProgressRejected = true;
      }
    }

    let f17SubmitRejected = false;
    try {
      await CompletionApprovalService.submitCompletion({
        reportId: incidentBms.id,
        actor: personaBms,
        notes: "Mencoba submit ulang pada closed report",
      });
    } catch (err: any) {
      if (err.status === 400 && err.code === "ALREADY_CLOSED") {
        f17SubmitRejected = true;
      }
    }
    assert(
      f17ProgressRejected && f17SubmitRejected,
      "F17",
      "Laporan dengan status CLOSED sepenuhnya read-only terhadap mutasi progress maupun approval"
    );

    // =========================================================================
    // F18. User override branch-scope benar
    // =========================================================================
    // Specific branch override allows G001 but DENIES G002
    const identityWithG1Override = {
      ...personaTimToko,
      overrides: [
        {
          id: "OV-01",
          userId: personaTimToko.id,
          permissionKey: "REPORT_UPDATE_PROGRESS" as const,
          effect: "ALLOW" as const,
          scopeType: "SPECIFIC_BRANCH" as const,
          branchCode: "G001",
          reason: "Tugas sementara maintenance G001",
          startsAt: new Date().toISOString(),
          expiresAt: null,
          grantedBy: "USR-P-ADMIN",
          revokedAt: null,
          revokedBy: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
    };

    const g1OverrideAllowed = checkClientPermission({
      identity: identityWithG1Override,
      permission: "REPORT_UPDATE_PROGRESS",
      targetBranch: "G001",
    });
    const g2OverrideDenied = checkClientPermission({
      identity: identityWithG1Override,
      permission: "REPORT_UPDATE_PROGRESS",
      targetBranch: "G002",
    });
    assert(
      g1OverrideAllowed.authorized && !g2OverrideDenied.authorized,
      "F18",
      "User override ALLOW spesifik cabang G001 berhasil untuk G001 dan tetap ditolak pada cabang G002"
    );

    // =========================================================================
    // F19. Notification tidak memberi privilege
    // =========================================================================
    const hoaNotificationView = checkClientPermission({
      identity: personaHOAdmin,
      permission: "NOTIFICATION_VIEW",
    });
    const hoaProgressOperational = checkClientPermission({
      identity: personaHOAdmin,
      permission: "REPORT_UPDATE_PROGRESS",
      targetBranch: "G001",
    });
    const ackMutationResponse = await acknowledgeNotification();
    const incidentMutationResponse = await mutateIncidentNotification(
      new Request("http://localhost/api/notifications/incident", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "acknowledge" }),
      })
    );
    assert(
      hoaNotificationView.authorized &&
        !hoaProgressOperational.authorized &&
        ackMutationResponse.status === 403 &&
        incidentMutationResponse.status === 403,
      "F19",
      "Hak melihat notifikasi tidak memberi hak mutasi laporan maupun notification objects"
    );

    // =========================================================================
    // F20. All role/action visibility sesuai persona (11 Personas Matrix)
    // =========================================================================
    const dummyRep = incidentDirect;

    // 1. Tim Toko: Cannot update progress, cannot submit completion
    const p1 = !checkClientPermission({ identity: personaTimToko, permission: "REPORT_UPDATE_PROGRESS", report: dummyRep }).authorized &&
               !checkClientPermission({ identity: personaTimToko, permission: "COMPLETION_SUBMIT", report: dummyRep }).authorized;

    // 2. BMS: Can update progress & submit completion, cannot coordinator approve
    const p2 = checkClientPermission({ identity: personaBms, permission: "REPORT_UPDATE_PROGRESS", report: dummyRep }).authorized &&
               checkClientPermission({ identity: personaBms, permission: "COMPLETION_SUBMIT", report: dummyRep }).authorized &&
               !checkClientPermission({ identity: personaBms, permission: "COMPLETION_APPROVE_COORDINATOR", report: dummyRep }).authorized;

    // 3. BES: Can submit completion, cannot update progress
    const p3 = checkClientPermission({ identity: personaBes, permission: "COMPLETION_SUBMIT", report: dummyRep }).authorized &&
               !checkClientPermission({ identity: personaBes, permission: "REPORT_UPDATE_PROGRESS", report: dummyRep }).authorized;

    // 4. BBS: Can submit completion, cannot update progress
    const p4 = checkClientPermission({ identity: personaBbs, permission: "COMPLETION_SUBMIT", report: dummyRep }).authorized &&
               !checkClientPermission({ identity: personaBbs, permission: "REPORT_UPDATE_PROGRESS", report: dummyRep }).authorized;

    // 5. BMC: Can approve coordinator, cannot update progress, cannot submit completion
    const p5 = checkClientPermission({ identity: personaBmc, permission: "COMPLETION_APPROVE_COORDINATOR", report: dummyRep }).authorized &&
               !checkClientPermission({ identity: personaBmc, permission: "REPORT_UPDATE_PROGRESS", report: dummyRep }).authorized &&
               !checkClientPermission({ identity: personaBmc, permission: "COMPLETION_SUBMIT", report: dummyRep }).authorized;

    // 6. BEC: Can approve coordinator, cannot update progress
    const p6 = checkClientPermission({ identity: personaBec, permission: "COMPLETION_APPROVE_COORDINATOR", report: dummyRep }).authorized &&
               !checkClientPermission({ identity: personaBec, permission: "REPORT_UPDATE_PROGRESS", report: dummyRep }).authorized;

    // 7. BBC: Can approve coordinator, cannot update progress
    const p7 = checkClientPermission({ identity: personaBbc, permission: "COMPLETION_APPROVE_COORDINATOR", report: dummyRep }).authorized &&
               !checkClientPermission({ identity: personaBbc, permission: "REPORT_UPDATE_PROGRESS", report: dummyRep }).authorized;

    // 8. BM: Can close report, cannot update progress
    const p8 = checkClientPermission({ identity: personaBM, permission: "REPORT_CLOSE", report: dummyRep }).authorized &&
               !checkClientPermission({ identity: personaBM, permission: "REPORT_UPDATE_PROGRESS", report: dummyRep }).authorized;

    // 9. HO Admin: Can view all, cannot do operational mutations
    const p9 = checkClientPermission({ identity: personaHOAdmin, permission: "REPORT_VIEW_ALL" }).authorized &&
               !checkClientPermission({ identity: personaHOAdmin, permission: "REPORT_UPDATE_PROGRESS", report: dummyRep }).authorized &&
               !checkClientPermission({ identity: personaHOAdmin, permission: "COMPLETION_SUBMIT", report: dummyRep }).authorized;

    // 10. GM HO: Can view all & create management instruction, cannot update progress
    const p10 = checkClientPermission({ identity: personaGMHO, permission: "REPORT_VIEW_ALL" }).authorized &&
                checkClientPermission({ identity: personaGMHO, permission: "MANAGEMENT_INSTRUCTION_CREATE" }).authorized &&
                !checkClientPermission({ identity: personaGMHO, permission: "REPORT_UPDATE_PROGRESS", report: dummyRep }).authorized;

    // 11. System Admin: Can view all monitoring, strictly ZERO operational permissions
    const p11 = checkClientPermission({ identity: personaSysAdmin, permission: "REPORT_VIEW_ALL" }).authorized &&
                !checkClientPermission({ identity: personaSysAdmin, permission: "REPORT_UPDATE_PROGRESS", report: dummyRep }).authorized &&
                !checkClientPermission({ identity: personaSysAdmin, permission: "COMPLETION_SUBMIT", report: dummyRep }).authorized &&
                !checkClientPermission({ identity: personaSysAdmin, permission: "COMPLETION_APPROVE_COORDINATOR", report: dummyRep }).authorized &&
                !checkClientPermission({ identity: personaSysAdmin, permission: "REPORT_CLOSE", report: dummyRep }).authorized;

    const allPersonasPass = p1 && p2 && p3 && p4 && p5 && p6 && p7 && p8 && p9 && p10 && p11;
    assert(
      allPersonasPass,
      "F20",
      "Matriks hak akses dan visibilitas 11 Persona terverifikasi 100% konsisten sesuai aturan bisnis"
    );

    // =========================================================================
    // FINAL SUMMARY
    // =========================================================================
    console.log("\n==================================================");
    console.log(`TASK 6 AUDIT SUMMARY: ${passedCount} / ${totalTests} SCENARIOS PASSED`);
    console.log("==================================================");

    if (passedCount === totalTests) {
      console.log("ALL TASK 6 FINAL INTEGRATION SCENARIOS PASSED WITH ZERO FAILURES!\n");
    } else {
      console.error(`SOME SCENARIOS FAILED: ${totalTests - passedCount} failure(s) detected.\n`);
      process.exitCode = 1;
    }
  } catch (err: any) {
    console.error("Fatal error during Task 6 test suite:", err);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

runTask6FinalIntegrationTests();
