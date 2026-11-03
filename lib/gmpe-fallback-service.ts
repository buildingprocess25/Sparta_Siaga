/**
 * SPARTA SIAGA - Ground Motion Prediction Equation (GMPE) Fallback Service
 * 
 * Scientific implementation of peer-reviewed ground motion attenuation models
 * and ground motion to intensity conversion equations (GMICE):
 * 
 * 1. BSSA14 (Boore et al., 2014): Shallow crustal earthquakes (NGA-West2).
 * 2. AB03 (Atkinson & Boore, 2003) & Zhao et al. (2006): Subduction intraslab earthquakes.
 * 3. WGRW12 (Worden et al., 2012): USGS ShakeMap GMICE for PGA/PGV to MMI conversion.
 * 
 * Used strictly for scientific feasibility evaluation, situational awareness,
 * and informational fallback.
 * 
 * Reference: PUSGEN 2024, USGS ShakeMap v4.0 manual, OpenQuake engine.
 * Rule: Zero em dashes. All punctuation uses standard hyphens (-) or colons (:).
 */

export type TectonicRegime = "SHALLOW_CRUSTAL" | "SUBDUCTION_INTRASLAB" | "SUBDUCTION_INTERFACE";
export type FaultMechanism = "STRIKE_SLIP" | "NORMAL" | "REVERSE" | "UNSPECIFIED";

export interface GmpeInputParams {
  magnitude: number; // Moment magnitude Mw
  depthKm: number; // Hypocentral depth in km
  distanceEpiKm: number; // Horizontal epicentral distance in km
  vs30?: number; // Time-averaged shear wave velocity in top 30m (m/s), default 760 (B/C rock)
  regime?: TectonicRegime;
  mechanism?: FaultMechanism;
  useRuptureDistanceConversion?: boolean; // If true, applies Thompson & Worden (2018) pseudo-rupture distance
  sigmaMultiplier?: number; // Evaluates at median + N*sigma (e.g. 0 for median, 1.0 for +1 sigma)
}

export interface GmpeOutputResult {
  pgaG: number; // Peak Ground Acceleration in g (median or adjusted by sigmaMultiplier)
  pgaGal: number; // Peak Ground Acceleration in Gal (cm/s^2)
  pgaLowG: number; // -1 sigma PGA in g
  pgaHighG: number; // +1 sigma PGA in g
  sigmaLn: number; // Standard deviation in natural log units
  mmi: number; // Median Modified Mercalli Intensity
  mmiLow: number; // -1 sigma MMI
  mmiHigh: number; // +1 sigma MMI
  sigmaMmi: number; // Total combined standard deviation in MMI units
  mmiRounded: number; // MMI rounded to 2 decimal places for display
  mmiRoman: string; // Roman numeral representation (e.g. "VI")
  decision: "CANDIDATE_AUTO_REPORT" | "NOTIFICATION_ONLY" | "UNKNOWN";
  modelName: string;
  effectiveDistanceKm?: number; // Rjb or converted finite rupture distance
  distanceConversionApplied?: boolean;
  faultLengthKm?: number;
  faultWidthKm?: number;
  sigmaRjbKm?: number;
}

export interface GmpeScenarioRow {
  distanceEpiKm: number;
  distanceHypKm: number;
  pgaG: number;
  pgaGal: number;
  pgaLowG: number;
  pgaHighG: number;
  mmi: number;
  mmiLow: number;
  mmiHigh: number;
  mmiRounded: number;
  mmiRoman: string;
  decision: "CANDIDATE_AUTO_REPORT" | "NOTIFICATION_ONLY" | "UNKNOWN";
}

/**
 * Converts decimal intensity value to Roman numeral (I through X).
 */
export function mmiToRomanNumeral(mmi: number): string {
  if (!Number.isFinite(mmi) || mmi < 1.0) return "I";
  const rounded = Math.round(mmi);
  const romanMap: Record<number, string> = {
    1: "I",
    2: "II",
    3: "III",
    4: "IV",
    5: "V",
    6: "VI",
    7: "VII",
    8: "VIII",
    9: "IX",
    10: "X",
  };
  return romanMap[Math.min(10, Math.max(1, rounded))] || "X";
}

/**
 * Worden et al. (2012) GMICE:
 * Converts Peak Ground Acceleration (PGA in Gal = cm/s^2) to Modified Mercalli Intensity (MMI).
 * Published relation in BSSA Vol. 102, No. 1, used as standard in USGS ShakeMap (WGRW12).
 */
export function gmiceWorden2012PgaToMmi(pgaGal: number): {
  mmi: number;
  sigmaResidual: number;
} {
  if (!Number.isFinite(pgaGal) || pgaGal <= 0) {
    return { mmi: 1.0, sigmaResidual: 0.73 };
  }

  const log10Pga = Math.log10(pgaGal);
  const tPga = 1.57; // Transition threshold log10(PGA) = 1.57 (approx 37.15 Gal)
  let mmi: number;

  if (log10Pga <= tPga) {
    mmi = 1.78 + 1.55 * log10Pga;
  } else {
    mmi = -1.60 + 3.70 * log10Pga;
  }

  // Physical clamping between I (1.0) and X (10.0)
  mmi = Math.min(10.0, Math.max(1.0, mmi));
  return {
    mmi,
    sigmaResidual: 0.73, // Residual standard deviation from Worden et al. (2012) Table 3
  };
}

