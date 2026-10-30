import { getDbPool } from "./db";
import { IncidentRecord, ManagementInstruction } from "@/types/incident";

export function rowToIncident(row: Record<string, unknown>): IncidentRecord {
  return {
    id: row.id as string,
    date: row.date as string,
    disasterType: row.disaster_type as IncidentRecord["disasterType"],
    reportOrigin: (row.report_origin as IncidentRecord["reportOrigin"]) || undefined,
    reporter: (row.reporter as IncidentRecord["reporter"]) ?? undefined,
    earthquakeEventId: (row.earthquake_event_id as string) ?? undefined,
    earthquakeSource: (row.earthquake_source as string) ?? undefined,
    earthquakeProvenance: (row.earthquake_provenance as string) ?? undefined,
    tkpType: (row.tkp_type as IncidentRecord["tkpType"]) ?? undefined,
    storeId: row.store_id as string,
    storeName: (row.location_name_snapshot ?? row.store_name ?? "Lokasi tanpa nama") as string,
    branch: row.branch as string,
    locationCity: row.location_city as string,
    locationKind: (row.location_kind as IncidentRecord["locationKind"]) ?? undefined,
    locationId: (row.location_id as string) ?? undefined,
    locationCodeSnapshot: (row.location_code_snapshot as string) ?? undefined,
    locationNameSnapshot: (row.location_name_snapshot as string) ?? undefined,
    primaryPicUserId: (row.primary_pic_user_id as string) ?? undefined,
    primaryPicClaimedAt: row.primary_pic_claimed_at ? String(row.primary_pic_claimed_at) : undefined,
    primaryPicName: (row.primary_pic_name as string) ?? undefined,
    status: row.status as IncidentRecord["status"],
    progress: row.progress as number,
    completionApprovalStatus: (row.completion_approval_status as string) ?? undefined,
    disasterMetadata: (row.disaster_metadata as IncidentRecord["disasterMetadata"]) ?? undefined,
    affectedStores: (row.affected_stores as IncidentRecord["affectedStores"]) ?? undefined,
    affectedStoreCount: (row.affected_store_count as number) ?? undefined,
    dangerStoreCount: (row.danger_store_count as number) ?? undefined,
    verification: (row.verification as IncidentRecord["verification"]) ?? undefined,
    maintenanceTicket: (row.maintenance_ticket as IncidentRecord["maintenanceTicket"]) ?? undefined,
    fieldPhotos: (row.field_photos as string[]) ?? [],
    timeline: (row.timeline as IncidentRecord["timeline"]) ?? [],
    externalWorkId: (row.external_work_id as string) ?? undefined,
    externalSystem: (row.external_system as string) ?? undefined,
    externalWorkStatus: (row.external_work_status as string) ?? undefined,
    externalSyncedAt: row.external_synced_at
      ? row.external_synced_at instanceof Date
        ? (row.external_synced_at as Date).toISOString()
        : (row.external_synced_at as string)
      : undefined,
    createdAt:
      row.created_at instanceof Date
        ? (row.created_at as Date).toISOString()
        : (row.created_at as string),
    updatedAt:
      row.updated_at instanceof Date
        ? (row.updated_at as Date).toISOString()
        : (row.updated_at as string),
    closedAt: row.closed_at
      ? row.closed_at instanceof Date
        ? (row.closed_at as Date).toISOString()
        : (row.closed_at as string)
      : undefined,
    reminder24hSentAt: row.reminder_24h_sent_at
      ? row.reminder_24h_sent_at instanceof Date
        ? (row.reminder_24h_sent_at as Date).toISOString()
        : (row.reminder_24h_sent_at as string)
      : undefined,
    expiredAt: row.expired_at
      ? row.expired_at instanceof Date
        ? (row.expired_at as Date).toISOString()
        : (row.expired_at as string)
      : undefined,
  };
}

export async function dbGetAllIncidents(): Promise<IncidentRecord[]> {
  const pool = getDbPool();
  const { rows } = await pool.query(
    `SELECT i.*, u.name AS primary_pic_name,
            ca.status AS completion_approval_status
     FROM incidents i
     LEFT JOIN users u ON u.id = i.primary_pic_user_id
     LEFT JOIN report_completion_approvals ca ON ca.report_id = i.id
     WHERE i.id NOT LIKE 'INC-TEST-%'
     ORDER BY i.created_at DESC`
  );
  return rows.map(rowToIncident);
}

