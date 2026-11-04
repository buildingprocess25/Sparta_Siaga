import { Pool, PoolClient } from "pg";
import { getDbPool } from "./db";
import { assertIsolatedDatabase } from "./database-safety";
import { isTestExecutionContext } from "./runtime-config";
import { normalizeBranchCode, isBranchCodeValid } from "./branch-utils";
import {
  FINALIZED_SIAGA_BUSINESS_ROLES,
  FinalizedSiagaBusinessRole,
  isFinalizedSiagaBusinessRole,
  RawSpartaUserRecord,
  NormalizedSyncUser,
  SyncRecordResult,
  MultiRoleAssignment,
  UserSyncOptions,
  UserSyncReport,
  SiagaSyncCategory,
  SsoUserReference,
} from "./user-sync-types";

interface RoleResolutionResult {
  role: FinalizedSiagaBusinessRole | null;
  scope: "HO" | "BRANCH" | null;
  isFlaggedForReview?: boolean;
  reviewReason?: string;
}

/**
 * Resolves an incoming role strictly into the approved 9 Finalized SIAGA Roles.
 * - System Administrator: Never assigned through imports.
 * - Admin (HO): Consolidates ho_admin, gm_ho, sm_ho, admin_ho.
 * - BnM Manajer (bm): ONLY from Maintenance BNM roles. Building Branch Manager & Engineering Manager are FLAGGED.
 * - BMC, BEC, BBC: Respective domain coordinators.
 * - BMS, BES, BBS: Respective domain specialists.
 */
export function resolveApprovedSiagaRole(
  rawRole?: string | null,
  systemModule?: string | null
): RoleResolutionResult {
  if (!rawRole) {
    return { role: null, scope: null, reviewReason: "Role kosong pada data sumber." };
  }

  const rawClean = rawRole.trim();
  const normalized = rawClean.toLowerCase().replace(/_/g, " ").replace(/\s+/g, " ");
  const mod = (systemModule || "").toUpperCase();

  // 1. Strict Protection: System Administrator must NEVER be assigned through imports
  if (
    normalized === "super admin" ||
    normalized === "superadmin" ||
    normalized === "system admin" ||
    normalized === "sysadmin" ||
    normalized === "technical admin" ||
    (normalized === "admin" && (mod.includes("SYSTEM") || mod === "SYSADMIN" || mod === "CORE" || mod === "BUILDING" || mod === "MAINTENANCE" || mod === "ENGINEERING" || mod === ""))
  ) {
    return {
      role: null,
      scope: null,
      isFlaggedForReview: true,
      reviewReason: "Hak akses Administrator Sistem dilindungi dan tidak dapat diimpor otomatis dari data sumber.",
    };
  }

  // 1b. Engineering & Building Admin Gating: Engineering or Building ADMIN_HO / HO_ADMIN cannot grant SIAGA Admin!
  if (mod.includes("ENGINEERING") || mod === "ENG" || mod.includes("BUILDING") || mod === "BLD") {
    if (
      normalized === "admin ho" ||
      normalized === "ho admin" ||
      normalized === "admin" ||
      normalized === "gm ho" ||
      normalized === "sm ho" ||
      normalized === "head office admin" ||
      normalized === "general manager" ||
      normalized === "senior manager"
    ) {
      return {
        role: null,
        scope: "HO",
        isFlaggedForReview: true,
        reviewReason: `${systemModule} role '${rawClean}' tidak dapat otomatis diberikan hak akses SIAGA Admin Head Office. Ditandai untuk review perizinan manual.`,
      };
    }
  }

  // 2. Head Office Admin Consolidation (ho_admin, gm_ho, sm_ho, admin_ho -> 'admin')
  if (
    normalized === "ho admin" ||
    normalized === "admin ho" ||
    normalized === "gm ho" ||
    normalized === "sm ho" ||
    normalized === "gm" ||
    normalized === "sm" ||
    normalized === "general manager" ||
    normalized === "senior manager" ||
    normalized === "head office admin" ||
    normalized === "admin monitoring ho" ||
    (normalized === "admin" && (mod.includes("HO") || mod.includes("HEAD") || mod === "SSO"))
  ) {
    return { role: "admin", scope: "HO" };
  }

  // 3. Building Manager Gating: Building BRANCH MANAGER / MANAGER is NOT BnM Manajer!
  if (mod.includes("BUILDING") || mod === "BLD") {
    if (
      normalized === "branch manager" ||
      normalized === "manager" ||
      normalized === "kepala cabang" ||
      normalized === "manager building"
    ) {
      return {
        role: null,
        scope: "BRANCH",
        isFlaggedForReview: true,
        reviewReason: "Building Branch Manager bukan BnM Manajer cabang; ditandai untuk review perizinan manual.",
      };
    }
    // BBS (Building Support)
    if (
      normalized === "bbs" ||
      normalized === "bs" ||
      normalized === "branch building support" ||
      normalized === "building support" ||
      normalized === "pengawas lapangan" ||
      normalized === "spv bbs" ||
      normalized === "staff building" ||
      normalized === "support"
    ) {
      return { role: "bbs", scope: "BRANCH" };
    }
    // BBC (Building Coordinator)
    if (
      normalized === "bbc" ||
      normalized === "bc" ||
      normalized === "branch building coordinator" ||
      normalized === "building coordinator" ||
      normalized === "koordinator bbs" ||
      normalized === "koordinator building" ||
      normalized === "coordinator"
    ) {
      return { role: "bbc", scope: "BRANCH" };
    }
  }

  // 4. Engineering Manager Gating: Engineering MANAGER is NOT BnM Manajer!
  if (mod.includes("ENGINEERING") || mod === "ENG") {
    if (
      normalized === "manager" ||
      normalized === "engineering manager" ||
      normalized === "branch manager"
    ) {
      return {
        role: null,
        scope: "BRANCH",
        isFlaggedForReview: true,
        reviewReason: "Engineering Manager bukan BnM Manajer cabang; ditandai untuk review perizinan manual.",
      };
    }
    // BES (Engineering Support / DC)
    if (
      normalized === "bes" ||
      normalized === "es" ||
      normalized === "branch engineering support" ||
      normalized === "engineering support" ||
      normalized === "pic dc" ||
      normalized === "spv bes" ||
      normalized === "staff engineering" ||
      normalized === "support"
    ) {
      return { role: "bes", scope: "BRANCH" };
    }
    // BEC (Engineering Coordinator)
    if (
      normalized === "bec" ||
      normalized === "coord" ||
      normalized === "branch engineering coordinator" ||
      normalized === "engineering coordinator" ||
      normalized === "koordinator bes" ||
      normalized === "koordinator engineering" ||
      normalized === "coordinator"
    ) {
      return { role: "bec", scope: "BRANCH" };
    }
  }

  // 5. Maintenance Roles (BnM Manajer, BMS, BMC)
  if (mod.includes("MAINTENANCE") || mod === "MTC" || mod === "SSO" || mod === "") {
    // Explicit BnM Manager (Authentic Branch Building & Maintenance Head)
    if (
      normalized === "bm" ||
      normalized === "bnm" ||
      normalized === "bnm manajer" ||
      normalized === "bnm manager" ||
      normalized === "branch bnm manager" ||
      normalized === "branch bnm manajer" ||
      normalized === "branch building & maintenance manager" ||
      normalized === "branch building and maintenance manager" ||
      normalized === "building & maintenance manager" ||
      normalized === "building and maintenance manager" ||
      normalized === "kepala cabang bnm" ||
      normalized === "manajer bnm" ||
      normalized === "manager bnm"
    ) {
      return { role: "bm", scope: "BRANCH" };
    }

    // Generic "BRANCH MANAGER", "MANAGER", or "KEPALA CABANG" must NOT automatically map to bm!
    if (
      normalized === "branch manager" ||
      normalized === "manager" ||
      normalized === "kepala cabang"
    ) {
      return {
        role: null,
        scope: "BRANCH",
        isFlaggedForReview: true,
        reviewReason: "Role 'Branch Manager' atau 'Manager' umum tidak dapat otomatis dipetakan ke BnM Manajer cabang. Ditandai untuk review manual.",
      };
    }
    // BMS (Toko Specialist)
    if (
      normalized === "bms" ||
      normalized === "branch maintenance support" ||
      normalized === "maintenance support" ||
      normalized === "pic toko" ||
      normalized === "spv bms" ||
      normalized === "staff maintenance" ||
      normalized === "support"
    ) {
      return { role: "bms", scope: "BRANCH" };
    }
    // BMC (Toko Coordinator)
    if (
      normalized === "bmc" ||
      normalized === "branch maintenance coordinator" ||
      normalized === "maintenance coordinator" ||
      normalized === "koordinator bms" ||
      normalized === "koordinator maintenance" ||
      normalized === "coordinator"
    ) {
      return { role: "bmc", scope: "BRANCH" };
    }
  }

  // 6. Direct Key Fallback if matched to finalized business role
  if (isFinalizedSiagaBusinessRole(normalized)) {
    return {
      role: normalized,
      scope: normalized === "admin" ? "HO" : "BRANCH",
    };
  }

  // 7. Unsupported / Unapproved role: Flag for review rather than dropping silently
  return {
    role: null,
    scope: null,
    isFlaggedForReview: true,
    reviewReason: `Peran '${rawClean}' bukan bagian dari 9 role kanonikal SIAGA dan ditandai untuk review perizinan.`,
  };
}

