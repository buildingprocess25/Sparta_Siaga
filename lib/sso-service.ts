import { getDbPool } from "./db";
import type { Pool } from "pg";
import { UserModel } from "./user-db";
import { createDeviceSession, SessionCreationResult } from "./session-service";
import { identityParameters, selectSpartaIdentity, SPARTA_IDENTITY_WHERE, SpartaIntegrationError } from "./sparta-identity";

export interface SsoExchangeUser {
  contractVersion?: number;
  spartaUserId?: string | null;
  branchCode?: string | null;
  email?: string | null;
  fullName?: string | null;
  branch?: string | null;
  access?: string[] | null;
  nik?: string | null;
  employeeId?: string | null;
  id?: string | null;
  externalUserId?: string | null;
}

export interface SsoExchangeSuccessData {
  user: SsoExchangeUser;
}

export type SsoExchangeResult =
  | { success: true; user: SsoExchangeUser }
  | { success: false; errorCode: string; errorMessage: string; status: number };

export type SsoIdentityMatchResult =
  | { status: "MATCHED"; user: UserModel }
  | { status: "NOT_FOUND"; reason: string }
  | { status: "AMBIGUOUS"; reason: string }
  | { status: "INACTIVE"; user: UserModel; reason: string }
  | { status: "DEACTIVATED_ROLE"; user: UserModel; reason: string }
  | { status: "PENDING_SSO_GRANT"; user: UserModel; reason: string }
  | { status: "UNMATCHED_SSO"; user: UserModel; reason: string }
  | { status: "PENDING_REVIEW"; user: UserModel; reason: string }
  | { status: "BLOCKED"; user: UserModel; reason: string };

/**
 * Validates whether the authenticated SSO user has access to the 'siaga' module.
 */
export function validateSsoModuleAccess(user: SsoExchangeUser): boolean {
  if (!user || !Array.isArray(user.access)) {
    return false;
  }
  return user.access.map((m) => m.toLowerCase().trim()).includes("siaga");
}

/**
 * Exchanges a one-time launch token with the SPARTA SSO portal.
 * Never logs launch tokens or sensitive user payloads.
 */
export async function exchangeSpartaLaunchToken(
  launchToken: string,
  options?: {
    spartaApiUrl?: string;
    fetchFn?: typeof fetch;
    timeoutMs?: number;
  }
): Promise<SsoExchangeResult> {
  const cleanToken = (launchToken || "").trim();
  if (!cleanToken) {
    return {
      success: false,
      errorCode: "INVALID_SSO_TOKEN",
      errorMessage: "Token SSO tidak valid atau kosong.",
      status: 400,
    };
  }

  const spartaApiUrl = (
    options?.spartaApiUrl ||
    process.env.SPARTA_API_URL ||
    "http://localhost:10000"
  ).replace(/\/+$/, "");

  const customFetch = options?.fetchFn || fetch;
  const timeoutMs = options?.timeoutMs || 5000;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await customFetch(`${spartaApiUrl}/v1/sso/exchange`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        moduleId: "siaga",
        launchToken: cleanToken,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    const json = await response.json().catch(() => null);

    if (!response.ok) {
      const code = json?.error?.code || (response.status === 403 ? "SSO_MODULE_MISMATCH" : "INVALID_SSO_TOKEN");
      const message = json?.error?.message || "Pertukaran token SSO gagal.";
      return {
        success: false,
        errorCode: code,
        errorMessage: message,
        status: response.status,
      };
    }

    const userData = json?.data?.user;
    if (!userData || typeof userData !== "object") {
      return {
        success: false,
        errorCode: "INVALID_SSO_PAYLOAD",
        errorMessage: "Payload user dari SPARTA Login Portal tidak valid.",
        status: 400,
      };
    }

    return {
      success: true,
      user: {
        contractVersion: userData.contractVersion,
        spartaUserId: typeof userData.spartaUserId === "string" ? userData.spartaUserId.trim() : null,
        branchCode: typeof userData.branchCode === "string" ? userData.branchCode.trim() : null,
        email: userData.email ? String(userData.email).trim().toLowerCase() : null,
        fullName: userData.fullName || userData.name || null,
        branch: userData.branch || userData.branchName || null,
        access: Array.isArray(userData.access) ? userData.access : [],
        nik: userData.nik || userData.employeeId || null,
        employeeId: userData.employeeId || userData.nik || null,
        id: userData.spartaUserId || userData.id || userData.externalUserId || null,
        externalUserId: userData.spartaUserId || userData.externalUserId || userData.id || null,
      },
    };
  } catch (error: any) {
    clearTimeout(timeoutId);
    if (error?.name === "AbortError") {
      return {
        success: false,
        errorCode: "SSO_SERVICE_TIMEOUT",
        errorMessage: "Koneksi ke SPARTA Login Portal mengalami batas waktu habis (timeout).",
        status: 504,
      };
    }
    return {
      success: false,
      errorCode: "SSO_SERVICE_UNAVAILABLE",
      errorMessage: "Layanan autentikasi SPARTA Login Portal sedang tidak tersedia.",
      status: 503,
    };
  }
}
/**
 * Validates whether a user has an approved role and branch assignment in SIAGA.
 * - System Administrator: systemRole === 'ADMIN' (always approved)
 * - Head Office Admin: role 'admin', 'ho_admin', 'gm_ho', 'sm_ho' with scope 'HO' (approved)
 * - Branch Roles: role 'bm', 'bmc', 'bec', 'bbc', 'bms', 'bes', 'bbs' with scope 'BRANCH'|'CABANG'|'WILAYAH'
 *   and non-empty branch assignment.
 * - Roles 'tim_toko' and 'rekanan' are rejected.
 */