/**
 * Boore, Stewart, Seyhan & Atkinson (2014) [BSSA14]:
 * Ground Motion Prediction Equation for shallow crustal earthquakes (NGA-West2).
 * Returns ln(PGA) in units of g for period T = 0 s.
 */
export function calculateBssa14Pga(params: {
  magnitude: number;
  rJbKm: number;
  vs30?: number;
  mechanism?: FaultMechanism;
}): {
  lnPga: number;
  pgaG: number;
  sigmaLn: number;
} {
  const { magnitude: m, rJbKm, vs30 = 760, mechanism = "UNSPECIFIED" } = params;

  // Published BSSA14 coefficients for PGA (Period = 0.0s / Peak Ground Acceleration)
  const c1 = -1.138;
  const c2 = 0.170;
  const c3 = -0.0073;
  const h = 5.74; // fictitious depth parameter in km
  const mh = 5.50;
  const mRef = 4.50;
  const rRef = 1.0;

  // Source mechanism coefficients
  let e0 = -0.450; // unspecified default
  if (mechanism === "STRIKE_SLIP") e0 = -0.450;
  else if (mechanism === "NORMAL") e0 = -0.630;
  else if (mechanism === "REVERSE") e0 = -0.340;

  const e4 = 0.770;
  const e5 = 0.000;
  const e6 = 0.400;

  // Source term Fe(M)
  let fe = 0;
  if (m <= mh) {
    fe = e0 + e4 * (m - mh) + e5 * Math.pow(m - mh, 2);
  } else {
    fe = e0 + e6 * (m - mh);
  }

  // Path term Fp(Rjb, M)
  const r = Math.sqrt(rJbKm * rJbKm + h * h);
  const fp = (c1 + c2 * (m - mRef)) * Math.log(r / rRef) + c3 * (r - rRef);

  // Site term Fs(Vs30)
  const vRef = 760.0;
  const vC = 1500.0;
  const cSite = -0.50; // Linear site amplification coefficient for PGA
  const fsLin = cSite * Math.log(Math.min(vs30, vC) / vRef);

  // Total mean ln(PGA) in g
  const lnPga = fe + fp + fsLin;
  const pgaG = Math.exp(lnPga);

  // Standard deviation for BSSA14 (approx 0.66 ln units)
  const sigmaLn = 0.66;

  return { lnPga, pgaG, sigmaLn };
}

/**
 * Atkinson & Boore (2003) Subduction In-Slab GMPE:
 * Ground motion model for intraslab subduction earthquakes (depth > 35 km).
 * Standard in USGS ShakeMap (AtkinsonBoore2003SSlab) and PUSGEN.
 */
export function calculateAb03IntraslabPga(params: {
  magnitude: number;
  depthKm: number;
  distanceEpiKm: number;
  vs30?: number;
}): {
  lnPga: number;
  pgaG: number;
  pgaGal: number;
  sigmaLn: number;
} {
  const { magnitude: m, depthKm: h, distanceEpiKm, vs30 = 760 } = params;

  // Hypocentral distance Rhyp = sqrt(Repi^2 + h^2)
  const rHyp = Math.sqrt(distanceEpiKm * distanceEpiKm + h * h);

  // Atkinson & Boore (2003) Table 4 coefficients for In-Slab PGA (Gal = cm/s^2)
  const c1 = -0.047;
  const c2 = 0.690;
  const c3 = 0.00375; // depth coefficient (stronger high frequency from deeper stress drop)
  const c4 = -0.0015;
  const g = 1.6 - 0.04 * m; // geometric spreading coefficient

  // log10(PGA) in Gal
  const log10PgaGal = c1 + c2 * m + c3 * h + c4 * rHyp - g * Math.log10(rHyp);
  const pgaGalRock = Math.pow(10, log10PgaGal);

  // Site amplification correction relative to rock (760 m/s)
  const siteAmpFactor = Math.pow(760 / Math.max(150, vs30), 0.35);
  const pgaGal = pgaGalRock * siteAmpFactor;

  const pgaG = pgaGal / 980.665;
  const lnPga = Math.log(pgaG);
  const sigmaLog10 = 0.27; // sigma in log10 units
  const sigmaLn = sigmaLog10 * Math.LN10; // ~0.62 ln units

  return { lnPga, pgaG, pgaGal, sigmaLn };
}

/**
 * Zhao et al. (2006) Subduction In-Slab GMPE:
 * Recommended in PUSGEN 2017/2024 for Indonesian intraslab earthquakes.
 */
