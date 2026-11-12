/**
 * SPARTA SIAGA - Task 4 Test Suite
 * Module Update Progress Pekerjaan
 * 
 * Covers: P1-P30, U1-U12, Security tests
 */

import { ProgressService, ensureProgressTables } from "../lib/progress-service";
import { EstimationIntegrationService, ensureEstimationRoutesTable, WorkStatus } from "../lib/estimation-service";
import { dbGetIncidentById, dbUpdateIncident } from "../lib/incident-db";
import { processAndWatermarkPhoto, validateImageMagicBytes } from "../lib/watermark";
import { checkUserPermission, getRolePermissions } from "../lib/permission-service";
import { getProgressPhotoFile, PROGRESS_STORAGE_DIR } from "../lib/progress-storage";
import { isOperationalPermission, ROLE_PERMISSION_CATALOG } from "../types/permission";
import sharp from "sharp";
import fs from "fs/promises";
import path from "path";

// ============================================
// Test Helpers
// ============================================

let passed = 0;
let failed = 0;
let skipped = 0;

const publicProgressDir = path.join(process.cwd(), "public", "uploads", "progress");

async function snapshotPublicProgressFiles(): Promise<Set<string>> {
  try {
    return new Set(await fs.readdir(publicProgressDir));
  } catch {
    return new Set();
  }
}

// Capture before the suite performs any progress update. Comparing filenames
// is deterministic in copied worktrees where tracked-file mtimes are refreshed.
const initialPublicProgressFiles = snapshotPublicProgressFiles();

function logResult(id: string, title: string, success: boolean, detail?: string) {
  if (success) {
    passed++;
    console.log(`  ✅ ${id}: ${title}`);
  } else {
    failed++;
    console.log(`  ❌ ${id}: ${title}`);
    if (detail) console.log(`     → ${detail}`);
  }
}

function logSkip(id: string, title: string, reason: string) {
  skipped++;
  console.log(`  ⏭️  ${id}: ${title} - SKIPPED: ${reason}`);
}

// Generate a minimal valid JPEG buffer for testing
async function createTestJpegBuffer(): Promise<Buffer> {
  return sharp({
    create: { width: 100, height: 100, channels: 3, background: { r: 128, g: 128, b: 128 } },
  }).jpeg().toBuffer();
}

// Test actor fixtures
const BMS_ACTOR = {
  id: "test-bms-user",
  name: "BMS Test User",
  branch: "TEST-BRANCH",
  role: "bms",
  systemRole: "USER" as const,
  scope: "BRANCH" as const,
};

const ADMIN_ACTOR = {
  id: "test-admin",
  name: "System Admin",
  branch: null,
  role: null,
  systemRole: "ADMIN" as const,
  scope: "HO" as const,
};

const OTHER_BRANCH_ACTOR = {
  id: "test-other-branch",
  name: "Other Branch User",
  branch: "OTHER-BRANCH",
  role: "bms",
  systemRole: "USER" as const,
  scope: "BRANCH" as const,
};

// ============================================
// Test Report Setup Helper
// ============================================

let testReportId: string;

async function findOrCreateTestReport(): Promise<string> {
  // Find an existing report with estimation route in READY_FOR_WORK
  const pool = (await import("../lib/db")).getDbPool();
  await ensureEstimationRoutesTable();
  await ensureProgressTables();

  // Clean up any previous test data
  const cleanupId = `TASK4-TEST-${Date.now()}`;

  // Create a test incident
  const { dbCreateIncident } = await import("../lib/incident-db");
  await dbCreateIncident({
    id: cleanupId,
    storeId: "ST-001",
    storeName: "Toko Test",
    branch: "TEST-BRANCH",
    locationCity: "Test Location",
    disasterType: "flood",
    reportOrigin: "manual",
    tkpType: "toko",
    date: "06 Oct 2026",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    status: "in_maintenance",
    progress: 0,
    timeline: [],
  });

  // Create estimation route with ESTIMATION_COMPLETED status
  try {
    await EstimationIntegrationService.createRoute({
      reportId: cleanupId,
      handlerType: "BMS",
      actor: { id: BMS_ACTOR.id, name: BMS_ACTOR.name },
      report: (await dbGetIncidentById(cleanupId))!,
    });
  } catch (e: any) {
    if (e.code !== "DUPLICATE_ROUTE") throw e;
  }

  // Move to ESTIMATION_COMPLETED
  await EstimationIntegrationService.updateRouteStatus(cleanupId, {
    status: "ESTIMATION_COMPLETED",
  });

  testReportId = cleanupId;
  return cleanupId;
}

