# Project Sparta  -  Penyempurnaan SPARTA SIAGA Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Menyelaraskan implementasi existing SPARTA SIAGA dengan empat penyempurnaan utama: integrasi pembaruan data master toko dari Google Sheets & optimalisasi performa Peta Monitoring, pencatatan milestone fleksibel dengan pemisahan progres vs kelengkapan dokumen wajib, penghilangan kalkulasi estimasi di SIAGA dengan mempertahankan dokumentasi milestone Estimasi 25%, penyempurnaan Serah Terima multi-file dengan penolakan BnM beralasan wajib tanpa reset milestone sebelumnya, serta pemisahan tegas Detail Laporan (Read-Only & PDF) dan Update Progress.

**Architecture:** Menggunakan arsitektur Next.js 16 App Router dengan React 19, Tailwind CSS, PostgreSQL via library `pg` (tanpa Prisma), dan Leaflet. Menjaga stabilitas schema database existing dan data operasional dengan menambahkan tabel log sinkronisasi (`store_sync_history`) dan kolom lampiran multi-file pada `report_completion_approvals`. Memisahkan logika evaluasi kelengkapan dokumen dari progres persentase fisik pada `lib/milestone-service.ts`.

**Tech Stack:** Next.js 16.1.7, React 19, TypeScript, PostgreSQL (`pg`), Tailwind CSS, Leaflet / React Leaflet, Playwright, tsx.

## Global Constraints

- **TIDAK MENGGUNAKAN PRISMA:** Proyek secara ketat menggunakan PostgreSQL native melalui pool `pg`. Jangan memasang atau memanggil Prisma ORM.
- **TIDAK MELAKUKAN RESET DATABASE:** Dilarang mereset database, menghapus data laporan, menghapus milestone, atau merusak relasi laporan dengan toko/cabang existing.
- **ZERO RE-REGRESSION:** Fitur kamera langsung, dialog metadata foto, tab navigasi modal, PDF generator, 28 marker DC, penomoran WIB, dan PIC Penanggung Jawab wajib dipertahankan 100%.
- **PERSENTASE 5 MILESTONE TETAP:** Ceklis (10%), Estimasi (25%), Approve Proxy (30%), SPK (50%), Serah Terima (100%).
- **DETAIL LAPORAN READ-ONLY:** Halaman/modal Detail Laporan hanya untuk melihat informasi dan mengunduh PDF. Segala mutasi dokumen dan milestone dilakukan melalui menu Update Progress.
- **ANTISLOP STANDARD:** Mode antislop aktif: `during (session override)`. Desain UI bersih, profesional, mobile-friendly tanpa hamburger menu ganda pada layar dengan bottom navigation.

---

### Task 1: Milestone Flexibility & Document Completeness Tracking

**Files:**
- Modify: `lib/milestone-service.ts`
- Modify: `app/api/incidents/[id]/milestones/route.ts`
- Modify: `components/incident/milestone-progression-card.tsx`
- Test: `scripts/test-flexible-milestones.ts`

**Interfaces:**
- Consumes: `IncidentRecord`, `MilestoneRecord`, `MILESTONE_CONFIG`, `MILESTONE_ORDER` from `@/types/incident`
- Produces: `checkMilestoneCompleteness(reportId: string): Promise<{ isDocumentComplete: boolean; missingDocuments: string[]; progress: number }>`
- Produces: `submitMilestoneFlexible(params: { reportId: string; stageKey: MilestoneKey; fileBuffer: Buffer; originalFilename: string; actor: UserContext; notes?: string })`

- [ ] **Step 1: Write the failing test for flexible milestone progression and document completeness**

