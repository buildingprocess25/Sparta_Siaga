import { isPortalManagedUser } from "./sparta-identity";
import { isDevelopmentReadOnlyMode } from "./environment-policy";
import type { UserModel } from "./user-db";

export type PortalRoleSyncSkipReason =
  | "local_user"
  | "system_admin"
  | "user_not_active"
  | "portal_access_not_active"
  | "missing_portal_identity"
  | "role_unchanged"
  | "missing_business_role"
  | "missing_portal_branch"
  | "portal_not_configured"
  | "read_only_mode";

export type PortalRoleSyncResult =
  | { status: "SYNCED"; role: string }
  | { status: "SKIPPED"; reason: PortalRoleSyncSkipReason }
  | { status: "FAILED"; statusCode?: number; message: string };

export interface PortalRoleSyncPayload {
  email: string;
  employeeId: string | null;
  fullName: string;
  branchCode: string;
  branchName: string;
  role: string;
  moduleId: "siaga";
}

export type PortalRoleSyncEligibility =
  | { eligible: true; payload: PortalRoleSyncPayload }
  | { eligible: false; reason: PortalRoleSyncSkipReason };

/**
 * Evaluates whether a SIAGA user update should report a role change back to Portal SPARTA.
 * Enforces an anti-reactivation guard because Portal's `/v1/admin/users/sync` reactivates
 * inactive module grants when called for an existing user.
 */
export function evaluatePortalRoleSyncEligibility(
  previous: Pick<UserModel, "systemRole" | "businessRole" | "status" | "ssoStatus" | "source" | "externalUserId">,
  next: Pick<
    UserModel,
    | "systemRole"
    | "businessRole"
    | "scope"
    | "branch"
    | "branchCode"
    | "pendingPortalBranch"
    | "status"
    | "ssoStatus"
    | "source"
    | "externalUserId"
    | "email"
    | "nik"
    | "name"
  >,
  env?: { spartaApiUrl?: string; internalApiKey?: string }
): PortalRoleSyncEligibility {
  if (!isPortalManagedUser(next)) {
    return { eligible: false, reason: "local_user" };
  }

  if (previous.systemRole === "ADMIN" || next.systemRole === "ADMIN") {
    return { eligible: false, reason: "system_admin" };
  }

  if (previous.status !== "ACTIVE" || next.status !== "ACTIVE") {
    return { eligible: false, reason: "user_not_active" };
  }

  const normalizedSsoStatus = (next.ssoStatus || "").trim().toUpperCase();
  if (normalizedSsoStatus && normalizedSsoStatus !== "ACTIVE") {
    return { eligible: false, reason: "portal_access_not_active" };
  }

  const email = next.email?.trim().toLowerCase() || "";
  if (!next.externalUserId?.trim() || !email) {
    return { eligible: false, reason: "missing_portal_identity" };
  }

  const prevRole = (previous.businessRole || "").trim().toLowerCase();
  const nextRole = (next.businessRole || "").trim().toLowerCase();
  if (!nextRole) {
    return { eligible: false, reason: "missing_business_role" };
  }
  if (prevRole === nextRole) {
    return { eligible: false, reason: "role_unchanged" };
  }

  const spartaApiUrl = (env?.spartaApiUrl ?? process.env.SPARTA_API_URL ?? "").trim();
  const internalApiKey = (env?.internalApiKey ?? process.env.SPARTA_INTERNAL_API_KEY ?? "").trim();
  if (!spartaApiUrl || !internalApiKey) {
    return { eligible: false, reason: "portal_not_configured" };
  }

  const branchCode = next.branchCode?.trim() || next.pendingPortalBranch?.branchCode?.trim() || "";
  const branchName =
    next.scope === "HO"
      ? next.pendingPortalBranch?.branch?.trim() || next.branch?.trim() || ""
      : next.branch?.trim() || next.pendingPortalBranch?.branch?.trim() || "";

  if (!branchCode || !branchName) {
    return { eligible: false, reason: "missing_portal_branch" };
  }

  return {
    eligible: true,
    payload: {
      email,
      employeeId: next.nik?.trim() || null,
      fullName: (next.name || "").trim() || email,
      branchCode,
      branchName,
      role: nextRole.toUpperCase(),
      moduleId: "siaga",
    },
  };
}

/**
 * Reports an operational role change on an active Portal-connected SIAGA user
 * to Portal SPARTA via `POST /v1/admin/users/sync`.
 */
export async function reportSiagaRoleChangeToPortal(
  previous: Pick<UserModel, "systemRole" | "businessRole" | "status" | "ssoStatus" | "source" | "externalUserId">,
  next: UserModel,
  options?: {
    spartaApiUrl?: string;
    internalApiKey?: string;
    fetchFn?: typeof fetch;
    timeoutMs?: number;
  }
): Promise<PortalRoleSyncResult> {
  if (isDevelopmentReadOnlyMode()) {
    return { status: "SKIPPED", reason: "read_only_mode" };
  }
  const spartaApiUrl = (options?.spartaApiUrl ?? process.env.SPARTA_API_URL ?? "").trim().replace(/\/+$/, "");
  const internalApiKey = (options?.internalApiKey ?? process.env.SPARTA_INTERNAL_API_KEY ?? "").trim();

  const eligibility = evaluatePortalRoleSyncEligibility(previous, next, { spartaApiUrl, internalApiKey });
  if (!eligibility.eligible) {
    return { status: "SKIPPED", reason: eligibility.reason };
  }

  const customFetch = options?.fetchFn || fetch;
  const timeoutMs = options?.timeoutMs ?? 5000;

  try {
    const response = await customFetch(`${spartaApiUrl}/v1/admin/users/sync`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "x-sparta-internal-key": internalApiKey,
      },
      body: JSON.stringify(eligibility.payload),
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
      redirect: "error",
    });

    if (!response.ok) {
      let message = `Sinkronisasi role ke Portal SPARTA gagal (HTTP ${response.status}).`;
      try {
        const body = await response.json();
        const detail = body?.error?.message || body?.message || body?.error;
        if (typeof detail === "string" && detail.trim()) {
          message = detail.trim();
        }
      } catch {
        // Ignore non-JSON error body
      }
      return { status: "FAILED", statusCode: response.status, message };
    }

    return { status: "SYNCED", role: eligibility.payload.role };
  } catch (error) {
    return {
      status: "FAILED",
      message: error instanceof Error ? error.message : "Gagal menghubungi Portal SPARTA saat sinkronisasi role.",
    };
  }
}
