// ============================================================
// CENTRALIZED PERMISSION KEYS & TYPES (SHARED CLIENT & SERVER)
// ============================================================

export const PERMISSION_KEYS = [
  // LAPORAN
  "REPORT_VIEW_ALL",
  "REPORT_VIEW_OWN",
  "REPORT_CONFIRM",
  "REPORT_BM_APPROVAL",
  "REPORT_FOLLOW_UP",
  "REPORT_UPDATE_PROGRESS",
  "REPORT_CLOSE",
  // NOTIFIKASI
  "NOTIFICATION_VIEW",
  // MANAGEMENT
  "MANAGEMENT_INSTRUCTION_CREATE",
  // ESTIMASI (Foundation only - not full workflow)
  "ESTIMATION_TRIGGER",
  "ESTIMATION_VIEW",
  // WORK READINESS (Task 3)
  "WORK_READINESS_UPDATE",
  // COMPLETION & APPROVAL (Task 5)
  "COMPLETION_SUBMIT",
  "COMPLETION_APPROVE_COORDINATOR",
] as const;

export type PermissionKey = (typeof PERMISSION_KEYS)[number];

export type PermissionEffect = "ALLOW" | "DENY";
export type ScopeType = "OWN_SCOPE" | "SPECIFIC_BRANCH" | "ALL_BRANCHES";

export interface PermissionDefinition {
  key: PermissionKey;
  label: string;
  category: "LAPORAN" | "NOTIFIKASI" | "MANAGEMENT" | "ESTIMASI";
  description: string;
  isOperational?: boolean;
}

export const PERMISSION_DEFINITIONS: PermissionDefinition[] = [
  // LAPORAN
  {
    key: "REPORT_VIEW_ALL",
    label: "Lihat Semua Laporan (Nasional)",
    category: "LAPORAN",
    description: "Izin memantau seluruh laporan bencana di seluruh cabang secara nasional.",
  },
  {
    key: "REPORT_VIEW_OWN",
    label: "Lihat Laporan Cabang Sendiri",
    category: "LAPORAN",
    description: "Izin melihat laporan yang terjadi pada cakupan cabang / toko sendiri.",
  },
  {
    key: "REPORT_CONFIRM",
    label: "Konfirmasi / Pemeriksaan Laporan",
    category: "LAPORAN",
    description: "Izin melakukan pemeriksaan dan pengajuan hasil kondisi lapangan oleh BMS/BES.",
    isOperational: true,
  },
  {
    key: "REPORT_BM_APPROVAL",
    label: "Persetujuan BnM Manajer",
    category: "LAPORAN",
    description: "Izin memberikan keputusan dan persetujuan awal BnM Manajer terhadap hasil pemeriksaan cabang.",
    isOperational: true,
  },
  {
    key: "REPORT_FOLLOW_UP",
    label: "Follow Up Laporan",
    category: "LAPORAN",
    description: "Izin menindaklanjuti investigasi dan penanganan laporan operasional.",
    isOperational: true,
  },
  {
    key: "REPORT_UPDATE_PROGRESS",
    label: "Update Progress",
    category: "LAPORAN",
    description: "Izin memperbarui persentase progress dan catatan perbaikan teknis.",
    isOperational: true,
  },
  {
    key: "REPORT_CLOSE",
    label: "Close Laporan",
    category: "LAPORAN",
    description: "Izin menyelesaikan dan menutup laporan insiden/kerusakan.",
    isOperational: true,
  },

  // NOTIFIKASI
  {
    key: "NOTIFICATION_VIEW",
    label: "Lihat Notifikasi",
    category: "NOTIFIKASI",
    description: "Izin menerima dan membuka daftar notifikasi peringatan bencana.",
  },

  // MANAGEMENT
  {
    key: "MANAGEMENT_INSTRUCTION_CREATE",
    label: "Management Instruction",
    category: "MANAGEMENT",
    description: "Izin membuat instruksi tanggap darurat manajemen untuk disiarkan ke cabang.",
  },

  // ESTIMASI
  {
    key: "ESTIMATION_TRIGGER",
    label: "Buat / Trigger Estimasi",
    category: "ESTIMASI",
    description: "Izin memicu pembuatan tiket estimasi perbaikan / pemeliharaan.",
  },
  {
    key: "ESTIMATION_VIEW",
    label: "Lihat Status Estimasi",
    category: "ESTIMASI",
    description: "Izin melihat status dan rincian estimasi perbaikan.",
  },
  // WORK READINESS
  {
    key: "WORK_READINESS_UPDATE",
    label: "Update Syarat Siap Kerja (Readiness)",
    category: "ESTIMASI",
    description: "Izin mengunggah bukti dan memperbarui persyaratan kesiapan mulai kerja fisik.",
    isOperational: true,
  },
  // COMPLETION & APPROVAL (Task 5)
  {
    key: "COMPLETION_SUBMIT",
    label: "Ajukan Penyelesaian Pekerjaan",
    category: "LAPORAN",
    description: "Izin mengajukan penyelesaian pekerjaan fisik setelah 100% dan bukti serah terima lengkap (PIC Lapangan BMS/BES/BBS).",
    isOperational: true,
  },
  {
    key: "COMPLETION_APPROVE_COORDINATOR",
    label: "Approval Penyelesaian Koordinator",
    category: "LAPORAN",
    description: "Izin menyetujui atau meminta revisi pengajuan penyelesaian pekerjaan (Koordinator BMC/BEC/BBC).",
    isOperational: true,
  },
];

