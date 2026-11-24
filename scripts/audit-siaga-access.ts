import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import type { PoolClient } from "pg";
import { getDbPool, closeDbPool } from "../lib/db";
import { CANONICAL_HUMAN_ROLES } from "../lib/role-catalog";
import { isApprovedRoleAndBranch } from "../lib/sso-service";

type AuditUser = {
  id: string;
  external_user_id: string | null;
  nik: string | null;
  name: string;
  email: string | null;
  system_role: string;
  business_role: string | null;
  scope: string | null;
  branch: string | null;
  status: string;
  source: string | null;
  sso_status: string | null;
  has_local_password: boolean | null;
};

export function classifyUser(user: AuditUser) {
  const role = (user.business_role || "").toLowerCase();
  const blockedRole = ["tim_toko", "rekanan"].includes(role);
  const approvedAssignment = isApprovedRoleAndBranch({
    systemRole: user.system_role,
    businessRole: user.business_role,
    scope: user.scope,
    branch: user.branch,
  });
  const localSessionGate = user.status === "ACTIVE" && !blockedRole &&
    (!user.sso_status || user.sso_status === "ACTIVE");
  const pendingActivation = user.sso_status === "PENDING_SSO_GRANT" &&
    !blockedRole && approvedAssignment &&
    !(user.source === "SPARTA" && !user.scope && user.system_role !== "ADMIN");
  const findings: string[] = [];
  if (localSessionGate && !approvedAssignment) findings.push("ACTIVE_ASSIGNMENT_NOT_APPROVED_BY_PENDING_LOGIN_POLICY");
  if (!user.external_user_id?.trim()) findings.push("PORTAL_ID_MISSING");
  if (user.system_role !== "ADMIN" && !CANONICAL_HUMAN_ROLES.some(r => r.key === role)) findings.push("ROLE_OUTSIDE_HUMAN_CATALOG");
  if (blockedRole) findings.push("ROLE_DISABLED");
  if (user.source === "LOCAL" && user.has_local_password) findings.push("LOCAL_PASSWORD_PRESENT_CHECK_DEPLOYED_TRANSITION_FLAG");
  return {
    ...user,
    approved_assignment: approvedAssignment,
    local_session_gate: localSessionGate ? "PASS_REQUIRES_VALID_SESSION" : "BLOCKED",
    sso_login_candidate: (localSessionGate && approvedAssignment &&
      !(user.source === "SPARTA" && !user.scope && user.system_role !== "ADMIN")) || pendingActivation,
    portal_module_grant: "UNVERIFIED",
    findings,
  };
}

function countBy<T>(rows: T[], key: (row: T) => string) {
  return Object.fromEntries([...rows.reduce((counts, row) => {
    const value = key(row);
    counts.set(value, (counts.get(value) || 0) + 1);
    return counts;
  }, new Map<string, number>())].sort((a, b) => a[0].localeCompare(b[0])));
}

type AuditColumn = { table_name: string; table_schema: string; column_name: string };

const tableFields = {
  users: ["id", "external_user_id", "nik", "name", "email", "system_role", "business_role", "scope", "branch", "status", "source", "sso_status"],
  role_permissions: ["business_role", "permission_key", "effect"],
  user_permission_overrides: ["user_id", "permission_key", "effect", "scope_type", "branch_code", "starts_at", "expires_at", "revoked_at"],
} as const;

const quoteIdentifier = (value: string) => `"${value.replaceAll('"', '""')}"`;

export async function readAccessTables(client: Pick<PoolClient, "query">) {
  const columns = (await client.query<AuditColumn>(`SELECT c.relname AS table_name,
    n.nspname AS table_schema, a.attname AS column_name
    FROM pg_catalog.pg_attribute a
    JOIN pg_catalog.pg_class c ON c.oid=a.attrelid
    JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    WHERE c.oid IN (to_regclass('users'), to_regclass('role_permissions'), to_regclass('user_permission_overrides'))
      AND a.attnum>0 AND NOT a.attisdropped
    ORDER BY c.relname,a.attnum`)).rows;
  const warnings: string[] = [];
  const userColumns = new Set(columns.filter(c => c.table_name === "users").map(c => c.column_name));
  const required = ["id", "name", "system_role", "business_role", "scope", "branch", "status"];
  const missingRequired = required.filter(field => !userColumns.has(field));
  if (missingRequired.length) throw new Error(`AUDIT_SCHEMA_UNSUPPORTED: users missing ${missingRequired.join(", ")}`);

  async function readTable(table: keyof typeof tableFields) {
    const schema = columns.find(c => c.table_name === table)?.table_schema;
    if (!schema) {
      warnings.push(`TABLE_UNAVAILABLE:${table}`);
      return null;
    }
    const available = new Set(columns.filter(c => c.table_name === table).map(c => c.column_name));
    const fields: string[] = tableFields[table].map(field => {
      if (available.has(field)) return quoteIdentifier(field);
      warnings.push(`COLUMN_UNAVAILABLE:${table}.${field}`);
      return `NULL::text AS ${quoteIdentifier(field)}`;
    });
    if (table === "users") {
      fields.push(available.has("password_hash")
        ? `(NULLIF("password_hash"::text,'') IS NOT NULL) AS has_local_password`
        : "NULL::boolean AS has_local_password");
      if (!available.has("password_hash")) warnings.push("COLUMN_UNAVAILABLE:users.password_hash");
    }
    const order = table === "users" ? " ORDER BY system_role,business_role,branch,name,id" : "";
    return (await client.query(`SELECT ${fields.join(", ")} FROM ${quoteIdentifier(schema)}.${quoteIdentifier(table)}${order}`)).rows;
  }

  const rawUsers = await readTable("users");
  const users = (rawUsers as AuditUser[]).map(user => {
    const result = classifyUser(user);
    for (const column of ["external_user_id", "source", "sso_status", "password_hash"]) {
      if (!userColumns.has(column)) result.findings.push(`COLUMN_UNAVAILABLE:${column}`);
    }
    if (!userColumns.has("external_user_id")) result.findings = result.findings.filter(f => f !== "PORTAL_ID_MISSING");
    return result;
  });
  return {
    users,
    permissions: await readTable("role_permissions"),
    overrides: await readTable("user_permission_overrides"),
    schema: { columns, warnings },
  };
}

