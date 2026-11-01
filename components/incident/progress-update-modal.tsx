"use client";

import React, { useState, useRef, useEffect } from "react";
import {
  X,
  Wrench,
  Camera,
  Image as ImageIcon,
  CheckCircle2,
  AlertTriangle,
  ArrowRight,
  Info,
  Calendar,
  Building,
  UploadCloud,
  FileCheck,
  ShieldCheck,
  Loader2,
  Send,
} from "lucide-react";
import { IncidentRecord } from "@/types/incident";
import { UserIdentity } from "@/lib/identity";
import { ProgressUpdateRecord, WorkStage } from "@/lib/progress-service";
import { CameraCapture } from "./camera-capture";
import { AppDialog } from "@/components/shared/app-dialog";
import { MilestoneProgressionCard } from "./milestone-progression-card";
import { StoreVerificationModal } from "./store-verification-modal";
import { CompletionApprovalCard } from "./completion-approval-card";
import {
  ApprovalRouteResolution,
  CompletionApprovalRecord,
  CompletionApprovalHistoryRecord,
} from "@/lib/completion-approval-service";

interface ProgressUpdateModalProps {
  isOpen: boolean;
  onClose: () => void;
  incident: IncidentRecord | null;
  latestProgress: number;
  onSuccess?: (updatedRecord: ProgressUpdateRecord) => void;
  onUpdated?: () => void | Promise<void>;
}