export function calculateZhao06IntraslabPga(params: {
  magnitude: number;
  depthKm: number;
  distanceEpiKm: number;
  vs30?: number;
}): {
  lnPga: number;
  pgaG: number;
  pgaGal: number;
  sigmaLn: number;
} {
  const { magnitude: m, depthKm: h, distanceEpiKm, vs30 = 760 } = params;
  const rHyp = Math.sqrt(distanceEpiKm * distanceEpiKm + h * h);

  // Coefficients for In-Slab PGA (Zhao et al. 2006, Table 4)
  const a = 1.101;
  const b = 0.00564;
  const c = 0.0055;
  const d = 1.080;
  const cIntraslab = 0.323;
  const qDepth = 0.0145; // for h <= 125 km

  const r = rHyp + c * Math.exp(d * m);
  const cappedDepth = Math.min(125, Math.max(35, h));

  // Site classification: SC I (rock Vs30 > 600 m/s) = 0.0
  let siteCoeff = 0.0;
  if (vs30 < 300) siteCoeff = 0.45; // SC IV (soft soil)
  else if (vs30 < 600) siteCoeff = 0.25; // SC II/III (stiff soil)

  // Note: Zhao et al. (2006) models PGA in cm/s^2 (Gal)
  const lnPgaGal = a * m - b * rHyp - Math.log(r) + cIntraslab + qDepth * cappedDepth + siteCoeff;
  const pgaGal = Math.exp(lnPgaGal);
  const pgaG = pgaGal / 980.665;
  const lnPga = Math.log(pgaG);
  const sigmaLn = 0.605;

  return { lnPga, pgaG, pgaGal, sigmaLn };
}

/**
 * Zhao et al. (2006) Subduction Interface GMPE:
 * Recommended in PUSGEN 2017/2024 and USGS ShakeMap for Indonesian megathrust earthquakes.
 * Ref: Zhao et al. (2006), BSSA Vol. 96, No. 3, Table 4.
 */
export function calculateZhao06InterfacePga(params: {
  magnitude: number;
  depthKm: number;
  distanceEpiKm: number;
  vs30?: number;
}): {
  lnPga: number;
  pgaG: number;
  pgaGal: number;
  sigmaLn: number;
} {
  const { magnitude: m, depthKm: h, distanceEpiKm, vs30 = 760 } = params;
  const rHyp = Math.sqrt(distanceEpiKm * distanceEpiKm + h * h);

  // Coefficients for Interface PGA (Zhao et al. 2006, Table 4)
  const a = 1.101;
  const b = 0.00564;
  const c = 0.0055;
  const d = 1.080;
  const cInterface = 0.0; // S_I = 0.0 for interface events
  const qDepth = 0.0145;

  const r = rHyp + c * Math.exp(d * m);
  const cappedDepth = Math.min(50, Math.max(15, h)); // Interface depth typically 15-50 km

  // Site classification: SC I (rock Vs30 > 600 m/s) = 0.0
  let siteCoeff = 0.0;
  if (vs30 < 300) siteCoeff = 0.45; // SC IV (soft soil)
  else if (vs30 < 600) siteCoeff = 0.25; // SC II/III (stiff soil)

  // Note: Zhao et al. (2006) models PGA in cm/s^2 (Gal)
  const lnPgaGal = a * m - b * rHyp - Math.log(r) + cInterface + qDepth * cappedDepth + siteCoeff;
  const pgaGal = Math.exp(lnPgaGal);
  const pgaG = pgaGal / 980.665;
  const lnPga = Math.log(pgaG);
  const sigmaLn = 0.605;

  return { lnPga, pgaG, pgaGal, sigmaLn };
}

/**
 * Atkinson & Boore (2003) Subduction Interface GMPE:
 * Standard USGS ShakeMap and PUSGEN interface model for megathrust subduction events.
 * Ref: Atkinson & Boore (2003), BSSA Vol. 93, No. 4, Table 4.
 */
export function calculateAb03InterfacePga(params: {
  magnitude: number;
  depthKm: number;
  distanceEpiKm: number;
  vs30?: number;
}): {
  lnPga: number;
  pgaG: number;
  pgaGal: number;
  sigmaLn: number;
} {
  const { magnitude: m, depthKm: h, distanceEpiKm, vs30 = 760 } = params;
  const rHyp = Math.sqrt(distanceEpiKm * distanceEpiKm + h * h);

  // Atkinson & Boore (2003) Table 4 coefficients for Interface PGA (Gal = cm/s^2)
  const c1 = 0.299;
  const c2 = 0.690;
  const c3 = 0.000; // Zero depth coefficient for interface in AB03
  const c4 = -0.0016;
  const g = 1.6 - 0.04 * m; // geometric spreading coefficient

  // log10(PGA) in Gal
  const log10PgaGal = c1 + c2 * m + c3 * h + c4 * rHyp - g * Math.log10(rHyp);
  const pgaGalRock = Math.pow(10, log10PgaGal);

  // Site amplification correction relative to rock (760 m/s)
  const siteAmpFactor = Math.pow(760 / Math.max(150, vs30), 0.35);
  const pgaGal = pgaGalRock * siteAmpFactor;

  const pgaG = pgaGal / 980.665;
  const lnPga = Math.log(pgaG);
  const sigmaLog10 = 0.23; // sigma in log10 units for interface
  const sigmaLn = sigmaLog10 * Math.LN10; // ~0.53 ln units

  return { lnPga, pgaG, pgaGal, sigmaLn };
}

/**
 * Estimates physical fault rupture dimensions (length and width in km) from moment magnitude.
 * Empirical scaling based on Wells & Coppersmith (1994) and Leonard (2010).
 * Standard in USGS ShakeMap (ShakeLib / ps2ff magnitude_scaling).
 */
