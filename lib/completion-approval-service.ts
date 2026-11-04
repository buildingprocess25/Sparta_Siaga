/**
 * SPARTA SIAGA — TASK 5: COMPLETION, APPROVAL & CLOSING SERVICE
 * 
 * Flow resmi setelah physical work mencapai work_status = COMPLETED:
 * 
 * TOKO / BMS flow:
 * BMS (PIC) → BMC (Coordinator) → BM (Manager Branch) → Case Close (resolved)
 * 
 * DC / WH flow:
 * BES (PIC) → BEC (Coordinator) → BM (Manager Branch) → Case Close (resolved)
 * 
 * BUILDING flow:
 * BBS (PIC) → BBC (Coordinator) → BM (Manager Branch) → Case Close (resolved)
 * 
 * Separation of Duties:
 * - Physical Work Completion (work_status = COMPLETED)
 * - Administrative Approval (Coordinator & Manager)
 * - Case Close (incident.status = resolved)
 * 
 * Zero Operational Bypass for System Admin is strictly enforced.
 */

import { getDbPool } from "./db";
import { IncidentRecord } from "@/types/incident";
import { dbGetIncidentById, dbUpdateIncident, rowToIncident } from "./incident-db";
import { EstimationIntegrationService } from "./estimation-service";
import { ProgressService } from "./progress-service";
import { checkUserPermission } from "./permission-service";
import { formatServerTimestampWib } from "./watermark";

export type ApprovalFlowType = "BMS" | "BES" | "BUILDING";

export type CompletionApprovalStatus =
  | "WAITING_PIC_SUBMISSION"
  | "WAITING_COORDINATOR_APPROVAL"
  | "WAITING_MANAGER_APPROVAL"
  | "APPROVED_PENDING_CLOSE"
  | "REVISION_REQUIRED"
  | "CLOSED";

export type CompletionApprovalStage =
  | "SUBMISSION"
  | "COORDINATOR_APPROVAL"
  | "MANAGER_APPROVAL"
  | "REVISION"
  | "CASE_CLOSE"
  | "CLOSE";

export type CompletionApprovalAction =
  | "SUBMIT_COMPLETION"
  | "APPROVE_COORDINATOR"
  | "REJECT_COORDINATOR"
  | "APPROVE_MANAGER"
  | "REJECT_MANAGER"
  | "CLOSE_CASE";

export interface CompletionApprovalAttachment {
  url: string;
  originalName: string;
  type: string;
  size: number;
}

export interface CompletionApprovalRecord {
  id: string;
  reportId: string;
  flowType: ApprovalFlowType;
  status: CompletionApprovalStatus;
  picRole: string; // 'bms' | 'bes' | 'bbs'
  picUserId: string | null;
  picUserName: string | null;
  submittedAt: string | null;
  submissionNotes: string | null;
  attachments?: CompletionApprovalAttachment[];
  coordinatorRole: string; // 'bmc' | 'bec' | 'bbc'
  coordinatorUserId: string | null;
  coordinatorUserName: string | null;
  coordinatorApprovedAt: string | null;
  coordinatorNotes: string | null;
  managerRole: string; // 'bm'
  managerUserId: string | null;
  managerUserName: string | null;
  managerApprovedAt: string | null;
  managerNotes: string | null;
  closedAt?: string | null;
  closedByUserId?: string | null;
  closedByUserName?: string | null;
  closingNotes?: string | null;
  rejectionReason: string | null;
  rejectedByRole: string | null;
  rejectedByUserId: string | null;
  rejectedByUserName: string | null;
  rejectedAt: string | null;
  branchCode: string;
  createdAt: string;
  updatedAt: string;
}

export interface CompletionApprovalHistoryRecord {
  id: string;
  reportId: string;
  stage: CompletionApprovalStage;
  action: CompletionApprovalAction;
  actorUserId: string;
  actorName: string;
  actorRole: string;
  branch: string;
  notes: string | null;
  createdAt: string;
}

export interface ApprovalRouteResolution {
  flowType: ApprovalFlowType;
  picRole: "bms" | "bes" | "bbs";
  coordinatorRole: "bmc" | "bec" | "bbc";
  managerRole: "bm";
}

let tablesEnsured = false;

export async function ensureCompletionApprovalTables(): Promise<void> {
  if (tablesEnsured) return;
  const pool = getDbPool();

  await pool.query(`
    CREATE TABLE IF NOT EXISTS report_completion_approvals (
      id VARCHAR(64) PRIMARY KEY,
      report_id VARCHAR(64) NOT NULL UNIQUE,
      flow_type VARCHAR(32) NOT NULL,
      status VARCHAR(64) NOT NULL,
      pic_role VARCHAR(32) NOT NULL,
      pic_user_id VARCHAR(64),
      pic_user_name VARCHAR(255),
      submitted_at TIMESTAMPTZ,
      submission_notes TEXT,
      coordinator_role VARCHAR(32) NOT NULL,
      coordinator_user_id VARCHAR(64),
      coordinator_user_name VARCHAR(255),
      coordinator_approved_at TIMESTAMPTZ,
      coordinator_notes TEXT,
      manager_role VARCHAR(32) NOT NULL DEFAULT 'bm',
      manager_user_id VARCHAR(64),
      manager_user_name VARCHAR(255),
      manager_approved_at TIMESTAMPTZ,
      manager_notes TEXT,
      rejection_reason TEXT,
      rejected_by_role VARCHAR(32),
      rejected_by_user_id VARCHAR(64),
      rejected_by_user_name VARCHAR(255),
      rejected_at TIMESTAMPTZ,
      attachments JSONB DEFAULT '[]'::jsonb,
      branch_code VARCHAR(64) NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    ALTER TABLE report_completion_approvals ADD COLUMN IF NOT EXISTS attachments JSONB DEFAULT '[]'::jsonb;
    ALTER TABLE report_completion_approvals ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ;
    ALTER TABLE report_completion_approvals ADD COLUMN IF NOT EXISTS closed_by_user_id VARCHAR(64);
    ALTER TABLE report_completion_approvals ADD COLUMN IF NOT EXISTS closed_by_user_name VARCHAR(255);
    ALTER TABLE report_completion_approvals ADD COLUMN IF NOT EXISTS closing_notes TEXT;

    CREATE INDEX IF NOT EXISTS idx_comp_appr_report ON report_completion_approvals(report_id);
    CREATE INDEX IF NOT EXISTS idx_comp_appr_status ON report_completion_approvals(status);
    CREATE INDEX IF NOT EXISTS idx_comp_appr_branch ON report_completion_approvals(branch_code);

    CREATE TABLE IF NOT EXISTS report_completion_approval_history (
      id VARCHAR(64) PRIMARY KEY,
      report_id VARCHAR(64) NOT NULL,
      stage VARCHAR(64) NOT NULL,
      action VARCHAR(64) NOT NULL,
      actor_user_id VARCHAR(64) NOT NULL,
      actor_name VARCHAR(255) NOT NULL,
      actor_role VARCHAR(32) NOT NULL,
      branch VARCHAR(64) NOT NULL,
      notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_comp_appr_hist_report ON report_completion_approval_history(report_id);
    CREATE INDEX IF NOT EXISTS idx_comp_appr_hist_created ON report_completion_approval_history(created_at);
  `);

  tablesEnsured = true;
}

