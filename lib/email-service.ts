import nodemailer, { type Transporter } from 'nodemailer';
import { getRuntimeConfig } from './runtime-config';
import { isTestingModeActiveSync } from './db';

export type EmailDeliveryStatus =
  | 'sent'
  | 'failed'
  | 'not_configured'
  | 'suppressed_testing_mode'
  | 'pending';

export interface EmailSendResult {
  status: EmailDeliveryStatus;
  providerMessageId?: string;
  sentAt?: string;
  errorMessage?: string;
}

export interface EmergencyEmailParams {
  to: string;
  subject: string;
  html: string;
  text?: string;
  branch: string;
  disasterId?: string;
  ticketNumber?: string;
}

// In-memory deduplication cache for recent email dispatches (15 minute window)
const recentDispatches = new Map<string, number>();
const DEDUP_WINDOW_MS = 15 * 60 * 1000;

function cleanOldDedupEntries() {
  const cutoff = Date.now() - DEDUP_WINDOW_MS;
  for (const [key, ts] of recentDispatches.entries()) {
    if (ts < cutoff) recentDispatches.delete(key);
  }
}

/**
 * Returns the verified DC Duty Officer email for a branch.
 * Adheres strictly to Alfamart DC convention (dc.<branch>@alfamart.co.id).
 * Never fabricates mock domains like .local or test.
 */
export function getBranchDutyOfficerEmail(branch: string): string {
  const normalized = branch.toLowerCase().trim().replace(/[^a-z0-9]/g, '');
  return `dc.${normalized}@alfamart.co.id`;
}

/**
 * Singleton nodemailer transporter
 */
let transporterInstance: Transporter | null = null;

export function getEmailTransporter(): Transporter | null {
  const { email } = getRuntimeConfig();

  if (!email.enabled || !email.smtpHost) {
    return null;
  }

  if (!transporterInstance) {
    transporterInstance = nodemailer.createTransport({
      host: email.smtpHost,
      port: email.smtpPort,
      secure: email.smtpSecure,
      auth: email.smtpUser
        ? {
            user: email.smtpUser,
            pass: email.smtpPass || '',
          }
        : undefined,
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 15000,
    });
  }

  return transporterInstance;
}

/**
 * Test SMTP connection readiness without sending an email
 */
export async function verifyEmailTransporter(): Promise<{ success: boolean; message: string }> {
  const transporter = getEmailTransporter();
  if (!transporter) {
    return {
      success: false,
      message: 'Email provider is not configured (SMTP_HOST is empty or EMAIL_NOTIFICATIONS_ENABLED=false)',
    };
  }

  try {
    await transporter.verify();
    return { success: true, message: 'SMTP connection verified successfully' };
  } catch (err: any) {
    return { success: false, message: `SMTP verification failed: ${err.message}` };
  }
}

/**
 * Send an automated emergency email for qualifying disaster events.
 * Honors Testing Mode suppression, deduplication, and honest provider status.
 */
export async function sendEmergencyEmail(params: EmergencyEmailParams): Promise<EmailSendResult> {
  // 1. Check Testing Mode suppression
  if (isTestingModeActiveSync()) {
    console.log(`[Email Service] 🛑 SUPPRESSED: Testing Mode active for branch ${params.branch}. Real email blocked.`);
    return {
      status: 'suppressed_testing_mode',
      errorMessage: 'Email delivery suppressed because Testing Mode is active.',
    };
  }

  // 2. Check deduplication key
  cleanOldDedupEntries();
  const dedupKey = `${params.disasterId || ''}_${params.branch}_${params.ticketNumber || ''}`;
  if (params.disasterId && recentDispatches.has(dedupKey)) {
    console.log(`[Email Service] ⏭️ SUPPRESSED: Duplicate email detected for key ${dedupKey}`);
    return {
      status: 'sent',
      errorMessage: 'Email already dispatched for this disaster and branch in current window (deduplicated).',
    };
  }

  // 3. Check transporter configuration
  const transporter = getEmailTransporter();
  const { email } = getRuntimeConfig();

  if (!transporter || !email.smtpHost) {
    console.warn(`[Email Service] ⚠️ Email provider is not configured. Recording honest 'not_configured' status.`);
    return {
      status: 'not_configured',
      errorMessage: 'Email provider is not configured in production environment.',
    };
  }

  // 4. Dispatch email
  try {
    const info = await transporter.sendMail({
      from: email.smtpFrom,
      to: params.to,
      subject: params.subject,
      html: params.html,
      text: params.text || 'Peringatan Bencana SPARTA Siaga. Buka dashboard untuk instruksi lengkap.',
    });

    if (params.disasterId) {
      recentDispatches.set(dedupKey, Date.now());
    }

    console.log(`[Email Service] ✉️ Real email dispatched to ${params.to}. MessageId: ${info.messageId}`);
    return {
      status: 'sent',
      providerMessageId: info.messageId,
      sentAt: new Date().toISOString(),
    };
  } catch (error: any) {
    console.error(`[Email Service] ❌ Failed to dispatch email to ${params.to}:`, error);
    return {
      status: 'failed',
      errorMessage: error.message || 'Unknown SMTP error',
    };
  }
}

