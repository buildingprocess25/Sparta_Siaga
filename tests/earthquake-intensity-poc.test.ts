/**
 * SPARTA SIAGA - Earthquake Intensity POC Test Suite
 * 
 * Tests the ShakeMap MMI reader, BMKG intensity parser,
 * policy decision simulation, schema validation, edge cases,
 * and comparison engine against SPARTA SIAGA's legacy circular radius algorithm.
 * 
 * Safety: Read-only, no database modifications.
 * Rule: Zero em dashes.
 */

import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs/promises";

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
  isValidGridValue,
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
        axisNames: ["y", "x"],
        shape: [3, 3],
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
        axisNames: ["y", "x"],
        shape: [3, 3],
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
        axisNames: ["y", "x"],
        shape: [3, 3],
      };

      assert.equal(interpolateMmiFromGrid(mockGrid, NaN, 101.0), null);
      assert.equal(interpolateMmiFromGrid(mockGrid, -1.0, NaN), null);
      assert.equal(interpolateMmiFromGrid(mockGrid, Infinity, 101.0), null);
      assert.equal(interpolateMmiFromGrid(mockGrid, -1.0, -Infinity), null);
      assert.equal(interpolateMmiFromGrid(mockGrid, 95.0, 101.0), null); // Lat > 90
      assert.equal(interpolateMmiFromGrid(mockGrid, -1.0, 200.0), null); // Lon > 180
    }),

    // --------------------------------------------------------------------------
    // 2. NoData / Null / NaN Grid Handling
    // --------------------------------------------------------------------------
    test("NoData Handling", "isValidGridValue accepts valid physical MMI and rejects sentinels", () => {
      assert.equal(isValidGridValue(1.0), true);
      assert.equal(isValidGridValue(6.5), true);
      assert.equal(isValidGridValue(12.0), true);

      assert.equal(isValidGridValue(null), false);
      assert.equal(isValidGridValue(undefined), false);
      assert.equal(isValidGridValue(NaN), false);
      assert.equal(isValidGridValue(Infinity), false);
      assert.equal(isValidGridValue(-999), false);
      assert.equal(isValidGridValue(0), false);
      assert.equal(isValidGridValue(0.2), false); // Below 0.5 threshold
      assert.equal(isValidGridValue(15), false); // Above 12 threshold
    }),

    test("NoData Handling", "Cells surrounded by NoData return null instead of 0", () => {
      const noDataGrid: ShakeMapGrid = {
        eventId: "test-nodata-01",
        name: "NoData Mask Grid",
        xMin: 100.0,
        xMax: 101.0,
        numX: 2,
        yMin: -1.0,
        yMax: 0.0,
        numY: 2,
        values: [
          NaN, null as any,
          -999, undefined as any,
        ],
        maxMmi: 0,
        axisNames: ["y", "x"],
        shape: [2, 2],
      };

      // When all 4 corner cells are invalid, interpolation must return null, never 0
      const res = interpolateMmiFromGrid(noDataGrid, -0.5, 100.5);
      assert.equal(res, null);
    }),

    test("NoData Handling", "Partial valid cells use weighted average of valid nodes", () => {
      const partialGrid: ShakeMapGrid = {
        eventId: "test-partial-01",
        name: "Partial Grid",
        xMin: 100.0,
        xMax: 101.0,
        numX: 2,
        yMin: -1.0,
        yMax: 0.0,
        numY: 2,
        values: [
          6.0, NaN,
          NaN, NaN,
        ],
        maxMmi: 6.0,
        axisNames: ["y", "x"],
        shape: [2, 2],
      };

      // Only node (0,0) at (-1.0, 100.0) is valid with value 6.0
      const res = interpolateMmiFromGrid(partialGrid, -0.8, 100.2);
      assert.ok(res !== null);
      assert.equal(res, 6.0);
    }),

    // --------------------------------------------------------------------------
    // 3. ShakeMap CovJSON Parser Schema Validation
    // --------------------------------------------------------------------------
    test("CovJSON Parser", "Valid CovJSON parses correctly into ShakeMapGrid", () => {
      const validCovJson = {
        type: "Coverage",
        domain: {
          type: "Domain",
          domainType: "Grid",
          axes: {
            x: { start: 100.0, stop: 102.0, num: 3 },
            y: { start: -2.0, stop: 0.0, num: 2 },
          },
        },
        ranges: {
          MMI: {
            type: "NdArray",
            dataType: "float",
            axisNames: ["y", "x"],
            shape: [2, 3],
            values: [2.0, 3.0, 4.0, 5.0, 6.0, 7.0],
          },
        },
      };

      const grid = parseShakeMapCovJson(validCovJson, { eventId: "test-valid", name: "Valid Grid" });
      assert.equal(grid.eventId, "test-valid");
      assert.equal(grid.numX, 3);
      assert.equal(grid.numY, 2);
      assert.equal(grid.values.length, 6);
      assert.equal(grid.maxMmi, 7.0);
      assert.deepEqual(grid.axisNames, ["y", "x"]);
      assert.deepEqual(grid.shape, [2, 3]);
    }),

    test("CovJSON Parser", "Rejects missing domain or ranges", () => {
      assert.throws(() => parseShakeMapCovJson(null), /Input must be a valid JSON object/);
      assert.throws(() => parseShakeMapCovJson({}), /Missing or invalid domain object/);
      assert.throws(() => parseShakeMapCovJson({ domain: {} }), /Missing or invalid ranges object/);
    }),

    test("CovJSON Parser", "Rejects malformed axes and out of bound coordinates", () => {
      // Missing x axis
      assert.throws(() => {
        parseShakeMapCovJson({
          domain: { axes: { y: { start: -1, stop: 0, num: 2 } } },
          ranges: { MMI: { values: [1, 2] } },
        });
      }, /Missing x \(longitude\) or y \(latitude\) axis/);

      // Malformed x axis (start >= stop)
      assert.throws(() => {
        parseShakeMapCovJson({
          domain: {
            axes: {
              x: { start: 105, stop: 100, num: 5 },
              y: { start: -5, stop: -2, num: 3 },
            },
          },
          ranges: { MMI: { values: [] } },
        });
      }, /Malformed x axis/);

      // Geographic coordinates out of world bounds (lat > 90)
      assert.throws(() => {
        parseShakeMapCovJson({
          domain: {
            axes: {
              x: { start: 100, stop: 105, num: 5 },
              y: { start: 85, stop: 95, num: 3 },
            },
          },
          ranges: { MMI: { values: [] } },
        });
      }, /Axis coordinates out of valid geographic range/);
    }),

    test("CovJSON Parser", "Rejects invalid or missing axisNames", () => {
      const base = {
        domain: {
          axes: {
            x: { start: 100, stop: 102, num: 2 },
            y: { start: -2, stop: -1, num: 2 },
          },
        },
        ranges: {
          MMI: {
            shape: [2, 2],
            values: [1, 2, 3, 4],
          },
        },
      };

      // Missing axisNames
      assert.throws(() => parseShakeMapCovJson(base), /axisNames must be a 2-element array/);

      // Invalid axisNames (non-spatial)
      assert.throws(() => {
        parseShakeMapCovJson({
          ...base,
          ranges: {
            MMI: {
              ...base.ranges.MMI,
              axisNames: ["time", "depth"],
            },
          },
        });
      }, /axisNames must contain spatial coordinates/);
    }),

    test("CovJSON Parser", "Rejects shape mismatches with grid dimensions and values length", () => {
      const base = {
        domain: {
          axes: {
            x: { start: 100, stop: 102, num: 3 },
            y: { start: -2, stop: 0, num: 2 },
          },
        },
        ranges: {
          MMI: {
            axisNames: ["y", "x"],
            shape: [2, 3],
            values: [1, 2, 3, 4, 5, 6], // 2 x 3 = 6
          },
        },
      };

      // Values length mismatch (expected 6, got 5)
      assert.throws(() => {
        parseShakeMapCovJson({
          ...base,
          ranges: {
            MMI: {
              ...base.ranges.MMI,
              values: [1, 2, 3, 4, 5],
            },
          },
        });
      }, /Grid length mismatch/);

      // Shape dimensions product mismatch (shape [2, 2] = 4, but expected 6)
      assert.throws(() => {
        parseShakeMapCovJson({
          ...base,
          ranges: {
            MMI: {
              ...base.ranges.MMI,
              shape: [2, 2],
            },
          },
        });
      }, /shape dimensions \[2, 2\] \(4\) do not match grid length \(6\)/);

      // Shape order mismatch (expected [2, 3] for ["y", "x"], got [3, 2])
      assert.throws(() => {
        parseShakeMapCovJson({
          ...base,
          ranges: {
            MMI: {
              ...base.ranges.MMI,
              shape: [3, 2],
            },
          },
        });
      }, /shape \[3, 2\] does not match axis dimensions \[2, 3\]/);
    }),

    // --------------------------------------------------------------------------
    // 4. Roman Numeral & BMKG Intensity Parser
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
      assert.equal(numberToRoman(null), "-");
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
    // 5. Policy Decision Simulation & Full Precision
    // --------------------------------------------------------------------------
    test("Policy Decision", "Maintains full precision float for MMI >= 6.0 decision threshold", () => {
      // 5.9999 is strictly below 6.0 -> NOTIFICATION_ONLY even if rounded display is 6.00
      const res599 = evaluateIntensityDecision(5.9999);
      assert.equal(res599.decision, "NOTIFICATION_ONLY");
      assert.equal(res599.mmi, 5.9999);
      assert.equal(res599.mmiRounded, 6.00);

      // Exact 6.0000 -> CANDIDATE_AUTO_REPORT
      const res600 = evaluateIntensityDecision(6.0000);
      assert.equal(res600.decision, "CANDIDATE_AUTO_REPORT");
      assert.equal(res600.mmi, 6.0000);
      assert.equal(res600.mmiRounded, 6.00);

      // 6.0001 -> CANDIDATE_AUTO_REPORT
      const res601 = evaluateIntensityDecision(6.0001);
      assert.equal(res601.decision, "CANDIDATE_AUTO_REPORT");
      assert.equal(res601.mmi, 6.0001);
      assert.equal(res601.mmiRounded, 6.00);

      // General levels
      assert.equal(evaluateIntensityDecision(2.1).decision, "NOTIFICATION_ONLY");
      assert.equal(evaluateIntensityDecision(4.5).decision, "NOTIFICATION_ONLY");
      assert.equal(evaluateIntensityDecision(7.5).decision, "CANDIDATE_AUTO_REPORT");

      // Unavailable / out of bounds -> UNKNOWN
      const resNull = evaluateIntensityDecision(null);
      assert.equal(resNull.decision, "UNKNOWN");
      assert.equal(resNull.mmi, null);
      assert.equal(resNull.mmiRounded, null);
    }),

    // --------------------------------------------------------------------------
    // 6. Historical Events Replay & Authentic USGS Datasets
    // --------------------------------------------------------------------------
    test("Historical Event", "Cianjur 2022 ShakeMap accurately identifies damage vs notification zones", async () => {
      const dir = path.resolve(process.cwd(), "data/poc/shakemaps/us7000ir9t");
      const dataset = await loadShakeMapFromDirectory("us7000ir9t", dir);
      assert.ok(dataset !== null, "Cianjur ShakeMap dataset must load");
      assert.ok(dataset.grid !== null, "Grid must exist");

      // Verify authentic USGS grid schema
      assert.equal(dataset.grid.numX, 109);
      assert.equal(dataset.grid.numY, 109);
      assert.deepEqual(dataset.grid.axisNames, ["y", "x"]);
      assert.deepEqual(dataset.grid.shape, [109, 109]);

      // Epicenter (-6.853, 107.095): Destructive shaking MMI >= 7.5
      const epicMmi = interpolateMmiFromGrid(dataset.grid, -6.853, 107.095);
      assert.ok(epicMmi !== null);
      assert.ok(epicMmi >= 7.5, `Epicenter MMI expected >= 7.5, got ${epicMmi}`);
      assert.equal(evaluateIntensityDecision(epicMmi).decision, "CANDIDATE_AUTO_REPORT");

      // Cianjur Central Town (-6.82, 107.14): Heavy shaking MMI ~ 7.4 >= VI
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
    }),

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

    test("Historical Event", "Malang 2021 deep quake correctly avoids false alarm (MMI < VI everywhere)", async () => {
      const dir = path.resolve(process.cwd(), "data/poc/shakemaps/us6000e0iy");
      const dataset = await loadShakeMapFromDirectory("us6000e0iy", dir);
      assert.ok(dataset !== null);
      assert.ok(dataset.grid !== null);

      // Maximum MMI anywhere in this event is 5.36 (V)
      assert.ok(dataset.grid.maxMmi < 6.0, `Max MMI must be < 6.0, got ${dataset.grid.maxMmi}`);

      // Southern coast of East Java (-8.50, 112.50)
      const southCoastMmi = interpolateMmiFromGrid(dataset.grid, -8.50, 112.50);
      assert.ok(southCoastMmi !== null);
      assert.ok(southCoastMmi < 6.0, `South Coast MMI expected < 6.0, got ${southCoastMmi}`);
      assert.equal(evaluateIntensityDecision(southCoastMmi).decision, "NOTIFICATION_ONLY");
    }),

    test("Historical Event", "All 5 historical events load authentic USGS ShakeMaps without errors", async () => {
      const events = ["us7000ir9t", "us1000h3p4", "us1000g3ub", "us6000e0iy", "us6000gzyg"];
      for (const ev of events) {
        const dir = path.resolve(process.cwd(), `data/poc/shakemaps/${ev}`);
        const dataset = await loadShakeMapFromDirectory(ev, dir);
        assert.ok(dataset !== null, `Event ${ev} must load`);
        assert.ok(dataset.grid !== null, `Event ${ev} grid must exist`);
        assert.ok(dataset.grid.values.length > 0, `Event ${ev} must have grid values`);
        assert.ok(dataset.grid.maxMmi > 0, `Event ${ev} maxMmi must be positive`);
      }
    }),

    // --------------------------------------------------------------------------
    // 7. Comparison Engine & Out of Coverage Rules
    // --------------------------------------------------------------------------
    test("Comparison Engine", "Out of coverage coordinate strictly evaluates to UNKNOWN and OUT_OF_SHAKEMAP_COVERAGE", () => {
      const res = compareRadiusVsMmi({
        locationCode: "MED01",
        locationName: "DC Medan",
        earthquakeId: "us7000ir9t", // Cianjur quake
        lat: 3.59,
        lon: 98.67, // Medan is far outside West Java ShakeMap
        eqLat: -6.853,
        eqLon: 107.095,
        eqMag: 5.6,
        eqDepthKm: 10,
        mmi: null, // Out of coverage
      });

      assert.equal(res.radiusZone, "SAFE");
      assert.equal(res.mmi, null);
      assert.equal(res.mmiRounded, null);
      assert.equal(res.mmiDecision, "UNKNOWN");
      // Must strictly be OUT_OF_SHAKEMAP_COVERAGE, never CONCORDANT_LOW_RISK
      assert.equal(res.discrepancyType, "OUT_OF_SHAKEMAP_COVERAGE");
      assert.ok(res.notes.includes("UNKNOWN"));
    }),

    test("Comparison Engine", "Evaluates facility comparison with updated discrepancy classifications", () => {
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
      // Discrepancy: RADIUS_OVERPREDICTION_VS_MMI (Radius creates overprediction vs ShakeMap MMI)
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
      assert.equal(resB.discrepancyType, "RADIUS_OVERPREDICTION_VS_MMI");

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

      // Case D: Synthetic case of soil amplification outside priority radius (distance = 45km > 35km MONITOR, but MMI = 6.2 >= VI)
      // Discrepancy: RADIUS_UNDERPREDICTION_VS_MMI
      const resD = compareRadiusVsMmi({
        locationCode: "AMP01",
        locationName: "Toko Amplifikasi Sesar",
        earthquakeId: "us7000ir9t",
        lat: -6.65,
        lon: 107.45,
        eqLat: -6.853,
        eqLon: 107.095,
        eqMag: 5.6,
        eqDepthKm: 10,
        mmi: 6.20,
      });
      assert.equal(resD.radiusZone, "MONITOR");
      assert.equal(resD.mmiDecision, "CANDIDATE_AUTO_REPORT");
      assert.equal(resD.discrepancyType, "RADIUS_UNDERPREDICTION_VS_MMI");
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
        // Coords in West Java (-7.5 to -6.2, 106.2 to 108.2)
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