/**
 * Memetakan alur approval resmi berdasarkan route estimasi dan konteks laporan:
 * - TOKO / BMS / REKANAN -> BMS -> BMC -> BM
 * - DC / WH / BES -> BES -> BEC -> BM
 * - BUILDING -> BBS -> BBC -> BM
 */
export function resolveApprovalRoute(
  report: IncidentRecord,
  route?: import("./estimation-service").EstimationRouteRecord | null
): ApprovalRouteResolution {
  if (route) {
    if (route.handlerType === "BES") {
      return { flowType: "BES", picRole: "bes", coordinatorRole: "bec", managerRole: "bm" };
    }
    if (route.handlerType === "BUILDING") {
      return { flowType: "BUILDING", picRole: "bbs", coordinatorRole: "bbc", managerRole: "bm" };
    }
    // Default BMS / Rekanan internal oversight
    return { flowType: "BMS", picRole: "bms", coordinatorRole: "bmc", managerRole: "bm" };
  }

  // Fallback berdasarkan tkpType jika route belum ada
  if (report.tkpType === "dc") {
    return { flowType: "BES", picRole: "bes", coordinatorRole: "bec", managerRole: "bm" };
  }
  if (report.tkpType === "building") {
    return { flowType: "BUILDING", picRole: "bbs", coordinatorRole: "bbc", managerRole: "bm" };
  }

  return { flowType: "BMS", picRole: "bms", coordinatorRole: "bmc", managerRole: "bm" };
}

const cleanBranch = (b?: string | null) => (b ? b.trim().toLowerCase() : "");

export class CompletionApprovalService {
  /**
   * Mengambil atau menginisialisasi record completion approval untuk sebuah laporan.
   */
  static async getOrCreateApproval(reportId: string): Promise<CompletionApprovalRecord> {
    await ensureCompletionApprovalTables();
    const pool = getDbPool();

    const existingRes = await pool.query(
      `SELECT * FROM report_completion_approvals WHERE report_id = $1`,
      [reportId]
    );

    if (existingRes.rows.length > 0) {
      return this.mapRowToRecord(existingRes.rows[0]);
    }

    const report = await dbGetIncidentById(reportId);
    if (!report) {
      const err: any = new Error("Laporan tidak ditemukan.");
      err.status = 404;
      throw err;
    }

    const route = await EstimationIntegrationService.getRouteByReportId(reportId);
    const resolvedRoute = resolveApprovalRoute(report, route);

    const id = `appr_${reportId}_${Date.now()}`;
    const initialStatus: CompletionApprovalStatus =
      report.status === "resolved" || report.status === "closed"
        ? "CLOSED"
        : report.status === "approved_pending_close"
        ? "APPROVED_PENDING_CLOSE"
        : "WAITING_PIC_SUBMISSION";

    const insertRes = await pool.query(
      `INSERT INTO report_completion_approvals (
        id, report_id, flow_type, status, pic_role, coordinator_role,
        manager_role, branch_code, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())
      RETURNING *`,
      [
        id,
        reportId,
        resolvedRoute.flowType,
        initialStatus,
        resolvedRoute.picRole,
        resolvedRoute.coordinatorRole,
        resolvedRoute.managerRole,
        report.branch || "N/A",
      ]
    );

    return this.mapRowToRecord(insertRes.rows[0]);
  }

  /**
   * Mengambil riwayat approval lengkap (append-only audit log).
   */
  static async getApprovalHistory(reportId: string): Promise<CompletionApprovalHistoryRecord[]> {
    await ensureCompletionApprovalTables();
    const pool = getDbPool();

    const res = await pool.query(
      `SELECT * FROM report_completion_approval_history 
       WHERE report_id = $1 
       ORDER BY created_at ASC`,
      [reportId]
    );

    return res.rows.map((row) => ({
      id: row.id,
      reportId: row.report_id,
      stage: row.stage as CompletionApprovalStage,
      action: row.action as CompletionApprovalAction,
      actorUserId: row.actor_user_id,
      actorName: row.actor_name,
      actorRole: row.actor_role,
      branch: row.branch,
      notes: row.notes || null,
      createdAt: row.created_at.toISOString ? row.created_at.toISOString() : new Date(row.created_at).toISOString(),
    }));
  }

  /**
   * Validasi prasyarat penyelesaian fisik sebelum alur approval dapat diproses.
   */
  static async validateCompletionPrerequisites(reportId: string): Promise<{
    report: IncidentRecord;
    route: import("./estimation-service").EstimationRouteRecord | null;
    hasMilestoneSt: boolean;
  }> {
    const report = await dbGetIncidentById(reportId);
    if (!report) {
      const err: any = new Error("Laporan tidak ditemukan.");
      err.status = 404;
      throw err;
    }

    if (report.status === "closed" || report.status === "resolved" || report.status === "archived") {
      const err: any = new Error("Laporan sudah ditutup/selesai. Tindakan approval tidak dapat diulangi.");
      err.status = 422;
      err.code = "ALREADY_CLOSED";
      throw err;
    }

    // 1. Cek Foto bukti akhir / SERAH TERIMA wajib
    const hasFinalEvidence = await ProgressService.hasFinalOrHandoverEvidence(reportId);
    let hasMilestoneSt = false;
    try {
      const { getMilestones } = await import("./milestone-service");
      const milestones = await getMilestones(reportId);
      const st = milestones.find((m) => m.stageKey === "SERAH_TERIMA");
      hasMilestoneSt = Boolean(st && st.status === "SUBMITTED" && (st.documentStorageKey || st.documentUrl));
    } catch {
      // ignore
    }

    // 2. Cek Route work_status (jika tidak menggunakan milestone serah terima)
    const route = await EstimationIntegrationService.getRouteByReportId(reportId);
    if (route && route.workStatus !== "COMPLETED" && !hasMilestoneSt) {
      const err: any = new Error(
        `Alur persetujuan belum dapat dimulai karena pekerjaan fisik belum berstatus 'COMPLETED' (status saat ini: '${route.workStatus}').`
      );
      err.status = 400;
      err.code = "WORK_NOT_COMPLETED";
      throw err;
    }

    // 3. Cek Progress fisik 100%
    const latestProgress = await ProgressService.getLatestProgress(reportId);
    const effectiveProgress = Math.max(report.progress || 0, latestProgress.latestPercentage || 0);
    if (effectiveProgress < 100) {
      const err: any = new Error(
        `Pekerjaan fisik belum mencapai 100% (progress saat ini: ${effectiveProgress}%). Persetujuan tidak dapat diproses.`
      );
      err.status = 400;
      err.code = "PROGRESS_NOT_100";
      throw err;
    }

    if (!hasFinalEvidence && !hasMilestoneSt) {
      const err: any = new Error(
        "Bukti serah terima pekerjaan (Milestone Serah Terima atau FINAL / HANDOVER) wajib dilampirkan sebelum mengajukan penyelesaian."
      );
      err.status = 400;
      err.code = "FINAL_EVIDENCE_MISSING";
      throw err;
    }

    return { report, route, hasMilestoneSt };
  }

