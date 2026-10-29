import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { dbGetIncidentById } from "@/lib/incident-db";
import { canAccessReportAsync } from "@/lib/report-access-policy";
import { checkUserPermission } from "@/lib/permission-service";
import { EstimationIntegrationService, HandlerType } from "@/lib/estimation-service";

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

    if (!await canAccessReportAsync(sessionUser, incident)) {
      return NextResponse.json(
        { error: "Unauthorized: Anda tidak memiliki izin untuk melihat laporan ini." },
        { status: 403 }
      );
    }

    // Cek permission ESTIMATION_VIEW
    const permCheck = await checkUserPermission({
      user: sessionUser,
      permission: "ESTIMATION_VIEW",
      report: incident,
    });

    if (!permCheck.authorized) {
      return NextResponse.json(
        { error: "Unauthorized: Anda tidak memiliki izin untuk melihat status estimasi laporan ini." },
        { status: 403 }
      );
    }

    const route = await EstimationIntegrationService.getRouteByReportId(id);
    return NextResponse.json({ data: route });
  } catch (err: any) {
    console.error("[GET /api/incidents/:id/estimation]", err);
    return NextResponse.json(
      { error: "Gagal memuat status estimasi laporan." },
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

    // 2. Pengguna HO hanya read-only
    if (sessionUser.scope === "HO" && sessionUser.systemRole !== "ADMIN") {
      return NextResponse.json(
        { error: "Forbidden: Pengguna HO hanya memiliki hak akses baca (read-only)." },
        { status: 403 }
      );
    }

    // 3. Load report dari DB
    const { id } = await params;
    const incident = await dbGetIncidentById(id);
    if (!incident) {
      return NextResponse.json(
        { error: "Laporan tidak ditemukan.", code: "REPORT_NOT_FOUND" },
        { status: 404 }
      );
    }

    // 4. Validate report status eligibility
    if (incident.status === "confirmed_safe") {
      return NextResponse.json(
        {
          error: "Laporan berstatus aman (confirmed_safe). Estimasi perbaikan hanya berlaku untuk laporan yang dikonfirmasi mengalami kerusakan fisik.",
          code: "REPORT_SAFE_NO_ESTIMATION",
        },
        { status: 422 }
      );
    }

    const unapprovedStatuses = [
      "pending_confirmation",
      "verifying",
      "pending_bm_approval",
      "clarification_requested",
      "rejected_invalid",
      "expired_unhandled",
    ];
    if (unapprovedStatuses.includes(incident.status)) {
      return NextResponse.json(
        {
          error: "Estimasi perbaikan hanya dapat diproses setelah laporan dikonfirmasi mengalami kerusakan (confirmed_affected) oleh BnM Manajer.",
          code: "REPORT_NOT_CONFIRMED_AFFECTED",
        },
        { status: 422 }
      );
    }

    if (incident.status === "resolved" || incident.status === "archived" || incident.status === "closed") {
      return NextResponse.json(
        {
          error: "Laporan yang telah selesai atau ditutup tidak dapat dibuatkan estimasi baru.",
          code: "REPORT_NOT_ELIGIBLE",
        },
        { status: 422 }
      );
    }

    // 5. Tentukan Handler otomatis berdasarkan TKP (Toko -> BMS, DC/Warehouse -> BES)
    const tkp = (incident.tkpType || "toko").trim().toLowerCase();
    const isTkpDc = tkp === "dc";
    const autoHandler: HandlerType = isTkpDc ? "BES" : "BMS";

    // Validasi kesesuaian role dengan jenis lokasi (hanya berlaku jika bukan Admin)
    const actorRole = (sessionUser.role || "").toLowerCase();
    const isSysAdmin = sessionUser.systemRole === "ADMIN";
    if (!isSysAdmin) {
      if (isTkpDc && actorRole === "bms") {
        return NextResponse.json(
          {
            error: "Laporan DC/Warehouse ditangani oleh petugas BES, bukan BMS.",
            code: "ROLE_LOCATION_MISMATCH",
          },
          { status: 403 }
        );
      }
      if (!isTkpDc && actorRole === "bes") {
        return NextResponse.json(
          {
            error: "Laporan Toko ditangani oleh petugas BMS, bukan BES.",
            code: "ROLE_LOCATION_MISMATCH",
          },
          { status: 403 }
        );
      }
    }

    // 6. Cek server-side permission ESTIMATION_TRIGGER
    const permCheck = await checkUserPermission({
      user: sessionUser,
      permission: "ESTIMATION_TRIGGER",
      report: incident,
    });

    if (!permCheck.authorized) {
      return NextResponse.json(
        {
          error:
            permCheck.reason ||
            "Unauthorized: Anda tidak memiliki izin untuk membuat estimasi pada laporan ini.",
          code: "FORBIDDEN",
        },
        { status: 403 }
      );
    }

    // 7. Cek duplicate protection (1 active route per report)
    const existingRoute = await EstimationIntegrationService.getRouteByReportId(id);
    if (existingRoute) {
      return NextResponse.json(
        {
          error:
            "Conflict: Laporan ini sudah memiliki rute estimasi aktif. Duplikasi estimasi tidak diizinkan.",
          code: "DUPLICATE_ROUTE",
        },
        { status: 409 }
      );
    }

    // 8. Tentukan handler (Otomatis berdasarkan lokasi; pilihan manual ditiadakan)
    const body = await request.json().catch(() => ({}));
    const rawHandler = (body.handler || body.handlerType || "").toString().trim().toUpperCase();
    const handlerType: HandlerType = rawHandler === "BES" || rawHandler === "BMS" ? (rawHandler as HandlerType) : autoHandler;

    // 9. Create routing record (clean, no fake data, initial status WAITING_ESTIMATION)
    const created = await EstimationIntegrationService.createRoute({
      reportId: id,
      handlerType,
      actor: {
        id: sessionUser.id,
        name: sessionUser.name,
        nik: sessionUser.nik,
      },
      report: incident,
    });

    try {
      const { assignIncidentPicForPersistedAction } = await import("@/lib/incident-assignment");
      const { getDbPool } = await import("@/lib/db");
      await assignIncidentPicForPersistedAction(getDbPool(), {
        incidentId: id,
        userId: sessionUser.id,
        branch: sessionUser.branch,
        role: sessionUser.role,
        action: "ESTIMATION_TRIGGERED",
      });
    } catch (picErr) {
      console.warn("[estimation/route] Auto-assign PIC warning:", picErr);
    }

    return NextResponse.json(
      {
        message: "Rute estimasi berhasil dibuat.",
        data: created,
      },
      { status: 201 }
    );
  } catch (err: any) {
    console.error("[POST /api/incidents/:id/estimation]", err);
    if (err.status) {
      return NextResponse.json(
        { error: err.message, code: err.code || "ESTIMATION_ERROR" },
        { status: err.status }
      );
    }
    return NextResponse.json(
      { error: "Gagal memproses pembuatan rute estimasi.", code: "INTERNAL_ERROR" },
      { status: 500 }
    );
  }
}
