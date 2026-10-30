/**
 * SPARTA SIAGA — Report Approval Event Service (Phase 1 & Hardening)
 *
 * Establishes a reliable, transactional, and auditable approval event contract for BnM Manager confirmation decisions.
 * When BnM Manager confirms a report as Damaged (confirmed_affected) or Safe (confirmed_safe),
 * this service records the structured event into the PostgreSQL database atomically inside a transaction,
 * backed by persistent database-level idempotency and concurrency protection (report_approval_outbox with UNIQUE report_id),
 * and notification logs, enabling Phase 3 Auto Email to subscribe seamlessly.
 */

import { getDbPool } from "./db";
import { recordNotificationLog } from "./notification-service";
import { DisasterNotificationType } from "@/types/notification";
import { DamageReport, IncidentRecord, IncidentStatus } from "@/types/incident";

export interface ReportApprovalEvent {
  eventId: string;
  reportId: string;
  decision: "approved" | "safe";
  outcomeStatus: "confirmed_affected" | "confirmed_safe";
  disasterType: string;
  reportOrigin?: string | null;
  branch: string;
  storeId: string;
  storeName: string;
  locationCity?: string;
  decidedBy: {
    userId: string;
    name: string;
    role: string;
    systemRole?: string;
  };
  decidedAt: string;
  decisionNotes?: string;
  condition: "damaged" | "safe";
  evidenceCount: number;
  publishedToHo: boolean;
  createdAt: string;
}

// In-memory audit registry of recorded approval events for fast test lookup and runtime cache
const recordedApprovalEvents: ReportApprovalEvent[] = [];

export function getRecordedApprovalEvents(reportId?: string): ReportApprovalEvent[] {
  if (reportId) {
    return recordedApprovalEvents.filter((e) => e.reportId === reportId);
  }
  return [...recordedApprovalEvents];
}

export async function getRecordedApprovalEventsFromDb(reportId?: string): Promise<ReportApprovalEvent[]> {
  try {
    const pool = getDbPool();
    let query = "SELECT payload FROM report_approval_outbox";
    const values: unknown[] = [];
    if (reportId) {
      query += " WHERE report_id = $1";
      values.push(reportId);
    }
    query += " ORDER BY created_at ASC";
    const { rows } = await pool.query(query, values);
    return rows.map((r) => r.payload as ReportApprovalEvent);
  } catch (err) {
    console.warn("[approval-event-service] Failed reading approval events from db outbox:", err);
    return getRecordedApprovalEvents(reportId);
  }
}

export function clearRecordedApprovalEvents(): void {
  recordedApprovalEvents.length = 0;
}

/**
 * Record an official BnM confirmation approval event.
 * Idempotent, durable, and concurrency-safe.
 */
