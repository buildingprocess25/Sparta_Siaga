// ============================================================
// SPARTA SIAGA — Incident / Report Domain Types
// Sesuai: UPDATE FLOW 1 SPARTA FORCE MAJURE & Flowchart Sistem Pelaporan Kejadian
// ============================================================

/**
 * 7 kategori kejadian sesuai flowchart
 */
export type DisasterType =
  | "earthquake"              // Gempa Bumi
  | "flood"                   // Kebanjiran
  | "fire"                    // Kebakaran
  | "theft"                   // Kemalingan
  | "heavy_rain"              // Hujan/Badai
  | "strong_wind"             // Angin Kencang
  | "severe_building_damage"; // Bangunan Rusak Parah

/**
 * Asal laporan: dibuat manual oleh user atau otomatis oleh sistem
 */
export type ReportOrigin =
  | "manual"
  | "automatic_earthquake"
  | "automatic_weather"
  | "automatic"
  | "unknown";

/**
 * Status laporan dalam lifecycle
 * Sesuai flowchart: laporan → estimasi → SPK → ST → Close
 */
export type IncidentStatus =
  | "pending_confirmation"  // Auto-report dibuat, menunggu konfirmasi/pemeriksaan lapangan cabang
  | "verifying"             // Menunggu verifikasi kondisi toko
  | "pending_bm_approval"   // Hasil pemeriksaan diajukan oleh BMS/BES, menunggu keputusan BnM Manajer
  | "clarification_requested" // BnM Manajer meminta klarifikasi hasil pemeriksaan
  | "confirmed_affected"    // Kerusakan disetujui BnM Manajer, siap masuk penanganan pekerjaan
  | "confirmed_safe"        // Kondisi aman disetujui/dinyatakan oleh BnM Manajer
  | "rejected_invalid"      // Laporan ditolak oleh BnM Manajer (tidak valid / hoax / salah TKP)
  | "investigating"         // Dalam penyelidikan/penugasan
  | "in_estimation"         // Sedang dalam proses Buat Estimasi
  | "in_maintenance"        // Sedang dalam perbaikan (MTC/ES)
  | "in_construction"       // Sedang dalam perbaikan (BLD)
  | "awaiting_spk"          // Menunggu Surat Perintah Kerja
  | "spk_issued"            // SPK sudah diterbitkan
  | "awaiting_st"           // Menunggu Serah Terima
  | "pending_final_approval" // Serah Terima 100% diajukan, menunggu persetujuan final BnM Manajer
  | "approved_pending_close" // Disetujui final BnM Manajer, menunggu tindakan Case Close
  | "revision_requested"    // BnM Manajer meminta revisi pada persetujuan final
  | "resolved"              // Selesai (legacy status)
  | "closed"                // Laporan resmi disetujui final BnM Manajer & ditutup
  | "archived"              // Diarsipkan
  | "expired_unhandled";    // Kedaluwarsa otomatis (48 jam tanpa pemeriksaan awal, ditampilkan sebagai 'Tidak Ditindaklanjuti')

/**
 * Pengelompokan status Riwayat (History) vs Aktif (Active)
 * Sesuai SPARTA SIAGA Report Lifecycle:
 * - History: closed, resolved, archived, confirmed_safe, rejected_invalid, expired_unhandled
 * - Active: status lainnya (pending_confirmation, verifying, clarification_requested, pending_bm_approval,
 *   confirmed_affected, in_estimation, awaiting_spk, spk_issued, in_maintenance, in_construction,
 *   awaiting_st, pending_final_approval, approved_pending_close, revision_requested, dsb.)
 */
export const HISTORY_STATUSES: IncidentStatus[] = [
  "closed",
  "resolved",
  "archived",
  "confirmed_safe",
  "rejected_invalid",
  "expired_unhandled",
];

export function isHistoryStatus(status?: string | null): boolean {
  if (!status) return false;
  return (HISTORY_STATUSES as string[]).includes(status);
}

