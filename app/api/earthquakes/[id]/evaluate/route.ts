import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getOperationalDbPool } from "@/lib/db";
import {
  parseShakeMapCovJson,
  processStageTwoIntensityEvaluation,
  EvaluatedFacilityTarget,
} from "@/lib/earthquake-intensity-service";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: RouteContext) {
  try {
    const { id } = await params;
    const sessionUser = await getSessionUser(request);

    // Authorization: internal worker secret header or Admin user
    const workerSecretHeader = request.headers.get("x-sparta-daemon-secret");
    const configuredSecret = process.env.SPARTA_INTERNAL_WORKER_SECRET;
    const isAuthorizedSecret = Boolean(configuredSecret && workerSecretHeader === configuredSecret);
    const isAdmin = sessionUser?.systemRole === "ADMIN";

    if (!isAuthorizedSecret && !isAdmin) {
      return NextResponse.json(
        { error: "Forbidden: Akses evaluasi intensitas hanya untuk daemon internal atau administrator teknis." },
        { status: 403 }
      );
    }

    const body = await request.json().catch(() => ({}));
    const covJson = body.covJsonPayload;
    if (!covJson) {
      return NextResponse.json(
        { error: "Bad Request: covJsonPayload diperlukan untuk evaluasi intensitas." },
        { status: 400 }
      );
    }

    const sourceProvider = body.sourceProvider || "USGS";
    const versionNumber = Number.isInteger(body.versionNumber) ? body.versionNumber : 1;

    // Validate and parse CovJSON into grid
    let grid;
    try {
      grid = parseShakeMapCovJson(covJson, {
        eventId: id,
        sourceProvider,
        versionNumber,
      });
    } catch (parseErr: any) {
      return NextResponse.json(
        { error: `Malformed CovJSON: ${parseErr.message}` },
        { status: 400 }
      );
    }

    const pool = getOperationalDbPool();

    // Load active facilities (DCs / Warehouses)
    const facRes = await pool.query(
      `SELECT id::text, code, name, facility_type, branch_id, latitude, longitude
         FROM facilities
        WHERE operational_status = 'ACTIVE'`
    );

    const facilities: EvaluatedFacilityTarget[] = [];
    for (const r of facRes.rows) {
      if (r.latitude != null && r.longitude != null && r.branch_id) {
        facilities.push({
          kind: "FACILITY",
          id: r.id,
          code: r.code,
          name: r.name,
          type: r.facility_type,
          branch: r.branch_id,
          latitude: Number(r.latitude),
          longitude: Number(r.longitude),
        });
      }
    }

    // Load candidate stores within and surrounding ShakeMap grid bounding box
    const latMin = grid.yMin - 0.5;
    const latMax = grid.yMax + 0.5;
    const lonMin = grid.xMin - 0.5;
    const lonMax = grid.xMax + 0.5;

    const storeRes = await pool.query(
      `SELECT kode_toko, nama_toko, cabang, latitude, longitude, fr_type
         FROM stores
        WHERE latitude BETWEEN $1 AND $2
          AND longitude BETWEEN $3 AND $4
        LIMIT 2000`,
      [latMin, latMax, lonMin, lonMax]
    );

    for (const r of storeRes.rows) {
      if (r.latitude != null && r.longitude != null && r.cabang) {
        facilities.push({
          kind: "STORE",
          id: r.kode_toko,
          code: r.kode_toko,
          name: r.nama_toko,
          type: r.fr_type || "store",
          branch: r.cabang,
          latitude: Number(r.latitude),
          longitude: Number(r.longitude),
        });
      }
    }

    // Process Stage 2 evaluation
    const result = await processStageTwoIntensityEvaluation({
      dataset: {
        eventId: id,
        title: body.title || `Earthquake ${id}`,
        sourceProvider,
        versionNumber,
        magnitude: Number(body.magnitude) || 5.0,
        depthKm: Number(body.depthKm) || 10,
        latitude: grid.yMin + (grid.yMax - grid.yMin) / 2,
        longitude: grid.xMin + (grid.xMax - grid.xMin) / 2,
        maxMmi: grid.maxMmi,
        grid,
        occurredAt: body.occurredAt ? new Date(body.occurredAt) : new Date(),
      },
      facilities,
      dbPool: pool,
    });

    return NextResponse.json({
      success: true,
      data: result,
    });
  } catch (err: any) {
    console.error("[POST /api/earthquakes/[id]/evaluate]", err);
    return NextResponse.json(
      { error: "Gagal mengevaluasi intensitas gempa", details: err?.message },
      { status: 500 }
    );
  }
}

