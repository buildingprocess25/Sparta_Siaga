/**
 * SPARTA SIAGA — Head Office Approval Email Distribution Service (Phase 3)
 *
 * Automatically dispatches official notification emails to authorized Head Office (HO)
 * recipients when a disaster report receives initial confirmation from BnM Manager.
 *
 * Architectural Guarantees:
 * 1. Durable Outbox Pattern: Reuses `report_approval_outbox` table with atomic processing.
 * 2. Idempotency & Concurrency: Uses `FOR UPDATE SKIP LOCKED` and unique dedup keys to prevent duplicate deliveries.
 * 3. Audit & Traceability: Logs delivery records into `report_distributions` and updates `notification_logs`.
 * 4. Safe Retry & Error Tracking: Handles transient SMTP failures with bounded retries and detailed logging.
 * 5. Testing Isolation: Suppresses live email dispatch when Testing Mode is active.
 */

import { getDbPool } from "./db";
import { ReportApprovalEvent } from "./approval-event-service";
import {
  sendHoApprovalNotificationEmail,
  EmailSendResult,
} from "./email-service";
import { getRuntimeConfig } from "./runtime-config";

export interface HoApprovalRecipient {
  userId: string;
  name: string;
  email: string;
  role: string;
}

export interface ApprovalEmailDispatchResult {
  recipient: string;
  userId: string;
  status: "sent" | "failed" | "not_configured" | "suppressed_testing_mode" | "deduplicated";
  providerMessageId?: string;
  errorMessage?: string;
  sentAt?: string;
}

export interface ProcessOutboxResult {
  outboxId: string;
  reportId: string;
  decision: "approved" | "safe";
  branch: string;
  totalRecipients: number;
  dispatches: ApprovalEmailDispatchResult[];
  processed: boolean;
  retryScheduled?: boolean;
}

const MAX_OUTBOX_RETRIES = 3;

/**
 * Resolves all active, authorized Head Office monitoring recipients from the database.
 * Deduplicates by normalized email address.
 */
export async function getAuthorizedHoRecipients(): Promise<HoApprovalRecipient[]> {
  try {
    const pool = getDbPool();
    const { rows } = await pool.query(
      `SELECT id, name, email, business_role, scope
       FROM users
       WHERE (scope = 'HO' OR business_role IN ('ho_admin', 'gm_ho', 'sm_ho'))
         AND status = 'ACTIVE'
         AND email IS NOT NULL
         AND TRIM(email) != ''
       ORDER BY id ASC`
    );

    const seenEmails = new Set<string>();
    const recipients: HoApprovalRecipient[] = [];

    for (const r of rows) {
      const emailNorm = (r.email || "").trim().toLowerCase();
      if (!emailNorm || seenEmails.has(emailNorm)) continue;
      seenEmails.add(emailNorm);
      recipients.push({
        userId: r.id,
        name: r.name,
        email: r.email.trim(),
        role: r.business_role || "ho_admin",
      });
    }

    return recipients;
  } catch (err) {
    console.error("[approval-email-service] Failed fetching HO recipients from DB:", err);
    return [];
  }
}

/**
 * Format disaster type to Indonesian label
 */
function formatDisasterTypeLabel(disasterType: string): string {
  const map: Record<string, string> = {
    earthquake: "Gempa Bumi",
    flood: "Banjir",
    fire: "Kebakaran",
    theft: "Pencurian",
    heavy_rain: "Hujan Lebat / Cuaca Ekstrem",
    strong_wind: "Angin Kencang / Puting Beliung",
    severe_building_damage: "Kerusakan Bangunan Fisik",
    other: "Kejadian Darurat Lainnya",
  };
  return map[disasterType] || disasterType;
}

/**
 * Generates an executive, accessible HTML email template for Head Office notification.
 */