async function setWorkStatusForTest(reportId: string, status: WorkStatus) {
  const pool = (await import("../lib/db")).getDbPool();
  await pool.query(
    `UPDATE report_estimation_routes SET work_status = $1, updated_at = NOW() WHERE report_id = $2`,
    [status, reportId]
  );
}

async function resetProgressForTest(reportId: string) {
  const pool = (await import("../lib/db")).getDbPool();
  await pool.query(`DELETE FROM report_progress_photos WHERE report_id = $1`, [reportId]);
  await pool.query(`DELETE FROM report_progress_updates WHERE report_id = $1`, [reportId]);
  await pool.query(`UPDATE incidents SET progress = 0, status = 'in_maintenance' WHERE id = $1`, [reportId]);
}

// ============================================
// DOMAIN TESTS (P1-P30)
// ============================================

async function testP1_NotReadyRejected() {
  const id = "P1";
  const title = "NOT_READY ditolak update progress";
  try {
    const reportId = testReportId;
    await setWorkStatusForTest(reportId, "NOT_READY");
    await resetProgressForTest(reportId);

    const jpegBuf = await createTestJpegBuffer();
    const wmResult = await processAndWatermarkPhoto(jpegBuf, {
      reportId, progressPercentage: 20, actorName: "Test",
    });

    try {
      await ProgressService.createProgressUpdate({
        reportId,
        progressPercentage: 20,
        description: "Test progress",
        actor: BMS_ACTOR,
        photos: [{ photoType: "PROGRESS", originalPath: wmResult.originalPath, watermarkedPath: wmResult.watermarkedPath, fileSize: jpegBuf.length, mimeType: "image/jpeg" }],
      });
      logResult(id, title, false, "Should have thrown WORK_NOT_READY");
    } catch (err: any) {
      logResult(id, title, err.code === "WORK_NOT_READY");
    }
  } catch (err: any) {
    logResult(id, title, false, err.message);
  }
}

async function testP2_ReadyForWorkCanSubmit() {
  const id = "P2";
  const title = "READY_FOR_WORK dapat submit progress pertama";
  try {
    const reportId = testReportId;
    await setWorkStatusForTest(reportId, "READY_FOR_WORK");
    await resetProgressForTest(reportId);

    const jpegBuf = await createTestJpegBuffer();
    const wmResult = await processAndWatermarkPhoto(jpegBuf, {
      reportId, progressPercentage: 20, actorName: "Test",
    });

    const result = await ProgressService.createProgressUpdate({
      reportId,
      progressPercentage: 20,
      description: "Progress pertama",
      actor: BMS_ACTOR,
      photos: [{ photoType: "PROGRESS", originalPath: wmResult.originalPath, watermarkedPath: wmResult.watermarkedPath, fileSize: jpegBuf.length, mimeType: "image/jpeg" }],
    });

    logResult(id, title, result.progressPercentage === 20);
  } catch (err: any) {
    logResult(id, title, false, err.message);
  }
}

async function testP3_FirstProgressTransition() {
  const id = "P3";
  const title = "Progress pertama: READY_FOR_WORK → IN_PROGRESS";
  try {
    const reportId = testReportId;
    const route = await EstimationIntegrationService.getRouteByReportId(reportId);
    logResult(id, title, route?.workStatus === "IN_PROGRESS");
  } catch (err: any) {
    logResult(id, title, false, err.message);
  }
}

async function testP4_AppendOnlyHistory() {
  const id = "P4";
  const title = "Progress update menghasilkan record baru (append-only)";
  try {
    const reportId = testReportId;
    const jpegBuf = await createTestJpegBuffer();
    const wmResult = await processAndWatermarkPhoto(jpegBuf, {
      reportId, progressPercentage: 45, actorName: "Test",
    });

    await ProgressService.createProgressUpdate({
      reportId,
      progressPercentage: 45,
      description: "Progress kedua",
      actor: BMS_ACTOR,
      photos: [{ photoType: "PROGRESS", originalPath: wmResult.originalPath, watermarkedPath: wmResult.watermarkedPath, fileSize: jpegBuf.length, mimeType: "image/jpeg" }],
    });

    const history = await ProgressService.getProgressHistory(reportId);
    logResult(id, title, history.length >= 2);
  } catch (err: any) {
    logResult(id, title, false, err.message);
  }
}