  /**
   * STEP 1: PIC LAPANGAN MENGAJUKAN PENYELESAIAN ("Ajukan Penyelesaian")
   * - BMS untuk jalur BMS/Rekanan
   * - BES untuk jalur DC/WH
   * - BBS untuk jalur BUILDING
   */
  static async submitCompletion(params: {
    reportId: string;
    actor: {
      id: string;
      name: string;
      role?: string | null;
      systemRole?: string;
      scope?: string | null;
      branch?: string | null;
    };
    notes?: string;
    attachments?: Array<{ url: string; originalName: string; type: string; size: number }>;
  }): Promise<CompletionApprovalRecord> {
    const { report, route } = await this.validateCompletionPrerequisites(params.reportId);
    const approval = await this.getOrCreateApproval(params.reportId);

    // 1. Scope and System Admin checks
    if (params.actor.scope === "HO") {
      const err: any = new Error("Forbidden: User dengan scope Head Office tidak memiliki izin operasional pengajuan penyelesaian.");
      err.status = 403;
      throw err;
    }

    const isSystemAdmin = params.actor.systemRole === "ADMIN";
    if (isSystemAdmin) {
      const err: any = new Error(
        "Forbidden: System Administrator tidak dapat melakukan tindakan operasional pengajuan penyelesaian."
      );
      err.status = 403;
      err.code = "ADMIN_OPERATIONAL_BYPASS_BLOCKED";
      throw err;
    }

    // 2. State Check
    if (approval.status !== "WAITING_PIC_SUBMISSION" && approval.status !== "REVISION_REQUIRED") {
      const err: any = new Error(
        `Pengajuan penyelesaian ditolak: Status persetujuan saat ini adalah '${approval.status}'.`
      );
      err.status = 400;
      err.code = "INVALID_APPROVAL_STATE";
      throw err;
    }

    // 3. Actor Role Validation (Server-side resolved)
    const expectedRoute = resolveApprovalRoute(report, route);
    const actorRole = (params.actor.role || "").toLowerCase();

    if (actorRole !== expectedRoute.picRole) {
      const err: any = new Error(
        `Pengajuan penyelesaian hanya dapat diajukan oleh PIC resmi jalur ${expectedRoute.flowType} (${expectedRoute.picRole.toUpperCase()}), bukan '${actorRole.toUpperCase() || "N/A"}'.`
      );
      err.status = 403;
      err.code = "ROLE_MISMATCH";
      throw err;
    }

    // 4. Branch Scope Validation
    const userBranch = cleanBranch(params.actor.branch);
    const reportBranch = cleanBranch(report.branch);
    if (!userBranch || userBranch !== reportBranch) {
      const err: any = new Error(
        `Aksi pengajuan penyelesaian hanya berlaku untuk cabang sendiri (${params.actor.branch || "N/A"}), bukan cabang ${report.branch?.toUpperCase() || "N/A"}.`
      );
      err.status = 403;
      err.code = "BRANCH_SCOPE_VIOLATION";
      throw err;
    }

    // 5. Central Permission Resolver check (COMPLETION_SUBMIT)
    const permCheck = await checkUserPermission({
      user: params.actor as any,
      permission: "COMPLETION_SUBMIT",
      report,
    });
    if (!permCheck.authorized) {
      const err: any = new Error(permCheck.reason || "Unauthorized: Anda tidak memiliki izin untuk mengajukan penyelesaian.");
      err.status = 403;
      throw err;
    }

    // 6. Update Approval State -> WAITING_COORDINATOR_APPROVAL (Flow: PIC -> Koordinator -> BnM Manajer)
    const pool = getDbPool();
    const submissionNotes = (params.notes || "").trim() || "Pekerjaan fisik telah 100% selesai dan siap diverifikasi.";
    const attachmentsJson = JSON.stringify(params.attachments || []);

    const updateRes = await pool.query(
      `UPDATE report_completion_approvals SET
        status = 'WAITING_COORDINATOR_APPROVAL',
        pic_user_id = COALESCE(pic_user_id, $1),
        pic_user_name = COALESCE(pic_user_name, $2),
        submitted_at = NOW(),
        submission_notes = $3,
        attachments = $4,
        rejection_reason = NULL,
        rejected_by_role = NULL,
        rejected_by_user_id = NULL,
        rejected_by_user_name = NULL,
        rejected_at = NULL,
        updated_at = NOW()
       WHERE report_id = $5
       RETURNING *`,
      [params.actor.id, params.actor.name, submissionNotes, attachmentsJson, params.reportId]
    );

    // 7. Append History
    const historyId = `hist_${params.reportId}_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    await pool.query(
      `INSERT INTO report_completion_approval_history (
        id, report_id, stage, action, actor_user_id, actor_name, actor_role, branch, notes, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())`,
      [
        historyId,
        params.reportId,
        "SUBMISSION",
        "SUBMIT_COMPLETION",
        params.actor.id,
        params.actor.name,
        actorRole,
        report.branch || "",
        submissionNotes,
      ]
    );

    // 8. Append to Incident Timeline & update status (Menuju Review Koordinator)
    const nowWib = formatServerTimestampWib();
    const timelineEntry = {
      stage: "Pengajuan Penyelesaian",
      label: `Penyelesaian Pekerjaan Diajukan ke Koordinator (${expectedRoute.coordinatorRole.toUpperCase()})`,
      timestamp: nowWib,
      actor: `${params.actor.name} (${actorRole.toUpperCase()})`,
      notes: submissionNotes,
    };

    await dbUpdateIncident(params.reportId, {
      status: "awaiting_st",
      timeline: [...(report.timeline || []), timelineEntry],
    });

    return this.mapRowToRecord(updateRes.rows[0]);
  }

  /**
   * STEP 2A: KOORDINATOR MENYETUJUI PENYELESAIAN (APPROVE)
   * - BMC untuk jalur BMS/Rekanan
   * - BEC untuk jalur BES
   * - BBC untuk jalur BBS
   */
  static async approveByCoordinator(params: {
    reportId: string;
    actor: {
      id: string;
      name: string;
      role?: string | null;
      systemRole?: string;
      scope?: string | null;
      branch?: string | null;
    };
    notes?: string;
  }): Promise<CompletionApprovalRecord> {
    const { report, route } = await this.validateCompletionPrerequisites(params.reportId);
    const approval = await this.getOrCreateApproval(params.reportId);

    // 1. Scope and System Admin checks
    if (params.actor.scope === "HO" || params.actor.systemRole === "ADMIN") {
      const err: any = new Error("Forbidden: User dengan scope Head Office tidak memiliki izin persetujuan koordinator.");
      err.status = 403;
      throw err;
    }

    // 2. Domain Routing Check
    const expectedRoute = resolveApprovalRoute(report, route);
    const actorRole = (params.actor.role || "").toLowerCase();

    if (actorRole !== expectedRoute.coordinatorRole) {
      const err: any = new Error(
        `Laporan jalur ${expectedRoute.flowType} hanya dapat disetujui oleh ${expectedRoute.coordinatorRole.toUpperCase()}, bukan '${actorRole.toUpperCase() || "N/A"}'.`
      );
      err.status = 403;
      err.code = "COORDINATOR_MISMATCH";
      throw err;
    }

    // 3. Branch Scope Check (Admin is not restricted to single branch)
    {
      const userBranch = cleanBranch(params.actor.branch);
      const reportBranch = cleanBranch(report.branch);
      if (!userBranch || userBranch !== reportBranch) {
        const err: any = new Error(
          `Aksi persetujuan koordinator hanya berlaku untuk cabang sendiri (${params.actor.branch || "N/A"}), bukan cabang ${report.branch?.toUpperCase() || "N/A"}.`
        );
        err.status = 403;
        err.code = "BRANCH_SCOPE_VIOLATION";
        throw err;
      }
    }

    // 4. Central Permission Resolver check (COMPLETION_APPROVE_COORDINATOR)
    const permCheck = await checkUserPermission({
      user: params.actor as any,
      permission: "COMPLETION_APPROVE_COORDINATOR",
      report,
    });
    if (!permCheck.authorized) {
      const err: any = new Error(permCheck.reason || "Unauthorized: Anda tidak memiliki izin persetujuan koordinator.");
      err.status = 403;
      throw err;
    }

    // 5. State Check
    if (approval.status !== "WAITING_COORDINATOR_APPROVAL") {
      const err: any = new Error(
        `Persetujuan Koordinator ditolak: Status persetujuan saat ini adalah '${approval.status}' (belum diajukan oleh PIC atau sudah disetujui).`
      );
      err.status = 400;
      err.code = "INVALID_APPROVAL_STATE";
      throw err;
    }

    // 6. Update Approval State -> WAITING_MANAGER_APPROVAL
    const pool = getDbPool();
    const coordNotes = (params.notes || "").trim() || "Pekerjaan fisik telah diperiksa dan disetujui oleh Koordinator.";

    const updateRes = await pool.query(
      `UPDATE report_completion_approvals SET
        status = 'WAITING_MANAGER_APPROVAL',
        coordinator_user_id = $1,
        coordinator_user_name = $2,
        coordinator_approved_at = NOW(),
        coordinator_notes = $3,
        updated_at = NOW()
       WHERE report_id = $4
       RETURNING *`,
      [params.actor.id, params.actor.name, coordNotes, params.reportId]
    );

    // 7. Append History
    const historyId = `hist_${params.reportId}_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    await pool.query(
      `INSERT INTO report_completion_approval_history (
        id, report_id, stage, action, actor_user_id, actor_name, actor_role, branch, notes, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())`,
      [
        historyId,
        params.reportId,
        "COORDINATOR_APPROVAL",
        "APPROVE_COORDINATOR",
        params.actor.id,
        params.actor.name,
        actorRole,
        report.branch || "",
        coordNotes,
      ]
    );

    // 8. Append to Incident Timeline & update status (Menuju Persetujuan Akhir BnM)
    const nowWib = formatServerTimestampWib();
    const timelineEntry = {
      stage: "Persetujuan Koordinator",
      label: `Disetujui oleh ${actorRole.toUpperCase()} - Diteruskan ke BnM Manajer`,
      timestamp: nowWib,
      actor: `${params.actor.name} (${actorRole.toUpperCase()})`,
      notes: coordNotes,
    };

    await dbUpdateIncident(params.reportId, {
      status: "pending_final_approval",
      timeline: [...(report.timeline || []), timelineEntry],
    });

    return this.mapRowToRecord(updateRes.rows[0]);
  }

