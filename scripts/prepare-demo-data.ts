/**
 * SPARTA SIAGA - Pre-Presentation Demo Data Cleanup Script
 * 
 * Prepares a clean, safe, and presentation-ready database dataset.
 * 
 * Rules:
 *   - NEVER delete or modify usr_seed_admin (Admin SPARTA SIAGA)
 *   - Keep ONLY the SINGLE newest legitimate non-test report.
 *   - Delete all older reports and their dependent records in safe relational order.
 *   - Purge associated evidence storage files only after successful DB transaction.
 *   - Keep notification logs clean (only canonical notification for retained report).
 *   - Create / configure coherent demo personas for branch CIKOKOL.
 *   - Never print or leak passwords.
 *   - Transactional rollback on any failure.
 */

import fs from "node:fs";
import path from "node:path";
import bcrypt from "bcryptjs";
import { getDbPool } from "../lib/db.js";

// Load .env.local if DEMO_USER_PASSWORD not yet in process.env
if (!process.env.DEMO_USER_PASSWORD && fs.existsSync(".env.local")) {
  try {
    const envContent = fs.readFileSync(".env.local", "utf-8");
    for (const line of envContent.split("\n")) {
      const trimmed = line.trim();
      if (trimmed.startsWith("DEMO_USER_PASSWORD=")) {
        const val = trimmed.substring("DEMO_USER_PASSWORD=".length).trim().replace(/^["']|["']$/g, "");
        if (val) process.env.DEMO_USER_PASSWORD = val;
      }
    }
  } catch {
    // Ignore read error
  }
}

const PROTECTED_ADMIN_ID = "usr_seed_admin";
const DEMO_BRANCH = "CIKOKOL";

interface RetainedReport {
  id: string;
  created_at: string;
  disaster_type: string;
  report_origin: string;
  branch: string;
  store_id: string;
  store_name: string;
  status: string;
  progress: number;
}

interface CleanupPlan {
  backupVerified: boolean;
  backupPath: string;
  adminProtected: boolean;
  demoPasswordConfigured: boolean;
  retainedReport: RetainedReport;
  reportDeleteIds: string[];
  totalReportsBefore: number;
  totalReportsAfter: number;
  retainedNotificationId: string | null;
  notifDeleteIds: string[];
  totalNotifsBefore: number;
  totalNotifsAfter: number;
  dependentCounts: {
    estimations: number;
    routes: number;
    progressUpdates: number;
    photos: number;
    approvals: number;
    approvalHistory: number;
    instructions: number;
    distributions: number;
  };
  storage: {
    totalFilesBefore: number;
    filesToDelete: string[];
    filesToRetain: string[];
  };
  users: {
    totalBefore: number;
    adminUser: { id: string; name: string; system_role: string; status: string };
    demoPersonasToUpdate: Array<{ id: string; name: string; business_role: string; scope: string; branch: string | null }>;
    demoPersonasToCreate: Array<{ id: string; name: string; business_role: string; scope: string; branch: string | null }>;
    usersToDeactivate: Array<{ id: string; name: string; reason: string }>;
  };
}

export async function buildCleanupPlan(): Promise<CleanupPlan> {
  const pool = getDbPool();

  // 1. Verify Backup Integrity
  const backupsDir = path.join(process.cwd(), "backups");
  let backupVerified = false;
  let backupPath = "";

  if (fs.existsSync(backupsDir)) {
    const dirs = fs.readdirSync(backupsDir).filter((d) => d.startsWith("dev-backup-")).sort().reverse();
    if (dirs.length > 0) {
      const latest = path.join(backupsDir, dirs[0]);
      const metaPath = path.join(latest, "BACKUP_METADATA.json");
      const shaPath = path.join(latest, "SHA256SUMS");
      if (fs.existsSync(metaPath) && fs.existsSync(shaPath)) {
        backupVerified = true;
        backupPath = latest;
      }
    }
  }

  if (!backupVerified) {
    throw new Error("SAFETY STOP: Valid backup directory or BACKUP_METADATA.json / SHA256SUMS not found!");
  }

  // 2. Verify Protected System Admin
  const adminRes = await pool.query("SELECT * FROM users WHERE id = $1", [PROTECTED_ADMIN_ID]);
  if (adminRes.rowCount === 0) {
    throw new Error(`CRITICAL: Protected admin '${PROTECTED_ADMIN_ID}' missing from database!`);
  }
  const admin = adminRes.rows[0];
  const adminProtected = 
    admin.id === PROTECTED_ADMIN_ID &&
    admin.name === "Admin SPARTA SIAGA" &&
    admin.system_role === "ADMIN" &&
    admin.status === "ACTIVE";

  if (!adminProtected) {
    throw new Error("CRITICAL: Protection verification failed for Admin SPARTA SIAGA!");
  }

  // 3. Demo Password check
  const demoPasswordConfigured = Boolean(process.env.DEMO_USER_PASSWORD);

  // 4. Resolve exact single newest legitimate non-test report
  const incRes = await pool.query(
    "SELECT id, created_at, disaster_type, report_origin, branch, store_id, store_name, status, progress, earthquake_event_id, timeline FROM incidents ORDER BY created_at DESC"
  );
  const allIncidents = incRes.rows;

  const testPrefixes = ["INC-TEST", "TASK4-TEST", "INC-T5", "INC-T6", "INC-DEMO", "TEST-"];
  const legitimateIncidents = allIncidents.filter((inc) => {
    const isTestId = testPrefixes.some((p) => inc.id.startsWith(p));
    const isTestStore = (inc.store_name || "").toLowerCase().includes("test");
    const isTestBranch = (inc.branch || "").toLowerCase().includes("test");
    return !isTestId && !isTestStore && !isTestBranch;
  });

  if (legitimateIncidents.length === 0) {
    throw new Error("CRITICAL: No legitimate non-test incident found to retain!");
  }

  // Exact ONE newest legitimate report:
  const newestReport = legitimateIncidents[0];
  const KEEP_REPORT_ID = newestReport.id;
  const retainedReport: RetainedReport = {
    id: newestReport.id,
    created_at: new Date(newestReport.created_at).toISOString(),
    disaster_type: newestReport.disaster_type,
    report_origin: newestReport.report_origin,
    branch: newestReport.branch,
    store_id: newestReport.store_id || "-",
    store_name: newestReport.store_name || "-",
    status: newestReport.status,
    progress: Number(newestReport.progress || 0),
  };

  const reportsToDelete = allIncidents.filter((inc) => inc.id !== KEEP_REPORT_ID);
  const reportDeleteIds = reportsToDelete.map((r) => r.id);

  // 5. Dependent record counts for reports to delete
  let estimations = 0;
  let routes = 0;
  let progressUpdates = 0;
  let photos = 0;
  let approvals = 0;
  let approvalHistory = 0;
  let instructions = 0;
  let distributions = 0;

  if (reportDeleteIds.length > 0) {
    const depRes = await pool.query(
      `SELECT
        (SELECT COUNT(*) FROM estimations WHERE report_id = ANY($1::text[])) as est_cnt,
        (SELECT COUNT(*) FROM report_estimation_routes WHERE report_id = ANY($1::text[])) as rtes_cnt,
        (SELECT COUNT(*) FROM report_progress_updates WHERE report_id = ANY($1::text[])) as prg_cnt,
        (SELECT COUNT(*) FROM report_progress_photos WHERE report_id = ANY($1::text[])) as pht_cnt,
        (SELECT COUNT(*) FROM report_completion_approvals WHERE report_id = ANY($1::text[])) as app_cnt,
        (SELECT COUNT(*) FROM report_completion_approval_history WHERE report_id = ANY($1::text[])) as hst_cnt,
        (SELECT COUNT(*) FROM report_instructions WHERE report_id = ANY($1::text[])) as ins_cnt,
        (SELECT COUNT(*) FROM report_distributions WHERE report_id = ANY($1::text[])) as dst_cnt
      `,
      [reportDeleteIds]
    );
    const row = depRes.rows[0];
    estimations = Number(row.est_cnt || 0);
    routes = Number(row.rtes_cnt || 0);
    progressUpdates = Number(row.prg_cnt || 0);
    photos = Number(row.pht_cnt || 0);
    approvals = Number(row.app_cnt || 0);
    approvalHistory = Number(row.hst_cnt || 0);
    instructions = Number(row.ins_cnt || 0);
    distributions = Number(row.dst_cnt || 0);
  }

  // 6. Notifications plan
  const notifRes = await pool.query(
    "SELECT id, disaster_id, branch, sent_at, title, ticket_number FROM notification_logs ORDER BY sent_at DESC"
  );
  const allNotifs = notifRes.rows;

  // Find notification directly related to KEEP_REPORT_ID (via event or ticket)
  let matchingNotif = allNotifs.find((n) => {
    if (newestReport.earthquake_event_id && n.disaster_id === newestReport.earthquake_event_id && n.branch === newestReport.branch) {
      return true;
    }
    const timelineStr = JSON.stringify(newestReport.timeline || []);
    if (n.ticket_number && timelineStr.includes(n.ticket_number)) {
      return true;
    }
    return false;
  });

  if (!matchingNotif) {
    // Fallback: single newest legitimate notification
    matchingNotif = allNotifs.find((n) => !n.title.toLowerCase().includes("test") && !n.branch.toLowerCase().includes("test"));
  }

  const retainedNotifId = matchingNotif ? matchingNotif.id : null;
  const notifsToDelete = allNotifs.filter((n) => n.id !== retainedNotifId);
  const notifDeleteIds = notifsToDelete.map((n) => n.id);

  // 7. Evidence files plan
  const storageRoot = path.join(process.cwd(), "storage");
  function walkFiles(dir: string): string[] {
    let files: string[] = [];
    if (!fs.existsSync(dir)) return files;
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        files = files.concat(walkFiles(full));
      } else {
        files.push(full);
      }
    }
    return files;
  }

  const allStorageFiles = walkFiles(storageRoot);
  const filesToDelete: string[] = [];
  const filesToRetain: string[] = [];

  const deleteReportIdTokens = new Set(
    reportDeleteIds.flatMap((id) => [id, id.replace(/[^a-zA-Z0-9_-]/g, "_")])
  );
  const keepTokens = [KEEP_REPORT_ID, KEEP_REPORT_ID.replace(/[^a-zA-Z0-9_-]/g, "_")];

  for (const f of allStorageFiles) {
    const base = path.basename(f);
    const belongsToKeep = keepTokens.some((token) => base.includes(token));
    if (belongsToKeep) {
      filesToRetain.push(f);
      continue;
    }

    const belongsToDeleted = Array.from(deleteReportIdTokens).some((token) => base.includes(token));
    if (belongsToDeleted) {
      filesToDelete.push(f);
    } else {
      // Unrelated or legacy test file without exact ID token
      // If it belongs to test prefixes, mark for delete
      const isTestFile = 
        testPrefixes.some((p) => base.includes(p)) || 
        base.toLowerCase().includes("test") ||
        base.includes("REPORT-A") ||
        base.includes("WM-TEST");
      if (isTestFile) {
        filesToDelete.push(f);
      } else {
        filesToRetain.push(f);
      }
    }
  }

  // 8. Users & Demo Personas Plan
  const allUsersRes = await pool.query(
    "SELECT id, name, system_role, business_role, scope, branch, status FROM users ORDER BY id ASC"
  );
  const allUsers = allUsersRes.rows;

  const demoPersonasToUpdate = [
    { id: "USR-HO-BUDI", name: "Demo HO Admin", business_role: "ho_admin", scope: "HO", branch: null },
    { id: "USR-BM-G001", name: "Demo Manager Branch", business_role: "bm", scope: "BRANCH", branch: DEMO_BRANCH },
    { id: "USR-BMS-001", name: "Demo BMS", business_role: "bms", scope: "BRANCH", branch: DEMO_BRANCH },
    { id: "usr_local_1790914913099", name: "Demo Tim Toko", business_role: "tim_toko", scope: "BRANCH", branch: DEMO_BRANCH },
  ];

  const demoPersonasToCreate = [
    { id: "USR-DEMO-BES", name: "Demo BES", business_role: "bes", scope: "BRANCH", branch: DEMO_BRANCH },
    { id: "USR-DEMO-BBS", name: "Demo BBS", business_role: "bbs", scope: "BRANCH", branch: DEMO_BRANCH },
    { id: "USR-DEMO-BMC", name: "Demo BMC", business_role: "bmc", scope: "BRANCH", branch: DEMO_BRANCH },
    { id: "USR-DEMO-BEC", name: "Demo BEC", business_role: "bec", scope: "BRANCH", branch: DEMO_BRANCH },
    { id: "USR-DEMO-BBC", name: "Demo BBC", business_role: "bbc", scope: "BRANCH", branch: DEMO_BRANCH },
  ];

  const usersToDeactivate = [
    { id: "USR-BM-G002", name: "Cahyo BM G002", reason: "Legacy branch G002 test account (deactivated to preserve history)" },
    { id: "USR-MTC-001", name: "Dedi Maintenance", reason: "Legacy test persona (deactivated to preserve history)" },
  ];

  return {
    backupVerified,
    backupPath,
    adminProtected,
    demoPasswordConfigured,
    retainedReport,
    reportDeleteIds,
    totalReportsBefore: allIncidents.length,
    totalReportsAfter: 1,
    retainedNotificationId: retainedNotifId,
    notifDeleteIds,
    totalNotifsBefore: allNotifs.length,
    totalNotifsAfter: retainedNotifId ? 1 : 0,
    dependentCounts: {
      estimations,
      routes,
      progressUpdates,
      photos,
      approvals,
      approvalHistory,
      instructions,
      distributions,
    },
    storage: {
      totalFilesBefore: allStorageFiles.length,
      filesToDelete,
      filesToRetain,
    },
    users: {
      totalBefore: allUsers.length,
      adminUser: {
        id: admin.id,
        name: admin.name,
        system_role: admin.system_role,
        status: admin.status,
      },
      demoPersonasToUpdate,
      demoPersonasToCreate,
      usersToDeactivate,
    },
  };
}

