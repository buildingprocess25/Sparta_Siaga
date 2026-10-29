import { NextResponse } from "next/server";
import { dbGetAllIncidents, dbCreateIncident } from "@/lib/incident-db";
import { IncidentRecord, isActiveStatus, isHistoryStatus } from "@/types/incident";
import { getSessionUser } from "@/lib/auth";
import { ReportDistributionService } from "@/lib/distribution-service";
import { canAccessReport } from "@/lib/report-access-policy";
import { isReportVisibleToHo } from "@/lib/report-permissions";
import { checkUserPermission } from "@/lib/permission-service";

export async function GET(request?: Request) {
  try {
    const sessionUser = await getSessionUser(request);
    if (!sessionUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const incidents = await dbGetAllIncidents();

    // Check if user has global read override REPORT_VIEW_ALL
    let hasGlobalViewOverride = false;
    if (sessionUser.systemRole !== "ADMIN" && sessionUser.scope !== "HO" && sessionUser.id) {
      const permCheck = await checkUserPermission({
        user: sessionUser,
        permission: "REPORT_VIEW_ALL",
      });
      hasGlobalViewOverride = permCheck.authorized;
    }

    let url: URL | null = null;
    if (request?.url) {
      try {
        url = new URL(request.url);
      } catch {}
    }
    const statusParam = url?.searchParams.get("status");

    let filteredIncidents = incidents.filter((inc) => {
      if (inc.id.startsWith("INC-TEST-")) return false;
      if (sessionUser.systemRole === "ADMIN") return true;
      if (hasGlobalViewOverride) {
        return canAccessReport(sessionUser, inc) || isReportVisibleToHo(inc);
      }
      return canAccessReport(sessionUser, inc);
    });

    if (statusParam === "active") {
      filteredIncidents = filteredIncidents.filter(
        (inc) => isActiveStatus(inc.status)
      );
    } else if (statusParam === "history" || statusParam === "closed") {
      filteredIncidents = filteredIncidents.filter(
        (inc) => isHistoryStatus(inc.status)
      );
    }

    return NextResponse.json({ data: filteredIncidents });
  } catch (err) {
    console.error("[GET /api/incidents]", err);
    return NextResponse.json(
      { error: "Gagal memuat data laporan" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const sessionUser = await getSessionUser(request);
    if (!sessionUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (sessionUser.scope === "HO" && sessionUser.systemRole !== "ADMIN") {
      return NextResponse.json(
        {
          error: "Forbidden: Pengguna HO hanya memiliki hak akses baca (read-only).",
          code: "HO_READ_ONLY",
        },
        { status: 403 }
      );
    }

    if (sessionUser.role === "tim_toko" || (sessionUser as any).businessRole === "tim_toko") {
      return NextResponse.json(
        {
          error: "Pelaporan mandiri oleh Tim Toko saat ini dinonaktifkan sementara. Laporan ditangani langsung melalui tim operasional cabang (BMS/BES).",
          code: "STORE_SELF_REPORT_DISABLED",
        },
        { status: 403 }
      );
    }

    const body: IncidentRecord = await request.json();
    if (!body.id || !body.disasterType || !body.storeId) {
      return NextResponse.json(
        { error: "Data laporan tidak lengkap (id, disasterType, storeId wajib diisi)" },
        { status: 400 }
      );
    }

    const isAdmin = sessionUser.systemRole === "ADMIN";
    const isHO = sessionUser.scope === "HO" && !isAdmin;
    const r = (sessionUser.role || "").toLowerCase();
    const isBMM = !isAdmin && !isHO && r === "bm";
    const isBES = !isAdmin && !isHO && r === "bes";
    const isBMS = !isAdmin && !isHO && !isBMM && !isBES;

    const isFacilityReport =
      body.locationKind === "FACILITY" ||
      body.tkpType === "dc" ||
      (body.tkpType as string) === "DC" ||
      (body.storeId && (body.storeId.startsWith("FACILITY:") || body.storeId.startsWith("FAC-")));

    if (isBMS && isFacilityReport) {
      return NextResponse.json(
        {
          error: "Akses ditolak: Petugas BMS tidak berwenang membuat laporan untuk Fasilitas/DC.",
          code: "BMS_FACILITY_REPORT_FORBIDDEN",
        },
        { status: 403 }
      );
    }

    if (isBES && !isFacilityReport) {
      return NextResponse.json(
        {
          error: "Akses ditolak: Petugas BES tidak berwenang membuat laporan untuk Toko.",
          code: "BES_STORE_REPORT_FORBIDDEN",
        },
        { status: 403 }
      );
    }

    if (body.disasterType === "strong_wind") {
      return NextResponse.json(
        {
          error: "Kategori Angin Kencang dialihkan ke Hujan Lebat/Badai untuk pembuatan laporan baru.",
          code: "STRONG_WIND_MERGED",
        },
        { status: 400 }
      );
    }

    if (sessionUser.scope !== "HO" && !isAdmin) {
      if (body.branch.trim().toLowerCase() !== (sessionUser.branch || "").trim().toLowerCase()) {
        return NextResponse.json(
          { error: "Unauthorized: Tidak dapat membuat laporan untuk cabang lain" },
          { status: 403 }
        );
      }
    }

    // Default dates if omitted
    if (!body.date) {
      body.date = body.createdAt || new Date().toISOString();
    }

    // TASK T05E: Enforce manual origin for reports submitted through user endpoint.
    // Untrusted user input must never be allowed to claim "automatic" origin.
    body.reportOrigin = "manual";

    // Phase 2: Automated Concurrency-Safe Reconciliation for Earthquake Reports
    if (body.disasterType === "earthquake") {
      const { reconcileManualEarthquakeSubmission } = await import("@/lib/earthquake-reconciliation");
      const recResult = await reconcileManualEarthquakeSubmission({
        sessionUser,
        body,
      });

      // Trigger distribution (Email/WA) for the reconciled incident
      await ReportDistributionService.distributeReport(recResult.incident.id, recResult.incident.branch, recResult.incident);

      const statusCode = recResult.outcome === "merged_into_existing" ? 200 : 201;
      return NextResponse.json(
        {
          data: recResult.incident,
          reconciliation: recResult.outcome,
          canonicalEventId: recResult.canonicalEventId,
          candidateCount: recResult.candidateCount,
        },
        { status: statusCode }
      );
    }

    const created = await dbCreateIncident(body);

    // Trigger distribution (Email/WA)
    await ReportDistributionService.distributeReport(created.id, created.branch, created);

    return NextResponse.json({ data: created }, { status: 201 });
  } catch (err) {
    console.error("[POST /api/incidents]", err);
    return NextResponse.json(
      { error: "Gagal membuat laporan baru" },
      { status: 500 }
    );
  }
}
