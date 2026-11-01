import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { dbGetIncidentById } from "@/lib/incident-db";
import { canAccessReportAsync } from "@/lib/report-access-policy";
import {
  getMilestones,
  submitMilestoneDocument,
  checkOperationalProgressGating,
  checkMilestoneCompleteness,
} from "@/lib/milestone-service";
import { MilestoneKey, MILESTONE_CONFIG } from "@/types/incident";

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
      return NextResponse.json({ error: "Laporan tidak ditemukan." }, { status: 404 });
    }

    const canView = await canAccessReportAsync(sessionUser, incident);
    if (!canView) {
      return NextResponse.json(
        { error: "Unauthorized: Anda tidak memiliki izin untuk melihat laporan ini." },
        { status: 403 }
      );
    }

    const milestones = await getMilestones(id);
    const activeIndex = milestones.findIndex((m) => m.status !== "SUBMITTED");
    const activeMilestone = activeIndex !== -1 ? milestones[activeIndex] : null;
    const gating = await checkOperationalProgressGating(incident);
    const completeness = await checkMilestoneCompleteness(id);

    return NextResponse.json({
      data: {
        reportId: id,
        currentProgress: incident.progress,
        status: incident.status,
        milestones,
        activeMilestone,
        isCompleted: milestones.every((m) => m.status === "SUBMITTED"),
        isDocumentComplete: completeness.isDocumentComplete,
        missingDocuments: completeness.missingDocuments,
        completedStages: completeness.completedStages,
        isProgressGated: gating.isProgressGated,
        gatingReason: gating.gatingReason,
        nextRequiredAction: gating.nextRequiredAction,
        workStatus: gating.workStatus,
        estimationStatus: gating.estimationStatus,
      },
    });
  } catch (err: unknown) {
    console.error("[GET /api/incidents/:id/milestones]", err);
    return NextResponse.json(
      { error: "Gagal memuat status milestone laporan." },
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

    // HO users are strictly read-only
    if (sessionUser.scope === "HO") {
      return NextResponse.json(
        { error: "Forbidden: Akun Head Office hanya memiliki hak akses baca (read-only) dan dilarang mengunggah berkas milestone." },
        { status: 403 }
      );
    }

    const { id } = await params;
    const incident = await dbGetIncidentById(id);
    if (!incident) {
      return NextResponse.json({ error: "Laporan tidak ditemukan." }, { status: 404 });
    }

    if (incident.status === "closed" || incident.status === "resolved" || incident.status === "archived") {
      return NextResponse.json(
        { error: "Laporan sudah ditutup/selesai. Tidak dapat mengunggah dokumen milestone lagi." },
        { status: 422 }
      );
    }

    // System Admin cannot perform operational milestone upload
    if (sessionUser.systemRole === "ADMIN") {
      return NextResponse.json(
        {
          error: "Forbidden: System Administrator tidak dapat melakukan tindakan operasional upload berkas milestone.",
          code: "ADMIN_OPERATIONAL_BYPASS_BLOCKED",
        },
        { status: 403 }
      );
    }

    // Branch isolation
    const clean = (b?: string | null) => (b ? b.trim().toLowerCase() : "");
    if (!sessionUser.branch || clean(sessionUser.branch) !== clean(incident.branch)) {
      return NextResponse.json(
        { error: `Aksi hanya berlaku untuk cabang sendiri (${sessionUser.branch || "N/A"}), bukan ${incident.branch}.` },
        { status: 403 }
      );
    }

    // Facility category vs specialist role check for milestone uploads (Section 5)
    const tkp = (incident.tkpType || (incident.locationKind === "FACILITY" ? "dc" : "toko")).toLowerCase();
    const expectedRole = tkp === "dc" ? "bes" : tkp === "building" ? "bbs" : "bms";
    const userRole = (sessionUser.role || "").toLowerCase();
    if (userRole !== expectedRole) {
      return NextResponse.json(
        {
          error: `Unggah berkas milestone untuk fasilitas '${tkp.toUpperCase()}' hanya dapat dilakukan oleh spesialis ${expectedRole.toUpperCase()} cabang terkait.`,
          code: "FACILITY_ROLE_MISMATCH",
        },
        { status: 403 }
      );
    }

    // Operational Progress Gating Guard
    const gating = await checkOperationalProgressGating(incident);
    if (gating.isProgressGated) {
      return NextResponse.json(
        {
          error: `Progres operasional terkunci. ${gating.gatingReason} ${gating.nextRequiredAction ? `Tindakan: ${gating.nextRequiredAction}` : ""}`.trim(),
          code: "PROGRESS_GATED",
          gatingReason: gating.gatingReason,
          nextRequiredAction: gating.nextRequiredAction,
        },
        { status: 422 }
      );
    }
    const contentType = request.headers.get("content-type") || "";
    if (!contentType.includes("multipart/form-data")) {
      return NextResponse.json(
        { error: "Permintaan harus menggunakan format multipart/form-data." },
        { status: 400 }
      );
    }

    const formData = await request.formData();
    const rawStage = (formData.get("stage_key") || formData.get("stageKey") || formData.get("stage")) as string;
    const stageKey = rawStage ? (rawStage.trim().toUpperCase() as MilestoneKey) : ("" as MilestoneKey);
    const notes = (formData.get("notes") as string)?.trim() || "";

    // Audit Keamanan: isTestSimulation TIDAK DAPAT diaktifkan oleh request pengguna / API produksi umum.
    // Di lingkungan produksi, jalur simulasi sepenuhnya dinonaktifkan.
    const isProduction = process.env.NODE_ENV === "production" && process.env.SPARTA_ALLOW_TEST_SIMULATION !== "true";
    const internalTestHeader = request.headers.get("x-sparta-internal-test");
    const isSimulation = Boolean(
      !isProduction &&
      internalTestHeader &&
      process.env.SPARTA_INTERNAL_WORKER_SECRET &&
      internalTestHeader === process.env.SPARTA_INTERNAL_WORKER_SECRET &&
      formData.get("is_simulation") === "true"
    );

    if (!stageKey || !MILESTONE_CONFIG[stageKey]) {
      return NextResponse.json(
        { error: `Stage milestone tidak valid. Pilihan: CEKLIS, ESTIMASI, APPROVE_PROXY, SPK, SERAH_TERIMA.` },
        { status: 400 }
      );
    }

    // Extract file
    let targetFile: File | null = null;
    for (const [key, val] of formData.entries()) {
      if ((key === "file" || key === "document" || key === "photo") && val instanceof File && val.size > 0) {
        targetFile = val;
        break;
      }
    }

    if (!targetFile) {
      return NextResponse.json(
        { error: "Berkas dokumen bukti wajib dilampirkan (PDF atau JPEG/PNG)." },
        { status: 400 }
      );
    }

    if (targetFile.size > 15 * 1024 * 1024) {
      return NextResponse.json(
        { error: "Ukuran berkas melebihi batas maksimal 15 MB." },
        { status: 400 }
      );
    }

    const arrayBuffer = await targetFile.arrayBuffer();
    const fileBuffer = Buffer.from(arrayBuffer);

    const result = await submitMilestoneDocument({
      reportId: id,
      stageKey,
      actor: sessionUser,
      fileBuffer,
      originalFilename: targetFile.name,
      notes,
      isTestSimulation: isSimulation,
    });

    try {
      const { assignIncidentPicForPersistedAction } = await import("@/lib/incident-assignment");
      const { getDbPool } = await import("@/lib/db");
      await assignIncidentPicForPersistedAction(getDbPool(), {
        incidentId: id,
        userId: sessionUser.id,
        branch: sessionUser.branch,
        role: sessionUser.role,
        action: `MILESTONE_${stageKey}_SUBMITTED`,
      });
    } catch (picErr) {
      console.warn("[milestones/route] Auto-assign PIC warning:", picErr);
    }

    return NextResponse.json(
      {
        message: `Milestone ${result.milestone.stageName} (${result.milestone.targetProgress}%) berhasil diselesaikan.`,
        data: result,
      },
      { status: 200 }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Gagal memproses pengajuan milestone.";
    console.error("[POST /api/incidents/:id/milestones]", err);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