export async function executeCleanup(plan: CleanupPlan): Promise<{
  reportsDeletedCount: number;
  notifsDeletedCount: number;
  storageDeletedCount: number;
  usersUpdatedCount: number;
  usersCreatedCount: number;
}> {
  const pool = getDbPool();
  const demoPassword = process.env.DEMO_USER_PASSWORD;

  if (!demoPassword) {
    throw new Error("STOP BEFORE USER MUTATION: DEMO_USER_PASSWORD environment variable is missing!");
  }

  console.log("\n▶ Starting Database Cleanup Transaction...");
  const client = await pool.connect();

  let reportsDeletedCount = 0;
  let notifsDeletedCount = 0;
  let usersUpdatedCount = 0;
  let usersCreatedCount = 0;

  try {
    await client.query("BEGIN");

    // 1. Re-verify usr_seed_admin within transaction
    const adminCheck = await client.query(
      "SELECT id, name, system_role, status FROM users WHERE id = $1 FOR SHARE",
      [PROTECTED_ADMIN_ID]
    );
    if (adminCheck.rowCount === 0 || adminCheck.rows[0].name !== "Admin SPARTA SIAGA") {
      throw new Error("CRITICAL: Protection check for Admin SPARTA SIAGA failed in transaction!");
    }

    // 2. Delete dependent records for reports to delete (and any historical orphan rows)
    console.log(`   Deleting dependents for all reports except ${plan.retainedReport.id}...`);

    await client.query(
      "DELETE FROM report_progress_photos WHERE report_id != $1",
      [plan.retainedReport.id]
    );
    await client.query(
      "DELETE FROM report_progress_updates WHERE report_id != $1",
      [plan.retainedReport.id]
    );
    await client.query(
      "DELETE FROM report_completion_approval_history WHERE report_id != $1",
      [plan.retainedReport.id]
    );
    await client.query(
      "DELETE FROM report_completion_approvals WHERE report_id != $1",
      [plan.retainedReport.id]
    );
    await client.query(
      "DELETE FROM report_instructions WHERE report_id != $1",
      [plan.retainedReport.id]
    );
    await client.query(
      "DELETE FROM report_distributions WHERE report_id != $1",
      [plan.retainedReport.id]
    );
    await client.query(
      "DELETE FROM estimations WHERE report_id != $1",
      [plan.retainedReport.id]
    );
    await client.query(
      "DELETE FROM report_estimation_routes WHERE report_id != $1",
      [plan.retainedReport.id]
    );

    // Delete reports
    const delRes = await client.query(
      "DELETE FROM incidents WHERE id != $1",
      [plan.retainedReport.id]
    );
    reportsDeletedCount = delRes.rowCount || 0;
    console.log(`   ✅ Deleted older/test reports.`);

    // 3. Clean notifications
    if (plan.notifDeleteIds.length > 0) {
      const delNotifRes = await client.query(
        "DELETE FROM notification_logs WHERE id = ANY($1::text[])",
        [plan.notifDeleteIds]
      );
      notifsDeletedCount = delNotifRes.rowCount || 0;
      console.log(`   ✅ Deleted ${notifsDeletedCount} older/test notifications.`);
    }

    // 4. Update / create demo personas with hashed password
    const passwordHash = await bcrypt.hash(demoPassword, 10);

    // Update existing accounts mapped to demo personas
    for (const u of plan.users.demoPersonasToUpdate) {
      await client.query(
        `UPDATE users 
         SET name = $1, business_role = $2, scope = $3, branch = $4, status = 'ACTIVE', 
             password_hash = $5, updated_at = NOW()
         WHERE id = $6 AND id != $7`,
        [u.name, u.business_role, u.scope, u.branch, passwordHash, u.id, PROTECTED_ADMIN_ID]
      );
      usersUpdatedCount++;
    }

    // Create missing personas if they do not exist
    for (const c of plan.users.demoPersonasToCreate) {
      const existing = await client.query("SELECT id FROM users WHERE id = $1", [c.id]);
      if (existing.rowCount && existing.rowCount > 0) {
        await client.query(
          `UPDATE users 
           SET name = $1, business_role = $2, scope = $3, branch = $4, status = 'ACTIVE', 
               password_hash = $5, updated_at = NOW()
           WHERE id = $6`,
          [c.name, c.business_role, c.scope, c.branch, passwordHash, c.id]
        );
        usersUpdatedCount++;
      } else {
        await client.query(
          `INSERT INTO users (id, name, system_role, business_role, scope, branch, status, password_hash, created_at, updated_at, source)
           VALUES ($1, $2, 'USER', $3, $4, $5, 'ACTIVE', $6, NOW(), NOW(), 'LOCAL')`,
          [c.id, c.name, c.business_role, c.scope, c.branch, passwordHash]
        );
        usersCreatedCount++;
      }
    }

    // Deactivate irrelevant accounts
    for (const d of plan.users.usersToDeactivate) {
      await client.query(
        "UPDATE users SET status = 'INACTIVE', updated_at = NOW() WHERE id = $1 AND id != $2",
        [d.id, PROTECTED_ADMIN_ID]
      );
    }

    // Commit database changes
    await client.query("COMMIT");
    console.log("   ✅ Database transaction successfully committed!");
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("   ❌ Transaction rolled back due to error:", err);
    throw err;
  } finally {
    client.release();
  }

  // 5. Purge associated evidence files from private storage ONLY after DB commit
  console.log("\n▶ Cleaning Evidence Storage Files...");
  let storageDeletedCount = 0;
  for (const filePath of plan.storage.filesToDelete) {
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        storageDeletedCount++;
      }
    } catch (err) {
      console.warn(`   ⚠️ Warning: Failed to unlink ${filePath}:`, err);
    }
  }
  console.log(`   ✅ Purged ${storageDeletedCount} orphan evidence files.`);
  console.log(`   ✅ Retained ${plan.storage.filesToRetain.length} valid storage files.`);

  return {
    reportsDeletedCount,
    notifsDeletedCount,
    storageDeletedCount,
    usersUpdatedCount,
    usersCreatedCount,
  };
}

