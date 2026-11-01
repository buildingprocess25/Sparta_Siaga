import { getDbPool } from "./db";
import { EstimationIntegrationService } from "./estimation-service";
import { dbGetIncidentById, dbUpdateIncident } from "./incident-db";
import { checkUserPermission } from "./permission-service";
import { formatServerTimestampWib } from "./watermark";
import { IncidentRecord } from "@/types/incident";

export type WorkStatus = "NOT_STARTED" | "IN_PROGRESS" | "COMPLETED";
export type PhotoType = "PROGRESS" | "FINAL" | "HANDOVER";
export type WorkStage = "PERSIAPAN" | "PENGERJAAN" | "FINISHING" | "SELESAI" | "SERAH_TERIMA";

export interface ProgressPhotoRecord {
  id: string;
  progressUpdateId: string;
  reportId: string;
  photoType: PhotoType;
  originalPath: string;
  watermarkedPath: string;
  fileSize: number;
  mimeType: string;
  uploadedBy: string;
  uploadedAt: string;
}

export interface ProgressUpdateRecord {
  id: string;
  reportId: string;
  progressPercentage: number;
  description: string;
  workStatus: WorkStatus;
  stage: WorkStage;
  notes: string | null;
  createdBy: string;
  createdByName: string;
  createdAt: string;
  photos: ProgressPhotoRecord[];
}

export interface CreateProgressUpdateParams {
  reportId: string;
  progressPercentage: number;
  description: string;
  stage?: WorkStage;
  notes?: string;
  actor: {
    id: string;
    name: string;
    branch?: string | null;
  };
  photos: Array<{
    photoType: PhotoType;
    originalPath: string;
    watermarkedPath: string;
    fileSize: number;
    mimeType: string;
  }>;
}

let tablesEnsured = false;

