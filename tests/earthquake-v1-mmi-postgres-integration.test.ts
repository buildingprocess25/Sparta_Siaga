import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import path from "node:path";
import type { Pool, PoolClient } from "pg";
import { getIsolatedDbPool, closeDbPool } from "../lib/db";
import { assertIsolatedDatabase, ISOLATED_DATABASE_NAME } from "../lib/database-safety";
import {
  executeEarthquakeV1MmiWorkflow,
  resetWorkflowMemoryState,
} from "../lib/earthquake-v1-mmi-service";
import { parseShakeMapCovJson } from "../lib/earthquake-intensity-service";
import type { Store } from "../types/store";

// ============================================================================
// Child worker subprocess entry point (for real process restart verification)
// ============================================================================
if (process.env.CHILD_WORKER_MODE === "true") {
  (async () => {
    const eventId = process.env.CHILD_EVENT_ID!;
    const currentTime = new Date(process.env.CHILD_CURRENT_TIME!);
    const pool = getIsolatedDbPool();
    try {
      const store = createStoreFixture("TEST_PG_STR_S1", "CAB_S1", 0.1, 0.0);
      const res = await executeEarthquakeV1MmiWorkflow({
        earthquake: { id: eventId, magnitude: 5.4, depthKm: 20.5, latitude: 0.0, longitude: 0.0 },
        stores: [store],
        officialGrids: [],
        currentTime,
        dbPool: pool,
      });
      console.log(
        "CHILD_WORKER_RESULT:" +
          JSON.stringify({
            windowStartedAt: res.evaluation.windowStartedAt.toISOString(),
            deadlineAt: res.evaluation.deadlineAt.toISOString(),
            ruleApplied: res.evaluation.ruleApplied,
            canFinalizeDecision: res.evaluation.canFinalizeDecision,
          })
      );
    } finally {
      await closeDbPool();
      process.exit(0);
    }
  })().catch((err) => {
    console.error("CHILD_WORKER_ERROR:", err);
    process.exit(1);
  });
}

// Test fixture base timestamp: 2026-11-09 08:00:00 UTC
const T0 = new Date("2026-11-09T08:00:00.000Z");
const atMinute = (minutes: number) => new Date(T0.getTime() + minutes * 60_000);

// Helper to construct store fixtures
function createStoreFixture(code: string, branch: string, lat: number, lon: number): Store {
  return {
    id: code,
    kode_toko: code,
    nama_toko: `Toko ${code}`,
    alamat: `Alamat Toko ${code}`,
    cabang: branch,
    latitude: lat,
    longitude: lon,
    fr_type: "REGULER",
  };
}

// ShakeMap grid payload helper
function createGridPayload(mmi = 6.5) {
  return {
    domain: {
      axes: {
        x: { start: -1.0, stop: 1.0, num: 2 },
        y: { start: -1.0, stop: 1.0, num: 2 },
      },
    },
    ranges: {
      MMI: {
        values: [mmi, mmi, mmi, mmi],
        axisNames: ["y", "x"],
        shape: [2, 2],
      },
    },
  };
}

function createOfficialGrid(eventId: string, mmi = 6.5, provider: "BMKG" | "USGS" = "BMKG", version = 1) {
  return {
    provider,
    versionNumber: version,
    grid: parseShakeMapCovJson(createGridPayload(mmi), {
      eventId,
      sourceProvider: provider,
      versionNumber: version,
    }),
  };
}

// Scoped DB cleanup: strictly deletes test fixtures with prefix 'TEST_PG_EQ_%'
async function cleanupTestFixtures(clientOrPool: Pool | PoolClient) {
  await clientOrPool.query(`DELETE FROM earthquake_facility_intensities WHERE canonical_event_id LIKE 'TEST_PG_EQ_%'`);
  await clientOrPool.query(`DELETE FROM earthquake_shakemaps WHERE canonical_event_id LIKE 'TEST_PG_EQ_%'`);
  await clientOrPool.query(`DELETE FROM incidents WHERE canonical_event_id LIKE 'TEST_PG_EQ_%'`);
  await clientOrPool.query(`DELETE FROM notification_logs WHERE canonical_event_id LIKE 'TEST_PG_EQ_%'`);
  await clientOrPool.query(`DELETE FROM earthquake_events WHERE id LIKE 'TEST_PG_EQ_%'`);
}