export async function dbGetIncidentById(
  id: string
): Promise<IncidentRecord | null> {
  const pool = getDbPool();
  const sql = `SELECT i.*, u.name AS primary_pic_name,
            ca.status AS completion_approval_status
     FROM incidents i
     LEFT JOIN users u ON u.id = i.primary_pic_user_id
     LEFT JOIN report_completion_approvals ca ON ca.report_id = i.id
     WHERE i.id = $1`;
  try {
    const { rows } = await pool.query(sql, [id]);
    if (rows.length === 0) return null;
    return rowToIncident(rows[0]);
  } catch (err: any) {
    if (err?.message && err.message.includes("Connection terminated unexpectedly")) {
      const { rows } = await pool.query(sql, [id]);
      if (rows.length === 0) return null;
      return rowToIncident(rows[0]);
    }
    throw err;
  }
}

// Lookup existing auto-report by event and store, falling back to branch for legacy data.
export async function dbFindAutoEarthquakeReport(
  earthquakeEventId: string,
  targetId: string,
  branch?: string
): Promise<IncidentRecord | null> {
  const pool = getDbPool();
  // 1. Primary lookup by exact store
  const storeRes = await pool.query(
    `SELECT * FROM incidents
     WHERE earthquake_event_id = $1 AND store_id = $2 AND report_origin = 'automatic_earthquake'
     LIMIT 1`,
    [earthquakeEventId, targetId]
  );
  if (storeRes.rows.length > 0) return rowToIncident(storeRes.rows[0]);

  // 2. Legacy fallback lookup by branch (only match legacy branch records where store_id equals the branch or is null/empty)
  const branchLookup = branch || targetId;
  const branchRes = await pool.query(
    `SELECT * FROM incidents
     WHERE earthquake_event_id = $1 
       AND branch = $2 
       AND (store_id = $2 OR store_id IS NULL OR store_id = '')
       AND report_origin = 'automatic_earthquake'
     LIMIT 1`,
    [earthquakeEventId, branchLookup]
  );
  if (branchRes.rows.length > 0) return rowToIncident(branchRes.rows[0]);

  return null;
}

// Find manual report linked to this event, checking store first then branch.
export async function dbFindManualEarthquakeReportByEvent(
  earthquakeEventId: string,
  storeIdOrBranch: string,
  branch?: string
): Promise<IncidentRecord | null> {
  const pool = getDbPool();
  const storeRes = await pool.query(
    `SELECT * FROM incidents
     WHERE earthquake_event_id = $1
       AND store_id = $2 
       AND report_origin = 'manual'
     ORDER BY created_at DESC
     LIMIT 1`,
    [earthquakeEventId, storeIdOrBranch]
  );
  if (storeRes.rows.length > 0) return rowToIncident(storeRes.rows[0]);

  if (branch) {
    const branchRes = await pool.query(
      `SELECT * FROM incidents
       WHERE earthquake_event_id = $1
         AND branch = $2 
         AND (store_id = $2 OR store_id IS NULL OR store_id = '')
         AND report_origin = 'manual'
       ORDER BY created_at DESC
       LIMIT 1`,
      [earthquakeEventId, branch]
    );
    if (branchRes.rows.length > 0) return rowToIncident(branchRes.rows[0]);
  }

  return null;
}

// Find unlinked manual earthquake reports for the specific store within time window.
export async function dbFindUnlinkedManualEarthquakeCandidates(
  storeId: string,
  eventTimestamp: number,
  windowMinutes: number = 120
): Promise<IncidentRecord[]> {
  const pool = getDbPool();
  const eventDate = new Date(eventTimestamp);
  const minTime = new Date(eventDate.getTime() - windowMinutes * 60 * 1000);
  const maxTime = new Date(eventDate.getTime() + windowMinutes * 60 * 1000);

  const { rows } = await pool.query(
    `SELECT * FROM incidents
     WHERE store_id = $1
       AND disaster_type = 'earthquake'
       AND report_origin = 'manual'
       AND earthquake_event_id IS NULL
       AND created_at >= $2 AND created_at <= $3
     ORDER BY created_at ASC`,
    [storeId, minTime.toISOString(), maxTime.toISOString()]
  );
  return rows.map(rowToIncident);
}

let isReporterColumnEnsured = false;
async function ensureReporterColumn(pool: ReturnType<typeof getDbPool>) {
  if (isReporterColumnEnsured) return;
  try {
    await pool.query(`ALTER TABLE incidents ADD COLUMN IF NOT EXISTS reporter JSONB;`);
    await pool.query(`ALTER TABLE incidents ADD COLUMN IF NOT EXISTS reminder_24h_sent_at TIMESTAMP WITH TIME ZONE;`);
    await pool.query(`ALTER TABLE incidents ADD COLUMN IF NOT EXISTS expired_at TIMESTAMP WITH TIME ZONE;`);
    isReporterColumnEnsured = true;
  } catch (err) {
    console.warn("[incident-db] Failed to alter table incidents for reporter/lifecycle columns:", err);
  }
}

