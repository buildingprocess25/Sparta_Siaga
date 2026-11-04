/**
 * SPARTA SIAGA - Earthquake Intensity Service
 *
 * Production service implementing the two-stage earthquake pipeline:
 * - Stage 1: Nationwide informational notification (no reports created, no user workflow)
 * - Stage 2: ShakeMap MMI numerical evaluation per facility (MMI >= 6.0 candidate auto-reports)
 * - Safe Fallback: 30-minute timeout with informational advisory escalation and controlled retry
 *
 * Safety: Uses feature flag `isEarthquakeIntensityEnabled()`.
 * Rule: Zero em dashes.
 */

import crypto from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { getOperationalDbPool } from "./db";
import { calculateHaversineDistance, calculateSpartaMonitoringZone, SpatialRisk } from "./haversine";
import { ensureEarthquakeReport, EarthquakeLocationKind } from "./earthquake-report-service";
import { recordNotificationLog } from "./notification-service";
import { dispatchEarthquakePushNotifications } from "./web-push-service";
import { isEarthquakeIntensityEnabled, EARTHQUAKE_INTENSITY_CONFIG } from "./earthquake-intensity-config";

export type PolicyDecision = "CANDIDATE_AUTO_REPORT" | "NOTIFICATION_ONLY" | "UNKNOWN";

export type DiscrepancyClassification =
  | "CONCORDANT_HIGH_RISK"
  | "CONCORDANT_LOW_RISK"
  | "RADIUS_OVERPREDICTION_VS_MMI"
  | "RADIUS_UNDERPREDICTION_VS_MMI"
  | "OUT_OF_SHAKEMAP_COVERAGE";

export interface ShakeMapGrid {
  eventId: string;
  name: string;
  sourceProvider: string;
  versionNumber: number;
  xMin: number;
  xMax: number;
  numX: number;
  yMin: number;
  yMax: number;
  numY: number;
  values: number[];
  maxMmi: number;
  axisNames: string[];
  shape: number[];
  checksumSha256: string;
  rawPayload?: any;
}

export interface ShakeMapDataset {
  eventId: string;
  title: string;
  sourceProvider: string;
  versionNumber: number;
  magnitude: number;
  depthKm: number;
  latitude: number;
  longitude: number;
  maxMmi: number;
  grid: ShakeMapGrid | null;
  occurredAt?: Date;
}

export interface EvaluatedFacilityTarget {
  kind: EarthquakeLocationKind;
  id: string;
  code: string;
  name: string;
  type: string;
  branch: string;
  latitude: number;
  longitude: number;
}

export interface IntensityDecisionResult {
  decision: PolicyDecision;
  mmi: number | null;
  mmiRounded: number | null;
  mmiRoman: string;
  categoryLabel: string;
  potentialDamageDescription: string;
}

export interface FacilityIntensityRecord {
  id?: string;
  shakemapId?: string;
  canonicalEventId: string;
  facilityKind: EarthquakeLocationKind;
  facilityId: string;
  facilityCode: string;
  facilityName: string;
  branch: string;
  latitude: number;
  longitude: number;
  distanceKm: number;
  mmiRaw: number | null;
  mmiRounded: number | null;
  mmiRoman: string;
  decisionPolicy: PolicyDecision;
  discrepancyVsRadius: DiscrepancyClassification;
  shakemapVersion: number;
  incidentId?: string | null;
  notes: string;
  evaluatedAt?: Date;
}

export interface StageOneNotificationResult {
  outcome: "dispatched" | "suppressed" | "duplicate";
  canonicalEventId: string;
  recipientGroup: string;
  message: string;
}

export interface StageTwoEvaluationResult {
  canonicalEventId: string;
  shakemapVersion: number;
  totalEvaluated: number;
  candidateReportsCount: number;
  notificationOnlyCount: number;
  outOfCoverageCount: number;
  createdIncidentIds: string[];
  preservedIncidentIds: string[];
}

export interface FallbackCheckResult {
  isFallbackActive: boolean;
  eventAgeMinutes: number;
  status: "NORMAL_POLLING" | "ESCALATED_WAITING_SHAKEMAP" | "SHAKEMAP_AVAILABLE";
  advisorySent: boolean;
  message: string;
}

// Roman numeral converters
const NUM_TO_ROMAN_MAP: Array<{ threshold: number; roman: string }> = [
  { threshold: 11.5, roman: "XII" },
  { threshold: 10.5, roman: "XI" },
  { threshold: 9.5, roman: "X" },
  { threshold: 8.5, roman: "IX" },
  { threshold: 7.5, roman: "VIII" },
  { threshold: 6.5, roman: "VII" },
  { threshold: 5.5, roman: "VI" },
  { threshold: 4.5, roman: "V" },
  { threshold: 2.5, roman: "III" },
  { threshold: 1.5, roman: "II" },
  { threshold: 0.0, roman: "I" },
];

