import { getDbPool, closeDbPool } from "../lib/db";
import { assertIsolatedDatabase } from "../lib/database-safety";

export async function runStagingCleanup(): Promise<void> {
  const isApply = process.argv.includes("--apply");

  console.log("================================================================================");
  console.log(" SPARTA SIAGA — AUDIT & SAFE CLEANUP OF AIVEN STAGING DATABASE");
  console.log(` Mode: ${isApply ? "🔴 LIVE EXECUTION (--apply)" : "🔍 DRY RUN ONLY (Safe Inspection)"}`);
  console.log("================================================================================\n");

  const pool = getDbPool();
  await assertIsolatedDatabase(pool);

  const dbRes = await pool.query("SELECT current_database() as db_name");
  const currentDb = dbRes.rows[0]?.db_name;
  console.log(`Verified Target Database: "${currentDb}" (Isolated Staging Environment)\n`);

  // 1. Audit confirmed dummy test incidents
  const testIncidentsRes = await pool.query(`
    SELECT id, store_id, store_name, branch, disaster_type, status, created_at
    FROM incidents
    WHERE id LIKE 'TEST-%' OR id LIKE 'INC-TEST-%'
    ORDER BY created_at ASC
  `);
  const dummyIncidentIds: string[] = testIncidentsRes.rows.map((r: any) => r.id);

  // 2. Audit confirmed dummy notifications
  const testNotifsRes = await pool.query(`
    SELECT id, ticket_number, disaster_id, branch, title
    FROM notification_logs
    WHERE id LIKE 'TEST-%' 
       OR ticket_number LIKE 'TEST-%' 
       OR ticket_number LIKE 'INC-TEST-%'
       OR disaster_id LIKE 'TEST-%'
       OR disaster_id LIKE 'flood_sim_%'
  `);
  const dummyNotifIds: string[] = testNotifsRes.rows.map((r: any) => r.id);

  // 3. Audit test users
  const testUsersRes = await pool.query(`
    SELECT id, nik, name, system_role, business_role, branch, status
    FROM users
    WHERE id LIKE 'USR-TEST-%' OR id = 'usr_bms_test'
  `);
  const dummyUserIds: string[] = testUsersRes.rows.map((r: any) => r.id);

  // 4. Audit dummy child records tied to dummy incident IDs
  let dummyMilestonesCount = 0;
  let dummyApprovalsCount = 0;
  let dummyApprovalHistCount = 0;
  let dummyProgressUpdatesCount = 0;
  let dummyProgressPhotosCount = 0;
  let dummyEstimationRoutesCount = 0;
  let dummyDistributionsCount = 0;
  let dummyPicHistoryCount = 0;

  if (dummyIncidentIds.length > 0) {
    const msRes = await pool.query("SELECT count(*)::int as count FROM report_milestones WHERE report_id = ANY($1::text[])", [dummyIncidentIds]);
    dummyMilestonesCount = msRes.rows[0].count;

    const appRes = await pool.query("SELECT count(*)::int as count FROM report_completion_approvals WHERE report_id = ANY($1::text[])", [dummyIncidentIds]);
    dummyApprovalsCount = appRes.rows[0].count;

    const histRes = await pool.query("SELECT count(*)::int as count FROM report_completion_approval_history WHERE report_id = ANY($1::text[])", [dummyIncidentIds]);
    dummyApprovalHistCount = histRes.rows[0].count;

    const updRes = await pool.query("SELECT count(*)::int as count FROM report_progress_updates WHERE report_id = ANY($1::text[])", [dummyIncidentIds]);
    dummyProgressUpdatesCount = updRes.rows[0].count;

    const photoRes = await pool.query("SELECT count(*)::int as count FROM report_progress_photos WHERE report_id = ANY($1::text[])", [dummyIncidentIds]);
    dummyProgressPhotosCount = photoRes.rows[0].count;

    const routeRes = await pool.query("SELECT count(*)::int as count FROM report_estimation_routes WHERE report_id = ANY($1::text[])", [dummyIncidentIds]);
    dummyEstimationRoutesCount = routeRes.rows[0].count;

    const distRes = await pool.query("SELECT count(*)::int as count FROM report_distributions WHERE report_id = ANY($1::text[])", [dummyIncidentIds]);
    dummyDistributionsCount = distRes.rows[0].count;

    const picRes = await pool.query("SELECT count(*)::int as count FROM incident_pic_history WHERE incident_id = ANY($1::text[])", [dummyIncidentIds]);
    dummyPicHistoryCount = picRes.rows[0].count;
  }

  // Audit dummy push deliveries and subscriptions
  const dummyPushDelRes = await pool.query(`
    SELECT id FROM push_event_deliveries 
    WHERE event_id LIKE '%test%' OR event_id LIKE 'TEST-%' OR (user_id IS NOT NULL AND user_id = ANY($1::text[]))
  `, [dummyUserIds.length > 0 ? dummyUserIds : ['__NONE__']]);
  const dummyPushDelIds: string[] = dummyPushDelRes.rows.map((r: any) => r.id);

  // Get total current counts
  const totalIncRes = await pool.query("SELECT count(*)::int as count FROM incidents");
  const totalNotifRes = await pool.query("SELECT count(*)::int as count FROM notification_logs");
  const totalUsersRes = await pool.query("SELECT count(*)::int as count FROM users");
  const totalPushDelRes = await pool.query("SELECT count(*)::int as count FROM push_event_deliveries");
  const totalStoresRes = await pool.query("SELECT count(*)::int as count FROM stores");
  const totalFacilitiesRes = await pool.query("SELECT count(*)::int as count FROM facilities");
  const totalMigrationsRes = await pool.query("SELECT count(*)::int as count FROM sparta_schema_migrations");
  const totalPermAuditRes = await pool.query("SELECT count(*)::int as count FROM permission_audit_logs");
  const totalFacAuditRes = await pool.query("SELECT count(*)::int as count FROM facility_audit_logs");

  console.log("--- AUDIT FINDINGS (Confirmed Dummy Test Records) ---");
  console.log(`• Dummy Incidents to Remove:             ${dummyIncidentIds.length} (out of ${totalIncRes.rows[0].count} total)`);
  console.log(`  - Associated Milestones:               ${dummyMilestonesCount}`);
  console.log(`  - Associated Approvals:                ${dummyApprovalsCount}`);
  console.log(`  - Associated Approval History:         ${dummyApprovalHistCount}`);
  console.log(`  - Associated Progress Updates:         ${dummyProgressUpdatesCount}`);
  console.log(`  - Associated Progress Photos:          ${dummyProgressPhotosCount}`);
  console.log(`  - Associated Estimation Routes:        ${dummyEstimationRoutesCount}`);
  console.log(`  - Associated Distributions:            ${dummyDistributionsCount}`);
  console.log(`  - Associated PIC History:              ${dummyPicHistoryCount}`);
  console.log(`• Dummy Notifications to Remove:         ${dummyNotifIds.length} (out of ${totalNotifRes.rows[0].count} total)`);
  console.log(`• Dummy Push Deliveries to Remove:       ${dummyPushDelIds.length} (out of ${totalPushDelRes.rows[0].count} total)`);
  console.log(`• Dummy Test Users to Remove:            ${dummyUserIds.length} (out of ${totalUsersRes.rows[0].count} total)`);
  console.log(`  Users to remove: ${dummyUserIds.join(", ")}\n`);

  console.log("--- LEGITIMATE DATA PRESERVATION SUMMARY ---");
  console.log(`✔ Stores Master Records:                ${totalStoresRes.rows[0].count} (100% PRESERVED)`);
  console.log(`✔ Facilities Master Records:            ${totalFacilitiesRes.rows[0].count} (100% PRESERVED)`);
  console.log(`✔ Schema Migrations Ledger:             ${totalMigrationsRes.rows[0].count} (100% PRESERVED)`);
  console.log(`✔ Permission Audit Logs:                ${totalPermAuditRes.rows[0].count} (100% PRESERVED)`);
  console.log(`✔ Facility Audit Logs:                  ${totalFacAuditRes.rows[0].count} (100% PRESERVED)`);
  console.log(`✔ Legitimate Operational Reports:       ${Number(totalIncRes.rows[0].count) - dummyIncidentIds.length} (PRESERVED)`);
  console.log(`✔ Legitimate Operational Personas:      ${Number(totalUsersRes.rows[0].count) - dummyUserIds.length} (PRESERVED)\n`);

  if (!isApply) {
    console.log("--------------------------------------------------------------------------------");
    console.log("ℹ️  Dry-run complete. No records were deleted.");
    console.log("   To execute safe cleanup, run: pnpm exec tsx scripts/cleanup-staging-dummy-data.ts --apply");
    console.log("--------------------------------------------------------------------------------\n");
    return;
  }

  // EXECUTE TRANSACTIONAL CLEANUP
  console.log("Executing transactional cleanup on isolated staging database...");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    if (dummyIncidentIds.length > 0) {
      await client.query("DELETE FROM report_milestones WHERE report_id = ANY($1::text[])", [dummyIncidentIds]);
      await client.query("DELETE FROM report_completion_approval_history WHERE report_id = ANY($1::text[])", [dummyIncidentIds]);
      await client.query("DELETE FROM report_completion_approvals WHERE report_id = ANY($1::text[])", [dummyIncidentIds]);
      await client.query("DELETE FROM report_progress_photos WHERE report_id = ANY($1::text[])", [dummyIncidentIds]);
      await client.query("DELETE FROM report_progress_updates WHERE report_id = ANY($1::text[])", [dummyIncidentIds]);
      await client.query("DELETE FROM report_estimation_routes WHERE report_id = ANY($1::text[])", [dummyIncidentIds]);
      await client.query("DELETE FROM report_distributions WHERE report_id = ANY($1::text[])", [dummyIncidentIds]);
      await client.query("DELETE FROM incident_pic_history WHERE incident_id = ANY($1::text[])", [dummyIncidentIds]);
      await client.query("DELETE FROM incidents WHERE id = ANY($1::text[])", [dummyIncidentIds]);
    }

    if (dummyNotifIds.length > 0) {
      await client.query("DELETE FROM notification_logs WHERE id = ANY($1::text[])", [dummyNotifIds]);
    }

    if (dummyPushDelIds.length > 0) {
      await client.query("DELETE FROM push_event_deliveries WHERE id = ANY($1::text[])", [dummyPushDelIds]);
    }

    if (dummyUserIds.length > 0) {
      await client.query("DELETE FROM user_push_subscriptions WHERE user_id = ANY($1::text[])", [dummyUserIds]);
      await client.query("DELETE FROM user_sessions WHERE user_id = ANY($1::text[])", [dummyUserIds]);
      await client.query("DELETE FROM users WHERE id = ANY($1::text[])", [dummyUserIds]);
    }

    await client.query("COMMIT");
    console.log("✔ Transaction successfully committed!\n");

    // Post-cleanup verification
    const postInc = await client.query("SELECT count(*)::int as count FROM incidents");
    const postNotif = await client.query("SELECT count(*)::int as count FROM notification_logs");
    const postPushDel = await client.query("SELECT count(*)::int as count FROM push_event_deliveries");
    const postUsers = await client.query("SELECT count(*)::int as count FROM users");

    console.log("================================================================================");
    console.log(" CLEANUP COMPLETION SUMMARY (BEFORE vs AFTER)");
    console.log("================================================================================");
    console.log(`• Incidents:         ${totalIncRes.rows[0].count} -> ${postInc.rows[0].count} (-${dummyIncidentIds.length} test records removed)`);
    console.log(`• Notifications:     ${totalNotifRes.rows[0].count} -> ${postNotif.rows[0].count} (-${dummyNotifIds.length} test logs removed)`);
    console.log(`• Push Deliveries:   ${totalPushDelRes.rows[0].count} -> ${postPushDel.rows[0].count} (-${dummyPushDelIds.length} test deliveries removed)`);
    console.log(`• Users:             ${totalUsersRes.rows[0].count} -> ${postUsers.rows[0].count} (-${dummyUserIds.length} test accounts removed)`);
    console.log(`• Stores Master:     ${totalStoresRes.rows[0].count} (Unchanged, 100% Intact)`);
    console.log(`• Facilities Master: ${totalFacilitiesRes.rows[0].count} (Unchanged, 100% Intact)`);
    console.log(`• Migrations Ledger: ${totalMigrationsRes.rows[0].count} (Unchanged, 100% Intact)`);
    console.log("================================================================================\n");

  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Cleanup error, transaction rolled back:", err);
    throw err;
  } finally {
    client.release();
  }
}

if (process.argv[1]?.endsWith("cleanup-staging-dummy-data.ts")) {
  runStagingCleanup()
    .then(async () => {
      await closeDbPool();
      process.exit(0);
    })
    .catch(async (e) => {
      console.error("Fatal error during cleanup:", e);
      await closeDbPool();
      process.exit(1);
    });
}
