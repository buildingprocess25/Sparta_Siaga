export const ACCESS_TOKEN_COOKIE = "siaga_session";
export const REFRESH_TOKEN_COOKIE = "siaga_refresh";

export const ACCESS_TOKEN_MAX_AGE = 15 * 60; // 15 minutes
export const REFRESH_TOKEN_MAX_AGE = 30 * 24 * 60 * 60; // 30 days

export interface SessionCookieOptions {
  httpOnly: boolean;
  secure: boolean;
  sameSite: "lax" | "strict" | "none";
  path: string;
  maxAge?: number;
}

export function getSessionCookieOptions(
  env: NodeJS.ProcessEnv = process.env,
  isSecureRequest?: boolean
): SessionCookieOptions {
  let secure: boolean;
  if (typeof isSecureRequest === "boolean") {
    secure = isSecureRequest;
  } else {
    const appUrl = env.NEXT_PUBLIC_APP_URL || env.APP_BASE_URL || "";
    const isLocalUrl =
      appUrl.includes("localhost") ||
      appUrl.includes("127.0.0.1") ||
      appUrl.startsWith("http://");
    secure = env.NODE_ENV === "production" && !isLocalUrl;
  }

  return {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
  };
}

export function getAccessTokenCookieOptions(
  env: NodeJS.ProcessEnv = process.env,
  isSecureRequest?: boolean
): SessionCookieOptions {
  return {
    ...getSessionCookieOptions(env, isSecureRequest),
    maxAge: ACCESS_TOKEN_MAX_AGE,
  };
}

export function getRefreshTokenCookieOptions(
  env: NodeJS.ProcessEnv = process.env,
  isSecureRequest?: boolean
): SessionCookieOptions {
  return {
    ...getSessionCookieOptions(env, isSecureRequest),
    maxAge: REFRESH_TOKEN_MAX_AGE,
  };
}
