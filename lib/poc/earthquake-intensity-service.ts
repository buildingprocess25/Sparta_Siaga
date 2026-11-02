/**
 * SPARTA SIAGA - Earthquake Intensity POC Module
 * 
 * Provides official BMKG & USGS ShakeMap MMI reading, spatial interpolation,
 * policy simulation (MMI >= VI candidate auto-report threshold), and comparison
 * against SPARTA SIAGA's legacy circular radius calculation.
 * 
 * Safety: Read-only, isolated module. Does not alter production databases or workflows.
 */

import fs from "node:fs/promises";
import path from "node:path";

import {
  calculateHaversineDistance,
  calculateSpartaMonitoringZone,
  SpatialRisk,
} from "../haversine";

export type PolicyDecision = "CANDIDATE_AUTO_REPORT" | "NOTIFICATION_ONLY" | "UNKNOWN";

export type DiscrepancyClassification =
  | "CONCORDANT_HIGH_RISK"
  | "CONCORDANT_LOW_RISK"
  | "RADIUS_OVERPREDICTION_VS_MMI"
  | "RADIUS_UNDERPREDICTION_VS_MMI"
  | "OUT_OF_SHAKEMAP_COVERAGE"
  | "FALSE_POSITIVE_RADIUS"
  | "FALSE_NEGATIVE_RADIUS"
  | "DATA_UNAVAILABLE";

export interface ShakeMapGrid {
  eventId: string;
  name: string;
  xMin: number;
  xMax: number;
  numX: number;
  yMin: number;
  yMax: number;
  numY: number;
  values: number[];
  maxMmi: number;
  axisNames?: string[];
  shape?: number[];
}

export interface ShakeMapContour {
  value: number;
  coordinates: [number, number][][];
}

export interface ShakeMapDataset {
  eventId: string;
  title: string;
  magnitude: number;
  depthKm: number;
  latitude: number;
  longitude: number;
  maxMmi: number;
  grid: ShakeMapGrid | null;
  contours: ShakeMapContour[];
  info?: any;
}

export interface BmkgFeltReport {
  city: string;
  rawIntensity: string;
  mmiMin: number;
  mmiMax: number;
  mmiAvg: number;
  romanMin: string;
  romanMax: string;
}

export interface IntensityDecisionResult {
  decision: PolicyDecision;
  mmi: number | null;
  mmiRounded: number | null;
  mmiRoman: string;
  categoryLabel: string;
  potentialDamageDescription: string;
}

export interface RadiusVsMmiComparisonRow {
  locationCode: string;
  locationName: string;
  branch: string;
  locationLat: number;
  locationLon: number;
  earthquakeId: string;
  earthquakeTitle: string;
  magnitude: number;
  depthKm: number;
  epicenterLat: number;
  epicenterLon: number;
  distanceKm: number;
  priorityRadiusKm: number;
  monitoringRadiusKm: number;
  radiusZone: SpatialRisk;
  mmi: number | null;
  mmiRounded: number | null;
  mmiRoman: string;
  mmiDecision: PolicyDecision;
  discrepancyType: DiscrepancyClassification;
  notes: string;
}

/**
 * Standard MMI Roman numeral mappings
 */
const ROMAN_MAP: Record<string, number> = {
  I: 1,
  II: 2,
  III: 3,
  IV: 4,
  V: 5,
  VI: 6,
  VII: 7,
  VIII: 8,
  IX: 9,
  X: 10,
  XI: 11,
  XII: 12,
};

const NUM_TO_ROMAN_MAP: Array<{ threshold: number; roman: string }> = [
  { threshold: 11.5, roman: "XII" },
  { threshold: 10.5, roman: "XI" },
  { threshold: 9.5, roman: "X" },
  { threshold: 8.5, roman: "IX" },
  { threshold: 7.5, roman: "VIII" },
  { threshold: 6.5, roman: "VII" },
  { threshold: 5.5, roman: "VI" },
  { threshold: 4.5, roman: "V" },
  { threshold: 3.5, roman: "IV" },
  { threshold: 2.5, roman: "III" },
  { threshold: 1.5, roman: "II" },
  { threshold: 0.0, roman: "I" },
];

export function romanToNumber(roman: string): number {
  const clean = roman.trim().toUpperCase();
  return ROMAN_MAP[clean] || 1;
}

