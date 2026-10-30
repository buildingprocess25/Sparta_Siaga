import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { dbGetIncidentById } from "@/lib/incident-db";
import { canAccessReportAsync } from "@/lib/report-access-policy";
import { EstimationIntegrationService } from "@/lib/estimation-service";
import { checkUserPermission } from "@/lib/permission-service";
import {
  resolveWorkReadinessCategory,
  evaluateWorkReadiness,
  WORK_READINESS_REQUIREMENTS,
  WorkReadinessRequirementKey,
} from "@/lib/work-readiness";
import { processReadinessUpdate } from "@/lib/work-readiness-server";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: RouteContext) {
  try {
    const sessionUser = await getSessionUser(request);
    if (!sessionUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const incident = await dbGetIncidentById(id);
    if (!incident) {
      return NextResponse.json({ error: "Laporan tidak ditemukan", code: "REPORT_NOT_FOUND" }, { status: 404 });
    }

    if (!await canAccessReportAsync(sessionUser, incident)) {
      return NextResponse.json(
        { error: "Anda tidak memiliki izin untuk melihat kesiapan kerja laporan ini.", code: "FORBIDDEN" },
        { status: 403 }
      );
    }

    const route = await EstimationIntegrationService.getRouteByReportId(id);
    if (!route) {
      return NextResponse.json({
        data: {
          reportId: incident.id,
          hasEstimation: false,
          workStatus: "NOT_READY",
          message: "Proses estimasi belum dimulai untuk laporan ini.",
        },
      });
    }

    // Evaluasi Readiness dari context report & route
    const category = resolveWorkReadinessCategory(incident.tkpType, route.handlerType) || "STORE_BMS";
    const evaluation = evaluateWorkReadiness(
      incident.tkpType,
      route.handlerType,
      route.readinessData || {}
    );

    // Pengecekan Izin Pengguna
    const permCheck = await checkUserPermission({
      user: sessionUser,
      permission: "WORK_READINESS_UPDATE",
      report: incident,
    });

    return NextResponse.json({
      data: {
        reportId: incident.id,
        hasEstimation: true,
        category,
        workStatus: route.workStatus,
        estimationStatus: route.status,
        isReady: evaluation.isReady,
        totalRequirements: evaluation.totalRequirements,
        completedRequirements: evaluation.completedRequirements,
        missingRequirements: evaluation.missingRequirements,
        details: evaluation.details,
        requirements: WORK_READINESS_REQUIREMENTS[category] || [],
        canUpdate: permCheck.authorized,
        updateReason: permCheck.reason || "",
        readinessData: route.readinessData,
      },
    });
  } catch (err: any) {
    console.error("[GET /api/incidents/:id/readiness]", err);
    return NextResponse.json(
      { error: "Gagal memuat status kesiapan kerja", code: "INTERNAL_ERROR" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request, { params }: RouteContext) {
  try {
    const sessionUser = await getSessionUser(request);
    if (!sessionUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const incident = await dbGetIncidentById(id);
    if (!incident) {
      return NextResponse.json(
        { error: "Laporan tidak ditemukan", code: "REPORT_NOT_FOUND" },
        { status: 404 }
      );
    }

    if (incident.status === "closed" || incident.status === "resolved" || incident.status === "archived") {
      return NextResponse.json(
        { error: "Laporan sudah ditutup/selesai. Persyaratan kesiapan kerja tidak dapat diubah.", code: "REPORT_CLOSED" },
        { status: 422 }
      );
    }

    const route = await EstimationIntegrationService.getRouteByReportId(id);
    if (!route) {
      return NextResponse.json(
        { error: "Rute estimasi untuk laporan ini belum dibuat.", code: "ESTIMATION_NOT_FOUND" },
        { status: 422 }
      );
    }

    // 1. Authorize: Enforce WORK_READINESS_UPDATE, branch scope, dan ZERO System Admin bypass
    const permCheck = await checkUserPermission({
      user: sessionUser,
      permission: "WORK_READINESS_UPDATE",
      report: incident,
    });

    if (!permCheck.authorized) {
      return NextResponse.json(
        {
          error: permCheck.reason || "Anda tidak memiliki izin untuk memperbarui persyaratan kesiapan kerja.",
          code: "FORBIDDEN",
        },
        { status: 403 }
      );
    }

    // 2. Lock check: jika workStatus sudah READY_FOR_WORK ke atas, tolak modifikasi
    if (route.workStatus !== "NOT_READY") {
      return NextResponse.json(
        {
          error: `Persyaratan kesiapan kerja telah divalidasi dan terkunci (Status pekerjaan: '${route.workStatus}').`,
          code: "WORK_ALREADY_READY",
        },
        { status: 422 }
      );
    }

    const contentType = request.headers.get("content-type") || "";

    // 3. Handle File Upload (multipart/form-data)
    if (contentType.includes("multipart/form-data")) {
      const formData = await request.formData();
      const rawReqKey = formData.get("requirement_key") || formData.get("key");
      const notes = (formData.get("notes") || "").toString().trim();
      const file = formData.get("file") as File | null;

      if (!rawReqKey) {
        return NextResponse.json(
          { error: "Key persyaratan (requirement_key) wajib disertakan.", code: "MISSING_KEY" },
          { status: 400 }
        );
      }

      const reqKey = rawReqKey.toString().trim() as WorkReadinessRequirementKey;

      if (!file || !(file instanceof File) || file.size === 0) {
        return NextResponse.json(
          { error: "Berkas lampiran fisik wajib dilampirkan.", code: "EVIDENCE_FILE_REQUIRED" },
          { status: 400 }
        );
      }

      // Max 10MB check
      if (file.size > 10 * 1024 * 1024) {
        return NextResponse.json(
          { error: "Ukuran berkas melebihi batas maksimal 10MB.", code: "FILE_TOO_LARGE" },
          { status: 400 }
        );
      }

      const arrayBuffer = await file.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      const updateResult = await processReadinessUpdate({
        reportId: id,
        actor: {
          id: sessionUser.id,
          name: sessionUser.name,
          branch: sessionUser.branch,
        },
        requirementKey: reqKey,
        fileEvidence: {
          buffer,
          originalFilename: file.name,
        },
        notes,
      });

      return NextResponse.json({
        success: true,
        data: updateResult,
      });
    }

    // 4. Handle JSON Action (Boolean checklist or transition action)
    const body = await request.json();
    const action = (body.action || "").toString().trim().toUpperCase();

    if (action === "TRANSITION_READY") {
      // Pastikan status estimasi sudah selesai
      if (route.status !== "ESTIMATION_COMPLETED") {
        return NextResponse.json(
          {
            error: "Pekerjaan belum dapat dialihkan ke Siap Dikerjakan karena tahap estimasi belum selesai (ESTIMATION_COMPLETED).",
            code: "ESTIMATION_NOT_COMPLETED",
          },
          { status: 422 }
        );
      }

      // Validasi evaluasi readiness
      const evaluation = evaluateWorkReadiness(
        incident.tkpType,
        route.handlerType,
        route.readinessData || {}
      );

      if (!evaluation.isReady) {
        const missingNames = evaluation.missingRequirements.map((r) => r.label).join(", ");
        return NextResponse.json(
          {
            error: `Pekerjaan belum dapat dimulai. Persyaratan berikut belum lengkap: ${missingNames}.`,
            code: "WORK_READINESS_INCOMPLETE",
            details: evaluation,
          },
          { status: 422 }
        );
      }

      const updatedRoute = await EstimationIntegrationService.updateWorkStatus(
        id,
        "READY_FOR_WORK",
        { readinessEvidences: route.readinessData || {} }
      );

      return NextResponse.json({
        success: true,
        data: {
          workStatus: "READY_FOR_WORK",
          route: updatedRoute,
          evaluation,
          message: "Status pekerjaan berhasil dialihkan ke SIAP DIKERJAKAN (READY_FOR_WORK).",
        },
      });
    }

    // Boolean Approval Update
    const rawReqKey = body.requirement_key || body.key;
    if (!rawReqKey) {
      return NextResponse.json(
        { error: "Key persyaratan (requirement_key) wajib disertakan.", code: "MISSING_KEY" },
        { status: 400 }
      );
    }

    const reqKey = rawReqKey.toString().trim() as WorkReadinessRequirementKey;
    const booleanVal = body.value !== undefined ? Boolean(body.value) : undefined;

    const updateResult = await processReadinessUpdate({
      reportId: id,
      actor: {
        id: sessionUser.id,
        name: sessionUser.name,
        branch: sessionUser.branch,
      },
      requirementKey: reqKey,
      booleanValue: booleanVal,
      notes: body.notes,
    });

    try {
      const { assignIncidentPicForPersistedAction } = await import("@/lib/incident-assignment");
      const { getDbPool } = await import("@/lib/db");
      await assignIncidentPicForPersistedAction(getDbPool(), {
        incidentId: id,
        userId: sessionUser.id,
        branch: sessionUser.branch,
        role: sessionUser.role,
        action: "READINESS_UPDATED",
      });
    } catch (picErr) {
      console.warn("[readiness/route] Auto-assign PIC warning:", picErr);
    }

    return NextResponse.json({
      success: true,
      data: updateResult,
    });
  } catch (err: any) {
    console.error("[POST /api/incidents/:id/readiness]", err);
    const status = err.status || 500;
    return NextResponse.json(
      {
        error: err.message || "Gagal memproses pembaruan kesiapan kerja.",
        code: err.code || "INTERNAL_ERROR",
        details: err.details,
      },
      { status }
    );
  }
}
