import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { readMigrationStatus } from "../scripts/migrate-production.mjs";

test("historical migrations retain the exact production ledger checksums", () => {
  const recorded = {
    "016_session_concurrency_and_token_encryption.sql": "2fe1f9271485e5b614c559531d500a983cdd8f82d5fa3ab5f493a29f4eb83651",
    "017_earthquake_shakemaps_and_facility_intensities.sql": "9625163ac23b72d05d7f5a2174111d8ab6d58b1c648ea54995ca334daff799eb",
  };
  for (const [name, expected] of Object.entries(recorded)) {
    assert.equal(createHash("sha256").update(readFileSync(`database/migrations/${name}`)).digest("hex"), expected, name);
  }
});

test("migration status reads applied, drifted and pending records without DDL or locks", async () => {
  const queries = [];
  const client = { async query(sql) {
    queries.push(sql);
    assert.match(sql, /^(SELECT|BEGIN READ ONLY|ROLLBACK)/);
    if (sql.includes("AS ledger_exists")) return { rows: [{ ledger_exists: true }] };
    if (sql.includes("SELECT name, checksum")) return { rows: [{ name: "001.sql", checksum: "same" }, { name: "016.sql", checksum: "production-original" }] };
    return { rows: [] };
  } };
  const result = await readMigrationStatus(client, [
    { name: "001.sql", checksum: "same" }, { name: "016.sql", checksum: "different" },
    { name: "020_sparta_user_provisioning_stage.sql", checksum: "pending" },
    { name: "021_sparta_master_conversion_stage.sql", checksum: "pending" },
  ]);
  assert.equal(result.readOnly, true);
  assert.deepEqual(result.migrations.map(row => row.status), ["APPLIED", "CHECKSUM_DRIFT", "PENDING", "PENDING"]);
  assert.equal(result.migrations[3].deferred, true);
  assert.equal(result.migrations[1].recordedChecksum, "production-original");
  assert.equal(queries.at(-1), "ROLLBACK");
});

test("migration status does not create an absent ledger", async () => {
  const queries = [];
  const result = await readMigrationStatus({ async query(sql) {
    queries.push(sql);
    return { rows: sql.includes("AS ledger_exists") ? [{ ledger_exists: false }] : [] };
  } }, [{ name: "020.sql", checksum: "new" }]);
  assert.equal(result.ledgerExists, false);
  assert.equal(result.migrations[0].status, "PENDING");
  assert.ok(queries.every(sql => /^(SELECT|BEGIN READ ONLY|ROLLBACK)/.test(sql)));
  assert.ok(!queries.some(sql => sql.includes("SELECT name, checksum")));
});

test("migration status rolls back its read transaction on errors", async () => {
  const queries = [];
  await assert.rejects(() => readMigrationStatus({ async query(sql) {
    queries.push(sql);
    if (sql.startsWith("SELECT")) throw new Error("test read failure");
    return { rows: [] };
  } }, []), /test read failure/);
  assert.equal(queries.at(-1), "ROLLBACK");
});

test("master migration remains deferred until IT authorization before connecting", () => {
  const result = spawnSync(process.execPath, ["scripts/migrate-production.mjs", "--include-master-conversion"], {
    encoding: "utf8", env: { ...process.env, DATABASE_URL: "postgresql://test@127.0.0.1:1/unused",
      SPARTA_BRANCH_MASTER_ENABLED: "true", SPARTA_API_URL: "http://portal.test", SPARTA_INTERNAL_API_KEY: "" },
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Master conversion remains deferred until IT authorization and coordinated rollout/);
  assert.equal(result.stdout, "");
});