Create `scripts/test-flexible-milestones.ts`:
```typescript
import assert from "node:assert";
import { getMilestones, submitMilestoneFlexible, checkMilestoneCompleteness } from "../lib/milestone-service";
import { dbGetIncidentById, dbCreateIncident } from "../lib/incident-db";

async function runTest() {
  console.log("▶ Testing Flexible Milestone Progression...");

  // 1. Create a test incident
  const testReportId = `TEST-FLEX-${Date.now()}`;
  await dbCreateIncident({
    id: testReportId,
    storeId: "SAT-TEST01",
    storeName: "Toko Uji Milestone",
    branch: "TANGERANG",
    status: "in_maintenance",
    progress: 0,
    disasterType: "flood",
    createdAt: new Date().toISOString(),
  } as any);

  const actor = {
    id: "USR-BMS-01",
    name: "Budi BMS",
    role: "bms",
    branch: "TANGERANG",
    systemRole: "USER",
  };

  // 2. Submit APPROVE_PROXY (30%) directly WITHOUT prior 10% (Ceklis) or 25% (Estimasi)
  const dummyBuffer = Buffer.from("%PDF-1.4 Mock Proxy Approval Document Content");
  const result = await submitMilestoneFlexible({
    reportId: testReportId,
    stageKey: "APPROVE_PROXY",
    fileBuffer: dummyBuffer,
    originalFilename: "surat-proxy-30.pdf",
    actor: actor as any,
    notes: "Pekerjaan lapangan telah disetujui proxy",
  });

  // Verify incident progress advances to 30%
  const updatedInc = await dbGetIncidentById(testReportId);
  assert.strictEqual(updatedInc?.progress, 30, "Incident progress must be 30%");

  // Verify document completeness is false because Ceklis and Estimasi are missing
  const completeness = await checkMilestoneCompleteness(testReportId);
  assert.strictEqual(completeness.isDocumentComplete, false, "Document completeness must be false");
  assert.ok(completeness.missingDocuments.some(d => d.includes("10%")), "Must list Ceklis 10% as missing");
  assert.ok(completeness.missingDocuments.some(d => d.includes("25%")), "Must list Estimasi 25% as missing");

  console.log("✔ Test Flexible Milestone passed successfully!");
}

runTest().catch((err) => {
  console.error("❌ Test failed:", err);
  process.exit(1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec tsx scripts/test-flexible-milestones.ts`
Expected: FAIL with `submitMilestoneFlexible is not a function` or sequential check error.

- [ ] **Step 3: Implement flexible milestone submission and completeness checker in `lib/milestone-service.ts`**

Update `lib/milestone-service.ts`:
1. Add `checkMilestoneCompleteness(reportId: string)`:
   - Fetches milestones for report.
   - Evaluates each of the 5 required milestones: `CEKLIS` (10%), `ESTIMASI` (25%), `APPROVE_PROXY` (30%), `SPK` (50%), `SERAH_TERIMA` (100%).
   - Returns `{ isDocumentComplete: boolean, missingDocuments: string[], completedStages: string[], progress: number }`.
2. Add `submitMilestoneFlexible()`:
   - Validates file (PDF/JPEG/PNG).
   - Validates branch & role permissions (BMS for toko, BES for DC, Admin).
   - DOES NOT throw error if previous milestone stages are not yet submitted.
   - Updates target stage status to `SUBMITTED`, saves document, creates revision history.
   - Updates incident `progress` to `Math.max(incident.progress || 0, targetConfig.targetProgress)`.
   - Records actor details (name, role, branch, timestamp).
3. Expose completeness information in `app/api/incidents/[id]/milestones/route.ts` response payload (`completeness: { isDocumentComplete, missingDocuments }`).
4. Update `components/incident/milestone-progression-card.tsx` to:
   - Allow user to pick any milestone stage that needs to be submitted.
   - Display:
     - `Progres Pekerjaan: ${progress}%`
     - `Kelengkapan Dokumen: ${isDocumentComplete ? "Lengkap" : "Belum Lengkap"}`
     - If not complete, display alert box listing missing documents.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec tsx scripts/test-flexible-milestones.ts`
Expected: PASS with 0 errors.

- [ ] **Step 5: Verify types**

Run: `pnpm typecheck`
Expected: 0 errors.

---

### Task 2: Estimasi Feature Adjustment (Remove Calculation UI & Retain 25% Estimation Upload)

**Files:**
- Modify: `components/reports/operational-report-center.tsx`
- Modify: `components/incident/maintenance-tracking-modal.tsx`
- Modify: `lib/milestone-service.ts`
- Test: `scripts/test-estimation-removal.ts`

**Interfaces:**
- Consumes: Milestone stage `ESTIMASI` (25%) from `MILESTONE_CONFIG`
- Produces: UI with NO "Buat Estimasi" or calculation forms, but keeping manual file upload for Milestone Estimasi 25% in Update Progress.

- [ ] **Step 1: Write test to verify estimation calculation removal and 25% milestone upload retention**

Create `scripts/test-estimation-removal.ts`:
```typescript
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { MILESTONE_CONFIG } from "../types/incident";

