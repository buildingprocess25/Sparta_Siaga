export interface SpartaIdentity {
  spartaUserId?: string | null;
  employeeId?: string | null;
  email?: string | null;
}

export interface IdentityCandidate {
  id: string;
  external_user_id?: string | null;
  nik?: string | null;
  email?: string | null;
  source?: string | null;
  system_role?: string | null;
}

export class SpartaIntegrationError extends Error {
  constructor(public code: string, message: string, public status = 400) {
    super(message);
  }
}

export function selectSpartaIdentity<T extends IdentityCandidate>(
  rows: T[],
  identity: SpartaIdentity,
  options: { allowLegacyLocalRelink?: boolean } = {}
): T | null {
  const portalId = identity.spartaUserId?.trim();
  const nik = identity.employeeId?.trim().toLowerCase();
  const email = identity.email?.trim().toLowerCase();
  const byId = portalId ? rows.filter(row => row.external_user_id?.trim() === portalId) : [];
  const byNik = nik ? rows.filter(row => row.nik?.trim().toLowerCase() === nik) : [];
  const byEmail = email ? rows.filter(row => row.email?.trim().toLowerCase() === email) : [];
  const candidates = [...byId, ...byNik, ...byEmail];
  if (new Set(candidates.map(row => row.id)).size > 1) {
    throw new SpartaIntegrationError("AMBIGUOUS_IDENTITY", "Identitas portal merujuk beberapa akun SIAGA.", 409);
  }
  const selected = byId[0] || byNik[0] || byEmail[0] || null;
  if (selected?.external_user_id?.trim() && portalId && selected.external_user_id.trim() !== portalId) {
    const canRelinkLegacyLocal =
      options.allowLegacyLocalRelink === true &&
      (selected.source || "").trim().toUpperCase() === "LOCAL" &&
      (selected.system_role || "").trim().toUpperCase() !== "ADMIN";
    if (!canRelinkLegacyLocal) {
      throw new SpartaIntegrationError("IDENTITY_ALREADY_LINKED", "Akun SIAGA sudah terhubung ke ID portal lain.", 409);
    }
  }
  return selected;
}

export const SPARTA_IDENTITY_WHERE = `
  (external_user_id = $1 AND $1::text IS NOT NULL)
  OR (LOWER(TRIM(nik)) = LOWER($2) AND $2::text IS NOT NULL)
  OR (LOWER(TRIM(email)) = LOWER($3) AND $3::text IS NOT NULL)`;

export function identityParameters(identity: SpartaIdentity) {
  return [identity.spartaUserId?.trim() || null, identity.employeeId?.trim() || null,
    identity.email?.trim().toLowerCase() || null];
}

export function canUseLocalPassword(source: string, restrictedEnvironment: boolean, transitionEnabled: boolean) {
  return source === "LOCAL" && (!restrictedEnvironment || transitionEnabled);
}

const PORTAL_MANAGED_SOURCES = new Set(["SPARTA", "SPARTA_SSO", "SSO"]);

export function isPortalManagedUser(user: { source?: string | null; externalUserId?: string | null }): boolean {
  if (user.externalUserId && user.externalUserId.trim().length > 0) return true;
  return PORTAL_MANAGED_SOURCES.has((user.source || "").trim().toUpperCase());
}

export function detectPortalIdentityFieldChanges(
  existing: { name?: string | null; nik?: string | null; email?: string | null },
  incoming: { name?: unknown; nik?: unknown; email?: unknown }
): string[] {
  const changed: string[] = [];
  if (incoming.name !== undefined) {
    const nextName = typeof incoming.name === "string" ? incoming.name.trim() : "";
    if (nextName !== (existing.name || "").trim()) changed.push("name");
  }
  if (incoming.nik !== undefined) {
    const nextNik = typeof incoming.nik === "string" ? incoming.nik.trim() || null : null;
    const prevNik = existing.nik?.trim() || null;
    if (nextNik !== prevNik) changed.push("nik");
  }
  if (incoming.email !== undefined) {
    const nextEmail = typeof incoming.email === "string" ? incoming.email.trim().toLowerCase() || null : null;
    const prevEmail = existing.email?.trim().toLowerCase() || null;
    if (nextEmail !== prevEmail) changed.push("email");
  }
  return changed;
}

export function shouldRevokeUserSessionsOnUpdate(
  existing: {
    systemRole?: string | null;
    businessRole?: string | null;
    scope?: string | null;
    branch?: string | null;
    status?: string | null;
  },
  next: {
    systemRole?: string | null;
    businessRole?: string | null;
    scope?: string | null;
    branch?: string | null;
    status?: string | null;
    passwordChanged?: boolean;
  }
): boolean {
  if (next.passwordChanged) return true;
  if ((next.systemRole ?? null) !== (existing.systemRole ?? null)) return true;
  if ((next.businessRole ?? null) !== (existing.businessRole ?? null)) return true;
  if ((next.scope ?? null) !== (existing.scope ?? null)) return true;
  if ((next.branch?.trim() || null) !== (existing.branch?.trim() || null)) return true;
  if ((next.status ?? null) !== (existing.status ?? null)) return true;
  return false;
}

export function getSpartaPortalUserManagementUrl(env: NodeJS.ProcessEnv = process.env): string {
  const baseUrl = (
    env.NEXT_PUBLIC_SPARTA_LOGIN_URL ||
    env.SPARTA_LOGIN_URL ||
    "https://sparta-alfamart.web.id"
  )
    .trim()
    .replace(/\/+$/, "");
  return `${baseUrl}/#/manajemen-user`;
}

export function detectCentralizedUserManagedFieldChanges(
  existing: {
    name?: string | null;
    nik?: string | null;
    email?: string | null;
    businessRole?: string | null;
    scope?: string | null;
    branch?: string | null;
    branchCode?: string | null;
    status?: string | null;
  },
  incoming: {
    name?: unknown;
    nik?: unknown;
    email?: unknown;
    businessRole?: unknown;
    scope?: unknown;
    branch?: unknown;
    branchCode?: unknown;
    status?: unknown;
  }
): string[] {
  const changed = detectPortalIdentityFieldChanges(existing, incoming);
  if (incoming.businessRole !== undefined) {
    const nextRole = typeof incoming.businessRole === "string" ? incoming.businessRole.trim().toLowerCase() || null : null;
    const prevRole = existing.businessRole?.trim().toLowerCase() || null;
    if (nextRole !== prevRole) changed.push("businessRole");
  }
  if (incoming.scope !== undefined) {
    const nextScope = typeof incoming.scope === "string" ? incoming.scope.trim().toUpperCase() || null : null;
    const prevScope = existing.scope?.trim().toUpperCase() || null;
    if (nextScope !== prevScope) changed.push("scope");
  }
  if (incoming.branch !== undefined) {
    const nextBranch = typeof incoming.branch === "string" ? incoming.branch.trim() || null : null;
    const prevBranch = existing.branch?.trim() || null;
    if (nextBranch !== prevBranch) changed.push("branch");
  }
  if (incoming.branchCode !== undefined) {
    const nextBranchCode = typeof incoming.branchCode === "string" ? incoming.branchCode.trim() || null : null;
    const prevBranchCode = existing.branchCode?.trim() || null;
    if (nextBranchCode !== prevBranchCode) changed.push("branchCode");
  }
  if (incoming.status !== undefined) {
    const nextStatus = typeof incoming.status === "string" ? incoming.status.trim().toUpperCase() || null : null;
    const prevStatus = existing.status?.trim().toUpperCase() || null;
    if (nextStatus !== prevStatus) changed.push("status");
  }
  return changed;
}
