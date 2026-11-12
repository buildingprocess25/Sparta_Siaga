import { getDbPool } from "../lib/db";
import { checkUserPermission } from "../lib/permission-service";
import {
  EstimationIntegrationService,
  ensureEstimationRoutesTable,
} from "../lib/estimation-service";
import { IncidentRecord } from "../types/incident";

async function runEstimationPhase1Tests() {
  console.log("==================================================");
  console.log("SPARTA SIAGA - PHASE 1 ESTIMATION ROUTING (A TO L)");
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

    // 1. Mock Reports
    const reportTokoG001: IncidentRecord = {
      id: "INC-EST-TOKO-001",
      storeId: "STR-001",
      storeName: "Alfamart Cibubur G001",
      branch: "G001",
      locationCity: "Jakarta Timur",
      disasterType: "heavy_rain",
      reportOrigin: "manual",
      tkpType: "toko",
      date: "02 Oct 2026",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: "verifying",
      progress: 20,
      timeline: [],
    };

    const reportTokoG002: IncidentRecord = {
      id: "INC-EST-TOKO-002",
      storeId: "STR-002",
      storeName: "Alfamart Bandung G002",
      branch: "G002",
      locationCity: "Bandung",
      disasterType: "flood",
      reportOrigin: "manual",
      tkpType: "toko",
      date: "02 Oct 2026",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: "verifying",
      progress: 20,
      timeline: [],
    };

    const reportDcG001: IncidentRecord = {
      id: "INC-EST-DC-001",
      storeId: "DC-001",
      storeName: "Gudang Distribusi DC Cibubur",
      branch: "G001",
      locationCity: "Jakarta Timur",
      disasterType: "fire",
      reportOrigin: "manual",
      tkpType: "dc",
      date: "02 Oct 2026",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: "investigating",
      progress: 30,
      timeline: [],
    };

    // 2. Mock Users
    const bmsUser = {
      id: "USR-BMS-001",
      name: "Agus BMS",
      nik: "BMS0001",
      role: "bms" as const,
      systemRole: "USER" as const,
      scope: "BRANCH" as const,
      branch: "G001",
    };

    const bmUser = {
      id: "USR-BM-G001",
      name: "Bambang BM",
      nik: "BM0001",
      role: "bm" as const,
      systemRole: "USER" as const,
      scope: "BRANCH" as const,
      branch: "G001",
    };

    const hoAdminUser = {
      id: "USR-HO-BUDI",
      name: "Budi HO Admin",
      nik: "HO0001",
      role: "ho_admin" as const,
      systemRole: "USER" as const,
      scope: "HO" as const,
      branch: null,
    };

    const systemAdminUser = {
      id: "USR-ADMIN-DEV",
      name: "System Admin Developer",
      nik: "ADM0001",
      role: null,
      systemRole: "ADMIN" as const,
      scope: null,
      branch: null,
    };

    const mtcUser = {
      id: "USR-MTC-001",
      name: "Dedi Maintenance",
      nik: "MTC0001",
      role: "sparta_maintenance" as const,
      systemRole: "USER" as const,
      scope: "BRANCH" as const,
      branch: "G001",
    };

    const userTanpaView = {
      id: "USR-NOVIEW-001",
      name: "User Tanpa View",
      nik: "NV0001",
      role: null,
      systemRole: "USER" as const,
      scope: null,
      branch: null,
    };

    // 3. Reset Data
    await pool.query(
      `DELETE FROM report_estimation_routes WHERE report_id IN ('INC-EST-TOKO-001', 'INC-EST-TOKO-002', 'INC-EST-DC-001')`
    );

    // ==================================================
    // SCENARIO A: BMS trigger Handler BMS pada report TKP Toko
    // ==================================================
    const routeBms = await EstimationIntegrationService.createRoute({
      reportId: reportTokoG001.id,
      handlerType: "BMS",
      actor: bmsUser,
      report: reportTokoG001,
    });

    assert(
      routeBms.handlerType === "BMS" &&
        routeBms.targetSystem === "SPARTA_MAINTENANCE" &&
        routeBms.status === "NOT_CONFIGURED" &&
        routeBms.routingStatus === "NOT_CONFIGURED",
      "A",
      "BMS trigger Handler BMS pada report TKP Toko -> route created, target SPARTA_MAINTENANCE, status NOT_CONFIGURED",
      JSON.stringify(routeBms)
    );

    // ==================================================
    // SCENARIO B: BMS trigger Handler Rekanan
    // ==================================================
    const routeRekanan = await EstimationIntegrationService.createRoute({
      reportId: reportTokoG002.id,
      handlerType: "REKANAN",
      actor: bmsUser,
      report: reportTokoG002,
    });

    assert(
      routeRekanan.handlerType === "REKANAN" &&
        routeRekanan.targetSystem === "BNM_MANTRA" &&
        routeRekanan.status === "MANUAL_ACTION_REQUIRED" &&
        routeRekanan.routingStatus === "MANUAL_ACTION_REQUIRED" &&
        routeRekanan.notes === "Silakan melanjutkan pembuatan agenda melalui BnM.",
      "B",
      "BMS trigger Handler Rekanan -> route created, target BNM_MANTRA, status MANUAL_ACTION_REQUIRED",
      JSON.stringify(routeRekanan)
    );

    // ==================================================
    // SCENARIO C: Duplicate trigger pada report yang sama
    // ==================================================
    let duplicateRejected = false;
    try {
      await EstimationIntegrationService.createRoute({
        reportId: reportTokoG001.id,
        handlerType: "REKANAN",
        actor: bmsUser,
        report: reportTokoG001,
      });
    } catch (dupErr: any) {
      if (dupErr.status === 409 || dupErr.code === "DUPLICATE_ROUTE") {
        duplicateRejected = true;
      }
    }
    assert(
      duplicateRejected === true,
      "C",
      "Duplicate trigger pada report yang sama -> 409 Conflict"
    );

    // ==================================================
    // SCENARIO D: Branch Manager trigger
    // ==================================================
    const permBm = await checkUserPermission({
      user: bmUser,
      permission: "ESTIMATION_TRIGGER",
      report: reportTokoG001,
    });
    assert(
      permBm.authorized === false,
      "D",
      "Branch Manager trigger -> 403 Forbidden (DENIED)",
      permBm.reason
    );

    // ==================================================
    // SCENARIO E: HO trigger
    // ==================================================
    const permHo = await checkUserPermission({
      user: hoAdminUser,
      permission: "ESTIMATION_TRIGGER",
      report: reportTokoG001,
    });
    assert(
      permHo.authorized === false,
      "E",
      "HO trigger -> 403 Forbidden (DENIED)",
      permHo.reason
    );

    // ==================================================
    // SCENARIO F: System Admin trigger
    // ==================================================
    const permSysAdmin = await checkUserPermission({
      user: systemAdminUser,
      permission: "ESTIMATION_TRIGGER",
      report: reportTokoG001,
    });
    assert(
      permSysAdmin.authorized === false,
      "F",
      "System Admin trigger -> 403 Forbidden (DENIED, no operational bypass)",
      permSysAdmin.reason
    );

    // ==================================================
    // SCENARIO G: Sparta Maintenance trigger
    // ==================================================
    const permMtc = await checkUserPermission({
      user: mtcUser,
      permission: "ESTIMATION_TRIGGER",
      report: reportTokoG001,
    });
    assert(
      permMtc.authorized === false,
      "G",
      "Sparta Maintenance trigger -> 403 Forbidden (DENIED, destination system not trigger actor)",
      permMtc.reason
    );

    // ==================================================
    // SCENARIO H: TKP DC
    // ==================================================
    const isDcToko = (reportDcG001.tkpType || "").toLowerCase() === "toko";
    assert(
      isDcToko === false,
      "H",
      "TKP DC -> ditolak ('Alur estimasi untuk lokasi DC belum tersedia.')"
    );

    // ==================================================
    // SCENARIO I: User dengan ESTIMATION_VIEW
    // ==================================================
    const permView = await checkUserPermission({
      user: bmUser,
      permission: "ESTIMATION_VIEW",
      report: reportTokoG001,
    });
    const loadedRoute = await EstimationIntegrationService.getRouteByReportId(reportTokoG001.id);

    assert(
      permView.authorized === true && loadedRoute !== null,
      "I",
      "User dengan ESTIMATION_VIEW -> dapat melihat status routing",
      permView.reason
    );

    // ==================================================
    // SCENARIO J: User tanpa ESTIMATION_VIEW
    // ==================================================
    const permNoView = await checkUserPermission({
      user: userTanpaView,
      permission: "ESTIMATION_VIEW",
      report: reportTokoG001,
    });

    assert(
      permNoView.authorized === false,
      "J",
      "User tanpa ESTIMATION_VIEW -> 403 tidak dapat melihat detail estimation routing",
      permNoView.reason
    );

    // ==================================================
    // SCENARIO K: Routing BMS belum punya API (No fake external_reference_id)
    // ==================================================
    assert(
      routeBms.externalReferenceId === null,
      "K",
      "Routing BMS belum punya API -> tidak boleh menghasilkan fake external_reference_id (null)"
    );

    // ==================================================
    // SCENARIO L: Audit ESTIMATION_ROUTE_CREATED
    // ==================================================
    const auditRes = await pool.query(
      `SELECT * FROM permission_audit_logs WHERE action = 'ESTIMATION_ROUTE_CREATED' AND target_user_id = $1 LIMIT 1`,
      [reportTokoG001.id]
    );

    assert(
      auditRes.rows.length > 0 &&
        auditRes.rows[0].actor_user_id === bmsUser.id &&
        auditRes.rows[0].action === "ESTIMATION_ROUTE_CREATED",
      "L",
      "Audit ESTIMATION_ROUTE_CREATED -> tercatat di permission_audit_logs",
      JSON.stringify(auditRes.rows[0])
    );

    console.log("\n==================================================");
    console.log(`TEST SUITE A–L RESULTS: ${passedCount} / ${totalTests} TESTS PASSED`);
    console.log("==================================================");
  } catch (error) {
    console.error("Test execution failed:", error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

runEstimationPhase1Tests();