export function numberToRoman(mmi: number | null): string {
  if (mmi == null || !Number.isFinite(mmi) || mmi <= 0) return "-";
  for (const item of NUM_TO_ROMAN_MAP) {
    if (mmi >= item.threshold) return item.roman;
  }
  return "I";
}

/**
 * Parses BMKG Dirasakan intensity string (e.g., 'V-VI Cianjur, IV-V Garut, IV Sukabumi')
 */
export function parseBmkgDirasakan(dirasakanStr: string): BmkgFeltReport[] {
  if (!dirasakanStr || typeof dirasakanStr !== "string") return [];

  const results: BmkgFeltReport[] = [];
  const entries = dirasakanStr.split(",");

  for (const raw of entries) {
    const trimmed = raw.trim();
    if (!trimmed) continue;

    // Pattern matches Roman numerals or range like "V-VI" or "IV" followed by city/region
    const match = trimmed.match(/^([IVXLCDM]+(?:-[IVXLCDM]+)?)\s+(.+)$/i);
    if (!match) continue;

    const rawIntensity = match[1].trim().toUpperCase();
    const city = match[2].trim();

    let mmiMin = 1;
    let mmiMax = 1;
    let romanMin = "I";
    let romanMax = "I";

    if (rawIntensity.includes("-")) {
      const parts = rawIntensity.split("-");
      romanMin = parts[0].trim();
      romanMax = parts[1].trim();
      mmiMin = romanToNumber(romanMin);
      mmiMax = romanToNumber(romanMax);
    } else {
      romanMin = rawIntensity;
      romanMax = rawIntensity;
      mmiMin = romanToNumber(rawIntensity);
      mmiMax = mmiMin;
    }

    const mmiAvg = Math.round(((mmiMin + mmiMax) / 2) * 10) / 10;

    results.push({
      city,
      rawIntensity,
      mmiMin,
      mmiMax,
      mmiAvg,
      romanMin,
      romanMax,
    });
  }

  return results;
}

/**
 * Validates a grid cell value. Returns true only if value is a finite number in physical MMI range [0.5, 12].
 */
export function isValidGridValue(val: unknown): val is number {
  return typeof val === "number" && Number.isFinite(val) && val >= 0.5 && val <= 12;
}

/**
 * Parses and strictly validates a USGS ShakeMap CovJSON (Coverage JSON) into a memory-efficient grid.
 * Validates:
 * - Domain object and axes (x, y) with finite ranges
 * - Ranges object containing MMI data
 * - axisNames (ensures spatial coordinates x, y / lat, lon)
 * - shape dimensions matching values array length
 * - NoData / null / NaN handling
 */
