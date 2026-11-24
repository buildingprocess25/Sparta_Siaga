"use client";

import React, { useState, useMemo } from "react";
import {
  X,
  Search,
  Building,
  Store as StoreIcon,
  MapPin,
  ChevronRight,
  AlertTriangle,
  CheckCircle2,
  Filter,
} from "lucide-react";
import type { Store } from "@/types/store";
import type { FacilityDetail } from "./location-detail-panel";

interface LocationListSheetProps {
  isOpen: boolean;
  onClose: () => void;
  locations: Store[];
  onSelectLocation: (loc: Store) => void;
  selectedLocationId?: string | null;
  mapMode: "event" | "location";
  theme?: "dark" | "light";
}

export function LocationListSheet({
  isOpen,
  onClose,
  locations,
  onSelectLocation,
  selectedLocationId,
  mapMode,
  theme = "light",
}: LocationListSheetProps) {
  const [query, setQuery] = useState("");
  const [filterType, setFilterType] = useState<"ALL" | "STORE" | "FACILITY" | "PRIORITY">("ALL");

  const isDark = theme === "dark";

  const filtered = useMemo(() => {
    let result = locations;

    if (filterType === "STORE") {
      result = result.filter((l) => !l.id.startsWith("FACILITY:"));
    } else if (filterType === "FACILITY") {
      result = result.filter((l) => l.id.startsWith("FACILITY:"));
    } else if (filterType === "PRIORITY") {
      result = result.filter(
        (l) => l.status === "PRIORITY_MONITOR" || l.visualStatus === "TERDAMPAK" || l.visualStatus === "PERLU_PERHATIAN"
      );
    }

    if (query.trim()) {
      const q = query.toLowerCase().trim();
      result = result.filter(
        (l) =>
          l.kode_toko.toLowerCase().includes(q) ||
          l.nama_toko.toLowerCase().includes(q) ||
          (l.cabang && l.cabang.toLowerCase().includes(q))
      );
    }

    return result;
  }, [locations, filterType, query]);

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="location-list-sheet-title"
      className="fixed inset-0 z-[2500] flex items-end sm:items-center sm:justify-center bg-slate-950/60 backdrop-blur-xs p-0 sm:p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-h-[85vh] sm:max-w-lg sm:rounded-2xl rounded-t-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl flex flex-col overflow-hidden text-slate-900 dark:text-slate-100">
        {/* Header */}
        <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between shrink-0">
          <div>
            <h2 id="location-list-sheet-title" className="text-sm font-bold text-slate-900 dark:text-white">
              {mapMode === "event" ? "Daftar Lokasi Radius Evaluasi" : "Daftar Lokasi Operasional"}
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Menampilkan {filtered.length} dari {locations.length} lokasi
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-xl text-slate-500 hover:text-slate-800 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 min-h-[44px] min-w-[44px] grid place-items-center"
            aria-label="Tutup daftar"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Search & Category Filter */}
        <div className="p-3 border-b border-slate-100 dark:border-slate-800/80 space-y-2 shrink-0 bg-slate-50 dark:bg-slate-900/50">
          {/* Search Box */}
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Cari kode, nama toko/DC, cabang..."
              className="w-full pl-9 pr-8 py-2.5 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-slate-100 focus:outline-hidden focus:ring-2 focus:ring-blue-600 min-h-[44px]"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          {/* Filter Pills */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-xs">
            <button
              type="button"
              onClick={() => setFilterType("ALL")}
              className={`px-3 py-1.5 rounded-lg font-semibold shrink-0 transition-colors min-h-[36px] ${
                filterType === "ALL"
                  ? "bg-blue-600 text-white shadow-xs"
                  : "bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300"
              }`}
            >
              Semua ({locations.length})
            </button>
            <button
              type="button"
              onClick={() => setFilterType("PRIORITY")}
              className={`px-3 py-1.5 rounded-lg font-semibold shrink-0 transition-colors min-h-[36px] flex items-center gap-1 ${
                filterType === "PRIORITY"
                  ? "bg-amber-600 text-white shadow-xs"
                  : "bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300"
              }`}
            >
              <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
              Perlu Perhatian
            </button>
            <button
              type="button"
              onClick={() => setFilterType("FACILITY")}
              className={`px-3 py-1.5 rounded-lg font-semibold shrink-0 transition-colors min-h-[36px] flex items-center gap-1 ${
                filterType === "FACILITY"
                  ? "bg-blue-600 text-white shadow-xs"
                  : "bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300"
              }`}
            >
              <Building className="w-3.5 h-3.5" />
              Fasilitas / DC
            </button>
            <button
              type="button"
              onClick={() => setFilterType("STORE")}
              className={`px-3 py-1.5 rounded-lg font-semibold shrink-0 transition-colors min-h-[36px] flex items-center gap-1 ${
                filterType === "STORE"
                  ? "bg-blue-600 text-white shadow-xs"
                  : "bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300"
              }`}
            >
              <StoreIcon className="w-3.5 h-3.5" />
              Toko
            </button>
          </div>
        </div>

        {/* Location List Items */}
        <div className="flex-1 overflow-y-auto p-3 space-y-2 pb-24 sm:pb-4 divide-y divide-slate-100 dark:divide-slate-800/60">
          {filtered.length === 0 ? (
            <div className="py-12 text-center text-slate-500 dark:text-slate-400 space-y-2">
              <MapPin className="w-8 h-8 mx-auto text-slate-300 dark:text-slate-600" />
              <p className="text-xs font-semibold">Tidak ada lokasi yang cocok dengan filter</p>
              <p className="text-[11px]">Coba ubah kata kunci pencarian atau kategori filter.</p>
            </div>
          ) : (
            filtered.map((loc) => {
              const isFacility = loc.id.startsWith("FACILITY:");
              const isSelected = selectedLocationId === loc.id;
              const isPriority =
                loc.status === "PRIORITY_MONITOR" || loc.visualStatus === "TERDAMPAK";
              const isAttention = loc.visualStatus === "PERLU_PERHATIAN";

              return (
                <button
                  key={loc.id}
                  type="button"
                  onClick={() => {
                    onSelectLocation(loc);
                    onClose();
                  }}
                  className={`w-full text-left p-3 pt-3.5 rounded-xl transition-all flex items-start justify-between gap-3 min-h-[56px] ${
                    isSelected
                      ? "bg-blue-50 dark:bg-blue-950/60 border border-blue-400 dark:border-blue-700"
                      : "hover:bg-slate-50 dark:hover:bg-slate-800/70"
                  }`}
                >
                  <div className="flex items-start gap-2.5 min-w-0">
                    <div
                      className={`p-2 rounded-lg shrink-0 mt-0.5 ${
                        isFacility
                          ? "bg-purple-100 dark:bg-purple-950 text-purple-700 dark:text-purple-300"
                          : "bg-blue-100 dark:bg-blue-950 text-blue-700 dark:text-blue-300"
                      }`}
                    >
                      {isFacility ? <Building className="w-4 h-4" /> : <StoreIcon className="w-4 h-4" />}
                    </div>

                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono text-xs font-bold text-slate-800 dark:text-slate-200">
                          {loc.kode_toko}
                        </span>
                        <span className="font-semibold text-xs text-slate-900 dark:text-white truncate">
                          {loc.nama_toko}
                        </span>
                      </div>

                      <div className="flex items-center gap-2 mt-1 text-[11px] text-slate-500 dark:text-slate-400 flex-wrap">
                        <span>{loc.cabang === "Belum dipetakan" ? "Belum dipetakan ke cabang" : `Cabang ${loc.cabang || "-"}`}</span>
                        {mapMode === "event" && loc.distanceFromDisasterKm !== undefined && (
                          <>
                            <span>•</span>
                            <span className="font-mono">{loc.distanceFromDisasterKm} km dari episentrum</span>
                          </>
                        )}
                      </div>

                      {/* Status Badges */}
                      <div className="mt-1.5 flex items-center gap-1.5 flex-wrap">
                        {isFacility && loc.cabang === "Belum dipetakan" && (
                          <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300 border border-amber-200 dark:border-amber-800">
                            Perlu Pemetaan Cabang
                          </span>
                        )}
                        {mapMode === "event" && isPriority && (
                          <span className="px-2 py-0.5 rounded-md bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300 text-[10px] font-bold">
                            Radius Prioritas
                          </span>
                        )}
                        {mapMode === "event" && isAttention && (
                          <span className="px-2 py-0.5 rounded-md bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300 text-[10px] font-bold">
                            Radius Pantau
                          </span>
                        )}
                        {loc.fr_type && isFacility && (
                          <span className="px-2 py-0.5 rounded-md bg-purple-50 text-purple-700 dark:bg-purple-950/80 dark:text-purple-300 text-[10px] font-semibold border border-purple-200 dark:border-purple-800">
                            {loc.fr_type.replace("FACILITY_", "")}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  <ChevronRight className="w-4 h-4 text-slate-400 shrink-0 mt-3" />
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