export function generateHoApprovalEmailHtml(
  event: ReportApprovalEvent,
  recipientName?: string
): string {
  const { appUrl } = getRuntimeConfig();
  const baseUrl = appUrl ? appUrl.origin : "http://localhost:3000";
  const reportUrl = `${baseUrl}/reports?search=${encodeURIComponent(event.reportId)}`;

  const isAffected = event.decision === "approved";
  const statusBadgeBg = isAffected ? "#dc2626" : "#16a34a";
  const statusText = isAffected
    ? "TERDAMPAK — Siap Tindak Lanjut SPARTA Maintenance"
    : "AMAN — Operasional Normal Terkonfirmasi";

  const disasterLabel = formatDisasterTypeLabel(event.disasterType);

  return `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Laporan Resmi BnM: ${event.reportId}</title>
</head>
<body style="margin: 0; padding: 24px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #0f172a; color: #f8fafc;">
  <div style="max-width: 620px; margin: 0 auto; background-color: #1e293b; border: 1px solid #334155; border-radius: 12px; overflow: hidden; box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.5);">
    
    <!-- Top Brand Header -->
    <div style="background-color: #1D5AA6; padding: 18px 24px; display: flex; align-items: center; justify-content: space-between;">
      <div style="color: #ffffff; font-size: 16px; font-weight: 800; letter-spacing: 0.5px;">
        SPARTA SIAGA — HEAD OFFICE ALERT
      </div>
      <div style="background-color: rgba(255,255,255,0.2); color: #ffffff; padding: 4px 10px; border-radius: 9999px; font-size: 11px; font-weight: 600;">
        Pusat Komando HO
      </div>
    </div>

    <!-- Main Content -->
    <div style="padding: 24px;">
      
      <!-- Greeting & Summary -->
      ${recipientName ? `<p style="font-size: 14px; color: #94a3b8; margin: 0 0 12px 0;">Yth. Bapak/Ibu <strong>${recipientName}</strong>,</p>` : ""}
      <p style="font-size: 14px; color: #cbd5e1; line-height: 1.6; margin: 0 0 20px 0;">
        Laporan kebencanaan telah selesai diperiksa oleh petugas lapangan dan <strong>resmi dikonfirmasi oleh Branch Building & Maintenance (BnM) Manajer</strong>.
      </p>

      <!-- Decision Status Banner -->
      <div style="background-color: ${statusBadgeBg}; color: #ffffff; padding: 12px 16px; border-radius: 8px; font-weight: bold; font-size: 14px; text-align: center; margin-bottom: 24px; letter-spacing: 0.3px;">
        STATUS KEPUTUSAN: ${statusText}
      </div>

      <!-- Report Details Table -->
      <div style="background-color: #0f172a; border: 1px solid #334155; border-radius: 8px; padding: 16px; margin-bottom: 24px;">
        <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
          <tr>
            <td style="padding: 6px 0; color: #94a3b8; width: 140px;">No. Tiket / ID:</td>
            <td style="padding: 6px 0; color: #f8fafc; font-weight: 600; font-family: monospace;">${event.reportId}</td>
          </tr>
          <tr>
            <td style="padding: 6px 0; color: #94a3b8;">Gerai / Fasilitas:</td>
            <td style="padding: 6px 0; color: #f8fafc; font-weight: 600;">${event.storeName} (${event.storeId})</td>
          </tr>
          <tr>
            <td style="padding: 6px 0; color: #94a3b8;">Cabang / Wilayah:</td>
            <td style="padding: 6px 0; color: #f8fafc;">Cabang ${event.branch}${event.locationCity ? ` (${event.locationCity})` : ""}</td>
          </tr>
          <tr>
            <td style="padding: 6px 0; color: #94a3b8;">Jenis Kejadian:</td>
            <td style="padding: 6px 0; color: #f8fafc;">${disasterLabel}</td>
          </tr>
          <tr>
            <td style="padding: 6px 0; color: #94a3b8;">Dikonfirmasi Oleh:</td>
            <td style="padding: 6px 0; color: #38bdf8; font-weight: 600;">${event.decidedBy.name} (${event.decidedBy.role.toUpperCase()})</td>
          </tr>
          <tr>
            <td style="padding: 6px 0; color: #94a3b8;">Waktu Keputusan:</td>
            <td style="padding: 6px 0; color: #f8fafc;">${event.decidedAt}</td>
          </tr>
          <tr>
            <td style="padding: 6px 0; color: #94a3b8;">Bukti Lapangan:</td>
            <td style="padding: 6px 0; color: #f8fafc;">${event.evidenceCount} foto dokumentasi terlampir</td>
          </tr>
          ${event.decisionNotes ? `
          <tr>
            <td style="padding: 6px 0; color: #94a3b8; vertical-align: top;">Catatan BnM:</td>
            <td style="padding: 6px 0; color: #fde047; font-style: italic;">"${event.decisionNotes}"</td>
          </tr>` : ""}
        </table>
      </div>

      <!-- Action Button -->
      <div style="text-align: center; margin-bottom: 24px;">
        <a href="${reportUrl}" style="background-color: #1D5AA6; color: #ffffff; padding: 12px 28px; border-radius: 8px; text-decoration: none; font-weight: bold; font-size: 13px; display: inline-block; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.2);">
          Buka Laporan di SPARTA Siaga &rarr;
        </a>
      </div>

      <!-- Governance & Read-Only Notice -->
      <div style="background-color: #1e293b; border-left: 4px solid #38bdf8; padding: 12px 16px; border-radius: 0 6px 6px 0; margin-bottom: 20px;">
        <p style="font-size: 12px; color: #94a3b8; margin: 0; line-height: 1.5;">
          <strong>Hak Akses Head Office (Read-Only):</strong> Sesuai Blueprint SOP Kebencanaan, akun Head Office memiliki wewenang pemantauan nasional terhadap laporan yang telah dikonfirmasi oleh cabang. Tindakan operasional perbaikan diserahkan kepada tim pemeliharaan cabang terkait.
        </p>
      </div>

      <p style="font-size: 11px; color: #64748b; margin: 0; text-align: center; line-height: 1.4;">
        Email ini dikirim secara otomatis oleh SPARTA Siaga.<br>
        PT Sumber Alfaria Trijaya Tbk. — Sistem Siaga Bencana Nasional
      </p>

    </div>
  </div>
</body>
</html>`;
}