// ============================================================
// ADMINISTRATIVE CAPABILITIES (INHERENT TO SYSTEM ADMIN)
// ============================================================

export const ADMIN_CAPABILITIES = [
  "MANAGE_USERS",
  "MANAGE_ROLES",
  "MANAGE_PERMISSIONS",
  "VIEW_AUDIT_LOG",
  "SYSTEM_CONFIGURATION",
] as const;

export type AdminCapability = (typeof ADMIN_CAPABILITIES)[number];

// ============================================================
// OPERATIONAL PERMISSIONS (BUSINESS OPERATIONS — REQUIRE EXPLICIT PERMISSION/SCOPE)
// ============================================================

export const OPERATIONAL_PERMISSIONS: readonly PermissionKey[] = [
  "REPORT_CONFIRM",
  "REPORT_BM_APPROVAL",
  "REPORT_FOLLOW_UP",
  "REPORT_UPDATE_PROGRESS",
  "REPORT_CLOSE",
  "MANAGEMENT_INSTRUCTION_CREATE",
  "ESTIMATION_TRIGGER",
  "WORK_READINESS_UPDATE",
  "COMPLETION_SUBMIT",
  "COMPLETION_APPROVE_COORDINATOR",
] as const;

export const MONITORING_PERMISSIONS: readonly PermissionKey[] = [
  "REPORT_VIEW_ALL",
  "NOTIFICATION_VIEW",
  "ESTIMATION_VIEW",
] as const;

export function isOperationalPermission(key: PermissionKey): boolean {
  return (OPERATIONAL_PERMISSIONS as readonly string[]).includes(key);
}

export function isMonitoringPermission(key: PermissionKey): boolean {
  return (MONITORING_PERMISSIONS as readonly string[]).includes(key);
}

// ============================================================
// CANONICAL SCOPE POLICIES PER PERMISSION
// ============================================================

export type ScopePolicyType = "FIXED_NATIONAL" | "FIXED_OWN" | "BRANCH_SCOPED";

export interface PermissionScopeRule {
  key: PermissionKey;
  policy: ScopePolicyType;
  allowedScopes: readonly ScopeType[];
  defaultScope: ScopeType;
  scopeSummary: (userContext?: { branch?: string | null; scope?: string | null }) => string;
  description: string;
}

