/**
 * SPARTA SIAGA - GMPE Fallback POC Unit & Benchmark Test Suite
 * 
 * Verifies scientific correctness, attenuation curves, GMICE conversion,
 * scenario calculations, and historical validation against USGS ShakeMaps.
 * 
 * Rule: Zero em dashes. All punctuation uses standard hyphens (-) or colons (:).
 */

import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs/promises";
import {
  calculateBssa14Pga,
  calculateAb03IntraslabPga,
  calculateZhao06IntraslabPga,
  gmiceWorden2012PgaToMmi,
  mmiToRomanNumeral,
  evaluateGmpeGroundMotion,
  runGmpeDistanceBenchmark,
} from "../lib/gmpe-fallback-service";
import {
  parseShakeMapCovJson,
  interpolateMmiFromGrid,
} from "../lib/earthquake-intensity-service";

async function runTestSuite() {
  console.log("================================================================================");
  console.log(" SPARTA SIAGA: GMPE FALLBACK POC UNIT & BENCHMARK SUITE");
  console.log("================================================================================\n");

  let passed = 0;
  let failed = 0;

  async function test(name: string, fn: () => void | Promise<void>) {
    try {
      await fn();
      console.log(`[PASS] ${name}`);
      passed++;
    } catch (err: any) {
      console.error(`[FAIL] ${name}`);
      console.error(`       Error: ${err.message}`);
      failed++;
    }
  }

  // 1. GMICE Worden et al. (2012) Tests
  test("GMICE: Monotonic mapping and boundary continuity at log10(PGA) = 1.57", () => {
    const pgaBoundaryLow = Math.pow(10, 1.569);
    const pgaBoundaryHigh = Math.pow(10, 1.571);

    const mmiLow = gmiceWorden2012PgaToMmi(pgaBoundaryLow).mmi;
    const mmiHigh = gmiceWorden2012PgaToMmi(pgaBoundaryHigh).mmi;

    // Both should evaluate to approx 4.21 with continuity difference < 0.02
    assert.ok(Math.abs(mmiLow - mmiHigh) < 0.02, `Discontinuity detected: low=${mmiLow}, high=${mmiHigh}`);
    assert.ok(mmiLow >= 4.15 && mmiLow <= 4.25);
  });

  test("GMICE: Intensity threshold VI (6.0) corresponds to ~110-120 Gal (0.11-0.12 g)", () => {
    // 0.115 g = 112.78 Gal
    const res = gmiceWorden2012PgaToMmi(112.78);
    assert.ok(Math.abs(res.mmi - 6.0) < 0.05, `Expected MMI ~6.0, got ${res.mmi}`);
  });

  test("GMICE: Physical clamping between I (1.0) and X (10.0)", () => {
    const minMmi = gmiceWorden2012PgaToMmi(0.0001).mmi;
    const maxMmi = gmiceWorden2012PgaToMmi(50000).mmi;
    assert.equal(minMmi, 1.0);
    assert.equal(maxMmi, 10.0);
  });

  // 2. BSSA14 (Boore et al., 2014) Shallow Crustal Tests
  test("BSSA14: Ground motion attenuates monotonically with distance", () => {
    const distances = [0, 5, 10, 20, 50, 100];
    let prevPga = Infinity;
    for (const d of distances) {
      const res = calculateBssa14Pga({ magnitude: 5.5, rJbKm: d });
      assert.ok(res.pgaG < prevPga, `PGA at ${d} km (${res.pgaG}) must be less than previous (${prevPga})`);
      prevPga = res.pgaG;
    }
  });

  test("BSSA14: Higher magnitude produces higher ground motion at same distance", () => {
    const m4 = calculateBssa14Pga({ magnitude: 4.0, rJbKm: 10 }).pgaG;
    const m5 = calculateBssa14Pga({ magnitude: 5.0, rJbKm: 10 }).pgaG;
    const m6 = calculateBssa14Pga({ magnitude: 6.0, rJbKm: 10 }).pgaG;
    const m7 = calculateBssa14Pga({ magnitude: 7.0, rJbKm: 10 }).pgaG;

    assert.ok(m4 < m5, "M4 must be less than M5");
    assert.ok(m5 < m6, "M5 must be less than M6");
    assert.ok(m6 < m7, "M6 must be less than M7");
  });

  test("BSSA14: Site amplification increases PGA on softer soil (Vs30 = 270 vs 760 m/s)", () => {
    const rock = calculateBssa14Pga({ magnitude: 5.0, rJbKm: 10, vs30: 760 }).pgaG;
    const soil = calculateBssa14Pga({ magnitude: 5.0, rJbKm: 10, vs30: 270 }).pgaG;
    assert.ok(soil > rock, `Soil PGA (${soil}) should exceed Rock PGA (${rock})`);
  });

  // 3. Subduction Intraslab Tests (Zhao et al., 2006 & Atkinson & Boore, 2003)
  test("Intraslab: Attenuates monotonically with horizontal epicentral distance", () => {
    const distances = [0, 10, 25, 50, 100];
    let prevPga = Infinity;
    for (const d of distances) {
      const res = calculateZhao06IntraslabPga({ magnitude: 6.2, depthKm: 100, distanceEpiKm: d });
      assert.ok(res.pgaG < prevPga, `Intraslab PGA at ${d} km must be less than previous`);
      prevPga = res.pgaG;
    }
  });

  test("Intraslab: Model agreement between Zhao et al. (2006) and Atkinson & Boore (2003)", () => {
    const zhao = calculateZhao06IntraslabPga({ magnitude: 6.2, depthKm: 100, distanceEpiKm: 20 });
    const ab03 = calculateAb03IntraslabPga({ magnitude: 6.2, depthKm: 100, distanceEpiKm: 20 });

    // Both should predict MMI in range 4.0 - 5.0 for M6.2 at 100 km depth (epistemic uncertainty < 1.0 unit)
    const mmiZhao = gmiceWorden2012PgaToMmi(zhao.pgaGal).mmi;
    const mmiAb03 = gmiceWorden2012PgaToMmi(ab03.pgaGal).mmi;

    assert.ok(Math.abs(mmiZhao - mmiAb03) < 0.9, `Zhao (${mmiZhao}) and AB03 (${mmiAb03}) should be consistent within 1.0 unit`);
  });

  // 4. Scenario A: M4.0, Depth 10 km, Shallow Crustal
  test("Scenario A: M4.0 shallow crustal never exceeds MMI VI at any distance (all NOTIFICATION_ONLY)", () => {
    const rows = runGmpeDistanceBenchmark({
      magnitude: 4.0,
      depthKm: 10,
      regime: "SHALLOW_CRUSTAL",
      distancesKm: [0, 5, 10, 20, 50, 100],
    });

    assert.equal(rows.length, 6);
    for (const r of rows) {
      assert.ok(r.mmi < 5.0, `M4.0 MMI at ${r.distanceEpiKm} km (${r.mmi}) must be < 5.0`);
      assert.equal(r.decision, "NOTIFICATION_ONLY", `Decision at ${r.distanceEpiKm} km must be NOTIFICATION_ONLY`);
    }

    // Epicentral intensity for M4.0 at 10 km should be approx MMI III-IV (~3.8)
    const epi = rows[0];
    assert.ok(epi.mmi >= 3.5 && epi.mmi <= 4.2, `Epicentral MMI expected ~3.8, got ${epi.mmi}`);
  });

  // 5. Scenario B: M6.2, Depth 100 km, Subduction Intraslab
  test("Scenario B: M6.2 deep intraslab (100 km) stays below MMI VI (all NOTIFICATION_ONLY)", () => {
    const rows = runGmpeDistanceBenchmark({
      magnitude: 6.2,
      depthKm: 100,
      regime: "SUBDUCTION_INTRASLAB",
      distancesKm: [0, 5, 10, 20, 50, 100],
    });

    assert.equal(rows.length, 6);
    for (const r of rows) {
      assert.ok(r.mmi < 6.0, `M6.2 at 100 km depth (${r.mmi}) must not trigger MMI >= 6.0`);
      assert.equal(r.decision, "NOTIFICATION_ONLY", `Decision at ${r.distanceEpiKm} km must be NOTIFICATION_ONLY`);
    }

    // Deep earthquake distributes moderate shaking (MMI IV-V) over broad area without extreme peaks
    const epi = rows[0];
    assert.ok(epi.mmi >= 4.1 && epi.mmi <= 5.0, `Epicentral MMI expected ~4.4-4.5, got ${epi.mmi}`);
  });

  // 6. Historical Validation Test against Authentic USGS ShakeMaps
  await (async () => {
    await test("Historical Validation: Cianjur 2022 (us7000ir9t, M5.6, 10 km)", async () => {
      const covPath = path.resolve(process.cwd(), "data/poc/shakemaps/us7000ir9t/coverage_mmi.covjson");
      const covRaw = await fs.readFile(covPath, "utf8");
      const grid = parseShakeMapCovJson(JSON.parse(covRaw), {
        eventId: "us7000ir9t",
        sourceProvider: "USGS",
      });

      // 1. ShakeMap Ground Truth at Cianjur DC
      const cianjurShakeMapMmi = interpolateMmiFromGrid(grid, -6.82, 107.14)!;
      assert.ok(cianjurShakeMapMmi >= 6.0, "Cianjur DC must be MMI >= 6.0 in ShakeMap");

      // 2. GMPE with local site soil condition (Vs30 ~ 270 m/s) and near-fault rupture (Rjb ~ 2 km)
      const nearFaultSoilGmpe = evaluateGmpeGroundMotion({
        magnitude: 5.6,
        depthKm: 10,
        distanceEpiKm: 2.0,
        vs30: 270,
        regime: "SHALLOW_CRUSTAL",
        mechanism: "STRIKE_SLIP",
      });
      assert.equal(nearFaultSoilGmpe.decision, "CANDIDATE_AUTO_REPORT");
      assert.ok(nearFaultSoilGmpe.mmi >= 6.0, "Near-fault with soil amplification yields MMI >= 6.0");

      // 3. GMPE point-source baseline without site correction (Vs30 = 760 m/s, Repi = 12 km)
      // Scientifically reveals point-source underprediction (False Negative) without finite rupture
      const baseGmpe = evaluateGmpeGroundMotion({
        magnitude: 5.6,
        depthKm: 10,
        distanceEpiKm: 12.0,
        vs30: 760,
        regime: "SHALLOW_CRUSTAL",
      });
      assert.ok(baseGmpe.mmi < cianjurShakeMapMmi, "Point source without site proxy underpredicts near-field MMI");

      // 4. Far-field facility: Bandung DC (~77 km)
      const bandungShakeMapMmi = interpolateMmiFromGrid(grid, -6.91, 107.61)!;
      const bandungGmpe = evaluateGmpeGroundMotion({
        magnitude: 5.6,
        depthKm: 10,
        distanceEpiKm: 77.1,
        regime: "SHALLOW_CRUSTAL",
      });

      assert.equal(bandungGmpe.decision, "NOTIFICATION_ONLY");
      assert.equal(bandungShakeMapMmi < 6.0, true);
    });

    await test("Historical Validation: Malang 2021 (us6000e0iy, M6.0, 67 km Intraslab)", async () => {
      const covPath = path.resolve(process.cwd(), "data/poc/shakemaps/us6000e0iy/coverage_mmi.covjson");
      const covRaw = await fs.readFile(covPath, "utf8");
      const grid = parseShakeMapCovJson(JSON.parse(covRaw), {
        eventId: "us6000e0iy",
        sourceProvider: "USGS",
      });

      // Malang event max MMI was ~5.36 (nowhere reached MMI 6.0)
      assert.ok(grid.maxMmi < 6.0, "Malang max MMI must be < 6.0 in ShakeMap");

      const malangEpiGmpe = evaluateGmpeGroundMotion({
        magnitude: 6.0,
        depthKm: 67,
        distanceEpiKm: 0,
        regime: "SUBDUCTION_INTRASLAB",
      });

      assert.equal(malangEpiGmpe.decision, "NOTIFICATION_ONLY");
      assert.ok(malangEpiGmpe.mmi < 6.0);
    });
  })();

  console.log("\n================================================================================");
  console.log(` SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log("================================================================================\n");

  if (failed > 0) {
    process.exit(1);
  }
}

runTestSuite();
