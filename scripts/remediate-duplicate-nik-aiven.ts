import { getIsolatedDbPool, closeDbPool } from "../lib/db";

export interface RevisedRemediationPlan {
  backupFile: string;
  preservedTargetAdmin: {
    id: string;
    nik: string;
    name: string;
    status: string;
  };
  obsoleteAccountToDeactivate: {
    id: string;
    currentNik: string;
    newNik: string;
    name: string;
    currentStatus: string;
    newStatus: string;
    reason: string;
  };
  activeUatAccountsToReassign: Array<{
    id: string;
    currentNik: string;
    newNik: string;
    name: string;
    businessRole: string;
    status: "ACTIVE";
    loginIdentifiers: string[];
    rolePurpose: string;
  }>;
  unaffectedAccountsCount: number;
  proposedSqlStatements: string[];
}

export async function planRevisedRemediation(): Promise<RevisedRemediationPlan> {
  const pool = getIsolatedDbPool();

  try {
    const dbRes = await pool.query(`SELECT current_database(), inet_server_addr()`);
    const currentDb = dbRes.rows[0].current_database;
    const serverAddr = dbRes.rows[0].inet_server_addr;

    if (currentDb !== "sparta_siaga_isolated") {
      throw new Error(`SAFETY ERROR: Connected to ${currentDb}, expected sparta_siaga_isolated!`);
    }

    // 1. Target admin to preserve
    const targetAdmin = {
      id: "usr_sysadmin_01",
      nik: "ADM0001",
      name: "System Administrator",
      status: "ACTIVE",
    };

    // 2. Only confirmed obsolete account: usr_seed_admin
    const obsoleteAccount = {
      id: "usr_seed_admin",
      currentNik: "ADM0001",
      newNik: "LEGACY_ADM0001",
      name: "Ahmad Fauzi",
      currentStatus: "ACTIVE",
      newStatus: "INACTIVE",
      reason: "Legacy initial seed admin replaced by pilot usr_sysadmin_01; preserved non-destructively for historical audit/push references.",
    };

    // 3. Active UAT Accounts: Keep ACTIVE, re-key NIK to distinct UAT NIK
    const activeUatAccounts: RevisedRemediationPlan["activeUatAccountsToReassign"] = [
      {
        id: "USR-BMS-001",
        currentNik: "BMS0001",
        newNik: "UAT_BMS0001",
        name: "Demo BMS Bandung",
        businessRole: "bms",
        status: "ACTIVE",
        loginIdentifiers: ["bms", "USR-BMS-001", "UAT_BMS0001"],
        rolePurpose: "Branch Maintenance Support - Pemeriksaan fisik gerai & upload foto",
      },
      {
        id: "USR-DEMO-BMC",
        currentNik: "BMC0001",
        newNik: "UAT_BMC0001",
        name: "Demo BMC Koordinator Bandung",
        businessRole: "bmc",
        status: "ACTIVE",
        loginIdentifiers: ["bmc", "USR-DEMO-BMC", "UAT_BMC0001"],
        rolePurpose: "Branch Maintenance Coordinator - Verifikasi hasil & Serah Terima toko",
      },
      {
        id: "USR-DEMO-BES",
        currentNik: "BES0001",
        newNik: "UAT_BES0001",
        name: "Demo BES Bandung",
        businessRole: "bes",
        status: "ACTIVE",
        loginIdentifiers: ["bes", "USR-DEMO-BES", "UAT_BES0001"],
        rolePurpose: "Branch Estate Support - Pemeriksaan fisik Gudang / DC & upload 5 milestone",
      },
      {
        id: "USR-DEMO-BEC",
        currentNik: "BEC0001",
        newNik: "UAT_BEC0001",
        name: "Demo BEC Koordinator Bandung",
        businessRole: "bec",
        status: "ACTIVE",
        loginIdentifiers: ["bec", "USR-DEMO-BEC", "UAT_BEC0001"],
        rolePurpose: "Branch Estate Coordinator - Verifikasi Serah Terima Gudang / DC",
      },
      {
        id: "USR-DEMO-BBS",
        currentNik: "BBS0001",
        newNik: "UAT_BBS0001",
        name: "Demo BBS Bandung",
        businessRole: "bbs",
        status: "ACTIVE",
        loginIdentifiers: ["bbs", "USR-DEMO-BBS", "UAT_BBS0001"],
        rolePurpose: "Branch Building Support - PIC pemeliharaan gedung kantor cabang",
      },
      {
        id: "USR-DEMO-BBC",
        currentNik: "BBC0001",
        newNik: "UAT_BBC0001",
        name: "Demo BBC Koordinator Bandung",
        businessRole: "bbc",
        status: "ACTIVE",
        loginIdentifiers: ["bbc", "USR-DEMO-BBC", "UAT_BBC0001"],
        rolePurpose: "Branch Building Coordinator - Verifikasi Serah Terima gedung cabang",
      },
      {
        id: "USR-BM-G001",
        currentNik: "BM0001",
        newNik: "UAT_BM0001",
        name: "Demo BnM Manajer Bandung",
        businessRole: "bm",
        status: "ACTIVE",
        loginIdentifiers: ["bmm", "USR-BM-G001", "UAT_BM0001"],
        rolePurpose: "Branch Building & Maintenance Manager - Konfirmasi lapangan & Case Close",
      },
      {
        id: "USR-HO-BUDI",
        currentNik: "HO0001",
        newNik: "UAT_HO0001",
        name: "Demo HO Admin Monitoring",
        businessRole: "ho_admin",
        status: "ACTIVE",
        loginIdentifiers: ["ho", "USR-HO-BUDI", "UAT_HO0001"],
        rolePurpose: "Head Office Monitoring - Pemantauan komprehensif seluruh cabang",
      },
      {
        id: "USR-DEMO-GM",
        currentNik: "GM0001",
        newNik: "UAT_GM0001",
        name: "Demo GM HO Monitoring",
        businessRole: "gm_ho",
        status: "ACTIVE",
        loginIdentifiers: ["gm", "USR-DEMO-GM", "UAT_GM0001"],
        rolePurpose: "General Manager HO - Pemantauan eksekutif kejadian nasional",
      },
    ];

    const totalUsersRes = await pool.query(`SELECT COUNT(*)::int as count FROM users`);
    const totalUsers = totalUsersRes.rows[0].count;
    const unaffectedCount = totalUsers - (1 + activeUatAccounts.length);

    const sqlStatements: string[] = [
      `-- 1. Deactivate solely the confirmed obsolete seed admin (non-destructive, preserves historical links)`,
      `UPDATE users SET nik = '${obsoleteAccount.newNik}', status = '${obsoleteAccount.newStatus}', updated_at = NOW() WHERE id = '${obsoleteAccount.id}' AND nik = '${obsoleteAccount.currentNik}';`,
      ``,
      `-- 2. Re-key 9 active UAT accounts to distinct UAT NIKs (PRESERVING status = 'ACTIVE' and passwords)`,
      ...activeUatAccounts.map(
        (u) =>
          `UPDATE users SET nik = '${u.newNik}', status = 'ACTIVE', updated_at = NOW() WHERE id = '${u.id}' AND nik = '${u.currentNik}';`
      ),
      ``,
      `-- 3. Enforce case-insensitive uniqueness at PostgreSQL engine level across all accounts`,
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_users_unique_lower_nik ON users (LOWER(TRIM(nik))) WHERE nik IS NOT NULL AND TRIM(nik) != '';`
    ];

    return {
      backupFile: "storage/backups/aiven-pre-remediation-users-backup.json",
      preservedTargetAdmin: targetAdmin,
      obsoleteAccountToDeactivate: obsoleteAccount,
      activeUatAccountsToReassign: activeUatAccounts,
      unaffectedAccountsCount: unaffectedCount,
      proposedSqlStatements: sqlStatements,
    };
  } finally {
    await closeDbPool();
  }
}

async function main() {
  const isApply = process.argv.includes("--apply");
  const plan = await planRevisedRemediation();

  console.log("================================================================================");
  console.log(" SPARTA SIAGA — REVISED NIK DUPLICATE REMEDIATION PLAN (DEV & UAT COEXISTENCE)");
  console.log(" Target: Aiven sparta_siaga_isolated (167.71.232.109)");
  console.log(" Mode:   " + (isApply ? "EXECUTE (APPLY)" : "DRY RUN (PROPOSAL ONLY)"));
  console.log("================================================================================\n");

  console.log("1. Preserved System Administrator (Undisputed owner of ADM0001):");
  console.log(`   - ID:     ${plan.preservedTargetAdmin.id}`);
  console.log(`   - NIK:    ${plan.preservedTargetAdmin.nik} (UNCHANGED)`);
  console.log(`   - Name:   ${plan.preservedTargetAdmin.name}`);
  console.log(`   - Status: ${plan.preservedTargetAdmin.status} (ACTIVE)\n`);

  console.log("2. Confirmed Obsolete Account to Deactivate (1 Account):");
  console.log(`   - ID:     ${plan.obsoleteAccountToDeactivate.id}`);
  console.log(`   - NIK:    ${plan.obsoleteAccountToDeactivate.currentNik} -> ${plan.obsoleteAccountToDeactivate.newNik}`);
  console.log(`   - Status: ${plan.obsoleteAccountToDeactivate.currentStatus} -> ${plan.obsoleteAccountToDeactivate.newStatus}`);
  console.log(`   - Reason: ${plan.obsoleteAccountToDeactivate.reason}\n`);

  console.log(`3. Active UAT Accounts Preserved in ACTIVE Status (${plan.activeUatAccountsToReassign.length} Accounts):`);
  for (const u of plan.activeUatAccountsToReassign) {
    console.log(`   - [${u.id}] ${u.name} (${u.businessRole.toUpperCase()})`);
    console.log(`     NIK:    ${u.currentNik} -> ${u.newNik}`);
    console.log(`     Status: ${u.status} (PRESERVED ACTIVE)`);
    console.log(`     Logins: ${u.loginIdentifiers.join(" / ")}`);
    console.log(`     Role:   ${u.rolePurpose}`);
    console.log();
  }

  console.log(`4. Unaffected Accounts: ${plan.unaffectedAccountsCount} accounts remain untouched in the database.\n`);

  console.log("5. Proposed SQL Statements:");
  console.log("--------------------------------------------------------------------------------");
  for (const sql of plan.proposedSqlStatements) {
    console.log(sql);
  }
  console.log("--------------------------------------------------------------------------------\n");

  if (!isApply) {
    console.log("⚠️  SAFETY NOTICE: Dry run complete. No database writes were committed.");
    console.log("   Awaiting explicit user authorization before applying.\n");
    return;
  }

  // Execution logic (only when approved with --apply)
  const pool = getIsolatedDbPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    console.log("Executing transaction...");

    // 1. Deactivate obsolete seed admin
    const res1 = await client.query(
      `UPDATE users SET nik = $1, status = $2, updated_at = NOW() WHERE id = $3 AND nik = $4`,
      [
        plan.obsoleteAccountToDeactivate.newNik,
        plan.obsoleteAccountToDeactivate.newStatus,
        plan.obsoleteAccountToDeactivate.id,
        plan.obsoleteAccountToDeactivate.currentNik,
      ]
    );
    if (res1.rowCount !== 1) {
      throw new Error(`SAFETY ASSERTION FAILED: Expected 1 row updated for ${plan.obsoleteAccountToDeactivate.id}, got ${res1.rowCount}!`);
    }
    console.log(`✔ [1/3] Updated ${plan.obsoleteAccountToDeactivate.id} -> NIK '${plan.obsoleteAccountToDeactivate.newNik}', status '${plan.obsoleteAccountToDeactivate.newStatus}' (1 row).`);

    // 2. Re-key UAT accounts while preserving status = 'ACTIVE'
    let countUat = 0;
    for (const u of plan.activeUatAccountsToReassign) {
      const resU = await client.query(
        `UPDATE users SET nik = $1, status = 'ACTIVE', updated_at = NOW() WHERE id = $2 AND nik = $3`,
        [u.newNik, u.id, u.currentNik]
      );
      if (resU.rowCount !== 1) {
        throw new Error(`SAFETY ASSERTION FAILED: Expected 1 row updated for ${u.id}, got ${resU.rowCount}!`);
      }
      countUat++;
    }
    console.log(`✔ [2/3] Re-keyed ${countUat} UAT accounts with ACTIVE status preserved.`);

    // 3. Create unique index
    await client.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_users_unique_lower_nik ON users (LOWER(TRIM(nik))) WHERE nik IS NOT NULL AND TRIM(nik) != ''`
    );
    console.log(`✔ [3/3] Created case-insensitive unique index 'idx_users_unique_lower_nik'.`);

    await client.query("COMMIT");
    console.log("\n✔ Transaction committed successfully!");

    // Post-commit verification
    console.log("\nRunning post-commit validation checks...");
    const admCount = await client.query(
      `SELECT id, nik, name, status FROM users WHERE LOWER(nik) = 'adm0001'`
    );
    console.log(`- Accounts with NIK 'ADM0001': ${admCount.rows.length}`);
    if (admCount.rows.length !== 1 || admCount.rows[0].id !== "usr_sysadmin_01") {
      throw new Error(`CRITICAL POST-CHECK FAILED: Expected usr_sysadmin_01 to be sole owner of ADM0001! Found: ${JSON.stringify(admCount.rows)}`);
    }
    console.log(`  -> Confirmed: ${admCount.rows[0].id} (${admCount.rows[0].name}) is sole owner of ADM0001.`);

    const dupCheck = await client.query(`
      SELECT LOWER(nik) as lower_nik, count(*) as c 
      FROM users 
      WHERE nik IS NOT NULL AND TRIM(nik) != '' 
      GROUP BY LOWER(nik) 
      HAVING count(*) > 1
    `);
    if (dupCheck.rows.length > 0) {
      throw new Error(`CRITICAL POST-CHECK FAILED: Remaining duplicate NIKs detected! Found: ${JSON.stringify(dupCheck.rows)}`);
    }
    console.log(`- Remaining duplicate NIKs in database: 0 (PASSED).`);

    const idxCheck = await client.query(`
      SELECT indexname, indexdef FROM pg_indexes 
      WHERE tablename = 'users' AND indexname = 'idx_users_unique_lower_nik'
    `);
    if (idxCheck.rows.length === 0) {
      throw new Error(`CRITICAL POST-CHECK FAILED: Index idx_users_unique_lower_nik not found!`);
    }
    console.log(`- Unique index confirmed: ${idxCheck.rows[0].indexname} (PASSED).`);

  } catch (err) {
    await client.query("ROLLBACK");
    console.error("❌ Remediation failed, rolled back:", err);
    throw err;
  } finally {
    client.release();
    await closeDbPool();
  }
}

main().catch(console.error);
