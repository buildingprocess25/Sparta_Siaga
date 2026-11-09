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
import { getOperationalDbPool } from "./db";
import { calculateHaversineDistance } from "./haversine";
import { ensureEarthquakeReport } from "./earthquake-report-service";
import { recordNotificationLog } from "./notification-service";
import { fetchOfficialMmiForEarthquake } from "./official-earthquake-mmi";
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
  selectedGridChecksum?: string;
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
    timestamp?: number;
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
    : new Date(params.currentTime ?? Date.now());

  if (params.windowStartedAt) eventWindowStartMap.set(canonicalEventId, initialWindowTs);

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
  const matchingGrids = officialGrids.filter((g) => g.grid.eventId === canonicalEventId);
  const bmkgGrids = matchingGrids.filter((g) => g.provider === "BMKG");
  const usgsGrids = matchingGrids.filter((g) => g.provider === "USGS");

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
    let selectedGridChecksum: string | undefined;

    for (const bGrid of bmkgGrids) {
      const val = interpolateMmiFromGrid(bGrid.grid, lat, lon);
      if (val !== null && Number.isFinite(val)) {
        mmi = val;
        mmiSource = "BMKG";
        selectedGridChecksum = bGrid.grid.checksumSha256;
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
          selectedGridChecksum = uGrid.grid.checksumSha256;
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
      selectedGridChecksum,
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
  fetchOfficialMmi?: typeof fetchOfficialMmiForEarthquake;
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
      `SELECT DISTINCT ON (source_provider) source_provider, version_number, grid_bounds_x_min, grid_bounds_x_max,
              grid_bounds_y_min, grid_bounds_y_max, grid_num_x, grid_num_y,
              max_mmi, raw_payload
         FROM earthquake_shakemaps
        WHERE canonical_event_id = $1
        ORDER BY source_provider, version_number DESC`,
      [canonicalEventId]
    );

    const result: Array<{ provider: "BMKG" | "USGS"; grid: ShakeMapGrid; versionNumber?: number }> = [];
    for (const r of rows) {
      const provider = r.source_provider.toUpperCase();
      if (provider !== "BMKG" && provider !== "USGS") continue;
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
  } catch (error) {
    throw new Error("Cannot load official MMI cache", { cause: error });
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
type StoredDecision = Omit<EarthquakeWorkflowEvaluation, "allEvaluatedStores">;
interface WorkflowState {
  status: "WAITING_WINDOW" | "DECIDED" | "FINALIZED";
  window_started_at: string;
  deadline_at: string;
  decision?: StoredDecision;
  finalized_at?: string;
}

async function withWorkflowLock<T>(pool: Pool, eventId: string, work: (client: PoolClient, state: WorkflowState | undefined) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`v1-mmi:${eventId}`]);
    const { rows } = await client.query("SELECT raw_metadata FROM earthquake_events WHERE id = $1 FOR UPDATE", [eventId]);
    if (!rows[0]) throw new Error(`Earthquake ${eventId} must be recorded before assessment`);
    const result = await work(client, rows[0].raw_metadata?.v1_mmi_workflow);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function saveWorkflowState(client: PoolClient, eventId: string, state: WorkflowState): Promise<void> {
  await client.query(
    `UPDATE earthquake_events
        SET raw_metadata = COALESCE(raw_metadata, '{}'::jsonb) || $1::jsonb
      WHERE id = $2`,
    [JSON.stringify({ v1_mmi_workflow: state }), eventId]
  );
}

function restoreDecision(decision: StoredDecision): EarthquakeWorkflowEvaluation {
  return {
    ...decision,
    windowStartedAt: new Date(decision.windowStartedAt),
    deadlineAt: new Date(decision.deadlineAt),
    currentTime: new Date(decision.currentTime),
    allEvaluatedStores: decision.qualifyingStores,
  };
}

function emptyExecution(evaluation: EarthquakeWorkflowEvaluation, duplicate = false): WorkflowExecutionResult {
  return {
    evaluation,
    dispatchedBranchNotifications: 0,
    createdInspectionReports: 0,
    preservedInspectionReports: duplicate ? evaluation.qualifyingStoresCount : 0,
    notificationTicketNumbers: {},
    createdReportIds: [],
    isDuplicateSuppressed: duplicate,
  };
}

export async function executeEarthquakeV1MmiWorkflow(params: ExecuteWorkflowParams): Promise<WorkflowExecutionResult> {
  const pool = params.dbPool || getOperationalDbPool();
  const { earthquake } = params;
  const eventId = earthquake.id;
  const now = new Date(params.currentTime ?? Date.now());
  if (![earthquake.magnitude, earthquake.depthKm, earthquake.latitude, earthquake.longitude].every(Number.isFinite) || earthquake.depthKm < 0) {
    throw new Error("Sufficient valid official earthquake parameters are required");
  }

  // Persist receipt time before network calls; earthquake origin time is not the waiting-window start.
  const initialState = await withWorkflowLock(pool, eventId, async (client, state) => {
    if (state) return state;
    const start = new Date(params.windowStartedAt ?? now);
    const initial: WorkflowState = {
      status: "WAITING_WINDOW",
      window_started_at: start.toISOString(),
      deadline_at: new Date(start.getTime() + 10 * 60_000).toISOString(),
    };
    await saveWorkflowState(client, eventId, initial);
    return initial;
  });

  let officialGrids = params.officialGrids;
  if (!officialGrids) {
    officialGrids = await loadOfficialGridsForEvent(eventId, pool);
    const needsFallback = params.stores.some((store) => !officialGrids!.some((item) =>
      item.provider === "BMKG" && interpolateMmiFromGrid(item.grid, Number(store.latitude), Number(store.longitude)) !== null
    ));
    if (earthquake.magnitude >= 4 && needsFallback) {
      const fetched = await (params.fetchOfficialMmi ?? fetchOfficialMmiForEarthquake)(earthquake);
      if (fetched) {
        await dbSaveShakeMapRecord(fetched.grid, pool);
        officialGrids = [...officialGrids.filter((g) => g.provider !== fetched.provider), fetched];
      }
    }
  }
  officialGrids = officialGrids.filter((item) => item.grid.eventId === eventId);
  const evaluated = evaluateEarthquakeV1MmiWorkflow({
    ...params,
    officialGrids,
    windowStartedAt: new Date(initialState.window_started_at),
    currentTime: params.currentTime ?? new Date(),
  });

  // Freeze targets independently of delivery so retries cannot adopt late MMI as a new decision.
  const state = await withWorkflowLock(pool, eventId, async (client, existing) => {
    if (!existing) throw new Error("Missing persisted earthquake workflow state");
    await persistFacilityIntensities({ ...params, officialGrids }, evaluated, client);
    if (existing.status !== "WAITING_WINDOW" || !evaluated.canFinalizeDecision) return existing;
    const { allEvaluatedStores: _, ...decision } = evaluated;
    const decided: WorkflowState = { ...existing, status: "DECIDED", decision };
    await saveWorkflowState(client, eventId, decided);
    return decided;
  });
  if (state.status === "WAITING_WINDOW") return emptyExecution(evaluated);

  return withWorkflowLock(pool, eventId, async (client, current) => {
    if (current?.status === "FINALIZED") {
      const evaluation = current.decision ? restoreDecision(current.decision) : evaluated;
      return emptyExecution({ ...evaluation, ruleApplied: "ALREADY_FINALIZED", canFinalizeDecision: false }, true);
    }
    if (!current?.decision) throw new Error("Missing persisted earthquake decision");
    const evaluation = restoreDecision(current.decision);
    const result = emptyExecution(evaluation);
    const occurredAt = new Date(earthquake.occurredAt ?? earthquake.timestamp ?? now);
    const byBranch = new Map<string, EvaluatedStoreTarget[]>();
    for (const store of evaluation.qualifyingStores) {
      const reportHash = crypto.createHash("sha256").update(`${eventId}:STORE:${store.kode_toko}`).digest("hex").slice(0, 16).toUpperCase();
      const report = await ensureEarthquakeReport({
        reportId: `LAP-EQ-STR-${reportHash}`,
        canonicalEventId: eventId,
        eventOccurredAt: occurredAt,
        source: earthquake.source || "BMKG",
        location: {
          kind: "STORE", id: store.kode_toko, code: store.kode_toko,
          name: store.nama_toko, type: store.fr_type || "REGULER", branch: store.cabang,
          latitude: store.latitude, longitude: store.longitude,
        },
        clientOrPool: client,
        manageTransaction: false,
      });
      if (report.outcome === "ambiguous") throw new Error(`Unresolved manual reports for ${store.kode_toko}`);
      if (report.outcome === "existing") result.preservedInspectionReports++;
      else { result.createdInspectionReports++; result.createdReportIds.push(report.incidentId); }
      const targets = byBranch.get(store.cabang) ?? [];
      targets.push(store);
      byBranch.set(store.cabang, targets);
    }
    for (const [branch, targets] of byBranch) {
      targets.sort((a, b) => a.distanceKm - b.distanceKm);
      const ticketNumber = `EQ-${crypto.createHash("sha256").update(`${eventId}:${branch}`).digest("hex").slice(0, 12).toUpperCase()}`;
      await recordNotificationLog({
        disasterId: eventId, canonicalEventId: eventId, disasterType: "earthquake",
        channel: "pwa_only", branch, recipientGroup: "BMS", category: "ASSIGNMENT",
        recipientContact: `in-app://branch/${encodeURIComponent(branch)}`,
        title: `Pemeriksaan gempa M ${evaluation.magnitude.toFixed(1)}: ${branch}`,
        message: `${targets.length} toko memenuhi kriteria pemeriksaan V1 + MMI. Pemeriksaan fisik tetap diperlukan.`,
        affectedStores: targets.map((store) => ({
          kode_toko: store.kode_toko, nama_toko: store.nama_toko, cabang: store.cabang,
          distance_km: Math.round(store.distanceKm * 10) / 10, status: "PRIORITY_MONITOR" as const,
          alamat: store.alamat, fr_type: store.fr_type,
        })),
        ticketNumber, clientOrPool: client,
      });
      result.notificationTicketNumbers[branch] = ticketNumber;
      result.dispatchedBranchNotifications++;
    }
    await saveWorkflowState(client, eventId, { ...current, status: "FINALIZED", finalized_at: now.toISOString() });
    return result;
  });
}

async function persistFacilityIntensities(
  params: ExecuteWorkflowParams,
  evaluation: EarthquakeWorkflowEvaluation,
  pool: Pool | PoolClient
): Promise<void> {
  try {
    const officialGrids = params.officialGrids || [];
    if (officialGrids.length === 0) return;

    for (const item of officialGrids) {
      const shakemapRecord = await dbSaveShakeMapRecord(item.grid, pool);
      const intensityRecords: FacilityIntensityRecord[] = [];

      for (const store of evaluation.allEvaluatedStores) {
        if (store.selectedGridChecksum !== item.grid.checksumSha256 || store.mmiSource !== item.provider) continue;
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
    throw new Error("Cannot persist earthquake intensity audit", { cause: err });
  }
}