export function parseShakeMapCovJson(
  covJson: any,
  meta: { eventId?: string; name?: string } = {}
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

  // Validate axis parameters
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

  // Geographic bounds validation
  if (x.start < -180 || x.stop > 360 || y.start < -90 || y.stop > 90) {
    throw new Error(`Invalid CovJSON: Axis coordinates out of valid geographic range (x: [${x.start}, ${x.stop}], y: [${y.start}, ${y.stop}]).`);
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

  // Validate values length against grid dimensions
  if (values.length !== expectedLength) {
    throw new Error(
      `Invalid CovJSON: Grid length mismatch. Expected ${expectedLength} (${x.num} x ${y.num}), received ${values.length}.`
    );
  }

  // Validate axisNames (mandatory in CovJSON NdArray for spatial grid)
  if (!mmiRange.axisNames || !Array.isArray(mmiRange.axisNames) || mmiRange.axisNames.length !== 2) {
    throw new Error("Invalid CovJSON: axisNames must be a 2-element array.");
  }
  const cleanAxes = mmiRange.axisNames.map((a: string) => String(a).toLowerCase().trim());
  const hasY = cleanAxes.includes("y") || cleanAxes.includes("latitude") || cleanAxes.includes("lat");
  const hasX = cleanAxes.includes("x") || cleanAxes.includes("longitude") || cleanAxes.includes("lon");
  if (!hasY || !hasX) {
    throw new Error(`Invalid CovJSON: axisNames must contain spatial coordinates (received: ${JSON.stringify(mmiRange.axisNames)}).`);
  }

  // Validate shape (mandatory in CovJSON NdArray)
  if (!mmiRange.shape || !Array.isArray(mmiRange.shape) || mmiRange.shape.length !== 2) {
    throw new Error("Invalid CovJSON: shape must be a 2-element array.");
  }
  const [s0, s1] = mmiRange.shape;
  if (s0 * s1 !== expectedLength) {
    throw new Error(`Invalid CovJSON: shape dimensions [${s0}, ${s1}] (${s0 * s1}) do not match grid length (${expectedLength}).`);
  }

  // Verify shape dimensions match axis order
  const firstAxisIsY = cleanAxes[0] === "y" || cleanAxes[0] === "latitude" || cleanAxes[0] === "lat";
  const expectedShape = firstAxisIsY ? [y.num, x.num] : [x.num, y.num];
  if (s0 !== expectedShape[0] || s1 !== expectedShape[1]) {
    throw new Error(`Invalid CovJSON: shape [${s0}, ${s1}] does not match axis dimensions [${expectedShape[0]}, ${expectedShape[1]}].`);
  }

  // Calculate maxMmi safely ignoring nulls, NaNs, and negative NoData sentinels
  const validValues = values.filter(isValidGridValue);
  const maxMmi = validValues.length > 0 ? Math.max(...validValues) : 0;

  return {
    eventId: meta.eventId || "unknown-event",
    name: meta.name || "ShakeMap Grid",
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
  };
}

/**
 * Performs bilinear interpolation of MMI from a ShakeMapGrid at target (lat, lon).
 * 
 * Precision & NoData Rules:
 * 1. Returns exact, unrounded floating-point number (full precision for threshold evaluation).
 * 2. Returns null (which maps to UNKNOWN) if coordinates are outside bounds, invalid, or if grid data is missing (NoData, null, NaN).
 * 3. Never returns 0 for missing data.
 */
export function interpolateMmiFromGrid(
  grid: ShakeMapGrid,
  lat: number,
  lon: number
): number | null {
  if (
    !Number.isFinite(lat) ||
    !Number.isFinite(lon) ||
    lat < -90 ||
    lat > 90 ||
    lon < -180 ||
    lon > 180
  ) {
    return null;
  }

  // Bounding box check: strictly out of grid coverage returns null
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

  // Check valid values for all 4 surrounding grid nodes
  const val00Valid = isValidGridValue(v00);
  const val01Valid = isValidGridValue(v01);
  const val10Valid = isValidGridValue(v10);
  const val11Valid = isValidGridValue(v11);

  // If all 4 corner nodes are missing or NoData, data is unavailable at this point -> return null
  if (!val00Valid && !val01Valid && !val10Valid && !val11Valid) {
    return null;
  }

  // Standard bilinear interpolation when all 4 nodes are valid
  if (val00Valid && val01Valid && val10Valid && val11Valid) {
    const interpolated =
      (1 - u) * (1 - v) * (v00 as number) +
      u * (1 - v) * (v01 as number) +
      (1 - u) * v * (v10 as number) +
      u * v * (v11 as number);

    // Return unrounded full precision float
    return interpolated;
  }

  // Partial node interpolation (edge of valid data mask)
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

  if (totalWeight <= 0) {
    return null;
  }

  return weightedSum / totalWeight;
}

/**
 * Candidate decision policy based on instrumental intensity:
 * - MMI < 6.0: NOTIFICATION_ONLY
 * - MMI >= 6.0: CANDIDATE_AUTO_REPORT (candidate threshold of potential non-structural and structural damage)
 * - null / out of coverage: UNKNOWN (data missing or out of coverage)
 * 
 * Uses full unrounded precision for the >= 6.0 threshold evaluation.
 * Returns mmiRounded for display formatting.
 */
export function evaluateIntensityDecision(mmi: number | null): IntensityDecisionResult {
  if (mmi == null || !Number.isFinite(mmi)) {
    return {
      decision: "UNKNOWN",
      mmi: null,
      mmiRounded: null,
      mmiRoman: "-",
      categoryLabel: "Di Luar Cakupan / Data Tidak Tersedia",
      potentialDamageDescription: "Data ShakeMap tidak mencakup koordinat atau belum tersedia.",
    };
  }

  // Full precision threshold evaluation
  const decision: PolicyDecision = mmi >= 6.0 ? "CANDIDATE_AUTO_REPORT" : "NOTIFICATION_ONLY";
  const mmiRounded = Math.round(mmi * 100) / 100;
  const mmiRoman = numberToRoman(mmi);

  if (mmi < 3.5) {
    return {
      decision,
      mmi,
      mmiRounded,
      mmiRoman,
      categoryLabel: "Getaran Ringan (Light - MMI I-III)",
      potentialDamageDescription: "Dirasakan oleh beberapa orang di dalam ruangan. Tidak ada potensi kerusakan fisik.",
    };
  }

  if (mmi < 6.0) {
    return {
      decision,
      mmi,
      mmiRounded,
      mmiRoman,
      categoryLabel: "Getaran Sedang (Moderate - MMI IV-V)",
      potentialDamageDescription: "Dirasakan banyak orang hingga hampir semua penduduk. Barang kecil bergeser. Belum ada kerusakan fisik/struktural.",
    };
  }

  if (mmi < 7.0) {
    return {
      decision,
      mmi,
      mmiRounded,
      mmiRoman,
      categoryLabel: "Getaran Kuat (Strong - MMI VI - BMKG SIG III)",
      potentialDamageDescription: "Semua orang terkejut keluar. Plester dinding retak/jatuh. Ambang kandidat kebijakan inspeksi fisik.",
    };
  }

  if (mmi < 8.0) {
    return {
      decision,
      mmi,
      mmiRounded,
      mmiRoman,
      categoryLabel: "Sangat Kuat (Very Strong - MMI VII - BMKG SIG IV)",
      potentialDamageDescription: "Kerusakan ringan pada bangunan kokoh, retak pada bangunan biasa. Prioritas inspeksi fisik.",
    };
  }

  return {
    decision,
    mmi,
    mmiRounded,
    mmiRoman,
    categoryLabel: "Destruktif / Parah (Destructive - MMI VIII+ - BMKG SIG V)",
    potentialDamageDescription: "Kerusakan berat pada bangunan, rangka bergeser, fondasi retak. Sangat prioritas penanganan darurat.",
  };
}

/**
 * Compares current SPARTA circular radius model with ShakeMap MMI for a single location.
 * 
 * Rules:
 * 1. Locations outside ShakeMap coverage strictly yield UNKNOWN and OUT_OF_SHAKEMAP_COVERAGE. Never SAFE!
 * 2. Terminology clarifies that discrepancies are comparisons against ShakeMap model estimates, not ground-truth damage.
 */
export function compareRadiusVsMmi(params: {
  locationCode: string;
  locationName: string;
  branch?: string;
  lat: number;
  lon: number;
  earthquakeId: string;
  earthquakeTitle?: string;
  eqLat: number;
  eqLon: number;
  eqMag: number;
  eqDepthKm: number;
  mmi: number | null;
}): RadiusVsMmiComparisonRow {
  const {
    locationCode,
    locationName,
    branch = "Cabang",
    lat,
    lon,
    earthquakeId,
    earthquakeTitle = "Earthquake Event",
    eqLat,
    eqLon,
    eqMag,
    eqDepthKm,
    mmi,
  } = params;

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
    notes = "Di luar cakupan grid ShakeMap numerik: Estimasi intensitas tidak tersedia (UNKNOWN), evaluasi mengandalkan parameter gempa awal.";
  } else if (radiusZone === "PRIORITY_MONITOR" && mmiDecision === "CANDIDATE_AUTO_REPORT") {
    discrepancyType = "CONCORDANT_HIGH_RISK";
    notes = "Konsisten risiko tinggi: Radius prioritas dan estimasi ShakeMap sama-sama memproyeksikan potensi dampak signifikan (Radius Priority & MMI >= VI).";
  } else if (
    (radiusZone === "MONITOR" || radiusZone === "SAFE") &&
    mmiDecision === "NOTIFICATION_ONLY"
  ) {
    discrepancyType = "CONCORDANT_LOW_RISK";
    notes = "Konsisten risiko rendah: Radius melingkar dan estimasi ShakeMap sama-sama memproyeksikan intensitas rendah (Radius Monitor/Safe & MMI < VI).";
  } else if (radiusZone === "PRIORITY_MONITOR" && mmiDecision === "NOTIFICATION_ONLY") {
    discrepancyType = "RADIUS_OVERPREDICTION_VS_MMI";
    notes = "Radius overprediction vs MMI: Radius melingkar memicu zona prioritas (<= 35km), padahal estimasi ShakeMap menunjukkan intensitas non-destruktif MMI < VI. Draf tiket inspeksi darurat palsu dihindarkan.";
  } else if (
    (radiusZone === "MONITOR" || radiusZone === "SAFE") &&
    mmiDecision === "CANDIDATE_AUTO_REPORT"
  ) {
    discrepancyType = "RADIUS_UNDERPREDICTION_VS_MMI";
    notes = "Radius underprediction vs MMI: Radius melingkar mengklasifikasikan aman/monitor, padahal estimasi ShakeMap memproyeksikan intensitas tinggi MMI >= VI akibat amplifikasi tanah lokal atau directivity sesar.";
  }

  return {
    locationCode,
    locationName,
    branch,
    locationLat: lat,
    locationLon: lon,
    earthquakeId,
    earthquakeTitle,
    magnitude: eqMag,
    depthKm: eqDepthKm,
    epicenterLat: eqLat,
    epicenterLon: eqLon,
    distanceKm: isNaN(distanceKm) ? 0 : distanceKm,
    priorityRadiusKm,
    monitoringRadiusKm,
    radiusZone,
    mmi,
    mmiRounded: intensityResult.mmiRounded,
    mmiRoman: intensityResult.mmiRoman,
    mmiDecision,
    discrepancyType,
    notes,
  };
}

