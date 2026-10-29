/**
 * SPARTA SIAGA — Report Permission Helpers (Client-Safe)
 * 
 * Provides client-side synchronous authorization helpers for UI rendering and modals.
 * Pure logic — does NOT import database or server packages.
 */

import { SpartaRole, IncidentRecord, SystemRole, Scope, IncidentStatus } from "@/types/incident";

export interface UserContext {
  id: string;
  name: string;
  email?: string | null;
  nik?: string | null;
  avatarUrl?: string | null;
  role: SpartaRole | null; // Business Role
  systemRole: SystemRole;
  scope: Scope | null;
  branch: string | null;
}

// ============================================================
// SYNCHRONOUS CLIENT-SIDE HELPERS & HO VISIBILITY RULE
// ============================================================

/**
 * Aturan Visibilitas Laporan untuk Head Office (HO) — Phase 1 Business Rules
 *
 * Prinsip:
 * 1. Seluruh Laporan (Manual & Otomatis Gempa):
 *    Tidak ada pengecualian otomatis gempa. Seluruh laporan kejadian (baik manual maupun otomatis sistem)
 *    adalah laporan awal cabang (preliminary) yang TIDAK boleh terlihat oleh HO sebelum menerima konfirmasi resmi
 *    dari BnM Manajer cabang terkait (approval keputusan: 'approved' [terdampak] atau 'safe' [aman]).
 *
 * 2. Status Belum Disetujui (Preliminary / Klarifikasi):
 *    - pending_confirmation, verifying, pending_bm_approval, clarification_requested,
 *      rejected_invalid, investigating, expired_unhandled -> TIDAK terlihat HO.
 *
 * 3. Status Pasca Konfirmasi Resmi BnM Manajer:
 *    - confirmed_affected (kerusakan disetujui, masuk ke alur perbaikan),
 *    - confirmed_safe (kondisi aman terkonfirmasi, masuk ke riwayat resmi),
 *    - in_estimation, awaiting_spk, spk_issued, in_maintenance, in_construction,
 *      awaiting_st, pending_final_approval, approved_pending_close, revision_requested,
 *      resolved, closed, archived -> Terlihat HO (read-only).
 */
export function isReportVisibleToHo(report: IncidentRecord): boolean {
  if (!report) return false;

  // 1. Blokir seluruh status yang belum atau tidak menerima konfirmasi/approval resmi BnM
  const unapprovedStatuses: IncidentStatus[] = [
    "pending_confirmation",
    "verifying",
    "pending_bm_approval",
    "clarification_requested",
    "rejected_invalid",
    "investigating",
    "expired_unhandled",
  ];
  if (unapprovedStatuses.includes(report.status)) {
    return false;
  }

  // 2. Status harus merupakan status pasca-approval yang sah
  const postApprovalStatuses: IncidentStatus[] = [
    "confirmed_affected",
    "confirmed_safe",
    "in_estimation",
    "awaiting_spk",
    "spk_issued",
    "in_maintenance",
    "in_construction",
    "awaiting_st",
    "pending_final_approval",
    "approved_pending_close",
    "revision_requested",
    "resolved",
    "closed",
    "archived",
  ];
  if (!postApprovalStatuses.includes(report.status)) {
    return false;
  }

  // 3. Wajib memiliki konfirmasi resmi BnM Manajer yang valid ('approved' atau 'safe').
  // Status pasca-approval yang disematkan tanpa konfirmasi sah BnM Manajer tidak boleh terlihat oleh HO.
  const bmDecision = report.verification?.bmApproval?.decision;
  return bmDecision === "approved" || bmDecision === "safe";
}

export function canViewReport(
  user: UserContext,
  report: IncidentRecord
): boolean {
  if (user.systemRole === "ADMIN") {
    return true; // Admin SPARTA SIAGA full access
  }
  if (user.scope === "HO") {
    return isReportVisibleToHo(report);
  }
  const userBranch = user.branch ? user.branch.trim().toLowerCase() : "";
  const reportBranch = report.branch ? report.branch.trim().toLowerCase() : "";
  return userBranch === reportBranch;
}

export function canActOnReport(
  user: UserContext,
  report: IncidentRecord
): boolean {
  if (user.scope === "HO") return false; // HO strictly read-only
  if (user.systemRole === "ADMIN") return true; // Admin SPARTA SIAGA full access

  const userBranch = user.branch ? user.branch.trim().toLowerCase() : "";
  const reportBranch = report.branch ? report.branch.trim().toLowerCase() : "";
  return userBranch === reportBranch;
}

export function canConfirmAffectedStore(
  user: UserContext,
  report: IncidentRecord
): boolean {
  return canActOnReport(user, report);
}

export function canInspectReport(
  user: UserContext,
  report: IncidentRecord
): boolean {
  if (user.systemRole === "ADMIN") return true; // Admin can inspect both Toko & DC across branches
  if (user.scope === "HO") return false;

  const userBranch = user.branch ? user.branch.trim().toLowerCase() : "";
  const reportBranch = report.branch ? report.branch.trim().toLowerCase() : "";
  if (userBranch !== reportBranch) return false;

  const tkp = report.tkpType || "toko";
  if (tkp === "dc") return user.role === "bes";
  if (tkp === "building") return user.role === "bbs";
  return user.role === "bms";
}

export function canApproveAsBm(
  user: UserContext,
  report: IncidentRecord
): boolean {
  if (user.systemRole === "ADMIN") return true; // Admin can approve across branches
  if (user.scope === "HO") return false;
  if (user.role !== "bm") return false;

  const userBranch = user.branch ? user.branch.trim().toLowerCase() : "";
  const reportBranch = report.branch ? report.branch.trim().toLowerCase() : "";
  return userBranch === reportBranch;
}

export function canCreateManagementInstruction(
  user: UserContext
): boolean {
  if (user.systemRole === "ADMIN") return true; // Admin has full access
  return user.role === "gm_ho" || user.role === "sm_ho";
}

export function canCreateEstimation(
  user: UserContext,
  report: IncidentRecord
): boolean {
  if (user.systemRole === "ADMIN") return true;
  if (user.role === "bms") {
    const userBranch = user.branch ? user.branch.trim().toLowerCase() : "";
    const reportBranch = report.branch ? report.branch.trim().toLowerCase() : "";
    return userBranch === reportBranch;
  }
  return false;
}

export function canUpdateProgress(
  user: UserContext,
  report: IncidentRecord
): boolean {
  return canActOnReport(user, report);
}

export function canCloseReport(
  user: UserContext,
  report: IncidentRecord
): boolean {
  if (user.scope === "HO") return false; // HO strictly read-only
  if (user.systemRole === "ADMIN") return true;
  if ((user.role || "").toLowerCase() !== "bm") return false; // BnM Manager only

  const userBranch = user.branch ? user.branch.trim().toLowerCase() : "";
  const reportBranch = report.branch ? report.branch.trim().toLowerCase() : "";
  return userBranch === reportBranch;
}

export function isBranchAffected(
  userBranch: string,
  report: IncidentRecord
): boolean {
  return (
    report.branch.trim().toLowerCase() === userBranch.trim().toLowerCase()
  );
}