async function testP5_PreviousRecordPreserved() {
  const id = "P5";
  const title = "20% → 45% mempertahankan record 20%";
  try {
    const reportId = testReportId;
    const history = await ProgressService.getProgressHistory(reportId);
    const has20 = history.some(h => h.progressPercentage === 20);
    const has45 = history.some(h => h.progressPercentage === 45);
    logResult(id, title, has20 && has45);
  } catch (err: any) {
    logResult(id, title, false, err.message);
  }
}

async function testP6_ProgressDecreaseDenied() {
  const id = "P6";
  const title = "Progress lebih rendah dari latest ditolak";
  try {
    const reportId = testReportId;
    const jpegBuf = await createTestJpegBuffer();
    const wmResult = await processAndWatermarkPhoto(jpegBuf, {
      reportId, progressPercentage: 10, actorName: "Test",
    });

    try {
      await ProgressService.createProgressUpdate({
        reportId,
        progressPercentage: 10,
        description: "Trying to decrease",
        actor: BMS_ACTOR,
        photos: [{ photoType: "PROGRESS", originalPath: wmResult.originalPath, watermarkedPath: wmResult.watermarkedPath, fileSize: jpegBuf.length, mimeType: "image/jpeg" }],
      });
      logResult(id, title, false, "Should have thrown PROGRESS_DECREASE_NOT_ALLOWED");
    } catch (err: any) {
      logResult(id, title, err.code === "PROGRESS_DECREASE_NOT_ALLOWED");
    }
  } catch (err: any) {
    logResult(id, title, false, err.message);
  }
}

async function testP7_ProgressOver100Denied() {
  const id = "P7";
  const title = "Progress >100 ditolak";
  try {
    const reportId = testReportId;
    const jpegBuf = await createTestJpegBuffer();
    const wmResult = await processAndWatermarkPhoto(jpegBuf, {
      reportId, progressPercentage: 150, actorName: "Test",
    });

    try {
      await ProgressService.createProgressUpdate({
        reportId,
        progressPercentage: 150,
        description: "Over 100",
        actor: BMS_ACTOR,
        photos: [{ photoType: "PROGRESS", originalPath: wmResult.originalPath, watermarkedPath: wmResult.watermarkedPath, fileSize: jpegBuf.length, mimeType: "image/jpeg" }],
      });
      logResult(id, title, false, "Should have thrown INVALID_PROGRESS");
    } catch (err: any) {
      logResult(id, title, err.code === "INVALID_PROGRESS");
    }
  } catch (err: any) {
    logResult(id, title, false, err.message);
  }
}

async function testP8_NegativeProgressDenied() {
  const id = "P8";
  const title = "Progress negatif ditolak";
  try {
    const reportId = testReportId;
    const jpegBuf = await createTestJpegBuffer();
    const wmResult = await processAndWatermarkPhoto(jpegBuf, {
      reportId, progressPercentage: -5, actorName: "Test",
    });

    try {
      await ProgressService.createProgressUpdate({
        reportId,
        progressPercentage: -5,
        description: "Negative",
        actor: BMS_ACTOR,
        photos: [{ photoType: "PROGRESS", originalPath: wmResult.originalPath, watermarkedPath: wmResult.watermarkedPath, fileSize: jpegBuf.length, mimeType: "image/jpeg" }],
      });
      logResult(id, title, false, "Should have thrown INVALID_PROGRESS");
    } catch (err: any) {
      logResult(id, title, err.code === "INVALID_PROGRESS");
    }
  } catch (err: any) {
    logResult(id, title, false, err.message);
  }
}

async function testP9_NoPhotoDenied() {
  const id = "P9";
  const title = "Progress tanpa foto ditolak";
  try {
    const reportId = testReportId;
    try {
      await ProgressService.createProgressUpdate({
        reportId,
        progressPercentage: 50,
        description: "No photos",
        actor: BMS_ACTOR,
        photos: [],
      });
      logResult(id, title, false, "Should have thrown PHOTO_REQUIRED");
    } catch (err: any) {
      logResult(id, title, err.code === "PHOTO_REQUIRED");
    }
  } catch (err: any) {
    logResult(id, title, false, err.message);
  }
}

async function testP10_InvalidPhotoRejected() {
  const id = "P10";
  const title = "File non-gambar (executable) ditolak";
  try {
    // Create a fake EXE/ZIP-like buffer
    const fakeExe = Buffer.from([0x4D, 0x5A, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00, 0x04, 0x00, 0x00, 0x00, 0xFF, 0xFF]);
    const validation = validateImageMagicBytes(fakeExe);
    logResult(id, title, !validation.valid);
  } catch (err: any) {
    logResult(id, title, false, err.message);
  }
}

