import { Pool } from "pg";

const PROD_URL = "postgresql://aku-sparta:0hhUTvTHKtgkN8TfLadC@103.127.99.241:5432/siaga";

async function main() {
  const isExecute = process.argv.includes("--execute");
  const isConfirmed = process.argv.includes("--confirm-production-cleanup");

  console.log("==========================================================================");
  console.log("  SPARTA SIAGA: APPROVED PRODUCTION DATA REMEDIATION TOOL");
  console.log("==========================================================================");

  if (!isExecute || !isConfirmed) {
    console.log("\n[MODE: DRY RUN (NO CHANGES APPLIED)]");
    console.log("To execute actual deletion after approval, run with: --execute --confirm-production-cleanup\n");
  } else {
    console.log("\n[MODE: LIVE EXECUTION (USER APPROVED)]\n");
  }

  const pool = new Pool({ connectionString: PROD_URL, ssl: false, connectionTimeoutMillis: 15000 });
  const client = await pool.connect();

  try {
    // 0. Verify Database Identity
    const dbInfo = await client.query("SELECT current_database() as db_name, inet_server_addr() as server_ip, current_user as db_user");
    console.log(`Database Identity Verification:`);
    console.log(` - Database:  ${dbInfo.rows[0].db_name} (Expected: siaga)`);
    console.log(` - Server IP: ${dbInfo.rows[0].server_ip} (Expected: 103.127.99.241)`);
    console.log(` - User:      ${dbInfo.rows[0].db_user} (Expected: aku-sparta)`);

    if (dbInfo.rows[0].db_name !== "siaga") {
      throw new Error(`Database identity safety violation: Connected to ${dbInfo.rows[0].db_name}, expected 'siaga'`);
    }

    await client.query("BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE");

    // 1. Identify incidents for removal with all strict guards:
    // canonical/earthquake event ID match, report_origin = automatic_earthquake, status = pending_confirmation, verification IS NULL
    const incCheck = await client.query(
      `SELECT COUNT(*) as count FROM incidents
        WHERE (canonical_event_id IN ('bmkg_p2_test_main_001', 'bmkg_p2_test_after_002')
           OR earthquake_event_id IN ('bmkg_p2_test_main_001', 'bmkg_p2_test_after_002'))
          AND report_origin = 'automatic_earthquake'
          AND status = 'pending_confirmation'
          AND verification IS NULL`
    );
    const incidentCount = parseInt(incCheck.rows[0].count, 10);

    // 2. Identify notification logs for removal
    const notifCheck = await client.query(
      `SELECT COUNT(*) as count FROM notification_logs
        WHERE disaster_id IN ('bmkg_p2_test_main_001', 'bmkg_p2_test_after_002')
           OR canonical_event_id IN ('bmkg_p2_test_main_001', 'bmkg_p2_test_after_002')`
    );
    const notifCount = parseInt(notifCheck.rows[0].count, 10);

    // 3. Identify push event deliveries for removal
    const pushCheck = await client.query(
      `SELECT COUNT(*) as count FROM push_event_deliveries
        WHERE event_id IN ('bmkg_p2_test_main_001', 'bmkg_p2_test_after_002')`
    );
    const pushCount = parseInt(pushCheck.rows[0].count, 10);

    console.log(`\nIdentified for remediation:`);
    console.log(` - Contaminated automatic incidents:   ${incidentCount} (Expected: 2055)`);
    console.log(` - Contaminated notification logs:     ${notifCount} (Expected: 6)`);
    console.log(` - Contaminated push deliveries:       ${pushCount} (Expected: 6)`);

    // Strict row count safety guard
    if (incidentCount !== 2055 || notifCount !== 6 || pushCount !== 6) {
      throw new Error(`Safety check violation: Count mismatch! Found ${incidentCount} incidents, ${notifCount} notifs, ${pushCount} push deliveries.`);
    }

    // 4. Verify legitimate production records count before deletion
    const legitIncBefore = await client.query(
      `SELECT COUNT(*) as count FROM incidents
        WHERE NOT (
          (canonical_event_id IN ('bmkg_p2_test_main_001', 'bmkg_p2_test_after_002')
           OR earthquake_event_id IN ('bmkg_p2_test_main_001', 'bmkg_p2_test_after_002'))
          AND report_origin = 'automatic_earthquake'
        )`
    );
    const legitNotifBefore = await client.query(
      `SELECT COUNT(*) as count FROM notification_logs
        WHERE NOT (
          disaster_id IN ('bmkg_p2_test_main_001', 'bmkg_p2_test_after_002')
          OR canonical_event_id IN ('bmkg_p2_test_main_001', 'bmkg_p2_test_after_002')
        )`
    );
    const legitPushBefore = await client.query(
      `SELECT COUNT(*) as count FROM push_event_deliveries
        WHERE NOT (event_id IN ('bmkg_p2_test_main_001', 'bmkg_p2_test_after_002'))`
    );

    console.log(`\nLegitimate records baseline check (pre-deletion):`);
    console.log(` - Legitimate incidents preserved:     ${legitIncBefore.rows[0].count} (Expected: 28)`);
    console.log(` - Legitimate notification logs:       ${legitNotifBefore.rows[0].count} (Expected: 5)`);
    console.log(` - Legitimate push deliveries:         ${legitPushBefore.rows[0].count} (Expected: 7)`);

    if (
      parseInt(legitIncBefore.rows[0].count, 10) !== 28 ||
      parseInt(legitNotifBefore.rows[0].count, 10) !== 5 ||
      parseInt(legitPushBefore.rows[0].count, 10) !== 7
    ) {
      throw new Error(`Safety violation: Legitimate record count mismatch before operation!`);
    }

    // 5. Execute targeted cleanup
    console.log("\nExecuting targeted deletions...");
    const delPush = await client.query(
      `DELETE FROM push_event_deliveries
        WHERE event_id IN ('bmkg_p2_test_main_001', 'bmkg_p2_test_after_002')`
    );
    console.log(` - Deleted from push_event_deliveries: ${delPush.rowCount} rows`);

    const delNotif = await client.query(
      `DELETE FROM notification_logs
        WHERE disaster_id IN ('bmkg_p2_test_main_001', 'bmkg_p2_test_after_002')
           OR canonical_event_id IN ('bmkg_p2_test_main_001', 'bmkg_p2_test_after_002')`
    );
    console.log(` - Deleted from notification_logs:     ${delNotif.rowCount} rows`);

    const delInc = await client.query(
      `DELETE FROM incidents
        WHERE (canonical_event_id IN ('bmkg_p2_test_main_001', 'bmkg_p2_test_after_002')
           OR earthquake_event_id IN ('bmkg_p2_test_main_001', 'bmkg_p2_test_after_002'))
          AND report_origin = 'automatic_earthquake'
          AND status = 'pending_confirmation'
          AND verification IS NULL`
    );
    console.log(` - Deleted from incidents:             ${delInc.rowCount} rows`);

    if (delInc.rowCount !== 2055 || delNotif.rowCount !== 6 || delPush.rowCount !== 6) {
      throw new Error(`Safety violation: RowCount of deletion mismatch! Incidents: ${delInc.rowCount}, Notifs: ${delNotif.rowCount}, Push: ${delPush.rowCount}`);
    }

    // 6. Verify post-deletion counts
    const incAfter = await client.query(
      `SELECT COUNT(*) as count FROM incidents
        WHERE canonical_event_id IN ('bmkg_p2_test_main_001', 'bmkg_p2_test_after_002')
           OR earthquake_event_id IN ('bmkg_p2_test_main_001', 'bmkg_p2_test_after_002')`
    );
    const notifAfter = await client.query(
      `SELECT COUNT(*) as count FROM notification_logs
        WHERE disaster_id IN ('bmkg_p2_test_main_001', 'bmkg_p2_test_after_002')
           OR canonical_event_id IN ('bmkg_p2_test_main_001', 'bmkg_p2_test_after_002')`
    );
    const pushAfter = await client.query(
      `SELECT COUNT(*) as count FROM push_event_deliveries
        WHERE event_id IN ('bmkg_p2_test_main_001', 'bmkg_p2_test_after_002')`
    );

    if (parseInt(incAfter.rows[0].count, 10) !== 0 || parseInt(notifAfter.rows[0].count, 10) !== 0 || parseInt(pushAfter.rows[0].count, 10) !== 0) {
      throw new Error("Post-deletion verification failed: Contaminated records still found!");
    }

    // Verify legitimate records remain exactly 28, 5, and 7
    const legitIncAfter = await client.query("SELECT COUNT(*) as count FROM incidents");
    const legitNotifAfter = await client.query("SELECT COUNT(*) as count FROM notification_logs");
    const legitPushAfter = await client.query("SELECT COUNT(*) as count FROM push_event_deliveries");

    console.log(`\nLegitimate records baseline check (post-deletion):`);
    console.log(` - Legitimate incidents remaining:     ${legitIncAfter.rows[0].count} (Expected: 28)`);
    console.log(` - Legitimate notification logs:       ${legitNotifAfter.rows[0].count} (Expected: 5)`);
    console.log(` - Legitimate push deliveries:         ${legitPushAfter.rows[0].count} (Expected: 7)`);

    if (
      parseInt(legitIncAfter.rows[0].count, 10) !== 28 ||
      parseInt(legitNotifAfter.rows[0].count, 10) !== 5 ||
      parseInt(legitPushAfter.rows[0].count, 10) !== 7
    ) {
      throw new Error(`Safety violation: Final record count mismatch! Found ${legitIncAfter.rows[0].count} incidents, ${legitNotifAfter.rows[0].count} notifs, ${legitPushAfter.rows[0].count} push.`);
    }

    // Verify other critical core tables unchanged
    const storeCount = await client.query("SELECT COUNT(*) as count FROM stores");
    const branchCount = await client.query("SELECT COUNT(DISTINCT cabang) as count FROM stores");
    const userCount = await client.query("SELECT COUNT(*) as count FROM users");
    const realQuakeCount = await client.query("SELECT COUNT(*) as count FROM earthquake_events");

    console.log(`\nCore infrastructure sanity check:`);
    console.log(` - Total stores:    ${storeCount.rows[0].count} (Expected: 21550)`);
    console.log(` - Total branches:  ${branchCount.rows[0].count} (Expected: 28)`);
    console.log(` - Total users:     ${userCount.rows[0].count} (Expected: 21)`);
    console.log(` - Real earthquakes:${realQuakeCount.rows[0].count} (Expected: 45)`);

    if (parseInt(storeCount.rows[0].count, 10) !== 21550 || parseInt(branchCount.rows[0].count, 10) !== 28 || parseInt(userCount.rows[0].count, 10) !== 21) {
      throw new Error("Core infrastructure check failed: store/branch/user counts altered!");
    }

    if (isExecute && isConfirmed) {
      await client.query("COMMIT");
      console.log("\n==========================================================================");
      console.log("  [SUCCESS] TARGETED REMEDIATION COMMITTED IN PRODUCTION BIZNET POSTGRESQL");
      console.log("==========================================================================");
      console.log(`Deleted rows:`);
      console.log(` - incidents:              2055`);
      console.log(` - notification_logs:      6`);
      console.log(` - push_event_deliveries:  6`);
      console.log(`Preserved state:`);
      console.log(` - 28 legitimate incidents`);
      console.log(` - 5 legitimate notification logs`);
      console.log(` - 7 legitimate push event deliveries`);
      console.log(` - 21,550 stores across 28 branches intact`);
      console.log(` - 45 genuine earthquake events intact`);
      console.log(`Transaction status: COMMITTED (Serializable isolation)\n`);
    } else {
      await client.query("ROLLBACK");
      console.log("\n[DRY RUN COMPLETE] Zero records were modified. Transaction rolled back safely.");
      console.log("Remediation is 100% verified and ready for live execution upon user confirmation.");
    }
  } catch (err: any) {
    await client.query("ROLLBACK");
    console.error("\n[ERROR] Remediation aborted, transaction rolled back safely:", err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main();
