/**
 * SPARTA SIAGA — Environment Safety & Simulation Policy Engine
 *
 * Implements strict, fail-closed separation between Development, UAT/Testing, and Production.
 * Enforces rule:
 * - Production: Simulation triggers, synthetic earthquake generators, UAT logins,
 *   Quick Login, and test reset endpoints MUST NEVER be available or executable.
 * - UAT: SSO authentication is MANDATORY. Quick Login and Direct Login are strictly FORBIDDEN.
 *   Simulations are permitted for authorized evaluators on staging database.
 * - Local Development: Quick Login with 9-role selection is permitted ONLY on local loopback.
 */

import { isProductionDatabaseTarget } from "./db";

export type SpartaEnvironment = "development" | "test" | "uat" | "staging" | "production";

/**
 * Resolves current environment name based on server environment variables.
 * In production deployments, APP_ENV or SPARTA_ENVIRONMENT is set to 'production'.
 */
export function getSpartaEnvironment(): SpartaEnvironment {
  // 1. Fail-closed: If target database is production, environment is ALWAYS production
  const dbUrl = process.env.DATABASE_URL || "";
  if (isProductionDatabaseTarget(dbUrl)) {
    return "production";
  }

  // 2. Explicit environment flag
  const explicitEnv = (
    process.env.APP_ENV ||
    process.env.SPARTA_ENVIRONMENT ||
    ""
  ).trim().toLowerCase();

  if (explicitEnv === "production" || explicitEnv === "prod") return "production";
  if (explicitEnv === "test" || explicitEnv === "testing") return "test";
  if (explicitEnv === "uat" || explicitEnv === "staging") return "uat";
  if (explicitEnv === "development" || explicitEnv === "dev") return "development";

  // 3. Target database inference for isolated staging
  if (dbUrl.includes("sparta_siaga_isolated") || dbUrl.includes("aivencloud.com")) {
    return "uat";
  }

  if (process.env.NODE_ENV === "production") return "production";
  if (process.env.NODE_ENV === "test") return "test";
  return "development";
}

/**
 * Returns true if the runtime is strictly identified as Production.
 * Fail-closed: If the target database URL is the production database,
 * it is ALWAYS treated as Production regardless of other environment flags.
 */
export function isProductionEnvironment(): boolean {
  // 1. Fail-closed: If target database is the production database, ALWAYS production
  const dbUrl = process.env.DATABASE_URL || "";
  if (isProductionDatabaseTarget(dbUrl)) {
    return true;
  }

  // 2. Explicit environment flag
  const explicitEnv = (
    process.env.APP_ENV ||
    process.env.SPARTA_ENVIRONMENT ||
    ""
  ).trim().toLowerCase();

  if (explicitEnv === "production" || explicitEnv === "prod") {
    return true;
  }
  if (
    explicitEnv === "uat" ||
    explicitEnv === "staging" ||
    explicitEnv === "test" ||
    explicitEnv === "development" ||
    explicitEnv === "dev"
  ) {
    return false;
  }

  // 3. Isolated database check (Aiven sparta_siaga_isolated is strictly staging/UAT)
  if (dbUrl.includes("sparta_siaga_isolated") || dbUrl.includes("aivencloud.com")) {
    return false;
  }

  // 4. Fallback to NODE_ENV
  return process.env.NODE_ENV === "production";
}

/**
 * Returns true if the runtime is UAT / Staging.
 */
export function isUatEnvironment(): boolean {
  if (isProductionEnvironment()) return false;
  const env = getSpartaEnvironment();
  return env === "uat" || env === "staging";
}

/**
 * Returns true if the runtime is Local Development.
 */
export function isDevelopmentEnvironment(): boolean {
  if (isProductionEnvironment()) return false;
  return getSpartaEnvironment() === "development";
}

/**
 * Returns true only if UAT simulation tools, synthetic earthquakes,
 * and test accounts are legitimately permitted in the current runtime.
 */