export function numberToRoman(mmi: number | null): string {
  if (mmi == null || !Number.isFinite(mmi) || mmi <= 0) return "-";
  for (const item of NUM_TO_ROMAN_MAP) {
    if (mmi >= item.threshold) return item.roman;
  }
  return "I";
}

export function isValidGridValue(val: unknown): val is number {
  return typeof val === "number" && Number.isFinite(val) && val >= 0.5 && val <= 12;
}

/**
 * Parses and strictly validates a USGS ShakeMap CovJSON (Coverage JSON) into a memory-efficient grid.
 */
export function parseShakeMapCovJson(
  covJson: any,
  meta: { eventId?: string; name?: string; sourceProvider?: string; versionNumber?: number } = {}
): ShakeMapGrid {
  if (!covJson || typeof covJson !== "object") {
    throw new Error("Invalid CovJSON: Input must be a valid JSON object.");
  }
  if (!covJson.domain || typeof covJson.domain !== "object") {
    throw new Error("Invalid CovJSON: Missing or invalid domain object.");
  }
  if (!covJson.ranges || typeof covJson.ranges !== "object") {
    throw new Error("Invalid CovJSON: Missing or invalid ranges object.");
  }

  const axes = covJson.domain.axes;
  if (!axes || typeof axes !== "object") {
    throw new Error("Invalid CovJSON: Missing domain.axes object.");
  }

  const x = axes.x || axes.longitude || axes.lon;
  const y = axes.y || axes.latitude || axes.lat;

  if (!x || !y) {
    throw new Error("Invalid CovJSON: Missing x (longitude) or y (latitude) axis.");
  }

  if (
    !Number.isFinite(x.start) ||
    !Number.isFinite(x.stop) ||
    !Number.isInteger(x.num) ||
    x.num < 2 ||
    x.start >= x.stop
  ) {
    throw new Error(`Invalid CovJSON: Malformed x axis (start: ${x.start}, stop: ${x.stop}, num: ${x.num}).`);
  }

  if (
    !Number.isFinite(y.start) ||
    !Number.isFinite(y.stop) ||
    !Number.isInteger(y.num) ||
    y.num < 2 ||
    y.start >= y.stop
  ) {
    throw new Error(`Invalid CovJSON: Malformed y axis (start: ${y.start}, stop: ${y.stop}, num: ${y.num}).`);
  }

  if (x.start < -180 || x.stop > 360 || y.start < -90 || y.stop > 90) {
    throw new Error(`Invalid CovJSON: Axis coordinates out of valid geographic range.`);
  }

  const mmiRange = covJson.ranges.MMI || covJson.ranges.mmi;
  if (!mmiRange || typeof mmiRange !== "object") {
    throw new Error("Invalid CovJSON: Missing MMI range object.");
  }

  if (!Array.isArray(mmiRange.values)) {
    throw new Error("Invalid CovJSON: MMI values must be an array.");
  }

  const values: number[] = mmiRange.values;
  const expectedLength = x.num * y.num;

  if (values.length !== expectedLength) {
    throw new Error(`Invalid CovJSON: Grid length mismatch. Expected ${expectedLength}, received ${values.length}.`);
  }

  if (!mmiRange.axisNames || !Array.isArray(mmiRange.axisNames) || mmiRange.axisNames.length !== 2) {
    throw new Error("Invalid CovJSON: axisNames must be a 2-element array.");
  }
  const cleanAxes = mmiRange.axisNames.map((a: string) => String(a).toLowerCase().trim());
  const hasY = cleanAxes.includes("y") || cleanAxes.includes("latitude") || cleanAxes.includes("lat");
  const hasX = cleanAxes.includes("x") || cleanAxes.includes("longitude") || cleanAxes.includes("lon");
  if (!hasY || !hasX) {
    throw new Error(`Invalid CovJSON: axisNames must contain spatial coordinates.`);
  }

  if (!mmiRange.shape || !Array.isArray(mmiRange.shape) || mmiRange.shape.length !== 2) {
    throw new Error("Invalid CovJSON: shape must be a 2-element array.");
  }
  const [s0, s1] = mmiRange.shape;
  if (s0 * s1 !== expectedLength) {
    throw new Error(`Invalid CovJSON: shape dimensions [${s0}, ${s1}] do not match grid length (${expectedLength}).`);
  }

  const firstAxisIsY = cleanAxes[0] === "y" || cleanAxes[0] === "latitude" || cleanAxes[0] === "lat";
  const expectedShape = firstAxisIsY ? [y.num, x.num] : [x.num, y.num];
  if (s0 !== expectedShape[0] || s1 !== expectedShape[1]) {
    throw new Error(`Invalid CovJSON: shape [${s0}, ${s1}] does not match axis dimensions [${expectedShape[0]}, ${expectedShape[1]}].`);
  }

  const validValues = values.filter(isValidGridValue);
  const maxMmi = validValues.length > 0 ? Math.max(...validValues) : 0;
  const rawString = JSON.stringify(covJson);
  const checksumSha256 = crypto.createHash("sha256").update(rawString).digest("hex");

  return {
    eventId: meta.eventId || "unknown-event",
    name: meta.name || "ShakeMap Grid",
    sourceProvider: meta.sourceProvider || "USGS",
    versionNumber: meta.versionNumber || 1,
    xMin: x.start,
    xMax: x.stop,
    numX: x.num,
    yMin: y.start,
    yMax: y.stop,
    numY: y.num,
    values,
    maxMmi,
    axisNames: mmiRange.axisNames,
    shape: mmiRange.shape,
    checksumSha256,
    rawPayload: covJson,
  };
}

