"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  MapContainer,
  TileLayer,
  Marker,
  CircleMarker,
  Popup,
  Circle,
  Tooltip,
  useMap,
  useMapEvents,
  ZoomControl,
} from "react-leaflet";
import L from "leaflet";
import { Store, SpatialRisk } from "@/types/store";
import { Earthquake } from "@/types/disaster";
import { getV1Coverage } from "@/lib/earthquake-v1-parameters";
import {
  ChevronRight,
  ShieldAlert,
  ExternalLink,
  AlertTriangle,
  Loader2,
} from "lucide-react";
import {
  calculateAhoPercentage,
  formatAhoBadgeLabel,
} from "@/lib/aho-utils";
import {
  createBranchFlagIcon,
  createClusterCircleIcon,
  createStoreTeardropIcon,
  createDcFacilityIcon,
  type BranchAggregationData,
  type ClusterAggregationData,
} from "./map-marker-icons";
import { AhoLegend } from "./aho-legend";

interface MapInnerProps {
  stores: Store[];
  locationMode?: "event" | "store" | "dc";
  earthquakes: Earthquake[];
  basemap: "esri-dark" | "esri-light" | "osm";
  incidentOnly: boolean;
  statusFilter: "all" | SpatialRisk;
  selectedStore: Store | null;
  onSelectStore: (store: Store) => void;
  onSelectBranch?: (branch: BranchAggregationData) => void;
  onSelectCluster?: (cluster: ClusterAggregationData) => void;
  selectedBranch?: BranchAggregationData | null;
  selectedCluster?: ClusterAggregationData | null;
  flyToTarget: { lat: number; lng: number; zoom?: number } | null;
  showRadar?: boolean;
  radarTileUrl?: string;
  activeLayer?: "all" | "earthquake" | "stores" | "weather" | "flood" | "aho";
  floodReports?: any[];
  theme?: "dark" | "light";
  onViewportChange?: (bounds: { north: number; south: number; east: number; west: number }) => void;
  selectedEarthquakeId?: string | null;
}

// Controller component to smoothly fly to coordinates when requested
function MapFlyController({
  target,
}: {
  target: { lat: number; lng: number; zoom?: number } | null;
}) {
  const map = useMap();

  useEffect(() => {
    if (target) {
      const targetZoom = Math.min(target.zoom || 13, map.getMaxZoom());
      map.flyTo([target.lat, target.lng], targetZoom, {
        duration: 1.5,
        easeLinearity: 0.25,
      });
    }
  }, [target, map]);

  useEffect(() => {
    if (typeof window !== "undefined") {
      (window as any).__SPARTA_MAP__ = map;
    }
  }, [map]);

  return null;
}

// Synchronize max zoom with active basemap capability to avoid "Zoom Level Not Supported" tiles
function BasemapZoomSync({ maxZoom }: { maxZoom: number }) {
  const map = useMap();
  useEffect(() => {
    map.setMaxZoom(maxZoom);
    if (map.getZoom() > maxZoom) {
      map.setZoom(maxZoom);
    }
  }, [map, maxZoom]);
  return null;
}

// Leaflet does not always notice sidebar transitions, parent panel resizing, or fullscreen transitions.
// Sync its viewport with actual container size without resetting map position.
function MapSizeSync() {
  const map = useMap();

  useEffect(() => {
    const node = map.getContainer();
    let frame: number | null = null;
    const sync = () => {
      if (frame !== null) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        frame = null;
        map.invalidateSize({ pan: false });
      });
    };
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(sync) : null;
    observer?.observe(node);
    window.addEventListener("resize", sync);
    document.addEventListener("fullscreenchange", sync);
    sync();
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", sync);
      document.removeEventListener("fullscreenchange", sync);
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [map]);

  return null;
}

// Component to track map viewport bounds and zoom level for dynamic LOD and culling
function ViewportTracker({ 
  onZoomChange, 
  onBoundsChange 
}: { 
  onZoomChange: (zoom: number) => void;
  onBoundsChange: (bounds: L.LatLngBounds) => void;
}) {
  const onZoomRef = React.useRef(onZoomChange);
  const onBoundsRef = React.useRef(onBoundsChange);
  onZoomRef.current = onZoomChange;
  onBoundsRef.current = onBoundsChange;

  const map = useMapEvents({
    zoomend: () => {
      onZoomRef.current(map.getZoom());
      onBoundsRef.current(map.getBounds());
    },
    moveend: () => {
      onBoundsRef.current(map.getBounds());
    },
  });

  useEffect(() => {
    // Only dispatch on initial mount
    onZoomRef.current(map.getZoom());
    onBoundsRef.current(map.getBounds());
  }, [map]);

  return null;
}

// Function to generate dynamic epicenter earthquake marker
function createEpicenterIcon(earthquake: Earthquake, isFocused: boolean = false) {
  const isTsunami = earthquake.potensiTsunami;
  const isHigh = earthquake.magnitude >= 6.0;

  const html = `
    <div class="relative flex items-center justify-center cursor-pointer">
      ${isFocused ? '<div class="absolute -inset-6 bg-cyan-400/35 rounded-full animate-ping"></div><div class="absolute -inset-2.5 ring-4 ring-cyan-400 rounded-full"></div>' : ''}
      <div class="absolute -inset-4 bg-red-600/30 rounded-full animate-ping"></div>
      <div class="absolute -inset-2 bg-red-500/50 rounded-full animate-pulse"></div>
      <div class="relative w-9 h-9 rounded-full ${isTsunami ? "bg-red-700" : isHigh ? "bg-red-600" : "bg-amber-600"
    } border-2 ${isFocused ? "border-cyan-300 ring-2 ring-cyan-400" : "border-white"} shadow-2xl flex items-center justify-center text-white">
        <span class="text-[10px] font-black font-mono">M${earthquake.magnitude}</span>
      </div>
    </div>
  `;

  return L.divIcon({
    html,
    className: "custom-disaster-pin",
    iconSize: [36, 36],
    iconAnchor: [18, 18],
    popupAnchor: [0, -20],
  });
}

