"use client";

import React, { useEffect, useMemo, useState, useCallback, Suspense } from "react";
import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import {
  Activity,
  AlertTriangle,
  Building2,
  Clock,
  Filter,
  Layers,
  List,
  Loader2,
  MapPin,
  Maximize2,
  Minimize2,
  Search,
  Store as StoreIcon,
  Wrench,
  X,
  SlidersHorizontal,
  Compass,
} from "lucide-react";
import { useSiaga } from "@/components/layout/siaga-context";
type MapMode = "event" | "store" | "dc";
import { MapControls } from "@/components/map/map-controls";
import {
  LocationDetailPanel,
  type FacilityDetail,
  type BranchSummaryDetail,
  type ClusterSummaryDetail,
} from "@/components/map/location-detail-panel";
import { LocationListSheet } from "@/components/map/location-list-sheet";
import { EarthquakeListModal } from "@/components/disaster/earthquake-list-modal";
import { assessStoreRisk } from "@/lib/haversine";
import type { Store } from "@/types/store";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

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
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
        <span className="text-muted-foreground font-medium text-xs">
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
  const [selectedBranch, setSelectedBranch] = useState<BranchSummaryDetail | null>(null);
  const [selectedCluster, setSelectedCluster] = useState<ClusterSummaryDetail | null>(null);
  const [isEarthquakeModalOpen, setIsEarthquakeModalOpen] = useState(false);
  const [viewport, setViewport] = useState<{ north: number; south: number; east: number; west: number } | null>(null);
  const [isMobile, setIsMobile] = useState(false);
  const [isControlPanelOpen, setIsControlPanelOpen] = useState(true);
  const [isMobileControlsOpen, setIsMobileControlsOpen] = useState(false);
  const [lastStoreUpdate, setLastStoreUpdate] = useState<string | null>(null);
  const [storeSyncSource, setStoreSyncSource] = useState<string | null>(null);
  const mapContainerRef = React.useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const toggleFullscreen = useCallback(async () => {
    if (!mapContainerRef.current) return;
    try {
      if (!document.fullscreenElement) {
        await mapContainerRef.current.requestFullscreen();
      } else {
        await document.exitFullscreen();
      }
    } catch (err) {
      console.warn("[MonitoringPage] Gagal beralih fullscreen:", err);
    }
  }, []);

  useEffect(() => {
    const onFullscreenChange = () => {
      const active = Boolean(document.fullscreenElement);
      setIsFullscreen(active);
      setTimeout(() => {
        window.dispatchEvent(new Event("resize"));
      }, 60);
    };
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, []);

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
    setFlyToTarget,
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
      const mobile = window.innerWidth < 1024;
      setIsMobile(mobile);
      if (mobile) {
        setIsControlPanelOpen(false);
      }
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

  // Fetch facilities for both Event Mode and Location Mode
  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams();
    if (mapMode === "dc") {
      params.set("type", "DC");
      if (facilityBranch) params.set("branch", facilityBranch);
      if (facilityStatus) params.set("status", facilityStatus);
      if (facilityMapping) params.set("mapping", facilityMapping);
    }
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

  const mapEarthquakes = activeQuakes;

  // Convert facilities to Store-compatible format with evaluated earthquake risk
  const locationModeStores = useMemo<Store[]>(() => {
    return facilities
      .filter((facility) => {
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

  const activeDetailStore = selectedStore;
  const activeDetailFacility = selectedFacility || (selectedStore ? facilityByStoreId.get(selectedStore.id) : null);

  const handleCloseDetail = () => {
    handleSelectStore(null as any);
    setSelectedFacility(null);
    setSelectedBranch(null);
    setSelectedCluster(null);
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
    // Mode-aware layer state synchronization: AHO is strictly restricted to Store mode
    if (m === "event") {
      if (activeLayer === "aho") {
        setActiveLayer("all");
      }
    } else if (m === "store") {
      if (activeLayer !== "aho" && activeLayer !== "stores") {
        setActiveLayer("stores");
      }
    } else if (m === "dc") {
      setActiveLayer("stores");
    }
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
    <div ref={mapContainerRef} className="w-full h-full relative overflow-hidden flex flex-col bg-background text-foreground select-none">
      <Suspense fallback={null}>
        <MonitoringDeepLinkHandler />
      </Suspense>

      {/* ========================================================================= */}
      {/* 1. MONITORING WORKSPACE HEADER (Compact Corporate Top Bar - Region A)     */}
      {/* ========================================================================= */}
      <header className="h-12 border-b border-border bg-card/95 px-3 md:px-4 flex items-center justify-between gap-2.5 shrink-0 z-30 select-none shadow-xs">
        {/* Left: Brand / Title + Controlled shadcn Tabs */}
        <div className="flex items-center gap-2.5 md:gap-3.5">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-[#0069a7] text-white flex items-center justify-center shrink-0 shadow-xs">
              <MapPin className="w-4 h-4" />
            </div>
            <span className="font-semibold text-xs tracking-tight text-foreground uppercase hidden sm:inline">
              Peta Monitoring
            </span>
          </div>

          {/* Mode Switcher Tabs [ Kejadian | Toko | DC ] */}
          <Tabs value={mapMode} onValueChange={(val) => handleModeChange(val as MapMode)}>
            <TabsList className="h-8 bg-muted/60 p-0.5 border border-border">
              <TabsTrigger
                value="event"
                className="h-7 text-xs px-2.5 font-medium data-[state=active]:bg-[#0069a7] data-[state=active]:text-white"
              >
                <Activity className="w-3.5 h-3.5 mr-1" />
                <span>Kejadian</span>
              </TabsTrigger>
              <TabsTrigger
                value="store"
                className="h-7 text-xs px-2.5 font-medium data-[state=active]:bg-[#0069a7] data-[state=active]:text-white"
              >
                <StoreIcon className="w-3.5 h-3.5 mr-1" />
                <span>Toko</span>
              </TabsTrigger>
              <TabsTrigger
                value="dc"
                className="h-7 text-xs px-2.5 font-medium data-[state=active]:bg-[#0069a7] data-[state=active]:text-white"
              >
                <Building2 className="w-3.5 h-3.5 mr-1" />
                <span>DC</span>
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        {/* Center: Contextual Search / Live Event Summary */}
        <div className="flex-1 max-w-md hidden md:flex items-center justify-center">
          {mapMode === "event" ? (
            latestEq && (
              <div className="flex items-center gap-2 px-2.5 py-1 rounded-md border border-border bg-muted/30 text-xs truncate max-w-full">
                <span className="font-bold text-red-600 dark:text-red-400 bg-red-500/10 px-1.5 py-0.5 rounded text-[10px]">
                  M {latestEq.magnitude}
                </span>
                <span className="truncate text-muted-foreground">
                  {latestEq.title || latestEq.place}
                </span>
              </div>
            )
          ) : (
            <div className="relative w-full max-w-xs">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={mapMode === "store" ? "Cari nama / kode toko..." : "Cari nama / kode DC..."}
                className="h-8 w-full rounded-md border border-input bg-background/80 py-1 pl-8 pr-2.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
          )}
        </div>

        {/* Right: Mode Actions & Control Rail Toggle & Fullscreen */}
        <div className="flex items-center gap-1.5">
          {mapMode === "event" ? (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={handleOpenEarthquakes}
                className="h-8 text-xs gap-1.5"
              >
                <List className="w-3.5 h-3.5 text-primary" />
                <span className="hidden sm:inline">Gempa</span> ({activeQuakes.length})
              </Button>

              <Button
                variant="outline"
                size="sm"
                onClick={handleOpenEvaluated}
                className="h-8 text-xs gap-1.5 text-amber-600 dark:text-amber-400"
              >
                <AlertTriangle className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Prioritas</span> ({dangerCount})
              </Button>

              {latestEq && (
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => handleFocusDisaster(latestEq)}
                  className="h-8 text-xs gap-1.5"
                  title="Pusatkan peta ke episentrum gempa"
                >
                  <MapPin className="w-3.5 h-3.5" />
                  <span className="hidden xl:inline">Episentrum</span>
                </Button>
              )}
            </>
          ) : (
            <>
              {mapMode === "store" && (
                <Button
                  variant={activeLayer === "aho" ? "default" : "outline"}
                  size="sm"
                  onClick={() => {
                    const next = activeLayer === "aho" ? "stores" : "aho";
                    setActiveLayer(next);
                    if (next !== "aho") handleCloseDetail();
                  }}
                  className={`h-8 text-xs gap-1.5 ${
                    activeLayer === "aho" ? "bg-amber-600 hover:bg-amber-700 text-white font-semibold" : ""
                  }`}
                  title="Tampilkan persebaran tiket AHO dari SPARTA Maintenance"
                >
                  <Wrench className={`w-3.5 h-3.5 ${activeLayer === "aho" ? "text-white" : "text-amber-500"}`} />
                  <span className="hidden sm:inline">Tiket AHO</span>
                </Button>
              )}

              <Button
                variant={facilityBranch || facilityStatus || facilityMapping ? "secondary" : "outline"}
                size="sm"
                onClick={handleOpenFilter}
                className="h-8 text-xs gap-1.5"
              >
                <Filter className="w-3.5 h-3.5 text-primary" />
                <span className="hidden sm:inline">Filter</span>
              </Button>

              <Button
                variant="outline"
                size="sm"
                onClick={handleOpenLocationList}
                className="h-8 text-xs gap-1.5"
              >
                <List className="w-3.5 h-3.5 text-primary" />
                <span className="hidden sm:inline">Daftar</span> ({displayedLocations.length})
              </Button>
            </>
          )}

          {/* Mobile Kontrol Peta button */}
          <Button
            variant="outline"
            size="sm"
            onClick={() => setIsMobileControlsOpen(true)}
            className="lg:hidden h-8 text-xs gap-1.5 text-primary"
          >
            <Layers className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Kontrol</span>
          </Button>

          {/* Desktop Left Rail Toggle Button */}
          <Button
            variant={isControlPanelOpen ? "secondary" : "outline"}
            size="icon-sm"
            onClick={() => setIsControlPanelOpen((prev) => !prev)}
            className="hidden lg:inline-flex h-8 w-8 text-muted-foreground hover:text-foreground"
            title={isControlPanelOpen ? "Tutup Panel Kontrol" : "Buka Panel Kontrol"}
            aria-label="Toggle Panel Kontrol"
          >
            <SlidersHorizontal className="w-3.5 h-3.5 text-primary" />
          </Button>

          {/* Fullscreen Toggle Button */}
          <Button
            variant="outline"
            size="icon-sm"
            onClick={toggleFullscreen}
            className="h-8 w-8 text-muted-foreground hover:text-foreground"
            title={isFullscreen ? "Keluar Layar Penuh (ESC)" : "Layar Penuh"}
            aria-label={isFullscreen ? "Keluar Layar Penuh" : "Layar Penuh"}
          >
            {isFullscreen ? (
              <Minimize2 className="w-3.5 h-3.5 text-primary" />
            ) : (
              <Maximize2 className="w-3.5 h-3.5" />
            )}
          </Button>
        </div>
      </header>

      {/* Floating alert if facility data fails to refresh */}
      {facilityFetchError && (
        <div
          role="status"
          className="absolute top-14 right-4 z-[460] max-w-sm rounded-lg border border-amber-500/30 bg-amber-500/10 p-2.5 text-xs text-amber-800 dark:text-amber-200 shadow-md backdrop-blur-xs flex items-center justify-between gap-3 animate-in fade-in"
        >
          <div className="flex items-center gap-2 min-w-0">
            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
            <span className="leading-tight">Data fasilitas gagal dimuat ulang. Peta mempertahankan data terakhir.</span>
          </div>
          <Button
            variant="outline"
            size="xs"
            onClick={() => setFacilityRefreshKey((key) => key + 1)}
            className="h-6 text-[10px]"
          >
            Coba lagi
          </Button>
        </div>
      )}

      {/* ========================================================================= */}
      {/* 2. MAIN WORKSPACE BODY: LEFT RAIL + MAP CANVAS + RIGHT DETAIL             */}
      {/* ========================================================================= */}
      <div className="flex-1 relative w-full h-[calc(100%-48px)] flex overflow-hidden">
        {/* Left Contextual Control Rail (Desktop integrated rail) */}
        <MapControls
          locationMode={mapMode}
          isOpen={isControlPanelOpen}
          onToggleOpen={() => setIsControlPanelOpen(false)}
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
          isFullscreen={isFullscreen}
          onToggleFullscreen={toggleFullscreen}
          isMobileSheetOpen={isMobileControlsOpen}
          onCloseMobileSheet={() => setIsMobileControlsOpen(false)}
        />

        {/* Map Canvas (Dominates the view - Region D) */}
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
            selectedBranch={selectedBranch}
            selectedCluster={selectedCluster}
            onSelectStore={(store) => {
              setFilterOpen(false);
              setIsLocationListOpen(false);
              setIsEarthquakeModalOpen(false);
              setIsAffectedSheetOpen(false);
              setSelectedBranch(null);
              setSelectedCluster(null);
              const fac = facilityByStoreId.get(store.id);
              if (fac) {
                setSelectedFacility(fac);
              } else {
                setSelectedFacility(null);
              }
              handleSelectStore(store);
            }}
            onSelectBranch={(branch) => {
              setFilterOpen(false);
              setIsLocationListOpen(false);
              setIsEarthquakeModalOpen(false);
              setIsAffectedSheetOpen(false);
              handleSelectStore(null as any);
              setSelectedFacility(null);
              setSelectedCluster(null);
              setSelectedBranch(branch);
            }}
            onSelectCluster={(cluster) => {
              setFilterOpen(false);
              setIsLocationListOpen(false);
              setIsEarthquakeModalOpen(false);
              setIsAffectedSheetOpen(false);
              handleSelectStore(null as any);
              setSelectedFacility(null);
              setSelectedBranch(null);
              setSelectedCluster(cluster);
            }}
            flyToTarget={flyToTarget}
            showRadar={mapMode === "event" && showRadar}
            radarTileUrl={radarData?.tileUrl}
            activeLayer={
              mapMode === "dc"
                ? "stores"
                : mapMode === "event" && activeLayer === "aho"
                ? "all"
                : activeLayer
            }
            theme={theme}
            onViewportChange={handleViewportChange}
          />

          {mapMode === "dc" && displayedLocations.length === 0 && !facilityFetchError && (
            <div role="status" className="pointer-events-none absolute bottom-20 left-1/2 z-[450] w-[min(360px,calc(100%-24px))] -translate-x-1/2 rounded-xl border border-border bg-card/95 p-4 text-center shadow-lg">
              <p className="text-sm font-semibold text-foreground">Belum ada titik DC yang bisa ditampilkan</p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                {facilities.length === 0
                  ? "Master DC belum tersedia untuk cakupan akun ini, atau datanya belum dimuat."
                  : "Periksa koordinat DC dan filter cabang/status pada master fasilitas."}
              </p>
            </div>
          )}
        </div>

        {/* Right Contextual Detail Panel (Desktop in-workspace panel - Region G) */}
        {!isMobile && (activeDetailStore || activeDetailFacility || selectedBranch || selectedCluster) && (
          <LocationDetailPanel
            location={activeDetailStore}
            facility={activeDetailFacility}
            branch={selectedBranch}
            cluster={selectedCluster}
            onClose={handleCloseDetail}
            isMobile={false}
            currentEarthquake={latestEq}
            activeLayer={activeLayer}
            onFlyTo={(lat, lng, zoom) => {
              setFlyToTarget({ lat, lng, zoom });
            }}
          />
        )}
      </div>

      {/* CONTEXTUAL DETAIL SHEET (MOBILE: Non-overlapping Bottom Sheet - Region G) */}
      {isMobile && (activeDetailStore || activeDetailFacility || selectedBranch || selectedCluster) && (
        <div data-testid="detail-fasilitas-sheet" aria-label="Detail fasilitas">
          <LocationDetailPanel
            location={activeDetailStore}
            facility={activeDetailFacility}
            branch={selectedBranch}
            cluster={selectedCluster}
            onClose={handleCloseDetail}
            isMobile={true}
            currentEarthquake={latestEq}
            activeLayer={activeLayer}
            onFlyTo={(lat, lng, zoom) => {
              setFlyToTarget({ lat, lng, zoom });
            }}
          />
        </div>
      )}

      {/* 3. LOCATION LIST SHEET */}
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

      {/* 5. FACILITY FILTER MODAL */}
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
          <div className="w-full rounded-t-2xl sm:rounded-xl bg-card p-4 sm:p-5 text-card-foreground shadow-2xl sm:max-w-md border border-border pb-24 sm:pb-5 max-h-[85vh] overflow-y-auto">
            <div className="sm:hidden w-full flex justify-center pb-2">
              <div className="w-12 h-1 bg-muted-foreground/30 rounded-full" />
            </div>
            <div className="flex items-center justify-between pb-3 border-b border-border">
              <h2 className="font-semibold text-sm">{mapMode === "store" ? "Filter Toko" : "Filter DC"}</h2>
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={() => setFilterOpen(false)}
                className="h-7 w-7 text-muted-foreground hover:text-foreground"
                aria-label="Tutup filter"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>

            <div className="mt-4 space-y-3.5 text-xs">
              <div>
                <label className="block font-medium text-muted-foreground mb-1 text-[11px] uppercase tracking-wider">
                  Cabang Operasional
                </label>
                <select
                  value={facilityBranch}
                  onChange={(e) => setFacilityBranch(e.target.value)}
                  className="w-full h-9 rounded-md border border-input bg-background px-3 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                >
                  <option value="">Semua Cabang</option>
                  {branchOptions.map((b) => (
                    <option key={b} value={b}>
                      Cabang {b}
                    </option>
                  ))}
                </select>
              </div>

              {mapMode === "dc" && (
                <div>
                  <label className="block font-medium text-muted-foreground mb-1 text-[11px] uppercase tracking-wider">
                    Status Operasional
                  </label>
                  <select
                    value={facilityStatus}
                    onChange={(e) => setFacilityStatus(e.target.value)}
                    className="w-full h-9 rounded-md border border-input bg-background px-3 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                  >
                    <option value="">Semua Status</option>
                    <option value="ACTIVE">Aktif</option>
                    <option value="INACTIVE">Tidak Aktif</option>
                  </select>
                </div>
              )}

              {mapMode === "dc" && (
                <div>
                  <label className="block font-medium text-muted-foreground mb-1 text-[11px] uppercase tracking-wider">
                    Status Pemetaan Cabang
                  </label>
                  <select
                    value={facilityMapping}
                    onChange={(e) => setFacilityMapping(e.target.value)}
                    className="w-full h-9 rounded-md border border-input bg-background px-3 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                  >
                    <option value="">Semua Status Mapping</option>
                    <option value="mapped">Terpetakan ke Cabang</option>
                    <option value="unmapped">Belum Terpetakan</option>
                  </select>
                </div>
              )}

              <div className="pt-2 grid grid-cols-2 gap-2">
                <Button
                  variant="outline"
                  onClick={handleResetLocationFilters}
                  className="h-9 text-xs"
                >
                  Reset Filter
                </Button>
                <Button
                  onClick={() => setFilterOpen(false)}
                  className="h-9 text-xs bg-[#0069a7] hover:bg-[#005a8f] text-white"
                >
                  Terapkan
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