// Insert earthquake event fixture into isolated DB
async function insertEarthquakeFixture(
  clientOrPool: Pool | PoolClient,
  eq: {
    id: string;
    magnitude: number;
    depthKm: number;
    latitude: number;
    longitude: number;
    title?: string;
    occurredAt?: Date;
    priorityRadiusKm?: number;
    monitoringRadiusKm?: number;
    rawMetadata?: any;
  }
) {
  await clientOrPool.query(
    `INSERT INTO earthquake_events (
      id, magnitude, depth_km, latitude, longitude, occurred_at, title, source_primary,
      priority_radius_km, monitoring_radius_km, first_seen_at, last_seen_at, raw_metadata
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'BMKG', $8, $9, $6, $6, $10::jsonb)
    ON CONFLICT (id) DO UPDATE SET
      magnitude = EXCLUDED.magnitude,
      depth_km = EXCLUDED.depth_km,
      latitude = EXCLUDED.latitude,
      longitude = EXCLUDED.longitude,
      priority_radius_km = EXCLUDED.priority_radius_km,
      monitoring_radius_km = EXCLUDED.monitoring_radius_km,
      raw_metadata = EXCLUDED.raw_metadata,
      last_seen_at = NOW()`,
    [
      eq.id,
      eq.magnitude,
      Math.round(eq.depthKm),
      eq.latitude,
      eq.longitude,
      eq.occurredAt || T0,
      eq.title || `Earthquake ${eq.id}`,
      eq.priorityRadiusKm ?? 50,
      eq.monitoringRadiusKm ?? 100,
      JSON.stringify(eq.rawMetadata || {}),
    ]
  );
}

// Controlled failure injector for Pool transactions
function createFailingPool(basePool: Pool, targetSqlSubstr: string) {
  let shouldFail = true;
  return {
    ...basePool,
    connect: async () => {
      const realClient = await basePool.connect();
      const origQuery = realClient.query.bind(realClient);
      realClient.query = (async (...args: any[]) => {
        const sql = typeof args[0] === "string" ? args[0] : args[0]?.text || "";
        if (shouldFail && sql.toUpperCase().includes(targetSqlSubstr.toUpperCase())) {
          shouldFail = false;
          throw new Error(`INJECTED_FAILURE_ON_${targetSqlSubstr}`);
        }
        return (origQuery as any)(...args);
      }) as any;
      return realClient;
    },
  } as unknown as Pool;
}

