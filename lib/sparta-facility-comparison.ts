import { SpartaIntegrationError } from "./sparta-identity";
import { resolvePortalBranch, type PortalBranch } from "./sparta-master-contract";

export interface FacilityComparisonRow {
  code: string;
  name: string;
  type: string;
  latitude: number | null;
  longitude: number | null;
  branchCode: string | null;
}

export interface FacilityComparisonOptions {
  portalBranches?: PortalBranch[];
  coordinateTolerance?: number;
}

export interface FacilityFieldDiff {
  code: string;
  fields: string[];
  details: Record<string, { siaga: unknown; carbontrack: unknown }>;
}

export interface FacilityBranchIssue {
  code: string;
  rawBranch: string;
  reason: "unmapped" | "ambiguous";
}

function toNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const num = typeof value === "number" ? value : Number(String(value).trim().replace(",", "."));
  return Number.isFinite(num) ? num : null;
}

function normalizeName(value: unknown): string {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").toUpperCase() : "";
}

function normalizeType(value: unknown): string {
  return typeof value === "string" ? value.trim().replace(/\s+/g, "_").toUpperCase() : "";
}

function normalizeBranchRaw(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.trim().replace(/\s+/g, " ").toUpperCase();
  return cleaned || null;
}

/**
 * Projects a row from SIAGA's `facilities` table into the canonical comparison shape.
 */
export function projectSiagaFacilityForComparison(row: {
  code: unknown;
  name: unknown;
  type?: unknown;
  facility_type?: unknown;
  latitude?: unknown;
  longitude?: unknown;
  branchCode?: unknown;
  branch_code?: unknown;
  branch_id?: unknown;
}): FacilityComparisonRow {
  const rawBranch = row.branchCode ?? row.branch_code ?? row.branch_id ?? null;
  return {
    code: typeof row.code === "string" ? row.code.trim().toUpperCase() : String(row.code ?? "").trim().toUpperCase(),
    name: typeof row.name === "string" ? row.name.trim() : String(row.name ?? "").trim(),
    type: normalizeType(row.type ?? row.facility_type ?? ""),
    latitude: toNullableNumber(row.latitude),
    longitude: toNullableNumber(row.longitude),
    branchCode: typeof rawBranch === "string" && rawBranch.trim() ? rawBranch.trim() : null,
  };
}

/**
 * Compares facility masters between SPARTA SIAGA and CarbonTrack without picking
 * an authoritative source until the Portal SPARTA Phase 4 facility contract is agreed.
 */
export function compareFacilityMasters(
  siaga: FacilityComparisonRow[],
  carbontrack: FacilityComparisonRow[],
  options: FacilityComparisonOptions = {}
) {
  const index = (rows: FacilityComparisonRow[]) => {
    const map = new Map<string, FacilityComparisonRow>();
    for (const row of rows) {
      const code = row.code?.trim().toUpperCase();
      if (!code || map.has(code)) {
        throw new Error("Kode fasilitas kosong atau berulang; perbaiki ekspor sebelum dibandingkan.");
      }
      map.set(code, row);
    }
    return map;
  };

  const left = index(siaga);
  const right = index(carbontrack);
  const tolerance = options.coordinateTolerance ?? 1e-5;
  const portalBranches = options.portalBranches?.length ? options.portalBranches : null;

  const missingCoordinates = {
    siaga: [] as string[],
    carbontrack: [] as string[],
  };
  const unmappedBranches = {
    siaga: [] as FacilityBranchIssue[],
    carbontrack: [] as FacilityBranchIssue[],
  };

  const resolveBranchValue = (
    code: string,
    rawValue: string | null,
    side: "siaga" | "carbontrack"
  ): string | null => {
    const cleaned = normalizeBranchRaw(rawValue);
    if (!cleaned) return null;
    if (!portalBranches) return cleaned;
    try {
      const resolved = resolvePortalBranch(cleaned, portalBranches);
      if (!resolved) {
        unmappedBranches[side].push({ code, rawBranch: rawValue!.trim(), reason: "unmapped" });
        return cleaned;
      }
      return resolved;
    } catch (error) {
      if (error instanceof SpartaIntegrationError && error.code === "AMBIGUOUS_BRANCH") {
        unmappedBranches[side].push({ code, rawBranch: rawValue!.trim(), reason: "ambiguous" });
        return cleaned;
      }
      throw error;
    }
  };

  const siagaBranches = new Map<string, string | null>();
  for (const [code, row] of left) {
    if (toNullableNumber(row.latitude) === null || toNullableNumber(row.longitude) === null) {
      missingCoordinates.siaga.push(code);
    }
    siagaBranches.set(code, resolveBranchValue(code, row.branchCode, "siaga"));
  }

  const carbonBranches = new Map<string, string | null>();
  for (const [code, row] of right) {
    if (toNullableNumber(row.latitude) === null || toNullableNumber(row.longitude) === null) {
      missingCoordinates.carbontrack.push(code);
    }
    carbonBranches.set(code, resolveBranchValue(code, row.branchCode, "carbontrack"));
  }

  const different: FacilityFieldDiff[] = [];
  let matchedExactCount = 0;

  for (const [code, row] of left) {
    const other = right.get(code);
    if (!other) continue;

    const changed: string[] = [];
    const details: Record<string, { siaga: unknown; carbontrack: unknown }> = {};

    if (normalizeName(row.name) !== normalizeName(other.name)) {
      changed.push("name");
      details.name = { siaga: row.name, carbontrack: other.name };
    }
    if (normalizeType(row.type) !== normalizeType(other.type)) {
      changed.push("type");
      details.type = { siaga: row.type, carbontrack: other.type };
    }

    const latA = toNullableNumber(row.latitude);
    const latB = toNullableNumber(other.latitude);
    if (latA === null || latB === null ? latA !== latB : Math.abs(latA - latB) > tolerance) {
      changed.push("latitude");
      details.latitude = { siaga: row.latitude, carbontrack: other.latitude };
    }

    const lonA = toNullableNumber(row.longitude);
    const lonB = toNullableNumber(other.longitude);
    if (lonA === null || lonB === null ? lonA !== lonB : Math.abs(lonA - lonB) > tolerance) {
      changed.push("longitude");
      details.longitude = { siaga: row.longitude, carbontrack: other.longitude };
    }

    const branchA = siagaBranches.get(code) ?? null;
    const branchB = carbonBranches.get(code) ?? null;
    if (branchA !== branchB) {
      changed.push("branchCode");
      details.branchCode = { siaga: branchA, carbontrack: branchB };
    }

    if (changed.length) {
      different.push({ code, fields: changed, details });
    } else {
      matchedExactCount += 1;
    }
  }

  return {
    siagaCount: left.size,
    carbontrackCount: right.size,
    onlySiaga: [...left.keys()].filter(code => !right.has(code)),
    onlyCarbontrack: [...right.keys()].filter(code => !left.has(code)),
    matchedExactCount,
    differentCount: different.length,
    different,
    missingCoordinates,
    unmappedBranches,
    portalBranchResolutionUsed: Boolean(portalBranches),
    sourceDecision: "PENDING_AGREEMENT" as const,
    portalSync: "BLOCKED_NO_PORTAL_FACILITY_CONTRACT" as const,
  };
}