/**
 * Validates unique identity without requiring NIK for sources that lack it (e.g. Building).
 * Preserves SSO IDs and normalized emails without fabricating identities.
 */
export function validateAndNormalizeSpartaUser(
  raw: RawSpartaUserRecord
): { user: NormalizedSyncUser | null; error?: string; isFlagged?: boolean } {
  // 1. Identity Resolution (SSO ID, NIK, or Email)
  const rawSsoId = (raw.ssoId || raw.externalUserId || (raw.id?.startsWith("usr_") ? raw.id : "") || "").trim();
  const rawNik = (raw.nik || raw.employeeId || "").trim();
  const rawEmail = (raw.email || raw.email_sat || "").trim().toLowerCase();

  const ssoId = rawSsoId.length > 0 ? rawSsoId : null;
  const nik = rawNik.length > 0 ? rawNik : null;
  const email = rawEmail.includes("@") && rawEmail.includes(".") ? rawEmail : null;

  // Strict: MUST have at least one verified identifier. Never fabricate an identity!
  if (!ssoId && !nik && !email) {
    return {
      user: null,
      error: "Identitas tidak valid: tidak ditemukan SSO ID, NIK/Employee ID, maupun email valid. Pembuatan identitas palsu ditolak.",
    };
  }

  // 2. Name Resolution
  const rawName = (raw.name || raw.fullName || raw.nama_lengkap || "").trim();
  if (!rawName) {
    return {
      user: null,
      error: `Nama lengkap kosong untuk identitas '${nik || email || ssoId}'.`,
    };
  }

  // 3. Source Module Determination
  const modRaw = (raw.system || raw.moduleId || raw.sourceModule || "").toUpperCase();
  let sourceModule: "BUILDING" | "MAINTENANCE" | "ENGINEERING" | "SSO" | "SPARTA_ECOSYSTEM" = "SPARTA_ECOSYSTEM";
  if (modRaw.includes("BUILDING") || raw.email_sat) sourceModule = "BUILDING";
  else if (modRaw.includes("ENGINEERING") || raw.location) sourceModule = "ENGINEERING";
  else if (modRaw.includes("MAINTENANCE") || raw.branchNames) sourceModule = "MAINTENANCE";
  else if (modRaw.includes("SSO") || ssoId) sourceModule = "SSO";

  // 4. Role Resolution against 9 Finalized SIAGA Roles
  const rawRole = (raw.role || raw.jabatan || raw.moduleRole || "").trim();
  const roleRes = resolveApprovedSiagaRole(rawRole, sourceModule);

  if (!roleRes.role) {
    return {
      user: null,
      error: roleRes.reviewReason || `Peran '${rawRole}' tidak valid untuk 9 role kanonikal SIAGA.`,
      isFlagged: roleRes.isFlaggedForReview ?? true,
    };
  }

  // 5. Branch Scope & Resolution
  let branch: string | null = null;
  const secondaryBranches: string[] = [];

  if (roleRes.scope === "HO") {
    branch = null; // Head Office is strictly null
  } else {
    // Check if record only has non-canonical facility branches
    const hasCanonical = Array.isArray(raw.canonicalBranches) && raw.canonicalBranches.length > 0;
    const hasNonCanonical = Array.isArray(raw.nonCanonicalBranches) && raw.nonCanonicalBranches.length > 0;

    if (!hasCanonical && hasNonCanonical) {
      return {
        user: null,
        error: `Cabang non-kanonikal/fasilitas ('${raw.nonCanonicalBranches?.join(", ")}') memerlukan verifikasi pemetaan wilayah.`,
        isFlagged: true,
      };
    }

    const rawBranch = (
      raw.branch ||
      raw.cabang ||
      raw.branchCode ||
      raw.branchName ||
      (Array.isArray(raw.canonicalBranches) ? raw.canonicalBranches[0] : null) ||
      (Array.isArray(raw.branchNames) ? raw.branchNames[0] : raw.branchNames) ||
      ""
    ).trim();

    if (!rawBranch) {
      return {
        user: null,
        error: `Cabang wajib diisi untuk peran cabang '${roleRes.role}' (${nik || email}).`,
        isFlagged: true,
      };
    }

    const normalizedBranch = normalizeBranchCode(rawBranch);
    if (!isBranchCodeValid(normalizedBranch)) {
      return {
        user: null,
        error: `Cabang '${rawBranch}' tidak dikenali dalam 28 cabang kanonikal SIAGA.`,
        isFlagged: true,
      };
    }
    branch = normalizedBranch;

    // Collect secondary canonical branches without duplicating
    const allCandidateBranches: string[] = Array.isArray(raw.canonicalBranches)
      ? raw.canonicalBranches
      : Array.isArray(raw.branchNames)
      ? raw.branchNames
      : typeof raw.branchNames === "string" && raw.branchNames.includes(",")
      ? raw.branchNames.split(",").map((s) => s.trim())
      : [];

    for (const b of allCandidateBranches) {
      const norm = normalizeBranchCode(b);
      if (isBranchCodeValid(norm) && norm !== branch && !secondaryBranches.includes(norm)) {
        secondaryBranches.push(norm);
      }
    }
  }

  // 6. Account Status & Soft-Delete Respect
  let status: "ACTIVE" | "INACTIVE" = "ACTIVE";
  let needsReview = false;
  let reviewReason: string | undefined = undefined;

  // Check explicit soft-delete / inactive
  if (
    raw.deleted_at ||
    raw.status === "INACTIVE" ||
    raw.status === "inactive" ||
    raw.status === "LOCKED" ||
    raw.status === "DELETED" ||
    raw.isActive === false ||
    raw.isActive === "false" ||
    raw.isActive === 0 ||
    raw.is_active === false ||
    raw.is_active === "false" ||
    raw.is_active === 0 ||
    (raw as any).is_soft_deleted === true ||
    (raw as any).isSoftDeleted === true
  ) {
    status = "INACTIVE";
  } else if (
    raw.status === "ACTIVE" ||
    raw.status === "active" ||
    raw.status === true ||
    raw.status === "true" ||
    raw.isActive === true ||
    raw.isActive === "true" ||
    raw.isActive === 1 ||
    raw.is_active === true ||
    raw.is_active === "true" ||
    raw.is_active === 1 ||
    raw.status === undefined ||
    raw.status === null
  ) {
    status = "ACTIVE";
  } else {
    // Unknown status string: Flag for review to prevent unapproved activation
    status = "INACTIVE";
    needsReview = true;
    reviewReason = `Status akun sumber '${String(raw.status)}' tidak dikenal. Dinonaktifkan sementara untuk review.`;
  }

  // Check explicit conflicts array on raw record
  if (Array.isArray(raw.conflicts) && raw.conflicts.length > 0) {
    needsReview = true;
    reviewReason = raw.conflicts.join("; ");
  }

  return {
    user: {
      ssoId,
      nik,
      email,
      name: rawName,
      businessRole: roleRes.role,
      scope: (roleRes.scope || (roleRes.role === "admin" ? "HO" : "BRANCH")) as "HO" | "BRANCH",
      branch,
      secondaryBranches: secondaryBranches.length > 0 ? secondaryBranches : undefined,
      status,
      source: "SPARTA_SYNC",
      sourceModule,
      originalRole: rawRole,
      needsReview,
      reviewReason,
    },
  };
}