export function isApprovedRoleAndBranch(user: {
  systemRole?: string | null;
  businessRole?: string | null;
  scope?: string | null;
  branch?: string | null;
}): boolean {
  if (user.systemRole === "ADMIN") {
    return true;
  }

  const role = (user.businessRole || "").toLowerCase().trim();
  if (!role) return false;

  // Deactivated roles
  if (["tim_toko", "rekanan"].includes(role)) {
    return false;
  }

  const APPROVED_HO_ROLES = ["admin", "ho_admin", "gm_ho", "sm_ho"];
  const APPROVED_BRANCH_ROLES = ["bm", "bmc", "bec", "bbc", "bms", "bes", "bbs"];

  const scope = (user.scope || "").toUpperCase().trim();

  if (APPROVED_HO_ROLES.includes(role)) {
    return scope === "HO" || scope === "";
  }

  if (APPROVED_BRANCH_ROLES.includes(role)) {
    const hasBranch = Boolean(user.branch && user.branch.trim().length > 0 && user.branch.trim() !== "-");
    const validScope = ["BRANCH", "CABANG", "WILAYAH"].includes(scope);
    return hasBranch && validScope;
  }

  return false;
}

/**
 * Matches an authenticated SSO identity against existing SIAGA users.
 * - Requires at least one approved identifier (SSO ID, NIK, or normalized email).
 * - Enforces zero automatic user creation.
 * - Detects and rejects ambiguous matches (e.g. cross-identity conflicts).
 * - Safe Just-In-Time activation for PENDING_SSO_GRANT candidates upon verified grant.
 * - Enforces strict rejection for BLOCKED, UNMATCHED_SSO, PENDING_REVIEW, and INACTIVE.
 */
