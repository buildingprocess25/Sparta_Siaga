import { NextResponse } from "next/server";
import { 
  getSpartaEnvironment, 
  isDevelopmentEnvironment, 
  isQuickLoginPermitted, 
  getSsoPortalUrl, 
  getSsoModuleLauncherUrl, isTestBrowserEnvironment, isGateRequired, isGateEnabled 
} from "@/lib/environment-policy";

export async function GET(req: Request) {
  const env = getSpartaEnvironment();
  const isDev = isDevelopmentEnvironment();
  const quickLoginCheck = isQuickLoginPermitted(req);

  return NextResponse.json({
    environment: env,
    isTestEnvironment: isTestBrowserEnvironment(),
    gateRequired: isGateRequired(req),
    gateEnabled: isGateEnabled(),
    isDevelopment: isDev,
    isQuickLoginAllowed: quickLoginCheck.allowed,
    quickLoginReason: quickLoginCheck.reason,
    ssoPortalUrl: getSsoPortalUrl(),
    ssoModuleLauncherUrl: getSsoModuleLauncherUrl(),
  }, { headers: { "Cache-Control": "no-store" } });
}