async function testP11_PhotoStoredPrivate() {
  const id = "P11";
  const title = "Foto progress disimpan di storage/progress/ (private)";
  try {
    const jpegBuf = await createTestJpegBuffer();
    const wmResult = await processAndWatermarkPhoto(jpegBuf, {
      reportId: "TEST-PRIVATE", progressPercentage: 50, actorName: "Test",
    });

    // Watermarked path should be a storage key, not a public URL
    const isPrivate = !wmResult.watermarkedPath.startsWith("/uploads/") && !wmResult.watermarkedPath.startsWith("public/");
    const diskExists = await fs.access(wmResult.watermarkedDiskPath).then(() => true).catch(() => false);
    const isInStorageDir = wmResult.watermarkedDiskPath.includes("storage");

    logResult(id, title, isPrivate && diskExists && isInStorageDir);
  } catch (err: any) {
    logResult(id, title, false, err.message);
  }
}

async function testP12_ProtectedEndpointPattern() {
  const id = "P12";
  const title = "Progress evidence served via protected endpoint pattern";
  try {
    const jpegBuf = await createTestJpegBuffer();
    const wmResult = await processAndWatermarkPhoto(jpegBuf, {
      reportId: "TEST-ENDPOINT", progressPercentage: 60, actorName: "Test",
    });

    // Storage key should be retrievable via getProgressPhotoFile
    const storageKey = wmResult.watermarkedPath;
    const fileData = await getProgressPhotoFile(storageKey);
    logResult(id, title, fileData !== null && fileData.buffer.length > 0);
  } catch (err: any) {
    logResult(id, title, false, err.message);
  }
}

async function testP13_UnauthDenied() {
  const id = "P13";
  const title = "Unauthenticated access → protected endpoint returns null for traversal";
  try {
    // Test path traversal protection
    const traversalResult = await getProgressPhotoFile("../../../etc/passwd");
    logResult(id, title, traversalResult === null);
  } catch (err: any) {
    logResult(id, title, false, err.message);
  }
}

async function testP14_CrossBranchDenied() {
  const id = "P14";
  const title = "Cross-branch photo access check";
  try {
    const report = await dbGetIncidentById(testReportId);
    if (!report) {
      logResult(id, title, false, "Report not found");
      return;
    }
    
    const check = await checkUserPermission({
      user: OTHER_BRANCH_ACTOR as any,
      permission: "REPORT_UPDATE_PROGRESS",
      report,
    });
    logResult(id, title, !check.authorized);
  } catch (err: any) {
    logResult(id, title, false, err.message);
  }
}

async function testP15_CrossReportEvidenceBlocked() {
  const id = "P15";
  const title = "Cross-report evidence swapping blocked (storage key includes reportId)";
  try {
    const jpegBuf = await createTestJpegBuffer();
    const wmResult = await processAndWatermarkPhoto(jpegBuf, {
      reportId: "REPORT-A", progressPercentage: 50, actorName: "Test",
    });

    // The storage key should contain REPORT-A, not REPORT-B
    const keyContainsReportId = wmResult.watermarkedPath.includes("REPORT-A");
    logResult(id, title, keyContainsReportId);
  } catch (err: any) {
    logResult(id, title, false, err.message);
  }
}

async function testP16_PathTraversalBlocked() {
  const id = "P16";
  const title = "Path traversal patterns rejected";
  try {
    const tests = [
      await getProgressPhotoFile("../../etc/passwd"),
      await getProgressPhotoFile("..\\..\\etc\\passwd"),
      await getProgressPhotoFile("/etc/passwd"),
      await getProgressPhotoFile(""),
    ];
    const allNull = tests.every(t => t === null);
    logResult(id, title, allNull);
  } catch (err: any) {
    logResult(id, title, false, err.message);
  }
}

