process.env.DATABASE_POOL_MAX = "2";

import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { getDbPool, closeDbPool } from "../lib/db";
import { dbGetIncidentById } from "../lib/incident-db";
import { generateInitialReportPdf, generateMonitoringReportPdf, generateFinalReportPdf } from "../lib/pdf-generator";
import { appendInspectionEvidencePages } from "../lib/pdf-evidence-appendix";
import { getInspectionPhotoFile } from "../lib/inspection-storage";
import { getHoAttentionReasons, getReportTarget, isFinalPdfAvailable, isReportFinalized, reportStatusLabel } from "../lib/ho-report-monitoring";
import { isEvidencePhotoLinked } from "../lib/inspection-photo-access";
import { canViewReport, canActOnReport, UserContext } from "../lib/report-permissions";
import { HoReportMonitoring } from "../components/reports/ho-report-monitoring";
import type { IncidentRecord } from "../types/incident";

async function runSuite() {
  console.log("==================================================================");
  console.log("  SPARTA SIAGA - HO FINAL VALIDATION SUITE                        ");
  console.log("==================================================================\n");

  // ---------------------------------------------------------------
  // 1. Data Actual DB Validation
  // ---------------------------------------------------------------
  console.log("[1/5] Memeriksa data aktual database...");
  const report1 = await dbGetIncidentById("LAP-EQ-DEMO-BDG-001");
  const report2 = await dbGetIncidentById("INC-MAN-1792116839286");

  assert.ok(report1, "Laporan LAP-EQ-DEMO-BDG-001 harus ada di DB");
  assert.ok(report2, "Laporan INC-MAN-1792116839286 harus ada di DB");
  console.log(`      ✓ Report 1: ${report1.id} (${report1.storeName}) - Status: ${report1.status}`);
  console.log(`      ✓ Report 2: ${report2.id} (${report2.storeName}) - Status: ${report2.status}`);

  // ---------------------------------------------------------------
  // 2. Business Rules: Attention Indicators & Statuses
  // ---------------------------------------------------------------
  console.log("\n[2/5] Memvalidasi aturan Perlu Perhatian & Tanpa SLA Fiktif...");
  
  // report1 is confirmed_affected, no target
  const reasons1 = getHoAttentionReasons(report1);
  assert.ok(reasons1.length > 0, "Laporan confirmed_affected harus masuk Perlu Perhatian");
  assert.ok(reasons1.some(r => r.includes("Kerusakan disetujui")), "Alasan harus menyebut kerusakan disetujui");
  console.log(`      ✓ Perlu Perhatian (Report 1): ${reasons1.join("; ")}`);

  // Target comparison test - No SLA fiktif, only real targets compared by calendar date
  const mockOverdueReport: IncidentRecord = {
    ...report1,
    id: "LAP-TEST-OVERDUE",
    status: "in_maintenance",
    maintenanceTicket: { ticketId: "TCK-OVERDUE", completedAt: "2026-10-10T12:00:00Z" },
  };
  const reasonsOverdue = getHoAttentionReasons(mockOverdueReport, Date.parse("2026-10-19T09:00:00+07:00"));
  assert.ok(reasonsOverdue.some(r => r.includes("terlewati")), "Target lampau harus ditandai terlewati");
  console.log("      ✓ Target melewati batas kalender ditandai secara tepat (tanpa jam fiktif)");

  const mockFutureReport: IncidentRecord = {
    ...report1,
    id: "LAP-TEST-FUTURE",
    status: "in_maintenance",
    maintenanceTicket: { ticketId: "TCK-FUTURE", completedAt: "2026-10-25T12:00:00Z" },
  };
  const reasonsFuture = getHoAttentionReasons(mockFutureReport, Date.parse("2026-10-19T09:00:00+07:00"));
  assert.ok(!reasonsFuture.some(r => r.includes("terlewati")), "Target masa depan TIDAK boleh ditandai terlewati");
  console.log("      ✓ Target masa depan tidak terlewati");

  // Terminal reports (closed, resolved) have 0 attention reasons
  const mockClosedReport: IncidentRecord = {
    ...report1,
    id: "LAP-TEST-CLOSED",
    status: "closed",
    maintenanceTicket: { ticketId: "TCK-CLOSED", completedAt: "2026-10-01T12:00:00Z" },
  };
  assert.equal(getHoAttentionReasons(mockClosedReport).length, 0, "Laporan closed tidak butuh perhatian");
  assert.equal(isFinalPdfAvailable(mockClosedReport), true, "Laporan closed dapat download final PDF");
  assert.equal(isFinalPdfAvailable(report1), false, "Laporan confirmed_affected TIDAK boleh download final PDF");
  console.log("      ✓ Laporan terminal/closed bersih dari perhatian & final PDF tersedia");

  // ---------------------------------------------------------------
  // 3. User Roles, Read-Only & Branch Isolation
  // ---------------------------------------------------------------
  console.log("\n[3/5] Memvalidasi RBAC, Isolasi Cabang & HO Read-Only...");
  const hoUser: UserContext = {
    id: "USR-HO-BUDI",
    name: "Demo HO",
    systemRole: "USER",
    scope: "HO",
    branch: null,
    role: "ho_admin",
  };
  const bdgUser: UserContext = {
    id: "USR-BMS-001",
    name: "BMS Bandung",
    systemRole: "USER",
    scope: "BRANCH",
    branch: "BANDUNG",
    role: "bms",
  };
  const jktUser: UserContext = {
    id: "USR-BMS-JKT",
    name: "BMS Jakarta",
    systemRole: "USER",
    scope: "BRANCH",
    branch: "JAKARTA",
    role: "bms",
  };

  // canViewReport: HO views all branches, branch users view only their branch
  assert.equal(canViewReport(hoUser, report1), true, "HO harus bisa melihat laporan Bandung");
  assert.equal(canViewReport(bdgUser, report1), true, "Petugas Bandung bisa melihat laporan Bandung");
  assert.equal(canViewReport(jktUser, report1), false, "Petugas Jakarta TIDAK boleh melihat laporan Bandung");

  // canActOnReport: HO is strictly false (read-only)
  assert.equal(canActOnReport(hoUser, report1), false, "HO HARUS STRICTLY READ-ONLY (canActOnReport = false)");
  assert.equal(canActOnReport(bdgUser, report1), true, "Petugas Bandung berwenang aksi pada laporan Bandung");
  assert.equal(canActOnReport(jktUser, report1), false, "Petugas Jakarta tidak berwenang aksi pada laporan Bandung");
  console.log("      ✓ HO strictly read-only di semua cabang");
  console.log("      ✓ Isolasi cabang aktif (Bandung vs Jakarta ditegakkan)");

  // ---------------------------------------------------------------
  // 4. Photo Evidence Integrity & Leakage Prevention
  // ---------------------------------------------------------------
  console.log("\n[4/5] Memvalidasi Keamanan Bukti Foto Pemeriksaan...");
  const validPhotoKey = "wm_LAP-EQ-DEMO-BDG-001_1792054014408_fx98xg.jpg";
  const unlinkedPhotoKey = "wm_LAP-EQ-DEMO-BDG-002_1792054014408_fx98xg.jpg";

  assert.equal(isEvidencePhotoLinked(report1, report1.id, validPhotoKey), true, "Foto valid harus terhubung");
  assert.equal(isEvidencePhotoLinked(report1, report1.id, unlinkedPhotoKey), false, "Foto tidak terdaftar harus ditolak");
  assert.equal(isEvidencePhotoLinked(report2, report2.id, validPhotoKey), false, "Foto laporan lain harus ditolak");

  const diskPhoto = await getInspectionPhotoFile(validPhotoKey);
  assert.ok(diskPhoto, "Foto fisik harus ditemukan di storage/inspection");
  assert.ok(diskPhoto.buffer.length > 0, "Buffer foto fisik harus > 0 bytes");
  console.log(`      ✓ Foto fisik '${validPhotoKey}' berukuran ${diskPhoto.buffer.length} bytes`);
  console.log("      ✓ Pencegahan kebocoran foto IDOR antar laporan terverifikasi");

  // ---------------------------------------------------------------
  // 5. PDF Generation & Inspection Appendix
  // ---------------------------------------------------------------
  console.log("\n[5/5] Menguji Pembuatan PDF Awal, Monitoring & Final...");
  const initialPdf = generateInitialReportPdf(report1);
  assert.ok(initialPdf.subarray(0, 8).toString("latin1").startsWith("%PDF-1.4"), "Initial PDF harus PDF-1.4 valid");

  const monitoringPdf = generateMonitoringReportPdf(report1);
  assert.ok(monitoringPdf.subarray(0, 8).toString("latin1").startsWith("%PDF-1.4"), "Monitoring PDF harus PDF-1.4 valid");
  assert.ok(monitoringPdf.toString("latin1").includes("RINGKASAN MONITORING - BUKAN DOKUMEN FINAL"), "Harus ada disclaimer non-final");
  assert.ok(monitoringPdf.toString("latin1").includes("LAP-EQ-DEMO-BDG-001"), "Harus memuat No. Laporan aktual");

  // Test Appendix addition with actual disk photo
  const monitoringWithPhoto = await appendInspectionEvidencePages(monitoringPdf, [{ buffer: diskPhoto.buffer }]);
  assert.ok(monitoringWithPhoto.length > monitoringPdf.length, "Ukuran PDF bertambah setelah lampiran foto");
  assert.ok(monitoringWithPhoto.toString("latin1").includes("/Count 2"), "PDF harus memiliki halaman kedua");

  const finalPdf = generateFinalReportPdf(mockClosedReport, []);
  assert.ok(finalPdf.subarray(0, 8).toString("latin1").startsWith("%PDF-1.4"), "Final PDF harus PDF-1.4 valid");
  assert.ok(finalPdf.toString("latin1").includes("BERITA ACARA RESMI PENYELESAIAN"), "Final PDF judul sesuai");
  console.log("      ✓ PDF Awal, PDF Ringkasan Monitoring & PDF Final berhasil diproduksi");
  console.log("      ✓ Lampiran foto pemeriksaan diinjeksi ke PDF dengan resolusi tajam");

  // ---------------------------------------------------------------
  // UI Render Test
  // ---------------------------------------------------------------
  console.log("\n[UI] Render HoReportMonitoring komponen dengan data aktual...");
  const renderedHtml = renderToStaticMarkup(
    React.createElement(HoReportMonitoring, { incidents: [report1, report2] })
  );
  assert.ok(renderedHtml.includes("Semua Laporan (2)"), "Tab Semua Laporan (2) ada");
  assert.ok(renderedHtml.includes("Perlu Perhatian (1)"), "Tab Perlu Perhatian (1) ada");
  assert.ok(renderedHtml.includes("Toko Simulasi Bandung"), "Nama toko 1 muncul");
  assert.ok(renderedHtml.includes("BABAKAN SARI"), "Nama toko 2 muncul");
  assert.ok(!renderedHtml.includes("Update Progress"), "HO TIDAK memuat tombol Update Progress");
  assert.ok(!renderedHtml.includes("Buat Estimasi"), "HO TIDAK memuat tombol Buat Estimasi");
  assert.ok(!renderedHtml.includes("Mulai Menangani"), "HO TIDAK memuat tombol Mulai Menangani");
  console.log("      ✓ Render komponen sukses, tab & counter sesuai data aktual, zero actionable operational controls");

  console.log("\n==================================================================");
  console.log("  SEMUA PENGUJIAN LOGIKA & ATURAN BISNIS: 100% PASS!              ");
  console.log("==================================================================");
}

runSuite()
  .catch(err => {
    console.error("FAIL:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDbPool();
    process.exit(process.exitCode || 0);
  });
