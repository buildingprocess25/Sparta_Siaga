import { getDbPool, closeDbPool } from "../lib/db";
import { readFile } from "node:fs/promises";
import type { PoolClient } from "pg";
import { SpartaIntegrationError } from "../lib/sparta-identity";

let client: PoolClient | undefined;
try {
  const exportArg = process.argv.find(arg => arg.startsWith("--portal-users="));
  let portalUsers: Array<{ id: string; employeeId?: string | null }> | undefined;
  if (exportArg) {
    const exportPath = exportArg.slice("--portal-users=".length);
    let data;
    try { data = JSON.parse(await readFile(exportPath, "utf8")); }
    catch (error) {
      if ((error as { code?: string }).code === "ENOENT") throw new SpartaIntegrationError("PORTAL_EXPORT_NOT_FOUND", "File ekspor user portal tidak ditemukan. Gunakan path file ekspor aktual; C:\\temp\\portal-users.json pada panduan hanya contoh.");
      throw new SpartaIntegrationError("INVALID_PORTAL_EXPORT", "Ekspor user portal tidak dapat dibaca sebagai JSON.");
    }
    const users = Array.isArray(data) ? data : data?.data;
    if (!Array.isArray(users) || users.some(u => !u || typeof u.id !== "string" || !u.id.trim()) || new Set(users.map(u => u.id)).size !== users.length) {
      throw new SpartaIntegrationError("INVALID_PORTAL_EXPORT", "Ekspor portal harus array user dengan id unik, employeeId, dan email.");
    }
    portalUsers = users;
  }
  client = await getDbPool().connect();
  await client.query("BEGIN READ ONLY");
  const sources = await client.query(`SELECT source,COUNT(*)::int AS total,
    COUNT(*) FILTER(WHERE NULLIF(BTRIM(external_user_id),'') IS NULL)::int AS missing_portal_id FROM users GROUP BY source`);
  const duplicates = await client.query(`SELECT 'external_user_id' AS field,COUNT(*)::int AS duplicate_groups FROM
    (SELECT external_user_id FROM users WHERE NULLIF(BTRIM(external_user_id),'') IS NOT NULL GROUP BY external_user_id HAVING COUNT(*)>1) d
    UNION ALL SELECT 'kode_toko',COUNT(*)::int FROM (SELECT kode_toko FROM stores GROUP BY kode_toko HAVING COUNT(*)>1) d`);
  const columns = await client.query(`SELECT table_name,column_name FROM information_schema.columns
    WHERE table_schema=current_schema() AND table_name IN ('users','stores','incidents')
    AND column_name IN ('branch_code','last_provisioned_at','is_active','master_source')`);
  let portalIdentityAudit: unknown = { verified: false, reason: "Sertakan --portal-users=<export-user-portal.json> untuk membandingkan ID aktual." };
  if (portalUsers) {
    const portalById = new Map(portalUsers.map(user => [user.id, user]));
    const local = await client.query("SELECT external_user_id,nik FROM users WHERE NULLIF(BTRIM(external_user_id),'') IS NOT NULL");
    const notInExport = local.rows.filter(user => !portalById.has(user.external_user_id)).length;
    const nikConflicts = local.rows.filter(user => {
      const portal = portalById.get(user.external_user_id);
      return portal?.employeeId && user.nik && String(portal.employeeId).trim() !== user.nik.trim();
    }).length;
    portalIdentityAudit = { verified: notInExport === 0 && nikConflicts === 0, compared: local.rows.length, notInExport, nikConflicts };
    if (notInExport || nikConflicts) process.exitCode = 1;
  }
  console.log(JSON.stringify({ sources: sources.rows, duplicates: duplicates.rows, columns: columns.rows, portalIdentityAudit }, null, 2));
  if (duplicates.rows.some(row => row.duplicate_groups > 0)) process.exitCode = 1;
  await client.query("ROLLBACK");
} catch (error) {
  if (client) await client.query("ROLLBACK");
  console.error("Audit kesiapan gagal:", error instanceof SpartaIntegrationError ? `${error.code}: ${error.message}` : (error as { code?: string }).code || "READINESS_FAILED");
  process.exitCode = 1;
} finally { client?.release(); await closeDbPool(); }