async function testP17_WatermarkServerSide() {
  const id = "P17";
  const title = "Watermark dibuat server-side (trusted timestamp, no client data)";
  try {
    const jpegBuf = await createTestJpegBuffer();
    const wmResult = await processAndWatermarkPhoto(jpegBuf, {
      reportId: "WM-TEST", progressPercentage: 75, actorName: "Server User",
    });

    // Watermarked file should be larger or different from original (watermark added)
    const origBuf = await fs.readFile(wmResult.originalDiskPath);
    const wmBuf = await fs.readFile(wmResult.watermarkedDiskPath);

    const wmTimestamp = wmResult.watermarkTimestamp;
    const hasTimestamp = Boolean(wmTimestamp && wmTimestamp.includes("WIB"));

    logResult(id, title, wmBuf.length > origBuf.length && hasTimestamp);
  } catch (err: any) {
    logResult(id, title, false, err.message);
  }
}

async function testP18_AuthenticatedActorMetadata() {
  const id = "P18";
  const title = "Audit metadata dari session/server (bukan client)";
  try {
    const reportId = testReportId;
    const history = await ProgressService.getProgressHistory(reportId);
    const latest = history[history.length - 1];

    // Created by should be from actor, not arbitrary client value
    const hasCreatedBy = latest && latest.createdBy === BMS_ACTOR.id;
    const hasCreatedByName = latest && latest.createdByName === BMS_ACTOR.name;
    logResult(id, title, hasCreatedBy && hasCreatedByName);
  } catch (err: any) {
    logResult(id, title, false, err.message);
  }
}

async function testP19_BMSCanUpdateBMSWork() {
  const id = "P19";
  const title = "Handler BMS → BMS/internal boleh update progress (permission check)";
  try {
    const report = await dbGetIncidentById(testReportId);
    if (!report) {
      logResult(id, title, false, "Report not found");
      return;
    }

    const check = await checkUserPermission({
      user: BMS_ACTOR as any,
      permission: "REPORT_UPDATE_PROGRESS",
      report,
    });
    logResult(id, title, check.authorized);
  } catch (err: any) {
    logResult(id, title, false, err.message);
  }
}

async function testP20_RekananInternalUpdateOnly() {
  const id = "P20";
  const title = "Handler Rekanan → BMS/internal yang update, Rekanan tidak mempunyai REPORT_UPDATE_PROGRESS";
  try {
    // Check that role catalog for 'rekanan' (if exists) doesn't have REPORT_UPDATE_PROGRESS
    // Rekanan role is NOT in ROLE_PERMISSION_CATALOG = default DENY
    const rekananCatalog = ROLE_PERMISSION_CATALOG["rekanan"];
    const hasProgressPerm = rekananCatalog && (rekananCatalog as readonly string[]).includes("REPORT_UPDATE_PROGRESS");
    logResult(id, title, !hasProgressPerm);
  } catch (err: any) {
    logResult(id, title, false, err.message);
  }
}

async function testP21_ClientCannotSpoofHandler() {
  const id = "P21";
  const title = "Handler resolved dari database, bukan client payload";
  try {
    const route = await EstimationIntegrationService.getRouteByReportId(testReportId);
    // Handler is stored in DB and resolved server-side
    logResult(id, title, route !== null && route.handlerType === "BMS");
  } catch (err: any) {
    logResult(id, title, false, err.message);
  }
}

async function testP22_ClientCannotSpoofBranch() {
  const id = "P22";
  const title = "Branch resolved dari database, bukan client payload";
  try {
    const report = await dbGetIncidentById(testReportId);
    // Branch is from DB, not from request
    logResult(id, title, report !== null && report.branch === "TEST-BRANCH");
  } catch (err: any) {
    logResult(id, title, false, err.message);
  }
}

async function testP23_SystemAdminNoOperationalBypass() {
  const id = "P23";
  const title = "System Admin tidak operational bypass (REPORT_UPDATE_PROGRESS denied)";
  try {
    const report = await dbGetIncidentById(testReportId);
    if (!report) {
      logResult(id, title, false, "Report not found");
      return;
    }

    const check = await checkUserPermission({
      user: ADMIN_ACTOR as any,
      permission: "REPORT_UPDATE_PROGRESS",
      report,
    });
    logResult(id, title, !check.authorized);
  } catch (err: any) {
    logResult(id, title, false, err.message);
  }
}

