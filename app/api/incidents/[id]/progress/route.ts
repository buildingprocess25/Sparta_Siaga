import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { dbGetIncidentById } from "@/lib/incident-db";
import { canAccessReportAsync } from "@/lib/report-access-policy";
import { checkUserPermission } from "@/lib/permission-service";
import { EstimationIntegrationService } from "@/lib/estimation-service";
import { ProgressService, PhotoType } from "@/lib/progress-service";
import { processAndWatermarkPhoto, validateImageMagicBytes } from "@/lib/watermark";

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

    // Role-based visibility
    const canView = await canAccessReportAsync(sessionUser, incident);
    if (!canView) {
      return NextResponse.json(
        { error: "Unauthorized: Anda tidak memiliki izin untuk melihat laporan ini." },
        { status: 403 }
      );
    }

    const [estimationRoute, history, latestStatus, hasFinalEvidence, updateCheck, closeCheck] =
      await Promise.all([
        EstimationIntegrationService.getRouteByReportId(id),
        ProgressService.getProgressHistory(id),
        ProgressService.getLatestProgress(id),
        ProgressService.hasFinalOrHandoverEvidence(id),
        checkUserPermission({ user: sessionUser, permission: "REPORT_UPDATE_PROGRESS", report: incident }),
        checkUserPermission({ user: sessionUser, permission: "REPORT_CLOSE", report: incident }),
      ]);

    const isEstimationEligible =
      estimationRoute !== null &&
      (estimationRoute.workStatus === "READY_FOR_WORK" ||
        estimationRoute.workStatus === "IN_PROGRESS" ||
        estimationRoute.workStatus === "COMPLETED");

    // Transform photo paths to protected endpoint URLs (private storage keys → protected API)
    const protectedHistory = history.map((entry) => ({
      ...entry,
      photos: entry.photos.map((photo) => ({
        ...photo,
        // Replace raw storage keys with protected API URLs
        watermarkedPath: `/api/incidents/${id}/progress/evidence/${encodeURIComponent(photo.watermarkedPath.split('/').pop() || photo.watermarkedPath)}`,
        originalPath: `/api/incidents/${id}/progress/evidence/${encodeURIComponent(photo.originalPath.split('/').pop() || photo.originalPath)}`,
      })),
    }));

    return NextResponse.json({
      data: {
        reportId: id,
        estimationRoute,
        isEstimationEligible,
        latestProgress: latestStatus.latestPercentage,
        workStatus: latestStatus.workStatus,
        hasFinalEvidence,
        history: protectedHistory,
        canUpdateProgress: updateCheck.authorized,
        updateProgressReason: updateCheck.reason || "",
        canClose: closeCheck.authorized,
        closeReason: closeCheck.reason || "",
      },
    });
  } catch (err: any) {
    console.error("[GET /api/incidents/:id/progress]", err);
    return NextResponse.json(
      { error: "Gagal memuat data progress laporan." },
      { status: 500 }
    );
  }
}