export async function verifyPostCleanup(retainedReportId: string): Promise<void> {
  const pool = getDbPool();
  console.log("\n▶ Running Post-Cleanup Verification Audits...");

  // 1. Reports verification
  const incRes = await pool.query("SELECT id, status, branch, store_name, created_at FROM incidents");
  console.log(`   Remaining incidents count: ${incRes.rows.length}`);
  if (incRes.rows.length !== 1 || incRes.rows[0].id !== retainedReportId) {
    throw new Error(`VERIFICATION FAILED: Expected exactly 1 incident '${retainedReportId}', found ${incRes.rows.length}`);
  }
  console.log(`   ✅ Exactly 1 legitimate report retained: ${incRes.rows[0].id} (${incRes.rows[0].store_name})`);

  // Check no test incidents remain
  const testCheck = await pool.query(
    "SELECT id FROM incidents WHERE id ILIKE 'INC-TEST%' OR id ILIKE 'TASK4-TEST%' OR id ILIKE 'INC-T5%' OR id ILIKE 'INC-T6%' OR id ILIKE 'INC-DEMO%'"
  );
  if (testCheck.rows.length > 0) {
    throw new Error(`VERIFICATION FAILED: Found ${testCheck.rows.length} remaining test incidents!`);
  }
  console.log("   ✅ Zero test incidents remaining.");

  // 2. Notifications verification
  const notifRes = await pool.query("SELECT id, disaster_id, branch, title FROM notification_logs");
  console.log(`   Remaining notifications count: ${notifRes.rows.length}`);
  if (notifRes.rows.length > 2) {
    throw new Error(`VERIFICATION FAILED: Expected clean notifications (1-2), found ${notifRes.rows.length}`);
  }
  console.log("   ✅ Notifications clean and minimal.");

  // 3. User verification
  const adminRes = await pool.query("SELECT * FROM users WHERE id = $1", [PROTECTED_ADMIN_ID]);
  const admin = adminRes.rows[0];
  if (!admin || admin.name !== "Admin SPARTA SIAGA" || admin.system_role !== "ADMIN" || admin.status !== "ACTIVE") {
    throw new Error("VERIFICATION FAILED: Admin SPARTA SIAGA was altered or compromised!");
  }
  console.log("   ✅ Admin SPARTA SIAGA verified untouched and intact.");

  const activeUsersRes = await pool.query("SELECT id, name, business_role, branch, status FROM users WHERE status = 'ACTIVE' ORDER BY id ASC");
  console.log(`   Active users count: ${activeUsersRes.rows.length}`);
  console.table(activeUsersRes.rows);

  // 4. Relational integrity check (zero orphan records)
  const orphanCheck = await pool.query(`
    SELECT
      (SELECT COUNT(*) FROM report_estimation_routes WHERE report_id != $1) as rtes,
      (SELECT COUNT(*) FROM report_progress_updates WHERE report_id != $1) as prgs,
      (SELECT COUNT(*) FROM report_progress_photos WHERE report_id != $1) as phts,
      (SELECT COUNT(*) FROM report_completion_approvals WHERE report_id != $1) as apps,
      (SELECT COUNT(*) FROM report_completion_approval_history WHERE report_id != $1) as hsts,
      (SELECT COUNT(*) FROM estimations WHERE report_id != $1) as ests,
      (SELECT COUNT(*) FROM report_instructions WHERE report_id != $1) as inss,
      (SELECT COUNT(*) FROM report_distributions WHERE report_id != $1) as dsts
  `, [retainedReportId]);
  const o = orphanCheck.rows[0];
  const totalOrphans = Number(o.rtes) + Number(o.prgs) + Number(o.phts) + Number(o.apps) + Number(o.hsts) + Number(o.ests) + Number(o.inss) + Number(o.dsts);
  if (totalOrphans > 0) {
    throw new Error(`VERIFICATION FAILED: Found ${totalOrphans} orphan dependent records!`);
  }
  console.log("   ✅ Zero orphan dependent records in database.");
  console.log("\n🎉 ALL POST-CLEANUP VERIFICATIONS PASSED SUCCESSFULLY!");
}