export function estimateFaultDimensions(
  magnitude: number,
  mechanism: FaultMechanism = "UNSPECIFIED"
): { lengthKm: number; widthKm: number } {
  let lengthKm: number;
  let widthKm: number;

  if (mechanism === "STRIKE_SLIP") {
    // Wells & Coppersmith (1994) Strike-Slip relations
    lengthKm = Math.pow(10, -2.57 + 0.62 * magnitude);
    widthKm = Math.pow(10, -0.76 + 0.27 * magnitude);
  } else if (mechanism === "REVERSE") {
    // Wells & Coppersmith (1994) Reverse/Thrust relations
    lengthKm = Math.pow(10, -2.42 + 0.58 * magnitude);
    widthKm = Math.pow(10, -1.61 + 0.41 * magnitude);
  } else if (mechanism === "NORMAL") {
    // Wells & Coppersmith (1994) Normal fault relations
    lengthKm = Math.pow(10, -1.88 + 0.50 * magnitude);
    widthKm = Math.pow(10, -1.14 + 0.35 * magnitude);
  } else {
    // All slip types combined (Wells & Coppersmith, 1994 Table 2A)
    lengthKm = Math.pow(10, -2.44 + 0.59 * magnitude);
    widthKm = Math.pow(10, -1.01 + 0.32 * magnitude);
  }

  // Physical bounds: minimum 0.5 km for micro-earthquakes
  lengthKm = Math.max(0.5, lengthKm);
  widthKm = Math.max(0.5, widthKm);

  return { lengthKm, widthKm };
}

/**
 * Thompson & Worden (2018) Point-Source to Finite-Fault (PS2FF) Distance Conversion:
 * Computes expected Joyner-Boore distance E[Rjb] and epistemic variance when fault geometry
 * (strike, dip, hypocenter location along strike) is unknown immediately post-event.
 * Ref: Thompson & Worden (2018), BSSA Vol. 108, No. 1, pp. 371-379. DOI: 10.1785/0120170174.
 */
export function convertPointSourceToFiniteRuptureDistance(params: {
  rEpiKm: number;
  magnitude: number;
  mechanism?: FaultMechanism;
  steps?: number;
}): {
  expectedRjbKm: number;
  minRjbKm: number;
  maxRjbKm: number;
  sigmaRjbKm: number;
  faultLengthKm: number;
  faultWidthKm: number;
} {
  const { rEpiKm, magnitude, mechanism = "UNSPECIFIED", steps = 180 } = params;
  const { lengthKm, widthKm } = estimateFaultDimensions(magnitude, mechanism);

  // For small events (M < 5.0) or distant sites (> 300 km), finite rupture effects are negligible
  if (magnitude < 5.0 || rEpiKm > 300) {
    return {
      expectedRjbKm: Math.round(rEpiKm * 100) / 100,
      minRjbKm: Math.max(0, Math.round((rEpiKm - lengthKm / 2) * 100) / 100),
      maxRjbKm: Math.round((rEpiKm + lengthKm / 2) * 100) / 100,
      sigmaRjbKm: 0,
      faultLengthKm: Math.round(lengthKm * 10) / 10,
      faultWidthKm: Math.round(widthKm * 10) / 10,
    };
  }

  const halfL = lengthKm / 2;
  const dTheta = Math.PI / steps;
  let sumR = 0;
  let sumR2 = 0;
  let minR = Infinity;
  let maxR = -Infinity;

  // Numerical angular integration across all azimuths theta in [0, pi]
  for (let i = 0; i <= steps; i++) {
    const theta = i * dTheta;
    const cosTheta = Math.cos(theta);
    const sinTheta = Math.sin(theta);
    const u = rEpiKm * cosTheta;
    let dist: number;

    if (Math.abs(u) <= halfL) {
      // Perpendicular point falls directly on the surface projection segment
      dist = rEpiKm * Math.abs(sinTheta);
    } else if (u > halfL) {
      // Closest point is positive segment endpoint
      const dx = rEpiKm - halfL * cosTheta;
      const dy = halfL * sinTheta;
      dist = Math.sqrt(dx * dx + dy * dy);
    } else {
      // Closest point is negative segment endpoint
      const dx = rEpiKm + halfL * cosTheta;
      const dy = halfL * sinTheta;
      dist = Math.sqrt(dx * dx + dy * dy);
    }

    // Trapezoidal weighting
    const weight = (i === 0 || i === steps) ? 0.5 : 1.0;
    sumR += dist * weight;
    sumR2 += dist * dist * weight;
    if (dist < minR) minR = dist;
    if (dist > maxR) maxR = dist;
  }

  const expectedR = sumR / steps;
  const expectedR2 = sumR2 / steps;
  const variance = Math.max(0, expectedR2 - expectedR * expectedR);
  const sigmaR = Math.sqrt(variance);

  return {
    expectedRjbKm: Math.round(expectedR * 100) / 100,
    minRjbKm: Math.round(minR * 100) / 100,
    maxRjbKm: Math.round(maxR * 100) / 100,
    sigmaRjbKm: Math.round(sigmaR * 100) / 100,
    faultLengthKm: Math.round(lengthKm * 10) / 10,
    faultWidthKm: Math.round(widthKm * 10) / 10,
  };
}