/**
 * Enforces production safety guard before executing writes.
 */
export function assertProductionUserSyncSafety(
  dryRun: boolean,
  allowProductionSync?: boolean,
  forceCheck: boolean = false
): void {
  if (dryRun) return;

  // In test scripts and test suites, isolated database safety is enforced at DB pool level.
  // forceCheck allows test suites to explicitly verify the production safety lock.
  if (!forceCheck && isTestExecutionContext()) {
    return;
  }

  const isProd = process.env.NODE_ENV === "production";
  const envAllowed = process.env.ALLOW_PRODUCTION_USER_SYNC === "true";
  const envConfirmed = process.env.CONFIRM_PRODUCTION_USER_SYNC === "I_UNDERSTAND_THIS_WRITES_TO_PRODUCTION";

  if (isProd && (!envAllowed || !envConfirmed || !allowProductionSync)) {
    throw new Error(
      "PRODUCTION_USER_SYNC_DISABLED: Eksekusi sinkronisasi user pada production dinonaktifkan. " +
      "Memerlukan otorisasi eksplisit dan preflight approval (ALLOW_PRODUCTION_USER_SYNC=true)."
    );
  }
}

/**
 * Execute or preview user synchronization against the SIAGA database.
 * Supports validated identity matching across SSO ID, NIK, and normalized Email.
 * Detects and flags identity ambiguity without destructive merging.
 */
