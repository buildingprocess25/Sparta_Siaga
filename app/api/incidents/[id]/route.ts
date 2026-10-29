import { NextResponse } from "next/server";
import {
  dbGetIncidentById,
  dbUpdateIncident,
  dbDeleteIncident,
} from "@/lib/incident-db";
import { getSessionUser } from "@/lib/auth";
import { checkMutationAuthorization } from "@/lib/permission-service";
import { canAccessReportAsync } from "@/lib/report-access-policy";

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
      return NextResponse.json({ error: "Laporan tidak ditemukan" }, { status: 404 });
    }

    // Role-based visibility
    const canView = await canAccessReportAsync(sessionUser, incident);
    if (!canView) {
      return NextResponse.json({ error: "Unauthorized: Akses laporan ditolak." }, { status: 403 });
    }

    return NextResponse.json({ data: incident });
  } catch (err) {
    console.error("[GET /api/incidents/:id]", err);
    return NextResponse.json({ error: "Gagal memuat laporan" }, { status: 500 });
  }
}

export async function PATCH(request: Request, { params }: RouteContext) {
  try {
    const sessionUser = await getSessionUser(request);
    if (!sessionUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (sessionUser.scope === "HO" && sessionUser.systemRole !== "ADMIN") {
      return NextResponse.json(
        { error: "Forbidden: Akun Head Office hanya memiliki hak akses baca (read-only)." },
        { status: 403 }
      );
    }
    
    const { id } = await params;
    const incident = await dbGetIncidentById(id);
    if (!incident) {
      return NextResponse.json({ error: "Laporan tidak ditemukan" }, { status: 404 });
    }

    const patch = await request.json();

    // Protect evidence already accepted by the dedicated inspection endpoint.
    // Older frontend callbacks may PATCH a partial verification object lacking
    // photos/evidenceDetails; never erase authenticated inspection evidence.
    if (patch.verification && typeof patch.verification === "object" && !Array.isArray(patch.verification)) {
      const existing = incident.verification;
      if (existing) {
        const incoming = patch.verification as Record<string, unknown>;
        patch.verification = {
          ...existing,
          ...incoming,
          photos: Array.isArray(incoming.photos) && incoming.photos.length
            ? incoming.photos
            : existing.photos ?? [],
          evidenceDetails: Array.isArray(incoming.evidenceDetails) && incoming.evidenceDetails.length
            ? incoming.evidenceDetails
            : existing.evidenceDetails ?? [],
          inspectionMethod: incoming.inspectionMethod ?? existing.inspectionMethod,
          officerSource: incoming.officerSource ?? existing.officerSource,
          revisions: incoming.revisions ?? existing.revisions,
          bmApproval: incoming.bmApproval ?? existing.bmApproval,
        };
      }
    }
    if (incident.fieldPhotos?.length &&
        (!Array.isArray(patch.fieldPhotos) || patch.fieldPhotos.length === 0)) {
      delete patch.fieldPhotos;
    }

    // Handling Target Penyelesaian (completedAt) update for BMS/BES
    if (patch.targetCompletionDate !== undefined) {
      const userRoleStr = (sessionUser.role || "").toLowerCase();
      const isTechnicalOfficer = sessionUser.systemRole === "ADMIN" || ["bms", "bes"].includes(userRoleStr) || incident.primaryPicUserId === sessionUser.id;
      if (!isTechnicalOfficer) {
        return NextResponse.json(
          { error: "Forbidden: Pengisian target selesai hanya dapat dilakukan oleh petugas teknis (BMS/BES) atau Admin." },
          { status: 403 }
        );
      }
      const existingTicket = incident.maintenanceTicket || { ticketId: `TCK-${id}` };
      const updatedTicket = {
        ...existingTicket,
        completedAt: patch.targetCompletionDate ? new Date(patch.targetCompletionDate).toISOString() : undefined,
      };
      patch.maintenanceTicket = updatedTicket;
      delete patch.targetCompletionDate;

      // Sync to report_estimation_routes if exists
      try {
        const { getDbPool } = await import("@/lib/db");
        await getDbPool().query(
          "UPDATE report_estimation_routes SET completed_at = $1 WHERE report_id = $2",
          [updatedTicket.completedAt || null, id]
        );
      } catch (e) {
        console.warn("[PATCH /api/incidents/:id] Sync estimation completed_at warning:", e);
      }

      // Record in audit timeline
      const nowWib = new Date().toLocaleString("id-ID", { timeZone: "Asia/Jakarta" }) + " WIB";
      const targetLabel = updatedTicket.completedAt
        ? new Date(updatedTicket.completedAt).toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" })
        : "Belum Ditentukan";
      patch.timeline = [
        ...(incident.timeline || []),
        {
          stage: "Target Selesai",
          label: `Target penyelesaian disetel ke ${targetLabel} oleh ${sessionUser.name}`,
          timestamp: nowWib,
          actor: sessionUser.name,
        },
      ];
    }

    const isConfirmation = Boolean(
      patch.verification && (!incident.verification || incident.status === "pending_confirmation" || incident.status === "verifying")
    );
    const isWorkClose = patch.status === "resolved" && (!isConfirmation || patch.verification?.isDamaged === true);
    const action = isConfirmation ? "confirm" : isWorkClose ? "close" : "act";

    const authResult = await checkMutationAuthorization(action, sessionUser, incident);
    if (!authResult.authorized) {
      return NextResponse.json({ error: authResult.reason }, { status: 403 });
    }

    if (isWorkClose) {
      const { ProgressService } = await import("@/lib/progress-service");
      const latest = await ProgressService.getLatestProgress(id);
      if (latest.latestPercentage < 100) {
        return NextResponse.json(
          { error: `Laporan hanya dapat diselesaikan jika progress pekerjaan telah mencapai 100% (saat ini ${latest.latestPercentage}%).` },
          { status: 400 }
        );
      }
      const hasFinal = await ProgressService.hasFinalOrHandoverEvidence(id);
      if (!hasFinal) {
        return NextResponse.json(
          { error: "Penutupan laporan wajib menyertakan foto bukti akhir pekerjaan (FINAL atau HANDOVER)." },
          { status: 400 }
        );
      }
    }

    const updated = await dbUpdateIncident(id, patch);
    return NextResponse.json({ data: updated });
  } catch (err) {
    console.error("[PATCH /api/incidents/:id]", err);
    return NextResponse.json({ error: "Gagal memperbarui laporan" }, { status: 500 });
  }
}

export async function DELETE(_: Request, { params }: RouteContext) {
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

    // Only HO Admin or GM should probably delete, but we'll use act for now or a custom check.
    // The instruction says "Close: TBD / deny for now. Do not invent Close permission."
    // Let's just fail closed for DELETE unless it's ho_admin for safety.
    if (sessionUser.systemRole !== "ADMIN") {
      return NextResponse.json({ error: "Hanya Administrator yang dapat menghapus laporan" }, { status: 403 });
    }

    const deleted = await dbDeleteIncident(id);
    return NextResponse.json({ data: { success: true, id } });
  } catch (err) {
    console.error("[DELETE /api/incidents/:id]", err);
    return NextResponse.json({ error: "Gagal menghapus laporan" }, { status: 500 });
  }
}
