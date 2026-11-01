"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  ClipboardList,
  Search,
  Filter,
  Eye,
  CheckCircle2,
  Clock,
  Wrench,
  AlertTriangle,
  Plus,
  ChevronLeft,
  ChevronRight,
  X,
  RotateCcw,
  ClipboardCheck,
  ShieldCheck,
  UserCheck,
  FileCheck,
} from "lucide-react";
import { IncidentRecord, DisasterType, IncidentStatus, RoleType, isActiveStatus, isHistoryStatus } from "@/types/incident";
import { UserIdentity } from "@/lib/identity";
import { CompletionApprovalModal } from "../incident/completion-approval-modal";
import { EstimationModal } from "../incident/estimation-modal";
import { ProgressUpdateModal } from "../incident/progress-update-modal";
import { StoreVerificationModal } from "../incident/store-verification-modal";
import { HoReportMonitoring } from "./ho-report-monitoring";
import { getStandardizedOperationalStatus } from "@/lib/operational-status";
import { getReportSourceInfo } from "@/lib/display-formatters";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";

const DISASTER_ID_MAP: Record<string, string> = {
  earthquake: "Gempa Bumi",
  flood: "Banjir",
  fire: "Kebakaran",
  theft: "Kemalingan",
  heavy_rain: "Hujan/Badai",
  strong_wind: "Angin Kencang",
  severe_building_damage: "Kerusakan Bangunan",
  tsunami: "Tsunami",
  volcano: "Gunung Meletus",
};