/**
 * Fetches official ShakeMap CovJSON from USGS detail API or local cached directory.
 */
export async function fetchOfficialShakeMapCovJson(
  eventId: string,
  options: { sourceProvider?: string; timeoutMs?: number; localFallbackDir?: string } = {}
): Promise<any> {
  const { sourceProvider = "USGS", timeoutMs = 10000, localFallbackDir } = options;
  const isUsgs = sourceProvider.toUpperCase() === "USGS";

  if (isUsgs) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      // USGS detail GeoJSON endpoint
      const detailUrl = `https://earthquake.usgs.gov/earthquakes/feed/v1.0/detail/${eventId}.geojson`;
      const detailRes = await fetch(detailUrl, { signal: controller.signal });
      clearTimeout(timer);

      if (detailRes.ok) {
        const detailJson = await detailRes.json();
        const shakemapProduct = detailJson?.properties?.products?.shakemap?.[0];
        const covJsonUrl = shakemapProduct?.contents?.["download/coverage_mmi.covjson"]?.url;

        if (covJsonUrl) {
          const covRes = await fetch(covJsonUrl, { signal: controller.signal });
          if (covRes.ok) {
            return await covRes.json();
          }
        }
      }
    } catch {
      // In testing, offline, or fallback mode, continue to local cache
    }
  }

  // Local dataset fallback for authentic offline / staging UAT
  if (localFallbackDir) {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const filePath = path.join(localFallbackDir, "coverage_mmi.covjson");
    const raw = await fs.readFile(filePath, "utf-8");
    return JSON.parse(raw);
  }

  return null;
}

/**
 * Performs bilinear interpolation of MMI from a ShakeMapGrid at target (lat, lon).
 * Returns exact unrounded full-precision float.
 */
export function interpolateMmiFromGrid(
  grid: ShakeMapGrid,
  lat: number,
  lon: number
): number | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    return null;
  }

  if (lon < grid.xMin || lon > grid.xMax || lat < grid.yMin || lat > grid.yMax) {
    return null;
  }

  const spanX = grid.xMax - grid.xMin;
  const spanY = grid.yMax - grid.yMin;

  if (spanX <= 0 || spanY <= 0 || grid.numX <= 1 || grid.numY <= 1) {
    return null;
  }

  const colFloat = ((lon - grid.xMin) / spanX) * (grid.numX - 1);
  const rowFloat = ((lat - grid.yMin) / spanY) * (grid.numY - 1);

  const c0 = Math.floor(colFloat);
  const c1 = Math.min(grid.numX - 1, c0 + 1);
  const r0 = Math.floor(rowFloat);
  const r1 = Math.min(grid.numY - 1, r0 + 1);

  const u = colFloat - c0;
  const v = rowFloat - r0;

  const idx00 = r0 * grid.numX + c0;
  const idx01 = r0 * grid.numX + c1;
  const idx10 = r1 * grid.numX + c0;
  const idx11 = r1 * grid.numX + c1;

  const v00 = grid.values[idx00];
  const v01 = grid.values[idx01];
  const v10 = grid.values[idx10];
  const v11 = grid.values[idx11];

  const val00Valid = isValidGridValue(v00);
  const val01Valid = isValidGridValue(v01);
  const val10Valid = isValidGridValue(v10);
  const val11Valid = isValidGridValue(v11);

  if (!val00Valid && !val01Valid && !val10Valid && !val11Valid) {
    return null;
  }

  if (val00Valid && val01Valid && val10Valid && val11Valid) {
    return (
      (1 - u) * (1 - v) * (v00 as number) +
      u * (1 - v) * (v01 as number) +
      (1 - u) * v * (v10 as number) +
      u * v * (v11 as number)
    );
  }

  let weightedSum = 0;
  let totalWeight = 0;

  if (val00Valid) {
    const w = (1 - u) * (1 - v);
    weightedSum += (v00 as number) * w;
    totalWeight += w;
  }
  if (val01Valid) {
    const w = u * (1 - v);
    weightedSum += (v01 as number) * w;
    totalWeight += w;
  }
  if (val10Valid) {
    const w = (1 - u) * v;
    weightedSum += (v10 as number) * w;
    totalWeight += w;
  }
  if (val11Valid) {
    const w = u * v;
    weightedSum += (v11 as number) * w;
    totalWeight += w;
  }

  return totalWeight > 0 ? weightedSum / totalWeight : null;
}

