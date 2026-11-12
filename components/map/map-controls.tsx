"use client";

import React, { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import {
  Compass,
  Eye,
  EyeOff,
  CloudRain,
  ChevronLeft,
  ChevronRight,
  Layers,
  RotateCcw,
  Globe2,
  Activity,
  Waves,
  Store,
  Clock,
  Wrench,
  Maximize2,
  Minimize2,
  X,
  SlidersHorizontal,
} from "lucide-react";
import { Earthquake } from "@/types/disaster";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

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
  isOpen?: boolean;
  onToggleOpen?: () => void;
  hidden?: boolean;
  theme?: "dark" | "light";
  activeLayer?: "all" | "earthquake" | "stores" | "weather" | "flood" | "aho";
  onLayerChange?: (layer: "all" | "earthquake" | "stores" | "weather" | "flood" | "aho") => void;
  mapTimeFilter?: "24h" | "3d";
  onChangeMapTimeFilter?: (filter: "24h" | "3d") => void;
  selectedEarthquake?: Earthquake | null;
  onClearEventFocus?: () => void;
  isFullscreen?: boolean;
  onToggleFullscreen?: () => void;
  lastStoreUpdate?: string | null;
  storeSyncSource?: "GOOGLE_SHEETS" | "LOCAL_MASTER" | string | null;
  storeSyncLabel?: string | null;
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
  incidentOnly,
  onToggleIncidentOnly,
  basemap,
  onChangeBasemap,
  onResetView,
  totalStoresCount,
  affectedStoresCount,
  showRadar = false,
  onToggleRadar,
  isOpen = true,
  onToggleOpen,
  hidden = false,
  theme = "dark",
  activeLayer = "all",
  onLayerChange,
  mapTimeFilter = "3d",
  onChangeMapTimeFilter,
  selectedEarthquake,
  onClearEventFocus,
  isFullscreen = false,
  onToggleFullscreen,
  isMobileSheetOpen = false,
  onCloseMobileSheet,
}: MapControlsProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (hidden) return null;

  const isDark = theme === "dark";
  const isLocationMode = locationMode === "store" || locationMode === "dc";

  // Reusable body of controls according to active mode
  const renderControlContent = () => (
    <div className="space-y-3.5 text-xs">
      {/* ------------------------------------------------------------- */}
      {/* MODE TOKO & DC CONTROLS                                       */}
      {/* ------------------------------------------------------------- */}
      {isLocationMode ? (
        <>
          {/* Mode Toko: Pilihan Sub-Layer (Standar vs Tiket AHO) */}
          {locationMode === "store" && (
            <div className="space-y-1.5">
              <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider block">
                Pilihan Layer Toko
              </label>
              <div className="grid grid-cols-2 gap-1 p-1 rounded-lg bg-muted/50 border border-border">
                <button
                  type="button"
                  onClick={() => onLayerChange?.("stores")}
                  aria-pressed={activeLayer !== "aho"}
                  className={`py-1.5 px-2 rounded-md text-xs font-medium transition-all text-center flex items-center justify-center gap-1.5 min-h-[32px] ${
                    activeLayer !== "aho"
                      ? "bg-primary text-primary-foreground shadow-xs font-semibold"
                      : "text-muted-foreground hover:text-foreground hover:bg-background/50"
                  }`}
                >
                  <Store className="w-3.5 h-3.5 shrink-0" />
                  <span>Standar</span>
                </button>
                <button
                  type="button"
                  onClick={() => onLayerChange?.("aho")}
                  aria-pressed={activeLayer === "aho"}
                  className={`py-1.5 px-2 rounded-md text-xs font-medium transition-all text-center flex items-center justify-center gap-1.5 min-h-[32px] ${
                    activeLayer === "aho"
                      ? "bg-amber-600 text-white shadow-xs font-semibold"
                      : "text-muted-foreground hover:text-foreground hover:bg-background/50"
                  }`}
                >
                  <Wrench className="w-3.5 h-3.5 shrink-0" />
                  <span>Tiket AHO</span>
                </button>
              </div>
            </div>
          )}

          {/* Basemap Selection */}
          <div className="space-y-1.5">
            <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider block">
              Pilihan Basemap
            </label>
            <div className="grid grid-cols-3 gap-1 p-1 rounded-lg bg-muted/50 border border-border">
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
                    className={`py-1.5 px-2 rounded-md text-xs font-medium transition-all text-center min-h-[30px] ${
                      isSelected
                        ? "bg-primary text-primary-foreground shadow-xs font-semibold"
                        : "text-muted-foreground hover:text-foreground hover:bg-background/50"
                    }`}
                  >
                    {b.label}
                  </button>
                );
              })}
            </div>
          </div>

          <Separator />

          {/* Reset Map Action */}
          <Button
            variant="outline"
            size="sm"
            onClick={onResetView}
            className="w-full justify-center gap-2 h-9 text-xs"
          >
            <Compass className="w-3.5 h-3.5 text-primary shrink-0" />
            <span>Reset Tampilan Peta</span>
          </Button>

          {/* Timestamp Info */}
          <div className="pt-1 text-[11px] text-muted-foreground space-y-1">
            <div className="flex items-center gap-1.5">
              <Clock className="w-3 h-3 text-primary shrink-0" />
              <span className="truncate">
                Pembaruan:{" "}
                <strong className="text-foreground font-medium">
                  {lastStoreUpdate ? formatIndonesianDateTime(lastStoreUpdate) : "Sinkron"}
                </strong>
              </span>
            </div>
            <div className="flex items-center gap-1.5 pl-4.5">
              <span className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 ${
                storeSyncSource === "GOOGLE_SHEETS" ? "bg-emerald-500" : "bg-primary"
              }`} />
              <span className="text-[10px] truncate">
                {storeSyncSource === "GOOGLE_SHEETS"
                  ? "Google Sheets (Terjadwal)"
                  : "Master Toko Lokal"}
              </span>
            </div>
          </div>
        </>
      ) : (
        /* ------------------------------------------------------------- */
        /* MODE KEJADIAN CONTROLS                                        */
        /* ------------------------------------------------------------- */
        <>
          {/* Focused Earthquake Banner */}
          {selectedEarthquake && (
            <div className="p-2.5 rounded-lg border border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300 text-xs flex items-center justify-between gap-2">
              <div className="min-w-0 flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-red-500 animate-ping shrink-0" />
                <span className="text-xs font-semibold truncate">
                  Fokus M{selectedEarthquake.magnitude} • {selectedEarthquake.place || selectedEarthquake.title}
                </span>
              </div>
              {onClearEventFocus && (
                <Button
                  variant="destructive"
                  size="xs"
                  onClick={onClearEventFocus}
                  className="h-6 px-2 text-[10px] shrink-0"
                >
                  <RotateCcw className="w-3 h-3" />
                  <span>Reset</span>
                </Button>
              )}
            </div>
          )}

          {/* Layer Tampilan: Semua, Gempa, Banjir, Toko (AHO strictly removed) */}
          <div className="space-y-1.5">
            <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider block">
              Layer Tampilan
            </label>
            <div className="grid grid-cols-4 gap-1">
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
                      onLayerChange?.(layer.id as "all" | "earthquake" | "stores" | "flood")
                    }
                    aria-pressed={isActive}
                    className={`py-2 px-1 rounded-lg border text-center transition-all flex flex-col items-center justify-center gap-1 min-h-[44px] ${
                      isActive
                        ? "bg-primary text-primary-foreground border-primary shadow-xs font-semibold"
                        : "bg-background border-border text-muted-foreground hover:text-foreground hover:bg-muted/50"
                    }`}
                  >
                    <LayerIcon className="h-4 w-4" />
                    <span className="text-[10px] leading-tight">{layer.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Periode Gempa: Only rendered when viewing earthquakes/all */}
          {(activeLayer === "all" || activeLayer === "earthquake") && (
            <div className="space-y-1.5">
              <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider block">
                Periode Gempa
              </label>
              <div className="grid grid-cols-2 gap-1 p-1 rounded-lg bg-muted/50 border border-border">
                <button
                  type="button"
                  onClick={() => onChangeMapTimeFilter?.("24h")}
                  aria-pressed={mapTimeFilter === "24h"}
                  className={`py-1.5 px-3 rounded-md text-xs font-semibold transition-all text-center min-h-[30px] ${
                    mapTimeFilter === "24h"
                      ? "bg-amber-600 text-white shadow-xs"
                      : "text-muted-foreground hover:text-foreground hover:bg-background/50"
                  }`}
                >
                  24 Jam
                </button>
                <button
                  type="button"
                  onClick={() => onChangeMapTimeFilter?.("3d")}
                  aria-pressed={mapTimeFilter === "3d"}
                  className={`py-1.5 px-3 rounded-md text-xs font-semibold transition-all text-center min-h-[30px] ${
                    mapTimeFilter === "3d"
                      ? "bg-primary text-primary-foreground shadow-xs"
                      : "text-muted-foreground hover:text-foreground hover:bg-background/50"
                  }`}
                >
                  3 Hari
                </button>
              </div>
            </div>
          )}

          {/* Overlay Toggles: Zona Krisis & Radar Cuaca */}
          <div className="grid grid-cols-2 gap-1.5">
            <button
              type="button"
              onClick={onToggleIncidentOnly}
              aria-pressed={incidentOnly}
              className={`py-2 px-2.5 rounded-lg border text-center font-medium text-xs flex items-center justify-center gap-1.5 transition-all min-h-[36px] ${
                incidentOnly
                  ? "bg-red-500/15 text-red-600 dark:text-red-400 border-red-500/40 font-semibold"
                  : "bg-background border-border text-muted-foreground hover:text-foreground hover:bg-muted/50"
              }`}
              title={incidentOnly ? "Mode krisis aktif" : "Filter toko di zona bencana"}
            >
              {incidentOnly ? (
                <Eye className="w-3.5 h-3.5 shrink-0 text-red-500" />
              ) : (
                <EyeOff className="w-3.5 h-3.5 shrink-0 opacity-70" />
              )}
              <span>Zona Krisis</span>
            </button>

            <button
              type="button"
              onClick={onToggleRadar}
              aria-pressed={showRadar}
              className={`py-2 px-2.5 rounded-lg border text-center font-medium text-xs flex items-center justify-center gap-1.5 transition-all min-h-[36px] ${
                showRadar
                  ? "bg-primary/15 text-primary border-primary/40 font-semibold"
                  : "bg-background border-border text-muted-foreground hover:text-foreground hover:bg-muted/50"
              }`}
              title="Toggle Radar Doppler BMKG RainViewer"
            >
              <CloudRain className={`w-3.5 h-3.5 shrink-0 ${showRadar ? "text-primary" : ""}`} />
              <span>Radar Cuaca</span>
            </button>
          </div>

          {/* Basemap Selection */}
          <div className="space-y-1.5">
            <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider block">
              Pilihan Basemap
            </label>
            <div className="grid grid-cols-3 gap-1 p-1 rounded-lg bg-muted/50 border border-border">
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
                    className={`py-1.5 px-2 rounded-md text-xs font-medium transition-all text-center min-h-[30px] ${
                      isSelected
                        ? "bg-primary text-primary-foreground shadow-xs font-semibold"
                        : "text-muted-foreground hover:text-foreground hover:bg-background/50"
                    }`}
                  >
                    {b.label}
                  </button>
                );
              })}
            </div>
          </div>

          <Separator />

          {/* Reset Map Action */}
          <Button
            variant="outline"
            size="sm"
            onClick={onResetView}
            className="w-full justify-center gap-2 h-9 text-xs"
          >
            <Compass className="w-3.5 h-3.5 text-primary shrink-0" />
            <span>Reset Tampilan Peta</span>
          </Button>

          {/* Timestamp Info */}
          <div className="pt-1 text-[11px] text-muted-foreground space-y-1">
            <div className="flex items-center gap-1.5">
              <Clock className="w-3 h-3 text-primary shrink-0" />
              <span className="truncate">
                Data toko:{" "}
                <strong className="text-foreground font-medium">
                  {lastStoreUpdate ? formatIndonesianDateTime(lastStoreUpdate) : "Terbaru"}
                </strong>
              </span>
            </div>
            <div className="flex items-center gap-1.5 pl-4.5">
              <span className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 ${
                storeSyncSource === "GOOGLE_SHEETS" ? "bg-emerald-500" : "bg-primary"
              }`} />
              <span className="text-[10px] truncate">
                {storeSyncSource === "GOOGLE_SHEETS"
                  ? "Google Sheets (Sinkron)"
                  : "Master Toko Lokal"}
              </span>
            </div>
          </div>
        </>
      )}
    </div>
  );

  return (
    <>
      {/* 1. DESKTOP FLOATING PANEL (Always visible on large screens) */}
      <div className="hidden lg:flex absolute top-[72px] left-4 z-[400] flex-col pointer-events-auto transition-all duration-200 w-[min(276px,calc(100vw-1.5rem))]">
        {isMinimized ? (
          <button
            onClick={() => setIsMinimized(false)}
            className={`p-2.5 rounded-xl shadow-xl backdrop-blur-md transition-all hover:scale-105 flex items-center justify-center ${
              isDark
                ? "bg-slate-900/95 border border-slate-700 text-white hover:bg-slate-800"
                : "bg-white/95 border border-slate-300 text-slate-800 hover:bg-slate-100 shadow-md"
            }`}
            title="Buka Kontrol Peta"
            aria-label="Buka Kontrol Peta"
          >
            <Layers className="w-4 h-4 text-cyan-500" />
            {showRadar && (
              <span className="w-2 h-2 rounded-full bg-cyan-400 animate-ping ml-1" />
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
                <ChevronLeft className="w-4 h-4" />
              </Button>
            )}
          </div>

          {/* Scrollable Content */}
          <div className="flex-1 p-3.5 overflow-y-auto space-y-4">
            {renderControlContent()}
          </div>
        </aside>
      ) : null}

      {/* ========================================================================= */}
      {/* 2. MOBILE BOTTOM SHEET (Modal sheet for touch screens)                   */}
      {/* ========================================================================= */}
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
            className={`relative w-full rounded-t-2xl shadow-2xl p-4 sm:p-5 border-t max-h-[82vh] overflow-y-auto overscroll-y-contain pb-20 animate-in slide-in-from-bottom duration-200 z-10 ${
              isDark
                ? "bg-slate-900 border-slate-800 text-white"
                : "bg-white border-slate-200 text-slate-900"
            }`}
          >
            {/* Sheet Handle */}
            <div className="w-12 h-1 bg-muted-foreground/30 rounded-full mx-auto mb-3" />

            {/* Header */}
            <div className="flex items-center justify-between pb-3 border-b border-border mb-3.5">
              <div className="flex items-center gap-2">
                <SlidersHorizontal className="w-4 h-4 text-primary" />
                <div>
                  <h3 className="font-semibold text-xs text-foreground leading-tight">Kontrol Peta</h3>
                  <span className="text-[10px] text-muted-foreground leading-tight">
                    Layer, basemap, dan parameter monitoring
                  </span>
                </div>
              </div>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={onCloseMobileSheet}
                className="h-8 w-8 text-muted-foreground hover:text-foreground"
                aria-label="Tutup Kontrol Peta"
              >
                <X className="w-4 h-4" />
              </Button>
            </div>

            {/* Content */}
            {renderControlContent()}
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