export function isActiveStatus(status?: string | null): boolean {
  if (!status) return false;
  return !isHistoryStatus(status);
}

/**
 * Tipe lokasi TKP sesuai flowchart
 */
export type TkpType = "toko" | "dc" | "building";

/**
 * Role sesuai glossary yang telah dikonfirmasi
 */
export type SpartaRole =
  | "ho_admin"
  | "gm_ho"         // General Manager HO — dapat memberi instruksi ke cabang
  | "sm_ho"         // Senior Manager HO — dapat memberi instruksi ke cabang
  | "bm"            // BnM Manajer
  | "bnm"           // Branch & Maintenance (BnM)
  | "bbc"           // Branch Building Coordinator
  | "bmc"           // Branch Maintenance Coordinator
  | "bec"           // Branch Engineering Coordinator
  | "bes"           // Branch Engineering Support
  | "bms"           // Branch Maintenance Support
  | "bbs"           // Branch Building Support
  | "tim_toko"
  | "tim_maintenance"
  | "sparta_maintenance" // Sparta Maintenance
  | "tim_office"
  | "tim_warehouse"
  | "rekanan";

export type SystemRole = "ADMIN" | "USER";
export type Scope = "HO" | "BRANCH";

// Legacy alias — dipertahankan untuk backward compatibility
export type RoleType =
  | "ho_admin"
  | "store_manager_affected"
  | "store_manager_normal"
  | "sparta_maintenance";

export type InspectionMethod = "kunjungan_langsung" | "informasi_petugas";
export type InspectionCondition = "damaged" | "safe" | "uncertain";
export type BmDecision = "approved" | "safe" | "rejected" | "clarification_requested";

export interface InspectionEvidence {
  photoUrl: string;
  photoPath?: string;
  sourceType: "camera" | "gallery" | "officer_upload";
  caption?: string;
  officerName?: string;
  officerContact?: string;
  officerRole?: string;
  timestamp: string;
}

export interface OfficerSource {
  name: string;
  contact?: string;
  role?: string;
  channel?: string; // e.g. "WhatsApp", "Media Perusahaan"
}

export interface BmApprovalRecord {
  decision: BmDecision;
  decidedBy: string;
  decidedAt: string;
  decisionNotes?: string;
  rejectionReason?: string;
  clarificationReason?: string;
}

export interface InspectionRevision {
  revisionNumber: number;
  submittedAt: string;
  inspectorName: string;
  inspectorRole: string;
  inspectionMethod: InspectionMethod;
  condition: InspectionCondition;
  notes: string;
  categories?: string[];
  severity?: "Ringan" | "Sedang" | "Berat";
  photos: string[];
  evidenceDetails?: InspectionEvidence[];
  officerSource?: OfficerSource;
}

export interface DamageReport {
  confirmedBy: string;
  confirmedAt: string;
  isDamaged: boolean;
  condition?: InspectionCondition;
  inspectionMethod?: InspectionMethod;
  officerSource?: OfficerSource;
  evidenceDetails?: InspectionEvidence[];
  categories?: (
    | "Dinding/Struktur"
    | "Kaca/Pintu"
    | "Rak Barang"
    | "Kelistrikan/AC"
    | "Plafon"
    | string
  )[];
  severity?: "Ringan" | "Sedang" | "Berat";
  photos?: string[];
  operationalStatus?: "Buka Normal" | "Tutup Sementara";
  notes?: string;
  bmApproval?: BmApprovalRecord;
  revisions?: InspectionRevision[];
}

export interface MaintenanceTicket {
  ticketId: string;
  assignedTechnician?: string;
  workDescription?: string;
  completedAt?: string;
  resolutionPhotos?: string[];
  costEstimate?: string;
}

export interface TimelineEvent {
  stage?: string;
  label?: string;
  timestamp: string;
  actor: string;
  notes?: string;
  activity?: string;
}

/**
 * Toko yang terindikasi berada dalam area dampak bencana.
 * PENTING: exposure calculation != confirmed physical damage.
 * Cabang terdampak tetap harus memberikan konfirmasi lapangan.
 */