export async function matchSsoIdentityToSiagaUser(
  ssoUser: SsoExchangeUser,
  options: { pool?: Pick<Pool, "query"> } = {}
): Promise<SsoIdentityMatchResult> {
  const pool = options.pool || getDbPool();

  const rawSsoId = (ssoUser.spartaUserId || ssoUser.externalUserId || ssoUser.id || "").trim();
  const rawNik = (ssoUser.nik || ssoUser.employeeId || "").trim();
  const rawEmail = (ssoUser.email || "").trim().toLowerCase();

  const ssoId = rawSsoId.length > 0 ? rawSsoId : null;
  const nik = rawNik.length > 0 ? rawNik : null;
  const email = rawEmail.includes("@") && rawEmail.includes(".") ? rawEmail : null;

  if (!ssoId && !nik && !email) {
    return {
      status: "NOT_FOUND",
      reason: "Payload SSO tidak menyertakan identitas yang valid (email, NIK, atau SSO ID kosong).",
    };
  }

  const { rows } = await pool.query(
    `SELECT * FROM users WHERE ${SPARTA_IDENTITY_WHERE}`,
    identityParameters({ spartaUserId: ssoId, employeeId: nik, email })
  );

  if (rows.length === 0) {
    return {
      status: "NOT_FOUND",
      reason: `Pengguna dengan identitas '${email || nik || ssoId}' tidak ditemukan di database SIAGA. Pengguna harus disinkronkan terlebih dahulu.`,
    };
  }

  let row;
  try {
    row = selectSpartaIdentity(rows, { spartaUserId: ssoId, employeeId: nik, email });
  } catch (error) {
    if (error instanceof SpartaIntegrationError) return { status: "AMBIGUOUS", reason: error.message };
    throw error;
  }
  if (!row) return { status: "NOT_FOUND", reason: "Identitas SSO tidak ditemukan." };
  const user: UserModel = {
    id: row.id,
    externalUserId: row.external_user_id,
    nik: row.nik,
    name: row.name,
    email: row.email,
    systemRole: row.system_role,
    businessRole: row.business_role,
    scope: row.scope,
    branch: row.branch,
    branchCode: row.branch_code ?? null,
    status: row.status,
    source: row.source || "SSO",
    ssoStatus: row.sso_status !== undefined ? row.sso_status : null,
    tokenVersion: row.token_version ? Number(row.token_version) : 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  // 1. Deactivated roles: tim_toko and rekanan are blocked from application access
  const DEACTIVATED_BUSINESS_ROLES = ["tim_toko", "rekanan"];
  if (user.businessRole && DEACTIVATED_BUSINESS_ROLES.includes(user.businessRole.toLowerCase())) {
    return {
      status: "DEACTIVATED_ROLE",
      user,
      reason: `Akun '${user.name}' memiliki peran '${user.businessRole}' yang telah dinonaktifkan dari sistem.`,
    };
  }

  // 2. Enforce sso_status for synchronized users
  if (user.ssoStatus) {
    const ssoUpper = user.ssoStatus.toUpperCase().trim();

    // 2a. BLOCKED accounts: soft-deleted or explicitly blocked
    if (ssoUpper === "BLOCKED") {
      return {
        status: "BLOCKED",
        user,
        reason: `Akun '${user.name}' (${user.id}) telah diblokir/dinonaktifkan (BLOCKED).`,
      };
    }

    // 2b. UNMATCHED_SSO accounts: not in SSO export
    if (ssoUpper === "UNMATCHED_SSO") {
      return {
        status: "UNMATCHED_SSO",
        user,
        reason: `Akun '${user.name}' (${user.id}) belum terdaftar di Portal SSO (UNMATCHED_SSO).`,
      };
    }

    // 2c. PENDING_REVIEW accounts: anomalies or pending administrative review
    if (ssoUpper === "PENDING_REVIEW") {
      return {
        status: "PENDING_REVIEW",
        user,
        reason: `Akun '${user.name}' (${user.id}) masih dalam proses review perizinan (PENDING_REVIEW).`,
      };
    }

    // 2d. PENDING_SSO_GRANT accounts: synchronized users waiting for valid SSO login & SIAGA grant
    if (ssoUpper === "PENDING_SSO_GRANT") {
      // Step A: Verify SIAGA module access grant in SSO token
      const hasSiagaGrant = validateSsoModuleAccess(ssoUser);
      if (!hasSiagaGrant) {
        return {
          status: "PENDING_SSO_GRANT",
          user,
          reason: `Akun '${user.name}' (${user.id}) menunggu otorisasi akses modul SIAGA di Portal SSO (PENDING_SSO_GRANT).`,
        };
      }

      // Step B: Verify approved local role and branch assignment in SIAGA
      if (!isApprovedRoleAndBranch(user) || (user.source === "SPARTA" && !user.scope && user.systemRole !== "ADMIN")) {
        return {
          status: "PENDING_REVIEW",
          user,
          reason: `Akun '${user.name}' (${user.id}) belum memiliki peran atau cabang yang memenuhi syarat otorisasi SIAGA.`,
        };
      }

      // Step C: Just-In-Time safe activation in SIAGA database
      const updateRes = await pool.query(
        `UPDATE users
         SET status = 'ACTIVE',
             sso_status = 'ACTIVE',
             external_user_id = COALESCE(NULLIF(BTRIM(users.external_user_id), ''), $2),
             updated_at = NOW()
         WHERE id = $1 AND sso_status='PENDING_SSO_GRANT'
           AND (NULLIF(BTRIM(external_user_id),'') IS NULL OR external_user_id=$2)
         RETURNING id, external_user_id, nik, name, email, system_role, business_role, scope, branch, status, sso_status, token_version`,
        [user.id, ssoId]
      );

      if (!updateRes.rows.length) return { status: "INACTIVE", user, reason: "Status akun berubah saat aktivasi SSO." };
      if (updateRes.rows.length > 0) {
        const uRow = updateRes.rows[0];
        user.status = "ACTIVE";
        user.ssoStatus = "ACTIVE";
        user.externalUserId = uRow.external_user_id;
      }

      return {
        status: "MATCHED",
        user,
      };
    }

    // 2e. Any other non-ACTIVE ssoStatus
    if (ssoUpper !== "ACTIVE") {
      return {
        status: "INACTIVE",
        user,
        reason: `Status sinkronisasi akun '${user.name}' (${user.id}) tidak valid untuk akses SIAGA (${user.ssoStatus}).`,
      };
    }
  }

  // 3. Status check: inactive accounts must not be authenticated
  if (user.status !== "ACTIVE") {
    return {
      status: "INACTIVE",
      user,
      reason: `Akun '${user.name}' (${user.id}) berstatus nonaktif di database SIAGA.`,
    };
  }

  if (!isApprovedRoleAndBranch(user) || (user.source === "SPARTA" && !user.scope && user.systemRole !== "ADMIN")) {
    return { status: "PENDING_REVIEW", user, reason: "Peran atau cakupan cabang akun belum valid untuk akses SIAGA." };
  }

  if (ssoId && !user.externalUserId) {
    const linked = await pool.query(`UPDATE users SET external_user_id=$2,updated_at=NOW()
      WHERE id=$1 AND status='ACTIVE' AND (sso_status IS NULL OR sso_status='ACTIVE')
      AND (external_user_id IS NULL OR BTRIM(external_user_id)='' OR external_user_id=$2)
      RETURNING external_user_id`, [user.id, ssoId]);
    if (!linked.rows.length) return { status: "AMBIGUOUS", reason: "Identitas akun berubah saat pencocokan SSO." };
    user.externalUserId = linked.rows[0].external_user_id;
  }
  return {
    status: "MATCHED",
    user,
  };
}

/**
 * Creates a verified local per-device session for an authenticated SSO user.
 */
export async function createSsoSessionForUser(
  user: UserModel,
  requestInfo?: {
    userAgent?: string | null;
    ipAddress?: string | null;
  }
): Promise<SessionCreationResult | null> {
  return createDeviceSession({
    userId: user.id,
    userAgent: requestInfo?.userAgent || null,
    ipAddress: requestInfo?.ipAddress || null,
    tokenVersion: user.tokenVersion || 1,
  });
}

/**
 * Maps SSO failure codes into safe, user-friendly redirect query parameters.
 */
export function mapSsoErrorCodeToRedirect(errorCode: string): string {
  switch (errorCode) {
    case "SSO_TOKEN_EXPIRED":
      return "TokenExpired";
    case "SSO_TOKEN_CONSUMED":
      return "TokenConsumed";
    case "SSO_MODULE_MISMATCH":
      return "ModuleMismatch";
    case "UNAUTHORIZED_MODULE":
      return "UnauthorizedModule";
    case "USER_NOT_FOUND":
      return "UserNotFound";
    case "USER_INACTIVE":
      return "InactiveAccount";
    case "AMBIGUOUS_IDENTITY":
      return "AmbiguousIdentity";
    case "DEACTIVATED_ROLE":
      return "DeactivatedRole";
    case "PENDING_SSO_GRANT":
      return "PendingSsoGrant";
    case "UNMATCHED_SSO":
      return "UnmatchedSso";
    case "PENDING_REVIEW":
      return "PendingReview";
    case "BLOCKED":
    case "USER_BLOCKED":
      return "UserBlocked";
    case "SSO_SERVICE_UNAVAILABLE":
    case "SSO_SERVICE_TIMEOUT":
      return "SsoServiceUnavailable";
    case "INVALID_SSO_PAYLOAD":
      return "InvalidPayload";
    case "SESSION_CREATION_FAILED":
      return "SessionCreationFailed";
    case "INVALID_SSO_TOKEN":
    default:
      return "InvalidToken";
  }
}
export interface SsoModuleGrantResult {
  status: "ACTIVE" | "REVOKED" | "NO_GRANT" | "UNVERIFIED" | "LOCAL";
  label: string;
  error?: string | null;
  verifiedAt: string | null;
  role?: string | null;
}

// In-memory cache for batch queries: externalUserId -> { result, cachedAt }
const grantCache = new Map<string, { result: SsoModuleGrantResult; cachedAt: number }>();
const CACHE_TTL_MS = 60 * 1000; // 60 seconds TTL

export function clearGrantCache(): void {
  grantCache.clear();
}

/**
 * Honest grant query fallback aligned with the actual Portal SPARTA API contract.
 * Portal SPARTA exposes `POST /v1/sso/exchange` (login-time check) and pushes access updates
 * via `POST /internal/sparta/provision`, and does NOT provide `/v1/sso/module-access/batch`.
 * Therefore live portal grant status cannot be polled on demand and is reported strictly as UNVERIFIED.
 */
export async function querySpartaBatchModuleGrants(
  externalUserIds: string[],
  _options?: {
    spartaApiUrl?: string;
    internalApiKey?: string;
    fetchFn?: typeof fetch;
    timeoutMs?: number;
    skipCache?: boolean;
  }
): Promise<Map<string, SsoModuleGrantResult>> {
  const results = new Map<string, SsoModuleGrantResult>();
  if (!externalUserIds || externalUserIds.length === 0) {
    return results;
  }

  for (const rawId of externalUserIds) {
    const id = (rawId || "").trim();
    if (!id) continue;
    results.set(id, {
      status: "UNVERIFIED",
      label: "Belum Diverifikasi",
      error: "Portal SPARTA tidak menyediakan endpoint baca-saja untuk verifikasi grant langsung. Akses diverifikasi saat login SSO (/v1/sso/exchange) dan diperbarui melalui webhook provisioning.",
      verifiedAt: null,
    });
  }

  return results;
}

/**
 * Single-user wrapper returning the contract-aligned UNVERIFIED result without calling an unavailable endpoint.
 */
export async function querySpartaUserModuleGrant(
  externalUserId: string,
  options?: {
    spartaApiUrl?: string;
    internalApiKey?: string;
    fetchFn?: typeof fetch;
    timeoutMs?: number;
    skipCache?: boolean;
  }
): Promise<SsoModuleGrantResult> {
  const cleanId = (externalUserId || "").trim();
  if (!cleanId) {
    return {
      status: "UNVERIFIED",
      label: "Belum Diverifikasi",
      error: "ID pengguna eksternal SSO kosong.",
      verifiedAt: null,
    };
  }

  const batchResults = await querySpartaBatchModuleGrants([cleanId], options);
  return (
    batchResults.get(cleanId) ?? {
      status: "UNVERIFIED",
      label: "Belum Diverifikasi",
      verifiedAt: null,
    }
  );
}

