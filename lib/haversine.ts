import { Store, StoreStatus } from "@/types/store";
import { Earthquake } from "@/types/disaster";
import { getV1Coverage } from "./earthquake-v1-parameters";

/**
 * Calculates the great-circle distance between two points on the Earth's surface
 * using the Haversine formula.
 *
 * @param lat1 Latitude of point 1 in decimal degrees
 * @param lon1 Longitude of point 1 in decimal degrees
 * @param lat2 Latitude of point 2 in decimal degrees
 * @param lon2 Longitude of point 2 in decimal degrees
 * @returns Distance in kilometers (rounded to 1 decimal place), or NaN if invalid
 */
export function calculateHaversineDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  if (
    !Number.isFinite(lat1) ||
    !Number.isFinite(lon1) ||
    !Number.isFinite(lat2) ||
    !Number.isFinite(lon2) ||
    lat1 < -90 ||
    lat1 > 90 ||
    lat2 < -90 ||
    lat2 > 90 ||
    lon1 < -180 ||
    lon1 > 180 ||
    lon2 < -180 ||
    lon2 > 180
  ) {
    return NaN;
  }

  const R = 6371; // Earth's mean radius in km
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);

  // Clamp a to [0, 1] to prevent floating-point precision error on antipodal points
  const aClamped = Math.min(1, Math.max(0, a));
  const c = 2 * Math.atan2(Math.sqrt(aClamped), Math.sqrt(1 - aClamped));
  const distance = R * c;

  return Math.round(distance * 10) / 10;
}

