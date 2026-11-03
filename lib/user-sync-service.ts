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
  if (roleRes.scope === "HO") {
    branch = null; // Head Office is strictly null
  } else {
    const rawBranch = (
      raw.branch ||
      raw.cabang ||
      raw.branchCode ||
      raw.branchName ||
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
    raw.is_active === 0
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

  return {
    user: {
      ssoId,
      nik,
      email,
      name: rawName,
      businessRole: roleRes.role,
      scope: (roleRes.scope || (roleRes.role === "admin" ? "HO" : "BRANCH")) as "HO" | "BRANCH",
      branch,
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
    rolesBreakdown: {},
    branchesBreakdown: {},
    records: [],
    errors: [],
  };

  for (const role of FINALIZED_SIAGA_BUSINESS_ROLES) {
    report.rolesBreakdown[role] = 0;
  }

  // 1. Process and normalize records with identity conflict checking
  const normalizedList: NormalizedSyncUser[] = [];
  const seenNiksInBatch = new Map<string, NormalizedSyncUser>();
  const seenEmailsInBatch = new Map<string, NormalizedSyncUser>();
  const seenSsoIdsInBatch = new Map<string, NormalizedSyncUser>();

  for (const raw of records) {
    const identifier = (raw.nik || raw.employeeId || raw.email || raw.email_sat || raw.ssoId || raw.id || "UNKNOWN").trim();
    const { user, error, isFlagged } = validateAndNormalizeSpartaUser(raw);

    if (!user) {
      if (isFlagged) {
        report.flaggedForReviewCount++;
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
          reason: error,
        });
      }
      continue;
    }

    // Intra-batch duplicate & multi-role detection
    const lowerNik = user.nik ? user.nik.toLowerCase() : null;
    const lowerEmail = user.email ? user.email.toLowerCase() : null;
    const ssoKey = user.ssoId ? user.ssoId : null;

    let existingInBatch: NormalizedSyncUser | undefined;
    if (lowerNik && seenNiksInBatch.has(lowerNik)) existingInBatch = seenNiksInBatch.get(lowerNik);
    else if (lowerEmail && seenEmailsInBatch.has(lowerEmail)) existingInBatch = seenEmailsInBatch.get(lowerEmail);
    else if (ssoKey && seenSsoIdsInBatch.has(ssoKey)) existingInBatch = seenSsoIdsInBatch.get(ssoKey);

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
        report.records.push({
          identifier,
          nik: user.nik,
          email: user.email,
          name: user.name,
          targetRole: user.businessRole,
          targetScope: user.scope,
          targetBranch: user.branch,
          sourceModule: user.sourceModule,
          status: "FLAGGED_FOR_REVIEW",
          reason: `Multi-role terdeteksi: '${existingInBatch.businessRole}' di ${existingInBatch.sourceModule} dan '${user.businessRole}' di ${user.sourceModule}. Peran utama dipertahankan, assignment multi-role dicatat.`,
          multiRoles: existingInBatch.multiRoles,
        });
        continue;
      } else {
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

  if (normalizedList.length === 0) {
    return report;
  }

  // 2. Query database for existing matches across (external_user_id, nik, email)
  const niksToQuery = normalizedList.map((u) => u.nik?.toLowerCase()).filter(Boolean) as string[];
  const emailsToQuery = normalizedList.map((u) => u.email?.toLowerCase()).filter(Boolean) as string[];
  const ssoIdsToQuery = normalizedList.map((u) => u.ssoId).filter(Boolean) as string[];

  const { rows: existingRows } = await pool.query(
    `SELECT id, external_user_id, nik, name, email, system_role, business_role, scope, branch, status, source
     FROM users
     WHERE (nik IS NOT NULL AND LOWER(TRIM(nik)) = ANY($1::text[]))
        OR (email IS NOT NULL AND LOWER(TRIM(email)) = ANY($2::text[]))
        OR (external_user_id IS NOT NULL AND external_user_id = ANY($3::text[]))`,
    [niksToQuery, emailsToQuery, ssoIdsToQuery]
  );

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
      report.records.push({
        identifier,
        nik: user.nik,
        email: user.email,
        name: user.name,
        targetRole: user.businessRole,
        targetScope: user.scope,
        targetBranch: user.branch,
        sourceModule: user.sourceModule,
        status: "FLAGGED_FOR_REVIEW",
        reason: `Konflik identitas: NIK '${user.nik}' merujuk user '${matchByNik.name}' (${matchByNik.id}), namun email '${user.email}' merujuk user '${matchByEmail.name}' (${matchByEmail.id}). Akun tidak digabung otomatis.`,
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
        sourceModule: user.sourceModule,
        status: "NEW",
        reason: user.needsReview
          ? `User baru terdaftar. Catatan: ${user.reviewReason}`
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
          sourceModule: user.sourceModule,
          status: "UNCHANGED",
          reason: "Akun adalah System Administrator dilindungi. Hak akses dan konfigurasi admin dipertahankan.",
        });
        continue;
      }

      // Multi-Role Conflict Protection:
      // In SIAGA's single-role model, an existing user's active role must NOT be silently overwritten
      // when imported from another source module with a different role.
      if (existing.business_role && user.businessRole && existing.business_role !== user.businessRole) {
        report.flaggedForReviewCount++;
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
          sourceModule: user.sourceModule,
          status: "FLAGGED_FOR_REVIEW",
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
            sourceModule: user.sourceModule,
            status: "UPDATE",
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
            sourceModule: user.sourceModule,
            status: "UNCHANGED",
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
          sourceModule: user.sourceModule,
          status: "UNCHANGED",
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

    // Insert new users
    for (const user of plannedInserts) {
      const idSeed = user.nik
        ? user.nik.toLowerCase().replace(/[^a-zA-Z0-9_-]/g, "")
        : (user.email?.split("@")[0] || "anon").replace(/[^a-zA-Z0-9_-]/g, "");

      const userId = user.ssoId || `usr_sparta_${idSeed}_${Date.now().toString(36)}`;

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

    // Update existing users
    for (const update of plannedUpdates) {
      const { user, existingId } = update;
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
