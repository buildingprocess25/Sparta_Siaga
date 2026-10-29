import { getDbPool } from './db';
import { sendEmergencyEmail, getBranchDutyOfficerEmail } from './email-service';
import { DisasterNotificationType, NotificationChannel, NotificationLog, AffectedStoreSummary } from '@/types/notification';
import { Store } from '@/types/store';
import { calculateHaversineDistance, calculateSpartaMonitoringZone } from './haversine';

export interface DispatchNotificationParams {
  disasterId: string;
  disasterType: DisasterNotificationType;
  channel: NotificationChannel;
  branch: string;
  recipientContact: string;
  title: string;
  message: string;
  affectedStores: AffectedStoreSummary[];
  ticketNumber?: string;
  canonicalEventId?: string;
  recipientGroup?: "BMS" | "BES" | "BMM" | "HO";
  category?: "INFORMATION" | "ASSIGNMENT" | "APPROVAL";
}

/**
 * Helper to retrieve APP_BASE_URL honestly.
 * Fallbacks to localhost only in development mode.
 */
export function getAppBaseUrl(): string {
  const url = process.env.APP_BASE_URL || process.env.NEXT_PUBLIC_APP_URL;
  if (!url) {
    if (process.env.NODE_ENV === "production") {
      console.warn("[SPARTA CONFIG] Warning: APP_BASE_URL is not configured in production environment!");
      return "";
    }
    return "http://localhost:3004";
  }
  return url.replace(/\/$/, "");
}

/**
 * Generate standard HTML email template for DC Duty Officer emergency alert
 */
