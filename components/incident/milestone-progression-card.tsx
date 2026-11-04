"use client";

import React, { useState, useEffect } from "react";
import {
  CheckCircle2,
  Clock,
  Lock,
  Upload,
  FileText,
  AlertTriangle,
  FileCheck,
  Eye,
  ChevronDown,
  ChevronUp,
  Download,
  ShieldCheck,
  RotateCcw,
  Send,
  Info,
} from "lucide-react";
import {
  MilestoneRecord,
  MilestoneKey,
  MILESTONE_ORDER,
  MILESTONE_CONFIG,
  IncidentRecord,
} from "@/types/incident";
import { UserIdentity } from "@/lib/identity";

interface MilestoneProgressionCardProps {
  incident: IncidentRecord;
  identity: UserIdentity | null;
  onMilestoneUpdated?: () => void;
  readOnly?: boolean;
}

export function MilestoneProgressionCard({
  incident,
  identity,
  onMilestoneUpdated,
  readOnly = false,
}: MilestoneProgressionCardProps) {
  const [milestones, setMilestones] = useState<MilestoneRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [submitNotes, setSubmitNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Operational Progress Gating State
  const [isGated, setIsGated] = useState(false);
  const [gatingReason, setGatingReason] = useState<string | null>(null);
  const [nextAction, setNextAction] = useState<string | null>(null);
  const [isDocComplete, setIsDocComplete] = useState<boolean>(false);
  const [missingDocs, setMissingDocs] = useState<string[]>([]);
  const [selectedStageKey, setSelectedStageKey] = useState<MilestoneKey>("CEKLIS");

  // Expanded revisions
  const [expandedRevisions, setExpandedRevisions] = useState<Record<string, boolean>>({});

  const loadMilestones = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/incidents/${incident.id}/milestones`);
      if (res.ok) {
        const json = await res.json();
        const list = Array.isArray(json.data)
          ? json.data
          : Array.isArray(json.data?.milestones)
          ? json.data.milestones
          : [];
        setMilestones(list);

        if (json.data) {
          setIsGated(Boolean(json.data.isProgressGated));
          setGatingReason(json.data.gatingReason || null);
          setNextAction(json.data.nextRequiredAction || null);
          setIsDocComplete(Boolean(json.data.isDocumentComplete));
          setMissingDocs(json.data.missingDocuments || []);
        }

        // Default selectedStageKey to first unsubmitted if currently pointing to submitted
        const unsubmitted = list.find((m: any) => m.status !== "SUBMITTED");
        if (unsubmitted) {
          setSelectedStageKey((prev) => {
            const currentItem = list.find((m: any) => m.stageKey === prev);
            return currentItem?.status === "SUBMITTED" ? unsubmitted.stageKey : prev;
          });
        }
      }
    } catch (err) {
      console.error("[MilestoneProgressionCard] Gagal memuat milestones:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadMilestones();
  }, [incident.id]);

  // Ensure safe array operations
  const safeMilestones = Array.isArray(milestones) ? milestones : [];

  // Active milestone based on selectedStageKey or unsubmitted
  const targetMilestone = safeMilestones.find((m) => m.stageKey === selectedStageKey) || safeMilestones.find((m) => m.status !== "SUBMITTED");
  const allCompleted = isDocComplete || (safeMilestones.length === 5 && safeMilestones.every((m) => m.status === "SUBMITTED"));
  const currentProgress = incident.progress ?? 0;

  const isBranchMatch = Boolean(
    identity?.branch &&
    incident.branch &&
    identity.branch.trim().toLowerCase() === incident.branch.trim().toLowerCase()
  );

  const isPicUser =
    identity?.scope !== "HO" &&
    identity?.systemRole !== "ADMIN" &&
    isBranchMatch &&
    (
      identity?.businessRole === "bms" ||
      identity?.role === "bms" ||
      identity?.businessRole === "bes" ||
      identity?.role === "bes" ||
      identity?.businessRole === "bbs" ||
      identity?.role === "bbs"
    );

  const isClosed = incident.status === "closed" || incident.status === "resolved" || incident.status === "archived";
  const handleFileUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!targetMilestone || !selectedFile) return;

    setSubmitting(true);
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      const formData = new FormData();
      formData.append("stage_key", targetMilestone.stageKey);
      formData.append("stageKey", targetMilestone.stageKey);
      formData.append("file", selectedFile);
      if (submitNotes.trim()) {
        formData.append("notes", submitNotes.trim());
      }

      const res = await fetch(`/api/incidents/${incident.id}/milestones`, {
        method: "POST",
        body: formData,
      });

      const json = await res.json().catch(() => ({}));
      if (res.ok) {
        setSuccessMessage(`Milestone ${targetMilestone.stageName} (${targetMilestone.targetProgress}%) berhasil dicatat.`);
        setSelectedFile(null);
        setSubmitNotes("");
        await loadMilestones();
        if (onMilestoneUpdated) onMilestoneUpdated();
      } else {
        setErrorMessage(json.error || "Gagal mengunggah berkas milestone.");
      }
    } catch (err: any) {
      console.error(err);
      setErrorMessage("Terjadi kesalahan jaringan saat mengunggah dokumen.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Banner: Progress Bar & Status */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-sm space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <span className="text-[10px] uppercase font-bold tracking-wider text-blue-600 dark:text-blue-400">
              Alur Penanganan Operasional
            </span>
            <h3 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <span>Progres 5 Milestone Penanganan</span>
              {isClosed && (
                <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300">
                  CLOSED
                </span>
              )}
            </h3>
            <div className="flex items-center gap-3 mt-1.5 text-xs font-semibold">
              <span className="text-slate-600 dark:text-slate-400">
                Progres Pekerjaan: <strong className="text-blue-600 dark:text-blue-400">{currentProgress}%</strong>
              </span>
              <span className="text-slate-300 dark:text-slate-700">•</span>
              <span className="text-slate-600 dark:text-slate-400">
                Kelengkapan Dokumen:{" "}
                <span className={`inline-flex items-center px-2 py-0.5 rounded-md font-bold text-[11px] ${
                  isDocComplete
                    ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300"
                    : "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300"
                }`}>
                  {isDocComplete ? "Lengkap" : "Belum Lengkap"}
                </span>
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2 self-start sm:self-auto">
            <span className="text-2xl font-black text-[#1D5AA6] dark:text-blue-400 font-mono">
              {currentProgress}%
            </span>
            <span className="text-xs text-slate-500 dark:text-slate-400">
              / 100%
            </span>
          </div>
        </div>

        {/* Visual Progress Bar */}
        <div className="h-2.5 w-full bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
          <div
            className={`h-full transition-all duration-500 ${
              isClosed ? "bg-emerald-600" : "bg-[#1D5AA6]"
            }`}
            style={{ width: `${Math.min(100, Math.max(0, currentProgress))}%` }}
          />
        </div>

        {/* Missing Documents Alert Banner */}
        {!isDocComplete && missingDocs.length > 0 && (
          <div className="p-3 bg-amber-50/80 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/40 rounded-xl text-xs text-amber-900 dark:text-amber-200 space-y-1.5">
            <div className="flex items-center gap-1.5 font-bold">
              <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
              <span>Dokumen Wajib yang Masih Perlu Dilengkapi:</span>
            </div>
            <ul className="list-disc list-inside space-y-0.5 text-[11px] text-amber-800 dark:text-amber-300 pl-1">
              {missingDocs.map((doc, idx) => (
                <li key={idx}>{doc}</li>
              ))}
            </ul>
          </div>
        )}

        {/* Milestone Steps Stepper (Responsive) */}
        <div className="grid grid-cols-5 gap-2 pt-1 text-center">
          {MILESTONE_ORDER.map((key, idx) => {
            const cfg = MILESTONE_CONFIG[key];
            const ms = safeMilestones.find((m) => m.stageKey === key);
            const isCompleted = ms?.status === "SUBMITTED";
            const isSelected = selectedStageKey === key;
            const isRevision = ms?.status === "REVISION_REQUESTED";

            return (
              <button
                key={key}
                type="button"
                onClick={() => setSelectedStageKey(key)}
                className="flex flex-col items-center space-y-1 group focus:outline-none"
              >
                <div
                  className={`w-7 h-7 sm:w-8 sm:h-8 rounded-full flex items-center justify-center text-xs font-bold transition-all ${
                    isCompleted
                      ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-700"
                      : isRevision
                      ? "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300 border border-amber-300 dark:border-amber-700 animate-pulse"
                      : isSelected
                      ? "bg-blue-600 text-white shadow-sm ring-2 ring-blue-300"
                      : "bg-slate-100 text-slate-400 dark:bg-slate-800 dark:text-slate-500 border border-slate-200 dark:border-slate-700"
                  }`}
                >
                  {isCompleted ? (
                    <CheckCircle2 className="w-4 h-4" />
                  ) : (
                    <span>{idx + 1}</span>
                  )}
                </div>
                <span className={`text-[10px] sm:text-[11px] font-semibold truncate w-full ${
                  isSelected ? "text-blue-600 dark:text-blue-400 font-bold" : "text-slate-700 dark:text-slate-300"
                }`}>
                  {cfg.label}
                </span>
                <span className="text-[9px] font-mono text-slate-400 dark:text-slate-500">
                  {cfg.progress}%
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Messages */}
      {errorMessage && (
        <div className="p-3.5 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 rounded-xl text-xs text-red-700 dark:text-red-300 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0 text-red-600" />
          <span>{errorMessage}</span>
        </div>
      )}

      {successMessage && (
        <div className="p-3.5 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 rounded-xl text-xs text-emerald-800 dark:text-emerald-300 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" />
          <span>{successMessage}</span>
        </div>
      )}

      {/* Informative Lock Banner when Progress is Gated */}
      {isGated && !isClosed && (
        <div
          id="operational-progress-gated-banner"
          className="bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-800 rounded-2xl p-5 shadow-sm space-y-3"
        >
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-100 dark:bg-amber-900/60 flex items-center justify-center shrink-0 text-amber-700 dark:text-amber-300">
              <Lock className="w-5 h-5" />
            </div>
            <div className="space-y-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[10px] font-bold uppercase tracking-wider text-amber-800 dark:text-amber-300 bg-amber-200/60 dark:bg-amber-900/80 px-2 py-0.5 rounded-md">
                  Progres Operasional Terkunci
                </span>
                <span className="text-xs font-semibold text-amber-900 dark:text-amber-200">
                  Prasyarat Operasional Belum Lengkap
                </span>
              </div>
              <p className="text-xs text-amber-900 dark:text-amber-200 leading-relaxed font-medium">
                {gatingReason || "Laporan baru memerlukan tahap verifikasi awal sebelum progres operasional dapat di-submit."}
              </p>
              {nextAction && (
                <div className="pt-2 flex items-start gap-2 text-xs text-amber-800 dark:text-amber-300 bg-amber-100/60 dark:bg-amber-900/30 p-2.5 rounded-xl border border-amber-200 dark:border-amber-800/60">
                  <Info className="w-4 h-4 shrink-0 mt-0.5 text-amber-700 dark:text-amber-400" />
                  <div>
                    <span className="font-bold">Aksi Berikutnya: </span>
                    <span>{nextAction}</span>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Upload & Submit Active Milestone (PIC only - Unlocked when prerequisites met) */}
      {!isGated && targetMilestone && isPicUser && !isClosed && (
        <div className="bg-white dark:bg-slate-900 border-2 border-blue-200 dark:border-blue-900/60 rounded-2xl p-5 shadow-sm space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Upload className="w-5 h-5 text-[#1D5AA6] dark:text-blue-400" />
              <div>
                <h4 className="text-sm font-bold text-slate-900 dark:text-white">
                  Unggah Bukti: {targetMilestone.stageName} ({targetMilestone.targetProgress}%)
                </h4>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  Pilih tahap milestone yang dicapai di lapangan dan unggah berkas bukti fisik (PDF/JPEG/PNG).
                </p>
              </div>
            </div>
            <span className="px-2.5 py-1 rounded-full text-[10px] font-bold bg-blue-50 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300 border border-blue-200 dark:border-blue-800 self-start sm:self-auto">
              Tahap {targetMilestone.stageOrder} dari 5
            </span>
          </div>

          {/* Quick Stage Selector Buttons */}
          <div className="flex flex-wrap items-center gap-1.5 pt-1 border-t border-slate-100 dark:border-slate-800">
            <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400 mr-1">
              Pilih Tahap:
            </span>
            {MILESTONE_ORDER.map((stageKey) => {
              const cfg = MILESTONE_CONFIG[stageKey];
              const ms = safeMilestones.find((m) => m.stageKey === stageKey);
              const isSelected = selectedStageKey === stageKey;
              const isSubmitted = ms?.status === "SUBMITTED";

              return (
                <button
                  key={stageKey}
                  type="button"
                  onClick={() => setSelectedStageKey(stageKey)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 ${
                    isSelected
                      ? "bg-[#1D5AA6] text-white shadow-xs"
                      : isSubmitted
                      ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800"
                      : "bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200"
                  }`}
                >
                  {isSubmitted && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />}
                  <span>{cfg.label} ({cfg.progress}%)</span>
                </button>
              );
            })}
          </div>

          {targetMilestone.stageKey === "APPROVE_PROXY" && (
            <div className="p-3 bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-900/40 rounded-xl text-xs text-blue-900 dark:text-blue-200 space-y-1">
              <div className="flex items-center gap-1.5 font-bold">
                <Info className="w-4 h-4 text-blue-600 shrink-0" />
                <span>Unggah Bukti Persetujuan Eksternal (Approve Proxy 30%):</span>
              </div>
              <p className="text-[11px] text-blue-800 dark:text-blue-300 leading-relaxed">
                Tahap ini mencatat bukti persetujuan dari pihak eksternal (bukan approval internal SPARTA SIAGA). Unggah dokumen bukti (PDF/JPEG/PNG) untuk melanjutkan ke penerbitan SPK.
              </p>
            </div>
          )}

          {targetMilestone.stageKey === "ESTIMASI" && (
            <div className="p-3 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/40 rounded-xl text-xs text-amber-900 dark:text-amber-200 space-y-1">
              <div className="flex items-center gap-1.5 font-bold">
                <Info className="w-4 h-4 text-amber-600 shrink-0" />
                <span>Dokumentasi Milestone Estimasi (25%):</span>
              </div>
              <p className="text-[11px] text-amber-800 dark:text-amber-300 leading-relaxed">
                Perhitungan estimasi biaya dikerjakan pada aplikasi SPARTA terkait. Unggah dokumen hasil estimasi resmi di sini sebagai dokumentasi perkembangan pekerjaan 25%.
              </p>
            </div>
          )}

          {readOnly ? (
            <div className="bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-800 rounded-xl p-4 text-xs text-slate-600 dark:text-slate-400 flex items-start gap-3">
              <Info className="w-5 h-5 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <h6 className="font-bold text-slate-800 dark:text-slate-200">Detail Laporan (Read-Only)</h6>
                <p className="text-[11px] leading-relaxed">
                  Pembaruan dokumen bukti milestone (10% Ceklis, 25% Estimasi, 30% Approve Proxy, 50% SPK, 100% Serah Terima) dikelola secara terpusat melalui tombol <strong>Update Progress</strong> di Pusat Laporan.
                </p>
              </div>
            </div>
          ) : (
            <form onSubmit={handleFileUpload} className="space-y-4">
              <div className="border-2 border-dashed border-slate-300 dark:border-slate-700 rounded-xl p-4 text-center hover:border-blue-500 transition-colors bg-slate-50/50 dark:bg-slate-800/30">
                <input
                  type="file"
                  id="milestone-file-input"
                  accept=".pdf,.jpg,.jpeg,.png"
                  onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
                  className="hidden"
                />
                <label
                  htmlFor="milestone-file-input"
                  className="cursor-pointer flex flex-col items-center space-y-1.5"
                >
                  <Upload className="w-6 h-6 text-slate-400" />
                  <span className="text-xs font-bold text-[#1D5AA6] dark:text-blue-400">
                    {selectedFile ? selectedFile.name : "Pilih Dokumen Bukti (PDF / Foto JPEG)"}
                  </span>
                  <span className="text-[10px] text-slate-400">
                    Maksimal 10MB • Format PDF, JPEG, JPG, PNG
                  </span>
                </label>
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Catatan Pekerjaan (Opsional):
                </label>
                <textarea
                  value={submitNotes}
                  onChange={(e) => setSubmitNotes(e.target.value)}
                  rows={2}
                  placeholder="Tambahkan keterangan teknis milestone..."
                  className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:border-blue-500"
                />
              </div>

              <div className="flex justify-end pt-1">
                <button
                  type="submit"
                  disabled={submitting || !selectedFile}
                  className="px-5 py-2.5 rounded-xl text-xs font-bold text-white bg-[#1D5AA6] hover:bg-[#123B6D] disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-sm flex items-center gap-1.5"
                >
                  {submitting ? (
                    <span>Mengunggah Berkas...</span>
                  ) : (
                    <>
                      <Send className="w-3.5 h-3.5" />
                      <span>Submit {targetMilestone.stageName} ({targetMilestone.targetProgress}%)</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          )}
        </div>
      )}

      {!readOnly && allCompleted && !isClosed && (
        <div className="bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 rounded-xl p-4 text-xs text-emerald-900 dark:text-emerald-200">
          Lima dokumen milestone telah lengkap. Pengajuan Serah Terima, persetujuan koordinator,
          dan keputusan akhir BnM Manajer dilanjutkan pada tab
          <strong> Persetujuan &amp; Case Close</strong> di Update Progress.
        </div>
      )}

      {/* List of 5 Milestones with Document Download & Revision History */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden shadow-sm">
        <div className="px-5 py-3.5 bg-slate-50 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <span className="text-xs font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
            <FileCheck className="w-4 h-4 text-[#1D5AA6]" />
            Daftar Bukti Fisik Milestone
          </span>
          <span className="text-[11px] text-slate-500 dark:text-slate-400">
            5 Tahapan Kumulatif
          </span>
        </div>

        <div className="divide-y divide-slate-100 dark:divide-slate-800">
          {safeMilestones.map((ms) => {
            const isCompleted = ms.status === "SUBMITTED";
            const isExpanded = Boolean(expandedRevisions[ms.id]);
            const revisionsCount = ms.revisions?.length || 0;

            return (
              <div key={ms.id} className="p-4 sm:p-5 space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div className="flex items-center gap-2.5">
                    <span
                      className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
                        isCompleted
                          ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300"
                          : "bg-slate-100 text-slate-400 dark:bg-slate-800 dark:text-slate-500"
                      }`}
                    >
                      {ms.stageOrder}
                    </span>
                    <div>
                      <h5 className="font-bold text-xs text-slate-900 dark:text-white">
                        {ms.stageName} ({ms.targetProgress}%)
                      </h5>
                      <p className="text-[10px] text-slate-400 dark:text-slate-500">
                        {isCompleted
                          ? `Disubmit oleh ${ms.actorName || "Petugas"} (${(ms.actorRole || "").toUpperCase()}) • ${
                              ms.submittedAt ? new Date(ms.submittedAt).toLocaleString("id-ID") : "-"
                            }`
                          : "Belum disubmit"}
                      </p>
                    </div>
                  </div>

                  {/* Document Access Button */}
                  {isCompleted && ms.documentStorageKey && (
                    <div className="flex items-center gap-2 self-start sm:self-auto">
                      <a
                        href={`/api/incidents/${incident.id}/milestones/document/${ms.documentStorageKey}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold bg-blue-50 dark:bg-blue-950/50 text-[#1D5AA6] dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-900/60 transition-colors"
                      >
                        <Eye className="w-3.5 h-3.5" />
                        <span className="truncate max-w-[140px]">
                          {ms.documentOriginalName || "Lihat Bukti"}
                        </span>
                      </a>
                    </div>
                  )}
                </div>

                {/* Notes if any */}
                {ms.notes && (
                  <p className="text-[11px] text-slate-600 dark:text-slate-400 bg-slate-50 dark:bg-slate-800/40 p-2.5 rounded-xl border border-slate-100 dark:border-slate-800">
                    {ms.notes}
                  </p>
                )}

                {/* Revision History Toggle (Rule 10: Prior evidence is never lost) */}
                {revisionsCount > 0 && (
                  <div className="pt-1">
                    <button
                      type="button"
                      onClick={() =>
                        setExpandedRevisions((prev) => ({
                          ...prev,
                          [ms.id]: !prev[ms.id],
                        }))
                      }
                      className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 flex items-center gap-1 transition-colors"
                    >
                      {isExpanded ? (
                        <ChevronUp className="w-3.5 h-3.5" />
                      ) : (
                        <ChevronDown className="w-3.5 h-3.5" />
                      )}
                      <span>Riwayat Revisi ({revisionsCount} berkas sebelumnya)</span>
                    </button>

                    {isExpanded && (
                      <div className="mt-2 pl-4 border-l-2 border-slate-200 dark:border-slate-700 space-y-2">
                        {ms.revisions.map((rev) => (
                          <div
                            key={rev.revisionNumber}
                            className="text-[10px] text-slate-600 dark:text-slate-400 flex items-center justify-between py-1 border-b border-slate-100 dark:border-slate-800 last:border-0"
                          >
                            <div>
                              <span className="font-bold">Revisi #{rev.revisionNumber}:</span>{" "}
                              <span>{rev.documentOriginalName}</span> •{" "}
                              <span>{rev.actorName}</span>
                            </div>
                            <a
                              href={`/api/incidents/${incident.id}/milestones/document/${rev.documentStorageKey}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-blue-600 hover:underline"
                            >
                              Lihat
                            </a>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* PDF Export Section */}
      <div className="bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700/60 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h5 className="font-bold text-xs text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
            <Download className="w-4 h-4 text-slate-600 dark:text-slate-400" />
            Dokumen Laporan Resmi
          </h5>
          <p className="text-[10px] text-slate-500 dark:text-slate-400">
            Unduh laporan digital terverifikasi dalam format PDF standar.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {/* Initial PDF */}
          <a
            href={`/api/incidents/${incident.id}/export/initial-pdf`}
            target="_blank"
            rel="noopener noreferrer"
            className="px-3.5 py-2 rounded-xl text-xs font-semibold bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 hover:bg-slate-100 transition-colors shadow-sm flex items-center gap-1.5"
          >
            <FileText className="w-3.5 h-3.5 text-blue-600" />
            <span>PDF Laporan Awal</span>
          </a>

          {/* Final PDF (Enabled when CLOSED) */}
          {isClosed ? (
            <a
              href={`/api/incidents/${incident.id}/export/final-pdf`}
              target="_blank"
              rel="noopener noreferrer"
              className="px-3.5 py-2 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white transition-colors shadow-sm flex items-center gap-1.5"
            >
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>PDF Berita Acara (CLOSED)</span>
            </a>
          ) : (
            <span
              title="Tersedia setelah laporan disetujui BnM Manajer (CLOSED)"
              className="px-3.5 py-2 rounded-xl text-xs font-semibold bg-slate-200/60 dark:bg-slate-800 text-slate-400 dark:text-slate-600 cursor-not-allowed flex items-center gap-1.5"
            >
              <Lock className="w-3.5 h-3.5" />
              <span>PDF Final (Terkunci)</span>
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
