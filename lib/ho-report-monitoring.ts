import type { IncidentRecord, IncidentStatus } from "@/types/incident";

const TERMINAL = new Set<IncidentStatus>(["closed", "resolved", "archived", "confirmed_safe", "rejected_invalid", "expired_unhandled"]);

export function isReportFinalized(report: IncidentRecord): boolean {
  return TERMINAL.has(report.status);
}

/**
 * Existing backend persists targetCompletionDate under maintenanceTicket.completedAt.
 * This legacy field is a PLANNED TARGET for the operational report, not
 * proof of physical completion; do not alter the database contract here.
 */
export function getReportTarget(report: IncidentRecord): string | null {
  const raw = report.maintenanceTicket?.completedAt;
  if (!raw || Number.isNaN(Date.parse(raw))) return null;
  return raw;
}

export function reportStatusLabel(status: IncidentStatus): string {
  const labels: Partial<Record<IncidentStatus, string>> = {
    pending_confirmation: "Menunggu Pemeriksaan",
    verifying: "Verifikasi Lapangan",
    pending_bm_approval: "Menunggu Persetujuan BnM",
    clarification_requested: "Perlu Klarifikasi",
    confirmed_affected: "Kerusakan Disetujui",
    confirmed_safe: "Dinyatakan Aman",
    rejected_invalid: "Laporan Ditolak",
    investigating: "Dalam Investigasi",
    in_estimation: "Dalam Estimasi",
    awaiting_spk: "Menunggu SPK",
    spk_issued: "SPK Terbit",
    in_maintenance: "Penanganan Maintenance",
    in_construction: "Perbaikan Berjalan",
    awaiting_st: "Menunggu Serah Terima",
    pending_final_approval: "Menunggu Persetujuan Akhir",
    revision_requested: "Revisi Diminta",
    resolved: "Selesai",
    closed: "Ditutup",
    archived: "Diarsipkan",
    expired_unhandled: "Tidak Ditindaklanjuti",
  };
  return labels[status] || status;
}

export function getHoAttentionReasons(report: IncidentRecord, now = Date.now()): string[] {
  if (isReportFinalized(report)) return [];
  const issues: string[] = [];
  switch (report.status) {
    case "confirmed_affected":
      issues.push("Kerusakan disetujui, menunggu proses penanganan");
      break;
    case "revision_requested":
      issues.push("Perlu revisi penyelesaian pekerjaan");
      break;
    case "pending_final_approval":
      issues.push("Menunggu persetujuan akhir");
      break;
  }
  const target = getReportTarget(report);
  const inWork = ["investigating", "in_maintenance", "in_construction", "in_estimation", "awaiting_spk", "spk_issued"].includes(report.status);
  if (inWork && !target) issues.push("Target penyelesaian belum ditentukan");
  // Target is a calendar deadline, not an hour-by-hour timer.
  // Do not mark a report overdue on the morning of its due date.
  if (target) {
    const targetDay = new Date(target).toLocaleDateString("sv-SE", { timeZone: "Asia/Jakarta" });
    const currentDay = new Date(now).toLocaleDateString("sv-SE", { timeZone: "Asia/Jakarta" });
    if (targetDay < currentDay) issues.push("Target penyelesaian terlewati");
  }
  return issues;
}

export function formatReportDate(date: string | null | undefined): string {
  if (!date || Number.isNaN(Date.parse(date))) return "Belum ditentukan";
  return new Date(date).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Jakarta" });
}

export function isFinalPdfAvailable(report: IncidentRecord): boolean {
  return report.status === "closed" || report.status === "resolved";
}