export async function dbCreateIncident(
  inc: IncidentRecord
): Promise<IncidentRecord> {
  const pool = getDbPool();
  await ensureReporterColumn(pool);
  const isFacility = inc.locationKind === "FACILITY"
    || inc.tkpType === "dc"
    || (inc.tkpType as string) === "DC"
    || (inc.storeId && (inc.storeId.startsWith("FACILITY:") || inc.storeId.startsWith("FAC-")));
  const resolvedLocationKind = inc.locationKind
    ? inc.locationKind
    : (isFacility ? "FACILITY" : inc.storeId ? "STORE" : null);
  const resolvedLocationId = inc.locationId
    ? inc.locationId
    : (inc.storeId ? inc.storeId.replace(/^FACILITY:/, "") : null);
  try {
    const { rows } = await pool.query(
    `INSERT INTO incidents (
      id, date, disaster_type, report_origin, reporter,
      earthquake_event_id, earthquake_source, earthquake_provenance,
      tkp_type, store_id, store_name, branch, location_city,
      status, progress,
      disaster_metadata, affected_stores, affected_store_count, danger_store_count,
      verification, maintenance_ticket, field_photos,
      timeline, created_at, updated_at, closed_at,
      canonical_event_id, location_kind, location_id
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29)
    ON CONFLICT (id) DO UPDATE SET
      status                   = EXCLUDED.status,
      progress                 = EXCLUDED.progress,
      reporter                 = COALESCE(EXCLUDED.reporter, incidents.reporter),
      disaster_metadata        = EXCLUDED.disaster_metadata,
      affected_stores          = EXCLUDED.affected_stores,
      affected_store_count     = EXCLUDED.affected_store_count,
      danger_store_count       = EXCLUDED.danger_store_count,
      verification             = EXCLUDED.verification,
      maintenance_ticket       = EXCLUDED.maintenance_ticket,
      field_photos             = EXCLUDED.field_photos,
      timeline                 = EXCLUDED.timeline,
      updated_at               = NOW()
    RETURNING *`,
    [
      inc.id,
      inc.date ?? inc.createdAt ?? new Date().toISOString(),
      inc.disasterType,
      inc.reportOrigin ?? "manual",
      inc.reporter ? JSON.stringify(inc.reporter) : null,
      inc.earthquakeEventId ?? null,
      inc.earthquakeSource ?? null,
      inc.earthquakeProvenance ?? null,
      inc.tkpType ?? null,
      inc.storeId,
      inc.storeName,
      inc.branch,
      inc.locationCity,
      inc.status,
      inc.progress,
      inc.disasterMetadata ? JSON.stringify(inc.disasterMetadata) : null,
      inc.affectedStores ? JSON.stringify(inc.affectedStores) : null,
      inc.affectedStoreCount ?? 0,
      inc.dangerStoreCount ?? 0,
      inc.verification ? JSON.stringify(inc.verification) : null,
      inc.maintenanceTicket ? JSON.stringify(inc.maintenanceTicket) : null,
      JSON.stringify(inc.fieldPhotos ?? []),
      JSON.stringify(inc.timeline ?? []),
      inc.createdAt ?? new Date().toISOString(),
      inc.updatedAt ?? new Date().toISOString(),
      inc.closedAt ?? null,
      inc.disasterType === "earthquake" ? inc.earthquakeEventId ?? null : null,
      resolvedLocationKind,
      resolvedLocationKind ? resolvedLocationId : null,
    ]
  );
  return rowToIncident(rows[0]);
  } catch (error: unknown) {
    const pgError = error as { code?: string; constraint?: string };
    const autoConstraints = [
      'idx_incidents_unique_auto_eq_store',
      'idx_incidents_unique_auto_eq_branch',
      'uq_incident_event_store_v1',
      'idx_incidents_unique_earthquake_location',
    ];
    if (pgError.code === '23505' && autoConstraints.includes(pgError.constraint || '')) {
      console.warn(`[SPARTA SIAGA] Race condition caught: event ${inc.earthquakeEventId} at store ${inc.storeId}. Returning existing record.`);
      const existing = await dbFindAutoEarthquakeReport(inc.earthquakeEventId!, inc.storeId, inc.branch);
      if (existing) return existing;
    }
    throw error;
  }
}