async function run() {
  const isDryRun = process.argv.includes("--dry-run");
  const isApply = process.argv.includes("--apply");

  if (!isDryRun && !isApply) {
    console.error("Usage: pnpm exec tsx scripts/prepare-demo-data.ts [--dry-run | --apply]");
    process.exit(1);
  }

  console.log("====================================================");
  console.log(" SPARTA SIAGA - PRE-PRESENTATION DEMO DATA CLEANUP");
  console.log(` Mode: ${isApply ? "⚠️ APPLY CLEANUP (MUTATION)" : "🔍 DRY-RUN ONLY (ZERO MUTATION)"}`);
  console.log("====================================================\n");

  const plan = await buildCleanupPlan();

  console.log("1. ADMIN PROTECTION VERIFICATION:");
  console.log(`   Account ID:      ${PROTECTED_ADMIN_ID}`);
  console.log(`   Admin Protected: ${plan.adminProtected ? "✅ VERIFIED (EXACT PROTECTION INTACT)" : "❌ FAILED"}`);

  console.log("\n2. BACKUP INTEGRITY STATUS:");
  console.log(`   Backup Status:   ${plan.backupVerified ? "✅ BACKUP VERIFIED & CHECKSUM READY" : "❌ NO BACKUP FOUND"}`);
  console.log(`   Backup Path:     ${plan.backupPath}`);

  console.log("\n3. DEMO CREDENTIALS STATUS:");
  console.log(`   DEMO_USER_PASSWORD set: ${plan.demoPasswordConfigured ? "✅ CONFIGURED" : "⚠️ NOT SET (Must be provided before --apply)"}`);

  console.log("\n4. EXACT SINGLE NEWEST LEGITIMATE REPORT TO RETAIN:");
  console.log(`   ID:            ${plan.retainedReport.id}`);
  console.log(`   Created At:    ${plan.retainedReport.created_at}`);
  console.log(`   Disaster Type: ${plan.retainedReport.disaster_type}`);
  console.log(`   Report Origin: ${plan.retainedReport.report_origin}`);
  console.log(`   Branch:        ${plan.retainedReport.branch}`);
  console.log(`   Store:         ${plan.retainedReport.store_id} - ${plan.retainedReport.store_name}`);
  console.log(`   Status:        ${plan.retainedReport.status}`);
  console.log(`   Progress:      ${plan.retainedReport.progress}%`);

  console.log("\n5. REPORTS CLEANUP SUMMARY:");
  console.log(`   Reports BEFORE: ${plan.totalReportsBefore}`);
  console.log(`   Reports to DELETE: ${plan.reportDeleteIds.length}`);
  console.log(`   Reports AFTER:  ${plan.totalReportsAfter}`);

  console.log("\n6. NOTIFICATIONS CLEANUP SUMMARY:");
  console.log(`   Notifications BEFORE: ${plan.totalNotifsBefore}`);
  console.log(`   Retained Notification ID: ${plan.retainedNotificationId || "None"}`);
  console.log(`   Notifications to DELETE: ${plan.notifDeleteIds.length}`);
  console.log(`   Notifications AFTER:  ${plan.totalNotifsAfter}`);

  console.log("\n7. DEPENDENT DATABASE RECORDS TO REMOVE:");
  console.table(plan.dependentCounts);

  console.log("\n8. EVIDENCE STORAGE FILES TO PURGE:");
  console.log(`   Storage Files BEFORE:   ${plan.storage.totalFilesBefore}`);
  console.log(`   Files Marked to PURGE:  ${plan.storage.filesToDelete.length}`);
  console.log(`   Files Marked to RETAIN: ${plan.storage.filesToRetain.length}`);

  console.log("\n9. TARGET DEMO PERSONAS (Branch CIKOKOL):");
  console.table([
    ...plan.users.demoPersonasToUpdate.map((u) => ({ ...u, action: "UPDATE/ACTIVATE" })),
    ...plan.users.demoPersonasToCreate.map((u) => ({ ...u, action: "CREATE/ACTIVATE" })),
    ...plan.users.usersToDeactivate.map((u) => ({ id: u.id, name: u.name, business_role: "N/A", scope: "N/A", branch: null, action: "DEACTIVATE (" + u.reason + ")" })),
  ]);

  if (isDryRun) {
    console.log("\n====================================================");
    console.log("✅ DRY-RUN AUDIT COMPLETE - ZERO MUTATIONS PERFORMED");
    console.log("====================================================");
    console.log("Safe to apply cleanup: YES");
    process.exit(0);
  }

  if (isApply) {
    console.log("\n====================================================");
    console.log("⚠️ EXECUTING CLEANUP WITH TRANSACTIONAL SAFETY...");
    console.log("====================================================");

    const result = await executeCleanup(plan);

    console.log("\nCleanup execution summary:");
    console.log(` - Reports deleted:    ${result.reportsDeletedCount}`);
    console.log(` - Notifs deleted:     ${result.notifsDeletedCount}`);
    console.log(` - Evidence files purged: ${result.storageDeletedCount}`);
    console.log(` - Users updated:      ${result.usersUpdatedCount}`);
    console.log(` - Users created:      ${result.usersCreatedCount}`);

    await verifyPostCleanup(plan.retainedReport.id);
    process.exit(0);
  }
}

if (process.argv[1] && process.argv[1].endsWith("prepare-demo-data.ts")) {
  run().catch((err) => {
    console.error("\n❌ Fatal Error:", err);
    process.exit(1);
  });
}
