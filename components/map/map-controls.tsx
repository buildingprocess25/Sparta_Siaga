"use client";

import React, { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import {
  Compass,
  Eye,
  EyeOff,
  CloudRain,
  ChevronUp,
  Layers,
  RotateCcw,
  Globe2,
  Activity,
  Waves,
  Store,
  Clock,
  X,
} from "lucide-react";
import { Earthquake } from "@/types/disaster";

interface MapControlsProps {
  locationMode?: "event" | "store" | "dc";
  latestEarthquake?: Earthquake;
  incidentOnly: boolean;
  onToggleIncidentOnly: () => void;
  basemap: "esri-dark" | "esri-light" | "osm";
  onChangeBasemap: (basemap: "esri-dark" | "esri-light" | "osm") => void;
  onResetView: () => void;
  totalStoresCount: number;
  affectedStoresCount: number;
  showRadar?: boolean;
  onToggleRadar?: () => void;
  radarTimeString?: string;
  hidden?: boolean;
  theme?: "dark" | "light";
  activeLayer?: "all" | "earthquake" | "stores" | "weather" | "flood";
  onLayerChange?: (layer: "all" | "earthquake" | "stores" | "weather" | "flood") => void;

  // Requirement 3 & 22: Map Time Filter (24 Jam vs 3 Hari Segmented Control)
  mapTimeFilter?: "24h" | "3d";
  onChangeMapTimeFilter?: (filter: "24h" | "3d") => void;

  // Requirement 7 & 32: Compact Event Focus Mode Banner
  selectedEarthquake?: Earthquake | null;
  onClearEventFocus?: () => void;

  // Store Sync Update Info
  lastStoreUpdate?: string | null;
  storeSyncSource?: "GOOGLE_SHEETS" | "LOCAL_MASTER" | string | null;
  storeSyncLabel?: string | null;

  // Mobile Bottom Sheet Props
  isMobileSheetOpen?: boolean;
  onCloseMobileSheet?: () => void;
}

function formatIndonesianDateTime(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    return (
      d.toLocaleString("id-ID", {
        day: "numeric",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "Asia/Jakarta",
      }) + " WIB"
    );
  } catch {
    return dateStr;
  }
}

