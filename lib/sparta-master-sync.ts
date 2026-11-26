import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { getDbPool } from "./db";
import { branchMasterEnabled, requireMasterConversion } from "./sparta-rollout";
import { SpartaIntegrationError } from "./sparta-identity";
import { parsePortalBranches, parsePortalStores, resolvePortalBranch, type PortalBranch } from "./sparta-master-contract";
import type { StoreSyncHistoryRecord } from "./google-sheets-sync";
import { invalidateMasterStoresCache } from "./store-master-loader";
import { invalidateBranchMasterCache } from "./branch-master-query";

type Queryable = Pick<PoolClient, "query">;
export type MasterSyncOptions = { pool?: Pool; fetchFn?: typeof fetch; full?: boolean; confirmFull?: boolean };

export const MASTER_SYNC_ADVISORY_LOCK_ID = 7421843;

const branchKeyCache = new Map<string, { code: string; until: number }>();

export function clearBranchKeyCache() {
  branchKeyCache.clear();
}

export function requirePortalMasterConfig() {
  const base = process.env.SPARTA_API_URL?.trim();
  const key = process.env.SPARTA_INTERNAL_API_KEY?.trim();
  const missing = [!base && "SPARTA_API_URL", !key && "SPARTA_INTERNAL_API_KEY"].filter(Boolean);
  if (missing.length) throw new SpartaIntegrationError("PORTAL_NOT_CONFIGURED", `Environment belum diisi: ${missing.join(", ")}.`, 503);
  return { base: base!, key: key! };
}

async function requireMasterSchema(client: Queryable) {
  const { rows } = await client.query(`SELECT (
    to_regclass('sparta_master_branches') IS NOT NULL
    AND to_regclass('sparta_master_sync_state') IS NOT NULL
    AND to_regprocedure('sparta_resolve_branch(text)') IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM (VALUES ('users','branch_code'),('users','pending_portal_branch'),('stores','branch_code'),('incidents','branch_code'),
        ('stores','is_active'),('stores','master_source'),('stores','master_synced_at')) AS required(table_name,column_name)
      WHERE NOT EXISTS (SELECT 1 FROM information_schema.columns c WHERE c.table_schema=current_schema()
        AND c.table_name=required.table_name AND c.column_name=required.column_name)
    )
  ) AS master_schema_ready`);
  if (!rows[0]?.master_schema_ready) throw new SpartaIntegrationError("MASTER_SCHEMA_NOT_READY", "Schema tahap akhir belum lengkap. Periksa status migrasi; master dan histori sync belum diubah.", 409);
}

export async function fetchPortalMaster(resource: "branches" | "stores", options: { fetchFn?: typeof fetch; updatedSince?: string } = {}) {
  const { base, key } = requirePortalMasterConfig();
  const url = new URL(`/v1/master/${resource}`, `${base.replace(/\/+$/, "")}/`);
  if (resource === "stores") url.searchParams.set("moduleId", "siaga");
  if (options.updatedSince) url.searchParams.set("updatedSince", options.updatedSince);
  const response = await (options.fetchFn || fetch)(url, {
    headers: { Accept: "application/json", "x-sparta-internal-key": key },
    cache: "no-store", signal: AbortSignal.timeout(15000), redirect: "error",
  });
  if (!response.ok) throw new SpartaIntegrationError("MASTER_FETCH_FAILED", `Master ${resource}: HTTP ${response.status}.`, 502);
  const body = await response.json();
  if (!body?.meta?.syncedAt || !Number.isFinite(Date.parse(body.meta.syncedAt)) || !Array.isArray(body.data) ||
    body.meta.count !== body.data.length) {
    throw new SpartaIntegrationError("INVALID_MASTER_PAYLOAD", `Respons master ${resource} tidak lengkap.`, 502);
  }
  return { data: body.data as unknown[], syncedAt: String(body.meta.syncedAt) };
}

export async function savePortalBranches(client: Queryable, branches: PortalBranch[]) {
  if (!branches.length) throw new SpartaIntegrationError("EMPTY_BRANCH_MASTER", "Master cabang kosong; data SIAGA dipertahankan.", 502);
  await client.query("UPDATE sparta_master_branches SET is_active=FALSE WHERE NOT (code=ANY($1::text[]))", [branches.map(branch => branch.code)]);
  for (const branch of branches) {
    await client.query(`INSERT INTO sparta_master_branches (code, name, aliases, is_active, updated_at)
      VALUES ($1,$2,$3::jsonb,$4,$5) ON CONFLICT (code) DO UPDATE SET name=EXCLUDED.name,
      aliases=EXCLUDED.aliases, is_active=EXCLUDED.is_active, updated_at=EXCLUDED.updated_at, synced_at=NOW()`,
    [branch.code, branch.name, JSON.stringify(branch.aliases), branch.isActive, branch.updatedAt]);
  }
}