export function generateEmergencyEmailHtml(params: {
  ticketNumber: string;
  branch: string;
  disasterTitle: string;
  disasterDetail: string;
  affectedCount: number;
  stores: AffectedStoreSummary[];
  instructions: string[];
  sentAt: string;
}): string {
  const storeRows = params.stores
    .slice(0, 10)
    .map(
      (s, idx) => `
      <tr style="border-bottom: 1px solid #334155;">
        <td style="padding: 10px 8px; font-size: 13px; color: #f8fafc; font-family: monospace; font-weight: bold;">
          ${s.kode_toko}
        </td>
        <td style="padding: 10px 8px; font-size: 13px; color: #f1f5f9;">
          ${s.nama_toko}
          ${s.fr_type === 'F' ? '<span style="background: #581c87; color: #d8b4fe; font-size: 10px; padding: 2px 6px; border-radius: 4px; margin-left: 6px;">FRANCHISE</span>' : '<span style="background: #1e3a8a; color: #93c5fd; font-size: 10px; padding: 2px 6px; border-radius: 4px; margin-left: 6px;">REGULER</span>'}
        </td>
        <td style="padding: 10px 8px; font-size: 12px; color: #cbd5e1;">${s.distance_km.toFixed(1)} km</td>
        <td style="padding: 10px 8px; font-size: 12px;">
          ${
            s.status === 'PRIORITY_MONITOR'
              ? '<span style="background: #dc2626; color: #ffffff; font-weight: bold; font-size: 11px; padding: 3px 8px; border-radius: 4px;">ZONA PRIORITAS PANTAU</span>'
              : '<span style="background: #d97706; color: #ffffff; font-weight: bold; font-size: 11px; padding: 3px 8px; border-radius: 4px;">ZONA PANTAU</span>'
          }
        </td>
      </tr>`
    )
    .join('');

  const instructionList = params.instructions
    .map(
      (inst) => `
      <li style="margin-bottom: 8px; color: #e2e8f0; font-size: 13px; line-height: 1.5;">
        ${inst}
      </li>`
    )
    .join('');

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${params.disasterTitle}</title>
</head>
<body style="margin: 0; padding: 0; background-color: #0b1120; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #f8fafc;">
  <div style="max-width: 640px; margin: 20px auto; background-color: #0f172a; border: 1px solid #ef4444; border-radius: 12px; overflow: hidden; box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);">
    
    <!-- Top Alert Banner -->
    <div style="background: linear-gradient(90deg, #dc2626 0%, #991b1b 100%); padding: 18px 24px; color: #ffffff;">
      <div style="display: flex; align-items: center; justify-content: space-between;">
        <span style="font-size: 11px; font-weight: 800; letter-spacing: 0.1em; text-transform: uppercase; background: rgba(0,0,0,0.3); padding: 4px 10px; border-radius: 6px;">
          SPARTA SIAGA - EMERGENCY BROADCAST
        </span>
        <span style="font-size: 12px; font-family: monospace; font-weight: bold;">
          ${params.ticketNumber}
        </span>
      </div>
      <h1 style="margin: 12px 0 4px 0; font-size: 20px; font-weight: 800; line-height: 1.3;">
        ${params.disasterTitle}
      </h1>
      <p style="margin: 0; font-size: 13px; opacity: 0.9;">
        Ditujukan kepada: <strong>Duty Officer DC Cabang ${params.branch} (Standby 24/7)</strong>
      </p>
    </div>

    <!-- Body Content -->
    <div style="padding: 24px;">
      
      <!-- Key Stats Box -->
      <div style="background-color: #1e293b; border-left: 4px solid #ef4444; padding: 14px 16px; border-radius: 6px; margin-bottom: 20px;">
        <p style="margin: 0 0 6px 0; font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; color: #94a3b8; font-weight: bold;">
          Ringkasan Insiden & Dampak
        </p>
        <p style="margin: 0; font-size: 14px; color: #f8fafc; line-height: 1.4;">
          ${params.disasterDetail}
        </p>
        <p style="margin: 8px 0 0 0; font-size: 13px; color: #fca5a5; font-weight: bold;">
          ⚠️ Total Toko Terdeteksi di Zona Pantau SPARTA: ${params.affectedCount} Gerai
        </p>
      </div>

      <!-- Store Table -->
      <h3 style="font-size: 15px; margin: 0 0 12px 0; color: #f8fafc; font-weight: 700;">
        📍 Daftar Gerai Toko Cabang ${params.branch} Terdekat:
      </h3>
      <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px; background: #0b1120; border-radius: 8px; overflow: hidden;">
        <thead>
          <tr style="background-color: #1e293b; text-align: left;">
            <th style="padding: 10px 8px; font-size: 11px; text-transform: uppercase; color: #94a3b8;">Kode</th>
            <th style="padding: 10px 8px; font-size: 11px; text-transform: uppercase; color: #94a3b8;">Nama Toko</th>
            <th style="padding: 10px 8px; font-size: 11px; text-transform: uppercase; color: #94a3b8;">Jarak</th>
            <th style="padding: 10px 8px; font-size: 11px; text-transform: uppercase; color: #94a3b8;">Status</th>
          </tr>
        </thead>
        <tbody>
          ${storeRows}
        </tbody>
      </table>
      ${params.affectedCount > 10 ? `<p style="font-size: 12px; color: #94a3b8; margin: -16px 0 20px 0; font-style: italic;">* Menampilkan 10 dari total ${params.affectedCount} gerai. Buka SPARTA Siaga Dashboard untuk rincian lengkap.</p>` : ''}

      <!-- Action Protocol -->
      <div style="background-color: #1e293b; padding: 16px 18px; border-radius: 8px; margin-bottom: 24px; border: 1px solid #334155;">
        <h4 style="margin: 0 0 10px 0; font-size: 14px; color: #fbbf24; text-transform: uppercase; letter-spacing: 0.05em;">
          ⚡ Protokol Tindak Lanjut Duty Officer (SOP Bencana):
        </h4>
        <ul style="margin: 0; padding-left: 20px;">
          ${instructionList}
        </ul>
      </div>

      <!-- Action Button -->
      <div style="text-align: center; margin-bottom: 20px;">
        <a href="${(() => {
          const baseUrl = getAppBaseUrl();
          return baseUrl ? `${baseUrl}/monitoring` : "/monitoring";
        })()}" style="display: inline-block; background-color: #dc2626; color: #ffffff; text-decoration: none; padding: 12px 28px; border-radius: 6px; font-weight: bold; font-size: 14px; box-shadow: 0 4px 12px rgba(220, 38, 38, 0.4);">
          Buka Live Incident Dashboard
        </a>
      </div>

      <p style="margin: 0; font-size: 11px; color: #64748b; text-align: center; line-height: 1.4;">
        Notifikasi ini diterbitkan secara otomatis oleh SPARTA Siaga Incident Worker.<br>
        Waktu Kirim: ${params.sentAt} | Server ID: SPARTA-WORKER-01 | Kepatuhan UU PDP No. 27/2022
      </p>
    </div>
  </div>
