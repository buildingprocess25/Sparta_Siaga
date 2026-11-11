"use client";

import React, { useState } from "react";
import {
  Layers,
  RotateCcw,
  Info,
  Radio,
  Activity,
  MapPin,
  List,
  AlertTriangle,
  ChevronDown,
  Building,
  Store,
  CloudRain,
  Filter,
  Search,
  X,
} from "lucide-react";
import { Earthquake } from "@/types/disaster";

export type MapMode = "event" | "location";

interface MapToolbarProps {
  mapMode: MapMode;
  onModeChange: (mode: MapMode) => void;
  // Mode Kejadian Context
  latestEarthquake?: Earthquake;
  activeEarthquakesCount: number;
  evaluatedLocationsCount: number;
  onOpenEvaluatedSheet: () => void;
  onOpenEarthquakeListModal: () => void;
  onFocusEpicenter: () => void;
  // Mode Lokasi Context & Filters
  searchQuery: string;
  onSearchChange: (query: string) => void;
  facilityType: string;
  onFacilityTypeChange: (type: string) => void;
  facilityBranch: string;
  onFacilityBranchChange: (branch: string) => void;
  facilityMapping: string;
  onFacilityMappingChange: (mapping: string) => void;
  branchOptions: string[];
  onResetLocationFilters: () => void;
  totalLocationsCount: number;
  // Map Quick View Controls
  basemap: "esri-dark" | "esri-light" | "osm";
  onChangeBasemap: (basemap: "esri-dark" | "esri-light" | "osm") => void;
  activeLayer: "all" | "earthquake" | "stores" | "weather" | "flood" | "aho";
  onLayerChange: (layer: "all" | "earthquake" | "stores" | "weather" | "flood" | "aho") => void;
  mapTimeFilter: "24h" | "3d";
  onChangeMapTimeFilter: (filter: "24h" | "3d") => void;
  incidentOnly: boolean;
  onToggleIncidentOnly: () => void;
  showRadar: boolean;
  onToggleRadar: () => void;
  onResetView: () => void;
  theme?: "dark" | "light";
  onOpenFilterModal?: () => void;
  onOpenLocationListSheet?: () => void;
  isMobileDetailOpen?: boolean;
}

