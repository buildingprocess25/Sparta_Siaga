"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import {
  X,
  Building,
  Store,
  MapPin,
  ShieldAlert,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Wrench,
  UserCheck,
  UserPlus,
  ExternalLink,
  ChevronRight,
  FileText,
  Activity,
  Layers,
  Sparkles,
} from "lucide-react";
import { Store as StoreType } from "@/types/store";

export type FacilityDetail = {
  id: string;
  code: string;
  name: string;
  facility_type: string;
  latitude: number;
  longitude: number;
  branch_id: string | null;
  operational_status: string;
  auto_report_enabled: boolean;
  mapping_verified_at: string | null;
};

interface LocationDetailPanelProps {
  location: StoreType | null;
  facility?: FacilityDetail | null;
  onClose: () => void;
  isMobile?: boolean;
  currentEarthquake?: {
    latitude: number;
    longitude: number;
    magnitude: number;
    title?: string;
  } | null;
  activeRole?: string;
}

export function LocationDetailPanel({
  location,
  facility,
  onClose,
  isMobile = false,
  currentEarthquake,
  activeRole,
}: LocationDetailPanelProps) {
  const [incidentInfo, setIncidentInfo] = useState<{
    id: string;
    status: string;
    progress: number;
    pic?: { name: string; nik?: string; role?: string } | null;
  } | null>(null);
  const [loadingIncident, setLoadingIncident] = useState(false);

  // Compute distance from current earthquake epicenter if available
  const distanceKm = React.useMemo(() => {
    if (!location || !currentEarthquake) return null;
    const lat1 = location.latitude;
    const lon1 = location.longitude;
    const lat2 = currentEarthquake.latitude;
    const lon2 = currentEarthquake.longitude;
    const R = 6371; // km
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLon = ((lon2 - lon1) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos((lat1 * Math.PI) / 180) *
        Math.cos((lat2 * Math.PI) / 180) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return Math.round(R * c * 10) / 10;
  }, [location, currentEarthquake]);

  const isFacility = Boolean(facility || location?.id?.startsWith("FACILITY:"));
  const locCode = facility?.code || location?.kode_toko || "-";
  const locName = facility?.name || location?.nama_toko || "Lokasi";
  const locType = facility?.facility_type
    ? facility.facility_type.replace(/_/g, " ")
    : "Toko Alfamart";
  const branchName = facility?.branch_id || location?.cabang || "Belum dipetakan";
  const isMapped = Boolean(facility?.mapping_verified_at || (!isFacility && location?.cabang));

  // Determine standardized operational terminology (antislop & SPARTA guidelines)
  const getTerminologyBadge = () => {
    if (!location) return null;

    if (location.visualStatus === "SELESAI" || location.operationalStatus === "RESOLVED") {
      return {
        label: "Selesai",
        sub: "Laporan penanganan telah ditutup (CLOSED)",
        bg: "bg-emerald-50 text-emerald-800 border-emerald-300 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800",
        icon: CheckCircle2,
      };
    }
    if (location.visualStatus === "DALAM_PENANGANAN") {
      return {
        label: "Dalam Penanganan",
        sub: "Proses perbaikan atau SPK sedang berjalan",
        bg: "bg-blue-50 text-blue-800 border-blue-300 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-800",
        icon: Wrench,
      };
    }
    if (location.visualStatus === "TERDAMPAK") {
      return {
        label: "Kerusakan Terkonfirmasi",
        sub: "Kerusakan fisik telah diverifikasi oleh petugas lapangan",
        bg: "bg-red-50 text-red-800 border-red-300 dark:bg-red-950/40 dark:text-red-300 dark:border-red-800",
        icon: ShieldAlert,
      };
    }
    if (location.status === "PRIORITY_MONITOR") {
      return {
        label: "Dalam Radius Evaluasi (V1)",
        sub: "Dalam radius evaluasi gempa (V1). Menunggu konfirmasi pemeriksaan fisik.",
        bg: "bg-amber-50 text-amber-800 border-amber-300 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800",
        icon: AlertTriangle,
      };
    }
    if (location.status === "MONITOR") {
      return {
        label: "Dalam Radius Pemantauan",
        sub: "Dalam area pemantauan operasional. Waspada potensi dampak gempa.",
        bg: "bg-yellow-50 text-yellow-800 border-yellow-300 dark:bg-yellow-950/40 dark:text-yellow-300 dark:border-yellow-800",
        icon: Clock,
      };
    }

    if (location.status === "UNASSESSED") {
      return {
        label: "Di Luar V1 (Belum Terkaji)",
        sub: "Di luar radius pencarian V1. Intensitas getaran belum terkaji (bukan konfirmasi aman).",
        bg: "bg-slate-50 text-slate-700 border-slate-300 dark:bg-slate-900/60 dark:text-slate-300 dark:border-slate-700",
        icon: Clock,
      };
    }

    return {
      label: "Normal",
      sub: "Kondisi normal; tidak terdeteksi gempa signifikan di wilayah gerai.",
      bg: "bg-slate-50 text-slate-700 border-slate-200 dark:bg-slate-800/60 dark:text-slate-300 dark:border-slate-700",
      icon: CheckCircle2,
    };
  };

  const termBadge = getTerminologyBadge();

  if (!location) return null;

  return (
    <>
      {isMobile && (
        <div
          className="fixed inset-0 bg-slate-950/40 backdrop-blur-xs z-[1190] transition-opacity"
          onClick={onClose}
          aria-hidden="true"
        />
      )}
      <aside
        onTouchStart={(e) => e.stopPropagation()}
        onTouchMove={(e) => e.stopPropagation()}
        onWheel={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
        className={`bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 shadow-2xl z-[1200] flex flex-col transition-all duration-300 ${
          isMobile
            ? "fixed inset-x-0 bottom-0 max-h-[82vh] rounded-t-2xl border-t pb-28 overflow-y-auto overscroll-y-contain animate-in slide-in-from-bottom duration-200"
            : "w-96 md:w-[400px] h-full border-l overflow-y-auto shrink-0"
        }`}
        aria-label="Panel Kontekstual Lokasi"
      >
        {/* Mobile drag handle */}
        {isMobile && (
          <div className="w-full flex justify-center pt-2.5 pb-1">
            <div className="w-12 h-1.5 rounded-full bg-slate-300 dark:bg-slate-700" />
          </div>
        )}

        {/* Header */}
        <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold tracking-wider uppercase bg-blue-50 text-blue-700 border border-blue-200 dark:bg-blue-950/60 dark:text-blue-300 dark:border-blue-800">
                {isFacility ? <Building className="w-3 h-3" /> : <Store className="w-3 h-3" />}
                {locType}
              </span>
              <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
                {locCode}
              </span>
            </div>
            <h2 className="text-base font-bold text-slate-900 dark:text-white truncate" title={locName}>
              {locName}
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 truncate">
              {location.alamat || (isFacility ? "Master Fasilitas Operasional" : "Jaringan Toko Alfamart")}
            </p>
          </div>

          <button
            onClick={onClose}
            className="p-2 rounded-xl text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors shrink-0 min-h-[44px] min-w-[44px] flex items-center justify-center"
            aria-label="Tutup panel detail"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

      <div className="p-4 space-y-4 flex-1">
        {/* Status Terminology Card */}
        {termBadge && (
          <div className={`p-3 rounded-xl border flex items-start gap-3 ${termBadge.bg}`}>
            <termBadge.icon className="w-5 h-5 shrink-0 mt-0.5" />
            <div className="min-w-0">
              <strong className="block text-xs font-bold uppercase tracking-wider">
                {termBadge.label}
              </strong>
              <p className="text-xs mt-0.5 opacity-90 leading-relaxed">
                {termBadge.sub}
              </p>
            </div>
          </div>
        )}

        {/* Earthquake Exposure (If inside radius) */}
        {distanceKm !== null && currentEarthquake && (
          <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/40 space-y-1.5 text-xs">
            <div className="flex items-center justify-between text-slate-600 dark:text-slate-400">
              <span className="flex items-center gap-1.5 font-medium">
                <Activity className="w-3.5 h-3.5 text-red-500" />
                Jarak dari Episentrum Gempa
              </span>
              <strong className="text-slate-900 dark:text-white font-mono">
                {distanceKm} km
              </strong>
            </div>
            <div className="flex items-center justify-between text-slate-600 dark:text-slate-400 pt-1 border-t border-slate-200/60 dark:border-slate-700/60">
              <span>Status Radius Evaluasi:</span>
              <span className="font-semibold text-slate-800 dark:text-slate-200">
                {location.status === "PRIORITY_MONITOR"
                  ? "Dalam Radius V1"
                  : location.status === "MONITOR"
                  ? "Area Pantau"
                  : location.status === "UNASSESSED"
                  ? "Di Luar V1 (Belum Terkaji)"
                  : "Di Luar Wilayah Gempa"}
              </span>
            </div>
          </div>
        )}

        {/* Location Metadata Grid */}
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="p-2.5 rounded-lg border border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50">
            <span className="text-[11px] text-slate-500 dark:text-slate-400 block mb-0.5">
              Cabang Pengelola
            </span>
            <strong className={`block truncate ${isMapped ? "text-slate-900 dark:text-white" : "text-amber-600 dark:text-amber-400"}`}>
              {branchName}
            </strong>
          </div>
          <div className="p-2.5 rounded-lg border border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50">
            <span className="text-[11px] text-slate-500 dark:text-slate-400 block mb-0.5">
              Status Koordinat
            </span>
            <span className="font-mono text-slate-700 dark:text-slate-300 block truncate">
              {location.latitude.toFixed(4)}, {location.longitude.toFixed(4)}
            </span>
          </div>
        </div>

        {/* Facility Specific Verification State */}
        {isFacility && (
          <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30 text-xs space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-slate-500 dark:text-slate-400">Verifikasi Cabang:</span>
              <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                facility?.mapping_verified_at
                  ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
                  : "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300"
              }`}>
                {facility?.mapping_verified_at ? "Terverifikasi" : "Belum Dipetakan"}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-500 dark:text-slate-400">Auto-Report Bencana:</span>
              <span className={`font-semibold ${facility?.auto_report_enabled ? "text-emerald-600" : "text-slate-500"}`}>
                {facility?.auto_report_enabled ? "Aktif" : "Nonaktif"}
              </span>
            </div>
          </div>
        )}

        {/* Action Button: Create Report or View Reports */}
        <div className="pt-2 flex flex-col gap-2">
          <Link
            href={`/reports?store=${encodeURIComponent(locCode)}`}
            className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg bg-blue-700 hover:bg-blue-800 text-white font-semibold text-xs transition-colors shadow-sm min-h-[44px]"
          >
            <FileText className="w-4 h-4" />
            <span>Lihat Riwayat & Laporan Lokasi Ini</span>
          </Link>

          <Link
            href={`/reports/shared-queue`}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-800 dark:text-slate-200 font-semibold text-xs transition-colors min-h-[44px]"
          >
            <UserCheck className="w-4 h-4 text-blue-600" />
            <span>Periksa Penugasan Cabang</span>
          </Link>
        </div>
      </div>
    </aside>
  </>
);
}