async function main() {
  let client;
  let stage = "connect";
  try {
    client = await getDbPool().connect();
    stage = "begin_read_only";
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    await client.query("SET LOCAL statement_timeout='15s'");
    const metadata = (await client.query(`SELECT current_database() AS database,
      current_timestamp AS audited_at, current_setting('transaction_read_only') AS read_only`)).rows[0];
    stage = "read_schema_and_access_tables";
    const { users, permissions, overrides, schema } = await readAccessTables(client);
    await client.query("ROLLBACK");
    const duplicateGroups = (field: "external_user_id" | "nik" | "email") => {
      const groups = new Map<string, string[]>();
      for (const user of users) {
        const value = user[field]?.trim();
        if (!value) continue;
        const key = field === "external_user_id" ? value : value.toLowerCase();
        groups.set(key, [...(groups.get(key) || []), user.id]);
      }
      return [...groups].filter(([, ids]) => ids.length > 1).map(([value, ids]) => ({ value, ids }));
    };
    console.log(JSON.stringify({
      metadata,
      schema,
      limitations: [
        "Audit membaca database tanpa membuat sesi, mengaktifkan akun, atau mengubah data.",
        "PASS pada gerbang lokal memerlukan sesi valid; bukan bukti grant portal aktif.",
        "Grant SIAGA dan status identitas portal belum diperiksa terhadap portal aktual.",
        "Akun pending hanya kandidat aktivasi, bukan akun yang terbukti dapat login.",
        "Override diekspor sebagai data audit; efektivitasnya bergantung waktu, scope, dan kebijakan permission.",
        "Aturan memakai source lokal; deployment dapat berbeda.",
        "Kolom atau tabel yang belum tersedia ditandai COLUMN_UNAVAILABLE/TABLE_UNAVAILABLE, bukan dianggap kosong atau tidak memiliki akses.",
        "Jika kolom sso_status belum tersedia, penilaian lokal mengikuti perilaku source saat metadata SSO tidak ada; status SSO aktual tetap belum terverifikasi.",
      ],
      summary: {
        total: users.length,
        by_role: countBy(users, u => u.system_role === "ADMIN" ? "SYSTEM_ADMIN" : u.business_role || "(EMPTY)"),
        by_status: countBy(users, u => u.status),
        by_sso_status: countBy(users, u => u.findings.includes("COLUMN_UNAVAILABLE:sso_status") ? "(COLUMN_UNAVAILABLE)" : u.sso_status || "(EMPTY)"),
        by_source: countBy(users, u => u.findings.includes("COLUMN_UNAVAILABLE:source") ? "(COLUMN_UNAVAILABLE)" : u.source || "(EMPTY)"),
        by_branch: countBy(users, u => u.branch || "(EMPTY)"),
        by_local_session_gate: countBy(users, u => u.local_session_gate),
        sso_login_candidates: users.filter(u => u.sso_login_candidate).length,
        missing_portal_id: schema.warnings.includes("COLUMN_UNAVAILABLE:users.external_user_id") ? null : users.filter(u => !u.external_user_id?.trim()).length,
        active_assignment_anomalies: users.filter(u => u.findings.includes("ACTIVE_ASSIGNMENT_NOT_APPROVED_BY_PENDING_LOGIN_POLICY")).length,
      },
      duplicates: {
        portal_id: duplicateGroups("external_user_id"),
        nik: duplicateGroups("nik"),
        email: duplicateGroups("email"),
      },
      users,
      role_permissions: permissions,
      permission_overrides: overrides,
    }, null, 2));
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    const code = (error as { code?: string }).code || "UNKNOWN";
    const message = error instanceof Error && (code === "42703" || code === "42P01" || error.message.startsWith("AUDIT_SCHEMA_UNSUPPORTED:"))
      ? error.message : undefined;
    console.error(JSON.stringify({ error: "ACCESS_AUDIT_FAILED", code, stage, message, databaseChanged: false }));
    process.exitCode = 1;
  } finally {
    client?.release();
    await closeDbPool();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main();
}