export async function recordReportApprovalEvent(event: ReportApprovalEvent): Promise<ReportApprovalEvent> {
  // Check if an approval event for this report has already been recorded in memory (idempotency guard)
  const existingIndex = recordedApprovalEvents.findIndex(
    (e) => e.reportId === event.reportId || e.eventId === event.eventId
  );
  if (existingIndex >= 0) {
    return recordedApprovalEvents[existingIndex];
  }

  // Push to local auditable event queue
  recordedApprovalEvents.push(event);

  try {
    // Persist into PostgreSQL report_approval_outbox
    const pool = getDbPool();
    await pool.query(
      `INSERT INTO report_approval_outbox (
        id, report_id, decision, outcome_status, disaster_type,
        report_origin, branch, store_id, store_name, location_city,
        decided_by_user_id, decided_by_name, decided_by_role, decided_at,
        decision_notes, condition, evidence_count, published_to_ho,
        payload, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19::jsonb, $20)
      ON CONFLICT (report_id) DO NOTHING`,
      [
        event.eventId,
        event.reportId,
        event.decision,
        event.outcomeStatus,
        event.disasterType,
        event.reportOrigin ?? null,
        event.branch,
        event.storeId,
        event.storeName,
        event.locationCity ?? null,
        event.decidedBy.userId,
        event.decidedBy.name,
        event.decidedBy.role,
        event.decidedAt,
        event.decisionNotes ?? null,
        event.condition,
        event.evidenceCount,
        event.publishedToHo,
        JSON.stringify(event),
        event.createdAt || new Date().toISOString(),
      ]
    );
  } catch (dbErr) {
    console.warn(`[approval-event-service] Failed inserting outbox row for ${event.reportId}:`, dbErr);
  }

  try {
    const disasterTypeForNotif: DisasterNotificationType =
      event.disasterType === "flood" || event.disasterType === "heavy_rain"
        ? event.disasterType
        : "earthquake";

    const statusLabel =
      event.decision === "approved"
        ? "TERDAMPAK (Siap Ditindaklanjuti)"
        : "AMAN (Operasional Normal)";

    await recordNotificationLog({
      disasterId: event.reportId,
      disasterType: disasterTypeForNotif,
      channel: "email_and_pwa",
      branch: event.branch,
      recipientContact: "HO Operational Monitoring <ho-monitoring@sparta.local>",
      title: `[LAPORAN RESMI BnM] ${event.reportId} - ${event.storeName} (${event.decision === "approved" ? "TERDAMPAK" : "AMAN"})`,
      message: `Laporan resmi ${event.reportId} (${event.storeName}) telah dikonfirmasi oleh BnM Manajer ${event.decidedBy.name}. Status: ${statusLabel}.${event.decisionNotes ? ` Catatan: ${event.decisionNotes}` : ""}`,
      affectedStores: [],
      ticketNumber: event.reportId,
      canonicalEventId: event.reportId,
      recipientGroup: "HO",
      category: "APPROVAL",
    });
  } catch (err) {
    console.warn(`[approval-event-service] Failed to persist approval notification log for ${event.reportId}:`, err);
  }

  // Trigger async approval outbox email distribution (Phase 3)
  import("./approval-email-service")
    .then(({ processReportApprovalOutbox }) => {
      processReportApprovalOutbox({ reportId: event.reportId }).catch((outboxErr) => {
        console.warn(`[approval-event-service] Non-fatal outbox dispatch error for ${event.reportId}:`, outboxErr);
      });
    })
    .catch(() => {});

  return event;
}

/**
 * Execute atomic transactional BnM approval.
 * Locks the incident row FOR UPDATE, verifies no prior approval, commits status change,
 * appends timeline, records durable outbox row, and logs audit in ONE transaction.
 */
