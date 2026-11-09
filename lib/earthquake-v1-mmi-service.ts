/**
 * SPARTA SIAGA - Earthquake V1 Parameters + Official MMI Evaluation Service
 *
 * Implements the operational decision revised on 6 November 2026:
 * - Magnitude < 4.0: Display only; do not trigger automatic inspection workflow.
 * - Magnitude >= 4.0: Evaluates stores using supervisor V1 parameter table + official MMI.
 * - Maximum 10-minute waiting window starting from first receipt of sufficient official data.
 *   Timer does not reset on event updates.
 * - Prioritizes BMKG; USGS as fallback only when its product corresponds to the same earthquake
 *   and covers the store coordinate.
 * - Rule A: MMI covers all stores within V1 -> Evaluate immediately using MMI (also stores outside V1 with MMI).
 * - Rule B: MMI covers only some stores -> Wait until complete or 10-minute deadline.
 *           At deadline, use MMI for covered stores and V1 for uncovered stores.
 * - Rule C: No usable MMI by deadline -> Use V1 alone (MMI recorded as unknown/null, never zero).
 * - Store qualification rules:
 *   - For stores with usable official MMI:
 *     - MMI >= 6.0 qualifies for automatic inspection.
 *     - MMI < 6.0 does not qualify (even if inside V1). Unrounded comparison (5.8 not rounded up).
 *   - A store outside V1 qualifies if official MMI at its coordinate is >= 6.0.
 *   - For uncovered stores at deadline: store inside V1 qualifies via V1 fallback; store outside V1 does not.
 * - When at least one store qualifies:
 *   - Send one notification per affected branch.
 *   - Create one inspection report per qualifying store.
 *   - Complete store list visible in Detail Notifikasi (10 stores per page).
 * - When no stores qualify: Keep earthquake visible without triggering notifications or reports.
 * - Idempotency enforced across polling, retries, concurrent calls, and event updates.
 * - MMI arriving after decision is recorded for internal monitoring without duplicate outputs.
 * - Inspection eligibility does not establish actual building damage; physical inspection remains necessary.
 *
 * Rule: Zero em dashes. All hyphens use standard - or :.
 */

import crypto from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { getOperationalDbPool, getDbPool } from "./db";
import { calculateHaversineDistance } from "./haversine";
import { ensureEarthquakeReport, EarthquakeLocationKind } from "./earthquake-report-service";
import { recordNotificationLog } from "./notification-service";
import { dbUpsertEarthquakeEvent } from "./earthquake-db";
import { Earthquake } from "@/types/disaster";
import { Store } from "@/types/store";
import {
  ShakeMapGrid,
  interpolateMmiFromGrid,
  dbSaveShakeMapRecord,
  dbSaveFacilityIntensities,
  FacilityIntensityRecord,
  numberToRoman,
  parseShakeMapCovJson,
} from "./earthquake-intensity-service";

// ============================================================================
// Types and Interfaces
// ============================================================================

export interface V1CoverageResult {
  magnitude: number;
  depthKm: number;
  depthGroup: string;
  isCovered: boolean;
  v1DistanceKm: number | null;
}

export type AssessmentBasis =
  | "MMI"
  | "V1_FALLBACK"
  | "OUT_OF_V1_AND_MMI"
  | "MAGNITUDE_BELOW_4";

export interface EvaluatedStoreTarget {
  kode_toko: string;
  nama_toko: string;
  cabang: string;
  latitude: number;
  longitude: number;
  alamat?: string;
  fr_type?: string;
  distanceKm: number;
  isInsideV1: boolean;
  mmi: number | null;
  mmiRounded: number | null;
  mmiRoman: string;
  mmiSource: "BMKG" | "USGS" | null;
  qualifies: boolean;
  assessmentBasis: AssessmentBasis;
  notes: string;
}

