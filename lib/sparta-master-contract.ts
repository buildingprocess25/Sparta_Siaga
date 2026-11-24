import { SpartaIntegrationError } from "./sparta-identity";
import { branchMasterEnabled } from "./sparta-rollout";

export interface PortalBranch {
  code: string;
  name: string;
  aliases: string[];
  isActive: boolean;
  updatedAt: string;
}

export interface PortalStore {
  code: string;
  name: string;
  branchCode: string;
  address?: string | null;
  latitude: number | null;
  longitude: number | null;
  ownershipType: "REGULAR" | "FRANCHISE" | "UNKNOWN" | null;
  isActive: boolean;
  updatedAt: string;
}

export function normalizePortalAlias(value: string) {
  return value.trim().replace(/\s+/g, " ").toUpperCase();
}

export function resolvePortalBranch(value: string | null | undefined, branches: PortalBranch[]): string | null {
  if (!value?.trim()) return null;
  const key = normalizePortalAlias(value);
  for (const pick of [(b: PortalBranch) => [b.code], (b: PortalBranch) => [b.name], (b: PortalBranch) => b.aliases]) {
    const matches = branches.filter(b => b.isActive && pick(b).some(alias => normalizePortalAlias(alias) === key));
    if (matches.length > 1) throw new SpartaIntegrationError("AMBIGUOUS_BRANCH", `Alias cabang ambigu: ${value}`, 409);
    if (matches.length === 1) return matches[0].code;
  }
  return null;
}

function requiredText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function parsePortalBranches(value: unknown): PortalBranch[] {
  if (!Array.isArray(value)) throw new SpartaIntegrationError("INVALID_MASTER_PAYLOAD", "Daftar cabang tidak valid.", 502);
  const codes = new Set<string>();
  return value.map(row => {
    if (!row || !requiredText(row.code) || row.code !== row.code.trim() || !requiredText(row.name) || typeof row.isActive !== "boolean" ||
      !Array.isArray(row.aliases) || row.aliases.some((alias: unknown) => !requiredText(alias)) ||
      !requiredText(row.updatedAt) || !Number.isFinite(Date.parse(row.updatedAt)) || codes.has(row.code)) {
      throw new SpartaIntegrationError("INVALID_MASTER_PAYLOAD", "Baris cabang tidak valid atau kode berulang.", 502);
    }
    codes.add(row.code);
    return { code: row.code.trim(), name: row.name.trim(), aliases: row.aliases, isActive: row.isActive, updatedAt: row.updatedAt };
  });
}

export function parsePortalStores(value: unknown, branches: PortalBranch[]): PortalStore[] {
  if (!Array.isArray(value)) throw new SpartaIntegrationError("INVALID_MASTER_PAYLOAD", "Daftar toko tidak valid.", 502);
  const codes = new Set<string>();
  return value.map(row => {
    const coordinate = (v: unknown, max: number) => v === null || (typeof v === "number" && Number.isFinite(v) && Math.abs(v) <= max);
    if (!row || !requiredText(row.code) || row.code !== row.code.trim() || !requiredText(row.name) || !requiredText(row.branchCode) ||
      !resolvePortalBranch(row.branchCode, branches) || codes.has(row.code) ||
      typeof row.isActive !== "boolean" || !coordinate(row.latitude, 90) || !coordinate(row.longitude, 180) ||
      !["REGULAR", "FRANCHISE", "UNKNOWN", null].includes(row.ownershipType) ||
      (row.address !== undefined && row.address !== null && typeof row.address !== "string") ||
      !requiredText(row.updatedAt) || !Number.isFinite(Date.parse(row.updatedAt))) {
      throw new SpartaIntegrationError("INVALID_MASTER_PAYLOAD", "Baris toko tidak valid, kode berulang, atau cabang belum dikenal.", 502);
    }
    codes.add(row.code);
    return { code: row.code.trim(), name: row.name.trim(), branchCode: resolvePortalBranch(row.branchCode, branches)!,
      address: row.address, latitude: row.latitude, longitude: row.longitude,
      ownershipType: row.ownershipType, isActive: row.isActive, updatedAt: row.updatedAt };
  });
}

export function portalStoresEnabled() {
  const portal = process.env.STORE_MASTER_SOURCE?.trim().toLowerCase() === "portal";
  if (portal && !branchMasterEnabled()) {
    throw new SpartaIntegrationError("MASTER_CONVERSION_DISABLED", "Sumber toko portal memerlukan aktivasi tahap terakhir; sync sumber lama diblokir.", 503);
  }
  return portal;
}
