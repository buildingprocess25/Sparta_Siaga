import type { Pool, PoolClient } from "pg";
import { getDbPool } from "./db";

export type EarthquakeLocationKind = "STORE" | "FACILITY";

export interface EarthquakeReportLocation {
  kind: EarthquakeLocationKind;
  id: string;
  code: string;
  name: string;
  type: string;
  branch: string;
  latitude: number;
  longitude: number;
}

export interface EnsureEarthquakeReportInput {
  reportId: string;
  canonicalEventId: string;
  eventOccurredAt: Date;
  source: string;
  location: EarthquakeReportLocation;
  reconciliationWindowMinutes?: number;
  clientOrPool?: Pool | PoolClient;
  manageTransaction?: boolean;
}

export type EnsureEarthquakeReportResult =
  | { outcome: "existing" | "linked_manual" | "created"; incidentId: string }
  | { outcome: "ambiguous"; candidateIncidentIds: string[] };

export async function ensureEarthquakeReport(
  input: EnsureEarthquakeReportInput
): Promise<EnsureEarthquakeReportResult> {
  const isAcquiredClient = !input.clientOrPool || typeof (input.clientOrPool as PoolClient).release !== "function";
  const client: PoolClient = input.clientOrPool
    ? (isAcquiredClient
      ? await (input.clientOrPool as Pool).connect()
      : (input.clientOrPool as PoolClient))
    : await getDbPool().connect();
  const windowMinutes = input.reconciliationWindowMinutes ?? 120;
  const manageTransaction = input.manageTransaction !== false;
  if (!manageTransaction && isAcquiredClient) {
    client.release();
    throw new Error("A caller-managed transaction requires a checked-out database client");
  }
  try {
    if (manageTransaction) await client.query("BEGIN");
    await client.query("SELECT lock_earthquake_location($1, $2, $3)", [
      input.canonicalEventId,
      input.location.kind,
      input.location.id,
    ]);

    const existing = await client.query<{ id: string }>(
      `SELECT id FROM incidents
        WHERE canonical_event_id = $1 AND location_kind = $2 AND location_id = $3
        LIMIT 1`,
      [input.canonicalEventId, input.location.kind, input.location.id]
    );
    if (existing.rows[0]) {
      if (manageTransaction) await client.query("COMMIT");
      return { outcome: "existing", incidentId: existing.rows[0].id };
    }

    const minTime = new Date(input.eventOccurredAt.getTime() - windowMinutes * 60_000);
    const maxTime = new Date(input.eventOccurredAt.getTime() + windowMinutes * 60_000);
    const manual = await client.query<{ id: string }>(
      `SELECT id FROM incidents
        WHERE disaster_type = 'earthquake'
          AND report_origin = 'manual'
          AND canonical_event_id IS NULL
          AND earthquake_event_id IS NULL
          AND created_at BETWEEN $1 AND $2
          AND (
            (location_kind = $3 AND location_id = $4)
            OR ($3 = 'STORE' AND location_kind IS NULL AND store_id = $4)
          )
        ORDER BY created_at, id
        FOR UPDATE`,
      [minTime, maxTime, input.location.kind, input.location.id]
    );

    if (manual.rows.length > 1) {
      for (const candidate of manual.rows) {
        await client.query(
          `INSERT INTO earthquake_reconciliation_cases (
             incident_id, candidate_canonical_event_id, candidate_location_kind,
             candidate_location_id, reason, details
           ) VALUES ($1, $2, $3, $4, 'MULTIPLE_MANUAL_CANDIDATES', $5::jsonb)
           ON CONFLICT DO NOTHING`,
          [
            candidate.id,
            input.canonicalEventId,
            input.location.kind,
            input.location.id,
            JSON.stringify({ candidateCount: manual.rows.length }),
          ]
        );
      }
      if (manageTransaction) await client.query("COMMIT");
      return { outcome: "ambiguous", candidateIncidentIds: manual.rows.map((row) => row.id) };
    }

    if (manual.rows.length === 1) {
      const incidentId = manual.rows[0].id;
      await client.query(
        `UPDATE incidents SET
           canonical_event_id = $1::text,
           earthquake_event_id = $1::text,
           earthquake_source = COALESCE(earthquake_source, $2),
           location_kind = $3,
           location_id = $4,
           location_code_snapshot = COALESCE(location_code_snapshot, $5),
           location_name_snapshot = COALESCE(location_name_snapshot, $6),
           location_type_snapshot = COALESCE(location_type_snapshot, $7),
           latitude_snapshot = COALESCE(latitude_snapshot, $8),
           longitude_snapshot = COALESCE(longitude_snapshot, $9),
           branch_snapshot = COALESCE(branch_snapshot, branch),
           updated_at = NOW()
         WHERE id = $10`,
        [
          input.canonicalEventId,
          input.source,
          input.location.kind,
          input.location.id,
          input.location.code,
          input.location.name,
          input.location.type,
          input.location.latitude,
          input.location.longitude,
          incidentId,
        ]
      );
      if (manageTransaction) await client.query("COMMIT");
      return { outcome: "linked_manual", incidentId };
    }

    const created = await client.query<{ id: string }>(
      `INSERT INTO incidents (
         id, date, disaster_type, report_origin, earthquake_event_id,
         canonical_event_id, earthquake_source, tkp_type, store_id, store_name,
         branch, location_city, status, progress, field_photos, timeline,
         location_kind, location_id, location_code_snapshot, location_name_snapshot,
         location_type_snapshot, latitude_snapshot, longitude_snapshot, branch_snapshot,
         created_at, updated_at
       ) VALUES (
         $1, $2, 'earthquake', 'automatic_earthquake', $3::text,
         $3::text, $4, $5, $6, $7,
         $8::text, NULL, 'pending_confirmation', 0, '[]'::jsonb, $9::jsonb,
         $10, $11, $12, $13, $14, $15, $16, $8::text, NOW(), NOW()
       )
       ON CONFLICT (canonical_event_id, location_kind, location_id)
         WHERE disaster_type = 'earthquake'
           AND canonical_event_id IS NOT NULL
           AND location_kind IS NOT NULL
           AND location_id IS NOT NULL
       DO NOTHING
       RETURNING id`,
      [
        input.reportId,
        input.eventOccurredAt.toISOString(),
        input.canonicalEventId,
        input.source,
        input.location.kind === "STORE" ? "toko" : "dc",
        input.location.kind === "STORE" ? input.location.id : null,
        input.location.kind === "STORE" ? input.location.name : null,
        input.location.branch,
        JSON.stringify([
          {
            stage: "auto_report_created",
            label: "Laporan gempa otomatis dibuat dan menunggu pemeriksaan",
            timestamp: new Date().toISOString(),
            actor: "SYSTEM",
          },
        ]),
        input.location.kind,
        input.location.id,
        input.location.code,
        input.location.name,
        input.location.type,
        input.location.latitude,
        input.location.longitude,
      ]
    );

    if (created.rows[0]) {
      if (manageTransaction) await client.query("COMMIT");
      return { outcome: "created", incidentId: created.rows[0].id };
    }

    const raced = await client.query<{ id: string }>(
      `SELECT id FROM incidents
        WHERE canonical_event_id = $1 AND location_kind = $2 AND location_id = $3
        LIMIT 1`,
      [input.canonicalEventId, input.location.kind, input.location.id]
    );
    if (!raced.rows[0]) {
      throw new Error("Earthquake report conflict resolved without an existing row.");
    }
    if (manageTransaction) await client.query("COMMIT");
    return { outcome: "existing", incidentId: raced.rows[0].id };
  } catch (error) {
    if (manageTransaction) await client.query("ROLLBACK");
    throw error;
  } finally {
    if (isAcquiredClient && typeof client.release === "function") {
      client.release();
    }
  }
}