async function runTest() {
  console.log("▶ Verifying Estimasi UI adjustment and 25% milestone retention...");

  // 1. Verify Milestone Estimasi exists with target progress 25%
  assert.strictEqual(MILESTONE_CONFIG.ESTIMASI.progress, 25, "Estimasi milestone target must be 25%");
  assert.strictEqual(MILESTONE_CONFIG.ESTIMASI.label, "Estimasi", "Estimasi milestone label must be 'Estimasi'");

  // 2. Verify OperationalReportCenter no longer has "Buat Estimasi" button
  const reportCenterPath = path.resolve(process.cwd(), "components/reports/operational-report-center.tsx");
  const reportCenterCode = fs.readFileSync(reportCenterPath, "utf-8");
  assert.ok(!reportCenterCode.includes('setSelectReportPurpose("ESTIMATION")'), "Buat Estimasi button must be removed from OperationalReportCenter");
  assert.ok(!reportCenterCode.includes('>Buat Estimasi<'), "Text 'Buat Estimasi' button must not be present");

  console.log("✔ Estimasi UI verification passed!");
}

runTest().catch((err) => {
  console.error("❌ Test failed:", err);
  process.exit(1);
});
```

- [ ] **Step 2: Run test to verify current state**

Run: `pnpm exec tsx scripts/test-estimation-removal.ts`
Expected: FAIL because `setSelectReportPurpose("ESTIMATION")` is still present in `components/reports/operational-report-center.tsx`.

- [ ] **Step 3: Remove calculation UI & retain 25% estimation milestone upload**

1. In `components/reports/operational-report-center.tsx`:
   - Remove the `canTriggerEstimation && (<button>Buat Estimasi</button>)` block.
   - Clean up `setSelectReportPurpose("ESTIMATION")` and unused estimation trigger states.
2. In `components/incident/maintenance-tracking-modal.tsx`:
   - In Tab 3 (`estimasi`), replace calculation/creation forms with an informative read-only card stating:
     *"Perhitungan dan rincian estimasi biaya dilakukan melalui aplikasi SPARTA terkait. Dokumen hasil estimasi diunggah secara manual pada menu Update Progress (Milestone Estimasi 25%)."*
   - Display uploaded estimation document and status if available.
3. In `lib/milestone-service.ts`:
   - Ensure `checkOperationalProgressGating` does not block progress if external estimation route is pending or manual document is being uploaded.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec tsx scripts/test-estimation-removal.ts`
Expected: PASS.

- [ ] **Step 5: Verify types**

Run: `pnpm typecheck`
Expected: 0 errors.

---

### Task 3: Serah Terima Multi-File Upload & BnM Rejection with Mandatory Reason

**Files:**
- Modify: `lib/completion-approval-service.ts`
- Modify: `app/api/incidents/[id]/completion/submit/route.ts`
- Modify: `app/api/incidents/[id]/completion/reject/route.ts`
- Modify: `app/api/incidents/[id]/completion/approve/route.ts`
- Modify: `components/incident/completion-approval-card.tsx`
- Test: `scripts/test-serah-terima-multi-file-and-rejection.ts`

**Interfaces:**
- Consumes: `report_completion_approvals` table, `checkMilestoneCompleteness`
- Produces: `submitCompletionWithAttachments(params: { reportId: string; actor: UserContext; notes?: string; attachments?: Array<{ url: string; originalName: string; type: string; size: number }> })`
- Produces: `rejectByManager(params: { reportId: string; actor: UserContext; reason: string })` (with mandatory reason validation)

- [ ] **Step 1: Write failing test for Serah Terima multi-file and rejection without resetting milestones**

