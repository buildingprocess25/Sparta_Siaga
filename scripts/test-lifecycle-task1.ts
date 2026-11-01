import { getDbPool } from "../lib/db";
import {
  EstimationIntegrationService,
  ensureEstimationRoutesTable,
  WorkStatus,
} from "../lib/estimation-service";
import {
  ProgressService,
  ensureProgressTables,
} from "../lib/progress-service";
import {
  getWorkReadinessRequirements,
  evaluateWorkReadiness,
  canTransitionToReadyForWork,
  FINAL_MANAGER_APPROVAL_STATUS,
} from "../lib/work-readiness";
import { checkUserPermission } from "../lib/permission-service";
import { dbGetIncidentById, dbCreateIncident, dbUpdateIncident } from "../lib/incident-db";
import { IncidentRecord } from "../types/incident";
import fs from "fs";
import path from "path";

async function runTask1LifecycleTests() {
  console.log("=====================================================================");
  console.log("SPARTA SIAGA - TASK 1 LIFECYCLE & WORK READINESS TEST SUITE");
  console.log("Scenarios L1-L12 (Domain & Lifecycle) and M1-M3 (Map Controls UI Fix)");
  console.log("=====================================================================\n");

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

    // -------------------------------------------------------------
    // SETUP TEST FIXTURES
    // -------------------------------------------------------------
    const testTokoReport: IncidentRecord = {
      id: "INC-TEST-L-TOKO-001",
      storeId: "STR-L001",
      storeName: "Alfamart Kalimalang L001",
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

    const testDcReport: IncidentRecord = {
      id: "INC-TEST-L-DC-002",
      storeId: "DC-L002",
      storeName: "DC Balaraja L002",
      branch: "G002",
      locationCity: "Tangerang",
      disasterType: "earthquake",
      reportOrigin: "manual",
      tkpType: "dc",
      date: "06 Oct 2026",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: "in_maintenance",
      progress: 0,
      timeline: [],
    };

    await dbCreateIncident(testTokoReport);
    await dbCreateIncident(testDcReport);

    // Clean prior test records
    await pool.query("DELETE FROM report_estimation_routes WHERE report_id LIKE 'INC-TEST-L-%'");
    await pool.query("DELETE FROM report_progress_updates WHERE report_id LIKE 'INC-TEST-L-%'");

    const bmsUser = {
      id: "USR-BMS-L001",
      name: "Dedi BMS",
      role: "bms" as const,
      businessRole: "bms" as const,
      systemRole: "USER" as const,
      scope: "BRANCH" as const,
      branch: "G001",
    };

    const sysAdminUser = {
      id: "USR-SYSADMIN-001",
      name: "Root Tech Admin",
      role: null,
      businessRole: null,
      systemRole: "ADMIN" as const,
      scope: "HO" as const,
      branch: null,
    };

    // =============================================================
    // L1: ESTIMATION_COMPLETED tidak otomatis menghasilkan READY_FOR_WORK
    // =============================================================
    const routeL1 = await EstimationIntegrationService.createRoute({
      reportId: testTokoReport.id,
      handlerType: "BMS",
      actor: { id: bmsUser.id, name: bmsUser.name },
      report: testTokoReport,
    });

    await EstimationIntegrationService.updateRouteStatus(testTokoReport.id, {
      status: "ESTIMATION_COMPLETED",
      estimationNumber: "EST-L1-9999",
      estimatedValue: 12500000,
      completedAt: new Date().toISOString(),
      notes: "Estimasi selesai oleh BMS.",
    });

    const routeAfterEstCompleted = await EstimationIntegrationService.getRouteByReportId(testTokoReport.id);
    assert(
      routeAfterEstCompleted?.status === "ESTIMATION_COMPLETED" &&
        routeAfterEstCompleted?.workStatus === "NOT_READY",
      "L1",
      "ESTIMATION_COMPLETED tidak otomatis menghasilkan READY_FOR_WORK (workStatus tetap NOT_READY)"
    );

    // =============================================================
    // L2: NOT_READY tidak dapat melakukan update progress
    // =============================================================
    let l2Blocked = false;
    let l2Error = "";
    try {
      await ProgressService.createProgressUpdate({
        reportId: testTokoReport.id,
        progressPercentage: 15,
        description: "Mencoba mulai kerja sebelum readiness tervalidasi",
        actor: { id: bmsUser.id, name: bmsUser.name },
        photos: [
          {
            photoType: "PROGRESS",
            originalPath: "/uploads/progress/test.jpg",
            watermarkedPath: "/uploads/progress/wm_test.jpg",
            fileSize: 1024,
            mimeType: "image/jpeg",
          },
        ],
      });
    } catch (err: any) {
      if (err.code === "WORK_NOT_READY" || err.status === 422) {
        l2Blocked = true;
        l2Error = err.message;
      }
    }
    assert(
      l2Blocked,
      "L2",
      `NOT_READY tidak dapat melakukan update progress (Ditolak: ${l2Error})`
    );

    // =============================================================
    // L3: Transition NOT_READY -> READY_FOR_WORK hanya diperbolehkan setelah readiness validation terpenuhi
    // =============================================================
    // 3a. Coba transisi tanpa kelengkapan berkas -> HARUS DITOLAK
    let l3Rejected = false;
    try {
      await EstimationIntegrationService.updateWorkStatus(
        testTokoReport.id,
        "READY_FOR_WORK",
        {
          readinessEvidences: {
            BMC_ESTIMATION_APPROVED: true,
            // BMC_APPROVAL_EVIDENCE missing
            // SPARTA_MAINTENANCE_START_EVIDENCE missing
          },
        }
      );
    } catch (err: any) {
      if (err.code === "WORK_READINESS_INCOMPLETE" || err.status === 422) {
        l3Rejected = true;
      }
    }
    assert(
      l3Rejected,
      "L3a",
      "Transisi NOT_READY -> READY_FOR_WORK ditolak jika persyaratan readiness belum lengkap"
    );

    // 3b. Transisi dengan seluruh berkas readiness lengkap -> HARUS DITERIMA
    const completeBmsEvidences = {
      BMC_ESTIMATION_APPROVED: true,
      BMC_APPROVAL_EVIDENCE: "https://storage.sparta.co.id/evidence/bmc-approval-001.png",
      SPARTA_MAINTENANCE_START_EVIDENCE: "https://storage.sparta.co.id/evidence/sparta-start-001.png",
    };

    const routeAfterReady = await EstimationIntegrationService.updateWorkStatus(
      testTokoReport.id,
      "READY_FOR_WORK",
      {
        readinessEvidences: completeBmsEvidences,
      }
    );
    assert(
      routeAfterReady.workStatus === "READY_FOR_WORK" &&
        Boolean(routeAfterReady.readinessData?.BMC_ESTIMATION_APPROVED),
      "L3b",
      "Transisi NOT_READY -> READY_FOR_WORK berhasil setelah seluruh persyaratan readiness terpenuhi"
    );

    // =============================================================
    // L4: NOT_READY -> IN_PROGRESS secara direct harus ditolak
    // =============================================================
    // Buat route baru dengan status awal NOT_READY
    const testDcRoute = await EstimationIntegrationService.createRoute({
      reportId: testDcReport.id,
      handlerType: "BES",
      actor: { id: bmsUser.id, name: bmsUser.name },
      report: testDcReport,
    });

    let l4Rejected = false;
    try {
      await EstimationIntegrationService.updateWorkStatus(testDcReport.id, "IN_PROGRESS");
    } catch (err: any) {
      if (err.code === "INVALID_WORK_TRANSITION" || err.status === 422) {
        l4Rejected = true;
      }
    }
    assert(
      l4Rejected,
      "L4",
      "Transisi langsung NOT_READY -> IN_PROGRESS ditolak (wajib melalui READY_FOR_WORK)"
    );

    // =============================================================
    // L5: NOT_READY -> COMPLETED harus ditolak
    // =============================================================
    let l5Rejected = false;
    try {
      await EstimationIntegrationService.updateWorkStatus(testDcReport.id, "COMPLETED");
    } catch (err: any) {
      if (err.code === "INVALID_WORK_TRANSITION" || err.status === 422) {
        l5Rejected = true;
      }
    }
    assert(
      l5Rejected,
      "L5",
      "Transisi langsung NOT_READY -> COMPLETED ditolak"
    );

    // =============================================================
    // L6: READY_FOR_WORK dapat masuk IN_PROGRESS melalui progress valid pertama
    // =============================================================
    const updateL6 = await ProgressService.createProgressUpdate({
      reportId: testTokoReport.id,
      progressPercentage: 25,
      description: "Memulai pekerjaan fisik: pembongkaran rangka plafon",
      actor: { id: bmsUser.id, name: bmsUser.name },
      photos: [
        {
          photoType: "PROGRESS",
          originalPath: "/uploads/progress/p1_orig.jpg",
          watermarkedPath: "/uploads/progress/p1_wm.jpg",
          fileSize: 2048,
          mimeType: "image/jpeg",
        },
      ],
    });

    const routeAfterProgress1 = await EstimationIntegrationService.getRouteByReportId(testTokoReport.id);
    assert(
      updateL6.workStatus === "IN_PROGRESS" &&
        routeAfterProgress1?.workStatus === "IN_PROGRESS",
      "L6",
      "READY_FOR_WORK berhasil berpindah ke IN_PROGRESS saat progress fisik pertama disubmit"
    );

    // =============================================================
    // L7: IN_PROGRESS dapat menjadi COMPLETED saat progress mencapai 100% dan bukti akhir tersedia
    // =============================================================
    const updateL7 = await ProgressService.createProgressUpdate({
      reportId: testTokoReport.id,
      progressPercentage: 100,
      description: "Pekerjaan fisik selesai 100% dan serah terima ke toko selesai",
      actor: { id: bmsUser.id, name: bmsUser.name },
      photos: [
        {
          photoType: "HANDOVER",
          originalPath: "/uploads/progress/handover_orig.jpg",
          watermarkedPath: "/uploads/progress/handover_wm.jpg",
          fileSize: 4096,
          mimeType: "image/jpeg",
        },
      ],
    });

    const routeAfterProgress100 = await EstimationIntegrationService.getRouteByReportId(testTokoReport.id);
    assert(
      updateL7.workStatus === "COMPLETED" &&
        routeAfterProgress100?.workStatus === "COMPLETED",
      "L7",
      "IN_PROGRESS berhasil menjadi COMPLETED saat progress mencapai 100% dan bukti akhir (HANDOVER) dilampirkan"
    );

    // =============================================================
    // L8: Progress 100% tidak otomatis mengubah incident menjadi resolved
    // =============================================================
    const incidentAfter100 = await dbGetIncidentById(testTokoReport.id);
    assert(
      incidentAfter100?.progress === 100 &&
        incidentAfter100?.status === "in_maintenance",
      "L8",
      "Progress 100% TIDAK otomatis mengubah incident.status menjadi resolved (tetap 'in_maintenance')"
    );

    // =============================================================
    // L9: COMPLETED tidak otomatis mengubah incident menjadi resolved
    // =============================================================
    assert(
      routeAfterProgress100?.workStatus === "COMPLETED" &&
        incidentAfter100?.status === "in_maintenance",
      "L9",
      "work_status COMPLETED TIDAK otomatis mengubah incident.status menjadi resolved (incident tetap in_maintenance)"
    );

    // =============================================================
    // L10: Handler & TKP berbeda menghasilkan readiness requirement yang sesuai
    // =============================================================
    // 10a: TOKO + BMS -> BMC requirements
    const reqStoreBms = getWorkReadinessRequirements("toko", "BMS");
    const storeBmsKeys = reqStoreBms.map((r) => r.key);
    const hasStoreBmsKeys =
      storeBmsKeys.includes("BMC_ESTIMATION_APPROVED") &&
      storeBmsKeys.includes("BMC_APPROVAL_EVIDENCE") &&
      storeBmsKeys.includes("SPARTA_MAINTENANCE_START_EVIDENCE");

    // 10b: DC/WH + BES -> PUM / fund / material receipt requirements
    const reqDcBes = getWorkReadinessRequirements("dc", "BES");
    const dcBesKeys = reqDcBes.map((r) => r.key);
    const hasDcBesKeys =
      dcBesKeys.includes("PUM_APPROVED") &&
      dcBesKeys.includes("FUND_DISBURSED") &&
      dcBesKeys.includes("PUM_APPROVAL_EVIDENCE") &&
      dcBesKeys.includes("MATERIAL_PURCHASE_RECEIPT");

    // 10c: BUILDING -> SPK requirements
    const reqBuilding = getWorkReadinessRequirements("toko", "BUILDING");
    const buildingKeys = reqBuilding.map((r) => r.key);
    const hasBuildingKeys =
      buildingKeys.includes("SPK_RELEASED") && buildingKeys.includes("SPK_EVIDENCE");

    // 10d: REKANAN -> SPK requirements
    const reqRekanan = getWorkReadinessRequirements("toko", "REKANAN");
    const rekananKeys = reqRekanan.map((r) => r.key);
    const hasRekananKeys =
      rekananKeys.includes("SPK_RELEASED") && rekananKeys.includes("SPK_EVIDENCE");

    assert(
      hasStoreBmsKeys && hasDcBesKeys && hasBuildingKeys && hasRekananKeys,
      "L10",
      "4 Pemetaan Work Readiness sesuai aturan Pak Iqbal (STORE_BMS, DC_WH_BES, BUILDING, REKANAN)"
    );

    // =============================================================
    // L11: Final Manager Approval resmi dikonfirmasi (Manager Branch)
    // =============================================================
    assert(
      FINAL_MANAGER_APPROVAL_STATUS === "CONFIRMED_MANAGER_BRANCH",
      "L11",
      "Final Manager Approval terkonfirmasi resmi: Manager Branch dari cabang laporan (CONFIRMED_MANAGER_BRANCH)"
    );

    // =============================================================
    // L12: System Admin tidak mendapatkan operational lifecycle bypass
    // =============================================================
    const permSysAdminTrigger = await checkUserPermission({
      user: sysAdminUser as any,
      permission: "ESTIMATION_TRIGGER",
      report: testTokoReport,
    });
    const permSysAdminProgress = await checkUserPermission({
      user: sysAdminUser as any,
      permission: "REPORT_UPDATE_PROGRESS",
      report: testTokoReport,
    });
    const permSysAdminClose = await checkUserPermission({
      user: sysAdminUser as any,
      permission: "REPORT_CLOSE",
      report: testTokoReport,
    });

    const sysAdminHasZeroOperationalAccess =
      !permSysAdminTrigger.authorized &&
      !permSysAdminProgress.authorized &&
      !permSysAdminClose.authorized;

    assert(
      sysAdminHasZeroOperationalAccess,
      "L12",
      "System Administrator ditolak dari seluruh tindakan operasional lifecycle (ESTIMATION_TRIGGER, REPORT_UPDATE_PROGRESS, REPORT_CLOSE)"
    );

    // =============================================================
    // M1 - M3: MAP CONTROLS UI FIX AUDIT
    // =============================================================
    console.log("\n--------------------------------------------------");
    console.log("SECTION 3: MINOR UI FIX - KONTROL PETA MINIMIZE (M1 - M3)");
    console.log("--------------------------------------------------");

    const mapControlsPath = path.resolve(process.cwd(), "components/map/map-controls.tsx");
    const mapControlsCode = fs.readFileSync(mapControlsPath, "utf-8");

    // M1: Map expanded -> Tombol/Panel Kontrol Peta visible
    const hasExpandedKontrolPeta =
      mapControlsCode.includes("<span>Kontrol Peta</span>") &&
      mapControlsCode.includes("Minimalkan Kontrol") &&
      mapControlsCode.includes("setIsMinimized(true)");

    assert(
      hasExpandedKontrolPeta,
      "M1",
      "Saat map normal / expanded: 'Kontrol Peta' ditampilkan di header panel bersama tombol minimize"
    );

    // M2: Map minimized -> Tombol "Kontrol Peta" TIDAK dirender (no invisible clickable text/pill)
    const startIndex = mapControlsCode.indexOf("if (isMinimized) {");
    const endIndex = mapControlsCode.indexOf("// Expanded compact enterprise card");
    const minimizedSection = mapControlsCode.substring(startIndex, endIndex);

    const hasNoTextInMinimized =
      !minimizedSection.includes("<span>Kontrol Peta</span>") &&
      minimizedSection.includes("<Layers") &&
      minimizedSection.includes("setIsMinimized(false)");

    assert(
      hasNoTextInMinimized,
      "M2",
      "Saat map minimized: Tombol berlabel 'Kontrol Peta' TIDAK dirender, hanya tombol expand icon yang aktif"
    );

    // M3: Map expanded kembali -> Tombol "Kontrol Peta" otomatis muncul kembali tanpa reload
    const supportsReExpand =
      mapControlsCode.includes("setIsMinimized(false)") &&
      mapControlsCode.includes("onClick={() => setIsMinimized(false)}");

    assert(
      supportsReExpand,
      "M3",
      "Saat tombol expand diklik: setIsMinimized(false) mengembalikan panel Kontrol Peta secara instan tanpa reload"
    );

    console.log("\n=====================================================================");
    console.log(`TEST SUMMARY: ${passedCount} / ${totalTests} SCENARIOS PASSED`);
    console.log("=====================================================================");

    if (passedCount === totalTests) {
      console.log("ALL TASK 1 SCENARIOS (L1-L12 & M1-M3) PASSED SUCCESSFULLY!");
      process.exit(0);
    } else {
      console.error(`FAILED: ${totalTests - passedCount} scenarios failed.`);
      process.exit(1);
    }
  } catch (fatalErr) {
    console.error("FATAL ERROR EXECUTING TASK 1 TEST SUITE:", fatalErr);
    process.exit(1);
  }
}

runTask1LifecycleTests();
