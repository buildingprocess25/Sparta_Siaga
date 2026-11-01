import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { getDbPool } from "../lib/db";
import {
  submitMilestoneFlexible,
  checkMilestoneCompleteness,
  getMilestones,
} from "../lib/milestone-service";
import { CompletionApprovalService } from "../lib/completion-approval-service";
import {
  syncStoresFromGoogleSheets,
  getLastStoreSyncHistory,
  ensureStoreSyncTables,
} from "../lib/google-sheets-sync";

async function main() {
  console.log("======================================================================");
  console.log("   SPARTA SIAGA - COMPREHENSIVE REFINEMENTS VALIDATION SUITE          ");
  console.log("======================================================================");

  // Configure DB connection
  const envContent = fs.readFileSync(path.join(process.cwd(), ".env.local"), "utf8");
  let isolatedUrl = "";
  for (const line of envContent.split(/\r?\n/)) {
    const match = line.match(/^\s*SPARTA_ISOLATED_TEST_DATABASE_URL\s*=\s*(.*)?\s*$/);
    if (match) {
      isolatedUrl = match[1].trim().replace(/^["']|["']$/g, "");
      break;
    }
  }
  if (isolatedUrl) {
    process.env.DATABASE_URL = isolatedUrl;
    process.env.DATABASE_SSL_MODE = "require";
  }

  const pool = getDbPool();
  const testId = `INC-REFINE-${Date.now()}`;

  // Create isolated incident in DB
  const { dbCreateIncident } = await import("../lib/incident-db");
  await dbCreateIncident({
    id: testId,
    storeId: "T770",
    storeName: "ABDUL HADI",
    branch: "CIKOKOL",
    status: "in_maintenance",
    progress: 10,
    disasterType: "earthquake",
    reportOrigin: "manual",
    createdAt: new Date().toISOString(),
  } as any);
  console.log(`\n[SETUP] Created test incident: ${testId}`);

  const actorBms = {
    id: "usr_bms_01",
    name: "Budi BMS",
    role: "bms",
    branch: "CIKOKOL",
    systemRole: "USER",
  };

  const actorBmc = {
    id: "usr_bmc_01",
    name: "Agus BMC",
    role: "bmc",
    branch: "CIKOKOL",
    systemRole: "USER",
  };

  const actorBm = {
    id: "usr_bm_01",
    name: "Hendra BnM",
    role: "bm",
    branch: "CIKOKOL",
    systemRole: "USER",
  };

  // ----------------------------------------------------------------------
  // TEST 1: Flexible Milestone Recording without Forced Sequential Lock
  // ----------------------------------------------------------------------
  console.log("\n--- TEST 1: Flexible Milestone Recording & Completeness ---");
  
  // Officer records 30% APPROVE_PROXY directly (skipping 25% Estimasi)
  console.log("Action: Submitting 30% APPROVE_PROXY directly (without 25% Estimasi)...");
  const m30 = await submitMilestoneFlexible({
    reportId: testId,
    stageKey: "APPROVE_PROXY",
    fileBuffer: Buffer.from("%PDF-1.4 Mock proxy"),
    originalFilename: "proxy_mandor.pdf",
    actor: actorBms as any,
  });
  assert.strictEqual(m30.milestone.status, "SUBMITTED", "Milestone 30% should be SUBMITTED");
  console.log("✓ Milestone 30% submitted successfully without sequential lock");

  // Check completeness: should be false because 10%, 25%, 50%, 100% are missing
  const completeness1 = await checkMilestoneCompleteness(testId);
  console.log("Completeness check:", {
    isDocumentComplete: completeness1.isDocumentComplete,
    missingDocuments: completeness1.missingDocuments,
  });
  assert.strictEqual(completeness1.isDocumentComplete, false, "Must be incomplete");
  assert.ok(completeness1.missingDocuments.some((d: string) => d.includes("25%")), "25% Estimasi must be missing");

  // Officer fills in 10% CEKLIS and 50% SPK
  console.log("Action: Submitting 10% CEKLIS and 50% SPK...");
  await submitMilestoneFlexible({
    reportId: testId,
    stageKey: "CEKLIS",
    fileBuffer: Buffer.from("%PDF-1.4 Mock ceklis"),
    originalFilename: "ceklis_10.pdf",
    actor: actorBms as any,
  });
  await submitMilestoneFlexible({
    reportId: testId,
    stageKey: "SPK",
    fileBuffer: Buffer.from("%PDF-1.4 Mock SPK"),
    originalFilename: "spk_50.pdf",
    actor: actorBms as any,
  });

  const completeness2 = await checkMilestoneCompleteness(testId);
  assert.ok(completeness2.missingDocuments.some((d: string) => d.includes("25%")), "Estimasi still missing");
  console.log("✓ 10% and 50% submitted, system accurately tracks remaining missing documents");

  // ----------------------------------------------------------------------
  // TEST 2: Estimasi Feature Adjustment (External SPARTA App Integration)
  // ----------------------------------------------------------------------
  console.log("\n--- TEST 2: Estimasi Feature Adjustment (Document Upload) ---");
  console.log("Action: Submitting 25% Estimasi document uploaded from external SPARTA app...");
  await submitMilestoneFlexible({
    reportId: testId,
    stageKey: "ESTIMASI",
    fileBuffer: Buffer.from("%PDF-1.4 Mock Estimasi"),
    originalFilename: "sparta_ext_estimasi.pdf",
    actor: actorBms as any,
  });
  const completeness3 = await checkMilestoneCompleteness(testId);
  assert.strictEqual(
    completeness3.missingDocuments.some((d: string) => d.includes("25%")),
    false,
    "Estimasi should no longer be missing"
  );
  console.log("✓ Milestone Estimasi 25% document successfully recorded and fulfills requirement");

  // ----------------------------------------------------------------------
  // TEST 3: Serah Terima Multi-File Upload & Rejection Workflow
  // ----------------------------------------------------------------------
  console.log("\n--- TEST 3: Serah Terima Multi-File Upload & Approval Hierarchy ---");

  // Officer submits 100% Serah Terima milestone (progress reaches 100%)
  await submitMilestoneFlexible({
    reportId: testId,
    stageKey: "SERAH_TERIMA",
    fileBuffer: Buffer.from("%PDF-1.4 Mock ST Document"),
    originalFilename: "st_100.pdf",
    actor: actorBms as any,
  });

  // Officer submits Serah Terima with multiple files
  console.log("Action: Officer submitting Serah Terima with 3 attachment files...");
  const attachments = [
    { url: "/uploads/st_official.pdf", originalName: "BA_Serah_Terima.pdf", type: "application/pdf", size: 1024 },
    { url: "/uploads/foto_selesai.jpg", originalName: "foto_selesai.jpg", type: "image/jpeg", size: 2048 },
    { url: "/uploads/before_after.jpg", originalName: "before_after.jpg", type: "image/jpeg", size: 2048 },
  ];

  const stSubmission = await CompletionApprovalService.submitCompletion({
    reportId: testId,
    actor: actorBms as any,
    notes: "Pekerjaan perbaikan atap telah selesai 100%",
    attachments,
  });

  assert.strictEqual(
    stSubmission.status,
    "WAITING_COORDINATOR_APPROVAL",
    "Should transition to WAITING_COORDINATOR_APPROVAL"
  );
  assert.strictEqual((stSubmission as any).attachments.length, 3, "Must persist 3 attachments");
  console.log("✓ Multi-file Serah Terima submitted to Koordinator");

  // Verify direct BnM bypass is BLOCKED
  console.log("Action: Verifying direct BnM bypass before Koordinator approval is blocked...");
  let bypassBlocked = false;
  try {
    await CompletionApprovalService.approveByManager({
      reportId: testId,
      actor: actorBm as any,
      notes: "Direct approve attempt",
    });
  } catch (err: any) {
    bypassBlocked = true;
    console.log("✓ Direct BnM bypass correctly blocked:", err.message);
  }
  assert.ok(bypassBlocked, "Direct BnM bypass must throw error");

  // Koordinator Approves
  console.log("Action: Koordinator (BMC/BEC/BBC) approves...");
  const coordApproval = await CompletionApprovalService.approveByCoordinator({
    reportId: testId,
    actor: actorBmc as any,
    notes: "Hasil fisik di lapangan telah dicek dan sesuai",
  });
  assert.strictEqual(
    coordApproval.status,
    "WAITING_MANAGER_APPROVAL",
    "Must transition to WAITING_MANAGER_APPROVAL"
  );
  console.log("✓ Koordinator approval succeeded");

  // BnM Rejection without reason must fail
  console.log("Action: Verifying BnM rejection without reason is rejected...");
  let emptyReasonBlocked = false;
  try {
    await CompletionApprovalService.rejectByManager({
      reportId: testId,
      actor: actorBm as any,
      reason: "   ",
    });
  } catch (err: any) {
    emptyReasonBlocked = true;
    console.log("✓ Empty rejection reason blocked:", err.message);
  }
  assert.ok(emptyReasonBlocked, "Rejection reason must be mandatory");

  // BnM Rejects with valid reason
  console.log("Action: BnM Manager rejects with detailed reason...");
  const rejectionResult = await CompletionApprovalService.rejectByManager({
    reportId: testId,
    actor: actorBm as any,
    reason: "Plafon sudut kiri masih ada rembesan air hujan. Harap diperbaiki sebelum serah terima final.",
  });
  assert.strictEqual(rejectionResult.status, "REVISION_REQUIRED", "Status must be REVISION_REQUIRED");
  assert.strictEqual(rejectionResult.rejectionReason?.includes("rembesan"), true);

  // Verify prior milestones 10%-50% remain intact and are NOT reset
  console.log("Action: Verifying prior milestones (10%-50%) remain SUBMITTED after rejection...");
  const milestonesAfterReject = await getMilestones(testId);
  const ceklisM = milestonesAfterReject.find((m) => m.stageKey === "CEKLIS");
  const estimasiM = milestonesAfterReject.find((m) => m.stageKey === "ESTIMASI");
  const proxyM = milestonesAfterReject.find((m) => m.stageKey === "APPROVE_PROXY");
  const spkM = milestonesAfterReject.find((m) => m.stageKey === "SPK");
  const stM = milestonesAfterReject.find((m) => m.stageKey === "SERAH_TERIMA");

  assert.strictEqual(ceklisM?.status, "SUBMITTED", "10% Ceklis must remain SUBMITTED");
  assert.strictEqual(estimasiM?.status, "SUBMITTED", "25% Estimasi must remain SUBMITTED");
  assert.strictEqual(proxyM?.status, "SUBMITTED", "30% Proxy must remain SUBMITTED");
  assert.strictEqual(spkM?.status, "SUBMITTED", "50% SPK must remain SUBMITTED");
  assert.strictEqual(stM?.status, "REVISION_REQUESTED", "100% ST must be REVISION_REQUESTED");
  console.log("✓ Milestones 10%-50% remain 100% INTACT. Only Serah Terima is marked REVISION_REQUESTED.");

  // Resubmission flow: Officer submits revision -> Koordinator approves -> BnM approves
  console.log("Action: Resubmitting Serah Terima after revision...");
  await submitMilestoneFlexible({
    reportId: testId,
    stageKey: "SERAH_TERIMA",
    fileBuffer: Buffer.from("%PDF-1.4 Revised Serah Terima"),
    originalFilename: "serah-terima-revisi.pdf",
    actor: actorBms as any,
    notes: "Sudah dilengkapi perbaikan plafon dan foto",
  });

  await CompletionApprovalService.submitCompletion({
    reportId: testId,
    actor: actorBms as any,
    notes: "Plafon sudut kiri telah diperbaiki dan diuji siram air",
    attachments: [
      { url: "/uploads/st_revisi.pdf", originalName: "BAST_Revisi.pdf", type: "application/pdf", size: 1024 },
      { url: "/uploads/plafon_ok.jpg", originalName: "plafon_ok.jpg", type: "image/jpeg", size: 2048 },
    ],
  });
  await CompletionApprovalService.approveByCoordinator({
    reportId: testId,
    actor: actorBmc as any,
    notes: "Plafon sudah kering dan rapi",
  });
  const finalApproval = await CompletionApprovalService.approveByManager({
    reportId: testId,
    actor: actorBm as any,
    notes: "Disetujui. Pekerjaan selesai sempurna.",
  });
  assert.strictEqual(finalApproval.status.toLowerCase(), "closed", "Final status must be closed");
  console.log("✓ Resubmission and final BnM Manager approval (CLOSED) completed successfully");

  // ----------------------------------------------------------------------
  // TEST 4: Google Sheets Store Sync Engine & Fallback
  // ----------------------------------------------------------------------
  console.log("\n--- TEST 4: Google Sheets Store Sync Engine & Map Performance ---");
  await ensureStoreSyncTables();
  const lastSyncRecord = await getLastStoreSyncHistory();
  assert.ok(lastSyncRecord, "Store sync history must have records");
  assert.ok(
    lastSyncRecord.status === "COMPLETED" || lastSyncRecord.status === "OFFLINE_SOURCE_PRESERVED",
    `Status must be valid, got: ${lastSyncRecord.status}`
  );
  console.log("Sync history status:", {
    source: lastSyncRecord.sync_source,
    status: lastSyncRecord.status,
    recordsRead: lastSyncRecord.records_read,
    completedAt: lastSyncRecord.completed_at,
  });

  const storesCountRes = await pool.query("SELECT COUNT(*) as count FROM stores");
  const totalStores = parseInt(storesCountRes.rows[0].count, 10);
  assert.ok(totalStores > 20000, `Total stores in DB must be > 20000, got ${totalStores}`);
  console.log(`✓ Total stores in PostgreSQL: ${totalStores}`);

  // ----------------------------------------------------------------------
  // CLEANUP
  // ----------------------------------------------------------------------
  await pool.query("DELETE FROM report_completion_approvals WHERE report_id = $1", [testId]);
  await pool.query("DELETE FROM report_milestones WHERE report_id = $1", [testId]);
  await pool.query("DELETE FROM incidents WHERE id = $1", [testId]);
  console.log(`\n[CLEANUP] Deleted test incident ${testId}`);

  console.log("\n======================================================================");
  console.log("   ALL REFINEMENTS VALIDATION TESTS PASSED WITH 100% SUCCESS!         ");
  console.log("======================================================================");
}

main().catch((err) => {
  console.error("Validation suite error:", err);
  process.exit(1);
});