export async function canonicalBranchKey(value: string | null | undefined): Promise<string> {
  if (!value?.trim()) return "";
  if (!branchMasterEnabled()) return value.trim().toUpperCase();
  const cached = branchKeyCache.get(value);
  if (cached && cached.until > Date.now()) return cached.code;
  const pool = getDbPool();
  const { rows } = await pool.query("SELECT sparta_resolve_branch($1) AS code", [value]);
  const code = rows[0]?.code || value.trim().toUpperCase();
  branchKeyCache.set(value, { code, until: Date.now() + 60000 });
  return code;
}

export async function samePortalBranch(left: string | null | undefined, right: string | null | undefined) {
  if (!left?.trim() || !right?.trim()) return false;
  const [a, b] = await Promise.all([canonicalBranchKey(left), canonicalBranchKey(right)]);
  return a === b;
}

export const BRANCH_BACKFILL_TARGETS = [
  { table: "users", column: "branch", code: "branch_code" },
  { table: "stores", column: "cabang", code: "branch_code" },
  { table: "incidents", column: "branch", code: "branch_code" },
  { table: "report_completion_approvals", column: "branch_code", code: "branch_code" },
  { table: "user_permission_overrides", column: "branch_code", code: "branch_code" },
  { table: "permission_audit_logs", column: "branch_code", code: "branch_code" },
] as const;

const USER_PENDING_PORTAL_BRANCH_READONLY_SQL = `COALESCE(
  NULLIF(NULLIF(BTRIM(to_jsonb(users)->'pending_portal_branch'->>'branchCode'), ''), '-'),
  NULLIF(NULLIF(BTRIM(to_jsonb(users)->'pending_portal_branch'->>'branch'), ''), '-')
)`;

const USER_EFFECTIVE_BRANCH_READONLY_SQL = `COALESCE(
  ${USER_PENDING_PORTAL_BRANCH_READONLY_SQL},
  NULLIF(NULLIF(BTRIM(branch), ''), '-')
)`;

const USER_PENDING_PORTAL_BRANCH_SQL = `COALESCE(
  NULLIF(NULLIF(BTRIM(pending_portal_branch->>'branchCode'), ''), '-'),
  NULLIF(NULLIF(BTRIM(pending_portal_branch->>'branch'), ''), '-')
)`;

const USER_EFFECTIVE_BRANCH_SQL = `COALESCE(
  ${USER_PENDING_PORTAL_BRANCH_SQL},
  NULLIF(NULLIF(BTRIM(branch), ''), '-')
)`;

export async function inspectBranchBackfill(client: Queryable, branches: PortalBranch[]) {
  const unmapped: Array<{ table: string; value: string; count: number }> = [];
  const mapped: Array<{ table: string; value: string; code: string; count: number }> = [];
  for (const target of BRANCH_BACKFILL_TARGETS) {
    const querySql = target.table === "users"
      ? `SELECT ${USER_EFFECTIVE_BRANCH_READONLY_SQL} AS value, COUNT(*)::int AS count FROM users
         WHERE ${USER_EFFECTIVE_BRANCH_READONLY_SQL} IS NOT NULL
         AND COALESCE(scope, '') <> 'HO' AND system_role <> 'ADMIN'
         GROUP BY ${USER_EFFECTIVE_BRANCH_READONLY_SQL}`
      : `SELECT ${target.column} AS value, COUNT(*)::int AS count FROM ${target.table}
         WHERE NULLIF(BTRIM(${target.column}), '') IS NOT NULL
         GROUP BY ${target.column}`;
    const { rows } = await client.query(querySql);
    for (const row of rows) {
      const code = resolvePortalBranch(row.value, branches);
      if (!code) unmapped.push({ table: target.table, value: row.value, count: row.count });
      else mapped.push({ table: target.table, value: row.value, code, count: row.count });
    }
  }
  return { mapped, unmapped };
}

