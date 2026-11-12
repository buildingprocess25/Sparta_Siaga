import test from "node:test";
import assert from "node:assert/strict";
import { getOperationalDbPool, isProductionDatabaseTarget } from "../lib/db";
import { Earthquake } from "../types/disaster";
import { Store } from "../types/store";
import { dbUpsertEarthquakeEvent, dbGetEarthquakeEventById } from "../lib/earthquake-db";
import {
  executeEarthquakeV1MmiWorkflow,
  resetWorkflowMemoryState,
} from "../lib/earthquake-v1-mmi-service";

test("Traceable Official Earthquake Flow: us7000ir9t (Cianjur 2022)", async () => {
  resetWorkflowMemoryState();
  const pool = getOperationalDbPool();

  // --------------------------------------------------------------------------
  // STEP 1: VERIFY DATABASE TARGET & IDENTITY
  // --------------------------------------------------------------------------
  const dbIdentityRes = await pool.query(
    "SELECT current_database() as db_name, current_user as db_user, version() as db_ver"
  );
  const dbName = dbIdentityRes.rows[0].db_name;
  const dbUser = dbIdentityRes.rows[0].db_user;
  const isProd = isProductionDatabaseTarget(process.env.DATABASE_URL || "");

  console.log(`[Step 1] Database Target Check:`);
  console.log(`         Database Name: ${dbName}`);
  console.log(`         Database User: ${dbUser}`);
  console.log(`         Is Production Target: ${isProd}`);

  assert.equal(dbName, "sparta_siaga_isolated", "Must connect strictly to sparta_siaga_isolated");
  assert.equal(isProd, false, "Must never target production database");

  // --------------------------------------------------------------------------
  // STEP 2: SELECT TRACEABLE OFFICIAL EARTHQUAKE
  // --------------------------------------------------------------------------
  // Official USGS Earthquake: us7000ir9t (2022 Cianjur, West Java Earthquake)
  // Preserving original provider identity, timestamps, coordinates, and depth
  const officialEarthquake: Earthquake = {
    id: "usgs-us7000ir9t",
    source: "USGS",
    sourcePrimary: "USGS",
    magnitude: 5.6,
    depth: "10 km",
    depthKm: 10,
    latitude: -6.836,
    longitude: 106.9968,
    time: "2022-11-21T06:21:07.066Z",
    timestamp: new Date("2022-11-21T06:21:07.066Z").getTime(),
    title: "M 5.6 - 11 km NE of Sukabumi, Indonesia",
    potensiTsunami: false,
    priorityRadiusKm: 50,
    monitoringRadiusKm: 110,
  };

  console.log(`\n[Step 2] Official Earthquake Selected:`);
  console.log(`         Canonical Event ID: ${officialEarthquake.id}`);
  console.log(`         Provider: ${officialEarthquake.source}`);
  console.log(`         Magnitude: M ${officialEarthquake.magnitude}`);
  console.log(`         Depth: ${officialEarthquake.depthKm} km (Group: 0–10 km)`);
  console.log(`         Epicenter: ${officialEarthquake.latitude}, ${officialEarthquake.longitude}`);
  console.log(`         Occurred At: ${officialEarthquake.time}`);

  // --------------------------------------------------------------------------
  // STEP 3: READ-ONLY SELECTION OF REPRESENTATIVE MASTER STORES
  // --------------------------------------------------------------------------
  // Select 15 real master stores from CIANJUR branch and neighboring areas
  const storeQuery = await pool.query<Store>(
    `SELECT kode_toko, nama_toko, cabang,
            latitude::float as latitude, longitude::float as longitude,
            alamat, fr_type
       FROM stores
      WHERE cabang = 'CIANJUR'
        AND latitude IS NOT NULL
        AND longitude IS NOT NULL
      ORDER BY kode_toko ASC
      LIMIT 15`
  );

  const candidateStores = storeQuery.rows;
  assert.ok(candidateStores.length >= 10, "Must load at least 10 master stores from CIANJUR branch");
  console.log(`\n[Step 3] Master Stores Selected (Read-Only): ${candidateStores.length} stores from CIANJUR`);

  // --------------------------------------------------------------------------
  // STEP 4: CLEAN UP PREVIOUS TEST RUN FOR THIS EXACT EVENT ID (ISOLATION)
  // --------------------------------------------------------------------------
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("DELETE FROM incidents WHERE canonical_event_id = $1", [officialEarthquake.id]);
    await client.query("DELETE FROM notification_logs WHERE canonical_event_id = $1", [officialEarthquake.id]);
    await client.query("DELETE FROM earthquake_facility_intensities WHERE canonical_event_id = $1", [officialEarthquake.id]);
    await client.query("DELETE FROM earthquake_shakemaps WHERE canonical_event_id = $1", [officialEarthquake.id]);
    await client.query("DELETE FROM earthquake_events WHERE id = $1", [officialEarthquake.id]);
    await client.query("COMMIT");
  } catch (cleanErr) {
    await client.query("ROLLBACK");
    throw cleanErr;
  } finally {
    client.release();
  }

  // --------------------------------------------------------------------------
  // STEP 5: EXERCISE ACTUAL INGESTION PATH
  // --------------------------------------------------------------------------
  console.log(`\n[Step 4] Ingesting Official Earthquake via dbUpsertEarthquakeEvent...`);
  await dbUpsertEarthquakeEvent(officialEarthquake);

  const ingestedEvent = await dbGetEarthquakeEventById(officialEarthquake.id);
  assert.ok(ingestedEvent, "Event record must exist in earthquake_events table");
  assert.equal(ingestedEvent.source_primary, "USGS");
  assert.equal(ingestedEvent.magnitude, 5.6);
  assert.equal(ingestedEvent.depth_km, 10);
  console.log(`         Ingested into earthquake_events successfully: ID=${ingestedEvent.id}`);

  // Controlled time: 2 minutes after event occurrence
  const testControlledTime = new Date("2022-11-21T06:23:07.066Z");

  console.log(`\n[Step 5] Orchestrating V1 + MMI Workflow Execution...`);
  const executionResult = await executeEarthquakeV1MmiWorkflow({
    earthquake: officialEarthquake,
    stores: candidateStores,
    currentTime: testControlledTime,
    windowStartedAt: testControlledTime,
  });

  const evalRes = executionResult.evaluation;
  console.log(`         Applied Rule: ${evalRes.ruleApplied}`);
  console.log(`         Can Finalize Decision: ${evalRes.canFinalizeDecision}`);
  console.log(`         V1 Distance: ${evalRes.v1Coverage.v1DistanceKm} km`);
  console.log(`         Stores In V1: ${evalRes.storesInV1Count}`);
  console.log(`         Stores With Official MMI: ${evalRes.coveredV1StoresCount}`);
  console.log(`         Qualifying Stores Count: ${evalRes.qualifyingStoresCount}`);
  console.log(`         Dispatched Branch Notifications: ${executionResult.dispatchedBranchNotifications}`);
  console.log(`         Created Inspection Reports: ${executionResult.createdInspectionReports}`);
  console.log(`         Created Report IDs: ${executionResult.createdReportIds.join(", ")}`);

  assert.equal(evalRes.ruleApplied, "RULE_A_IMMEDIATE_FULL_MMI", "Should apply Rule A (full MMI coverage)");
  assert.equal(evalRes.canFinalizeDecision, true, "Decision should be finalized");
  assert.equal(executionResult.dispatchedBranchNotifications, 1, "Exactly 1 branch notification for CIANJUR");
  assert.ok(executionResult.createdInspectionReports > 0, "Must create reports for qualifying stores");

  // --------------------------------------------------------------------------
  // STEP 6: VERIFY DATABASE PERSISTENCE & PRODUCT PROVENANCE
  // --------------------------------------------------------------------------
  console.log(`\n[Step 6] Verifying Database Records in sparta_siaga_isolated...`);

  // A. ShakeMap table
  const shakemapRows = await pool.query(
    "SELECT id, source_provider, version_number, max_mmi, raw_payload->'spartaProvenance' as provenance FROM earthquake_shakemaps WHERE canonical_event_id = $1",
    [officialEarthquake.id]
  );
  assert.equal(shakemapRows.rows.length, 1, "Must have exactly 1 ShakeMap record");
  const sm = shakemapRows.rows[0];
  console.log(`         ShakeMap ID: ${sm.id}`);
  console.log(`         Source Provider: ${sm.source_provider}`);
  console.log(`         Version Number: ${sm.version_number}`);
  console.log(`         Max MMI: ${sm.max_mmi}`);
  console.log(`         Provenance Source URL: ${sm.provenance?.sourceUrl}`);
  assert.equal(sm.source_provider, "USGS");
  assert.ok(sm.provenance?.sourceUrl?.includes("earthquake.usgs.gov"));

  // B. Facility Intensities table
  const intensityRows = await pool.query(
    "SELECT facility_id, facility_name, distance_km, mmi_raw, mmi_roman, decision_policy FROM earthquake_facility_intensities WHERE canonical_event_id = $1 ORDER BY distance_km ASC",
    [officialEarthquake.id]
  );
  console.log(`         Facility Intensities Recorded: ${intensityRows.rows.length}`);
  assert.equal(intensityRows.rows.length, candidateStores.length, "All stores must have audit intensity records");

  // C. Incidents / Inspection Reports table
  const incidentRows = await pool.query(
    "SELECT id, store_id, store_name, branch, status, report_origin FROM incidents WHERE canonical_event_id = $1 ORDER BY store_id ASC",
    [officialEarthquake.id]
  );
  console.log(`         Incident Reports Created: ${incidentRows.rows.length}`);
  assert.equal(incidentRows.rows.length, executionResult.createdInspectionReports);
  for (const inc of incidentRows.rows) {
    assert.equal(inc.branch, "CIANJUR");
    assert.equal(inc.report_origin, "automatic_earthquake");
    assert.equal(inc.status, "pending_confirmation");
  }

  // D. Notification Logs table
  const notifRows = await pool.query(
    "SELECT id, ticket_number, branch, disaster_type, channel, recipient_group, title, affected_stores_count, affected_stores_sample FROM notification_logs WHERE canonical_event_id = $1",
    [officialEarthquake.id]
  );
  assert.equal(notifRows.rows.length, 1, "Must have 1 notification log");
  const notif = notifRows.rows[0];
  console.log(`         Notification Ticket: ${notif.ticket_number}`);
  console.log(`         Branch: ${notif.branch}`);
  console.log(`         Channel: ${notif.channel}`);
  console.log(`         Title: ${notif.title}`);
  assert.equal(notif.branch, "CIANJUR");
  assert.equal(notif.disaster_type, "earthquake");

  // --------------------------------------------------------------------------
  // STEP 7: DEDUPLICATION & IDEMPOTENCY CHECK
  // --------------------------------------------------------------------------
  console.log(`\n[Step 7] Checking Workflow Idempotency & Duplicate Suppression...`);
  const rerunResult = await executeEarthquakeV1MmiWorkflow({
    earthquake: officialEarthquake,
    stores: candidateStores,
    currentTime: new Date("2022-11-21T06:25:00.000Z"),
    windowStartedAt: testControlledTime,
  });

  console.log(`         Is Duplicate Suppressed: ${rerunResult.isDuplicateSuppressed}`);
  console.log(`         Dispatched Branch Notifications on Rerun: ${rerunResult.dispatchedBranchNotifications}`);
  console.log(`         Created Inspection Reports on Rerun: ${rerunResult.createdInspectionReports}`);
  assert.equal(rerunResult.isDuplicateSuppressed, true, "Rerun must be suppressed as duplicate");
  assert.equal(rerunResult.dispatchedBranchNotifications, 0, "Must not create duplicate branch notification");
  assert.equal(rerunResult.createdInspectionReports, 0, "Must not create duplicate inspection reports");

  // --------------------------------------------------------------------------
  // STEP 8: COMPACT STORE ASSESSMENT SUMMARY TABLE
  // --------------------------------------------------------------------------
  const allStoredIntensities = await pool.query<{
    facility_code: string;
    facility_name: string;
    branch: string;
    distance_km: number;
    mmi_raw: number | null;
    decision_policy: string;
    discrepancy_vs_radius: string;
  }>(
    `SELECT facility_code, facility_name, branch, distance_km, mmi_raw,
            decision_policy, discrepancy_vs_radius
       FROM earthquake_facility_intensities
      WHERE canonical_event_id = $1
      ORDER BY distance_km ASC`,
    [officialEarthquake.id]
  );

  console.log(`\n========================================================================================================================`);
  console.log(` COMPACT STORE-ASSESSMENT TABLE: USGS us7000ir9t (M 5.6, Depth 10 km, V1 Radius 50 km)`);
  console.log(`========================================================================================================================`);
  console.log(
    `| Store Code | Store Name                     | Branch  | Dist (km) | V1 Cover | MMI (Source)  | Basis        | Qualifies? |`
  );
  console.log(
    `|------------|--------------------------------|---------|-----------|----------|---------------|--------------|------------|`
  );

  const v1RadiusKm = evalRes.v1Coverage.v1DistanceKm || 50;
  for (const st of allStoredIntensities.rows) {
    const code = st.facility_code.padEnd(10);
    const name = st.facility_name.slice(0, 30).padEnd(30);
    const branch = st.branch.padEnd(7);
    const dist = st.distance_km.toFixed(1).padStart(7) + " km";
    const isInsideV1 = st.distance_km <= v1RadiusKm;
    const v1Cov = (isInsideV1 ? "INSIDE" : "OUTSIDE").padEnd(8);
    const mmiStr = (st.mmi_raw !== null ? `${st.mmi_raw.toFixed(2)} (USGS)` : "UNKNOWN").padEnd(13);
    const basis = (st.mmi_raw !== null ? "MMI" : "V1_FALLBACK").padEnd(12);
    const qual = st.decision_policy === "CANDIDATE_AUTO_REPORT" ? "YES (AUTO)" : "NO";

    console.log(`| ${code} | ${name} | ${branch} | ${dist} | ${v1Cov} | ${mmiStr} | ${basis} | ${qual.padEnd(10)} |`);
  }
  console.log(`========================================================================================================================\n`);
});