// Only register tests in the main test runner process
if (process.env.CHILD_WORKER_MODE !== "true") {
// Always cleanly close pool when all tests complete
test.after(async () => {
  const pool = getIsolatedDbPool();
  try {
    await cleanupTestFixtures(pool);
  } finally {
    await closeDbPool();
  }
});

test("PostgreSQL Environment Safety Check", async () => {
  const pool = getIsolatedDbPool();
  const client = await pool.connect();
  try {
    await assertIsolatedDatabase(client);
    const dbRes = await client.query("SELECT current_database() AS db_name, current_user AS db_user");
    assert.equal(dbRes.rows[0].db_name, ISOLATED_DATABASE_NAME);
  } finally {
    client.release();
  }
});

test("Scenario 1: Persistent waiting window restores on restart and ignores event updates", async () => {
  const pool = getIsolatedDbPool();
  const eventId = "TEST_PG_EQ_S1_WINDOW";
  const storeA = createStoreFixture("TEST_PG_STR_S1", "CAB_S1", 0.1, 0.0); // ~11 km

  const client = await pool.connect();
  try {
    await cleanupTestFixtures(client);

    // Initial earthquake receipt at T0 (M 5.3, depth 20.5 km -> V1 radius 50 km)
    await insertEarthquakeFixture(client, {
      id: eventId,
      magnitude: 5.3,
      depthKm: 20.5,
      latitude: 0.0,
      longitude: 0.0,
      occurredAt: T0,
    });

    resetWorkflowMemoryState();

    // 1. Initial workflow execution at T0 + 2m without MMI
    const res1 = await executeEarthquakeV1MmiWorkflow({
      earthquake: { id: eventId, magnitude: 5.3, depthKm: 20.5, latitude: 0.0, longitude: 0.0 },
      stores: [storeA],
      officialGrids: [],
      windowStartedAt: T0,
      currentTime: atMinute(2),
      dbPool: pool,
    });

    assert.equal(res1.evaluation.ruleApplied, "RULE_C_WAITING_NO_MMI");
    assert.equal(res1.evaluation.canFinalizeDecision, false);
    assert.equal(res1.createdInspectionReports, 0);

    // Verify persisted state in PostgreSQL
    const dbCheck1 = await client.query(
      `SELECT raw_metadata->'v1_mmi_workflow' AS state FROM earthquake_events WHERE id = $1`,
      [eventId]
    );
    const state1 = dbCheck1.rows[0].state;
    assert.equal(state1.status, "WAITING_WINDOW");
    assert.equal(state1.window_started_at, T0.toISOString());
    assert.equal(state1.deadline_at, atMinute(10).toISOString());

    // 2A. In-memory cache reset simulation
    resetWorkflowMemoryState();

    // 2B. Real separate process restart verification (distinct from clearing in-memory cache)
    const thisTestFile = path.resolve(process.cwd(), "tests/earthquake-v1-mmi-postgres-integration.test.ts");
    const childProc = spawnSync("pnpm", ["dlx", "tsx", thisTestFile], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        SPARTA_TEST_MODE: "true",
        CHILD_WORKER_MODE: "true",
        CHILD_EVENT_ID: eventId,
        CHILD_CURRENT_TIME: atMinute(4).toISOString(),
      },
      shell: true,
      encoding: "utf8",
    });

    assert.equal(childProc.status, 0, `Child process failed: ${childProc.stderr}`);
    const matchResult = childProc.stdout.match(/CHILD_WORKER_RESULT:(.+)/);
    assert.ok(matchResult, `Child process must output worker result: ${childProc.stdout}`);
    const childParsed = JSON.parse(matchResult[1].trim());
    assert.equal(
      childParsed.windowStartedAt,
      T0.toISOString(),
      "Separate OS process restart must restore original window_started_at from PostgreSQL"
    );
    assert.equal(
      childParsed.deadlineAt,
      atMinute(10).toISOString(),
      "Separate OS process restart must restore original deadline_at from PostgreSQL"
    );

    // 3. Event update arrives at T0 + 5m (e.g. revised magnitude 5.4)
    // The event update must NOT reset window timer
    const res2 = await executeEarthquakeV1MmiWorkflow({
      earthquake: { id: eventId, magnitude: 5.4, depthKm: 20.5, latitude: 0.0, longitude: 0.0 },
      stores: [storeA],
      officialGrids: [],
      windowStartedAt: atMinute(5), // Caller attempts to pass new start time
      currentTime: atMinute(5),
      dbPool: pool,
    });

    // Window must strictly maintain original start time and deadline from DB
    assert.equal(res2.evaluation.windowStartedAt.toISOString(), T0.toISOString());
    assert.equal(res2.evaluation.deadlineAt.toISOString(), atMinute(10).toISOString());
    assert.equal(res2.evaluation.isDeadlineReached, false);
    assert.equal(res2.evaluation.ruleApplied, "RULE_C_WAITING_NO_MMI");

    // Check DB state confirms original timer was preserved
    const dbCheck2 = await client.query(
      `SELECT raw_metadata->'v1_mmi_workflow' AS state FROM earthquake_events WHERE id = $1`,
      [eventId]
    );
    const state2 = dbCheck2.rows[0].state;
    assert.equal(state2.window_started_at, T0.toISOString());
    assert.equal(state2.deadline_at, atMinute(10).toISOString());
  } finally {
    await cleanupTestFixtures(client);
    client.release();
  }
});