function toRad(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/**
 * Calculates SPARTA's operational monitoring zones based on the agreed V1 parameter table.
 * Preserves the supervisor-provided parameter table revised on 6 November 2026.
 * Note: These are SPARTA's internal operational vigilance zones, NOT confirmed structural damage.
 */
export function calculateSpartaMonitoringZone(
  magnitude: number,
  depthKm: number = 10
): { priorityRadiusKm: number; monitoringRadiusKm: number } {
  const coverage = getV1Coverage(magnitude, depthKm);
  const v1Radius = coverage.v1DistanceKm ?? 0;
  return {
    priorityRadiusKm: v1Radius,
    monitoringRadiusKm: v1Radius,
  };
}

export type SpatialRisk = "SAFE" | "MONITOR" | "PRIORITY_MONITOR" | "UNASSESSED";

export interface StoreRiskAssessment {
  spatialRisk: SpatialRisk;
  distanceFromEventKm?: number;
  riskSourceEvent?: Earthquake;
  isInsideV1?: boolean;
  v1DistanceKm?: number | null;
  officialMmi?: number | null;
  intensityStatus?: "INTENSITY_TRIGGERED" | "BELOW_INSPECTION_THRESHOLD" | "UNASSESSED";
  assessmentNote?: string;
}

/**
 * Evaluates the spatial risk and V1 coverage status of a store against active earthquakes.
 *
 * Rules:
 * 1. Distance alone describes whether a store is inside or outside V1.
 * 2. Outside V1 with unavailable MMI is explicitly UNASSESSED, never automatically SAFE.
 * 3. Official MMI >= 6.0 outside V1 remains visible as meeting the intensity threshold (PRIORITY_MONITOR).
 * 4. MMI below 6.0 means below the automatic-inspection threshold, NOT proof of physical safety.
 * 5. SAFE is only used when no active earthquakes exist or confirmed safe by inspection.
 */
export function assessStoreRisk(
  store: {
    latitude?: number | null;
    longitude?: number | null;
    mmi?: number | null;
    officialMmi?: number | null;
  },
  activeEarthquakes: Earthquake[]
): StoreRiskAssessment {
  if (
    store.latitude == null ||
    store.longitude == null ||
    !Number.isFinite(store.latitude) ||
    !Number.isFinite(store.longitude) ||
    store.latitude < -90 ||
    store.latitude > 90 ||
    store.longitude < -180 ||
    store.longitude > 180 ||
    !activeEarthquakes ||
    activeEarthquakes.length === 0
  ) {
    return { spatialRisk: "SAFE" };
  }

  let highestSpatialRisk: SpatialRisk = "UNASSESSED";
  let minDistance = Infinity;
  let riskSourceEvent: Earthquake | undefined;
  let chosenInsideV1 = false;
  let chosenV1Radius: number | null = null;
  let chosenIntensityStatus: "INTENSITY_TRIGGERED" | "BELOW_INSPECTION_THRESHOLD" | "UNASSESSED" = "UNASSESSED";
  let chosenAssessmentNote = "";

  const riskPriority: Record<SpatialRisk, number> = {
    SAFE: 0,
    UNASSESSED: 1,
    MONITOR: 2,
    PRIORITY_MONITOR: 3,
  };

  for (const event of activeEarthquakes) {
    if (
      event.latitude == null ||
      event.longitude == null ||
      !Number.isFinite(event.latitude) ||
      !Number.isFinite(event.longitude) ||
      event.latitude < -90 ||
      event.latitude > 90 ||
      event.longitude < -180 ||
      event.longitude > 180
    ) {
      continue;
    }

    const dist = calculateHaversineDistance(
      store.latitude,
      store.longitude,
      event.latitude,
      event.longitude
    );

    if (isNaN(dist)) continue;

    const coverage = (event as any).v1Coverage ?? getV1Coverage(event.magnitude, event.depthKm ?? 10);
    const v1Radius = (event as any).v1DistanceKm ?? (event as any).priorityRadiusKm ?? coverage.v1DistanceKm;
    const storeMmi = store.officialMmi ?? store.mmi ?? null;
    const isInsideV1 = v1Radius !== null && v1Radius > 0 && dist <= v1Radius;

    let currentEventRisk: SpatialRisk = "UNASSESSED";
    let intensityStatus: "INTENSITY_TRIGGERED" | "BELOW_INSPECTION_THRESHOLD" | "UNASSESSED" = "UNASSESSED";
    let assessmentNote = "";

    if (storeMmi !== null && storeMmi >= 6.0) {
      // Official MMI >= 6.0 meets intensity threshold regardless of V1 boundary
      currentEventRisk = "PRIORITY_MONITOR";
      intensityStatus = "INTENSITY_TRIGGERED";
      assessmentNote = isInsideV1
        ? `Tercakup dalam V1 (${dist.toFixed(1)} km <= ${v1Radius} km) dan memenuhi ambang MMI (${storeMmi})`
        : `Di luar V1 (${dist.toFixed(1)} km > ${v1Radius ?? 0} km), namun memenuhi ambang intensitas MMI (${storeMmi})`;
    } else if (storeMmi !== null && storeMmi < 6.0) {
      // MMI below 6.0 means below automatic-inspection threshold, not proof of physical safety
      intensityStatus = "BELOW_INSPECTION_THRESHOLD";
      if (isInsideV1) {
        currentEventRisk = "MONITOR";
        assessmentNote = `Dalam V1 (${dist.toFixed(1)} km <= ${v1Radius} km), MMI ${storeMmi} di bawah ambang inspeksi otomatis (bukan bukti aman fisik)`;
      } else {
        currentEventRisk = "UNASSESSED";
        assessmentNote = `Di luar V1 (${dist.toFixed(1)} km), MMI ${storeMmi} di bawah ambang inspeksi otomatis (bukan bukti aman fisik)`;
      }
    } else {
      // MMI unavailable / unassessed
      intensityStatus = "UNASSESSED";
      if (isInsideV1) {
        currentEventRisk = "PRIORITY_MONITOR";
        assessmentNote = `Dalam radius pencarian V1 (${dist.toFixed(1)} km <= ${v1Radius} km). MMI belum tersedia (fallback operasional)`;
      } else {
        currentEventRisk = "UNASSESSED";
        assessmentNote = v1Radius !== null
          ? `Di luar radius V1 (${dist.toFixed(1)} km > ${v1Radius} km); intensitas belum terkaji (tidak membuktikan aman)`
          : `Parameter gempa tidak tercakup tabel V1; intensitas belum terkaji`;
      }
    }

    if (riskPriority[currentEventRisk] > riskPriority[highestSpatialRisk]) {
      highestSpatialRisk = currentEventRisk;
      minDistance = dist;
      riskSourceEvent = event;
      chosenInsideV1 = isInsideV1;
      chosenV1Radius = v1Radius;
      chosenIntensityStatus = intensityStatus;
      chosenAssessmentNote = assessmentNote;
    } else if (riskPriority[currentEventRisk] === riskPriority[highestSpatialRisk]) {
      if (dist < minDistance) {
        minDistance = dist;
        riskSourceEvent = event;
        chosenInsideV1 = isInsideV1;
        chosenV1Radius = v1Radius;
        chosenIntensityStatus = intensityStatus;
        chosenAssessmentNote = assessmentNote;
      }
    }
  }

  return {
    spatialRisk: highestSpatialRisk,
    distanceFromEventKm: minDistance === Infinity ? undefined : minDistance,
    riskSourceEvent,
    isInsideV1: chosenInsideV1,
    v1DistanceKm: chosenV1Radius,
    officialMmi: store.officialMmi ?? store.mmi ?? null,
    intensityStatus: chosenIntensityStatus,
    assessmentNote: chosenAssessmentNote,
  };
}

export interface LocationItem {
  id?: string;
  code?: string;
  kode_toko?: string;
  name?: string;
  nama_toko?: string;
  cabang?: string;
  branch_id?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  [key: string]: any;
}

export interface EvaluatedLocation<T = LocationItem> {
  item: T;
  id: string;
  code: string;
  name: string;
  branch: string;
  latitude: number;
  longitude: number;
  distanceKm: number;
  zone: SpatialRisk;
}

export interface AffectedLocationSummary<T = LocationItem> {
  earthquakeId: string;
  magnitude: number;
  depthKm: number;
  priorityRadiusKm: number;
  monitoringRadiusKm: number;
  priorityLocations: EvaluatedLocation<T>[];
  monitoringLocations: EvaluatedLocation<T>[];
  allAffectedLocations: EvaluatedLocation<T>[];
  totalAffected: number;
  totalEvaluated: number;
  invalidLocationCount: number;
}

/**
 * Mathematically evaluates a list of locations (stores or facilities) against an earthquake.
 * Ensures:
 * 1. Strict Haversine distance calculation and boundary classification.
 * 2. Deduplication by location code/id so counts are unique and consistent.
 * 3. Accurate sorting by distance ascending.
 * 4. Filtering of locations with missing or invalid coordinates.
 */
export function evaluateAffectedLocations<T extends LocationItem>(
  earthquake: {
    id: string;
    latitude: number;
    longitude: number;
    magnitude: number;
    depthKm?: number;
    priorityRadiusKm?: number | null;
    monitoringRadiusKm?: number | null;
  },
  locations: T[]
): AffectedLocationSummary<T> {
  const depth = earthquake.depthKm ?? 10;
  const radii = (earthquake.priorityRadiusKm && earthquake.monitoringRadiusKm)
    ? { priorityRadiusKm: earthquake.priorityRadiusKm, monitoringRadiusKm: earthquake.monitoringRadiusKm }
    : calculateSpartaMonitoringZone(earthquake.magnitude, depth);

  if (
    earthquake.latitude == null ||
    earthquake.longitude == null ||
    !Number.isFinite(earthquake.latitude) ||
    !Number.isFinite(earthquake.longitude) ||
    earthquake.latitude < -90 ||
    earthquake.latitude > 90 ||
    earthquake.longitude < -180 ||
    earthquake.longitude > 180
  ) {
    return {
      earthquakeId: earthquake.id,
      magnitude: earthquake.magnitude,
      depthKm: depth,
      priorityRadiusKm: radii.priorityRadiusKm,
      monitoringRadiusKm: radii.monitoringRadiusKm,
      priorityLocations: [],
      monitoringLocations: [],
      allAffectedLocations: [],
      totalAffected: 0,
      totalEvaluated: 0,
      invalidLocationCount: 0,
    };
  }

  const priorityLocations: EvaluatedLocation<T>[] = [];
  const monitoringLocations: EvaluatedLocation<T>[] = [];
  const allAffectedLocations: EvaluatedLocation<T>[] = [];
  const seenCodes = new Set<string>();

  let totalEvaluated = 0;
  let invalidLocationCount = 0;

  for (const loc of locations) {
    totalEvaluated++;
    const lat = loc.latitude;
    const lon = loc.longitude;

    if (
      lat == null ||
      lon == null ||
      !Number.isFinite(lat) ||
      !Number.isFinite(lon) ||
      lat < -90 ||
      lat > 90 ||
      lon < -180 ||
      lon > 180
    ) {
      invalidLocationCount++;
      continue;
    }

    const rawCode = (loc.code || loc.kode_toko || loc.id || "").toString().trim();
    const code = rawCode.length > 0 ? rawCode : `loc_${totalEvaluated}`;
    if (seenCodes.has(code)) {
      continue; // Deduplicate duplicate locations
    }
    seenCodes.add(code);

    const distanceKm = calculateHaversineDistance(
      earthquake.latitude,
      earthquake.longitude,
      lat,
      lon
    );

    if (isNaN(distanceKm)) {
      invalidLocationCount++;
      continue;
    }

    const id = (loc.id || loc.code || loc.kode_toko || code).toString();
    const name = (loc.name || loc.nama_toko || code).toString();
    const rawBranch = (loc.cabang || loc.branch_id || "").toString().trim();
    const branch = rawBranch || "Belum dipetakan";

    if (distanceKm <= radii.priorityRadiusKm) {
      const evaluated: EvaluatedLocation<T> = {
        item: loc,
        id,
        code,
        name,
        branch,
        latitude: lat,
        longitude: lon,
        distanceKm,
        zone: "PRIORITY_MONITOR",
      };
      priorityLocations.push(evaluated);
      allAffectedLocations.push(evaluated);
    } else if (distanceKm <= radii.monitoringRadiusKm) {
      const evaluated: EvaluatedLocation<T> = {
        item: loc,
        id,
        code,
        name,
        branch,
        latitude: lat,
        longitude: lon,
        distanceKm,
        zone: "MONITOR",
      };
      monitoringLocations.push(evaluated);
      allAffectedLocations.push(evaluated);
    }
  }

  // Sort by distance ascending
  priorityLocations.sort((a, b) => a.distanceKm - b.distanceKm);
  monitoringLocations.sort((a, b) => a.distanceKm - b.distanceKm);
  allAffectedLocations.sort((a, b) => a.distanceKm - b.distanceKm);

  return {
    earthquakeId: earthquake.id,
    magnitude: earthquake.magnitude,
    depthKm: depth,
    priorityRadiusKm: radii.priorityRadiusKm,
    monitoringRadiusKm: radii.monitoringRadiusKm,
    priorityLocations,
    monitoringLocations,
    allAffectedLocations,
    totalAffected: allAffectedLocations.length,
    totalEvaluated,
    invalidLocationCount,
  };
}
