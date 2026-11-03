import { getDbPool } from "./db";
import { UserModel } from "./user-db";
import { createDeviceSession, SessionCreationResult } from "./session-service";

export interface SsoExchangeUser {
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
  | { status: "DEACTIVATED_ROLE"; user: UserModel; reason: string };

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
        email: userData.email ? String(userData.email).trim().toLowerCase() : null,
        fullName: userData.fullName || userData.name || null,
        branch: userData.branch || userData.branchName || null,
        access: Array.isArray(userData.access) ? userData.access : [],
        nik: userData.nik || userData.employeeId || null,
        employeeId: userData.employeeId || userData.nik || null,
        id: userData.id || userData.externalUserId || null,
        externalUserId: userData.externalUserId || userData.id || null,
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
 * Matches an authenticated SSO identity against existing SIAGA users.
 * - Requires at least one approved identifier (SSO ID, NIK, or normalized email).
 * - Enforces zero automatic user creation.
 * - Detects and rejects ambiguous matches (e.g. cross-identity conflicts).
 * - Verifies user active status.
 */
export async function matchSsoIdentityToSiagaUser(
  ssoUser: SsoExchangeUser
): Promise<SsoIdentityMatchResult> {
  const pool = getDbPool();

  const rawSsoId = (ssoUser.externalUserId || ssoUser.id || "").trim();
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

  // Find all candidate users in SIAGA DB matching any approved identifier
  const { rows } = await pool.query(
    `SELECT id, external_user_id, nik, name, email, system_role, business_role, scope, branch, status, token_version
     FROM users
     WHERE (LOWER(TRIM(email)) = LOWER(TRIM($1)) AND $1::text IS NOT NULL)
        OR (LOWER(TRIM(nik)) = LOWER(TRIM($2)) AND $2::text IS NOT NULL)
        OR (LOWER(TRIM(external_user_id)) = LOWER(TRIM($3)) AND $3::text IS NOT NULL)`,
    [email, nik, ssoId]
  );

  if (rows.length === 0) {
    return {
      status: "NOT_FOUND",
      reason: `Pengguna dengan identitas '${email || nik || ssoId}' tidak ditemukan di database SIAGA. Pengguna harus disinkronkan terlebih dahulu.`,
    };
  }

  // Ambiguity check: if multiple distinct user IDs are returned, reject the match
  const distinctUserIds = Array.from(new Set(rows.map((r) => r.id)));
  if (distinctUserIds.length > 1) {
    return {
      status: "AMBIGUOUS",
      reason: `Konflik identitas terdeteksi: Identifier SSO merujuk ${distinctUserIds.length} akun pengguna berbeda di SIAGA. Penggabungan otomatis dilarang.`,
    };
  }

  const row = rows[0];
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
    status: row.status,
    source: row.source || "SSO",
    tokenVersion: row.token_version ? Number(row.token_version) : 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  // Status check: inactive accounts must not be authenticated
  if (user.status !== "ACTIVE") {
    return {
      status: "INACTIVE",
      user,
      reason: `Akun '${user.name}' (${user.id}) berstatus nonaktif di database SIAGA.`,
    };
  }

  // Deactivated roles: tim_toko and rekanan are blocked from application access
  const DEACTIVATED_BUSINESS_ROLES = ["tim_toko", "rekanan"];
  if (user.businessRole && DEACTIVATED_BUSINESS_ROLES.includes(user.businessRole.toLowerCase())) {
    return {
      status: "DEACTIVATED_ROLE",
      user,
      reason: `Akun '${user.name}' memiliki peran '${user.businessRole}' yang telah dinonaktifkan dari sistem.`,
    };
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