/**
 * Evaluates candidate policy decision using unrounded full floating-point precision:
 * - mmi >= 6.0000 -> CANDIDATE_AUTO_REPORT
 * - mmi < 6.0000 -> NOTIFICATION_ONLY
 * - null -> UNKNOWN
 */
export function evaluateIntensityDecision(mmi: number | null): IntensityDecisionResult {
  if (mmi == null || !Number.isFinite(mmi)) {
    return {
      decision: "UNKNOWN",
      mmi: null,
      mmiRounded: null,
      mmiRoman: "-",
      categoryLabel: "Di Luar Cakupan / Data Belum Tersedia",
      potentialDamageDescription: "Data ShakeMap tidak mencakup koordinat fasilitas atau produk numerik belum terbit.",
    };
  }

  const decision: PolicyDecision = mmi >= EARTHQUAKE_INTENSITY_CONFIG.candidateReportMmiThreshold
    ? "CANDIDATE_AUTO_REPORT"
    : "NOTIFICATION_ONLY";
  const mmiRounded = Math.round(mmi * 100) / 100;
  const mmiRoman = numberToRoman(mmi);

  if (mmi < 3.5) {
    return {
      decision,
      mmi,
      mmiRounded,
      mmiRoman,
      categoryLabel: "Getaran Ringan (Light - MMI I-III)",
      potentialDamageDescription: "Dirasakan oleh beberapa orang di dalam ruangan. Guncangan di bawah ambang kandidat aktivasi tiket.",
    };
  }

  if (mmi < 6.0) {
    return {
      decision,
      mmi,
      mmiRounded,
      mmiRoman,
      categoryLabel: "Getaran Sedang (Moderate - MMI IV-V)",
      potentialDamageDescription: "Dirasakan banyak orang, barang kecil bergetar. Guncangan di bawah ambang kandidat inspeksi otomatis.",
    };
  }

  if (mmi < 7.0) {
    return {
      decision,
      mmi,
      mmiRounded,
      mmiRoman,
      categoryLabel: "Getaran Kuat (Strong - MMI VI - BMKG SIG III)",
      potentialDamageDescription: "Plester dinding berpotensi retak, barang rak bergeser. Ambang kandidat pemeriksaan fisik PIC.",
    };
  }

  if (mmi < 8.0) {
    return {
      decision,
      mmi,
      mmiRounded,
      mmiRoman,
      categoryLabel: "Sangat Kuat (Very Strong - MMI VII - BMKG SIG IV)",
      potentialDamageDescription: "Kerusakan ringan pada bangunan kokoh. Prioritas pemeriksaan fisik berkamera.",
    };
  }

  return {
    decision,
    mmi,
    mmiRounded,
    mmiRoman,
    categoryLabel: "Destruktif / Parah (Destructive - MMI VIII+ - BMKG SIG V)",
    potentialDamageDescription: "Potensi kerusakan berat pada struktur. Sangat prioritas penanganan darurat cabang.",
  };
}

/**
 * Compares circular radius with ShakeMap MMI.
 */