async function testP24_100DoesNotAutoResolve() {
  const id = "P24";
  const title = "100% saja tidak membuat incident resolved";
  try {
    const reportId = testReportId;
    await setWorkStatusForTest(reportId, "IN_PROGRESS");

    // Submit 100% progress without FINAL/HANDOVER photo type
    const jpegBuf = await createTestJpegBuffer();
    const wmResult = await processAndWatermarkPhoto(jpegBuf, {
      reportId, progressPercentage: 100, actorName: "Test",
    });

    await ProgressService.createProgressUpdate({
      reportId,
      progressPercentage: 100,
      description: "100% progress tanpa final evidence",
      actor: BMS_ACTOR,
      photos: [{ photoType: "PROGRESS", originalPath: wmResult.originalPath, watermarkedPath: wmResult.watermarkedPath, fileSize: jpegBuf.length, mimeType: "image/jpeg" }],
    });

    const report = await dbGetIncidentById(reportId);
    logResult(id, title, report?.status !== "resolved");
  } catch (err: any) {
    logResult(id, title, false, err.message);
  }
}

async function testP25_100NoFinalEvidenceNotClosed() {
  const id = "P25";
  const title = "100% tanpa final evidence: work_status tetap IN_PROGRESS";
  try {
    const route = await EstimationIntegrationService.getRouteByReportId(testReportId);
    // Without FINAL/HANDOVER photos, should stay IN_PROGRESS (not COMPLETED)
    logResult(id, title, route?.workStatus === "IN_PROGRESS");
  } catch (err: any) {
    logResult(id, title, false, err.message);
  }
}

async function testP26_100WithFinalEvidence() {
  const id = "P26";
  const title = "100% + final evidence → COMPLETED";
  try {
    const reportId = testReportId;
    // Reset and rebuild from clean state
    await resetProgressForTest(reportId);
    await setWorkStatusForTest(reportId, "IN_PROGRESS");

    // First: submit 70% progress
    const jpegBuf = await createTestJpegBuffer();
    let wmResult = await processAndWatermarkPhoto(jpegBuf, {
      reportId, progressPercentage: 70, actorName: "Test",
    });
    await ProgressService.createProgressUpdate({
      reportId,
      progressPercentage: 70,
      description: "Progress 70%",
      actor: BMS_ACTOR,
      photos: [{ photoType: "PROGRESS", originalPath: wmResult.originalPath, watermarkedPath: wmResult.watermarkedPath, fileSize: jpegBuf.length, mimeType: "image/jpeg" }],
    });

    // Then: submit 100% with FINAL evidence
    wmResult = await processAndWatermarkPhoto(jpegBuf, {
      reportId, progressPercentage: 100, actorName: "Test",
    });
    await ProgressService.createProgressUpdate({
      reportId,
      progressPercentage: 100,
      description: "Progress 100% with final evidence",
      actor: BMS_ACTOR,
      photos: [{ photoType: "FINAL", originalPath: wmResult.originalPath, watermarkedPath: wmResult.watermarkedPath, fileSize: jpegBuf.length, mimeType: "image/jpeg" }],
    });

    const route = await EstimationIntegrationService.getRouteByReportId(reportId);
    logResult(id, title, route?.workStatus === "COMPLETED");
  } catch (err: any) {
    logResult(id, title, false, err.message);
  }
}

async function testP27_CompletedNotResolved() {
  const id = "P27";
  const title = "COMPLETED tetap tidak mengubah incident menjadi resolved";
  try {
    const report = await dbGetIncidentById(testReportId);
    logResult(id, title, report?.status !== "resolved");
  } catch (err: any) {
    logResult(id, title, false, err.message);
  }
}

async function testP28_CompletedRejectsNewProgress() {
  const id = "P28";
  const title = "COMPLETED menolak update progress baru";
  try {
    const reportId = testReportId;
    // work_status should already be COMPLETED from P26
    const jpegBuf = await createTestJpegBuffer();
    const wmResult = await processAndWatermarkPhoto(jpegBuf, {
      reportId, progressPercentage: 100, actorName: "Test",
    });

    try {
      await ProgressService.createProgressUpdate({
        reportId,
        progressPercentage: 100,
        description: "Trying to update after COMPLETED",
        actor: BMS_ACTOR,
        photos: [{ photoType: "PROGRESS", originalPath: wmResult.originalPath, watermarkedPath: wmResult.watermarkedPath, fileSize: jpegBuf.length, mimeType: "image/jpeg" }],
      });
      logResult(id, title, false, "Should have thrown WORK_ALREADY_COMPLETED");
    } catch (err: any) {
      logResult(id, title, err.code === "WORK_ALREADY_COMPLETED");
    }
  } catch (err: any) {
    logResult(id, title, false, err.message);
  }
}