/**
 * Unified GMPE Evaluator:
 * Selects appropriate attenuation model based on tectonic regime and hypocentral depth,
 * evaluates PGA, and converts to MMI with total standard deviation.
 * Supports:
 * - Shallow Crustal (Boore et al., 2014 BSSA14)
 * - Subduction Interface (Zhao et al., 2006 + Atkinson & Boore, 2003 Interface ensemble)
 * - Subduction Intraslab (Zhao et al., 2006 + Atkinson & Boore, 2003 Intraslab ensemble)
 * - Thompson & Worden (2018) Point-Source to Finite-Fault Rupture Distance Conversion (PS2FF)
 * - Explicit sigma multiplier evaluation (e.g. median vs +1 sigma)
 */
export function evaluateGmpeGroundMotion(params: GmpeInputParams): GmpeOutputResult {
  const {
    magnitude,
    depthKm,
    distanceEpiKm,
    vs30 = 760,
    regime = depthKm >= 50 ? "SUBDUCTION_INTRASLAB" : "SHALLOW_CRUSTAL",
    mechanism = "UNSPECIFIED",
    useRuptureDistanceConversion = false,
    sigmaMultiplier = 0,
  } = params;

  let effectiveDist = Math.max(0, distanceEpiKm);
  let faultLengthKm: number | undefined;
  let faultWidthKm: number | undefined;
  let sigmaRjbKm: number | undefined;
  let distanceConversionApplied = false;

  if (useRuptureDistanceConversion) {
    const tw = convertPointSourceToFiniteRuptureDistance({
      rEpiKm: distanceEpiKm,
      magnitude,
      mechanism,
    });
    effectiveDist = tw.expectedRjbKm;
    faultLengthKm = tw.faultLengthKm;
    faultWidthKm = tw.faultWidthKm;
    sigmaRjbKm = tw.sigmaRjbKm;
    distanceConversionApplied = true;
  }

  let pgaG = 0;
  let sigmaLn = 0.65;
  let modelName = "";

  if (regime === "SUBDUCTION_INTRASLAB") {
    // Subduction Intraslab multi-GMPE ensemble:
    // 50% Zhao et al. (2006) + 50% Atkinson & Boore (2003)
    // Represents intraslab logic tree components used in USGS NSHMP and global ShakeMap.
    const zhaoRes = calculateZhao06IntraslabPga({
      magnitude,
      depthKm,
      distanceEpiKm: effectiveDist,
      vs30,
    });
    const ab03Res = calculateAb03IntraslabPga({
      magnitude,
      depthKm,
      distanceEpiKm: effectiveDist,
      vs30,
    });
    const lnPga = 0.5 * zhaoRes.lnPga + 0.5 * ab03Res.lnPga;
    sigmaLn = Math.sqrt(0.5 * Math.pow(zhaoRes.sigmaLn, 2) + 0.5 * Math.pow(ab03Res.sigmaLn, 2));
    pgaG = Math.exp(lnPga + sigmaMultiplier * sigmaLn);
    modelName = "Intraslab Ensemble (Zhao 2006 + AB03)";
  } else if (regime === "SUBDUCTION_INTERFACE") {
    // Subduction Interface multi-GMPE ensemble:
    // 50% Zhao et al. (2006) Interface + 50% Atkinson & Boore (2003) Interface
    // Standard megathrust interface logic tree components used in USGS ShakeMap and PUSGEN.
    const zhaoInt = calculateZhao06InterfacePga({
      magnitude,
      depthKm,
      distanceEpiKm: effectiveDist,
      vs30,
    });
    const ab03Int = calculateAb03InterfacePga({
      magnitude,
      depthKm,
      distanceEpiKm: effectiveDist,
      vs30,
    });
    const lnPga = 0.5 * zhaoInt.lnPga + 0.5 * ab03Int.lnPga;
    sigmaLn = Math.sqrt(0.5 * Math.pow(zhaoInt.sigmaLn, 2) + 0.5 * Math.pow(ab03Int.sigmaLn, 2));
    pgaG = Math.exp(lnPga + sigmaMultiplier * sigmaLn);
    modelName = "Subduction Interface Ensemble (Zhao 2006 + AB03)";
  } else {
    // Shallow Crustal model: Boore et al. (2014) BSSA14 (NGA-West2)
    // Uses Joyner-Boore distance Rjb (or Thompson & Worden converted Rjb)
    const bssaRes = calculateBssa14Pga({
      magnitude,
      rJbKm: effectiveDist,
      vs30,
      mechanism,
    });
    sigmaLn = bssaRes.sigmaLn;
    pgaG = Math.exp(bssaRes.lnPga + sigmaMultiplier * sigmaLn);
    modelName = "Boore et al. (2014) BSSA14";
  }

  const pgaGal = pgaG * 980.665;
  const pgaLowG = Math.exp(Math.log(pgaG) - sigmaLn);
  const pgaHighG = Math.exp(Math.log(pgaG) + sigmaLn);

  // Convert to MMI via Worden et al. (2012)
  const medianMmiObj = gmiceWorden2012PgaToMmi(pgaGal);
  const lowMmiObj = gmiceWorden2012PgaToMmi(pgaLowG * 980.665);
  const highMmiObj = gmiceWorden2012PgaToMmi(pgaHighG * 980.665);

  const mmi = medianMmiObj.mmi;
  const mmiLow = lowMmiObj.mmi;
  const mmiHigh = highMmiObj.mmi;

  // Propagated standard deviation in MMI
  const log10Pga = Math.log10(pgaGal);
  const gmiceSlope = log10Pga <= 1.57 ? 1.55 : 3.70;
  const propagatedSigmaMmi = gmiceSlope * (sigmaLn / Math.LN10);
  const sigmaMmi = Math.sqrt(Math.pow(medianMmiObj.sigmaResidual, 2) + Math.pow(propagatedSigmaMmi, 2));

  const mmiRounded = Math.round(mmi * 100) / 100;
  const mmiRoman = mmiToRomanNumeral(mmi);

  // Policy threshold check: MMI >= 6.0000 produces CANDIDATE_AUTO_REPORT
  let decision: "CANDIDATE_AUTO_REPORT" | "NOTIFICATION_ONLY" | "UNKNOWN" = "NOTIFICATION_ONLY";
  if (mmi >= 6.0) {
    decision = "CANDIDATE_AUTO_REPORT";
  } else {
    decision = "NOTIFICATION_ONLY";
  }

  return {
    pgaG,
    pgaGal,
    pgaLowG,
    pgaHighG,
    sigmaLn,
    mmi,
    mmiLow,
    mmiHigh,
    sigmaMmi,
    mmiRounded,
    mmiRoman,
    decision,
    modelName,
    effectiveDistanceKm: effectiveDist,
    distanceConversionApplied,
    faultLengthKm,
    faultWidthKm,
    sigmaRjbKm,
  };
}