export function compareRadiusVsMmi(params: {
  locationCode: string;
  locationName: string;
  branch: string;
  lat: number;
  lon: number;
  earthquakeId: string;
  eqLat: number;
  eqLon: number;
  eqMag: number;
  eqDepthKm: number;
  mmi: number | null;
}): {
  radiusZone: SpatialRisk;
  mmiDecision: PolicyDecision;
  discrepancyType: DiscrepancyClassification;
  notes: string;
  distanceKm: number;
} {
  const { lat, lon, eqLat, eqLon, eqMag, eqDepthKm, mmi } = params;
  const distanceKm = calculateHaversineDistance(eqLat, eqLon, lat, lon);
  const { priorityRadiusKm, monitoringRadiusKm } = calculateSpartaMonitoringZone(eqMag, eqDepthKm);

  let radiusZone: SpatialRisk = "SAFE";
  if (!isNaN(distanceKm)) {
    if (distanceKm <= priorityRadiusKm) {
      radiusZone = "PRIORITY_MONITOR";
    } else if (distanceKm <= monitoringRadiusKm) {
      radiusZone = "MONITOR";
    }
  }

  const intensityResult = evaluateIntensityDecision(mmi);
  const mmiDecision = intensityResult.decision;

  let discrepancyType: DiscrepancyClassification = "OUT_OF_SHAKEMAP_COVERAGE";
  let notes = "";

  if (mmiDecision === "UNKNOWN" || mmi == null) {
    discrepancyType = "OUT_OF_SHAKEMAP_COVERAGE";
    notes = "Di luar cakupan grid ShakeMap numerik: Estimasi intensitas tidak tersedia (UNKNOWN).";
  } else if (radiusZone === "PRIORITY_MONITOR" && mmiDecision === "CANDIDATE_AUTO_REPORT") {
    discrepancyType = "CONCORDANT_HIGH_RISK";
    notes = "Konsisten risiko tinggi: Radius prioritas dan ShakeMap sama-sama memproyeksikan potensi dampak (MMI >= VI).";
  } else if ((radiusZone === "MONITOR" || radiusZone === "SAFE") && mmiDecision === "NOTIFICATION_ONLY") {
    discrepancyType = "CONCORDANT_LOW_RISK";
    notes = "Konsisten risiko rendah: Radius dan ShakeMap sama-sama memproyeksikan intensitas di bawah ambang kandidat (MMI < VI).";
  } else if (radiusZone === "PRIORITY_MONITOR" && mmiDecision === "NOTIFICATION_ONLY") {
    discrepancyType = "RADIUS_OVERPREDICTION_VS_MMI";
    notes = "Radius overprediction vs MMI: Radius lingkaran memicu zona prioritas, padahal estimasi MMI < VI.";
  } else if ((radiusZone === "MONITOR" || radiusZone === "SAFE") && mmiDecision === "CANDIDATE_AUTO_REPORT") {
    discrepancyType = "RADIUS_UNDERPREDICTION_VS_MMI";
    notes = "Radius underprediction vs MMI: Radius mengklasifikasikan aman/monitor, namun estimasi ShakeMap MMI >= VI.";
  }

  return {
    radiusZone,
    mmiDecision,
    discrepancyType,
    notes,
    distanceKm: isNaN(distanceKm) ? 0 : distanceKm,
  };
}

// ============================================================================
// Database Persistence Layer
// ============================================================================

export async function dbSaveShakeMapRecord(
  grid: ShakeMapGrid,
  clientOrPool: Pool | PoolClient = getOperationalDbPool()
): Promise<{ id: string; isNew: boolean }> {
  const query = `
    INSERT INTO earthquake_shakemaps (
      canonical_event_id, source_provider, version_number, product_type,
      grid_bounds_x_min, grid_bounds_x_max, grid_bounds_y_min, grid_bounds_y_max,
      grid_num_x, grid_num_y, max_mmi, checksum_sha256, raw_payload,
      evaluation_status, received_at, evaluated_at
    ) VALUES (
      $1, $2, $3, 'covjson',
      $4, $5, $6, $7,
      $8, $9, $10, $11, $12,
      'COMPLETED', NOW(), NOW()
    )
    ON CONFLICT (canonical_event_id, source_provider, version_number)
    DO UPDATE SET
      max_mmi = EXCLUDED.max_mmi,
      checksum_sha256 = EXCLUDED.checksum_sha256,
      raw_payload = EXCLUDED.raw_payload,
      evaluated_at = NOW(),
      evaluation_status = 'COMPLETED'
    RETURNING id, (xmax = 0) AS is_new;
  `;

  const res = await clientOrPool.query<{ id: string; is_new: boolean }>(query, [
    grid.eventId,
    grid.sourceProvider,
    grid.versionNumber,
    grid.xMin,
    grid.xMax,
    grid.yMin,
    grid.yMax,
    grid.numX,
    grid.numY,
    grid.maxMmi,
    grid.checksumSha256,
    grid.rawPayload ? JSON.stringify(grid.rawPayload) : null,
  ]);

  return {
    id: res.rows[0].id,
    isNew: Boolean(res.rows[0].is_new),
  };
}