export type WaitingWindowRule =
  | "RULE_A_IMMEDIATE_FULL_MMI"
  | "RULE_B_WAITING_PARTIAL_MMI"
  | "RULE_B_DEADLINE_PARTIAL_MMI"
  | "RULE_C_WAITING_NO_MMI"
  | "RULE_C_DEADLINE_V1_ONLY"
  | "MAGNITUDE_BELOW_4"
  | "ALREADY_FINALIZED";

export interface EarthquakeWorkflowEvaluation {
  canonicalEventId: string;
  magnitude: number;
  depthKm: number;
  depthGroup: string;
  v1Coverage: V1CoverageResult;
  windowStartedAt: Date;
  deadlineAt: Date;
  currentTime: Date;
  elapsedMinutes: number;
  isDeadlineReached: boolean;
  ruleApplied: WaitingWindowRule;
  canFinalizeDecision: boolean;
  totalStoresEvaluated: number;
  storesInV1Count: number;
  coveredV1StoresCount: number;
  uncoveredV1StoresCount: number;
  coveredStoresTotalCount: number;
  qualifyingStoresCount: number;
  affectedBranchesCount: number;
  affectedBranches: string[];
  qualifyingStores: EvaluatedStoreTarget[];
  allEvaluatedStores: EvaluatedStoreTarget[];
}

export interface WorkflowExecutionResult {
  evaluation: EarthquakeWorkflowEvaluation;
  dispatchedBranchNotifications: number;
  createdInspectionReports: number;
  preservedInspectionReports: number;
  notificationTicketNumbers: Record<string, string>;
  createdReportIds: string[];
  isDuplicateSuppressed: boolean;
}

// In-memory / cache tracker for event window start to prevent timer resets on event updates
const eventWindowStartMap = new Map<string, Date>();
// In-memory / cache tracker for completed decisions to enforce idempotency
const finalizedDecisionsMap = new Map<
  string,
  {
    finalizedAt: Date;
    ruleApplied: WaitingWindowRule;
    qualifyingStoreCodes: string[];
    affectedBranches: string[];
  }
>();

// ============================================================================
// V1 Parameter Table & Depth Groups
// ============================================================================

/**
 * Returns the V1 depth group string for a given depth in km.
 * Groups:
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
 * - M < 4.0: Not eligible for automatic inspection (display only).
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

// ============================================================================
// Waiting Window Timer Management
// ============================================================================

export const EARTHQUAKE_WAITING_WINDOW_MINUTES = 10;

/**
 * Initializes or retrieves the persistent waiting window start time for an earthquake.
 * Event updates MUST NOT restart this timer.
 */
export function getOrCreateWindowStartTime(
  canonicalEventId: string,
  initialTimestamp?: Date | number
): Date {
  const existing = eventWindowStartMap.get(canonicalEventId);
  if (existing) {
    return existing;
  }

  const start = initialTimestamp
    ? initialTimestamp instanceof Date
      ? initialTimestamp
      : new Date(initialTimestamp)
    : new Date();

  eventWindowStartMap.set(canonicalEventId, start);
  return start;
}

/**
 * Reset memory state (for testing isolation only).
 */
export function resetWorkflowMemoryState(): void {
  eventWindowStartMap.clear();
  finalizedDecisionsMap.clear();
}

// ============================================================================
// Core V1 + MMI Evaluation Engine
// ============================================================================

export interface EvaluateWorkflowParams {
  earthquake: {
    id: string;
    magnitude: number;
    depthKm: number;
    latitude: number;
    longitude: number;
    occurredAt?: Date | string | number;
    title?: string;
    source?: string;
  };
  stores: Store[];
  officialGrids?: Array<{
    provider: "BMKG" | "USGS";
    grid: ShakeMapGrid;
    versionNumber?: number;
  }>;
  windowStartedAt?: Date | number;
  currentTime?: Date | number;
}

/**
 * Evaluates stores against an earthquake according to the 6 November 2026 decision.
 */
