// ============================================================
// SPARTA SIAGA — CANONICAL ROLE CATALOG & IDENTITY DEFINITIONS
// Single Source of Truth for Human Business Roles, Scope, and Metadata
// ============================================================

export type SystemRoleType = "ADMIN" | "USER";
export type ScopeType = "HO" | "BRANCH";

export interface BusinessRoleDefinition {
  key: string;
  label: string;
  fullLabel?: string;
  scope: ScopeType;
  category: "HO" | "BRANCH" | "LEGACY" | "INTEGRATION";
  selectable: boolean;
  description: string;
}

/**
 * 11 CANONICAL HUMAN BUSINESS ROLES
 * 3 Head Office roles + 8 Branch operational roles.
 * Seluruhnya merupakan human persona yang dapat login dan dipilih dalam User Management.
 */
export const CANONICAL_HUMAN_ROLES: readonly BusinessRoleDefinition[] = [
  // --- HEAD OFFICE ---
  {
    key: "admin",
    label: "Admin",
    fullLabel: "Head Office Administrator",
    scope: "HO",
    category: "HO",
    selectable: true,
    description: "Administrator Head Office pemantau nasional seluruh cabang SPARTA SIAGA.",
  },
  {
    key: "ho_admin",
    label: "HO Admin",
    fullLabel: "Head Office Administrator",
    scope: "HO",
    category: "LEGACY",
    selectable: false,
    description: "Pemantau nasional lintas cabang dan administrasi operasional HO (Legacy — dikonsolidasi ke Admin).",
  },
  {
    key: "gm_ho",
    label: "GM HO",
    fullLabel: "General Manager Head Office",
    scope: "HO",
    category: "LEGACY",
    selectable: false,
    description: "Manajemen eksekutif HO (Legacy — dikonsolidasi ke Admin).",
  },
  {
    key: "sm_ho",
    label: "SM HO",
    fullLabel: "Senior Manager Head Office",
    scope: "HO",
    category: "LEGACY",
    selectable: false,
    description: "Senior Manajemen HO (Legacy — dikonsolidasi ke Admin).",
  },

  // --- BRANCH ---
  {
    key: "bm",
    label: "BnM Manajer",
    fullLabel: "BnM Manajer",
    scope: "BRANCH",
    category: "BRANCH",
    selectable: true,
    description: "Pimpinan cabang BnM Manajer, pemegang wewenang approval awal, approval final penyelesaian pekerjaan dan Case Close cabang sendiri.",
  },
  {
    key: "tim_toko",
    label: "Tim Toko",
    fullLabel: "Tim Personil Gerai / Toko",
    scope: "BRANCH",
    category: "BRANCH",
    selectable: false,
    description: "Personil lapangan gerai ritel (NONAKTIF — dinonaktifkan sesuai kebijakan restrukturisasi, data historis dipertahankan).",
  },
  {
    key: "bms",
    label: "BMS",
    fullLabel: "Branch Maintenance Support",
    scope: "BRANCH",
    category: "BRANCH",
    selectable: true,
    description: "PIC teknis lapangan pemeliharaan toko, pembuat estimasi TKP Toko, updater progress, dan pengaju penyelesaian fisik.",
  },
  {
    key: "bmc",
    label: "BMC",
    fullLabel: "Branch Maintenance Coordinator",
    scope: "BRANCH",
    category: "BRANCH",
    selectable: true,
    description: "Branch Maintenance Coordinator: Koordinator pemeliharaan gerai cabang, verifikator dan approver Serah Terima fisik pekerjaan Toko sebelum diajukan ke BnM Manajer.",
  },
  {
    key: "bes",
    label: "BES",
    fullLabel: "Branch Engineering Support",
    scope: "BRANCH",
    category: "BRANCH",
    selectable: true,
    description: "PIC teknis lapangan Engineering (Gudang / DC), updater progress DC, dan pengaju penyelesaian pekerjaan DC.",
  },
  {
    key: "bec",
    label: "BEC",
    fullLabel: "Branch Engineering Coordinator",
    scope: "BRANCH",
    category: "BRANCH",
    selectable: true,
    description: "Branch Engineering Coordinator: Koordinator Engineering cabang, verifikator dan approver Serah Terima pekerjaan Gudang / DC sebelum diajukan ke BnM Manajer.",
  },
  {
    key: "bbs",
    label: "BBS",
    fullLabel: "Branch Building Support",
    scope: "BRANCH",
    category: "BRANCH",
    selectable: true,
    description: "Branch Building Support: PIC teknis pemeliharaan gedung/fasilitas cabang, pengunggah bukti pekerjaan dan dokumen milestone.",
  },
  {
    key: "bbc",
    label: "BBC",
    fullLabel: "Branch Building Coordinator",
    scope: "BRANCH",
    category: "BRANCH",
    selectable: true,
    description: "Branch Building Coordinator: Koordinator pemeliharaan gedung cabang, verifikator dan approver Serah Terima pekerjaan Gedung sebelum diajukan ke BnM Manajer.",
  },
] as const;

