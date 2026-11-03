import { SpartaRole, Scope } from "@/types/incident";

/**
 * EXACTLY 9 FINALIZED SIAGA ROLES:
 * 1. System Administrator (System Role: ADMIN — protected, never imported)
 * 2. Admin (Consolidated HO Business Role: admin — encompasses ho_admin, gm_ho, sm_ho)
 * 3. BnM Manajer (Branch Business Role: bm)
 * 4. BMC (Branch Business Role: bmc)
 * 5. BEC (Branch Business Role: bec)
 * 6. BBC (Branch Business Role: bbc)
 * 7. BMS (Branch Business Role: bms)
 * 8. BES (Branch Business Role: bes)
 * 9. BBS (Branch Business Role: bbs)
 */
export const FINALIZED_SIAGA_BUSINESS_ROLES = [
  "admin", // Consolidated Head Office Admin
  "bm",    // BnM Manajer (Branch)
  "bmc",   // Branch Maintenance Coordinator
  "bec",   // Branch Engineering Coordinator
  "bbc",   // Branch Building Coordinator
  "bms",   // Branch Maintenance Support
  "bes",   // Branch Engineering Support
  "bbs",   // Branch Building Support
] as const;

export type FinalizedSiagaBusinessRole = typeof FINALIZED_SIAGA_BUSINESS_ROLES[number];

// Compatible internal keys (ho_admin, gm_ho, sm_ho consolidate to 'admin')
export const COMPATIBLE_HO_INTERNAL_KEYS = ["ho_admin", "gm_ho", "sm_ho"] as const;

export function isFinalizedSiagaBusinessRole(role?: string | null): role is FinalizedSiagaBusinessRole {
  if (!role) return false;
  const lower = role.toLowerCase();
  return (FINALIZED_SIAGA_BUSINESS_ROLES as readonly string[]).includes(lower);
}

/**
 * Raw input user record compatible with Building, Maintenance, Engineering, and SSO exports
 */
export interface RawSpartaUserRecord {
  // Identifiers (Building lacks NIK; supports SSO ID and normalized email)
  id?: string | null;
  ssoId?: string | null;
  externalUserId?: string | null;
  nik?: string | null;
  employeeId?: string | null;
  email?: string | null;
  email_sat?: string | null;

  // Identity & Names
  name?: string | null;
  fullName?: string | null;
  nama_lengkap?: string | null;

  // Roles & Job Title
  role?: string | null;
  jabatan?: string | null;
  moduleRole?: string | null;
  moduleId?: string | null;
  system?: "BUILDING" | "MAINTENANCE" | "ENGINEERING" | string | null;
  sourceModule?: string | null;

  // Branch & Location
  branch?: string | null;
  cabang?: string | null;
  branchCode?: string | null;
  branchName?: string | null;
  branchNames?: string[] | string | null;
  location?: string | null;

  // Account Status (supports soft-delete flags)
  status?: string | boolean | null;
  isActive?: boolean | string | number | null;
  is_active?: boolean | string | number | null;
  is_soft_deleted?: boolean | string | number | null;
  deleted_at?: string | null;

  // SSO Reference & Status Cross-Check
  ssoMatched?: boolean | null;
  hasSiagaGrant?: boolean | null;
  ssoStatus?: string | null;
  ssoMatchType?: string | null;
  activeModuleAccess?: string[] | null;
  canonicalBranches?: string[] | null;
  nonCanonicalBranches?: string[] | null;
  conflicts?: string[] | null;
}

/**
 * Categorization of user synchronization into SIAGA:
 * - PENDING_SSO_GRANT: Active in SSO with clean mapping, awaiting IT portal grant (669 candidates)
 * - UNMATCHED_SSO: Active in module, but not yet registered in login-sparta (123 candidates)
 * - PENDING_REVIEW: Role conflict or non-canonical/facility branch (31 exceptions)
 * - BLOCKED: Soft-deleted or inactive in source module (50 blocked)
 * - ACTIVE: Active in SSO with SIAGA module already granted
 */
export type SiagaSyncCategory =
  | "PENDING_SSO_GRANT"
  | "UNMATCHED_SSO"
  | "PENDING_REVIEW"
  | "BLOCKED"
  | "ACTIVE";

export type SyncRecordStatus =
  | "NEW"
  | "UPDATE"
  | "UNCHANGED"
  | "SKIPPED"
  | "FLAGGED_FOR_REVIEW"
  | "PENDING_SSO_GRANT"
  | "UNMATCHED_SSO"
  | "PENDING_REVIEW"
  | "BLOCKED";

export interface MultiRoleAssignment {
  module: string;
  sourceRole: string;
  mappedRole: FinalizedSiagaBusinessRole | null;
  isSupported: boolean;
  notes?: string;
}

export interface NormalizedSyncUser {
  ssoId: string | null;
  nik: string | null;
  email: string | null;
  name: string;
  businessRole: FinalizedSiagaBusinessRole;
  scope: Scope;
  branch: string | null;
  secondaryBranches?: string[];
  status: "ACTIVE" | "INACTIVE";
  ssoStatus?: SiagaSyncCategory;
  category?: SiagaSyncCategory;
  source: string;
  sourceModule: "BUILDING" | "MAINTENANCE" | "ENGINEERING" | "SSO" | "SPARTA_ECOSYSTEM";
  originalRole: string;
  multiRoles?: MultiRoleAssignment[];
  needsReview?: boolean;
  reviewReason?: string;
}

export interface SyncRecordResult {
  identifier: string; // NIK, SSO ID, or Email
  nik: string | null;
  email: string | null;
  name: string;
  targetRole: FinalizedSiagaBusinessRole | null;
  targetScope: Scope | null;
  targetBranch: string | null;
  secondaryBranches?: string[];
  sourceModule: string;
  status: SyncRecordStatus;
  category?: SiagaSyncCategory;
  ssoStatus?: SiagaSyncCategory;
  reason?: string;
  changedFields?: Record<string, { from: unknown; to: unknown }>;
  multiRoles?: MultiRoleAssignment[];
}

export interface SsoUserReference {
  email: string;
  nik?: string | null;
  ssoId?: string | null;
  name?: string | null;
  status?: string | null; // e.g. "ACTIVE"
  activeModuleAccess?: string[] | null;
}

export interface UserSyncOptions {
  dryRun?: boolean;
  sourceModule?: "BUILDING" | "MAINTENANCE" | "ENGINEERING" | "SSO" | "ALL" | "PILOT" | "PILOT_REAL" | "ALL_RECONCILED" | string;
  allowUpdates?: boolean;
  allowProductionSync?: boolean;
  ssoReferenceUsers?: (SsoUserReference | RawSpartaUserRecord)[];
  ssoReferenceMap?: Map<string, SsoUserReference>;
  existingUsers?: any[];
}

export interface UserSyncReport {
  timestamp: string;
  dryRun: boolean;
  sourceModule: string;
  totalScanned: number;
  validCount: number;
  newCount: number;
  updatedCount: number;
  unchangedCount: number;
  skippedCount: number;
  flaggedForReviewCount: number;
  pendingSsoGrantCount?: number;
  unmatchedSsoCount?: number;
  pendingReviewCount?: number;
  blockedCount?: number;
  categoriesBreakdown?: {
    PENDING_SSO_GRANT: number;
    UNMATCHED_SSO: number;
    PENDING_REVIEW: number;
    BLOCKED: number;
    ACTIVE: number;
  };
  rolesBreakdown: Record<string, number>;
  branchesBreakdown: Record<string, number>;
  records: SyncRecordResult[];
  errors: string[];
}
