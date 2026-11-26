import { getDbPool } from "./db";
import { IncidentRecord, IncidentStatus } from "@/types/incident";
import { rowToIncident } from "./incident-db";
import { recordNotificationLog } from "./notification-service";
import { DisasterNotificationType } from "@/types/notification";
import { isDevelopmentReadOnlyMode } from "./environment-policy";

export interface LifecycleProcessOptions {
  now?: Date | number;
  includeTestIds?: boolean;
}

export interface LifecycleProcessResult {
  evaluatedCount: number;
  remindersSent: number;
  expiredCount: number;
  skippedInspectedCount: number;
  processedIds: string[];
  expiredReportIds: string[];
  reminderReportIds: string[];
}

let isLifecycleSchemaEnsured = false;
export async function ensureLifecycleSchema(): Promise<void> {
  if (isLifecycleSchemaEnsured || isDevelopmentReadOnlyMode()) return;
  try {
    const pool = getDbPool();
    await pool.query(`ALTER TABLE incidents ADD COLUMN IF NOT EXISTS reminder_24h_sent_at TIMESTAMP WITH TIME ZONE;`);
    await pool.query(`ALTER TABLE incidents ADD COLUMN IF NOT EXISTS expired_at TIMESTAMP WITH TIME ZONE;`);
    isLifecycleSchemaEnsured = true;
  } catch (err) {
    console.warn("[report-lifecycle-service] Schema ensure warning:", err);
  }
}

/**
 * Checks whether an incident has received a valid initial inspection.
 * An inspection is valid if:
 * 1. An inspector submitted it (verification.confirmedBy exists)
 * 2. Field evidence was attached (verification.photos or verification.evidenceDetails has items)
 * 3. Or the report has transitioned to an inspected/active handling state
 *    (pending_bm_approval, clarification_requested, confirmed_affected, in_estimation, in_maintenance, etc.)
 */
export function hasValidInitialInspection(report: IncidentRecord): boolean {
  if (!report) return false;

  const postInspectionStatuses = new Set<string>([
    "pending_bm_approval",
    "clarification_requested",
    "confirmed_affected",
    "in_estimation",
    "awaiting_spk",
    "spk_issued",
    "in_maintenance",
    "in_construction",
    "awaiting_st",
    "pending_final_approval",
    "approved_pending_close",
    "revision_requested",
    "confirmed_safe",
    "rejected_invalid",
    "closed",
    "resolved",
    "archived",
  ]);

  if (postInspectionStatuses.has(report.status)) {
    return true;
  }

  const ver = report.verification;
  if (ver) {
    if (typeof ver.confirmedBy === "string" && ver.confirmedBy.trim().length > 0) {
      return true;
    }
    if (Array.isArray(ver.photos) && ver.photos.length > 0) {
      return true;
    }
    if (Array.isArray(ver.evidenceDetails) && ver.evidenceDetails.length > 0) {
      return true;
    }
    if (ver.condition === "safe" || ver.condition === "damaged" || ver.condition === "uncertain") {
      return true;
    }
  }

  return false;
}

/**
 * Check if the report has already received a 24-hour reminder in its timeline or metadata
 */
function has24hReminderInAuditTrail(report: IncidentRecord): boolean {
  if (report.reminder24hSentAt) return true;
  if (Array.isArray(report.timeline)) {
    return report.timeline.some((t) =>
      (typeof t.activity === "string" && t.activity.includes("Pengingat Pemeriksaan 24 Jam")) ||
      (typeof t.label === "string" && t.label.includes("Pengingat Pemeriksaan 24 Jam")) ||
      t.stage === "REMINDER_24H"
    );
  }
  return false;
}

/**
 * Server-side reliable, idempotent, and concurrency-safe processor for report expiration and reminders.
 * - 24 hours without valid initial inspection -> sends ONE reminder to responsible branch.
 * - 48 hours without valid initial inspection -> automatically transitions report to `expired_unhandled` (Tidak Ditindaklanjuti).
 * - Preserves original verification status, evidence, and complete audit trail.
 * - Never classifies unverified earthquake reports as safe or damaged.
 */