test("Scenario 2: Deadline processing without new live-feed update evaluates V1 fallback", async () => {
  const pool = getIsolatedDbPool();
  const eventId = "TEST_PG_EQ_S2_DEADLINE";
  const storeA = createStoreFixture("TEST_PG_STR_S2", "CAB_S2", 0.1, 0.0); // ~11 km (inside V1 50 km)

  const client = await pool.connect();
  try {
    await cleanupTestFixtures(client);

    // Initial earthquake at T0
    await insertEarthquakeFixture(client, {
      id: eventId,
      magnitude: 5.3,
      depthKm: 20.5,
      latitude: 0.0,
      longitude: 0.0,
      occurredAt: T0,
      rawMetadata: {
        v1_mmi_workflow: {
          status: "WAITING_WINDOW",
          window_started_at: T0.toISOString(),
          deadline_at: atMinute(10).toISOString(),
        },
      },
    });

    resetWorkflowMemoryState();

    // Evaluate at T0 + 11m (deadline elapsed, no new MMI arrived)
    const result = await executeEarthquakeV1MmiWorkflow({
      earthquake: { id: eventId, magnitude: 5.3, depthKm: 20.5, latitude: 0.0, longitude: 0.0 },
      stores: [storeA],
      officialGrids: [],
      currentTime: atMinute(11),
      dbPool: pool,
    });

    assert.equal(result.evaluation.isDeadlineReached, true);
    assert.equal(result.evaluation.ruleApplied, "RULE_C_DEADLINE_V1_ONLY");
    assert.equal(result.evaluation.canFinalizeDecision, true);
    assert.equal(result.createdInspectionReports, 1);
    assert.equal(result.dispatchedBranchNotifications, 1);

    // Check store evaluation basis
    const evalTarget = result.evaluation.qualifyingStores[0];
    assert.equal(evalTarget.assessmentBasis, "V1_FALLBACK");
    assert.equal(evalTarget.mmi, null); // MMI recorded as unknown/null, never 0

    // Database evidence
    const incidentRows = await client.query(
      `SELECT id, canonical_event_id, location_id, report_origin, status FROM incidents WHERE canonical_event_id = $1`,
      [eventId]
    );
    assert.equal(incidentRows.rows.length, 1);
    assert.equal(incidentRows.rows[0].location_id, storeA.kode_toko);
    assert.equal(incidentRows.rows[0].report_origin, "automatic_earthquake");

    const notifRows = await client.query(
      `SELECT id, canonical_event_id, branch, ticket_number FROM notification_logs WHERE canonical_event_id = $1`,
      [eventId]
    );
    assert.equal(notifRows.rows.length, 1);
    assert.equal(notifRows.rows[0].branch, "CAB_S2");

    const stateRes = await client.query(
      `SELECT raw_metadata->'v1_mmi_workflow' AS state FROM earthquake_events WHERE id = $1`,
      [eventId]
    );
    assert.equal(stateRes.rows[0].state.status, "FINALIZED");
  } finally {
    await cleanupTestFixtures(client);
    client.release();
  }
});

