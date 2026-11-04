import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  ACCESS_TOKEN_COOKIE,
  REFRESH_TOKEN_COOKIE,
  getSessionCookieOptions
} from "@/lib/session-config";
import { getSessionUser } from "@/lib/auth";
import {
  revokeSessionByRefreshToken,
  revokeAllUserSessions
} from "@/lib/session-service";
import { dbRevokeAllUserSessions } from "@/lib/user-db";
import { getLogoutRedirectUrl } from "@/lib/environment-policy";

export async function POST(req: Request) {
  let allDevices = false;
  let refreshToken: string | undefined;

  if (req) {
    try {
      const url = new URL(req.url);
      if (url.searchParams.get("all") === "true") {
        allDevices = true;
      } else {
        const body = await req.json().catch(() => ({}));
        if (body && body.allDevices === true) {
          allDevices = true;
        }
      }

      const cookieHeader = req.headers.get("cookie") || "";
      const match = cookieHeader.match(/siaga_refresh=([^;]+)/);
      if (match) {
        refreshToken = match[1];
      }
    } catch {
      // Ignored: fallback to standard single-device logout
    }
  }

  if (!refreshToken) {
    try {
      const cookieStore = await cookies();
      refreshToken = cookieStore.get(REFRESH_TOKEN_COOKIE)?.value;
    } catch {
      // Handled outside async storage
    }
  }

  const session = await getSessionUser(req);

  // If all-devices logout requested, revoke token version and all sessions in database
  if (allDevices) {
    if (session?.id) {
      await revokeAllUserSessions(session.id);
      await dbRevokeAllUserSessions(session.id);
    }
  } else if (refreshToken) {
    // Single device logout: revoke just this refresh token
    await revokeSessionByRefreshToken(refreshToken);
  }

  const response = NextResponse.json({
    success: true,
    allDevices,
    redirectTo: getLogoutRedirectUrl()
  });
  const cookieOpts = {
    ...getSessionCookieOptions(),
    maxAge: 0,
  };

  response.cookies.set(ACCESS_TOKEN_COOKIE, "", cookieOpts);
  response.cookies.set(REFRESH_TOKEN_COOKIE, "", cookieOpts);

  try {
    const cookieStore = await cookies();
    cookieStore.set(ACCESS_TOKEN_COOKIE, "", cookieOpts);
    cookieStore.set(REFRESH_TOKEN_COOKIE, "", cookieOpts);
  } catch {
    // Handled when called outside requestAsyncStorage
  }

  return response;
}