export async function ensureProgressTables(): Promise<void> {
  if (tablesEnsured) return;
  const pool = getDbPool();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS report_progress_updates (
      id VARCHAR(64) PRIMARY KEY,
      report_id VARCHAR(64) NOT NULL,
      progress_percentage INT NOT NULL CHECK (progress_percentage >= 0 AND progress_percentage <= 100),
      description TEXT NOT NULL,
      work_status VARCHAR(32) NOT NULL DEFAULT 'IN_PROGRESS',
      stage VARCHAR(32) DEFAULT 'PENGERJAAN',
      notes TEXT,
      created_by VARCHAR(64) NOT NULL,
      created_by_name VARCHAR(255) NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    ALTER TABLE report_progress_updates ADD COLUMN IF NOT EXISTS stage VARCHAR(32) DEFAULT 'PENGERJAAN';

    CREATE INDEX IF NOT EXISTS idx_progress_updates_report ON report_progress_updates(report_id);
    CREATE INDEX IF NOT EXISTS idx_progress_updates_created_at ON report_progress_updates(created_at);

    CREATE TABLE IF NOT EXISTS report_progress_photos (
      id VARCHAR(64) PRIMARY KEY,
      progress_update_id VARCHAR(64) NOT NULL REFERENCES report_progress_updates(id) ON DELETE CASCADE,
      report_id VARCHAR(64) NOT NULL,
      photo_type VARCHAR(32) NOT NULL CHECK (photo_type IN ('PROGRESS', 'FINAL', 'HANDOVER')),
      original_path TEXT NOT NULL,
      watermarked_path TEXT NOT NULL,
      file_size INT NOT NULL DEFAULT 0,
      mime_type VARCHAR(64) NOT NULL DEFAULT 'image/jpeg',
      uploaded_by VARCHAR(64) NOT NULL,
      uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_progress_photos_update ON report_progress_photos(progress_update_id);
    CREATE INDEX IF NOT EXISTS idx_progress_photos_report ON report_progress_photos(report_id);
    CREATE INDEX IF NOT EXISTS idx_progress_photos_type ON report_progress_photos(photo_type);
  `);
  tablesEnsured = true;
}

export class ProgressService {
  /**
   * Mengambil riwayat progress update secara urut kronologis (append-only timeline).
   */
  static async getProgressHistory(reportId: string): Promise<ProgressUpdateRecord[]> {
    await ensureProgressTables();
    const pool = getDbPool();

    const updatesRes = await pool.query(
      `SELECT * FROM report_progress_updates 
       WHERE report_id = $1 
       ORDER BY created_at ASC`,
      [reportId]
    );

    if (updatesRes.rows.length === 0) return [];

    const updateIds = updatesRes.rows.map((r) => r.id);
    const photosRes = await pool.query(
      `SELECT * FROM report_progress_photos 
       WHERE progress_update_id = ANY($1) 
       ORDER BY uploaded_at ASC`,
      [updateIds]
    );

    const photosByUpdateId: Record<string, ProgressPhotoRecord[]> = {};
    for (const p of photosRes.rows) {
      if (!photosByUpdateId[p.progress_update_id]) {
        photosByUpdateId[p.progress_update_id] = [];
      }
      photosByUpdateId[p.progress_update_id].push({
        id: p.id,
        progressUpdateId: p.progress_update_id,
        reportId: p.report_id,
        photoType: p.photo_type,
        originalPath: p.original_path,
        watermarkedPath: p.watermarked_path,
        fileSize: p.file_size,
        mimeType: p.mime_type,
        uploadedBy: p.uploaded_by,
        uploadedAt: p.uploaded_at instanceof Date ? p.uploaded_at.toISOString() : p.uploaded_at,
      });
    }

    return updatesRes.rows.map((r) => ({
      id: r.id,
      reportId: r.report_id,
      progressPercentage: r.progress_percentage,
      description: r.description,
      workStatus: r.work_status as WorkStatus,
      stage: (r.stage as WorkStage) || "PENGERJAAN",
      notes: r.notes || null,
      createdBy: r.created_by,
      createdByName: r.created_by_name,
      createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at,
      photos: photosByUpdateId[r.id] || [],
    }));
  }

  /**
   * Mengambil progress terakhir dan status pekerjaan saat ini.
   */
  static async getLatestProgress(reportId: string): Promise<{
    latestPercentage: number;
    workStatus: WorkStatus;
    latestUpdate: ProgressUpdateRecord | null;
  }> {
    const history = await this.getProgressHistory(reportId);
    if (history.length === 0) {
      return {
        latestPercentage: 0,
        workStatus: "NOT_STARTED",
        latestUpdate: null,
      };
    }

    const latest = history[history.length - 1];
    const hasFinalEvidence = await this.hasFinalOrHandoverEvidence(reportId);

    let workStatus: WorkStatus = "IN_PROGRESS";
    if (latest.progressPercentage === 100 && hasFinalEvidence) {
      workStatus = "COMPLETED";
    } else if (latest.progressPercentage === 0) {
      workStatus = "NOT_STARTED";
    }

    return {
      latestPercentage: latest.progressPercentage,
      workStatus,
      latestUpdate: latest,
    };
  }

  /**
   * Cek apakah laporan memiliki foto bukti akhir (FINAL atau HANDOVER).
   */
  static async hasFinalOrHandoverEvidence(reportId: string): Promise<boolean> {
    await ensureProgressTables();
    const pool = getDbPool();
    const res = await pool.query(
      `SELECT COUNT(*)::int as count 
       FROM report_progress_photos 
       WHERE report_id = $1 AND photo_type IN ('FINAL', 'HANDOVER')`,
      [reportId]
    );
    return (res.rows[0]?.count || 0) > 0;
  }

  /**
   * Menambahkan record update progress baru.
   * Dilengkapi validasi ketat:
   * 1. Laporan exists
   * 2. Estimasi status & Work status eligible (Work Status = READY_FOR_WORK atau IN_PROGRESS)
   *    (ESTIMATION_COMPLETED ≠ READY_FOR_WORK)
   * 3. Persentase valid (0-100 & tidak boleh lebih kecil dari sebelumnya)
   * 4. Foto wajib (minimal 1 foto)
   * 5. Append-only (tidak menimpa record riwayat sebelumnya)
   */
  static async createProgressUpdate(
    params: CreateProgressUpdateParams
  ): Promise<ProgressUpdateRecord> {
    await ensureProgressTables();
    const pool = getDbPool();

    // 1. Cek Laporan & Status Tertutup/Terminal
    const report = await dbGetIncidentById(params.reportId);
    if (!report) {
      const err: any = new Error("Laporan tidak ditemukan.");
      err.status = 404;
      throw err;
    }

    if (report.status === "closed" || report.status === "resolved" || report.status === "archived") {
      const err: any = new Error("Laporan sudah ditutup/selesai. Tidak dapat memperbarui progress pekerjaan.");
      err.status = 422;
      err.code = "REPORT_CLOSED";
      throw err;
    }

    const preApprovalStatuses = [
      "pending_confirmation",
      "verifying",
      "investigating",
      "pending_bm_approval",
      "clarification_requested",
    ];
    if (preApprovalStatuses.includes(report.status)) {
      const err: any = new Error("Tindakan progres fisik belum dapat dilakukan karena laporan belum disetujui BnM Manajer.");
      err.status = 422;
      err.code = "REPORT_NOT_APPROVED";
      throw err;
    }

    if (report.status === "confirmed_safe" || report.status === "rejected_invalid") {
      const err: any = new Error("Laporan berstatus aman atau ditolak tidak memerlukan penanganan progress fisik.");
      err.status = 422;
      err.code = "REPORT_TERMINAL";
      throw err;
    }

    // 2. Cek Eligibility Estimasi & Kesiapan Pekerjaan (Section D & I)
    // Update Progress HANYA boleh aktif jika Work Status = READY_FOR_WORK atau IN_PROGRESS.
    // Estimasi Selesai (ESTIMATION_COMPLETED) TIDAK OTOMATIS membuat pekerjaan Siap Dikerjakan.
    const estimationRoute = await EstimationIntegrationService.getRouteByReportId(params.reportId);
    if (!estimationRoute) {
      const err: any = new Error(
        "Progress pekerjaan belum dapat diperbarui karena proses estimasi belum dimulai."
      );
      err.status = 422;
      err.code = "ESTIMATION_NOT_FOUND";
      throw err;
    }

    if (estimationRoute.workStatus === "NOT_READY") {
      const err: any = new Error(
        "Progress pekerjaan belum dapat diperbarui. Status pekerjaan saat ini: 'Belum Siap Dikerjakan' (menunggu konfirmasi resmi siap kerja setelah estimasi selesai)."
      );
      err.status = 422;
      err.code = "WORK_NOT_READY";
      throw err;
    }

    // COMPLETED Lock (Section AB): Pekerjaan yang sudah COMPLETED tidak boleh menerima update progress baru
    if (estimationRoute.workStatus === "COMPLETED") {
      const err: any = new Error(
        "Pekerjaan telah diselesaikan (COMPLETED). Update progress baru tidak diizinkan."
      );
      err.status = 422;
      err.code = "WORK_ALREADY_COMPLETED";
      throw err;
    }

    // 3. Validasi Persentase Progress (Section T)
    const percentage = Number(params.progressPercentage);
    if (isNaN(percentage) || !Number.isInteger(percentage) || percentage < 0 || percentage > 100) {
      const err: any = new Error("Persentase progress harus berupa bilangan bulat antara 0% dan 100%.");
      err.status = 400;
      err.code = "INVALID_PROGRESS";
      throw err;
    }

    const currentStatus = await this.getLatestProgress(params.reportId);
    if (percentage < currentStatus.latestPercentage) {
      const err: any = new Error(
        `Progress tidak boleh lebih kecil dari progress sebelumnya (${currentStatus.latestPercentage}%).`
      );
      err.status = 400;
      err.code = "PROGRESS_DECREASE_NOT_ALLOWED";
      throw err;
    }

    // 4. Validasi Foto Wajib (Section V)
    if (!params.photos || params.photos.length === 0) {
      const err: any = new Error("Foto progress wajib dilampirkan minimal 1 foto.");
      err.status = 400;
      err.code = "PHOTO_REQUIRED";
      throw err;
    }

    // 5. Tentukan work_status internal (Section AG)
    const hasAnyFinalInThisBatch = params.photos.some(
      (p) => p.photoType === "FINAL" || p.photoType === "HANDOVER"
    );
    const existingHasFinal = await this.hasFinalOrHandoverEvidence(params.reportId);
    const finalEvidencePresent = hasAnyFinalInThisBatch || existingHasFinal;

    let workStatus: WorkStatus = "IN_PROGRESS";
    if (percentage === 100 && finalEvidencePresent) {
      workStatus = "COMPLETED";
    } else if (percentage === 0) {
      workStatus = "NOT_STARTED";
    }

    // 6. Insert new update record (Append-Only)
    const updateId = `PRG-${Date.now()}-${Math.random().toString(36).substring(2, 7).toUpperCase()}`;
    const selectedStage: WorkStage = params.stage || "PENGERJAAN";

    const insertUpdateRes = await pool.query(
      `INSERT INTO report_progress_updates (
        id, report_id, progress_percentage, description, work_status, stage, notes,
        created_by, created_by_name, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
      RETURNING *`,
      [
        updateId,
        params.reportId,
        percentage,
        params.description,
        workStatus,
        selectedStage,
        params.notes || null,
        params.actor.id,
        params.actor.name,
      ]
    );

    const updateRow = insertUpdateRes.rows[0];

    // 7. Insert photo records
    const insertedPhotos: ProgressPhotoRecord[] = [];
    for (const photo of params.photos) {
      const photoId = `PHT-${Date.now()}-${Math.random().toString(36).substring(2, 7).toUpperCase()}`;
      const insertPhotoRes = await pool.query(
        `INSERT INTO report_progress_photos (
          id, progress_update_id, report_id, photo_type, original_path, watermarked_path,
          file_size, mime_type, uploaded_by, uploaded_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
        RETURNING *`,
        [
          photoId,
          updateId,
          params.reportId,
          photo.photoType,
          photo.originalPath,
          photo.watermarkedPath,
          photo.fileSize,
          photo.mimeType,
          params.actor.id,
        ]
      );
      const pr = insertPhotoRes.rows[0];
      insertedPhotos.push({
        id: pr.id,
        progressUpdateId: pr.progress_update_id,
        reportId: pr.report_id,
        photoType: pr.photo_type,
        originalPath: pr.original_path,
        watermarkedPath: pr.watermarked_path,
        fileSize: pr.file_size,
        mimeType: pr.mime_type,
        uploadedBy: pr.uploaded_by,
        uploadedAt: pr.uploaded_at instanceof Date ? pr.uploaded_at.toISOString() : pr.uploaded_at,
      });
    }

    // 8. Update Incident record progress and timeline
    const nowWib = formatServerTimestampWib();
    const timelineEntry = {
      stage: "Progress Pekerjaan",
      label: `Progress Pekerjaan: ${percentage}%`,
      timestamp: nowWib,
      actor: params.actor.name,
      notes: params.description,
    };

    // Section Y/AE: incident.status tetap 'in_maintenance', TIDAK PERNAH auto-resolve.
    // COMPLETED hanya mengubah work_status, bukan incident.status.
    // incident.status = 'resolved' hanya terjadi melalui approval chain Task 5.
    const nextStatus = ["awaiting_st", "pending_final_approval", "revision_requested"].includes(report.status)
      ? report.status
      : "in_maintenance";
    await dbUpdateIncident(params.reportId, {
      progress: percentage,
      status: nextStatus, // NEVER auto-resolve — Task 5 handles Case Close
      timeline: [...(report.timeline || []), timelineEntry],
    });

    // 9. Catat Audit Log
    try {
      const auditId = `audit_prg_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
      const hasFinal = params.photos.some((p) => p.photoType === "FINAL" || p.photoType === "HANDOVER");
      const actionName = hasFinal ? "FINAL_EVIDENCE_UPLOADED" : "PROGRESS_UPDATED";

      await pool.query(
        `INSERT INTO permission_audit_logs (
          id, actor_user_id, actor_name, action, target_user_id,
          permission_key, effect, scope_type, branch_code, reason, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())`,
        [
          auditId,
          params.actor.id,
          params.actor.name,
          actionName,
          params.reportId,
          "REPORT_UPDATE_PROGRESS",
          "ALLOW",
          "BRANCH",
          report.branch || null,
          `Progress diupdate menjadi ${percentage}%. Deskripsi: ${params.description}`,
        ]
      );
    } catch (auditErr) {
      console.warn("[ProgressService] Gagal mencatat audit log:", auditErr);
    }

    // Update route work_status to IN_PROGRESS (or COMPLETED if 100% and final evidence present)
    try {
      const nextRouteWorkStatus =
        percentage === 100 && finalEvidencePresent ? "COMPLETED" : "IN_PROGRESS";
      const currentRoute = await EstimationIntegrationService.getRouteByReportId(params.reportId);
      if (currentRoute) {
        if (currentRoute.workStatus === "READY_FOR_WORK") {
          await EstimationIntegrationService.updateWorkStatus(params.reportId, "IN_PROGRESS", {
            bypassReadinessValidation: true,
          });
        }
        if (nextRouteWorkStatus === "COMPLETED") {
          await EstimationIntegrationService.updateWorkStatus(params.reportId, "COMPLETED", {
            bypassReadinessValidation: true,
          });
        }
      }
    } catch (routeErr) {
      console.warn("[ProgressService] Gagal update work_status pada route:", routeErr);
    }

    return {
      id: updateRow.id,
      reportId: updateRow.report_id,
      progressPercentage: updateRow.progress_percentage,
      description: updateRow.description,
      workStatus: updateRow.work_status as WorkStatus,
      stage: (updateRow.stage as WorkStage) || selectedStage,
      notes: updateRow.notes,
      createdBy: updateRow.created_by,
      createdByName: updateRow.created_by_name,
      createdAt: updateRow.created_at instanceof Date ? updateRow.created_at.toISOString() : updateRow.created_at,
      photos: insertedPhotos,
    };
  }

  /**
   * Menutup laporan (Case Close) melalui alur resmi Task 5:
   * 1. work_status = COMPLETED (progress 100% + mandatory HANDOVER evidence)
   * 2. PIC Completion Submission (BMS / BES / BBS)
   * 3. Coordinator Approval (BMC / BEC / BBC)
   * 4. Manager Branch Final Approval & Case Close (BM)
   * 
   * Direct close tanpa persetujuan koordinator DITOLAK KERAS.
   */
  static async closeReport(params: {
    reportId: string;
    actor: {
      id: string;
      name: string;
      role?: string | null;
      systemRole?: string;
      scope?: string | null;
      branch?: string | null;
    };
    reason?: string;
  }): Promise<IncidentRecord> {
    const { CompletionApprovalService } = await import("./completion-approval-service");
    return await CompletionApprovalService.closeCase({
      reportId: params.reportId,
      actor: params.actor,
      notes: params.reason,
    });
  }
}

