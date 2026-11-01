import { getDbPool } from "./db";
import { dbGetIncidentById, dbUpdateIncident } from "./incident-db";
import {
  MilestoneKey,
  MilestoneRecord,
  MilestoneRevision,
  MILESTONE_CONFIG,
  MILESTONE_ORDER,
  IncidentRecord,
} from "@/types/incident";
import { UserContext } from "./report-permissions";
import { saveMilestoneDocument, validateMilestoneDocumentMagicBytes } from "./milestone-storage";
import { EstimationIntegrationService } from "./estimation-service";

let tablesEnsured = false;

export interface OperationalProgressGatingInfo {
  isProgressGated: boolean;
  gatingReason: string | null;
  nextRequiredAction: string | null;
  workStatus?: string;
  estimationStatus?: string;
}

export async function checkOperationalProgressGating(
  incident: IncidentRecord
): Promise<OperationalProgressGatingInfo> {
  // 1. Initial pre-handling lifecycle statuses
  const preHandlingStatuses = [
    "pending_confirmation",
    "verifying",
    "investigating",
    "pending_bm_approval",
    "clarification_requested",
  ];

  if (preHandlingStatuses.includes(incident.status)) {
    return {
      isProgressGated: true,
      gatingReason: "Laporan baru masih dalam tahap verifikasi awal atau menunggu persetujuan BnM Manajer.",
      nextRequiredAction: "Lakukan pemeriksaan kondisi fisik di lapangan, unggah bukti inspeksi, dan ajukan keputusan BnM Manajer.",
    };
  }

  // 2. Terminal non-work statuses
  if (incident.status === "confirmed_safe") {
    return {
      isProgressGated: true,
      gatingReason: "Laporan dinyatakan Aman (confirmed_safe), tidak memerlukan penanganan pekerjaan fisik.",
      nextRequiredAction: "Tidak ada tindakan operasional lebih lanjut yang diperlukan.",
    };
  }

  if (incident.status === "rejected_invalid") {
    return {
      isProgressGated: true,
      gatingReason: "Laporan dinyatakan Ditolak (rejected_invalid) oleh BnM Manajer.",
      nextRequiredAction: "Tidak ada tindakan operasional lebih lanjut yang diperlukan.",
    };
  }

  if (incident.status === "closed" || incident.status === "resolved" || incident.status === "archived") {
    return {
      isProgressGated: true,
      gatingReason: "Laporan telah resmi disetujui final BnM Manajer dan berstatus CLOSED.",
      nextRequiredAction: "Seluruh tahapan pekerjaan dan dokumen telah selesai.",
    };
  }

  // 3. Ongoing work with progress already registered
  if ((incident.progress ?? 0) > 0 && incident.status === "in_maintenance") {
    return {
      isProgressGated: false,
      gatingReason: null,
      nextRequiredAction: null,
      workStatus: "IN_PROGRESS",
    };
  }

  // 4. Estimation & Work Readiness Gating
  // Sesuai ketentuan penyempurnaan, kalkulasi estimasi dilakukan di aplikasi SPARTA eksternal.
  // Dokumen estimasi diunggah manual ke Milestone Estimasi (25%). Jika rute belum ada atau laporan sudah in_maintenance, jangan kunci progres.
  try {
    const estimationRoute = await EstimationIntegrationService.getRouteByReportId(incident.id);
    if (!estimationRoute) {
      return {
        isProgressGated: false,
        gatingReason: null,
        nextRequiredAction: null,
        workStatus: (incident.progress ?? 0) > 0 ? "IN_PROGRESS" : "READY_FOR_WORK",
      };
    }

    if (estimationRoute.workStatus === "NOT_READY" && incident.status !== "in_maintenance") {
      return {
        isProgressGated: true,
        gatingReason: "Pekerjaan belum dinyatakan Siap Dikerjakan (READY_FOR_WORK).",
        nextRequiredAction: "Konfirmasi kesiapan kerja operasional untuk memulai pengerjaan fisik.",
        workStatus: estimationRoute.workStatus,
        estimationStatus: estimationRoute.status,
      };
    }

    return {
      isProgressGated: false,
      gatingReason: null,
      nextRequiredAction: null,
      workStatus: estimationRoute.workStatus || "IN_PROGRESS",
      estimationStatus: estimationRoute.status,
    };
  } catch (err) {
    return {
      isProgressGated: false,
      gatingReason: null,
      nextRequiredAction: null,
      workStatus: "IN_PROGRESS",
    };
  }
}

