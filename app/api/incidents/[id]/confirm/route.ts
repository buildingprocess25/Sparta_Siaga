/**
 * SPARTA SIAGA — Branch Inspection Submission & BM Approval API
 * POST /api/incidents/[id]/confirm
 */

import { NextResponse } from "next/server";
import { dbGetIncidentById, dbUpdateIncident } from "@/lib/incident-db";
import {
  canSubmitInspectionAsync,
  canApproveAsBmAsync,
} from "@/lib/permission-service";
import { getSessionUser } from "@/lib/auth";
import {
  InspectionCondition,
  InspectionMethod,
  InspectionEvidence,
  OfficerSource,
  BmDecision,
  DamageReport,
  InspectionRevision,
  IncidentStatus,
} from "@/types/incident";
import { validateImageMagicBytes, processAndWatermarkPhoto } from "@/lib/watermark";
import { saveInspectionPhoto } from "@/lib/inspection-storage";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: RouteContext) {
  try {
    const { id } = await params;

    const report = await dbGetIncidentById(id);
    if (!report) {
      return NextResponse.json({ error: "Laporan tidak ditemukan" }, { status: 404 });
    }

    const sessionUser = await getSessionUser(request);
    if (!sessionUser) {
      return NextResponse.json(
        { error: "Unauthorized: Sesi login diperlukan." },
        { status: 401 }
      );
    }

    if (sessionUser.scope === "HO") {
      return NextResponse.json(
        { error: "Forbidden: Akun Head Office hanya memiliki hak akses baca (read-only) dan dilarang melakukan aksi operasional atau approval cabang." },
        { status: 403 }
      );
    }

    if (report.status === "closed" || report.status === "resolved" || report.status === "archived") {
      return NextResponse.json(
        { error: "Laporan sudah ditutup/selesai. Tidak dapat melakukan perubahan operasional atau approval." },
        { status: 422 }
      );
    }

    const contentType = request.headers.get("content-type") || "";
    const nowWib = new Date().toLocaleString("id-ID", { timeZone: "Asia/Jakarta" }) + " WIB";

    let bodyData: Record<string, unknown> = {};
    const uploadedFiles: File[] = [];

    if (contentType.includes("multipart/form-data")) {
      const formData = await request.formData();
      for (const [key, value] of formData.entries()) {
        if (
          (key === "photo" || key === "photos" || key === "file" || key === "files") &&
          value instanceof File &&
          value.size > 0
        ) {
          uploadedFiles.push(value);
        } else if (typeof value === "string") {
          try {
            bodyData[key] = JSON.parse(value);
          } catch {
            bodyData[key] = value;
          }
        }
      }
    } else {
      bodyData = await request.json();
    }

    // =========================================================================
    // BRANCH MANAGER APPROVAL DECISION PATH
    // =========================================================================
    const action = (bodyData.action as string) || "";
    const isBmAction = action === "bm_approval" || action === "bm_decision" || bodyData.decision !== undefined;

    if (isBmAction) {
      if (
        report.status === "confirmed_affected" ||
        report.status === "confirmed_safe" ||
        report.verification?.bmApproval?.decision === "approved" ||
        report.verification?.bmApproval?.decision === "safe"
      ) {
        return NextResponse.json(
          {
            error: "Laporan ini sudah dikonfirmasi sebelumnya oleh BnM Manajer.",
            code: "REPORT_ALREADY_CONFIRMED",
          },
          { status: 409 }
        );
      }

      const bmAuth = await canApproveAsBmAsync(sessionUser, report);
      if (!bmAuth.authorized) {
        return NextResponse.json(
          { error: bmAuth.reason || "Unauthorized: Hanya BnM Manajer yang dapat memberikan persetujuan." },
          { status: 403 }
        );
      }

      const rawDecision = (bodyData.decision as string) || "";
      const validDecisions: BmDecision[] = ["approved", "safe", "rejected", "clarification_requested"];
      if (!validDecisions.includes(rawDecision as BmDecision)) {
        return NextResponse.json(
          { error: "Keputusan BnM Manajer tidak valid. Pilihan: approved, safe, rejected, clarification_requested." },
          { status: 400 }
        );
      }
      const decision = rawDecision as BmDecision;
      const notes = (bodyData.notes as string)?.trim() || "";
      const reason = (bodyData.reason as string)?.trim() || (bodyData.notes as string)?.trim() || "";

      if (decision === "rejected") {
        const isAutoEarthquake =
          report.reportOrigin === "automatic_earthquake" ||
          (report.disasterType === "earthquake" && report.reportOrigin !== "manual");
        if (isAutoEarthquake) {
          return NextResponse.json(
            {
              error:
                "Laporan gempa otomatis tidak dapat ditolak sebagai laporan palsu/hoax. Jika kondisi lapangan aman dan tidak ada kerusakan, pilih 'Kondisi Aman' / 'Tidak Ada Kerusakan' untuk menutup laporan dengan aman.",
              code: "EARTHQUAKE_REJECTION_FORBIDDEN",
            },
            { status: 400 }
          );
        }
      }

      if (decision === "rejected" && report.reportOrigin !== "manual") {
        return NextResponse.json(
          { error: "Tolak Laporan hanya berlaku untuk laporan manual yang tidak valid.", code: "REPORT_REJECTION_MANUAL_ONLY" },
          { status: 400 }
        );
      }

      if ((decision === "rejected" || decision === "clarification_requested") && !reason) {
        return NextResponse.json(
          {
            error: decision === "rejected"
              ? "Alasan penolakan laporan wajib diisi."
              : "Catatan klarifikasi kepada petugas pemeriksa wajib diisi.",
          },
          { status: 400 }
        );
      }

      let newStatus: IncidentStatus;
      let timelineLabel: string;

      const actorRoleTitle = sessionUser.systemRole === "ADMIN" ? "Admin SPARTA SIAGA" : "BnM Manajer";
      const actorRoleTag = sessionUser.systemRole === "ADMIN" ? "ADMIN" : "BnM Manajer";

      switch (decision) {
        case "approved":
          newStatus = "confirmed_affected";
          timelineLabel = `Pemeriksaan Disetujui ${actorRoleTitle}: Laporan dinyatakan terkena dampak dan siap ditindaklanjuti. Catatan: ${notes || "Disetujui untuk perbaikan."}`;
          break;
        case "safe":
          newStatus = "confirmed_safe";
          timelineLabel = `Kondisi Dinyatakan Aman oleh ${actorRoleTitle}: Tidak ditemukan kerusakan operasional yang memerlukan tindakan. Catatan: ${notes || "Aman."}`;
          break;
        case "rejected":
          newStatus = "rejected_invalid";
          timelineLabel = `Laporan Ditolak oleh ${actorRoleTitle} (Tidak Valid / Hoax): ${reason}`;
          break;
        case "clarification_requested":
          newStatus = "clarification_requested";
          timelineLabel = `${actorRoleTitle} Meminta Klarifikasi Hasil Pemeriksaan: ${reason}`;
          break;
      }

      const existingVerification = report.verification;
      const updatedVerification: DamageReport = {
        ...(existingVerification || {
          confirmedBy: "Petugas Lapangan",
          confirmedAt: nowWib,
          isDamaged: decision === "approved",
        }),
        isDamaged: decision === "approved",
        bmApproval: {
          decision,
          decidedBy: `${sessionUser.name} (${actorRoleTag})`,
          decidedAt: nowWib,
          decisionNotes: notes,
          rejectionReason: decision === "rejected" ? reason : undefined,
          clarificationReason: decision === "clarification_requested" ? reason : undefined,
        },
      };

      const timelineEntry = {
        stage: `Keputusan ${actorRoleTitle}`,
        label: timelineLabel,
        timestamp: nowWib,
        actor: `${sessionUser.name} (${actorRoleTag})`,
        notes: reason || notes,
      };

      if (decision === "approved" || decision === "safe") {
        const { commitAtomicBmApprovalTransaction } = await import("@/lib/approval-event-service");
        const atomicRes = await commitAtomicBmApprovalTransaction({
          reportId: id,
          newStatus,
          updatedVerification,
          timelineEntry,
          approvalEvent: {
            eventId: `appr_${id}`,
            reportId: id,
            decision,
            outcomeStatus: newStatus as "confirmed_affected" | "confirmed_safe",
            disasterType: report.disasterType,
            reportOrigin: report.reportOrigin,
            branch: report.branch,
            storeId: report.storeId,
            storeName: report.storeName,
            locationCity: report.locationCity,
            decidedBy: {
              userId: sessionUser.id,
              name: sessionUser.name,
              role: sessionUser.role || "bm",
              systemRole: sessionUser.systemRole,
            },
            decidedAt: nowWib,
            decisionNotes: notes,
            condition: decision === "approved" ? "damaged" : "safe",
            evidenceCount: (updatedVerification.photos?.length ?? 0) + (updatedVerification.evidenceDetails?.length ?? 0),
            publishedToHo: true,
            createdAt: new Date().toISOString(),
          },
        });

        if (!atomicRes.success) {
          if (atomicRes.conflict) {
            return NextResponse.json(
              { error: atomicRes.reason || "Laporan ini sudah dikonfirmasi sebelumnya oleh BnM Manajer.", code: "REPORT_ALREADY_CONFIRMED" },
              { status: 409 }
            );
          }
          return NextResponse.json(
            { error: atomicRes.reason || "Gagal menyimpan keputusan BnM Manajer." },
            { status: 500 }
          );
        }
      } else {
        await dbUpdateIncident(id, {
          status: newStatus,
          verification: updatedVerification,
          timeline: [...(report.timeline || []), timelineEntry],
        });
      }

      return NextResponse.json({
        data: {
          report_id: id,
          status: newStatus,
          decision,
          decided_by: sessionUser.name,
          decided_at: nowWib,
        },
      });
    }

    // =========================================================================
    // BMS / BES INSPECTION SUBMISSION PATH
    // =========================================================================
    const inspectionAuth = await canSubmitInspectionAsync(sessionUser, report);
    if (!inspectionAuth.authorized) {
      return NextResponse.json(
        { error: inspectionAuth.reason || "Unauthorized: Anda tidak berwenang memeriksa laporan ini." },
        { status: 403 }
      );
    }

    // Process and collect photos
    const photoUrls: string[] = [];
    const evidenceDetails: InspectionEvidence[] = [];

    // Pre-existing or JSON-passed photo URLs
    if (Array.isArray(bodyData.photos)) {
      for (const p of bodyData.photos) {
        if (typeof p === "string" && p.trim()) {
          photoUrls.push(p.trim());
          evidenceDetails.push({
            photoUrl: p.trim(),
            sourceType: (bodyData.source_type as "camera" | "gallery" | "officer_upload") || "camera",
            timestamp: nowWib,
          });
        }
      }
    }

    // Process newly uploaded files
    for (const file of uploadedFiles) {
      if (file.size > 10 * 1024 * 1024) {
        return NextResponse.json(
          { error: `Ukuran foto ${file.name} melebihi batas 10MB.` },
          { status: 400 }
        );
      }

      const arrayBuffer = await file.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      const { valid, mimeType } = validateImageMagicBytes(buffer);
      if (!valid) {
        return NextResponse.json(
          { error: `Berkas ${file.name} bukan gambar yang valid (JPEG, PNG, WEBP).` },
          { status: 400 }
        );
      }

      const wmResult = await processAndWatermarkPhoto(buffer, {
        reportId: id,
        reportNumber: report.id,
        storeName: report.storeName || "Lokasi Pelaporan",
        progressPercentage: 0,
        actorName: sessionUser.name,
        photoType: "INSPECTION",
      });

      const saved = await saveInspectionPhoto(
        buffer,
        Buffer.from(wmResult.watermarkedDiskPath ? await (await import("fs/promises")).readFile(wmResult.watermarkedDiskPath) : buffer),
        id,
        mimeType,
        file.name
      );

      photoUrls.push(saved.url);
      evidenceDetails.push({
        photoUrl: saved.url,
        photoPath: saved.storageKey,
        sourceType: (bodyData.source_type as "camera" | "gallery" | "officer_upload") || "camera",
        officerName: typeof bodyData.officer_name === "string" ? bodyData.officer_name : undefined,
        officerContact: typeof bodyData.officer_contact === "string" ? bodyData.officer_contact : undefined,
        officerRole: typeof bodyData.officer_role === "string" ? bodyData.officer_role : undefined,
        timestamp: nowWib,
      });
    }

    // Requirement 4: Minimal satu foto diwajibkan untuk submit pemeriksaan
    if (photoUrls.length === 0) {
      return NextResponse.json(
        { error: "Minimal satu foto bukti pemeriksaan wajib dilampirkan." },
        { status: 400 }
      );
    }

    // Extract condition
    let condition: InspectionCondition = "damaged";
    if (bodyData.condition === "safe" || bodyData.condition === "uncertain" || bodyData.condition === "damaged") {
      condition = bodyData.condition as InspectionCondition;
    } else if (bodyData.is_damaged === false) {
      condition = "safe";
    }

    const isDamaged = condition === "damaged";
    const inspectionMethod: InspectionMethod =
      bodyData.inspection_method === "informasi_petugas"
        ? "informasi_petugas"
        : "kunjungan_langsung";

    let officerSource: OfficerSource | undefined = undefined;
    if (inspectionMethod === "informasi_petugas") {
      const offName = (bodyData.officer_name as string)?.trim() || "";
      officerSource = {
        name: offName || "Petugas Lokasi",
        contact: (bodyData.officer_contact as string)?.trim() || undefined,
        role: (bodyData.officer_role as string)?.trim() || "Petugas Toko / DC",
        channel: (bodyData.officer_channel as string)?.trim() || "WhatsApp / Media Perusahaan",
      };
    }

    const notes = (bodyData.notes as string)?.trim() || (bodyData.damage_notes as string)?.trim() || "";
    const rawCats = bodyData.categories;
    const categories = Array.isArray(rawCats) ? (rawCats as string[]) : isDamaged ? ["Rak Barang"] : [];
    const severity = (bodyData.severity as "Ringan" | "Sedang" | "Berat") || "Sedang";
    const operationalStatus = (bodyData.operational_status as "Buka Normal" | "Tutup Sementara") || "Buka Normal";

    // Manage revision history if report was previously inspected or under clarification
    const revisions: InspectionRevision[] = Array.isArray(report.verification?.revisions)
      ? [...report.verification.revisions]
      : [];

    if (report.verification?.confirmedBy) {
      revisions.push({
        revisionNumber: revisions.length + 1,
        submittedAt: report.verification.confirmedAt || nowWib,
        inspectorName: report.verification.confirmedBy,
        inspectorRole: sessionUser.role || "BMS",
        inspectionMethod: report.verification.inspectionMethod || "kunjungan_langsung",
        condition: report.verification.condition || (report.verification.isDamaged ? "damaged" : "safe"),
        notes: report.verification.notes || "",
        categories: report.verification.categories,
        severity: report.verification.severity,
        photos: report.verification.photos || [],
        evidenceDetails: report.verification.evidenceDetails,
        officerSource: report.verification.officerSource,
      });
    }

    const inspectorRoleTag = sessionUser.systemRole === "ADMIN" ? "ADMIN" : (sessionUser.role?.toUpperCase() || "BMS");

    const newVerification: DamageReport = {
      confirmedBy: `${sessionUser.name} (${inspectorRoleTag})`,
      confirmedAt: nowWib,
      isDamaged,
      condition,
      inspectionMethod,
      officerSource,
      evidenceDetails,
      photos: photoUrls,
      categories: isDamaged ? categories : undefined,
      severity: isDamaged ? severity : undefined,
      operationalStatus,
      notes: notes || (isDamaged ? "Ada kerusakan fisik di lokasi." : condition === "safe" ? "Lokasi aman, operasional normal." : "Kondisi belum dapat dipastikan, perlu pengecekan lanjutan."),
      revisions,
    };

    const conditionText =
      condition === "damaged"
        ? "Ada Kerusakan Fisik"
        : condition === "safe"
        ? "Kondisi Aman"
        : "Belum Dapat Dipastikan";

    const timelineEntry = {
      stage: "Pemeriksaan Lapangan Diajukan",
      label: `Hasil pemeriksaan (${conditionText}) diajukan oleh ${sessionUser.name} (${inspectorRoleTag}). Metode: ${inspectionMethod === "informasi_petugas" ? "Informasi Petugas Lokasi" : "Kunjungan Langsung"}. Menunggu persetujuan BnM Manajer.`,
      timestamp: nowWib,
      actor: `${sessionUser.name} (${inspectorRoleTag})`,
      notes: notes || undefined,
    };

    // Auto-affected store status update if multi-store
    const updatedAffectedStores = (report.affectedStores ?? []).map((store) => ({
      ...store,
      confirmation_status: isDamaged ? ("confirmed_damaged" as const) : ("confirmed_safe" as const),
      confirmed_by: sessionUser.name,
      confirmed_at: new Date().toISOString(),
      damage_notes: notes || store.damage_notes,
    }));

    // Status moves to pending_bm_approval; progress remains 0%
    await dbUpdateIncident(id, {
      status: "pending_bm_approval",
      verification: newVerification,
      fieldPhotos: photoUrls,
      affectedStores: updatedAffectedStores,
      timeline: [...(report.timeline || []), timelineEntry],
    });

    try {
      const { assignIncidentPicForPersistedAction } = await import("@/lib/incident-assignment");
      const { getDbPool } = await import("@/lib/db");
      await assignIncidentPicForPersistedAction(getDbPool(), {
        incidentId: id,
        userId: sessionUser.id,
        branch: sessionUser.branch,
        role: sessionUser.role,
        action: "INSPECTION_SUBMITTED",
      });
    } catch (picErr) {
      console.warn("[confirm/route] Auto-assign PIC warning:", picErr);
    }

    return NextResponse.json({
      data: {
        report_id: id,
        status: "pending_bm_approval",
        inspector: sessionUser.name,
        inspection_method: inspectionMethod,
        condition,
        photos: photoUrls,
      },
    });
  } catch (err) {
    console.error("[POST /api/incidents/:id/confirm]", err);
    return NextResponse.json({ error: "Gagal menyimpan hasil pemeriksaan." }, { status: 500 });
  }
}