export interface ReportAffectedStore {
  kode_toko: string;
  nama_toko: string;
  cabang: string;
  alamat?: string;
  fr_type?: string;
  distance_km: number;
  exposure_zone: "PRIORITY_MONITOR" | "MONITOR"; // Hasil kalkulasi SPARTA, bukan confirmed damage
  confirmation_status: "pending" | "confirmed_safe" | "confirmed_damaged" | "unreachable";
  confirmed_by?: string;
  confirmed_at?: string;
  damage_notes?: string;
}

/**
 * Instruksi dari GM/SM HO terkait nomor laporan tertentu.
 * Sesuai flowchart: GM/SM HO dapat memberi arahan/instruksi ke cabang melalui Web SPARTA,
 * kemudian didistribusikan via WA ke BnM, BBC, BMC, BES.
 * PENTING: "instruction created" != "delivery status" — keduanya dicatat terpisah.
 */
export interface ManagementInstruction {
  instruction_id: string;
  report_id: string;
  instruction_text: string;
  author_id: string;
  author_name: string;
  author_role: "gm_ho" | "sm_ho";
  created_at: string;
  delivery_status:
    | "pending"
    | "queued"
    | "delivered"
    | "failed"
    | "not_configured"; // Jika WA provider belum tersedia
  target_roles: ("bnm" | "bbc" | "bmc" | "bes")[];
  delivery_channel: "wa";  // Per flowchart, distribusi via Auto WA
  delivery_log?: string;   // Catatan pengiriman / error detail
}

export interface IncidentReporter {
  id?: string;
  userId?: string;
  name: string;
  nik?: string | null;
  role?: string | null;
  branch?: string | null;
  storeId?: string | null;
}

export { getRoleDisplayLabel } from "@/lib/role-catalog";

export interface IncidentPhotoDetail {
  url: string;
  source: "camera" | "gallery";
  reporterRelation?: "self" | "received" | null;
  galleryReason?: string | null;
  sourceProvider?: string | null;
  receiptContext?: string | null;
  capturedAt?: string | null;
  slotLabel?: string;
}

/**
 * Record laporan utama — anchor lifecycle sistem.
 * Nomor Laporan adalah anchor:
 *   Laporan → Estimasi → SPK → ST → Close
 *   Laporan → Update Progres → Upload Foto → Close
 */
export interface IncidentRecord {
  id: string;               // Nomor Laporan, e.g. "LAP-EQ-2026-0001" atau "LAP-MAN-2026-0042"
  date: string;
  disasterType: DisasterType;

  // === Asal Laporan ===
  reportOrigin?: ReportOrigin | null;
  reporter?: IncidentReporter;   // Source of truth original pelapor
  earthquakeEventId?: string;    // Linked ke earthquake event ID jika auto
  canonicalEventId?: string;     // Canonical event ID for cross-source reconciliation
  earthquakeSource?: string;     // "BMKG" | "USGS"
  earthquakeProvenance?: string; // Label provenance sesuai prinsip semantik

  // === TKP ===
  tkpType?: TkpType;
  storeId: string;
  storeName: string;
  branch: string;
  locationCity: string;
  locationKind?: "STORE" | "FACILITY";
  locationId?: string;
  locationCodeSnapshot?: string;
  locationNameSnapshot?: string;
  locationTypeSnapshot?: string;
  latitudeSnapshot?: number | null;
  longitudeSnapshot?: number | null;
  branchSnapshot?: string;
  primaryPicUserId?: string;
  primaryPicClaimedAt?: string;
  primaryPicName?: string;

  // === Status & Progress ===
  status: IncidentStatus;
  progress: number;
  completionApprovalStatus?: string;

  // === Metadata Bencana ===
  disasterMetadata?: {
    magnitude?: number;
    depth?: string;
    coordinates?: [number, number];
    place?: string;
    time?: string;
    distanceKm?: number;
  };