Create `scripts/test-serah-terima-multi-file-and-rejection.ts`:
```typescript
import assert from "node:assert";
import { CompletionApprovalService } from "../lib/completion-approval-service";
import { submitMilestoneFlexible, getMilestones } from "../lib/milestone-service";
import { dbCreateIncident, dbGetIncidentById } from "../lib/incident-db";

async function runTest() {
  console.log("▶ Testing Serah Terima Multi-File & BnM Rejection...");

  const testReportId = `TEST-ST-${Date.now()}`;
  await dbCreateIncident({
    id: testReportId,
    storeId: "SAT-TEST02",
    storeName: "Toko Uji Serah Terima",
    branch: "JAKARTA",
    status: "in_maintenance",
    progress: 100,
    disasterType: "fire",
    createdAt: new Date().toISOString(),
  } as any);

  // Set all 5 milestones to SUBMITTED
  const actorPic = { id: "USR-BMS-02", name: "Andi BMS", role: "bms", branch: "JAKARTA", systemRole: "USER" };
  for (const stage of ["CEKLIS", "ESTIMASI", "APPROVE_PROXY", "SPK", "SERAH_TERIMA"] as const) {
    await submitMilestoneFlexible({
      reportId: testReportId,
      stageKey: stage,
      fileBuffer: Buffer.from(`%PDF-1.4 Mock document for ${stage}`),
      originalFilename: `${stage.toLowerCase()}.pdf`,
      actor: actorPic as any,
    });
  }

  // 1. Submit completion with multiple attachments
  const attachments = [
    { url: "/uploads/st-doc.pdf", originalName: "BA_Serah_Terima.pdf", type: "application/pdf", size: 1024 },
    { url: "/uploads/foto-hasil-1.jpg", originalName: "foto-hasil-1.jpg", type: "image/jpeg", size: 2048 },
    { url: "/uploads/foto-before-after.jpg", originalName: "foto-before-after.jpg", type: "image/jpeg", size: 2048 },
  ];

  await CompletionApprovalService.submitCompletion({
    reportId: testReportId,
    actor: actorPic as any,
    notes: "Pengajuan Serah Terima lengkap dengan foto sebelum-sesudah",
    attachments,
  });

  const approval = await CompletionApprovalService.getOrCreateApproval(testReportId);
  assert.strictEqual(approval.status, "WAITING_COORDINATOR_APPROVAL", "Status must be WAITING_COORDINATOR_APPROVAL");
  assert.ok(Array.isArray((approval as any).attachments), "Attachments must be an array");
  assert.strictEqual((approval as any).attachments.length, 3, "Must have 3 attachments recorded");

  // 2. Coordinator approves
  const actorCoord = { id: "USR-BMC-01", name: "Citra BMC", role: "bmc", branch: "JAKARTA", systemRole: "USER" };
  await CompletionApprovalService.approveByCoordinator({
    reportId: testReportId,
    actor: actorCoord as any,
    notes: "Pemeriksaan koordinator selesai dan disetujui",
  });

  // 3. Manager rejects WITHOUT reason -> MUST THROW ERROR
  const actorManager = { id: "USR-BM-01", name: "Dedi BM", role: "bm", branch: "JAKARTA", systemRole: "USER" };
  let threwWithoutReason = false;
  try {
    await CompletionApprovalService.rejectByManager({
      reportId: testReportId,
      actor: actorManager as any,
      reason: "   ", // empty
    });
  } catch (err: any) {
    threwWithoutReason = true;
    assert.strictEqual(err.code, "REJECTION_REASON_REQUIRED", "Must have code REJECTION_REASON_REQUIRED");
  }
  assert.ok(threwWithoutReason, "Rejection without reason must fail");

  // 4. Manager rejects WITH reason
  await CompletionApprovalService.rejectByManager({
    reportId: testReportId,
    actor: actorManager as any,
    reason: "Foto hasil perbaikan belum lengkap. Mohon unggah foto terbaru seluruh bagian pekerjaan.",
  });

  // Verify report status is not closed, milestone SERAH_TERIMA is REVISION_REQUESTED, but prior milestones 10%-50% remain intact!
  const milestonesAfterReject = await getMilestones(testReportId);
  const stMilestone = milestonesAfterReject.find(m => m.stageKey === "SERAH_TERIMA");
  assert.strictEqual(stMilestone?.status, "REVISION_REQUESTED", "SERAH_TERIMA milestone must be REVISION_REQUESTED");

  const ceklisMilestone = milestonesAfterReject.find(m => m.stageKey === "CEKLIS");
  assert.strictEqual(ceklisMilestone?.status, "SUBMITTED", "CEKLIS milestone must remain SUBMITTED");

  const spkMilestone = milestonesAfterReject.find(m => m.stageKey === "SPK");
  assert.strictEqual(spkMilestone?.status, "SUBMITTED", "SPK milestone must remain SUBMITTED");

  console.log("✔ Test Serah Terima Multi-File & Rejection passed!");
}

runTest().catch((err) => {
  console.error("❌ Test failed:", err);
  process.exit(1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec tsx scripts/test-serah-terima-multi-file-and-rejection.ts`
