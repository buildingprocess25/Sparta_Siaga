"use client";

import React from "react";
import {
  X,
  Flame,
  CloudRain,
  MapPin,
  Building,
  Info,
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Layers,
} from "lucide-react";
import { NotificationLog } from "@/types/notification";
import { cleanDisplayTitle, cleanDisplayText } from "@/lib/display-formatters";

interface IncidentDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  incident: NotificationLog | null;
  onFlyToIncident?: (incident: NotificationLog) => void;
  onFlyToLocation?: (loc: {
    kode_toko?: string;
    nama_toko?: string;
    cabang?: string;
    latitude?: number;
    longitude?: number;
    isFacility?: boolean;
  }) => void;
  onOpenReport?: (report: any) => void;
  relatedReport?: any;
  theme?: "dark" | "light";
}

export function IncidentDetailModal({
  isOpen,
  onClose,
  incident,
  onFlyToIncident,
  onFlyToLocation,
  theme = "dark",
}: IncidentDetailModalProps) {
  const [currentPage, setCurrentPage] = React.useState(1);

  React.useEffect(() => {
    setCurrentPage(1);
  }, [incident?.id]);

  if (!isOpen || !incident) return null;

  const isDark = theme === "dark";
  const isEarthquake = incident.disaster_type === "earthquake";
  const stores = incident.affected_stores_sample || [];
  const totalStores = incident.affected_stores_count || stores.length;

  const pageSize = 10;
  const totalPages = Math.max(1, Math.ceil(stores.length / pageSize));
  const paginatedStores = stores.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  const displayTitle = cleanDisplayTitle(incident.title);
  const displayMessage = cleanDisplayText(incident.message);

  const formattedDateTime = incident.sent_at
    ? new Date(incident.sent_at).toLocaleDateString("id-ID", {
        day: "numeric",
        month: "short",
        year: "numeric",
      }) +
      " • " +
      new Date(incident.sent_at).toLocaleTimeString("id-ID", {
        hour: "2-digit",
        minute: "2-digit",
      }) +
      " WIB"
    : "Baru saja";

  const handleFlyToMapAll = () => {
    onClose();
    if (onFlyToIncident) {
      onFlyToIncident(incident);
    }
  };

  const handleFlyToSingleLocation = (loc: {
    kode_toko?: string;
    nama_toko?: string;
    cabang?: string;
    latitude?: number;
    longitude?: number;
    isFacility?: boolean;
  }) => {
    onClose();
    if (onFlyToLocation) {
      onFlyToLocation(loc);
    }
  };

  return (
    <div className="fixed inset-0 z-[850] bg-black/60 backdrop-blur-sm flex flex-col justify-end sm:items-center sm:justify-center p-0 sm:p-5 animate-in fade-in duration-200">
      <div
        className={`w-full max-w-3xl flex flex-col overflow-hidden transition-colors ${
          isDark
            ? "bg-slate-900 border-slate-800 text-slate-100"
            : "bg-white border-slate-200 text-slate-900"
        } rounded-t-2xl sm:rounded-2xl sm:border shadow-2xl h-[92vh] sm:h-auto sm:max-h-[88vh]`}
      >
        {/* Header Bar */}
        <div
          className={`px-5 py-4 flex items-start justify-between gap-4 border-b ${
            isDark ? "bg-slate-900/90 border-slate-800" : "bg-white border-slate-100"
          }`}
        >
          <div className="flex items-start gap-3 min-w-0">
            <div
              className={`p-2 rounded-xl mt-0.5 shrink-0 ${
                isEarthquake
                  ? "bg-red-50 text-red-600 dark:bg-red-950/40 dark:text-red-400"
                  : "bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-400"
              }`}
            >
              {isEarthquake ? <Flame className="w-5 h-5" /> : <CloudRain className="w-5 h-5" />}
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2 mb-1">
                <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-extrabold uppercase tracking-wider bg-red-600 text-white shadow-xs">
                  {isEarthquake ? "GEMPA BUMI • BMKG" : "PERINGATAN DINI CUACA"}
                </span>

                <span
                  className={`font-mono text-[11px] font-bold tracking-wider ${
                    isDark ? "text-slate-400" : "text-slate-500"
                  }`}
                >
                  {incident.ticket_number || "NOTIF-EARLY-ALERT"}
                </span>

                <span className="text-[11px] text-slate-400">·</span>

                <span className={`text-[11px] font-medium ${isDark ? "text-slate-400" : "text-slate-500"}`}>
                  {formattedDateTime}
                </span>
              </div>

              <h2 className={`text-base font-bold leading-snug ${isDark ? "text-white" : "text-slate-900"}`}>
                {displayTitle}
              </h2>
            </div>
          </div>

          <button
            onClick={onClose}
            className={`p-2 rounded-lg shrink-0 transition-colors ${
              isDark
                ? "text-slate-400 hover:text-white hover:bg-slate-800"
                : "text-slate-500 hover:text-slate-900 hover:bg-slate-100"
            }`}
            aria-label="Tutup Detail"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Scrollable Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">

          {/* Awareness Info Strip */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200/80 dark:border-slate-800 text-xs">
            <div>
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Jenis Kejadian</span>
              <span className="font-semibold text-slate-800 dark:text-slate-200 truncate block mt-0.5">
                {isEarthquake ? "Gempa Bumi (BMKG)" : "Cuaca Ekstrem / Banjir"}
              </span>
            </div>
            <div>
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Cabang Utama</span>
              <span className="font-semibold text-slate-800 dark:text-slate-200 truncate block mt-0.5">
                Cabang {incident.branch || "Nasional"}
              </span>
            </div>
            <div>
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Waktu Kejadian</span>
              <span className="font-medium text-slate-700 dark:text-slate-300 truncate block mt-0.5">
                {formattedDateTime}
              </span>
            </div>
            <div>
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Lokasi Zona Pantau</span>
              <span className="font-bold text-blue-600 dark:text-blue-400 truncate block mt-0.5">
                {totalStores} Toko & Fasilitas
              </span>
            </div>
          </div>

          {/* Affected Branch DC & Description */}
          <div className="p-4 rounded-xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900/50 space-y-2.5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2.5 border-b border-slate-100 dark:border-slate-800">
              <div className="flex items-center gap-2 text-sm font-bold text-slate-800 dark:text-slate-100">
                <Building className="w-4 h-4 text-emerald-600" />
                <span>Distribution Center (DC) Cabang {incident.branch}</span>
              </div>
              <button
                type="button"
                onClick={() =>
                  handleFlyToSingleLocation({
                    nama_toko: `DC ${incident.branch}`,
                    cabang: incident.branch,
                    isFacility: true,
                  })
                }
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-50 hover:bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:hover:bg-emerald-900/60 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 transition-colors w-fit"
              >
                <MapPin className="w-3.5 h-3.5" />
                <span>Lihat DC di Peta</span>
              </button>
            </div>
            <p className={`text-xs leading-relaxed ${isDark ? "text-slate-300" : "text-slate-600"}`}>
              {displayMessage}
            </p>
          </div>

          {/* Structured Affected Stores & DC Table */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className={`text-xs font-bold uppercase tracking-wider ${isDark ? "text-slate-400" : "text-slate-600"}`}>
                Daftar {stores.length > 0 ? stores.length : totalStores} Gerai & DC Terdampak
              </h3>
              <span className="text-[11px] text-slate-500">
                Prioritas zona pantau berbasis radius getaran BMKG
              </span>
            </div>

            <div
              className={`rounded-xl border overflow-hidden ${
                isDark ? "border-slate-800" : "border-slate-200"
              }`}
            >
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr
                      className={`border-b text-[11px] uppercase tracking-wider font-semibold ${
                        isDark
                          ? "bg-slate-950/70 border-slate-800 text-slate-400"
                          : "bg-slate-50 border-slate-200 text-slate-500"
                      }`}
                    >
                      <th className="py-2.5 px-3 text-center w-10">No</th>
                      <th className="py-2.5 px-3">Toko / Fasilitas</th>
                      <th className="py-2.5 px-3 text-center">Jarak Episentrum</th>
                      <th className="py-2.5 px-3 text-center">Status Pantau</th>
                      <th className="py-2.5 px-3 text-right">Aksi</th>
                    </tr>
                  </thead>
                  <tbody className={`divide-y ${isDark ? "divide-slate-800/80" : "divide-slate-100"}`}>
                    {paginatedStores.length > 0 ? (
                      paginatedStores.map((store, idx) => {
                        const isPriority = store.status === "PRIORITY_MONITOR";
                        const isDc =
                          store.fr_type === "dc" ||
                          store.nama_toko?.toUpperCase().includes("DC") ||
                          store.nama_toko?.toUpperCase().includes("WAREHOUSE");

                        const rowNumber = (currentPage - 1) * pageSize + idx + 1;

                        return (
                          <tr
                            key={store.kode_toko || rowNumber}
                            className={`transition-colors ${
                              isDark ? "hover:bg-slate-800/40" : "hover:bg-slate-50"
                            }`}
                          >
                            <td className="py-2.5 px-3 text-center text-slate-400 font-mono text-[11px]">
                              {rowNumber}
                            </td>
                            <td className="py-2.5 px-3">
                              <div className="font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-1.5 flex-wrap">
                                {isDc && (
                                  <span className="px-1 py-0.2 rounded text-[9px] font-extrabold bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                                    DC
                                  </span>
                                )}
                                <span className="font-mono text-blue-600 dark:text-blue-400">
                                  {store.kode_toko}
                                </span>
                                <span>{store.nama_toko}</span>
                              </div>
                              {store.alamat && (
                                <div className="text-[11px] text-slate-500 mt-0.5 line-clamp-1">
                                  {store.alamat}
                                </div>
                              )}
                            </td>
                            <td className="py-2.5 px-3 text-center font-mono font-medium text-slate-600 dark:text-slate-400">
                              {store.distance_km != null ? `${store.distance_km} km` : "-"}
                            </td>
                            <td className="py-2.5 px-3 text-center">
                              {isPriority ? (
                                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold text-red-700 bg-red-100 dark:bg-red-950/60 dark:text-red-300 border border-red-200 dark:border-red-800">
                                  PRIORITAS PANTAU
                                </span>
                              ) : (
                                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold text-amber-700 bg-amber-100 dark:bg-amber-950/60 dark:text-amber-300 border border-amber-200 dark:border-amber-800">
                                  ZONA WASPADA
                                </span>
                              )}
                            </td>
                            <td className="py-2.5 px-3 text-right">
                              <button
                                type="button"
                                onClick={() =>
                                  handleFlyToSingleLocation({
                                    kode_toko: store.kode_toko,
                                    nama_toko: store.nama_toko,
                                    cabang: store.cabang || incident.branch,
                                    latitude: store.latitude,
                                    longitude: store.longitude,
                                    isFacility: isDc,
                                  })
                                }
                                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-medium bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 transition-colors"
                              >
                                <MapPin className="w-3 h-3 text-[#1D5AA6]" />
                                <span>Lihat di Peta</span>
                              </button>
                            </td>
                          </tr>
                        );
                      })
                    ) : (
                      <tr>
                        <td
                          colSpan={5}
                          className="py-8 text-center text-xs text-slate-400 italic"
                        >
                          Daftar gerai terdampak sedang dalam proses kalkulasi radius atau tidak ada data gerai spesifik.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {/* Pagination Bar (10 stores per page) */}
              {stores.length > 0 && (
                <div
                  className={`px-4 py-2.5 flex items-center justify-between border-t text-xs ${
                    isDark
                      ? "bg-slate-950/50 border-slate-800 text-slate-400"
                      : "bg-slate-50/80 border-slate-200 text-slate-600"
                  }`}
                >
                  <span className="text-[11px]">
                    Menampilkan {Math.min((currentPage - 1) * pageSize + 1, stores.length)} -{" "}
                    {Math.min(currentPage * pageSize, stores.length)} dari {stores.length} gerai (10 per halaman)
                  </span>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      disabled={currentPage <= 1}
                      onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                      className={`p-1.5 rounded border flex items-center gap-1 text-[11px] font-medium transition-colors ${
                        currentPage <= 1
                          ? "opacity-40 cursor-not-allowed border-transparent"
                          : isDark
                          ? "border-slate-700 hover:bg-slate-800 text-slate-200"
                          : "border-slate-300 hover:bg-white text-slate-700"
                      }`}
                    >
                      <ChevronLeft className="w-3.5 h-3.5" />
                      <span>Sebelumnya</span>
                    </button>

                    <span className="font-mono text-[11px] px-2 font-semibold">
                      {currentPage} / {totalPages}
                    </span>

                    <button
                      type="button"
                      disabled={currentPage >= totalPages}
                      onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                      className={`p-1.5 rounded border flex items-center gap-1 text-[11px] font-medium transition-colors ${
                        currentPage >= totalPages
                          ? "opacity-40 cursor-not-allowed border-transparent"
                          : isDark
                          ? "border-slate-700 hover:bg-slate-800 text-slate-200"
                          : "border-slate-300 hover:bg-white text-slate-700"
                      }`}
                    >
                      <span>Berikutnya</span>
                      <ChevronRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Footer (Awareness Only: Pure Navigation, No Operational Mutations) */}
        <div
          className={`p-4 sm:px-5 sm:py-3.5 flex flex-col sm:flex-row items-center justify-between gap-3 border-t ${
            isDark ? "bg-slate-900/90 border-slate-800" : "bg-white border-slate-100"
          }`}
        >
          <div className="flex items-center gap-2 text-[11px] text-slate-500">
            <Info className="w-4 h-4 text-blue-500 shrink-0" />
            <span>
              Pusat notifikasi berfungsi sebagai <strong>deteksi dini (awareness)</strong>. Tindak lanjut operasional penanganan fisik dilakukan melalui menu Laporan.
            </span>
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto shrink-0">
            <button
              type="button"
              onClick={handleFlyToMapAll}
              className="flex-1 sm:flex-none inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold bg-[#1D5AA6] hover:bg-[#164684] text-white transition-colors shadow-xs"
            >
              <Layers className="w-3.5 h-3.5" />
              <span>Lihat Seluruh Area di Peta</span>
            </button>

            <button
              type="button"
              onClick={onClose}
              className={`flex-1 sm:flex-none px-4 py-2 rounded-xl text-xs font-semibold transition-colors border ${
                isDark
                  ? "bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700"
                  : "bg-slate-100 hover:bg-slate-200 text-slate-700 border-slate-200"
              }`}
            >
              Tutup
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
