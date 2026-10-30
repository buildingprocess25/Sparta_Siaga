"use client";

import React, { useEffect, useMemo, useState, useCallback, Suspense } from "react";
import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import { Activity, AlertTriangle, Building2, Clock, Filter, Layers, List, Loader2, MapPin, Radio, Search, Store as StoreIcon, X } from "lucide-react";
import { useSiaga } from "@/components/layout/siaga-context";
type MapMode = "event" | "store" | "dc";
import { MapControls } from "@/components/map/map-controls";
import { LocationDetailPanel, type FacilityDetail } from "@/components/map/location-detail-panel";
import { LocationListSheet } from "@/components/map/location-list-sheet";
import { EarthquakeListModal } from "@/components/disaster/earthquake-list-modal";
import { assessStoreRisk } from "@/lib/haversine";
import type { Store } from "@/types/store";

function MonitoringDeepLinkHandler() {
  const searchParams = useSearchParams();
  const { disasterData, handleFocusDisaster, setActiveLayer, computedStores, handleSelectStore } = useSiaga();
  const handledDisasterIdRef = React.useRef<string | null>(null);
  const handledStoreIdRef = React.useRef<string | null>(null);

  const disasterId = searchParams.get("disasterId");
  const storeId = searchParams.get("storeId");

  // Reset tracking refs if query parameter is removed
  useEffect(() => {
    if (!disasterId) handledDisasterIdRef.current = null;
  }, [disasterId]);

  useEffect(() => {
    if (!storeId) handledStoreIdRef.current = null;
  }, [storeId]);

  // Handle earthquake deep link
  useEffect(() => {
    if (!disasterId || disasterId === handledDisasterIdRef.current || !disasterData) {
      return;
    }

    const allEqs = [
      ...(disasterData.activeEarthquakes || []),
      ...(disasterData.recentEarthquakes || []),
    ];
    const target = allEqs.find((e) => e.id === disasterId || e.id.includes(disasterId));
    if (target) {
      handledDisasterIdRef.current = disasterId;
      handleFocusDisaster(target);
      setActiveLayer("earthquake");
    }
  }, [disasterId, disasterData, handleFocusDisaster, setActiveLayer]);

  // Handle store deep link
  useEffect(() => {
    if (!storeId || storeId === handledStoreIdRef.current || computedStores.length === 0) {
      return;
    }

    const targetStore = computedStores.find(
      (s) => s.id === storeId || s.kode_toko === storeId
    );
    if (targetStore) {
      handledStoreIdRef.current = storeId;
      handleSelectStore(targetStore);
    }
  }, [storeId, computedStores, handleSelectStore]);

  return null;
}

const MapView = dynamic(
  () => import("@/components/map/map-view").then((mod) => mod.MapView),
  {
    ssr: false,
    loading: () => (
      <div className="w-full h-full bg-slate-100 dark:bg-slate-900 animate-pulse flex flex-col items-center justify-center gap-3">
        <Loader2 className="w-10 h-10 animate-spin text-blue-600" />
        <span className="text-slate-500 font-medium text-xs">
          Memuat SPARTA Geospatial Engine...
        </span>
      </div>
    ),
  }
);

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