test("Scenario 3: Controlled failure during report creation rolls back and retry succeeds", async () => {
  const pool = getIsolatedDbPool();
  const eventId = "TEST_PG_EQ_S3_REPORT_FAIL";
  const storeA = createStoreFixture("TEST_PG_STR_S3", "CAB_S3", 0.1, 0.0);

  const client = await pool.connect();
  try {
    await cleanupTestFixtures(client);

    await insertEarthquakeFixture(client, {
      id: eventId,
      magnitude: 5.3,
      depthKm: 20.5,
      latitude: 0.0,
      longitude: 0.0,
      occurredAt: T0,
      rawMetadata: {
        v1_mmi_workflow: {
          status: "WAITING_WINDOW",
          window_started_at: T0.toISOString(),
          deadline_at: atMinute(10).toISOString(),
        },
      },
    });

    resetWorkflowMemoryState();

    // Create a pool wrapper that injects failure on INSERT INTO incidents on attempt 1
    const failingPool = createFailingPool(pool, "INSERT INTO INCIDENTS");

    // 1. First execution should fail during report insertion
    await assert.rejects(
      async () => {
        await executeEarthquakeV1MmiWorkflow({
          earthquake: { id: eventId, magnitude: 5.3, depthKm: 20.5, latitude: 0.0, longitude: 0.0 },
          stores: [storeA],
          officialGrids: [],
          currentTime: atMinute(11),
          dbPool: failingPool,
        });
      },
      /INJECTED_FAILURE_ON_INSERT INTO INCIDENTS/
    );

    // Verify transaction rollback: zero reports and zero notification logs in DB
    const reportCheck1 = await client.query(
      `SELECT count(*)::int AS cnt FROM incidents WHERE canonical_event_id = $1`,
      [eventId]
    );
    assert.equal(reportCheck1.rows[0].cnt, 0);

    const notifCheck1 = await client.query(
      `SELECT count(*)::int AS cnt FROM notification_logs WHERE canonical_event_id = $1`,
      [eventId]
    );
    assert.equal(notifCheck1.rows[0].cnt, 0);

    // State in DB remains DECIDED (frozen targets preserved for retry)
    const stateCheck1 = await client.query(
      `SELECT raw_metadata->'v1_mmi_workflow' AS state FROM earthquake_events WHERE id = $1`,
      [eventId]
    );
    assert.equal(stateCheck1.rows[0].state.status, "DECIDED");

    // 2. Retry execution without failure
    const retryResult = await executeEarthquakeV1MmiWorkflow({
      earthquake: { id: eventId, magnitude: 5.3, depthKm: 20.5, latitude: 0.0, longitude: 0.0 },
      stores: [storeA],
      officialGrids: [],
      currentTime: atMinute(11),
      dbPool: pool,
    });

    assert.equal(retryResult.createdInspectionReports, 1);
    assert.equal(retryResult.dispatchedBranchNotifications, 1);

    // Verify DB records after retry
    const reportCheck2 = await client.query(
      `SELECT count(*)::int AS cnt FROM incidents WHERE canonical_event_id = $1`,
      [eventId]
    );
    assert.equal(reportCheck2.rows[0].cnt, 1);

    const notifCheck2 = await client.query(
      `SELECT count(*)::int AS cnt FROM notification_logs WHERE canonical_event_id = $1`,
      [eventId]
    );
    assert.equal(notifCheck2.rows[0].cnt, 1);

    const stateCheck2 = await client.query(
      `SELECT raw_metadata->'v1_mmi_workflow' AS state FROM earthquake_events WHERE id = $1`,
      [eventId]
    );
    assert.equal(stateCheck2.rows[0].state.status, "FINALIZED");
  } finally {
    await cleanupTestFixtures(client);
    client.release();
  }
});