export function isUatSimulationAllowed(): boolean {
  if (isProductionEnvironment()) {
    return false;
  }

  const dbUrl = process.env.DATABASE_URL || "";
  if (isProductionDatabaseTarget(dbUrl)) {
    return false;
  }

  return true;
}

/**
 * Server-side guard for API routes and backend services.
 * Throws a fatal 403 error if called in Production.
 */
export function assertSimulationAllowed(): void {
  if (!isUatSimulationAllowed()) {
    throw new Error(
      "SIMULATION_FORBIDDEN_IN_PRODUCTION: Fitur simulasi gempa, reset skenario UAT, dan kredensial pengujian dilarang keras di environment Production."
    );
  }
}

/**
 * Checks whether Quick Login is permitted.
 * Quick Login is strictly permitted ONLY in Local Development, on loopback access,
 * and never over public tunnels or in UAT/Production.
 */
export function isQuickLoginPermitted(req?: Request): { allowed: boolean; reason?: string } {
  // 1. Fail-closed: Must not be production
  if (isProductionEnvironment()) {
    return {
      allowed: false,
      reason: "Quick Login dilarang keras di environment Production.",
    };
  }

  // 2. Database target guard
  const dbUrl = process.env.DATABASE_URL || "";
  if (isProductionDatabaseTarget(dbUrl)) {
    return {
      allowed: false,
      reason: "Quick Login dilarang keras saat terhubung ke database Production.",
    };
  }

  // 3. Must be explicitly Local Development
  const env = getSpartaEnvironment();
  if (env !== "development") {
    return {
      allowed: false,
      reason: `Quick Login hanya diizinkan di Local Development (environment saat ini: ${env}). UAT wajib melalui Portal SSO SPARTA.`,
    };
  }

  // 4. Loopback and tunnel security check
  if (req) {
    const rawHost = (req.headers.get("x-forwarded-host") || req.headers.get("host") || "").toLowerCase();
    const hostName = rawHost.split(":")[0].trim();

    // Reject public tunnels or non-loopback domains
    const isPublicTunnel =
      rawHost.includes("loca.lt") ||
      rawHost.includes("ngrok") ||
      rawHost.includes("trycloudflare.com") ||
      rawHost.includes("sparta-alfamart.web.id") ||
      rawHost.includes(".nip.io");

    if (isPublicTunnel) {
      return {
        allowed: false,
        reason: "Quick Login dilarang diakses melalui tunnel publik atau port forwarding.",
      };
    }

    const isLoopback =
      hostName === "localhost" ||
      hostName === "127.0.0.1" ||
      hostName === "::1" ||
      hostName === "[::1]";

    if (!isLoopback && hostName !== "") {
      return {
        allowed: false,
        reason: `Quick Login hanya dapat diakses melalui loopback lokal (localhost/127.0.0.1). Host terdeteksi: ${hostName}`,
      };
    }
  }

  return { allowed: true };
}

/**
 * Returns the configured base URL for the SPARTA SSO Login Portal.
 */
export function getSsoPortalUrl(): string {
  return (
    process.env.SPARTA_LOGIN_URL ||
    process.env.NEXT_PUBLIC_SPARTA_LOGIN_URL ||
    "https://login.sparta-alfamart.web.id"
  ).replace(/\/+$/, "");
}

/**
 * Returns the URL to redirect the user to the SPARTA SSO module launcher page.
 */
export function getSsoModuleLauncherUrl(): string {
  const portalUrl = getSsoPortalUrl();
  return `${portalUrl}/#/modules`;
}

/**
 * Resolves the appropriate post-logout redirect URL based on environment.
 * In Local Development: redirect to /login (Quick Login page).
 * In UAT and Production: redirect to Portal SSO module launcher page (#/modules).
 */
export function getLogoutRedirectUrl(): string {
  if (isDevelopmentEnvironment()) {
    return "/login";
  }
  return getSsoModuleLauncherUrl();
}