/**
 * Loads a ShakeMap dataset from a local cached directory.
 */
export async function loadShakeMapFromDirectory(
  eventId: string,
  dirPath: string
): Promise<ShakeMapDataset | null> {
  try {
    const detailPath = path.join(dirPath, "detail.json");
    const covPath = path.join(dirPath, "coverage_mmi.covjson");
    const contPath = path.join(dirPath, "cont_mmi.json");
    const infoPath = path.join(dirPath, "info.json");

    let detailJson: any = null;
    let covJson: any = null;
    let contJson: any = null;
    let infoJson: any = null;

    try {
      detailJson = JSON.parse(await fs.readFile(detailPath, "utf8"));
    } catch {
      // ignore
    }

    try {
      covJson = JSON.parse(await fs.readFile(covPath, "utf8"));
    } catch {
      // ignore
    }

    try {
      contJson = JSON.parse(await fs.readFile(contPath, "utf8"));
    } catch {
      // ignore
    }

    try {
      infoJson = JSON.parse(await fs.readFile(infoPath, "utf8"));
    } catch {
      // ignore
    }

    const p = detailJson?.properties || {};
    const coords = detailJson?.geometry?.coordinates || [0, 0, 10];
    const lon = coords[0];
    const lat = coords[1];
    const depthKm = coords[2] ?? 10;
    const mag = p.mag ?? 0;
    const title = p.title || `Earthquake ${eventId}`;

    const grid = covJson ? parseShakeMapCovJson(covJson, { eventId, name: title }) : null;
    const maxMmi = p.mmi ?? (grid ? grid.maxMmi : 0);

    const contours: ShakeMapContour[] = [];
    if (contJson && Array.isArray(contJson.features)) {
      for (const feat of contJson.features) {
        const val = feat.properties?.value ?? 0;
        const geom = feat.geometry;
        if (geom?.type === "MultiLineString" && Array.isArray(geom.coordinates)) {
          contours.push({ value: val, coordinates: geom.coordinates });
        } else if (geom?.type === "LineString" && Array.isArray(geom.coordinates)) {
          contours.push({ value: val, coordinates: [geom.coordinates] });
        }
      }
    }

    return {
      eventId,
      title,
      magnitude: mag,
      depthKm,
      latitude: lat,
      longitude: lon,
      maxMmi,
      grid,
      contours,
      info: infoJson,
    };
  } catch (err) {
    console.error(`[loadShakeMapFromDirectory] Failed to load dataset for ${eventId}:`, err);
    return null;
  }
}

/**
 * Evaluates a single facility or store against a ShakeMapDataset.
 */
export function evaluateFacilityAgainstEvent(
  facility: {
    code: string;
    name: string;
    branch?: string;
    latitude: number;
    longitude: number;
  },
  dataset: ShakeMapDataset
): RadiusVsMmiComparisonRow {
  const mmi = dataset.grid
    ? interpolateMmiFromGrid(dataset.grid, facility.latitude, facility.longitude)
    : null;

  return compareRadiusVsMmi({
    locationCode: facility.code,
    locationName: facility.name,
    branch: facility.branch || "Cabang",
    lat: facility.latitude,
    lon: facility.longitude,
    earthquakeId: dataset.eventId,
    earthquakeTitle: dataset.title,
    eqLat: dataset.latitude,
    eqLon: dataset.longitude,
    eqMag: dataset.magnitude,
    eqDepthKm: dataset.depthKm,
    mmi,
  });
}