export default function MonitoringPage() {
  // Mode Kejadian is the strict default mode
  const [mapMode, setMapMode] = useState<MapMode>("event");
  const [facilities, setFacilities] = useState<FacilityDetail[]>([]);
  const [facilityType, setFacilityType] = useState("");
  const [facilityBranch, setFacilityBranch] = useState("");
  const [facilityStatus, setFacilityStatus] = useState("");
  const [facilityMapping, setFacilityMapping] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [filterOpen, setFilterOpen] = useState(false);
  const [facilityFetchError, setFacilityFetchError] = useState(false);
  const [facilityRefreshKey, setFacilityRefreshKey] = useState(0);
  const [isLocationListOpen, setIsLocationListOpen] = useState(false);
  const [selectedFacility, setSelectedFacility] = useState<FacilityDetail | null>(null);
  const [isEarthquakeModalOpen, setIsEarthquakeModalOpen] = useState(false);
  const [viewport, setViewport] = useState<{ north: number; south: number; east: number; west: number } | null>(null);
  const [isMobile, setIsMobile] = useState(false);
  const [isMobileControlsOpen, setIsMobileControlsOpen] = useState(false);
  const [lastStoreUpdate, setLastStoreUpdate] = useState<string | null>(null);
  const [storeSyncSource, setStoreSyncSource] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/stores/sync")
      .then((r) => (r.ok ? r.json() : null))
      .then((res) => {
        if (res?.lastSync) {
          setLastStoreUpdate(res.lastSync.completed_at || res.lastSync.started_at || null);
          setStoreSyncSource(res.lastSync.sourceType || (res.lastSync.sync_source?.includes("GOOGLE") ? "GOOGLE_SHEETS" : "LOCAL_MASTER"));
        }
      })
      .catch((e) => console.error("[MonitoringPage] Gagal memuat status sinkronisasi toko:", e));
  }, []);

  const {
    computedStores,
    disasterData,
    basemap,
    setBasemap,
    incidentOnly,
    setIncidentOnly,
    statusFilter,
    selectedStore,
    handleSelectStore,
    flyToTarget,
    showRadar,
    setShowRadar,
    radarData,
    activeLayer,
    setActiveLayer,
    dangerCount,
    warningCount,
    handleResetView,
    handleFocusDisaster,
    setIsAffectedSheetOpen,
    theme,
    mapTimeFilter,
    setMapTimeFilter,
    selectedEarthquake,
    clearEventFocus,
  } = useSiaga();

  const isDark = theme === "dark";

  // Detect mobile screen for responsive side-panel vs bottom-sheet
  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 1024);
    };
    checkMobile();
    window.addEventListener("resize", checkMobile);
    return () => window.removeEventListener("resize", checkMobile);
  }, []);

  // Stabilized viewport callback with threshold check to prevent infinite re-render cycles
  const handleViewportChange = useCallback(
    (next: { north: number; south: number; east: number; west: number }) => {
      setViewport((prev) => {
        if (!prev) return next;
        const diff = Math.max(
          Math.abs(prev.north - next.north),
          Math.abs(prev.south - next.south),
          Math.abs(prev.east - next.east),
          Math.abs(prev.west - next.west)
        );
        if (diff < 0.05) return prev;
        return next;
      });
    },
    []
  );

  // Fetch facilities for both Event Mode (evaluated alongside stores) and Location Mode
  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams();
    if (mapMode === "dc") {
      params.set("type", "DC");
      if (facilityBranch) params.set("branch", facilityBranch);
      if (facilityStatus) params.set("status", facilityStatus);
      if (facilityMapping) params.set("mapping", facilityMapping);
    }
    // DC mode loads the small branch-scoped master dataset, not only the
    // current map bounds. Avoid hiding DCs located outside the first viewport.
    if (viewport && mapMode !== "dc") {
      Object.entries(viewport).forEach(([key, value]) => params.set(key, String(value)));
    }

    setFacilityFetchError(false);
    fetch(`/api/locations/facilities?${params}`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        const text = await response.text();
        const payload = text ? JSON.parse(text) : {};
        if (!response.ok) throw new Error(payload.error || "Gagal memuat fasilitas");
        setFacilities(payload.data || []);
        setFacilityFetchError(false);
      })
      .catch((error) => {
        if (error instanceof Error && error.name !== "AbortError") {
          // Retain last known facilities if network fails; do not silently
          // present an empty map as if there were no facilities.
          setFacilityFetchError(true);
        }
      });

    return () => controller.abort();
  }, [facilityBranch, facilityMapping, facilityStatus, facilityType, mapMode, viewport, facilityRefreshKey]);

  // Active operational earthquakes filtered strictly by active window (24h or 72h max)
  const activeQuakes = useMemo(() => {
    const allActive = disasterData?.activeEarthquakes || [];
    const maxHours = mapTimeFilter === "24h" ? 24 : 72;
    const maxAgeMs = maxHours * 60 * 60 * 1000;
    const now = Date.now();
    return allActive.filter((eq) => now - eq.timestamp <= maxAgeMs);
  }, [disasterData, mapTimeFilter]);

  const latestEq = selectedEarthquake && activeQuakes.some(eq => eq.id === selectedEarthquake.id)
    ? selectedEarthquake
    : activeQuakes[0] || disasterData?.latestBmkgEarthquake;

  // Map earthquakes: All earthquakes within the active time window (24h or 72h) are rendered.
  // The focused earthquake is highlighted with a pulse ring via selectedEarthquakeId.
  const mapEarthquakes = activeQuakes;

  // Convert facilities to Store-compatible format with evaluated earthquake risk
  const locationModeStores = useMemo<Store[]>(() => {
    return facilities
      .filter((facility) => {
        // A missing master coordinate must not turn into a fictitious 0° point.
        if (facility.latitude == null || facility.longitude == null) return false;
        const lat = Number(facility.latitude);
        const lng = Number(facility.longitude);
        return Number.isFinite(lat) && Number.isFinite(lng) &&
          lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180 &&
          !(lat === 0 && lng === 0);
      })
      .map((facility) => {
      const lat = Number(facility.latitude);
      const lng = Number(facility.longitude);
      const risk = assessStoreRisk({ latitude: lat, longitude: lng }, mapEarthquakes);
      const isDanger = risk.spatialRisk === "PRIORITY_MONITOR";
      const isWarning = risk.spatialRisk === "MONITOR";

      return {
        id: `FACILITY:${facility.id}`,
        kode_toko: facility.code,
        nama_toko: facility.name,
        cabang: facility.branch_id || "Belum dipetakan",
        alamat: facility.mapping_verified_at
          ? "Mapping cabang terverifikasi"
          : "Mapping cabang perlu dilengkapi",
        latitude: lat,
        longitude: lng,
        fr_type: `FACILITY_${facility.facility_type}`,
        status: risk.spatialRisk,
        spatialRisk: risk.spatialRisk,
        operationalStatus: facility.operational_status === "ACTIVE" ? "NONE" : "RESOLVED",
        visualStatus: isDanger ? "PERLU_PERHATIAN" : isWarning ? "PERLU_PERHATIAN" : "NORMAL",
        distanceFromDisasterKm: risk.distanceFromEventKm,
        riskSourceEvent: risk.riskSourceEvent,
      };
    });
  }, [facilities, mapEarthquakes]);

  // Each category has its own marker set: no mixed Store/DC results.
  // Event mode intentionally includes both to evaluate risk geographically.
  const displayedLocations = useMemo<Store[]>(() => {
    const isValid = (loc: Store) =>
      loc.latitude != null && loc.longitude != null &&
      Number.isFinite(Number(loc.latitude)) && Number.isFinite(Number(loc.longitude)) &&
      !(Number(loc.latitude) === 0 && Number(loc.longitude) === 0) &&
      Math.abs(Number(loc.latitude)) <= 90 && Math.abs(Number(loc.longitude)) <= 180;
    const inBranch = (loc: Store) =>
      !facilityBranch || (loc.cabang || "").toLowerCase() === facilityBranch.toLowerCase();
    const realStores = computedStores.filter(loc => isValid(loc) && inBranch(loc));
    const dcs = locationModeStores.filter(loc =>
      isValid(loc) && loc.fr_type === "FACILITY_DC" && inBranch(loc)
    );
    let list = mapMode === "store" ? realStores
      : mapMode === "dc" ? dcs
      : [...realStores, ...dcs];

    if (mapMode !== "event" && searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      list = list.filter(loc =>
        (loc.kode_toko || "").toLowerCase().includes(q) ||
        (loc.nama_toko || "").toLowerCase().includes(q) ||
        (loc.cabang || "").toLowerCase().includes(q)
      );
    }
    if (mapMode === "dc") {
      if (facilityStatus) {
        list = list.filter(loc => facilities.some(f => "FACILITY:" + f.id === loc.id &&
          f.operational_status === facilityStatus));
      }
      if (facilityMapping) {
        list = list.filter(loc => facilities.some(f => "FACILITY:" + f.id === loc.id &&
          (facilityMapping === "mapped" ? Boolean(f.mapping_verified_at) : !f.mapping_verified_at)));
      }
    }
    return list;
  }, [mapMode, computedStores, locationModeStores, searchQuery, facilityBranch,
      facilityStatus, facilityMapping, facilities]);

  const facilityByStoreId = useMemo(
    () => new Map(facilities.map((facility) => [`FACILITY:${facility.id}`, facility])),
    [facilities]
  );

  const branchOptions = useMemo(
    () => [...new Set([
      ...facilities.map((facility) => facility.branch_id),
      ...computedStores.map((store) => store.cabang),
    ].filter((branch): branch is string => Boolean(branch)))].sort((a, b) => a.localeCompare(b, "id")),
    [facilities, computedStores]
  );

  // Selected item detail resolver
  const activeDetailStore = selectedStore;
  const activeDetailFacility = selectedFacility || (selectedStore ? facilityByStoreId.get(selectedStore.id) : null);

  const handleCloseDetail = () => {
    handleSelectStore(null as any);
    setSelectedFacility(null);
  };

  const handleCloseAllSheets = () => {
    setFilterOpen(false);
    setIsLocationListOpen(false);
    setIsEarthquakeModalOpen(false);
    setIsAffectedSheetOpen(false);
    setIsMobileControlsOpen(false);
    handleCloseDetail();
  };

  const handleOpenFilter = () => {
    handleCloseAllSheets();
    setFilterOpen(true);
  };

  const handleOpenLocationList = () => {
    handleCloseAllSheets();
    setIsLocationListOpen(true);
  };

  const handleOpenEvaluated = () => {
    handleCloseAllSheets();
    setIsAffectedSheetOpen(true);
  };

  const handleOpenEarthquakes = () => {
    handleCloseAllSheets();
    setIsEarthquakeModalOpen(true);
  };

  const handleModeChange = (m: MapMode) => {
    setMapMode(m);
    setSearchQuery("");
    setFacilityBranch("");
    setFacilityStatus("");
    setFacilityMapping("");
    handleCloseAllSheets();
  };

  const handleResetLocationFilters = () => {
    setSearchQuery("");
    setFacilityType("");
    setFacilityBranch("");
    setFacilityStatus("");
    setFacilityMapping("");
  };

  return (
    <div className="w-full h-full relative overflow-hidden flex flex-col bg-slate-900">
      <Suspense fallback={null}>
        <MonitoringDeepLinkHandler />
      </Suspense>
      {/* 1. FLOATING TOP CONTROL OVERLAY (NASA FIRMS Inspired, Task 1 & Task 5) */}
      {/* 1. Floating Map Mode & Controls Toolbar with Safe Area & Responsive Layout */}
      <div className="absolute top-2.5 left-2.5 right-2.5 sm:top-4 sm:left-4 sm:right-4 z-[450] pointer-events-none flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        {/* Left: Floating Mode Switcher Pill + Mobile Kontrol Peta Button */}
        <div className="pointer-events-auto flex items-center justify-between sm:justify-start gap-1.5 flex-nowrap w-full sm:w-auto">
          {/* Floating Mode Switcher Pill: [ Kejadian | Toko | DC ] */}
          <div
            role="tablist"
            aria-label="Jenis monitoring peta"
            className={`flex items-center p-1 rounded-xl shadow-lg backdrop-blur-md border ${
              isDark
                ? "bg-slate-900/90 border-slate-700/80"
                : "bg-white/95 border-slate-200 shadow-md"
            }`}
          >
            {[
              { id: "event" as const, label: "Kejadian", icon: Activity },
              { id: "store" as const, label: "Toko", icon: StoreIcon },
              { id: "dc" as const, label: "DC", icon: Building2 },
            ].map((tab) => {
              const Icon = tab.icon;
              const selected = mapMode === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  onClick={() => handleModeChange(tab.id)}
                  className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold transition-all min-h-[40px] ${
                    selected
                      ? "bg-[#1D5AA6] text-white shadow-sm font-bold"
                      : isDark
                      ? "text-slate-300 hover:text-white hover:bg-white/5"
                      : "text-slate-600 hover:text-slate-900 hover:bg-slate-100"
                  }`}
                >
                  <Icon className="w-4 h-4 shrink-0" />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </div>

          {/* Tombol Kontrol Peta Mobile */}
          <button
            type="button"
            onClick={() => setIsMobileControlsOpen(true)}
            className={`lg:hidden inline-flex items-center gap-1.5 px-3 py-2 rounded-xl shadow-lg backdrop-blur-md border text-xs font-bold transition-all min-h-[40px] shrink-0 ${
              isDark
                ? "bg-slate-900/90 hover:bg-slate-800 border-slate-700/80 text-cyan-400"
                : "bg-white/95 hover:bg-slate-50 border-slate-200 text-[#123B6D] shadow-md"
            }`}
            aria-label="Buka Kontrol Peta"
            title="Buka Kontrol Peta"
          >
            <Layers className="w-4 h-4 text-cyan-500 shrink-0" />
            <span>Kontrol Peta</span>
            {showRadar && <span className="w-2 h-2 rounded-full bg-cyan-400 animate-ping" />}
          </button>
        </div>

        {/* Right: Floating Mode Actions & Context Info */}
        <div className="pointer-events-auto flex items-center gap-1.5 overflow-x-auto max-w-full pb-0.5 sm:pb-0 scrollbar-none">
          {mapMode === "event" ? (
            <div
              className={`flex items-center gap-1.5 p-1.5 rounded-xl shadow-lg backdrop-blur-md border ${
                isDark
                  ? "bg-slate-900/90 border-slate-700/80 text-white"
                  : "bg-white/95 border-slate-200 text-slate-800 shadow-md"
              }`}
            >
              {latestEq && (
                <div
                  className="hidden md:flex items-center gap-1.5 px-2.5 py-1.5 max-w-[280px] xl:max-w-[360px] truncate text-xs"
                  title={latestEq.title || latestEq.place}
                >
                  <span className="font-bold text-red-500 bg-red-50 dark:bg-red-950/60 px-1.5 py-0.5 rounded text-[11px]">
                    M {latestEq.magnitude}
                  </span>
                  <span className="truncate text-slate-600 dark:text-slate-300">
                    {latestEq.title || latestEq.place}
                  </span>
                </div>
              )}
              <button
                type="button"
                onClick={handleOpenEarthquakes}
                className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold transition-colors min-h-[38px] ${
                  isDark ? "hover:bg-slate-800 text-slate-200" : "hover:bg-slate-100 text-slate-700"
                }`}
              >
                <List className="w-4 h-4 text-blue-500" />
                <span>Gempa ({activeQuakes.length})</span>
              </button>
              <button
                type="button"
                onClick={handleOpenEvaluated}
                className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold transition-colors min-h-[38px] ${
                  isDark ? "hover:bg-slate-800 text-slate-200" : "hover:bg-slate-100 text-slate-700"
                }`}
              >
                <AlertTriangle className="w-4 h-4 text-amber-500" />
                <span>Prioritas ({dangerCount})</span>
              </button>
              {latestEq && (
                <button
                  type="button"
                  onClick={() => handleFocusDisaster(latestEq)}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold bg-red-600 hover:bg-red-700 text-white shadow-sm transition-colors min-h-[38px]"
                  title="Pusatkan peta ke episentrum gempa"
                >
                  <MapPin className="w-4 h-4" />
                  <span className="hidden sm:inline">Episentrum</span>
                </button>
              )}
            </div>
          ) : (
            <div
              className={`flex items-center gap-2 p-1.5 rounded-xl shadow-lg backdrop-blur-md border max-w-full ${
                isDark
                  ? "bg-slate-900/90 border-slate-700/80 text-white"
                  : "bg-white/95 border-slate-200 text-slate-800 shadow-md"
              }`}
            >
              {/* Search bar */}
              <div className="relative flex items-center min-w-0">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input
                  type="search"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  aria-label={mapMode === "store" ? "Cari nama atau kode toko" : "Cari nama atau kode DC"}
                  placeholder={mapMode === "store" ? "Cari nama atau kode toko..." : "Cari nama atau kode DC..."}
                  className={`h-9 w-32 sm:w-44 md:w-56 rounded-lg border py-1.5 pl-8 pr-2.5 text-xs outline-none focus:border-blue-500 transition-all ${
                    isDark
                      ? "bg-slate-800/80 border-slate-700 text-white placeholder-slate-400"
                      : "bg-slate-50 border-slate-200 text-slate-900 placeholder-slate-400"
                  }`}
                />
              </div>

              <button
                type="button"
                onClick={handleOpenFilter}
                className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold transition-colors min-h-[38px] ${
                  facilityBranch || facilityStatus || facilityMapping
                    ? "bg-blue-50 dark:bg-blue-950/60 text-[#1D5AA6] dark:text-blue-400 font-bold"
                    : isDark
                    ? "hover:bg-slate-800 text-slate-200"
                    : "hover:bg-slate-100 text-slate-700"
                }`}
              >
                <Filter className="w-4 h-4 text-[#1D5AA6] dark:text-blue-400" />
                <span>Filter {mapMode === "store" ? "Toko" : "DC"}</span>
              </button>

              <button
                type="button"
                onClick={handleOpenLocationList}
                className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold transition-colors min-h-[38px] ${
                  isDark ? "hover:bg-slate-800 text-slate-200" : "hover:bg-slate-100 text-slate-700"
                }`}
              >
                <List className="w-4 h-4 text-blue-500" />
                <span>Daftar ({displayedLocations.length})</span>
              </button>

              {(searchQuery || facilityBranch || facilityStatus || facilityMapping) && (
                <button
                  type="button"
                  onClick={handleResetLocationFilters}
                  className="inline-flex items-center px-2.5 py-1.5 rounded-lg text-xs font-medium text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors min-h-[38px]"
                  title="Reset pencarian dan filter"
                >
                  Reset
                </button>
              )}

              {/* Data toko terakhir diperbarui status pill */}
              <div className={`hidden lg:flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-[11px] shadow-sm backdrop-blur-md min-h-[34px] ${
                isDark ? "bg-slate-800/80 border-slate-700 text-slate-300" : "bg-slate-50 border-slate-200 text-slate-600"
              }`}>
                <Clock className="w-3.5 h-3.5 text-blue-500 dark:text-cyan-400 shrink-0" />
                <span>
                  Data toko terakhir diperbarui:{" "}
                  <strong className={isDark ? "text-white font-semibold" : "text-slate-900 font-semibold"}>
                    {lastStoreUpdate ? formatIndonesianDateTime(lastStoreUpdate) : "Terbaru (Sinkron)"}
                  </strong>
                </span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Floating alert if facility data fails to refresh */}
      {facilityFetchError && (
        <div
          role="status"
          className="absolute top-16 right-3 sm:top-20 sm:right-4 z-[460] max-w-sm rounded-xl border border-amber-300 dark:border-amber-800 bg-amber-50/95 dark:bg-amber-950/90 p-3 text-xs text-amber-900 dark:text-amber-200 shadow-xl backdrop-blur-md flex items-center justify-between gap-3 animate-in fade-in"
        >
          <div className="flex items-center gap-2 min-w-0">
            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
            <span className="leading-tight">Data fasilitas terbaru gagal dimuat. Peta mempertahankan data terakhir.</span>
          </div>
          <button
            type="button"
            className="shrink-0 rounded-lg border border-amber-400 px-2 py-1 text-[11px] font-bold hover:bg-amber-100 dark:hover:bg-amber-900 transition-colors"
            onClick={() => setFacilityRefreshKey((key) => key + 1)}
          >
            Coba lagi
          </button>
        </div>
      )}

      {/* 2. Interactive map with maximum available space */}
      <div className="flex-1 relative w-full h-full flex overflow-hidden">
        {/* INTERACTIVE MAP AREA (Takes maximum available space) */}
        <div className="flex-1 relative h-full w-full min-w-0 z-0">
          <MapView
            stores={displayedLocations}
            locationMode={mapMode}
            earthquakes={mapMode === "event" ? mapEarthquakes : []}
            selectedEarthquakeId={selectedEarthquake?.id}
            floodReports={mapMode === "event" ? disasterData?.floodReports || [] : []}
            basemap={basemap}
            incidentOnly={mapMode === "event" && incidentOnly}
            statusFilter={mapMode === "event" ? statusFilter : "all"}
            selectedStore={selectedStore}
            onSelectStore={(store) => {
              setFilterOpen(false);
              setIsLocationListOpen(false);
              setIsEarthquakeModalOpen(false);
              setIsAffectedSheetOpen(false);
              const fac = facilityByStoreId.get(store.id);
              if (fac) {
                setSelectedFacility(fac);
              } else {
                setSelectedFacility(null);
              }
              handleSelectStore(store);
            }}
            flyToTarget={flyToTarget}
            showRadar={mapMode === "event" && showRadar}
            radarTileUrl={radarData?.tileUrl}
            activeLayer={mapMode === "event" ? activeLayer : "stores"}
            theme={theme}
            onViewportChange={handleViewportChange}
          />
          {mapMode === "dc" && displayedLocations.length === 0 && !facilityFetchError && (
            <div role="status" className="pointer-events-none absolute bottom-20 left-1/2 z-[450] w-[min(360px,calc(100%-24px))] -translate-x-1/2 rounded-xl border border-slate-200 bg-white/95 p-4 text-center shadow-lg dark:border-slate-700 dark:bg-slate-900/95">
              <p className="text-sm font-semibold text-slate-900 dark:text-white">Belum ada titik DC yang bisa ditampilkan</p>
              <p className="mt-1 text-xs leading-relaxed text-slate-600 dark:text-slate-300">
                {facilities.length === 0
                  ? "Master DC belum tersedia untuk cakupan akun ini, atau datanya belum dimuat."
                  : "Periksa koordinat DC dan filter cabang/status pada master fasilitas."}
              </p>
            </div>
          )}
          {/* Map Controls (Desktop floating panel + Mobile bottom sheet) */}
          <MapControls
            locationMode={mapMode}
            lastStoreUpdate={lastStoreUpdate}
            storeSyncSource={storeSyncSource}
            latestEarthquake={latestEq}
            incidentOnly={incidentOnly}
            onToggleIncidentOnly={() => setIncidentOnly((prev) => !prev)}
            basemap={basemap}
            onChangeBasemap={setBasemap}
            onResetView={handleResetView}
            totalStoresCount={displayedLocations.length}
            affectedStoresCount={dangerCount}
            showRadar={showRadar}
            onToggleRadar={() => setShowRadar((prev) => !prev)}
            theme={theme}
            activeLayer={activeLayer}
            onLayerChange={setActiveLayer}
            mapTimeFilter={mapTimeFilter}
            onChangeMapTimeFilter={(value) => {
              setMapTimeFilter(value);
              if (selectedEarthquake) {
                const maxAgeMs = (value === "24h" ? 24 : 72) * 60 * 60 * 1000;
                if (Date.now() - selectedEarthquake.timestamp > maxAgeMs) {
                  clearEventFocus();
                }
              }
            }}
            selectedEarthquake={selectedEarthquake}
            onClearEventFocus={clearEventFocus}
            isMobileSheetOpen={isMobileControlsOpen}
            onCloseMobileSheet={() => setIsMobileControlsOpen(false)}
          />
        </div>

        {/* CONTEXTUAL DETAIL PANEL (DESKTOP: Slide-in Side Panel) */}
        {!isMobile && (activeDetailStore || activeDetailFacility) && (
          <LocationDetailPanel
            location={activeDetailStore}
            facility={activeDetailFacility}
            onClose={handleCloseDetail}
            isMobile={false}
            currentEarthquake={latestEq}
          />
        )}
      </div>

      {/* CONTEXTUAL DETAIL SHEET (MOBILE: Non-overlapping Bottom Sheet with safe-area padding - Detail fasilitas) */}
      {isMobile && (activeDetailStore || activeDetailFacility) && (
        <div data-testid="detail-fasilitas-sheet" aria-label="Detail fasilitas">
          <LocationDetailPanel
            location={activeDetailStore}
            facility={activeDetailFacility}
            onClose={handleCloseDetail}
            isMobile={true}
            currentEarthquake={latestEq}
          />
        </div>
      )}

      {/* 3. LOCATION LIST SHEET (List-First Alternative) */}
      <LocationListSheet
        isOpen={isLocationListOpen}
        onClose={() => setIsLocationListOpen(false)}
        locations={displayedLocations}
        onSelectLocation={(loc) => {
          const fac = facilityByStoreId.get(loc.id);
          setSelectedFacility(fac || null);
          handleSelectStore(loc);
        }}
        selectedLocationId={selectedStore?.id}
        mapMode={mapMode === "event" ? "event" : "location"}
        theme={theme}
      />

      {/* 4. EARTHQUAKE LIST MODAL */}
      <EarthquakeListModal
        isOpen={isEarthquakeModalOpen}
        onClose={() => setIsEarthquakeModalOpen(false)}
        earthquakes={activeQuakes}
        onSelectEarthquake={(eq) => {
          handleFocusDisaster(eq);
          setIsEarthquakeModalOpen(false);
        }}
        selectedEarthquakeId={latestEq?.id}
        theme={theme}
      />

      {/* 5. FACILITY FILTER MODAL (Compatible with test selector) */}
      {filterOpen && (
        <div
          className="fixed inset-0 z-[3000] flex items-end sm:items-center sm:justify-center p-0 sm:p-5 bg-slate-950/60 backdrop-blur-xs"
          role="dialog"
          aria-modal="true"
          aria-label="Filter fasilitas"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setFilterOpen(false);
          }}
        >
          <div className="w-full rounded-t-3xl sm:rounded-2xl bg-white dark:bg-slate-900 p-4 sm:p-5 text-slate-900 dark:text-white shadow-2xl sm:max-w-md border border-slate-200 dark:border-slate-800 pb-28 sm:pb-5 max-h-[85vh] overflow-y-auto">
            <div className="sm:hidden w-full flex justify-center pb-2">
              <div className="w-12 h-1.5 rounded-full bg-slate-300 dark:bg-slate-700" />
            </div>
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <h2 className="font-bold text-sm">{mapMode === "store" ? "Filter Toko" : "Filter DC"}</h2>
              <button
                type="button"
                onClick={() => setFilterOpen(false)}
                className="p-1 rounded text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 min-h-[44px] min-w-[44px] grid place-items-center"
                aria-label="Tutup filter"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="mt-4 space-y-3 text-xs">
              <div>
                <label className="block font-semibold text-slate-600 dark:text-slate-400 mb-1">
                  Cabang Operasional
                </label>
                <select
                  value={facilityBranch}
                  onChange={(e) => setFacilityBranch(e.target.value)}
                  className="w-full min-h-[44px] rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 text-xs"
                >
                  <option value="">Semua Cabang</option>
                  {branchOptions.map((b) => (
                    <option key={b} value={b}>
                      Cabang {b}
                    </option>
                  ))}
                </select>
              </div>

              {mapMode === "dc" && <div>
                <label className="block font-semibold text-slate-600 dark:text-slate-400 mb-1">
                  Status Operasional
                </label>
                <select
                  value={facilityStatus}
                  onChange={(e) => setFacilityStatus(e.target.value)}
                  className="w-full min-h-[44px] rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 text-xs"
                >
                  <option value="">Semua Status</option>
                  <option value="ACTIVE">Aktif</option>
                  <option value="INACTIVE">Tidak Aktif</option>
                </select>
              </div>}

              {mapMode === "dc" && <div>
                <label className="block font-semibold text-slate-600 dark:text-slate-400 mb-1">
                  Status Pemetaan Cabang
                </label>
                <select
                  value={facilityMapping}
                  onChange={(e) => setFacilityMapping(e.target.value)}
                  className="w-full min-h-[44px] rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 text-xs"
                >
                  <option value="">Semua Status Mapping</option>
                  <option value="mapped">Terpetakan ke Cabang</option>
                  <option value="unmapped">Belum Terpetakan</option>
                </select>
              </div>}

              <div className="pt-2 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={handleResetLocationFilters}
                  className="px-3 py-2.5 rounded-lg border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 font-semibold text-xs min-h-[44px]"
                >
                  Reset Filter
                </button>
                <button
                  type="button"
                  onClick={() => setFilterOpen(false)}
                  className="px-3 py-2.5 rounded-lg bg-blue-700 hover:bg-blue-800 text-white font-semibold text-xs min-h-[44px]"
                >
                  Terapkan
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