Expected: FAIL due to missing `attachments` handling on `report_completion_approvals`.

- [ ] **Step 3: Implement multi-file Serah Terima and rejection enforcement**

1. In `lib/completion-approval-service.ts`:
   - In `ensureCompletionApprovalTables()`: add `ALTER TABLE report_completion_approvals ADD COLUMN IF NOT EXISTS attachments JSONB DEFAULT '[]'::jsonb;`.
   - Update `submitCompletion()`: accept `attachments?: Array<{ url: string; originalName: string; type: string; size: number }>` and persist into `attachments` column.
   - Update `rejectByManager()`: strictly require `reason.trim().length > 0`, otherwise throw error with code `REJECTION_REASON_REQUIRED`. Ensure earlier milestones (`CEKLIS`, `ESTIMASI`, `APPROVE_PROXY`, `SPK`) remain intact; only `SERAH_TERIMA` is marked `REVISION_REQUESTED`.
   - Update `approveByManager()`: verify `checkMilestoneCompleteness(reportId)` is true before allowing case close. If mandatory documents are missing, throw error `MANDATORY_DOCUMENTS_INCOMPLETE`.
2. In `app/api/incidents/[id]/completion/submit/route.ts`:
   - Pass `body.attachments` to `CompletionApprovalService.submitCompletion()`.
3. In `app/api/incidents/[id]/completion/reject/route.ts`:
   - Validate `reason` presence before calling service.
4. In `components/incident/completion-approval-card.tsx`:
   - Support uploading multiple files (Handover doc, after repair photos, before/after photos, supporting docs) with preview list before submission.
   - For BnM Manajer: show clear textarea for mandatory rejection reason when "Tolak Serah Terima" is chosen.
   - Display rejection reason banner and allow resubmission of Serah Terima without resetting prior milestones.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec tsx scripts/test-serah-terima-multi-file-and-rejection.ts`
Expected: PASS.

- [ ] **Step 5: Verify types**

Run: `pnpm typecheck`
Expected: 0 errors.

---

### Task 4: Separation of Read-Only Detail Laporan & Update Progress

**Files:**
- Modify: `components/incident/maintenance-tracking-modal.tsx`
- Modify: `components/incident/progress-update-modal.tsx`
- Modify: `components/reports/operational-report-center.tsx`
- Test: `scripts/test-detail-readonly-separation.ts`

**Interfaces:**
- Consumes: `IncidentRecord`, `MaintenanceTrackingModalProps`
- Produces: Strictly Read-Only Detail Laporan Modal with PDF Download, and Dedicated Update Progress Modal for updating work documentation.

- [ ] **Step 1: Write test for Detail Laporan read-only enforcement**

Create `scripts/test-detail-readonly-separation.ts`:
```typescript
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";

