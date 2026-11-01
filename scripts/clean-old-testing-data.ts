import fs from "fs";
import path from "path";
import { getDbPool, closeDbPool } from "../lib/db";
import { assertIsolatedDatabase } from "../lib/database-safety";

export interface CleanupSummary {
  dryRun: boolean;
  preservedAdminsCount: number;
  preservedAdmins: Array<{ id: string; nik: string; name: string }>;
  targetTestUsersCount: number;
  targetTestUsers: Array<{ id: string; nik: string; name: string; role: string }>;
  targetTestIncidentsCount: number;
  targetTestIncidents: Array<{ id: string; store: string; status: string }>;
  affectedMilestoneRows: number;
  affectedApprovalRows: number;
  affectedHistoryRows: number;
  affectedRouteRows: number;
  affectedDistributionRows: number;
  targetStorageFilesCount: number;
  targetStorageFiles: string[];
}

export async function cleanOldTestingData(isLive: boolean = false): Promise<CleanupSummary> {
  const pool = getDbPool();
  await assertIsolatedDatabase(pool);

  console.log("==============================================================");
  console.log(`🧹 SPARTA SIAGA - CLEANUP OLD TESTING DATA [${isLive ? "LIVE EXECUTION" : "DRY RUN"}]`);
  console.log("==============================================================");

  // 1. Verify and Protect Administrators
  const adminsRes = await pool.query(
    "SELECT id, nik, name, email, system_role FROM users WHERE system_role = 'ADMIN' OR id = 'usr_seed_admin' OR nik = 'ADM0001'"
  );
  const preservedAdmins = adminsRes.rows.map((u) => ({
    id: u.id,
    nik: u.nik,
    name: u.name,
  }));
  const adminIds = new Set(preservedAdmins.map((a) => a.id));

  console.log(`[Safety Audit] Preserved System Administrators (${preservedAdmins.length}):`);
  preservedAdmins.forEach((a) => console.log(`  🛡️ [PROTECTED] ID: ${a.id} | NIK: ${a.nik} | Name: ${a.name}`));

  // 2. Identify Test Users to Clean
  // Explicitly target scaffolding test accounts created during automated tests:
  // usr_bes_verify, usr_bms_verify, usr_t_*, usr_vis_*, usr_mv_*, usr_pw_*, u-test-*
  // AND NEVER an admin!
  const allUsersRes = await pool.query("SELECT id, nik, name, system_role, business_role FROM users");
  const targetTestUsers = allUsersRes.rows
    .filter((u) => {
      if (adminIds.has(u.id) || u.system_role === "ADMIN") return false;
      // Do not delete clean demo personas we will use
      if (["USR-BMS-001", "USR-DEMO-BES", "USR-BM-G001", "USR-HO-BUDI"].includes(u.id)) return false;
      
      // Target test scaffolding accounts
      const isScaffoldingId =
        u.id.startsWith("usr_") ||
        u.id.startsWith("u-test-") ||
        u.nik.startsWith("T_") ||
        u.nik.startsWith("VIS_") ||
        u.nik.startsWith("MV_") ||
        u.nik.startsWith("PW_") ||
        ["BES001", "BMS001", "1001", "1002", "1003", "1004"].includes(u.nik);

      return isScaffoldingId;
    })
    .map((u) => ({
      id: u.id,
      nik: u.nik,
      name: u.name,
      role: u.business_role || u.system_role,
    }));

  console.log(`\n[Audit] Scaffolding Test Users to Clean (${targetTestUsers.length}):`);
  targetTestUsers.forEach((u) => console.log(`  ❌ [TARGET] ID: ${u.id} | NIK: ${u.nik} | Name: ${u.name}`));

  // 3. Identify Test Incidents to Clean
  // Only target incidents created by automated test scripts (TEST-*, INC-REFINE-*, INC-TEST-*)
  const allIncRes = await pool.query("SELECT id, store_name, status FROM incidents");
  const targetTestIncidents = allIncRes.rows
    .filter((i) => {
      return (
        i.id.startsWith("TEST-") ||
        i.id.startsWith("INC-REFINE-") ||
        i.id.startsWith("INC-TEST-")
      );
    })
    .map((i) => ({
      id: i.id,
      store: i.store_name,
      status: i.status,
    }));

  console.log(`\n[Audit] Automated Test Incidents to Clean (${targetTestIncidents.length}):`);
  targetTestIncidents.forEach((i) => console.log(`  ❌ [TARGET] ID: ${i.id} | Store: ${i.store} | Status: ${i.status}`));

  const testReportIds = targetTestIncidents.map((i) => i.id);

  // 4. Count Related Child Records
  let affectedMilestones = 0;
  let affectedApprovals = 0;
  let affectedHistories = 0;
  let affectedRoutes = 0;
  let affectedDistributions = 0;

  if (testReportIds.length > 0) {
    const msRes = await pool.query(
      "SELECT COUNT(*) as cnt FROM report_milestones WHERE report_id = ANY($1)",
      [testReportIds]
    );
    affectedMilestones = parseInt(msRes.rows[0].cnt, 10);

    const apprRes = await pool.query(
      "SELECT COUNT(*) as cnt FROM report_completion_approvals WHERE report_id = ANY($1)",
      [testReportIds]
    );
    affectedApprovals = parseInt(apprRes.rows[0].cnt, 10);

    const histRes = await pool.query(
      "SELECT COUNT(*) as cnt FROM report_completion_approval_history WHERE report_id = ANY($1)",
      [testReportIds]
    );
    affectedHistories = parseInt(histRes.rows[0].cnt, 10);

    const routeRes = await pool.query(
      "SELECT COUNT(*) as cnt FROM report_estimation_routes WHERE report_id = ANY($1)",
      [testReportIds]
    );
    affectedRoutes = parseInt(routeRes.rows[0].cnt, 10);

    const distRes = await pool.query(
      "SELECT COUNT(*) as cnt FROM report_distributions WHERE report_id = ANY($1)",
      [testReportIds]
    );
    affectedDistributions = parseInt(distRes.rows[0].cnt, 10);
  }

  // 5. Identify Storage Files to Clean
  const targetStorageFiles: string[] = [];
  const milestonesDir = path.resolve("storage", "milestones");
  if (fs.existsSync(milestonesDir)) {
    const files = fs.readdirSync(milestonesDir);
    for (const f of files) {
      for (const repId of testReportIds) {
        if (f.startsWith(`doc_${repId}_`)) {
          targetStorageFiles.push(path.join(milestonesDir, f));
          break;
        }
      }
    }
  }

  console.log(`\n[Audit] Child Records and Storage Files Tally:`);
  console.log(`  - report_milestones               : ${affectedMilestones} rows`);
  console.log(`  - report_completion_approvals     : ${affectedApprovals} rows`);
  console.log(`  - report_completion_approval_history: ${affectedHistories} rows`);
  console.log(`  - report_estimation_routes        : ${affectedRoutes} rows`);
  console.log(`  - report_distributions            : ${affectedDistributions} rows`);
  console.log(`  - storage/milestones files        : ${targetStorageFiles.length} files`);

  // 6. Execute Deletion if LIVE
  if (isLive) {
    console.log("\n[Execution] Performing transactional database cleanup...");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      // Verify no admin is in target test users
      for (const u of targetTestUsers) {
        if (adminIds.has(u.id)) {
          throw new Error(`ABORT: Attempted to delete admin user: ${u.id}`);
        }
      }

      if (testReportIds.length > 0) {
        await client.query(
          "DELETE FROM report_completion_approval_history WHERE report_id = ANY($1)",
          [testReportIds]
        );
        await client.query(
          "DELETE FROM report_completion_approvals WHERE report_id = ANY($1)",
          [testReportIds]
        );
        await client.query(
          "DELETE FROM report_milestones WHERE report_id = ANY($1)",
          [testReportIds]
        );
        await client.query(
          "DELETE FROM report_estimation_routes WHERE report_id = ANY($1)",
          [testReportIds]
        );
        await client.query(
          "DELETE FROM report_distributions WHERE report_id = ANY($1)",
          [testReportIds]
        );
        await client.query(
          "DELETE FROM incidents WHERE id = ANY($1)",
          [testReportIds]
        );
      }

      const targetUserIds = targetTestUsers.map((u) => u.id);
      if (targetUserIds.length > 0) {
        // Delete permission overrides first if any
        await client.query(
          "DELETE FROM user_permission_overrides WHERE user_id = ANY($1)",
          [targetUserIds]
        );
        await client.query(
          "DELETE FROM users WHERE id = ANY($1)",
          [targetUserIds]
        );
      }

      await client.query("COMMIT");
      console.log("✔ [Execution] Database records deleted successfully.");

      // Delete storage files
      let deletedFiles = 0;
      for (const f of targetStorageFiles) {
        if (fs.existsSync(f)) {
          fs.unlinkSync(f);
          deletedFiles++;
        }
      }
      console.log(`✔ [Execution] ${deletedFiles} obsolete storage files unlinked.`);
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }

    // Post-cleanup audit
    const checkAdmin = await pool.query(
      "SELECT id, nik, name, status FROM users WHERE nik = 'ADM0001'"
    );
    if (checkAdmin.rows.length === 0 || checkAdmin.rows[0].status !== "ACTIVE") {
      throw new Error("FATAL: System Administrator ADM0001 was damaged during cleanup!");
    }
    console.log("✔ [Post-Audit] System Administrator verified 100% ACTIVE and intact.");
  } else {
    console.log("\n[Dry Run] No data was modified. Run with --live to execute.");
  }

  return {
    dryRun: !isLive,
    preservedAdminsCount: preservedAdmins.length,
    preservedAdmins,
    targetTestUsersCount: targetTestUsers.length,
    targetTestUsers,
    targetTestIncidentsCount: targetTestIncidents.length,
    targetTestIncidents,
    affectedMilestoneRows: affectedMilestones,
    affectedApprovalRows: affectedApprovals,
    affectedHistoryRows: affectedHistories,
    affectedRouteRows: affectedRoutes,
    affectedDistributionRows: affectedDistributions,
    targetStorageFilesCount: targetStorageFiles.length,
    targetStorageFiles,
  };
}

if (process.argv[1]?.endsWith("clean-old-testing-data.ts")) {
  const isLive = process.argv.includes("--live");
  cleanOldTestingData(isLive)
    .then(async () => {
      await closeDbPool();
      process.exit(0);
    })
    .catch(async (err) => {
      console.error("[Cleanup] Error:", err);
      await closeDbPool();
      process.exit(1);
    });
}