export function MapControls({
  locationMode = "event",
  lastStoreUpdate,
  storeSyncSource,
  storeSyncLabel,
  incidentOnly,
  onToggleIncidentOnly,
  basemap,
  onChangeBasemap,
  onResetView,
  totalStoresCount,
  affectedStoresCount,
  showRadar = false,
  onToggleRadar,
  hidden = false,
  theme = "dark",
  activeLayer = "all",
  onLayerChange,
  mapTimeFilter = "3d",
  onChangeMapTimeFilter,
  selectedEarthquake,
  onClearEventFocus,
  isMobileSheetOpen = false,
  onCloseMobileSheet,
}: MapControlsProps) {
  const [isMinimized, setIsMinimized] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (hidden) return null;

  const isDark = theme === "dark";
  const isLocationMode = locationMode === "store" || locationMode === "dc";

  const controlContent = isLocationMode ? (
    <div className="space-y-3">
      {/* Basemap Selector */}
      <div>
        <div className={`text-[10px] font-bold uppercase tracking-wider mb-1.5 ${isDark ? "text-slate-400" : "text-slate-500"}`}>
          Pilihan Basemap
        </div>
        <div
          className={`p-1 rounded-xl flex items-center gap-1 border ${
            isDark ? "bg-slate-950/80 border-slate-800" : "bg-slate-100 border-slate-200"
          }`}
        >
          {[
            { id: "esri-dark", label: "Dark" },
            { id: "esri-light", label: "Light" },
            { id: "osm", label: "OSM" },
          ].map((b) => {
            const isSelected = basemap === b.id;
            return (
              <button
                key={b.id}
                onClick={() => onChangeBasemap(b.id as "esri-dark" | "esri-light" | "osm")}
                aria-pressed={isSelected}
                className={`flex-1 py-1.5 rounded-lg text-xs font-semibold transition-all text-center min-h-[34px] ${
                  isSelected
                    ? isDark
                      ? "bg-slate-800 text-cyan-400 shadow-xs font-bold"
                      : "bg-white text-blue-600 shadow-xs font-bold"
                    : isDark
                    ? "text-slate-400 hover:text-white"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                {b.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Reset Tampilan Peta */}
      <button
        onClick={onResetView}
        className={`w-full py-2 px-3 rounded-xl border font-semibold text-xs flex items-center justify-center gap-2 transition-all min-h-[40px] ${
          isDark
            ? "border-slate-700/80 hover:bg-slate-800 text-slate-300 hover:text-white"
            : "border-slate-200 hover:bg-slate-100 text-slate-700 hover:text-slate-900"
        }`}
      >
        <Compass className="w-4 h-4 shrink-0 text-cyan-500" />
        <span>Reset Tampilan Peta</span>
      </button>

      {/* Catatan Terakhir Pembaruan Data Toko */}
      <div className={`pt-2 border-t text-[10px] space-y-1 ${
        isDark ? "border-slate-800 text-slate-400" : "border-slate-200 text-slate-500"
      }`}>
        <div className="flex items-center gap-1.5">
          <Clock className="w-3 h-3 text-cyan-500 shrink-0" />
          <span className="leading-tight">
            Data toko:{" "}
            <strong className={isDark ? "text-slate-300 font-semibold" : "text-slate-800 font-semibold"}>
              {lastStoreUpdate ? formatIndonesianDateTime(lastStoreUpdate) : "Terbaru"}
            </strong>
          </span>
        </div>
        <div className="flex items-center gap-1 pl-4.5">
          <span className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 ${
            storeSyncSource === "GOOGLE_SHEETS" ? "bg-emerald-500" : "bg-amber-500"
          }`} />
          <span className="text-[9px] opacity-85 truncate">
            {storeSyncSource === "GOOGLE_SHEETS"
              ? "Sumber: Google Sheets (Sinkron)"
              : "Sumber: Master Toko Lokal (21.550 Toko)"}
          </span>
        </div>
      </div>
    </div>
  ) : (

    <div className="space-y-3">
      {/* Event Focus Mode Banner: Compact Fokus: M... [Reset] */}
      {selectedEarthquake && (
        <div className={`p-2 rounded-xl border text-xs flex items-center justify-between gap-2 ${
          isDark ? "bg-red-950/80 border-red-500/40 text-red-100" : "bg-red-50 border-red-200 text-red-900"
        }`}>
          <div className="min-w-0 flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-red-500 animate-ping shrink-0" />
            <span className="text-xs font-bold truncate">
              Fokus: M{selectedEarthquake.magnitude} • {selectedEarthquake.title || selectedEarthquake.place}
            </span>
          </div>
          {onClearEventFocus && (
            <button
              onClick={onClearEventFocus}
              className="px-2 py-1 rounded-md text-[10px] font-bold bg-red-600 hover:bg-red-500 text-white shrink-0 transition-colors flex items-center gap-1 shadow-xs"
              title="Reset Fokus Event"
            >
              <RotateCcw className="w-3 h-3" />
              <span>Reset</span>
            </button>
          )}
        </div>
      )}

      {/* Periode Gempa: Segmented Control [ 24 Jam | 3 Hari ] */}
      <div>
        <div className={`text-[10px] font-bold uppercase tracking-wider mb-1.5 ${isDark ? "text-slate-400" : "text-slate-500"}`}>
          Periode Gempa
        </div>
        <div
          className={`p-1 rounded-xl flex items-center gap-1 border ${
            isDark ? "bg-slate-950/80 border-slate-800" : "bg-slate-100 border-slate-200"
          }`}
        >
          <button
            onClick={() => onChangeMapTimeFilter?.("24h")}
            aria-pressed={mapTimeFilter === "24h"}
            className={`flex-1 py-1.5 px-3 rounded-lg text-xs font-bold transition-all text-center min-h-[36px] ${
              mapTimeFilter === "24h"
                ? "bg-amber-500 text-white shadow-xs"
                : isDark
                ? "text-slate-400 hover:text-white"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            24 Jam
          </button>
          <button
            onClick={() => onChangeMapTimeFilter?.("3d")}
            aria-pressed={mapTimeFilter === "3d"}
            className={`flex-1 py-1.5 px-3 rounded-lg text-xs font-bold transition-all text-center min-h-[36px] ${
              mapTimeFilter === "3d"
                ? "bg-blue-600 text-white shadow-xs"
                : isDark
                ? "text-slate-400 hover:text-white"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            3 Hari
          </button>
        </div>
      </div>

      {/* Layer Selector */}
      <div>
        <div className={`text-[10px] font-bold uppercase tracking-wider mb-1.5 ${isDark ? "text-slate-400" : "text-slate-500"}`}>
          Layer Tampilan
        </div>
        <div className="grid grid-cols-4 gap-1.5">
          {[
            { id: "all", label: "Semua", icon: Globe2 },
            { id: "earthquake", label: "Gempa", icon: Activity },
            { id: "flood", label: "Banjir", icon: Waves },
            { id: "stores", label: "Toko", icon: Store },
          ].map((layer) => {
            const isActive = activeLayer === layer.id;
            const LayerIcon = layer.icon;
            return (
              <button
                key={layer.id}
                onClick={() =>
                  onLayerChange?.(
                    layer.id as "all" | "earthquake" | "stores" | "flood"
                  )
                }
                aria-pressed={isActive}
                className={`py-2 px-1 rounded-xl border text-center transition-all flex flex-col items-center justify-center gap-1 min-h-[44px] ${
                  isActive
                    ? isDark
                      ? "bg-slate-800 text-white border-cyan-500/50 shadow-xs font-bold"
                      : "bg-white text-slate-900 border-slate-300 shadow-xs font-bold"
                    : isDark
                    ? "bg-transparent border-transparent text-slate-400 hover:bg-slate-800/60 hover:text-slate-200"
                    : "bg-transparent border-transparent text-slate-500 hover:bg-slate-100 hover:text-slate-800"
                }`}
              >
                <LayerIcon className="h-4 w-4" />
                <span className="leading-none text-[11px]">{layer.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Crisis & Radar Toggles */}
      <div className="grid grid-cols-2 gap-2 pt-0.5">
        <button
          onClick={onToggleIncidentOnly}
          aria-pressed={incidentOnly}
          className={`py-2 px-2.5 rounded-xl border text-center font-semibold text-xs flex items-center justify-center gap-1.5 transition-all min-h-[40px] ${
            incidentOnly
              ? isDark
                ? "bg-red-500/15 text-red-400 border-red-500/40 font-bold"
                : "bg-red-50 text-red-600 border-red-200 font-bold"
              : isDark
              ? "bg-slate-800/40 border-slate-700/60 text-slate-400 hover:bg-slate-800 hover:text-slate-200"
              : "bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100 hover:text-slate-900"
          }`}
          title={incidentOnly ? "Mode krisis aktif (hanya toko di zona terdampak)" : "Klik untuk memfilter hanya toko di zona krisis"}
        >
          {incidentOnly ? (
            <Eye className="w-4 h-4 shrink-0 text-red-500" />
          ) : (
            <EyeOff className="w-4 h-4 shrink-0 opacity-70" />
          )}
          <span>Zona Krisis</span>
        </button>

        <button
          onClick={onToggleRadar}
          aria-pressed={showRadar}
          className={`py-2 px-2.5 rounded-xl border text-center font-semibold text-xs flex items-center justify-center gap-1.5 transition-all min-h-[40px] ${
            showRadar
              ? isDark
                ? "bg-cyan-500/15 text-cyan-400 border-cyan-500/40 font-bold"
                : "bg-cyan-50 text-cyan-600 border-cyan-200 font-bold"
              : isDark
              ? "bg-slate-800/40 border-slate-700/60 text-slate-400 hover:bg-slate-800 hover:text-slate-200"
              : "bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100 hover:text-slate-900"
          }`}
          title="Toggle Radar Doppler BMKG RainViewer"
        >
          <CloudRain className={`w-4 h-4 shrink-0 ${showRadar ? "text-cyan-400" : ""}`} />
          <span>Radar Cuaca</span>
        </button>
      </div>

      {/* Basemap Selector */}
      <div>
        <div className={`text-[10px] font-bold uppercase tracking-wider mb-1.5 ${isDark ? "text-slate-400" : "text-slate-500"}`}>
          Pilihan Basemap
        </div>
        <div
          className={`p-1 rounded-xl flex items-center gap-1 border ${
            isDark ? "bg-slate-950/80 border-slate-800" : "bg-slate-100 border-slate-200"
          }`}
        >
          {[
            { id: "esri-dark", label: "Dark" },
            { id: "esri-light", label: "Light" },
            { id: "osm", label: "OSM" },
          ].map((b) => {
            const isSelected = basemap === b.id;
            return (
              <button
                key={b.id}
                onClick={() => onChangeBasemap(b.id as "esri-dark" | "esri-light" | "osm")}
                aria-pressed={isSelected}
                className={`flex-1 py-1.5 rounded-lg text-xs font-semibold transition-all text-center min-h-[34px] ${
                  isSelected
                    ? isDark
                      ? "bg-slate-800 text-cyan-400 shadow-xs font-bold"
                      : "bg-white text-blue-600 shadow-xs font-bold"
                    : isDark
                    ? "text-slate-400 hover:text-white"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                {b.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Reset Tampilan Peta */}
      <button
        onClick={onResetView}
        className={`w-full py-2 px-3 rounded-xl border font-semibold text-xs flex items-center justify-center gap-2 transition-all min-h-[40px] ${
          isDark
            ? "border-slate-700/80 hover:bg-slate-800 text-slate-300 hover:text-white"
            : "border-slate-200 hover:bg-slate-100 text-slate-700 hover:text-slate-900"
        }`}
      >
        <Compass className="w-4 h-4 shrink-0 text-cyan-500" />
        <span>Reset Tampilan Peta</span>
      </button>

      {/* Catatan Terakhir Pembaruan Data Toko */}
      <div className={`pt-2 border-t text-[10px] space-y-1 ${
        isDark ? "border-slate-800 text-slate-400" : "border-slate-200 text-slate-500"
      }`}>
        <div className="flex items-center gap-1.5">
          <Clock className="w-3 h-3 text-cyan-500 shrink-0" />
          <span className="leading-tight">
            Data toko:{" "}
            <strong className={isDark ? "text-slate-300 font-semibold" : "text-slate-800 font-semibold"}>
              {lastStoreUpdate ? formatIndonesianDateTime(lastStoreUpdate) : "Terbaru"}
            </strong>
          </span>
        </div>
        <div className="flex items-center gap-1 pl-4.5">
          <span className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 ${
            storeSyncSource === "GOOGLE_SHEETS" ? "bg-emerald-500" : "bg-amber-500"
          }`} />
          <span className="text-[9px] opacity-85 truncate">
            {storeSyncSource === "GOOGLE_SHEETS"
              ? "Sumber: Google Sheets (Sinkron)"
              : "Sumber: Master Toko Lokal (21.550 Toko)"}
          </span>
        </div>
      </div>
    </div>
  );

  return (
    <>
      {/* 1. DESKTOP FLOATING PANEL (Always visible on large screens) */}
      <div className="hidden lg:flex absolute top-[72px] left-4 z-[400] flex-col pointer-events-auto transition-all duration-200 w-[min(276px,calc(100vw-1.5rem))]">
        {isMinimized ? (
          <button
            onClick={() => setIsMinimized(false)}
            className={`px-3 py-2 rounded-xl shadow-xl backdrop-blur-md transition-all hover:scale-105 flex items-center gap-2 text-xs font-bold border ${
              isDark
                ? "bg-slate-900/95 border-slate-700 text-white hover:bg-slate-800"
                : "bg-white/95 border-slate-300 text-slate-800 hover:bg-slate-100 shadow-md"
            }`}
            title="Buka Kontrol Peta"
            aria-label="Buka Kontrol Peta"
          >
            <Layers className="w-4 h-4 text-cyan-500 shrink-0" />
            <span className="hidden xl:inline">Kontrol Peta</span>
            {showRadar && (
              <span className="w-2 h-2 rounded-full bg-cyan-400 animate-ping" />
            )}
          </button>
        ) : (
          <div
            className={`border rounded-xl p-3 shadow-lg backdrop-blur-md w-full text-xs space-y-2 transition-colors duration-200 max-h-[min(540px,calc(100dvh-155px))] overflow-y-auto ${
              isDark
                ? "bg-slate-900/95 border-slate-700/80 text-white"
                : "bg-white/95 border-slate-200 text-slate-900 shadow-xl"
            }`}
          >
            <div className={`flex items-center justify-between border-b pb-1.5 ${isDark ? "border-slate-800" : "border-slate-100"}`}>
              <div className="flex items-center gap-1.5 font-bold text-xs tracking-tight">
                <Layers className="w-3.5 h-3.5 text-cyan-500 shrink-0" />
                <span>Kontrol Peta</span>
              </div>
              <button
                onClick={() => setIsMinimized(true)}
                className={`p-1 rounded-md transition-colors ${
                  isDark
                    ? "hover:bg-slate-800 text-slate-400 hover:text-white"
                    : "hover:bg-slate-100 text-slate-500 hover:text-slate-900"
                }`}
                title="Minimalkan Kontrol"
                aria-label="Minimalkan kontrol peta"
              >
                <ChevronUp className="w-3.5 h-3.5" />
              </button>
            </div>
            {controlContent}
          </div>
        )}
      </div>

      {/* 2. MOBILE BOTTOM SHEET (Opens when user taps "Kontrol Peta" on mobile, mounted in body portal) */}
      {mounted && isMobileSheetOpen && typeof document !== "undefined" && createPortal(
        <div
          className="lg:hidden fixed inset-0 z-[9999] flex flex-col justify-end"
          role="dialog"
          aria-modal="true"
          aria-label="Kontrol Peta"
        >
          {/* Backdrop */}
          <div
            className="fixed inset-0 bg-slate-950/60 backdrop-blur-xs transition-opacity"
            onClick={onCloseMobileSheet}
          />

          {/* Bottom Sheet Card */}
          <div
            onTouchStart={(e) => e.stopPropagation()}
            onTouchMove={(e) => e.stopPropagation()}
            onWheel={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            className={`relative w-full rounded-t-2xl shadow-2xl p-4 sm:p-5 border-t max-h-[82vh] overflow-y-auto overscroll-y-contain pb-24 animate-in slide-in-from-bottom duration-200 z-10 ${
              isDark
                ? "bg-slate-900 border-slate-800 text-white"
                : "bg-white border-slate-200 text-slate-900"
            }`}
          >
            {/* Sheet Handle */}
            <div className="w-12 h-1.5 bg-slate-300 dark:bg-slate-700 rounded-full mx-auto mb-3" />

            {/* Header */}
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800 mb-3">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-cyan-500/10 text-cyan-500">
                  <Layers className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-sm leading-tight">Kontrol Peta</h3>
                  <span className="text-[10px] text-slate-500 dark:text-slate-400 leading-tight">
                    Layer, basemap, radar dan periode gempa
                  </span>
                </div>
              </div>
              <button
                type="button"
                onClick={onCloseMobileSheet}
                className="p-2 rounded-xl text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center"
                aria-label="Tutup Kontrol Peta"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Content */}
            {controlContent}
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