  /**
   * STEP 2B: KOORDINATOR MENOLAK / MEMINTA REVISI (REJECT)
   * Mengembalikan status ke REVISION_REQUIRED dengan alasan wajib.
   */
  static async rejectByCoordinator(params: {
    reportId: string;
    actor: {
      id: string;
      name: string;
      role?: string | null;
      systemRole?: string;
      scope?: string | null;
      branch?: string | null;
    };
    reason: string;
  }): Promise<CompletionApprovalRecord> {
    const report = await dbGetIncidentById(params.reportId);
    if (!report) {
      const err: any = new Error("Laporan tidak ditemukan.");
      err.status = 404;
      throw err;
    }

    if (report.status === "resolved") {
      const err: any = new Error("Laporan sudah ditutup.");
      err.status = 400;
      throw err;
    }

    const route = await EstimationIntegrationService.getRouteByReportId(params.reportId);
    const approval = await this.getOrCreateApproval(params.reportId);

    // 1. Scope and System Admin checks
    if (params.actor.scope === "HO" || params.actor.systemRole === "ADMIN") {
      const err: any = new Error("Forbidden: User dengan scope Head Office tidak memiliki izin revisi koordinator.");
      err.status = 403;
      throw err;
    }

    // 2. Domain Routing Check
    const expectedRoute = resolveApprovalRoute(report, route);
    const actorRole = (params.actor.role || "").toLowerCase();
    if (actorRole !== expectedRoute.coordinatorRole) {
      const err: any = new Error(
        `Laporan jalur ${expectedRoute.flowType} hanya dapat direvisi oleh ${expectedRoute.coordinatorRole.toUpperCase()}.`
      );
      err.status = 403;
      throw err;
    }

    // 3. Branch Scope Check (Admin is not restricted to single branch)
    {
      const userBranch = cleanBranch(params.actor.branch);
      const reportBranch = cleanBranch(report.branch);
      if (!userBranch || userBranch !== reportBranch) {
        const err: any = new Error(
          `Aksi revisi koordinator hanya berlaku untuk cabang sendiri (${params.actor.branch || "N/A"}).`
        );
        err.status = 403;
        throw err;
      }
    }

    // 4. State Check
    if (approval.status !== "WAITING_COORDINATOR_APPROVAL") {
      const err: any = new Error(
        `Penolakan Koordinator ditolak: Status laporan saat ini adalah '${approval.status}'.`
      );
      err.status = 400;
      throw err;
    }

    // 5. Reason Validation (Wajib)
    const reason = (params.reason || "").trim();
    if (!reason) {
      const err: any = new Error("Alasan penolakan / revisi wajib diisi.");
      err.status = 400;
      err.code = "REJECTION_REASON_REQUIRED";
      throw err;
    }

    // 6. Update Approval State -> REVISION_REQUIRED (TIDAK menutup laporan!)
    const pool = getDbPool();
    const updateRes = await pool.query(
      `UPDATE report_completion_approvals SET
        status = 'REVISION_REQUIRED',
        rejection_reason = $1,
        rejected_by_role = $2,
        rejected_by_user_id = $3,
        rejected_by_user_name = $4,
        rejected_at = NOW(),
        updated_at = NOW()
       WHERE report_id = $5
       RETURNING *`,
      [reason, actorRole, params.actor.id, params.actor.name, params.reportId]
    );

    // 7. Append History
    const historyId = `hist_${params.reportId}_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    await pool.query(
      `INSERT INTO report_completion_approval_history (
        id, report_id, stage, action, actor_user_id, actor_name, actor_role, branch, notes, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())`,
      [
        historyId,
        params.reportId,
        "REVISION",
        "REJECT_COORDINATOR",
        params.actor.id,
        params.actor.name,
        actorRole,
        report.branch || "",
        reason,
      ]
    );

    // 8. Append to Incident Timeline & update status
    const nowWib = formatServerTimestampWib();
    const timelineEntry = {
      stage: "Revisi Pekerjaan Diminta",
      label: `Revisi Diminta oleh Koordinator (${actorRole.toUpperCase()})`,
      timestamp: nowWib,
      actor: `${params.actor.name} (${actorRole.toUpperCase()})`,
      notes: reason,
    };

    await dbUpdateIncident(params.reportId, {
      status: "revision_requested",
      timeline: [...(report.timeline || []), timelineEntry],
    });

    return this.mapRowToRecord(updateRes.rows[0]);
  }

  /**
   * STEP 3A: BUILDING & MAINTENANCE MANAGER FINAL APPROVAL
   * - Wajib telah melewati persetujuan Koordinator (status: WAITING_MANAGER_APPROVAL)
   * - Menghasilkan approval.status = APPROVED_PENDING_CLOSE
   * - Menghasilkan incident.status = approved_pending_close
   * - TIDAK menutup laporan (incident.status BUKAN closed, closedAt BELUM diisi)
   */
  static async approveByManager(params: {
    reportId: string;
    actor: {
      id: string;
      name: string;
      role?: string | null;
      systemRole?: string;
      scope?: string | null;
      branch?: string | null;
    };
    notes?: string;
  }): Promise<IncidentRecord> {
    const { report } = await this.validateCompletionPrerequisites(params.reportId);
    const approval = await this.getOrCreateApproval(params.reportId);

    // 1. HO Role Substitution Blocked
    if (params.actor.scope === "HO" || ["ho_admin", "gm_ho", "sm_ho"].includes(params.actor.role || "")) {
      const err: any = new Error(
        "Forbidden: User dengan role atau scope Head Office (HO) tidak dapat menggantikan kewenangan BnM Manajer cabang."
      );
      err.status = 403;
      err.code = "HO_MANAGER_SUBSTITUTION_BLOCKED";
      throw err;
    }

    const isSystemAdmin = params.actor.systemRole === "ADMIN";

    // 2. Role Check: BnM Manajer ('bm') - Admin zero-bypass
    const actorRole = (params.actor.role || "").toLowerCase();
    if (isSystemAdmin || actorRole !== "bm") {
      const err: any = new Error(
        `Persetujuan final laporan hanya dapat dilakukan oleh BnM Manajer, bukan '${actorRole.toUpperCase() || "N/A"}'.`
      );
      err.status = 403;
      err.code = "ROLE_MISMATCH";
      throw err;
    }

    // 3. Branch Scope Isolation
    {
      const userBranch = cleanBranch(params.actor.branch);
      const reportBranch = cleanBranch(report.branch);
      if (!userBranch || userBranch !== reportBranch) {
        const err: any = new Error(
          `Aksi persetujuan final BnM Manajer hanya berlaku untuk cabang sendiri (${params.actor.branch || "N/A"}), bukan cabang ${report.branch?.toUpperCase() || "N/A"}.`
        );
        err.status = 403;
        err.code = "BRANCH_SCOPE_VIOLATION";
        throw err;
      }
    }

    // 4. Central Permission Resolver check (REPORT_CLOSE / REPORT_BM_APPROVAL)
    const permCheck = await checkUserPermission({
      user: params.actor as any,
      permission: "REPORT_CLOSE",
      report,
    });
    if (!permCheck.authorized) {
      const err: any = new Error(permCheck.reason || "Unauthorized: Anda tidak memiliki izin persetujuan final BnM Manajer.");
      err.status = 403;
      throw err;
    }

    // 5. Status Check: WAITING_MANAGER_APPROVAL
    const isReadyForManager = approval.status === "WAITING_MANAGER_APPROVAL";

    if (!isReadyForManager) {
      const err: any = new Error(
        `Persetujuan final ditolak: Status approval saat ini adalah '${approval.status}'. Serah Terima wajib disetujui Koordinator terlebih dahulu.`
      );
      err.status = 400;
      err.code = "INVALID_APPROVAL_STATE";
      throw err;
    }

    // 5b. Document Completeness Check (All 5 mandatory milestone documents must be complete!)
    const { checkMilestoneCompleteness } = await import("./milestone-service");
    const completeness = await checkMilestoneCompleteness(params.reportId);
    if (!completeness.isDocumentComplete) {
      const err: any = new Error(
        `Persetujuan final ditolak. Seluruh 5 dokumen milestone wajib dilengkapi terlebih dahulu. Dokumen yang belum lengkap: ${completeness.missingDocuments.join(", ")}`
      );
      err.status = 400;
      err.code = "MANDATORY_DOCUMENTS_INCOMPLETE";
      throw err;
    }

    // 6. Execute atomic, concurrency-safe Final Approval in a single transaction
    const pool = getDbPool();
    const client = await pool.connect();
    const managerNotes = (params.notes || "").trim() || "Pekerjaan dan dokumen serah terima disetujui final oleh BnM Manajer.";
    const actorDisplayName = params.actor.name;

    try {
      await client.query("BEGIN");

      // Row-level lock on approval record
      const apprRes = await client.query(
        `SELECT * FROM report_completion_approvals WHERE report_id = $1 FOR UPDATE`,
        [params.reportId]
      );
      if (apprRes.rows.length === 0) {
        const err: any = new Error("Data persetujuan tidak ditemukan.");
        err.status = 404;
        throw err;
      }
      const lockedApproval = this.mapRowToRecord(apprRes.rows[0]);

      if (lockedApproval.status !== "WAITING_MANAGER_APPROVAL") {
        const err: any = new Error(
          `Persetujuan final ditolak: Status approval saat ini adalah '${lockedApproval.status}'. Serah Terima wajib disetujui Koordinator terlebih dahulu.`
        );
        err.status = 400;
        err.code = "INVALID_APPROVAL_STATE";
        throw err;
      }

      // Row-level lock on incident record
      const incRes = await client.query(
        `SELECT * FROM incidents WHERE id = $1 FOR UPDATE`,
        [params.reportId]
      );
      if (incRes.rows.length === 0) {
        const err: any = new Error("Laporan tidak ditemukan.");
        err.status = 404;
        throw err;
      }
      const lockedIncident = rowToIncident(incRes.rows[0]);

      // Compare-and-set update on approval record
      const updateApprRes = await client.query(
        `UPDATE report_completion_approvals SET
          status = 'APPROVED_PENDING_CLOSE',
          manager_role = 'bm',
          manager_user_id = $1,
          manager_user_name = $2,
          manager_approved_at = NOW(),
          manager_notes = $3,
          updated_at = NOW()
         WHERE report_id = $4 AND status = 'WAITING_MANAGER_APPROVAL'
         RETURNING *`,
        [params.actor.id, actorDisplayName, managerNotes, params.reportId]
      );
      if (updateApprRes.rowCount === 0) {
        const err: any = new Error("Persetujuan final ditolak karena status persetujuan telah berubah.");
        err.status = 409;
        err.code = "CONCURRENCY_CONFLICT";
        throw err;
      }

      // Append History
      const historyId = `hist_${params.reportId}_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
      await client.query(
        `INSERT INTO report_completion_approval_history (
          id, report_id, stage, action, actor_user_id, actor_name, actor_role, branch, notes, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())`,
        [
          historyId,
          params.reportId,
          "MANAGER_APPROVAL",
          "APPROVE_MANAGER",
          params.actor.id,
          actorDisplayName,
          actorRole.toUpperCase(),
          lockedIncident.branch || "",
          managerNotes,
        ]
      );

      // Update Incident: status = approved_pending_close, progress = 100 (TIDAK CLOSED & closedAt NULL)
      const nowWib = formatServerTimestampWib();
      const actorLabel = `${params.actor.name} (BnM Manajer ${lockedIncident.branch || ""})`;
      const finalApprovalTimelineEntry = {
        stage: "Persetujuan Final",
        label: "Pekerjaan Disetujui Final oleh BnM Manajer (Menunggu Case Close)",
        timestamp: nowWib,
        actor: actorLabel,
        notes: managerNotes,
      };

      const updatedTimeline = [...(lockedIncident.timeline || []), finalApprovalTimelineEntry];
      const updateIncRes = await client.query(
        `UPDATE incidents SET
          status = 'approved_pending_close',
          progress = 100,
          timeline = $1,
          updated_at = NOW()
         WHERE id = $2
         RETURNING *`,
        [JSON.stringify(updatedTimeline), params.reportId]
      );

      // Non-silent Audit Log inside the transaction
      const auditId = `audit_fa_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
      await client.query(
        `INSERT INTO permission_audit_logs (
          id, actor_user_id, actor_name, action, target_user_id,
          permission_key, effect, scope_type, branch_code, reason, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())`,
        [
          auditId,
          params.actor.id,
          actorDisplayName,
          "FINAL_APPROVAL_GRANTED",
          params.reportId,
          "REPORT_CLOSE",
          "ALLOW",
          "BRANCH",
          lockedIncident.branch || null,
          `Final Approval disetujui oleh ${actorLabel}. Menunggu Case Close. Catatan: ${managerNotes}`,
        ]
      );

      await client.query("COMMIT");
      return rowToIncident(updateIncRes.rows[0]);
    } catch (txErr) {
      await client.query("ROLLBACK").catch(() => {});
      throw txErr;
    } finally {
      client.release();
    }
  }

  /**
   * STEP 4: CASE CLOSE OLEH BNM MANAJER (EKSPLISIT)
   * - Hanya dapat dijalankan setelah Final Approval disetujui (status: APPROVED_PENDING_CLOSE)
   * - Eksekusi sebelum Final Approval DITOLAK
   * - Role: BnM Manajer cabang bersangkutan (Admin dan HO dilarang bypass)
   * - Menghasilkan incident.status = closed dan closedAt
   * - Idempoten: Jika laporan sudah closed, tidak membuat riwayat atau audit duplikat
   */
  static async closeCase(params: {
    reportId: string;
    actor: {
      id: string;
      name: string;
      role?: string | null;
      systemRole?: string;
      scope?: string | null;
      branch?: string | null;
    };
    notes?: string;
  }): Promise<IncidentRecord> {
    const report = await dbGetIncidentById(params.reportId);
    if (!report) {
      const err: any = new Error("Laporan tidak ditemukan.");
      err.status = 404;
      throw err;
    }

    // Idempotency: Jika laporan sudah ditutup sebelumnya, kembalikan data tanpa menduplikasi audit trail
    if (report.status === "closed" || report.status === "resolved") {
      return report;
    }

    // 1. HO Blocked
    if (params.actor.scope === "HO" || ["ho_admin", "gm_ho", "sm_ho"].includes(params.actor.role || "")) {
      const err: any = new Error(
        "Forbidden: User dengan role atau scope Head Office (HO) tidak memiliki kewenangan menutup laporan cabang."
      );
      err.status = 403;
      err.code = "HO_MANAGER_SUBSTITUTION_BLOCKED";
      throw err;
    }

    // 2. Role Check: BnM Manajer ('bm') - Admin zero-bypass
    const isSystemAdmin = params.actor.systemRole === "ADMIN";
    const actorRole = (params.actor.role || "").toLowerCase();
    if (isSystemAdmin || actorRole !== "bm") {
      const err: any = new Error(
        `Penutupan laporan (Case Close) hanya dapat dilakukan oleh BnM Manajer, bukan '${actorRole.toUpperCase() || "N/A"}'.`
      );
      err.status = 403;
      err.code = "ROLE_MISMATCH";
      throw err;
    }

    // 3. Branch Scope Isolation
    {
      const userBranch = cleanBranch(params.actor.branch);
      const reportBranch = cleanBranch(report.branch);
      if (!userBranch || userBranch !== reportBranch) {
        const err: any = new Error(
          `Aksi Case Close BnM Manajer hanya berlaku untuk cabang sendiri (${params.actor.branch || "N/A"}), bukan cabang ${report.branch?.toUpperCase() || "N/A"}.`
        );
        err.status = 403;
        err.code = "BRANCH_SCOPE_VIOLATION";
        throw err;
      }
    }

    // 4. Central Permission Resolver check (REPORT_CLOSE)
    const permCheck = await checkUserPermission({
      user: params.actor as any,
      permission: "REPORT_CLOSE",
      report,
    });
    if (!permCheck.authorized) {
      const err: any = new Error(permCheck.reason || "Unauthorized: Anda tidak memiliki izin penutupan laporan (REPORT_CLOSE).");
      err.status = 403;
      throw err;
    }

    // 5. Status Check: WAJIB telah disetujui Final (APPROVED_PENDING_CLOSE)
    const approval = await this.getOrCreateApproval(params.reportId);
    if (approval.status !== "APPROVED_PENDING_CLOSE" && report.status !== "approved_pending_close") {
      const err: any = new Error(
        `Case Close ditolak: Laporan belum mendapatkan persetujuan final (Final Approval) dari BnM Manajer. Status saat ini adalah '${approval.status}'.`
      );
      err.status = 400;
      err.code = "INVALID_APPROVAL_STATE";
      throw err;
    }

    // 6. Execute atomic, concurrency-safe Case Close in a single transaction
    const pool = getDbPool();
    const client = await pool.connect();
    const closingNotes = (params.notes || "").trim() || "Pekerjaan dan serah terima telah diverifikasi lengkap. Laporan resmi ditutup.";
    const actorDisplayName = params.actor.name;

    try {
      await client.query("BEGIN");

      // Row-level lock on incident record
      const incRes = await client.query(
        `SELECT * FROM incidents WHERE id = $1 FOR UPDATE`,
        [params.reportId]
      );
      if (incRes.rows.length === 0) {
        const err: any = new Error("Laporan tidak ditemukan.");
        err.status = 404;
        throw err;
      }
      const lockedIncident = rowToIncident(incRes.rows[0]);

      // Idempotency under row lock
      if (lockedIncident.status === "closed" || lockedIncident.status === "resolved") {
        await client.query("COMMIT");
        return lockedIncident;
      }

      // Row-level lock on approval record
      const apprRes = await client.query(
        `SELECT * FROM report_completion_approvals WHERE report_id = $1 FOR UPDATE`,
        [params.reportId]
      );
      if (apprRes.rows.length === 0) {
        const err: any = new Error("Data persetujuan tidak ditemukan.");
        err.status = 404;
        throw err;
      }
      const lockedApproval = this.mapRowToRecord(apprRes.rows[0]);

      if (lockedApproval.status === "CLOSED") {
        await client.query("COMMIT");
        return lockedIncident;
      }

      if (lockedApproval.status !== "APPROVED_PENDING_CLOSE" && lockedIncident.status !== "approved_pending_close") {
        const err: any = new Error(
          `Case Close ditolak: Laporan belum mendapatkan persetujuan final (Final Approval) dari BnM Manajer. Status saat ini adalah '${lockedApproval.status}'.`
        );
        err.status = 400;
        err.code = "INVALID_APPROVAL_STATE";
        throw err;
      }

      // Compare-and-set update on approval record
      const updateApprRes = await client.query(
        `UPDATE report_completion_approvals SET
          status = 'CLOSED',
          closed_at = NOW(),
          closed_by_user_id = $1,
          closed_by_user_name = $2,
          closing_notes = $3,
          updated_at = NOW()
         WHERE report_id = $4 AND status = 'APPROVED_PENDING_CLOSE'
         RETURNING *`,
        [params.actor.id, actorDisplayName, closingNotes, params.reportId]
      );
      if (updateApprRes.rowCount === 0) {
        const err: any = new Error("Case Close ditolak karena status persetujuan telah berubah.");
        err.status = 409;
        err.code = "CONCURRENCY_CONFLICT";
        throw err;
      }

      // Append History
      const historyId = `hist_${params.reportId}_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
      await client.query(
        `INSERT INTO report_completion_approval_history (
          id, report_id, stage, action, actor_user_id, actor_name, actor_role, branch, notes, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())`,
        [
          historyId,
          params.reportId,
          "CASE_CLOSE",
          "CLOSE_CASE",
          params.actor.id,
          actorDisplayName,
          actorRole.toUpperCase(),
          lockedIncident.branch || "",
          closingNotes,
        ]
      );

      // Update Incident: status = closed, progress = 100, closedAt
      const nowWib = formatServerTimestampWib();
      const actorLabel = `${params.actor.name} (BnM Manajer ${lockedIncident.branch || ""})`;
      const closeTimelineEntry = {
        stage: "Laporan Ditutup",
        label: "Laporan Resmi Ditutup (Case Close) oleh BnM Manajer",
        timestamp: nowWib,
        actor: actorLabel,
        notes: closingNotes,
      };

      const updatedTimeline = [...(lockedIncident.timeline || []), closeTimelineEntry];
      const updateIncRes = await client.query(
        `UPDATE incidents SET
          status = 'closed',
          progress = 100,
          closed_at = NOW(),
          timeline = $1,
          updated_at = NOW()
         WHERE id = $2
         RETURNING *`,
        [JSON.stringify(updatedTimeline), params.reportId]
      );

      // Non-silent Audit Log inside transaction
      const auditId = `audit_close_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
      await client.query(
        `INSERT INTO permission_audit_logs (
          id, actor_user_id, actor_name, action, target_user_id,
          permission_key, effect, scope_type, branch_code, reason, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())`,
        [
          auditId,
          params.actor.id,
          actorDisplayName,
          "REPORT_CLOSED",
          params.reportId,
          "REPORT_CLOSE",
          "ALLOW",
          "BRANCH",
          lockedIncident.branch || null,
          `Case Closed oleh ${actorLabel}. Catatan: ${closingNotes}`,
        ]
      );

      await client.query("COMMIT");
      return rowToIncident(updateIncRes.rows[0]);
    } catch (txErr) {
      await client.query("ROLLBACK").catch(() => {});
      throw txErr;
    } finally {
      client.release();
    }
  }

  /**
   * STEP 3B: BUILDING & MAINTENANCE MANAGER MENOLAK / MEMINTA REVISI (REJECT)
   */
  static async rejectByManager(params: {
    reportId: string;
    actor: {
      id: string;
      name: string;
      role?: string | null;
      systemRole?: string;
      scope?: string | null;
      branch?: string | null;
    };
    reason: string;
  }): Promise<CompletionApprovalRecord> {
    const report = await dbGetIncidentById(params.reportId);
    if (!report) {
      const err: any = new Error("Laporan tidak ditemukan.");
      err.status = 404;
      throw err;
    }

    if (report.status === "resolved") {
      const err: any = new Error("Laporan sudah ditutup.");
      err.status = 400;
      throw err;
    }

    const approval = await this.getOrCreateApproval(params.reportId);

    // 1. HO Blocked
    if (params.actor.scope === "HO" || ["ho_admin", "gm_ho", "sm_ho"].includes(params.actor.role || "")) {
      const err: any = new Error("Forbidden: User dengan scope Head Office tidak memiliki izin revisi manager.");
      err.status = 403;
      throw err;
    }

    // 2. Role Check: BnM Manajer ('bm') or Admin
    const actorRole = (params.actor.role || "").toLowerCase();
    if (params.actor.systemRole === "ADMIN" || actorRole !== "bm") {
      const err: any = new Error(`Hanya BnM Manajer yang dapat meminta revisi pada tahap ini.`);
      err.status = 403;
      throw err;
    }

    // 3. Branch Scope (Admin is not restricted to single branch)
    {
      const userBranch = cleanBranch(params.actor.branch);
      const reportBranch = cleanBranch(report.branch);
      if (!userBranch || userBranch !== reportBranch) {
        const err: any = new Error(
          `Aksi penolakan BnM Manajer hanya berlaku untuk cabang sendiri (${params.actor.branch || "N/A"}).`
        );
        err.status = 403;
        throw err;
      }
    }

    // 4. State Check
    if (approval.status !== "WAITING_MANAGER_APPROVAL") {
      const err: any = new Error(
        `Penolakan / permintaan revisi BnM Manajer ditolak: Status laporan saat ini adalah '${approval.status}'.`
      );
      err.status = 400;
      throw err;
    }

    // 5. Reason Validation (Wajib)
    const reason = (params.reason || "").trim();
    if (!reason) {
      const err: any = new Error("Alasan penolakan / revisi wajib diisi.");
      err.status = 400;
      err.code = "REJECTION_REASON_REQUIRED";
      throw err;
    }

    // 6. Update Approval State -> REVISION_REQUIRED (TIDAK menutup laporan!)
    const pool = getDbPool();
    const updateRes = await pool.query(
      `UPDATE report_completion_approvals SET
        status = 'REVISION_REQUIRED',
        rejection_reason = $1,
        rejected_by_role = $2,
        rejected_by_user_id = $3,
        rejected_by_user_name = $4,
        rejected_at = NOW(),
        updated_at = NOW()
       WHERE report_id = $5
       RETURNING *`,
      [reason, actorRole, params.actor.id, params.actor.name, params.reportId]
    );

    // 7. Append History
    const historyId = `hist_${params.reportId}_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    await pool.query(
      `INSERT INTO report_completion_approval_history (
        id, report_id, stage, action, actor_user_id, actor_name, actor_role, branch, notes, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())`,
      [
        historyId,
        params.reportId,
        "REVISION",
        "REJECT_MANAGER",
        params.actor.id,
        params.actor.name,
        actorRole,
        report.branch || "",
        reason,
      ]
    );

    // 8. Append to Incident Timeline & update status to revision_requested
    const nowWib = formatServerTimestampWib();
    const timelineEntry = {
      stage: "Revisi Pekerjaan Diminta",
      label: `Revisi Diminta oleh BnM Manajer`,
      timestamp: nowWib,
      actor: `${params.actor.name} (BnM Manajer ${report.branch || ""})`,
      notes: reason,
    };

    await dbUpdateIncident(params.reportId, {
      status: "revision_requested",
      timeline: [...(report.timeline || []), timelineEntry],
    });

    try {
      const { requestMilestoneRevision } = await import("./milestone-service");
      await requestMilestoneRevision(params.reportId, "SERAH_TERIMA", reason, params.actor as any);
    } catch {
      // ignore if milestone not yet initialized
    }

    return this.mapRowToRecord(updateRes.rows[0]);
  }