export const PERMISSION_SCOPE_RULES: Record<PermissionKey, PermissionScopeRule> = {
  REPORT_VIEW_ALL: {
    key: "REPORT_VIEW_ALL",
    policy: "FIXED_NATIONAL",
    allowedScopes: ["ALL_BRANCHES"],
    defaultScope: "ALL_BRANCHES",
    scopeSummary: () => "Seluruh Cabang (Nasional)",
    description: "Izin monitoring baca seluruh laporan cabang secara nasional.",
  },
  REPORT_VIEW_OWN: {
    key: "REPORT_VIEW_OWN",
    policy: "FIXED_OWN",
    allowedScopes: ["OWN_SCOPE"],
    defaultScope: "OWN_SCOPE",
    scopeSummary: (u) => `Cabang Pengguna (${u?.branch || "Scope User"})`,
    description: "Izin melihat laporan cabang/toko penugasan sendiri.",
  },
  NOTIFICATION_VIEW: {
    key: "NOTIFICATION_VIEW",
    policy: "FIXED_OWN",
    allowedScopes: ["OWN_SCOPE"],
    defaultScope: "OWN_SCOPE",
    scopeSummary: () => "Global / Seluruh Notifikasi Bencana",
    description: "Izin memantau feed notifikasi peringatan bencana.",
  },
  MANAGEMENT_INSTRUCTION_CREATE: {
    key: "MANAGEMENT_INSTRUCTION_CREATE",
    policy: "FIXED_NATIONAL",
    allowedScopes: ["ALL_BRANCHES"],
    defaultScope: "ALL_BRANCHES",
    scopeSummary: () => "Seluruh Cabang (Nasional)",
    description: "Izin menerbitkan instruksi tanggap darurat manajemen HO.",
  },
  ESTIMATION_VIEW: {
    key: "ESTIMATION_VIEW",
    policy: "FIXED_OWN",
    allowedScopes: ["OWN_SCOPE"],
    defaultScope: "OWN_SCOPE",
    scopeSummary: (u) => `Cabang Pengguna (${u?.branch || "Scope User"})`,
    description: "Izin melihat status tiket estimasi perbaikan.",
  },
  REPORT_CONFIRM: {
    key: "REPORT_CONFIRM",
    policy: "BRANCH_SCOPED",
    allowedScopes: ["SPECIFIC_BRANCH", "OWN_SCOPE"],
    defaultScope: "SPECIFIC_BRANCH",
    scopeSummary: (u) => `Operasional Cabang (${u?.branch || "Branch"})`,
    description: "Izin konfirmasi kondisi kerusakan di lapangan.",
  },
  REPORT_BM_APPROVAL: {
    key: "REPORT_BM_APPROVAL",
    policy: "BRANCH_SCOPED",
    allowedScopes: ["SPECIFIC_BRANCH", "OWN_SCOPE"],
    defaultScope: "SPECIFIC_BRANCH",
    scopeSummary: (u) => `Keputusan BnM Manajer (${u?.branch || "Cabang"})`,
    description: "Izin persetujuan awal BnM Manajer terhadap hasil pemeriksaan cabang.",
  },
  REPORT_FOLLOW_UP: {
    key: "REPORT_FOLLOW_UP",
    policy: "BRANCH_SCOPED",
    allowedScopes: ["SPECIFIC_BRANCH", "OWN_SCOPE"],
    defaultScope: "SPECIFIC_BRANCH",
    scopeSummary: (u) => `Operasional Cabang (${u?.branch || "Branch"})`,
    description: "Izin investigasi dan tindak lanjut penanganan insiden.",
  },
  REPORT_UPDATE_PROGRESS: {
    key: "REPORT_UPDATE_PROGRESS",
    policy: "BRANCH_SCOPED",
    allowedScopes: ["SPECIFIC_BRANCH", "OWN_SCOPE"],
    defaultScope: "SPECIFIC_BRANCH",
    scopeSummary: (u) => `Operasional Cabang (${u?.branch || "Branch"})`,
    description: "Izin pembaruan persentase progress perbaikan teknis.",
  },
  REPORT_CLOSE: {
    key: "REPORT_CLOSE",
    policy: "BRANCH_SCOPED",
    allowedScopes: ["SPECIFIC_BRANCH", "OWN_SCOPE"],
    defaultScope: "SPECIFIC_BRANCH",
    scopeSummary: (u) => `Operasional Cabang (${u?.branch || "Branch"})`,
    description: "Izin penyelesaian dan penutupan laporan insiden.",
  },
  ESTIMATION_TRIGGER: {
    key: "ESTIMATION_TRIGGER",
    policy: "BRANCH_SCOPED",
    allowedScopes: ["SPECIFIC_BRANCH", "OWN_SCOPE"],
    defaultScope: "SPECIFIC_BRANCH",
    scopeSummary: (u) => `Operasional Cabang (${u?.branch || "Branch"})`,
    description: "Izin pembuatan tiket estimasi perbaikan fisik.",
  },
  WORK_READINESS_UPDATE: {
    key: "WORK_READINESS_UPDATE",
    policy: "BRANCH_SCOPED",
    allowedScopes: ["SPECIFIC_BRANCH", "OWN_SCOPE"],
    defaultScope: "SPECIFIC_BRANCH",
    scopeSummary: (u) => `Operasional Cabang (${u?.branch || "Branch"})`,
    description: "Izin verifikasi kesiapan kerja fisik di toko.",
  },
  COMPLETION_SUBMIT: {
    key: "COMPLETION_SUBMIT",
    policy: "BRANCH_SCOPED",
    allowedScopes: ["SPECIFIC_BRANCH", "OWN_SCOPE"],
    defaultScope: "SPECIFIC_BRANCH",
    scopeSummary: (u) => `Operasional Cabang (${u?.branch || "Branch"})`,
    description: "Izin pengajuan penyelesaian pekerjaan fisik (PIC).",
  },
  COMPLETION_APPROVE_COORDINATOR: {
    key: "COMPLETION_APPROVE_COORDINATOR",
    policy: "BRANCH_SCOPED",
    allowedScopes: ["SPECIFIC_BRANCH", "OWN_SCOPE"],
    defaultScope: "SPECIFIC_BRANCH",
    scopeSummary: (u) => `Operasional Cabang (${u?.branch || "Branch"})`,
    description: "Izin approval penyelesaian pekerjaan (Koordinator).",
  },
};

