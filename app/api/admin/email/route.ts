import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getRuntimeConfig } from "@/lib/runtime-config";
import { getProductionDbPool } from "@/lib/db";
import { sendAdminTestEmail, verifyEmailTransporter } from "@/lib/email-service";

export async function GET() {
  try {
    const sessionUser = await getSessionUser();
    if (!sessionUser || sessionUser.systemRole !== "ADMIN") {
      return NextResponse.json(
        { error: "Forbidden: Hanya Administrator yang dapat melihat konfigurasi dan status pengiriman email." },
        { status: 403 }
      );
    }

    const { email } = getRuntimeConfig();
    const isConfigured = Boolean(email.enabled && email.smtpHost);

    // Fetch recent delivery logs from notification_logs
    const pool = getProductionDbPool();
    let recentNotifications = [];
    try {
      const res = await pool.query(
        `SELECT id, disaster_id, disaster_type, branch, recipient_contact, 
                ticket_number, status, delivery_status, delivery_attempted_at, delivery_error, sent_at
         FROM notification_logs
         WHERE channel IN ('email', 'email_and_pwa')
         ORDER BY sent_at DESC
         LIMIT 25`
      );
      recentNotifications = res.rows;
    } catch (e) {
      console.warn("[Admin Email API] Warning querying notification logs:", e);
    }

    let recentDistributions = [];
    try {
      const distRes = await pool.query(
        `SELECT id, report_id, channel, recipient, status, provider_message_id, attempted_at, sent_at, error_message
         FROM report_distributions
         WHERE channel = 'email'
         ORDER BY attempted_at DESC
         LIMIT 25`
      );
      recentDistributions = distRes.rows;
    } catch (e) {
      console.warn("[Admin Email API] Warning querying report distributions:", e);
    }

    return NextResponse.json({
      success: true,
      configuration: {
        configured: isConfigured,
        enabled: email.enabled,
        smtpHost: email.smtpHost || null,
        smtpPort: email.smtpPort,
        smtpSecure: email.smtpSecure,
        smtpFrom: email.smtpFrom,
        approvedTestRecipients: email.approvedTestRecipients,
      },
      recentDeliveries: {
        notifications: recentNotifications,
        distributions: recentDistributions,
      },
    });
  } catch (error: any) {
    console.error("[API admin/email GET] Error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const sessionUser = await getSessionUser();
    if (!sessionUser || sessionUser.systemRole !== "ADMIN") {
      return NextResponse.json(
        { error: "Forbidden: Hanya Administrator yang berwenang mengirim email uji coba." },
        { status: 403 }
      );
    }

    const body = await request.json();
    const targetEmail = body?.targetEmail?.trim();

    if (!targetEmail) {
      return NextResponse.json(
        { error: "Bad Request: 'targetEmail' wajib diisi." },
        { status: 400 }
      );
    }

    const result = await sendAdminTestEmail(targetEmail, {
      id: sessionUser.id,
      name: sessionUser.name,
    });

    if (result.status === "failed") {
      return NextResponse.json(
        {
          success: false,
          status: result.status,
          error: result.errorMessage,
        },
        { status: 502 }
      );
    }

    return NextResponse.json({
      success: true,
      result,
      message:
        result.status === "sent"
          ? `Email uji coba berhasil dikirim ke ${targetEmail} melalui penyedia SMTP (Message ID: ${result.providerMessageId})`
          : `Email tidak terkirim: status '${result.status}'. ${result.errorMessage || ''}`,
    });
  } catch (error: any) {
    console.error("[API admin/email POST] Error:", error);
    return NextResponse.json(
      { error: error.message || "Gagal mengirim email uji coba." },
      { status: 400 }
    );
  }
}