/**
 * Runs Scenario Benchmark across horizontal distances [0, 5, 10, 20, 50, 100] km.
 */
export function runGmpeDistanceBenchmark(params: {
  magnitude: number;
  depthKm: number;
  regime: TectonicRegime;
  distancesKm?: number[];
  vs30?: number;
}): GmpeScenarioRow[] {
  const distances = params.distancesKm || [0, 5, 10, 20, 50, 100];
  const rows: GmpeScenarioRow[] = [];

  for (const d of distances) {
    const rHyp = Math.sqrt(d * d + params.depthKm * params.depthKm);
    const result = evaluateGmpeGroundMotion({
      magnitude: params.magnitude,
      depthKm: params.depthKm,
      distanceEpiKm: d,
      vs30: params.vs30 || 760,
      regime: params.regime,
    });

    rows.push({
      distanceEpiKm: d,
      distanceHypKm: Math.round(rHyp * 10) / 10,
      pgaG: Math.round(result.pgaG * 10000) / 10000,
      pgaGal: Math.round(result.pgaGal * 100) / 100,
      pgaLowG: Math.round(result.pgaLowG * 10000) / 10000,
      pgaHighG: Math.round(result.pgaHighG * 10000) / 10000,
      mmi: Math.round(result.mmi * 10000) / 10000,
      mmiLow: Math.round(result.mmiLow * 100) / 100,
      mmiHigh: Math.round(result.mmiHigh * 100) / 100,
      mmiRounded: result.mmiRounded,
      mmiRoman: result.mmiRoman,
      decision: result.decision,
    });
  }

  return rows;
}

export interface M4SensitivityRow {
  magnitude: number;
  depthKm: number;
  distanceEpiKm: number;
  vs30: number;
  soilDescription: string;
  pgaMedianG: number;
  pgaPlus1SigmaG: number;
  pgaPlus2SigmaG: number;
  mmiMedian: number;
  mmiPlus1Sigma: number;
  mmiPlus2Sigma: number;
  decisionMedian: "CANDIDATE_AUTO_REPORT" | "NOTIFICATION_ONLY";
  decisionPlus2Sigma: "CANDIDATE_AUTO_REPORT" | "NOTIFICATION_ONLY";
  canExceedMmi6: boolean;
}

/**
 * Evaluates sensitivity of shallow M4.0 - M4.5 earthquakes against
 * focal depth, site soil condition (Vs30), distance, and aleatory uncertainty (+1s / +2s).
 * Proves that M < 5.0 cannot be generalized as categorically harmless under all conditions.
 */