/**
 * Send Admin Test Email to explicitly approved inboxes only.
 * Rejects any unapproved addresses or real emergency recipients.
 */
export async function sendAdminTestEmail(
  targetEmail: string,
  actor: { id: string; name: string }
): Promise<EmailSendResult> {
  const { email } = getRuntimeConfig();
  const normalizedTarget = targetEmail.trim().toLowerCase();

  // 1. Explicitly disallow emergency DC inboxes as test targets
  if (normalizedTarget.startsWith('dc.') || normalizedTarget.includes('emergency')) {
    throw new Error('Alamat DC Duty Officer darurat tidak boleh digunakan untuk pengetesan.');
  }

  // 2. Whitelist verification
  const isApproved = email.approvedTestRecipients.includes(normalizedTarget);
  if (!isApproved) {
    throw new Error(
      `Alamat email '${targetEmail}' tidak terdaftar dalam whitelist approved test inboxes. Whitelist: [${email.approvedTestRecipients.join(', ')}]`
    );
  }

  const transporter = getEmailTransporter();
  if (!transporter || !email.smtpHost) {
    return {
      status: 'not_configured',
      errorMessage: 'Email provider belum dikonfigurasi di environment (SMTP_HOST atau EMAIL_NOTIFICATIONS_ENABLED belum diatur).',
    };
  }

  const subject = `[SPARTA SIAGA] Uji Coba Pengiriman Email — ${new Date().toLocaleTimeString('id-ID', { timeZone: 'Asia/Jakarta' })} WIB`;
  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Uji Coba Email SPARTA Siaga</title></head>
<body style="margin: 0; padding: 24px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #0f172a; color: #f8fafc;">
  <div style="max-width: 560px; margin: 0 auto; background-color: #1e293b; border: 1px solid #3b82f6; border-radius: 10px; padding: 24px;">
    <div style="background-color: #1d4ed8; color: #ffffff; padding: 8px 14px; border-radius: 6px; display: inline-block; font-weight: bold; font-size: 12px; margin-bottom: 16px;">
      ADMIN TEST EMAIL
    </div>
    <h2 style="margin: 0 0 12px 0; font-size: 18px; color: #f8fafc;">Uji Coba Konfigurasi Email SPARTA Siaga</h2>
    <p style="font-size: 14px; color: #cbd5e1; line-height: 1.5; margin: 0 0 16px 0;">
      Email ini dikirim atas permintaan Administrator untuk memverifikasi fungsionalitas pengiriman otomatis SPARTA Siaga ke penyedia SMTP.
    </p>
    <div style="background-color: #0f172a; border-radius: 6px; padding: 14px; font-size: 13px; font-family: monospace; color: #94a3b8; margin-bottom: 16px;">
      <div>Pemohon: <strong>${actor.name} (${actor.id})</strong></div>
      <div>Waktu: <strong>${new Date().toISOString()}</strong></div>
      <div>SMTP Host: <strong>${email.smtpHost}</strong></div>
      <div>Status: <strong>BERHASIL TERKIRIM DARI PROVIDER</strong></div>
    </div>
    <p style="font-size: 12px; color: #64748b; margin: 0;">
      Sistem Siaga Bencana — PT Sumber Alfaria Trijaya Tbk.
    </p>
  </div>
</body>
</html>
  `;

  try {
    const info = await transporter.sendMail({
      from: email.smtpFrom,
      to: normalizedTarget,
      subject,
      html,
      text: `Uji coba email SPARTA Siaga berhasil dikirim oleh ${actor.name} (${actor.id}) pada ${new Date().toISOString()}.`,
    });

    return {
      status: 'sent',
      providerMessageId: info.messageId,
      sentAt: new Date().toISOString(),
    };
  } catch (error: any) {
    return {
      status: 'failed',
      errorMessage: error.message || 'SMTP send failed',
    };
  }
}
