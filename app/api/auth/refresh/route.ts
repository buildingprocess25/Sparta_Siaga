import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { 
  ACCESS_TOKEN_COOKIE, 
  REFRESH_TOKEN_COOKIE, 
  getAccessTokenCookieOptions, 
  getRefreshTokenCookieOptions,
  getSessionCookieOptions
} from "@/lib/session-config";
import { rotateDeviceSession } from "@/lib/session-service";

export const dynamic = "force-dynamic";

// Single-flight in-memory deduplication map to prevent parallel concurrent refreshes from clashing
const inFlightRefreshes = new Map<string, Promise<any>>();

export async function POST(request: Request) {
  try {
    let refreshToken: string | undefined;

    // Check request cookies
    const cookieHeader = request.headers.get("cookie") || "";
    const match = cookieHeader.match(/siaga_refresh=([^;]+)/);
    if (match) {
      refreshToken = match[1];
    }

    if (!refreshToken) {
      try {
        const cookieStore = await cookies();
        refreshToken = cookieStore.get(REFRESH_TOKEN_COOKIE)?.value;
      } catch {
        // Outside async storage
      }
    }

    // Check request body fallback
    if (!refreshToken) {
      const body = await request.json().catch(() => ({}));
      if (body && typeof body.refreshToken === "string") {
        refreshToken = body.refreshToken;
      }
    }

    if (!refreshToken) {
      return NextResponse.json(
        { error: "Refresh token tidak ditemukan" },
        { status: 401 }
      );
    }

    const userAgent = request.headers.get("user-agent") || null;
    const ipAddress = request.headers.get("x-forwarded-for") || null;

    // Deduplicate in-flight requests for the exact same token to avoid race conditions
    let refreshPromise = inFlightRefreshes.get(refreshToken);
    if (!refreshPromise) {
      refreshPromise = rotateDeviceSession(refreshToken, { 
        userAgent, 
        ipAddress, 
        allowGracePeriod: true 
      }).finally(() => {
        // Keep in map for 5 seconds to catch near-simultaneous browser calls
        setTimeout(() => {
          inFlightRefreshes.delete(refreshToken!);
        }, 5000);
      });
      inFlightRefreshes.set(refreshToken, refreshPromise);
    }

    const result = await refreshPromise;

    if (!result) {
      // Refresh token is revoked, expired, or invalid. Clear cookies.
      const response = NextResponse.json(
        { error: "Sesi telah kedaluwarsa atau dicabut. Silakan login kembali." },
        { status: 401 }
      );
      const clearOpts = { ...getSessionCookieOptions(), maxAge: 0 };
      response.cookies.set(ACCESS_TOKEN_COOKIE, "", clearOpts);
      response.cookies.set(REFRESH_TOKEN_COOKIE, "", clearOpts);
      return response;
    }

    const response = NextResponse.json({
      success: true,
      user: {
        id: result.user.id,
        name: result.user.name,
        nik: result.user.nik,
        systemRole: result.user.systemRole,
        businessRole: result.user.businessRole,
        branch: result.user.branch,
      },
      expiresAt: result.expiresAt.toISOString(),
    });

    response.cookies.set(ACCESS_TOKEN_COOKIE, result.accessToken, getAccessTokenCookieOptions());
    response.cookies.set(REFRESH_TOKEN_COOKIE, result.refreshToken, getRefreshTokenCookieOptions());

    try {
      const cookieStore = await cookies();
      cookieStore.set(ACCESS_TOKEN_COOKIE, result.accessToken, getAccessTokenCookieOptions());
      cookieStore.set(REFRESH_TOKEN_COOKIE, result.refreshToken, getRefreshTokenCookieOptions());
    } catch {
      // Handled when called outside request async storage
    }

    return response;
  } catch (error) {
    console.error("[POST /api/auth/refresh]", error);
    return NextResponse.json(
      { error: "Terjadi kesalahan saat memperbarui sesi" },
      { status: 500 }
    );
  }
}
