import assert from "node:assert/strict";
import { test } from "node:test";
import type { PoolClient } from "pg";
import { readAccessTables } from "../scripts/audit-siaga-access";

const userFields = ["id", "external_user_id", "nik", "name", "email", "system_role", "business_role", "scope", "branch", "status", "source", "sso_status", "password_hash"];
const user = {
  id: "fixture-user", external_user_id: "fixture-portal", nik: "fixture-nik", name: "Fixture",
  email: "fixture@example.invalid", system_role: "USER", business_role: "bms", scope: "BRANCH",
  branch: "FIXTURE", status: "ACTIVE", source: "SPARTA", sso_status: "ACTIVE", has_local_password: false,
};

function database(tables: Record<string, string[]>, rows: Record<string, unknown>[] = [user]) {
  const queries: string[] = [];
  const client = {
    async query(sql: string) {
      queries.push(sql);
      if (sql.includes("pg_catalog.pg_attribute")) return {
        rows: Object.entries(tables).flatMap(([table_name, fields]) => fields.map(column_name => ({
          table_name, table_schema: "public", column_name,
        }))),
      };
      assert.ok(sql.startsWith("SELECT "), "schema audit must only read data");
      const table = /FROM "public"\."([^"]+)"/.exec(sql)?.[1];
      assert.ok(table && tables[table], "must not query absent tables");
      const projection = sql.slice(7, sql.indexOf(" FROM "));
      for (const field of [...userFields, "starts_at", "expires_at", "revoked_at"]) {
        if (!tables[table].includes(field)) {
          assert.ok(!new RegExp(`(?:^|, )"${field}"(?:,|$)`).test(projection), `query references missing ${field}`);
        }
      }
      if (table !== "users") return { rows: [] };
      return { rows: rows.map(row => {
        const result = { ...row };
        for (const match of projection.matchAll(/NULL::(?:text|boolean) AS "?(\w+)"?/g)) result[match[1]] = null;
        return result;
      }) };
    },
  } as unknown as Pick<PoolClient, "query">;
  return { client, queries };
}

test("pre-018 schema can audit active users without referencing sso_status", async () => {
  const db = database({ users: userFields.filter(f => f !== "sso_status") });
  const result = await readAccessTables(db.client);
  assert.equal(result.users.length, 1);
  assert.equal(result.users[0].sso_status, null);
  assert.equal(result.users[0].local_session_gate, "PASS_REQUIRES_VALID_SESSION");
  assert.ok(result.schema.warnings.includes("COLUMN_UNAVAILABLE:users.sso_status"));
  assert.ok(result.users[0].findings.includes("COLUMN_UNAVAILABLE:sso_status"));
});

test("missing optional tables are unavailable rather than empty permission sets", async () => {
  const db = database({ users: userFields });
  const result = await readAccessTables(db.client);
  assert.equal(result.permissions, null);
  assert.equal(result.overrides, null);
  assert.ok(result.schema.warnings.includes("TABLE_UNAVAILABLE:role_permissions"));
  assert.equal(db.queries.length, 2);
});

test("missing identity and password columns remain unknown", async () => {
  const db = database({ users: userFields.filter(f => !["external_user_id", "password_hash", "source"].includes(f)) });
  const result = await readAccessTables(db.client);
  assert.equal(result.users[0].external_user_id, null);
  assert.equal(result.users[0].has_local_password, null);
  assert.equal(result.users[0].source, null);
  assert.ok(!result.users[0].findings.includes("PORTAL_ID_MISSING"));
  assert.ok(result.users[0].findings.includes("COLUMN_UNAVAILABLE:external_user_id"));
  assert.ok(!db.queries[1].includes('"password_hash"'));
});

test("older overrides schema projects absent metadata and reports it", async () => {
  const db = database({
    users: userFields,
    role_permissions: ["business_role", "permission_key", "effect"],
    user_permission_overrides: ["user_id", "permission_key", "effect", "scope_type", "branch_code"],
  });
  const result = await readAccessTables(db.client);
  assert.deepEqual(result.overrides, []);
  assert.ok(result.schema.warnings.includes("COLUMN_UNAVAILABLE:user_permission_overrides.starts_at"));
  assert.ok(db.queries[3].includes('NULL::text AS "starts_at"'));
});

test("missing essential role data stops classification with a specific error", async () => {
  const db = database({ users: userFields.filter(f => f !== "system_role") });
  await assert.rejects(readAccessTables(db.client), /AUDIT_SCHEMA_UNSUPPORTED: users missing system_role/);
  assert.equal(db.queries.length, 1);
});

test("current schema keeps blocked and pending users distinct", async () => {
  const db = database({ users: userFields }, [
    { ...user, id: "blocked", sso_status: "BLOCKED" },
    { ...user, id: "pending", status: "INACTIVE", sso_status: "PENDING_SSO_GRANT" },
    { ...user, id: "pending-without-scope", status: "INACTIVE", sso_status: "PENDING_SSO_GRANT", scope: null, branch: null },
  ]);
  const { users } = await readAccessTables(db.client);
  assert.equal(users[0].sso_login_candidate, false);
  assert.equal(users[1].sso_login_candidate, true);
  assert.equal(users[1].local_session_gate, "BLOCKED");
  assert.equal(users[2].sso_login_candidate, false);
  assert.ok(users.every(u => u.portal_module_grant === "UNVERIFIED"));
});
