/**
 * SPARTA SIAGA — Client-Side Effective Permission Resolver
 * 
 * Scope-aware, user-override-aware, and client-safe (no DB/Node.js dependencies).
 */

import {
  PermissionKey,
  PermissionEffect,
  UserPermissionOverrideRecord,
  DEFAULT_ROLE_PERMISSIONS,
  isOperationalPermission,
  isMonitoringPermission,
} from "@/types/permission";
import { UserIdentity } from "./identity";
import { IncidentRecord } from "@/types/incident";

export interface ClientPermissionCheckParams {
  identity: UserIdentity | null;
  permission: PermissionKey;
  report?: IncidentRecord | null;
  targetBranch?: string | null;
}

export interface ClientPermissionCheckResult {
  authorized: boolean;
  reason: string;
  scopeReason: string;
  isScopeViolation?: boolean;
}

export function checkClientPermission(params: ClientPermissionCheckParams): ClientPermissionCheckResult {
  const { identity, permission, report, targetBranch } = params;

  if (!identity) {
    return {
      authorized: false,
      reason: "Memuat identitas pengguna...",
      scopeReason: "Sesi belum siap",
    };
  }

  const cleanBranch = (b?: string | null) => (b ? b.trim().toLowerCase() : "");
  const explicitTarget = cleanBranch(targetBranch);
  const useReportCodes = Boolean(!explicitTarget && identity.branchCode && report?.branchCode);
  const contextBranch = explicitTarget || cleanBranch(useReportCodes ? report?.branchCode : report?.branch);
  const userBranch = cleanBranch(useReportCodes ? identity.branchCode : identity.branch);
  const matchesTargetBranch = (candidate?: string | null) => {
    const cleanCandidate = cleanBranch(candidate);
    if (!cleanCandidate || !explicitTarget) return cleanCandidate === contextBranch;
    if (cleanCandidate === explicitTarget) return true;
    return false;
  };

  // 1. SYSTEM ADMIN CLASSIFICATION
  // Admin SPARTA SIAGA is the super administrator with full application access across all branches.
  if (identity.systemRole === "ADMIN") {
    return {
      authorized: true,
      reason: "Admin SPARTA SIAGA memiliki akses penuh aplikasi.",
      scopeReason: "Super Administrator Nasional",
    };
  }

  // 2. ACTIVE USER OVERRIDES EVALUATION (For business users)
  if (identity.overrides && identity.overrides.length > 0) {
    const now = new Date();
    const activeOverrides = identity.overrides.filter((ov) => {
      if (ov.revokedAt) return false;
      if (ov.startsAt && new Date(ov.startsAt) > now) return false;
      if (ov.expiresAt && new Date(ov.expiresAt) <= now) return false;
      return true;
    });

    const matchingOverrides = activeOverrides.filter((ov) => ov.permissionKey === permission);

    const doesScopeMatch = (ov: UserPermissionOverrideRecord) => {
      // Operational actions cannot match ALL_BRANCHES (must be specific branch or own branch)
      if (isOperationalPermission(permission) && ov.scopeType === "ALL_BRANCHES") {
        return false;
      }
      if (ov.scopeType === "ALL_BRANCHES") return true;
      if (ov.scopeType === "SPECIFIC_BRANCH") {
        if (!contextBranch) return true;
        if (matchesTargetBranch(ov.branchCode)) return true;
        return Boolean(report?.branchCode && cleanBranch(ov.branchCode) === cleanBranch(report.branchCode));
      }
      if (ov.scopeType === "OWN_SCOPE") {
        if (identity.scope === "HO") return true;
        if (!contextBranch) return true;
        if (explicitTarget) {
          return (
            explicitTarget === cleanBranch(identity.branch) ||
            Boolean(identity.branchCode && explicitTarget === cleanBranch(identity.branchCode))
          );
        }
        return userBranch === contextBranch;
      }
      return false;
    };

    // Explicit User DENY
    const userDeny = matchingOverrides.find((ov) => ov.effect === "DENY" && doesScopeMatch(ov));
    if (userDeny) {
      return {
        authorized: false,
        reason: "Anda tidak memiliki izin untuk melakukan tindakan pada laporan ini.",
        scopeReason: `Izin ditolak secara spesifik pada akun Anda: ${userDeny.reason}`,
      };
    }

    // Explicit User ALLOW
    const userAllow = matchingOverrides.find((ov) => ov.effect === "ALLOW" && doesScopeMatch(ov));
    if (userAllow) {
      return {
        authorized: true,
        reason: "Izin diberikan melalui override pengguna.",
        scopeReason: `Cakupan sesuai override aktif (${userAllow.reason})`,
      };
    }
  }

  // If user has no business role
  if (!identity.businessRole) {
    return {
      authorized: false,
      reason: "Anda tidak memiliki business role yang valid.",
      scopeReason: "Akun belum dikonfigurasikan dengan role bisnis",
    };
  }

  // 3. ROLE PERMISSION EVALUATION
  const roleEffect: PermissionEffect =
    (identity.rolePermissions?.[permission] as PermissionEffect) ||
    DEFAULT_ROLE_PERMISSIONS[identity.businessRole]?.[permission] ||
    "DENY";

  if (roleEffect !== "ALLOW") {
    return {
      authorized: false,
      reason: "Anda tidak memiliki izin untuk melakukan aksi pada laporan ini.",
      scopeReason: "Permission belum diberikan pada akun Anda.",
    };
  }

  // 4. ORGANIZATIONAL SCOPE EVALUATION
  const isOperational =
    permission === "REPORT_CONFIRM" ||
    permission === "REPORT_FOLLOW_UP" ||
    permission === "REPORT_UPDATE_PROGRESS" ||
    permission === "REPORT_CLOSE" ||
    permission === "ESTIMATION_TRIGGER" ||
    permission === "WORK_READINESS_UPDATE" ||
    permission === "COMPLETION_SUBMIT" ||
    permission === "COMPLETION_APPROVE_COORDINATOR";

  if (isOperational) {
    // HO roles CANNOT act on branch without explicit branch override
    if (identity.scope === "HO") {
      return {
        authorized: false,
        reason: "Anda tidak memiliki izin untuk melakukan aksi pada laporan ini.",
        scopeReason: "Laporan ini berada di luar cakupan akses Anda (User HO memerlukan izin khusus untuk aksi operasional cabang).",
        isScopeViolation: true,
      };
    }

    // Branch staff: can ONLY act on their own branch!
    if (contextBranch && userBranch !== contextBranch) {
      return {
        authorized: false,
        reason: "Anda tidak memiliki izin untuk melakukan aksi pada laporan ini.",
        scopeReason: "Laporan ini berada di luar cakupan akses Anda.",
        isScopeViolation: true,
      };
    }

    return {
      authorized: true,
      reason: "Izin operasional cabang aktif.",
      scopeReason: `Sesuai cabang ${identity.branch || ""}`,
    };
  }

  // Management instruction
  if (permission === "MANAGEMENT_INSTRUCTION_CREATE") {
    if (identity.scope === "HO" && (identity.businessRole === "gm_ho" || identity.businessRole === "sm_ho")) {
      return {
        authorized: true,
        reason: "Izin membuat instruksi manajemen aktif.",
        scopeReason: "Scope HO Manajemen",
      };
    }
    return {
      authorized: false,
      reason: "Instruksi manajemen hanya dapat dibuat oleh GM/SM Head Office.",
      scopeReason: "Laporan ini berada di luar cakupan akses Anda.",
      isScopeViolation: true,
    };
  }

  // Default allow for views if role has ALLOW
  return {
    authorized: true,
    reason: "Akses diizinkan.",
    scopeReason: "Sesuai wewenang akun",
  };
}