test("Scenario 4: Controlled failure during notification creation rolls back reports and retry succeeds", async () => {
  const pool = getIsolatedDbPool();
  const eventId = "TEST_PG_EQ_S4_NOTIF_FAIL";
  const storeA = createStoreFixture("TEST_PG_STR_S4", "CAB_S4", 0.1, 0.0);

  const client = await pool.connect();
  try {
    await cleanupTestFixtures(client);

    await insertEarthquakeFixture(client, {
      id: eventId,
      magnitude: 5.3,
      depthKm: 20.5,
      latitude: 0.0,
      longitude: 0.0,
      occurredAt: T0,
      rawMetadata: {
        v1_mmi_workflow: {
          status: "WAITING_WINDOW",
          window_started_at: T0.toISOString(),
          deadline_at: atMinute(10).toISOString(),
        },
      },
    });

    resetWorkflowMemoryState();

    // Wrap pool to inject failure when writing notification_logs
    const failingPool = createFailingPool(pool, "INSERT INTO NOTIFICATION_LOGS");

    // 1. Attempt execution with notification failure
    await assert.rejects(
      async () => {
        await executeEarthquakeV1MmiWorkflow({
          earthquake: { id: eventId, magnitude: 5.3, depthKm: 20.5, latitude: 0.0, longitude: 0.0 },
          stores: [storeA],
          officialGrids: [],
          currentTime: atMinute(11),
          dbPool: failingPool,
        });
      },
      /INJECTED_FAILURE_ON_INSERT INTO NOTIFICATION_LOGS/
    );

    // Verify rollback: even though report insert ran, notification error rolled it back!
    const reportCheck = await client.query(
      `SELECT count(*)::int AS cnt FROM incidents WHERE canonical_event_id = $1`,
      [eventId]
    );
    assert.equal(reportCheck.rows[0].cnt, 0);

    const notifCheck = await client.query(
      `SELECT count(*)::int AS cnt FROM notification_logs WHERE canonical_event_id = $1`,
      [eventId]
    );
    assert.equal(notifCheck.rows[0].cnt, 0);

    // 2. Retry execution
    const retryResult = await executeEarthquakeV1MmiWorkflow({
      earthquake: { id: eventId, magnitude: 5.3, depthKm: 20.5, latitude: 0.0, longitude: 0.0 },
      stores: [storeA],
      officialGrids: [],
      currentTime: atMinute(11),
      dbPool: pool,
    });

    assert.equal(retryResult.createdInspectionReports, 1);
    assert.equal(retryResult.dispatchedBranchNotifications, 1);

    const reportCheck2 = await client.query(
      `SELECT count(*)::int AS cnt FROM incidents WHERE canonical_event_id = $1`,
      [eventId]
    );
    assert.equal(reportCheck2.rows[0].cnt, 1);

    const notifCheck2 = await client.query(
      `SELECT count(*)::int AS cnt FROM notification_logs WHERE canonical_event_id = $1`,
      [eventId]
    );
    assert.equal(notifCheck2.rows[0].cnt, 1);
  } finally {
    await cleanupTestFixtures(client);
    client.release();
  }
});

test("Scenario 5: Concurrent workers with DB locks and unique constraints prevent duplicate outputs", async () => {
  const pool = getIsolatedDbPool();
  const eventId = "TEST_PG_EQ_S5_CONCURRENT";
  const storeA = createStoreFixture("TEST_PG_STR_S5A", "CAB_S5", 0.1, 0.0);
  const storeB = createStoreFixture("TEST_PG_STR_S5B", "CAB_S5", 0.2, 0.0);

  const client = await pool.connect();
  try {
    await cleanupTestFixtures(client);

    await insertEarthquakeFixture(client, {
      id: eventId,
      magnitude: 5.3,
      depthKm: 20.5,
      latitude: 0.0,
      longitude: 0.0,
      occurredAt: T0,
      rawMetadata: {
        v1_mmi_workflow: {
          status: "WAITING_WINDOW",
          window_started_at: T0.toISOString(),
          deadline_at: atMinute(10).toISOString(),
        },
      },
    });

    resetWorkflowMemoryState();

    // Run 2 workers simultaneously with real separate DB connections
    const [worker1, worker2] = await Promise.all([
      executeEarthquakeV1MmiWorkflow({
        earthquake: { id: eventId, magnitude: 5.3, depthKm: 20.5, latitude: 0.0, longitude: 0.0 },
        stores: [storeA, storeB],
        officialGrids: [],
        currentTime: atMinute(11),
        dbPool: pool,
      }),
      executeEarthquakeV1MmiWorkflow({
        earthquake: { id: eventId, magnitude: 5.3, depthKm: 20.5, latitude: 0.0, longitude: 0.0 },
        stores: [storeA, storeB],
        officialGrids: [],
        currentTime: atMinute(11),
        dbPool: pool,
      }),
    ]);

    const totalCreatedReports = worker1.createdInspectionReports + worker2.createdInspectionReports;
    const totalDispatchedNotifs = worker1.dispatchedBranchNotifications + worker2.dispatchedBranchNotifications;

    assert.equal(totalCreatedReports, 2, "Only 2 reports total across both workers (1 per store)");
    assert.equal(totalDispatchedNotifs, 1, "Only 1 notification total across both workers (1 per branch)");

    // Exactly one worker should detect suppression/duplicate
    const duplicateFlags = [worker1.isDuplicateSuppressed, worker2.isDuplicateSuppressed];
    assert.ok(duplicateFlags.includes(true), "One worker must have duplicate suppression flagged");
    assert.ok(duplicateFlags.includes(false), "One worker must have executed creation");

    // Database evidence: check actual row count in PostgreSQL
    const reportRows = await client.query(
      `SELECT count(*)::int AS cnt FROM incidents WHERE canonical_event_id = $1`,
      [eventId]
    );
    assert.equal(reportRows.rows[0].cnt, 2);

    const notifRows = await client.query(
      `SELECT count(*)::int AS cnt FROM notification_logs WHERE canonical_event_id = $1`,
      [eventId]
    );
    assert.equal(notifRows.rows[0].cnt, 1);
  } finally {
    await cleanupTestFixtures(client);
    client.release();
  }
});

