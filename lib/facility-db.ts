
import type { PoolClient } from "pg";

import { ISOLATED_DATABASE_NAME } from "./database-safety";

import type {
  FacilityImportRecord,
  FacilityParseResult,
  FacilitySourceAdapter,
  InvalidFacilityRow,
} from "./facility-import";

export interface FacilityImportPreview {
  sourceName: string;
  total: number;
  newCount: number;
  changedCount: number;
  unchangedCount: number;
  invalidCount: number;
  invalid: InvalidFacilityRow[];
  records: FacilityImportRecord[];
}

type ExistingFacility = {
  id: string;
  code: string;
  name: string;
  initials: string | null;
  facility_type: string;
  latitude: number;
  longitude: number;
};

function changedFields(
  existing: ExistingFacility,
  incoming: FacilityImportRecord
): Record<string, { from: unknown; to: unknown }> {
  const pairs: Array<[keyof ExistingFacility, unknown]> = [
    ["name", incoming.name],
    ["initials", incoming.initials],
    ["facility_type", incoming.type],
    ["latitude", incoming.latitude],
    ["longitude", incoming.longitude],
  ];

  return Object.fromEntries(
    pairs
      .filter(([key, value]) => existing[key] !== value)
      .map(([key, value]) => [
        key,
        { from: existing[key], to: value },
      ])
  );
}

/**
 * Preview facility import without modifying database records.
 */
export async function previewFacilityImport(
  client: Pick<PoolClient, "query">,
  source: FacilitySourceAdapter,
  parsed: FacilityParseResult
): Promise<FacilityImportPreview> {
  const { rows } = await client.query<ExistingFacility>(
    `SELECT id, code, name, initials, facility_type, latitude, longitude
       FROM facilities
      WHERE code = ANY($1::text[])`,
    [parsed.records.map((record) => record.code)]
  );

  const existingByCode = new Map(
    rows.map((row) => [row.code, row])
  );

  let newCount = 0;
  let changedCount = 0;
  let unchangedCount = 0;

  for (const record of parsed.records) {
    const existing = existingByCode.get(record.code);

    if (!existing) {
      newCount += 1;
    } else if (
      Object.keys(changedFields(existing, record)).length > 0
    ) {
      changedCount += 1;
    } else {
      unchangedCount += 1;
    }
  }

  return {
    sourceName: source.sourceName,
    total: parsed.records.length + parsed.invalid.length,
    newCount,
    changedCount,
    unchangedCount,
    invalidCount: parsed.invalid.length,
    invalid: parsed.invalid,
    records: parsed.records,
  };
}

/**
 * Apply facility import using a single database transaction.
 *
 * Allowed targets:
 * - Production: siaga
 * - Development/test: sparta_siaga_isolated
 *
 * All other databases are rejected.
 */
export async function applyFacilityImport(
  client: PoolClient,
  preview: FacilityImportPreview,
  actorUserId: string | null = null
): Promise<string> {
  await client.query("BEGIN");

  try {
    // Verify the actual connected PostgreSQL database.
    const databaseResult = await client.query<{
      database_name: string;
    }>(
      "SELECT current_database() AS database_name"
    );

    const databaseName =
      databaseResult.rows[0]?.database_name;

    const isTestDatabase =
      databaseName === ISOLATED_DATABASE_NAME &&
      process.env.NODE_ENV !== "production";

    const isProductionDatabase =
      databaseName === "siaga" &&
      process.env.NODE_ENV === "production";

    if (!isTestDatabase && !isProductionDatabase) {
      throw new Error(
        `Facility import ditolak: database "${databaseName ?? "unknown"}" tidak diizinkan.`
      );
    }

    // Refuse import when source contains invalid records.
    if (preview.invalidCount > 0) {
      throw new Error(
        `Import dibatalkan: ${preview.invalidCount} baris invalid.`
      );
    }

    // Create import execution history.
    const runResult = await client.query<{ id: string }>(
      `INSERT INTO facility_import_runs (
         source_name,
         mode,
         total_count,
         new_count,
         changed_count,
         unchanged_count,
         invalid_count,
         invalid_rows,
         executed_by
       )
       VALUES (
         $1, 'APPLY', $2, $3, $4, $5, $6, $7::jsonb, $8
       )
       RETURNING id`,
      [
        preview.sourceName,
        preview.total,
        preview.newCount,
        preview.changedCount,
        preview.unchangedCount,
        preview.invalidCount,
        JSON.stringify(preview.invalid),
        actorUserId,
      ]
    );

    const importRunId = runResult.rows[0].id;

    // Insert or update facility records.
    for (const record of preview.records) {
      const existingResult =
        await client.query<ExistingFacility>(
          `SELECT
             id,
             code,
             name,
             initials,
             facility_type,
             latitude,
             longitude
           FROM facilities
           WHERE code = $1
           FOR UPDATE`,
          [record.code]
        );

      const existing = existingResult.rows[0];

      const changes = existing
        ? changedFields(existing, record)
        : {
            created: {
              from: null,
              to: record.code,
            },
          };

      const upsert = await client.query<{ id: string }>(
        `INSERT INTO facilities (
           code,
           name,
           initials,
           facility_type,
           latitude,
           longitude,
           source_name,
           source_synced_at
         )
         VALUES (
           $1, $2, $3, $4, $5, $6, $7, NOW()
         )
         ON CONFLICT (code)
         DO UPDATE SET
           name = EXCLUDED.name,
           initials = EXCLUDED.initials,
           facility_type = EXCLUDED.facility_type,
           latitude = EXCLUDED.latitude,
           longitude = EXCLUDED.longitude,
           source_name = EXCLUDED.source_name,
           source_synced_at = NOW(),
           updated_at = NOW()
         RETURNING id`,
        [
          record.code,
          record.name,
          record.initials,
          record.type,
          record.latitude,
          record.longitude,
          preview.sourceName,
        ]
      );

      // Preserve audit history for new or modified facilities.
      if (
        !existing ||
        Object.keys(changes).length > 0
      ) {
        await client.query(
          `INSERT INTO facility_audit_logs (
             facility_id,
             import_run_id,
             action,
             changed_fields,
             actor_user_id
           )
           VALUES (
             $1, $2, $3, $4::jsonb, $5
           )`,
          [
            upsert.rows[0].id,
            importRunId,
            existing
              ? "SOURCE_UPDATE"
              : "SOURCE_CREATE",
            JSON.stringify(changes),
            actorUserId,
          ]
        );
      }
    }

    // Commit only after all records are processed.
    await client.query("COMMIT");

    return importRunId;
  } catch (error) {
    // Roll back all changes if any step fails.
    await client.query("ROLLBACK");
    throw error;
  }
}