/**
 * SPECIAL / LEGACY / INTEGRATION ROLES
 * Dipertahankan untuk audit dan backward-compatibility kode lama.
 * TIDAK BOLEH muncul pada dropdown pembuatan user baru (selectable = false).
 */
export const SPECIAL_LEGACY_ROLES: readonly BusinessRoleDefinition[] = [
  {
    key: "rekanan",
    label: "Rekanan Eksternal",
    fullLabel: "Vendor / Rekanan Eksternal",
    scope: "BRANCH",
    category: "LEGACY",
    selectable: false,
    description: "Struktur entitas rekanan / kontraktor eksternal (NONAKTIF — tanpa hak akses login maupun operasional langsung di aplikasi).",
  },
  {
    key: "sparta_maintenance",
    label: "Sparta Maintenance",
    fullLabel: "SPARTA Maintenance System",
    scope: "BRANCH",
    category: "INTEGRATION",
    selectable: false,
    description: "Sistem destinasi integrasi estimasi internal BMS (bukan persona login manusia).",
  },
  {
    key: "bnm",
    label: "BnM",
    fullLabel: "Branch & Maintenance Department",
    scope: "BRANCH",
    category: "INTEGRATION",
    selectable: false,
    description: "Departemen/target instruksi dan destinasi alur Rekanan via BNM_MANTRA (bukan persona login manusia).",
  },
  {
    key: "tim_maintenance",
    label: "Tim Maintenance",
    scope: "BRANCH",
    category: "LEGACY",
    selectable: false,
    description: "Role legacy versi awal (telah digantikan oleh spesialisasi BMS/BES/BBS).",
  },
  {
    key: "tim_office",
    label: "Tim Office",
    scope: "BRANCH",
    category: "LEGACY",
    selectable: false,
    description: "Role legacy versi awal.",
  },
  {
    key: "tim_warehouse",
    label: "Tim Warehouse",
    scope: "BRANCH",
    category: "LEGACY",
    selectable: false,
    description: "Role legacy versi awal (telah digantikan oleh alur BES/BEC).",
  },
] as const;

/**
 * Gabungan seluruh definisi role untuk lookup universal
 */
export const ALL_BUSINESS_ROLES: readonly BusinessRoleDefinition[] = [
  ...CANONICAL_HUMAN_ROLES,
  ...SPECIAL_LEGACY_ROLES,
] as const;

/**
 * Subset: Hanya human roles yang selectable untuk User Management UI & APIs
 */
export const HUMAN_SELECTABLE_ROLES = CANONICAL_HUMAN_ROLES.filter(
  (r) => r.selectable
);

export const HUMAN_SELECTABLE_HO_ROLES = CANONICAL_HUMAN_ROLES.filter(
  (r) => r.scope === "HO" && r.selectable
);

export const HUMAN_SELECTABLE_BRANCH_ROLES = CANONICAL_HUMAN_ROLES.filter(
  (r) => r.scope === "BRANCH" && r.selectable
);

/**
 * Lookup definisi role berdasarkan key (case-insensitive)
 */
export function getBusinessRoleDefinition(
  key?: string | null
): BusinessRoleDefinition | undefined {
  if (!key) return undefined;
  const lower = key.toLowerCase();
  return ALL_BUSINESS_ROLES.find((r) => r.key.toLowerCase() === lower);
}

/**
 * Cek apakah sebuah role key adalah human role yang valid dan selectable
 */
export function isValidHumanBusinessRole(key?: string | null): boolean {
  if (!key) return false;
  const def = getBusinessRoleDefinition(key);
  return Boolean(def && def.selectable);
}

/**
 * Turunkan scope server-side secara otoritatif dari Business Role
 * HO roles -> "HO"
 * BRANCH roles -> "BRANCH"
 * Invalid role -> null
 */
export function deriveScopeFromBusinessRole(
  key?: string | null
): ScopeType | null {
  if (!key) return null;
  const def = getBusinessRoleDefinition(key);
  if (!def) return null;
  return def.scope;
}

/**
 * Canonical display label resolver untuk seluruh tampilan UI dan logging
 */
export function getRoleDisplayLabel(role?: string | null): string {
  if (!role) return "User";
  const r = role.toLowerCase();

  // Khusus System Admin
  if (r === "sys_admin" || r === "system_admin") {
    return "Admin SPARTA SIAGA";
  }

  // Admin HO
  if (r === "admin") {
    return "Admin";
  }

  // BnM Manajer
  if (r === "bm") {
    return "BnM Manajer";
  }

  const def = getBusinessRoleDefinition(r);
  if (def) {
    return def.label;
  }

  // Fallback prettified text
  return role.replace(/_/g, " ").toUpperCase();
}

/**
 * Short label / singkatan resolver (misal: BnM Manajer, ADMIN, BMS, BES)
 */
export function getRoleShortLabel(role?: string | null): string {
  if (!role) return "User";
  const r = role.toLowerCase();
  if (r === "bm") return "BnM Manajer";
  if (r === "admin" || r === "sys_admin" || r === "system_admin") return "ADMIN";
  const def = getBusinessRoleDefinition(r);
  return def ? def.label : role.toUpperCase();
}