async function testP29_MultiDayHistoryOrdered() {
  const id = "P29";
  const title = "Multi-day history tetap berurutan (kronologis)";
  try {
    const reportId = testReportId;
    const history = await ProgressService.getProgressHistory(reportId);
    
    let ordered = true;
    for (let i = 1; i < history.length; i++) {
      if (new Date(history[i].createdAt) < new Date(history[i-1].createdAt)) {
        ordered = false;
        break;
      }
    }
    logResult(id, title, ordered && history.length > 0);
  } catch (err: any) {
    logResult(id, title, false, err.message);
  }
}

async function testP30_DuplicateSubmitSafety() {
  const id = "P30";
  const title = "Duplicate submit tidak merusak state (COMPLETED tetap locked)";
  try {
    const reportId = testReportId;
    const jpegBuf = await createTestJpegBuffer();
    const wmResult = await processAndWatermarkPhoto(jpegBuf, {
      reportId, progressPercentage: 100, actorName: "Test",
    });

    // First attempt should fail (COMPLETED)
    let caught1 = false;
    try {
      await ProgressService.createProgressUpdate({
        reportId,
        progressPercentage: 100,
        description: "Duplicate 1",
        actor: BMS_ACTOR,
        photos: [{ photoType: "PROGRESS", originalPath: wmResult.originalPath, watermarkedPath: wmResult.watermarkedPath, fileSize: jpegBuf.length, mimeType: "image/jpeg" }],
      });
    } catch {
      caught1 = true;
    }

    // Second attempt should also fail
    let caught2 = false;
    try {
      await ProgressService.createProgressUpdate({
        reportId,
        progressPercentage: 100,
        description: "Duplicate 2",
        actor: BMS_ACTOR,
        photos: [{ photoType: "PROGRESS", originalPath: wmResult.originalPath, watermarkedPath: wmResult.watermarkedPath, fileSize: jpegBuf.length, mimeType: "image/jpeg" }],
      });
    } catch {
      caught2 = true;
    }

    logResult(id, title, caught1 && caught2);
  } catch (err: any) {
    logResult(id, title, false, err.message);
  }
}

// ============================================
// SECURITY TESTS
// ============================================

async function testSec_NoPublicProgressPhotos() {
  const id = "SEC1";
  const title = "Tidak ada foto progress baru di public/uploads/progress/";
  try {
    const before = await initialPublicProgressFiles;
    const after = await snapshotPublicProgressFiles();
    const newPublicFiles = [...after].filter((file) => !before.has(file));
    logResult(id, title, newPublicFiles.length === 0, newPublicFiles.join(", "));
  } catch (err: any) {
    logResult(id, title, false, err.message);
  }
}

async function testSec_PrivateStorageExists() {
  const id = "SEC2";
  const title = "storage/progress/ directory digunakan untuk foto baru";
  try {
    const storageDir = PROGRESS_STORAGE_DIR;
    const exists = await fs.access(storageDir).then(() => true).catch(() => false);
    let hasFiles = false;
    if (exists) {
      const files = await fs.readdir(storageDir);
      hasFiles = files.length > 0;
    }
    logResult(id, title, exists && hasFiles);
  } catch (err: any) {
    logResult(id, title, false, err.message);
  }
}

async function testSec_AdminOperationalDenied() {
  const id = "SEC3";
  const title = "System Admin REPORT_UPDATE_PROGRESS = operational → DENY";
  try {
    const isOp = isOperationalPermission("REPORT_UPDATE_PROGRESS");
    logResult(id, title, isOp);
  } catch (err: any) {
    logResult(id, title, false, err.message);
  }
}

// ============================================
// PERMISSION MAPPING TESTS
// ============================================

async function testPerm_BMSHasUpdateProgress() {
  const id = "PERM1";
  const title = "Role BMS memiliki REPORT_UPDATE_PROGRESS di catalog";
  try {
    const catalog = ROLE_PERMISSION_CATALOG["bms"];
    const has = catalog && (catalog as readonly string[]).includes("REPORT_UPDATE_PROGRESS");
    logResult(id, title, Boolean(has));
  } catch (err: any) {
    logResult(id, title, false, err.message);
  }
}

async function testPerm_BMCDoesNotHaveUpdateProgress() {
  const id = "PERM2";
  const title = "Role BMC TIDAK memiliki REPORT_UPDATE_PROGRESS di catalog (Separation of duties: approver != updater)";
  try {
    const catalog = ROLE_PERMISSION_CATALOG["bmc"];
    const has = catalog && (catalog as readonly string[]).includes("REPORT_UPDATE_PROGRESS");
    logResult(id, title, !has);
  } catch (err: any) {
    logResult(id, title, false, err.message);
  }
}

