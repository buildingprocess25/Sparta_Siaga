import type { Pool } from "pg";
import { getDbPool } from "./db";
import { CANONICAL_BRANCH_LIST, CanonicalBranchRecord } from "./branch-utils";
import { branchMasterEnabled } from "./sparta-rollout";
import { resolvePortalBranch, type PortalBranch } from "./sparta-master-contract";
import { SpartaIntegrationError } from "./sparta-identity";

let cachedLegacyCounts: Map<string, number> | null = null;
let lastLegacyCountsFetch = 0;
let cachedPortalBranches: CanonicalBranchRecord[] | null = null;
let lastPortalBranchesFetch = 0;
const CACHE_TTL = 300_000;

export function invalidateBranchMasterCache() {
  cachedLegacyCounts = null;
  lastLegacyCountsFetch = 0;
  cachedPortalBranches = null;
  lastPortalBranchesFetch = 0;
}

/**
 * Gets all canonical branches, reading active `sparta_master_branches` when portal branch conversion is active,
 * or falling back to the 28-branch organizational list with legacy store counts before conversion.
 */
export async function getCanonicalBranches(options: { pool?: Pool } = {}): Promise<CanonicalBranchRecord[]> {
  const pool = options.pool || getDbPool();
  const now = Date.now();

  if (branchMasterEnabled()) {
    if (!options.pool && cachedPortalBranches && now - lastPortalBranchesFetch <= CACHE_TTL) {
      return cachedPortalBranches;
    }

    const branchRes = await pool.query<{ code: string; name: string; aliases: unknown }>(
      `SELECT code, name, aliases FROM sparta_master_branches WHERE is_active = TRUE ORDER BY name ASC`
    );

    if (!branchRes.rows.length) {
      throw new SpartaIntegrationError("BRANCH_MASTER_NOT_READY", "Master cabang Portal belum disinkronkan.", 503);
    }

    const countsMap = new Map<string, number>();
    try {
      const countsRes = await pool.query<{ branch_code: string; store_count: number }>(
        `SELECT branch_code, COUNT(*)::int AS store_count
         FROM stores
         WHERE COALESCE(is_active, TRUE) = TRUE AND branch_code IS NOT NULL
         GROUP BY branch_code`
      );
      for (const row of countsRes.rows) {
        countsMap.set(String(row.branch_code), Number(row.store_count));
      }
    } catch {
      // Preserve portal branch list even if store counts query fails before store conversion
    }

    const mapped: CanonicalBranchRecord[] = branchRes.rows.map((row) => ({
      code: String(row.code),
      name: String(row.name),
      aliases: Array.isArray(row.aliases) ? row.aliases.map(String) : [],
      storeCount: countsMap.get(String(row.code)) || undefined,
      source: "SPARTA_PORTAL",
    }));

    if (!options.pool) {
      cachedPortalBranches = mapped;
      lastPortalBranchesFetch = now;
    }
    return mapped;
  }

  if (options.pool || !cachedLegacyCounts || now - lastLegacyCountsFetch > CACHE_TTL) {
    try {
      const res = await pool.query(`
        SELECT UPPER(cabang) as cabang_code, COUNT(*)::int as store_count
        FROM stores
        GROUP BY UPPER(cabang)
      `);
      const countsMap = new Map<string, number>();
      for (const row of res.rows) {
        countsMap.set(row.cabang_code, row.store_count);
      }
      if (!options.pool) {
        cachedLegacyCounts = countsMap;
        lastLegacyCountsFetch = now;
      } else {
        return CANONICAL_BRANCH_LIST.map((b) => ({
          ...b,
          storeCount: countsMap.get(b.code) || undefined,
          source: "LEGACY",
        }));
      }
    } catch {
      // Fallback if query fails
    }
  }

  return CANONICAL_BRANCH_LIST.map((b) => ({
    ...b,
    storeCount: cachedLegacyCounts?.get(b.code) || undefined,
    source: "LEGACY",
  }));
}

/**
 * Search canonical branches by query string (matching code, name, or alias).
 */
export async function searchCanonicalBranches(
  query: string,
  options: { pool?: Pool } = {}
): Promise<CanonicalBranchRecord[]> {
  const all = await getCanonicalBranches(options);
  const q = query.trim().toUpperCase();
  if (!q) return all;

  return all.filter((b) => {
    if (b.code.toUpperCase().includes(q)) return true;
    if (b.name.toUpperCase().includes(q)) return true;
    return b.aliases.some((a) => a.toUpperCase().includes(q));
  });
}

/**
 * Resolves a branch input (code, official name, or alias) against active Portal master branches.
 */
export async function resolveActivePortalBranch(
  rawInput: string,
  options: { pool?: Pool } = {}
): Promise<{ code: string; name: string } | null> {
  if (!branchMasterEnabled() || !rawInput?.trim()) return null;
  const pool = options.pool || getDbPool();
  const { rows } = await pool.query<{ code: string; name: string; aliases: unknown; updated_at?: unknown }>(
    `SELECT code, name, aliases, updated_at FROM sparta_master_branches WHERE is_active = TRUE`
  );
  if (!rows.length) {
    throw new SpartaIntegrationError("BRANCH_MASTER_NOT_READY", "Master cabang Portal belum disinkronkan.", 503);
  }
  const portalBranches: PortalBranch[] = rows.map((row) => ({
    code: String(row.code),
    name: String(row.name),
    aliases: Array.isArray(row.aliases) ? row.aliases.map(String) : [],
    isActive: true,
    updatedAt: row.updated_at ? new Date(String(row.updated_at)).toISOString() : new Date(0).toISOString(),
  }));
  const resolvedCode = resolvePortalBranch(rawInput, portalBranches);
  if (!resolvedCode) return null;
  const matched = portalBranches.find((b) => b.code === resolvedCode);
  return matched ? { code: matched.code, name: matched.name } : { code: resolvedCode, name: resolvedCode };
}