export async function backfillPortalBranches(options: MasterSyncOptions & { apply?: boolean } = {}) {
  if (options.apply) requireMasterConversion();
  const response = await fetchPortalMaster("branches", options);
  const branches = parsePortalBranches(response.data);
  const pool = options.pool || getDbPool();
  if (options.apply) await requireMasterSchema(pool);
  const client = await pool.connect();
  try {
    await client.query(options.apply ? "BEGIN" : "BEGIN READ ONLY");
    if (options.apply) {
      await client.query(`SELECT pg_advisory_xact_lock(${MASTER_SYNC_ADVISORY_LOCK_ID})`);
      for (const target of BRANCH_BACKFILL_TARGETS) await client.query(`LOCK TABLE ${target.table} IN SHARE ROW EXCLUSIVE MODE`);
    }
    const inspection = await inspectBranchBackfill(client, branches);
    if (!options.apply || inspection.unmapped.length) {
      await client.query("ROLLBACK");
      return { applied: false, ...inspection };
    }
    await savePortalBranches(client, branches);
    for (const target of BRANCH_BACKFILL_TARGETS) {
      if (target.table === "users") {
        await client.query(`UPDATE users
          SET
            branch = COALESCE(
              (SELECT b.name FROM sparta_master_branches b
               WHERE b.code = sparta_resolve_branch(${USER_PENDING_PORTAL_BRANCH_SQL})
                 AND b.is_active = TRUE),
              branch
            ),
            branch_code = sparta_resolve_branch(${USER_EFFECTIVE_BRANCH_SQL}),
            pending_portal_branch = CASE
              WHEN sparta_resolve_branch(${USER_PENDING_PORTAL_BRANCH_SQL}) IS NOT NULL THEN NULL
              ELSE pending_portal_branch
            END
          WHERE ${USER_EFFECTIVE_BRANCH_SQL} IS NOT NULL
            AND COALESCE(scope, '') <> 'HO' AND system_role <> 'ADMIN'`);
      } else {
        await client.query(`UPDATE ${target.table} SET ${target.code}=sparta_resolve_branch(${target.column})
          WHERE NULLIF(BTRIM(${target.column}), '') IS NOT NULL`);
      }
    }
    await client.query("COMMIT");
    branchKeyCache.clear();
    invalidateMasterStoresCache();
    return { applied: true, ...inspection };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}

export async function syncBranchesFromPortal(options: Pick<MasterSyncOptions, "pool" | "fetchFn"> = {}) {
  requireMasterConversion();
  requirePortalMasterConfig();
  const pool = options.pool || getDbPool();
  await requireMasterSchema(pool);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`SELECT pg_advisory_xact_lock(${MASTER_SYNC_ADVISORY_LOCK_ID})`);
    const response = await fetchPortalMaster("branches", options);
    const branches = parsePortalBranches(response.data);
    await savePortalBranches(client, branches);
    await client.query(
      `INSERT INTO sparta_master_sync_state(resource,synced_at) VALUES('branches',$1)
       ON CONFLICT(resource) DO UPDATE SET synced_at=EXCLUDED.synced_at`,
      [response.syncedAt]
    );
    await client.query("COMMIT");
    branchKeyCache.clear();
    return {
      syncedAt: response.syncedAt,
      count: branches.length,
      activeCount: branches.filter(b => b.isActive).length,
      inactiveCount: branches.filter(b => !b.isActive).length,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}

export async function syncStoresFromPortal(options: MasterSyncOptions = {}): Promise<StoreSyncHistoryRecord> {
  requireMasterConversion();
  requirePortalMasterConfig();
  const pool = options.pool || getDbPool();
  await requireMasterSchema(pool);
  const id = randomUUID();
  const startedAt = new Date().toISOString();
  await pool.query(`INSERT INTO store_sync_history(id,sync_source,status,started_at)
    VALUES($1,'SPARTA_PORTAL','IN_PROGRESS',$2)`, [id, startedAt]);
  const client = await pool.connect();
  let recordsRead = 0;
  try {
    await client.query("BEGIN");
    await client.query(`SELECT pg_advisory_xact_lock(${MASTER_SYNC_ADVISORY_LOCK_ID})`);
    const cursor = await client.query("SELECT synced_at FROM sparta_master_sync_state WHERE resource='stores'");
    const updatedSince = !options.full && cursor.rows[0]?.synced_at ? new Date(cursor.rows[0].synced_at).toISOString() : undefined;
    if (!updatedSince && !options.confirmFull) throw new SpartaIntegrationError("FULL_SYNC_REQUIRES_REVIEW", "Sync penuh memerlukan preview dan --confirm-full.", 409);
    const branchResponse = await fetchPortalMaster("branches", options);
    const branches = parsePortalBranches(branchResponse.data);
    const response = await fetchPortalMaster("stores", { ...options, updatedSince });
    recordsRead = response.data.length;
    const stores = parsePortalStores(response.data, branches);
    if (!updatedSince && !stores.length) throw new SpartaIntegrationError("EMPTY_STORE_MASTER", "Master toko penuh kosong; data SIAGA dipertahankan.", 502);
    await savePortalBranches(client, branches);
    let added = 0;
    let updated = 0;
    const branchNames = new Map(branches.map(branch => [branch.code, branch.name]));
    for (let offset = 0; offset < stores.length; offset += 500) {
      const batch = stores.slice(offset, offset + 500).map(store => ({
        code: store.code, name: store.name, branch_code: store.branchCode,
        branch_name: branchNames.get(store.branchCode), address: store.address?.trim() || null,
        latitude: store.latitude, longitude: store.longitude,
        ownership_type: store.ownershipType || "UNKNOWN", is_active: store.isActive,
      }));
      const result = await client.query(`INSERT INTO stores
        (id,kode_toko,nama_toko,cabang,branch_code,alamat,latitude,longitude,fr_type,is_active,master_source,master_synced_at)
        SELECT 'SAT-'||t.code,t.code,t.name,t.branch_name,t.branch_code,t.address,t.latitude,t.longitude,
          t.ownership_type,t.is_active,'SPARTA_PORTAL',NOW()
        FROM jsonb_to_recordset($1::jsonb) AS t(code TEXT,name TEXT,branch_code TEXT,branch_name TEXT,
          address TEXT,latitude DOUBLE PRECISION,longitude DOUBLE PRECISION,ownership_type TEXT,is_active BOOLEAN)
        ON CONFLICT(kode_toko) DO UPDATE SET nama_toko=EXCLUDED.nama_toko,
        cabang=EXCLUDED.cabang,branch_code=EXCLUDED.branch_code,
        alamat=COALESCE(EXCLUDED.alamat,stores.alamat),latitude=EXCLUDED.latitude,longitude=EXCLUDED.longitude,
        fr_type=EXCLUDED.fr_type,is_active=EXCLUDED.is_active,master_source='SPARTA_PORTAL',master_synced_at=NOW()
        RETURNING (xmax=0) AS inserted`, [JSON.stringify(batch)]);
      added += result.rows.filter(row => row.inserted).length;
      updated += result.rows.filter(row => !row.inserted).length;
    }
    if (!updatedSince) {
      await client.query(`UPDATE stores SET is_active=FALSE WHERE NOT (kode_toko=ANY($1::text[]))`, [stores.map(s => s.code)]);
    }
    await client.query(`INSERT INTO sparta_master_sync_state(resource,synced_at) VALUES('branches',$1)
      ON CONFLICT(resource) DO UPDATE SET synced_at=EXCLUDED.synced_at`, [branchResponse.syncedAt]);
    await client.query(`INSERT INTO sparta_master_sync_state(resource,synced_at) VALUES('stores',$1)
      ON CONFLICT(resource) DO UPDATE SET synced_at=EXCLUDED.synced_at`, [response.syncedAt]);
    await client.query(`UPDATE store_sync_history SET status='COMPLETED',completed_at=NOW(),records_read=$2,
      records_added=$3,records_updated=$4 WHERE id=$1`, [id, recordsRead, added, updated]);
    await client.query("COMMIT");
    branchKeyCache.clear();
    invalidateBranchMasterCache();
    invalidateMasterStoresCache();
    return { id, sync_source: "SPARTA_PORTAL", sourceType: "SPARTA_PORTAL", sourceLabel: "Portal SPARTA",
      status: "COMPLETED", started_at: startedAt, completed_at: new Date().toISOString(), records_read: recordsRead,
      records_added: added, records_updated: updated, records_skipped: 0, records_failed: 0, error_message: null };
  } catch (error) {
    await client.query("ROLLBACK");
    await pool.query(`UPDATE store_sync_history SET status='FAILED',completed_at=NOW(),records_read=$2,
      records_failed=$3,error_message=$4 WHERE id=$1`, [id, recordsRead, Math.max(recordsRead, 1),
      error instanceof SpartaIntegrationError ? error.message : "Sinkronisasi portal gagal; data sebelumnya dipertahankan."]);
    throw error;
  } finally { client.release(); }
}

export async function previewPortalStores(options: Pick<MasterSyncOptions, "pool" | "fetchFn"> = {}) {
  const branchResponse = await fetchPortalMaster("branches", options);
  const branches = parsePortalBranches(branchResponse.data);
  const response = await fetchPortalMaster("stores", options);
  const stores = parsePortalStores(response.data, branches);
  if (!stores.length) throw new SpartaIntegrationError("EMPTY_STORE_MASTER", "Master toko penuh kosong; konversi diblokir.", 502);
  const pool = options.pool || getDbPool();
  const { rows } = await pool.query(`SELECT kode_toko, COALESCE((to_jsonb(stores)->>'is_active')::boolean,TRUE) AS is_active FROM stores`);
  const existing = new Set(rows.map(row => row.kode_toko));
  const incoming = new Map(stores.map(store => [store.code, store]));
  const deactivate = rows.filter(row => row.is_active && (!incoming.has(row.kode_toko) || !incoming.get(row.kode_toko)!.isActive)).map(row => row.kode_toko);
  return { mode: "preview", syncedAt: response.syncedAt, portalStores: stores.length,
    added: stores.filter(store => !existing.has(store.code)).length,
    matched: stores.filter(store => existing.has(store.code)).length,
    deactivate, deactivateCount: deactivate.length,
    missingPortalAddress: stores.filter(store => store.address == null).length };
}
