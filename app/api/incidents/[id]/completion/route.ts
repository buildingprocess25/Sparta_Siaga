import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { dbGetIncidentById } from "@/lib/incident-db";
import { canAccessReportAsync } from "@/lib/report-access-policy";
import { EstimationIntegrationService } from "@/lib/estimation-service";
import {
  CompletionApprovalService,
  resolveApprovalRoute,
} from "@/lib/completion-approval-service";
import { ProgressService } from "@/lib/progress-service";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: RouteContext) {
  try {
    const sessionUser = await getSessionUser(request);
    if (!sessionUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const report = await dbGetIncidentById(id);
    if (!report) {
      return NextResponse.json({ error: "Laporan tidak ditemukan" }, { status: 404 });
    }

    if (!await canAccessReportAsync(sessionUser, report)) {
      return NextResponse.json({ error: "Anda tidak memiliki akses ke laporan ini." }, { status: 403 });
    }

    const route = await EstimationIntegrationService.getRouteByReportId(id);
    const resolvedRoute = resolveApprovalRoute(report, route);
    const approval = await CompletionApprovalService.getOrCreateApproval(id);
    const history = await CompletionApprovalService.getApprovalHistory(id);

    const hasFinalEvidence = await ProgressService.hasFinalOrHandoverEvidence(id);
    let hasMilestoneSt = false;
    try {
      const { getMilestones } = await import("@/lib/milestone-service");
      const milestones = await getMilestones(id);
      const st = milestones.find((m) => m.stageKey === "SERAH_TERIMA");
      hasMilestoneSt = Boolean(st && st.status === "SUBMITTED" && (st.documentStorageKey || st.documentUrl));
    } catch {
      // ignore
    }

    const isCompleted = (report.progress ?? 0) >= 100 && (hasFinalEvidence || hasMilestoneSt);

    return NextResponse.json({
      data: {
        approval,
        route: resolvedRoute,
        history,
        hasFinalEvidence,
        hasMilestoneSt,
        isCompleted,
      },
    });
  } catch (err: any) {
    console.error("[GET /api/incidents/:id/completion]", err);
    return NextResponse.json(
      { error: err.message || "Gagal memuat status approval" },
      { status: err.status || 500 }
    );
  }
}
