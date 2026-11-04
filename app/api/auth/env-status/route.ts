import { NextResponse } from "next/server";
import {
  getSpartaEnvironment,
  isDevelopmentEnvironment,
  isQuickLoginPermitted,
  getSsoPortalUrl,
  getSsoModuleLauncherUrl
} from "@/lib/environment-policy";

export async function GET(req: Request) {
  const env = getSpartaEnvironment();
  const isDev = isDevelopmentEnvironment();
  const quickLoginCheck = isQuickLoginPermitted(req);

  return NextResponse.json({
    environment: env,
    isDevelopment: isDev,
    isQuickLoginAllowed: quickLoginCheck.allowed,
    quickLoginReason: quickLoginCheck.reason,
    ssoPortalUrl: getSsoPortalUrl(),
    ssoModuleLauncherUrl: getSsoModuleLauncherUrl(),
  });
}
