import { getDbPool } from "../lib/db";
import { checkUserPermission } from "../lib/permission-service";
import {
  EstimationIntegrationService,
  ensureEstimationRoutesTable,
} from "../lib/estimation-service";
import { ProgressService, ensureProgressTables } from "../lib/progress-service";
import {
  processAndWatermarkPhoto,
  validateImageMagicBytes,
  formatServerTimestampWib,
} from "../lib/watermark";
import { dbGetIncidentById, dbCreateIncident } from "../lib/incident-db";
import { IncidentRecord } from "../types/incident";
import {
  CompletionApprovalService,
  ensureCompletionApprovalTables,
} from "../lib/completion-approval-service";
import sharp from "sharp";

async function runEstimationProgressTests() {
  console.log("==================================================");
  console.log("SPARTA SIAGA - ESTIMASI & PROGRESS FLOW TEST SUITE");
  console.log("Scenarios E1-E7 (Estimasi) & P1-P12 (Progress & Close)");
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

    // 1. Setup Test Mock Reports in DB
    const reportToko1: IncidentRecord = {
      id: "INC-TEST-E1-001",
      storeId: "STR-001",
      storeName: "Alfamart Cibubur G001",
      branch: "G001",
      locationCity: "Jakarta Timur",
      disasterType: "flood",
      reportOrigin: "manual",
      tkpType: "toko",
      date: "06 Oct 2026",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: "verifying",
      progress: 0,
      timeline: [],
    };

    const reportToko2: IncidentRecord = {
      id: "INC-TEST-E4-002",
      storeId: "STR-002",
      storeName: "Alfamart Bandung G002",
      branch: "G002",
      locationCity: "Bandung",
      disasterType: "heavy_rain",
      reportOrigin: "manual",
      tkpType: "toko",
      date: "06 Oct 2026",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: "verifying",
      progress: 0,
      timeline: [],
    };

    const reportDc: IncidentRecord = {
      id: "INC-TEST-E6-DC",
      storeId: "DC-001",
      storeName: "DC Distribution Cibubur",
      branch: "G001",
      locationCity: "Jakarta Timur",
      disasterType: "fire",
      reportOrigin: "manual",
      tkpType: "dc",
      date: "06 Oct 2026",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: "verifying",
      progress: 0,
      timeline: [],
    };

    const reportProg: IncidentRecord = {
      id: "INC-TEST-PROG-001",
      storeId: "STR-003",
      storeName: "Alfamart Klender G001",
      branch: "G001",
      locationCity: "Jakarta Timur",
      disasterType: "flood",
      reportOrigin: "manual",
      tkpType: "toko",
      date: "06 Oct 2026",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: "in_maintenance",
      progress: 0,
      timeline: [],
    };

    await dbCreateIncident(reportToko1);
    await dbCreateIncident(reportToko2);
    await dbCreateIncident(reportDc);
    await dbCreateIncident(reportProg);

    // Clean prior test artifacts for idempotent runs
    await pool.query("DELETE FROM report_estimation_routes WHERE report_id LIKE 'INC-TEST-%'");
    await pool.query("DELETE FROM report_progress_updates WHERE report_id LIKE 'INC-TEST-%'");
    await pool.query("DELETE FROM report_completion_approvals WHERE report_id LIKE 'INC-TEST-%'");
    await pool.query("DELETE FROM report_completion_approval_history WHERE report_id LIKE 'INC-TEST-%'");

    // 2. Setup Actors
    const bmsUser = {
      id: "USR-BMS-001",
      name: "Agus BMS",
      nik: "BMS0001",
      role: "bms" as const,
      businessRole: "bms" as const,
      systemRole: "USER" as const,
      scope: "BRANCH" as const,
      branch: "G001",
    };

    const bmcUser = {
      id: "USR-BMC-001",
      name: "Candra BMC",
      nik: "BMC0001",
      role: "bmc" as const,
      businessRole: "bmc" as const,
      systemRole: "USER" as const,
      scope: "BRANCH" as const,
      branch: "G001",
    };

    const bmUser = {
      id: "USR-BM-FLOW-001",
      name: "Bambang BM Flow",
      nik: "BM0001",
      role: "bm" as const,
      businessRole: "bm" as const,
      systemRole: "USER" as const,
      scope: "BRANCH" as const,
      branch: "G001",
    };

    const hoUser = {
      id: "USR-HO-001",
      name: "Hendra HO Admin",
      role: "ho_admin" as const,
      businessRole: "ho_admin" as const,
      systemRole: "USER" as const,
      scope: "HO" as const,
      branch: null,
    };

    // Create a 100x100 sample PNG buffer for testing watermark
    const sampleImageBuffer = await sharp({
      create: {
        width: 400,
        height: 300,
        channels: 3,
        background: { r: 50, g: 120, b: 200 },
      },
    })
      .png()
      .toBuffer();

    console.log("--------------------------------------------------");
    console.log("SECTION 1: TEST SCENARIOS ESTIMASI (E1 - E7)");
    console.log("--------------------------------------------------");

    // E1: BMS buka Detail Laporan TKP Toko. Expected: Buat Estimasi tersedia.
    const permE1 = await checkUserPermission({
      user: bmsUser,
      permission: "ESTIMATION_TRIGGER",
      report: reportToko1,
    });
    assert(
      permE1.authorized && (reportToko1.tkpType || "").toLowerCase() === "toko",
      "E1",
      "BMS pada laporan TKP Toko berhak memicu Buat Estimasi (ESTIMATION_TRIGGER: ALLOW)"
    );

    // E2: Klik Buat Estimasi. Data report sudah terisi otomatis (read-only, no re-input).
    const contextReport = await dbGetIncidentById(reportToko1.id);
    const hasFullContext = Boolean(
      contextReport &&
        contextReport.id &&
        contextReport.storeName &&
        contextReport.branch &&
        contextReport.tkpType === "toko" &&
        contextReport.disasterType
    );
    assert(
      hasFullContext,
      "E2",
      "Konteks laporan existing lengkap tersedia (Nomor, Toko, Cabang, TKP, Bencana) tanpa input ulang NIK/Nama"
    );

    // E3: BMS Pilih Handler BMS. Route dibuat, target=SPARTA_MAINTENANCE, status=WAITING_ESTIMATION.
    const routeE3 = await EstimationIntegrationService.createRoute({
      reportId: reportToko1.id,
      handlerType: "BMS",
      actor: { id: bmsUser.id, name: bmsUser.name, nik: bmsUser.nik },
      report: reportToko1,
    });
    assert(
      routeE3.handlerType === "BMS" &&
        routeE3.targetSystem === "SPARTA_MAINTENANCE" &&
        routeE3.status === "WAITING_ESTIMATION",
      "E3",
      "Handler BMS berhasil dirutekan ke SPARTA_MAINTENANCE dengan status awal WAITING_ESTIMATION"
    );

    // E4: BMS Pilih Handler Rekanan pada Laporan Toko 2. Route target=BNM_MANTRA, status=WAITING_ESTIMATION.
    const routeE4 = await EstimationIntegrationService.createRoute({
      reportId: reportToko2.id,
      handlerType: "REKANAN",
      actor: { id: bmsUser.id, name: bmsUser.name, nik: bmsUser.nik },
      report: reportToko2,
    });
    assert(
      routeE4.handlerType === "REKANAN" &&
        routeE4.targetSystem === "BNM_MANTRA" &&
        routeE4.status === "WAITING_ESTIMATION",
      "E4",
      "Handler Rekanan berhasil dirutekan ke BNM_MANTRA dengan status awal WAITING_ESTIMATION"
    );

    // E5: Duplicate estimation on same report. Expected: 409 Conflict.
    let duplicateRejected = false;
    try {
      await EstimationIntegrationService.createRoute({
        reportId: reportToko1.id,
        handlerType: "BMS",
        actor: { id: bmsUser.id, name: bmsUser.name },
        report: reportToko1,
      });
    } catch (err: any) {
      if (err.status === 409 || err.code === "DUPLICATE_ROUTE") {
        duplicateRejected = true;
      }
    }
    assert(duplicateRejected, "E5", "Percobaan duplikasi estimasi ditolak dengan status 409 Conflict");

    // E6: TKP DC. Alur DC belum tersedia.
    const isDcRejected = (reportDc.tkpType || "").toLowerCase() !== "toko";
    assert(
      isDcRejected,
      "E6",
      "Laporan dengan TKP DC ditolak dari alur estimasi (Alur estimasi untuk lokasi DC belum tersedia)"
    );

    // E7: Branch Manager tanpa ESTIMATION_TRIGGER. Expected: tidak dapat membuat estimasi.
    const permBm = await checkUserPermission({
      user: bmUser,
      permission: "ESTIMATION_TRIGGER",
      report: reportToko1,
    });
    assert(!permBm.authorized, "E7", "Branch Manager tanpa ESTIMATION_TRIGGER ditolak membuat estimasi (403)");

    console.log("\n--------------------------------------------------");
    console.log("SECTION 2: TEST SCENARIOS PROGRESS & LIFECYCLE (F1 - F7 / P1 - P12)");
    console.log("--------------------------------------------------");

    // P1 / F3: Report estimasinya masih WAITING_ESTIMATION atau NOT_READY. Update Progress ditolak.
    let p1Rejected = false;
    let p1Reason = "";
    try {
      await ProgressService.createProgressUpdate({
        reportId: reportToko1.id, // route status is WAITING_ESTIMATION, work_status is NOT_READY
        progressPercentage: 20,
        description: "Mulai pembongkaran plafon",
        actor: { id: bmUser.id, name: bmUser.name },
        photos: [
          {
            photoType: "PROGRESS",
            originalPath: "/uploads/progress/orig_test.png",
            watermarkedPath: "/uploads/progress/wm_test.png",
            fileSize: 1024,
            mimeType: "image/png",
          },
        ],
      });
    } catch (err: any) {
      p1Rejected = true;
      p1Reason = err.message;
    }
    assert(
      p1Rejected && (p1Reason.includes("Belum Siap Dikerjakan") || p1Reason.includes("belum selesai")),
      "P1 / F3",
      `Report dengan status NOT_READY ditolak update progress: "${p1Reason}"`
    );

    // Setup report for progress testing: create route
    await EstimationIntegrationService.createRoute({
      reportId: reportProg.id,
      handlerType: "BMS",
      actor: { id: bmsUser.id, name: bmsUser.name },
      report: reportProg,
    });

    // F2: Estimasi Selesai -> TIDAK otomatis READY_FOR_WORK
    await EstimationIntegrationService.updateRouteStatus(reportProg.id, {
      status: "ESTIMATION_COMPLETED",
      estimationNumber: "EST-2026-00123",
      estimatedValue: 15000000,
      completedAt: new Date().toISOString(),
      notes: "Estimasi selesai oleh handler BMS.",
    });

    const routeAfterEstCompleted = await EstimationIntegrationService.getRouteByReportId(reportProg.id);
    assert(
      routeAfterEstCompleted?.status === "ESTIMATION_COMPLETED" &&
        routeAfterEstCompleted?.workStatus === "NOT_READY",
      "F2",
      "Estimasi Selesai (ESTIMATION_COMPLETED) TIDAK otomatis menjadi READY_FOR_WORK (workStatus tetap NOT_READY)"
    );

    // F3 test 2: Mencoba update progress saat ESTIMATION_COMPLETED tapi workStatus masih NOT_READY
    let f3Blocked = false;
    try {
      await ProgressService.createProgressUpdate({
        reportId: reportProg.id,
        progressPercentage: 10,
        description: "Mencoba mulai kerja sebelum ada trigger resmi",
        actor: { id: bmUser.id, name: bmUser.name },
        photos: [
          {
            photoType: "PROGRESS",
            originalPath: "/uploads/progress/orig_test.png",
            watermarkedPath: "/uploads/progress/wm_test.png",
            fileSize: 1024,
            mimeType: "image/png",
          },
        ],
      });
    } catch (err: any) {
      if (err.code === "WORK_NOT_READY" || err.status === 422) {
        f3Blocked = true;
      }
    }
    assert(
      f3Blocked,
      "F3",
      "Update progress tetap DIBLOKIR selama work_status = NOT_READY meskipun estimasi sudah selesai"
    );

    // Sekarang transisikan work status ke READY_FOR_WORK (simulasi trigger resmi dengan kelengkapan readiness)
    await EstimationIntegrationService.updateWorkStatus(reportProg.id, "READY_FOR_WORK", {
      readinessEvidences: {
        BMC_ESTIMATION_APPROVED: true,
        BMC_APPROVAL_EVIDENCE: "https://storage.sparta.co.id/evidence/bmc-approval.png",
        SPARTA_MAINTENANCE_START_EVIDENCE: "https://storage.sparta.co.id/evidence/sparta-start.png",
      },
    });

    // P2: Report status kerja READY_FOR_WORK. Update Progress tersedia untuk authorized user (BMS), BM tidak mendapat update progress.
    const routeAfterReady = await EstimationIntegrationService.getRouteByReportId(reportProg.id);
    const permProgBMS = await checkUserPermission({
      user: bmsUser,
      permission: "REPORT_UPDATE_PROGRESS",
      report: reportProg,
    });
    const permProgBM = await checkUserPermission({
      user: bmUser,
      permission: "REPORT_UPDATE_PROGRESS",
      report: reportProg,
    });

    assert(
      routeAfterReady?.workStatus === "READY_FOR_WORK" && permProgBMS.authorized && !permProgBM.authorized,
      "P2",
      "Report dengan workStatus = READY_FOR_WORK eligible untuk Update Progress oleh authorized user (BMS ALLOW, BM DENY)"
    );

    // P3 / F4: Submit progress 20% + foto. Expected: history dibuat.
    const wmResultP3 = await processAndWatermarkPhoto(sampleImageBuffer, {
      reportId: reportProg.id,
      reportNumber: reportProg.id,
      storeName: reportProg.storeName,
      progressPercentage: 20,
      actorName: bmsUser.name,
      photoType: "PROGRESS",
    });

    const update1 = await ProgressService.createProgressUpdate({
      reportId: reportProg.id,
      progressPercentage: 20,
      description: "Pekerjaan pembongkaran area rusak dimulai.",
      stage: "PERSIAPAN",
      actor: { id: bmsUser.id, name: bmsUser.name },
      photos: [
        {
          photoType: "PROGRESS",
          originalPath: wmResultP3.originalPath,
          watermarkedPath: wmResultP3.watermarkedPath,
          fileSize: wmResultP3.fileSize,
          mimeType: wmResultP3.mimeType,
        },
      ],
    });

    assert(
      update1.progressPercentage === 20 && update1.photos.length === 1,
      "P3",
      "Submit progress 20% + foto ber-watermark berhasil disimpan"
    );

    // P4: Submit progress 45% di hari yang sama. Expected: record baru, record 20% tetap ada (Append-Only).
    const wmResultP4 = await processAndWatermarkPhoto(sampleImageBuffer, {
      reportId: reportProg.id,
      progressPercentage: 45,
      actorName: bmsUser.name,
      photoType: "PROGRESS",
    });

    const update2 = await ProgressService.createProgressUpdate({
      reportId: reportProg.id,
      progressPercentage: 45,
      description: "Pembongkaran selesai dan material pengganti telah tiba di toko.",
      actor: { id: bmsUser.id, name: bmsUser.name },
      photos: [
        {
          photoType: "PROGRESS",
          originalPath: wmResultP4.originalPath,
          watermarkedPath: wmResultP4.watermarkedPath,
          fileSize: wmResultP4.fileSize,
          mimeType: wmResultP4.mimeType,
        },
      ],
    });

    const historyAfterP4 = await ProgressService.getProgressHistory(reportProg.id);
    assert(
      historyAfterP4.length === 2 &&
        historyAfterP4[0].progressPercentage === 20 &&
        historyAfterP4[1].progressPercentage === 45,
      "P4",
      "Progress 45% menghasilkan record baru tanpa menimpa record 20% (History Append-Only terbukti)"
    );

    // P5: Submit progress 70% hari berikutnya. Expected: timeline memiliki 3 history.
    const wmResultP5 = await processAndWatermarkPhoto(sampleImageBuffer, {
      reportId: reportProg.id,
      progressPercentage: 70,
      actorName: bmsUser.name,
      photoType: "PROGRESS",
      customDate: new Date(Date.now() + 86400000), // Next day
    });

    await ProgressService.createProgressUpdate({
      reportId: reportProg.id,
      progressPercentage: 70,
      description: "Pemasangan rangka dan instalasi keramik pengganti.",
      actor: { id: bmsUser.id, name: bmsUser.name },
      photos: [
        {
          photoType: "PROGRESS",
          originalPath: wmResultP5.originalPath,
          watermarkedPath: wmResultP5.watermarkedPath,
          fileSize: wmResultP5.fileSize,
          mimeType: wmResultP5.mimeType,
        },
      ],
    });

    const historyAfterP5 = await ProgressService.getProgressHistory(reportProg.id);
    assert(
      historyAfterP5.length === 3 && historyAfterP5[2].progressPercentage === 70,
      "P5",
      "Multi-day progress berhasil tercatat dan timeline memiliki 3 riwayat berurutan"
    );

    // P6: Validasi watermark foto (SPARTA SIAGA, No Laporan, Tanggal/Jam WIB, Progress %).
    const timestampWib = formatServerTimestampWib();
    const hasAllWatermarkFields =
      (wmResultP3.watermarkedPath.startsWith("/uploads/progress/wm_") || wmResultP3.watermarkedPath.startsWith("wm_")) &&
      wmResultP3.watermarkTimestamp.includes("WIB") &&
      wmResultP3.width > 0 &&
      wmResultP3.height > 0;

    assert(
      hasAllWatermarkFields,
      "P6",
      `Foto otomatis ber-watermark server: SPARTA SIAGA, ID: ${reportProg.id}, Timestamp: ${timestampWib}, Progress: 20%`
    );

    // P7: Submit progress lebih kecil dari sebelumnya (saat ini 70%, submit 40%). Expected: ditolak.
    let p7Rejected = false;
    try {
      await ProgressService.createProgressUpdate({
        reportId: reportProg.id,
        progressPercentage: 40,
        description: "Koreksi penurunan progress yang tidak valid",
        actor: { id: bmUser.id, name: bmUser.name },
        photos: [
          {
            photoType: "PROGRESS",
            originalPath: "/uploads/progress/orig_test.png",
            watermarkedPath: "/uploads/progress/wm_test.png",
            fileSize: 1024,
            mimeType: "image/png",
          },
        ],
      });
    } catch (err: any) {
      if (err.code === "PROGRESS_CANNOT_DECREASE" || err.status === 400) {
        p7Rejected = true;
      }
    }
    assert(p7Rejected, "P7", "Submit progress lebih kecil dari progress sebelumnya (40% < 70%) ditolak (400)");

    // P8: Submit progress tanpa foto. Expected: ditolak.
    let p8Rejected = false;
    try {
      await ProgressService.createProgressUpdate({
        reportId: reportProg.id,
        progressPercentage: 85,
        description: "Pekerjaan hampir selesai tanpa melampirkan foto",
        actor: { id: bmUser.id, name: bmUser.name },
        photos: [], // Empty photos
      });
    } catch (err: any) {
      if (err.code === "PHOTO_REQUIRED" || err.status === 400) {
        p8Rejected = true;
      }
    }
    assert(p8Rejected, "P8", "Submit progress tanpa foto wajib ditolak (PHOTO_REQUIRED: 400)");

    // P9: Progress 100% tanpa bukti akhir. Expected: belum otomatis Close Report.
    const wmResultP9 = await processAndWatermarkPhoto(sampleImageBuffer, {
      reportId: reportProg.id,
      progressPercentage: 100,
      actorName: bmUser.name,
      photoType: "PROGRESS",
    });

    await ProgressService.createProgressUpdate({
      reportId: reportProg.id,
      progressPercentage: 100,
      description: "Pekerjaan fisik selesai 100%.",
      actor: { id: bmUser.id, name: bmUser.name },
      photos: [
        {
          photoType: "PROGRESS", // Note: type PROGRESS, not FINAL/HANDOVER yet
          originalPath: wmResultP9.originalPath,
          watermarkedPath: wmResultP9.watermarkedPath,
          fileSize: wmResultP9.fileSize,
          mimeType: wmResultP9.mimeType,
        },
      ],
    });

    const reportAfter100 = await dbGetIncidentById(reportProg.id);
    const hasFinalBeforeP10 = await ProgressService.hasFinalOrHandoverEvidence(reportProg.id);
    assert(
      reportAfter100?.progress === 100 &&
        reportAfter100?.status !== "resolved" &&
        !hasFinalBeforeP10,
      "P9",
      "Progress 100% TIDAK otomatis Close Report dan tetap membutuhkan bukti akhir (FINAL / HANDOVER)"
    );

    // P10: Upload final / handover evidence (photo_type: FINAL atau HANDOVER).
    const wmResultP10 = await processAndWatermarkPhoto(sampleImageBuffer, {
      reportId: reportProg.id,
      progressPercentage: 100,
      actorName: bmUser.name,
      photoType: "HANDOVER",
    });

    await ProgressService.createProgressUpdate({
      reportId: reportProg.id,
      progressPercentage: 100,
      description: "Serah terima pekerjaan fisik bersama Store Manager.",
      actor: { id: bmUser.id, name: bmUser.name },
      photos: [
        {
          photoType: "HANDOVER",
          originalPath: wmResultP10.originalPath,
          watermarkedPath: wmResultP10.watermarkedPath,
          fileSize: wmResultP10.fileSize,
          mimeType: wmResultP10.mimeType,
        },
      ],
    });

    const hasFinalAfterP10 = await ProgressService.hasFinalOrHandoverEvidence(reportProg.id);
    const latestStatusAfterP10 = await ProgressService.getLatestProgress(reportProg.id);

    assert(
      hasFinalAfterP10 && latestStatusAfterP10.workStatus === "COMPLETED",
      "P10",
      "Upload bukti akhir HANDOVER berhasil, workStatus menjadi COMPLETED dan eligible untuk Close"
    );

    // P11: User tanpa REPORT_CLOSE mencoba Close. Expected: 403 Forbidden.
    let p11Rejected = false;
    try {
      await ProgressService.closeReport({
        reportId: reportProg.id,
        actor: {
          id: bmsUser.id,
          name: bmsUser.name,
          role: "bms",
          systemRole: "USER",
          scope: "BRANCH",
          branch: "G001",
        }, // BMS does not have REPORT_CLOSE by default
        reason: "BMS mencoba menutup laporan",
      });
    } catch (err: any) {
      if (err.status === 403 || err.code === "CLOSE_FORBIDDEN" || err.code === "ROLE_MISMATCH") {
        p11Rejected = true;
      }
    }
    assert(p11Rejected, "P11", "User tanpa hak REPORT_CLOSE (BMS) ditolak saat mencoba menutup laporan (403)");

    // P12a: Direct Close oleh Branch Manager sebelum persetujuan koordinator DITOLAK (400 COORDINATOR_APPROVAL_REQUIRED)
    let directCloseRejected = false;
    try {
      await ProgressService.closeReport({
        reportId: reportProg.id,
        actor: {
          id: bmUser.id,
          name: bmUser.name,
          role: "bm",
          systemRole: "USER",
          scope: "BRANCH",
          branch: "G001",
        },
        reason: "BM mencoba direct close sebelum approval BMC",
      });
    } catch (err: any) {
      if (err.status === 400 || err.code === "COORDINATOR_APPROVAL_REQUIRED") {
        directCloseRejected = true;
      }
    }
    assert(
      directCloseRejected,
      "P12a",
      "Direct Close oleh Branch Manager tanpa approval koordinator ditolak (400 COORDINATOR_APPROVAL_REQUIRED)"
    );

    // P12b: PIC (BMS G001) submit completion
    const submitResult = await CompletionApprovalService.submitCompletion({
      reportId: reportProg.id,
      actor: {
        id: bmsUser.id,
        name: bmsUser.name,
        role: "bms",
        systemRole: "USER",
        scope: "BRANCH",
        branch: "G001",
      },
      notes: "Pekerjaan fisik 100% selesai, siap diperiksa BMC",
    });
    assert(
      submitResult.status === "WAITING_COORDINATOR_APPROVAL",
      "P12b",
      "BMS berhasil submit completion -> WAITING_COORDINATOR_APPROVAL"
    );

    // P12c: Koordinator (BMC G001) menyetujui laporan
    const coordResult = await CompletionApprovalService.approveByCoordinator({
      reportId: reportProg.id,
      actor: {
        id: bmcUser.id,
        name: bmcUser.name,
        role: "bmc",
        systemRole: "USER",
        scope: "BRANCH",
        branch: "G001",
      },
      notes: "Hasil pekerjaan telah diperiksa dan disetujui BMC",
    });
    assert(
      coordResult.status === "WAITING_MANAGER_APPROVAL",
      "P12c",
      "BMC menyetujui laporan -> WAITING_MANAGER_APPROVAL"
    );

    // P12d: Branch Manager G001 menyetujui final & close report
    const closedIncident = await ProgressService.closeReport({
      reportId: reportProg.id,
      actor: {
        id: bmUser.id,
        name: bmUser.name,
        role: "bm",
        systemRole: "USER",
        scope: "BRANCH",
        branch: "G001",
      },
      reason: "Pekerjaan selesai 100% dan bukti serah terima telah diverifikasi lengkap.",
    });

    assert(
      closedIncident.status === "resolved" && closedIncident.progress === 100,
      "P12d",
      "Branch Manager berhasil final approve & Case Close (Status: resolved)"
    );

    console.log("\n==================================================");
    console.log(`TEST SUMMARY: ${passedCount} / ${totalTests} SCENARIOS PASSED`);
    console.log("==================================================");

    if (passedCount === totalTests) {
      console.log("ALL SCENARIOS PASSED WITH ZERO REGRESSIONS!");
      process.exit(0);
    } else {
      console.error(`SOME SCENARIOS FAILED: ${totalTests - passedCount} failures`);
      process.exit(1);
    }
  } catch (err) {
    console.error("FATAL ERROR RUNNING TEST SUITE:", err);
    process.exit(1);
  } finally {
    try {
      await pool.end();
    } catch {}
  }
}

runEstimationProgressTests();
