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
  calculateZhao06InterfacePga,
  calculateAb03InterfacePga,
  estimateFaultDimensions,
  convertPointSourceToFiniteRuptureDistance,
  runVs30SensitivityAnalysis,
  runTectonicRegimeComparison,
  gmiceWorden2012PgaToMmi,
  mmiToRomanNumeral,
  evaluateGmpeGroundMotion,
  runGmpeDistanceBenchmark,
  runM4SensitivityAnalysis,
  computeContingencyMetrics,
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

    await test("Sensitivity: Ultra-shallow M4.5 on soft soil at +1s/+2s can reach MMI >= VI", async () => {
      const rows = runM4SensitivityAnalysis();
      const shallowSoftCases = rows.filter((r) => r.canExceedMmi6);
      // Confirms that localized shallow soft-soil events can exceed MMI VI under positive uncertainty
      assert.ok(shallowSoftCases.length > 0, "Must identify cases where M4.0-M4.5 can exceed MMI 6.0");
      const extremeCase = rows.find((r) => r.magnitude === 4.5 && r.depthKm === 5 && r.vs30 === 180);
      assert.ok(extremeCase != null);
      assert.ok(extremeCase.mmiPlus1Sigma >= 6.0, "M4.5 at +1s on soft soil must exceed MMI VI");
    });

    await test("Contingency Metrics: Verifies accurate reporting of 1.79% recall and 98.21% missed alert rate", async () => {
      // Synthetic test array matching the 2 TP, 110 FN, 2368 TN
      const dummyEvaluations: { shakemapMmi: number; gmpeMmi: number }[] = [];
      for (let i = 0; i < 2; i++) dummyEvaluations.push({ shakemapMmi: 6.5, gmpeMmi: 6.2 }); // TP
      for (let i = 0; i < 110; i++) dummyEvaluations.push({ shakemapMmi: 6.5, gmpeMmi: 5.2 }); // FN
      for (let i = 0; i < 2368; i++) dummyEvaluations.push({ shakemapMmi: 4.5, gmpeMmi: 4.2 }); // TN

      const metrics = computeContingencyMetrics(dummyEvaluations);
      assert.equal(metrics.actualPositiveHighRisk, 112);
      assert.equal(metrics.truePositives, 2);
      assert.equal(metrics.falseNegatives, 110);
      assert.equal(metrics.recallPercent, 1.79);
      assert.equal(metrics.missedAlertRatePercent, 98.21);
      assert.equal(metrics.accuracyPercent, 95.56);
    });

    await test("Subduction Interface: Zhao et al. (2006) & AB03 Interface attenuate monotonically", async () => {
      const zhaoNear = calculateZhao06InterfacePga({ magnitude: 7.0, depthKm: 25, distanceEpiKm: 10, vs30: 760 });
      const zhaoFar = calculateZhao06InterfacePga({ magnitude: 7.0, depthKm: 25, distanceEpiKm: 100, vs30: 760 });
      assert.ok(zhaoNear.pgaG > zhaoFar.pgaG, "Zhao 2006 Interface must attenuate with distance");

      const ab03Near = calculateAb03InterfacePga({ magnitude: 7.0, depthKm: 25, distanceEpiKm: 10, vs30: 760 });
      const ab03Far = calculateAb03InterfacePga({ magnitude: 7.0, depthKm: 25, distanceEpiKm: 100, vs30: 760 });
      assert.ok(ab03Near.pgaG > ab03Far.pgaG, "AB03 Interface must attenuate with distance");
    });

    await test("Fault Scaling: Wells & Coppersmith (1994) dimensions scale exponentially with magnitude", async () => {
      const dim5 = estimateFaultDimensions(5.0);
      const dim6 = estimateFaultDimensions(6.0);
      const dim7 = estimateFaultDimensions(7.0);

      assert.ok(dim6.lengthKm > dim5.lengthKm, "M6 fault length must exceed M5");
      assert.ok(dim7.lengthKm > dim6.lengthKm, "M7 fault length must exceed M6");
      assert.ok(dim7.widthKm > dim5.widthKm, "M7 fault width must exceed M5");
      // M7.5 strike-slip should produce length ~95-130 km (Wells & Coppersmith 1994)
      const dim75ss = estimateFaultDimensions(7.5, "STRIKE_SLIP");
      assert.ok(dim75ss.lengthKm > 80 && dim75ss.lengthKm < 135, "M7.5 strike-slip rupture length ~95-130 km");
    });

    await test("Thompson & Worden (2018): E[Rjb] <= Repi and produces non-zero epistemic sigma for large M", async () => {
      const conv = convertPointSourceToFiniteRuptureDistance({ rEpiKm: 45, magnitude: 6.9, mechanism: "REVERSE" });
      assert.ok(conv.expectedRjbKm <= 45, "E[Rjb] must be less than or equal to Repi");
      assert.ok(conv.expectedRjbKm > 0, "E[Rjb] must remain positive for distant site");
      assert.ok(conv.sigmaRjbKm > 0, "Must calculate non-zero sigmaRjb due to unknown fault azimuth");
      assert.ok(conv.minRjbKm < conv.expectedRjbKm, "minRjb must be lower than expected Rjb");

      // Small magnitude should produce Repi == expectedRjb
      const convSmall = convertPointSourceToFiniteRuptureDistance({ rEpiKm: 20, magnitude: 4.0 });
      assert.equal(convSmall.expectedRjbKm, 20);
      assert.equal(convSmall.sigmaRjbKm, 0);
    });

    await test("Geotechnical Sensitivity: Vs30 amplification produces higher ground motion on Class E vs Class B", async () => {
      const rows = runVs30SensitivityAnalysis({
        magnitude: 6.0,
        depthKm: 15,
        distanceKm: 20,
        regime: "SHALLOW_CRUSTAL",
      });

      const classB = rows.find((r) => r.siteClass === "B");
      const classE = rows.find((r) => r.siteClass === "E");
      assert.ok(classB != null && classE != null);
      assert.ok(classE.pgaMedianG > classB.pgaMedianG, "Class E PGA must exceed Class B PGA");
      assert.ok(classE.mmiMedian > classB.mmiMedian, "Class E MMI must exceed Class B MMI");
      assert.ok(classE.deltaMmiVsRock >= 0.8, "Class E amplification relative to rock must be >= 0.8 MMI units");
    });

    await test("Tectonic Regime Differentiation: Shallow Crustal, Interface, and Intraslab evaluate independently", async () => {
      const comp = runTectonicRegimeComparison({
        magnitude: 6.5,
        depthKm: 30,
        distancesKm: [20],
      });

      assert.equal(comp.length, 1);
      assert.ok(comp[0].crustalMmi > 0);
      assert.ok(comp[0].interfaceMmi > 0);
      assert.ok(comp[0].intraslabMmi > 0);
      // All three regimes evaluate distinctly without throwing errors
      assert.notEqual(comp[0].crustalMmi, comp[0].intraslabMmi);
    });

    // 7. Task 4: Historical Earthquakes without Numerical ShakeMap (Audited USGS/BMKG)
    await test("Task 4: Non-ShakeMap Validation for Shallow M<5 (Sumedang 2023 us6000m0tt) captures near-source intensity", async () => {
      // Sumedang 2023 (us6000m0tt: Mw 4.8, h=12.16 km, strike-slip, Repi=14.2 km to Sumedang Kota, Vs30=240 m/s)
      const res = evaluateGmpeGroundMotion({
        magnitude: 4.8,
        depthKm: 12.16,
        distanceEpiKm: 14.2,
        vs30: 240,
        regime: "SHALLOW_CRUSTAL",
        mechanism: "STRIKE_SLIP",
      });

      // Observed: USGS DYFI CDI 5.4, BMKG IV-V (interval [4.0, 5.4])
      // GMPE median predicts ~4.07 MMI (falls within interval [4.0, 5.4])
      assert.ok(res.mmi >= 3.8 && res.mmi <= 5.5, `Expected near-source MMI ~3.8-5.5, got ${res.mmi}`);
      assert.ok(res.mmi >= 4.0 && res.mmi <= 5.4, `Prediction must fall within observed interval [4.0, 5.4], got ${res.mmi}`);
    });

    await test("Task 4: Non-ShakeMap Validation for Deep M6+ (Java Sea 2023 us6000k49j h=597 km) captures broad attenuation", async () => {
      // Java Sea 2023 (us6000k49j: Mw 7.0, h=597 km, deep intraslab)
      const resTuban = evaluateGmpeGroundMotion({
        magnitude: 7.0,
        depthKm: 597.0,
        distanceEpiKm: 95.5,
        regime: "SUBDUCTION_INTRASLAB",
        vs30: 270,
      });

      // Observed: USGS DYFI CDI 3.8, BMKG III-IV
      // GMPE median predicts ~3.96 MMI (difference < 0.3 MMI)
      assert.ok(Math.abs(resTuban.mmi - 3.80) < 0.3, `Tuban error must be < 0.3 MMI, got ${Math.abs(resTuban.mmi - 3.80)}`);

      // Far field: Jakarta (Repi=574.9 km), Observed: USGS DYFI CDI 2.7, BMKG II-III
      const resJkt = evaluateGmpeGroundMotion({
        magnitude: 7.0,
        depthKm: 597.0,
        distanceEpiKm: 574.9,
        regime: "SUBDUCTION_INTRASLAB",
        vs30: 250,
      });
      assert.ok(Math.abs(resJkt.mmi - 2.70) < 0.5, `Jakarta error must be < 0.5 MMI, got ${Math.abs(resJkt.mmi - 2.70)}`);
      // Far field ground motion must attenuate relative to near field
      assert.ok(resJkt.mmi < resTuban.mmi, "Far-field intensity must be less than near-field");
    });

    await test("Task 4: Non-ShakeMap Validation for Bawean 2024 (us6000mkfz) captures finite-fault intensity", async () => {
      // Bawean 2024 (us6000mkfz: Mw 6.4, h=9.47 km, shallow crustal strike-slip, Repi=31.8 km to Bawean)
      const resBawean = evaluateGmpeGroundMotion({
        magnitude: 6.4,
        depthKm: 9.47,
        distanceEpiKm: 31.8,
        vs30: 250,
        regime: "SHALLOW_CRUSTAL",
        mechanism: "STRIKE_SLIP",
        useRuptureDistanceConversion: true,
      });

      // Observed: BMKG V-VI MMI (interval [5.0, 6.0], midpoint 5.5)
      // GMPE median with Thompson-Worden conversion predicts ~5.67 MMI
      assert.ok(resBawean.mmi >= 5.0 && resBawean.mmi <= 6.0, `Expected MMI in interval [5.0, 6.0], got ${resBawean.mmi}`);
      assert.ok(Math.abs(resBawean.mmi - 5.50) < 0.25, `Bawean error must be < 0.25 MMI, got ${Math.abs(resBawean.mmi - 5.50)}`);
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