  private static mapRowToRecord(row: any): CompletionApprovalRecord {
    let attachments: CompletionApprovalAttachment[] = [];
    if (row.attachments) {
      try {
        attachments = typeof row.attachments === "string" ? JSON.parse(row.attachments) : row.attachments;
      } catch {
        attachments = [];
      }
    }

    return {
      id: row.id,
      reportId: row.report_id,
      flowType: row.flow_type as ApprovalFlowType,
      status: row.status as CompletionApprovalStatus,
      picRole: row.pic_role,
      picUserId: row.pic_user_id || null,
      picUserName: row.pic_user_name || null,
      submittedAt: row.submitted_at ? (row.submitted_at.toISOString ? row.submitted_at.toISOString() : new Date(row.submitted_at).toISOString()) : null,
      submissionNotes: row.submission_notes || null,
      attachments,
      coordinatorRole: row.coordinator_role,
      coordinatorUserId: row.coordinator_user_id || null,
      coordinatorUserName: row.coordinator_user_name || null,
      coordinatorApprovedAt: row.coordinator_approved_at ? (row.coordinator_approved_at.toISOString ? row.coordinator_approved_at.toISOString() : new Date(row.coordinator_approved_at).toISOString()) : null,
      coordinatorNotes: row.coordinator_notes || null,
      managerRole: row.manager_role,
      managerUserId: row.manager_user_id || null,
      managerUserName: row.manager_user_name || null,
      managerApprovedAt: row.manager_approved_at ? (row.manager_approved_at.toISOString ? row.manager_approved_at.toISOString() : new Date(row.manager_approved_at).toISOString()) : null,
      managerNotes: row.manager_notes || null,
      closedAt: row.closed_at ? (row.closed_at.toISOString ? row.closed_at.toISOString() : new Date(row.closed_at).toISOString()) : null,
      closedByUserId: row.closed_by_user_id || null,
      closedByUserName: row.closed_by_user_name || null,
      closingNotes: row.closing_notes || null,
      rejectionReason: row.rejection_reason || null,
      rejectedByRole: row.rejected_by_role || null,
      rejectedByUserId: row.rejected_by_user_id || null,
      rejectedByUserName: row.rejected_by_user_name || null,
      rejectedAt: row.rejected_at ? (row.rejected_at.toISOString ? row.rejected_at.toISOString() : new Date(row.rejected_at).toISOString()) : null,
      branchCode: row.branch_code,
      createdAt: row.created_at.toISOString ? row.created_at.toISOString() : new Date(row.created_at).toISOString(),
      updatedAt: row.updated_at.toISOString ? row.updated_at.toISOString() : new Date(row.updated_at).toISOString(),
    };
  }
}