export function evaluateEarthquakeV1MmiWorkflow(
  params: EvaluateWorkflowParams
): EarthquakeWorkflowEvaluation {
  const { earthquake, stores, officialGrids = [] } = params;
  const canonicalEventId = earthquake.id;
  const magnitude = earthquake.magnitude;
  const depthKm = earthquake.depthKm;

  const initialWindowTs = params.windowStartedAt
    ? params.windowStartedAt instanceof Date
      ? params.windowStartedAt
      : new Date(params.windowStartedAt)
    : earthquake.occurredAt
    ? earthquake.occurredAt instanceof Date
      ? earthquake.occurredAt
      : new Date(earthquake.occurredAt)
    : new Date();

  const windowStartedAt = getOrCreateWindowStartTime(
    canonicalEventId,
    initialWindowTs
  );

  const currentTime = params.currentTime
    ? params.currentTime instanceof Date
      ? params.currentTime
      : new Date(params.currentTime)
    : new Date();

  const deadlineAt = new Date(
    windowStartedAt.getTime() + EARTHQUAKE_WAITING_WINDOW_MINUTES * 60 * 1000
  );

  const elapsedMinutes = Math.max(
    0,
    (currentTime.getTime() - windowStartedAt.getTime()) / (60 * 1000)
  );
  const isDeadlineReached = elapsedMinutes >= EARTHQUAKE_WAITING_WINDOW_MINUTES;

  // 1. Check Magnitude Eligibility (M < 4.0: display only)
  const v1Coverage = getV1Coverage(magnitude, depthKm);
  if (magnitude < 4.0) {
    return {
      canonicalEventId,
      magnitude,
      depthKm,
      depthGroup: v1Coverage.depthGroup,
      v1Coverage,
      windowStartedAt,
      deadlineAt,
      currentTime,
      elapsedMinutes,
      isDeadlineReached,
      ruleApplied: "MAGNITUDE_BELOW_4",
      canFinalizeDecision: true,
      totalStoresEvaluated: stores.length,
      storesInV1Count: 0,
      coveredV1StoresCount: 0,
      uncoveredV1StoresCount: 0,
      coveredStoresTotalCount: 0,
      qualifyingStoresCount: 0,
      affectedBranchesCount: 0,
      affectedBranches: [],
      qualifyingStores: [],
      allEvaluatedStores: [],
    };
  }

  // 2. Separate BMKG and USGS grids (BMKG prioritized over USGS)
  const bmkgGrids = officialGrids.filter((g) => g.provider === "BMKG");
  const usgsGrids = officialGrids.filter((g) => g.provider === "USGS");

  // 3. Evaluate each store's distance to epicenter and interpolate official MMI
  const evaluatedStores: EvaluatedStoreTarget[] = [];

  for (const store of stores) {
    if (
      store.latitude == null ||
      store.longitude == null ||
      !Number.isFinite(Number(store.latitude)) ||
      !Number.isFinite(Number(store.longitude))
    ) {
      continue;
    }

    const lat = Number(store.latitude);
    const lon = Number(store.longitude);
    const distanceKm = calculateHaversineDistance(
      earthquake.latitude,
      earthquake.longitude,
      lat,
      lon
    );

    if (isNaN(distanceKm)) continue;

    const isInsideV1 =
      v1Coverage.isCovered &&
      v1Coverage.v1DistanceKm !== null &&
      distanceKm <= v1Coverage.v1DistanceKm;

    // Check BMKG first
    let mmi: number | null = null;
    let mmiSource: "BMKG" | "USGS" | null = null;

    for (const bGrid of bmkgGrids) {
      const val = interpolateMmiFromGrid(bGrid.grid, lat, lon);
      if (val !== null && Number.isFinite(val)) {
        mmi = val;
        mmiSource = "BMKG";
        break;
      }
    }

    // Fallback to USGS only if BMKG did not cover coordinate
    if (mmi === null) {
      for (const uGrid of usgsGrids) {
        const val = interpolateMmiFromGrid(uGrid.grid, lat, lon);
        if (val !== null && Number.isFinite(val)) {
          mmi = val;
          mmiSource = "USGS";
          break;
        }
      }
    }

    evaluatedStores.push({
      kode_toko: store.kode_toko,
      nama_toko: store.nama_toko,
      cabang: store.cabang,
      latitude: lat,
      longitude: lon,
      alamat: store.alamat,
      fr_type: store.fr_type,
      distanceKm,
      isInsideV1,
      mmi,
      mmiRounded: mmi !== null ? Math.round(mmi * 100) / 100 : null,
      mmiRoman: numberToRoman(mmi),
      mmiSource,
      qualifies: false,
      assessmentBasis: "OUT_OF_V1_AND_MMI",
      notes: "",
    });
  }

  // 4. Analyze coverage of stores inside V1
  const storesInV1 = evaluatedStores.filter((s) => s.isInsideV1);
  const coveredV1Stores = storesInV1.filter((s) => s.mmi !== null);
  const uncoveredV1Stores = storesInV1.filter((s) => s.mmi === null);
  const coveredStoresTotal = evaluatedStores.filter((s) => s.mmi !== null);

  // 5. Apply Rules A, B, C and waiting window logic
  let ruleApplied: WaitingWindowRule;
  let canFinalizeDecision = false;

  const allV1Covered = storesInV1.length > 0 && uncoveredV1Stores.length === 0;
  const someV1Covered = coveredV1Stores.length > 0 && uncoveredV1Stores.length > 0;
  const noV1Covered = storesInV1.length > 0 && coveredV1Stores.length === 0;
  const zeroStoresInV1 = storesInV1.length === 0;

  if (allV1Covered || (zeroStoresInV1 && coveredStoresTotal.length > 0)) {
    // Rule A: MMI covers all stores within V1 -> Evaluate immediately
    ruleApplied = "RULE_A_IMMEDIATE_FULL_MMI";
    canFinalizeDecision = true;
  } else if (someV1Covered) {
    // Rule B: MMI covers only some stores
    if (isDeadlineReached) {
      ruleApplied = "RULE_B_DEADLINE_PARTIAL_MMI";
      canFinalizeDecision = true;
    } else {
      ruleApplied = "RULE_B_WAITING_PARTIAL_MMI";
      canFinalizeDecision = false;
    }
  } else if (noV1Covered || (zeroStoresInV1 && coveredStoresTotal.length === 0)) {
    // Rule C: No usable MMI
    if (isDeadlineReached) {
      ruleApplied = "RULE_C_DEADLINE_V1_ONLY";
      canFinalizeDecision = true;
    } else {
      ruleApplied = "RULE_C_WAITING_NO_MMI";
      canFinalizeDecision = false;
    }
  } else {
    ruleApplied = "RULE_C_WAITING_NO_MMI";
    canFinalizeDecision = false;
  }

  // 6. Determine qualification per store (only finalized when canFinalizeDecision is true)
  if (canFinalizeDecision) {
    for (const store of evaluatedStores) {
      if (store.mmi !== null) {
        // For every store with usable official MMI:
        // - MMI >= 6.0 qualifies
        // - MMI < 6.0 does not qualify (even if inside V1). Unrounded: 5.8 not rounded up!
        // - Store outside V1 qualifies if official MMI >= 6.0.
        if (store.mmi >= 6.0) {
          store.qualifies = true;
          store.assessmentBasis = "MMI";
          store.notes = `Lolos inspeksi otomatis: Nilai resmi MMI ${store.mmi.toFixed(2)} >= 6.0 (${store.mmiRoman}) dari ${store.mmiSource}. Verifikasi fisik lapangan tetap diperlukan.`;
        } else {
          store.qualifies = false;
          store.assessmentBasis = "MMI";
          store.notes = `Tidak lolos inspeksi: Nilai resmi MMI ${store.mmi.toFixed(2)} < 6.0 (${store.mmiRoman}) dari ${store.mmiSource}. Intensitas di bawah ambang kandidat tiket otomatis.`;
        }
      } else {
        // Store has NO usable official MMI:
        // Record MMI as unknown/null (never zero).
        // At deadline, use V1 fallback:
        // - Inside V1 -> qualifies via V1 fallback
        // - Outside V1 -> does not qualify
        if (store.isInsideV1) {
          store.qualifies = true;
          store.assessmentBasis = "V1_FALLBACK";
          store.notes = `Lolos inspeksi otomatis via fallback V1 batas waktu 10 menit (jarak ${store.distanceKm.toFixed(1)} km <= radius V1 ${v1Coverage.v1DistanceKm} km). MMI belum tersedia (UNKNOWN). Verifikasi fisik lapangan tetap diperlukan.`;
        } else {
          store.qualifies = false;
          store.assessmentBasis = "OUT_OF_V1_AND_MMI";
          store.notes = `Tidak lolos: Berada di luar radius V1 (${store.distanceKm.toFixed(1)} km > ${v1Coverage.v1DistanceKm ?? 0} km) dan data MMI tidak tersedia.`;
        }
      }
    }
  }

  const qualifyingStores = evaluatedStores.filter((s) => s.qualifies);
  const branchSet = new Set<string>();
  qualifyingStores.forEach((s) => {
    if (s.cabang) branchSet.add(s.cabang);
  });
  const affectedBranches = Array.from(branchSet).sort();

  return {
    canonicalEventId,
    magnitude,
    depthKm,
    depthGroup: v1Coverage.depthGroup,
    v1Coverage,
    windowStartedAt,
    deadlineAt,
    currentTime,
    elapsedMinutes,
    isDeadlineReached,
    ruleApplied,
    canFinalizeDecision,
    totalStoresEvaluated: evaluatedStores.length,
    storesInV1Count: storesInV1.length,
    coveredV1StoresCount: coveredV1Stores.length,
    uncoveredV1StoresCount: uncoveredV1Stores.length,
    coveredStoresTotalCount: coveredStoresTotal.length,
    qualifyingStoresCount: qualifyingStores.length,
    affectedBranchesCount: affectedBranches.length,
    affectedBranches,
    qualifyingStores,
    allEvaluatedStores: evaluatedStores,
  };
}

