import { getDbPool } from "./db";
import { IncidentRecord } from "@/types/incident";
import { dbGetIncidentById } from "./incident-db";
import {
  evaluateWorkReadiness,
  resolveWorkReadinessCategory,
} from "./work-readiness";

export type HandlerType = "BMS" | "BES" | "BUILDING" | "REKANAN";
export type TargetSystem = "SPARTA_MAINTENANCE" | "BNM_MANTRA";
export type EstimationLifecycleStatus =
  | "WAITING_ESTIMATION"
  | "ESTIMATION_IN_PROCESS"
  | "ESTIMATION_COMPLETED"
  | "CANCELLED";

export type RoutingStatus =
  | EstimationLifecycleStatus
  | "READY_FOR_WORK"
  | "NOT_CONFIGURED"
  | "MANUAL_ACTION_REQUIRED"
  | "PENDING"
  | "ROUTED"
  | "SYNCED"
  | "ERROR";

export type WorkStatus = "NOT_READY" | "READY_FOR_WORK" | "IN_PROGRESS" | "COMPLETED";
export type DataSource = "MANUAL" | "SPARTA_MAINTENANCE" | "BNM_MANTRA";

export interface EstimationRouteRecord {
  id: string;
  reportId: string;
  handlerType: HandlerType;
  targetSystem: TargetSystem;
  routingStatus: RoutingStatus;
  status: RoutingStatus; // Compatibility alias
  workStatus: WorkStatus; // Separate Work Lifecycle
  dataSource: DataSource; // Foundation Source: MANUAL | SPARTA_MAINTENANCE | BNM_MANTRA
  storeCode: string | null;
  branchCode: string | null;
  externalReferenceId: string | null;
  notes: string | null;
  createdBy: string;
  createdByName: string;
  createdAt: string;
  updatedAt: string;
  lastSyncedAt: string | null;
  // Foundation fields for actual feedback
  estimationNumber?: string | null;
  estimatedValue?: number | null;
  completedAt?: string | null;
  externalReference?: string | null;
  estimationSummary?: string | null;
  readinessData?: Record<string, any> | null;
}

export interface CreateEstimationRouteParams {
  reportId: string;
  handlerType: HandlerType;
  dataSource?: DataSource;
  actor: {
    id: string;
    name: string;
    nik?: string | null;
  };
  report?: IncidentRecord | null;
}

export interface UpdateEstimationRouteParams {
  status: RoutingStatus;
  workStatus?: WorkStatus;
  dataSource?: DataSource;
  estimationNumber?: string | null;
  estimatedValue?: number | null;
  completedAt?: string | null;
  externalReference?: string | null;
  estimationSummary?: string | null;
  notes?: string | null;
}

let tableEnsured = false;