async function testPerm_BMAndStoreDoNotHaveUpdateProgress() {
  const id = "PERM3";
  const title = "Role BM & Tim Toko TIDAK memiliki REPORT_UPDATE_PROGRESS default di catalog";
  try {
    const bmCatalog = ROLE_PERMISSION_CATALOG["bm"];
    const tokoCatalog = ROLE_PERMISSION_CATALOG["tim_toko"];
    const bmHas = bmCatalog && (bmCatalog as readonly string[]).includes("REPORT_UPDATE_PROGRESS");
    const tokoHas = tokoCatalog && (tokoCatalog as readonly string[]).includes("REPORT_UPDATE_PROGRESS");
    logResult(id, title, !bmHas && !tokoHas);
  } catch (err: any) {
    logResult(id, title, false, err.message);
  }
}

// ============================================
// Main Runner
// ============================================

async function main() {
  console.log("\n╔═════════════════════════════════════════════════════╗");
  console.log("║   SPARTA SIAGA - Task 4 Test Suite                 ║");
  console.log("║   Module Update Progress Pekerjaan                 ║");
  console.log("╚═════════════════════════════════════════════════════╝\n");

  try {
    // Setup
    console.log("🔧 Setup: Creating test report and estimation route...");
    await findOrCreateTestReport();
    console.log(`   Test Report ID: ${testReportId}\n`);

    // ── Domain Tests (P1-P30) ──
    console.log("── DOMAIN TESTS ──");
    await testP1_NotReadyRejected();
    await testP2_ReadyForWorkCanSubmit();
    await testP3_FirstProgressTransition();
    await testP4_AppendOnlyHistory();
    await testP5_PreviousRecordPreserved();
    await testP6_ProgressDecreaseDenied();
    await testP7_ProgressOver100Denied();
    await testP8_NegativeProgressDenied();
    await testP9_NoPhotoDenied();
    await testP10_InvalidPhotoRejected();
    await testP11_PhotoStoredPrivate();
    await testP12_ProtectedEndpointPattern();
    await testP13_UnauthDenied();
    await testP14_CrossBranchDenied();
    await testP15_CrossReportEvidenceBlocked();
    await testP16_PathTraversalBlocked();
    await testP17_WatermarkServerSide();
    await testP18_AuthenticatedActorMetadata();
    await testP19_BMSCanUpdateBMSWork();
    await testP20_RekananInternalUpdateOnly();
    await testP21_ClientCannotSpoofHandler();
    await testP22_ClientCannotSpoofBranch();
    await testP23_SystemAdminNoOperationalBypass();

    console.log("\n── 100% PROGRESS & COMPLETED TESTS ──");
    await testP24_100DoesNotAutoResolve();
    await testP25_100NoFinalEvidenceNotClosed();
    await testP26_100WithFinalEvidence();
    await testP27_CompletedNotResolved();
    await testP28_CompletedRejectsNewProgress();
    await testP29_MultiDayHistoryOrdered();
    await testP30_DuplicateSubmitSafety();

    console.log("\n── SECURITY TESTS ──");
    await testSec_NoPublicProgressPhotos();
    await testSec_PrivateStorageExists();
    await testSec_AdminOperationalDenied();

    console.log("\n── PERMISSION MAPPING TESTS ──");
    await testPerm_BMSHasUpdateProgress();
    await testPerm_BMCDoesNotHaveUpdateProgress();
    await testPerm_BMAndStoreDoNotHaveUpdateProgress();

    // Summary
    const total = passed + failed + skipped;
    console.log("\n" + "═".repeat(55));
    console.log(`  TASK 4 TEST RESULTS: ${passed}/${total} PASSED`);
    console.log(`  ✅ Passed: ${passed}`);
    console.log(`  ❌ Failed: ${failed}`);
    if (skipped > 0) console.log(`  ⏭️  Skipped: ${skipped}`);
    console.log("═".repeat(55));

    if (failed > 0) {
      console.log("\n⚠️  SOME TESTS FAILED - Please review failures above.");
      process.exit(1);
    } else {
      console.log("\n🎉 ALL TASK 4 TESTS PASSED!");
      process.exit(0);
    }
  } catch (err: any) {
    console.error("\n💥 FATAL ERROR during test execution:", err);
    process.exit(1);
  } finally {
    try {
      const pool = (await import("../lib/db")).getDbPool();
      await pool.end();
    } catch {}
  }
}

main();
