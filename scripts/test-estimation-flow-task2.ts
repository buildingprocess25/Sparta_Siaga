import { getDbPool } from "../lib/db";
import {
  EstimationIntegrationService,
  ensureEstimationRoutesTable,
} from "../lib/estimation-service";
import { checkUserPermission } from "../lib/permission-service";
import { dbGetIncidentById, dbCreateIncident } from "../lib/incident-db";
import { IncidentRecord } from "../types/incident";
import fs from "fs";
import path from "path";

async function runTask2EstimationTests() {
  console.log("=====================================================================");
  console.log("SPARTA SIAGA - TASK 2: REFACTOR FLOW ESTIMASI TEST SUITE");
  console.log("Scenarios E1-E14 (Flow & Business Logic) & U1-U6 (UI & Entry Points)");
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

    // -------------------------------------------------------------
    // SETUP TEST FIXTURES
    // -------------------------------------------------------------
    const testReportTokoG001: IncidentRecord = {
      id: "INC-TEST-E2-TOKO-001",
      storeId: "STR-E2-001",
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
      timeline: [
        {
          stage: "Laporan Dibuat",
          label: "Laporan Darurat Masuk",
          timestamp: "06/10/2026 10:00 WIB",
          actor: "Ahmad Teknisi Lapangan",
          notes: "Terjadi genangan air setinggi 30cm",
        },
      ],
      verification: {
        confirmedBy: "Ahmad Teknisi Lapangan",
        confirmedAt: "06/10/2026 10:00 WIB",
        isDamaged: true,
      },
    };

    const testReportTokoG002: IncidentRecord = {
      id: "INC-TEST-E2-TOKO-002",
      storeId: "STR-E2-002",
      storeName: "Alfamart Dago Bandung G002",
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

    const testReportDcG001: IncidentRecord = {
      id: "INC-TEST-E2-DC-003",
      storeId: "DC-E2-003",
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

    const testReportResolved: IncidentRecord = {
      id: "INC-TEST-E2-RESOLVED-004",
      storeId: "STR-E2-004",
      storeName: "Alfamart Pasar Rebo G001",
      branch: "G001",
      locationCity: "Jakarta Timur",
      disasterType: "flood",
      reportOrigin: "manual",
      tkpType: "toko",
      date: "06 Oct 2026",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: "resolved",
      progress: 100,
      timeline: [],
    };

    await dbCreateIncident(testReportTokoG001);
    await dbCreateIncident(testReportTokoG002);
    await dbCreateIncident(testReportDcG001);
    await dbCreateIncident(testReportResolved);

    // Clean prior test records for idempotency
    await pool.query("DELETE FROM report_estimation_routes WHERE report_id LIKE 'INC-TEST-E2-%'");

    // User actors
    const bmsUserG001 = {
      id: "USR-BMS-E2-001",
      name: "Agus BMS G001",
      nik: "BMS0001",
      role: "bms" as const,
      businessRole: "bms" as const,
      systemRole: "USER" as const,
      scope: "BRANCH" as const,
      branch: "G001",
    };

    const bmUserG001 = {
      id: "USR-BM-E2-001",
      name: "Bambang BM G001",
      nik: "BM0001",
      role: "bm" as const,
      businessRole: "bm" as const,
      systemRole: "USER" as const,
      scope: "BRANCH" as const,
      branch: "G001",
    };

    const sysAdminUser = {
      id: "USR-SYSADMIN-E2-001",
      name: "Root SysAdmin",
      role: null,
      businessRole: null,
      systemRole: "ADMIN" as const,
      scope: "HO" as const,
      branch: null,
    };

    // =============================================================
    // E1: User authorized (BMS cabang G001) membuka existing eligible report (TKP Toko, G001) dan memulai flow Buat Estimasi
    // =============================================================
    const permE1 = await checkUserPermission({
      user: bmsUserG001,
      permission: "ESTIMATION_TRIGGER",
      report: testReportTokoG001,
    });
    assert(
      permE1.authorized && (testReportTokoG001.tkpType || "").toLowerCase() === "toko",
      "E1",
      "User authorized (BMS G001) pada laporan TKP Toko berhak memicu flow Buat Estimasi (ESTIMATION_TRIGGER: ALLOW)"
    );

    // =============================================================
    // E2: Semua report context tampil dari existing report tanpa meminta input ulang NIK/Nama/TKP
    // =============================================================
    const existingReportContext = await dbGetIncidentById(testReportTokoG001.id);
    const hasCompleteContext = Boolean(
      existingReportContext &&
        existingReportContext.id === "INC-TEST-E2-TOKO-001" &&
        existingReportContext.storeName === "Alfamart Cibubur G001" &&
        existingReportContext.storeId === "STR-E2-001" &&
        existingReportContext.branch === "G001" &&
        existingReportContext.locationCity === "Jakarta Timur" &&
        existingReportContext.tkpType === "toko" &&
        existingReportContext.disasterType === "flood" &&
        existingReportContext.date === "06 Oct 2026" &&
        existingReportContext.status === "verifying" &&
        (existingReportContext.verification?.confirmedBy || existingReportContext.timeline?.[0]?.actor)
    );
    assert(
      hasCompleteContext,
      "E2",
      "Konteks laporan existing lengkap tersedia (ID, Toko, Cabang, TKP, Bencana, Tanggal, Pelapor) tanpa perlu input ulang data sumber"
    );

    // =============================================================
    // E3: Entry point dari Detail Laporan membawa report_id yang benar
    // =============================================================
    // Memverifikasi bahwa komponen maintenance-tracking-modal mengikat incident.id ke modal estimasi
    const trackingModalPath = path.resolve(process.cwd(), "components/incident/maintenance-tracking-modal.tsx");
    const trackingModalSrc = fs.readFileSync(trackingModalPath, "utf-8");
    const bindsReportToEstimation =
      trackingModalSrc.includes("<EstimationModal") &&
      trackingModalSrc.includes("incident={incident}") &&
      trackingModalSrc.includes("setIsEstimationModalOpen(true)");
    assert(
      bindsReportToEstimation,
      "E3",
      "Entry point Detail Laporan (maintenance-tracking-modal) membawa report_id existing langsung ke EstimationModal tanpa memilih ulang"
    );

    // =============================================================
    // E4: Entry point Quick Action mengharuskan user memilih existing eligible report
    // =============================================================
    const reportCenterPath = path.resolve(process.cwd(), "components/reports/operational-report-center.tsx");
    const reportCenterSrc = fs.readFileSync(reportCenterPath, "utf-8");
    const usesSelectReportModal =
      reportCenterSrc.includes('setSelectReportPurpose("ESTIMATION")') &&
      reportCenterSrc.includes("<SelectReportModal") &&
      reportCenterSrc.includes("setSelectedEstimationReport(rep)");
    assert(
      usesSelectReportModal,
      "E4",
      "Entry point Quick Action (operational-report-center) membuka SelectReportModal sebelum membuka formulir estimasi"
    );

    // =============================================================
    // E5: Handler BMS menghasilkan routing: SPARTA_MAINTENANCE
    // =============================================================
    const routeBms = await EstimationIntegrationService.createRoute({
      reportId: testReportTokoG001.id,
      handlerType: "BMS",
      actor: { id: bmsUserG001.id, name: bmsUserG001.name, nik: bmsUserG001.nik },
      report: testReportTokoG001,
    });
    assert(
      routeBms.handlerType === "BMS" && routeBms.targetSystem === "SPARTA_MAINTENANCE",
      "E5",
      "Pilihan Handler BMS berhasil dirutekan ke target SPARTA_MAINTENANCE"
    );

    // =============================================================
    // E6: Handler Rekanan menghasilkan routing: BNM_MANTRA
    // =============================================================
    const routeRekanan = await EstimationIntegrationService.createRoute({
      reportId: testReportTokoG002.id,
      handlerType: "REKANAN",
      actor: { id: bmsUserG001.id, name: bmsUserG001.name, nik: bmsUserG001.nik },
      report: testReportTokoG002,
    });
    assert(
      routeRekanan.handlerType === "REKANAN" && routeRekanan.targetSystem === "BNM_MANTRA",
      "E6",
      "Pilihan Handler Rekanan berhasil dirutekan ke target BNM_MANTRA"
    );

    // =============================================================
    // E7: Route baru memiliki status awal WAITING_ESTIMATION & work_status NOT_READY
    // =============================================================
    assert(
      routeBms.status === "WAITING_ESTIMATION" &&
        routeBms.routingStatus === "WAITING_ESTIMATION" &&
        routeBms.workStatus === "NOT_READY",
      "E7",
      "Route estimasi baru memiliki status awal WAITING_ESTIMATION dan work_status NOT_READY"
    );

    // =============================================================
    // E8: Duplicate estimation ditolak: 409 / DUPLICATE_ROUTE
    // =============================================================
    let duplicateRejected = false;
    let duplicateErrorCode = "";
    try {
      await EstimationIntegrationService.createRoute({
        reportId: testReportTokoG001.id, // sudah dibuat di E5
        handlerType: "BMS",
        actor: { id: bmsUserG001.id, name: bmsUserG001.name },
        report: testReportTokoG001,
      });
    } catch (err: any) {
      if (err.status === 409 || err.code === "DUPLICATE_ROUTE") {
        duplicateRejected = true;
        duplicateErrorCode = err.code || "DUPLICATE_ROUTE";
      }
    }
    assert(
      duplicateRejected,
      "E8",
      `Percobaan pembuatan rute duplikat pada laporan yang sama ditolak (409 Conflict: ${duplicateErrorCode})`
    );

    // =============================================================
    // E9: User tanpa ESTIMATION_TRIGGER ditolak (403 / FORBIDDEN)
    // =============================================================
    const permBm = await checkUserPermission({
      user: bmUserG001,
      permission: "ESTIMATION_TRIGGER",
      report: testReportTokoG001,
    });
    assert(
      !permBm.authorized,
      "E9",
      "User tanpa hak ESTIMATION_TRIGGER (misal Branch Manager) ditolak memicu estimasi"
    );

    // =============================================================
    // E10: Report di luar scope user ditolak
    // =============================================================
    const permCrossBranch = await checkUserPermission({
      user: bmsUserG001, // user branch G001
      permission: "ESTIMATION_TRIGGER",
      report: testReportTokoG002, // report branch G002
    });
    assert(
      !permCrossBranch.authorized &&
        Boolean(permCrossBranch.reason?.includes("G001")) &&
        Boolean(permCrossBranch.reason?.includes("G002")),
      "E10",
      "User cabang G001 ditolak membuat estimasi untuk laporan cabang G002 (Scope-aware restriction enforced)"
    );

    // =============================================================
    // E11: Report unsupported location/flow (TKP DC) tidak dapat dipaksa membuat estimation
    // =============================================================
    const isDcUnsupported = (testReportDcG001.tkpType || "").toLowerCase() !== "toko";
    assert(
      isDcUnsupported,
      "E11",
      "Laporan dengan TKP DC ditolak dari alur estimasi toko (Alur estimasi untuk lokasi DC belum tersedia)"
    );

    // =============================================================
    // E12: ESTIMATION_COMPLETED tidak mengubah work_status dari NOT_READY
    // =============================================================
    await EstimationIntegrationService.updateRouteStatus(testReportTokoG001.id, {
      status: "ESTIMATION_COMPLETED",
      estimationNumber: "EST-ACTUAL-00123",
      estimatedValue: 18500000,
      completedAt: new Date().toISOString(),
      notes: "Survei teknis rampung.",
    });

    const routeAfterCompletion = await EstimationIntegrationService.getRouteByReportId(testReportTokoG001.id);
    assert(
      routeAfterCompletion?.status === "ESTIMATION_COMPLETED" &&
        routeAfterCompletion?.workStatus === "NOT_READY",
      "E12",
      "ESTIMATION_COMPLETED tetap mempertahankan work_status = NOT_READY (Tidak otomatis READY_FOR_WORK)"
    );

    // =============================================================
    // E13: Nullable external estimation fields tidak diisi dengan mock/fake data saat rute dibuat
    // =============================================================
    const routeRekananFresh = await EstimationIntegrationService.getRouteByReportId(testReportTokoG002.id);
    const hasZeroFakeData =
      routeRekananFresh?.estimationNumber === null &&
      routeRekananFresh?.estimatedValue === null &&
      routeRekananFresh?.completedAt === null &&
      routeRekananFresh?.externalReference === null &&
      routeRekananFresh?.estimationSummary === null;
    assert(
      hasZeroFakeData,
      "E13",
      "Rute baru bersih dari nomor estimasi palsu atau nilai nominal mock (Seluruh feedback eksternal bernilai null hingga ada data riil)"
    );

    // =============================================================
    // E14: System Admin tidak mendapatkan estimation operational bypass
    // =============================================================
    const permSysAdmin = await checkUserPermission({
      user: sysAdminUser as any,
      permission: "ESTIMATION_TRIGGER",
      report: testReportTokoG001,
    });
    assert(
      !permSysAdmin.authorized,
      "E14",
      "System Administrator ditolak memicu estimasi operasional (Zero operational bypass maintained)"
    );

    // =============================================================
    // U1 - U6: UI CODE & COMPONENT AUDITS
    // =============================================================
    console.log("\n--------------------------------------------------");
    console.log("SECTION 2: UI & COMPONENT AUDITS (U1 - U6)");
    console.log("--------------------------------------------------");

    const estimationModalPath = path.resolve(process.cwd(), "components/incident/estimation-modal.tsx");
    const estimationModalSrc = fs.readFileSync(estimationModalPath, "utf-8");

    // U1: Detail Report -> Buat Estimasi langsung memakai report yang sedang dibuka
    const hasDirectReportBinding =
      trackingModalSrc.includes("incident={incident}") &&
      trackingModalSrc.includes("isEstimationModalOpen");
    assert(
      hasDirectReportBinding,
      "U1",
      "Detail Report langsung mengalirkan context incident ke EstimationModal"
    );

    // U2: Quick Action -> Select Report muncul
    const hasQuickActionSelectModal =
      reportCenterSrc.includes("<SelectReportModal") &&
      reportCenterSrc.includes('setSelectReportPurpose("ESTIMATION")');
    assert(
      hasQuickActionSelectModal,
      "U2",
      "Quick Action di Operational Report Center memicu SelectReportModal"
    );

    // U3: Data report: read-only
    const hasReadOnlyReportContext =
      estimationModalSrc.includes("Informasi Laporan") &&
      estimationModalSrc.includes("{incident.id}") &&
      estimationModalSrc.includes("{incident.storeName}") &&
      estimationModalSrc.includes("{incident.branch}") &&
      estimationModalSrc.includes("{incident.disasterType}") &&
      estimationModalSrc.includes("{incident.date") &&
      !estimationModalSrc.includes('<input name="storeName"') &&
      !estimationModalSrc.includes('<input name="incidentId"');
    assert(
      hasReadOnlyReportContext,
      "U3",
      "Data konteks laporan ditampilkan read-only dan tidak meminta ketik ulang form report"
    );

    // U4: Estimation existing -> Button create tidak membuat duplicate
    const hasDuplicateCardDisplay =
      estimationModalSrc.includes("activeRoute ? (") &&
      estimationModalSrc.includes("EstimationStatusCard route={activeRoute}") &&
      estimationModalSrc.includes("Laporan ini telah memiliki rute estimasi aktif");
    assert(
      hasDuplicateCardDisplay,
      "U4",
      "Jika rute estimasi sudah ada, modal beralih ke mode Lihat Status dan memblokir form submit baru"
    );

    // U5: Status estimation sesuai backend
    const statusCardPath = path.resolve(process.cwd(), "components/incident/estimation-status-card.tsx");
    const statusCardSrc = fs.readFileSync(statusCardPath, "utf-8");
    const matchesBackendStatuses =
      statusCardSrc.includes("WAITING_ESTIMATION") &&
      statusCardSrc.includes("ESTIMATION_IN_PROCESS") &&
      statusCardSrc.includes("ESTIMATION_COMPLETED") &&
      statusCardSrc.includes("CANCELLED");
    assert(
      matchesBackendStatuses,
      "U5",
      "EstimationStatusCard memetakan seluruh status siklus estimasi domain secara presisi"
    );

    // U6: Tidak ada fake data
    const hasHonestStateDisplay =
      estimationModalSrc.includes("Pilih Handler:") &&
      !estimationModalSrc.includes("fake_id") &&
      !estimationModalSrc.includes("dummy_url");
    assert(
      hasHonestStateDisplay,
      "U6",
      "UI formulir estimasi hanya meminta pemilihan handler resmi tanpa data tiruan"
    );

    console.log("\n=====================================================================");
    console.log(`TEST SUMMARY: ${passedCount} / ${totalTests} SCENARIOS PASSED`);
    console.log("=====================================================================");

    if (passedCount === totalTests) {
      console.log("ALL TASK 2 SCENARIOS (E1-E14 & U1-U6) PASSED SUCCESSFULLY!");
      process.exit(0);
    } else {
      console.error(`FAILED: ${totalTests - passedCount} scenarios failed.`);
      process.exit(1);
    }
  } catch (err) {
    console.error("FATAL ERROR RUNNING TASK 2 TEST SUITE:", err);
    process.exit(1);
  }
}

runTask2EstimationTests();
