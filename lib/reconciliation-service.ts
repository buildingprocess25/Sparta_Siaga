import { getDbPool } from "./db";

export async function listReconciliationCases(status = "OPEN") {
  const { rows } = await getDbPool().query(
    `SELECT c.*, i.status AS incident_status, i.disaster_type,
            COALESCE(i.location_name_snapshot, i.store_name) AS current_location_name,
            i.canonical_event_id AS current_canonical_event_id,
            i.location_kind AS current_location_kind, i.location_id AS current_location_id,
            e.occurred_at, e.magnitude, e.title AS event_location
       FROM earthquake_reconciliation_cases c
       JOIN incidents i ON i.id = c.incident_id
       LEFT JOIN earthquake_events e ON e.id = c.candidate_canonical_event_id
      WHERE c.status = $1 ORDER BY c.created_at DESC`,
    [status]
  );
  return rows;
}

export async function createReconciliationCase(input: {
  incidentId: string;
  candidateCanonicalEventId?: string | null;
  candidateLocationKind?: string | null;
  candidateLocationId?: string | null;
  reason: string;
  details?: Record<string, unknown>;
}): Promise<{ id: string } | null> {
  const pool = getDbPool();
  try {
    const { rows } = await pool.query(
      `INSERT INTO earthquake_reconciliation_cases (
         incident_id, candidate_canonical_event_id, candidate_location_kind,
         candidate_location_id, reason, details
       ) VALUES ($1, $2, $3, $4, $5, $6::jsonb)
       ON CONFLICT (incident_id, candidate_canonical_event_id, candidate_location_kind, candidate_location_id)
         WHERE status = 'OPEN'
       DO UPDATE SET details = EXCLUDED.details, created_at = NOW()
       RETURNING id`,
      [
        input.incidentId,
        input.candidateCanonicalEventId ?? null,
        input.candidateLocationKind ?? "STORE",
        input.candidateLocationId ?? null,
        input.reason,
        JSON.stringify(input.details || {}),
      ]
    );
    return rows[0] || null;
  } catch (err) {
    console.warn("[reconciliation-service] Warning creating reconciliation case:", err);
    return null;
  }
}

export async function decideReconciliation(input: {
  caseId: string;
  action: "LINK" | "DISMISS";
  actorUserId: string;
  notes?: string;
}) {
  const client = await getDbPool().connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `SELECT c.*, i.canonical_event_id, i.location_kind, i.location_id
         FROM earthquake_reconciliation_cases c
         JOIN incidents i ON i.id = c.incident_id
        WHERE c.id = $1 FOR UPDATE OF c, i`,
      [input.caseId]
    );
    const item = result.rows[0];
    if (!item) throw new Error("RECONCILIATION_NOT_FOUND");
    if (item.status !== "OPEN") throw new Error("RECONCILIATION_ALREADY_DECIDED");
    const before = {
      canonicalEventId: item.canonical_event_id,
      locationKind: item.location_kind,
      locationId: item.location_id,
    };
    let after = before;
    if (input.action === "LINK") {
      if (!item.candidate_canonical_event_id || !item.candidate_location_kind || !item.candidate_location_id) {
        throw new Error("RECONCILIATION_CANDIDATE_INCOMPLETE");
      }
      await client.query(`SELECT lock_earthquake_location($1, $2, $3)`, [
        item.candidate_canonical_event_id, item.candidate_location_kind, item.candidate_location_id,
      ]);
      const collision = await client.query(
        `SELECT id FROM incidents WHERE id <> $1 AND canonical_event_id = $2
          AND location_kind = $3 AND location_id = $4 LIMIT 1`,
        [item.incident_id, item.candidate_canonical_event_id, item.candidate_location_kind, item.candidate_location_id]
      );
      if (collision.rows[0]) throw new Error("CANONICAL_LOCATION_ALREADY_LINKED");
      await client.query(
        `UPDATE incidents SET canonical_event_id = $2, earthquake_event_id = $2,
            location_kind = $3, location_id = $4, updated_at = NOW() WHERE id = $1`,
        [item.incident_id, item.candidate_canonical_event_id, item.candidate_location_kind, item.candidate_location_id]
      );
      after = { canonicalEventId: item.candidate_canonical_event_id,
        locationKind: item.candidate_location_kind, locationId: item.candidate_location_id };
    }
    await client.query(
      `UPDATE earthquake_reconciliation_cases SET status = $2, resolved_by = $3,
          resolved_at = NOW() WHERE id = $1`,
      [input.caseId, input.action === "LINK" ? "RESOLVED" : "DISMISSED", input.actorUserId]
    );
    await client.query(
      `INSERT INTO earthquake_reconciliation_audit
        (case_id, incident_id, action, previous_identity, resulting_identity, actor_user_id, notes)
       VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6, $7)`,
      [input.caseId, item.incident_id, input.action, JSON.stringify(before), JSON.stringify(after),
        input.actorUserId, input.notes ?? null]
    );
    await client.query("COMMIT");
    return { incidentId: item.incident_id, action: input.action, identity: after };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
