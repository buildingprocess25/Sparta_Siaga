"use client";

import React, { useState } from "react";
import {
  CheckCircle2,
  Clock,
  AlertTriangle,
  Send,
  Check,
  XCircle,
  ShieldCheck,
  Lock,
  ChevronDown,
  ChevronUp,
  FileCheck,
  Building,
  UserCheck,
} from "lucide-react";
import { IncidentRecord } from "@/types/incident";
import {
  CompletionApprovalRecord,
  CompletionApprovalHistoryRecord,
  ApprovalRouteResolution,
} from "@/lib/completion-approval-service";

interface CompletionApprovalCardProps {
  incident: IncidentRecord;
  approval: CompletionApprovalRecord | null;
  route: ApprovalRouteResolution | null;
  history: CompletionApprovalHistoryRecord[];
  latestProgress: number;
  hasFinalEvidence: boolean;
  hasMilestoneSt?: boolean;
  userRole?: string | null;
  userBranch?: string | null;
  userSystemRole?: string;
  canSubmitCompletion: boolean;
  submitCompletionReason?: string;
  canApproveCoordinator: boolean;
  approveCoordinatorReason?: string;
  canFinalApprove?: boolean;
  finalApproveReason?: string;
  canClose: boolean;
  closeReason?: string;
  onRefresh: () => void;
  /** Detail Laporan can display status/history but never operational actions. */
  readOnly?: boolean;
}

