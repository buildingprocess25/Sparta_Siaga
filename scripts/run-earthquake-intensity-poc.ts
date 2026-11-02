/**
 * SPARTA SIAGA - Earthquake Intensity POC Runner & Benchmark
 * 
 * Evaluates 67 key logistics facilities (DCs / Warehouses) and
 * retail store networks across 5 authentic Indonesian earthquakes
 * comparing SPARTA SIAGA's circular radius model against ShakeMap MMI.
 * 
 * Generates: radius_vs_mmi_comparison.csv
 * Safety: Read-only, no database writes.
 * Rule: Zero em dashes.
 */

import path from "node:path";
import fs from "node:fs/promises";
import { existsSync, createReadStream } from "node:fs";
import readline from "node:readline";
import * as XLSX from "xlsx";

import {
  loadShakeMapFromDirectory,
  interpolateMmiFromGrid,
  compareRadiusVsMmi,
  RadiusVsMmiComparisonRow,
  ShakeMapDataset,
} from "../lib/poc/earthquake-intensity-service";

interface FacilityItem {
  code: string;
  name: string;
  branch: string;
  category: string;
  latitude: number;
  longitude: number;
}

interface StoreItem {
  code: string;
  name: string;
  branch: string;
  latitude: number;
  longitude: number;
}

const HISTORICAL_EVENTS = [
  { id: "us7000ir9t", name: "Cianjur 2022 (M5.6 Depth:10km)" },
  { id: "us1000h3p4", name: "Palu 2018 (M7.5 Depth:20km)" },
  { id: "us1000g3ub", name: "Lombok 2018 (M6.9 Depth:34km)" },
  { id: "us6000e0iy", name: "Malang 2021 (M6.0 Depth:67km)" },
  { id: "us6000gzyg", name: "Pasaman 2022 (M6.1 Depth:4km)" },
];