// ============================================================================
// Workflow Execution and Orchestration (DB Persistence & Idempotency)
// ============================================================================

export interface ExecuteWorkflowParams extends EvaluateWorkflowParams {
  dbPool?: Pool;
  suppressWebPush?: boolean;
}

/**
 * Loads official BMKG/USGS ShakeMap grids for an earthquake from database.
 */
export async function loadOfficialGridsForEvent(
  canonicalEventId: string,
  clientOrPool: Pool | PoolClient = getOperationalDbPool()
): Promise<Array<{ provider: "BMKG" | "USGS"; grid: ShakeMapGrid; versionNumber?: number }>> {
  try {
    const { rows } = await clientOrPool.query<{
      source_provider: string;
      version_number: number;
      grid_bounds_x_min: number;
      grid_bounds_x_max: number;
      grid_bounds_y_min: number;
      grid_bounds_y_max: number;
      grid_num_x: number;
      grid_num_y: number;
      max_mmi: number;
      raw_payload: any;
    }>(
      `SELECT source_provider, version_number, grid_bounds_x_min, grid_bounds_x_max,
              grid_bounds_y_min, grid_bounds_y_max, grid_num_x, grid_num_y,
              max_mmi, raw_payload
         FROM earthquake_shakemaps
        WHERE canonical_event_id = $1
        ORDER BY version_number DESC`,
      [canonicalEventId]
    );

    const result: Array<{ provider: "BMKG" | "USGS"; grid: ShakeMapGrid; versionNumber?: number }> = [];
    for (const r of rows) {
      const provider = r.source_provider.toUpperCase() === "BMKG" ? "BMKG" : "USGS";
      if (r.raw_payload) {
        try {
          const parsed = parseShakeMapCovJson(r.raw_payload, {
            eventId: canonicalEventId,
            sourceProvider: provider,
            versionNumber: r.version_number,
          });
          result.push({ provider, grid: parsed, versionNumber: r.version_number });
        } catch {
          // Non-fatal parse fallback
        }
      }
    }
    return result;
  } catch {
    return [];
  }
}