export async function ensureMilestoneTables(): Promise<void> {
  if (tablesEnsured) return;
  const pool = getDbPool();

  await pool.query(`
    CREATE TABLE IF NOT EXISTS report_milestones (
      id VARCHAR(64) PRIMARY KEY,
      report_id VARCHAR(64) NOT NULL,
      stage_order INT NOT NULL,
      stage_key VARCHAR(32) NOT NULL,
      stage_name VARCHAR(64) NOT NULL,
      target_progress INT NOT NULL,
      status VARCHAR(32) NOT NULL DEFAULT 'NOT_STARTED',
      document_url TEXT,
      document_storage_key TEXT,
      document_original_name VARCHAR(255),
      document_mime_type VARCHAR(64),
      document_file_size INT,
      actor_id VARCHAR(64),
      actor_name VARCHAR(255),
      actor_role VARCHAR(32),
      submitted_at TIMESTAMPTZ,
      notes TEXT,
      proxy_approval_status VARCHAR(64),
      revisions JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(report_id, stage_key)
    );

    CREATE INDEX IF NOT EXISTS idx_milestones_report ON report_milestones(report_id);
    CREATE INDEX IF NOT EXISTS idx_milestones_order ON report_milestones(report_id, stage_order);
  `);

  tablesEnsured = true;
}

function rowToMilestone(row: Record<string, unknown>): MilestoneRecord {
  const revisions = Array.isArray(row.revisions)
    ? (row.revisions as MilestoneRevision[])
    : typeof row.revisions === "string"
    ? JSON.parse(row.revisions)
    : [];

  return {
    id: row.id as string,
    reportId: row.report_id as string,
    stageOrder: Number(row.stage_order),
    stageKey: row.stage_key as MilestoneKey,
    stageName: row.stage_name as string,
    targetProgress: Number(row.target_progress),
    status: row.status as MilestoneRecord["status"],
    documentUrl: (row.document_url as string) || undefined,
    documentStorageKey: (row.document_storage_key as string) || undefined,
    documentOriginalName: (row.document_original_name as string) || undefined,
    documentMimeType: (row.document_mime_type as string) || undefined,
    documentFileSize: row.document_file_size ? Number(row.document_file_size) : undefined,
    actorId: (row.actor_id as string) || undefined,
    actorName: (row.actor_name as string) || undefined,
    actorRole: (row.actor_role as string) || undefined,
    submittedAt: row.submitted_at
      ? new Date(row.submitted_at as string).toISOString()
      : undefined,
    notes: (row.notes as string) || undefined,
    proxyApprovalStatus: (row.proxy_approval_status as MilestoneRecord["proxyApprovalStatus"]) || undefined,
    revisions,
    createdAt: new Date(row.created_at as string).toISOString(),
    updatedAt: new Date(row.updated_at as string).toISOString(),
  };
}

export async function getMilestones(reportId: string): Promise<MilestoneRecord[]> {
  await ensureMilestoneTables();
  const pool = getDbPool();

  const { rows } = await pool.query(
    `SELECT * FROM report_milestones WHERE report_id = $1 ORDER BY stage_order ASC`,
    [reportId]
  );

  if (rows.length === 5) {
    return rows.map(rowToMilestone);
  }

  // Initialize missing milestone records for this report in strict sequential order
  const existingMap = new Map(rows.map((r) => [r.stage_key, r]));
  const initialized: MilestoneRecord[] = [];

  for (const key of MILESTONE_ORDER) {
    const config = MILESTONE_CONFIG[key];
    const existing = existingMap.get(key);

    if (existing) {
      initialized.push(rowToMilestone(existing));
    } else {
      const id = `ms_${reportId.replace(/[^a-zA-Z0-9_-]/g, "_")}_${key.toLowerCase()}`;
      const insertRes = await pool.query(
        `INSERT INTO report_milestones (
          id, report_id, stage_order, stage_key, stage_name, target_progress, status
        ) VALUES ($1, $2, $3, $4, $5, $6, 'NOT_STARTED')
        ON CONFLICT (report_id, stage_key) DO UPDATE SET updated_at = NOW()
        RETURNING *`,
        [id, reportId, config.order, key, config.label, config.progress]
      );
      initialized.push(rowToMilestone(insertRes.rows[0]));
    }
  }

  return initialized.sort((a, b) => a.stageOrder - b.stageOrder);
}

export interface MilestoneCompletenessInfo {
  isDocumentComplete: boolean;
  missingDocuments: string[];
  completedStages: string[];
  progress: number;
}

