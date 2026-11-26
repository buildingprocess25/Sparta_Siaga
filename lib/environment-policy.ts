/**
 * SPARTA SIAGA environment safety.
 * Environments are strictly Development ('development'), Test ('test'), or Production ('production').
 * Development supports two data modes:
 * - 'isolated': isolated Aiven database (sparta_siaga_isolated) for Quick Login, CRUD, simulations, and migrations.
 * - 'production-readonly': PostgreSQL SELECT-only connection to Production data with zero writes.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { getJwtSecret } from "./runtime-config";

export type SpartaEnvironment = "development" | "test" | "production";
export type DevelopmentDataMode = "isolated" | "production-readonly";

export function isProductionDatabaseTarget(connectionString: string): boolean {
  if (!connectionString) return false;
  return (
    /103\.127\.99\.241/i.test(connectionString) ||
    /\/siaga(\?|$)/i.test(connectionString)
  );
}

function normalizeEnvironment(value: string | undefined): SpartaEnvironment | null {
  switch ((value || "").trim().toLowerCase()) {
    case "production": case "prod": return "production";
    case "development": case "dev": return "development";
    case "test": case "testing": return "test";
    default: return null;
  }
}

export function normalizeDevDataMode(value: string | undefined): DevelopmentDataMode | null {
  switch ((value || "").trim().toLowerCase()) {
    case "":
    case "isolated":
    case "aiven":
      return "isolated";
    case "production-readonly":
    case "prod-readonly":
    case "readonly":
      return "production-readonly";
    default:
      return null;
  }
}

export function areSameDatabaseCredentials(urlA: string | undefined, urlB: string | undefined): boolean {
  const a = (urlA || "").trim();
  const b = (urlB || "").trim();
  if (!a || !b) return false;
  if (a === b) return true;
  try {
    const parsedA = new URL(a);
    const parsedB = new URL(b);
    return (
      parsedA.hostname.toLowerCase() === parsedB.hostname.toLowerCase() &&
      (parsedA.port || "5432") === (parsedB.port || "5432") &&
      decodeURIComponent(parsedA.pathname) === decodeURIComponent(parsedB.pathname) &&
      decodeURIComponent(parsedA.username).toLowerCase() === decodeURIComponent(parsedB.username).toLowerCase()
    );
  } catch {
    return false;
  }
}

function isValidReadOnlyPostgresUrl(raw: string): boolean {
  if (!raw) return false;
  try {
    const parsed = new URL(raw);
    return (
      (parsed.protocol === "postgresql:" || parsed.protocol === "postgres:") &&
      parsed.hostname.trim().length > 0 &&
      decodeURIComponent(parsed.username).trim().length > 0 &&
      decodeURIComponent(parsed.pathname).replace(/^\/+/, "").length > 0
    );
  } catch {
    return false;
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
  const rawFlags = [process.env.APP_ENV, process.env.SPARTA_ENVIRONMENT].filter(v => Boolean(v?.trim()));
  const flags = rawFlags.map(normalizeEnvironment);
  // Fail-closed on conflicting, unknown, legacy (e.g. 'uat'), missing, or production flags.
  if (!flags.length || flags.some(v => v === null || v === "production") ||
      new Set(flags).size !== 1) return "production";

  const target = flags[0]!;
  if (target === "test") {
    if (dbUrl && isProductionDatabaseTarget(dbUrl)) return "production";
    return "test";
  }

  if (target === "development") {
    const dataMode = normalizeDevDataMode(process.env.SPARTA_DEV_DATA_MODE);
    if (dataMode === "production-readonly") {
      if (process.env.NODE_ENV === "production") return "production";
      const roUrl = (process.env.SPARTA_PRODUCTION_READONLY_DATABASE_URL || "").trim();
      const writeCheckUrl =
        process.env.SPARTA_WRITE_DATABASE_URL_FOR_CHECK?.trim() ||
        (isProductionDatabaseTarget(dbUrl) ? dbUrl : undefined);
      if (!isValidReadOnlyPostgresUrl(roUrl) || areSameDatabaseCredentials(roUrl, writeCheckUrl)) {
        return "production";
      }
      return "development";
    }
    if (dataMode === "isolated") {
      if (isProductionDatabaseTarget(dbUrl) || !isIsolatedDatabaseTarget(dbUrl)) return "production";
      return "development";
    }
    return "production";
  }

  return "production";
}

export function isProductionEnvironment(): boolean {
  return getSpartaEnvironment() === "production";
}
export function isDevelopmentEnvironment(): boolean {
  return getSpartaEnvironment() === "development";
}
export function getDevelopmentDataMode(): DevelopmentDataMode | null {
  if (!isDevelopmentEnvironment()) return null;
  return normalizeDevDataMode(process.env.SPARTA_DEV_DATA_MODE) ?? "isolated";
}
export function isDevelopmentReadOnlyMode(): boolean {
  return getDevelopmentDataMode() === "production-readonly";
}
export function isDevelopmentIsolatedMode(): boolean {
  return getDevelopmentDataMode() === "isolated";
}
export function validateProductionDatabaseAccess(): { allowed: true } | { allowed: false; reason: string } {
  const nodeEnv = process.env.NODE_ENV?.trim().toLowerCase();
  if (nodeEnv && nodeEnv !== "production") {
    return {
      allowed: false,
      reason: "Koneksi ke database Production ditolak saat NODE_ENV bukan 'production'.",
    };
  }
  if (process.env.SPARTA_DEV_DATA_MODE?.trim()) {
    return {
      allowed: false,
      reason: "Koneksi ke database Production operasional ditolak saat SPARTA_DEV_DATA_MODE aktif atau tidak valid.",
    };
  }
  const rawFlags = [process.env.APP_ENV, process.env.SPARTA_ENVIRONMENT].filter(v => Boolean(v?.trim()));
  if (rawFlags.length === 0) {
    if (nodeEnv === "production") {
      return { allowed: true };
    }
    return {
      allowed: false,
      reason: "Environment produksi tidak dikonfigurasi secara eksplisit (APP_ENV/SPARTA_ENVIRONMENT kosong dan NODE_ENV bukan 'production').",
    };
  }
  if (rawFlags.some(v => normalizeEnvironment(v) !== "production")) {
    return {
      allowed: false,
      reason: "Konfigurasi APP_ENV/SPARTA_ENVIRONMENT tidak valid atau bukan Production; fallback otomatis ke database Production diblokir.",
    };
  }
  if (isDevelopmentReadOnlyMode()) {
    return {
      allowed: false,
      reason: "Mode Development Read-Only melarang koneksi ke pool tulis Production.",
    };
  }
  return { allowed: true };
}
export function getActiveSessionEnvironmentTag(): string {
  return isDevelopmentReadOnlyMode() ? "development-readonly" : getSpartaEnvironment();
}
export function isSimulationAllowed(): boolean {
  return isDevelopmentIsolatedMode() || getSpartaEnvironment() === "test";
}
/** @deprecated Use isSimulationAllowed */
export const isUatSimulationAllowed = isSimulationAllowed;
export function assertSimulationAllowed(): void {
  if (!isSimulationAllowed()) {
    throw new Error("SIMULATION_FORBIDDEN_IN_PRODUCTION: Fitur simulasi dan kredensial pengujian dilarang pada Production atau mode Development Read-Only.");
  }
}

