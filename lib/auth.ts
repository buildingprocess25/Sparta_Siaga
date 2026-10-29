import { cookies } from "next/headers";
import { UserContext } from "./report-permissions";
import { SpartaRole } from "@/types/incident";
import { dbGetUserById, dbUpsertUser, UserModel } from "./user-db";
import { verifySession } from "./jwt";
import { 
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

  return {
    id: dbUser.id,
    name: dbUser.name,
    nik: dbUser.nik,
    avatarUrl: dbUser.avatarUrl || null,
    role: isSystemAdmin ? null : dbUser.businessRole,
    systemRole: dbUser.systemRole,
    scope: isSystemAdmin ? null : dbUser.scope,
    branch: isSystemAdmin ? null : dbUser.branch,
  };
}

/**
 * SPARTA SIAGA — Trusted Server-Side Identity Helper
 * 
 * Extracts authenticated user context from the active session.
 * Supports persistent per-device sessions with transparent Refresh Token Rotation.
 * Database is the single source of truth for authorization.
 */
export async function getSessionUser(req?: Request): Promise<UserContext | null> {
  let sessionToken: string | undefined;
  let refreshToken: string | undefined;

  if (req) {
    const cookieHeader = req.headers.get("cookie") || "";
    const sessionMatch = cookieHeader.match(/siaga_session=([^;]+)/);
    if (sessionMatch) {
      sessionToken = sessionMatch[1];
    }
    const refreshMatch = cookieHeader.match(/siaga_refresh=([^;]+)/);
    if (refreshMatch) {
      refreshToken = refreshMatch[1];
    }
  }

  if (!sessionToken || !refreshToken) {
    try {
      const cookieStore = await cookies();
      if (!sessionToken) {
        sessionToken = cookieStore.get(ACCESS_TOKEN_COOKIE)?.value;
      }
      if (!refreshToken) {
        refreshToken = cookieStore.get(REFRESH_TOKEN_COOKIE)?.value;
      }
    } catch {
      // Handled when called outside Next.js requestAsyncStorage
    }
  }

  // 1. First, attempt to verify short-lived access token
  if (sessionToken) {
    const payload = await verifySession(sessionToken);
    if (payload && payload.id) {
      const dbUser = await dbGetUserById(payload.id);

      if (dbUser && dbUser.status === "ACTIVE") {
        // Multi-device session revocation check: if user's token version was bumped, old tokens are invalidated
        if (!dbUser.tokenVersion || !payload.v || payload.v >= dbUser.tokenVersion) {
          return buildUserContext(dbUser);
        }
        console.warn(`[Auth] User ${dbUser.id} session revoked (token version ${payload.v} < ${dbUser.tokenVersion})`);
      }
    }
  }

  // 2. If access token is missing or expired, attempt transparent renewal via persistent refresh token
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
