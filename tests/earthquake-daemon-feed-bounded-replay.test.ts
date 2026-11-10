import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { getOperationalDbPool, isProductionDatabaseTarget } from "../lib/db";
import { fetchDisasterFeed } from "../lib/disaster-service";
import { processEarthquakeAlertsAndReports } from "../lib/server-daemon";
import { isUatSimulationAllowed } from "../lib/environment-policy";
import { Store } from "../types/store";

test("Bounded Isolated Replay through Feed-Ingestion and Daemon Entry Points: us1000g3ub (Lombok 2018)", async () => {
  const pool = getOperationalDbPool();

  // --------------------------------------------------------------------------
  // STEP 1: VERIFY DATABASE TARGET & ISOLATION
  // --------------------------------------------------------------------------
  const dbRes = await pool.query("SELECT current_database() as db_name, current_user as db_user");
  const dbName = dbRes.rows[0].db_name;
  const isProd = isProductionDatabaseTarget(process.env.DATABASE_URL || "");
  console.log(`[Step 1] Database Target Check: ${dbName} (isProduction: ${isProd})`);
  assert.equal(dbName, "sparta_siaga_isolated", "Must connect strictly to sparta_siaga_isolated");
  assert.equal(isProd, false, "Must never target production database");

  // Verify previous event usgs-us7000ir9t is intact and not modified
  const prevReportsRes = await pool.query(
    "SELECT count(*)::int as cnt FROM incidents WHERE canonical_event_id = 'usgs-us7000ir9t'"
  );
  const prevCount = prevReportsRes.rows[0].cnt;
  console.log(`         Preserved previous Cianjur reports count: ${prevCount}`);
  assert.equal(prevCount, 4, "Previously finalized Cianjur event must retain its 4 reports untouched");

  // --------------------------------------------------------------------------
  // STEP 2: SETUP LOCAL FEED SERVER FOR AUTHENTIC USGS GEOJSON
  // --------------------------------------------------------------------------
  // Authentic USGS Event: us1000g3ub (2018 Lombok Earthquake, M 6.9, depth 34 km)
  // Preserving original agency provenance with UAT replay context
  const eventTime = 1533469598630; // 2018-08-05T11:46:38.630Z
  const replayGeoJson = {
    type: "FeatureCollection",
    metadata: {
      generated: Date.now(),
      url: "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_week.geojson",
      title: "USGS Magnitude 4.5+ Earthquakes (UAT Replay)",
      status: 200,
      api: "1.10.3",
      count: 1,
    },
    features: [
      {
        type: "Feature",
        properties: {
          mag: 6.9,
          place: "36 km NW of Labuan Lombok, Indonesia [UAT Replay]",
          time: eventTime,
          updated: 1594396253000,
          tz: null,
          url: "https://earthquake.usgs.gov/earthquakes/eventpage/us1000g3ub",
          detail: "https://earthquake.usgs.gov/fdsnws/event/1/query?eventid=us1000g3ub&format=geojson",
          felt: 802,
          cdi: 9.0,
          mmi: 8.052,
          alert: "orange",
          status: "reviewed",
          tsunami: 0,
          sig: 1722,
          net: "us",
          code: "1000g3ub",
          ids: ",us1000g3ub,",
          sources: ",us,",
          types: ",dyfi,ground-failure,impact-text,losspager,moment-tensor,origin,phase-data,shakemap,",
          nst: null,
          dmin: 2.271,
          rms: 1.05,
          gap: 15,
          magType: "mww",
          type: "earthquake",
          title: "M 6.9 - 36 km NW of Labuan Lombok, Indonesia [UAT Replay]",
        },
        geometry: {
          type: "Point",
          coordinates: [116.4375, -8.2581, 34.0],
        },
        id: "us1000g3ub",
      },
    ],
  };

  const feedServer = http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(replayGeoJson));
  });

  await new Promise<void>((resolve) => feedServer.listen(0, "127.0.0.1", () => resolve()));
  const address = feedServer.address();
  const port = typeof address === "object" && address ? address.port : 0;
  assert.ok(port > 0, "Feed server must bind to ephemeral port");
  const feedUrl = `http://127.0.0.1:${port}/summary/4.5_week.geojson`;

  const originalFeedUrl = process.env.USGS_EARTHQUAKE_FEED_URL;
  process.env.USGS_EARTHQUAKE_FEED_URL = feedUrl;

  console.log(`\n[Step 2] Ephemeral Feed Replay Server started: ${feedUrl}`);
  console.log(`         Substituted Dependency: process.env.USGS_EARTHQUAKE_FEED_URL -> ${feedUrl}`);

  // --------------------------------------------------------------------------
  // STEP 3: EXERCISE ACTUAL FEED INGESTION ENTRY POINT: fetchDisasterFeed(true)
  // --------------------------------------------------------------------------
  console.log(`\n[Step 3] Exercising Feed Ingestion Entry Point: fetchDisasterFeed(true)...`);
  // Controlled time for freshness check: 2 minutes after event occurrence
  const controlledReplayNow = eventTime + 2 * 60_000;
  const originalDateNow = Date.now;
  Date.now = () => controlledReplayNow;

  let disasterFeed;
  try {
    disasterFeed = await fetchDisasterFeed(true);
  } finally {
    Date.now = originalDateNow;
  }

  assert.ok(disasterFeed, "Must return DisasterFeedResponse");
  console.log(`         Feed Ingestion Status: Freshness = ${disasterFeed.dataFreshness}`);
  console.log(`         Active Earthquakes parsed: ${disasterFeed.activeEarthquakes?.length ?? 0}`);

  const ingestedEq = disasterFeed.activeEarthquakes?.find((e) => e.id === "usgs-us1000g3ub");
  assert.ok(ingestedEq, "usgs-us1000g3ub must be ingested through the actual feed parser");
  console.log(`         Ingested Canonical Event: ID=${ingestedEq.id}, M=${ingestedEq.magnitude}, Depth=${ingestedEq.depthKm} km`);
  console.log(`         Sparta Priority Radius: ${ingestedEq.priorityRadiusKm} km, Monitoring: ${ingestedEq.monitoringRadiusKm} km`);
  assert.equal(ingestedEq.source, "USGS");
  assert.equal(ingestedEq.magnitude, 6.9);
  assert.equal(ingestedEq.depthKm, 34);

  // --------------------------------------------------------------------------
  // STEP 4: PREPARE BOUNDED STORES COHORT (READ-ONLY)
  // --------------------------------------------------------------------------
  // Select bounded cohort of 15 real master stores from Cabang LOMBOK
  const boundedStoresRes = await pool.query<Store>(
    `SELECT kode_toko, nama_toko, cabang,
            latitude::float as latitude, longitude::float as longitude,
            alamat, fr_type
       FROM stores
      WHERE cabang = 'LOMBOK'
        AND latitude IS NOT NULL
        AND longitude IS NOT NULL
      ORDER BY kode_toko ASC
      LIMIT 15`
  );
  const boundedStores = boundedStoresRes.rows;
  assert.equal(boundedStores.length, 15, "Must select exactly 15 master stores from LOMBOK branch");
  console.log(`\n[Step 4] Bounded Stores Cohort Selected (Read-Only): 15 stores from Cabang LOMBOK`);
  console.log(`         Substituted Dependency: Entire 21,550 master dataset -> Bounded 15-store cohort`);

  // Clean up any existing records for this specific replay event ID to ensure clean isolation
  const cleanClient = await pool.connect();
  try {
    await cleanClient.query("BEGIN");
    await cleanClient.query("DELETE FROM incidents WHERE canonical_event_id = $1", [ingestedEq.id]);
    await cleanClient.query("DELETE FROM notification_logs WHERE canonical_event_id = $1", [ingestedEq.id]);
    await cleanClient.query("DELETE FROM earthquake_facility_intensities WHERE canonical_event_id = $1", [ingestedEq.id]);
    await cleanClient.query("DELETE FROM earthquake_shakemaps WHERE canonical_event_id = $1", [ingestedEq.id]);
    await cleanClient.query("DELETE FROM earthquake_events WHERE id = $1", [ingestedEq.id]);
    await cleanClient.query("COMMIT");
  } catch (cleanErr) {
    await cleanClient.query("ROLLBACK");
    throw cleanErr;
  } finally {
    cleanClient.release();
  }

  // --------------------------------------------------------------------------
  // STEP 5: EXERCISE ACTUAL DAEMON ENTRY POINT: processEarthquakeAlertsAndReports
  // --------------------------------------------------------------------------
  console.log(`\n[Step 5] Exercising Daemon Worker Entry Point: processEarthquakeAlertsAndReports...`);
  Date.now = () => controlledReplayNow;

  let daemonResult;
  try {
    const allowSimulation = isUatSimulationAllowed();
    daemonResult = await processEarthquakeAlertsAndReports(
      [ingestedEq],
      boundedStores,
      true, // isEligibleForAlert
      true, // allowBackfill
      allowSimulation
    );
  } finally {
    Date.now = originalDateNow;
    if (originalFeedUrl !== undefined) process.env.USGS_EARTHQUAKE_FEED_URL = originalFeedUrl;
    else delete process.env.USGS_EARTHQUAKE_FEED_URL;
    feedServer.close();
  }

  console.log(`         Daemon Execution Completed:`);
  console.log(`         Dispatched Branch Alerts: ${daemonResult.dispatchedAlerts}`);
  console.log(`         Created Inspection Reports: ${daemonResult.createdReports}`);

  assert.equal(daemonResult.dispatchedAlerts, 1, "Must dispatch 1 branch notification for LOMBOK");
  assert.ok(daemonResult.createdReports > 0, "Must create inspection reports for qualifying stores");

  // --------------------------------------------------------------------------
  // STEP 6: VERIFY PERSISTED RECORDS & ATTRIBUTES IN sparta_siaga_isolated
  // --------------------------------------------------------------------------
  console.log(`\n[Step 6] Inspecting Persisted Database Records in sparta_siaga_isolated...`);

  // 1. ShakeMap product provenance
  const shakemapRes = await pool.query(
    "SELECT id, source_provider, version_number, max_mmi, raw_payload->'spartaProvenance' as provenance FROM earthquake_shakemaps WHERE canonical_event_id = $1",
    [ingestedEq.id]
  );
  assert.equal(shakemapRes.rows.length, 1, "Must have exactly 1 ShakeMap record");
  const sm = shakemapRes.rows[0];
  console.log(`         ShakeMap ID: ${sm.id}`);
  console.log(`         Provider: ${sm.source_provider}, Version: ${sm.version_number}, Max MMI: ${sm.max_mmi}`);
  console.log(`         Provenance Source URL: ${sm.provenance?.sourceUrl}`);
  assert.equal(sm.source_provider, "USGS");
  assert.ok(sm.provenance?.sourceUrl?.includes("earthquake.usgs.gov"));

  // 2. Notification logs
  const notifRes = await pool.query(
    "SELECT ticket_number, branch, channel, recipient_group, title, affected_stores_count FROM notification_logs WHERE canonical_event_id = $1",
    [ingestedEq.id]
  );
  assert.equal(notifRes.rows.length, 1, "Must have exactly 1 notification log");
  const notif = notifRes.rows[0];
  console.log(`         Notification Ticket: ${notif.ticket_number}`);
  console.log(`         Branch: ${notif.branch}, Channel: ${notif.channel}, Affected Stores: ${notif.affected_stores_count}`);
  assert.equal(notif.branch, "LOMBOK");
  assert.equal(notif.channel, "pwa_only");
  assert.equal(notif.affected_stores_count, daemonResult.createdReports);

  // 3. Incidents / inspection reports
  const incidentsRes = await pool.query(
    "SELECT id, store_id, store_name, branch, status, report_origin FROM incidents WHERE canonical_event_id = $1 ORDER BY store_id ASC",
    [ingestedEq.id]
  );
  console.log(`         Total Incidents Created: ${incidentsRes.rows.length}`);
  assert.equal(incidentsRes.rows.length, daemonResult.createdReports);
  for (const inc of incidentsRes.rows) {
    assert.equal(inc.branch, "LOMBOK");
    assert.equal(inc.report_origin, "automatic_earthquake");
    assert.equal(inc.status, "pending_confirmation");
  }

  // 4. Verify previous Cianjur event usgs-us7000ir9t was NOT modified
  const postCheckPrevRes = await pool.query(
    "SELECT count(*)::int as cnt FROM incidents WHERE canonical_event_id = 'usgs-us7000ir9t'"
  );
  assert.equal(postCheckPrevRes.rows[0].cnt, prevCount, "Previous event reports must remain completely untouched");
  console.log(`         Verified: usgs-us7000ir9t remains intact with ${postCheckPrevRes.rows[0].cnt} reports.`);

  // --------------------------------------------------------------------------
  // STEP 7: PRINT COMPACT STORE-ASSESSMENT TABLE
  // --------------------------------------------------------------------------
  const allStoredIntensities = await pool.query<{
    facility_code: string;
    facility_name: string;
    branch: string;
    distance_km: number;
    mmi_raw: number | null;
    decision_policy: string;
  }>(
    `SELECT facility_code, facility_name, branch, distance_km, mmi_raw, decision_policy
       FROM earthquake_facility_intensities
      WHERE canonical_event_id = $1
      ORDER BY distance_km ASC`,
    [ingestedEq.id]
  );

  console.log(`\n========================================================================================================================`);
  console.log(` COMPACT STORE-ASSESSMENT TABLE: USGS us1000g3ub (M 6.9, Depth 34 km, V1 Radius 160 km)`);
  console.log(`========================================================================================================================`);
  console.log(
    `| Store Code | Store Name                     | Branch  | Dist (km) | V1 Cover | MMI (Source)  | Basis        | Qualifies? |`
  );
  console.log(
    `|------------|--------------------------------|---------|-----------|----------|---------------|--------------|------------|`
  );

  for (const st of allStoredIntensities.rows) {
    const code = st.facility_code.padEnd(10);
    const name = st.facility_name.slice(0, 30).padEnd(30);
    const branch = st.branch.padEnd(7);
    const dist = st.distance_km.toFixed(1).padStart(7) + " km";
    const isInsideV1 = st.distance_km <= 160;
    const v1Cov = (isInsideV1 ? "INSIDE" : "OUTSIDE").padEnd(8);
    const mmiStr = (st.mmi_raw !== null ? `${st.mmi_raw.toFixed(2)} (USGS)` : "UNKNOWN").padEnd(13);
    const basis = (st.mmi_raw !== null ? "MMI" : "V1_FALLBACK").padEnd(12);
    const qual = st.decision_policy === "CANDIDATE_AUTO_REPORT" ? "YES (AUTO)" : "NO";

    console.log(`| ${code} | ${name} | ${branch} | ${dist} | ${v1Cov} | ${mmiStr} | ${basis} | ${qual.padEnd(10)} |`);
  }
  console.log(`========================================================================================================================\n`);
});