export function MapToolbar({
  mapMode,
  onModeChange,
  latestEarthquake,
  activeEarthquakesCount,
  evaluatedLocationsCount,
  onOpenEvaluatedSheet,
  onOpenEarthquakeListModal,
  onFocusEpicenter,
  searchQuery,
  onSearchChange,
  facilityType,
  facilityBranch,
  facilityMapping,
  onResetLocationFilters,
  totalLocationsCount,
  basemap,
  onChangeBasemap,
  activeLayer,
  onLayerChange,
  mapTimeFilter,
  onChangeMapTimeFilter,
  incidentOnly,
  onToggleIncidentOnly,
  showRadar,
  onToggleRadar,
  onResetView,
  theme = "light",
  onOpenFilterModal,
  onOpenLocationListSheet,
  isMobileDetailOpen = false,
}: MapToolbarProps) {
  const [isLayerPopoverOpen, setIsLayerPopoverOpen] = useState(false);
  const [isLegendPopoverOpen, setIsLegendPopoverOpen] = useState(false);

  const activeFiltersCount =
    (facilityType ? 1 : 0) + (facilityBranch ? 1 : 0) + (facilityMapping ? 1 : 0);

  return (
    <div className="w-full bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 shadow-xs z-20 flex flex-col shrink-0">
      {/* =========================================================================
          ROW 1: Primary Header & Mode Switcher
         ========================================================================= */}
      <div className="px-3 md:px-4 py-2 flex items-center justify-between gap-2 md:gap-3 flex-wrap">
        {/* Left: Brand / Title + Mode Selector */}
        <div className="flex items-center gap-2 md:gap-4 flex-wrap">
          <span className="text-xs font-bold tracking-tight text-slate-800 dark:text-slate-100 uppercase hidden sm:inline">
            Peta Monitoring
          </span>

          {/* Segmented Control for Mode Kejadian vs Mode Lokasi */}
          <div
            className="inline-flex rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 p-0.5"
            aria-label="Mode Monitoring Peta"
          >
            <button
              type="button"
              aria-pressed={mapMode === "event"}
              onClick={() => onModeChange("event")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-all min-h-[40px] sm:min-h-[36px] ${
                mapMode === "event"
                  ? "bg-blue-700 text-white shadow-xs font-bold"
                  : "text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white"
              }`}
            >
              <Activity className="w-3.5 h-3.5" />
              <span>Mode Kejadian</span>
            </button>
            <button
              type="button"
              aria-pressed={mapMode === "location"}
              onClick={() => onModeChange("location")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-all min-h-[40px] sm:min-h-[36px] ${
                mapMode === "location"
                  ? "bg-blue-700 text-white shadow-xs font-bold"
                  : "text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white"
              }`}
            >
              <Store className="w-3.5 h-3.5" />
              <span>Mode Lokasi</span>
            </button>
          </div>
        </div>

        {/* Center / Search Input (Desktop Mode Lokasi) */}
        {mapMode === "location" && (
          <div className="hidden lg:flex items-center relative flex-1 max-w-xs mx-2">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="Cari lokasi, DC, kode..."
              className="w-full pl-8 pr-7 py-1.5 bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-lg text-xs text-slate-800 dark:text-slate-200 focus:outline-hidden focus:ring-2 focus:ring-blue-600"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => onSearchChange("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        )}

        {/* Right: Actions, Filters & Layer Popover */}
        <div className="flex items-center gap-1.5 md:gap-2 ml-auto">
          {/* Filter button in Mode Lokasi (Desktop & Tablet only; Mobile uses bottom action pill) */}
          {mapMode === "location" && (
            <button
              type="button"
              onClick={onOpenFilterModal}
              className="hidden sm:flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 text-xs font-semibold hover:bg-slate-50 dark:hover:bg-slate-700 min-h-[36px] shadow-xs"
              aria-label="Filter fasilitas"
            >
              <Filter className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
              <span>Filter fasilitas</span>
              {activeFiltersCount > 0 && (
                <span className="w-4 h-4 rounded-full bg-blue-600 text-white text-[10px] grid place-items-center font-bold">
                  {activeFiltersCount}
                </span>
              )}
            </button>
          )}

          {/* List-First Alternative Button (Desktop & Tablet) */}
          <button
            type="button"
            onClick={onOpenLocationListSheet}
            className="hidden sm:flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 text-xs font-semibold hover:bg-slate-50 dark:hover:bg-slate-700 min-h-[36px]"
            title="Buka daftar lokasi tabular"
          >
            <List className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
            <span>Daftar</span>
          </button>

          {/* Layer & Basemap Popover */}
          <div className="relative">
            <button
              type="button"
              onClick={() => {
                setIsLayerPopoverOpen(!isLayerPopoverOpen);
                setIsLegendPopoverOpen(false);
              }}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-semibold transition-colors min-h-[40px] sm:min-h-[36px] ${
                isLayerPopoverOpen
                  ? "bg-blue-50 border-blue-400 text-blue-700 dark:bg-blue-950/60 dark:border-blue-700 dark:text-blue-300"
                  : "bg-white dark:bg-slate-800 border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700"
              }`}
              aria-expanded={isLayerPopoverOpen}
              aria-haspopup="dialog"
              title="Pengaturan Layer & Basemap"
            >
              <Layers className="w-4 h-4 text-blue-600 dark:text-blue-400" />
              <span className="hidden md:inline">Layer</span>
              <ChevronDown className="w-3 h-3 opacity-60" />
            </button>

            {/* Dropdown Menu */}
            {isLayerPopoverOpen && (
              <div
                className="absolute right-0 top-full mt-1.5 w-72 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-3 shadow-2xl z-[2000] text-xs space-y-3"
                role="dialog"
                aria-label="Pengaturan Layer dan Tampilan Peta"
              >
                <div className="flex items-center justify-between pb-2 border-b border-slate-100 dark:border-slate-800">
                  <strong className="font-bold text-slate-900 dark:text-white">
                    Tampilan & Lapisan Peta
                  </strong>
                  <button
                    type="button"
                    onClick={() => setIsLayerPopoverOpen(false)}
                    className="p-1 text-slate-400 hover:text-slate-600 rounded"
                    aria-label="Tutup popover"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                {/* Basemap Choice */}
                <div>
                  <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider block mb-1">
                    Basemap
                  </span>
                  <div className="grid grid-cols-3 gap-1 bg-slate-100 dark:bg-slate-800 p-1 rounded-lg">
                    <button
                      type="button"
                      onClick={() => onChangeBasemap("esri-dark")}
                      className={`py-1.5 rounded text-center font-medium ${
                        basemap === "esri-dark"
                          ? "bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-xs font-bold"
                          : "text-slate-600 dark:text-slate-400"
                      }`}
                    >
                      Dark
                    </button>
                    <button
                      type="button"
                      onClick={() => onChangeBasemap("esri-light")}
                      className={`py-1.5 rounded text-center font-medium ${
                        basemap === "esri-light"
                          ? "bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-xs font-bold"
                          : "text-slate-600 dark:text-slate-400"
                      }`}
                    >
                      Light
                    </button>
                    <button
                      type="button"
                      onClick={() => onChangeBasemap("osm")}
                      className={`py-1.5 rounded text-center font-medium ${
                        basemap === "osm"
                          ? "bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-xs font-bold"
                          : "text-slate-600 dark:text-slate-400"
                      }`}
                    >
                      OSM
                    </button>
                  </div>
                </div>

                {/* Layer Visibility */}
                <div>
                  <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider block mb-1">
                    Lapisan Operasional
                  </span>
                  <div className="grid grid-cols-2 gap-1.5">
                    {[
                      { key: "all", label: "Semua Layer" },
                      { key: "earthquake", label: "Gempa Bumi" },
                      { key: "stores", label: "Toko & Fasilitas" },
                      { key: "flood", label: "Banjir / Cuaca" },
                    ].map((ly) => (
                      <button
                        key={ly.key}
                        type="button"
                        onClick={() => onLayerChange(ly.key as any)}
                        className={`px-2 py-1.5 rounded-md border text-left font-medium transition-colors ${
                          activeLayer === ly.key
                            ? "bg-blue-50 border-blue-400 text-blue-700 dark:bg-blue-950 dark:border-blue-700 dark:text-blue-300 font-bold"
                            : "border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300"
                        }`}
                      >
                        {ly.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Radar Cuaca */}
                <div className="pt-2 border-t border-slate-100 dark:border-slate-800">
                  <button
                    type="button"
                    onClick={onToggleRadar}
                    className={`w-full flex items-center justify-between px-2.5 py-2 rounded-md border text-xs font-semibold ${
                      showRadar
                        ? "bg-cyan-50 border-cyan-300 text-cyan-700 dark:bg-cyan-950/60 dark:border-cyan-800 dark:text-cyan-300"
                        : "border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300"
                    }`}
                  >
                    <span className="flex items-center gap-1.5">
                      <CloudRain className="w-3.5 h-3.5 text-cyan-600" />
                      Radar Cuaca (RainViewer)
                    </span>
                    <span className="text-[10px] uppercase font-bold">{showRadar ? "Aktif" : "Mati"}</span>
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Reset View Button */}
          <button
            type="button"
            onClick={onResetView}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 text-xs font-semibold transition-colors min-h-[40px] sm:min-h-[36px]"
            title="Reset tampilan peta ke seluruh Indonesia"
            aria-label="Reset Tampilan"
          >
            <RotateCcw className="w-3.5 h-3.5 text-slate-500" />
            <span className="hidden md:inline">Reset</span>
          </button>
        </div>
      </div>

      {/* =========================================================================
          ROW 2: Contextual Summary Strip (Slim & Clean, No Overlays)
         ========================================================================= */}
      {mapMode === "event" ? (
        <div className="px-3 md:px-4 py-1.5 bg-slate-50 dark:bg-slate-950/70 border-t border-slate-200/80 dark:border-slate-800 flex items-center justify-between gap-2 text-xs">
          {latestEarthquake ? (
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold tracking-wide uppercase bg-red-100 text-red-700 border border-red-300 dark:bg-red-950/80 dark:text-red-300 dark:border-red-800 shrink-0">
                <Radio className="w-2.5 h-2.5 text-red-600 animate-ping" />
                LIVE
              </span>
              <span className="font-bold text-slate-900 dark:text-white truncate">
                M {latestEarthquake.magnitude} — {latestEarthquake.title || latestEarthquake.place}
              </span>
              <span className="text-slate-500 font-mono hidden md:inline">
                • {latestEarthquake.depth}
              </span>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 text-slate-500 text-xs">
              <Activity className="w-3.5 h-3.5 text-emerald-500" />
              <span>Tidak ada gempa darurat baru.</span>
            </div>
          )}

          {/* Quick Context Actions */}
          <div className="flex items-center gap-1.5 shrink-0 ml-auto">
            {evaluatedLocationsCount > 0 ? (
              <button
                type="button"
                onClick={onOpenEvaluatedSheet}
                className="flex items-center gap-1 px-2 py-1 rounded-md bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold text-xs shadow-xs min-h-[32px]"
              >
                <AlertTriangle className="w-3 h-3" />
                <span>Evaluasi ({evaluatedLocationsCount})</span>
              </button>
            ) : (
              <span className="px-2 py-0.5 rounded text-[11px] font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:border-emerald-800 hidden sm:inline">
                Aman
              </span>
            )}

            <button
              type="button"
              onClick={onOpenEarthquakeListModal}
              className="flex items-center gap-1 px-2 py-1 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-blue-700 dark:text-blue-300 text-xs font-semibold hover:bg-slate-50 min-h-[32px]"
            >
              <List className="w-3 h-3" />
              <span>Gempa ({activeEarthquakesCount})</span>
            </button>

            {latestEarthquake && (
              <button
                type="button"
                onClick={onFocusEpicenter}
                className="hidden sm:flex items-center gap-1 px-2 py-1 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 text-xs font-semibold hover:bg-slate-50 min-h-[32px]"
              >
                <MapPin className="w-3 h-3 text-red-500" />
                <span>Episentrum</span>
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="px-3 md:px-4 py-1.5 bg-slate-50 dark:bg-slate-950/70 border-t border-slate-200/80 dark:border-slate-800 flex items-center justify-between gap-2 text-xs">
          <div className="flex items-center gap-2 text-slate-600 dark:text-slate-300">
            <Store className="w-3.5 h-3.5 text-blue-600" />
            <span className="font-semibold text-slate-900 dark:text-white">
              {totalLocationsCount} Lokasi Aktif
            </span>
            {activeFiltersCount > 0 && (
              <span className="text-[11px] text-blue-600 dark:text-blue-400 font-medium">
                ({activeFiltersCount} filter diterapkan)
              </span>
            )}
          </div>

          {activeFiltersCount > 0 && (
            <button
              type="button"
              onClick={onResetLocationFilters}
              className="text-[11px] text-red-600 dark:text-red-400 font-semibold hover:underline"
            >
              Reset Filter
            </button>
          )}
        </div>
      )}

      {/* =========================================================================
          MOBILE FLOATING ACTION PILLS (Centered above bottom navigation)
          Never covers the map; clean tap targets >= 44x44px.
         ========================================================================= */}
      {!isMobileDetailOpen && (
        <div className="sm:hidden fixed bottom-20 left-0 right-0 z-[500] flex justify-center pointer-events-none px-4">
          <div className="flex items-center gap-2 p-1.5 bg-white/95 dark:bg-slate-900/95 border border-slate-200 dark:border-slate-800 shadow-2xl rounded-full pointer-events-auto backdrop-blur-md">
            {mapMode === "location" ? (
              <button
                type="button"
                onClick={onOpenFilterModal}
                className="flex items-center gap-1.5 px-4 py-2 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200 text-xs font-bold min-h-[44px] shadow-xs active:scale-95 transition-transform"
                aria-label="Filter fasilitas"
              >
                <Filter className="w-4 h-4 text-blue-600" />
                <span>Filter</span>
                {activeFiltersCount > 0 && (
                  <span className="w-4 h-4 rounded-full bg-blue-600 text-white text-[10px] grid place-items-center">
                    {activeFiltersCount}
                  </span>
                )}
              </button>
            ) : (
              <button
                type="button"
                onClick={onFocusEpicenter}
                className="flex items-center gap-1.5 px-4 py-2 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200 text-xs font-bold min-h-[44px] shadow-xs active:scale-95 transition-transform"
              >
                <MapPin className="w-4 h-4 text-red-600" />
                <span>Episentrum</span>
              </button>
            )}

            <button
              type="button"
              onClick={mapMode === "event" ? onOpenEvaluatedSheet : onOpenLocationListSheet}
              aria-label={mapMode === "event" ? "Daftar evaluasi radius" : "Daftar lokasi operasional"}
              className="flex items-center gap-1.5 px-4 py-2 rounded-full bg-blue-700 text-white text-xs font-bold min-h-[44px] shadow-md active:scale-95 transition-transform"
            >
              <List className="w-4 h-4" />
              <span>
                {mapMode === "event" ? `Evaluasi (${evaluatedLocationsCount})` : `Daftar Lokasi`}
              </span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
