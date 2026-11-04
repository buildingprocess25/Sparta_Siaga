import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { assertSimulationAllowed } from "@/lib/environment-policy";
import { processEarthquakeAlertsAndReports } from "@/lib/server-daemon";
import { getOrLoadMasterStores } from "@/lib/store-master-loader";
import { calculateSpartaMonitoringZone } from "@/lib/haversine";
import { Earthquake } from "@/types/disaster";

export async function POST(request: Request) {
  try {
    // 1. Strict Fail-Closed Production Guard
    assertSimulationAllowed();

    // 2. Authentication & Authorization Check
    const authHeader = request.headers.get("x-internal-worker-secret");
    const isInternalWorker =
      process.env.SPARTA_INTERNAL_WORKER_SECRET &&
      authHeader === process.env.SPARTA_INTERNAL_WORKER_SECRET;

    const sessionUser = await getSessionUser(request);
    if (!sessionUser && !isInternalWorker) {
      return NextResponse.json(
        { error: "Unauthorized: Diperlukan sesi pengguna untuk memicu simulasi UAT." },
        { status: 401 }
      );
    }

    const body = await request.json().catch(() => ({}));
    const {
      latitude = -6.9039,
      longitude = 107.6186,
      magnitude = 5.6,
      depthKm = 10,
      title = "Gempa Bumi Simulasi M 5.6 Bandung",
      eventId,
      scenarioKey,
    } = body;

    const parsedLat = Number(latitude);
    const parsedLon = Number(longitude);
    const parsedMag = Number(magnitude);
    const parsedDepth = Number(depthKm);

    if (
      !Number.isFinite(parsedLat) ||
      !Number.isFinite(parsedLon) ||
      !Number.isFinite(parsedMag) ||
      !Number.isFinite(parsedDepth)
    ) {
      return NextResponse.json(
        { error: "Parameter latitude, longitude, magnitude, dan depthKm wajib berupa angka valid." },
        { status: 400 }
      );
    }

    const simEventId = eventId || `SIM-EQ-UAT-${Date.now()}`;
    const timestamp = Date.now();
    const timeFormatted = new Date(timestamp).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" }) + " WIB";

    const { priorityRadiusKm, monitoringRadiusKm } = calculateSpartaMonitoringZone(parsedMag, parsedDepth);

    const simulationEarthquake: Earthquake = {
      id: simEventId,
      source: "SIMULASI UAT",
      sourcePrimary: "SIMULASI UAT",
      canonicalEventKey: simEventId,
      informationType: "official_event",
      verificationStatus: "official",
      title: title || `Gempa Bumi Simulasi M ${parsedMag.toFixed(1)}`,
      magnitude: parsedMag,
      depth: `${parsedDepth} km`,
      depthKm: parsedDepth,
      latitude: parsedLat,
      longitude: parsedLon,
      time: timeFormatted,
      timestamp,
      potensiTsunami: false,
      priorityRadiusKm,
      monitoringRadiusKm,
      isSignificant: parsedMag >= 5.0,
    };

    // 3. Load stores from master repository
    const stores = await getOrLoadMasterStores();

    // 4. Trigger authentic SPARTA evaluation pipeline in simulation mode
    const result = await processEarthquakeAlertsAndReports(
      [simulationEarthquake],
      stores,
      true, // isEligibleForAlert
      true, // allowBackfill
      true  // allowSimulation
    );

    return NextResponse.json({
      success: true,
      message: `Gempa simulasi '${simulationEarthquake.title}' berhasil diproses oleh engine SPARTA SIAGA.`,
      affectedReportsCount: result.createdReports,
      incidentId: simEventId,
      simulation: {
        eventId: simEventId,
        title: simulationEarthquake.title,
        magnitude: parsedMag,
        depthKm: parsedDepth,
        coordinates: [parsedLat, parsedLon],
        priorityRadiusKm,
        monitoringRadiusKm,
        occurredAt: timeFormatted,
        scenarioKey: scenarioKey || "custom",
      },
      evaluation: {
        dispatchedAlerts: result.dispatchedAlerts,
        createdReports: result.createdReports,
      },
    });
  } catch (error: any) {
    if (error?.message?.includes("SIMULATION_FORBIDDEN_IN_PRODUCTION")) {
      return NextResponse.json(
        { error: error.message, code: "SIMULATION_FORBIDDEN_IN_PRODUCTION" },
        { status: 403 }
      );
    }

    console.error("[API Simulation Trigger Error]:", error);
    return NextResponse.json(
      { error: "Gagal memproses simulasi gempa", details: error?.message },
      { status: 500 }
    );
  }
}