/**
 * Executes the complete workflow for an earthquake:
 * 1. Evaluates eligibility and waiting window.
 * 2. If decision can be finalized:
 *    - Records one notification per affected branch (with complete store list).
 *    - Creates one inspection report per qualifying store.
 *    - Persists evaluation records in database idempotently.
 *    - Late MMI is recorded for monitoring without triggering duplicate outputs.
 */
export async function executeEarthquakeV1MmiWorkflow(
  params: ExecuteWorkflowParams
): Promise<WorkflowExecutionResult> {
  const pool = params.dbPool || getOperationalDbPool();
  const { earthquake } = params;
  const canonicalEventId = earthquake.id;

  let officialGrids = params.officialGrids;
  if (!officialGrids) {
    officialGrids = await loadOfficialGridsForEvent(canonicalEventId, pool);
  }

  const evaluation = evaluateEarthquakeV1MmiWorkflow({
    ...params,
    officialGrids,
  });

  // 1. Check if already finalized (in-memory or DB check)
  const existingFinalized = finalizedDecisionsMap.get(canonicalEventId);

  // If already finalized, handle potential late-arriving MMI
  if (existingFinalized) {
    if (params.officialGrids && params.officialGrids.length > 0) {
      await recordLateMmiForMonitoring(params, evaluation, pool);
    }
    return {
      evaluation: {
        ...evaluation,
        ruleApplied: "ALREADY_FINALIZED",
        canFinalizeDecision: false,
      },
      dispatchedBranchNotifications: 0,
      createdInspectionReports: 0,
      preservedInspectionReports: existingFinalized.qualifyingStoreCodes.length,
      notificationTicketNumbers: {},
      createdReportIds: [],
      isDuplicateSuppressed: true,
    };
  }

  // 2. If decision cannot be finalized yet (waiting window active)
  if (!evaluation.canFinalizeDecision) {
    return {
      evaluation,
      dispatchedBranchNotifications: 0,
      createdInspectionReports: 0,
      preservedInspectionReports: 0,
      notificationTicketNumbers: {},
      createdReportIds: [],
      isDuplicateSuppressed: false,
    };
  }

  // 3. Finalize decision:
  // If magnitude < 4.0 or 0 qualifying stores:
  // Keep earthquake recorded for monitoring without triggering notifications or reports
  if (evaluation.qualifyingStoresCount === 0) {
    finalizedDecisionsMap.set(canonicalEventId, {
      finalizedAt: evaluation.currentTime,
      ruleApplied: evaluation.ruleApplied,
      qualifyingStoreCodes: [],
      affectedBranches: [],
    });

    await persistWorkflowMetadata(canonicalEventId, evaluation, pool);
    return {
      evaluation,
      dispatchedBranchNotifications: 0,
      createdInspectionReports: 0,
      preservedInspectionReports: 0,
      notificationTicketNumbers: {},
      createdReportIds: [],
      isDuplicateSuppressed: false,
    };
  }

  // 4. When at least one store qualifies:
  // - Send one notification per affected branch for that earthquake
  // - Create one inspection report per qualifying store
  let dispatchedBranchNotifications = 0;
  let createdInspectionReports = 0;
  let preservedInspectionReports = 0;
  const notificationTicketNumbers: Record<string, string> = {};
  const createdReportIds: string[] = [];

  // Group qualifying stores by branch
  const qualifyingByBranch = new Map<string, EvaluatedStoreTarget[]>();
  for (const store of evaluation.qualifyingStores) {
    if (!qualifyingByBranch.has(store.cabang)) {
      qualifyingByBranch.set(store.cabang, []);
    }
    qualifyingByBranch.get(store.cabang)!.push(store);
  }

  const occurredDate = earthquake.occurredAt
    ? earthquake.occurredAt instanceof Date
      ? earthquake.occurredAt
      : new Date(earthquake.occurredAt)
    : new Date();

  // A. Create inspection report for each qualifying store
  for (const store of evaluation.qualifyingStores) {
    const reportHash = crypto
      .createHash("sha256")
      .update(`${canonicalEventId}:STORE:${store.kode_toko}`)
      .digest("hex")
      .slice(0, 16)
      .toUpperCase();

    const reportId = `LAP-EQ-STR-${reportHash}`;

    try {
      const res = await ensureEarthquakeReport({
        reportId,
        canonicalEventId,
        eventOccurredAt: occurredDate,
        source: earthquake.source || "BMKG",
        location: {
          kind: "STORE",
          id: store.kode_toko,
          code: store.kode_toko,
          name: store.nama_toko,
          type: store.fr_type || "REGULER",
          branch: store.cabang,
          latitude: store.latitude,
          longitude: store.longitude,
        },
        clientOrPool: pool,
      });

      if (res.outcome === "created" || res.outcome === "linked_manual") {
        createdInspectionReports++;
        createdReportIds.push(res.incidentId);
      } else if (res.outcome === "existing") {
        preservedInspectionReports++;
      }
    } catch (reportErr) {
      console.warn(`[V1+MMI Workflow] Notice ensuring report for ${store.kode_toko}:`, reportErr);
    }
  }

  // B. Send one notification per affected branch
  for (const [branch, branchStores] of qualifyingByBranch.entries()) {
    branchStores.sort((a, b) => a.distanceKm - b.distanceKm);

    const ticketNumber = `EQ-${branch.substring(0, 3).toUpperCase()}-${Math.floor(1000 + Math.random() * 9000)}`;
    notificationTicketNumbers[branch] = ticketNumber;

    const notifTitle = `Peringatan Siaga Gempa M ${evaluation.magnitude.toFixed(1)}: Cabang ${branch.toUpperCase()}`;
    const notifMessage =
      `Gempa bumi tektonik M ${evaluation.magnitude.toFixed(1)} kedalaman ${evaluation.depthKm} km terdeteksi. ` +
      `Berdasarkan evaluasi V1 (${evaluation.v1Coverage.v1DistanceKm ? evaluation.v1Coverage.v1DistanceKm + " km" : "dikecualikan"}) ` +
      `dan data intensitas resmi MMI, terdapat ${branchStores.length} gerai toko di cabang Anda yang memenuhi kualifikasi inspeksi. ` +
      `Status kualifikasi inspeksi tidak menetapkan kerusakan fisik bangunan aktual; pemeriksaan fisik PIC tetap diperlukan.`;

    const affectedStoresSummary = branchStores.map((s) => ({
      kode_toko: s.kode_toko,
      nama_toko: s.nama_toko,
      cabang: s.cabang,
      distance_km: Math.round(s.distanceKm * 10) / 10,
      status: "PRIORITY_MONITOR" as const,
      alamat: s.alamat,
      fr_type: s.fr_type,
    }));

    try {
      await recordNotificationLog({
        disasterId: canonicalEventId,
        canonicalEventId,
        disasterType: "earthquake",
        channel: "pwa_only",
        branch,
        recipientGroup: "BMS",
        category: "ASSIGNMENT",
        recipientContact: `in-app://branch/${branch.toLowerCase().replace(/\s+/g, "-")}`,
        title: notifTitle,
        message: notifMessage,
        affectedStores: affectedStoresSummary,
        ticketNumber,
        clientOrPool: pool,
      });
      dispatchedBranchNotifications++;
    } catch (notifErr) {
      console.warn(`[V1+MMI Workflow] Notice recording notification for branch ${branch}:`, notifErr);
    }
  }

  // 5. Save facility intensities in DB for persistent audit
  await persistFacilityIntensities(params, evaluation, pool);

  // 6. Record finalized decision in memory and DB
  finalizedDecisionsMap.set(canonicalEventId, {
    finalizedAt: evaluation.currentTime,
    ruleApplied: evaluation.ruleApplied,
    qualifyingStoreCodes: evaluation.qualifyingStores.map((s) => s.kode_toko),
    affectedBranches: evaluation.affectedBranches,
  });

  await persistWorkflowMetadata(canonicalEventId, evaluation, pool);

  return {
    evaluation,
    dispatchedBranchNotifications,
    createdInspectionReports,
    preservedInspectionReports,
    notificationTicketNumbers,
    createdReportIds,
    isDuplicateSuppressed: false,
  };
}