export async function checkMilestoneCompleteness(
  reportId: string
): Promise<MilestoneCompletenessInfo> {
  const milestones = await getMilestones(reportId);
  const missingDocuments: string[] = [];
  const completedStages: string[] = [];

  for (const key of MILESTONE_ORDER) {
    const config = MILESTONE_CONFIG[key];
    const m = milestones.find((item) => item.stageKey === key);
    if (m && m.status === "SUBMITTED" && (m.documentStorageKey || m.documentUrl)) {
      completedStages.push(config.label);
    } else {
      missingDocuments.push(`Dokumen ${config.label} (${config.progress}%)`);
    }
  }

  const incident = await dbGetIncidentById(reportId);
  const currentProgress = incident?.progress ?? 0;

  return {
    isDocumentComplete: missingDocuments.length === 0,
    missingDocuments,
    completedStages,
    progress: currentProgress,
  };
}

export interface SubmitMilestoneParams {
  reportId: string;
  stageKey: MilestoneKey;
  actor: UserContext;
  fileBuffer: Buffer;
  originalFilename?: string;
  notes?: string;
  isTestSimulation?: boolean;
}

export async function submitMilestoneDocument(params: SubmitMilestoneParams): Promise<{
  milestone: MilestoneRecord;
  incident: IncidentRecord;
}> {
  const { reportId, stageKey, actor, fileBuffer, originalFilename, notes } = params;

  // 1. Ensure schema exists
  await ensureMilestoneTables();

  // 2. Report verification
  const incident = await dbGetIncidentById(reportId);
  if (!incident) {
    throw new Error(`Laporan kejadian dengan ID ${reportId} tidak ditemukan.`);
  }

  if (actor.scope === "HO") {
    throw new Error("Scope Head Office tidak memiliki izin mengunggah dokumen milestone operasional.");
  }

  if (incident.status === "closed" || incident.status === "resolved" || incident.status === "archived") {
    throw new Error("Laporan sudah ditutup/selesai. Tidak dapat mengunggah dokumen milestone lagi.");
  }

  const isSystemAdmin = actor.systemRole === "ADMIN";

  // 3. Operational Gating Check (Must apply to all, including System Admin)
  const gating = await checkOperationalProgressGating(incident);
  if (gating.isProgressGated) {
    throw new Error(
      `Progres operasional terkunci. ${gating.gatingReason} ${gating.nextRequiredAction ? `Tindakan berikutnya: ${gating.nextRequiredAction}` : ""}`.trim()
    );
  }

  // 4. Branch & Role isolation (Admin is not restricted to single branch or single tkp type)
  if (!isSystemAdmin) {
    const clean = (b?: string | null) => (b ? b.trim().toLowerCase() : "");
    if (!actor.branch || clean(actor.branch) !== clean(incident.branch)) {
      throw new Error(`Aksi hanya berlaku untuk cabang sendiri (${actor.branch || "N/A"}), bukan ${incident.branch}.`);
    }

    const tkp = incident.tkpType || "toko";
    const requiredRole = tkp === "dc" ? "bes" : tkp === "building" ? "bbs" : "bms";
    if (actor.role !== requiredRole) {
      throw new Error(
        `Unggah dokumen milestone untuk ${tkp} hanya dapat dilakukan oleh ${requiredRole.toUpperCase()} cabang terkait.`
      );
    }
  }

  // 5. Document presence & magic bytes validation
  if (!fileBuffer || fileBuffer.length === 0) {
    throw new Error("Dokumen bukti fisik (PDF/JPEG/PNG) wajib diunggah untuk menyelesaikan milestone.");
  }

  const { valid, mimeType } = validateMilestoneDocumentMagicBytes(fileBuffer);
  if (!valid) {
    throw new Error("Berkas bukti tidak valid. Hanya berkas PDF, JPEG, JPG, atau PNG asli yang diizinkan.");
  }

  // 6. Milestone Ordering & Flexible Verification
  // Petugas dapat langsung memilih milestone yang dicapai di lapangan tanpa harus berurutan.
  // Dokumen wajib yang belum lengkap tetap dilacak via checkMilestoneCompleteness.
  const milestones = await getMilestones(reportId);
  const targetConfig = MILESTONE_CONFIG[stageKey];
  if (!targetConfig) {
    throw new Error(`Milestone '${stageKey}' tidak valid.`);
  }

  const currentMilestoneIndex = milestones.findIndex((m) => m.stageKey === stageKey);
  if (currentMilestoneIndex === -1) {
    throw new Error(`Milestone ${stageKey} tidak ditemukan.`);
  }

  const currentRecord = milestones[currentMilestoneIndex];

  // 7. Save document to persistent private storage
  const savedDoc = await saveMilestoneDocument(
    fileBuffer,
    reportId,
    stageKey,
    originalFilename
  );

  // 8. Manage revision history (preserve previous documents)
  const revisions: MilestoneRevision[] = [...(currentRecord.revisions || [])];
  if (currentRecord.documentStorageKey) {
    revisions.push({
      revisionNumber: revisions.length + 1,
      submittedAt: currentRecord.submittedAt || new Date().toISOString(),
      actorId: currentRecord.actorId || actor.id,
      actorName: currentRecord.actorName || actor.name,
      actorRole: currentRecord.actorRole || (actor.systemRole === "ADMIN" ? "ADMIN" : (actor.role || "UNKNOWN")),
      documentUrl: currentRecord.documentUrl || "",
      documentStorageKey: currentRecord.documentStorageKey,
      documentOriginalName: currentRecord.documentOriginalName || currentRecord.documentStorageKey,
      documentMimeType: currentRecord.documentMimeType || "application/octet-stream",
      documentFileSize: currentRecord.documentFileSize || 0,
      notes: currentRecord.notes,
    });
  }

  const nowIso = new Date().toISOString();
  const nowWib = new Date().toLocaleString("id-ID", { timeZone: "Asia/Jakarta" }) + " WIB";

  // Untuk Approve Proxy (30%): bukti persetujuan eksternal tersimpan resmi
  let proxyStatus: string | null = null;
  if (stageKey === "APPROVE_PROXY") {
    proxyStatus = "VALIDATED";
  }

  const pool = getDbPool();
  const updateRes = await pool.query(
    `UPDATE report_milestones SET
      status = 'SUBMITTED',
      document_url = $1,
      document_storage_key = $2,
      document_original_name = $3,
      document_mime_type = $4,
      document_file_size = $5,
      actor_id = $6,
      actor_name = $7,
      actor_role = $8,
      submitted_at = $9,
      notes = $10,
      proxy_approval_status = $11,
      revisions = $12,
      updated_at = NOW()
     WHERE report_id = $13 AND stage_key = $14
     RETURNING *`,
    [
      savedDoc.url,
      savedDoc.storageKey,
      savedDoc.fileName,
      mimeType,
      savedDoc.fileSize,
      actor.id,
      isSystemAdmin ? `${actor.name} (ADMIN)` : actor.name,
      isSystemAdmin ? "ADMIN" : (actor.role || "BMS"),
      nowIso,
      notes || null,
      proxyStatus,
      JSON.stringify(revisions),
      reportId,
      stageKey,
    ]
  );

  // 9. Update incident progress: advance to the higher of existing progress and targetConfig.progress
  const currentIncidentProgress = incident.progress ?? 0;
  const newProgress = Math.max(currentIncidentProgress, targetConfig.progress);
  const actorRoleLabel = isSystemAdmin ? "ADMIN" : (actor.role?.toUpperCase() || "BMS");
  const timelineEntry = {
    stage: `Milestone ${targetConfig.label}`,
    label: `Milestone ${targetConfig.label} (${targetConfig.progress}%) Selesai Disubmit`,
    timestamp: nowWib,
    actor: `${actor.name} (${actorRoleLabel})`,
    notes: notes || `Dokumen ${savedDoc.fileName} berhasil diverifikasi.`,
  };

  // Section 1: Upload milestone SERAH_TERIMA tidak boleh otomatis mengubah status laporan ke awaiting_st.
  // Status awaiting_st hanya boleh diberikan setelah PIC resmi melakukan submitCompletion.
  const nextStatus = ["revision_requested", "in_maintenance"].includes(incident.status)
    ? incident.status
    : "in_maintenance";

  const updatedIncident = await dbUpdateIncident(reportId, {
    progress: newProgress,
    status: nextStatus,
    timeline: [...(incident.timeline || []), timelineEntry],
  });

  return {
    milestone: rowToMilestone(updateRes.rows[0]),
    incident: updatedIncident!,
  };
}

export const submitMilestoneFlexible = submitMilestoneDocument;

export async function requestMilestoneRevision(
  reportId: string,
  stageKey: MilestoneKey,
  reason: string,
  actor: UserContext
): Promise<MilestoneRecord> {
  await ensureMilestoneTables();

  if (!reason.trim()) {
    throw new Error("Alasan permintaan revisi dokumen wajib diisi.");
  }

  const pool = getDbPool();
  const updateRes = await pool.query(
    `UPDATE report_milestones SET
      status = 'REVISION_REQUESTED',
      notes = $1,
      updated_at = NOW()
     WHERE report_id = $2 AND stage_key = $3
     RETURNING *`,
    [`[Permintaan Revisi oleh ${actor.name}]: ${reason.trim()}`, reportId, stageKey]
  );

  if (updateRes.rows.length === 0) {
    throw new Error(`Milestone ${stageKey} tidak ditemukan pada laporan ${reportId}.`);
  }

  return rowToMilestone(updateRes.rows[0]);
}