export async function dbSaveFacilityIntensities(
  intensities: FacilityIntensityRecord[],
  clientOrPool: Pool | PoolClient = getOperationalDbPool()
): Promise<void> {
  if (intensities.length === 0) return;

  const chunkSize = 50;
  for (let i = 0; i < intensities.length; i += chunkSize) {
    const chunk = intensities.slice(i, i + chunkSize);
    const valuePlaceholders: string[] = [];
    const values: any[] = [];

    chunk.forEach((item, idx) => {
      const offset = idx * 18;
      valuePlaceholders.push(
        `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, ` +
        `$${offset + 5}, $${offset + 6}, $${offset + 7}, $${offset + 8}, $${offset + 9}, ` +
        `$${offset + 10}, $${offset + 11}, $${offset + 12}, $${offset + 13}, $${offset + 14}, ` +
        `$${offset + 15}, $${offset + 16}, $${offset + 17}, $${offset + 18}, NOW())`
      );
      values.push(
        item.shakemapId,
        item.canonicalEventId,
        item.facilityKind,
        item.facilityId,
        item.facilityCode,
        item.facilityName,
        item.branch,
        item.latitude,
        item.longitude,
        item.distanceKm,
        item.mmiRaw,
        item.mmiRounded,
        item.mmiRoman,
        item.decisionPolicy,
        item.discrepancyVsRadius,
        item.shakemapVersion,
        item.incidentId || null,
        item.notes
      );
    });

    const query = `
      INSERT INTO earthquake_facility_intensities (
        shakemap_id, canonical_event_id, facility_kind, facility_id,
        facility_code, facility_name, branch, latitude, longitude,
        distance_km, mmi_raw, mmi_rounded, mmi_roman, decision_policy,
        discrepancy_vs_radius, shakemap_version, incident_id, notes, evaluated_at
      ) VALUES ${valuePlaceholders.join(", ")}
      ON CONFLICT (shakemap_id, facility_kind, facility_id, shakemap_version)
      DO UPDATE SET
        mmi_raw = EXCLUDED.mmi_raw,
        mmi_rounded = EXCLUDED.mmi_rounded,
        mmi_roman = EXCLUDED.mmi_roman,
        decision_policy = EXCLUDED.decision_policy,
        discrepancy_vs_radius = EXCLUDED.discrepancy_vs_radius,
        incident_id = COALESCE(EXCLUDED.incident_id, earthquake_facility_intensities.incident_id),
        notes = EXCLUDED.notes,
        evaluated_at = NOW();
    `;

    await clientOrPool.query(query, values);
  }
}

// ============================================================================
// Two-Stage Pipeline Orchestration
// ============================================================================

/**
 * Stage 1: Dispatches instant nationwide informational notification.
 * - Broadcasts to all authorized SPARTA SIAGA users nationally.
 * - Deduplicated by canonicalEventId.
 * - Strictly does NOT create incident reports.
 * - No user action or acknowledge workflow.
 */
export async function dispatchStageOneNationalNotification(params: {
  canonicalEventId: string;
  title: string;
  magnitude: number;
  depthKm: number;
  latitude: number;
  longitude: number;
  occurredAt: Date;
  sourceProvider?: string;
}): Promise<StageOneNotificationResult> {
  const { canonicalEventId, title, magnitude, depthKm, occurredAt, sourceProvider = "BMKG" } = params;

  const notificationTitle = `Info Gempa M ${magnitude.toFixed(1)}: ${title}`;
  const notificationMessage = `Gempa bumi tektonik M ${magnitude.toFixed(1)} kedalaman ${depthKm} km terdeteksi oleh ${sourceProvider} pada ${occurredAt.toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })} WIB. Sistem sedang menunggu evaluasi intensitas ShakeMap resmi.`;

  try {
    await recordNotificationLog({
      disasterId: canonicalEventId,
      canonicalEventId,
      disasterType: "earthquake",
      channel: "pwa_only",
      branch: "NATIONAL",
      recipientGroup: "HO",
      category: "INFORMATION",
      recipientContact: "in-app://national/all-users",
      title: notificationTitle,
      message: notificationMessage,
      affectedStores: [],
    });

    // Also dispatch background Web Push to registered PWA devices across branches & HO
    await dispatchEarthquakePushNotifications({
      title: notificationTitle,
      body: notificationMessage,
      branch: "NATIONAL",
      eventId: canonicalEventId,
      magnitude,
      url: `/monitoring?disasterId=${encodeURIComponent(canonicalEventId)}`,
    }).catch((pushErr) => {
      console.warn("[Stage 1] Background Web Push dispatch warning:", pushErr);
    });

    return {
      outcome: "dispatched",
      canonicalEventId,
      recipientGroup: "NATIONAL_ALL_USERS",
      message: notificationMessage,
    };
  } catch (err: any) {
    if (String(err?.message || "").includes("duplicate") || String(err?.code) === "23505") {
      return {
        outcome: "duplicate",
        canonicalEventId,
        recipientGroup: "NATIONAL_ALL_USERS",
        message: "Duplicate notification suppressed by canonical_event_id lock.",
      };
    }
    throw err;
  }
}

