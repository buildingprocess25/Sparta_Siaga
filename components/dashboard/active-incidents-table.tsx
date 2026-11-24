"use client";

import React, { useState, useMemo } from "react";
import {
  Plus,
  Flame,
  UserX,
  Activity,
  Waves,
  Wind,
  Eye,
  Filter,
  Trash2,
  Pencil,
} from "lucide-react";
import { toast } from "sonner";
import { IncidentRecord, DisasterType, IncidentStatus } from "@/types/incident";
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

interface ActiveIncidentsTableProps {
  incidents: IncidentRecord[];
  onSelectIncident: (incident: IncidentRecord) => void;
  onCreateReportClick: () => void;
  onDeleteIncident?: (id: string) => void;
  hideAction?: boolean;
  currentUser?: {
    id?: string;
    name?: string;
    role?: string;
    businessRole?: string;
    systemRole?: string;
    scope?: string;
    branch?: string;
  } | null;
  onClaimSuccess?: () => void;
}

export function ActiveIncidentsTable({
  incidents,
  onSelectIncident,
  onCreateReportClick,
  onDeleteIncident,
  hideAction = false,
  currentUser,
  onClaimSuccess,
}: ActiveIncidentsTableProps) {
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [filterType, setFilterType] = useState<DisasterType | "all">("all");
  const [filterStatus, setFilterStatus] = useState<IncidentStatus | "all">("all");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [filterBranch, setFilterBranch] = useState("all");
  const [claimingId, setClaimingId] = useState<string | null>(null);

  const availableBranches = useMemo(() => {
    const map = new Map<string, { value: string; label: string }>();
    incidents.forEach((i) => {
      const code = i.branchCode?.trim() || "";
      const name = i.branch?.trim() || "";
      const value = code || name;
      if (!value) return;
      const key = value.toUpperCase();
      if (!map.has(key)) {
        const label = code && name && code.toUpperCase() !== name.toUpperCase() ? `${name} (${code})` : name || code;
        map.set(key, { value, label });
      }
    });
    return Array.from(map.values()).sort((a, b) => a.label.localeCompare(b.label));
  }, [incidents]);

  const isHO = currentUser?.scope === "HO" && currentUser?.systemRole !== "ADMIN";
  const userRoleStr = (currentUser?.businessRole || currentUser?.role || "").toLowerCase();
  const isBMM = !isHO && currentUser?.systemRole !== "ADMIN" && userRoleStr === "bm";
  const canClaim = !isHO && (currentUser?.systemRole === "ADMIN" || ["bms", "bes"].includes(userRoleStr));

  const handleClaim = async (incId: string) => {
    setClaimingId(incId);
    try {
      const res = await fetch(`/api/incidents/${incId}/pic`, { method: "POST" });
      const data = await res.json();
      if (res.ok && data.claimed) {
        toast.success("Berhasil mengambil tugas. Anda telah ditugaskan sebagai PIC penanggung jawab.");
        onClaimSuccess?.();
      } else if (res.status === 409) {
        toast.error("Laporan sudah diambil oleh petugas lain.");
      } else {
        toast.error(data.error || "Gagal mengambil tugas laporan.");
      }
    } catch {
      toast.error("Gagal terhubung ke server.");
    } finally {
      setClaimingId(null);
    }
  };

  const filteredIncidents = useMemo(() => {
    return incidents.filter((inc) => {
      // Type Filter
      const matchType = filterType === "all" || inc.disasterType === filterType;
      
      // Status Filter
      const matchStatus = filterStatus === "all" || inc.status === filterStatus;
      
      // Date Filter
      let matchDate = true;
      if (startDate || endDate) {
        const incDateStr = inc.date; // e.g. "1 Sep 2026"
        const incDate = new Date(incDateStr);
        if (!isNaN(incDate.getTime())) {
          incDate.setHours(0, 0, 0, 0);

          if (startDate) {
            const sDate = new Date(startDate);
            sDate.setHours(0, 0, 0, 0);
            if (incDate < sDate) matchDate = false;
          }

          if (endDate) {
            const eDate = new Date(endDate);
            eDate.setHours(23, 59, 59, 999);
            if (incDate > eDate) matchDate = false;
          }
        }
      }

      const matchBranch =
        filterBranch === "all" ||
        (Boolean(inc.branchCode) && inc.branchCode!.toLowerCase() === filterBranch.toLowerCase()) ||
        inc.branch?.toLowerCase() === filterBranch.toLowerCase();

      return matchType && matchStatus && matchDate && matchBranch;
    });
  }, [incidents, filterType, filterStatus, startDate, endDate, filterBranch]);

  const getDisasterBadge = (type: DisasterType | string) => {
    switch (type) {
      case "flood":
        return { label: "Banjir", icon: Waves, color: "bg-blue-50 text-blue-700 border-blue-200" };
      case "theft":
        return { label: "Kemalingan", icon: UserX, color: "bg-slate-100 text-slate-800 border-slate-200" };
      case "fire":
        return { label: "Kebakaran", icon: Flame, color: "bg-red-50 text-red-700 border-red-200" };
      case "earthquake":
        return { label: "Gempa Bumi", icon: Activity, color: "bg-amber-50 text-amber-800 border-amber-200" };
      case "strong_wind":
        return { label: "Angin Kencang", icon: Wind, color: "bg-cyan-50 text-cyan-700 border-cyan-200" };
      case "heavy_rain":
        return { label: "Hujan/Badai", icon: Waves, color: "bg-indigo-50 text-indigo-700 border-indigo-200" };
      case "severe_building_damage":
        return { label: "Bangunan Rusak", icon: Pencil, color: "bg-orange-50 text-orange-700 border-orange-200" };
      case "tornado":
        return { label: "Puting Beliung", icon: Wind, color: "bg-teal-50 text-teal-700 border-teal-200" };
      case "landslide":
        return { label: "Tanah Longsor", icon: Pencil, color: "bg-amber-50 text-amber-900 border-amber-300" };
      case "riot":
        return { label: "Huru-Hara", icon: UserX, color: "bg-rose-50 text-rose-800 border-rose-200" };
      default:
        return { label: "Lainnya", icon: Pencil, color: "bg-slate-50 text-slate-600 border-slate-200" };
    }
  };

  const formatIndonesianDate = (dateStr?: string | null): string => {
    if (!dateStr) return "—";
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    return d.toLocaleDateString("id-ID", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  };

  const getOriginBadge = (inc: IncidentRecord) => {
    const source = getReportSourceInfo(inc.reportOrigin);
    return (
      <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-medium tracking-tight ${source.badgeCls}`}>
        {source.longLabel}
      </span>
    );
  };

  const getHandlingStatus = (inc: IncidentRecord) => {
    return getStandardizedOperationalStatus(inc);
  };

  const getProgressBarColor = (progress: number) => {
    if (progress >= 100) return "bg-[#16A34A]"; // Success green
    if (progress >= 60) return "bg-[#1D5AA6]";  // Action blue
    if (progress >= 40) return "bg-[#F59E0B]";  // Warning amber
    return "bg-[#DC2626]/80"; // Critical red
  };

  return (
    <div className="bg-white dark:bg-slate-900 rounded-[20px] shadow-sm overflow-hidden transition-colors border border-slate-200 dark:border-slate-800">
      {/* Table Header with Title & Action Button */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 dark:border-slate-800">
        <div>
          <h3 className="font-bold text-slate-900 dark:text-white text-sm">Daftar Kejadian Terbaru</h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Daftar insiden aktif yang sedang dalam penanganan di seluruh gerai toko
          </p>
        </div>
        <div className="relative">
          <button
            onClick={() => setIsFilterOpen(!isFilterOpen)}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold transition-all ${
              filterType !== "all" || filterStatus !== "all" || startDate || endDate
                ? "bg-[#EAF2FB] dark:bg-blue-900/30 text-[#1D5AA6] dark:text-blue-400"
                : "bg-slate-50 dark:bg-slate-950 hover:bg-slate-100 dark:hover:bg-slate-900 text-slate-600 dark:text-slate-300"
            }`}
          >
            <Filter className="w-3.5 h-3.5" />
            <span>Filter {(filterType !== "all" || filterStatus !== "all" || startDate || endDate) && "(Aktif)"}</span>
          </button>

          {isFilterOpen && (
            <div className="absolute right-0 mt-2 w-72 p-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-xl z-50">
              <div className="space-y-3">
                <div>
                  <label className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1.5 block">
                    Rentang Waktu
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="relative">
                      <span className="absolute -top-2 left-2 bg-white dark:bg-slate-900 px-1 text-[9px] text-slate-400">Dari</span>
                      <input
                        type="date"
                        value={startDate}
                        onChange={(e) => setStartDate(e.target.value)}
                        className="w-full text-xs p-2 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100 focus:outline-none focus:border-blue-500"
                      />
                    </div>
                    <div className="relative">
                      <span className="absolute -top-2 left-2 bg-white dark:bg-slate-900 px-1 text-[9px] text-slate-400">Sampai</span>
                      <input
                        type="date"
                        value={endDate}
                        onChange={(e) => setEndDate(e.target.value)}
                        className="w-full text-xs p-2 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100 focus:outline-none focus:border-blue-500"
                      />
                    </div>
                  </div>
                  {(startDate || endDate) && (
                    <button 
                      onClick={() => { setStartDate(""); setEndDate(""); }}
                      className="text-[10px] text-red-500 hover:text-red-600 mt-2 font-medium flex items-center justify-end w-full"
                    >
                      Reset Tanggal
                    </button>
                  )}
                </div>

                <div>
                  <label className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1.5 block">
                    Jenis Kejadian
                  </label>
                  <Select
                    value={filterType}
                    onValueChange={(val) => {
                      if (val) setFilterType(val as DisasterType | "all");
                    }}
                  >
                    <SelectTrigger
                      aria-label="Filter jenis kejadian"
                      className="w-full h-8 text-xs bg-slate-50 dark:bg-slate-950 border-slate-200 dark:border-slate-800"
                    >
                      <SelectValue placeholder="Semua Jenis" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Semua Jenis</SelectItem>
                      <SelectItem value="earthquake">Gempa Bumi</SelectItem>
                      <SelectItem value="flood">Banjir</SelectItem>
                      <SelectItem value="other">Lainnya</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                
                <div>
                  <label className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1.5 block">
                    Status Penanganan
                  </label>
                  <Select
                    value={filterStatus}
                    onValueChange={(val) => {
                      if (val) setFilterStatus(val as IncidentStatus | "all");
                    }}
                  >
                    <SelectTrigger
                      aria-label="Filter status penanganan"
                      className="w-full h-8 text-xs bg-slate-50 dark:bg-slate-950 border-slate-200 dark:border-slate-800"
                    >
                      <SelectValue placeholder="Semua Status" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Semua Status</SelectItem>
                      <SelectItem value="verifying">Verifikasi</SelectItem>
                      <SelectItem value="investigating">Investigasi</SelectItem>
                      <SelectItem value="in_maintenance">Dalam Penanganan</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <label className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1.5 block">
                    Cabang
                  </label>
                  <Select
                    value={filterBranch}
                    onValueChange={(val) => {
                      if (val) setFilterBranch(val);
                    }}
                  >
                    <SelectTrigger
                      aria-label="Filter cabang"
                      className="w-full h-8 text-xs bg-slate-50 dark:bg-slate-950 border-slate-200 dark:border-slate-800"
                    >
                      <SelectValue placeholder="Semua Cabang" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Semua Cabang</SelectItem>
                      {availableBranches.map((b) => (
                        <SelectItem key={b.value} value={b.value}>
                          {b.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* DESKTOP TABLE VIEW */}
      <div className="hidden md:block overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="bg-slate-50/80 dark:bg-slate-800/60 text-slate-500 dark:text-slate-400 font-semibold uppercase tracking-wider text-[10px] border-b border-slate-200 dark:border-slate-700">
            <tr>
              <th className="px-4 py-3 whitespace-nowrap">No. Laporan & Tanggal</th>
              <th className="px-4 py-3">Lokasi Unit & Cabang</th>
              <th className="px-4 py-3">Kejadian & Sumber</th>
              <th className="px-4 py-3">Status Penanganan</th>
              {!hideAction && (
                <th className="px-4 py-3 text-right">Aksi</th>
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70 text-slate-700 dark:text-slate-300">
            {filteredIncidents.length === 0 ? (
              <tr>
                <td colSpan={hideAction ? 4 : 5} className="py-8 text-center text-slate-400">
                  Tidak ada kejadian aktif yang sesuai dengan filter Anda.
                </td>
              </tr>
            ) : (
              filteredIncidents.map((inc) => {
                const disaster = getDisasterBadge(inc.disasterType);
                const handling = getHandlingStatus(inc);
                const Icon = disaster.icon;
                const hasPic = Boolean(inc.primaryPicUserId);

                return (
                  <tr key={inc.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition-colors">
                    <td className="px-4 py-3.5 whitespace-nowrap">
                      <div className="font-mono font-bold text-[#1D5AA6] dark:text-blue-400">
                        {inc.maintenanceTicket?.ticketId || inc.id}
                      </div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                        {formatIndonesianDate(inc.date || inc.createdAt)}
                      </div>
                    </td>
                    <td className="px-4 py-3.5 whitespace-nowrap">
                      <div className="font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                        {inc.locationKind === "FACILITY" && (
                          <span className="text-[9px] font-extrabold bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300 px-1 py-0.5 rounded">
                            DC
                          </span>
                        )}
                        <span className="text-[9px] font-bold bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300 px-1.5 py-0.5 rounded border border-slate-200 dark:border-slate-700">
                          {inc.locationKind === "FACILITY" || inc.tkpType === "dc" ? "Tim BES" : "Tim BMS"}
                        </span>
                        <span>{inc.storeName}</span>
                      </div>
                      <div className="text-[10px] text-slate-500 mt-0.5">{inc.branch} • {inc.locationCity}</div>
                    </td>
                    <td className="px-4 py-3.5 whitespace-nowrap">
                      <div className="flex flex-col gap-1 items-start">
                        <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-[11px] font-medium ${disaster.color}`}>
                          <Icon className="w-3 h-3 shrink-0" />
                          <span>{disaster.label}</span>
                        </span>
                        {getOriginBadge(inc)}
                      </div>
                    </td>
                    <td className="px-4 py-3.5 whitespace-nowrap">
                      <span className={`inline-block px-2.5 py-0.5 rounded-full text-[11px] font-semibold ${handling.color}`}>
                        {handling.label}
                      </span>
                    </td>
                    {!hideAction && (
                      <td className="px-4 py-3.5 whitespace-nowrap text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          {!hasPic && canClaim && !isHO && (
                            <Button
                              size="sm"
                              onClick={() => handleClaim(inc.id)}
                              disabled={claimingId === inc.id}
                              className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold shadow-xs text-[11px]"
                            >
                              {claimingId === inc.id ? "Memproses..." : "Mulai Menangani"}
                            </Button>
                          )}
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => onSelectIncident(inc)}
                            className="text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700 text-[11px]"
                          >
                            <Eye className="w-3.5 h-3.5 mr-1" />
                            <span>{isBMM && (inc.status === "pending_bm_approval" || inc.status === "pending_final_approval") ? "Review & Approval" : "Detail"}</span>
                          </Button>
                          {onDeleteIncident && (
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              onClick={() => {
                                if (confirm(`Hapus laporan ${inc.id} (${inc.storeName})? Tindakan ini tidak dapat dibatalkan.`)) {
                                  onDeleteIncident(inc.id);
                                }
                              }}
                              className="text-red-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30"
                              title="Hapus Laporan"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </Button>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* MOBILE CARD LIST VIEW (antislop-layoutmobile: adaptive, zero horizontal scroll) */}
      <div className="md:hidden space-y-2.5 p-3">
        {filteredIncidents.length === 0 ? (
          <div className="py-8 text-center text-xs text-slate-400">
            Tidak ada kejadian aktif yang sesuai dengan filter Anda.
          </div>
        ) : (
          filteredIncidents.map((inc) => {
            const disaster = getDisasterBadge(inc.disasterType);
            const handling = getHandlingStatus(inc);
            const Icon = disaster.icon;
            const hasPic = Boolean(inc.primaryPicUserId);

            return (
              <div
                key={inc.id}
                className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-xl p-3.5 shadow-xs space-y-2.5"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="font-mono text-[10px] font-bold text-blue-600 dark:text-blue-400 mb-0.5">
                      {inc.maintenanceTicket?.ticketId || inc.id}
                    </div>
                    <div className="font-bold text-xs text-slate-900 dark:text-white truncate flex items-center gap-1.5">
                      {inc.locationKind === "FACILITY" && (
                        <span className="text-[9px] font-extrabold bg-emerald-100 text-emerald-800 px-1 py-0.5 rounded">
                          DC
                        </span>
                      )}
                      <span className="text-[9px] font-bold bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300 px-1 py-0.5 rounded">
                        {inc.locationKind === "FACILITY" || inc.tkpType === "dc" ? "BES" : "BMS"}
                      </span>
                      <span className="truncate">{inc.storeName}</span>
                    </div>
                    <div className="text-[11px] text-slate-500 truncate">
                      {inc.locationCity} • {inc.branch}
                    </div>
                    <div className="mt-1 flex items-center gap-1.5 flex-wrap">
                      <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full border text-[10px] font-medium ${disaster.color}`}>
                        <Icon className="w-2.5 h-2.5 shrink-0" />
                        <span>{disaster.label}</span>
                      </span>
                      {getOriginBadge(inc)}
                      <span className="text-[10px] text-slate-400">
                        {formatIndonesianDate(inc.date || inc.createdAt)}
                      </span>
                    </div>
                  </div>
                  <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold shrink-0 ${handling.color}`}>
                    {handling.label}
                  </span>
                </div>

                {/* Mobile Action Buttons */}
                <div className="pt-2 border-t border-slate-100 dark:border-slate-800 flex items-center justify-end gap-2">
                  {!hasPic && canClaim && !isHO && (
                    <Button
                      size="sm"
                      onClick={() => handleClaim(inc.id)}
                      disabled={claimingId === inc.id}
                      className="px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold transition-colors min-h-[44px] shadow-xs disabled:opacity-50"
                    >
                      <span>{claimingId === inc.id ? "..." : "Mulai Menangani"}</span>
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => onSelectIncident(inc)}
                    className="inline-flex items-center justify-center gap-1.5 px-3 py-2 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-lg text-xs font-semibold transition-colors min-h-[44px] flex-1 border-slate-200 dark:border-slate-700"
                  >
                    <Eye className="w-3.5 h-3.5" />
                    <span>{isBMM && (inc.status === "pending_bm_approval" || inc.status === "pending_final_approval") ? "Review & Approval" : "Lihat Detail"}</span>
                  </Button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