  // === Multi-store exposure (auto-report: satu laporan per branch, multi-store) ===
  affectedStores?: ReportAffectedStore[];
  affectedStoreCount?: number;
  dangerStoreCount?: number;

  // === Konfirmasi Lapangan dari Cabang ===
  verification?: DamageReport;

  // === Maintenance / Construction (diisi setelah estimasi) ===
  maintenanceTicket?: MaintenanceTicket;
  targetCompletionDate?: string;

  // === Foto Lapangan ===
  // Manual: wajib (4 foto tampak). Auto-report: field ini null/empty pending konfirmasi.
  fieldPhotos?: (string | IncidentPhotoDetail)[];

  // === Sinkronisasi Ekosistem Eksternal (SPARTA Maintenance / Engineering Support) ===
  externalWorkId?: string;
  externalSystem?: string;
  externalWorkStatus?: string;
  externalSyncedAt?: string;

  // === Timeline / History ===
  timeline: TimelineEvent[];
  createdAt: string;
  updatedAt: string;
  closedAt?: string;
  reminder24hSentAt?: string;
  expiredAt?: string;
}

export interface IncidentStats {
  total: number;
  theft: number;
  fire: number;
  earthquake: number;
  flood: number;
  heavy_rain: number;
  strong_wind: number;
  severe_building_damage: number;
  wind: number; // legacy
  other: number;
  autoEarthquake?: number;
  waitingInspection?: number;
  waitingBmApproval?: number;
  inHandling?: number;
  closed?: number;
  statusBreakdown: {
    resolved: number;
    inMaintenance: number;
    investigating: number;
    verifying: number;
    unhandled: number;
  };
}

// ============================================================
// 5 MILESTONES WORKFLOW TYPES (CEKLIS -> ESTIMASI -> APPROVE PROXY -> SPK -> SERAH TERIMA)
// ============================================================

export type MilestoneKey =
  | "CEKLIS"
  | "ESTIMASI"
  | "APPROVE_PROXY"
  | "SPK"
  | "SERAH_TERIMA";

export const MILESTONE_ORDER: readonly MilestoneKey[] = [
  "CEKLIS",
  "ESTIMASI",
  "APPROVE_PROXY",
  "SPK",
  "SERAH_TERIMA",
] as const;

export const MILESTONE_CONFIG: Record<
  MilestoneKey,
  { order: number; label: string; progress: number }
> = {
  CEKLIS: { order: 1, label: "Ceklis", progress: 10 },
  ESTIMASI: { order: 2, label: "Estimasi", progress: 25 },
  APPROVE_PROXY: { order: 3, label: "Approve Proxy", progress: 30 },
  SPK: { order: 4, label: "SPK", progress: 50 },
  SERAH_TERIMA: { order: 5, label: "Serah Terima", progress: 100 },
};

export interface MilestoneRevision {
  revisionNumber: number;
  submittedAt: string;
  actorId: string;
  actorName: string;
  actorRole: string;
  documentUrl: string;
  documentStorageKey: string;
  documentOriginalName: string;
  documentMimeType: string;
  documentFileSize: number;
  notes?: string;
}

export type MilestoneStatus =
  | "NOT_STARTED"
  | "PENDING_SUBMISSION"
  | "SUBMITTED"
  | "REVISION_REQUESTED";

export interface MilestoneRecord {
  id: string;
  reportId: string;
  stageOrder: number;
  stageKey: MilestoneKey;
  stageName: string;
  targetProgress: number;
  status: MilestoneStatus;
  documentUrl?: string;
  documentStorageKey?: string;
  documentOriginalName?: string;
  documentMimeType?: string;
  documentFileSize?: number;
  actorId?: string;
  actorName?: string;
  actorRole?: string;
  submittedAt?: string;
  notes?: string;
  proxyApprovalStatus?: "EVIDENCE_SUBMITTED_AWAITING_POLICY" | "VALIDATED";
  revisions: MilestoneRevision[];
  createdAt: string;
  updatedAt: string;
}