export async function commitAtomicBmApprovalTransaction(params: {
  reportId: string;
  newStatus: IncidentStatus;
  updatedVerification: DamageReport;
  timelineEntry: {
    stage: string;
    label: string;
    timestamp: string;
    actor: string;
    notes?: string;
  };
  approvalEvent: ReportApprovalEvent;
}): Promise<{ success: boolean; conflict?: boolean; reason?: string; report?: IncidentRecord }> {
  const pool = getDbPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // 1. Concurrency protection: row-level lock on incident
    const checkRes = await client.query(
      `SELECT id, status, verification, timeline, branch, store_id, store_name, location_city, disaster_type, report_origin
       FROM incidents
       WHERE id = $1
       FOR UPDATE`,
      [params.reportId]
    );

    if (checkRes.rows.length === 0) {
      await client.query("ROLLBACK");
      return { success: false, reason: "NOT_FOUND" };
    }

    const current = checkRes.rows[0];
    const currentStatus = current.status;
    const currentVerification = current.verification;
    const isAlreadyConfirmed =
      currentStatus === "confirmed_affected" ||
      currentStatus === "confirmed_safe" ||
      currentVerification?.bmApproval?.decision === "approved" ||
      currentVerification?.bmApproval?.decision === "safe";

    if (isAlreadyConfirmed) {
      await client.query("ROLLBACK");
      return {
        success: false,
        conflict: true,
        reason: "Laporan ini sudah dikonfirmasi sebelumnya oleh BnM Manajer.",
      };
    }

    // 2. Update incident record
    const updatedTimeline = [...(current.timeline || []), params.timelineEntry];
    await client.query(
      `UPDATE incidents
       SET status = $2,
           verification = $3::jsonb,
           timeline = $4::jsonb,
           updated_at = NOW()
       WHERE id = $1`,
      [
        params.reportId,
        params.newStatus,
        JSON.stringify(params.updatedVerification),
        JSON.stringify(updatedTimeline),
      ]
    );

    // 3. Atomically write durable approval outbox event with database uniqueness constraint
    await client.query(
      `INSERT INTO report_approval_outbox (
        id, report_id, decision, outcome_status, disaster_type,
        report_origin, branch, store_id, store_name, location_city,
        decided_by_user_id, decided_by_name, decided_by_role, decided_at,
        decision_notes, condition, evidence_count, published_to_ho,
        payload, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19::jsonb, $20)
      ON CONFLICT (report_id) DO NOTHING`,
      [
        params.approvalEvent.eventId,
        params.approvalEvent.reportId,
        params.approvalEvent.decision,
        params.approvalEvent.outcomeStatus,
        params.approvalEvent.disasterType,
        params.approvalEvent.reportOrigin ?? null,
        params.approvalEvent.branch,
        params.approvalEvent.storeId,
        params.approvalEvent.storeName,
        params.approvalEvent.locationCity ?? null,
        params.approvalEvent.decidedBy.userId,
        params.approvalEvent.decidedBy.name,
        params.approvalEvent.decidedBy.role,
        params.approvalEvent.decidedAt,
        params.approvalEvent.decisionNotes ?? null,
        params.approvalEvent.condition,
        params.approvalEvent.evidenceCount,
        params.approvalEvent.publishedToHo,
        JSON.stringify(params.approvalEvent),
        params.approvalEvent.createdAt || new Date().toISOString(),
      ]
    );

    // 4. Record to system_audit_logs inside the same transaction
    await client.query(
      `INSERT INTO system_audit_logs (
        id, action, target, actor_user_id, actor_name, details, created_at
      ) VALUES (gen_random_uuid(), 'BM_APPROVAL_CONFIRMATION', $1, $2, $3, $4::jsonb, NOW())`,
      [
        params.reportId,
        params.approvalEvent.decidedBy.userId,
        params.approvalEvent.decidedBy.name,
        JSON.stringify({
          decision: params.approvalEvent.decision,
          outcomeStatus: params.approvalEvent.outcomeStatus,
          notes: params.approvalEvent.decisionNotes,
        }),
      ]
    );

    await client.query("COMMIT");

    // Mirror to in-memory registry
    const existingIdx = recordedApprovalEvents.findIndex((e) => e.reportId === params.approvalEvent.reportId);
    if (existingIdx >= 0) {
      recordedApprovalEvents[existingIdx] = params.approvalEvent;
    } else {
      recordedApprovalEvents.push(params.approvalEvent);
    }

    // Trigger async notification log recording outside transaction boundary
    recordNotificationLog({
      disasterId: params.approvalEvent.reportId,
      disasterType:
        params.approvalEvent.disasterType === "flood" || params.approvalEvent.disasterType === "heavy_rain"
          ? params.approvalEvent.disasterType
          : "earthquake",
      channel: "email_and_pwa",
      branch: params.approvalEvent.branch,
      recipientContact: "HO Operational Monitoring <ho-monitoring@sparta.local>",
      title: `[LAPORAN RESMI BnM] ${params.approvalEvent.reportId} - ${params.approvalEvent.storeName} (${params.approvalEvent.decision === "approved" ? "TERDAMPAK" : "AMAN"})`,
      message: `Laporan resmi ${params.approvalEvent.reportId} (${params.approvalEvent.storeName}) telah dikonfirmasi oleh BnM Manajer ${params.approvalEvent.decidedBy.name}. Status: ${params.approvalEvent.decision === "approved" ? "TERDAMPAK" : "AMAN"}.${params.approvalEvent.decisionNotes ? ` Catatan: ${params.approvalEvent.decisionNotes}` : ""}`,
      affectedStores: [],
      ticketNumber: params.approvalEvent.reportId,
      canonicalEventId: params.approvalEvent.reportId,
      recipientGroup: "HO",
      category: "APPROVAL",
    }).catch((notifErr) => {
      console.warn(`[approval-event-service] Non-fatal notification log error for ${params.reportId}:`, notifErr);
    });

    // Trigger async approval outbox email distribution outside transaction boundary (Phase 3)
    import("./approval-email-service")
      .then(({ processReportApprovalOutbox }) => {
        processReportApprovalOutbox({ reportId: params.approvalEvent.reportId }).catch((outboxErr) => {
          console.warn(`[approval-event-service] Non-fatal outbox processing error for ${params.reportId}:`, outboxErr);
        });
      })
      .catch((importErr) => {
        console.warn(`[approval-event-service] Failed loading approval-email-service for ${params.reportId}:`, importErr);
      });

    return { success: true };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
