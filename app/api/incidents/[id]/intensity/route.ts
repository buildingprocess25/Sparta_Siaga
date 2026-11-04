import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { dbGetIncidentById } from "@/lib/incident-db";
import { canAccessReport } from "@/lib/report-access-policy";
import { getOperationalDbPool } from "@/lib/db";

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
      return NextResponse.json({ error: "Laporan insiden tidak ditemukan" }, { status: 404 });
    }

    // Role and branch access check
    if (sessionUser.systemRole !== "ADMIN" && !canAccessReport(sessionUser, report)) {
      return NextResponse.json(
        { error: "Forbidden: Anda tidak memiliki hak akses melihat laporan cabang ini." },
        { status: 403 }
      );
    }

    const pool = getOperationalDbPool();
    const intensityRes = await pool.query(
      `SELECT efi.*, es.source_provider, es.version_number, es.received_at
         FROM earthquake_facility_intensities efi
         JOIN earthquake_shakemaps es ON efi.shakemap_id = es.id
        WHERE efi.incident_id = $1 OR (efi.canonical_event_id = $2 AND efi.facility_code = $3)
        ORDER BY es.version_number DESC
        LIMIT 1`,
      [report.id, report.canonicalEventId || report.earthquakeEventId, report.storeId]
    );

    if (intensityRes.rows.length === 0) {
      return NextResponse.json({
        success: true,
        data: {
          incidentId: report.id,
          canonicalEventId: report.canonicalEventId || report.earthquakeEventId,
          hasIntensityData: false,
          status: "UNKNOWN",
          message: "Data ShakeMap numerik belum tersedia untuk laporan ini.",
        },
      });
    }

    const r = intensityRes.rows[0];
    return NextResponse.json({
      success: true,
      data: {
        incidentId: report.id,
        canonicalEventId: r.canonical_event_id,
        hasIntensityData: true,
        facilityCode: r.facility_code,
        facilityName: r.facility_name,
        branch: r.branch,
        distanceKm: parseFloat(r.distance_km),
        mmiRaw: r.mmi_raw !== null ? parseFloat(r.mmi_raw) : null,
        mmiRounded: r.mmi_rounded !== null ? parseFloat(r.mmi_rounded) : null,
        mmiRoman: r.mmi_roman,
        decisionPolicy: r.decision_policy,
        discrepancyVsRadius: r.discrepancy_vs_radius,
        shakemapVersion: r.version_number,
        sourceProvider: r.source_provider,
        evaluatedAt: r.evaluated_at,
        notes: r.notes,
      },
    });
  } catch (err: any) {
    console.error("[GET /api/incidents/[id]/intensity]", err);
    return NextResponse.json(
      { error: "Gagal memuat detail intensitas insiden", details: err?.message },
      { status: 500 }
    );
  }
}
