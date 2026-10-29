/**
 * SPARTA SIAGA — TASK T05B Regression Test Suite
 * Pengujian 18 Skenario Wajib Aturan Visibilitas Laporan untuk Head Office (HO)
 */

import assert from "node:assert/strict";
import { 
  canViewReport, 
  canActOnReport, 
  isReportVisibleToHo, 
  UserContext 
} from "../lib/report-permissions";
import { 
  canViewReportAsync, 
  canApproveAsBmAsync, 
  checkMutationAuthorization 
} from "../lib/permission-service";
import { IncidentRecord } from "../types/incident";

console.log("==================================================================");
console.log("  SPARTA SIAGA — TASK T05B: HO REPORT VISIBILITY 18 SCENARIOS     ");
console.log("==================================================================");

// --- User Personas ---
const hoUser: UserContext = {
  id: "USR-HO-ADMIN-01",
  name: "HO Administrator",
  systemRole: "USER",
  scope: "HO",
  branch: null,
  role: "ho_admin",
};

const gmHoUser: UserContext = {
  id: "USR-GM-HO-01",
  name: "General Manager HO",
  systemRole: "USER",
  scope: "HO",
  branch: null,
  role: "gm_ho",
};

const bmsOwnerUser: UserContext = {
  id: "USR-BMS-BDG-01",
  name: "BMS Cabang Bandung",
  systemRole: "USER",
  scope: "BRANCH",
  branch: "BANDUNG",
  role: "bms",
};

const bmOwnerUser: UserContext = {
  id: "USR-BM-BDG-01",
  name: "BnM Manajer Bandung",
  systemRole: "USER",
  scope: "BRANCH",
  branch: "BANDUNG",
  role: "bm",
};

const bmsForeignUser: UserContext = {
  id: "USR-BMS-JKT-01",
  name: "BMS Cabang Jakarta (Cabang Lain)",
  systemRole: "USER",
  scope: "BRANCH",
  branch: "JAKARTA",
  role: "bms",
};

// --- Base Report Template ---
const baseReport: IncidentRecord = {
  id: "LAP-MAN-2026-BDG-001",
  date: "2026-10-22",
  disasterType: "flood",
  reportOrigin: "manual",
  branch: "BANDUNG",
  storeId: "T001",
  storeName: "Alfamart Dago Bandung",
  locationCity: "Kota Bandung",
  status: "pending_confirmation",
  progress: 0,
  timeline: [],
  createdAt: "2026-10-22T00:00:00.000Z",
  updatedAt: "2026-10-22T00:00:00.000Z",
};

