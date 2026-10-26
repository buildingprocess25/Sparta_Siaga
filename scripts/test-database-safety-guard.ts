import assert from "node:assert";
import { assertIsolatedDatabase, ISOLATED_DATABASE_NAME } from "../lib/database-safety";
import { getDbPool } from "../lib/db";

async function runTest() {
  console.log("==============================================================");
  console.log("🔒 TEST: DATABASE SAFETY GUARDS & DEMO SEED AUDIT");
  console.log("==============================================================");

  const pool = getDbPool();

  // 1. Verify live connected database is strictly isolated
  console.log("Verifying current database connection...");
  const res = await pool.query("SELECT current_database() as db_name");
  const currentDb = res.rows[0]?.db_name;
  console.log("Current connected database name:", currentDb);

  assert.strictEqual(
    currentDb,
    ISOLATED_DATABASE_NAME,
    `FATAL: Current database must be '${ISOLATED_DATABASE_NAME}', found '${currentDb}'`
  );
  console.log(`✔ Verified: Active DB is '${currentDb}' (isolated environment)`);

  // 2. Verify assertIsolatedDatabase succeeds on current pool
  await assertIsolatedDatabase(pool);
  console.log("✔ assertIsolatedDatabase(pool) successfully passed on active database");

  // 3. Verify assertIsolatedDatabase strictly blocks any production/operational DB
  console.log("\nSimulating connection to operational/production database...");
  const mockProdDb = {
    query: async () => ({
      rows: [{ database_name: "sparta_siaga_operational_prod" }],
    }),
  };

  let blockedProd = false;
  try {
    await assertIsolatedDatabase(mockProdDb as any);
  } catch (err: any) {
    blockedProd = true;
    console.log("✔ Intercepted expected safety error:", err.message);
    assert.ok(err.message.includes("Refusing database write"));
    assert.ok(err.message.includes("sparta_siaga_operational_prod"));
  }
  assert.ok(blockedProd, "assertIsolatedDatabase MUST block production database write");

  // 4. Verify mock default 'postgres' database is also blocked
  console.log("\nSimulating connection to default postgres database...");
  const mockPostgresDb = {
    query: async () => ({
      rows: [{ database_name: "postgres" }],
    }),
  };

  let blockedPostgres = false;
  try {
    await assertIsolatedDatabase(mockPostgresDb as any);
  } catch (err: any) {
    blockedPostgres = true;
    console.log("✔ Intercepted expected safety error:", err.message);
    assert.ok(err.message.includes("Refusing database write"));
  }
  assert.ok(blockedPostgres, "assertIsolatedDatabase MUST block postgres database write");

  console.log("\n==============================================================");
  console.log("🛡️ ALL DATABASE SAFETY GUARDS VERIFIED 100%!");
  console.log("==============================================================");
  process.exit(0);
}

runTest().catch((err) => {
  console.error("❌ Safety test failed:", err);
  process.exit(1);
});