/**
 * Stage 2: Evaluates ShakeMap MMI per facility and generates candidate auto-reports.
 * - MMI >= 6.0: Creates candidate auto-report draft (pending_confirmation, progress 0).
 * - Scoped per facility branch.
 * - HO can view automatic reports read-only immediately.
 * - If ShakeMap version is revised downward (MMI < 6.0), do NOT cancel existing report; record audit entry.
 */
export async function processStageTwoIntensityEvaluation(params: {
  dataset: ShakeMapDataset;
  facilities: EvaluatedFacilityTarget[];
  dbPool?: Pool;
}): Promise<StageTwoEvaluationResult> {
  const pool = params.dbPool || getOperationalDbPool();
  const { dataset, facilities } = params;

  if (!dataset.grid) {
    throw new Error(`Cannot process Stage 2 evaluation: Grid not found for event ${dataset.eventId}`);
  }

  // 1. Persist ShakeMap Grid Record
  const shakemapDbRecord = await dbSaveShakeMapRecord(dataset.grid, pool);
  const shakemapId = shakemapDbRecord.id;

  const createdIncidentIds: string[] = [];
  const preservedIncidentIds: string[] = [];
  const intensityRecords: FacilityIntensityRecord[] = [];

  let candidateReportsCount = 0;
  let notificationOnlyCount = 0;
  let outOfCoverageCount = 0;

  for (const fac of facilities) {
    const mmi = interpolateMmiFromGrid(dataset.grid, fac.latitude, fac.longitude);
    const decisionResult = evaluateIntensityDecision(mmi);
    const comparison = compareRadiusVsMmi({
      locationCode: fac.code,
      locationName: fac.name,
      branch: fac.branch,
      lat: fac.latitude,
      lon: fac.longitude,
      earthquakeId: dataset.eventId,
      eqLat: dataset.latitude,
      eqLon: dataset.longitude,
      eqMag: dataset.magnitude,
      eqDepthKm: dataset.depthKm,
      mmi,
    });

    if (decisionResult.decision === "CANDIDATE_AUTO_REPORT") {
      candidateReportsCount++;
    } else if (decisionResult.decision === "NOTIFICATION_ONLY") {
      notificationOnlyCount++;
    } else {
      outOfCoverageCount++;
    }

    let linkedIncidentId: string | null = null;

    // Check if an existing report was already created for this location & event
    const existingCheck = await pool.query<{ id: string; status: string; timeline: any }>(
      `SELECT id, status, timeline FROM incidents
        WHERE canonical_event_id = $1 AND location_kind = $2 AND location_id = $3
        LIMIT 1`,
      [dataset.eventId, fac.kind, fac.id]
    );

    const existingIncident = existingCheck.rows[0];

    if (decisionResult.decision === "CANDIDATE_AUTO_REPORT") {
      if (existingIncident) {
        linkedIncidentId = existingIncident.id;
        preservedIncidentIds.push(existingIncident.id);
      } else {
        // Generate deterministic report ID
        const reportHash = crypto
          .createHash("sha256")
          .update(`${dataset.eventId}:${fac.kind}:${fac.id}`)
          .digest("hex")
          .slice(0, 16)
          .toUpperCase();

        const reportPrefix = fac.kind === "STORE" ? "LAP-EQ-STR" : "LAP-EQ-FAC";
        const reportId = `${reportPrefix}-${reportHash}`;

        const reportRes = await ensureEarthquakeReport({
          reportId,
          canonicalEventId: dataset.eventId,
          eventOccurredAt: dataset.occurredAt || new Date(),
          source: dataset.sourceProvider,
          location: {
            kind: fac.kind,
            id: fac.id,
            code: fac.code,
            name: fac.name,
            type: fac.type,
            branch: fac.branch,
            latitude: fac.latitude,
            longitude: fac.longitude,
          },
        });

        if (reportRes.outcome === "created" || reportRes.outcome === "linked_manual") {
          linkedIncidentId = reportRes.incidentId;
          createdIncidentIds.push(reportRes.incidentId);
        } else if (reportRes.outcome === "existing") {
          linkedIncidentId = reportRes.incidentId;
          preservedIncidentIds.push(reportRes.incidentId);
        }
      }
    } else if (existingIncident) {
      // NON-CANCELLATION POLICY: If ShakeMap revised downward (MMI < 6.0), do NOT cancel!
      linkedIncidentId = existingIncident.id;
      preservedIncidentIds.push(existingIncident.id);

      // Append audit trail to incident timeline
      const currentTimeline = Array.isArray(existingIncident.timeline) ? existingIncident.timeline : [];
      const updatedTimeline = [
        ...currentTimeline,
        {
          stage: "shakemap_intensity_revised",
          label: `Estimasi intensitas ShakeMap direvisi ke MMI ${decisionResult.mmiRounded ?? "-"} (${decisionResult.mmiRoman}) pada versi ${dataset.versionNumber}. Laporan dipertahankan untuk verifikasi fisik lapangan.`,
          timestamp: new Date().toISOString(),
          shakemapVersion: dataset.versionNumber,
          mmiEstimate: decisionResult.mmiRounded,
        },
      ];

      await pool.query(
        `UPDATE incidents SET timeline = $1::jsonb, updated_at = NOW() WHERE id = $2`,
        [JSON.stringify(updatedTimeline), existingIncident.id]
      );
    }

    intensityRecords.push({
      shakemapId,
      canonicalEventId: dataset.eventId,
      facilityKind: fac.kind,
      facilityId: fac.id,
      facilityCode: fac.code,
      facilityName: fac.name,
      branch: fac.branch,
      latitude: fac.latitude,
      longitude: fac.longitude,
      distanceKm: comparison.distanceKm,
      mmiRaw: decisionResult.mmi,
      mmiRounded: decisionResult.mmiRounded,
      mmiRoman: decisionResult.mmiRoman,
      decisionPolicy: decisionResult.decision,
      discrepancyVsRadius: comparison.discrepancyType,
      shakemapVersion: dataset.versionNumber,
      incidentId: linkedIncidentId,
      notes: comparison.notes,
    });
  }

  // Persist all facility intensity records
  await dbSaveFacilityIntensities(intensityRecords, pool);

  return {
    canonicalEventId: dataset.eventId,
    shakemapVersion: dataset.versionNumber,
    totalEvaluated: facilities.length,
    candidateReportsCount,
    notificationOnlyCount,
    outOfCoverageCount,
    createdIncidentIds,
    preservedIncidentIds,
  };
}

