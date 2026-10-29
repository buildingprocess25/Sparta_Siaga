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
        { error: "Forbidden: Pengguna HO hanya memiliki hak akses baca (read-only)." },
        { status: 403 }
      );
    }

    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const notes = (body.notes || body.reason || "").toString().trim();

    const result = await CompletionApprovalService.submitCompletion({
      reportId: id,
      actor: {
        id: sessionUser.id,
        name: sessionUser.name,
        role: sessionUser.role,
        systemRole: sessionUser.systemRole,
        scope: sessionUser.scope,
        branch: sessionUser.branch,
      },
      notes,
      attachments: body.attachments,
    });

    return NextResponse.json({
      message: "Pengajuan penyelesaian berhasil disubmit.",
      data: result,
    });
  } catch (err: any) {
    console.error("[POST /api/incidents/:id/completion/submit]", err);
    return NextResponse.json(
      { error: err.message || "Gagal mengajukan penyelesaian laporan.", code: err.code },
      { status: err.status || 500 }
    );
  }
}