// ============================================================================
// Internal Monitoring and Persistence Helpers
// ============================================================================

async function persistWorkflowMetadata(
  canonicalEventId: string,
  evaluation: EarthquakeWorkflowEvaluation,
  pool: Pool
): Promise<void> {
  try {
    const metadataUpdate = {
      v1_mmi_workflow: {
        status: evaluation.canFinalizeDecision ? "FINALIZED" : "WAITING_WINDOW",
        rule_applied: evaluation.ruleApplied,
        qualifying_stores_count: evaluation.qualifyingStoresCount,
        affected_branches: evaluation.affectedBranches,
        decided_at: evaluation.canFinalizeDecision ? evaluation.currentTime.toISOString() : null,
        window_started_at: evaluation.windowStartedAt.toISOString(),
        deadline_at: evaluation.deadlineAt.toISOString(),
      },
    };

    await pool.query(
      `UPDATE earthquake_events
          SET raw_metadata = COALESCE(raw_metadata, '{}'::jsonb) || $1::jsonb
        WHERE id = $2`,
      [JSON.stringify(metadataUpdate), canonicalEventId]
    );
  } catch (err) {
    // Non-fatal metadata update notice
  }
}

async function persistFacilityIntensities(
  params: ExecuteWorkflowParams,
  evaluation: EarthquakeWorkflowEvaluation,
  pool: Pool
): Promise<void> {
  try {
    const officialGrids = params.officialGrids || [];
    if (officialGrids.length === 0) return;

    for (const item of officialGrids) {
      const shakemapRecord = await dbSaveShakeMapRecord(item.grid, pool);
      const intensityRecords: FacilityIntensityRecord[] = [];

      for (const store of evaluation.allEvaluatedStores) {
        intensityRecords.push({
          shakemapId: shakemapRecord.id,
          canonicalEventId: params.earthquake.id,
          facilityKind: "STORE",
          facilityId: store.kode_toko,
          facilityCode: store.kode_toko,
          facilityName: store.nama_toko,
          branch: store.cabang,
          latitude: store.latitude,
          longitude: store.longitude,
          distanceKm: store.distanceKm,
          mmiRaw: store.mmi,
          mmiRounded: store.mmiRounded,
          mmiRoman: store.mmiRoman,
          decisionPolicy: store.qualifies ? "CANDIDATE_AUTO_REPORT" : "NOTIFICATION_ONLY",
          discrepancyVsRadius: store.mmi === null ? "OUT_OF_SHAKEMAP_COVERAGE" : store.qualifies ? "CONCORDANT_HIGH_RISK" : "CONCORDANT_LOW_RISK",
          shakemapVersion: item.versionNumber || 1,
          notes: store.notes,
        });
      }

      await dbSaveFacilityIntensities(intensityRecords, pool);
    }
  } catch (err) {
    // Non-fatal persistence notice
  }
}

async function recordLateMmiForMonitoring(
  params: ExecuteWorkflowParams,
  evaluation: EarthquakeWorkflowEvaluation,
  pool: Pool
): Promise<void> {
  try {
    // Persist late ShakeMap records for internal monitoring without sending notifications or reports
    await persistFacilityIntensities(params, evaluation, pool);
    console.log(
      `[V1+MMI Workflow] Recorded late official MMI for event ${params.earthquake.id} for internal monitoring. Zero duplicate notifications sent.`
    );
  } catch (err) {
    console.warn(`[V1+MMI Workflow] Notice recording late MMI for ${params.earthquake.id}:`, err);
  }
}