export async function POST(request: Request, { params }: RouteContext) {
  try {
    // 1. Authenticate session
    const sessionUser = await getSessionUser(request);
    if (!sessionUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // 2. HO tidak boleh tindakan operasional progress
    if (sessionUser.scope === "HO") {
      return NextResponse.json(
        { error: "Forbidden: Akun Head Office tidak memiliki izin memperbarui progress." },
        { status: 403 }
      );
    }

    // 3. Load report
    const { id } = await params;
    const incident = await dbGetIncidentById(id);
    if (!incident) {
      return NextResponse.json({ error: "Laporan tidak ditemukan." }, { status: 404 });
    }

    if (incident.status === "closed" || incident.status === "resolved" || incident.status === "archived") {
      return NextResponse.json(
        { error: "Laporan sudah ditutup/selesai. Tidak dapat memperbarui progress pekerjaan.", code: "REPORT_CLOSED" },
        { status: 422 }
      );
    }

    const preApprovalStatuses = [
      "pending_confirmation",
      "verifying",
      "investigating",
      "pending_bm_approval",
      "clarification_requested",
    ];
    if (preApprovalStatuses.includes(incident.status)) {
      return NextResponse.json(
        { error: "Tindakan progres fisik belum dapat dilakukan karena laporan belum disetujui BnM Manajer.", code: "REPORT_NOT_APPROVED" },
        { status: 422 }
      );
    }

    if (incident.status === "confirmed_safe" || incident.status === "rejected_invalid") {
      return NextResponse.json(
        { error: "Laporan berstatus aman atau ditolak tidak memerlukan penanganan progress fisik.", code: "REPORT_TERMINAL" },
        { status: 422 }
      );
    }

    // 4. Permission check REPORT_UPDATE_PROGRESS
    const permCheck = await checkUserPermission({
      user: sessionUser,
      permission: "REPORT_UPDATE_PROGRESS",
      report: incident,
    });

    if (!permCheck.authorized) {
      return NextResponse.json(
        {
          error:
            permCheck.reason ||
            "Unauthorized: Anda tidak memiliki izin untuk memperbarui progress pada laporan ini.",
        },
        { status: 403 }
      );
    }

    // 5. Cek status estimasi dan kesiapan kerja (Section D & I)
    // Update Progress HANYA boleh aktif jika Work Status = READY_FOR_WORK atau IN_PROGRESS.
    const estimationRoute = await EstimationIntegrationService.getRouteByReportId(id);
    if (!estimationRoute) {
      return NextResponse.json(
        {
          error:
            "Progress pekerjaan belum dapat diperbarui karena proses estimasi belum dimulai.",
          code: "ESTIMATION_NOT_FOUND",
        },
        { status: 422 }
      );
    }

    if (estimationRoute.workStatus === "NOT_READY") {
      return NextResponse.json(
        {
          error:
            "Progress pekerjaan belum dapat diperbarui. Status pekerjaan saat ini: 'Belum Siap Dikerjakan' (menunggu konfirmasi resmi siap kerja setelah estimasi selesai).",
          code: "WORK_NOT_READY",
        },
        { status: 422 }
      );
    }

    // COMPLETED Lock (Section AB): work already completed cannot receive new updates
    if (estimationRoute.workStatus === "COMPLETED") {
      return NextResponse.json(
        {
          error:
            "Pekerjaan telah diselesaikan (COMPLETED). Update progress baru tidak diizinkan.",
          code: "WORK_ALREADY_COMPLETED",
        },
        { status: 422 }
      );
    }

    // 6. Parse multipart/form-data
    const contentType = request.headers.get("content-type") || "";
    if (!contentType.includes("multipart/form-data")) {
      return NextResponse.json(
        { error: "Format request harus multipart/form-data untuk upload foto dan data progress." },
        { status: 400 }
      );
    }

    const formData = await request.formData();
    const rawPercentage = formData.get("progress_percentage") || formData.get("progress");
    const description = (formData.get("description") || "").toString().trim();
    const notes = (formData.get("notes") || "").toString().trim();
    const rawStage = (formData.get("stage") as string) || "PENGERJAAN";
    const validStages = ["PERSIAPAN", "PENGERJAAN", "FINISHING", "SELESAI", "SERAH_TERIMA"];
    const stage = validStages.includes(rawStage.toUpperCase()) ? rawStage.toUpperCase() : "PENGERJAAN";
    const defaultPhotoType = ((formData.get("photo_type") as string) || "PROGRESS").toUpperCase() as PhotoType;

    if (!rawPercentage) {
      return NextResponse.json({ error: "Persentase progress wajib diisi." }, { status: 400 });
    }

    const percentage = parseInt(rawPercentage.toString(), 10);
    if (isNaN(percentage) || percentage < 0 || percentage > 100) {
      return NextResponse.json(
        { error: "Persentase progress harus berada di antara 0% dan 100%." },
        { status: 400 }
      );
    }

    if (!description) {
      return NextResponse.json(
        { error: "Keterangan progress wajib diisi." },
        { status: 400 }
      );
    }

    // Monotonic check against latest progress
    const latestStatus = await ProgressService.getLatestProgress(id);
    if (percentage < latestStatus.latestPercentage) {
      return NextResponse.json(
        {
          error: `Progress tidak boleh lebih kecil dari progress sebelumnya (${latestStatus.latestPercentage}%).`,
        },
        { status: 400 }
      );
    }

    // 7. Collect files
    const fileEntries: File[] = [];
    for (const [key, val] of formData.entries()) {
      if ((key === "photo" || key === "photos" || key === "file" || key === "files") && val instanceof File) {
        if (val.size > 0) fileEntries.push(val);
      }
    }

    if (fileEntries.length === 0) {
      return NextResponse.json(
        { error: "Foto progress wajib dilampirkan minimal 1 foto." },
        { status: 400 }
      );
    }

    // 8. Process each photo with automated server watermark
    const processedPhotos: Array<{
      photoType: PhotoType;
      originalPath: string;
      watermarkedPath: string;
      fileSize: number;
      mimeType: string;
    }> = [];

    for (const file of fileEntries) {
      // Validate file size (max 10MB)
      if (file.size > 10 * 1024 * 1024) {
        return NextResponse.json(
          { error: `Ukuran file ${file.name} melebihi batas maksimal 10MB.` },
          { status: 400 }
        );
      }

      const arrayBuffer = await file.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      // Validate magic bytes
      const { valid, mimeType } = validateImageMagicBytes(buffer);
      if (!valid) {
        return NextResponse.json(
          {
            error: `File ${file.name} bukan format gambar valid. Hanya JPEG, PNG, dan WEBP yang diizinkan.`,
          },
          { status: 400 }
        );
      }

      // Generate watermark with user-facing report number & store name
      const wmResult = await processAndWatermarkPhoto(buffer, {
        reportId: id,
        reportNumber: incident.id,
        storeName: incident.storeName || "Toko Cabang",
        progressPercentage: percentage,
        actorName: sessionUser.name,
        photoType: defaultPhotoType,
      });

      processedPhotos.push({
        photoType: defaultPhotoType,
        originalPath: wmResult.originalPath,
        watermarkedPath: wmResult.watermarkedPath,
        fileSize: wmResult.fileSize,
        mimeType: wmResult.mimeType,
      });
    }

    // 9. Save to ProgressService (Append-only)
    const createdUpdate = await ProgressService.createProgressUpdate({
      reportId: id,
      progressPercentage: percentage,
      description,
      stage: stage as any,
      notes,
      actor: {
        id: sessionUser.id,
        name: sessionUser.name,
        branch: sessionUser.branch,
      },
      photos: processedPhotos,
    });

    try {
      const { assignIncidentPicForPersistedAction } = await import("@/lib/incident-assignment");
      const { getDbPool } = await import("@/lib/db");
      await assignIncidentPicForPersistedAction(getDbPool(), {
        incidentId: id,
        userId: sessionUser.id,
        branch: sessionUser.branch,
        role: sessionUser.role,
        action: "PROGRESS_UPDATED",
      });
    } catch (picErr) {
      console.warn("[progress/route] Auto-assign PIC warning:", picErr);
    }

    // Transform response photo paths to protected API URLs
    const protectedResult = {
      ...createdUpdate,
      photos: createdUpdate.photos.map((photo) => ({
        ...photo,
        watermarkedPath: `/api/incidents/${id}/progress/evidence/${encodeURIComponent(photo.watermarkedPath.split('/').pop() || photo.watermarkedPath)}`,
        originalPath: `/api/incidents/${id}/progress/evidence/${encodeURIComponent(photo.originalPath.split('/').pop() || photo.originalPath)}`,
      })),
    };

    return NextResponse.json(
      {
        message: "Progress pekerjaan berhasil diperbarui.",
        data: protectedResult,
      },
      { status: 201 }
    );
  } catch (err: any) {
    console.error("[POST /api/incidents/:id/progress]", err);
    if (err.status) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json(
      { error: "Gagal menyimpan progress pekerjaan." },
      { status: 500 }
    );
  }
}
