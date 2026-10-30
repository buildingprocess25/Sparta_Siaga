import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import {
  processReportApprovalOutbox,
  getApprovalOutboxStatus,
} from "@/lib/approval-email-service";

/**
 * GET /api/notifications/approval-outbox
 * Returns the status and recent audit items from the report approval outbox.
 */
export async function GET(request: Request) {
  try {
    const sessionUser = await getSessionUser(request);
    if (!sessionUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const url = new URL(request.url);
    const reportId = url.searchParams.get("reportId") || undefined;

    const status = await getApprovalOutboxStatus(reportId);
    return NextResponse.json({ success: true, data: status });
  } catch (err: any) {
    console.error("[GET /api/notifications/approval-outbox]", err);
    return NextResponse.json(
      { error: "Gagal membaca status outbox approval", message: err.message },
      { status: 500 }
    );
  }
}

/**
 * POST /api/notifications/approval-outbox
 * Flushes/processes unprocessed items from the report approval outbox.
 */
export async function POST(request: Request) {
  try {
    const sessionUser = await getSessionUser(request);
    if (!sessionUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Only System Administrator can trigger outbox flushing; HO is strictly monitoring-only
    if (sessionUser.systemRole !== "ADMIN") {
      return NextResponse.json(
        { error: "Forbidden: Pengguna Head Office hanya memiliki hak pemantauan (monitoring-only) dan dilarang memicu pemrosesan antrean outbox secara manual." },
        { status: 403 }
      );
    }

    const body = await request.json().catch(() => ({}));
    const reportId = body.reportId || undefined;
    const limit = typeof body.limit === "number" ? body.limit : undefined;

    const results = await processReportApprovalOutbox({ reportId, limit });

    return NextResponse.json({
      success: true,
      message: `Diproses ${results.length} item approval outbox.`,
      data: results,
    });
  } catch (err: any) {
    console.error("[POST /api/notifications/approval-outbox]", err);
    return NextResponse.json(
      { error: "Gagal memproses outbox approval", message: err.message },
      { status: 500 }
    );
  }
}