/** Browser gate is only applicable to explicitly verified Development environments. */
export function isTestBrowserEnvironment(): boolean {
  return isDevelopmentEnvironment();
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
  return isDevelopmentEnvironment() &&
    (process.env.SPARTA_FORCE_DEV_GATE === "true" || !isLocalLoopbackRequest(req));
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
  if (!req || !isTestBrowserEnvironment()) return { allowed: false, reason: "Quick Login hanya tersedia di Development terisolasi atau Development Read-Only." };
  if (isDevelopmentEnvironment() && isLocalLoopbackRequest(req) && process.env.SPARTA_FORCE_DEV_GATE !== "true") return { allowed: true };
  if (hasVerifiedGate(req)) return { allowed: true };
  return { allowed: false, reason: "Verifikasi gate diperlukan." };
}
// Verify the actual pg pool target before creating synthetic users in isolated Development mode.
export function isSafeTestPoolTarget(value: unknown): boolean {
  return isDevelopmentIsolatedMode() && typeof value === "string" &&
    !isProductionDatabaseTarget(value) && isIsolatedDatabaseTarget(value);
}

export const GATE_TOKEN_COOKIE = "siaga_gate_token";
export const GATE_TOKEN_TTL_SECONDS = 8 * 60 * 60;

export function getConfiguredGatePasscode(): string | null {
  if (!isDevelopmentEnvironment()) return null;
  const value = process.env.DEV_GATE_PASSCODE?.trim();
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
  if (!isDevelopmentEnvironment()) throw new Error("GATE_FORBIDDEN");
  const env = getActiveSessionEnvironmentTag();
  const expiry = Math.floor(now / 1000) + GATE_TOKEN_TTL_SECONDS;
  const payload = `${env}.${expiry}`;
  return `${payload}.${gateSignature(payload)}`;
}

export function verifyGateToken(token: string | undefined, now = Date.now()): boolean {
  if (!token || token.length > 256 || !isDevelopmentEnvironment()) return false;
  const [env, expires, signature, ...extra] = token.split(".");
  const expiry = Number(expires);
  const current = Math.floor(now / 1000);
  if (extra.length || !signature || env !== getActiveSessionEnvironmentTag() ||
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
 * In Development (isolated or read-only): redirect to /login.
 * In Production: redirect to Portal SSO module launcher page (#/modules).
 */
export function getLogoutRedirectUrl(): string {
  if (isTestBrowserEnvironment()) {
    return "/login";
  }
  return getSsoModuleLauncherUrl();
}