/**
 * Generates an honest plain text version of the HO approval notification email.
 */
export function generateHoApprovalEmailText(event: ReportApprovalEvent): string {
  const isAffected = event.decision === "approved";
  const statusLabel = isAffected ? "TERDAMPAK" : "AMAN";
  const disasterLabel = formatDisasterTypeLabel(event.disasterType);

  return `[SPARTA SIAGA] PEMBERITAHUAN RESMI HEAD OFFICE (HO)
================================================================================
No. Tiket:      ${event.reportId}
Status:         ${statusLabel}
Gerai:          ${event.storeName} (${event.storeId})
Cabang:         ${event.branch}${event.locationCity ? ` (${event.locationCity})` : ""}
Jenis Kejadian: ${disasterLabel}
Dikonfirmasi:   BnM Manajer ${event.decidedBy.name} (${event.decidedBy.role.toUpperCase()})
Waktu:          ${event.decidedAt}
Bukti Foto:     ${event.evidenceCount} foto dokumentasi
${event.decisionNotes ? `Catatan BnM:    ${event.decisionNotes}\n` : ""}
Pemberitahuan otomatis ini diterbitkan setelah konfirmasi resmi dari BnM Manajer.
Akun Head Office memiliki hak akses pemantauan (Read-Only) secara nasional.
================================================================================
Sistem Siaga Bencana — PT Sumber Alfaria Trijaya Tbk.`;
}

/**
 * Process a single outbox row, dispatching emails to all authorized HO recipients,
 * recording delivery audit in `report_distributions`, and handling retries/errors.
 */
