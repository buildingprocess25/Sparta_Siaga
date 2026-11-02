/**
 * SPARTA SIAGA - Earthquake Intensity POC Test Suite
 * 
 * Tests the ShakeMap MMI reader, BMKG intensity parser,
 * policy decision simulation, and comparison engine against
 * SPARTA SIAGA's existing circular radius algorithm.
 * 
 * Safety: Read-only, no database modifications.
 */

import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";

import {
  parseShakeMapCovJson,
  interpolateMmiFromGrid,
  parseBmkgDirasakan,
  romanToNumber,
  numberToRoman,
  evaluateIntensityDecision,
  loadShakeMapFromDirectory,
  compareRadiusVsMmi,
  evaluateFacilityAgainstEvent,
  ShakeMapGrid,
  PolicyDecision,
} from "../lib/poc/earthquake-intensity-service";

interface TestReportItem {
  name: string;
  category: string;
  status: "PASS" | "FAIL";
  detail: string;
}

const testResults: TestReportItem[] = [];

function test(category: string, name: string, fn: () => void | Promise<void>) {
  return async () => {
    try {
      await fn();
      testResults.push({ name, category, status: "PASS", detail: "OK" });
      console.log(`[PASS] [${category}] ${name}`);
    } catch (err: any) {
      testResults.push({
        name,
        category,
        status: "FAIL",
        detail: err.message || String(err),
      });
      console.error(`[FAIL] [${category}] ${name}: ${err.message}`);
      throw err;
    }
  };
}