export async function executeUserSynchronization(
  records: RawSpartaUserRecord[],
  options: UserSyncOptions = {}
): Promise<UserSyncReport> {
  const pool = getDbPool();
  const dryRun = options.dryRun ?? false;
  const allowUpdates = options.allowUpdates ?? true;

  // Assert production safety before any write
  assertProductionUserSyncSafety(dryRun, options.allowProductionSync);

  const report: UserSyncReport = {
    timestamp: new Date().toISOString(),
    dryRun,
    sourceModule: options.sourceModule || "ALL",
    totalScanned: records.length,
    validCount: 0,
    newCount: 0,
    updatedCount: 0,
    unchangedCount: 0,
    skippedCount: 0,
    flaggedForReviewCount: 0,
    pendingSsoGrantCount: 0,
    unmatchedSsoCount: 0,
    pendingReviewCount: 0,
    blockedCount: 0,
    categoriesBreakdown: {
      PENDING_SSO_GRANT: 0,
      UNMATCHED_SSO: 0,
      PENDING_REVIEW: 0,
      BLOCKED: 0,
      ACTIVE: 0,
    },
    rolesBreakdown: {},
    branchesBreakdown: {},
    records: [],
    errors: [],
  };

  for (const role of FINALIZED_SIAGA_BUSINESS_ROLES) {
    report.rolesBreakdown[role] = 0;
  }

  // Build fast SSO Reference lookup map if provided
  const ssoRefMap = new Map<string, SsoUserReference>();
  if (options.ssoReferenceMap) {
    options.ssoReferenceMap.forEach((v, k) => {
      ssoRefMap.set(k.toLowerCase().trim(), v);
    });
  } else if (options.ssoReferenceUsers) {
    for (const ref of options.ssoReferenceUsers) {
      if (ref.email) {
        const lowerEm = ref.email.toLowerCase().trim();
        const activeModules =
          (ref as any).activeModuleAccess ||
          (ref as any).active_module_access ||
          (ref as any).activeModules ||
          [];
        ssoRefMap.set(lowerEm, {
          email: lowerEm,
          nik: ref.nik || (ref as any).employeeId || null,
          ssoId: (ref as any).ssoId || (ref as any).externalUserId || null,
          name: ref.name || (ref as any).fullName || null,
          status:
            typeof ref.status === "string"
              ? ref.status
              : ref.status || (ref as any).isActive
              ? "ACTIVE"
              : "INACTIVE",
          activeModuleAccess: Array.isArray(activeModules) ? activeModules : [],
        });
      }
    }
  }

  // 1. Process and normalize records with identity conflict checking
  const normalizedList: NormalizedSyncUser[] = [];
  const rawRecordMap = new Map<string, RawSpartaUserRecord>();
  const seenNiksInBatch = new Map<string, NormalizedSyncUser>();
  const seenEmailsInBatch = new Map<string, NormalizedSyncUser>();
  const seenSsoIdsInBatch = new Map<string, NormalizedSyncUser>();

  for (const raw of records) {
    const identifier = (
      raw.nik ||
      raw.employeeId ||
      raw.email ||
      raw.email_sat ||
      raw.ssoId ||
      raw.id ||
      "UNKNOWN"
    ).trim();

    if (raw.email) {
      rawRecordMap.set(raw.email.toLowerCase().trim(), raw);
    }

    // Explicit Soft-Delete / Inactive in source module -> BLOCKED
    const isSoftDeleted =
      raw.deleted_at ||
      raw.status === "INACTIVE" ||
      raw.status === "inactive" ||
      raw.status === "DELETED" ||
      raw.isActive === false ||
      raw.isActive === "false" ||
      raw.isActive === 0 ||
      raw.is_active === false ||
      raw.is_active === "false" ||
      raw.is_active === 0 ||
      (raw as any).is_soft_deleted === true ||
      (raw as any).isSoftDeleted === true;

    if (isSoftDeleted) {
      report.skippedCount++;
      report.blockedCount = (report.blockedCount || 0) + 1;
      report.categoriesBreakdown!.BLOCKED++;
      report.records.push({
        identifier,
        nik: raw.nik || raw.employeeId || null,
        email: raw.email || raw.email_sat || null,
        name: raw.name || raw.fullName || raw.nama_lengkap || "UNKNOWN",
        targetRole: null,
        targetScope: null,
        targetBranch: null,
        sourceModule: String(raw.system || raw.moduleId || "UNKNOWN"),
        status: "BLOCKED",
        category: "BLOCKED",
        ssoStatus: "BLOCKED",
        reason: "Pengguna berstatus soft-deleted atau nonaktif pada modul sumber. Akses diblokir.",
      });
      continue;
    }

    const { user, error, isFlagged } = validateAndNormalizeSpartaUser(raw);

    if (!user) {
      if (isFlagged) {
        report.flaggedForReviewCount++;
        report.pendingReviewCount = (report.pendingReviewCount || 0) + 1;
        report.categoriesBreakdown!.PENDING_REVIEW++;
        report.records.push({
          identifier,
          nik: raw.nik || raw.employeeId || null,
          email: raw.email || raw.email_sat || null,
          name: raw.name || raw.fullName || raw.nama_lengkap || "UNKNOWN",
          targetRole: null,
          targetScope: null,
          targetBranch: null,
          sourceModule: String(raw.system || raw.moduleId || "UNKNOWN"),
          status: "FLAGGED_FOR_REVIEW",
          category: "PENDING_REVIEW",
          ssoStatus: "PENDING_REVIEW",
          reason: error,
        });
      } else {
        report.skippedCount++;
        report.records.push({
          identifier,
          nik: raw.nik || raw.employeeId || null,
          email: raw.email || raw.email_sat || null,
          name: raw.name || raw.fullName || raw.nama_lengkap || "UNKNOWN",
          targetRole: null,
          targetScope: null,
          targetBranch: null,
          sourceModule: String(raw.system || raw.moduleId || "UNKNOWN"),
          status: "SKIPPED",
          category: "BLOCKED",
          reason: error,
        });
      }
      continue;
    }

    if (user.needsReview) {
      report.flaggedForReviewCount++;
      report.pendingReviewCount = (report.pendingReviewCount || 0) + 1;
      report.categoriesBreakdown!.PENDING_REVIEW++;
      report.records.push({
        identifier,
        nik: user.nik,
        email: user.email,
        name: user.name,
        targetRole: user.businessRole,
        targetScope: user.scope,
        targetBranch: user.branch,
        secondaryBranches: user.secondaryBranches,
        sourceModule: user.sourceModule,
        status: "FLAGGED_FOR_REVIEW",
        category: "PENDING_REVIEW",
        ssoStatus: "PENDING_REVIEW",
        reason: user.reviewReason || "Data memerlukan review manual.",
      });
      continue;
    }

    // Intra-batch duplicate & multi-role detection (Corporate SSO email is primary)
    const lowerEmail = user.email ? user.email.toLowerCase() : null;
    const lowerNik = user.nik ? user.nik.toLowerCase() : null;
    const ssoKey = user.ssoId ? user.ssoId : null;

    let existingInBatch: NormalizedSyncUser | undefined;
    if (lowerEmail && seenEmailsInBatch.has(lowerEmail)) existingInBatch = seenEmailsInBatch.get(lowerEmail);
    else if (ssoKey && seenSsoIdsInBatch.has(ssoKey)) existingInBatch = seenSsoIdsInBatch.get(ssoKey);
    else if (!lowerEmail && lowerNik && seenNiksInBatch.has(lowerNik)) existingInBatch = seenNiksInBatch.get(lowerNik);

    if (existingInBatch) {
      // Check multi-role assignment preservation
      if (existingInBatch.businessRole !== user.businessRole) {
        if (!existingInBatch.multiRoles) {
          existingInBatch.multiRoles = [
            {
              module: existingInBatch.sourceModule,
              sourceRole: existingInBatch.originalRole,
              mappedRole: existingInBatch.businessRole,
              isSupported: true,
            },
          ];
        }
        existingInBatch.multiRoles.push({
          module: user.sourceModule,
          sourceRole: user.originalRole,
          mappedRole: user.businessRole,
          isSupported: true,
          notes: "Penetapan multi-role dari modul berbeda.",
        });

        report.flaggedForReviewCount++;
        report.pendingReviewCount = (report.pendingReviewCount || 0) + 1;
        report.categoriesBreakdown!.PENDING_REVIEW++;
        report.records.push({
          identifier,
          nik: user.nik,
          email: user.email,
          name: user.name,
          targetRole: existingInBatch.businessRole,
          targetScope: existingInBatch.scope,
          targetBranch: existingInBatch.branch,
          secondaryBranches: existingInBatch.secondaryBranches,
          sourceModule: user.sourceModule,
          status: "FLAGGED_FOR_REVIEW",
          category: "PENDING_REVIEW",
          ssoStatus: "PENDING_REVIEW",
          reason: `Multi-role terdeteksi: '${existingInBatch.businessRole}' di ${existingInBatch.sourceModule} dan '${user.businessRole}' di ${user.sourceModule}. Peran utama dipertahankan, assignment multi-role dicatat.`,
          multiRoles: existingInBatch.multiRoles,
        });
        continue;
      } else {
        // Merge secondary branches if present
        if (user.branch && user.branch !== existingInBatch.branch) {
          if (!existingInBatch.secondaryBranches) existingInBatch.secondaryBranches = [];
          if (!existingInBatch.secondaryBranches.includes(user.branch)) {
            existingInBatch.secondaryBranches.push(user.branch);
          }
        }
        report.skippedCount++;
        report.records.push({
          identifier,
          nik: user.nik,
          email: user.email,
          name: user.name,
          targetRole: user.businessRole,
          targetScope: user.scope,
          targetBranch: user.branch,
          sourceModule: user.sourceModule,
          status: "SKIPPED",
          category: "PENDING_SSO_GRANT",
          reason: "Duplikasi record identik dalam batch import yang sama. Record pertama digunakan.",
        });
        continue;
      }
    }

    if (lowerNik) seenNiksInBatch.set(lowerNik, user);
    if (lowerEmail) seenEmailsInBatch.set(lowerEmail, user);
    if (ssoKey) seenSsoIdsInBatch.set(ssoKey, user);

    normalizedList.push(user);
    report.validCount++;
    report.rolesBreakdown[user.businessRole] = (report.rolesBreakdown[user.businessRole] || 0) + 1;
    if (user.branch) {
      report.branchesBreakdown[user.branch] = (report.branchesBreakdown[user.branch] || 0) + 1;
    }
  }

  // Categorize valid normalized candidates against SSO reference
  for (const user of normalizedList) {
    const lowerEmail = user.email ? user.email.toLowerCase().trim() : null;
    const ssoRef = lowerEmail ? ssoRefMap.get(lowerEmail) : null;
    const rawRec = lowerEmail ? rawRecordMap.get(lowerEmail) : undefined;

    let category: SiagaSyncCategory = "PENDING_SSO_GRANT";
    let ssoReason = "";

    const hasSsoData = ssoRefMap.size > 0;
    const isExplicitNotSso =
      rawRec?.ssoMatched === false ||
      rawRec?.ssoStatus === "NOT_IN_SSO" ||
      (rawRec as any)?.sso_match_type === "NONE";
    const isExplicitSsoMatch =
      rawRec?.ssoMatched === true ||
      (rawRec as any)?.sso_match_type === "EXACT_EMAIL" ||
      (rawRec as any)?.sso_match_type === "NIK_CROSS_CHECK";

    const isMatchedInSso = isExplicitSsoMatch
      ? true
      : isExplicitNotSso
      ? false
      : hasSsoData
      ? Boolean(ssoRef)
      : true;

    if (!isMatchedInSso) {
      category = "UNMATCHED_SSO";
      ssoReason = "User aktif di modul sumber, namun belum terdaftar di Portal SSO. Menunggu pendaftaran akun oleh IT SSO.";
      report.unmatchedSsoCount = (report.unmatchedSsoCount || 0) + 1;
      report.categoriesBreakdown!.UNMATCHED_SSO++;
    } else {
      const ssoStatusVal = (ssoRef?.status || rawRec?.ssoStatus || "ACTIVE").toUpperCase();
      if (ssoStatusVal === "INACTIVE" || ssoStatusVal === "SUSPENDED" || ssoStatusVal === "LOCKED") {
        category = "BLOCKED";
        ssoReason = "Akun terdaftar di Portal SSO tetapi berstatus nonaktif.";
        report.blockedCount = (report.blockedCount || 0) + 1;
        report.categoriesBreakdown!.BLOCKED++;
      } else {
        const hasSiagaGrant =
          rawRec?.hasSiagaGrant !== undefined && rawRec?.hasSiagaGrant !== null
            ? Boolean(rawRec.hasSiagaGrant)
            : (rawRec as any)?.sso_has_siaga_grant !== undefined
            ? Boolean((rawRec as any).sso_has_siaga_grant)
            : (ssoRef?.activeModuleAccess || []).some((m) => m.toLowerCase() === "siaga");

        if (hasSiagaGrant) {
          category = "ACTIVE";
          ssoReason = "User terdaftar aktif di Portal SSO dan telah memiliki otorisasi modul SIAGA.";
          report.categoriesBreakdown!.ACTIVE++;
        } else {
          category = "PENDING_SSO_GRANT";
          ssoReason = "User aktif di SSO dengan pemetaan bersih, menunggu otorisasi hak akses modul 'siaga' oleh IT.";
          report.pendingSsoGrantCount = (report.pendingSsoGrantCount || 0) + 1;
          report.categoriesBreakdown!.PENDING_SSO_GRANT++;
        }
      }
    }

    user.category = category;
    user.ssoStatus = category;
    // CRITICAL SAFETY RULE: status = ACTIVE only if account meets ALL approved SIAGA activation criteria (category === 'ACTIVE')
    user.status = category === "ACTIVE" ? "ACTIVE" : "INACTIVE";
  }

  if (normalizedList.length === 0) {
    return report;
  }

  // 2. Query database for existing matches across (external_user_id, nik, email)
  let existingRows: any[] = [];
  if (options.existingUsers) {
    existingRows = options.existingUsers;
  } else {
    try {
      const niksToQuery = normalizedList.map((u) => u.nik?.toLowerCase()).filter(Boolean) as string[];
      const emailsToQuery = normalizedList.map((u) => u.email?.toLowerCase()).filter(Boolean) as string[];
      const ssoIdsToQuery = normalizedList.map((u) => u.ssoId).filter(Boolean) as string[];

      if (niksToQuery.length > 0 || emailsToQuery.length > 0 || ssoIdsToQuery.length > 0) {
        const { rows } = await pool.query(
          `SELECT id, external_user_id, nik, name, email, system_role, business_role, scope, branch, status, source
           FROM users
           WHERE (nik IS NOT NULL AND LOWER(TRIM(nik)) = ANY($1::text[]))
              OR (email IS NOT NULL AND LOWER(TRIM(email)) = ANY($2::text[]))
              OR (external_user_id IS NOT NULL AND external_user_id = ANY($3::text[]))`,
          [niksToQuery, emailsToQuery, ssoIdsToQuery]
        );
        existingRows = rows;
      }
    } catch (dbErr: any) {
      if (dryRun) {
        report.errors.push(`Dry-run DB check offline: ${dbErr.message}`);
      } else {
        throw dbErr;
      }
    }
  }

  const existingByNik = new Map<string, any>();
  const existingByEmail = new Map<string, any>();
  const existingBySsoId = new Map<string, any>();

  for (const row of existingRows) {
    if (row.nik) existingByNik.set(row.nik.trim().toLowerCase(), row);
    if (row.email) existingByEmail.set(row.email.trim().toLowerCase(), row);
    if (row.external_user_id) existingBySsoId.set(row.external_user_id, row);
  }

  const plannedInserts: NormalizedSyncUser[] = [];
  const plannedUpdates: { user: NormalizedSyncUser; existingId: string; diff: any }[] = [];

  for (const user of normalizedList) {
    const identifier = user.nik || user.email || user.ssoId || "UNKNOWN";
    const matchBySso = user.ssoId ? existingBySsoId.get(user.ssoId) : undefined;
    const matchByNik = user.nik ? existingByNik.get(user.nik.toLowerCase()) : undefined;
    const matchByEmail = user.email ? existingByEmail.get(user.email.toLowerCase()) : undefined;

    // Detect ambiguous identity conflicts: e.g. NIK matches user A but Email matches user B
    if (matchByNik && matchByEmail && matchByNik.id !== matchByEmail.id) {
      report.flaggedForReviewCount++;
      report.pendingReviewCount = (report.pendingReviewCount || 0) + 1;
      report.categoriesBreakdown!.PENDING_REVIEW++;
      report.records.push({
        identifier,
        nik: user.nik,
        email: user.email,
        name: user.name,
        targetRole: user.businessRole,
        targetScope: user.scope,
        targetBranch: user.branch,
        secondaryBranches: user.secondaryBranches,
        sourceModule: user.sourceModule,
        status: "FLAGGED_FOR_REVIEW",
        category: "PENDING_REVIEW",
        ssoStatus: "PENDING_REVIEW",
        reason: `Konflik identitas: NIK '${user.nik}' merujuk user '${matchByNik.name}' (${matchByNik.id}), namun email '${user.email}' merujuk user '${matchByEmail.name}' (${matchByEmail.id}). Akun tidak digabung otomatis.`,
      });
      continue;
    }

    // Unmatched SSO accounts are retained in the reconciliation report for future IT SSO provisioning,
    // but strictly NOT inserted into SIAGA database without verified SSO corporate identity.
    if (user.category === "UNMATCHED_SSO") {
      report.skippedCount++;
      report.records.push({
        identifier,
        nik: user.nik,
        email: user.email,
        name: user.name,
        targetRole: user.businessRole,
        targetScope: user.scope,
        targetBranch: user.branch,
        secondaryBranches: user.secondaryBranches,
        sourceModule: user.sourceModule,
        status: "SKIPPED",
        category: "UNMATCHED_SSO",
        ssoStatus: "UNMATCHED_SSO",
        reason: "Pengguna belum terdaftar di Portal SSO. Ditahan dalam hasil rekonsiliasi tanpa pembuatan akun SIAGA.",
      });
      continue;
    }

    const existing = matchBySso || matchByNik || matchByEmail;

    if (!existing) {
      report.newCount++;
      plannedInserts.push(user);
      report.records.push({
        identifier,
        nik: user.nik,
        email: user.email,
        name: user.name,
        targetRole: user.businessRole,
        targetScope: user.scope,
        targetBranch: user.branch,
        secondaryBranches: user.secondaryBranches,
        sourceModule: user.sourceModule,
        status: "NEW",
        category: user.category,
        ssoStatus: user.ssoStatus,
        reason: user.needsReview
          ? `User baru terdaftar. Catatan: ${user.reviewReason}`
          : (user.category as string) === "PENDING_SSO_GRANT"
          ? "Pengguna baru disiapkan di SIAGA, menunggu otorisasi modul SIAGA di SSO."
          : (user.category as string) === "UNMATCHED_SSO"
          ? "Pengguna baru disiapkan di SIAGA, menunggu pendaftaran akun di Portal SSO."
          : "Pengguna baru terdaftar dari sinkronisasi ekosistem SPARTA.",
      });
    } else {
      // System Administrator is protected
      if (existing.system_role === "ADMIN") {
        report.unchangedCount++;
        report.records.push({
          identifier,
          nik: existing.nik,
          email: existing.email,
          name: existing.name,
          targetRole: existing.business_role,
          targetScope: existing.scope,
          targetBranch: existing.branch,
          secondaryBranches: user.secondaryBranches,
          sourceModule: user.sourceModule,
          status: "UNCHANGED",
          category: user.category,
          ssoStatus: user.ssoStatus,
          reason: "Akun adalah System Administrator dilindungi. Hak akses dan konfigurasi admin dipertahankan.",
        });
        continue;
      }

      // Multi-Role Conflict Protection:
      // In SIAGA's single-role model, an existing user's active role must NOT be silently overwritten
      // when imported from another source module with a different role.
      if (existing.business_role && user.businessRole && existing.business_role !== user.businessRole) {
        report.flaggedForReviewCount++;
        report.pendingReviewCount = (report.pendingReviewCount || 0) + 1;
        report.categoriesBreakdown!.PENDING_REVIEW++;
        const multiRoles: MultiRoleAssignment[] = [
          {
            module: "SIAGA_EXISTING" as any,
            sourceRole: existing.business_role,
            mappedRole: existing.business_role,
            isSupported: true,
            notes: "Peran aktif saat ini di database SIAGA (dipertahankan).",
          },
          {
            module: user.sourceModule,
            sourceRole: user.originalRole,
            mappedRole: user.businessRole,
            isSupported: true,
            notes: "Peran kandidat dari sinkronisasi ekosistem; ditahan untuk review dan tidak menimpa peran aktif.",
          },
        ];

        report.records.push({
          identifier,
          nik: existing.nik || user.nik,
          email: existing.email || user.email,
          name: user.name || existing.name,
          targetRole: existing.business_role, // PRESERVE existing active role
          targetScope: existing.scope,
          targetBranch: existing.branch,
          secondaryBranches: user.secondaryBranches,
          sourceModule: user.sourceModule,
          status: "FLAGGED_FOR_REVIEW",
          category: "PENDING_REVIEW",
          ssoStatus: "PENDING_REVIEW",
          reason: `Konflik multi-role: Pengguna sudah memiliki peran aktif '${existing.business_role}' di SIAGA. Peran '${user.businessRole}' dari ${user.sourceModule} ditahan untuk review dan tidak menimpa peran aktif secara otomatis.`,
          multiRoles,
        });
        continue;
      }

      // Compute field differences
      const diff: Record<string, { from: unknown; to: unknown }> = {};
      if (existing.name !== user.name) diff.name = { from: existing.name, to: user.name };
      if (user.email && existing.email !== user.email) diff.email = { from: existing.email, to: user.email };
      if (user.nik && !existing.nik) diff.nik = { from: null, to: user.nik };
      if (user.ssoId && !existing.external_user_id) diff.externalUserId = { from: null, to: user.ssoId };
      if (existing.business_role !== user.businessRole) diff.businessRole = { from: existing.business_role, to: user.businessRole };
      if (existing.scope !== user.scope) diff.scope = { from: existing.scope, to: user.scope };
      if (existing.branch !== user.branch) diff.branch = { from: existing.branch, to: user.branch };
      // Safety: Do not downgrade an existing ACTIVE user to INACTIVE when incoming candidate is only pending SSO grant
      if (existing.status === "ACTIVE" && user.status === "INACTIVE" && user.category === "PENDING_SSO_GRANT") {
        user.status = "ACTIVE";
      }
      if (existing.status !== user.status) diff.status = { from: existing.status, to: user.status };

      if (Object.keys(diff).length > 0) {
        if (allowUpdates) {
          report.updatedCount++;
          plannedUpdates.push({ user, existingId: existing.id, diff });
          report.records.push({
            identifier,
            nik: user.nik || existing.nik,
            email: user.email || existing.email,
            name: user.name,
            targetRole: user.businessRole,
            targetScope: user.scope,
            targetBranch: user.branch,
            secondaryBranches: user.secondaryBranches,
            sourceModule: user.sourceModule,
            status: "UPDATE",
            category: user.category,
            ssoStatus: user.ssoStatus,
            reason: `Data diperbarui: ${Object.keys(diff).join(", ")}.`,
            changedFields: diff,
          });
        } else {
          report.unchangedCount++;
          report.records.push({
            identifier,
            nik: existing.nik,
            email: existing.email,
            name: existing.name,
            targetRole: existing.business_role,
            targetScope: existing.scope,
            targetBranch: existing.branch,
            secondaryBranches: user.secondaryBranches,
            sourceModule: user.sourceModule,
            status: "UNCHANGED",
            category: user.category,
            ssoStatus: user.ssoStatus,
            reason: "Pengguna sudah ada dan pembaruan dinonaktifkan.",
          });
        }
      } else {
        report.unchangedCount++;
        report.records.push({
          identifier,
          nik: existing.nik,
          email: existing.email,
          name: user.name,
          targetRole: user.businessRole,
          targetScope: user.scope,
          targetBranch: user.branch,
          secondaryBranches: user.secondaryBranches,
          sourceModule: user.sourceModule,
          status: "UNCHANGED",
          category: user.category,
          ssoStatus: user.ssoStatus,
          reason: "Data mutakhir dan identik dengan database SIAGA.",
        });
      }
    }
  }

  // 3. Dry-Run stop
  if (dryRun) {
    return report;
  }

  // 4. Live execution within an atomic transaction
  const client: PoolClient = await pool.connect();
  try {
    if (isTestExecutionContext()) {
      await assertIsolatedDatabase(client);
    }

    await client.query("BEGIN;");

    // Check table columns dynamically for non-breaking backward compatibility
    let hasSsoStatusCol = false;
    let hasSecBranchesCol = false;
    let hasMultiRolesCol = false;
    let hasSyncMetadataCol = false;

    try {
      const { rows: cols } = await client.query(
        `SELECT column_name FROM information_schema.columns WHERE table_name = 'users'`
      );
      const colSet = new Set(cols.map((c: any) => c.column_name.toLowerCase()));
      hasSsoStatusCol = colSet.has("sso_status");
      hasSecBranchesCol = colSet.has("secondary_branches");
      hasMultiRolesCol = colSet.has("multi_roles");
      hasSyncMetadataCol = colSet.has("sync_metadata");
    } catch {
      // Proceed with baseline schema
    }

    // Insert new users
    for (const user of plannedInserts) {
      const idSeed = user.nik
        ? user.nik.toLowerCase().replace(/[^a-zA-Z0-9_-]/g, "")
        : (user.email?.split("@")[0] || "anon").replace(/[^a-zA-Z0-9_-]/g, "");

      const userId = user.ssoId || `usr_sparta_${idSeed}_${Date.now().toString(36)}`;

      if (hasSsoStatusCol) {
        await client.query(
          `INSERT INTO users (
            id, external_user_id, nik, name, email, system_role, business_role, scope, branch, status, source, sso_status, secondary_branches, multi_roles, sync_metadata, created_at, updated_at
          ) VALUES ($1, $2, $3, $4, $5, 'USER', $6, $7, $8, $9, $10, $11, $12::jsonb, $13::jsonb, $14::jsonb, NOW(), NOW())`,
          [
            userId,
            user.ssoId,
            user.nik ? user.nik.trim() : null,
            user.name.trim(),
            user.email || null,
            user.businessRole,
            user.scope,
            user.branch,
            user.status,
            user.source,
            user.ssoStatus || "PENDING_SSO_GRANT",
            JSON.stringify(user.secondaryBranches || []),
            JSON.stringify(user.multiRoles || []),
            JSON.stringify({ syncedAt: new Date().toISOString(), sourceModule: user.sourceModule }),
          ]
        );
      } else {
        await client.query(
          `INSERT INTO users (
            id, external_user_id, nik, name, email, system_role, business_role, scope, branch, status, source, created_at, updated_at
          ) VALUES ($1, $2, $3, $4, $5, 'USER', $6, $7, $8, $9, $10, NOW(), NOW())`,
          [
            userId,
            user.ssoId,
            user.nik ? user.nik.trim() : null,
            user.name.trim(),
            user.email || null,
            user.businessRole,
            user.scope,
            user.branch,
            user.status,
            user.source,
          ]
        );
      }
    }

    // Update existing users
    for (const update of plannedUpdates) {
      const { user, existingId } = update;
      if (hasSsoStatusCol) {
        await client.query(
          `UPDATE users SET
            name = $1,
            email = COALESCE($2, email),
            nik = COALESCE($3, nik),
            external_user_id = COALESCE($4, external_user_id),
            business_role = $5,
            scope = $6,
            branch = $7,
            status = $8,
            sso_status = $9,
            secondary_branches = $10::jsonb,
            source = 'SPARTA_SYNC',
            updated_at = NOW()
          WHERE id = $11`,
          [
            user.name.trim(),
            user.email || null,
            user.nik ? user.nik.trim() : null,
            user.ssoId || null,
            user.businessRole,
            user.scope,
            user.branch,
            user.status,
            user.ssoStatus || "PENDING_SSO_GRANT",
            JSON.stringify(user.secondaryBranches || []),
            existingId,
          ]
        );
      } else {
        await client.query(
          `UPDATE users SET
            name = $1,
            email = COALESCE($2, email),
            nik = COALESCE($3, nik),
            external_user_id = COALESCE($4, external_user_id),
            business_role = $5,
            scope = $6,
            branch = $7,
            status = $8,
            source = 'SPARTA_SYNC',
            updated_at = NOW()
          WHERE id = $9`,
          [
            user.name.trim(),
            user.email || null,
            user.nik ? user.nik.trim() : null,
            user.ssoId || null,
            user.businessRole,
            user.scope,
            user.branch,
            user.status,
            existingId,
          ]
        );
      }
    }

    await client.query("COMMIT;");
  } catch (err: any) {
    await client.query("ROLLBACK;");
    const errMsg = `Gagal mengeksekusi transaksi sinkronisasi user: ${err.message}`;
    report.errors.push(errMsg);
    throw new Error(errMsg);
  } finally {
    client.release();
  }

  return report;
}

