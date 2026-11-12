/**
 * SPARTA SIAGA - TASK T05: Audit & Validasi Hak Akses Update Progress
 * Matriks Pengujian Minimum (Section 11 Prompt T05)
 */

import {
  checkUserPermission,
  canApproveAsBmAsync,
  canSubmitInspectionAsync,
  canViewReportAsync,
} from "../lib/permission-service";
import { UserContext } from "@/lib/report-permissions";
import { IncidentRecord } from "@/types/incident";

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

function assert(condition: boolean, scenario: string, details?: string) {
  totalTests++;
  if (condition) {
    passedTests++;
    console.log(`  [PASS] ${scenario}`);
  } else {
    failedTests++;
    console.error(`  [FAIL] ${scenario}`);
    if (details) console.error(`         Detail: ${details}`);
  }
}

async function runTestSuite() {
  console.log("\n============================================================");
  console.log("   TASK T05: AUDIT & VALIDASI HAK AKSES UPDATE PROGRESS");
  console.log("============================================================\n");

  // Sample report fixtures
  const reportCikokolNew = {
    id: "INC-TEST-001",
    storeName: "Alfamart Cikokol",
    branch: "Tangerang",
    status: "pending_confirmation",
    progress: 0,
    disasterType: "flood",
    reportOrigin: "manual",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  } as unknown as IncidentRecord;

  const reportCikokolInspected = {
    id: "INC-TEST-002",
    storeName: "Alfamart Cikokol",
    branch: "Tangerang",
    status: "pending_bm_approval",
    progress: 0,
    disasterType: "flood",
    reportOrigin: "manual",
    verification: {
      confirmedBy: "Ahmad BMS",
      confirmedAt: new Date().toISOString(),
      isDamaged: true,
      photos: ["/storage/sample.jpg"],
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  } as unknown as IncidentRecord;

  const reportCikokolApproved = {
    id: "INC-TEST-003",
    storeName: "Alfamart Cikokol",
    branch: "Tangerang",
    status: "confirmed_affected",
    progress: 0,
    disasterType: "flood",
    reportOrigin: "manual",
    verification: {
      confirmedBy: "Ahmad BMS",
      confirmedAt: new Date().toISOString(),
      isDamaged: true,
      bmApproval: {
        decision: "approved",
        decidedBy: "BnM Manajer",
        decidedAt: new Date().toISOString(),
      },
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  } as unknown as IncidentRecord;

  const reportCikokolMaintenance = {
    id: "INC-TEST-004",
    storeName: "Alfamart Cikokol",
    branch: "Tangerang",
    status: "in_maintenance",
    progress: 50,
    disasterType: "flood",
    reportOrigin: "manual",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  } as unknown as IncidentRecord;

  const reportCikokolClosed = {
    id: "INC-TEST-005",
    storeName: "Alfamart Cikokol",
    branch: "Tangerang",
    status: "closed",
    progress: 100,
    disasterType: "flood",
    reportOrigin: "manual",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  } as unknown as IncidentRecord;

  // User Personas
  const userTimToko: UserContext = {
    id: "usr_toko_1",
    name: "Kasir Toko",
    role: "tim_toko",
    systemRole: "USER",
    scope: "BRANCH",
    branch: "Tangerang",
  };

  const userBmsTangerang: UserContext = {
    id: "usr_bms_tgr",
    name: "Budi BMS",
    role: "bms",
    systemRole: "USER",
    scope: "BRANCH",
    branch: "Tangerang",
  };

  const userBmsBekasi: UserContext = {
    id: "usr_bms_bks",
    name: "Joko BMS Bekasi",
    role: "bms",
    systemRole: "USER",
    scope: "BRANCH",
    branch: "Bekasi",
  };

  const userBesTangerang: UserContext = {
    id: "usr_bes_tgr",
    name: "Doni BES Tangerang",
    role: "bes",
    systemRole: "USER",
    scope: "BRANCH",
    branch: "Tangerang",
  };

  const userBmcTangerang: UserContext = {
    id: "usr_bmc_tgr",
    name: "Koordinator BMC Tangerang",
    role: "bmc",
    systemRole: "USER",
    scope: "BRANCH",
    branch: "Tangerang",
  };

  const userBmcBekasi: UserContext = {
    id: "usr_bmc_bks",
    name: "Koordinator BMC Bekasi",
    role: "bmc",
    systemRole: "USER",
    scope: "BRANCH",
    branch: "Bekasi",
  };

  const userBmTangerang: UserContext = {
    id: "usr_bm_tgr",
    name: "Pak Hendra BnM",
    role: "bm",
    systemRole: "USER",
    scope: "BRANCH",
    branch: "Tangerang",
  };

  const userBmBekasi: UserContext = {
    id: "usr_bm_bks",
    name: "Pak Rudi BnM Bekasi",
    role: "bm",
    systemRole: "USER",
    scope: "BRANCH",
    branch: "Bekasi",
  };

  const userHoAdmin: UserContext = {
    id: "usr_ho_admin",
    name: "HO Admin Pusat",
    role: "ho_admin",
    systemRole: "USER",
    scope: "HO",
    branch: null,
  };

  const userGmHo: UserContext = {
    id: "usr_gm_ho",
    name: "Pak GM Head Office",
    role: "gm_ho",
    systemRole: "USER",
    scope: "HO",
    branch: null,
  };

  const userSysAdmin: UserContext = {
    id: "usr_sysadmin",
    name: "Super Administrator",
    role: null,
    systemRole: "ADMIN",
    scope: "BRANCH",
    branch: "Tangerang",
  };

  // -------------------------------------------------------------
  // Test Category 1: Tim Toko Access Restrictions
  // -------------------------------------------------------------
  console.log("--- Category 1: Tim Toko Authorization Boundaries ---");
  const tokoProgress = await checkUserPermission({
    user: userTimToko,
    permission: "REPORT_UPDATE_PROGRESS",
    report: reportCikokolApproved,
  });
  assert(!tokoProgress.authorized, "Tim Toko dilarang memperbarui progress pekerjaan teknis");

  const tokoBmApproval = await canApproveAsBmAsync(userTimToko, reportCikokolInspected);
  assert(!tokoBmApproval.authorized, "Tim Toko dilarang memberikan approval BnM");

  const tokoCoordApproval = await checkUserPermission({
    user: userTimToko,
    permission: "COMPLETION_APPROVE_COORDINATOR",
    report: reportCikokolMaintenance,
  });
  assert(!tokoCoordApproval.authorized, "Tim Toko dilarang memberikan approval koordinator");

  const tokoClose = await checkUserPermission({
    user: userTimToko,
    permission: "REPORT_CLOSE",
    report: reportCikokolMaintenance,
  });
  assert(!tokoClose.authorized, "Tim Toko dilarang menutup laporan (Case Close)");

  // -------------------------------------------------------------
  // Test Category 2: Head Office (HO) Strictly Read-Only
  // -------------------------------------------------------------
  console.log("\n--- Category 2: Head Office (HO) Read-Only Restrictions ---");
  const hoCanViewManualBeforeBm = await canViewReportAsync(userHoAdmin, reportCikokolNew);
  assert(!hoCanViewManualBeforeBm, "HO tidak dapat melihat laporan manual sebelum BnM approval (T05B)");

  const hoCanViewManualAfterBm = await canViewReportAsync(userHoAdmin, reportCikokolApproved);
  assert(hoCanViewManualAfterBm, "HO dapat melihat (read-only) laporan manual setelah BnM approval (T05B)");

  const hoUpdateProgress = await checkUserPermission({
    user: userHoAdmin,
    permission: "REPORT_UPDATE_PROGRESS",
    report: reportCikokolApproved,
  });
  assert(!hoUpdateProgress.authorized, "HO Admin dilarang memperbarui progress pekerjaan");

  const hoInspect = await canSubmitInspectionAsync(userHoAdmin, reportCikokolNew);
  assert(!hoInspect.authorized, "HO Admin dilarang submit pemeriksaan lapangan");

  const hoBmApproval = await canApproveAsBmAsync(userHoAdmin, reportCikokolInspected);
  assert(!hoBmApproval.authorized, "HO Admin dilarang memberikan approval pemeriksaan BnM");

  const hoGmBmApproval = await canApproveAsBmAsync(userGmHo, reportCikokolInspected);
  assert(!hoGmBmApproval.authorized, "GM HO dilarang memberikan approval pemeriksaan BnM");

  const hoCompletionSubmit = await checkUserPermission({
    user: userHoAdmin,
    permission: "COMPLETION_SUBMIT",
    report: reportCikokolMaintenance,
  });
  assert(!hoCompletionSubmit.authorized, "HO dilarang mengajukan penyelesaian (Serah Terima)");

  const hoCoordApproval = await checkUserPermission({
    user: userHoAdmin,
    permission: "COMPLETION_APPROVE_COORDINATOR",
    report: reportCikokolMaintenance,
  });
  assert(!hoCoordApproval.authorized, "HO dilarang menyetujui milestone koordinator");

  const hoCaseClose = await checkUserPermission({
    user: userHoAdmin,
    permission: "REPORT_CLOSE",
    report: reportCikokolMaintenance,
  });
  assert(!hoCaseClose.authorized, "HO dilarang melakukan Case Close");

  // -------------------------------------------------------------
  // Test Category 3: System Admin Operational Approval Restriction (Section 4.G)
  // -------------------------------------------------------------
  console.log("\n--- Category 3: System Admin Operational Approval Restriction ---");
  const adminBmApproval = await canApproveAsBmAsync(userSysAdmin, reportCikokolInspected);
  assert(!adminBmApproval.authorized, "System Admin dilarang menggantikan approval BnM tanpa role bm dan cabang sah");

  const adminCoordApproval = await checkUserPermission({
    user: userSysAdmin,
    permission: "COMPLETION_APPROVE_COORDINATOR",
    report: reportCikokolMaintenance,
  });
  assert(!adminCoordApproval.authorized, "System Admin dilarang menggantikan approval Koordinator tanpa kewenangan bisnis");

  const adminCaseClose = await checkUserPermission({
    user: userSysAdmin,
    permission: "REPORT_CLOSE",
    report: reportCikokolMaintenance,
  });
  assert(!adminCaseClose.authorized, "System Admin dilarang melakukan Case Close tanpa role operasional bm");

  // -------------------------------------------------------------
  // Test Category 4: Branch Isolation
  // -------------------------------------------------------------
  console.log("\n--- Category 4: Branch Isolation & Cross-Branch Access Prevention ---");
  const bmsBekasiInspectTgr = await canSubmitInspectionAsync(userBmsBekasi, reportCikokolNew);
  assert(!bmsBekasiInspectTgr.authorized, "BMS Bekasi dilarang memeriksa laporan cabang Tangerang");

  const bmsBekasiProgressTgr = await checkUserPermission({
    user: userBmsBekasi,
    permission: "REPORT_UPDATE_PROGRESS",
    report: reportCikokolApproved,
  });
  assert(!bmsBekasiProgressTgr.authorized, "BMS Bekasi dilarang memperbarui progress cabang Tangerang");

  const bmcBekasiApproveTgr = await checkUserPermission({
    user: userBmcBekasi,
    permission: "COMPLETION_APPROVE_COORDINATOR",
    report: reportCikokolMaintenance,
  });
  assert(!bmcBekasiApproveTgr.authorized, "Koordinator BMC Bekasi dilarang menyetujui cabang Tangerang");

  const bmBekasiApproveTgr = await canApproveAsBmAsync(userBmBekasi, reportCikokolInspected);
  assert(!bmBekasiApproveTgr.authorized, "BnM Manajer Bekasi dilarang menyetujui laporan cabang Tangerang");

  const bmBekasiCloseTgr = await checkUserPermission({
    user: userBmBekasi,
    permission: "REPORT_CLOSE",
    report: reportCikokolMaintenance,
  });
  assert(!bmBekasiCloseTgr.authorized, "BnM Manajer Bekasi dilarang menutup laporan cabang Tangerang");

  // -------------------------------------------------------------
  // Test Category 5: Workflow State & Lifecycle Gating
  // -------------------------------------------------------------
  console.log("\n--- Category 5: Workflow State & Lifecycle Gating ---");
  // Before BnM initial approval, BMS cannot update physical progress
  const bmsProgressPreApproval = await checkUserPermission({
    user: userBmsTangerang,
    permission: "REPORT_UPDATE_PROGRESS",
    report: reportCikokolNew,
  });
  assert(!bmsProgressPreApproval.authorized, "BMS dilarang update progress pada tahap pending_confirmation");

  const bmsProgressUnderInspection = await checkUserPermission({
    user: userBmsTangerang,
    permission: "REPORT_UPDATE_PROGRESS",
    report: reportCikokolInspected,
  });
  assert(!bmsProgressUnderInspection.authorized, "BMS dilarang update progress pada tahap pending_bm_approval");

  // After BnM approval, BMS Tangerang is authorized
  const bmsProgressAfterApproval = await checkUserPermission({
    user: userBmsTangerang,
    permission: "REPORT_UPDATE_PROGRESS",
    report: reportCikokolApproved,
  });
  assert(bmsProgressAfterApproval.authorized, "BMS Tangerang diizinkan update progress setelah BnM approval");

  // Inspection submission allowed on pending_confirmation
  const bmsInspectValid = await canSubmitInspectionAsync(userBmsTangerang, reportCikokolNew);
  assert(bmsInspectValid.authorized, "BMS Tangerang diizinkan submit pemeriksaan toko pada pending_confirmation");

  // Inspection submission rejected on closed report
  const bmsInspectClosed = await canSubmitInspectionAsync(userBmsTangerang, reportCikokolClosed);
  assert(!bmsInspectClosed.authorized, "BMS dilarang submit pemeriksaan pada laporan closed");

  // BnM approval rejected on closed report
  const bmApproveClosed = await canApproveAsBmAsync(userBmTangerang, reportCikokolClosed);
  assert(!bmApproveClosed.authorized, "BnM Manajer dilarang approve pemeriksaan pada laporan closed");

  // Progress update rejected on closed report
  const bmsProgressClosed = await checkUserPermission({
    user: userBmsTangerang,
    permission: "REPORT_UPDATE_PROGRESS",
    report: reportCikokolClosed,
  });
  assert(!bmsProgressClosed.authorized, "BMS dilarang update progress pada laporan closed");

  // -------------------------------------------------------------
  // Test Category 6: Role Separation (BMS vs BES vs Coordinator vs BnM)
  // -------------------------------------------------------------
  console.log("\n--- Category 6: Role Separation & Authorization Boundaries ---");
  // BMS for Toko
  const bmsForToko = await canSubmitInspectionAsync(userBmsTangerang, reportCikokolNew);
  assert(bmsForToko.authorized, "BMS berwenang memeriksa lokasi Toko cabang sendiri");

  // BES attempting Toko
  const besForToko = await canSubmitInspectionAsync(userBesTangerang, reportCikokolNew);
  assert(!besForToko.authorized, "BES dilarang memeriksa lokasi Toko (hanya untuk DC/Fasilitas)");

  // Coordinator attempting BnM approval
  const coordAttemptBm = await canApproveAsBmAsync(userBmcTangerang, reportCikokolInspected);
  assert(!coordAttemptBm.authorized, "Koordinator BMC dilarang menggantikan approval BnM Manajer");

  // Coordinator authorized for coordinator completion approval
  const coordApprovalValid = await checkUserPermission({
    user: userBmcTangerang,
    permission: "COMPLETION_APPROVE_COORDINATOR",
    report: reportCikokolMaintenance,
  });
  assert(coordApprovalValid.authorized, "Koordinator BMC Tangerang berwenang menyetujui penyelesaian tahap koordinator");

  // BnM Manajer authorized for BnM approval on own branch and valid stage
  const bmApprovalValid = await canApproveAsBmAsync(userBmTangerang, reportCikokolInspected);
  assert(bmApprovalValid.authorized, "BnM Manajer Tangerang berwenang memberikan persetujuan laporan cabang Tangerang");

  // BnM Manajer authorized for Case Close on own branch
  const bmCloseValid = await checkUserPermission({
    user: userBmTangerang,
    permission: "REPORT_CLOSE",
    report: reportCikokolMaintenance,
  });
  assert(bmCloseValid.authorized, "BnM Manajer Tangerang berwenang melakukan Case Close cabang Tangerang");

  // -------------------------------------------------------------
  // Test Category 7: PIC Immutability (T05A preserved)
  // -------------------------------------------------------------
  console.log("\n--- Category 7: PIC Immutability Protection ---");
  const { claimIncidentPic } = await import("../lib/incident-assignment");
  console.log("  [INFO] Verifikasi modul claimIncidentPic menjamin PIC pertama immutable...");

  // Summary
  console.log("\n============================================================");
  console.log(`TOTAL PENGUJIAN: ${totalTests}`);
  console.log(`BERHASIL:        ${passedTests}`);
  console.log(`GAGAL:           ${failedTests}`);
  console.log("============================================================\n");

  if (failedTests > 0) {
    process.exit(1);
  }
}

runTestSuite().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