export function runM4SensitivityAnalysis(): M4SensitivityRow[] {
  const testCases: { mag: number; depth: number; dist: number; vs30: number; desc: string }[] = [
    { mag: 4.0, depth: 10, dist: 0, vs30: 760, desc: "Rock (Class B), Depth 10 km, Epicenter" },
    { mag: 4.0, depth: 10, dist: 5, vs30: 760, desc: "Rock (Class B), Depth 10 km, Dist 5 km" },
    { mag: 4.0, depth: 5, dist: 0, vs30: 760, desc: "Rock (Class B), Depth 5 km, Epicenter" },
    { mag: 4.0, depth: 5, dist: 0, vs30: 270, desc: "Medium Soil (Class D), Depth 5 km, Epicenter" },
    { mag: 4.0, depth: 5, dist: 0, vs30: 180, desc: "Soft Soil / Alluvium (Class E), Depth 5 km, Epicenter" },
    { mag: 4.0, depth: 2, dist: 0, vs30: 270, desc: "Medium Soil (Class D), Ultra-Shallow 2 km, Epicenter" },
    { mag: 4.0, depth: 2, dist: 0, vs30: 180, desc: "Soft Soil (Class E), Ultra-Shallow 2 km, Epicenter" },
    { mag: 4.0, depth: 2, dist: 2, vs30: 180, desc: "Soft Soil (Class E), Ultra-Shallow 2 km, Dist 2 km" },
    { mag: 4.5, depth: 5, dist: 0, vs30: 760, desc: "Rock (Class B), Depth 5 km, Epicenter" },
    { mag: 4.5, depth: 5, dist: 0, vs30: 270, desc: "Medium Soil (Class D), Depth 5 km, Epicenter" },
    { mag: 4.5, depth: 5, dist: 0, vs30: 180, desc: "Soft Soil (Class E), Depth 5 km, Epicenter" },
    { mag: 4.5, depth: 2, dist: 0, vs30: 180, desc: "Soft Soil (Class E), Ultra-Shallow 2 km, Epicenter" },
  ];

  const results: M4SensitivityRow[] = [];

  for (const tc of testCases) {
    const sigmaLn = 0.66;
    const bssa = calculateBssa14Pga({
      magnitude: tc.mag,
      rJbKm: tc.dist,
      vs30: tc.vs30,
    });

    const pgaMedianG = bssa.pgaG;
    const pgaPlus1G = Math.exp(Math.log(pgaMedianG) + sigmaLn);
    const pgaPlus2G = Math.exp(Math.log(pgaMedianG) + 2 * sigmaLn);

    const mmiMedian = gmiceWorden2012PgaToMmi(pgaMedianG * 980.665).mmi;
    const mmiPlus1 = gmiceWorden2012PgaToMmi(pgaPlus1G * 980.665).mmi;
    const mmiPlus2 = gmiceWorden2012PgaToMmi(pgaPlus2G * 980.665).mmi;

    results.push({
      magnitude: tc.mag,
      depthKm: tc.depth,
      distanceEpiKm: tc.dist,
      vs30: tc.vs30,
      soilDescription: tc.desc,
      pgaMedianG: Math.round(pgaMedianG * 10000) / 10000,
      pgaPlus1SigmaG: Math.round(pgaPlus1G * 10000) / 10000,
      pgaPlus2SigmaG: Math.round(pgaPlus2G * 10000) / 10000,
      mmiMedian: Math.round(mmiMedian * 100) / 100,
      mmiPlus1Sigma: Math.round(mmiPlus1 * 100) / 100,
      mmiPlus2Sigma: Math.round(mmiPlus2 * 100) / 100,
      decisionMedian: mmiMedian >= 6.0 ? "CANDIDATE_AUTO_REPORT" : "NOTIFICATION_ONLY",
      decisionPlus2Sigma: mmiPlus2 >= 6.0 ? "CANDIDATE_AUTO_REPORT" : "NOTIFICATION_ONLY",
      canExceedMmi6: mmiPlus1 >= 6.0 || mmiPlus2 >= 6.0,
    });
  }

  return results;
}

export interface ContingencyEvaluationMetrics {
  totalEvaluated: number;
  actualPositiveHighRisk: number; // ShakeMap MMI >= 6.0 (TP + FN)
  actualNegativeLowRisk: number; // ShakeMap MMI < 6.0 (TN + FP)
  truePositives: number; // TP
  trueNegatives: number; // TN
  falsePositives: number; // FP (overprediction)
  falseNegatives: number; // FN (missed alerts)
  accuracyPercent: number; // (TP + TN) / Total
  recallPercent: number; // Sensitivity: TP / (TP + FN)
  missedAlertRatePercent: number; // FN / (TP + FN)
  precisionPercent: number; // TP / (TP + FP)
  specificityPercent: number; // TN / (TN + FP)
  f1Score: number;
}

export function computeContingencyMetrics(
  evaluations: { shakemapMmi: number; gmpeMmi: number }[]
): ContingencyEvaluationMetrics {
  const total = evaluations.length;
  let tp = 0;
  let tn = 0;
  let fp = 0;
  let fn = 0;

  for (const e of evaluations) {
    const actHigh = e.shakemapMmi >= 6.0;
    const predHigh = e.gmpeMmi >= 6.0;

    if (actHigh && predHigh) tp++;
    else if (!actHigh && !predHigh) tn++;
    else if (!actHigh && predHigh) fp++;
    else if (actHigh && !predHigh) fn++;
  }

  const actPos = tp + fn;
  const actNeg = tn + fp;

  const accuracy = (total > 0 ? (tp + tn) / total : 0) * 100;
  const recall = (actPos > 0 ? tp / actPos : 0) * 100;
  const missedAlertRate = (actPos > 0 ? fn / actPos : 0) * 100;
  const precision = (tp + fp > 0 ? tp / (tp + fp) : 1) * 100;
  const specificity = (actNeg > 0 ? tn / actNeg : 0) * 100;

  const precFrac = precision / 100;
  const recFrac = recall / 100;
  const f1 = precFrac + recFrac > 0 ? (2 * precFrac * recFrac) / (precFrac + recFrac) : 0;

  return {
    totalEvaluated: total,
    actualPositiveHighRisk: actPos,
    actualNegativeLowRisk: actNeg,
    truePositives: tp,
    trueNegatives: tn,
    falsePositives: fp,
    falseNegatives: fn,
    accuracyPercent: Math.round(accuracy * 100) / 100,
    recallPercent: Math.round(recall * 100) / 100,
    missedAlertRatePercent: Math.round(missedAlertRate * 100) / 100,
    precisionPercent: Math.round(precision * 100) / 100,
    specificityPercent: Math.round(specificity * 100) / 100,
    f1Score: Math.round(f1 * 10000) / 10000,
  };
}