/**
 * Universal Sparta Real Data Import Adapter:
 * Parses CSV/JSON from Building, Maintenance, Engineering, and SSO formats.
 */
export function parseSpartaUserCsv(csvText: string, defaultModule?: string): RawSpartaUserRecord[] {
  const lines = csvText.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return [];

  const headerLine = lines[0];
  const delimiter = headerLine.includes(";") && !headerLine.includes(",") ? ";" : ",";
  const headers = headerLine.split(delimiter).map((h) => h.trim().replace(/^["']|["']$/g, ""));

  const getColIndex = (names: string[]): number => {
    for (const n of names) {
      const idx = headers.findIndex((h) => h.toLowerCase() === n.toLowerCase());
      if (idx !== -1) return idx;
    }
    return -1;
  };

  const emailIdx = getColIndex(["email", "email_sat", "surel", "email_address"]);
  const nameIdx = getColIndex(["fullName", "name", "nama_lengkap", "nama", "full_name"]);
  const nikIdx = getColIndex(["employeeId", "nik", "nip", "no_karyawan", "id_karyawan"]);
  const ssoIdIdx = getColIndex(["ssoId", "externalUserId", "external_user_id", "id"]);
  const branchIdx = getColIndex(["branchCode", "branchName", "branch", "cabang", "kode_cabang", "nama_cabang", "location", "lokasi"]);
  const roleIdx = getColIndex(["role", "moduleRole", "jabatan", "posisi", "role_name", "nama_jabatan"]);
  const statusIdx = getColIndex(["status", "isActive", "is_active", "aktif", "status_karyawan"]);
  const moduleIdx = getColIndex(["moduleId", "system", "module", "source_module", "sumber"]);

  const records: RawSpartaUserRecord[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const values: string[] = [];
    let insideQuotes = false;
    let current = "";

    for (let c = 0; c < line.length; c++) {
      const char = line[c];
      if (char === '"') {
        insideQuotes = !insideQuotes;
      } else if (char === delimiter && !insideQuotes) {
        values.push(current.trim().replace(/^["']|["']$/g, ""));
        current = "";
      } else {
        current += char;
      }
    }
    values.push(current.trim().replace(/^["']|["']$/g, ""));

    const getValue = (idx: number): string | null => {
      if (idx === -1 || idx >= values.length) return null;
      const v = values[idx]?.trim();
      return v ? v : null;
    };

    records.push({
      email: getValue(emailIdx),
      email_sat: getValue(emailIdx),
      fullName: getValue(nameIdx),
      employeeId: getValue(nikIdx),
      nik: getValue(nikIdx),
      ssoId: getValue(ssoIdIdx),
      branchName: getValue(branchIdx),
      role: getValue(roleIdx),
      isActive: getValue(statusIdx),
      status: getValue(statusIdx),
      moduleId: getValue(moduleIdx) || defaultModule || null,
      system: getValue(moduleIdx) || defaultModule || null,
    });
  }

  return records;
}

/**
 * Builds a normalized lookup map of SSO users keyed by lowercased email.
 */
export function buildSsoReferenceMap(
  ssoRecords: (RawSpartaUserRecord | SsoUserReference)[]
): Map<string, SsoUserReference> {
  const map = new Map<string, SsoUserReference>();
  for (const r of ssoRecords) {
    if (r.email) {
      const lower = r.email.toLowerCase().trim();
      const activeModules =
        (r as any).activeModuleAccess ||
        (r as any).active_module_access ||
        (r as any).activeModules ||
        [];
      map.set(lower, {
        email: lower,
        nik: r.nik || (r as any).employeeId || null,
        ssoId: (r as any).ssoId || (r as any).externalUserId || null,
        name: (r as any).name || (r as any).fullName || null,
        status:
          typeof r.status === "string"
            ? r.status
            : r.status || (r as any).isActive
            ? "ACTIVE"
            : "INACTIVE",
        activeModuleAccess: Array.isArray(activeModules) ? activeModules : [],
      });
    }
  }
  return map;
}

/**
 * Converts reconciled report items (e.g. from reconciliation_rerun_full_report.json)
 * into RawSpartaUserRecord[] for user sync processing.
 */
export function convertReconciledReportToRawRecords(
  reportData: Record<string, any>
): RawSpartaUserRecord[] {
  const records: RawSpartaUserRecord[] = [];
  for (const [email, r] of Object.entries(reportData)) {
    const nik = Array.isArray(r.niks) && r.niks.length > 0 ? r.niks[0] : null;
    const name =
      Array.isArray(r.names) && r.names.length > 0
        ? r.names[0]
        : email.split("@")[0] || "USER";
    const source =
      Array.isArray(r.sources) && r.sources.length > 0
        ? r.sources[0]
        : "SPARTA_ECOSYSTEM";
    const mappedRoles = Array.isArray(r.mapped_siaga_roles) ? r.mapped_siaga_roles : [];
    const sourceRoles = r.source_roles || {};
    const primaryRole =
      mappedRoles.length === 1
        ? mappedRoles[0]
        : Object.values(sourceRoles)[0] || (mappedRoles.length > 1 ? mappedRoles[0] : "support");
    const canonicalBranches = Array.isArray(r.canonical_branches) ? r.canonical_branches : [];
    const nonCanonicalBranches = Array.isArray(r.non_canonical_branches) ? r.non_canonical_branches : [];
    const primaryBranch =
      canonicalBranches.length > 0
        ? canonicalBranches[0]
        : nonCanonicalBranches.length > 0
        ? nonCanonicalBranches[0]
        : null;

    // Detect role conflicts across disparate roles
    const conflicts = Array.isArray(r.conflicts) ? [...r.conflicts] : [];
    if (mappedRoles.length > 1) {
      conflicts.push(`Multi-role disparitas terdeteksi: ${mappedRoles.join(", ")}`);
    }

    records.push({
      email,
      email_sat: email,
      nik,
      employeeId: nik,
      fullName: name,
      name,
      role: primaryRole,
      sourceModule: source,
      system: source,
      branchName: primaryBranch,
      branch: primaryBranch,
      canonicalBranches,
      nonCanonicalBranches,
      is_active: !r.is_soft_deleted,
      isActive: !r.is_soft_deleted,
      status: r.is_soft_deleted ? "INACTIVE" : "ACTIVE",
      deleted_at: r.is_soft_deleted ? "2026-01-01T00:00:00Z" : null,
      ssoMatched: r.sso_match_type && r.sso_match_type !== "NONE",
      ssoMatchType: r.sso_match_type,
      ssoStatus: r.sso_status,
      hasSiagaGrant: Boolean(r.sso_has_siaga_grant),
      conflicts,
    });
  }
  return records;
}