async function runAll18Scenarios() {
  let passedCount = 0;

  // -------------------------------------------------------------
  // Scenario 1: Laporan manual baru dibuat -> Tidak terlihat HO
  // -------------------------------------------------------------
  {
    const rep: IncidentRecord = {
      ...baseReport,
      id: "REP-01-NEW",
      reportOrigin: "manual",
      status: "pending_confirmation",
    };
    assert.equal(isReportVisibleToHo(rep), false, "S1: isReportVisibleToHo harus false");
    assert.equal(canViewReport(hoUser, rep), false, "S1: canViewReport untuk HO harus false");
    assert.equal(await canViewReportAsync(hoUser, rep), false, "S1: canViewReportAsync untuk HO harus false");
    console.log("  [Skenario 01] PASS: Laporan manual baru dibuat -> Tidak terlihat HO");
    passedCount++;
  }

  // -------------------------------------------------------------
  // Scenario 2: Laporan manual menunggu pemeriksaan -> Tidak terlihat HO
  // -------------------------------------------------------------
  {
    const rep: IncidentRecord = {
      ...baseReport,
      id: "REP-02-VERIFYING",
      reportOrigin: "manual",
      status: "verifying",
    };
    assert.equal(isReportVisibleToHo(rep), false, "S2: isReportVisibleToHo harus false");
    assert.equal(canViewReport(hoUser, rep), false, "S2: canViewReport untuk HO harus false");
    assert.equal(await canViewReportAsync(hoUser, rep), false, "S2: canViewReportAsync untuk HO harus false");
    console.log("  [Skenario 02] PASS: Laporan manual menunggu pemeriksaan -> Tidak terlihat HO");
    passedCount++;
  }

  // -------------------------------------------------------------
  // Scenario 3: Pemeriksaan dikirim ke BnM -> Belum terlihat HO
  // -------------------------------------------------------------
  {
    const rep: IncidentRecord = {
      ...baseReport,
      id: "REP-03-PENDING-BM",
      reportOrigin: "manual",
      status: "pending_bm_approval",
      verification: {
        confirmedBy: "Petugas BMS",
        confirmedAt: "2026-10-22 09:00:00 WIB",
        isDamaged: true,
      },
    };
    assert.equal(isReportVisibleToHo(rep), false, "S3: isReportVisibleToHo harus false");
    assert.equal(canViewReport(hoUser, rep), false, "S3: canViewReport untuk HO harus false");
    assert.equal(await canViewReportAsync(hoUser, rep), false, "S3: canViewReportAsync untuk HO harus false");
    console.log("  [Skenario 03] PASS: Pemeriksaan dikirim ke BnM -> Belum terlihat HO");
    passedCount++;
  }

  // -------------------------------------------------------------
  // Scenario 4: BnM belum mengambil keputusan -> Belum terlihat HO
  // -------------------------------------------------------------
  {
    const rep: IncidentRecord = {
      ...baseReport,
      id: "REP-04-NO-DECISION",
      reportOrigin: "manual",
      status: "pending_bm_approval",
      verification: {
        confirmedBy: "Petugas BMS",
        confirmedAt: "2026-10-22 09:00:00 WIB",
        isDamaged: true,
        bmApproval: undefined,
      },
    };
    assert.equal(isReportVisibleToHo(rep), false, "S4: isReportVisibleToHo harus false");
    assert.equal(canViewReport(hoUser, rep), false, "S4: canViewReport untuk HO harus false");
    console.log("  [Skenario 04] PASS: BnM belum mengambil keputusan -> Belum terlihat HO");
    passedCount++;
  }

  // -------------------------------------------------------------
  // Scenario 5: BnM meminta revisi / klarifikasi -> Belum terlihat HO
  // -------------------------------------------------------------
  {
    const rep: IncidentRecord = {
      ...baseReport,
      id: "REP-05-REVISION",
      reportOrigin: "manual",
      status: "clarification_requested",
      verification: {
        confirmedBy: "Petugas BMS",
        confirmedAt: "2026-10-22 09:00:00 WIB",
        isDamaged: true,
        bmApproval: {
          decision: "clarification_requested",
          decidedBy: "BnM Manajer",
          decidedAt: "2026-10-22 10:00:00 WIB",
          clarificationReason: "Perlu foto tambahan area rak depan",
        },
      },
    };
    assert.equal(isReportVisibleToHo(rep), false, "S5: isReportVisibleToHo harus false");
    assert.equal(canViewReport(hoUser, rep), false, "S5: canViewReport untuk HO harus false");
    console.log("  [Skenario 05] PASS: BnM meminta revisi -> Belum terlihat HO");
    passedCount++;
  }

  // -------------------------------------------------------------
  // Scenario 6: BnM menyetujui pemeriksaan awal -> Terlihat HO
  // -------------------------------------------------------------
  {
    const rep: IncidentRecord = {
      ...baseReport,
      id: "REP-06-BM-APPROVED",
      reportOrigin: "manual",
      status: "confirmed_affected",
      verification: {
        confirmedBy: "Petugas BMS",
        confirmedAt: "2026-10-22 09:00:00 WIB",
        isDamaged: true,
        bmApproval: {
          decision: "approved",
          decidedBy: "BnM Manajer Bandung",
          decidedAt: "2026-10-22 10:30:00 WIB",
          decisionNotes: "Disetujui untuk perbaikan fasilitas",
        },
      },
    };
    assert.equal(isReportVisibleToHo(rep), true, "S6: isReportVisibleToHo harus true");
    assert.equal(canViewReport(hoUser, rep), true, "S6: canViewReport untuk HO harus true");
    assert.equal(await canViewReportAsync(hoUser, rep), true, "S6: canViewReportAsync untuk HO harus true");
    console.log("  [Skenario 06] PASS: BnM menyetujui pemeriksaan awal -> Terlihat HO");
    passedCount++;
  }

  // -------------------------------------------------------------
  // Scenario 7: Laporan sudah disetujui awal tetapi belum selesai maintenance -> Tetap dapat dimonitor HO
  // -------------------------------------------------------------
  {
    const repInMaintenance: IncidentRecord = {
      ...baseReport,
      id: "REP-07-IN-MAINTENANCE",
      reportOrigin: "manual",
      status: "in_maintenance",
      progress: 40,
      verification: {
        confirmedBy: "Petugas BMS",
        confirmedAt: "2026-10-22 09:00:00 WIB",
        isDamaged: true,
        bmApproval: {
          decision: "approved",
          decidedBy: "BnM Manajer Bandung",
          decidedAt: "2026-10-22 10:30:00 WIB",
        },
      },
    };
    assert.equal(isReportVisibleToHo(repInMaintenance), true, "S7: isReportVisibleToHo in_maintenance harus true");
    assert.equal(canViewReport(hoUser, repInMaintenance), true, "S7: canViewReport HO harus true");
    assert.equal(await canViewReportAsync(hoUser, repInMaintenance), true, "S7: canViewReportAsync HO harus true");

    const repInEstimation: IncidentRecord = {
      ...repInMaintenance,
      id: "REP-07-IN-ESTIMATION",
      status: "in_estimation",
    };
    assert.equal(isReportVisibleToHo(repInEstimation), true, "S7: isReportVisibleToHo in_estimation harus true");
    console.log("  [Skenario 07] PASS: Laporan sudah disetujui awal tetapi belum selesai maintenance -> Tetap dapat dimonitor HO");
    passedCount++;
  }

  // -------------------------------------------------------------
  // Scenario 8: Gempa dibuat otomatis oleh sistem belum disetujui BnM -> TIDAK terlihat HO (Phase 1)
  // -------------------------------------------------------------
  {
    const repAutoEarthquake: IncidentRecord = {
      ...baseReport,
      id: "LAP-EQ-AUTO-001",
      disasterType: "earthquake",
      reportOrigin: "automatic_earthquake",
      earthquakeEventId: "bmkg_20261022_001",
      status: "pending_confirmation",
    };
    assert.equal(isReportVisibleToHo(repAutoEarthquake), false, "S8: Phase 1 unapproved auto-earthquake report must be false for HO");
    assert.equal(canViewReport(hoUser, repAutoEarthquake), false, "S8: canViewReport HO harus false");
    assert.equal(await canViewReportAsync(hoUser, repAutoEarthquake), false, "S8: canViewReportAsync HO harus false");
    console.log("  [Skenario 08] PASS: Gempa dibuat otomatis oleh sistem belum disetujui BnM -> Tersembunyi dari HO");
    passedCount++;
  }

  // -------------------------------------------------------------
  // Scenario 9: Gempa otomatis setelah diverifikasi dan disetujui BnM -> Resmi terlihat HO
  // -------------------------------------------------------------
  {
    const repVerifiedAuto: IncidentRecord = {
      ...baseReport,
      id: "LAP-EQ-AUTO-002",
      disasterType: "earthquake",
      reportOrigin: "automatic_earthquake",
      earthquakeEventId: "bmkg_20261022_002",
      status: "confirmed_affected",
      verification: {
        confirmedBy: "Petugas Lapangan",
        confirmedAt: "2026-10-22 10:00:00 WIB",
        isDamaged: true,
        photos: ["/storage/sample.jpg"],
        bmApproval: {
          decision: "approved",
          decidedBy: "BnM Manajer",
          decidedAt: "2026-10-22 11:00:00 WIB",
        },
      },
    };
    assert.equal(isReportVisibleToHo(repVerifiedAuto), true, "S9: isReportVisibleToHo harus true setelah disetujui BnM");
    assert.equal(canViewReport(hoUser, repVerifiedAuto), true, "S9: canViewReport HO harus true setelah disetujui BnM");
    assert.equal(await canViewReportAsync(hoUser, repVerifiedAuto), true, "S9: canViewReportAsync HO harus true setelah disetujui BnM");
    console.log("  [Skenario 09] PASS: Gempa otomatis setelah diverifikasi dan disetujui BnM -> Resmi terlihat HO");
    passedCount++;
  }

  // -------------------------------------------------------------
  // Scenario 10: Gempa dibuat manual oleh pengguna -> Menunggu Approval awal BnM sebelum terlihat HO
  // -------------------------------------------------------------
  {
    const repManualEarthquake: IncidentRecord = {
      ...baseReport,
      id: "LAP-MAN-EQ-001",
      disasterType: "earthquake", // Gempa bumi, tapi dibuat manual!
      reportOrigin: "manual",
      status: "pending_confirmation",
    };
    // Sebelum disetujui BnM: TIDAK boleh terlihat HO
    assert.equal(isReportVisibleToHo(repManualEarthquake), false, "S10: manual earthquake unapproved harus false");
    assert.equal(canViewReport(hoUser, repManualEarthquake), false, "S10: canViewReport harus false");

    // Setelah disetujui BnM: BARU terlihat HO
    const repManualEqApproved: IncidentRecord = {
      ...repManualEarthquake,
      status: "confirmed_affected",
      verification: {
        confirmedBy: "Petugas",
        confirmedAt: "2026-10-22 10:00:00 WIB",
        isDamaged: true,
        bmApproval: {
          decision: "approved",
          decidedBy: "BnM Manajer",
          decidedAt: "2026-10-22 11:00:00 WIB",
        },
      },
    };
    assert.equal(isReportVisibleToHo(repManualEqApproved), true, "S10: manual earthquake approved harus true");
    assert.equal(canViewReport(hoUser, repManualEqApproved), true, "S10: canViewReport harus true setelah approval");
    console.log("  [Skenario 10] PASS: Gempa dibuat manual oleh pengguna -> Menunggu Approval awal BnM sebelum terlihat HO");
    passedCount++;
  }

  // -------------------------------------------------------------
  // Scenario 11: HO membuka API detail laporan manual yang belum disetujui -> Akses ditolak
  // -------------------------------------------------------------
  {
    const repUnapproved: IncidentRecord = {
      ...baseReport,
      id: "REP-11-UNAPPROVED",
      reportOrigin: "manual",
      status: "pending_confirmation",
    };
    const canView = await canViewReportAsync(hoUser, repUnapproved);
    assert.equal(canView, false, "S11: canViewReportAsync harus menolak akses HO pada laporan manual belum disetujui");
    console.log("  [Skenario 11] PASS: HO membuka API detail laporan manual yang belum disetujui -> Akses ditolak");
    passedCount++;
  }

  // -------------------------------------------------------------
  // Scenario 12: HO mencoba membuka lampiran laporan tersembunyi -> Akses ditolak
  // -------------------------------------------------------------
  {
    const repUnapproved: IncidentRecord = {
      ...baseReport,
      id: "REP-12-EVIDENCE",
      reportOrigin: "manual",
      status: "pending_bm_approval",
    };
    // Sesuai implementasi pada inspection evidence route: if (!canViewReport(sessionUser, incident)) -> 403
    const canAccessAttachment = canViewReport(hoUser, repUnapproved);
    assert.equal(canAccessAttachment, false, "S12: canViewReport untuk lampiran laporan belum disetujui harus ditolak (false)");
    console.log("  [Skenario 12] PASS: HO mencoba membuka lampiran laporan tersembunyi -> Akses ditolak");
    passedCount++;
  }

  // -------------------------------------------------------------
  // Scenario 13: HO membuka laporan yang sudah memenuhi syarat -> Read-only
  // -------------------------------------------------------------
  {
    const repApproved: IncidentRecord = {
      ...baseReport,
      id: "REP-13-READONLY",
      reportOrigin: "manual",
      status: "confirmed_affected",
      verification: {
        confirmedBy: "Petugas",
        confirmedAt: "2026-10-22 09:00:00 WIB",
        isDamaged: true,
        bmApproval: {
          decision: "approved",
          decidedBy: "BnM Manajer",
          decidedAt: "2026-10-22 10:00:00 WIB",
        },
      },
    };
    assert.equal(canViewReport(hoUser, repApproved), true, "S13: HO harus bisa melihat laporan yang disetujui");
    assert.equal(canActOnReport(hoUser, repApproved), false, "S13: canActOnReport untuk HO HARUS false (Read-only)");
    assert.equal(canActOnReport(gmHoUser, repApproved), false, "S13: canActOnReport untuk GM HO HARUS false (Read-only)");
    console.log("  [Skenario 13] PASS: HO membuka laporan yang sudah memenuhi syarat -> Read-only");
    passedCount++;
  }

  // -------------------------------------------------------------
  // Scenario 14: Dashboard HO menghitung laporan -> Hanya laporan yang boleh terlihat
  // -------------------------------------------------------------
  {
    const mixedReports: IncidentRecord[] = [
      { ...baseReport, id: "M1", reportOrigin: "manual", status: "pending_confirmation" }, // Sembunyi
      { ...baseReport, id: "M2", reportOrigin: "manual", status: "verifying" },            // Sembunyi
      { ...baseReport, id: "M3", reportOrigin: "manual", status: "pending_bm_approval" },  // Sembunyi
      { 
        ...baseReport, 
        id: "M4", 
        reportOrigin: "manual", 
        status: "confirmed_affected",
        verification: { confirmedBy: "P", confirmedAt: "T", isDamaged: true, bmApproval: { decision: "approved", decidedBy: "BM", decidedAt: "T" } }
      }, // Terlihat (1)
      { ...baseReport, id: "M5", reportOrigin: "automatic_earthquake", status: "pending_confirmation" }, // Sembunyi (Phase 1)
      { ...baseReport, id: "M6", reportOrigin: "automatic_earthquake", status: "verifying" },           // Sembunyi (Phase 1)
      { 
        ...baseReport, 
        id: "M7", 
        reportOrigin: "automatic_earthquake", 
        status: "confirmed_safe",
        verification: { confirmedBy: "P", confirmedAt: "T", isDamaged: false, photos: ["/storage/sample.jpg"], bmApproval: { decision: "safe", decidedBy: "BM", decidedAt: "T" } }
      }, // Terlihat (2)
    ];

    // Simulasi backend filtering seperti pada GET /api/incidents
    const hoVisibleReports = mixedReports.filter((r) => canViewReport(hoUser, r));
    assert.equal(hoVisibleReports.length, 2, "S14: Hanya 2 laporan terkonfirmasi (M4 & M7) yang boleh masuk ke dashboard HO");
    assert.deepEqual(hoVisibleReports.map((r) => r.id), ["M4", "M7"], "S14: Hanya M4 dan M7 yang terhitung");
    console.log("  [Skenario 14] PASS: Dashboard HO menghitung laporan -> Hanya laporan terkonfirmasi yang terlihat (2/7)");
    passedCount++;
  }

  // -------------------------------------------------------------
  // Scenario 15: Cabang pemilik membuka laporan yang belum disetujui -> Tetap dapat diakses sesuai izin
  // -------------------------------------------------------------
  {
    const repUnapprovedBandung: IncidentRecord = {
      ...baseReport,
      id: "REP-15-OWN-BRANCH",
      branch: "BANDUNG",
      reportOrigin: "manual",
      status: "pending_confirmation",
    };
    // Cabang Bandung harus tetap bisa melihat laporannya sendiri
    assert.equal(canViewReport(bmsOwnerUser, repUnapprovedBandung), true, "S15: Cabang pemilik (BMS) bisa melihat laporan");
    assert.equal(canViewReport(bmOwnerUser, repUnapprovedBandung), true, "S15: Cabang pemilik (BM) bisa melihat laporan");
    assert.equal(await canViewReportAsync(bmsOwnerUser, repUnapprovedBandung), true, "S15: canViewReportAsync cabang pemilik true");
    assert.equal(canActOnReport(bmsOwnerUser, repUnapprovedBandung), true, "S15: BMS berwenang melakukan tindakan pada cabang sendiri");
    console.log("  [Skenario 15] PASS: Cabang pemilik membuka laporan yang belum disetujui -> Tetap dapat diakses sesuai izin");
    passedCount++;
  }

  // -------------------------------------------------------------
  // Scenario 16: Cabang lain membuka laporan tanpa izin -> Akses ditolak
  // -------------------------------------------------------------
  {
    const repBandung: IncidentRecord = {
      ...baseReport,
      id: "REP-16-OTHER-BRANCH",
      branch: "BANDUNG",
      reportOrigin: "manual",
      status: "pending_confirmation",
    };
    // Cabang Jakarta DITOLAK melihat laporan Bandung
    assert.equal(canViewReport(bmsForeignUser, repBandung), false, "S16: canViewReport cabang lain harus false");
    assert.equal(await canViewReportAsync(bmsForeignUser, repBandung), false, "S16: canViewReportAsync cabang lain harus false");
    assert.equal(canActOnReport(bmsForeignUser, repBandung), false, "S16: canActOnReport cabang lain harus false");
    console.log("  [Skenario 16] PASS: Cabang lain membuka laporan tanpa izin -> Akses ditolak");
    passedCount++;
  }

  // -------------------------------------------------------------
  // Scenario 17: HO mencoba aksi approval atau update progress -> Tidak diizinkan
  // -------------------------------------------------------------
  {
    const repApproved: IncidentRecord = {
      ...baseReport,
      id: "REP-17-HO-MUTATION",
      status: "confirmed_affected",
      verification: {
        confirmedBy: "P",
        confirmedAt: "T",
        isDamaged: true,
        bmApproval: { decision: "approved", decidedBy: "BM", decidedAt: "T" },
      },
    };
    // Aksi Approval BnM oleh HO harus ditolak
    const bmAuth = await canApproveAsBmAsync(hoUser, repApproved);
    assert.equal(bmAuth.authorized, false, "S17: canApproveAsBmAsync untuk HO harus ditolak");

    // Aksi operasional melalui checkMutationAuthorization harus ditolak
    const mutAuth = await checkMutationAuthorization(
      "update_progress",
      hoUser,
      repApproved
    );
    assert.equal(mutAuth.authorized, false, "S17: checkMutationAuthorization untuk HO harus ditolak");
    console.log("  [Skenario 17] PASS: HO mencoba aksi approval atau update progress -> Tidak diizinkan (403/Forbidden)");
    passedCount++;
  }

  // -------------------------------------------------------------
  // Scenario 18: Laporan manual tidak memenuhi syarat muncul pada notifikasi/export HO -> Tidak boleh bocor
  // -------------------------------------------------------------
  {
    const repUnapproved: IncidentRecord = {
      ...baseReport,
      id: "REP-18-LEAK-PREVENTION",
      reportOrigin: "manual",
      status: "pending_bm_approval",
    };
    // Export endpoint check: if (!canViewReport(sessionUser, report)) -> ditolak
    const canExport = canViewReport(hoUser, repUnapproved);
    assert.equal(canExport, false, "S18: canViewReport untuk export dokumen laporan belum disetujui harus false");
    console.log("  [Skenario 18] PASS: Laporan manual tidak memenuhi syarat pada export/notifikasi HO -> Tidak boleh bocor");
    passedCount++;
  }

  console.log("==================================================================");
  console.log(`  HASIL AKHIR: ${passedCount} DARI 18 SKENARIO 100% PASS!`);
  console.log("==================================================================");
}

runAll18Scenarios().catch((err) => {
  console.error("FATAL ERROR IN TEST SUITE:", err);
  process.exit(1);
});