export async function ensureEstimationRoutesTable(): Promise<void> {
  if (tableEnsured) return;
  const pool = getDbPool();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS report_estimation_routes (
      id VARCHAR(64) PRIMARY KEY,
      report_id VARCHAR(64) NOT NULL UNIQUE,
      handler_type VARCHAR(32) NOT NULL,
      target_system VARCHAR(64) NOT NULL,
      routing_status VARCHAR(64) NOT NULL,
      status VARCHAR(64) NOT NULL,
      store_code VARCHAR(64),
      branch_code VARCHAR(64),
      external_reference_id VARCHAR(128),
      notes TEXT,
      created_by VARCHAR(64) NOT NULL,
      created_by_name VARCHAR(255) NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_synced_at TIMESTAMPTZ
    );

    ALTER TABLE report_estimation_routes ADD COLUMN IF NOT EXISTS routing_status VARCHAR(64);
    ALTER TABLE report_estimation_routes ADD COLUMN IF NOT EXISTS work_status VARCHAR(32) DEFAULT 'NOT_READY';
    ALTER TABLE report_estimation_routes ADD COLUMN IF NOT EXISTS data_source VARCHAR(64) DEFAULT 'MANUAL';
    ALTER TABLE report_estimation_routes ADD COLUMN IF NOT EXISTS estimation_number VARCHAR(128);
    ALTER TABLE report_estimation_routes ADD COLUMN IF NOT EXISTS estimated_value NUMERIC;
    ALTER TABLE report_estimation_routes ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;
    ALTER TABLE report_estimation_routes ADD COLUMN IF NOT EXISTS external_reference VARCHAR(128);
    ALTER TABLE report_estimation_routes ADD COLUMN IF NOT EXISTS estimation_summary TEXT;
    ALTER TABLE report_estimation_routes ADD COLUMN IF NOT EXISTS readiness_data JSONB;

    CREATE INDEX IF NOT EXISTS idx_estimation_routes_report ON report_estimation_routes(report_id);
    CREATE INDEX IF NOT EXISTS idx_estimation_routes_handler ON report_estimation_routes(handler_type);
  `);
  tableEnsured = true;
}

function mapRowToRecord(r: any): EstimationRouteRecord {
  let readinessData: Record<string, any> | null = null;
  if (r.readiness_data) {
    if (typeof r.readiness_data === "string") {
      try {
        readinessData = JSON.parse(r.readiness_data);
      } catch {
        readinessData = null;
      }
    } else {
      readinessData = r.readiness_data;
    }
  }

  return {
    id: r.id,
    reportId: r.report_id,
    handlerType: r.handler_type,
    targetSystem: r.target_system,
    routingStatus: r.routing_status || r.status,
    status: r.status || r.routing_status,
    workStatus: (r.work_status as WorkStatus) || "NOT_READY",
    dataSource: (r.data_source as DataSource) || "MANUAL",
    storeCode: r.store_code,
    branchCode: r.branch_code,
    externalReferenceId: r.external_reference_id || r.external_reference,
    notes: r.notes,
    createdBy: r.created_by,
    createdByName: r.created_by_name,
    createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at,
    updatedAt: r.updated_at instanceof Date ? r.updated_at.toISOString() : r.updated_at,
    lastSyncedAt: r.last_synced_at ? (r.last_synced_at instanceof Date ? r.last_synced_at.toISOString() : r.last_synced_at) : null,
    estimationNumber: r.estimation_number || null,
    estimatedValue: r.estimated_value ? Number(r.estimated_value) : null,
    completedAt: r.completed_at ? (r.completed_at instanceof Date ? r.completed_at.toISOString() : r.completed_at) : null,
    externalReference: r.external_reference || r.external_reference_id || null,
    estimationSummary: r.estimation_summary || null,
    readinessData,
  };
}

export interface UpdateWorkStatusOptions {
  readinessEvidences?: Record<string, any>;
  bypassReadinessValidation?: boolean;
  actor?: {
    id: string;
    name: string;
  };
  notes?: string;
}

export class EstimationIntegrationService {
  /**
   * Mengambil routing record estimasi berdasarkan ID laporan (jika ada).
   */
  static async getRouteByReportId(reportId: string): Promise<EstimationRouteRecord | null> {
    await ensureEstimationRoutesTable();
    const pool = getDbPool();
    const res = await pool.query(
      `SELECT * FROM report_estimation_routes WHERE report_id = $1 LIMIT 1`,
      [reportId]
    );

    if (res.rows.length === 0) return null;
    return mapRowToRecord(res.rows[0]);
  }

  /**
   * Membuat routing record baru untuk laporan TKP Toko atau DC.
   * Melakukan proteksi duplikasi (1 active route per report).
   * Status awal selalu WAITING_ESTIMATION ("Menunggu Hasil Estimasi").
   * Work Status awal selalu NOT_READY ("Belum Siap Dikerjakan").
   */
  static async createRoute(params: CreateEstimationRouteParams): Promise<EstimationRouteRecord> {
    await ensureEstimationRoutesTable();
    const pool = getDbPool();

    // 1. Cek duplikasi
    const existing = await this.getRouteByReportId(params.reportId);
    if (existing) {
      const err: any = new Error(
        "Conflict: Laporan ini sudah memiliki rute estimasi aktif. Duplikasi estimasi tidak diizinkan."
      );
      err.code = "DUPLICATE_ROUTE";
      err.status = 409;
      throw err;
    }

    // 2. Tentukan target system dan notes berdasarkan handler
    let targetSystem: TargetSystem;
    let initialNotes: string;

    if (params.handlerType === "BMS") {
      targetSystem = "SPARTA_MAINTENANCE";
      initialNotes = "Estimasi ditangani melalui alur BMS.";
    } else if (params.handlerType === "BES") {
      targetSystem = "SPARTA_MAINTENANCE";
      initialNotes = "Estimasi ditangani melalui alur BES.";
    } else if (params.handlerType === "BUILDING") {
      targetSystem = "BNM_MANTRA";
      initialNotes = "Estimasi ditangani melalui alur Building.";
    } else if (params.handlerType === "REKANAN") {
      targetSystem = "BNM_MANTRA";
      initialNotes = "Estimasi ditangani melalui alur Rekanan.";
    } else {
      const err: any = new Error("Handler tidak valid. Pilihan yang tersedia: BMS, BES, BUILDING, atau REKANAN.");
      err.code = "INVALID_HANDLER";
      err.status = 400;
      throw err;
    }

    const rep = params.report || (await dbGetIncidentById(params.reportId));
    const storeCode = rep?.storeId || (rep as any)?.facilityId || null;
    const branchCode = rep?.branch || null;
    const initialStatus: RoutingStatus = "WAITING_ESTIMATION";
    const initialWorkStatus: WorkStatus = "NOT_READY";
    const initialDataSource: DataSource = params.dataSource || "MANUAL";

    // 3. Simpan record routing dengan status WAITING_ESTIMATION dan work_status NOT_READY
    const routeId = `EST-ROUTE-${Date.now()}-${Math.random().toString(36).substring(2, 7).toUpperCase()}`;

    const insertRes = await pool.query(
      `INSERT INTO report_estimation_routes (
        id, report_id, handler_type, target_system, routing_status, status,
        work_status, data_source,
        store_code, branch_code, external_reference_id, notes,
        created_by, created_by_name, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, NOW(), NOW())
      RETURNING *`,
      [
        routeId,
        params.reportId,
        params.handlerType,
        targetSystem,
        initialStatus,
        initialStatus,
        initialWorkStatus,
        initialDataSource,
        storeCode,
        branchCode,
        null, // No fake external reference
        initialNotes,
        params.actor.id,
        params.actor.name,
      ]
    );

    const r = insertRes.rows[0];

    // 4. Catat Audit Log
    try {
      const auditId = `audit_est_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
      await pool.query(
        `INSERT INTO permission_audit_logs (
          id, actor_user_id, actor_name, action, target_user_id,
          permission_key, effect, scope_type, branch_code, reason, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())`,
        [
          auditId,
          params.actor.id,
          params.actor.name,
          "ESTIMATION_CREATED",
          params.reportId,
          "ESTIMATION_TRIGGER",
          "ALLOW",
          "BRANCH",
          branchCode,
          `Routing Estimasi dibuat: Handler=${params.handlerType}, Target=${targetSystem}, Status=${initialStatus}, WorkStatus=${initialWorkStatus}`,
        ]
      );
    } catch (auditErr) {
      console.warn("[EstimationService] Gagal mencatat audit log:", auditErr);
    }

    return mapRowToRecord(r);
  }

  /**
   * Update status dan data feedback estimasi (misal ESTIMATION_COMPLETED).
   * PENTING: ESTIMATION_COMPLETED TIDAK OTOMATIS mengubah work_status ke READY_FOR_WORK.
   * work_status tetap mempertahankan nilai sebelumnya (NOT_READY) kecuali parameter workStatus diberikan secara eksplisit.
   */
  static async updateRouteStatus(
    reportId: string,
    params: UpdateEstimationRouteParams
  ): Promise<EstimationRouteRecord> {
    await ensureEstimationRoutesTable();
    const pool = getDbPool();

    const existing = await this.getRouteByReportId(reportId);
    if (!existing) {
      const err: any = new Error("Rute estimasi tidak ditemukan.");
      err.status = 404;
      throw err;
    }

    // Jika parameter workStatus secara eksplisit diberikan, transisikan lewat updateWorkStatus
    if (params.workStatus && params.workStatus !== existing.workStatus) {
      await this.updateWorkStatus(reportId, params.workStatus);
    }

    const res = await pool.query(
      `UPDATE report_estimation_routes SET
        status = $1,
        routing_status = $1,
        data_source = COALESCE($2, data_source),
        estimation_number = COALESCE($3, estimation_number),
        estimated_value = COALESCE($4, estimated_value),
        completed_at = COALESCE($5::timestamptz, completed_at),
        external_reference = COALESCE($6, external_reference),
        estimation_summary = COALESCE($7, estimation_summary),
        notes = COALESCE($8, notes),
        updated_at = NOW()
      WHERE report_id = $9
      RETURNING *`,
      [
        params.status,
        params.dataSource || null,
        params.estimationNumber || null,
        params.estimatedValue || null,
        params.completedAt || null,
        params.externalReference || null,
        params.estimationSummary || null,
        params.notes || null,
        reportId,
      ]
    );

    return mapRowToRecord(res.rows[0]);
  }

  /**
   * Mengubah status kesiapan pekerjaan (Work Lifecycle).
   * Nilai: NOT_READY | READY_FOR_WORK | IN_PROGRESS | COMPLETED
   * 
   * Validasi Transisi State Machine:
   * - NOT_READY -> READY_FOR_WORK: Wajib memenuhi evaluasi readiness (sesuai TKP & Handler).
   * - NOT_READY -> IN_PROGRESS: DITOLAK (harus melalui READY_FOR_WORK).
   * - NOT_READY -> COMPLETED: DITOLAK.
   * - READY_FOR_WORK -> IN_PROGRESS: Diizinkan (saat submit progress fisik pertama).
   * - READY_FOR_WORK -> COMPLETED: DITOLAK secara langsung (harus melalui IN_PROGRESS dengan progress 100%).
   * - IN_PROGRESS -> COMPLETED: Diizinkan saat progress 100% dan bukti akhir (FINAL / HANDOVER) tervalidasi.
   */
  static async updateWorkStatus(
    reportId: string,
    workStatus: WorkStatus,
    options?: UpdateWorkStatusOptions
  ): Promise<EstimationRouteRecord> {
    await ensureEstimationRoutesTable();
    const pool = getDbPool();

    const existing = await this.getRouteByReportId(reportId);
    if (!existing) {
      const err: any = new Error("Rute estimasi tidak ditemukan.");
      err.status = 404;
      err.code = "ROUTE_NOT_FOUND";
      throw err;
    }

    const validStatuses: WorkStatus[] = ["NOT_READY", "READY_FOR_WORK", "IN_PROGRESS", "COMPLETED"];
    if (!validStatuses.includes(workStatus)) {
      const err: any = new Error(`Status pekerjaan '${workStatus}' tidak valid.`);
      err.status = 400;
      err.code = "INVALID_WORK_STATUS";
      throw err;
    }

    const currentStatus = existing.workStatus;

    // Idempotent: jika status sama, update readinessData jika ada
    if (currentStatus === workStatus) {
      if (options?.readinessEvidences) {
        const updateRes = await pool.query(
          `UPDATE report_estimation_routes SET
            readiness_data = $1,
            updated_at = NOW()
          WHERE report_id = $2
          RETURNING *`,
          [JSON.stringify(options.readinessEvidences), reportId]
        );
        return mapRowToRecord(updateRes.rows[0]);
      }
      return existing;
    }

    // Validasi transisi state
    if (workStatus === "READY_FOR_WORK") {
      if (currentStatus !== "NOT_READY") {
        const err: any = new Error(
          `Transisi status tidak valid: Tidak dapat mengubah status ke READY_FOR_WORK dari status '${currentStatus}'.`
        );
        err.status = 400;
        err.code = "INVALID_WORK_TRANSITION";
        throw err;
      }

      // Validasi Readiness sesuai TKP & Handler
      if (!options?.bypassReadinessValidation) {
        if (existing.status !== "ESTIMATION_COMPLETED") {
          const err: any = new Error(
            "Pekerjaan belum dapat dialihkan ke Siap Dikerjakan (READY_FOR_WORK) karena tahap estimasi belum selesai (ESTIMATION_COMPLETED)."
          );
          err.status = 422;
          err.code = "ESTIMATION_NOT_COMPLETED";
          throw err;
        }

        const report = await dbGetIncidentById(reportId);
        const evidences = options?.readinessEvidences || existing.readinessData || {};
        const evaluation = evaluateWorkReadiness(
          report?.tkpType,
          existing.handlerType,
          evidences
        );

        if (!evaluation.isReady) {
          const missingNames = evaluation.missingRequirements
            .map((r) => r.label)
            .join(", ");
          const err: any = new Error(
            `Pekerjaan belum dapat dimulai (NOT_READY). Persyaratan berikut belum lengkap: ${missingNames}.`
          );
          err.status = 422;
          err.code = "WORK_READINESS_INCOMPLETE";
          err.details = evaluation;
          throw err;
        }
      }
    } else if (workStatus === "IN_PROGRESS") {
      if (currentStatus === "NOT_READY") {
        const err: any = new Error(
          "Transisi status tidak valid: Pekerjaan tidak dapat langsung masuk ke IN_PROGRESS dari NOT_READY tanpa melalui validasi READY_FOR_WORK."
        );
        err.status = 422;
        err.code = "INVALID_WORK_TRANSITION";
        throw err;
      }
      if (currentStatus === "COMPLETED") {
        const err: any = new Error(
          "Transisi status tidak valid: Pekerjaan yang telah selesai (COMPLETED) tidak dapat diubah kembali ke IN_PROGRESS secara langsung."
        );
        err.status = 400;
        err.code = "INVALID_WORK_TRANSITION";
        throw err;
      }
    } else if (workStatus === "COMPLETED") {
      if (currentStatus === "NOT_READY") {
        const err: any = new Error(
          "Transisi status tidak valid: Pekerjaan tidak dapat langsung diselesaikan (COMPLETED) dari NOT_READY."
        );
        err.status = 422;
        err.code = "INVALID_WORK_TRANSITION";
        throw err;
      }
      if (currentStatus === "READY_FOR_WORK") {
        const err: any = new Error(
          "Transisi status tidak valid: Pekerjaan tidak dapat langsung diselesaikan (COMPLETED) dari READY_FOR_WORK tanpa melalui progress pengerjaan fisik."
        );
        err.status = 422;
        err.code = "INVALID_WORK_TRANSITION";
        throw err;
      }
    } else if (workStatus === "NOT_READY") {
      // Reverting to NOT_READY is only allowed from READY_FOR_WORK if explicit cancellation/reset
      if (currentStatus === "IN_PROGRESS" || currentStatus === "COMPLETED") {
        const err: any = new Error(
          `Transisi status tidak valid: Pekerjaan yang sedang atau telah berjalan (${currentStatus}) tidak dapat dikembalikan ke NOT_READY.`
        );
        err.status = 400;
        err.code = "INVALID_WORK_TRANSITION";
        throw err;
      }
    }

    const readinessJson = options?.readinessEvidences
      ? JSON.stringify(options.readinessEvidences)
      : null;

    const res = await pool.query(
      `UPDATE report_estimation_routes SET
        work_status = $1,
        readiness_data = COALESCE($2, readiness_data),
        updated_at = NOW()
      WHERE report_id = $3
      RETURNING *`,
      [workStatus, readinessJson, reportId]
    );

    return mapRowToRecord(res.rows[0]);
  }
}
