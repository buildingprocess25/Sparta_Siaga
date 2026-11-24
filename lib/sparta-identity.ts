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
}

export class SpartaIntegrationError extends Error {
  constructor(public code: string, message: string, public status = 400) {
    super(message);
  }
}

export function selectSpartaIdentity<T extends IdentityCandidate>(rows: T[], identity: SpartaIdentity): T | null {
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
    throw new SpartaIntegrationError("IDENTITY_ALREADY_LINKED", "Akun SIAGA sudah terhubung ke ID portal lain.", 409);
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
