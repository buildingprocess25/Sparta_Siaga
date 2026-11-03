import { getIsolatedDbPool, closeDbPool } from "../lib/db";
import { assertIsolatedDatabase } from "../lib/database-safety";

async function main() {
  console.log("=== Staging Isolated DB Email Remediation ===");
  const pool = getIsolatedDbPool();
  await assertIsolatedDatabase(pool);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // 1. Differentiate legacy seed admin email from active System Administrator
    const r1 = await client.query(
      `UPDATE users 
       SET email = 'legacy.admin@sparta-siaga.local', updated_at = NOW() 
       WHERE id = 'usr_seed_admin' AND email = 'sysadmin@sparta-siaga.local'`
    );
    console.log(`[1/2] Updated usr_seed_admin email -> legacy.admin@sparta-siaga.local (${r1.rowCount} row)`);

    // 2. Differentiate USR-HO-BUDI email from usr_ho_admin_01
    const r2 = await client.query(
      `UPDATE users 
       SET email = 'budi.santoso@sparta-siaga.local', updated_at = NOW() 
       WHERE id = 'USR-HO-BUDI' AND email = 'ho.admin.01@sparta-siaga.local'`
    );
    console.log(`[2/2] Updated USR-HO-BUDI email -> budi.santoso@sparta-siaga.local (${r2.rowCount} row)`);

    await client.query("COMMIT");
    console.log("Remediation committed successfully in isolated staging database.");
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Failed to apply remediation:", err);
    throw err;
  } finally {
    client.release();
    await closeDbPool();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

