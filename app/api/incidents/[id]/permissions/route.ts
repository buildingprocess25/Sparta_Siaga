import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { dbGetIncidentById } from "@/lib/incident-db";
import {
  checkUserPermission,
  canSubmitInspectionAsync,
  canApproveAsBmAsync,
  canViewReportAsync,
} from "@/lib/permission-service";
import { ProgressService } from "@/lib/progress-service";
import { deriveWorkflowActions } from "@/lib/workflow-actions";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_: Request, { params }: RouteContext) {
  try {
    const sessionUser = await getSessionUser();
    if (!sessionUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const incident = await dbGetIncidentById(id);
    if (!incident) {
      return NextResponse.json({ error: "Laporan tidak ditemukan" }, { status: 404 });
    }

    if (!await canViewReportAsync(sessionUser, incident)) {
      return NextResponse.json({ error: "Anda tidak memiliki akses ke laporan ini." }, { status: 403 });
    }

    const [
      inspectionResult,
      bmApprovalResult,
      followUpResult,
      updateProgressResult,
      closeResult,
      instructionResult,
      triggerEstimationResult,
      viewEstimationResult,
      readinessResult,
      submitCompletionResult,
      approveCoordinatorResult,
    ] = await Promise.all([
      canSubmitInspectionAsync(sessionUser, incident),
      canApproveAsBmAsync(sessionUser, incident),
      checkUserPermission({ user: sessionUser, permission: "REPORT_FOLLOW_UP", report: incident }),
      checkUserPermission({ user: sessionUser, permission: "REPORT_UPDATE_PROGRESS", report: incident }),
      checkUserPermission({ user: sessionUser, permission: "REPORT_CLOSE", report: incident }),
      checkUserPermission({ user: sessionUser, permission: "MANAGEMENT_INSTRUCTION_CREATE", report: incident }),
      checkUserPermission({ user: sessionUser, permission: "ESTIMATION_TRIGGER", report: incident }),
      checkUserPermission({ user: sessionUser, permission: "ESTIMATION_VIEW", report: incident }),
      checkUserPermission({ user: sessionUser, permission: "WORK_READINESS_UPDATE", report: incident }),
      checkUserPermission({ user: sessionUser, permission: "COMPLETION_SUBMIT", report: incident }),
      checkUserPermission({ user: sessionUser, permission: "COMPLETION_APPROVE_COORDINATOR", report: incident }),
    ]);

    const sameBranch = Boolean(
      sessionUser.branch && incident.branch &&
      sessionUser.branch.trim().toLowerCase() === incident.branch.trim().toLowerCase()
    );
    const actorRole = (sessionUser.role || "").toLowerCase();
    const operationalActor = sessionUser.systemRole !== "ADMIN" && sessionUser.scope !== "HO" && sameBranch;

    // Prasyarat pengajuan penyelesaian: progres 100% dan bukti FINAL/HANDOVER atau milestone SERAH_TERIMA
    const hasFinalEvidence = await ProgressService.hasFinalOrHandoverEvidence(incident.id);
    let hasMilestoneSt = false;
    try {
      const { getMilestones } = await import("@/lib/milestone-service");
      const milestones = await getMilestones(incident.id);
      const st = milestones.find((m) => m.stageKey === "SERAH_TERIMA");
      hasMilestoneSt = Boolean(st && st.status === "SUBMITTED" && (st.documentStorageKey || st.documentUrl));
    } catch {
      // ignore
    }

    const currentProgress = incident.progress ?? 0;
    const isPrerequisitesMet = currentProgress >= 100 && (hasFinalEvidence || hasMilestoneSt);
    let submitCompletionReason = submitCompletionResult.reason || "";
    if (operationalActor && ["bms", "bes", "bbs"].includes(actorRole)) {
      if (currentProgress < 100) {
        submitCompletionReason = `Pekerjaan fisik belum mencapai 100% (progres saat ini: ${currentProgress}%).`;
      } else if (!hasFinalEvidence && !hasMilestoneSt) {
        submitCompletionReason = "Wajib melampirkan bukti serah terima (Milestone Serah Terima atau foto FINAL / HANDOVER).";
      }
    }

    const actionPermissions = {
      canInspect: inspectionResult.authorized,
      canApproveInitial: bmApprovalResult.authorized,
      canCreateEstimation: triggerEstimationResult.authorized,
      canUpdateReadiness: readinessResult.authorized,
      canUpdateProgress: updateProgressResult.authorized,
      canSubmitCompletion:
        operationalActor &&
        ["bms", "bes", "bbs"].includes(actorRole) &&
        isPrerequisitesMet &&
        submitCompletionResult.authorized,
      canApproveCoordinator: operationalActor && ["bmc", "bec", "bbc"].includes(actorRole) && approveCoordinatorResult.authorized,
      canFinalApprove: operationalActor && actorRole === "bm" && closeResult.authorized,
      canClose: operationalActor && actorRole === "bm" && closeResult.authorized,
      completionStatus: incident.completionApprovalStatus,
    };
    const actions = deriveWorkflowActions(sessionUser, incident, actionPermissions);

    return NextResponse.json({
      data: {
        incidentId: incident.id,
        branch: incident.branch,
        actions,
        canConfirm: actionPermissions.canInspect,
        confirmReason: inspectionResult.reason || "",
        canBmApprove: actionPermissions.canApproveInitial,
        bmApproveReason: bmApprovalResult.reason || "",
        canFollowUp: followUpResult.authorized,
        followUpReason: followUpResult.reason || "",
        canUpdateProgress: updateProgressResult.authorized,
        updateProgressReason: updateProgressResult.reason || "",
        canFinalApprove: actionPermissions.canFinalApprove,
        finalApproveReason: closeResult.reason || "",
        canClose: actionPermissions.canClose,
        closeReason: closeResult.reason || "",
        canCreateInstruction: instructionResult.authorized,
        canTriggerEstimation: actionPermissions.canCreateEstimation,
        triggerEstimationReason: triggerEstimationResult.reason || "",
        canViewEstimation: viewEstimationResult.authorized,
        canUpdateReadiness: actionPermissions.canUpdateReadiness,
        updateReadinessReason: readinessResult.reason || "",
        canSubmitCompletion: actionPermissions.canSubmitCompletion,
        submitCompletionReason: submitCompletionReason,
        canApproveCoordinator: actionPermissions.canApproveCoordinator,
        approveCoordinatorReason: approveCoordinatorResult.reason || "",
      },
    });
  } catch (err) {
    console.error("[GET /api/incidents/:id/permissions]", err);
    return NextResponse.json(
      { error: "Gagal memverifikasi permission laporan" },
      { status: 500 }
    );
  }
}
