import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getOperationalDbPool } from "@/lib/db";
import {
  parseShakeMapCovJson,
  dbSaveShakeMapRecord,
} from "@/lib/earthquake-intensity-service";

import { executeEarthquakeV1MmiWorkflow } from "@/lib/earthquake-v1-mmi-service";
import type { Store } from "@/types/store";
import { portalStoresEnabled } from "@/lib/sparta-master-contract";

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

    const sourceProvider = body.sourceProvider;
    if (sourceProvider !== "BMKG" && sourceProvider !== "USGS") {
      return NextResponse.json({ error: "A verified BMKG or USGS provider is required" }, { status: 400 });
    }
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

    const { rows } = await pool.query("SELECT * FROM earthquake_events WHERE id = $1", [id]);
    const event = rows[0];
    if (!event) return NextResponse.json({ error: "Earthquake not found" }, { status: 404 });
    if (event.source_primary !== "BMKG" && event.source_primary !== "USGS") {
      return NextResponse.json({ error: "Unverified earthquake" }, { status: 400 });
    }
    if (covJson.spartaProvenance?.canonicalEventId && covJson.spartaProvenance.canonicalEventId !== id) {
      return NextResponse.json({ error: "ShakeMap event mismatch" }, { status: 400 });
    }
    await dbSaveShakeMapRecord(grid, pool);
    const usePortalStores = portalStoresEnabled();
    const storeRes = await pool.query<Store>(
      usePortalStores
        ? "SELECT id, kode_toko, nama_toko, cabang, branch_code, alamat, latitude, longitude, fr_type FROM stores WHERE latitude IS NOT NULL AND longitude IS NOT NULL AND is_active = TRUE AND master_source = 'SPARTA_PORTAL'"
        : "SELECT kode_toko AS id, kode_toko, nama_toko, cabang, alamat, latitude, longitude, fr_type FROM stores WHERE latitude IS NOT NULL AND longitude IS NOT NULL"
    );
    const result = await executeEarthquakeV1MmiWorkflow({
      earthquake: {
        id, source: event.source_primary, title: event.title,
        magnitude: Number(event.magnitude), depthKm: Number(event.depth_km),
        latitude: Number(event.latitude), longitude: Number(event.longitude),
        timestamp: new Date(event.occurred_at).getTime(),
      },
      stores: storeRes.rows, dbPool: pool,
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

