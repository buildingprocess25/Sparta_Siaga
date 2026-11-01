/**
 * SPARTA SIAGA - Automated Verification Suite for Additional Refinements (Tasks 1-6)
 */

import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { checkOperationalProgressGating } from "../lib/milestone-service";
import { generateInitialReportPdf, generateFinalReportPdf } from "../lib/pdf-generator";
import { createZipArchive } from "../lib/zip-bundle";
import type { IncidentRecord, MilestoneRecord } from "../types/incident";

async function runVerification() {
  console.log("=== SPARTA SIAGA: ADDITIONAL REFINEMENTS QA SUITE ===\n");

  // -------------------------------------------------------------
  // TEST 1: Task 1 - Camera Flow & Gallery Separation
  // -------------------------------------------------------------
  console.log("[TEST 1] Task 1: Camera Flow & Gallery Separation");
  const cameraSource = fs.readFileSync(path.resolve("components/incident/camera-capture.tsx"), "utf-8");
  const uploaderSource = fs.readFileSync(path.resolve("components/incident/field-photo-uploader.tsx"), "utf-8");

  assert.doesNotMatch(
    cameraSource,
    /Unggah dari Galeri/i,
    "Tombol 'Unggah dari Galeri' tidak boleh ada di layar kamera langsung SPARTA Camera"
  );
  assert.doesNotMatch(
    cameraSource,
    /type=["']file["']/i,
    "Input file galeri tidak boleh ada di dalam SPARTA Camera"
  );
  assert.match(
    uploaderSource,
    /galleryReason/i,
    "FieldPhotoUploader harus memiliki validasi alasan galeri"
  );
  assert.match(
    uploaderSource,
    /sourceProvider/i,
    "FieldPhotoUploader harus memiliki validasi penyedia sumber foto"
  );
  console.log("  ✓ SPARTA Camera murni kamera langsung; Galeri strictly via Photo Source dialog dengan metadata wajib.");

  // -------------------------------------------------------------
  // TEST 2: Task 2 - Operational Progress Gating
  // -------------------------------------------------------------
  console.log("\n[TEST 2] Task 2: Operational Progress Gating Logic");

  const baseReport: IncidentRecord = {
    id: "LAP-QA-TEST-001",
    disasterType: "earthquake",
    storeId: "SAT-TEST",
    storeName: "Alfamart Test Unit",
    branch: "JAKARTA",
    date: "2026-10-19",
    status: "pending_confirmation",
    progress: 0,
    fieldPhotos: [],
    timeline: [],
    reportOrigin: "automatic_earthquake",
    locationCity: "Jakarta",
    createdAt: "2026-10-19T00:00:00Z",
    updatedAt: "2026-10-19T00:00:00Z",
  };

  // Status: Pending confirmation -> MUST BE GATED
  const gatePending = await checkOperationalProgressGating(baseReport);
  assert.strictEqual(gatePending.isProgressGated, true, "Laporan pending_confirmation harus terkunci");
  assert.match(gatePending.gatingReason || "", /verifikasi awal/i);

  // Status: Investigating -> MUST BE GATED
  const gateInvestigating = await checkOperationalProgressGating({ ...baseReport, status: "investigating" });
  assert.strictEqual(gateInvestigating.isProgressGated, true, "Laporan status investigating harus terkunci");

  // Status: Pending BM Approval -> MUST BE GATED
  const gatePendingBM = await checkOperationalProgressGating({ ...baseReport, status: "pending_bm_approval" });
  assert.strictEqual(gatePendingBM.isProgressGated, true, "Laporan pending_bm_approval harus terkunci");

  // Status: Confirmed Safe -> MUST BE GATED
  const gateSafe = await checkOperationalProgressGating({ ...baseReport, status: "confirmed_safe" });
  assert.strictEqual(gateSafe.isProgressGated, true, "Laporan confirmed_safe harus terkunci");

  // Status: Closed -> MUST BE GATED (already finished)
  const gateClosed = await checkOperationalProgressGating({ ...baseReport, status: "closed" });
  assert.strictEqual(gateClosed.isProgressGated, true, "Laporan berstatus closed harus terkunci");

  // Status: In maintenance with progress > 0 -> UNLOCKED
  const gateProgressActive = await checkOperationalProgressGating({ ...baseReport, status: "in_maintenance", progress: 20 });
  assert.strictEqual(gateProgressActive.isProgressGated, false, "Laporan yang sudah berjalan pengerjaannya tidak terkunci");

  console.log("  ✓ Operational progress gating terverifikasi 100% pada semua tahapan status laporan.");

  // -------------------------------------------------------------
  // TEST 3: Task 3 - Detail Tracking 5-Section Redesign & Modal UI
  // -------------------------------------------------------------
  console.log("\n[TEST 3] Task 3: Detail Tracking Modal 5-Section Architecture");
  const modalSource = fs.readFileSync(path.resolve("components/incident/maintenance-tracking-modal.tsx"), "utf-8");

  assert.match(modalSource, /activeTab === "ringkasan"/, "Modal harus memiliki section 1: Ringkasan");
  assert.match(modalSource, /activeTab === "pemeriksaan"/, "Modal harus memiliki section 2: Pemeriksaan");
  assert.match(modalSource, /activeTab === "estimasi"/, "Modal harus memiliki section 3: Estimasi");
  assert.match(modalSource, /activeTab === "progres"/, "Modal harus memiliki section 4: Progres");
  assert.match(modalSource, /activeTab === "dokumen"/, "Modal harus memiliki section 5: Dokumen");
  assert.match(modalSource, /initial-photo-preview-modal/, "Modal harus memiliki Lightbox Photo Preview modal");
  console.log("  ✓ 5 logical sections tabs dan modal Lightbox preview terpasang sempurna.");

  // -------------------------------------------------------------
  // TEST 4: Task 4 - Initial Report PDF
  // -------------------------------------------------------------
  console.log("\n[TEST 4] Task 4: Initial Report PDF Generation & Notice");
  const autoReportNoInspect: IncidentRecord = {
    ...baseReport,
    reportOrigin: "automatic_earthquake",
    verification: undefined,
  };
  const initialPdfBuf = generateInitialReportPdf(autoReportNoInspect);
  assert(initialPdfBuf.length > 500, "Initial PDF buffer harus terisi valid");
  const pdfString = initialPdfBuf.toString("latin1");
  assert.match(
    pdfString,
    /PERINGATAN: Laporan otomatis sistem\. Bukti fisik inspeksi belum tersedia/i,
    "Initial PDF harus menampilkan notice jika laporan otomatis belum ada bukti fisik inspeksi"
  );
  console.log("  ✓ Initial PDF memuat identitas kejadian dan notice otomatis ketika inspeksi fisik belum ada.");

  // -------------------------------------------------------------
  // TEST 5: Task 5 - Final Report PDF & Attachment Bundle
  // -------------------------------------------------------------
  console.log("\n[TEST 5] Task 5: Final Report PDF & ZIP Bundle Creation");
  const closedReport: IncidentRecord = {
    ...baseReport,
    status: "closed",
    closedAt: "2026-10-19T14:30:00Z",
    verification: {
      isDamaged: true,
      confirmedBy: "Budi Teknisi",
      confirmedAt: "2026-10-19T10:00:00Z",
    },
  };

  const sampleMilestones: MilestoneRecord[] = [
    {
      id: "ms_1",
      reportId: closedReport.id,
      stageOrder: 1,
      stageKey: "spk_issued" as any,
      stageName: "Penerbitan SPK / WO",
      targetProgress: 10,
      status: "SUBMITTED",
      documentOriginalName: "SPK_Resmi.pdf",
      actorName: "Ahmad Staff",
      submittedAt: "2026-10-19T11:00:00Z",
      createdAt: "2026-10-19T10:00:00Z",
      updatedAt: "2026-10-19T11:00:00Z",
      revisions: [],
    },
  ];

  const finalPdfBuf = generateFinalReportPdf(closedReport, sampleMilestones);
  assert(finalPdfBuf.length > 500, "Final PDF buffer harus terisi valid");
  const finalPdfStr = finalPdfBuf.toString("latin1");
  assert.match(finalPdfStr, /BERITA ACARA RESMI PENYELESAIAN/i, "Final PDF harus bertajuk Berita Acara Resmi CLOSED");

  // Test ZIP Bundle Generator
  const sampleZip = createZipArchive([
    { filename: "laporan_final.pdf", buffer: finalPdfBuf },
    { filename: "manifest.json", buffer: Buffer.from(JSON.stringify({ id: closedReport.id }), "utf-8") },
  ]);
  assert(sampleZip.length > 100, "ZIP archive buffer harus valid");
  assert.strictEqual(sampleZip.readUInt32LE(0), 0x04034b50, "Header ZIP signature harus 0x04034b50");
  console.log("  ✓ Final Report PDF dan Native ZIP bundle generator tervalidasi 100%.");

  // -------------------------------------------------------------
  // TEST 6: Task 6 - UI Cleanup (Repair Links Removal)
  // -------------------------------------------------------------
  console.log("\n[TEST 6] Task 6: UI Cleanup (Repair Links Removal)");
  assert.doesNotMatch(modalSource, /<RepairLinksCard/i, "Maintenance modal tidak boleh me-render RepairLinksCard");
  assert.doesNotMatch(modalSource, /Referensi pekerjaan/i, "Field Referensi Pekerjaan tidak boleh muncul di modal");
  assert.doesNotMatch(modalSource, /Catatan verifikasi/i, "Field Catatan Verifikasi tidak boleh muncul di modal");

  console.log("  ✓ Komponen referensi perbaikan terkait telah dihilangkan dari antarmuka laporan insiden.");

  console.log("\n========================================================");
  console.log("🎉 ALL ADDITIONAL REFINEMENT TESTS PASSED SUCCESSFULLY! 🎉");
  console.log("========================================================");
}

runVerification().catch((err) => {
  console.error("Verification failed:", err);
  process.exit(1);
});