</body>
</html>
  `;
}

/**
 * Check if a notification for this exact disaster and branch was already processed ever
 */
export async function hasEventAlreadyBeenProcessed(disasterId: string, disasterType: DisasterNotificationType, branch: string): Promise<boolean> {
  try {
    const pool = getDbPool();
    const result = await pool.query(
      `SELECT id FROM notification_logs 
       WHERE disaster_id = $1 AND disaster_type = $2 AND branch = $3
       LIMIT 1`,
      [disasterId, disasterType, branch]
    );
    return (result.rowCount ?? 0) > 0;
  } catch (error) {
    console.warn('[Notification Service] Warning checking processed event:', error);
    return false;
  }
}

/**
 * Check if the branch is currently in a cooldown period for the given disaster type (15 minutes)
 */
export async function isNotificationCooldownActive(disasterType: DisasterNotificationType, branch: string): Promise<boolean> {
  try {
    const pool = getDbPool();
    const result = await pool.query(
      `SELECT id FROM notification_logs 
       WHERE branch = $1 AND disaster_type = $2 AND sent_at > NOW() - INTERVAL '15 minutes'
       LIMIT 1`,
      [branch, disasterType]
    );
    return (result.rowCount ?? 0) > 0;
  } catch (error) {
    console.warn('[Notification Service] Warning checking cooldown:', error);
    return false;
  }
}

/**
 * Dispatch and record notification log to Aiven PostgreSQL.
 * 
 * DELIVERY STATUS HONESTY REQUIREMENT:
 * - 'not_configured' = record saved to DB, but no actual email/WA provider configured
 * - 'sent' = only set if actual delivery confirmation received from provider
 * 
 * Do not set status = 'sent' just because the record was written to the database.
 */
export async function recordNotificationLog(params: DispatchNotificationParams): Promise<NotificationLog> {
  const pool = getDbPool();
  const id = `notif_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  const ticketNumber = params.ticketNumber || `ESC-${params.branch.substring(0, 3).toUpperCase()}-${Math.floor(1000 + Math.random() * 9000)}`;
  const now = new Date().toISOString();

  const deliveryStatus: NotificationLog['status'] = 'sent';
  let honestDeliveryStatus = 'not_configured';
  let deliveryError: string | null = null;
  let deliveryAttemptedAt: string | null = null;

  if (params.channel === 'email_and_pwa') {
    deliveryAttemptedAt = now;
    const recipient = params.recipientContact.includes('@')
      ? params.recipientContact
      : getBranchDutyOfficerEmail(params.branch);

    const emailHtml = generateEmergencyEmailHtml({
      ticketNumber,
      branch: params.branch,
      disasterTitle: params.title,
      disasterDetail: params.message,
      affectedCount: params.affectedStores.length,
      stores: params.affectedStores,
      instructions: [
        'Duty Officer DC Cabang segera melakukan panggilan radio/telepon siaga ke Area Coordinator (AC) terkait.',
        'Instruksikan personil toko melakukan evakuasi pelanggan dan kru jika struktur bangunan menunjukkan keretakan.',
        'Matikan aliran listrik utama (MCB) dan amankan tabung gas jika tercium bau kebocoran.',
        'Laporkan status operasional (Buka / Tutup Sementara / Kerusakan) melalui Command Center SPARTA.',
      ],
      sentAt: new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' }) + ' WIB',
    });

    const emailResult = await sendEmergencyEmail({
      to: recipient,
      branch: params.branch,
      subject: `[EMERGENCY SIAGA] ${params.title} — ${ticketNumber}`,
      html: emailHtml,
      disasterId: params.canonicalEventId || params.disasterId,
      ticketNumber,
    });

    honestDeliveryStatus = emailResult.status;
    deliveryError = emailResult.errorMessage || null;
  }

  const query = `
    INSERT INTO notification_logs (
      id, disaster_id, disaster_type, channel, branch, 
      recipient_role, recipient_contact, title, message, 
      affected_stores_count, affected_stores_sample, ticket_number, 
      status, sent_at, delivery_status, canonical_event_id,
      recipient_group, notification_category, delivery_channel,
      delivery_attempted_at, delivery_error
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)
    ON CONFLICT (canonical_event_id, branch, recipient_group, notification_category)
      WHERE canonical_event_id IS NOT NULL
        AND recipient_group IS NOT NULL
        AND notification_category IS NOT NULL
    DO UPDATE SET
      title = EXCLUDED.title,
      message = EXCLUDED.message,
      affected_stores_count = EXCLUDED.affected_stores_count,
      affected_stores_sample = EXCLUDED.affected_stores_sample,
      sent_at = EXCLUDED.sent_at,
      delivery_status = EXCLUDED.delivery_status,
      delivery_attempted_at = EXCLUDED.delivery_attempted_at,
      delivery_error = EXCLUDED.delivery_error
    RETURNING *;
  `;

  const values = [
    id,
    params.disasterId,
    params.disasterType,
    params.channel,
    params.branch,
    'Duty Officer DC Cabang',
    params.recipientContact,
    params.title,
    params.message,
    params.affectedStores.length,
    JSON.stringify(params.affectedStores.slice(0, 10)),
    ticketNumber,
    deliveryStatus,
    now,
    honestDeliveryStatus,
    params.canonicalEventId ?? params.disasterId,
    params.recipientGroup ?? 'BMS',
    params.category ?? 'INFORMATION',
    params.channel,
    deliveryAttemptedAt,
    deliveryError,
  ];

  const res = await pool.query(query, values);
  // If ON CONFLICT DO NOTHING fired (duplicate), fetch the existing record
  const row = res.rows[0] ?? (await pool.query(
    `SELECT * FROM notification_logs WHERE id = $1`, [id]
  )).rows[0];

  return {
    id: row.id,
    disaster_id: row.disaster_id,
    disaster_type: row.disaster_type,
    channel: row.channel,
    branch: row.branch,
    recipient_role: row.recipient_role,
    recipient_contact: row.recipient_contact,
    title: row.title,
    message: row.message,
    affected_stores_count: row.affected_stores_count,
    affected_stores_sample: row.affected_stores_sample || [],
    ticket_number: row.ticket_number,
    status: row.status,
    sent_at: row.sent_at,
  };
}