test("Scenario 6: Late MMI updates monitoring intensity without adding reports or notifications", async () => {
  const pool = getIsolatedDbPool();
  const eventId = "TEST_PG_EQ_S6_LATE_MMI";
  // Store A inside V1 (~11 km), Store B outside V1 (~78 km)
  const storeA = createStoreFixture("TEST_PG_STR_S6A", "CAB_S6", 0.1, 0.0);
  const storeB = createStoreFixture("TEST_PG_STR_S6B", "CAB_S6", 0.7, 0.0);

  const client = await pool.connect();
  try {
    await cleanupTestFixtures(client);

    // Initial earthquake receipt
    await insertEarthquakeFixture(client, {
      id: eventId,
      magnitude: 5.3,
      depthKm: 20.5,
      latitude: 0.0,
      longitude: 0.0,
      occurredAt: T0,
      rawMetadata: {
        v1_mmi_workflow: {
          status: "WAITING_WINDOW",
          window_started_at: T0.toISOString(),
          deadline_at: atMinute(10).toISOString(),
        },
      },
    });

    resetWorkflowMemoryState();

    // 1. Initial finalization at deadline under Rule C (no MMI)
    const initialResult = await executeEarthquakeV1MmiWorkflow({
      earthquake: { id: eventId, magnitude: 5.3, depthKm: 20.5, latitude: 0.0, longitude: 0.0 },
      stores: [storeA, storeB],
      officialGrids: [],
      currentTime: atMinute(11),
      dbPool: pool,
    });

    assert.equal(initialResult.createdInspectionReports, 1); // Only Store A inside V1
    assert.equal(initialResult.dispatchedBranchNotifications, 1);

    // 2. Simulate process restart
    resetWorkflowMemoryState();

    // 3. Late MMI arrives (BMKG ShakeMap v2 with MMI 6.8 covering both stores)
    // Under initial evaluation, Store B would qualify if evaluated with MMI 6.8.
    // However, late MMI after decision MUST NOT add new reports or notifications.
    const lateGrid = createOfficialGrid(eventId, 6.8, "BMKG", 2);

    const lateResult = await executeEarthquakeV1MmiWorkflow({
      earthquake: { id: eventId, magnitude: 5.3, depthKm: 20.5, latitude: 0.0, longitude: 0.0 },
      stores: [storeA, storeB],
      officialGrids: [lateGrid],
      currentTime: atMinute(15),
      dbPool: pool,
    });

    assert.equal(lateResult.createdInspectionReports, 0);
    assert.equal(lateResult.dispatchedBranchNotifications, 0);
    assert.equal(lateResult.isDuplicateSuppressed, true);

    // DB evidence: incidents still only has 1 report (Store A), Store B was NOT added
    const incidentRows = await client.query(
      `SELECT location_id FROM incidents WHERE canonical_event_id = $1`,
      [eventId]
    );
    assert.equal(incidentRows.rows.length, 1);
    assert.equal(incidentRows.rows[0].location_id, storeA.kode_toko);

    // DB evidence: notification_logs still only has 1 notification
    const notifRows = await client.query(
      `SELECT count(*)::int AS cnt FROM notification_logs WHERE canonical_event_id = $1`,
      [eventId]
    );
    assert.equal(notifRows.rows[0].cnt, 1);

    // DB evidence: earthquake_facility_intensities HAS recorded late MMI for internal monitoring
    const intensityRows = await client.query(
      `SELECT facility_id, mmi_raw, shakemap_version FROM earthquake_facility_intensities WHERE canonical_event_id = $1 ORDER BY facility_id`,
      [eventId]
    );
    assert.ok(intensityRows.rows.length >= 2, "Internal facility intensity table must record late MMI for both stores");
    const storeBIntensity = intensityRows.rows.find((r) => r.facility_id === storeB.kode_toko);
    assert.ok(storeBIntensity, "Store B intensity must be recorded");
    assert.ok(
      Math.abs(Number(storeBIntensity.mmi_raw) - 6.8) < 0.01,
      `Store B MMI must be approximately 6.8, got ${storeBIntensity.mmi_raw}`
    );
  } finally {
    await cleanupTestFixtures(client);
    client.release();
  }
});

