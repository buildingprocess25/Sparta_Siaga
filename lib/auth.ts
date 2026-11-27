import { cookies } from "next/headers";
import { UserContext } from "./report-permissions";
import { Scope, SpartaRole } from "@/types/incident";
import { dbGetUserById, UserModel } from "./user-db";
import { verifySession } from "./jwt";
import {
  GATE_TOKEN_COOKIE,
  isDevelopmentReadOnlyMode,
  isGateEnabled,
  isReadOnlyLoopbackAllowed,
  verifyGateToken,
} from "./environment-policy";
import { canUseSessionIdentity } from "./session-environment";
import {
  getReadOnlyUserTokenVersion,
  rotateDeviceSession
} from "./session-service";
import { 
  ACCESS_TOKEN_COOKIE, 
  REFRESH_TOKEN_COOKIE, 
  getAccessTokenCookieOptions, 
  getRefreshTokenCookieOptions 
} from "./session-config";

/**
 * Transforms a database UserModel into authenticated UserContext.
 */
function buildUserContext(dbUser: UserModel): UserContext | null {
  if (!canUseSessionIdentity(dbUser)) return null;
  if (dbUser.status === "INACTIVE") {
    console.warn("[Auth] User is inactive in Siaga DB:", dbUser.id);
    return null;
  }

  // Deactivated roles: tim_toko and rekanan are denied from operational / application access
  const DEACTIVATED_BUSINESS_ROLES = ["tim_toko", "rekanan"];
  if (dbUser.businessRole && DEACTIVATED_BUSINESS_ROLES.includes(dbUser.businessRole.toLowerCase())) {
    console.warn(`[Auth] User ${dbUser.id} belongs to deactivated role '${dbUser.businessRole}'. Access denied.`);
    return null;
  }

  const isSystemAdmin = dbUser.systemRole === "ADMIN";

  // Enforce sso_status for synchronized users
  if (dbUser.ssoStatus && dbUser.ssoStatus !== "ACTIVE") {
    console.warn(`[Auth] User ${dbUser.id} has non-active SSO status '${dbUser.ssoStatus}'. Access denied.`);
    return null;
  }

  return {
    id: dbUser.id,
    name: dbUser.name,
    nik: dbUser.nik,
    avatarUrl: dbUser.avatarUrl || null,
    role: isSystemAdmin ? null : dbUser.businessRole,
    systemRole: dbUser.systemRole,
    scope: isSystemAdmin ? null : dbUser.scope,
    branch: isSystemAdmin ? null : dbUser.branch,
    branchCode: isSystemAdmin || process.env.SPARTA_BRANCH_MASTER_ENABLED !== "true" ? null : dbUser.branchCode,
  };
}

/**
 * SPARTA SIAGA — Trusted Server-Side Identity Helper
 * 
 * Extracts authenticated user context from the active session.
 * Supports persistent per-device sessions with transparent Refresh Token Rotation.
 * In Development Read-Only mode, Quick Login sessions are verified from signed JWT + in-memory store with zero DB writes.
 */
export async function getSessionUser(req?: Request): Promise<UserContext | null> {
  let sessionToken: string | undefined;
  let refreshToken: string | undefined;
  let gateToken: string | undefined;

  if (req) {
    if (isDevelopmentReadOnlyMode() && !isReadOnlyLoopbackAllowed(req)) {
      return null;
    }
    const cookieHeader = req.headers.get("cookie") || "";
    const sessionMatch = cookieHeader.match(/siaga_session=([^;]+)/);
    if (sessionMatch) {
      sessionToken = sessionMatch[1];
    }
    const refreshMatch = cookieHeader.match(/siaga_refresh=([^;]+)/);
    if (refreshMatch) {
      refreshToken = refreshMatch[1];
    }
    const gateMatch = cookieHeader.match(new RegExp(`(?:^|;\\s*)${GATE_TOKEN_COOKIE}=([^;]+)`));
    if (gateMatch) {
      gateToken = gateMatch[1];
    }
  }

  if (!sessionToken || !refreshToken || (isDevelopmentReadOnlyMode() && !gateToken)) {
    try {
      const cookieStore = await cookies();
      if (!sessionToken) {
        sessionToken = cookieStore.get(ACCESS_TOKEN_COOKIE)?.value;
      }
      if (!refreshToken) {
        refreshToken = cookieStore.get(REFRESH_TOKEN_COOKIE)?.value;
      }
      if (!gateToken) {
        gateToken = cookieStore.get(GATE_TOKEN_COOKIE)?.value;
      }
    } catch {
      // Handled when called outside Next.js requestAsyncStorage
    }
  }

  if (isDevelopmentReadOnlyMode() && (!isGateEnabled() || !verifyGateToken(gateToken))) {
    return null;
  }

  // 1. First, attempt to verify short-lived access token
  if (sessionToken) {
    const payload = await verifySession(sessionToken);
    if (payload && payload.id) {
      if (isDevelopmentReadOnlyMode()) {
        if (!payload.devPersona) {
          return null;
        }
        const minVersion = getReadOnlyUserTokenVersion(payload.id);
        const tokenVersion = payload.v || 1;
        if (tokenVersion < minVersion) {
          return null;
        }
        const nowIso = new Date().toISOString();
        return buildUserContext({
          id: payload.devPersona.id,
          nik: payload.devPersona.nik,
          name: payload.devPersona.name,
          email: payload.devPersona.email,
          systemRole: payload.devPersona.systemRole,
          businessRole: payload.devPersona.businessRole as SpartaRole | null,
          scope: payload.devPersona.scope as Scope | null,
          branch: payload.devPersona.branch,
          branchCode: payload.devPersona.branchCode ?? null,
          status: "ACTIVE",
          source: "DEVELOPMENT",
          ssoStatus: null,
          tokenVersion,
          createdAt: nowIso,
          updatedAt: nowIso,
        });
      }

      const dbUser = await dbGetUserById(payload.id);

      if (dbUser && dbUser.status === "ACTIVE") {
        // Multi-device session revocation check: if user's token version was bumped, old tokens are invalidated
        if (payload.v === (dbUser.tokenVersion || 1) || (!payload.v && (dbUser.tokenVersion || 1) === 1)) {
          return buildUserContext(dbUser);
        }
        console.warn(`[Auth] User ${dbUser.id} session revoked (token version ${payload.v} < ${dbUser.tokenVersion})`);
      }
    }
  }

  // 2. If access token is missing or expired, attempt transparent renewal via refresh token
  if (refreshToken) {
    const userAgent = req?.headers.get("user-agent") || null;
    const ipAddress = req?.headers.get("x-forwarded-for") || null;

    const refreshResult = await rotateDeviceSession(refreshToken, { userAgent, ipAddress, allowGracePeriod: true });
    if (refreshResult) {
      // Try updating the cookies in response headers if running within Next.js async storage
      try {
        const cookieStore = await cookies();
        cookieStore.set(ACCESS_TOKEN_COOKIE, refreshResult.accessToken, getAccessTokenCookieOptions());
        cookieStore.set(REFRESH_TOKEN_COOKIE, refreshResult.refreshToken, getRefreshTokenCookieOptions());
      } catch {
        // Context might be read-only (e.g. middleware or static rendering); user is still verified
      }

      return buildUserContext(refreshResult.user);
    }
  }

  return null;
}