/**
 * Fallback Checker:
 * - If ShakeMap not available after 30 minutes, triggers informational advisory escalation.
 * - Strictly does NOT create incident reports based on circular radius!
 */
export async function checkAndEscalateShakeMapFallback(params: {
  canonicalEventId: string;
  title: string;
  magnitude: number;
  depthKm: number;
  eventOccurredAt: Date;
  dbPool?: Pool;
}): Promise<FallbackCheckResult> {
  const pool = params.dbPool || getOperationalDbPool();
  const { canonicalEventId, title, magnitude, depthKm, eventOccurredAt } = params;

  const now = new Date();
  const ageMinutes = (now.getTime() - eventOccurredAt.getTime()) / (60 * 1000);

  // Check if ShakeMap already exists
  const existingMap = await pool.query<{ id: string }>(
    `SELECT id FROM earthquake_shakemaps WHERE canonical_event_id = $1 LIMIT 1`,
    [canonicalEventId]
  );

  if (existingMap.rows.length > 0) {
    return {
      isFallbackActive: false,
      eventAgeMinutes: ageMinutes,
      status: "SHAKEMAP_AVAILABLE",
      advisorySent: false,
      message: "ShakeMap numerical data is available; standard Stage 2 evaluation is active.",
    };
  }

  if (ageMinutes < EARTHQUAKE_INTENSITY_CONFIG.fallbackTimeoutMinutes) {
    return {
      isFallbackActive: false,
      eventAgeMinutes: ageMinutes,
      status: "NORMAL_POLLING",
      advisorySent: false,
      message: `Event age ${ageMinutes.toFixed(1)}m < 30m; waiting for official ShakeMap modeling.`,
    };
  }

  // Event age >= 30 minutes and no ShakeMap: trigger informational advisory escalation
  const advisoryTitle = `Advisory: ShakeMap Belum Tersedia (>30m) - M ${magnitude.toFixed(1)}`;
  const advisoryMessage = `Pemodelan ShakeMap resmi untuk gempa ${title} (M ${magnitude.toFixed(1)}, Kedalaman ${depthKm} km) belum terbit setelah 30 menit. Status intensitas tetap UNKNOWN. Sistem melanjutkan retry berkala terkontrol dan TIDAK membuat draf laporan otomatis berbasis radius lama. Cabang dihimbau melakukan koordinasi pemantauan mandiri.`;

  await recordNotificationLog({
    disasterId: canonicalEventId,
    canonicalEventId,
    disasterType: "earthquake",
    channel: "pwa_only",
    branch: "NATIONAL",
    recipientGroup: "BMM",
    category: "INFORMATION",
    recipientContact: "in-app://advisory/coordinators",
    title: advisoryTitle,
    message: advisoryMessage,
    affectedStores: [],
  });

  return {
    isFallbackActive: true,
    eventAgeMinutes: ageMinutes,
    status: "ESCALATED_WAITING_SHAKEMAP",
    advisorySent: true,
    message: advisoryMessage,
  };
}