export function getPermissionScopeRule(key: PermissionKey): PermissionScopeRule {
  return (
    PERMISSION_SCOPE_RULES[key] || {
      key,
      policy: "BRANCH_SCOPED",
      allowedScopes: ["SPECIFIC_BRANCH", "OWN_SCOPE"],
      defaultScope: "SPECIFIC_BRANCH",
      scopeSummary: (u) => `Cabang (${u?.branch || "N/A"})`,
      description: "Pengaturan izin operasional cabang.",
    }
  );
}

export function isFixedScopePermission(key: PermissionKey): boolean {
  const rule = getPermissionScopeRule(key);
  return rule.policy === "FIXED_NATIONAL" || rule.policy === "FIXED_OWN";
}

// ============================================================
// ROLE PERMISSION CATALOG (INHERENT PERMISSIONS PER BUSINESS ROLE)
// ============================================================
// Menentukan permission apa saja yang memang secara business rule
// merupakan hak bawaan role tersebut dan dapat dikelola (ON/OFF) oleh Admin.
// Permission di luar katalog role TIDAK BOLEH tampil di tab Hak Akses Role.
export const ROLE_PERMISSION_CATALOG: Record<string, readonly PermissionKey[]> = {
  admin: [
    "REPORT_VIEW_ALL",
    "NOTIFICATION_VIEW",
    "MANAGEMENT_INSTRUCTION_CREATE",
    "ESTIMATION_VIEW",
  ],
  ho_admin: [
    "REPORT_VIEW_ALL",
    "NOTIFICATION_VIEW",
    "ESTIMATION_VIEW",
  ],
  gm_ho: [
    "REPORT_VIEW_ALL",
    "NOTIFICATION_VIEW",
    "MANAGEMENT_INSTRUCTION_CREATE",
    "ESTIMATION_VIEW",
  ],
  sm_ho: [
    "REPORT_VIEW_ALL",
    "NOTIFICATION_VIEW",
    "MANAGEMENT_INSTRUCTION_CREATE",
    "ESTIMATION_VIEW",
  ],
  bm: [
    "REPORT_VIEW_OWN",
    "REPORT_CONFIRM",
    "REPORT_BM_APPROVAL",
    "REPORT_FOLLOW_UP",
    "REPORT_CLOSE",
    "NOTIFICATION_VIEW",
    "ESTIMATION_VIEW",
  ],
  tim_toko: [
    "REPORT_VIEW_OWN",
    "REPORT_CONFIRM",
    "REPORT_FOLLOW_UP",
    "NOTIFICATION_VIEW",
    "ESTIMATION_VIEW",
  ],
  sparta_maintenance: [
    "REPORT_VIEW_OWN",
    "REPORT_FOLLOW_UP",
    "NOTIFICATION_VIEW",
    "ESTIMATION_VIEW",
  ],
  bms: [
    "REPORT_VIEW_OWN",
    "REPORT_CONFIRM",
    "REPORT_FOLLOW_UP",
    "REPORT_UPDATE_PROGRESS",
    "NOTIFICATION_VIEW",
    "ESTIMATION_TRIGGER",
    "ESTIMATION_VIEW",
    "WORK_READINESS_UPDATE",
    "COMPLETION_SUBMIT",
  ],
  bmc: [
    "REPORT_VIEW_OWN",
    "REPORT_FOLLOW_UP",
    "NOTIFICATION_VIEW",
    "ESTIMATION_VIEW",
    "COMPLETION_APPROVE_COORDINATOR",
  ],
  bes: [
    "REPORT_VIEW_OWN",
    "REPORT_CONFIRM",
    "REPORT_FOLLOW_UP",
    "REPORT_UPDATE_PROGRESS",
    "NOTIFICATION_VIEW",
    "ESTIMATION_TRIGGER",
    "ESTIMATION_VIEW",
    "COMPLETION_SUBMIT",
  ],
  bec: [
    "REPORT_VIEW_OWN",
    "REPORT_FOLLOW_UP",
    "NOTIFICATION_VIEW",
    "ESTIMATION_VIEW",
    "COMPLETION_APPROVE_COORDINATOR",
  ],
  bbs: [
    "REPORT_VIEW_OWN",
    "REPORT_CONFIRM",
    "REPORT_FOLLOW_UP",
    "REPORT_UPDATE_PROGRESS",
    "NOTIFICATION_VIEW",
    "ESTIMATION_VIEW",
    "COMPLETION_SUBMIT",
  ],
  bbc: [
    "REPORT_VIEW_OWN",
    "REPORT_FOLLOW_UP",
    "NOTIFICATION_VIEW",
    "ESTIMATION_VIEW",
    "COMPLETION_APPROVE_COORDINATOR",
  ],
  bnm: [
    "REPORT_VIEW_OWN",
    "REPORT_FOLLOW_UP",
    "NOTIFICATION_VIEW",
    "ESTIMATION_VIEW",
  ],
} as const;