async function runAllTests() {
  console.log("================================================================================");
  console.log(" SPARTA SIAGA: EARTHQUAKE INTENSITY POC UNIT & HISTORICAL TEST SUITE");
  console.log("================================================================================\n");

  const suites = [
    // --------------------------------------------------------------------------
    // 1. Bilinear Grid Interpolation & Math
    // --------------------------------------------------------------------------
    test("Interpolation", "Grid interpolation returns exact value at grid nodes", () => {
      const mockGrid: ShakeMapGrid = {
        eventId: "test-grid-01",
        name: "Synthetic Grid",
        xMin: 100.0,
        xMax: 102.0,
        numX: 3, // columns: 100.0, 101.0, 102.0 (dx = 1.0)
        yMin: -2.0,
        yMax: 0.0,
        numY: 3, // rows: -2.0, -1.0, 0.0 (dy = 1.0)
        values: [
          // row 0 (y = -2.0): x=100.0, 101.0, 102.0
          2.0, 3.0, 4.0,
          // row 1 (y = -1.0): x=100.0, 101.0, 102.0
          4.0, 6.0, 8.0,
          // row 2 (y = 0.0): x=100.0, 101.0, 102.0
          6.0, 7.0, 8.0,
        ],
        maxMmi: 8.0,
      };

      // Exact corner and center nodes
      assert.equal(interpolateMmiFromGrid(mockGrid, -2.0, 100.0), 2.0);
      assert.equal(interpolateMmiFromGrid(mockGrid, -1.0, 101.0), 6.0);
      assert.equal(interpolateMmiFromGrid(mockGrid, 0.0, 102.0), 8.0);

      // Midpoint between (0,0)->2.0, (0,1)->3.0, (1,0)->4.0, (1,1)->6.0 at (-1.5, 100.5)
      // u = 0.5, v = 0.5 -> average = (2 + 3 + 4 + 6) / 4 = 3.75
      const midVal = interpolateMmiFromGrid(mockGrid, -1.5, 100.5);
      assert.ok(midVal !== null);
      assert.ok(Math.abs(midVal - 3.75) < 1e-4, `Expected 3.75, got ${midVal}`);
    }),

    test("Interpolation", "Out of bounds coordinates return null", () => {
      const mockGrid: ShakeMapGrid = {
        eventId: "test-grid-02",
        name: "Synthetic Grid",
        xMin: 100.0,
        xMax: 102.0,
        numX: 3,
        yMin: -2.0,
        yMax: 0.0,
        numY: 3,
        values: [1, 2, 3, 4, 5, 6, 7, 8, 9],
        maxMmi: 9.0,
      };

      assert.equal(interpolateMmiFromGrid(mockGrid, 10.0, 101.0), null); // Far North
      assert.equal(interpolateMmiFromGrid(mockGrid, -10.0, 101.0), null); // Far South
      assert.equal(interpolateMmiFromGrid(mockGrid, -1.0, 95.0), null); // Far West
      assert.equal(interpolateMmiFromGrid(mockGrid, -1.0, 110.0), null); // Far East
    }),

    test("Interpolation", "Invalid coordinate values (NaN, null, Infinity) safely return null", () => {
      const mockGrid: ShakeMapGrid = {
        eventId: "test-grid-03",
        name: "Synthetic Grid",
        xMin: 100.0,
        xMax: 102.0,
        numX: 3,
        yMin: -2.0,
        yMax: 0.0,
        numY: 3,
        values: [1, 2, 3, 4, 5, 6, 7, 8, 9],
        maxMmi: 9.0,
      };

      assert.equal(interpolateMmiFromGrid(mockGrid, NaN, 101.0), null);
      assert.equal(interpolateMmiFromGrid(mockGrid, -1.0, NaN), null);
      assert.equal(interpolateMmiFromGrid(mockGrid, Infinity, 101.0), null);
      assert.equal(interpolateMmiFromGrid(mockGrid, -1.0, -Infinity), null);
      assert.equal(interpolateMmiFromGrid(mockGrid, 95.0, 101.0), null); // Lat > 90
      assert.equal(interpolateMmiFromGrid(mockGrid, -1.0, 200.0), null); // Lon > 180
    }),

    // --------------------------------------------------------------------------
    // 2. Roman Numeral & BMKG Intensity Parser
    // --------------------------------------------------------------------------
    test("BMKG Parser", "Converts Roman numerals to numbers and numbers to Roman", () => {
      assert.equal(romanToNumber("I"), 1);
      assert.equal(romanToNumber("II"), 2);
      assert.equal(romanToNumber("III"), 3);
      assert.equal(romanToNumber("IV"), 4);
      assert.equal(romanToNumber("V"), 5);
      assert.equal(romanToNumber("VI"), 6);
      assert.equal(romanToNumber("VII"), 7);
      assert.equal(romanToNumber("VIII"), 8);
      assert.equal(romanToNumber("IX"), 9);
      assert.equal(romanToNumber("X"), 10);
      assert.equal(romanToNumber("XI"), 11);
      assert.equal(romanToNumber("XII"), 12);

      assert.equal(numberToRoman(1.2), "I");
      assert.equal(numberToRoman(3.8), "IV");
      assert.equal(numberToRoman(6.4), "VI");
      assert.equal(numberToRoman(7.9), "VIII");
    }),

    test("BMKG Parser", "Parses official BMKG Dirasakan string into structured reports", () => {
      const rawBmkg = "V-VI Cianjur, IV-V Garut, IV Sukabumi, III Cimahi, III Lembang, III Kota Bandung, II-III Jakarta";
      const reports = parseBmkgDirasakan(rawBmkg);

      assert.equal(reports.length, 7);

      assert.equal(reports[0].city, "Cianjur");
      assert.equal(reports[0].rawIntensity, "V-VI");
      assert.equal(reports[0].mmiMin, 5.0);
      assert.equal(reports[0].mmiMax, 6.0);
      assert.equal(reports[0].mmiAvg, 5.5);

      assert.equal(reports[2].city, "Sukabumi");
      assert.equal(reports[2].mmiAvg, 4.0);

      assert.equal(reports[6].city, "Jakarta");
      assert.equal(reports[6].mmiAvg, 2.5);
    }),

    // --------------------------------------------------------------------------
    // 3. Policy Decision Simulation (Threshold VI)
    // --------------------------------------------------------------------------
    test("Policy Decision", "Simulates MMI decision policy with threshold VI", () => {
      // Below VI (< 6.0) -> NOTIFICATION_ONLY
      assert.equal(evaluateIntensityDecision(2.1).decision, "NOTIFICATION_ONLY");
      assert.equal(evaluateIntensityDecision(4.5).decision, "NOTIFICATION_ONLY");
      assert.equal(evaluateIntensityDecision(5.99).decision, "NOTIFICATION_ONLY");

      // VI or above (>= 6.0) -> CANDIDATE_AUTO_REPORT
      assert.equal(evaluateIntensityDecision(6.0).decision, "CANDIDATE_AUTO_REPORT");
      assert.equal(evaluateIntensityDecision(6.5).decision, "CANDIDATE_AUTO_REPORT");
      assert.equal(evaluateIntensityDecision(8.4).decision, "CANDIDATE_AUTO_REPORT");

      // Unavailable / out of bounds -> UNKNOWN
      assert.equal(evaluateIntensityDecision(null).decision, "UNKNOWN");
      assert.equal(evaluateIntensityDecision(undefined as any).decision, "UNKNOWN");
    }),

    // --------------------------------------------------------------------------
    // 4. Historical Event: Cianjur 2022 (us7000ir9t)
    // --------------------------------------------------------------------------
    test("Historical Event", "Cianjur 2022 ShakeMap accurately identifies damage vs notification zones", async () => {
      const dir = path.resolve(process.cwd(), "data/poc/shakemaps/us7000ir9t");
      const dataset = await loadShakeMapFromDirectory("us7000ir9t", dir);
      assert.ok(dataset !== null, "Cianjur ShakeMap dataset must load");
      assert.ok(dataset.grid !== null, "Grid must exist");

      // Epicenter (-6.853, 107.095): Destructive shaking MMI >= 7.5
      const epicMmi = interpolateMmiFromGrid(dataset.grid, -6.853, 107.095);
      assert.ok(epicMmi !== null);
      assert.ok(epicMmi >= 7.5, `Epicenter MMI expected >= 7.5, got ${epicMmi}`);
      assert.equal(evaluateIntensityDecision(epicMmi).decision, "CANDIDATE_AUTO_REPORT");

      // Cianjur Central Town (-6.82, 107.14): Heavy shaking MMI ~ 7.3 >= VI
      const cianjurTownMmi = interpolateMmiFromGrid(dataset.grid, -6.82, 107.14);
      assert.ok(cianjurTownMmi !== null);
      assert.ok(cianjurTownMmi >= 6.5, `Cianjur Town MMI expected >= 6.5, got ${cianjurTownMmi}`);
      assert.equal(evaluateIntensityDecision(cianjurTownMmi).decision, "CANDIDATE_AUTO_REPORT");

      // Sukabumi City (-6.92, 106.93): Distance ~ 22 km, MMI ~ 5.1 < VI
      const sukabumiMmi = interpolateMmiFromGrid(dataset.grid, -6.92, 106.93);
      assert.ok(sukabumiMmi !== null);
      assert.ok(sukabumiMmi < 6.0, `Sukabumi MMI expected < 6.0, got ${sukabumiMmi}`);
      assert.equal(evaluateIntensityDecision(sukabumiMmi).decision, "NOTIFICATION_ONLY");

      // Bandung City (-6.91, 107.61): Distance ~ 58 km, MMI ~ 3.6 < VI
      const bandungMmi = interpolateMmiFromGrid(dataset.grid, -6.91, 107.61);
      assert.ok(bandungMmi !== null);
      assert.ok(bandungMmi < 4.5, `Bandung MMI expected < 4.5, got ${bandungMmi}`);
      assert.equal(evaluateIntensityDecision(bandungMmi).decision, "NOTIFICATION_ONLY");

      // Jakarta Pusat (-6.20, 106.85): Distance ~ 75 km, MMI ~ 3.4 < VI
      const jakartaMmi = interpolateMmiFromGrid(dataset.grid, -6.20, 106.85);
      assert.ok(jakartaMmi !== null);
      assert.ok(jakartaMmi < 4.0, `Jakarta MMI expected < 4.0, got ${jakartaMmi}`);
      assert.equal(evaluateIntensityDecision(jakartaMmi).decision, "NOTIFICATION_ONLY");
    }),

    // --------------------------------------------------------------------------
    // 5. Historical Event: Palu 2018 (us1000h3p4)
    // --------------------------------------------------------------------------
    test("Historical Event", "Palu 2018 ShakeMap identifies Palu and Donggala rupture zone", async () => {
      const dir = path.resolve(process.cwd(), "data/poc/shakemaps/us1000h3p4");
      const dataset = await loadShakeMapFromDirectory("us1000h3p4", dir);
      assert.ok(dataset !== null);
      assert.ok(dataset.grid !== null);

      // Palu City (-0.89, 119.87): MMI >= 7.0 -> CANDIDATE_AUTO_REPORT
      const paluMmi = interpolateMmiFromGrid(dataset.grid, -0.89, 119.87);
      assert.ok(paluMmi !== null);
      assert.ok(paluMmi >= 6.5, `Palu MMI expected >= 6.5, got ${paluMmi}`);
      assert.equal(evaluateIntensityDecision(paluMmi).decision, "CANDIDATE_AUTO_REPORT");

      // Donggala (-0.68, 119.74): MMI >= 7.0 -> CANDIDATE_AUTO_REPORT
      const donggalaMmi = interpolateMmiFromGrid(dataset.grid, -0.68, 119.74);
      assert.ok(donggalaMmi !== null);
      assert.ok(donggalaMmi >= 6.5, `Donggala MMI expected >= 6.5, got ${donggalaMmi}`);
      assert.equal(evaluateIntensityDecision(donggalaMmi).decision, "CANDIDATE_AUTO_REPORT");
    }),

    // --------------------------------------------------------------------------
    // 6. Historical Event: Malang 2021 (us6000e0iy) - Deep Quake False Positive Proof
    // --------------------------------------------------------------------------
    test("Historical Event", "Malang 2021 deep quake correctly avoids false alarm (MMI < VI everywhere)", async () => {
      const dir = path.resolve(process.cwd(), "data/poc/shakemaps/us6000e0iy");
      const dataset = await loadShakeMapFromDirectory("us6000e0iy", dir);
      assert.ok(dataset !== null);
      assert.ok(dataset.grid !== null);

      // Maximum MMI anywhere in this event is 5.36 (V)
      assert.ok(dataset.grid.maxMmi < 6.0, `Max MMI must be < 6.0, got ${dataset.grid.maxMmi}`);

      // Test point closest to epicenter on southern coast of East Java (-8.50, 112.50)
      const southCoastMmi = interpolateMmiFromGrid(dataset.grid, -8.50, 112.50);
      assert.ok(southCoastMmi !== null);
      assert.ok(southCoastMmi < 6.0, `South Coast MMI expected < 6.0, got ${southCoastMmi}`);
      assert.equal(evaluateIntensityDecision(southCoastMmi).decision, "NOTIFICATION_ONLY");

      // Malang City (-7.98, 112.63)
      const malangCityMmi = interpolateMmiFromGrid(dataset.grid, -7.98, 112.63);
      assert.ok(malangCityMmi !== null);
      assert.ok(malangCityMmi < 6.0);
      assert.equal(evaluateIntensityDecision(malangCityMmi).decision, "NOTIFICATION_ONLY");
    }),

    // --------------------------------------------------------------------------
    // 7. Comparison Engine: Radius vs ShakeMap Intensity
    // --------------------------------------------------------------------------
    test("Comparison Engine", "Evaluates facility comparison with delta classification", () => {
      // Event: Cianjur (M 5.6, depth 10 km, epicenter: -6.853, 107.095)
      // Radius model: priorityRadiusKm = 35 km, monitoringRadiusKm = 77 km

      // Case A: Cianjur Town (-6.82, 107.14) -> distance ~ 6 km <= 35 km (PRIORITY_MONITOR) and MMI ~ 7.4 >= VI (CANDIDATE_AUTO_REPORT)
      // Discrepancy: CONCORDANT_HIGH_RISK
      const resA = compareRadiusVsMmi({
        locationCode: "CJR01",
        locationName: "Toko Cianjur Raya",
        earthquakeId: "us7000ir9t",
        lat: -6.82,
        lon: 107.14,
        eqLat: -6.853,
        eqLon: 107.095,
        eqMag: 5.6,
        eqDepthKm: 10,
        mmi: 7.39,
      });
      assert.equal(resA.radiusZone, "PRIORITY_MONITOR");
      assert.equal(resA.mmiDecision, "CANDIDATE_AUTO_REPORT");
      assert.equal(resA.discrepancyType, "CONCORDANT_HIGH_RISK");

      // Case B: Sukabumi City (-6.92, 106.93) -> distance ~ 20 km <= 35 km (PRIORITY_MONITOR) BUT MMI 5.07 < VI (NOTIFICATION_ONLY)
      // Discrepancy: FALSE_POSITIVE_RADIUS (Radius creates false alarm auto-report!)
      const resB = compareRadiusVsMmi({
        locationCode: "SKB01",
        locationName: "Toko Sukabumi Sudirman",
        earthquakeId: "us7000ir9t",
        lat: -6.92,
        lon: 106.93,
        eqLat: -6.853,
        eqLon: 107.095,
        eqMag: 5.6,
        eqDepthKm: 10,
        mmi: 5.07,
      });
      assert.equal(resB.radiusZone, "PRIORITY_MONITOR");
      assert.equal(resB.mmiDecision, "NOTIFICATION_ONLY");
      assert.equal(resB.discrepancyType, "FALSE_POSITIVE_RADIUS");

      // Case C: Bandung City (-6.91, 107.61) -> distance ~ 58 km <= 77 km (MONITOR) and MMI 3.63 < VI (NOTIFICATION_ONLY)
      // Discrepancy: CONCORDANT_LOW_RISK
      const resC = compareRadiusVsMmi({
        locationCode: "BDG01",
        locationName: "DC Bandung",
        earthquakeId: "us7000ir9t",
        lat: -6.91,
        lon: 107.61,
        eqLat: -6.853,
        eqLon: 107.095,
        eqMag: 5.6,
        eqDepthKm: 10,
        mmi: 3.63,
      });
      assert.equal(resC.radiusZone, "MONITOR");
      assert.equal(resC.mmiDecision, "NOTIFICATION_ONLY");
      assert.equal(resC.discrepancyType, "CONCORDANT_LOW_RISK");
    }),

    // --------------------------------------------------------------------------
    // 8. Benchmark & Throughput Check
    // --------------------------------------------------------------------------
    test("Benchmark", "Evaluates grid interpolation speed across 1,000 coordinates", async () => {
      const dir = path.resolve(process.cwd(), "data/poc/shakemaps/us7000ir9t");
      const dataset = await loadShakeMapFromDirectory("us7000ir9t", dir);
      assert.ok(dataset?.grid);

      const t0 = performance.now();
      const n = 1000;
      let count = 0;
      for (let i = 0; i < n; i++) {
        // Random coords in West Java (-7.5 to -6.2, 106.2 to 108.2)
        const lat = -7.5 + (i / n) * 1.3;
        const lon = 106.2 + ((i * 3) % n / n) * 2.0;
        const val = interpolateMmiFromGrid(dataset.grid, lat, lon);
        if (val !== null) count++;
      }
      const t1 = performance.now();
      const durationMs = t1 - t0;
      const rate = Math.round((n / durationMs) * 1000);
      console.log(` Interpolated ${n} coords in ${durationMs.toFixed(2)} ms (${rate} lookups/sec). Valid: ${count}/${n}`);
      assert.ok(rate > 10000, `Expected throughput > 10,000 lookups/sec, achieved ${rate}`);
    }),
  ];

  for (const s of suites) {
    await s();
  }

  console.log("\n================================================================================");
  console.log(" SPARTA SIAGA: TEST SUITE EXECUTION SUMMARY");
  console.log("================================================================================");
  const total = testResults.length;
  const passed = testResults.filter((r) => r.status === "PASS").length;
  const failed = total - passed;
  console.log(`Total Tests : ${total}`);
  console.log(`Passed      : ${passed}`);
  console.log(`Failed      : ${failed}`);
  console.log(`Success Rate: ${((passed / total) * 100).toFixed(1)}%\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

runAllTests().catch((e) => {
  console.error("Fatal test execution error:", e);
  process.exit(1);
});