export function formatIndonesianDate(raw?: string): string {
  if (!raw) return "-";
  try {
    const d = new Date(raw);
    if (isNaN(d.getTime())) return raw;
    return d.toLocaleDateString("id-ID", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  } catch {
    return raw;
  }
}

export function getOperationalHandlingStatus(inc: IncidentRecord) {
  return getStandardizedOperationalStatus(inc);
}

export function getOriginBadge(inc: IncidentRecord) {
  const source = getReportSourceInfo(inc.reportOrigin);
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-medium whitespace-nowrap ${source.badgeCls}`}>
      {source.longLabel}
    </span>
  );
}

interface OperationalReportCenterProps {
  incidents: IncidentRecord[];
  onSelectIncident: (inc: IncidentRecord) => void;
  onOpenReportModal: () => void;
  onReportUpdated?: () => void | Promise<void>;
}

export function OperationalReportCenter({
  incidents,
  onSelectIncident,
  onOpenReportModal,
  onReportUpdated,
}: OperationalReportCenterProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [filterStatus, setFilterStatus] = useState<IncidentStatus | "all">("all");
  const [filterType, setFilterType] = useState<"all" | DisasterType>("all");

  const [identity, setIdentity] = useState<UserIdentity | null>(null);
  const [identityLoading, setIdentityLoading] = useState(true);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data) setIdentity(data.user || data);
      })
      .catch(() => {})
      .finally(() => setIdentityLoading(false));
  }, []);

  const isSystemAdmin = identity?.systemRole === "ADMIN";
  const isHoViewer = identity?.scope === "HO" && !isSystemAdmin;
  const canTriggerEstimation = !isSystemAdmin && Boolean(identity?.effectivePermissions?.ESTIMATION_TRIGGER);
  const canUpdateProgress = !isHoViewer && (
    isSystemAdmin ||
    Boolean(identity?.effectivePermissions?.REPORT_UPDATE_PROGRESS) ||
    Boolean(identity?.effectivePermissions?.REPORT_CONFIRM) ||
    Boolean(identity?.effectivePermissions?.REPORT_CLOSE) ||
    Boolean(identity?.effectivePermissions?.COMPLETION_SUBMIT) ||
    Boolean(identity?.effectivePermissions?.COMPLETION_APPROVE_COORDINATOR)
  );
  const canCreateReport = Boolean(identity) && !isHoViewer;

  // Contextual Modal States
  const [selectedProgressReport, setSelectedProgressReport] = useState<IncidentRecord | null>(null);
  const [selectedVerificationReport, setSelectedVerificationReport] = useState<IncidentRecord | null>(null);
  const [selectedApprovalReport, setSelectedApprovalReport] = useState<IncidentRecord | null>(null);

  useEffect(() => {
    setSelectedProgressReport((previous) =>
      previous ? incidents.find((item) => item.id === previous.id) || previous : previous
    );
    setSelectedVerificationReport((previous) =>
      previous ? incidents.find((item) => item.id === previous.id) || previous : previous
    );
    setSelectedApprovalReport((previous) =>
      previous ? incidents.find((item) => item.id === previous.id) || previous : previous
    );
  }, [incidents]);

  const getContextualAction = (inc: IncidentRecord) => {
    if (isHoViewer) return null;
    if (["closed", "resolved", "archived", "confirmed_safe", "rejected_invalid"].includes(inc.status)) {
      return null;
    }

    const userRole = (identity?.role || "").toLowerCase();
    const userBranch = (identity?.branch || "").trim().toLowerCase();
    const repBranch = (inc.branch || "").trim().toLowerCase();
    const isSameBranch = !userBranch || userBranch === repBranch;
    const isSysAdmin = identity?.systemRole === "ADMIN";

    const tkp = (inc.tkpType || (inc.locationKind === "FACILITY" ? "dc" : "toko")).toLowerCase();
    const expectedSpecialistRole = tkp === "dc" ? "bes" : tkp === "building" ? "bbs" : "bms";
    const expectedCoordinatorRole = tkp === "dc" ? "bec" : tkp === "building" ? "bbc" : "bmc";

    const isSpecialist = userRole === expectedSpecialistRole && isSameBranch;
    const isCoordinator = userRole === expectedCoordinatorRole && isSameBranch;
    const isManager = userRole === "bm" && isSameBranch;

    // 1. Pemeriksaan Lapangan
    if (["pending_confirmation", "verifying"].includes(inc.status)) {
      return {
        label: "Pemeriksaan Lapangan",
        icon: ClipboardCheck,
        disabled: !isSpecialist && !isSysAdmin,
        disabledReason: !isSpecialist ? `Hanya dapat diperiksa oleh ${expectedSpecialistRole.toUpperCase()} cabang terkait.` : undefined,
        handler: () => setSelectedVerificationReport(inc),
      };
    }

    // 2. Revisi Pemeriksaan
    if (inc.status === "clarification_requested") {
      return {
        label: "Revisi Pemeriksaan",
        icon: RotateCcw,
        disabled: !isSpecialist && !isSysAdmin,
        disabledReason: !isSpecialist ? `Menunggu revisi bukti dari ${expectedSpecialistRole.toUpperCase()} cabang.` : undefined,
        handler: () => setSelectedVerificationReport(inc),
      };
    }

    // 3. Konfirmasi BnM Manajer
    if (inc.status === "pending_bm_approval") {
      return {
        label: "Konfirmasi BnM",
        icon: ShieldCheck,
        disabled: !isManager && !isSysAdmin,
        disabledReason: !isManager ? "Menunggu persetujuan awal BnM Manajer cabang." : undefined,
        handler: () => setSelectedVerificationReport(inc),
      };
    }

    // 4. Penanganan Kerusakan / Kesiapan Kerja
    if (["confirmed_affected", "WAITING_ESTIMATION"].includes(inc.status)) {
      return {
        label: "Penanganan Kerusakan",
        icon: Wrench,
        disabled: !isSpecialist && !isSysAdmin,
        disabledReason: !isSpecialist ? `Tindak lanjut dikelola oleh ${expectedSpecialistRole.toUpperCase()} cabang.` : undefined,
        handler: () => setSelectedProgressReport(inc),
      };
    }

    // 5. Work in Progress / Completion Review
    if (inc.status === "in_maintenance") {
      const currentProgress = inc.progress ?? 0;
      if (currentProgress < 100) {
        return {
          label: "Update Progres",
          icon: Wrench,
          disabled: !isSpecialist,
          disabledReason: !isSpecialist ? `Pembaruan progres fisik dikelola oleh ${expectedSpecialistRole.toUpperCase()} cabang.` : undefined,
          handler: () => setSelectedProgressReport(inc),
        };
      }
      // 100% physically complete: PIC must complete milestones & submit completion first
      if (isSpecialist) {
        return {
          label: "Berkas Milestone",
          icon: FileCheck,
          disabled: false,
          handler: () => setSelectedProgressReport(inc),
        };
      }
      // Coordinator button remains disabled until PIC officially submits completion
      return {
        label: "Review Koordinator",
        icon: UserCheck,
        disabled: true,
        disabledReason: "Menunggu PIC resmi mengajukan penyelesaian pekerjaan dan melengkapi berkas.",
        handler: () => onSelectIncident(inc),
      };
    }

    // 6. Awaiting Coordinator Approval (PIC officially submitted completion)
    if (inc.status === "awaiting_st") {
      return {
        label: "Review Koordinator",
        icon: UserCheck,
        disabled: !isCoordinator,
        disabledReason: !isCoordinator ? `Menunggu review ${expectedCoordinatorRole.toUpperCase()} cabang.` : undefined,
        handler: () => setSelectedApprovalReport(inc),
      };
    }

    // 7. Awaiting Final Manager Case Close (Coordinator officially approved completion)
    if (["pending_final_approval", "approved_pending_close"].includes(inc.status)) {
      return {
        label: "Persetujuan & Case Close",
        icon: ShieldCheck,
        disabled: !isManager,
        disabledReason: !isManager ? "Menunggu persetujuan akhir dan penutupan resmi oleh BnM Manajer cabang." : undefined,
        handler: () => setSelectedApprovalReport(inc),
      };
    }

    return null;
  };

  const filteredIncidents = useMemo(() => {
    return incidents.filter((inc) => {
      // Exclude history reports permanently from active operational center
      if (!isHoViewer && isHistoryStatus(inc.status)) return false;

      // Detailed active status filter
      if (filterStatus !== "all" && inc.status !== filterStatus) return false;

      // Type filter
      if (filterType !== "all" && inc.disasterType !== filterType) return false;

      // Search query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const ticketId = (inc.maintenanceTicket?.ticketId || inc.id || '').toLowerCase();
        const storeName = (inc.storeName || '').toLowerCase();
        const branch = (inc.branch || '').toLowerCase();
        const city = (inc.locationCity || '').toLowerCase();
        if (
          !ticketId.includes(q) &&
          !storeName.includes(q) &&
          !branch.includes(q) &&
          !city.includes(q)
        ) {
          return false;
        }
      }

      return true;
    });
  }, [incidents, searchQuery, filterStatus, filterType, isHoViewer]);

  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 10;

  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, filterStatus, filterType]);

  const totalPages = Math.max(1, Math.ceil(filteredIncidents.length / pageSize));

  const paginatedIncidents = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredIncidents.slice(start, start + pageSize);
  }, [filteredIncidents, currentPage, pageSize]);

  const activeCount = incidents.filter(i => isActiveStatus(i.status)).length;
  const pendingCount = incidents.filter(i => i.status === "pending_confirmation" || i.status === "verifying").length;
  const maintenanceCount = incidents.filter(i => i.status === "in_maintenance").length;
  const resolvedCount = incidents.filter(i => isHistoryStatus(i.status)).length;

  const getStatusBadge = (status: IncidentStatus) => {
    switch (status) {
      case "pending_confirmation":
        return { label: "Perlu Konfirmasi", color: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400" };
      case "pending_bm_approval":
        return { label: "Menunggu Persetujuan BnM", color: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300" };
      case "clarification_requested":
        return { label: "Perlu Klarifikasi", color: "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300" };
      case "confirmed_affected":
        return { label: "Disetujui BnM", color: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300" };
      case "in_estimation":
        return { label: "Dalam Estimasi", color: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300" };
      case "verifying":
        return { label: "Verifikasi", color: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400" };
      case "investigating":
        return { label: "Investigasi", color: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400" };
      case "in_maintenance":
        return { label: "Penanganan", color: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400" };
      case "confirmed_safe":
        return { label: "Dinyatakan Aman", color: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300" };
      case "rejected_invalid":
        return { label: "Ditolak", color: "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300" };
      case "expired_unhandled":
        return { label: "Tidak Ditindaklanjuti", color: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300" };
      case "closed":
      case "archived":
      case "resolved":
        return { label: "Selesai", color: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400" };
      case "in_construction":
        return { label: "Perbaikan Berjalan", color: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300" };
      case "pending_final_approval":
        return { label: "Persetujuan Akhir", color: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300" };
      default:
        return { label: "Unknown", color: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300" };
    }
  };

  if (identityLoading) {
    return (
      <div role="status" aria-label="Menyiapkan data laporan" className="space-y-4 max-w-7xl mx-auto pb-20 animate-pulse">
        <div className="flex flex-col gap-1">
          <div className="h-6 w-52 bg-slate-200 dark:bg-slate-800 rounded-md" />
          <div className="h-4 w-72 bg-slate-100 dark:bg-slate-800/60 rounded-md" />
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-20 bg-slate-100 dark:bg-slate-800/50 rounded-xl border border-slate-200/60 dark:border-slate-800" />
          ))}
        </div>
        <div className="h-10 bg-slate-100 dark:bg-slate-800/50 rounded-lg border border-slate-200/60 dark:border-slate-800" />
        <div className="h-72 bg-slate-100 dark:bg-slate-800/50 rounded-xl border border-slate-200/60 dark:border-slate-800" />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-20">
      
      {/* Dedicated HO monitoring, deliberately separate from branch workflows. */}
      {isHoViewer ? (
        <HoReportMonitoring incidents={incidents} />
      ) : (
        <>
      {/* ── Header & Action Bar ── */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-lg sm:text-xl font-bold flex items-center gap-2 text-slate-900 dark:text-white">
            <ClipboardList className="w-5 h-5 text-[#1D5AA6]" />
            Daftar Laporan Kejadian
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Monitoring dan tindak lanjut laporan insiden operasional unit kerja.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 pt-1 sm:pt-0">
          {canCreateReport && (
            <button
              onClick={onOpenReportModal}
              type="button"
              className="inline-flex items-center justify-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-lg bg-[#1D5AA6] hover:bg-[#154684] text-white shadow-2xs transition-colors min-h-[40px] focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            >
              <Plus className="w-4 h-4" />
              Buat Laporan
            </button>
          )}
        </div>
      </div>

      {/* ── KPI Summary Cards ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 sm:gap-3">
        {[
          { label: "Aktif / Berjalan", value: activeCount, icon: Clock, color: "text-blue-600 dark:text-blue-400" },
          { label: "Perlu Konfirmasi", value: pendingCount, icon: AlertTriangle, color: "text-rose-600 dark:text-rose-400" },
          { label: "Dalam Penanganan", value: maintenanceCount, icon: Wrench, color: "text-amber-600 dark:text-amber-400" },
          { label: "Selesai (Arsip)", value: resolvedCount, icon: CheckCircle2, color: "text-emerald-600 dark:text-emerald-400" },
        ].map((kpi, i) => (
          <div
            key={i}
            className="bg-white dark:bg-slate-900 p-3.5 sm:p-4 rounded-xl border border-slate-200/80 dark:border-slate-800 shadow-2xs flex flex-col gap-1"
          >
            <div className="flex items-center gap-1.5 text-[11px] font-medium text-slate-500 dark:text-slate-400">
              <kpi.icon className={`w-3.5 h-3.5 ${kpi.color}`} />
              <span className="truncate">{kpi.label}</span>
            </div>
            <div className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
              {kpi.value}
            </div>
          </div>
        ))}
      </div>

      {/* ── Filters & Search ── */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 sm:gap-3">
        <div className="relative flex-1 w-full">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            placeholder="Cari No. Laporan, Toko, Cabang, Kota..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            aria-label="Cari No. Laporan, Toko, Cabang, atau Kota"
            className="w-full pl-9 pr-9 py-2 text-xs sm:text-sm bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 text-slate-800 dark:text-slate-200 placeholder:text-slate-400 min-h-[40px] transition-colors"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery("")}
              aria-label="Hapus pencarian"
              className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 rounded-md"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
        
        <div className="flex items-center gap-2 w-full sm:w-auto shrink-0 flex-wrap sm:flex-nowrap">
          <Select
            value={filterStatus}
            onValueChange={(val) => {
              if (val) setFilterStatus(val as IncidentStatus | "all");
            }}
          >
            <SelectTrigger
              aria-label="Filter status laporan"
              className="flex-1 sm:flex-initial h-10 px-3 text-xs font-medium bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 min-w-[160px]"
            >
              <SelectValue placeholder="Semua Status Aktif" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Semua Status Aktif</SelectItem>
              <SelectItem value="pending_confirmation">Perlu Konfirmasi</SelectItem>
              <SelectItem value="pending_bm_approval">Menunggu Persetujuan BnM</SelectItem>
              <SelectItem value="clarification_requested">Perlu Klarifikasi</SelectItem>
              <SelectItem value="confirmed_affected">Disetujui BnM</SelectItem>
              <SelectItem value="in_estimation">Dalam Estimasi</SelectItem>
              <SelectItem value="investigating">Investigasi</SelectItem>
              <SelectItem value="in_maintenance">Penanganan</SelectItem>
            </SelectContent>
          </Select>

          <Select
            value={filterType}
            onValueChange={(val) => {
              if (val) setFilterType(val as "all" | DisasterType);
            }}
          >
            <SelectTrigger
              aria-label="Filter jenis kejadian"
              className="flex-1 sm:flex-initial h-10 px-3 text-xs font-medium bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 min-w-[150px]"
            >
              <SelectValue placeholder="Semua Kejadian" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Semua Kejadian</SelectItem>
              <SelectItem value="earthquake">Gempa Bumi</SelectItem>
              <SelectItem value="flood">Banjir</SelectItem>
              <SelectItem value="fire">Kebakaran</SelectItem>
              <SelectItem value="heavy_rain">Hujan/Badai</SelectItem>
              <SelectItem value="strong_wind">Angin Kencang</SelectItem>
              <SelectItem value="theft">Kemalingan</SelectItem>
              <SelectItem value="severe_building_damage">Kerusakan Bangunan</SelectItem>
              <SelectItem value="other">Lainnya</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* ── Content ── */}
      {filteredIncidents.length === 0 ? (
        <div className="text-center py-14 px-4 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-2xs">
          <ClipboardList className="w-9 h-9 mx-auto text-slate-300 dark:text-slate-600 mb-2.5" />
          <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-300">
            {searchQuery || filterStatus !== "all" || filterType !== "all"
              ? "Tidak ada laporan yang sesuai kriteria pencarian"
              : "Belum ada laporan insiden operasional aktif"}
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-sm mx-auto">
            {searchQuery || filterStatus !== "all" || filterType !== "all"
              ? "Coba gunakan kata kunci lain atau setel ulang filter untuk melihat seluruh laporan."
              : "Laporan baru akan muncul di sini setelah dibuat atau terdeteksi oleh sistem."}
          </p>
          {(searchQuery || filterStatus !== "all" || filterType !== "all") && (
            <button
              onClick={() => {
                setSearchQuery("");
                setFilterStatus("all");
                setFilterType("all");
              }}
              type="button"
              className="mt-3.5 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-[#1D5AA6] dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/40 rounded-lg transition-colors"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Reset Filter
            </button>
          )}
        </div>
      ) : (
        <>
          {/* DESKTOP TABLE VIEW */}
          <div className="hidden md:block bg-white dark:bg-slate-900 rounded-xl border border-slate-200/90 dark:border-slate-800 shadow-2xs overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50/80 dark:bg-slate-800/60 text-slate-500 dark:text-slate-400 font-semibold uppercase tracking-wider text-[10px] border-b border-slate-200 dark:border-slate-700">
                  <tr>
                    <th className="px-4 py-3 whitespace-nowrap">No. Laporan & Tanggal</th>
                    <th className="px-4 py-3">Lokasi / Cabang</th>
                    <th className="px-3 py-3">Kejadian & Sumber</th>
                    <th className="px-3 py-3">Status Penanganan</th>
                    <th className="px-4 py-3 text-right">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-slate-700 dark:text-slate-300">
                  {paginatedIncidents.map((inc) => {
                    const handlingStatus = getOperationalHandlingStatus(inc);
                    const formattedDate = formatIndonesianDate(inc.date || inc.createdAt);
                    const disasterLabel = DISASTER_ID_MAP[inc.disasterType?.toLowerCase()] || inc.disasterType;
                    const displayCity =
                      inc.locationCity && inc.locationCity !== "Unknown"
                        ? inc.locationCity
                        : inc.branch || "Area Toko";

                    const isDc = inc.locationKind === "FACILITY" || inc.tkpType === "dc";
                    const isBuilding = inc.tkpType === "building";

                    return (
                      <tr key={inc.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition-colors">
                        <td className="px-4 py-3 whitespace-nowrap">
                          <div className="font-mono font-semibold text-[#1D5AA6] dark:text-blue-400">
                            {inc.maintenanceTicket?.ticketId || inc.id}
                          </div>
                          <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                            {formattedDate}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="font-semibold text-slate-900 dark:text-white flex items-center gap-1.5 max-w-[240px]">
                            {isDc ? (
                              <span className="text-[9px] font-bold bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300 px-1.5 py-0.5 rounded border border-amber-200/80 dark:border-amber-800 shrink-0">
                                DC BES
                              </span>
                            ) : isBuilding ? (
                              <span className="text-[9px] font-bold bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300 px-1.5 py-0.5 rounded border border-slate-200 dark:border-slate-700 shrink-0">
                                Gedung
                              </span>
                            ) : null}
                            <span className="truncate" title={inc.storeName}>
                              {inc.storeName}
                            </span>
                          </div>
                          <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate max-w-[240px] mt-0.5">
                            {inc.branch} • {displayCity}
                          </div>
                        </td>
                        <td className="px-3 py-3 whitespace-nowrap">
                          <div className="font-medium text-slate-800 dark:text-slate-200 text-xs">
                            {disasterLabel}
                          </div>
                          <div className="mt-1">
                            {getOriginBadge(inc)}
                          </div>
                        </td>
                        <td className="px-3 py-3 whitespace-nowrap">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full font-medium text-[10px] ${handlingStatus.cls}`}>
                            {handlingStatus.label}
                          </span>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-right">
                          <div className="inline-flex items-center gap-1.5 justify-end">
                            {(() => {
                              const action = getContextualAction(inc);
                              if (!action) return null;
                              return (
                                <Button
                                  size="sm"
                                  disabled={action.disabled}
                                  onClick={action.handler}
                                  title={action.disabled ? action.disabledReason : action.label}
                                  aria-label={`Tindak lanjut: ${action.label} laporan ${inc.maintenanceTicket?.ticketId || inc.id}`}
                                  className={`font-semibold shadow-2xs ${
                                    action.disabled
                                      ? "bg-slate-100 text-slate-400 dark:bg-slate-800 dark:text-slate-500 border border-slate-200 dark:border-slate-700 cursor-not-allowed opacity-60"
                                      : "bg-[#1D5AA6] hover:bg-[#123B6D] text-white"
                                  }`}
                                >
                                  <action.icon className="w-3.5 h-3.5 mr-1" />
                                  {action.label}
                                </Button>
                              );
                            })()}
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => onSelectIncident(inc)}
                              aria-label={`Lihat detail laporan ${inc.maintenanceTicket?.ticketId || inc.id}`}
                              className="text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700"
                            >
                              <Eye className="w-3.5 h-3.5 mr-1 text-slate-500" />
                              Detail
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Desktop Pagination */}
            {totalPages > 1 && (
              <div className="px-4 py-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between bg-slate-50/50 dark:bg-slate-800/30">
                <div className="text-xs text-slate-500 dark:text-slate-400">
                  Menampilkan <span className="font-semibold text-slate-800 dark:text-slate-200">{(currentPage - 1) * pageSize + 1}</span>–
                  <span className="font-semibold text-slate-800 dark:text-slate-200">{Math.min(currentPage * pageSize, filteredIncidents.length)}</span> dari{" "}
                  <span className="font-semibold text-slate-800 dark:text-slate-200">{filteredIncidents.length}</span> laporan
                </div>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    disabled={currentPage === 1}
                    onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                    aria-label="Halaman sebelumnya"
                    className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-50 dark:hover:bg-slate-700"
                  >
                    <ChevronLeft className="w-3.5 h-3.5" />
                    Sebelumnya
                  </button>
                  <span className="text-xs text-slate-500 px-2">
                    {currentPage} / {totalPages}
                  </span>
                  <button
                    type="button"
                    disabled={currentPage === totalPages}
                    onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                    aria-label="Halaman berikutnya"
                    className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-50 dark:hover:bg-slate-700"
                  >
                    Berikutnya
                    <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* MOBILE CARD VIEW */}
          <div className="md:hidden space-y-3">
            {paginatedIncidents.map((inc) => {
              const handlingStatus = getOperationalHandlingStatus(inc);
              const formattedDate = formatIndonesianDate(inc.date || inc.createdAt);
              const disasterLabel = DISASTER_ID_MAP[inc.disasterType?.toLowerCase()] || inc.disasterType;
              const displayCity =
                inc.locationCity && inc.locationCity !== "Unknown"
                  ? inc.locationCity
                  : inc.branch || "Area Toko";

              const isDc = inc.locationKind === "FACILITY" || inc.tkpType === "dc";
              const isBuilding = inc.tkpType === "building";

              return (
                <div
                  key={inc.id}
                  className="bg-white dark:bg-slate-900 p-3.5 rounded-xl border border-slate-200/90 dark:border-slate-800 shadow-2xs flex flex-col gap-2.5"
                >
                  {/* Top Bar: Ticket ID, Date & Status */}
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="font-mono text-[11px] font-bold text-[#1D5AA6] dark:text-blue-400">
                        {inc.maintenanceTicket?.ticketId || inc.id}
                      </div>
                      <div className="text-[10px] text-slate-400 dark:text-slate-500 mt-0.5">
                        {formattedDate}
                      </div>
                    </div>
                    <span className={`px-2 py-0.5 rounded-full font-medium text-[10px] shrink-0 ${handlingStatus.cls}`}>
                      {handlingStatus.label}
                    </span>
                  </div>

                  {/* Incident & Unit Information */}
                  <div className="pt-1 border-t border-slate-100 dark:border-slate-800/80">
                    <div className="text-xs font-semibold text-slate-900 dark:text-white flex items-center gap-1.5 flex-wrap">
                      {isDc ? (
                        <span className="text-[9px] font-bold bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300 px-1.5 py-0.5 rounded border border-amber-200/80 dark:border-amber-800">
                          DC BES
                        </span>
                      ) : isBuilding ? (
                        <span className="text-[9px] font-bold bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300 px-1.5 py-0.5 rounded border border-slate-200 dark:border-slate-700">
                          Gedung
                        </span>
                      ) : null}
                      <span>{inc.storeName}</span>
                    </div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 flex items-center gap-1.5 flex-wrap">
                      <span>{inc.branch} • {displayCity}</span>
                      <span>-</span>
                      <span className="font-medium text-slate-700 dark:text-slate-300">{disasterLabel}</span>
                      {getOriginBadge(inc)}
                    </div>
                  </div>

                  {/* Action Button: Consistent Detail Button & Tindak Lanjut */}
                  <div className="pt-2 border-t border-slate-100 dark:border-slate-800/80 flex items-center justify-end gap-2">
                    {(() => {
                      const action = getContextualAction(inc);
                      if (!action) return null;
                      return (
                        <Button
                          size="sm"
                          disabled={action.disabled}
                          onClick={action.handler}
                          title={action.disabled ? action.disabledReason : action.label}
                          aria-label={`Tindak lanjut: ${action.label} laporan ${inc.maintenanceTicket?.ticketId || inc.id}`}
                          className={`min-h-[44px] px-3.5 font-semibold shadow-2xs ${
                            action.disabled
                              ? "bg-slate-100 text-slate-400 dark:bg-slate-800 dark:text-slate-500 border border-slate-200 dark:border-slate-700 cursor-not-allowed opacity-60"
                              : "bg-[#1D5AA6] hover:bg-[#123B6D] text-white"
                          }`}
                        >
                          <action.icon className="w-3.5 h-3.5 mr-1.5" />
                          {action.label}
                        </Button>
                      );
                    })()}
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => onSelectIncident(inc)}
                      aria-label={`Lihat detail laporan ${inc.maintenanceTicket?.ticketId || inc.id}`}
                      className="min-h-[44px] px-3.5 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700"
                    >
                      <Eye className="w-3.5 h-3.5 mr-1.5 text-slate-500" />
                      Detail
                    </Button>
                  </div>
                </div>
              );
            })}

            {/* Mobile Pagination */}
            {totalPages > 1 && (
              <div className="p-3 bg-white dark:bg-slate-900 rounded-xl border border-slate-200/90 dark:border-slate-800 flex items-center justify-between shadow-2xs">
                <span className="text-xs text-slate-500 dark:text-slate-400">
                  Hal. {currentPage} dari {totalPages} ({filteredIncidents.length} total)
                </span>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    disabled={currentPage === 1}
                    onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                    aria-label="Halaman sebelumnya"
                    className="p-1.5 text-xs font-medium rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-50 dark:hover:bg-slate-700 min-h-[36px] min-w-[36px] flex items-center justify-center"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    disabled={currentPage === totalPages}
                    onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                    aria-label="Halaman berikutnya"
                    className="p-1.5 text-xs font-medium rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-50 dark:hover:bg-slate-700 min-h-[36px] min-w-[36px] flex items-center justify-center"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}
          </div>
        </>
      )}

        </>
      )}


      {/* Sub-modal: Update Progress */}
      <ProgressUpdateModal
        isOpen={selectedProgressReport !== null}
        onClose={() => setSelectedProgressReport(null)}
        incident={selectedProgressReport}
        latestProgress={selectedProgressReport?.progress || 0}
        onUpdated={onReportUpdated}
      />

      {/* Sub-modal: Store Verification / Inspection */}
      <StoreVerificationModal
        incident={selectedVerificationReport}
        activeRole={(identity?.role as RoleType | undefined) || undefined}
        isOpen={selectedVerificationReport !== null}
        onClose={() => setSelectedVerificationReport(null)}
        onConfirmVerification={async () => {
          setSelectedVerificationReport(null);
          if (onReportUpdated) {
            await onReportUpdated();
          }
        }}
      />

      {/* Sub-modal: Completion Review & Case Close */}
      <CompletionApprovalModal
        incident={selectedApprovalReport}
        isOpen={selectedApprovalReport !== null}
        onClose={() => setSelectedApprovalReport(null)}
        onUpdated={async () => {
          setSelectedApprovalReport(null);
          if (onReportUpdated) {
            await onReportUpdated();
          }
        }}
      />
    </div>
  );
}