function formatWIBTime(iso: string) {
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return (
      d.toLocaleString("id-ID", {
        timeZone: "Asia/Jakarta",
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      }).replace(/\./g, ":") + " WIB"
    );
  } catch {
    return iso;
  }
}

function FloodMarkerAndPopup({
  report,
  isDark,
}: {
  report: any;
  isDark: boolean;
}) {
  const map = useMap();

  const floodIcon = useMemo(() => {
    return L.divIcon({
      className: "custom-div-icon",
      html: `
        <div class="relative flex items-center justify-center w-8 h-8 rounded-full bg-blue-600 border-2 border-white shadow-lg z-50">
          <span class="text-[11px]">🌊</span>
        </div>
      `,
      iconSize: [32, 32],
      iconAnchor: [16, 16],
      popupAnchor: [0, -16],
    });
  }, []);

  const isPolygon =
    report.geometryType === "Polygon" &&
    Array.isArray(report.polygonCoordinates) &&
    report.polygonCoordinates.length >= 3;

  const actionLabel = isPolygon ? "Fokus ke Area Genangan" : "Lihat Lokasi di Peta";

  const handleNavigate = () => {
    if (isPolygon) {
      const bounds = L.latLngBounds(report.polygonCoordinates);
      map.fitBounds(bounds, { padding: [50, 50], maxZoom: 16 });
    } else {
      map.flyTo([report.lat, report.lng], 15, { animate: true, duration: 1.2 });
    }
  };

  const reportIdDisplay =
    report.id && report.id.length > 8
      ? "PB-" + report.id.substring(0, 4).toUpperCase()
      : report.id;

  return (
    <Marker
      position={[report.lat, report.lng]}
      icon={floodIcon}
      eventHandlers={{
        click: (e) => {
          e.target.openPopup();
        },
      }}
    >
      <Popup
        className={`custom-leaflet-popup ${isDark ? "popup-dark" : "popup-light"}`}
        maxWidth={320}
      >
        <div
          className={`p-3 rounded-xl border w-72 space-y-2.5 text-xs transition-colors ${
            isDark
              ? "bg-slate-900 text-white border-slate-700 shadow-2xl"
              : "bg-white text-slate-900 border-slate-200 shadow-xl"
          }`}
        >
          {/* Header */}
          <div className="flex items-center justify-between gap-2">
            <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-blue-600/15 text-blue-600 dark:text-blue-400 border border-blue-500/30">
              {reportIdDisplay}
            </span>
            {report.verificationStatus ? (
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-emerald-600 text-white">
                {report.verificationStatus}
              </span>
            ) : (
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-blue-600 text-white">
                Laporan Warga
              </span>
            )}
          </div>

          {/* Title */}
          <h3 className={`font-bold text-sm leading-snug ${isDark ? "text-white" : "text-slate-900"}`}>
            {report.title || "Laporan Banjir Lapangan (PetaBencana)"}
          </h3>

          {/* Reported Depth - Accurately labeled community report */}
          {report.depth != null && (
            <div
              className={`p-2 rounded-lg border text-xs ${
                isDark
                  ? "bg-blue-950/40 border-blue-800/60 text-blue-100"
                  : "bg-blue-50/80 border-blue-200 text-blue-900"
              }`}
            >
              <span className="block text-[10px] font-medium opacity-80 mb-0.5">
                Ketinggian Air (Laporan Warga):
              </span>
              <strong className="text-sm font-bold text-red-600 dark:text-red-400">
                {report.depth} cm
              </strong>
            </div>
          )}

          {/* Citizen Description / Text if provided */}
          {report.description && (
            <div
              className={`p-2 rounded-lg border text-[11px] leading-relaxed ${
                isDark
                  ? "bg-slate-800/60 border-slate-700/60 text-slate-300"
                  : "bg-slate-50 border-slate-200 text-slate-700"
              }`}
            >
              <span className="block text-[10px] font-semibold text-slate-400 mb-0.5">
                Catatan Lapangan:
              </span>
              <p className="line-clamp-3">{report.description}</p>
            </div>
          )}

          {/* Photo if provided by API */}
          {report.imageUrl && (
            <div className="rounded-lg overflow-hidden border border-slate-200 dark:border-slate-700">
              <img
                src={report.imageUrl}
                alt="Foto Laporan Lapangan"
                className="w-full h-28 object-cover hover:scale-105 transition-transform duration-300"
                loading="lazy"
              />
            </div>
          )}

          {/* Metadata */}
          <div
            className={`text-[11px] space-y-1 pt-1.5 border-t ${
              isDark ? "border-slate-800 text-slate-400" : "border-slate-100 text-slate-500"
            }`}
          >
            <div className="flex justify-between items-center">
              <span>Sumber:</span>
              <span className="font-semibold text-slate-800 dark:text-slate-200">
                {report.source || "PetaBencana"}
              </span>
            </div>
            {report.locationName && (
              <div className="flex justify-between items-center">
                <span>Wilayah:</span>
                <span className="font-medium text-slate-800 dark:text-slate-200">
                  {report.locationName}
                </span>
              </div>
            )}
            <div className="flex justify-between items-center">
              <span>Waktu:</span>
              <span className="font-mono text-[10px] text-slate-700 dark:text-slate-300">
                {formatWIBTime(report.timestamp)}
              </span>
            </div>
          </div>

          {/* Action Button */}
          <button
            type="button"
            onClick={handleNavigate}
            className="w-full mt-2 py-2 px-3 rounded-lg bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white font-semibold text-xs flex items-center justify-center gap-1.5 transition-colors shadow-sm"
          >
            <span>{actionLabel}</span>
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </Popup>
    </Marker>
  );
}

