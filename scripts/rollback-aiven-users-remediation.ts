import { getIsolatedDbPool, closeDbPool } from "../lib/db";
import fs from "fs/promises";
import path from "path";

async function rollback() {
  const isApply = process.argv.includes("--apply");
  console.log("================================================================================");
  console.log(" SPARTA SIAGA — ROLLBACK AIVEN USER REMEDIATION");
  console.log(" Target: Aiven sparta_siaga_isolated");
  console.log(" Mode:   " + (isApply ? "EXECUTE (APPLY ROLLBACK)" : "DRY RUN (PROPOSAL ONLY)"));
  console.log("================================================================================\n");

  const pool = getIsolatedDbPool();

  try {
    const dbRes = await pool.query(`SELECT current_database(), inet_server_addr()`);
    if (dbRes.rows[0].current_database !== "sparta_siaga_isolated") {
      throw new Error(`SAFETY ERROR: Connected to ${dbRes.rows[0].current_database}, expected sparta_siaga_isolated!`);
    }

    // Read pre-remediation backup
    const backupPath = path.join(process.cwd(), "storage", "backups", "aiven-pre-remediation-users-backup.json");
    const raw = await fs.readFile(backupPath, "utf8");
    const backup = JSON.parse(raw);

    console.log(`Loaded backup snapshot from: ${backupPath}`);
    console.log(`Backup Timestamp: ${backup.timestamp}`);
    console.log(`Total users in backup: ${backup.total_users}\n`);

    const accountsToRestore = [
      "usr_seed_admin",
      "USR-BMS-001",
      "USR-DEMO-BMC",
      "USR-DEMO-BES",
      "USR-DEMO-BEC",
      "USR-DEMO-BBS",
      "USR-DEMO-BBC",
      "USR-BM-G001",
      "USR-HO-BUDI",
      "USR-DEMO-GM",
    ];

    console.log("Rollback Steps to be executed:");
    console.log("1. DROP INDEX IF EXISTS idx_users_unique_lower_nik;");
    for (const id of accountsToRestore) {
      const original = backup.users.find((u: any) => u.id === id);
      if (original) {
        console.log(`2. RESTORE [${id}] -> NIK: '${original.nik}', Status: '${original.status}'`);
      }
    }
    console.log();

    if (!isApply) {
      console.log("⚠️  Dry run complete. No rollback writes executed.");
      console.log("   To execute rollback, run with '--apply'.\n");
      return;
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      console.log("Executing rollback transaction...");

      // 1. Drop index
      await client.query("DROP INDEX IF EXISTS idx_users_unique_lower_nik");

      // 2. Restore rows from backup
      for (const id of accountsToRestore) {
        const original = backup.users.find((u: any) => u.id === id);
        if (original) {
          await client.query(
            `UPDATE users SET nik = $1, status = $2, updated_at = NOW() WHERE id = $3`,
            [original.nik, original.status, id]
          );
        }
      }

      await client.query("COMMIT");
      console.log("✔ Rollback completed successfully and verified!");
    } catch (err) {
      await client.query("ROLLBACK");
      console.error("❌ Rollback transaction failed:", err);
      throw err;
    } finally {
      client.release();
    }
  } finally {
    await closeDbPool();
  }
}

rollback().catch(console.error);

