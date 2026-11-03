import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  exchangeSpartaLaunchToken,
  validateSsoModuleAccess,
  matchSsoIdentityToSiagaUser,
  createSsoSessionForUser,
  mapSsoErrorCodeToRedirect,
} from "@/lib/sso-service";
import {
  ACCESS_TOKEN_COOKIE,
  REFRESH_TOKEN_COOKIE,
  getAccessTokenCookieOptions,
  getRefreshTokenCookieOptions,
} from "@/lib/session-config";

/**
 * SPARTA SIAGA — SSO Callback Handler
 *
 * Implements the SPARTA Corporate SSO contract:
 * 1. Receives one-time launch token via query parameter (?token=...)
 * 2. Exchanges token through POST /v1/sso/exchange with moduleId: "siaga"
 * 3. Validates exchange response, user identity, and SIAGA module authorization
 * 4. Matches identity against existing active SIAGA users (strictly no auto-creation)
 * 5. Issues local access/refresh tokens and secure HttpOnly cookies
 * 6. Redirects to SIAGA dashboard
 */
export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const token = requestUrl.searchParams.get("token");

  // Determine base URL safely for redirects
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_BASE_URL || requestUrl.origin;

  // 1. Validate launch token presence
  if (!token || !token.trim()) {
    return NextResponse.redirect(new URL("/login?error=MissingToken", baseUrl));
  }

  try {
    // 2. Exchange token with SPARTA Login Portal
    const exchangeResult = await exchangeSpartaLaunchToken(token);

    if (!exchangeResult.success) {
      // Never log raw tokens or sensitive payloads
      console.warn(`[SSO Callback] Exchange failed: code=${exchangeResult.errorCode}, status=${exchangeResult.status}`);
      const errorParam = mapSsoErrorCodeToRedirect(exchangeResult.errorCode);
      return NextResponse.redirect(new URL(`/login?error=${errorParam}`, baseUrl));
    }

    const ssoUser = exchangeResult.user;

    // 3. Validate SIAGA module authorization
    const hasModuleAccess = validateSsoModuleAccess(ssoUser);
    if (!hasModuleAccess) {
      console.warn("[SSO Callback] User does not have authorized access to 'siaga' module.");
      return NextResponse.redirect(new URL("/login?error=UnauthorizedModule", baseUrl));
    }

    // 4. Match identity against existing active SIAGA users (strictly zero auto-creation)
    const matchResult = await matchSsoIdentityToSiagaUser(ssoUser);

    if (matchResult.status !== "MATCHED") {
      console.warn(`[SSO Callback] Identity match rejected: status=${matchResult.status}, reason=${matchResult.reason}`);
      const redirectCode = mapSsoErrorCodeToRedirect(
        matchResult.status === "NOT_FOUND"
          ? "USER_NOT_FOUND"
          : matchResult.status === "INACTIVE"
          ? "USER_INACTIVE"
          : matchResult.status === "AMBIGUOUS"
          ? "AMBIGUOUS_IDENTITY"
          : "DEACTIVATED_ROLE"
      );
      return NextResponse.redirect(new URL(`/login?error=${redirectCode}`, baseUrl));
    }

    const dbUser = matchResult.user;

    // 5. Issue local per-device session with rotating refresh token
    const userAgent = request.headers.get("user-agent") || null;
    const ipAddress = request.headers.get("x-forwarded-for") || null;

    const sessionResult = await createSsoSessionForUser(dbUser, { userAgent, ipAddress });

    if (!sessionResult) {
      console.error("[SSO Callback] Failed to create local device session for user.");
      return NextResponse.redirect(new URL("/login?error=SessionCreationFailed", baseUrl));
    }

    // 6. Set secure HttpOnly cookies and redirect to dashboard
    const response = NextResponse.redirect(new URL("/", baseUrl));

    response.cookies.set(
      ACCESS_TOKEN_COOKIE,
      sessionResult.accessToken,
      getAccessTokenCookieOptions()
    );
    response.cookies.set(
      REFRESH_TOKEN_COOKIE,
      sessionResult.refreshToken,
      getRefreshTokenCookieOptions()
    );

    // Also attempt setting in cookie store if accessible
    try {
      const cookieStore = await cookies();
      cookieStore.set(
        ACCESS_TOKEN_COOKIE,
        sessionResult.accessToken,
        getAccessTokenCookieOptions()
      );
      cookieStore.set(
        REFRESH_TOKEN_COOKIE,
        sessionResult.refreshToken,
        getRefreshTokenCookieOptions()
      );
    } catch {
      // Ignored outside Next.js async storage context
    }

    return response;
  } catch (error) {
    // Log error summary safely without exposing token or request secrets
    console.error("[SSO Callback] Unexpected error during SSO authentication processing.");
    return NextResponse.redirect(new URL("/login?error=ServerError", baseUrl));
  }
}