export function ProgressUpdateModal({
  isOpen,
  onClose,
  incident,
  latestProgress,
  onSuccess,
  onUpdated,
}: ProgressUpdateModalProps) {
  // Lock background scroll when modal is open

  const [identity, setIdentity] = useState<UserIdentity | null>(null);
  const [progressValue, setProgressValue] = useState<number>(latestProgress || 0);
  const [description, setDescription] = useState("");
  const [stage, setStage] = useState<WorkStage>("PENGERJAAN");
  const [photoType, setPhotoType] = useState<"PROGRESS" | "FINAL" | "HANDOVER">("PROGRESS");

  // Selected files & local preview
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [previewUrls, setPreviewUrls] = useState<string[]>([]);

  const [isCameraOpen, setIsCameraOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successResult, setSuccessResult] = useState<ProgressUpdateRecord | null>(null);
  const [activeTab, setActiveTab] = useState<"progress" | "milestone" | "submission">("progress");
  const [workflowPermissions, setWorkflowPermissions] = useState<{
    canConfirm: boolean;
    canBmApprove: boolean;
    canUpdateProgress: boolean;
    updateProgressReason?: string;
    canSubmitCompletion: boolean;
    submitCompletionReason?: string;
    canApproveCoordinator: boolean;
    approveCoordinatorReason?: string;
    canFinalApprove?: boolean;
    finalApproveReason?: string;
    canClose: boolean;
    closeReason?: string;
  } | null>(null);
  const [workflowLoading, setWorkflowLoading] = useState(false);
  const [approval, setApproval] = useState<CompletionApprovalRecord | null>(null);
  const [approvalRoute, setApprovalRoute] = useState<ApprovalRouteResolution | null>(null);
  const [approvalHistory, setApprovalHistory] = useState<CompletionApprovalHistoryRecord[]>([]);
  const [physicalProgress, setPhysicalProgress] = useState(latestProgress || 0);
  const [hasFinalEvidence, setHasFinalEvidence] = useState(false);
  const [hasMilestoneSt, setHasMilestoneSt] = useState(false);

  const isSysAdmin = identity?.systemRole === "ADMIN";

  const refreshWorkflow = async (selectInitialTab = false) => {
    if (!incident) return;
    try {
      setWorkflowLoading(true);
      const [permissionResponse, completionResponse, progressResponse] = await Promise.all([
        fetch(`/api/incidents/${encodeURIComponent(incident.id)}/permissions`, { cache: "no-store" }),
        fetch(`/api/incidents/${encodeURIComponent(incident.id)}/completion`, { cache: "no-store" }),
        fetch(`/api/incidents/${encodeURIComponent(incident.id)}/progress`, { cache: "no-store" }),
      ]);
      const [permissionJson, completionJson, progressJson] = await Promise.all([
        permissionResponse.ok ? permissionResponse.json() : Promise.resolve(null),
        completionResponse.ok ? completionResponse.json() : Promise.resolve(null),
        progressResponse.ok ? progressResponse.json() : Promise.resolve(null),
      ]);
      setWorkflowPermissions(permissionJson?.data || null);
      setApproval(completionJson?.data?.approval || null);
      setApprovalRoute(completionJson?.data?.route || null);
      setApprovalHistory(completionJson?.data?.history || []);
      setPhysicalProgress(progressJson?.data?.latestProgress ?? incident.progress ?? 0);
      setHasFinalEvidence(Boolean(progressJson?.data?.hasFinalEvidence || completionJson?.data?.hasFinalEvidence));
      setHasMilestoneSt(Boolean(completionJson?.data?.hasMilestoneSt || progressJson?.data?.hasMilestoneSt));
      if (selectInitialTab) {
        if (incident.status === "revision_requested") {
          setActiveTab("milestone");
        } else if ((incident.progress ?? 0) >= 100) {
          setActiveTab("submission");
        } else {
          setActiveTab("progress");
        }
      }
    } catch (error) {
      console.error("[Update Progress] Gagal memuat alur tindakan laporan:", error);
      setWorkflowPermissions(null);
    } finally {
      setWorkflowLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen && incident) {
      setActiveTab("progress");
      setWorkflowLoading(true);
      setWorkflowPermissions(null);
      setProgressValue(Math.max(latestProgress || 0, incident.progress || 0));
      setDescription("");
      setSelectedFiles([]);
      setPreviewUrls([]);
      setErrorMessage(null);
      setSuccessResult(null);

      fetch("/api/auth/me")
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (data) setIdentity(data.user || data);
        })
        .catch(() => {});
      void refreshWorkflow(true);
    }
  }, [isOpen, incident?.id]);

  useEffect(() => {
    setProgressValue((previous) => Math.max(previous, latestProgress || 0));
  }, [latestProgress]);

  // Adjust photo type suggestion when progress reaches 100%
  useEffect(() => {
    if (progressValue === 100 && photoType === "PROGRESS") {
      setPhotoType("FINAL");
    } else if (progressValue < 100 && photoType !== "PROGRESS") {
      setPhotoType("PROGRESS");
    }
  }, [progressValue]);

  if (!isOpen || !incident) return null;


  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const newFiles: File[] = Array.from(files);
    const newPreviews = newFiles.map((file) => URL.createObjectURL(file));

    setSelectedFiles((prev) => [...prev, ...newFiles]);
    setPreviewUrls((prev) => [...prev, ...newPreviews]);
  };

  const handleCameraCapture = (file: File, previewUrl: string) => {
    setSelectedFiles((prev) => [...prev, file]);
    setPreviewUrls((prev) => [...prev, previewUrl]);
  };

  const handleRemovePhoto = (index: number) => {
    if (previewUrls[index]) URL.revokeObjectURL(previewUrls[index]);
    setSelectedFiles((prev) => prev.filter((_, i) => i !== index));
    setPreviewUrls((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    // Validasi input
    if (isNaN(progressValue) || !Number.isInteger(progressValue) || progressValue < 0 || progressValue > 100) {
      setErrorMessage("Persentase progress harus berupa bilangan bulat antara 0% dan 100%.");
      return;
    }

    if (progressValue < (latestProgress || 0)) {
      setErrorMessage(`Progress baru tidak boleh lebih kecil dari progress sebelumnya (${latestProgress}%).`);
      return;
    }

    if (!description.trim()) {
      setErrorMessage("Keterangan pekerjaan progress wajib diisi.");
      return;
    }

    if (selectedFiles.length === 0) {
      setErrorMessage("Foto bukti progress wajib dilampirkan minimal 1 foto.");
      return;
    }

    setLoading(true);

    try {
      const formData = new FormData();
      formData.append("progress_percentage", progressValue.toString());
      formData.append("description", description.trim());
      formData.append("stage", stage);
      formData.append("photo_type", photoType);

      selectedFiles.forEach((file) => {
        formData.append("photos", file);
      });

      const res = await fetch(`/api/incidents/${incident.id}/progress`, {
        method: "POST",
        body: formData,
      });

      const json = await res.json().catch(() => ({}));

      if (res.ok) {
        setSuccessResult(json.data);
        if (onSuccess) onSuccess(json.data);
        void refreshWorkflow();
        void onUpdated?.();
      } else {
        setErrorMessage(json.error || "Gagal memperbarui progress.");
      }
    } catch (err: any) {
      console.error(err);
      setErrorMessage("Terjadi kesalahan sistem saat menghubungi server.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
    <AppDialog open={isOpen && !isCameraOpen} onClose={onClose} title={"Update Progress Pekerjaan"} className="sm:!max-w-2xl">
      <div className="bg-white dark:bg-slate-900 w-full max-w-2xl rounded-2xl overflow-hidden shadow-2xl border border-slate-200 dark:border-slate-800 flex flex-col max-h-[90dvh] sm:max-h-[85dvh] touch-auto select-text">
        {/* Header (Fixed) */}
        <div className="flex items-center justify-between px-6 py-4 bg-[#123B6D] text-white shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-white/10 text-white">
              <Wrench className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-sm">Update Progress Pekerjaan</h3>
              <p className="text-[11px] text-blue-200">
                {incident.storeName} ({incident.branch}) • Laporan #{incident.id}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 hover:bg-white/20 rounded-lg transition-colors text-white"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab navigasi terfokus spesialis lapangan */}
        <div className="px-6 py-2.5 bg-slate-50 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-800 flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => setActiveTab("progress")}
            className={`flex-1 py-2 px-3 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 ${
              activeTab === "progress"
                ? "bg-[#1D5AA6] text-white shadow-xs"
                : "bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700"
            }`}
          >
            <Wrench className="w-3.5 h-3.5" />
            <span>1. Progres Fisik</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("milestone")}
            className={`flex-1 py-2 px-3 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 ${
              activeTab === "milestone"
                ? "bg-[#1D5AA6] text-white shadow-xs"
                : "bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700"
            }`}
          >
            <FileCheck className="w-3.5 h-3.5" />
            <span>2. Berkas Milestone</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("submission")}
            className={`flex-1 py-2 px-3 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 ${
              activeTab === "submission"
                ? "bg-[#1D5AA6] text-white shadow-xs"
                : "bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700"
            }`}
          >
            <Send className="w-3.5 h-3.5" />
            <span>3. Ajukan Penyelesaian</span>
          </button>
        </div>

        {/* Modal Body (Scrollable Internal Only) */}
        <div className="p-6 overflow-y-auto overscroll-contain space-y-5 flex-1 min-h-0">
          {activeTab === "submission" ? (
            <div className="space-y-4">
              <CompletionApprovalCard
                incident={incident}
                approval={approval}
                route={approvalRoute}
                history={approvalHistory}
                latestProgress={physicalProgress}
                hasFinalEvidence={hasFinalEvidence}
                hasMilestoneSt={hasMilestoneSt}
                userRole={identity?.role}
                userBranch={identity?.branch}
                userSystemRole={identity?.systemRole}
                canSubmitCompletion={Boolean(workflowPermissions?.canSubmitCompletion && !isSysAdmin)}
                submitCompletionReason={
                  isSysAdmin
                    ? "System Administrator memiliki akses read-only pada tindakan operasional."
                    : workflowPermissions?.submitCompletionReason
                }
                canApproveCoordinator={false}
                approveCoordinatorReason="Review koordinator dilakukan secara terpisah oleh koordinator."
                canFinalApprove={false}
                finalApproveReason="Persetujuan akhir dilakukan oleh BnM Manajer."
                canClose={false}
                closeReason="Penutupan kasus dilakukan oleh BnM Manajer."
                readOnly={Boolean(isSysAdmin)}
                onRefresh={() => {
                  void refreshWorkflow();
                  void onUpdated?.();
                }}
              />
            </div>
          ) : activeTab === "milestone" ? (
            <div className="space-y-4">
              <MilestoneProgressionCard
                incident={incident}
                identity={identity}
                readOnly={Boolean(isSysAdmin)}
                onMilestoneUpdated={() => {
                  void refreshWorkflow();
                  void onUpdated?.();
                }}
              />
            </div>
          ) : workflowLoading || !workflowPermissions ? (
            <div className="p-8 text-center flex flex-col items-center justify-center space-y-3">
              <Loader2 className="w-6 h-6 animate-spin text-blue-600" />
              <p className="text-xs text-slate-500">Memuat izin dan progres pekerjaan...</p>
            </div>
          ) : isSysAdmin ? (
            <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-4 text-sm text-slate-600 dark:text-slate-300">
              System Administrator memiliki akses administrasi teknis dan detail read-only pada tindakan operasional.
            </div>
          ) : !workflowPermissions?.canUpdateProgress ? (
            <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-4 text-sm text-slate-600 dark:text-slate-300">
              {workflowPermissions?.updateProgressReason || "Pembaruan progres fisik belum tersedia untuk akun atau tahap laporan ini."}
            </div>
          ) : successResult ? (
            /* SUKSES RESULT WITH WATERMARKED PHOTO PREVIEW */
            <div className="text-center py-4 space-y-4 animate-in zoom-in-95">
              <div className="w-14 h-14 bg-emerald-100 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 rounded-full flex items-center justify-center mx-auto border border-emerald-200 dark:border-emerald-800">
                <CheckCircle2 className="w-8 h-8" />
              </div>
              <div className="space-y-1">
                <h3 className="text-base font-bold text-slate-900 dark:text-white">
                  Progress Berhasil Diperbarui ({successResult.progressPercentage}%)!
                </h3>
                <p className="text-xs text-slate-600 dark:text-slate-400 max-w-sm mx-auto">
                  Catatan riwayat pekerjaan telah disimpan dan foto telah diberi watermark server otomatis.
                </p>
              </div>

              {/* Watermarked Photos Showcase */}
              {successResult.photos && successResult.photos.length > 0 && (
                <div className="space-y-2 text-left pt-2">
                  <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block">
                    Foto Bukti Ber-Watermark Otomatis:
                  </span>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {successResult.photos.map((p) => (
                      <div
                        key={p.id}
                        className="rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden bg-slate-950"
                      >
                        <img
                          src={p.watermarkedPath}
                          alt="Watermarked Progress"
                          className="w-full h-40 object-cover"
                        />
                        <div className="p-2 bg-slate-900 text-white flex items-center justify-between text-[10px]">
                          <span className="font-semibold text-emerald-400">
                            {p.photoType}
                          </span>
                          <span className="text-slate-400 font-mono">
                            {p.fileSize ? `${Math.round(p.fileSize / 1024)} KB` : ""}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {successResult.progressPercentage === 100 && (
                <div className="p-3 bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 rounded-xl text-left text-xs text-emerald-800 dark:text-emerald-300 flex items-start gap-2">
                  <ShieldCheck className="w-4 h-4 shrink-0 mt-0.5 text-emerald-600" />
                  <div className="space-y-1">
                    <p className="text-[11px] leading-relaxed">
                      Pekerjaan fisik telah mencapai <strong>100%</strong>. Lengkapi berkas milestone dan ajukan penyelesaian pekerjaan melalui tab <strong>3. Ajukan Penyelesaian</strong>.
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        setSuccessResult(null);
                        setActiveTab("submission");
                      }}
                      className="mt-1 inline-flex items-center gap-1 text-xs font-bold text-[#1D5AA6] dark:text-blue-400 hover:underline"
                    >
                      Buka Tab Ajukan Penyelesaian <ArrowRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              )}

              <div className="pt-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="w-full py-2.5 rounded-xl bg-[#1D5AA6] hover:bg-[#123B6D] text-white font-bold text-xs transition-colors shadow-sm"
                >
                  Selesai
                </button>
              </div>
            </div>
          ) : (
            /* FORM UPDATE PROGRESS */
            <form onSubmit={handleSubmit} className="space-y-5">
              {errorMessage && (
                <div className="p-3 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 rounded-xl text-xs flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <span>{errorMessage}</span>
                </div>
              )}

              {/* 1. INFORMASI LAPORAN (READ-ONLY) */}
              <div className="bg-slate-50 dark:bg-slate-800/50 p-4 rounded-xl border border-slate-200/80 dark:border-slate-800 space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-bold text-[#123B6D] dark:text-blue-400 uppercase tracking-wider flex items-center gap-1.5">
                    <Building className="w-3.5 h-3.5" />
                    Informasi Laporan
                  </h4>
                  <span className="text-[11px] font-bold px-2 py-0.5 rounded-md bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300">
                    Progress Terakhir: {latestProgress}%
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div>
                    <span className="text-[10px] text-slate-400 block font-medium">No. Laporan</span>
                    <span className="font-mono font-bold text-slate-800 dark:text-slate-200">
                      {incident.id}
                    </span>
                  </div>

                  <div>
                    <span className="text-[10px] text-slate-400 block font-medium">Toko</span>
                    <span className="font-bold text-slate-800 dark:text-slate-200 truncate block">
                      {incident.storeName} ({incident.storeId || "-"})
                    </span>
                  </div>

                  <div>
                    <span className="text-[10px] text-slate-400 block font-medium">Cabang</span>
                    <span className="font-semibold text-slate-800 dark:text-slate-200">
                      {incident.branch}
                    </span>
                  </div>

                  <div>
                    <span className="text-[10px] text-slate-400 block font-medium">Tanggal Kejadian</span>
                    <span className="font-semibold text-slate-800 dark:text-slate-200">
                      {incident.date || "-"}
                    </span>
                  </div>
                </div>
              </div>

              {/* 2. PROGRESS SAAT INI (0 - 100%) - INPUT NUMERIK & PROGRESS BAR READ-ONLY */}
              <div className="space-y-3 p-3.5 bg-slate-50/70 dark:bg-slate-800/40 rounded-xl border border-slate-200/80 dark:border-slate-700/80">
                <div className="flex items-center justify-between">
                  <div>
                    <label htmlFor="numeric-progress-input" className="text-xs font-bold text-slate-800 dark:text-slate-200 block">
                      Persentase Progress Fisik:
                    </label>
                    <span className="text-[11px] text-slate-500 dark:text-slate-400">
                      Tersimpan saat ini: <strong className="text-slate-700 dark:text-slate-300 font-mono">{latestProgress}%</strong>
                    </span>
                  </div>
                  <div className="text-right">
                    <span className="text-lg font-black text-[#1D5AA6] dark:text-blue-400 font-mono">
                      {isNaN(progressValue) ? 0 : progressValue}%
                    </span>
                  </div>
                </div>

                {/* Read-Only Visual Progress Bar */}
                <div className="space-y-1">
                  <div className="w-full bg-slate-200 dark:bg-slate-700 h-2.5 rounded-full overflow-hidden">
                    <div
                      className="bg-[#1D5AA6] h-full transition-all duration-300 rounded-full"
                      style={{ width: `${Math.min(100, Math.max(0, isNaN(progressValue) ? 0 : progressValue))}%` }}
                    />
                  </div>
                  <div className="flex justify-between text-[10px] text-slate-400 font-mono">
                    <span>0%</span>
                    <span>25%</span>
                    <span>50%</span>
                    <span>75%</span>
                    <span>100%</span>
                  </div>
                </div>

                {/* Numeric Input Field */}
                <div className="pt-1">
                  <div className="relative">
                    <input
                      id="numeric-progress-input"
                      type="number"
                      min={latestProgress || 0}
                      max={100}
                      step={1}
                      value={isNaN(progressValue) ? "" : progressValue}
                      onChange={(e) => {
                        const val = e.target.value.trim();
                        if (val === "") {
                          setProgressValue(NaN);
                        } else {
                          setProgressValue(Number(val));
                        }
                      }}
                      placeholder={`Nilai ${latestProgress || 0} - 100`}
                      className="w-full px-3 py-2 text-sm font-semibold rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#1D5AA6] focus:border-transparent transition-all pr-8"
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400">
                      %
                    </span>
                  </div>
                  {!isNaN(progressValue) && progressValue < (latestProgress || 0) && (
                    <p className="text-[11px] text-rose-600 dark:text-rose-400 mt-1 flex items-center gap-1 font-medium">
                      <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                      Progress tidak boleh lebih kecil dari progress tersimpan ({latestProgress}%).
                    </p>
                  )}
                  {!isNaN(progressValue) && progressValue > 100 && (
                    <p className="text-[11px] text-rose-600 dark:text-rose-400 mt-1 flex items-center gap-1 font-medium">
                      <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                      Progress tidak boleh melebihi 100%.
                    </p>
                  )}
                </div>
              </div>

              {/* 100% Milestone Notice */}
              {progressValue === 100 && (
                <div className="p-3 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-xl text-xs text-amber-900 dark:text-amber-200 space-y-1">
                  <p className="font-bold flex items-center gap-1.5">
                    <FileCheck className="w-4 h-4 text-amber-600" />
                    Pekerjaan telah mencapai 100%
                  </p>
                  <p className="text-[11px] opacity-90">
                    Untuk finalisasi, lampirkan minimal 1 foto dengan tipe <strong>FINAL</strong> atau <strong>HANDOVER</strong> (Serah Terima).
                  </p>
                </div>
              )}

              {/* TAHAP PEKERJAAN (Section K) */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                    Tahap Pekerjaan:
                  </label>
                  <span className="text-[10px] text-slate-400">
                    Konteks informasi
                  </span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-1.5">
                  {(["PERSIAPAN", "PENGERJAAN", "FINISHING", "SELESAI", "SERAH_TERIMA"] as const).map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setStage(s)}
                      className={`py-1.5 px-2 rounded-lg text-[11px] font-bold border transition-all text-center truncate ${
                        stage === s
                          ? "bg-blue-50 dark:bg-blue-900/40 text-[#1D5AA6] dark:text-blue-300 border-[#1D5AA6] ring-1 ring-[#1D5AA6]"
                          : "bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-700 hover:bg-slate-100"
                      }`}
                    >
                      {s === "PERSIAPAN"
                        ? "Persiapan"
                        : s === "PENGERJAAN"
                        ? "Pengerjaan"
                        : s === "FINISHING"
                        ? "Finishing"
                        : s === "SELESAI"
                        ? "Selesai"
                        : "Serah Terima"}
                    </button>
                  ))}
                </div>
              </div>

              {/* 3. KLASIFIKASI FOTO */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-700 dark:text-slate-300 block">
                  Klasifikasi Foto:
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {(["PROGRESS", "FINAL", "HANDOVER"] as const).map((type) => (
                    <button
                      key={type}
                      type="button"
                      onClick={() => setPhotoType(type)}
                      className={`py-2 px-2 rounded-xl text-xs font-bold border transition-all text-center ${
                        photoType === type
                          ? "bg-blue-50 dark:bg-blue-900/40 text-[#1D5AA6] dark:text-blue-300 border-[#1D5AA6] ring-1 ring-[#1D5AA6]"
                          : "bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-700 hover:bg-slate-100"
                      }`}
                    >
                      {type === "PROGRESS"
                        ? "Progress Rutin"
                        : type === "FINAL"
                        ? "Bukti Final"
                        : "Serah Terima"}
                    </button>
                  ))}
                </div>
              </div>

              {/* 4. KETERANGAN PROGRESS */}
              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-700 dark:text-slate-300 block">
                  Keterangan Progress <span className="text-red-500">*</span>:
                </label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={2}
                  required
                  placeholder="Contoh: Pembongkaran plafon rusak selesai, rangka pengganti siap dipasang..."
                  className="w-full p-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-slate-900 dark:text-white focus:ring-2 focus:ring-[#1D5AA6] focus:outline-hidden"
                />
              </div>

              {/* 5. UPLOAD FOTO (WAJIB DENGAN WATERMARK SERVER) */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                    <Camera className="w-3.5 h-3.5 text-[#1D5AA6]" />
                    Upload Foto Bukti <span className="text-red-500">* (Wajib)</span>
                  </label>
                  <span className="text-[10px] text-slate-400">
                    Otomatis Watermark Server
                  </span>
                </div>

                <div className="border border-dashed border-slate-300 dark:border-slate-700 rounded-xl p-3 bg-slate-50/50 dark:bg-slate-800/40">
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    ref={fileInputRef}
                    multiple
                    className="hidden"
                    onChange={handleFileChange}
                  />

                  {previewUrls.length === 0 ? (
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => setIsCameraOpen(true)}
                        className="flex-1 flex flex-col items-center justify-center gap-1.5 h-20 border border-dashed border-slate-300 dark:border-slate-600 rounded-lg hover:border-[#1D5AA6] hover:bg-blue-50/50 dark:hover:bg-blue-900/20 text-slate-600 dark:text-slate-300 transition-colors"
                      >
                        <Camera className="w-5 h-5 text-[#1D5AA6]" />
                        <span className="text-[10px] font-bold uppercase tracking-wider">Kamera</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        className="flex-1 flex flex-col items-center justify-center gap-1.5 h-20 border border-dashed border-slate-300 dark:border-slate-600 rounded-lg hover:border-[#1D5AA6] hover:bg-blue-50/50 dark:hover:bg-blue-900/20 text-slate-600 dark:text-slate-300 transition-colors"
                      >
                        <ImageIcon className="w-5 h-5 text-blue-500" />
                        <span className="text-[10px] font-bold uppercase tracking-wider">Galeri Foto</span>
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                        {previewUrls.map((url, idx) => (
                          <div key={idx} className="relative rounded-lg overflow-hidden border border-slate-200 dark:border-slate-700 group">
                            <img
                              src={url}
                              alt={`Preview ${idx + 1}`}
                              className="w-full h-24 object-cover"
                            />
                            <button
                              type="button"
                              onClick={() => handleRemovePhoto(idx)}
                              className="absolute top-1 right-1 p-1 bg-red-600/90 hover:bg-red-700 text-white rounded-md text-[10px]"
                            >
                              <X className="w-3 h-3" />
                            </button>
                            <span className="absolute bottom-1 left-1 px-1.5 py-0.5 bg-black/60 text-white rounded text-[9px] font-mono">
                              Foto #{idx + 1}
                            </span>
                          </div>
                        ))}
                      </div>

                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => fileInputRef.current?.click()}
                          className="px-3 py-1 rounded-lg border border-slate-300 dark:border-slate-600 text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                        >
                          + Tambah Foto Lain
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                {/* Server Watermark Notice */}
                <div className="p-2.5 bg-blue-50/60 dark:bg-blue-950/20 border border-blue-100 dark:border-blue-900/40 rounded-xl text-[10px] text-blue-800 dark:text-blue-300 flex items-start gap-2">
                  <Info className="w-3.5 h-3.5 shrink-0 mt-0.5 text-blue-600" />
                  <span>
                    Watermark otomatis server mencakup: <strong>SPARTA SIAGA</strong>, Nomor Laporan: <strong>{incident.id}</strong>, Timestamp Terpercaya Server WIB, dan Progress <strong>{progressValue}%</strong>.
                  </span>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-colors"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={loading || isSysAdmin}
                  className="px-5 py-2.5 text-xs font-bold text-white bg-[#1D5AA6] hover:bg-[#123B6D] rounded-xl shadow-sm transition-colors flex items-center gap-1.5 disabled:opacity-50"
                >
                  {loading ? (
                    <span>Menyimpan Progress...</span>
                  ) : (
                    <>
                      <span>Simpan Progress</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </>
                  )}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>

    </AppDialog>
      <CameraCapture
        isOpen={isCameraOpen}
        onClose={() => setIsCameraOpen(false)}
        onCapture={handleCameraCapture}
        storeName={incident.storeName}
        reporterName={identity?.name || "Petugas Lapangan"}
      />
    </>
  );
}
