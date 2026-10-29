import { getDbPool } from "./db";
import { sendEmergencyEmail, getBranchDutyOfficerEmail } from "./email-service";

export type DeliveryChannel = "email" | "whatsapp";
export type DeliveryStatus =
  | "queued_no_provider"
  | "not_configured"
  | "sent"
  | "failed"
  | "pending"
  | "suppressed_testing_mode";

export interface DistributionRecord {
  id?: string;
  reportId: string;
  channel: DeliveryChannel;
  recipient: string;
  status: DeliveryStatus;
  providerMessageId?: string;
  attemptedAt: string;
  sentAt?: string;
  errorMessage?: string;
}

/**
 * ReportDistributionService
 * Handles the distribution lifecycle of reports to external channels.
 */
export class ReportDistributionService {
  /**
   * Dispatches a report to all configured channels (Email & WhatsApp).
   */
  static async distributeReport(reportId: string, branch: string, data?: any) {
    const verifiedEmailRecipient = getBranchDutyOfficerEmail(branch);
    const mockWaRecipient = `+628000000${branch.length}`;

    // 1. Dispatch real email via email-service
    const subject = `[SPARTA SIAGA] Distribusi Laporan Darurat ${reportId} — Cabang ${branch}`;
    const emailResult = await sendEmergencyEmail({
      to: verifiedEmailRecipient,
      branch,
      subject,
      html: `
        <div style="font-family: sans-serif; padding: 20px; color: #1e293b;">
          <h2>Laporan Kejadian Darurat SPARTA Siaga</h2>
          <p>ID Laporan: <strong>${reportId}</strong></p>
          <p>Cabang: <strong>${branch}</strong></p>
          <p>Waktu Distribusi: <strong>${new Date().toISOString()}</strong></p>
        </div>
      `,
      ticketNumber: reportId,
    });

    await this.recordDelivery({
      reportId,
      channel: "email",
      recipient: verifiedEmailRecipient,
      status: emailResult.status as DeliveryStatus,
      providerMessageId: emailResult.providerMessageId,
      attemptedAt: new Date().toISOString(),
      sentAt: emailResult.sentAt,
      errorMessage: emailResult.errorMessage,
    });

    // 2. WhatsApp status (honestly queued_no_provider)
    await this.recordDelivery({
      reportId,
      channel: "whatsapp",
      recipient: mockWaRecipient,
      status: "queued_no_provider",
      attemptedAt: new Date().toISOString(),
      errorMessage: "WhatsApp Business API is not yet linked.",
    });
  }

  /**
   * Persists the distribution log to the database.
   * Note: Requires `report_distributions` table to exist.
   */
  static async recordDelivery(record: DistributionRecord) {
    const pool = getDbPool();
    
    // Ensure table exists (in a real app this is handled by migrations)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS report_distributions (
        id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
        report_id VARCHAR(50) NOT NULL,
        channel VARCHAR(20) NOT NULL,
        recipient VARCHAR(100) NOT NULL,
        status VARCHAR(30) NOT NULL,
        provider_message_id VARCHAR(100),
        attempted_at TIMESTAMPTZ NOT NULL,
        sent_at TIMESTAMPTZ,
        error_message TEXT
      )
    `);

    await pool.query(
      `INSERT INTO report_distributions 
       (report_id, channel, recipient, status, provider_message_id, attempted_at, sent_at, error_message)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        record.reportId,
        record.channel,
        record.recipient,
        record.status,
        record.providerMessageId || null,
        record.attemptedAt,
        record.sentAt || null,
        record.errorMessage || null
      ]
    );
  }

  static async getDistributionsForReport(reportId: string): Promise<DistributionRecord[]> {
    const pool = getDbPool();
    try {
      const { rows } = await pool.query(
        `SELECT * FROM report_distributions WHERE report_id = $1 ORDER BY attempted_at DESC`,
        [reportId]
      );
      
      return rows.map(r => ({
        id: r.id,
        reportId: r.report_id,
        channel: r.channel as DeliveryChannel,
        recipient: r.recipient,
        status: r.status as DeliveryStatus,
        providerMessageId: r.provider_message_id,
        attemptedAt: r.attempted_at instanceof Date ? r.attempted_at.toISOString() : r.attempted_at,
        sentAt: r.sent_at ? (r.sent_at instanceof Date ? r.sent_at.toISOString() : r.sent_at) : undefined,
        errorMessage: r.error_message
      }));
    } catch (e) {
      // Table might not exist yet if no reports have been created
      console.warn("Could not fetch distributions, returning empty array.", e);
      return [];
    }
  }
}