export default function MapInner({
  stores,
  locationMode = "event",
  earthquakes,
  basemap,
  incidentOnly,
  statusFilter,
  selectedStore,
  onSelectStore,
  onSelectBranch,
  onSelectCluster,
  selectedBranch,
  selectedCluster,
  flyToTarget,
  showRadar = false,
  radarTileUrl,
  activeLayer = "all",
  floodReports = [],
  theme = "dark",
  onViewportChange,
  selectedEarthquakeId,
}: MapInnerProps) {
  const isDark = theme === "dark";
  const [currentZoom, setCurrentZoom] = useState(5);
  const [mapBounds, setMapBounds] = useState<L.LatLngBounds | null>(null);

  const handleBoundsChange = React.useCallback((bounds: L.LatLngBounds) => {
    setMapBounds(bounds);
    onViewportChange?.({
      north: Number(bounds.getNorth().toFixed(4)),
      south: Number(bounds.getSouth().toFixed(4)),
      east: Number(bounds.getEast().toFixed(4)),
      west: Number(bounds.getWest().toFixed(4)),
    });
  }, [onViewportChange]);

  // AHO Layer state and data fetching (SPARTA Maintenance Integration)
  // Strictly mode-aware: AHO is ONLY valid when locationMode === "store"
  const isAhoLayer = locationMode === "store" && activeLayer === "aho";
  const [ahoCounts, setAhoCounts] = useState<Record<string, number> | null>(null);
  const [ahoLastUpdated, setAhoLastUpdated] = useState<string | null>(null);
  const [ahoTotalTickets, setAhoTotalTickets] = useState(0);
  const [ahoTotalStores, setAhoTotalStores] = useState(0);
  const [ahoLoading, setAhoLoading] = useState(false);
  const [ahoError, setAhoError] = useState(false);
  const [ahoRefreshKey, setAhoRefreshKey] = useState(0);

  useEffect(() => {
    if (!isAhoLayer) return;

    // Use cached counts if already fetched in this session unless refresh requested
    if (ahoCounts && ahoRefreshKey === 0) return;

    const controller = new AbortController();
    setAhoLoading(true);
    setAhoError(false);

    fetch("/api/aho" + (ahoRefreshKey > 0 ? "?refresh=true" : ""), {
      signal: controller.signal,
    })
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok || !data.success) {
          throw new Error(data.error || "Gagal memuat data AHO");
        }
        setAhoCounts(data.counts || {});
        setAhoLastUpdated(data.lastUpdated || null);
        setAhoTotalTickets(data.totalActiveTickets || 0);
        setAhoTotalStores(data.totalStoresWithTickets || 0);
        setAhoError(false);
      })
      .catch((err) => {
        if (err.name !== "AbortError") {
          console.error("[MapInner] Gagal memuat data AHO:", err);
          setAhoError(true);
        }
      })
      .finally(() => {
        setAhoLoading(false);
      });

    return () => controller.abort();
  }, [isAhoLayer, ahoRefreshKey]);

  const showEarthquakes = !isAhoLayer && (activeLayer === "all" || activeLayer === "earthquake");
  const showStoresLayer = !isAhoLayer && (activeLayer === "all" || activeLayer === "stores");

  // Requirement: Radar is only visible when specifically enabled and zoomed in to prevent global watermark clutter.
  const isRadarEnabled = showRadar || activeLayer === "weather";
  const showWeatherLayer = !isAhoLayer && isRadarEnabled;

  // Group all stores into branch aggregations for AHO Layer (Zoom <= 7)
  const ahoBranchAggregations = useMemo(() => {
    if (!isAhoLayer || !ahoCounts) return [];

    const map = new Map<
      string,
      {
        cabang: string;
        sumLat: number;
        sumLng: number;
        totalStores: number;
        storesWithTickets: number;
        totalTickets: number;
      }
    >();

    for (const store of stores) {
      const branchName = store.cabang || "Lainnya";
      const code = (store.kode_toko || "").toUpperCase().trim();
      const ticketCount = ahoCounts[code] || 0;
      const hasTicket = ticketCount > 0;

      const existing = map.get(branchName);
      if (!existing) {
        map.set(branchName, {
          cabang: branchName,
          sumLat: store.latitude,
          sumLng: store.longitude,
          totalStores: 1,
          storesWithTickets: hasTicket ? 1 : 0,
          totalTickets: ticketCount,
        });
      } else {
        existing.sumLat += store.latitude;
        existing.sumLng += store.longitude;
        existing.totalStores += 1;
        if (hasTicket) existing.storesWithTickets += 1;
        existing.totalTickets += ticketCount;
      }
    }

    const result: BranchAggregationData[] = [];
    map.forEach((item) => {
      if (item.totalStores > 0) {
        const percentage = calculateAhoPercentage(item.totalStores, item.storesWithTickets);
        result.push({
          cabang: item.cabang,
          latitude: item.sumLat / item.totalStores,
          longitude: item.sumLng / item.totalStores,
          totalStores: item.totalStores,
          storesWithTickets: item.storesWithTickets,
          totalTickets: item.totalTickets,
          percentage,
        });
      }
    });

    return result;
  }, [stores, isAhoLayer, ahoCounts]);

  // Spatial Grid Clustering for AHO Layer at Zoom 8–12
  const ahoClusters = useMemo(() => {
    if (!isAhoLayer || !ahoCounts || currentZoom < 8 || currentZoom >= 13) return [];

    // Filter by viewport bounds for optimal rendering performance
    const visibleStores = mapBounds
      ? stores.filter((s) => mapBounds.contains([s.latitude, s.longitude]))
      : stores;

    const step =
      currentZoom <= 8 ? 0.7 :
      currentZoom === 9 ? 0.35 :
      currentZoom === 10 ? 0.18 :
      currentZoom === 11 ? 0.09 : 0.045;

    const gridMap = new Map<
      string,
      {
        sumLat: number;
        sumLng: number;
        stores: Store[];
        storesWithTickets: number;
        totalTickets: number;
      }
    >();

    for (const s of visibleStores) {
      const latIdx = Math.floor(s.latitude / step);
      const lngIdx = Math.floor(s.longitude / step);
      const key = `${latIdx}_${lngIdx}`;

      const code = (s.kode_toko || "").toUpperCase().trim();
      const ticketCount = ahoCounts[code] || 0;
      const hasTicket = ticketCount > 0;

      const cell = gridMap.get(key);
      if (!cell) {
        gridMap.set(key, {
          sumLat: s.latitude,
          sumLng: s.longitude,
          stores: [s],
          storesWithTickets: hasTicket ? 1 : 0,
          totalTickets: ticketCount,
        });
      } else {
        cell.sumLat += s.latitude;
        cell.sumLng += s.longitude;
        cell.stores.push(s);
        if (hasTicket) cell.storesWithTickets += 1;
        cell.totalTickets += ticketCount;
      }
    }

    const result: ClusterAggregationData[] = [];

    gridMap.forEach((cell) => {
      const totalStores = cell.stores.length;
      const percentage = calculateAhoPercentage(totalStores, cell.storesWithTickets);
      result.push({
        lat: cell.sumLat / totalStores,
        lng: cell.sumLng / totalStores,
        totalStores,
        storesWithTickets: cell.storesWithTickets,
        totalTickets: cell.totalTickets,
        percentage,
        stores: cell.stores,
      });
    });

    return result;
  }, [stores, isAhoLayer, ahoCounts, currentZoom, mapBounds]);

  // Viewport culled stores for individual AHO markers at Zoom >= 13
  const ahoVisibleStores = useMemo(() => {
    if (!isAhoLayer || !ahoCounts || currentZoom < 13) return [];

    return mapBounds
      ? stores.filter((s) => mapBounds.contains([s.latitude, s.longitude]))
      : stores;
  }, [stores, isAhoLayer, ahoCounts, currentZoom, mapBounds]);

  // Group stores into branch aggregations for Zoom <= 7 (Titik Percabang)
  const branchAggregations = useMemo(() => {
    const map = new Map<
      string,
      {
        cabang: string;
        sumLat: number;
        sumLng: number;
        count: number;
        dangerCount: number;
        warningCount: number;
      }
    >();

    for (const store of stores) {
      const branchName = store.cabang || "Lainnya";
      const existing = map.get(branchName);
      const isDanger =
        store.visualStatus === "TERDAMPAK" ||
        store.visualStatus === "DALAM_PENANGANAN" ||
        store.status === "PRIORITY_MONITOR";
      const isWarning =
        store.visualStatus === "PERLU_PERHATIAN" ||
        store.status === "MONITOR";

      if (!existing) {
        map.set(branchName, {
          cabang: branchName,
          sumLat: store.latitude,
          sumLng: store.longitude,
          count: 1,
          dangerCount: isDanger ? 1 : 0,
          warningCount: isWarning ? 1 : 0,
        });
      } else {
        existing.sumLat += store.latitude;
        existing.sumLng += store.longitude;
        existing.count += 1;
        if (isDanger) existing.dangerCount += 1;
        if (isWarning) existing.warningCount += 1;
      }
    }

    const result: BranchAggregationData[] = [];
    map.forEach((item) => {
      if (item.count > 0) {
        // If incidentOnly is ON, hide branches that have zero affected stores
        if (incidentOnly && item.dangerCount === 0 && item.warningCount === 0) {
          return;
        }

        result.push({
          cabang: item.cabang,
          latitude: item.sumLat / item.count,
          longitude: item.sumLng / item.count,
          totalStores: incidentOnly ? item.dangerCount + item.warningCount : item.count,
          dangerCount: item.dangerCount,
          warningCount: item.warningCount,
        });
      }
    });

    return result;
  }, [stores, incidentOnly]);

  // Partition stores into high-priority operational/affected stores vs safe/normal stores
  // (Requirements 10, 11, 28)
  const { operationalStores, safeStores } = useMemo(() => {
    const operational: Store[] = [];
    const safe: Store[] = [];

    for (const store of stores) {
      const isPriorityOperational =
        store.visualStatus === "TERDAMPAK" ||
        store.visualStatus === "DALAM_PENANGANAN" ||
        store.visualStatus === "PERLU_PERHATIAN" ||
        store.status === "PRIORITY_MONITOR" ||
        store.status === "MONITOR";

      const isResolved = store.visualStatus === "SELESAI";

      if (isPriorityOperational) {
        if (
          statusFilter === "all" ||
          (statusFilter === "PRIORITY_MONITOR" && (store.visualStatus === "TERDAMPAK" || store.status === "PRIORITY_MONITOR")) ||
          (statusFilter === "MONITOR" && (store.visualStatus === "PERLU_PERHATIAN" || store.status === "MONITOR"))
        ) {
          operational.push(store);
        }
      } else if (isResolved) {
        // Requirement 28: Resolved store does not clutter incidentOnly crisis view.
        if (!incidentOnly && (statusFilter === "all" || statusFilter === "SAFE")) {
          safe.push(store);
        }
      } else {
        if (!incidentOnly && (statusFilter === "all" || statusFilter === "SAFE")) {
          safe.push(store);
        }
      }
    }

    return { operationalStores: operational, safeStores: safe };
  }, [stores, incidentOnly, statusFilter]);

  // Requirement 12: Spatial Grid Clustering for Safe Stores at Zoom 8–12
  const clusteredSafeStores = useMemo(() => {
    if (currentZoom < 8 || currentZoom >= 13) return [];

    // Filter by viewport bounds first for optimal performance
    const visibleStores = mapBounds
      ? safeStores.filter((s) => mapBounds.contains([s.latitude, s.longitude]))
      : safeStores;

    const step =
      currentZoom <= 8 ? 0.7 :
      currentZoom === 9 ? 0.35 :
      currentZoom === 10 ? 0.18 :
      currentZoom === 11 ? 0.09 : 0.045;

    const gridMap = new Map<
      string,
      { sumLat: number; sumLng: number; count: number; stores: Store[] }
    >();

    for (const s of visibleStores) {
      const latIdx = Math.floor(s.latitude / step);
      const lngIdx = Math.floor(s.longitude / step);
      const key = `${latIdx}_${lngIdx}`;

      const cell = gridMap.get(key);
      if (!cell) {
        gridMap.set(key, { sumLat: s.latitude, sumLng: s.longitude, count: 1, stores: [s] });
      } else {
        cell.sumLat += s.latitude;
        cell.sumLng += s.longitude;
        cell.count += 1;
        cell.stores.push(s);
      }
    }

    const result: Array<{ lat: number; lng: number; count: number; stores: Store[] }> = [];
    gridMap.forEach((cell) => {
      result.push({
        lat: cell.sumLat / cell.count,
        lng: cell.sumLng / cell.count,
        count: cell.count,
        stores: cell.stores,
      });
    });

    return result;
  }, [safeStores, currentZoom, mapBounds]);

  // 100% Watermark-Free Basemap Tile URLs
  const tileUrl = useMemo(() => {
    if (basemap === "esri-dark") {
      return (
        process.env.NEXT_PUBLIC_MAP_TILE_ESRI_DARK_URL ||
        "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}"
      );
    }
    if (basemap === "esri-light") {
      return (
        process.env.NEXT_PUBLIC_MAP_TILE_ESRI_LIGHT_URL ||
        "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}"
      );
    }
    return (
      process.env.NEXT_PUBLIC_MAP_TILE_OSM_URL ||
      "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
    );
  }, [basemap]);

  const tileAttribution = useMemo(() => {
    if (basemap === "osm") {
      return (
        process.env.NEXT_PUBLIC_MAP_TILE_OSM_ATTRIBUTION ||
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
      );
    }
    return (
      process.env.NEXT_PUBLIC_MAP_TILE_ESRI_ATTRIBUTION ||
      'Tiles &copy; Esri &mdash; Esri, DeLorme, NAVTEQ'
    );
  }, [basemap]);

  const mapMaxZoom = basemap === "osm" ? 18 : 16;

  return (
    <div className="w-full h-full relative">
      <MapContainer
        center={[-2.5, 118.0]}
        zoom={5}
        minZoom={4}
        maxZoom={mapMaxZoom}
        scrollWheelZoom={true}
        zoomControl={false}
        className="w-full h-full z-0"
        preferCanvas={true}
      >
        <BasemapZoomSync maxZoom={mapMaxZoom} />

        {/* Basemap Tile Layer */}
        <TileLayer
          key={tileUrl}
          url={tileUrl}
          attribution={tileAttribution}
          maxZoom={mapMaxZoom}
          maxNativeZoom={mapMaxZoom}
        />

        {/* Live Doppler Weather Radar Layer (Capped to zoom 12 with maxNativeZoom 7 to prevent RainViewer unsupported tile errors) */}
        {showWeatherLayer && radarTileUrl && currentZoom <= 12 && (
          <TileLayer
            key={radarTileUrl}
            url={radarTileUrl}
            opacity={0.65}
            zIndex={350}
            maxNativeZoom={7}
            maxZoom={12}
          />
        )}

        <MapSizeSync />
        <ZoomControl position="bottomright" />
        <MapFlyController target={flyToTarget} />
        <ViewportTracker onZoomChange={setCurrentZoom} onBoundsChange={handleBoundsChange} />

        {/* 1. DISASTER EPICENTERS & V1 EVALUATION RADIUS (6 November 2026 Operational Decision) */}
        {showEarthquakes &&
          earthquakes.map((eq) => {
            const coverage = eq.v1Coverage ?? getV1Coverage(eq.magnitude, eq.depthKm ?? 10);
            const v1Radius = eq.v1DistanceKm ?? coverage.v1DistanceKm;

            return (
              <React.Fragment key={eq.id}>
                {/* Radius Pencarian / Fallback V1 Operasional SPARTA (Bukan Batas Kerusakan Mutlak) */}
                {v1Radius !== null && v1Radius > 0 && (
                  <Circle
                    center={[eq.latitude, eq.longitude]}
                    radius={v1Radius * 1000}
                    pathOptions={{
                      color: "#dc2626",
                      fillColor: "#dc2626",
                      fillOpacity: 0.14,
                      weight: 2,
                      dashArray: "6, 6",
                    }}
                  />
                )}

                {/* Epicenter Marker */}
                <Marker
                  position={[eq.latitude, eq.longitude]}
                  icon={createEpicenterIcon(eq, eq.id === selectedEarthquakeId)}
                >
                  <Popup className={`custom-leaflet-popup ${isDark ? "popup-dark" : "popup-light"}`}>
                    <div className={`p-3.5 rounded-xl border w-72 space-y-2 text-xs transition-colors ${
                      isDark
                        ? "bg-slate-900 text-white border-slate-700 shadow-2xl"
                        : "bg-white text-slate-900 border-slate-200 shadow-xl"
                    }`}>
                      <div className={`flex items-center gap-1.5 font-bold ${isDark ? "text-red-400" : "text-red-600"}`}>
                        <ShieldAlert className={`w-4 h-4 shrink-0 ${isDark ? "text-red-500" : "text-red-600"}`} />
                        <span>Pusat Gempa ({eq.source || "BMKG"})</span>
                      </div>

                      <p className={`font-semibold leading-snug ${isDark ? "text-white" : "text-slate-900"}`}>
                        {eq.title || eq.place}
                      </p>

                      <div className={`grid grid-cols-2 gap-1 text-[11px] pt-1 border-t ${
                        isDark ? "text-slate-300 border-slate-800" : "text-slate-600 border-slate-100"
                      }`}>
                        <div>
                          <span className={isDark ? "text-slate-500" : "text-slate-500"}>Magnitudo:</span>{" "}
                          <strong className={isDark ? "text-white" : "text-slate-900"}>M {eq.magnitude}</strong>
                        </div>
                        <div>
                          <span className={isDark ? "text-slate-500" : "text-slate-500"}>Kedalaman:</span>{" "}
                          <strong className={isDark ? "text-white" : "text-slate-900"}>{eq.depth}</strong>
                        </div>
                      </div>

                      <div className={`p-2 rounded-lg border text-[10px] space-y-1 ${
                        isDark ? "bg-slate-950/70 border-slate-800" : "bg-slate-50 border-slate-200 text-slate-700"
                      }`}>
                        <div className="flex justify-between items-center">
                          <span className={`font-bold ${isDark ? "text-red-400" : "text-red-600"}`}>Radius Pencarian/Fallback V1:</span>
                          <span className={`font-mono font-bold ${isDark ? "text-white" : "text-slate-900"}`}>
                            {v1Radius !== null ? `${v1Radius} km` : (eq.magnitude < 4.0 ? "Hanya Pemantauan" : "Tidak Berlaku")}
                          </span>
                        </div>
                        <div className="flex justify-between items-center">
                          <span className={isDark ? "text-slate-400" : "text-slate-600"}>Kelompok Kedalaman:</span>
                          <span className={`font-mono ${isDark ? "text-slate-300" : "text-slate-700"}`}>{coverage.depthGroup}</span>
                        </div>
                      </div>

                      <p className={`text-[9px] italic leading-tight ${isDark ? "text-slate-400" : "text-slate-500"}`}>
                        Radius V1 adalah batas pencarian awal / fallback operasional SPARTA, bukan batas mutlak kerusakan. Toko di luar V1 tetap dapat terkualifikasi jika intensitas MMI resmi &ge; 6.0; berada di luar V1 tidak membuktikan keamanan fisik.
                      </p>

                      <div className={`text-[10px] ${isDark ? "text-slate-400" : "text-slate-500"}`}>
                        Waktu: {eq.time || eq.date}
                      </div>

                      {eq.felt && (
                        <div className={`text-[10px] ${isDark ? "text-slate-300" : "text-slate-600"}`}>
                          Wilayah merasakan guncangan (MMI): <span className="font-medium">{eq.felt}</span>
                        </div>
                      )}

                      {eq.potensiText && (
                        <div
                          className={`p-1.5 rounded text-[10px] font-bold ${
                            eq.potensiTsunami
                              ? "bg-red-600 text-white animate-pulse"
                              : isDark ? "bg-slate-800 text-slate-300" : "bg-slate-100 text-slate-700 border border-slate-200"
                          }`}
                        >
                          {eq.potensiText}
                        </div>
                      )}

                      {eq.shakemapUrl && (
                        <a
                          href={eq.shakemapUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={`w-full mt-2 py-1.5 px-3 rounded-lg font-medium text-xs flex items-center justify-center gap-1.5 transition-colors border ${
                            isDark
                              ? "bg-slate-800 hover:bg-slate-700 text-cyan-300 border-slate-700"
                              : "bg-slate-100 hover:bg-slate-200 text-cyan-700 border-slate-200"
                          }`}
                        >
                          <span>Lihat Shakemap BMKG</span>
                          <ExternalLink className="w-3.5 h-3.5" />
                        </a>
                      )}
                    </div>
                  </Popup>
                </Marker>
              </React.Fragment>
            );
          })}

        {/* DC mode: facility marker with warehouse icon, always renders INDIVIDUAL markers independently of zoom */}
        {showStoresLayer && locationMode === "dc" && stores.map((dc) => (
          <Marker
            key={dc.id}
            position={[dc.latitude, dc.longitude]}
            icon={createDcFacilityIcon(dc, selectedStore?.id === dc.id)}
            eventHandlers={{ click: () => onSelectStore(dc) }}
          >
            <Tooltip direction="top" offset={[0, -28]} opacity={0.95}>
              <div className="px-1 text-xs text-slate-900">
                <span className="font-bold text-blue-700">DC {dc.kode_toko}</span>
                <div className="font-medium">{dc.nama_toko}</div>
                <div className="text-[10px] text-slate-500">
                  {dc.cabang === "Belum dipetakan" ? "Belum dipetakan ke cabang" : `Cabang ${dc.cabang}`}
                </div>
                <span className="text-[10px] text-blue-600 font-medium block mt-0.5">Klik untuk melihat detail DC</span>
              </div>
            </Tooltip>
          </Marker>
        ))}

        {/* 2. STORES LAYER (LOD: Zoom <= 7 Branch Aggregation, Zoom 8–12 Clustering, Zoom >= 13 Individual) */}
        {showStoresLayer && locationMode !== "dc" && (
          <>
            {/* LEVEL NASIONAL / PROVINSI (Zoom <= 7): Titik Percabang (Anchored Flag) */}
            {currentZoom <= 7 &&
              branchAggregations.map((branch) => (
                <Marker
                  key={branch.cabang}
                  position={[branch.latitude, branch.longitude]}
                  icon={createBranchFlagIcon(branch, false, selectedBranch?.cabang === branch.cabang)}
                  eventHandlers={{
                    click: () => {
                      onSelectBranch?.(branch);
                    },
                  }}
                >
                  <Tooltip direction="top" offset={[0, -28]} opacity={0.95}>
                    <div className="text-xs font-semibold text-slate-900 px-1">
                      Cabang {branch.cabang}: {branch.totalStores} Toko (Klik untuk ringkasan)
                    </div>
                  </Tooltip>
                </Marker>
              ))}

            {/* LEVEL REGIONAL / KABUPATEN (Zoom 8–12): Circular Aggregate Cluster */}
            {currentZoom >= 8 &&
              currentZoom <= 12 &&
              !incidentOnly &&
              clusteredSafeStores.map((cluster, idx) => {
                if (cluster.count === 1) {
                  const s = cluster.stores[0];
                  return (
                    <Marker
                      key={`single-${s.id}`}
                      position={[s.latitude, s.longitude]}
                      icon={createStoreTeardropIcon(s, false, false, 0, selectedStore?.id === s.id)}
                      eventHandlers={{
                        click: () => onSelectStore(s),
                      }}
                    >
                      <Tooltip direction="top" offset={[0, -24]} opacity={0.95}>
                        <div className="text-[11px] font-medium text-slate-900 px-1">
                          <span className="font-bold text-emerald-700">[{s.kode_toko}]</span>{" "}
                          {s.nama_toko}
                        </div>
                      </Tooltip>
                    </Marker>
                  );
                }

                const isClusterSelected =
                  selectedCluster?.lat === cluster.lat && selectedCluster?.lng === cluster.lng;

                return (
                  <Marker
                    key={`cluster-${cluster.lat.toFixed(3)}_${cluster.lng.toFixed(3)}_${idx}`}
                    position={[cluster.lat, cluster.lng]}
                    icon={createClusterCircleIcon(cluster.count, false, 0, 0, isClusterSelected)}
                    eventHandlers={{
                      click: () => {
                        onSelectCluster?.({
                          lat: cluster.lat,
                          lng: cluster.lng,
                          totalStores: cluster.count,
                          storesWithTickets: 0,
                          totalTickets: 0,
                          percentage: 0,
                          stores: cluster.stores,
                        });
                      },
                    }}
                  >
                    <Tooltip direction="top" offset={[0, -22]} opacity={0.95}>
                      <div className="text-xs font-semibold text-slate-900 px-1">
                        Cluster: {cluster.count} Toko (Klik untuk ringkasan)
                      </div>
                    </Tooltip>
                  </Marker>
                );
              })}

            {/* LEVEL KOTA / JALAN (Zoom >= 13): Individual Teardrop Location Pins dengan Viewport Culling */}
            {currentZoom >= 13 &&
              !incidentOnly &&
              safeStores
                .filter((store) => !mapBounds || mapBounds.contains([store.latitude, store.longitude]))
                .map((store) => (
                  <Marker
                    key={store.id}
                    position={[store.latitude, store.longitude]}
                    icon={createStoreTeardropIcon(store, false, false, 0, selectedStore?.id === store.id)}
                    eventHandlers={{
                      click: () => onSelectStore(store),
                    }}
                  >
                    <Tooltip direction="top" offset={[0, -24]} opacity={0.95}>
                      <div className="text-[11px] font-medium text-slate-900 px-1">
                        <span className="font-bold text-emerald-700">[{store.kode_toko}]</span>{" "}
                        {store.nama_toko} ({store.cabang})
                      </div>
                    </Tooltip>
                  </Marker>
                ))}
          </>
        )}

        {/* 3. OPERATIONAL & AFFECTED STORES (Distinct teardrop pins, click opens Right Detail Panel) */}
        {showStoresLayer && locationMode !== "dc" &&
          currentZoom >= 8 &&
          operationalStores.map((store) => {
            const isSelected = store.id === selectedStore?.id;

            return (
              <Marker
                key={store.id}
                position={[store.latitude, store.longitude]}
                icon={createStoreTeardropIcon(store, false, false, 0, isSelected)}
                eventHandlers={{
                  click: () => {
                    onSelectStore(store);
                  },
                }}
              >
                <Tooltip direction="top" offset={[0, -24]} opacity={0.95}>
                  <div className="text-xs font-semibold text-slate-900 px-1 py-0.5">
                    <span className="font-bold text-red-600">[{store.kode_toko}]</span>{" "}
                    {store.nama_toko}
                    {store.distanceFromDisasterKm !== undefined && (
                      <span className="ml-1 text-slate-600">
                        ({store.distanceFromDisasterKm} km)
                      </span>
                    )}
                  </div>
                </Tooltip>
              </Marker>
            );
          })}

        {/* 4. RENDER FLOOD REPORTS */}
        {(activeLayer === "all" || activeLayer === "weather" || activeLayer === "flood") &&
          floodReports?.map((report) => (
            <FloodMarkerAndPopup key={report.id} report={report} isDark={isDark} />
          ))}

        {/* 5. EXPLICIT SELECTED STORE PIN (Always visible even in Crisis Focus Mode!) */}
        {selectedStore &&
          !operationalStores.some((s) => s.id === selectedStore.id) &&
          !isAhoLayer && (
            <Marker
              key={`selected-${selectedStore.id}`}
              position={[selectedStore.latitude, selectedStore.longitude]}
              icon={createStoreTeardropIcon(selectedStore, false, false, 0, true)}
              eventHandlers={{
                click: () => {
                  onSelectStore(selectedStore);
                },
              }}
            >
              <Tooltip direction="top" offset={[0, -24]} opacity={0.98} permanent>
                <div className="text-xs font-bold text-slate-900 px-1.5 py-0.5 flex items-center gap-1.5">
                  <span className="text-cyan-600 font-extrabold">🎯 [{selectedStore.kode_toko}]</span>
                  <span>{selectedStore.nama_toko}</span>
                  <span className="text-slate-500 font-normal">({selectedStore.cabang})</span>
                </div>
              </Tooltip>
            </Marker>
          )}

        {/* =========================================================================
            6. AHO TICKETS LAYER (SPARTA Maintenance Integration)
            LOD: Zoom <= 7 Cabang, Zoom 8–12 Cluster, Zoom >= 13 Individual
           ========================================================================= */}
        {isAhoLayer && ahoCounts && (
          <>
            {/* LEVEL CABANG (Zoom <= 7): Agregasi per Cabang (Anchored Flag) */}
            {currentZoom <= 7 &&
              ahoBranchAggregations.map((branch) => {
                const isSelected = selectedBranch?.cabang === branch.cabang;
                return (
                  <Marker
                    key={`aho-branch-${branch.cabang}`}
                    position={[branch.latitude, branch.longitude]}
                    icon={createBranchFlagIcon(branch, true, isSelected)}
                    eventHandlers={{
                      click: () => onSelectBranch?.(branch),
                    }}
                  >
                    <Tooltip direction="top" offset={[0, -28]} opacity={0.95}>
                      <div className="text-xs font-semibold text-slate-900 px-1 py-0.5">
                        <span className="font-bold">Cabang {branch.cabang}</span>: {formatAhoBadgeLabel(branch.totalStores, branch.storesWithTickets ?? 0)} ({(branch.percentage ?? 0).toFixed(1)}%)
                      </div>
                    </Tooltip>
                  </Marker>
                );
              })}

            {/* LEVEL CLUSTER (Zoom 8–12): Spatial Grid Cluster with SVG Donut */}
            {currentZoom >= 8 &&
              currentZoom <= 12 &&
              ahoClusters.map((cluster, idx) => {
                const isClusterSelected =
                  selectedCluster?.lat === cluster.lat && selectedCluster?.lng === cluster.lng;
                return (
                  <Marker
                    key={`aho-cluster-${cluster.lat.toFixed(3)}_${cluster.lng.toFixed(3)}_${idx}`}
                    position={[cluster.lat, cluster.lng]}
                    icon={createClusterCircleIcon(
                      cluster.totalStores,
                      true,
                      cluster.storesWithTickets,
                      cluster.percentage,
                      isClusterSelected
                    )}
                    eventHandlers={{
                      click: () => onSelectCluster?.(cluster),
                    }}
                  >
                    <Tooltip direction="top" offset={[0, -22]} opacity={0.95}>
                      <div className="text-xs font-semibold text-slate-900 px-1">
                        Cluster: {formatAhoBadgeLabel(cluster.totalStores, cluster.storesWithTickets ?? 0)} ({(cluster.percentage ?? 0).toFixed(1)}%) • Klik untuk ringkasan
                      </div>
                    </Tooltip>
                  </Marker>
                );
              })}

            {/* LEVEL TOKO INDIVIDUAL (Zoom >= 13): Viewport Culled Teardrop Pin */}
            {currentZoom >= 13 &&
              ahoVisibleStores.map((store) => {
                const code = (store.kode_toko || "").toUpperCase().trim();
                const ticketCount = ahoCounts[code] || 0;
                const hasTicket = ticketCount > 0;
                const isSelected = selectedStore?.id === store.id;

                return (
                  <Marker
                    key={`aho-store-${store.id}`}
                    position={[store.latitude, store.longitude]}
                    icon={createStoreTeardropIcon(store, true, hasTicket, ticketCount, isSelected, !ahoError)}
                    eventHandlers={{
                      click: () => onSelectStore(store),
                    }}
                  >
                    <Tooltip direction="top" offset={[0, -24]} opacity={0.95}>
                      <div className="text-xs font-semibold text-slate-900 px-1 py-0.5">
                        <span className={hasTicket ? "font-bold text-red-600" : "font-bold text-emerald-600"}>
                          [{store.kode_toko}]
                        </span>{" "}
                        {store.nama_toko} •{" "}
                        <span className={hasTicket ? "text-red-600 font-bold" : "text-emerald-700 font-medium"}>
                          {hasTicket ? `${ticketCount} Tiket AHO Aktif` : "Tanpa Tiket Aktif"}
                        </span>
                      </div>
                    </Tooltip>
                  </Marker>
                );
              })}
          </>
        )}
      </MapContainer>

      {/* AHO LAYER CONTEXTUAL FLOATING LEGEND (Zoom-adaptive & Collapsible) */}
      {isAhoLayer && (
        <AhoLegend
          zoom={currentZoom}
          lastUpdated={ahoLastUpdated}
          className="absolute bottom-6 left-3"
        />
      )}

      {/* AHO Loading Indicator */}
      {isAhoLayer && ahoLoading && !ahoCounts && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 z-[460] px-3.5 py-2 rounded-full bg-slate-900/90 border border-amber-500/40 text-amber-300 text-xs font-semibold shadow-xl backdrop-blur-md flex items-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin text-amber-400" />
          <span>Memuat data tiket AHO SPARTA Maintenance...</span>
        </div>
      )}

      {/* AHO Error Alert */}
      {isAhoLayer && ahoError && (
        <div
          role="status"
          className="absolute top-16 left-1/2 -translate-x-1/2 z-[460] max-w-md px-3.5 py-2.5 rounded-xl bg-amber-950/95 border border-amber-500 text-amber-200 text-xs font-medium shadow-xl backdrop-blur-md flex items-center justify-between gap-3 animate-in fade-in"
        >
          <div className="flex items-center gap-2 min-w-0">
            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
            <span className="leading-tight">
              Data tiket AHO sedang tidak tersedia dari SPARTA Maintenance.
            </span>
          </div>
          <button
            type="button"
            onClick={() => setAhoRefreshKey((k) => k + 1)}
            className="shrink-0 rounded-lg border border-amber-400/80 px-2 py-1 text-[11px] font-bold hover:bg-amber-900/60 transition-colors"
          >
            Coba lagi
          </button>
        </div>
      )}
    </div>
  );
}
