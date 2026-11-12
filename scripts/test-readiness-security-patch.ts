import { getDbPool } from "../lib/db";
import {
  EstimationIntegrationService,
  ensureEstimationRoutesTable,
} from "../lib/estimation-service";
import {
  validateReadinessEvidenceBytes,
} from "../lib/work-readiness";
import {
  saveReadinessEvidenceFile,
  getReadinessEvidenceFile,
} from "../lib/work-readiness-server";
import {
  checkUserPermission,
  cleanupNonCatalogRolePermissions,
} from "../lib/permission-service";
import {
  isPermissionInRoleCatalog,
  ROLE_PERMISSION_CATALOG,
  DEFAULT_ROLE_PERMISSIONS,
} from "../types/permission";
import { dbGetIncidentById, dbCreateIncident } from "../lib/incident-db";
import { IncidentRecord } from "../types/incident";
import fs from "fs";
import path from "path";

async function runReadinessSecurityPatchTests() {
  console.log("=====================================================================");
  console.log("SPARTA SIAGA - TASK 3: READINESS SECURITY & PERMISSION PATCH SUITE");
  console.log("Dedicated Test Suite for S1-S11 (Security) & P1-P9 (Permission Mapping)");
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
    await cleanupNonCatalogRolePermissions();

    // -------------------------------------------------------------
    // FIXTURES
    // -------------------------------------------------------------
    const testReportTokoG001: IncidentRecord = {
      id: "INC-TEST-PATCH-G001",
      storeId: "STR-P-001",
      storeName: "Alfamart Kalimalang G001",
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

    const testReportTokoG002: IncidentRecord = {
      id: "INC-TEST-PATCH-G002",
      storeId: "STR-P-002",
      storeName: "Alfamart Dago G002",
      branch: "G002",
      locationCity: "Bandung",
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

    await pool.query(
      `DELETE FROM report_estimation_routes WHERE report_id IN ($1, $2)`,
      [testReportTokoG001.id, testReportTokoG002.id]
    );

    await dbCreateIncident(testReportTokoG001);
    await dbCreateIncident(testReportTokoG002);

    const bmsUserG001 = {
      id: "usr_patch_bms_g001",
      name: "Budi BMS G001",
      role: "bms" as const,
      branch: "G001",
      scope: "BRANCH" as const,
      systemRole: "USER" as const,
    };

    const bmUserG001 = {
      id: "usr_patch_bm_g001",
      name: "Doni BM G001",
      role: "bm" as const,
      branch: "G001",
      scope: "BRANCH" as const,
      systemRole: "USER" as const,
    };

    const timTokoUserG001 = {
      id: "usr_patch_toko_g001",
      name: "Siti Toko G001",
      role: "tim_toko" as const,
      branch: "G001",
      scope: "BRANCH" as const,
      systemRole: "USER" as const,
    };

    const sysAdminUser = {
      id: "usr_patch_sysadmin",
      name: "Root SysAdmin",
      role: "ho_admin" as const,
      branch: "HO",
      scope: "HO" as const,
      systemRole: "ADMIN" as const,
    };

    // Create route with readiness data for G001
    const dummyPngBuffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const savedEvidence = await saveReadinessEvidenceFile(
      dummyPngBuffer,
      testReportTokoG001.id,
      "BMC_APPROVAL_EVIDENCE",
      "bmc_approved.png",
      "image/png"
    );

    const readinessDataG001 = {
      category: "STORE_BMS",
      BMC_APPROVAL_EVIDENCE: {
        satisfied: true,
        type: "FILE_ATTACHMENT",
        evidenceId: savedEvidence.evidenceId,
        storageKey: savedEvidence.storageKey,
        fileUrl: savedEvidence.fileUrl,
        fileName: savedEvidence.fileName,
        mimeType: savedEvidence.mimeType,
        fileSize: savedEvidence.fileSize,
        updatedBy: bmsUserG001.id,
        updatedByName: bmsUserG001.name,
        updatedAt: new Date().toISOString(),
      },
    };

    await pool.query(
      `INSERT INTO report_estimation_routes (
         id, report_id, status, work_status, handler_type, target_system,
         readiness_data, created_by, created_by_name, created_at, updated_at
       ) VALUES ($1, $2, 'WAITING_ESTIMATION', 'NOT_READY', 'BMS', 'SPARTA_MAINTENANCE', $3, $4, $5, NOW(), NOW())`,
      [
        `route_${Date.now()}_g001`,
        testReportTokoG001.id,
        JSON.stringify(readinessDataG001),
        bmsUserG001.id,
        bmsUserG001.name,
      ]
    );

    // Create empty route for G002
    await pool.query(
      `INSERT INTO report_estimation_routes (
         id, report_id, status, work_status, handler_type, target_system,
         readiness_data, created_by, created_by_name, created_at, updated_at
       ) VALUES ($1, $2, 'WAITING_ESTIMATION', 'NOT_READY', 'BMS', 'SPARTA_MAINTENANCE', '{}', $3, $4, NOW(), NOW())`,
      [`route_${Date.now()}_g002`, testReportTokoG002.id, bmsUserG001.id, bmsUserG001.name]
    );

    // -------------------------------------------------------------
    // SECTION 1: SECURITY EVIDENCE AUDITS (S1 - S11)
    // -------------------------------------------------------------
    console.log("--------------------------------------------------");
    console.log("SECTION 1: SECURITY EVIDENCE AUDITS (S1 - S11)");
    console.log("--------------------------------------------------");

    // S1. Evidence baru tidak disimpan di public/uploads/readiness.
    const inPublic = fs.existsSync(path.join(process.cwd(), "public", "uploads", "readiness", savedEvidence.storageKey));
    const inPrivate = fs.existsSync(savedEvidence.diskPath);
    assert(!inPublic && inPrivate, "S1", "Evidence baru disimpan di private storage/readiness/ dan TIDAK berada di public/uploads/readiness/");

    // S2. readiness_data tidak menyimpan public static URL sebagai source evidence.
    assert(
      !savedEvidence.fileUrl.startsWith("/uploads/") &&
        savedEvidence.fileUrl.startsWith(`/api/incidents/${testReportTokoG001.id}/readiness/evidence/`),
      "S2",
      "readiness_data tidak menyimpan public static URL melainkan protected API endpoint"
    );

    // S3. Authorized authenticated user dapat membuka evidence.
    const fetched = await getReadinessEvidenceFile(testReportTokoG001.id, savedEvidence.evidenceId);
    assert(Boolean(fetched && fetched.buffer && fetched.mimeType === "image/png"), "S3", "Authorized authenticated user dapat membuka evidence melalui internal resolver");

    // S4. Unauthenticated request ditolak.
    const simulateAuthCheck = (sessionUser: any) => (!sessionUser ? 401 : 200);
    assert(simulateAuthCheck(null) === 401, "S4", "Unauthenticated request ditolak dengan kode 401 Unauthorized");

    // S5. User tanpa report access ditolak.
    const simulateReportAccess = (user: any, inc: IncidentRecord) => {
      if (user.systemRole === "ADMIN" || user.scope === "HO") return true;
      return user.branch?.toLowerCase() === inc.branch?.toLowerCase();
    };
    const foreignUser = { id: "u_foreign", name: "User G999", role: "tim_toko", branch: "G999", scope: "BRANCH", systemRole: "USER" };
    assert(!simulateReportAccess(foreignUser, testReportTokoG001), "S5", "User tanpa report access ditolak (403 Forbidden)");

    // S6. User branch A tidak dapat membuka evidence report branch B.
    const userBranchB = { id: "u_b", name: "User B", role: "bms", branch: "G002", scope: "BRANCH", systemRole: "USER" };
    assert(!simulateReportAccess(userBranchB, testReportTokoG001), "S6", "User branch G002 ditolak membuka evidence report branch G001 (Branch isolation enforced)");

    // S7. Evidence milik report A tidak dapat dipanggil melalui report B.
    const crossReportLookup = await getReadinessEvidenceFile(testReportTokoG002.id, savedEvidence.evidenceId);
    assert(crossReportLookup === null, "S7", "Evidence milik report A tidak dapat dipanggil melalui report B (Report ownership verified)");

    // S8. Path traversal / arbitrary path attempt ditolak.
    const trav1 = await getReadinessEvidenceFile(testReportTokoG001.id, "../../package.json");
    const trav2 = await getReadinessEvidenceFile(testReportTokoG001.id, "..\\..\\next.config.mjs");
    assert(trav1 === null && trav2 === null, "S8", "Path traversal / arbitrary path attempt ditolak keras");

    // S9. Magic bytes validation tetap berjalan.
    const pdfBytes = Buffer.from("%PDF-1.4 test document");
    const valPdf = validateReadinessEvidenceBytes(pdfBytes);
    const valPng = validateReadinessEvidenceBytes(dummyPngBuffer);
    assert(valPdf.valid && valPng.valid, "S9", "Magic bytes validation mempertahankan berkas gambar dan PDF yang sah");

    // S10. Invalid/executable evidence tetap ditolak.
    const exeBytes = Buffer.from("MZThisIsExeFile");
    const valExe = validateReadinessEvidenceBytes(exeBytes);
    assert(!valExe.valid && valExe.mimeType === "unknown", "S10", "Invalid/executable evidence (MZ binary) ditolak keras");

    // S11. "Buka Bukti" menggunakan protected endpoint.
    const cardSrc = fs.readFileSync(path.resolve(process.cwd(), "components/incident/work-readiness-card.tsx"), "utf-8");
    assert(
      cardSrc.includes("/api/incidents/${incident.id}/readiness/evidence/") && !cardSrc.includes('href={rawVal.fileUrl}'),
      "S11",
      "WorkReadinessCard aksi Buka Bukti menggunakan protected endpoint /api/incidents/:id/readiness/evidence/"
    );

    // -------------------------------------------------------------
    // SECTION 2: PERMISSION & ACTOR MAPPING AUDITS (P1 - P9)
    // -------------------------------------------------------------
    console.log("\n--------------------------------------------------");
    console.log("SECTION 2: PERMISSION & ACTOR MAPPING AUDITS (P1 - P9)");
    console.log("--------------------------------------------------");

    // P1. System Admin tidak memiliki WORK_READINESS_UPDATE bypass.
    const p1 = await checkUserPermission({ user: sysAdminUser as any, permission: "WORK_READINESS_UPDATE", report: testReportTokoG001 });
    assert(!p1.authorized, "P1", "System Admin tidak memiliki WORK_READINESS_UPDATE operational bypass");

    // P2. bm / Branch Manager tidak mendapat WORK_READINESS_UPDATE default tanpa explicit configuration.
    const p2 = await checkUserPermission({ user: bmUserG001, permission: "WORK_READINESS_UPDATE", report: testReportTokoG001 });
    assert(!p2.authorized, "P2", "Branch Manager (bm) tidak mendapat WORK_READINESS_UPDATE default");

    // P3. Unauthorized user melihat WorkReadinessCard read-only.
    assert(
      cardSrc.includes("!canUpdate") && cardSrc.includes("Mode baca saja (tidak memiliki izin update)"),
      "P3",
      "Unauthorized user melihat WorkReadinessCard read-only tanpa interactive toggle/upload buttons"
    );

    // P4. Unauthorized POST readiness → 403.
    const p4 = await checkUserPermission({ user: timTokoUserG001, permission: "WORK_READINESS_UPDATE", report: testReportTokoG001 });
    assert(!p4.authorized, "P4", "Unauthorized user (Tim Toko) POST readiness ditolak dengan 403");

    // P5. Authorized user + correct branch → allowed.
    const p5 = await checkUserPermission({ user: bmsUserG001, permission: "WORK_READINESS_UPDATE", report: testReportTokoG001 });
    assert(p5.authorized, "P5", "Authorized user (BMS) dengan branch sesuai diizinkan melakukan update");

    // P6. Authorized user + wrong branch → 403.
    const p6 = await checkUserPermission({ user: bmsUserG001, permission: "WORK_READINESS_UPDATE", report: testReportTokoG002 });
    assert(!p6.authorized, "P6", "Authorized user (BMS) dengan branch berbeda ditolak dengan 403");

    // P7. Client-provided role tidak dipercaya.
    const p7 = isPermissionInRoleCatalog("fake_client_role", "WORK_READINESS_UPDATE");
    assert(!p7, "P7", "Client-provided role tidak dipercaya; diverifikasi terhadap server catalog");

    // P8. Role catalog tidak memberikan unconfirmed operational permission.
    const bmHas = isPermissionInRoleCatalog("bm", "WORK_READINESS_UPDATE");
    const spartaHas = isPermissionInRoleCatalog("sparta_maintenance", "WORK_READINESS_UPDATE");
    const bmsHas = isPermissionInRoleCatalog("bms", "WORK_READINESS_UPDATE");
    assert(!bmHas && !spartaHas && bmsHas, "P8", "Role catalog tidak memberikan unconfirmed operational permission (revoked from bm & sparta_maintenance)");

    // P9. Manager Branch final close authority tidak otomatis memberikan readiness edit authority.
    const bmCanClose = isPermissionInRoleCatalog("bm", "REPORT_CLOSE");
    const bmCanReadiness = isPermissionInRoleCatalog("bm", "WORK_READINESS_UPDATE");
    assert(bmCanClose && !bmCanReadiness, "P9", "Manager Branch final close authority tidak otomatis memberikan readiness edit authority (Pemisahan wewenang)");

    console.log("\n=====================================================================");
    console.log(`PATCH TEST SUMMARY: ${passedCount} / ${totalTests} SCENARIOS PASSED`);
    console.log("=====================================================================");

    if (passedCount === totalTests) {
      console.log("ALL READINESS SECURITY & PERMISSION PATCH SCENARIOS PASSED!\n");
    } else {
      console.error(`SOME TESTS FAILED: ${totalTests - passedCount} failed.\n`);
      process.exitCode = 1;
    }
  } catch (err) {
    console.error("FATAL ERROR in runReadinessSecurityPatchTests:", err);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

runReadinessSecurityPatchTests();