async function loadFacilities(): Promise<FacilityItem[]> {
  const filePath = path.resolve(process.cwd(), "data/KOORDINAT GUDANG.xlsx");
  if (!existsSync(filePath)) {
    console.warn("KOORDINAT GUDANG.xlsx not found");
    return [];
  }

  const fileBuffer = await fs.readFile(filePath);
  const xlsxLib: any = (XLSX as any).default || XLSX;
  const wb = xlsxLib.read(fileBuffer, { type: "buffer" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows: any[] = xlsxLib.utils.sheet_to_json(sheet);

  const facilities: FacilityItem[] = [];
  for (const r of rows) {
    const lat = Number(r.Latitude);
    const lon = Number(r.Longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;

    facilities.push({
      code: String(r.Kode || "").trim(),
      name: String(r["Nama Toko"] || r.name || "").trim(),
      branch: String(r.Inisial || r.cabang || "DC").trim(),
      category: String(r.CATEGORY || "DC").trim(),
      latitude: lat,
      longitude: lon,
    });
  }

  return facilities;
}

async function loadStoresSample(maxPerBranch = 150): Promise<StoreItem[]> {
  const filePath = path.resolve(process.cwd(), "data/stores-master.csv");
  if (!existsSync(filePath)) {
    console.warn("stores-master.csv not found");
    return [];
  }

  const stream = createReadStream(filePath);
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  const stores: StoreItem[] = [];
  const branchCounts: Record<string, number> = {};
  let isHeader = true;

  for await (const line of rl) {
    if (isHeader) {
      isHeader = false;
      continue;
    }

    const trimmed = line.trim();
    if (!trimmed) continue;

    // Format: Branch,Kode Toko,Nama Toko,F/R,Titik Koordinat
    const parts = trimmed.split(",");
    if (parts.length < 5) continue;

    const branch = parts[0].trim();
    const code = parts[1].trim();
    const name = parts[2].trim();
    const coordStr = parts.slice(4).join(",").replace(/"/g, "").trim();

    const coordParts = coordStr.split(/[\s,]+/);
    if (coordParts.length < 2) continue;

    const lat = parseFloat(coordParts[0]);
    const lon = parseFloat(coordParts[1]);

    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;

    const currentCount = branchCounts[branch] || 0;
    if (currentCount >= maxPerBranch) continue;

    branchCounts[branch] = currentCount + 1;
    stores.push({
      code,
      name,
      branch,
      latitude: lat,
      longitude: lon,
    });
  }

  return stores;
}

function escapeCsvField(val: any): string {
  if (val == null) return "";
  const str = String(val);
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

async function runBenchmark() {
  console.log("================================================================================");
  console.log(" SPARTA SIAGA: EARTHQUAKE INTENSITY (SHAKEMAP) POC BENCHMARK & EVALUATION");
  console.log("================================================================================\n");

  console.log("--> Loading 67 key logistics facilities (KOORDINAT GUDANG.xlsx)...");
  const facilities = await loadFacilities();
  console.log(`    Loaded ${facilities.length} logistics facilities.`);

  console.log("--> Loading master store network sample (stores-master.csv)...");
  const stores = await loadStoresSample(150);
  console.log(`    Loaded ${stores.length} stores across multiple operational branches.`);

  console.log("--> Loading official USGS ShakeMap datasets...");
  const datasets: ShakeMapDataset[] = [];
  const baseDir = path.resolve(process.cwd(), "data/poc/shakemaps");

  for (const ev of HISTORICAL_EVENTS) {
    const dir = path.join(baseDir, ev.id);
    const ds = await loadShakeMapFromDirectory(ev.id, dir);
    if (ds) {
      datasets.push(ds);
      console.log(`    [LOADED] ${ds.eventId}: ${ds.title} (M${ds.magnitude}, Depth:${ds.depthKm}km, Max MMI:${ds.maxMmi})`);
    } else {
      console.warn(`    [MISSING] ${ev.id}: Dataset not found in ${dir}`);
    }
  }

  if (datasets.length === 0) {
    console.error("No ShakeMap datasets loaded. Please ensure data/poc/shakemaps contains downloaded events.");
    process.exit(1);
  }

  console.log("\n--> Executing comparative analysis: Circular Radius vs ShakeMap MMI...");
  const t0 = performance.now();
  const comparisonRows: RadiusVsMmiComparisonRow[] = [];

  // Combine facilities and stores
  const allLocations = [
    ...facilities.map((f) => ({
      code: f.code,
      name: `[FACILITY-${f.category}] ${f.name}`,
      branch: f.branch,
      latitude: f.latitude,
      longitude: f.longitude,
    })),
    ...stores.map((s) => ({
      code: s.code,
      name: `[STORE] ${s.name}`,
      branch: s.branch,
      latitude: s.latitude,
      longitude: s.longitude,
    })),
  ];

  for (const ds of datasets) {
    for (const loc of allLocations) {
      const mmi = ds.grid
        ? interpolateMmiFromGrid(ds.grid, loc.latitude, loc.longitude)
        : null;

      const row = compareRadiusVsMmi({
        locationCode: loc.code,
        locationName: loc.name,
        branch: loc.branch,
        lat: loc.latitude,
        lon: loc.longitude,
        earthquakeId: ds.eventId,
        earthquakeTitle: ds.title,
        eqLat: ds.latitude,
        eqLon: ds.longitude,
        eqMag: ds.magnitude,
        eqDepthKm: ds.depthKm,
        mmi,
      });

      comparisonRows.push(row);
    }
  }

  const t1 = performance.now();
  const executionTimeMs = t1 - t0;
  const totalEvaluations = comparisonRows.length;
  const evaluationsPerSec = Math.round((totalEvaluations / executionTimeMs) * 1000);

  console.log(`\nCompleted ${totalEvaluations} evaluations in ${executionTimeMs.toFixed(2)} ms (${evaluationsPerSec} evaluations/sec).`);

  // Explicit Denominator Grouping
  const nTotal = totalEvaluations;
  const outOfCoverageRows = comparisonRows.filter((r) => r.discrepancyType === "OUT_OF_SHAKEMAP_COVERAGE");
  const nOutOfCoverage = outOfCoverageRows.length;
  const coveredRows = comparisonRows.filter((r) => r.discrepancyType !== "OUT_OF_SHAKEMAP_COVERAGE");
  const nCovered = coveredRows.length;

  const concordantHighRiskRows = coveredRows.filter((r) => r.discrepancyType === "CONCORDANT_HIGH_RISK");
  const concordantLowRiskRows = coveredRows.filter((r) => r.discrepancyType === "CONCORDANT_LOW_RISK");
  const radiusOverpredictionRows = coveredRows.filter((r) => r.discrepancyType === "RADIUS_OVERPREDICTION_VS_MMI");
  const radiusUnderpredictionRows = coveredRows.filter((r) => r.discrepancyType === "RADIUS_UNDERPREDICTION_VS_MMI");

  const nConcordantHigh = concordantHighRiskRows.length;
  const nConcordantLow = concordantLowRiskRows.length;
  const nConcordantTotal = nConcordantHigh + nConcordantLow;
  const nRadiusOverprediction = radiusOverpredictionRows.length;
  const nRadiusUnderprediction = radiusUnderpredictionRows.length;

  // Covered locations where circular radius triggered PRIORITY_MONITOR
  const coveredPriorityRadiusRows = coveredRows.filter((r) => r.radiusZone === "PRIORITY_MONITOR");
  const nCoveredPriorityRadius = coveredPriorityRadiusRows.length;

  // Action counts across all evaluations
  const mmiCandidateAutoReportCount = comparisonRows.filter((r) => r.mmiDecision === "CANDIDATE_AUTO_REPORT").length;
  const mmiNotificationOnlyCount = comparisonRows.filter((r) => r.mmiDecision === "NOTIFICATION_ONLY").length;
  const mmiUnknownCount = comparisonRows.filter((r) => r.mmiDecision === "UNKNOWN").length;
  const radiusPriorityMonitorCount = comparisonRows.filter((r) => r.radiusZone === "PRIORITY_MONITOR").length;
  const radiusMonitorCount = comparisonRows.filter((r) => r.radiusZone === "MONITOR").length;
  const radiusSafeCount = comparisonRows.filter((r) => r.radiusZone === "SAFE").length;

  // Percentage calculations with explicit denominators
  const coverageRate = ((nCovered / nTotal) * 100).toFixed(1);
  const outOfCoverageRate = ((nOutOfCoverage / nTotal) * 100).toFixed(1);

  // Denominator: N_covered
  const concordanceRate = nCovered > 0 ? ((nConcordantTotal / nCovered) * 100).toFixed(1) : "0.0";
  const overpredictionVsCoveredRate = nCovered > 0 ? ((nRadiusOverprediction / nCovered) * 100).toFixed(1) : "0.0";
  const underpredictionVsCoveredRate = nCovered > 0 ? ((nRadiusUnderprediction / nCovered) * 100).toFixed(1) : "0.0";

  // Denominator: N_coveredPriorityRadius (how many circular priority alerts were downgraded)
  const overpredictionVsPriorityRate = nCoveredPriorityRadius > 0
    ? ((nRadiusOverprediction / nCoveredPriorityRadius) * 100).toFixed(1)
    : "0.0";

  console.log("\n================================================================================");
  console.log(" STATISTICAL SUMMARY: RADIUS MODEL VS SHAKEMAP MMI (WITH EXPLICIT DENOMINATORS)");
  console.log("================================================================================");
  console.log(` N_total (All Location-Event Pairs)         : ${nTotal}`);
  console.log(` N_covered (Inside ShakeMap Numerical Grid) : ${nCovered} (${coverageRate}% of N_total)`);
  console.log(` N_uncovered (Out of ShakeMap Grid Bounds)  : ${nOutOfCoverage} (${outOfCoverageRate}% of N_total)`);
  console.log("--------------------------------------------------------------------------------");
  console.log(" BREAKDOWN WITHIN SHAKEMAP COVERAGE (Denominator: N_covered = " + nCovered + "):");
  console.log(` 1. Concordant High Risk (Both High)        : ${nConcordantHigh} (${((nConcordantHigh / nCovered) * 100).toFixed(1)}%)`);
  console.log(` 2. Concordant Low Risk (Both Low)          : ${nConcordantLow} (${((nConcordantLow / nCovered) * 100).toFixed(1)}%)`);
  console.log(` 3. Radius Overprediction vs MMI            : ${nRadiusOverprediction} (${overpredictionVsCoveredRate}% of N_covered)`);
  console.log(`    -> Relative to Covered Priority Alerts  : ${overpredictionVsPriorityRate}% (${nRadiusOverprediction} / ${nCoveredPriorityRadius})`);
  console.log(` 4. Radius Underprediction vs MMI           : ${nRadiusUnderprediction} (${underpredictionVsCoveredRate}% of N_covered)`);
  console.log(` Overall Concordance Rate (High/Low Match)  : ${concordanceRate}% (${nConcordantTotal} / ${nCovered})`);
  console.log("--------------------------------------------------------------------------------");
  console.log(" DECISION & ZONE TOTAL COUNTS:");
  console.log(` - Circular Radius Priority Zone (Report)   : ${radiusPriorityMonitorCount} (Covered: ${nCoveredPriorityRadius})`);
  console.log(` - Circular Radius Monitor Zone             : ${radiusMonitorCount}`);
  console.log(` - Circular Radius Safe Zone                : ${radiusSafeCount}`);
  console.log(` - ShakeMap MMI >= VI (Candidate Report)    : ${mmiCandidateAutoReportCount}`);
  console.log(` - ShakeMap MMI < VI (Notification Only)    : ${mmiNotificationOnlyCount}`);
  console.log(` - ShakeMap Out of Bounds (UNKNOWN)         : ${mmiUnknownCount}`);
  console.log("================================================================================\n");

  // Write CSV
  const csvHeaders = [
    "Location Code",
    "Location Name",
    "Branch",
    "Latitude",
    "Longitude",
    "Earthquake ID",
    "Earthquake Title",
    "Magnitude",
    "Depth (km)",
    "Distance to Epicenter (km)",
    "Priority Radius (km)",
    "Monitoring Radius (km)",
    "Radius Zone",
    "ShakeMap MMI Raw",
    "ShakeMap MMI Rounded",
    "MMI Roman",
    "MMI Policy Decision",
    "Discrepancy Classification",
    "Notes",
  ];

  const csvRows = [csvHeaders.join(",")];
  for (const r of comparisonRows) {
    csvRows.push(
      [
        escapeCsvField(r.locationCode),
        escapeCsvField(r.locationName),
        escapeCsvField(r.branch),
        r.locationLat.toFixed(5),
        r.locationLon.toFixed(5),
        escapeCsvField(r.earthquakeId),
        escapeCsvField(r.earthquakeTitle),
        r.magnitude.toFixed(1),
        r.depthKm.toFixed(1),
        r.distanceKm.toFixed(1),
        r.priorityRadiusKm,
        r.monitoringRadiusKm,
        escapeCsvField(r.radiusZone),
        r.mmi != null ? r.mmi.toFixed(4) : "N/A",
        r.mmiRounded != null ? r.mmiRounded.toFixed(2) : "N/A",
        escapeCsvField(r.mmiRoman),
        escapeCsvField(r.mmiDecision),
        escapeCsvField(r.discrepancyType),
        escapeCsvField(r.notes),
      ].join(",")
    );
  }

  const csvContent = csvRows.join("\n");
  const rootCsvPath = path.resolve(process.cwd(), "radius_vs_mmi_comparison.csv");
  const dataCsvPath = path.resolve(process.cwd(), "data/poc/radius_vs_mmi_comparison.csv");

  await fs.writeFile(rootCsvPath, csvContent, "utf8");
  await fs.writeFile(dataCsvPath, csvContent, "utf8");
  console.log(`CSV Report generated:`);
  console.log(`  - ${rootCsvPath}`);
  console.log(`  - ${dataCsvPath}`);

  // Print sample representative comparison cases
  console.log("\n================================================================================");
  console.log(" SAMPLE REPRESENTATIVE COMPARISON CASES (FIRST 10 CASES)");
  console.log("================================================================================");
  const sampleCases = comparisonRows.filter((r) => r.distanceKm < 150).slice(0, 10);
  for (const c of sampleCases) {
    console.log(`Location : ${c.locationCode} - ${c.locationName} (${c.branch})`);
    console.log(`Event    : ${c.earthquakeTitle} | Dist: ${c.distanceKm} km`);
    console.log(`Radius   : ${c.radiusZone} (Priority: ${c.priorityRadiusKm}km, Mon: ${c.monitoringRadiusKm}km)`);
    console.log(`ShakeMap : MMI Raw: ${c.mmi != null ? c.mmi.toFixed(4) : 'N/A'}, Rounded: ${c.mmiRounded != null ? c.mmiRounded.toFixed(2) : 'N/A'} (${c.mmiRoman}) -> ${c.mmiDecision}`);
    console.log(`Verdict  : ${c.discrepancyType} - ${c.notes}`);
    console.log("--------------------------------------------------------------------------------");
  }
}

runBenchmark().catch((err) => {
  console.error("Benchmark error:", err);
  process.exit(1);
});