async function runTest() {
  console.log("▶ Verifying Read-Only Detail Laporan and Update Progress separation...");

  const trackingModalPath = path.resolve(process.cwd(), "components/incident/maintenance-tracking-modal.tsx");
  const modalCode = fs.readFileSync(trackingModalPath, "utf-8");

  // Detail Modal must NOT contain mutating buttons:
  // 1. No milestone upload form inside detail modal
  assert.ok(!modalCode.includes('handleMilestoneUpload'), "Detail modal must not have direct milestone upload form");
  // 2. Must contain PDF download button / action
  assert.ok(modalCode.includes('/api/incidents/') && modalCode.includes('/export/pdf'), "Detail modal must have PDF download link/button");

  // 3. Operational Report Center must have separate "Detail" vs "Update Progress"
  const reportCenterPath = path.resolve(process.cwd(), "components/reports/operational-report-center.tsx");
  const centerCode = fs.readFileSync(reportCenterPath, "utf-8");
  assert.ok(centerCode.includes('Update Progress'), "Report Center must retain 'Update Progress' button");

  console.log("✔ Detail Read-Only Separation verified!");
}

runTest().catch((err) => {
  console.error("❌ Test failed:", err);
  process.exit(1);
});
```

- [ ] **Step 2: Run test to verify current state**

Run: `pnpm exec tsx scripts/test-detail-readonly-separation.ts`
Expected: Verify what needs cleanup in `maintenance-tracking-modal.tsx`.

- [ ] **Step 3: Refactor Detail Laporan Modal to be strictly Read-Only with PDF Download**

1. In `components/incident/maintenance-tracking-modal.tsx`:
   - Remove mutating actions:
     - Remove inline target date editor form.
     - Remove inline estimation creation/approval buttons.
     - Remove inline milestone document upload form (delegate to Update Progress).
     - Remove direct completion submission or direct report closing buttons from Detail.
   - Retain complete comprehensive view:
     - Incident information & location (Store / DC).
     - Initial photos & inspection photos (with metadata viewer).
     - BnM initial confirmation decision.
     - Work milestones status list (10% Ceklis, 25% Estimasi, 30% Approve Proxy, 50% SPK, 100% Serah Terima).
     - Work photos & Serah Terima attachments list.
     - Rejection and revision history audit log.
     - Final approval decision.
     - Prominent "Unduh PDF Laporan" button calling `/api/incidents/${incident.id}/export/pdf`.
2. In `components/incident/progress-update-modal.tsx`:
   - Connect flexible milestone selection, document uploading, and Serah Terima submission so that all work documentation updates are managed cleanly here.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec tsx scripts/test-detail-readonly-separation.ts`
Expected: PASS.

- [ ] **Step 5: Verify types**

Run: `pnpm typecheck`
Expected: 0 errors.

---

### Task 5: Google Sheets Store Sync Engine & Peta Monitoring Performance Optimization

**Files:**
- Create: `lib/google-sheets-sync.ts`
- Create: `app/api/stores/sync/route.ts`
- Modify: `app/api/stores/route.ts`
- Modify: `components/map/map-toolbar.tsx`
- Modify: `components/map/map-inner.tsx`
- Test: `scripts/test-google-sheets-sync.ts`

**Interfaces:**
- Consumes: Google Sheets URL `https://docs.google.com/spreadsheets/d/1wvweYqTkS4PA1WKXARRn-vubv7qn6lqISHiSdKSZKcg`, `data/stores-master.csv`
- Produces: `syncStoresFromGoogleSheets(): Promise<SyncResult>`
- Produces: `getLastStoreSyncInfo(): Promise<{ lastSyncAt: string | null; totalStores: number; status: string }>`

- [ ] **Step 1: Write test for Google Sheets sync engine and fallback protection**

Create `scripts/test-google-sheets-sync.ts`:
```typescript
import assert from "node:assert";
import { syncStoresFromGoogleSheets, getLastStoreSyncInfo } from "../lib/google-sheets-sync";

async function runTest() {
  console.log("▶ Testing Google Sheets Store Sync Engine & Fallback...");

  // Run sync routine
  const result = await syncStoresFromGoogleSheets({ dryRun: false });
  console.log("Sync result:", result);

  // Result must be safely defined without crashing
  assert.ok(typeof result.recordsRead === "number", "recordsRead must be a number");
  assert.ok(typeof result.recordsAdded === "number", "recordsAdded must be a number");
  assert.ok(typeof result.recordsUpdated === "number", "recordsUpdated must be a number");
  assert.ok(typeof result.recordsSkipped === "number", "recordsSkipped must be a number");

  // Verify sync history record
  const syncInfo = await getLastStoreSyncInfo();
  assert.ok(syncInfo !== null, "Sync info must exist in store_sync_history");

  console.log("✔ Google Sheets sync engine test passed!");
}

runTest().catch((err) => {
  console.error("❌ Test failed:", err);
  process.exit(1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec tsx scripts/test-google-sheets-sync.ts`