test("Scenario 7: Empty result produces zero inspection reports and zero notifications", async () => {
  const pool = getIsolatedDbPool();
  const eventId = "TEST_PG_EQ_S7_EMPTY";
  // Store far away (~111 km), well outside V1 radius 20 km for M 4.2
  const farStore = createStoreFixture("TEST_PG_STR_S7", "CAB_S7", 1.0, 0.0);

  const client = await pool.connect();
  try {
    await cleanupTestFixtures(client);

    await insertEarthquakeFixture(client, {
      id: eventId,
      magnitude: 4.2,
      depthKm: 15.0,
      latitude: 0.0,
      longitude: 0.0,
      occurredAt: T0,
      priorityRadiusKm: 20,
      monitoringRadiusKm: 50,
      rawMetadata: {
        v1_mmi_workflow: {
          status: "WAITING_WINDOW",
          window_started_at: T0.toISOString(),
          deadline_at: atMinute(10).toISOString(),
        },
      },
    });

    resetWorkflowMemoryState();

    const result = await executeEarthquakeV1MmiWorkflow({
      earthquake: { id: eventId, magnitude: 4.2, depthKm: 15.0, latitude: 0.0, longitude: 0.0 },
      stores: [farStore],
      officialGrids: [],
      currentTime: atMinute(11),
      dbPool: pool,
    });

    assert.equal(result.evaluation.qualifyingStoresCount, 0);
    assert.equal(result.createdInspectionReports, 0);
    assert.equal(result.dispatchedBranchNotifications, 0);

    // DB evidence: earthquake event exists and is finalized, but reports and notifs are 0
    const eqRow = await client.query(
      `SELECT raw_metadata->'v1_mmi_workflow' AS state FROM earthquake_events WHERE id = $1`,
      [eventId]
    );
    assert.equal(eqRow.rows[0].state.status, "FINALIZED");

    const reportCount = await client.query(
      `SELECT count(*)::int AS cnt FROM incidents WHERE canonical_event_id = $1`,
      [eventId]
    );
    assert.equal(reportCount.rows[0].cnt, 0);

    const notifCount = await client.query(
      `SELECT count(*)::int AS cnt FROM notification_logs WHERE canonical_event_id = $1`,
      [eventId]
    );
    assert.equal(notifCount.rows[0].cnt, 0);
  } finally {
    await cleanupTestFixtures(client);
    client.release();
  }
});
}
