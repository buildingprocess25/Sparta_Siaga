import { getSessionUser } from "./auth";
import { UserContext } from "./report-permissions";
import { SpartaRole, SystemRole, Scope } from "@/types/incident";
import {
  PERMISSION_KEYS,
  PermissionKey,
  checkUserPermission,
  getUserOverrides,
} from "./permission-service";

export interface UserIdentity {
  id: string;
  userId: string;
  nik: string | null;
  name: string;
  avatarUrl: string | null;
  systemRole: SystemRole;
  businessRole: SpartaRole | null;
  scope: Scope | null;
  branch: string | null;
  role: SpartaRole | null;
  position: string;
  effectivePermissions?: Record<PermissionKey, boolean>;
  overrides?: import("./permission-service").UserPermissionOverrideRecord[];
  rolePermissions?: Partial<Record<PermissionKey, import("./permission-service").PermissionEffect>>;
}

/**
 * Resolves a UserContext into a full UserIdentity including effective permissions and role position.
 */
export async function resolveUserIdentityFromSession(session: UserContext): Promise<UserIdentity> {
  const isSystemAdmin = session.systemRole === "ADMIN";

  // Pre-fetch overrides once for efficiency
  let overrides: import("./permission-service").UserPermissionOverrideRecord[] = [];
  if (session.id) {
    overrides = await getUserOverrides(session.id);
  }

  let rolePermissions: Partial<Record<PermissionKey, import("./permission-service").PermissionEffect>> = {};
  if (session.role) {
    const { getRolePermissions } = await import("./permission-service");
    rolePermissions = await getRolePermissions(session.role);
  }

  const effectivePermissions: Partial<Record<PermissionKey, boolean>> = {};
  for (const key of PERMISSION_KEYS) {
    const res = await checkUserPermission({
      user: session,
      permission: key,
      overrides,
    });
    effectivePermissions[key] = res.authorized;
  }

  return {
    id: session.id,
    userId: session.id,
    nik: session.nik || null,
    name: session.name,
    avatarUrl: session.avatarUrl || null,
    systemRole: session.systemRole,
    businessRole: isSystemAdmin ? null : session.role,
    scope: isSystemAdmin ? null : session.scope,
    branch: isSystemAdmin ? null : session.branch,
    role: isSystemAdmin ? null : session.role,
    position: isSystemAdmin
      ? "System Administrator"
      : (session.scope === "HO" || session.role === "admin" || session.role?.includes("ho")
        ? "Staff Head Office"
        : "Staff Cabang"),
    effectivePermissions: effectivePermissions as Record<PermissionKey, boolean>,
    overrides,
    rolePermissions,
  };
}

/**
 * Resolves the current user's identity including effective permissions.
 */
export async function resolveCurrentUserIdentity(req?: Request): Promise<UserIdentity | null> {
  try {
    const session = await getSessionUser(req);
    
    if (!session) {
      return null;
    }

    return await resolveUserIdentityFromSession(session);
  } catch (error) {
    console.error("[Identity Service] Failed to resolve user identity:", error);
    return null;
  }
}
