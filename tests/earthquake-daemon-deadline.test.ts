import assert from "node:assert/strict";
import test from "node:test";
import { getIsolatedDbPool, closeDbPool } from "../lib/db";
import { assertIsolatedDatabase, ISOLATED_DATABASE_NAME } from "../lib/database-safety";
import { runAutonomousDisasterCycle } from "../lib/server-daemon";
import { dbGetPendingEarthquakeEvents } from "../lib/earthquake-db";

const EVENT_ID = "SIM-EQ-UAT-DEADLINE-DAEMON-01";

test.before(async () => {
  const pool = getIsolatedDbPool();
  const client = await pool.connect();
  try {
    await assertIsolatedDatabase(client);
    // Initial cleanup
    await client.query(`DELETE FROM incidents WHERE canonical_event_id = $1`, [EVENT_ID]);
    await client.query(`DELETE FROM notification_logs WHERE canonical_event_id = $1`, [EVENT_ID]);
    await client.query(`DELETE FROM earthquake_events WHERE id = $1`, [EVENT_ID]);
  } finally {
    client.release();
  }
});

test.after(async () => {
  const pool = getIsolatedDbPool();
  const client = await pool.connect();
  try {
    await assertIsolatedDatabase(client);
    await client.query(`DELETE FROM incidents WHERE canonical_event_id = $1`, [EVENT_ID]);
    await client.query(`DELETE FROM notification_logs WHERE canonical_event_id = $1`, [EVENT_ID]);
    await client.query(`DELETE FROM earthquake_events WHERE id = $1`, [EVENT_ID]);
  } finally {
    client.release();
    await closeDbPool();
  }
});

test("Automatic Daemon Cycle: Pending earthquake discovery, deadline evaluation, and idempotent rerun", async () => {
  const pool = getIsolatedDbPool();
  const client = await pool.connect();

  try {
    await assertIsolatedDatabase(client);

    const now = Date.now();
    const windowStartedAt = new Date(now - 12 * 60 * 1000); // 12 minutes ago
    const deadlineAt = new Date(now - 2 * 60 * 1000); // 2 minutes ago (deadline elapsed)
    const occurredAt = new Date(now - 20 * 60 * 1000); // 20 minutes ago

    // Insert pending earthquake fixture in WAITING_WINDOW state
    // Coordinate: Boalemo, Gorontalo (0.49701, 122.28157)
    // Magnitude: 4.2, Depth: 15 km -> V1 distance: 20 km (19 active stores within 20 km)
    await client.query(
      `INSERT INTO earthquake_events (
        id, magnitude, depth_km, latitude, longitude, occurred_at, title, source_primary,
        priority_radius_km, monitoring_radius_km, first_seen_at, last_seen_at, raw_metadata
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11, $12::jsonb)`,
      [
        EVENT_ID,
        4.2,
        15,
        0.49701,
        122.28157,
        occurredAt,
        "Gempa Bumi Simulasi M 4.2 Boalemo UAT Daemon Test",
        "SIMULASI UAT",
        20,
        50,
        occurredAt,
        JSON.stringify({
          v1_mmi_workflow: {
            status: "WAITING_WINDOW",
            window_started_at: windowStartedAt.toISOString(),
            deadline_at: deadlineAt.toISOString(),
          },
        }),
      ]
    );

    // STEP 1: Verify daemon discovers the persisted pending earthquake from database
    const pendingBefore = await dbGetPendingEarthquakeEvents();
    const foundPending = pendingBefore.find((e) => e.id === EVENT_ID);
    assert.ok(foundPending, "Daemon must discover the pending earthquake from database queue");
    assert.equal(foundPending.id, EVENT_ID);

    // STEP 2: Execute actual daemon cycle (cycle 1) without new live-feed update
    await runAutonomousDisasterCycle();

    // STEP 3: Verify transition from WAITING_WINDOW to FINALIZED in database
    const eqRow = await client.query(
      `SELECT raw_metadata->'v1_mmi_workflow' AS state FROM earthquake_events WHERE id = $1`,
      [EVENT_ID]
    );
    const workflowState = eqRow.rows[0]?.state;
    assert.ok(workflowState, "Workflow state must be present in earthquake_events");
    assert.equal(workflowState.status, "FINALIZED", "Workflow status must transition to FINALIZED");
    assert.equal(
      workflowState.decision?.ruleApplied,
      "RULE_C_DEADLINE_V1_ONLY",
      "Rule applied must be RULE_C_DEADLINE_V1_ONLY upon deadline expiration without MMI"
    );
    assert.equal(workflowState.decision?.qualifyingStoresCount, 19);
    assert.deepEqual(workflowState.decision?.affectedBranches, ["GORONTALO"]);

    // Verify 19 inspection reports created in incidents table
    const incidentRows = await client.query(
      `SELECT id, location_id, branch, report_origin FROM incidents WHERE canonical_event_id = $1`,
      [EVENT_ID]
    );
    assert.equal(incidentRows.rows.length, 19, "Exactly 19 inspection reports must be created");
    for (const row of incidentRows.rows) {
      assert.equal(row.branch, "GORONTALO");
      assert.equal(row.report_origin, "automatic_earthquake");
    }

    // Verify 1 branch notification dispatched for GORONTALO
    const notifRows = await client.query(
      `SELECT id, branch, ticket_number, affected_stores_count FROM notification_logs WHERE canonical_event_id = $1`,
      [EVENT_ID]
    );
    assert.equal(notifRows.rows.length, 1, "Exactly 1 branch notification must be dispatched");
    assert.equal(notifRows.rows[0].branch, "GORONTALO");
    assert.equal(notifRows.rows[0].affected_stores_count, 19);

    const initialReportCount = incidentRows.rows.length;
    const initialNotifCount = notifRows.rows.length;

    // STEP 4: Execute another daemon cycle (cycle 2) and verify zero duplicate outputs
    await runAutonomousDisasterCycle();

    // Verify earthquake is no longer in pending list
    const pendingAfter = await dbGetPendingEarthquakeEvents();
    const foundAfter = pendingAfter.find((e) => e.id === EVENT_ID);
    assert.equal(foundAfter, undefined, "Finalized earthquake must not appear in pending list");

    // Verify report count remains exactly identical
    const incidentRows2 = await client.query(
      `SELECT count(*)::int AS cnt FROM incidents WHERE canonical_event_id = $1`,
      [EVENT_ID]
    );
    assert.equal(incidentRows2.rows[0].cnt, initialReportCount, "Report count must not change on rerun");

    // Verify notification count remains exactly identical
    const notifRows2 = await client.query(
      `SELECT count(*)::int AS cnt FROM notification_logs WHERE canonical_event_id = $1`,
      [EVENT_ID]
    );
    assert.equal(notifRows2.rows[0].cnt, initialNotifCount, "Notification count must not change on rerun");
  } finally {
    client.release();
  }
});
