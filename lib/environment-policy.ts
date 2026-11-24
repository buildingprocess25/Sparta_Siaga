/**
 * SPARTA SIAGA environment safety.
 * Testing is allowed only on the explicitly configured isolated database.
 * Gate primitives are available, but public Quick Login remains disabled
 * until the complete login/session isolation flow is reviewed.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { isProductionDatabaseTarget } from "./db";
import { getJwtSecret } from "./runtime-config";

export type SpartaEnvironment = "development" | "test" | "uat" | "staging" | "production";

function normalizeEnvironment(value: string | undefined): SpartaEnvironment | null {
  switch ((value || "").trim().toLowerCase()) {
    case "production": case "prod": return "production";
    case "development": case "dev": return "development";
    case "uat": case "staging": return "uat";
    case "test": case "testing": return "test";
    default: return null;
  }
}

function isIsolatedDatabaseTarget(value: string): boolean {
  try {
    const url = new URL(value);
    return (url.protocol === "postgresql:" || url.protocol === "postgres:") &&
      url.hostname.toLowerCase().endsWith(".aivencloud.com") &&
      decodeURIComponent(url.pathname) === "/sparta_siaga_isolated" &&
      [...url.searchParams.keys()].every(key => key === "sslmode");
  } catch { return false; }
}

export function getSpartaEnvironment(): SpartaEnvironment {
  const dbUrl = (process.env.DATABASE_URL || "").trim();
  if (isProductionDatabaseTarget(dbUrl) || !isIsolatedDatabaseTarget(dbUrl)) return "production";
  const rawFlags = [process.env.APP_ENV, process.env.SPARTA_ENVIRONMENT].filter(v => Boolean(v?.trim()));
  const flags = rawFlags.map(normalizeEnvironment);
  // No inference from cloud hostname, no conflicting/unknown/missing flags.
  // NODE_ENV=production is normal for a built UAT application.
  if (!flags.length || flags.some(v => v === null || v === "production") ||
      new Set(flags).size !== 1) return "production";
  return flags[0] as SpartaEnvironment;
}

export function isProductionEnvironment(): boolean {
  return getSpartaEnvironment() === "production";
}
export function isUatEnvironment(): boolean {
  return getSpartaEnvironment() === "uat";
}
export function isDevelopmentEnvironment(): boolean {
  return getSpartaEnvironment() === "development";
}
export function isUatSimulationAllowed(): boolean {
  return !isProductionEnvironment();
}
export function assertSimulationAllowed(): void {
  if (!isUatSimulationAllowed()) {
    throw new Error("SIMULATION_FORBIDDEN_IN_PRODUCTION: Fitur simulasi dan kredensial pengujian dilarang pada target production atau target yang belum terverifikasi.");
  }
}

/** Browser gate is only applicable to explicitly isolated development/UAT. */
export function isTestBrowserEnvironment(): boolean {
  const env = getSpartaEnvironment();
  return env === "development" || env === "uat";
}
export function isLocalLoopbackRequest(req: Request): boolean {
  const local = new Set(["localhost", "127.0.0.1", "[::1]"]);
  const localAuthority = (value: string) => {
    if (!value || /[\s,/@?#]/.test(value)) return false;
    try { return local.has(new URL(`http://${value}`).hostname.toLowerCase()); }
    catch { return false; }
  };
  try {
    const host = req.headers.get("host") || "";
    const forwardedHost = req.headers.get("x-forwarded-host");
    const forwardedFor = req.headers.get("x-forwarded-for");
    const loopbackIp = (v: string) => ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(v.trim());
    return localAuthority(host) && local.has(new URL(req.url).hostname.toLowerCase()) &&
      (!forwardedHost || localAuthority(forwardedHost)) &&
      (!forwardedFor || forwardedFor.split(",").every(loopbackIp));
  } catch { return false; }
}
export function isGateRequired(req: Request): boolean {
  return isTestBrowserEnvironment() &&
    !(isDevelopmentEnvironment() && isLocalLoopbackRequest(req));
}
export function isGateEnabled(): boolean {
  return isTestBrowserEnvironment() && process.env.SPARTA_TEST_GATE_ENABLED === "true" &&
    getConfiguredGatePasscode() !== null;
}
export function isGateTransportAllowed(req: Request): boolean {
  try {
    return isLocalLoopbackRequest(req) || new URL(req.url).protocol === "https:" ||
      req.headers.get("x-forwarded-proto") === "https";
  } catch { return false; }
}
export function hasVerifiedGate(req: Request): boolean {
  if (!isGateEnabled() || !isGateTransportAllowed(req)) return false;
  const tokens = (req.headers.get("cookie") || "").split(";").map(v => v.trim())
    .filter(v => v.startsWith(`${GATE_TOKEN_COOKIE}=`));
  return tokens.length === 1 && verifyGateToken(tokens[0].slice(GATE_TOKEN_COOKIE.length + 1));
}
export function isQuickLoginPermitted(req?: Request): { allowed: boolean; reason?: string } {
  if (!req || !isTestBrowserEnvironment()) return { allowed: false, reason: "Quick Login hanya tersedia di Development/UAT terisolasi." };
  if (isDevelopmentEnvironment() && isLocalLoopbackRequest(req)) return { allowed: true };
  if (hasVerifiedGate(req)) return { allowed: true };
  return { allowed: false, reason: "Verifikasi gate diperlukan." };
}
// Verify the actual pg pool target before creating synthetic users (not merely DATABASE_URL).
export function isSafeTestPoolTarget(value: unknown): boolean {
  return isTestBrowserEnvironment() && typeof value === "string" &&
    !isProductionDatabaseTarget(value) && isIsolatedDatabaseTarget(value);
}

export const GATE_TOKEN_COOKIE = "siaga_gate_token";
export const GATE_TOKEN_TTL_SECONDS = 8 * 60 * 60;

export function getConfiguredGatePasscode(): string | null {
  const env = getSpartaEnvironment();
  if (env !== "development" && env !== "uat") return null;
  const value = (env === "development"
    ? process.env.DEV_GATE_PASSCODE || process.env.UAT_GATE_PASSCODE
    : process.env.UAT_GATE_PASSCODE)?.trim();
  // No hard-coded fallback or blank/default password.
  return value && value.length >= 12 && value.length <= 1024 ? value : null;
}

function equalText(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  return left.length === right.length && timingSafeEqual(left, right);
}

export function verifyGatePasscode(candidate: string): boolean {
  const expected = getConfiguredGatePasscode();
  return expected !== null && candidate.length <= 1024 && equalText(candidate, expected);
}

function gateSignature(payload: string): string {
  const passcode = getConfiguredGatePasscode();
  const secret = getJwtSecret();
  if (!passcode || typeof secret !== "string" || secret.length < 32) throw new Error("GATE_NOT_CONFIGURED");
  return createHmac("sha256", secret)
    .update("siaga-gate-v1\0").update(passcode).update("\0").update(payload)
    .digest("base64url");
}

export function issueGateToken(now = Date.now()): string {
  const env = getSpartaEnvironment();
  if (env !== "development" && env !== "uat") throw new Error("GATE_FORBIDDEN");
  const expiry = Math.floor(now / 1000) + GATE_TOKEN_TTL_SECONDS;
  const payload = `${env}.${expiry}`;
  return `${payload}.${gateSignature(payload)}`;
}

export function verifyGateToken(token: string | undefined, now = Date.now()): boolean {
  if (!token || token.length > 256 || isProductionEnvironment()) return false;
  const [env, expires, signature, ...extra] = token.split(".");
  const expiry = Number(expires);
  const current = Math.floor(now / 1000);
  if (extra.length || !signature || env !== getSpartaEnvironment() ||
      !/^\d+$/.test(expires || "") || !Number.isSafeInteger(expiry) ||
      expiry <= current || expiry > current + GATE_TOKEN_TTL_SECONDS) return false;
  try { return equalText(signature, gateSignature(`${env}.${expires}`)); }
  catch { return false; }
}

/**
 * Returns the configured base URL for the SPARTA SSO Login Portal.
 */
export function getSsoPortalUrl(): string {
  return (
    process.env.SPARTA_LOGIN_URL ||
    process.env.NEXT_PUBLIC_SPARTA_LOGIN_URL ||
    "https://sparta-alfamart.web.id"
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
  if (isTestBrowserEnvironment()) {
    return "/login";
  }
  return getSsoModuleLauncherUrl();
}