export interface Vs30SensitivityRow {
  siteClass: "B" | "C" | "D" | "E";
  vs30: number;
  description: string;
  pgaMedianG: number;
  pgaPlus1SigmaG: number;
  mmiMedian: number;
  mmiPlus1Sigma: number;
  deltaMmiVsRock: number;
}

/**
 * Evaluates sensitivity of ground motion to accountable geotechnical Vs30 site conditions (NEHRP Site Classes B through E).
 * Highlights how soft alluvial basins in Indonesia amplify ground shaking by up to +1.2 MMI units.
 */
export function runVs30SensitivityAnalysis(params: {
  magnitude: number;
  depthKm: number;
  distanceKm: number;
  regime: TectonicRegime;
  mechanism?: FaultMechanism;
}): Vs30SensitivityRow[] {
  const classes: { siteClass: "B" | "C" | "D" | "E"; vs30: number; desc: string }[] = [
    { siteClass: "B", vs30: 760, desc: "Rock / B-C Boundary (USGS Reference)" },
    { siteClass: "C", vs30: 520, desc: "Dense Soil / Soft Rock" },
    { siteClass: "D", vs30: 270, desc: "Stiff Soil (Indonesian Urban Default)" },
    { siteClass: "E", vs30: 180, desc: "Soft Soil / Loose Alluvial Sediments" },
  ];

  const rockRes = evaluateGmpeGroundMotion({
    magnitude: params.magnitude,
    depthKm: params.depthKm,
    distanceEpiKm: params.distanceKm,
    vs30: 760,
    regime: params.regime,
    mechanism: params.mechanism,
  });
  const rockMmi = rockRes.mmi;

  return classes.map((c) => {
    const res = evaluateGmpeGroundMotion({
      magnitude: params.magnitude,
      depthKm: params.depthKm,
      distanceEpiKm: params.distanceKm,
      vs30: c.vs30,
      regime: params.regime,
      mechanism: params.mechanism,
    });
    const pga1s = Math.exp(Math.log(res.pgaG) + res.sigmaLn);
    const mmi1s = gmiceWorden2012PgaToMmi(pga1s * 980.665).mmi;

    return {
      siteClass: c.siteClass,
      vs30: c.vs30,
      description: c.desc,
      pgaMedianG: Math.round(res.pgaG * 10000) / 10000,
      pgaPlus1SigmaG: Math.round(pga1s * 10000) / 10000,
      mmiMedian: res.mmiRounded,
      mmiPlus1Sigma: Math.round(mmi1s * 100) / 100,
      deltaMmiVsRock: Math.round((res.mmi - rockMmi) * 100) / 100,
    };
  });
}

export interface TectonicRegimeComparisonRow {
  distanceKm: number;
  crustalMmi: number;
  interfaceMmi: number;
  intraslabMmi: number;
  crustalPgaG: number;
  interfacePgaG: number;
  intraslabPgaG: number;
}

/**
 * Compares ground motion attenuation across the three primary Indonesian tectonic regimes:
 * 1. Shallow Crustal (Boore et al., 2014)
 * 2. Subduction Interface (Zhao et al., 2006 + AB03 Interface)
 * 3. Subduction Intraslab (Zhao et al., 2006 + AB03 Intraslab)
 */
export function runTectonicRegimeComparison(params: {
  magnitude: number;
  depthKm: number;
  distancesKm?: number[];
  vs30?: number;
}): TectonicRegimeComparisonRow[] {
  const distances = params.distancesKm || [0, 10, 25, 50, 100, 150];
  const vs30 = params.vs30 || 270; // Class D standard

  return distances.map((d) => {
    const crustal = evaluateGmpeGroundMotion({
      magnitude: params.magnitude,
      depthKm: params.depthKm,
      distanceEpiKm: d,
      vs30,
      regime: "SHALLOW_CRUSTAL",
    });
    const iface = evaluateGmpeGroundMotion({
      magnitude: params.magnitude,
      depthKm: params.depthKm,
      distanceEpiKm: d,
      vs30,
      regime: "SUBDUCTION_INTERFACE",
    });
    const slab = evaluateGmpeGroundMotion({
      magnitude: params.magnitude,
      depthKm: params.depthKm,
      distanceEpiKm: d,
      vs30,
      regime: "SUBDUCTION_INTRASLAB",
    });

    return {
      distanceKm: d,
      crustalMmi: crustal.mmiRounded,
      interfaceMmi: iface.mmiRounded,
      intraslabMmi: slab.mmiRounded,
      crustalPgaG: Math.round(crustal.pgaG * 10000) / 10000,
      interfacePgaG: Math.round(iface.pgaG * 10000) / 10000,
      intraslabPgaG: Math.round(slab.pgaG * 10000) / 10000,
    };
  });
}