export async function processReportLifecycles(
  options: LifecycleProcessOptions = {}
): Promise<LifecycleProcessResult> {
  await ensureLifecycleSchema();
  const pool = getDbPool();

  const currentTime = options.now
    ? (options.now instanceof Date ? options.now : new Date(options.now))
    : new Date();

  const result: LifecycleProcessResult = {
    evaluatedCount: 0,
    remindersSent: 0,
    expiredCount: 0,
    skippedInspectedCount: 0,
    processedIds: [],
    expiredReportIds: [],
    reminderReportIds: [],
  };

  // Query reports that are currently in initial unhandled states
  const testFilter = options.includeTestIds ? "" : "AND i.id NOT LIKE 'INC-TEST-%'";
  const query = `
    SELECT i.*, u.name AS primary_pic_name, ca.status AS completion_approval_status
    FROM incidents i
    LEFT JOIN users u ON u.id = i.primary_pic_user_id
    LEFT JOIN report_completion_approvals ca ON ca.report_id = i.id
    WHERE i.status IN ('pending_confirmation', 'verifying')
      ${testFilter}
    ORDER BY i.created_at ASC
  `;

  const { rows } = await pool.query(query);
  const reports = rows.map(rowToIncident);
  result.evaluatedCount = reports.length;

  for (const report of reports) {
    result.processedIds.push(report.id);

    // Rule: Prevent expiration and reminder if a valid initial inspection has already been submitted
    if (hasValidInitialInspection(report)) {
      result.skippedInspectedCount++;
      continue;
    }

    const createdAtDate = new Date(report.createdAt);
    if (isNaN(createdAtDate.getTime())) {
      continue;
    }

    const ageMs = currentTime.getTime() - createdAtDate.getTime();
    const ageHours = ageMs / (1000 * 60 * 60);

    const nowIso = currentTime.toISOString();
    const nowWib = currentTime.toLocaleString("id-ID", { timeZone: "Asia/Jakarta" }) + " WIB";

    // 1. After 48 hours without a valid initial inspection:
    // Transition to expired_unhandled (Tidak Ditindaklanjuti)
    if (ageHours >= 48) {
      const expirationTimelineEntry = {
        stage: "EXPIRED_UNHANDLED",
        label: "Laporan Kedaluwarsa Otomatis (Tidak Ditindaklanjuti)",
        activity: "Laporan Kedaluwarsa Otomatis (Tidak Ditindaklanjuti)",
        actor: "SISTEM",
        timestamp: nowWib,
        notes: `Laporan otomatis dialihkan ke riwayat setelah ${Math.floor(ageHours)} jam tanpa pemeriksaan fisik awal dari cabang. Status verifikasi dan bukti asli dipertahankan tanpa perubahan klasifikasi.`,
      };

      // Atomic, concurrency-safe transition
      const updateRes = await pool.query(
        `UPDATE incidents
         SET status = 'expired_unhandled',
             closed_at = $1,
             expired_at = $1,
             timeline = COALESCE(timeline, '[]'::jsonb) || $2::jsonb,
             updated_at = NOW()
         WHERE id = $3
           AND status IN ('pending_confirmation', 'verifying')
           AND (verification IS NULL OR verification->>'confirmedBy' IS NULL)
         RETURNING id`,
        [nowIso, JSON.stringify([expirationTimelineEntry]), report.id]
      );

      if ((updateRes.rowCount ?? 0) > 0) {
        result.expiredCount++;
        result.expiredReportIds.push(report.id);
      }
      continue;
    }

    // 2. After 24 hours without a valid initial inspection (and < 48 hours):
    // Send ONE reminder to the responsible branch
    if (ageHours >= 24 && ageHours < 48) {
      if (has24hReminderInAuditTrail(report)) {
        // Already reminded, skip idempotently
        continue;
      }

      const reminderTimelineEntry = {
        stage: "REMINDER_24H",
        label: "Pengingat Pemeriksaan 24 Jam Dikirim ke Cabang",
        activity: "Pengingat Pemeriksaan 24 Jam Dikirim ke Cabang",
        actor: "SISTEM",
        timestamp: nowWib,
        notes: `Pengingat otomatis telah dikirim ke cabang ${report.branch}. Batas waktu tersisa ${Math.max(0, Math.floor(48 - ageHours))} jam sebelum laporan otomatis kedaluwarsa.`,
      };

      // Atomic conditional update ensuring exactly one reminder is sent
      const reminderUpdate = await pool.query(
        `UPDATE incidents
         SET reminder_24h_sent_at = $1,
             timeline = COALESCE(timeline, '[]'::jsonb) || $2::jsonb,
             updated_at = NOW()
         WHERE id = $3
           AND reminder_24h_sent_at IS NULL
           AND status IN ('pending_confirmation', 'verifying')
           AND (verification IS NULL OR verification->>'confirmedBy' IS NULL)
         RETURNING id`,
        [nowIso, JSON.stringify([reminderTimelineEntry]), report.id]
      );

      if ((reminderUpdate.rowCount ?? 0) > 0) {
        // Dispatch official notification record to responsible branch
        try {
          const notificationDisasterType: DisasterNotificationType =
            report.disasterType === "flood" || report.disasterType === "heavy_rain"
              ? report.disasterType
              : "earthquake";

          await recordNotificationLog({
            disasterId: report.id,
            disasterType: notificationDisasterType,
            channel: "email_and_pwa",
            branch: report.branch || "HO",
            recipientContact: `Duty Officer DC Cabang ${report.branch || "Terkait"}`,
            title: `[PENGINGAT 24 JAM] Pemeriksaan Awal Diperlukan: ${report.storeName || report.id}`,
            message: `Laporan ${report.id} (${report.storeName || report.storeId}) belum menerima pemeriksaan fisik awal dalam 24 jam. Harap segera lakukan pemeriksaan lapangan sebelum batas 48 jam kedaluwarsa otomatis.`,
            affectedStores: [],
            ticketNumber: report.maintenanceTicket?.ticketId || report.id,
            canonicalEventId: report.earthquakeEventId || report.id,
            recipientGroup: "BMS",
            category: "ASSIGNMENT",
          });
        } catch (notifErr) {
          console.warn(`[report-lifecycle-service] Failed to record reminder notification log for ${report.id}:`, notifErr);
        }

        result.remindersSent++;
        result.reminderReportIds.push(report.id);
      }
    }
  }

  return result;
}