async function processSingleOutboxRow(
  client: any,
  row: any,
  event: ReportApprovalEvent,
  recipients: HoApprovalRecipient[]
): Promise<ProcessOutboxResult> {
  const dispatches: ApprovalEmailDispatchResult[] = [];
  let successCount = 0;
  let failureCount = 0;

  const currentPayload = typeof row.payload === "string" ? JSON.parse(row.payload) : (row.payload || {});
  const currentRetryCount: number = currentPayload.retryCount || 0;

  const subject = `[SPARTA SIAGA] Laporan Resmi BnM: ${event.reportId} - ${event.storeName} (${event.branch}) - ${event.decision === "approved" ? "TERDAMPAK" : "AMAN"}`;

  for (const recipient of recipients) {
    // 1. Idempotency check: check if email was already recorded in report_distributions
    const existingCheck = await client.query(
      `SELECT status FROM report_distributions
       WHERE report_id = $1 AND channel = 'email' AND recipient = $2 AND status = 'sent'
       LIMIT 1`,
      [event.reportId, recipient.email]
    );

    if (existingCheck.rows.length > 0) {
      dispatches.push({
        recipient: recipient.email,
        userId: recipient.userId,
        status: "deduplicated",
      });
      successCount++;
      continue;
    }

    // 2. Dispatch email
    const html = generateHoApprovalEmailHtml(event, recipient.name);
    const text = generateHoApprovalEmailText(event);

    const sendRes: EmailSendResult = await sendHoApprovalNotificationEmail({
      to: recipient.email,
      subject,
      html,
      text,
      reportId: event.reportId,
      branch: event.branch,
    });

    dispatches.push({
      recipient: recipient.email,
      userId: recipient.userId,
      status: sendRes.status as any,
      providerMessageId: sendRes.providerMessageId,
      errorMessage: sendRes.errorMessage,
      sentAt: sendRes.sentAt,
    });

    if (sendRes.status === "sent" || sendRes.status === "suppressed_testing_mode" || sendRes.status === "not_configured") {
      successCount++;
    } else {
      failureCount++;
    }

    // 3. Persist delivery audit log to report_distributions
    try {
      await client.query(
        `INSERT INTO report_distributions (
          report_id, channel, recipient, status, provider_message_id, attempted_at, sent_at, error_message
        ) VALUES ($1, 'email', $2, $3, $4, NOW(), $5, $6)`,
        [
          event.reportId,
          recipient.email,
          sendRes.status,
          sendRes.providerMessageId || null,
          sendRes.sentAt ? new Date(sendRes.sentAt) : null,
          sendRes.errorMessage || null,
        ]
      );
    } catch (distErr) {
      console.warn(`[approval-email-service] Failed logging to report_distributions for ${recipient.email}:`, distErr);
    }
  }

  // 4. Determine outbox completion vs retry
  const allFailed = failureCount > 0 && successCount === 0;
  const shouldRetry = allFailed && currentRetryCount < MAX_OUTBOX_RETRIES;

  const distributionAudit = {
    processedAt: new Date().toISOString(),
    totalRecipients: recipients.length,
    successCount,
    failureCount,
    retryCount: shouldRetry ? currentRetryCount + 1 : currentRetryCount,
    dispatches,
  };

  const updatedPayload = {
    ...currentPayload,
    emailDistribution: distributionAudit,
    retryCount: distributionAudit.retryCount,
  };

  if (!shouldRetry) {
    // Completed processing (mark processed_at)
    await client.query(
      `UPDATE report_approval_outbox
       SET processed_at = NOW(),
           payload = $1::jsonb
       WHERE id = $2`,
      [JSON.stringify(updatedPayload), row.id]
    );

    // Update notification_logs delivery status
    try {
      await client.query(
        `UPDATE notification_logs
         SET delivery_status = $1,
             delivery_channel = 'email',
             delivery_attempted_at = NOW(),
             sent_at = NOW()
         WHERE disaster_id = $2 AND recipient_group = 'HO'`,
        [successCount > 0 ? "sent" : "failed", event.reportId]
      );
    } catch (notifErr) {
      console.warn(`[approval-email-service] Failed updating notification_logs for ${event.reportId}:`, notifErr);
    }

    return {
      outboxId: row.id,
      reportId: event.reportId,
      decision: event.decision,
      branch: event.branch,
      totalRecipients: recipients.length,
      dispatches,
      processed: true,
      retryScheduled: false,
    };
  } else {
    // Schedule retry by leaving processed_at as NULL and recording error
    await client.query(
      `UPDATE report_approval_outbox
       SET payload = $1::jsonb
       WHERE id = $2`,
      [JSON.stringify(updatedPayload), row.id]
    );

    console.warn(
      `[approval-email-service] Retry ${currentRetryCount + 1}/${MAX_OUTBOX_RETRIES} scheduled for outbox item ${row.id}`
    );

    return {
      outboxId: row.id,
      reportId: event.reportId,
      decision: event.decision,
      branch: event.branch,
      totalRecipients: recipients.length,
      dispatches,
      processed: false,
      retryScheduled: true,
    };
  }
}