export async function dbUpdateIncident(
  id: string,
  patch: Partial<IncidentRecord>
): Promise<IncidentRecord | null> {
  const pool = getDbPool();
  await ensureReporterColumn(pool);
  const setClauses: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  const scalarFieldMap: Record<string, string> = {
    status: "status",
    progress: "progress",
    disasterType: "disaster_type",
    storeName: "store_name",
    branch: "branch",
    locationCity: "location_city",
    date: "date",
    storeId: "store_id",
    tkpType: "tkp_type",
    locationKind: "location_kind",
    locationId: "location_id",
    locationCodeSnapshot: "location_code_snapshot",
    locationNameSnapshot: "location_name_snapshot",
    locationTypeSnapshot: "location_type_snapshot",
    branchSnapshot: "branch_snapshot",
    primaryPicUserId: "primary_pic_user_id",
    primaryPicClaimedAt: "primary_pic_claimed_at",
    earthquakeEventId: "earthquake_event_id",
    earthquakeSource: "earthquake_source",
    earthquakeProvenance: "earthquake_provenance",
    affectedStoreCount: "affected_store_count",
    dangerStoreCount: "danger_store_count",
    externalWorkId: "external_work_id",
    externalSystem: "external_system",
    externalWorkStatus: "external_work_status",
    externalSyncedAt: "external_synced_at",
    reminder24hSentAt: "reminder_24h_sent_at",
    expiredAt: "expired_at",
  };

  for (const [key, col] of Object.entries(scalarFieldMap)) {
    if (key in patch) {
      setClauses.push(`${col} = $${idx++}`);
      values.push((patch as Record<string, unknown>)[key]);
    }
  }

  const jsonbFieldMap: Record<string, string> = {
    reporter: "reporter",
    disasterMetadata: "disaster_metadata",
    affectedStores: "affected_stores",
    verification: "verification",
    maintenanceTicket: "maintenance_ticket",
    fieldPhotos: "field_photos",
    timeline: "timeline",
  };

  for (const [key, col] of Object.entries(jsonbFieldMap)) {
    if (key in patch) {
      setClauses.push(`${col} = $${idx++}`);
      values.push(JSON.stringify((patch as Record<string, unknown>)[key]));
    }
  }

  if (patch.closedAt !== undefined) {
    setClauses.push(`closed_at = $${idx++}`);
    values.push(patch.closedAt);
  }

  setClauses.push(`updated_at = NOW()`);
  values.push(id);

  const { rows } = await pool.query(
    `UPDATE incidents SET ${setClauses.join(", ")} WHERE id = $${idx} RETURNING *`,
    values
  );
  if (rows.length === 0) return null;
  return rowToIncident(rows[0]);
}

export async function dbDeleteIncident(id: string): Promise<boolean> {
  const pool = getDbPool();
  const { rowCount } = await pool.query(
    `DELETE FROM incidents WHERE id = $1`,
    [id]
  );
  return (rowCount ?? 0) > 0;
}

// ============================================================
// Management Instructions DB operations
// ============================================================

export async function dbCreateInstruction(
  instruction: import("@/types/incident").ManagementInstruction
): Promise<void> {
  const pool = getDbPool();
  await pool.query(
    `INSERT INTO report_instructions (
      instruction_id, report_id, instruction_text,
      author_id, author_name, author_role,
      created_at, delivery_status, target_roles, delivery_channel, delivery_log
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [
      instruction.instruction_id,
      instruction.report_id,
      instruction.instruction_text,
      instruction.author_id,
      instruction.author_name,
      instruction.author_role,
      instruction.created_at,
      instruction.delivery_status,
      JSON.stringify(instruction.target_roles),
      instruction.delivery_channel,
      instruction.delivery_log ?? null,
    ]
  );
}

export async function dbGetInstructionsByReport(
  reportId: string
): Promise<import("@/types/incident").ManagementInstruction[]> {
  const pool = getDbPool();
  const { rows } = await pool.query(
    `SELECT * FROM report_instructions WHERE report_id = $1 ORDER BY created_at ASC`,
    [reportId]
  );
  return rows.map((row) => ({
    instruction_id: row.instruction_id as string,
    report_id: row.report_id as string,
    instruction_text: row.instruction_text as string,
    author_id: row.author_id as string,
    author_name: row.author_name as string,
    author_role: row.author_role as "gm_ho" | "sm_ho",
    created_at: row.created_at instanceof Date
      ? (row.created_at as Date).toISOString()
      : (row.created_at as string),
    delivery_status: row.delivery_status as ManagementInstruction["delivery_status"],
    target_roles: (row.target_roles as ManagementInstruction["target_roles"]) ?? [],
    delivery_channel: "wa" as const,
    delivery_log: (row.delivery_log as string) ?? undefined,
  }));
}
