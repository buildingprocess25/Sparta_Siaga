import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { dbGetIncidentById } from "@/lib/incident-db";
import { CompletionApprovalService } from "@/lib/completion-approval-service";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: RouteContext) {
  try {
    const sessionUser = await getSessionUser(request);
    if (!sessionUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (sessionUser.scope === "HO") {
      return NextResponse.json(
        { error: "Forbidden: Pengguna Head Office (HO) tidak memiliki izin menutup laporan." },
        { status: 403 }
      );
    }

    if (sessionUser.systemRole === "ADMIN") {
      return NextResponse.json(
        { error: "Forbidden: Administrator sistem tidak berwenang melakukan tindakan operasional Case Close atas nama BnM Manajer." },
        { status: 403 }
      );
    }

    if ((sessionUser.role || "").toLowerCase() !== "bm") {
      return NextResponse.json(
        { error: "Forbidden: Tindakan Case Close hanya dapat dilakukan oleh BnM Manajer cabang bersangkutan." },
        { status: 403 }
      );
    }

    const { id } = await params;
    const incident = await dbGetIncidentById(id);
    if (!incident) {
      return NextResponse.json({ error: "Laporan tidak ditemukan." }, { status: 404 });
    }

    const body = await request.json().catch(() => ({}));
    const reason = (body.notes || body.reason || "").toString().trim();

    const closedReport = await CompletionApprovalService.closeCase({
      reportId: id,
      actor: {
        id: sessionUser.id,
        name: sessionUser.name,
        role: sessionUser.role,
        systemRole: sessionUser.systemRole,
        scope: sessionUser.scope,
        branch: sessionUser.branch,
      },
      notes: reason,
    });

    return NextResponse.json({
      message: "Laporan berhasil ditutup (Case Close) oleh BnM Manajer.",
      data: closedReport,
    });
  } catch (err: any) {
    console.error("[POST /api/incidents/:id/completion/close]", err);
    const statusCode = err.status || 500;
    return NextResponse.json(
      { error: err.message || "Gagal menutup laporan." },
      { status: statusCode }
    );
  }
}