/**
 * Main Outbox Processor:
 * Safely fetches unprocessed approval events from `report_approval_outbox` with `FOR UPDATE SKIP LOCKED`,
 * sends automated notification emails to authorized Head Office recipients, and marks them processed.
 */
export async function processReportApprovalOutbox(options?: {
  reportId?: string;
  limit?: number;
}): Promise<ProcessOutboxResult[]> {
  const pool = getDbPool();
  const client = await pool.connect();
  const results: ProcessOutboxResult[] = [];

  try {
    // 1. Resolve authorized HO recipients
    const recipients = await getAuthorizedHoRecipients();
    if (recipients.length === 0) {
      console.log("[approval-email-service] No active HO recipients found in database; outbox items will mark not_configured or empty.");
    }

    await client.query("BEGIN");

    // 2. Query unprocessed outbox items with row-level lock
    let query = `
      SELECT id, report_id, decision, outcome_status, disaster_type,
             report_origin, branch, store_id, store_name, location_city,
             decided_by_user_id, decided_by_name, decided_by_role, decided_at,
             decision_notes, condition, evidence_count, published_to_ho,
             payload, processed_at, created_at
      FROM report_approval_outbox
      WHERE processed_at IS NULL
    `;
    const params: unknown[] = [];
    if (options?.reportId) {
      params.push(options.reportId);
      query += ` AND report_id = $${params.length}`;
    }
    query += ` ORDER BY created_at ASC FOR UPDATE SKIP LOCKED`;
    if (options?.limit) {
      params.push(options.limit);
      query += ` LIMIT $${params.length}`;
    } else {
      query += ` LIMIT 20`;
    }

    const { rows: outboxRows } = await client.query(query, params);

    for (const row of outboxRows) {
      const event: ReportApprovalEvent = {
        eventId: row.id,
        reportId: row.report_id,
        decision: row.decision,
        outcomeStatus: row.outcome_status,
        disasterType: row.disaster_type,
        reportOrigin: row.report_origin,
        branch: row.branch,
        storeId: row.store_id || "",
        storeName: row.store_name || "",
        locationCity: row.location_city,
        decidedBy: {
          userId: row.decided_by_user_id,
          name: row.decided_by_name,
          role: row.decided_by_role,
        },
        decidedAt: row.decided_at,
        decisionNotes: row.decision_notes,
        condition: row.condition,
        evidenceCount: row.evidence_count,
        publishedToHo: row.published_to_ho,
        createdAt: row.created_at,
      };

      const outboxRes = await processSingleOutboxRow(client, row, event, recipients);
      results.push(outboxRes);
    }

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("[approval-email-service] Transaction error processing approval outbox:", err);
    throw err;
  } finally {
    client.release();
  }

  return results;
}

/**
 * Get high-level audit summary of the approval outbox.
 */
export async function getApprovalOutboxStatus(reportId?: string): Promise<{
  total: number;
  unprocessed: number;
  processed: number;
  recentItems: any[];
}> {
  try {
    const pool = getDbPool();
    let query = `
      SELECT 
        COUNT(*)::int as total,
        COUNT(CASE WHEN processed_at IS NULL THEN 1 END)::int as unprocessed,
        COUNT(CASE WHEN processed_at IS NOT NULL THEN 1 END)::int as processed
      FROM report_approval_outbox
    `;
    const params: unknown[] = [];
    if (reportId) {
      params.push(reportId);
      query += ` WHERE report_id = $1`;
    }
    const { rows: stats } = await pool.query(query, params);

    let listQuery = `
      SELECT id, report_id, decision, outcome_status, branch, store_name,
             decided_by_name, processed_at, created_at,
             payload->'emailDistribution' as email_distribution
      FROM report_approval_outbox
    `;
    if (reportId) {
      listQuery += ` WHERE report_id = $1`;
    }
    listQuery += ` ORDER BY created_at DESC LIMIT 10`;

    const { rows: recentItems } = await pool.query(listQuery, params);

    return {
      total: stats[0]?.total || 0,
      unprocessed: stats[0]?.unprocessed || 0,
      processed: stats[0]?.processed || 0,
      recentItems,
    };
  } catch (err) {
    console.error("[approval-email-service] Failed reading outbox status:", err);
    return { total: 0, unprocessed: 0, processed: 0, recentItems: [] };
  }
}

