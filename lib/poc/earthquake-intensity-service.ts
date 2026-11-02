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
 * Parses a USGS ShakeMap CovJSON (Coverage JSON) into a memory-efficient grid.
 */
export function parseShakeMapCovJson(
  covJson: any,
  meta: { eventId?: string; name?: string } = {}
): ShakeMapGrid {
  if (!covJson || !covJson.domain || !covJson.ranges) {
    throw new Error("Invalid CovJSON: Missing domain or ranges object.");
  }

  const x = covJson.domain.axes?.x;
  const y = covJson.domain.axes?.y;

  if (!x || !y) {
    throw new Error("Invalid CovJSON: Missing x or y axis.");
  }

  const mmiRange = covJson.ranges.MMI || covJson.ranges.mmi;
  if (!mmiRange || !Array.isArray(mmiRange.values)) {
    throw new Error("Invalid CovJSON: Missing MMI values array.");
  }

  const values: number[] = mmiRange.values;
  const maxMmi = values.length > 0 ? Math.max(...values) : 0;

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
  };
}

/**
 * Performs bilinear interpolation of MMI from a ShakeMapGrid at target (lat, lon).
 * Returns null if target coordinates are outside grid boundaries or invalid.
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

  // Bounding box check
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

  const v00 = grid.values[idx00] ?? 0;
  const v01 = grid.values[idx01] ?? v00;
  const v10 = grid.values[idx10] ?? v00;
  const v11 = grid.values[idx11] ?? v00;

  // Bilinear interpolation formula:
  // f(u,v) = (1-u)(1-v)v00 + u(1-v)v01 + (1-u)v v10 + uv v11
  const interpolated =
    (1 - u) * (1 - v) * v00 +
    u * (1 - v) * v01 +
    (1 - u) * v * v10 +
    u * v * v11;

  return Math.round(interpolated * 100) / 100;
}

/**
 * Candidate decision policy based on instrumental intensity:
 * - MMI < 6.0: NOTIFICATION_ONLY
 * - MMI >= 6.0: CANDIDATE_AUTO_REPORT (threshold of potential non-structural and structural damage)
 * - null: UNKNOWN (data missing or out of coverage)
 */
export function evaluateIntensityDecision(mmi: number | null): IntensityDecisionResult {
  if (mmi == null || !Number.isFinite(mmi)) {
    return {
      decision: "UNKNOWN",
      mmi: null,
      mmiRoman: "-",
      categoryLabel: "Tidak Terjangkau / Data Tidak Tersedia",
      potentialDamageDescription: "Data ShakeMap tidak mencakup koordinat atau belum tersedia.",
    };
  }

  const mmiRoman = numberToRoman(mmi);

  if (mmi < 3.5) {
    return {
      decision: "NOTIFICATION_ONLY",
      mmi,
      mmiRoman,
      categoryLabel: "Getaran Ringan (Light - MMI I-III)",
      potentialDamageDescription: "Dirasakan oleh beberapa orang di dalam ruangan. Tidak ada potensi kerusakan fisik.",
    };
  }

  if (mmi < 6.0) {
    return {
      decision: "NOTIFICATION_ONLY",
      mmi,
      mmiRoman,
      categoryLabel: "Getaran Sedang (Moderate - MMI IV-V)",
      potentialDamageDescription: "Dirasakan banyak orang hingga hampir semua penduduk. Barang kecil bergeser. Belum ada kerusakan fisik/struktural.",
    };
  }

  if (mmi < 7.0) {
    return {
      decision: "CANDIDATE_AUTO_REPORT",
      mmi,
      mmiRoman,
      categoryLabel: "Getaran Kuat (Strong - MMI VI - BMKG SIG III)",
      potentialDamageDescription: "Semua orang terkejut keluar. Plester dinding retak/jatuh. Ambang awal potensi kerusakan fisik/non-struktural.",
    };
  }

  if (mmi < 8.0) {
    return {
      decision: "CANDIDATE_AUTO_REPORT",
      mmi,
      mmiRoman,
      categoryLabel: "Sangat Kuat (Very Strong - MMI VII - BMKG SIG IV)",
      potentialDamageDescription: "Kerusakan ringan pada bangunan kokoh, retak pada bangunan biasa. Wajib inspeksi fisik.",
    };
  }

  return {
    decision: "CANDIDATE_AUTO_REPORT",
    mmi,
    mmiRoman,
    categoryLabel: "Destruktif / Parah (Destructive - MMI VIII+ - BMKG SIG V)",
    potentialDamageDescription: "Kerusakan berat pada bangunan, rangka bergeser, fondasi retak. Sangat prioritas penanganan darurat.",
  };
}

/**
 * Compares current SPARTA circular radius model with ShakeMap MMI for a single location.
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

  let discrepancyType: DiscrepancyClassification = "DATA_UNAVAILABLE";
  let notes = "";

  if (mmiDecision === "UNKNOWN") {
    discrepancyType = "DATA_UNAVAILABLE";
    notes = "ShakeMap tidak mencakup koordinat fasilitas.";
  } else if (radiusZone === "PRIORITY_MONITOR" && mmiDecision === "CANDIDATE_AUTO_REPORT") {
    discrepancyType = "CONCORDANT_HIGH_RISK";
    notes = "Keduanya sepakat: Risiko kerusakan fisik tinggi, laporan darurat tepat dipicu.";
  } else if (
    (radiusZone === "MONITOR" || radiusZone === "SAFE") &&
    mmiDecision === "NOTIFICATION_ONLY"
  ) {
    discrepancyType = "CONCORDANT_LOW_RISK";
    notes = "Keduanya sepakat: Getaran ringan hingga sedang, cukup notifikasi tanpa tiket operasional.";
  } else if (radiusZone === "PRIORITY_MONITOR" && mmiDecision === "NOTIFICATION_ONLY") {
    discrepancyType = "FALSE_POSITIVE_RADIUS";
    notes = "Kelemahan radius: Radius melingkar memicu laporan darurat, padahal intensitas MMI < VI (tidak ada kerusakan fisik).";
  } else if (
    (radiusZone === "MONITOR" || radiusZone === "SAFE") &&
    mmiDecision === "CANDIDATE_AUTO_REPORT"
  ) {
    discrepancyType = "FALSE_NEGATIVE_RADIUS";
    notes = "Kelemahan radius: Radius lingkaran melewatkan atau mendowngrade fasilitas yang mengalami MMI >= VI akibat amplifikasi tanah / arah patahan.";
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
    const maxMmi = p.mmi ?? (covJson ? Math.max(...(covJson.ranges?.MMI?.values || [0])) : 0);

    const grid = covJson ? parseShakeMapCovJson(covJson, { eventId, name: title }) : null;

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