export function isPermissionInRoleCatalog(role: string, permission: PermissionKey): boolean {
  const catalog = ROLE_PERMISSION_CATALOG[role.toLowerCase()];
  if (!catalog) return false;
  return (catalog as readonly string[]).includes(permission);
}

// Default State per Catalog Permission (All inherent permissions default to ALLOW unless toggled OFF)
export const DEFAULT_ROLE_PERMISSIONS: Record<string, Partial<Record<PermissionKey, PermissionEffect>>> = {
  admin: {
    REPORT_VIEW_ALL: "ALLOW",
    NOTIFICATION_VIEW: "ALLOW",
    MANAGEMENT_INSTRUCTION_CREATE: "ALLOW",
    ESTIMATION_VIEW: "ALLOW",
  },
  ho_admin: {
    REPORT_VIEW_ALL: "ALLOW",
    NOTIFICATION_VIEW: "ALLOW",
    ESTIMATION_VIEW: "ALLOW",
  },
  gm_ho: {
    REPORT_VIEW_ALL: "ALLOW",
    NOTIFICATION_VIEW: "ALLOW",
    MANAGEMENT_INSTRUCTION_CREATE: "ALLOW",
    ESTIMATION_VIEW: "ALLOW",
  },
  sm_ho: {
    REPORT_VIEW_ALL: "ALLOW",
    NOTIFICATION_VIEW: "ALLOW",
    MANAGEMENT_INSTRUCTION_CREATE: "ALLOW",
    ESTIMATION_VIEW: "ALLOW",
  },
  bm: {
    REPORT_VIEW_OWN: "ALLOW",
    REPORT_CONFIRM: "ALLOW",
    REPORT_BM_APPROVAL: "ALLOW",
    REPORT_FOLLOW_UP: "ALLOW",
    REPORT_CLOSE: "ALLOW",
    NOTIFICATION_VIEW: "ALLOW",
    ESTIMATION_VIEW: "ALLOW",
  },
  tim_toko: {
    REPORT_VIEW_OWN: "ALLOW",
    REPORT_CONFIRM: "ALLOW",
    REPORT_FOLLOW_UP: "ALLOW",
    NOTIFICATION_VIEW: "ALLOW",
    ESTIMATION_VIEW: "ALLOW",
  },
  sparta_maintenance: {
    REPORT_VIEW_OWN: "ALLOW",
    REPORT_FOLLOW_UP: "ALLOW",
    NOTIFICATION_VIEW: "ALLOW",
    ESTIMATION_VIEW: "ALLOW",
  },
  bms: {
    REPORT_VIEW_OWN: "ALLOW",
    REPORT_CONFIRM: "ALLOW",
    REPORT_FOLLOW_UP: "ALLOW",
    REPORT_UPDATE_PROGRESS: "ALLOW",
    NOTIFICATION_VIEW: "ALLOW",
    ESTIMATION_TRIGGER: "ALLOW",
    ESTIMATION_VIEW: "ALLOW",
    WORK_READINESS_UPDATE: "ALLOW",
    COMPLETION_SUBMIT: "ALLOW",
  },
  bmc: {
    REPORT_VIEW_OWN: "ALLOW",
    REPORT_FOLLOW_UP: "ALLOW",
    NOTIFICATION_VIEW: "ALLOW",
    ESTIMATION_VIEW: "ALLOW",
    COMPLETION_APPROVE_COORDINATOR: "ALLOW",
  },
  bes: {
    REPORT_VIEW_OWN: "ALLOW",
    REPORT_CONFIRM: "ALLOW",
    REPORT_FOLLOW_UP: "ALLOW",
    REPORT_UPDATE_PROGRESS: "ALLOW",
    NOTIFICATION_VIEW: "ALLOW",
    ESTIMATION_TRIGGER: "ALLOW",
    ESTIMATION_VIEW: "ALLOW",
    COMPLETION_SUBMIT: "ALLOW",
  },
  bec: {
    REPORT_VIEW_OWN: "ALLOW",
    REPORT_FOLLOW_UP: "ALLOW",
    NOTIFICATION_VIEW: "ALLOW",
    ESTIMATION_VIEW: "ALLOW",
    COMPLETION_APPROVE_COORDINATOR: "ALLOW",
  },
  bbs: {
    REPORT_VIEW_OWN: "ALLOW",
    REPORT_CONFIRM: "ALLOW",
    REPORT_FOLLOW_UP: "ALLOW",
    REPORT_UPDATE_PROGRESS: "ALLOW",
    NOTIFICATION_VIEW: "ALLOW",
    ESTIMATION_VIEW: "ALLOW",
    COMPLETION_SUBMIT: "ALLOW",
  },
  bbc: {
    REPORT_VIEW_OWN: "ALLOW",
    REPORT_FOLLOW_UP: "ALLOW",
    NOTIFICATION_VIEW: "ALLOW",
    ESTIMATION_VIEW: "ALLOW",
    COMPLETION_APPROVE_COORDINATOR: "ALLOW",
  },
  bnm: {
    REPORT_VIEW_OWN: "ALLOW",
    REPORT_FOLLOW_UP: "ALLOW",
    NOTIFICATION_VIEW: "ALLOW",
    ESTIMATION_VIEW: "ALLOW",
  },
};