function safeFormatDate(raw?: string | null): string {
  if (!raw) return "-";
  try {
    const d = new Date(raw);
    if (isNaN(d.getTime())) return raw;
    return d.toLocaleString("id-ID", {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return raw;
  }
}

export function CompletionApprovalCard({
  incident,
  approval,
  route,
  history,
  latestProgress,
  hasFinalEvidence,
  hasMilestoneSt = false,
  userRole,
  userBranch,
  userSystemRole,
  canSubmitCompletion,
  submitCompletionReason,
  canApproveCoordinator,
  approveCoordinatorReason,
  canFinalApprove,
  finalApproveReason,
  canClose,
  closeReason,
  onRefresh,
  readOnly = false,
}: CompletionApprovalCardProps) {
  const [showHistory, setShowHistory] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Dialog State
  const [activeModal, setActiveModal] = useState<"submit" | "approve" | "reject" | "close" | null>(null);
  const [notesInput, setNotesInput] = useState("");

  const hasValidCompletionEvidence = Boolean(hasFinalEvidence || hasMilestoneSt);
  const currentProgress = Math.max(latestProgress || 0, incident.progress || 0);
  const isProgress100 = currentProgress >= 100;
  const isCompleted = isProgress100 && hasValidCompletionEvidence;

  const prerequisiteReason = !isProgress100
    ? `Pekerjaan fisik belum mencapai 100% (progres saat ini: ${currentProgress}%).`
    : !hasValidCompletionEvidence
    ? "Wajib melampirkan bukti serah terima (Milestone Serah Terima atau foto FINAL / HANDOVER)."
    : undefined;
  const isResolved = incident.status === "closed" || incident.status === "resolved" || approval?.status === "CLOSED";
  const status = approval?.status || "WAITING_PIC_SUBMISSION";

  const cleanUserBranch = (userBranch || "").trim().toLowerCase();
  const cleanReportBranch = (incident.branch || "").trim().toLowerCase();
  const isSameBranch = cleanUserBranch === cleanReportBranch;
  const isSysAdmin = userSystemRole === "ADMIN";

  const handleAction = async (actionType: "submit" | "approve" | "reject" | "close") => {
    setActionLoading(true);
    setErrorMessage(null);

    try {
      let endpoint = `/api/incidents/${incident.id}/completion/${actionType}`;
      let body: any = {};

      if (actionType === "submit") {
        body = { notes: notesInput.trim() };
      } else if (actionType === "approve") {
        body = { notes: notesInput.trim() };
      } else if (actionType === "close") {
        body = { notes: notesInput.trim() };
      } else if (actionType === "reject") {
        if (!notesInput.trim()) {
          setErrorMessage("Alasan penolakan / revisi wajib diisi.");
          setActionLoading(false);
          return;
        }
        body = { reason: notesInput.trim() };
      }

      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const json = await res.json().catch(() => ({}));

      if (!res.ok) {
        setErrorMessage(json.error || "Gagal memproses aksi persetujuan.");
      } else {
        setActiveModal(null);
        setNotesInput("");
        onRefresh();
      }
    } catch (err: any) {
      console.error(err);
      setErrorMessage("Terjadi kesalahan jaringan atau sistem.");
    } finally {
      setActionLoading(false);
    }
  };

  // Determine role labels based on category / route
  const tkpType = (incident.tkpType || "toko").toLowerCase();
  const defaultPicRole = tkpType === "dc" ? "BES" : tkpType === "building" ? "BBS" : "BMS";
  const defaultCoordRole = tkpType === "dc" ? "BEC" : tkpType === "building" ? "BBC" : "BMC";

  const picLabel = route ? route.picRole.toUpperCase() : defaultPicRole;
  const coordLabel = route ? route.coordinatorRole.toUpperCase() : defaultCoordRole;

  // READ-ONLY SIMPLIFIED APPROVAL TAB (Task T04)
  if (readOnly) {
    const verification = incident.verification;
    const bmApproval = verification?.bmApproval;
    const hasInspectionStarted = Boolean(verification?.confirmedBy || verification?.confirmedAt);

    // Initial inspection decision label & style
    const getBmDecisionInfo = () => {
      if (!bmApproval) {
        if (incident.status === "pending_bm_approval") {
          return {
            label: "Menunggu Keputusan BnM Manajer",
            badgeClass: "bg-purple-100 text-purple-800 dark:bg-purple-950/60 dark:text-purple-300 border-purple-200 dark:border-purple-800",
            decidedBy: `Menunggu BnM Manajer (${incident.branch})`,
            date: "-",
            notes: "Hasil pemeriksaan diajukan oleh petugas cabang dan sedang menunggu persetujuan awal BnM Manajer.",
          };
        }
        if (hasInspectionStarted) {
          return {
            label: "Pemeriksaan Dikonfirmasi",
            badgeClass: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800",
            decidedBy: `BnM Manajer (${incident.branch})`,
            date: safeFormatDate(verification?.confirmedAt),
            notes: verification?.notes || "Dikonfirmasi operasional.",
          };
        }
        return {
          label: "Persetujuan Belum Dimulai",
          badgeClass: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300 border-slate-200 dark:border-slate-700",
          decidedBy: `BnM Manajer (${incident.branch})`,
          date: "-",
          notes: "Persetujuan awal BnM Manajer akan aktif setelah pemeriksaan fisik lapangan diinput oleh petugas cabang.",
        };
      }

      switch (bmApproval.decision) {
        case "approved":
          return {
            label: "Disetujui Penanganan Lanjutan",
            badgeClass: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800",
            decidedBy: bmApproval.decidedBy || `BnM Manajer (${incident.branch})`,
            date: safeFormatDate(bmApproval.decidedAt),
            notes: bmApproval.decisionNotes || "Disetujui untuk masuk ke alur penanganan teknis.",
          };
        case "safe":
          return {
            label: "Dinyatakan Aman (Selesai)",
            badgeClass: "bg-teal-100 text-teal-800 dark:bg-teal-950/60 dark:text-teal-300 border-teal-200 dark:border-teal-800",
            decidedBy: bmApproval.decidedBy || `BnM Manajer (${incident.branch})`,
            date: safeFormatDate(bmApproval.decidedAt),
            notes: bmApproval.decisionNotes || "Kondisi fisik aman dan operasional berjalan normal.",
          };
        case "rejected":
          return {
            label: "Ditolak (Data Tidak Valid)",
            badgeClass: "bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300 border-rose-200 dark:border-rose-800",
            decidedBy: bmApproval.decidedBy || `BnM Manajer (${incident.branch})`,
            date: safeFormatDate(bmApproval.decidedAt),
            notes: bmApproval.rejectionReason || "Laporan tidak valid atau salah lokasi.",
          };
        case "clarification_requested":
          return {
            label: "Permintaan Klarifikasi",
            badgeClass: "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300 border-amber-200 dark:border-amber-800",
            decidedBy: bmApproval.decidedBy || `BnM Manajer (${incident.branch})`,
            date: safeFormatDate(bmApproval.decidedAt),
            notes: bmApproval.clarificationReason || "Diperlukan informasi atau bukti tambahan.",
          };
        default:
          return {
            label: String(bmApproval.decision).toUpperCase(),
            badgeClass: "bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-300 border-slate-200 dark:border-slate-700",
            decidedBy: bmApproval.decidedBy || `BnM Manajer (${incident.branch})`,
            date: safeFormatDate(bmApproval.decidedAt),
            notes: bmApproval.decisionNotes || "-",
          };
      }
    };

    const bmDecisionInfo = getBmDecisionInfo();

    // Handover flow resolution
    const isHandoverStarted = Boolean(approval?.submittedAt || approval?.status || latestProgress === 100);
    const flowTitle = tkpType === "dc"
      ? `Jalur DC: ${picLabel} → ${coordLabel} → BnM Manajer`
      : tkpType === "building"
      ? `Jalur Gedung: ${picLabel} → ${coordLabel} → BnM Manajer`
      : `Jalur Toko: ${picLabel} → ${coordLabel} → BnM Manajer`;

    // Revision check in Serah Terima
    const isRevision = status === "REVISION_REQUIRED";
    const isRevisionByCoord = isRevision && (approval?.rejectedByRole?.toLowerCase().includes("c") || approval?.rejectedByRole?.toLowerCase().includes("coord"));
    const isRevisionByManager = isRevision && (approval?.rejectedByRole?.toLowerCase() === "bm" || approval?.rejectedByRole?.toLowerCase().includes("manager"));

    return (
      <div className="space-y-6 animate-in fade-in select-text">
        {/* BAGIAN 1: APPROVAL PEMERIKSAAN AWAL */}
        <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 space-y-4 shadow-2xs">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-slate-100 dark:border-slate-800">
            <div>
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-900 dark:text-white flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-[#1D5AA6] dark:text-blue-400" />
                1. Approval Pemeriksaan Awal
              </h4>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                Alur: PIC {picLabel} ({incident.branch}) → BnM Manajer ({incident.branch})
              </p>
            </div>
            <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold border self-start sm:self-auto ${bmDecisionInfo.badgeClass}`}>
              {bmDecisionInfo.label}
            </span>
          </div>

          {!hasInspectionStarted ? (
            <div className="p-4 rounded-xl border border-dashed border-slate-200 dark:border-slate-800 text-center text-xs text-slate-500 bg-slate-50/50 dark:bg-slate-900/30">
              Persetujuan belum dimulai. Pemeriksaan fisik lapangan belum dilakukan oleh tim cabang.
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
              {/* Hasil Pemeriksaan Lapangan */}
              <div className="p-3.5 rounded-xl border border-slate-200/80 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/40 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-slate-800 dark:text-slate-200">
                    Pemeriksaan Fisik Lapangan
                  </span>
                  <span
                    className={`text-[10px] font-bold px-2 py-0.5 rounded-md ${
                      verification?.isDamaged
                        ? "bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300"
                        : "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300"
                    }`}
                  >
                    {verification?.isDamaged ? "RUSAK / TERDAMPAK" : "AMAN / TIDAK RUSAK"}
                  </span>
                </div>
                <div className="space-y-1 text-[11px] text-slate-600 dark:text-slate-400">
                  <p>
                    <span className="text-slate-400">Pemeriksa:</span>{" "}
                    <strong className="text-slate-800 dark:text-slate-200">{verification?.confirmedBy || "-"}</strong>
                  </p>
                  <p>
                    <span className="text-slate-400">Waktu Pemeriksaan:</span>{" "}
                    <span className="text-slate-700 dark:text-slate-300 font-medium">
                      {safeFormatDate(verification?.confirmedAt)}
                    </span>
                  </p>
                  <p>
                    <span className="text-slate-400">Metode:</span>{" "}
                    <span className="text-slate-700 dark:text-slate-300">
                      {verification?.inspectionMethod === "kunjungan_langsung" ? "Kunjungan Langsung" : "Informasi Petugas"}
                    </span>
                  </p>
                  {verification?.notes && (
                    <p className="pt-1 text-slate-700 dark:text-slate-300 italic border-t border-slate-200/50 dark:border-slate-800/50">
                      &ldquo;{verification.notes}&rdquo;
                    </p>
                  )}
                </div>
              </div>

              {/* Keputusan BnM Manajer */}
              <div className="p-3.5 rounded-xl border border-slate-200/80 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/40 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-slate-800 dark:text-slate-200">
                    Keputusan BnM Manajer
                  </span>
                  <span className="text-[10px] font-mono text-slate-400">
                    {bmDecisionInfo.date !== "-" ? bmDecisionInfo.date : "Menunggu"}
                  </span>
                </div>
                <div className="space-y-1 text-[11px] text-slate-600 dark:text-slate-400">
                  <p>
                    <span className="text-slate-400">Pengambil Keputusan:</span>{" "}
                    <strong className="text-slate-800 dark:text-slate-200">{bmDecisionInfo.decidedBy}</strong>
                  </p>
                  <p>
                    <span className="text-slate-400">Status:</span>{" "}
                    <span className="font-semibold text-slate-800 dark:text-slate-200">{bmDecisionInfo.label}</span>
                  </p>
                  <div className="pt-1 border-t border-slate-200/50 dark:border-slate-800/50">
                    <span className="text-[10px] text-slate-400 block mb-0.5">Catatan BnM Manajer:</span>
                    <p className="text-slate-700 dark:text-slate-300 italic">
                      &ldquo;{bmDecisionInfo.notes}&rdquo;
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* BAGIAN 2: APPROVAL SERAH TERIMA & STATUS CASE CLOSE */}
        <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 space-y-4 shadow-2xs">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-slate-100 dark:border-slate-800">
            <div>
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-900 dark:text-white flex items-center gap-2">
                <FileCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                2. Approval Serah Terima
              </h4>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                {flowTitle}
              </p>
            </div>
            <div>
              {isResolved ? (
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-700">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                  Selesai & Ditutup
                </span>
              ) : status === "APPROVED_PENDING_CLOSE" ? (
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-teal-100 text-teal-800 dark:bg-teal-950/60 dark:text-teal-300 border border-teal-300 dark:border-teal-700">
                  <Clock className="w-3.5 h-3.5 text-teal-600" />
                  Menunggu Case Close
                </span>
              ) : isRevision ? (
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300 border border-rose-300 dark:border-rose-700">
                  <AlertTriangle className="w-3.5 h-3.5 text-rose-600" />
                  Revisi Diminta
                </span>
              ) : status === "WAITING_COORDINATOR_APPROVAL" ? (
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300 border border-blue-300 dark:border-blue-700">
                  <Clock className="w-3.5 h-3.5 text-blue-600" />
                  Menunggu {coordLabel}
                </span>
              ) : status === "WAITING_MANAGER_APPROVAL" ? (
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-purple-100 text-purple-800 dark:bg-purple-950/60 dark:text-purple-300 border border-purple-300 dark:border-purple-700">
                  <Clock className="w-3.5 h-3.5 text-purple-600" />
                  Menunggu BnM Manajer
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
                  <Clock className="w-3.5 h-3.5 text-slate-500" />
                  {latestProgress === 100 ? `Menunggu Pengajuan ${picLabel}` : "Pekerjaan Fisik Berjalan"}
                </span>
              )}
            </div>
          </div>

          {/* Empty state if Serah Terima hasn't started */}
          {!isHandoverStarted ? (
            <div className="p-4 rounded-xl border border-dashed border-slate-200 dark:border-slate-800 text-center text-xs text-slate-500 bg-slate-50/50 dark:bg-slate-900/30 space-y-1">
              <p className="font-semibold text-slate-700 dark:text-slate-300">Persetujuan belum dimulai.</p>
              <p className="text-[11px] text-slate-400">
                Pekerjaan fisik saat ini berada pada tahap {latestProgress}%. Serah terima dapat diajukan setelah pekerjaan fisik mencapai 100% dan bukti fisik lengkap.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Alert jika ada revisi */}
              {isRevision && (
                <div className="p-3.5 bg-rose-50/80 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900/50 rounded-xl text-xs space-y-1 text-rose-900 dark:text-rose-200">
                  <div className="font-bold flex items-center gap-1.5 text-rose-700 dark:text-rose-400">
                    <AlertTriangle className="w-4 h-4 shrink-0" />
                    <span>
                      Catatan Permintaan Revisi ({approval?.rejectedByRole?.toUpperCase() || "Approver"} - {approval?.rejectedByUserName || "Approver"}):
                    </span>
                  </div>
                  <p className="text-[11px] pl-5.5 italic bg-white/70 dark:bg-slate-900/60 p-2 rounded-lg border border-rose-200/50 dark:border-rose-800/50">
                    &ldquo;{approval?.rejectionReason || "Harap lengkapi berkas dan verifikasi kembali."}&rdquo;
                  </p>
                  <p className="text-[10px] text-rose-600 dark:text-rose-400 pl-5.5">
                    Perbaikan bukti pekerjaan diajukan kembali melalui Update Progress oleh PIC lapangan ({picLabel}).
                  </p>
                </div>
              )}

              {/* 3-Step Sequential Handover Table / Cards */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                {/* 1. Pengajuan PIC */}
                <div className="p-3.5 rounded-xl border border-slate-200/80 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/40 space-y-1.5 flex flex-col justify-between">
                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-slate-800 dark:text-slate-200">
                        1. Pengajuan PIC
                      </span>
                      <span
                        className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${
                          approval?.submittedAt
                            ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300"
                            : latestProgress === 100 && hasFinalEvidence
                            ? "bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300"
                            : "bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-400"
                        }`}
                      >
                        {approval?.submittedAt
                          ? "Diajukan"
                          : latestProgress === 100 && hasFinalEvidence
                          ? "Siap Diajukan"
                          : "Belum Diajukan"}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-600 dark:text-slate-400">
                      PIC: <strong className="text-slate-800 dark:text-slate-200">{approval?.picUserName || (latestProgress === 100 ? `PIC ${picLabel}` : "-")}</strong>
                    </p>
                    <p className="text-[10px] text-slate-400">
                      Waktu: {safeFormatDate(approval?.submittedAt)}
                    </p>
                  </div>
                  {approval?.submissionNotes && (
                    <p className="text-[10px] text-slate-600 dark:text-slate-400 italic pt-1 border-t border-slate-200/50 dark:border-slate-800/50 line-clamp-2">
                      &ldquo;{approval.submissionNotes}&rdquo;
                    </p>
                  )}
                </div>

                {/* 2. Persetujuan Koordinator */}
                <div className="p-3.5 rounded-xl border border-slate-200/80 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/40 space-y-1.5 flex flex-col justify-between">
                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-slate-800 dark:text-slate-200">
                        2. Koordinator ({coordLabel})
                      </span>
                      <span
                        className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${
                          approval?.coordinatorApprovedAt
                            ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300"
                            : isRevisionByCoord
                            ? "bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300"
                            : status === "WAITING_COORDINATOR_APPROVAL"
                            ? "bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300"
                            : "bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-400"
                        }`}
                      >
                        {approval?.coordinatorApprovedAt
                          ? "Disetujui"
                          : isRevisionByCoord
                          ? "Revisi"
                          : status === "WAITING_COORDINATOR_APPROVAL"
                          ? "Menunggu"
                          : "Belum Dimulai"}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-600 dark:text-slate-400">
                      Koordinator:{" "}
                      <strong className="text-slate-800 dark:text-slate-200">
                        {approval?.coordinatorUserName || (status === "WAITING_COORDINATOR_APPROVAL" ? `Menunggu ${coordLabel}` : "-")}
                      </strong>
                    </p>
                    <p className="text-[10px] text-slate-400">
                      Waktu: {safeFormatDate(approval?.coordinatorApprovedAt)}
                    </p>
                  </div>
                  {approval?.coordinatorNotes && (
                    <p className="text-[10px] text-slate-600 dark:text-slate-400 italic pt-1 border-t border-slate-200/50 dark:border-slate-800/50 line-clamp-2">
                      &ldquo;{approval.coordinatorNotes}&rdquo;
                    </p>
                  )}
                </div>

                {/* 3. Final Approval BnM Manajer */}
                <div className="p-3.5 rounded-xl border border-slate-200/80 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/40 space-y-1.5 flex flex-col justify-between">
                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-slate-800 dark:text-slate-200">
                        3. Final BnM Manajer
                      </span>
                      <span
                        className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${
                          approval?.managerApprovedAt || status === "APPROVED_PENDING_CLOSE" || isResolved
                            ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300"
                            : isRevisionByManager
                            ? "bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300"
                            : status === "WAITING_MANAGER_APPROVAL"
                            ? "bg-purple-100 text-purple-800 dark:bg-purple-950/60 dark:text-purple-300"
                            : "bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-400"
                        }`}
                      >
                        {approval?.managerApprovedAt || status === "APPROVED_PENDING_CLOSE" || isResolved
                          ? "Disetujui Final"
                          : isRevisionByManager
                          ? "Revisi"
                          : status === "WAITING_MANAGER_APPROVAL"
                          ? "Menunggu"
                          : "Belum Dimulai"}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-600 dark:text-slate-400">
                      Manajer:{" "}
                      <strong className="text-slate-800 dark:text-slate-200">
                        {approval?.managerUserName || (status === "WAITING_MANAGER_APPROVAL" ? `Menunggu BnM Manajer` : "-")}
                      </strong>
                    </p>
                    <p className="text-[10px] text-slate-400">
                      Waktu: {safeFormatDate(approval?.managerApprovedAt)}
                    </p>
                  </div>
                  {approval?.managerNotes && (
                    <p className="text-[10px] text-slate-600 dark:text-slate-400 italic pt-1 border-t border-slate-200/50 dark:border-slate-800/50 line-clamp-2">
                      &ldquo;{approval.managerNotes}&rdquo;
                    </p>
                  )}
                </div>
              </div>

              {/* Status Penutupan Kasus (Case Close) - Informasi Terpisah */}
              <div className="p-3.5 rounded-xl border border-slate-200/80 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/30 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
                <div className="space-y-0.5">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-slate-800 dark:text-slate-200">
                      Status Penutupan Kasus (Case Close)
                    </span>
                    <span
                      className={`text-[9px] font-bold px-2 py-0.5 rounded-md ${
                        isResolved
                          ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300"
                          : status === "APPROVED_PENDING_CLOSE"
                          ? "bg-teal-100 text-teal-800 dark:bg-teal-950/60 dark:text-teal-300"
                          : "bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-400"
                      }`}
                    >
                      {isResolved
                        ? "CLOSED"
                        : status === "APPROVED_PENDING_CLOSE"
                        ? "Menunggu Case Close"
                        : "Belum Ditutup"}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    {isResolved
                      ? `Laporan resmi ditutup oleh ${approval?.closedByUserName || approval?.managerUserName || `BnM Manajer (${incident.branch})`} pada ${safeFormatDate(incident.closedAt || approval?.closedAt || approval?.managerApprovedAt)}.`
                      : status === "APPROVED_PENDING_CLOSE"
                      ? "Pekerjaan telah disetujui final oleh BnM Manajer. Menunggu penutupan kasus (Case Close) oleh BnM Manajer."
                      : "Penutupan kasus dilakukan setelah persetujuan akhir BnM Manajer dinyatakan lengkap."}
                  </p>
                </div>

                <div className="text-[11px] font-mono text-slate-400 shrink-0">
                  {isResolved
                    ? `Waktu Close: ${safeFormatDate(incident.closedAt || approval?.closedAt || approval?.managerApprovedAt)}`
                    : status === "APPROVED_PENDING_CLOSE"
                    ? "Status: Menunggu Penutupan"
                    : "Status: Menunggu Selesai"}
                </div>
              </div>

              {/* Berkas Bukti Lampiran Serah Terima */}
              {approval?.attachments && approval.attachments.length > 0 && (
                <div className="p-3.5 bg-slate-50/60 dark:bg-slate-950/30 border border-slate-200 dark:border-slate-800 rounded-xl space-y-2 text-xs">
                  <span className="font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                    <FileCheck className="w-4 h-4 text-blue-600" />
                    Dokumen & Lampiran Bukti Serah Terima ({approval.attachments.length} berkas):
                  </span>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {approval.attachments.map((att, i) => (
                      <div key={i} className="flex items-center justify-between p-2 bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800">
                        <span className="truncate font-medium text-slate-700 dark:text-slate-300" title={att.originalName}>
                          {att.originalName}
                        </span>
                        <span className="text-[10px] text-slate-400 font-mono shrink-0 ml-2">
                          {Math.round(att.size / 1024)} KB
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Riwayat Keputusan & Audit Collapsible */}
          <div className="pt-2 border-t border-slate-100 dark:border-slate-800">
            <button
              type="button"
              onClick={() => setShowHistory(!showHistory)}
              className="text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1.5"
            >
              {showHistory ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              <span>Riwayat Keputusan & Audit Serah Terima ({history.length} catatan)</span>
            </button>

            {showHistory && (
              <div className="mt-2.5 bg-slate-50 dark:bg-slate-950/40 border border-slate-200 dark:border-slate-800 rounded-xl p-3 space-y-2 text-xs">
                {history.length === 0 ? (
                  <p className="text-slate-400 text-[11px] italic">Belum ada riwayat keputusan tercatat untuk serah terima laporan ini.</p>
                ) : (
                  <div className="space-y-2 divide-y divide-slate-100 dark:divide-slate-800">
                    {history.map((h) => (
                      <div key={h.id} className="pt-2 first:pt-0 flex items-start justify-between gap-3">
                        <div className="space-y-0.5">
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-slate-800 dark:text-slate-200">
                              {h.action}
                            </span>
                            <span className="text-[10px] px-1.5 py-0.2 rounded bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 font-mono uppercase">
                              {h.actorRole}
                            </span>
                          </div>
                          <p className="text-[11px] text-slate-600 dark:text-slate-400">
                            Aktor: <strong className="text-slate-800 dark:text-slate-200">{h.actorName}</strong> • Cabang: {h.branch || "-"}
                          </p>
                          {h.notes && (
                            <p className="text-[11px] text-slate-700 dark:text-slate-300 italic bg-white dark:bg-slate-900 p-2 rounded-lg border border-slate-200/50 dark:border-slate-800/50 mt-1">
                              &ldquo;{h.notes}&rdquo;
                            </p>
                          )}
                        </div>
                        <span className="text-[10px] text-slate-400 shrink-0 font-mono">
                          {safeFormatDate(h.createdAt)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Determine current step index for stepped visual in Update Progress mode
  let currentStep = 0;
  if (isCompleted) {
    if (status === "WAITING_PIC_SUBMISSION") currentStep = 1;
    else if (status === "REVISION_REQUIRED") currentStep = 1;
    else if (status === "WAITING_COORDINATOR_APPROVAL") currentStep = 2;
    else if (status === "WAITING_MANAGER_APPROVAL") currentStep = 3;
    else if (status === "APPROVED_PENDING_CLOSE") currentStep = 4;
    else if (status === "CLOSED" || isResolved) currentStep = 5;
  }

  return (
    <div className="space-y-4 pt-2 border-t border-slate-100 dark:border-slate-800">
      <div className="flex items-center justify-between">
        <div>
          <h4 className="text-xs font-bold text-slate-800 dark:text-slate-200 uppercase tracking-wider flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-emerald-600" />
            Alur Persetujuan Serah Terima & Case Close
          </h4>
          <p className="text-[11px] text-slate-400 mt-0.5">
            Jalur: {route?.flowType || "BMS"} • {picLabel} → {coordLabel} → BnM Manajer ({incident.branch})
          </p>
        </div>

        {/* Current State Badge */}
        <div>
          {isResolved ? (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
              Case Closed
            </span>
          ) : status === "APPROVED_PENDING_CLOSE" ? (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-teal-100 text-teal-800 dark:bg-teal-950/60 dark:text-teal-300">
              <Clock className="w-3.5 h-3.5 text-teal-600" />
              Menunggu Case Close
            </span>
          ) : status === "REVISION_REQUIRED" ? (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300">
              <AlertTriangle className="w-3.5 h-3.5 text-rose-600" />
              Revisi Diminta
            </span>
          ) : status === "WAITING_COORDINATOR_APPROVAL" ? (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300">
              <Clock className="w-3.5 h-3.5 text-blue-600" />
              Menunggu Review {coordLabel}
            </span>
          ) : status === "WAITING_MANAGER_APPROVAL" ? (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-purple-100 text-purple-800 dark:bg-purple-950/60 dark:text-purple-300">
              <Clock className="w-3.5 h-3.5 text-purple-600" />
              Menunggu Approval BnM Manajer
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300">
              <Clock className="w-3.5 h-3.5 text-slate-500" />
              Menunggu Pengajuan {picLabel}
            </span>
          )}
        </div>
      </div>

      {errorMessage && (
        <div className="p-3 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 rounded-xl text-xs flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>{errorMessage}</span>
        </div>
      )}

      {/* Stepped Visual Chain */}
      <div className="bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-800 rounded-xl p-3.5 space-y-3">
        <div className="grid grid-cols-5 gap-1.5 sm:gap-2 text-center text-[10px] font-bold">
          {/* Step 1: Fisik Selesai */}
          <div
            className={`p-2 rounded-lg border ${
              isCompleted
                ? "bg-emerald-50 dark:bg-emerald-950/40 border-emerald-300 dark:border-emerald-700 text-emerald-800 dark:text-emerald-300"
                : "bg-slate-100 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-400"
            }`}
          >
            <div className="flex items-center justify-center gap-1 mb-0.5">
              {isCompleted ? <CheckCircle2 className="w-3 h-3 text-emerald-600" /> : <Clock className="w-3 h-3" />}
              <span>1. Fisik 100%</span>
            </div>
            <span className="text-[9px] font-normal block opacity-80">
              {isCompleted ? "Handover Ada" : "Belum Siap"}
            </span>
          </div>

          {/* Step 2: PIC Submit */}
          <div
            className={`p-2 rounded-lg border ${
              currentStep >= 2
                ? "bg-emerald-50 dark:bg-emerald-950/40 border-emerald-300 dark:border-emerald-700 text-emerald-800 dark:text-emerald-300"
                : currentStep === 1
                ? "bg-blue-50 dark:bg-blue-950/40 border-blue-300 dark:border-blue-700 text-blue-800 dark:text-blue-300"
                : "bg-slate-100 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-400"
            }`}
          >
            <div className="flex items-center justify-center gap-1 mb-0.5">
              {currentStep >= 2 ? (
                <CheckCircle2 className="w-3 h-3 text-emerald-600" />
              ) : currentStep === 1 ? (
                <Send className="w-3 h-3 text-blue-600" />
              ) : (
                <Clock className="w-3 h-3" />
              )}
              <span>2. PIC ({picLabel})</span>
            </div>
            <span className="text-[9px] font-normal block opacity-80">
              {approval?.picUserName ? `Diajukan` : "Menunggu"}
            </span>
          </div>

          {/* Step 3: Coordinator Approval */}
          <div
            className={`p-2 rounded-lg border ${
              currentStep >= 3
                ? "bg-emerald-50 dark:bg-emerald-950/40 border-emerald-300 dark:border-emerald-700 text-emerald-800 dark:text-emerald-300"
                : currentStep === 2
                ? "bg-amber-50 dark:bg-amber-950/40 border-amber-300 dark:border-amber-700 text-amber-800 dark:text-amber-300"
                : "bg-slate-100 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-400"
            }`}
          >
            <div className="flex items-center justify-center gap-1 mb-0.5">
              {currentStep >= 3 ? (
                <CheckCircle2 className="w-3 h-3 text-emerald-600" />
              ) : currentStep === 2 ? (
                <Clock className="w-3 h-3 text-amber-600" />
              ) : (
                <Clock className="w-3 h-3" />
              )}
              <span>3. Koord ({coordLabel})</span>
            </div>
            <span className="text-[9px] font-normal block opacity-80">
              {approval?.coordinatorUserName ? "Disetujui" : "Menunggu"}
            </span>
          </div>

          {/* Step 4: Final BnM Manajer Approval */}
          <div
            className={`p-2 rounded-lg border ${
              currentStep >= 4
                ? "bg-emerald-50 dark:bg-emerald-950/40 border-emerald-300 dark:border-emerald-700 text-emerald-800 dark:text-emerald-300"
                : currentStep === 3
                ? "bg-purple-50 dark:bg-purple-950/40 border-purple-300 dark:border-purple-700 text-purple-800 dark:text-purple-300"
                : "bg-slate-100 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-400"
            }`}
          >
            <div className="flex items-center justify-center gap-1 mb-0.5">
              {currentStep >= 4 ? (
                <CheckCircle2 className="w-3 h-3 text-emerald-600" />
              ) : (
                <ShieldCheck className="w-3 h-3" />
              )}
              <span>4. Final BnM</span>
            </div>
            <span className="text-[9px] font-normal block opacity-80">
              {approval?.managerApprovedAt || currentStep >= 4 ? "Disetujui" : "Menunggu"}
            </span>
          </div>

          {/* Step 5: Case Close */}
          <div
            className={`p-2 rounded-lg border ${
              currentStep >= 5
                ? "bg-emerald-50 dark:bg-emerald-950/40 border-emerald-300 dark:border-emerald-700 text-emerald-800 dark:text-emerald-300"
                : currentStep === 4
                ? "bg-teal-50 dark:bg-teal-950/40 border-teal-300 dark:border-teal-700 text-teal-800 dark:text-teal-300"
                : "bg-slate-100 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-400"
            }`}
          >
            <div className="flex items-center justify-center gap-1 mb-0.5">
              {currentStep >= 5 ? (
                <CheckCircle2 className="w-3 h-3 text-emerald-600" />
              ) : (
                <Lock className="w-3 h-3" />
              )}
              <span>5. Case Close</span>
            </div>
            <span className="text-[9px] font-normal block opacity-80">
              {isResolved ? "Selesai" : currentStep === 4 ? "Siap Tutup" : "Menunggu"}
            </span>
          </div>
        </div>
      </div>

      {/* Revision Banner if status is REVISION_REQUIRED */}
      {status === "REVISION_REQUIRED" && (
        <div className="p-3.5 bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-800 rounded-xl text-xs text-rose-900 dark:text-rose-200 space-y-1">
          <div className="font-bold flex items-center gap-1.5 text-rose-700 dark:text-rose-400">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>Revisi Diminta oleh {approval?.rejectedByRole?.toUpperCase()} ({approval?.rejectedByUserName || "Approver"}):</span>
          </div>
          <p className="text-[11px] pl-5.5 italic bg-white/60 dark:bg-black/20 p-2 rounded-lg border border-rose-100 dark:border-rose-900">
            &ldquo;{approval?.rejectionReason || "Harap lengkapi bukti dan verifikasi kembali."}&rdquo;
          </p>
          <p className="text-[10px] text-rose-600 dark:text-rose-400 pl-5.5">
            PIC lapangan ({picLabel}) dapat memperbaiki pekerjaan/bukti lalu mengajukan penyelesaian ulang.
          </p>
        </div>
      )}

      {/* Serah Terima Attachments List */}
      {approval?.attachments && approval.attachments.length > 0 && (
        <div className="p-3.5 bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-800 rounded-xl space-y-2">
          <div className="flex items-center gap-1.5 text-xs font-bold text-slate-800 dark:text-slate-200">
            <FileCheck className="w-4 h-4 text-blue-600" />
            <span>Dokumen & Foto Bukti Serah Terima ({approval.attachments.length} berkas):</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
            {approval.attachments.map((att, i) => (
              <div key={i} className="flex items-center justify-between p-2 bg-white dark:bg-slate-900 rounded-lg border border-slate-200/60 dark:border-slate-700">
                <span className="truncate font-medium text-slate-700 dark:text-slate-300" title={att.originalName}>
                  {att.originalName}
                </span>
                <span className="text-[10px] text-slate-400 font-mono shrink-0 ml-2">
                  {Math.round(att.size / 1024)} KB
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Action Area based on Role and Stage */}
      {!readOnly && !isResolved && (
        <div className="bg-slate-50 dark:bg-slate-800/30 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
          {/* STAGE 1: WAITING_PIC_SUBMISSION or REVISION_REQUIRED */}
          {(status === "WAITING_PIC_SUBMISSION" || status === "REVISION_REQUIRED") && (
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
              <div>
                <p className="text-xs font-bold text-slate-800 dark:text-slate-200">
                  Tahap 1: Pengajuan Penyelesaian Lapangan
                </p>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                  PIC resmi: <span className="font-semibold text-blue-600 dark:text-blue-400">{picLabel}</span> cabang {incident.branch}.
                </p>
              </div>

              {!isCompleted ? (
                <span
                  className="text-xs text-amber-700 dark:text-amber-400 font-semibold flex items-center gap-1.5"
                  title={prerequisiteReason}
                >
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  {prerequisiteReason}
                </span>
              ) : canSubmitCompletion && !isSysAdmin ? (
                <button
                  type="button"
                  onClick={() => {
                    setNotesInput("");
                    setActiveModal("submit");
                  }}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-xl shadow-xs flex items-center gap-1.5 transition-colors"
                >
                  <Send className="w-3.5 h-3.5" />
                  Ajukan Penyelesaian
                </button>
              ) : (
                <span className="text-xs text-slate-400 flex items-center gap-1" title={submitCompletionReason}>
                  <Lock className="w-3.5 h-3.5" /> {submitCompletionReason || `Menunggu Pengajuan ${picLabel} (${incident.branch})`}
                </span>
              )}
            </div>
          )}

          {/* STAGE 2: WAITING_COORDINATOR_APPROVAL */}
          {status === "WAITING_COORDINATOR_APPROVAL" && (
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
              <div>
                <p className="text-xs font-bold text-slate-800 dark:text-slate-200">
                  Tahap 2: Verifikasi & Persetujuan Koordinator
                </p>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                  Menunggu verifikasi dari <span className="font-semibold text-amber-600 dark:text-amber-400">{coordLabel}</span> cabang {incident.branch}.
                </p>
              </div>

              {canApproveCoordinator && !isSysAdmin ? (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setNotesInput("");
                      setActiveModal("reject");
                    }}
                    className="px-3.5 py-2 border border-rose-300 dark:border-rose-700 text-rose-700 dark:text-rose-300 hover:bg-rose-50 dark:hover:bg-rose-950/40 font-bold text-xs rounded-xl transition-colors flex items-center gap-1.5"
                  >
                    <XCircle className="w-3.5 h-3.5" />
                    Minta Revisi
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setNotesInput("");
                      setActiveModal("approve");
                    }}
                    className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl shadow-xs flex items-center gap-1.5 transition-colors"
                  >
                    <Check className="w-3.5 h-3.5" />
                    Setujui Penyelesaian
                  </button>
                </div>
              ) : (
                <span className="text-xs text-slate-400 flex items-center gap-1" title={approveCoordinatorReason}>
                  <Lock className="w-3.5 h-3.5" /> Menunggu Review {coordLabel} ({incident.branch})
                </span>
              )}
            </div>
          )}

          {/* STAGE 3: WAITING_MANAGER_APPROVAL */}
          {status === "WAITING_MANAGER_APPROVAL" && (
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
              <div>
                <p className="text-xs font-bold text-slate-800 dark:text-slate-200">
                  Tahap 3: Persetujuan Final BnM Manajer
                </p>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                  Koordinator ({coordLabel}) telah menyetujui. Menunggu persetujuan final <span className="font-semibold text-emerald-600 dark:text-emerald-400">BnM Manajer</span> cabang {incident.branch}.
                </p>
              </div>

              {(canFinalApprove || canClose) && !isSysAdmin && isSameBranch && userRole?.toLowerCase() === "bm" ? (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setNotesInput("");
                      setActiveModal("reject");
                    }}
                    className="px-3.5 py-2 border border-rose-300 dark:border-rose-700 text-rose-700 dark:text-rose-300 hover:bg-rose-50 dark:hover:bg-rose-950/40 font-bold text-xs rounded-xl transition-colors flex items-center gap-1.5"
                  >
                    <XCircle className="w-3.5 h-3.5" />
                    Minta Revisi
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setNotesInput("");
                      setActiveModal("approve");
                    }}
                    className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl shadow-xs flex items-center gap-1.5 transition-colors"
                  >
                    <ShieldCheck className="w-4 h-4" />
                    Setujui Final
                  </button>
                </div>
              ) : (
                <span className="text-xs text-slate-400 flex items-center gap-1" title={finalApproveReason || closeReason}>
                  <Lock className="w-3.5 h-3.5" /> Menunggu Persetujuan Final BnM Manajer ({incident.branch})
                </span>
              )}
            </div>
          )}

          {/* STAGE 4: APPROVED_PENDING_CLOSE (MENUNGGU CASE CLOSE) */}
          {status === "APPROVED_PENDING_CLOSE" && (
            <div className="p-3 bg-teal-50/60 dark:bg-teal-950/30 border border-teal-200 dark:border-teal-800 rounded-xl space-y-3">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <p className="text-xs font-bold text-slate-800 dark:text-slate-200">
                      Tahap 4: Penutupan Laporan (Case Close)
                    </p>
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-teal-100 text-teal-800 dark:bg-teal-950/60 dark:text-teal-300 border border-teal-200 dark:border-teal-800">
                      Menunggu Penutupan
                    </span>
                  </div>
                  <div className="text-[11px] text-slate-600 dark:text-slate-400 space-y-0.5">
                    <p>
                      <strong>Final Approval:</strong> <span className="text-emerald-700 dark:text-emerald-400 font-semibold">Disetujui</span>
                      {approval?.managerUserName ? ` oleh ${approval.managerUserName}` : ""}
                      {approval?.managerApprovedAt ? ` (${safeFormatDate(approval.managerApprovedAt)})` : ""}
                    </p>
                    <p className="text-slate-500">
                      <strong>Case Close:</strong> Menunggu tindakan penutupan resmi oleh BnM Manajer.
                    </p>
                  </div>
                </div>

                {canClose && !isSysAdmin && isSameBranch && userRole?.toLowerCase() === "bm" ? (
                  <button
                    type="button"
                    onClick={() => {
                      setNotesInput("");
                      setActiveModal("close");
                    }}
                    className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl shadow-xs flex items-center gap-1.5 transition-colors shrink-0"
                  >
                    <CheckCircle2 className="w-4 h-4" />
                    Case Close
                  </button>
                ) : (
                  <span className="text-xs text-slate-400 flex items-center gap-1 shrink-0" title={closeReason}>
                    <Lock className="w-3.5 h-3.5" /> Menunggu Penutupan oleh BnM Manajer ({incident.branch})
                  </span>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* History Collapsible Toggle */}
      <div className="pt-1">
        <button
          type="button"
          onClick={() => setShowHistory(!showHistory)}
          className="text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1.5"
        >
          {showHistory ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          <span>Riwayat Persetujuan & Audit ({history.length} catatan)</span>
        </button>

        {showHistory && (
          <div className="mt-2.5 bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-800 rounded-xl p-3 space-y-2 text-xs">
            {history.length === 0 ? (
              <p className="text-slate-400 text-[11px] italic">Belum ada riwayat persetujuan untuk laporan ini.</p>
            ) : (
              <div className="space-y-2 divide-y divide-slate-100 dark:divide-slate-800">
                {history.map((h) => (
                  <div key={h.id} className="pt-2 first:pt-0 flex items-start justify-between gap-3">
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-slate-800 dark:text-slate-200">
                          {h.action}
                        </span>
                        <span className="text-[10px] px-1.5 py-0.2 rounded bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 font-mono uppercase">
                          {h.actorRole}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-600 dark:text-slate-400">
                        Oleh: {h.actorName} • Cabang: {h.branch || "-"}
                      </p>
                      {h.notes && (
                        <p className="text-[11px] text-slate-500 italic bg-white dark:bg-slate-900/60 p-1.5 rounded border border-slate-100 dark:border-slate-800 mt-1">
                          &ldquo;{h.notes}&rdquo;
                        </p>
                      )}
                    </div>
                    <span className="text-[10px] text-slate-400 shrink-0 font-mono">
                      {h.createdAt ? new Date(h.createdAt).toLocaleDateString("id-ID", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "-"}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Confirmation / Notes Dialog */}
      {!readOnly && activeModal && (
        <div className="fixed inset-0 z-[7000] flex items-center justify-center p-4 bg-slate-950/75 backdrop-blur-xs animate-in fade-in">
          <div className="bg-white dark:bg-slate-900 w-full max-w-md rounded-2xl overflow-hidden shadow-2xl border border-slate-200 dark:border-slate-800 p-6 space-y-4">
            <h4 className="font-bold text-sm text-slate-900 dark:text-white flex items-center gap-2">
              {activeModal === "submit" && <Send className="w-4 h-4 text-blue-600" />}
              {activeModal === "approve" && <ShieldCheck className="w-4 h-4 text-emerald-600" />}
              {activeModal === "close" && <CheckCircle2 className="w-4 h-4 text-emerald-600" />}
              {activeModal === "reject" && <XCircle className="w-4 h-4 text-rose-600" />}
              <span>
                {activeModal === "submit"
                  ? "Ajukan Penyelesaian Pekerjaan"
                  : activeModal === "close"
                  ? "Konfirmasi Penutupan Laporan (Case Close)"
                  : activeModal === "approve"
                  ? userRole?.toLowerCase() === "bm"
                    ? "Konfirmasi Persetujuan Final (Final Approval)"
                    : "Persetujuan Koordinator"
                  : "Minta Revisi Pekerjaan"}
              </span>
            </h4>

            <p className="text-xs text-slate-500 dark:text-slate-400">
              {activeModal === "submit"
                ? "Pastikan pekerjaan fisik 100% selesai dan foto serah terima (HANDOVER) telah terlampir."
                : activeModal === "close"
                ? "Apakah Anda yakin ingin menutup laporan ini secara resmi? Tindakan Case Close akan mengubah status laporan menjadi CLOSED dan menandai seluruh tahapan penanganan selesai."
                : activeModal === "approve"
                ? userRole?.toLowerCase() === "bm"
                  ? "Persetujuan final BnM Manajer menyatakan bahwa pekerjaan selesai dan dokumen serah terima lengkap. Tindakan ini BELUM menutup laporan. Laporan akan menunggu tindakan Case Close secara eksplisit."
                  : "Persetujuan Koordinator akan meneruskan berkas serah terima ke tahap akhir (Persetujuan Final BnM Manajer)."
                : "Tuliskan alasan atau bagian yang perlu direvisi secara jelas agar PIC dapat memperbaikinya."}
            </p>

            <div className="space-y-1">
              <label className="text-xs font-bold text-slate-700 dark:text-slate-300 block">
                {activeModal === "reject"
                  ? "Alasan Revisi (Wajib):"
                  : activeModal === "close"
                  ? "Catatan Penutupan Kasus (Opsional):"
                  : activeModal === "approve"
                  ? "Catatan Persetujuan Final (Opsional):"
                  : "Catatan (Opsional):"}
              </label>
              <textarea
                value={notesInput}
                onChange={(e) => setNotesInput(e.target.value)}
                rows={3}
                placeholder={
                  activeModal === "reject"
                    ? "Contoh: Foto serah terima bagian atap belum jelas, mohon foto ulang."
                    : activeModal === "close"
                    ? "Contoh: Pekerjaan diverifikasi selesai 100%, serah terima diterima tanpa catatan."
                    : activeModal === "approve"
                    ? "Contoh: Berkas serah terima lengkap dan disetujui."
                    : "Tuliskan catatan tambahan jika ada..."
                }
                className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-slate-900 dark:text-white"
              />
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-slate-100 dark:border-slate-800">
              <button
                type="button"
                disabled={actionLoading}
                onClick={() => setActiveModal(null)}
                className="px-4 py-2 text-xs font-semibold text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl"
              >
                Batal
              </button>
              <button
                type="button"
                disabled={actionLoading}
                onClick={() => handleAction(activeModal)}
                className={`px-5 py-2 text-xs font-bold text-white rounded-xl shadow-xs disabled:opacity-50 flex items-center gap-1.5 ${
                  activeModal === "reject"
                    ? "bg-rose-600 hover:bg-rose-700"
                    : activeModal === "close"
                    ? "bg-emerald-600 hover:bg-emerald-700"
                    : activeModal === "approve"
                    ? "bg-emerald-600 hover:bg-emerald-700"
                    : "bg-blue-600 hover:bg-blue-700"
                }`}
              >
                {actionLoading
                  ? "Memproses..."
                  : activeModal === "close"
                  ? "Tutup Laporan (Case Close)"
                  : activeModal === "approve"
                  ? "Setujui Final"
                  : "Konfirmasi"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