Expected: FAIL with `Cannot find module '../lib/google-sheets-sync'`.

- [ ] **Step 3: Implement Google Sheets store sync engine & map performance optimization**

1. Create `lib/google-sheets-sync.ts`:
   - Create `store_sync_history` table if not exists:
     `id, sync_source, status, started_at, completed_at, records_read, records_added, records_updated, records_skipped, records_failed, error_message, created_at`.
   - Fetches Google Sheets URL. If protected/private (HTTP 302 login), gracefully records `OFFLINE_SOURCE_PRESERVED` or `FAILED`, retaining last valid data in PostgreSQL `stores` and `stores-master.csv`.
   - When data is read: compares `kode_toko` uniquely. Inserts new stores, updates modified stores (alamat, nama_toko, latitude, longitude, cabang), skips identical stores, NEVER deletes missing stores.
   - Logs start time, completion time, counts (read, added, updated, skipped, failed).
2. Create `app/api/stores/sync/route.ts`:
   - Endpoint `POST /api/stores/sync` for manual or cron/periodic check trigger.
   - Endpoint `GET /api/stores/sync` returning last sync info (`lastSyncAt`, `status`, `counts`).
3. Update `app/api/stores/route.ts`:
   - Include `lastSyncAt` in response metadata.
4. Update `components/map/map-toolbar.tsx` and `components/map/map-inner.tsx`:
   - Display `Data toko terakhir diperbarui: [formatted date & time]` when available.
   - Optimize marker clustering and viewport debouncing to ensure map stays silky smooth on desktop and mobile.
   - Preserve mobile bottom navigation bar; do not introduce a hamburger menu that duplicates bottom navigation.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec tsx scripts/test-google-sheets-sync.ts`
Expected: PASS.

- [ ] **Step 5: Verify types**

Run: `pnpm typecheck`
Expected: 0 errors.

---

### Task 6: Comprehensive Verification & Regression Suite

**Files:**
- Modify: `scripts/validate-all-sparta-siaga-refinements.ts`
- Test: All automated unit & integration scripts + Playwright verification

**Interfaces:**
- Verifies: All 4 major user requirements, 100% backward compatibility, zero TypeScript errors.

- [ ] **Step 1: Create and run comprehensive regression verification script**

Create `scripts/validate-all-sparta-siaga-refinements.ts`:
- Validates 5 milestones and percentages (10%, 25%, 30%, 50%, 100%).
- Validates flexible progression without forced sequential blocking.
- Validates document completeness tracking (Progres: X% vs Kelengkapan: Belum Lengkap).
- Validates removal of estimation calculation in SIAGA and retention of 25% milestone upload.
- Validates Serah Terima multi-file attachments and mandatory rejection reason.
- Validates Detail Laporan strictly read-only with PDF download.
- Validates Google Sheets sync logging and fallback.
- Validates HO cross-branch read-only scope.

- [ ] **Step 2: Run verification script**

Run: `pnpm exec tsx scripts/validate-all-sparta-siaga-refinements.ts`
Expected: All test assertions PASS.

- [ ] **Step 3: Run full typecheck and build check**

Run: `pnpm typecheck`
Expected: 0 errors.

- [ ] **Step 4: Capture visual QA screenshots**

Capture screenshots of:
1. Peta Monitoring with store sync timestamp and clean mobile bottom navigation.
2. Update Progress with flexible milestone selection & document completeness status.
3. Serah Terima multi-file upload & BnM rejection reason dialogue.
4. Detail Laporan in strictly read-only mode with PDF download button.

- [ ] **Step 5: Prepare final report**

Draft comprehensive Indonesian report matching Sections A through J in Section 13 of the user specification.