export interface RolePermissionRecord {
  id: string;
  businessRole: string;
  permissionKey: PermissionKey;
  effect: PermissionEffect;
  createdAt: string;
  updatedAt: string;
}

export interface UserPermissionOverrideRecord {
  id: string;
  userId: string;
  permissionKey: PermissionKey;
  effect: PermissionEffect;
  scopeType: ScopeType;
  branchCode: string | null;
  reason: string;
  startsAt: string;
  expiresAt: string | null;
  grantedBy: string | null;
  revokedAt: string | null;
  revokedBy: string | null;
  createdAt: string;
  updatedAt: string;
  policyCompliance?: OverridePolicyCompliance;
}

export interface OverridePolicyCompliance {
  isValid: boolean;
  isCompliant: boolean;
  isEffective: boolean;
  isEffectivelyActive: boolean;
  statusCode: "ACTIVE_ALLOWED" | "ACTIVE_DENIED" | "EXPIRED" | "REVOKED" | "POLICY_CONFLICT";
  statusBadgeText: string;
  statusBadgeClass: string;
  policyWarning?: string;
  reason?: string;
}

export function evaluateOverridePolicyCompliance(
  override: UserPermissionOverrideRecord,
  _user?: { scope?: string | null; branch?: string | null }
): OverridePolicyCompliance {
  const isRevoked = Boolean(override.revokedAt);
  const isExpired = !isRevoked && Boolean(override.expiresAt) && new Date(override.expiresAt!) <= new Date();

  if (isRevoked) {
    return {
      isValid: true,
      isCompliant: true,
      isEffective: false,
      isEffectivelyActive: false,
      statusCode: "REVOKED",
      statusBadgeText: "DICABUT",
      statusBadgeClass: "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-700",
      reason: "Override telah dicabut secara manual oleh Administrator.",
    };
  }

  if (isExpired) {
    return {
      isValid: true,
      isCompliant: true,
      isEffective: false,
      isEffectivelyActive: false,
      statusCode: "EXPIRED",
      statusBadgeText: "KADALUARSA",
      statusBadgeClass: "bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800",
      reason: "Masa berlaku override telah berakhir.",
    };
  }

  const isOp = isOperationalPermission(override.permissionKey);
  const scopeRule = getPermissionScopeRule(override.permissionKey);

  // Prohibit operational permissions with ALL_BRANCHES scope
  if (isOp && override.scopeType === "ALL_BRANCHES") {
    const warning =
      "Hak akses operasional tidak diizinkan menggunakan cakupan seluruh cabang (ALL_BRANCHES). Override ini diblokir oleh sistem demi keamanan isolasi cabang (Zero Cross-Branch Mutation).";
    return {
      isValid: false,
      isCompliant: false,
      isEffective: false,
      isEffectivelyActive: false,
      statusCode: "POLICY_CONFLICT",
      statusBadgeText: "Tidak Berlaku — Bertentangan dengan Kebijakan",
      statusBadgeClass: "bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-200 border-amber-300 dark:border-amber-700",
      policyWarning: warning,
      reason: warning,
    };
  }

  // Check if scopeType is in allowedScopes
  if (!scopeRule.allowedScopes.includes(override.scopeType)) {
    const warning = `Cakupan '${override.scopeType}' tidak sesuai dengan kebijakan '${override.permissionKey}'. Cakupan yang didukung: ${scopeRule.allowedScopes.join(", ")}.`;
    return {
      isValid: false,
      isCompliant: false,
      isEffective: false,
      isEffectivelyActive: false,
      statusCode: "POLICY_CONFLICT",
      statusBadgeText: "Tidak Berlaku — Bertentangan dengan Kebijakan",
      statusBadgeClass: "bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-200 border-amber-300 dark:border-amber-700",
      policyWarning: warning,
      reason: warning,
    };
  }

  if (override.effect === "DENY") {
    return {
      isValid: true,
      isCompliant: true,
      isEffective: true,
      isEffectivelyActive: true,
      statusCode: "ACTIVE_DENIED",
      statusBadgeText: "DITOLAK",
      statusBadgeClass: "bg-rose-100 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 border-rose-200 dark:border-rose-800",
      reason: "Override aktif dengan instruksi penolakan (DENY).",
    };
  }

  return {
    isValid: true,
    isCompliant: true,
    isEffective: true,
    isEffectivelyActive: true,
    statusCode: "ACTIVE_ALLOWED",
    statusBadgeText: "DIIZINKAN",
    statusBadgeClass: "bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800",
    reason: "Override aktif dan sesuai dengan kebijakan.",
  };
}

export interface PermissionAuditLogRecord {
  id: string;
  actorUserId: string | null;
  actorName: string | null;
  action: string;
  targetRole: string | null;
  targetUserId: string | null;
  permissionKey: PermissionKey;
  effect: PermissionEffect;
  scopeType: ScopeType | null;
  branchCode: string | null;
  reason: string | null;
  expiresAt: string | null;
  createdAt: string;
}

