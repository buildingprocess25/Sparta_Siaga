/**
 * Pure shared helper for SPARTA SIAGA Earthquake V1 Parameters.
 * 
 * Single source of truth for the supervisor-provided V1 parameter table
 * revised on 6 November 2026.
 *
 * This module is pure TypeScript with ZERO external, server, database,
 * or Node.js runtime dependencies. It is safe to import in client bundles,
 * server services, API routes, and test suites.
 *
 * Rule: Zero em dashes. Standard hyphens (-) or colons (:) only.
 */

export interface V1CoverageResult {
  magnitude: number;
  depthKm: number;
  depthGroup: string;
  isCovered: boolean;
  v1DistanceKm: number | null;
}

/**
 * Returns the V1 depth group string for a given depth in km.
 * Preserves the exact supervisor depth classifications:
 * - 0–10 km
 * - >10–20 km
 * - >20–30 km (e.g. 20.5 km)
 * - >30–40 km
 * - >40–50 km
 * - >50 km
 */
export function getV1DepthGroup(depthKm: number): string {
  if (!Number.isFinite(depthKm) || depthKm < 0) return "0–10 km";
  if (depthKm <= 10) return "0–10 km";
  if (depthKm <= 20) return ">10–20 km";
  if (depthKm <= 30) return ">20–30 km";
  if (depthKm <= 40) return ">30–40 km";
  if (depthKm <= 50) return ">40–50 km";
  return ">50 km";
}

/**
 * Evaluates whether an earthquake is covered by the supervisor-provided V1 parameter table.
 * Preserves original V1 depth groups and excluded/red cells:
 * - 4.0 <= M < 5.0: Covered depth up to 30 km -> V1 distance 0-20 km. Depth > 30 km excluded.
 * - 5.0 <= M < 6.0: Covered depth up to 30 km -> V1 distance 0-50 km. Depth > 30 km excluded.
 * - 6.0 <= M < 7.0: Covered depth up to 40 km -> V1 distance 0-160 km. Depth > 40 km excluded.
 * - 7.0 <= M < 8.0: Covered depth up to 50 km -> V1 distance 0-200 km. Depth > 50 km excluded.
 * - M >= 8.0: All depth groups covered by V1 -> V1 distance 0-250 km.
 * - M < 4.0: Not eligible for automatic inspection workflow (monitoring only).
 *
 * Excluded combinations return isCovered: false and v1DistanceKm: null.
 * An unavailable V1 range must never convert to zero, a default radius, or an extrapolated value.
 */
export function getV1Coverage(magnitude: number, depthKm: number): V1CoverageResult {
  const safeMag = Number.isFinite(magnitude) ? magnitude : 0;
  const safeDepth = Number.isFinite(depthKm) && depthKm >= 0 ? depthKm : 10;
  const depthGroup = getV1DepthGroup(safeDepth);

  if (safeMag < 4.0) {
    return {
      magnitude: safeMag,
      depthKm: safeDepth,
      depthGroup,
      isCovered: false,
      v1DistanceKm: null,
    };
  }

  if (safeMag < 5.0) {
    if (safeDepth <= 30) {
      return { magnitude: safeMag, depthKm: safeDepth, depthGroup, isCovered: true, v1DistanceKm: 20 };
    }
    return { magnitude: safeMag, depthKm: safeDepth, depthGroup, isCovered: false, v1DistanceKm: null };
  }

  if (safeMag < 6.0) {
    if (safeDepth <= 30) {
      return { magnitude: safeMag, depthKm: safeDepth, depthGroup, isCovered: true, v1DistanceKm: 50 };
    }
    return { magnitude: safeMag, depthKm: safeDepth, depthGroup, isCovered: false, v1DistanceKm: null };
  }

  if (safeMag < 7.0) {
    if (safeDepth <= 40) {
      return { magnitude: safeMag, depthKm: safeDepth, depthGroup, isCovered: true, v1DistanceKm: 160 };
    }
    return { magnitude: safeMag, depthKm: safeDepth, depthGroup, isCovered: false, v1DistanceKm: null };
  }

  if (safeMag < 8.0) {
    if (safeDepth <= 50) {
      return { magnitude: safeMag, depthKm: safeDepth, depthGroup, isCovered: true, v1DistanceKm: 200 };
    }
    return { magnitude: safeMag, depthKm: safeDepth, depthGroup, isCovered: false, v1DistanceKm: null };
  }

  // M >= 8.0: All depth groups covered by V1
  return { magnitude: safeMag, depthKm: safeDepth, depthGroup, isCovered: true, v1DistanceKm: 250 };
}

/**
 * Returns true if the earthquake magnitude meets the minimum threshold (M >= 4.0)
 * for automatic inspection workflow consideration.
 */
export function isEarthquakeV1Eligible(magnitude: number): boolean {
  return Number.isFinite(magnitude) && magnitude >= 4.0;
}

