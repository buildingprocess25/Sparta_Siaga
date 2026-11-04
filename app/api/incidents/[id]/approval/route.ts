/**
 * SPARTA SIAGA — Branch Manager Decision API
 * POST /api/incidents/[id]/approval
 */

import { NextResponse } from "next/server";
import { dbGetIncidentById, dbUpdateIncident } from "@/lib/incident-db";
import { canApproveAsBmAsync } from "@/lib/permission-service";
import { getSessionUser } from "@/lib/auth";
import { BmDecision, DamageReport, IncidentStatus } from "@/types/incident";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: RouteContext) {
  try {
    const sessionUser = await getSessionUser(request);
    if (!sessionUser) {
      return NextResponse.json({ error: "Unauthorized: Sesi login diperlukan." }, { status: 401 });
    }

    if (sessionUser.scope === "HO") {
      return NextResponse.json(
        { error: "Forbidden: Akun Head Office hanya memiliki hak akses baca (read-only) dan dilarang memberikan approval BnM Manajer." },
        { status: 403 }
      );
    }

    const { id } = await params;
    const report = await dbGetIncidentById(id);
    if (!report) {
      return NextResponse.json({ error: "Laporan tidak ditemukan" }, { status: 404 });
    }

    if (report.status === "closed" || report.status === "resolved" || report.status === "archived") {
      return NextResponse.json(
        { error: "Laporan sudah ditutup/selesai. Tidak dapat memberikan approval pemeriksaan awal." },
        { status: 422 }
      );
    }

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

    const body = await request.json();
    const rawDecision = (body.decision as string) || "";
    const validDecisions: BmDecision[] = ["approved", "safe", "rejected", "clarification_requested"];
    if (!validDecisions.includes(rawDecision as BmDecision)) {
      return NextResponse.json(
        { error: "Keputusan BnM Manajer tidak valid. Pilihan: approved, safe, rejected, clarification_requested." },
        { status: 400 }
      );
    }

    const decision = rawDecision as BmDecision;
    const notes = (body.notes as string)?.trim() || "";
    const reason = (body.reason as string)?.trim() || notes;

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

      if (report.reportOrigin !== "manual") {
        return NextResponse.json(
          { error: "Tolak Laporan hanya berlaku untuk laporan manual yang tidak valid.", code: "REPORT_REJECTION_MANUAL_ONLY" },
          { status: 400 }
        );
      }
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

    const nowWib = new Date().toLocaleString("id-ID", { timeZone: "Asia/Jakarta" }) + " WIB";
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
  } catch (err) {
    console.error("[POST /api/incidents/:id/approval]", err);
    return NextResponse.json({ error: "Gagal menyimpan keputusan BnM Manajer." }, { status: 500 });
  }
}