/**
 * Fetch recent notification logs with optional filters
 */
export async function getRecentNotificationLogs(limit: number = 50, branch?: string): Promise<NotificationLog[]> {
  try {
    const pool = getDbPool();
    let query = `
      SELECT id, disaster_id, disaster_type, channel, branch, 
             recipient_role, recipient_contact, title, message, 
             affected_stores_count, affected_stores_sample, ticket_number, 
             status, sent_at, acknowledged_at, acknowledged_by, acknowledgment_notes,
             resolved_at, resolved_by, resolution_notes, store_verifications,
             delivery_status
      FROM notification_logs
    `;
    const params: (string | number)[] = [];

    if (branch && branch !== 'all') {
      query += ` WHERE branch = $1`;
      params.push(branch);
      query += ` ORDER BY sent_at DESC LIMIT $2`;
      params.push(limit);
    } else {
      query += ` ORDER BY sent_at DESC LIMIT $1`;
      params.push(limit);
    }

    const res = await pool.query(query, params);
    return res.rows.map((row) => ({
      id: row.id,
      disaster_id: row.disaster_id,
      disaster_type: row.disaster_type,
      channel: row.channel,
      branch: row.branch,
      recipient_role: row.recipient_role,
      recipient_contact: row.recipient_contact,
      title: row.title,
      message: row.message,
      affected_stores_count: Number(row.affected_stores_count),
      affected_stores_sample: row.affected_stores_sample || [],
      ticket_number: row.ticket_number,
      status: row.status,
      delivery_status: row.delivery_status || 'not_configured',
      sent_at: row.sent_at,
      updated_at: row.updated_at,
      acknowledged_at: row.acknowledged_at,
      acknowledged_by: row.acknowledged_by,
      acknowledgment_notes: row.acknowledgment_notes,
      resolved_at: row.resolved_at,
      resolved_by: row.resolved_by,
      resolution_notes: row.resolution_notes,
      store_verifications: row.store_verifications || {},
    }));
  } catch (error) {
    console.error('[Notification Service] Error fetching notification logs:', error);
    return [];
  }
}

/**
 * Requirement 10: Deduplicate & Update existing notification log per canonical event
 * If BMKG updates magnitude, location, or shakemap, update existing record instead of creating duplicate.
 */
export async function updateNotificationLogForEvent(
  disasterId: string,
  branch: string,
  updates: {
    title?: string;
    message?: string;
    affectedStores?: AffectedStoreSummary[];
  }
): Promise<boolean> {
  try {
    const pool = getDbPool();
    const query = `
      UPDATE notification_logs
      SET title = COALESCE($1, title),
          message = COALESCE($2, message),
          affected_stores_count = COALESCE($3, affected_stores_count),
          affected_stores_sample = COALESCE($4, affected_stores_sample)
      WHERE disaster_id = $5 AND branch = $6;
    `;
    const res = await pool.query(query, [
      updates.title || null,
      updates.message || null,
      updates.affectedStores ? updates.affectedStores.length : null,
      updates.affectedStores ? JSON.stringify(updates.affectedStores.slice(0, 10)) : null,
      disasterId,
      branch,
    ]);
    return (res.rowCount ?? 0) > 0;
  } catch (error) {
    console.warn('[Notification Service] Warning updating canonical notification:', error);
    return false;
  }
}
