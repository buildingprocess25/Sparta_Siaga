import { getSpartaEnvironment } from "./environment-policy";
export function currentSessionEnvironment(): string { return getSpartaEnvironment(); }
export function hasCurrentRefreshEnvironment(token: unknown): token is string {
  return typeof token === "string" && token.startsWith(`${currentSessionEnvironment()}.`) && /^[a-z]+\.[A-Za-z0-9_-]{43}$/.test(token);
}
export function canUseSessionIdentity(user: { id: string; source?: string | null; email?: string | null; nik?: string | null; ssoStatus?: string | null }): boolean {
  if (currentSessionEnvironment() !== "production") return true;
  return !(user.source?.toUpperCase() === "DEVELOPMENT" || user.ssoStatus === "UAT_PERSONA" ||
    user.email?.toLowerCase().endsWith("@sparta-siaga.local") || /^(DEV_|UAT_)/i.test(user.nik || "") ||
    /^(USR-DEMO|USR-BMS-001|USR-BM-G001)/i.test(user.id));
}
