import { NextResponse } from "next/server";
import {
  getSpartaEnvironment,
  getDevelopmentDataMode,
  isDevelopmentEnvironment,
  isDevelopmentReadOnlyMode,
  isReadOnlyLoopbackAllowed,
  isSimulationAllowed,
  isQuickLoginPermitted,
  getSsoPortalUrl,
  getSsoModuleLauncherUrl,
  isTestBrowserEnvironment,
  isGateRequired,
  isGateEnabled,
} from "@/lib/environment-policy";
import { getDbPool } from "@/lib/db";

const FALLBACK_BRANCHES = ["BANDUNG", "CIKOKOL"];

async function loadQuickLoginBranches(): Promise<string[]> {
  if (!isDevelopmentEnvironment()) return [];
  try {
    const pool = getDbPool();
    const res = await pool.query<{ branch: string }>(
      `SELECT DISTINCT UPPER(BTRIM(cabang)) AS branch
       FROM stores
       WHERE NULLIF(BTRIM(cabang), '') IS NOT NULL
       ORDER BY branch ASC
       LIMIT 200`
    );
    const branches = res.rows.map((r) => r.branch).filter(Boolean);
    return branches.length > 0 ? branches : FALLBACK_BRANCHES;
  } catch {
    return FALLBACK_BRANCHES;
  }
}

export async function GET(req: Request) {
  const env = getSpartaEnvironment();
  const isDev = isDevelopmentEnvironment();
  const dataMode = getDevelopmentDataMode();
  const isReadOnlyMode = isDevelopmentReadOnlyMode();
  if (isReadOnlyMode && !isReadOnlyLoopbackAllowed(req)) {
    return NextResponse.json(
      {
        error: "READ_ONLY_TUNNEL_FORBIDDEN",
        code: "READ_ONLY_TUNNEL_FORBIDDEN",
        message: "Mode Development Read-Only hanya diizinkan dari loopback lokal dan melarang ekspos melalui tunnel publik.",
      },
      { status: 403, headers: { "Cache-Control": "no-store" } }
    );
  }
  const quickLoginCheck = isQuickLoginPermitted(req);
  const availableBranches = quickLoginCheck.allowed ? await loadQuickLoginBranches() : [];

  return NextResponse.json({
    environment: env,
    dataMode,
    isReadOnlyMode,
    isSimulationAllowed: isSimulationAllowed(),
    isTestEnvironment: isTestBrowserEnvironment(),
    gateRequired: isGateRequired(req),
    gateEnabled: isGateEnabled(),
    isDevelopment: isDev,
    isQuickLoginAllowed: quickLoginCheck.allowed,
    quickLoginReason: quickLoginCheck.reason,
    availableBranches,
    ssoPortalUrl: getSsoPortalUrl(),
    ssoModuleLauncherUrl: getSsoModuleLauncherUrl(),
  }, { headers: { "Cache-Control": "no-store" } });
}
