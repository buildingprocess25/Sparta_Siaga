import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getOperationalDbPool } from "@/lib/db";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: RouteContext) {
  try {
    const sessionUser = await getSessionUser(request);
    if (!sessionUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const pool = getOperationalDbPool();

    const shakemapRes = await pool.query(
      `SELECT id, canonical_event_id, source_provider, version_number,
              grid_bounds_x_min, grid_bounds_x_max, grid_bounds_y_min, grid_bounds_y_max,
              grid_num_x, grid_num_y, max_mmi, evaluation_status, received_at, evaluated_at, error_message
         FROM earthquake_shakemaps
        WHERE canonical_event_id = $1
        ORDER BY version_number DESC
        LIMIT 1`,
      [id]
    );

    if (shakemapRes.rows.length === 0) {
      return NextResponse.json(
        {
          success: false,
          error: "ShakeMap belum tersedia untuk gempa ini",
          code: "SHAKEMAP_NOT_FOUND",
          status: "UNKNOWN",
        },
        { status: 404 }
      );
    }

    const sm = shakemapRes.rows[0];

    // Summary counts from earthquake_facility_intensities
    const countRes = await pool.query(
      `SELECT
         COUNT(*)::int AS total_evaluated,
         COUNT(CASE WHEN decision_policy = 'CANDIDATE_AUTO_REPORT' THEN 1 END)::int AS candidate_auto_report,
         COUNT(CASE WHEN decision_policy = 'NOTIFICATION_ONLY' THEN 1 END)::int AS notification_only,
         COUNT(CASE WHEN decision_policy = 'UNKNOWN' OR discrepancy_vs_radius = 'OUT_OF_SHAKEMAP_COVERAGE' THEN 1 END)::int AS out_of_coverage
       FROM earthquake_facility_intensities
      WHERE canonical_event_id = $1 AND shakemap_version = $2`,
      [id, sm.version_number]
    );

    const counts = countRes.rows[0] || {
      total_evaluated: 0,
      candidate_auto_report: 0,
      notification_only: 0,
      out_of_coverage: 0,
    };

    return NextResponse.json({
      success: true,
      data: {
        shakemapId: sm.id,
        canonicalEventId: sm.canonical_event_id,
        sourceProvider: sm.source_provider,
        version: sm.version_number,
        maxMmi: parseFloat(sm.max_mmi),
        evaluationStatus: sm.evaluation_status,
        bounds: {
          xMin: parseFloat(sm.grid_bounds_x_min),
          xMax: parseFloat(sm.grid_bounds_x_max),
          yMin: parseFloat(sm.grid_bounds_y_min),
          yMax: parseFloat(sm.grid_bounds_y_max),
        },
        summaryCounts: {
          totalEvaluated: counts.total_evaluated,
          candidateAutoReport: counts.candidate_auto_report,
          notificationOnly: counts.notification_only,
          outOfCoverage: counts.out_of_coverage,
        },
        evaluatedAt: sm.evaluated_at,
      },
    });
  } catch (err: any) {
    console.error("[GET /api/earthquakes/[id]/shakemap]", err);
    return NextResponse.json(
      { error: "Gagal mengambil metadata ShakeMap", details: err?.message },
      { status: 500 }
    );
  }
}
