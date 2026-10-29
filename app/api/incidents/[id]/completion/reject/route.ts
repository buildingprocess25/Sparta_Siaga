import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
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
        { error: "Forbidden: Pengguna Head Office (HO) hanya memiliki hak akses monitoring (read-only)." },
        { status: 403 }
      );
    }

    if (sessionUser.systemRole === "ADMIN") {
      return NextResponse.json(
        { error: "Forbidden: Administrator sistem tidak berwenang memberikan keputusan revisi operasional atas nama BnM Manajer atau Koordinator." },
        { status: 403 }
      );
    }

    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const reason = (body.reason || body.notes || "").toString().trim();

    if (!reason) {
      return NextResponse.json(
        { error: "Alasan penolakan / revisi wajib diisi.", code: "REJECTION_REASON_REQUIRED" },
        { status: 400 }
      );
    }

    const actor = {
      id: sessionUser.id,
      name: sessionUser.name,
      role: sessionUser.role,
      systemRole: sessionUser.systemRole,
      scope: sessionUser.scope,
      branch: sessionUser.branch,
    };

    const role = (sessionUser.role || "").toLowerCase();

    if (role === "bm") {
      const result = await CompletionApprovalService.rejectByManager({
        reportId: id,
        actor,
        reason,
      });

      return NextResponse.json({
        message: "Laporan ditolak oleh BnM Manajer / Administrator dan dikembalikan dengan status revisi.",
        data: result,
      });
    }

    if (["bmc", "bec", "bbc"].includes(role)) {
      const result = await CompletionApprovalService.rejectByCoordinator({
        reportId: id,
        actor,
        reason,
      });

      return NextResponse.json({
        message: "Laporan ditolak oleh Koordinator dan dikembalikan dengan status revisi.",
        data: result,
      });
    }

    return NextResponse.json(
      {
        error: `Role '${role.toUpperCase() || "N/A"}' tidak memiliki otoritas untuk menolak/merevisi laporan pada tahap ini.`,
        code: "ROLE_MISMATCH",
      },
      { status: 403 }
    );
  } catch (err: any) {
    console.error("[POST /api/incidents/:id/completion/reject]", err);
    return NextResponse.json(
      { error: err.message || "Gagal menolak laporan.", code: err.code },
      { status: err.status || 500 }
    );
  }
}
