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
import { Store } from "@/types/store";
import { Earthquake } from "@/types/disaster";
import {
  Building,
  ChevronRight,
  ShieldAlert,
  ExternalLink,
} from "lucide-react";

interface MapInnerProps {
  stores: Store[];
  locationMode?: "event" | "store" | "dc";
  earthquakes: Earthquake[];
  basemap: "esri-dark" | "esri-light" | "osm";
  incidentOnly: boolean;
  statusFilter: "all" | "PRIORITY_MONITOR" | "MONITOR" | "SAFE";
  selectedStore: Store | null;
  onSelectStore: (store: Store) => void;
  flyToTarget: { lat: number; lng: number; zoom?: number } | null;
  showRadar?: boolean;
  radarTileUrl?: string;
  activeLayer?: "all" | "earthquake" | "stores" | "weather" | "flood";
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

// Leaflet does not always notice sidebar transitions or parent panel resizing.
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
    sync();
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", sync);
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

// Function to generate dynamic Alfamart store and DC markers using L.divIcon
function createStoreIcon(store: Store, isSelected: boolean = false) {
  const isFacility = store.id.startsWith("FACILITY:");
  const isDC = isFacility && (store.fr_type === "FACILITY_DC" || (store.nama_toko && store.nama_toko.toUpperCase().includes("DC")));
  const markerLabel = isDC ? "DC" : isFacility ? "F" : "A";
  const visualStatus = store.visualStatus || (
    store.status === "PRIORITY_MONITOR" ? "TERDAMPAK" :
    store.status === "MONITOR" ? "PERLU_PERHATIAN" : "NORMAL"
  );

  let ringColor = isDC ? "border-indigo-500 shadow-indigo-500/20" : "border-emerald-500 shadow-emerald-500/20";
  let pulseClass = "";
  let badgeColor = isDC ? "bg-indigo-600" : "bg-emerald-600";
  let innerColor = isDC ? "bg-indigo-600" : "bg-emerald-600";

  if (isSelected) {
    ringColor = "border-cyan-400 shadow-cyan-400/80 scale-125";
    pulseClass = "pulse-beacon";
    badgeColor = "bg-cyan-500";
    innerColor = "bg-cyan-500";
  } else if (visualStatus === "TERDAMPAK") {
    ringColor = "border-red-600 shadow-red-600/50";
    pulseClass = "pulse-beacon";
    badgeColor = "bg-red-600";
    innerColor = "bg-red-600";
  } else if (visualStatus === "DALAM_PENANGANAN") {
    ringColor = "border-blue-500 shadow-blue-500/40";
    pulseClass = "pulse-beacon";
    badgeColor = "bg-blue-600";
    innerColor = "bg-blue-600";
  } else if (visualStatus === "PERLU_PERHATIAN") {
    ringColor = "border-amber-500 shadow-amber-500/30";
    badgeColor = "bg-amber-500";
    innerColor = "bg-amber-500";
  } else if (visualStatus === "SELESAI") {
    ringColor = "border-teal-500 shadow-teal-500/30";
    badgeColor = "bg-teal-600";
    innerColor = "bg-teal-600";
  }

  const isFlood = !!store.floodWarning;

  const html = `
    <div class="relative group cursor-pointer flex items-center justify-center">
      ${isSelected
        ? `<div class="absolute -inset-3 bg-cyan-400/50 rounded-full animate-ping"></div>`
        : visualStatus === "TERDAMPAK"
        ? `<div class="absolute -inset-2 bg-red-600/40 rounded-full animate-ping"></div>`
        : visualStatus === "DALAM_PENANGANAN"
        ? `<div class="absolute -inset-2 bg-blue-500/30 rounded-full animate-pulse"></div>`
        : isFlood
        ? `<div class="absolute -inset-2 bg-blue-500/40 rounded-full animate-ping"></div>`
        : ""
      }
      <div class="w-8 h-8 rounded-full bg-slate-900 border-2 ${ringColor} ${pulseClass} flex items-center justify-center shadow-lg transition-transform hover:scale-125 z-20">
        <div class="w-5 h-5 rounded-full ${innerColor} flex items-center justify-center ${isDC ? "text-[8px]" : "text-[9px]"} font-black text-white tracking-tighter">
          ${markerLabel}
        </div>
      </div>
      <div class="absolute -bottom-1 -right-1 w-3 h-3 rounded-full ${badgeColor} border border-slate-900 z-30"></div>
      ${isFlood
        ? `<div class="absolute -top-1.5 -left-1.5 w-4 h-4 rounded-full bg-blue-600 border border-slate-900 text-[8px] flex items-center justify-center shadow-md z-30" title="Peringatan Banjir / Hujan Lebat">💧</div>`
        : ""
      }
    </div>
  `;

  return L.divIcon({
    html,
    className: "custom-store-pin",
    iconSize: [32, 32],
    iconAnchor: [16, 16],
    popupAnchor: [0, -18],
  });
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

interface BranchAggregation {
  cabang: string;
  latitude: number;
  longitude: number;
  totalStores: number;
  dangerCount: number;
  warningCount: number;
}

function createBranchIcon(branch: BranchAggregation) {
  const hasDanger = branch.dangerCount > 0;
  const hasWarning = branch.warningCount > 0;

  const badgeBg = hasDanger
    ? "bg-red-600 border-red-300 ring-4 ring-red-500/30"
    : hasWarning
      ? "bg-amber-600 border-amber-300 ring-4 ring-amber-500/20"
      : "bg-slate-900 border-cyan-400/80 shadow-cyan-500/20";

  const dotColor = hasDanger ? "bg-white animate-ping" : hasWarning ? "bg-white" : "bg-cyan-400";

  const html = `
    <div class="relative flex items-center justify-center cursor-pointer group select-none">
      ${hasDanger ? '<div class="absolute -inset-3 bg-red-600/40 rounded-full animate-ping"></div>' : ''}
      <div class="px-3 py-1 rounded-full ${badgeBg} border-2 text-white shadow-2xl flex items-center gap-2 font-bold text-xs whitespace-nowrap transition-transform duration-200 group-hover:scale-110">
        <span class="w-2.5 h-2.5 rounded-full ${dotColor} shrink-0"></span>
        <span class="tracking-tight text-[11px] font-semibold">${branch.cabang}</span>
        <span class="px-1.5 py-0.2 rounded-full bg-white/20 text-[10px] font-mono font-bold">${branch.totalStores} Toko</span>
      </div>
    </div>
  `;

  return L.divIcon({
    html,
    className: "custom-branch-marker",
    iconSize: [140, 32],
    iconAnchor: [70, 16],
    popupAnchor: [0, -18],
  });
}

// Function to generate grid cluster icon for Zoom 8–12 (Requirement 12)
function createClusterIcon(count: number) {
  const size = count > 100 ? 38 : count > 20 ? 34 : 30;
  const html = `
    <div class="relative flex items-center justify-center cursor-pointer group select-none">
      <div class="w-${size} h-${size} rounded-full bg-slate-900/90 border-2 border-emerald-400 text-emerald-300 shadow-xl flex items-center justify-center font-bold text-xs transition-transform duration-200 group-hover:scale-110">
        <span class="font-mono text-[11px]">${count}</span>
      </div>
    </div>
  `;

  return L.divIcon({
    html,
    className: "custom-grid-cluster",
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    popupAnchor: [0, -size / 2],
  });
}

// Subcomponent to render a clickable cluster marker with smooth flyTo zoom
function ClusterMarkerItem({
  cluster,
  zoom,
}: {
  cluster: { lat: number; lng: number; count: number; stores: Store[] };
  zoom: number;
}) {
  const map = useMap();

  return (
    <Marker
      position={[cluster.lat, cluster.lng]}
      icon={createClusterIcon(cluster.count)}
      eventHandlers={{
        click: () => {
          map.flyTo([cluster.lat, cluster.lng], Math.min(14, zoom + 2), {
            duration: 0.8,
          });
        },
      }}
    >
      <Tooltip direction="top" offset={[0, -16]} opacity={0.95}>
        <div className="text-xs font-semibold text-slate-900 px-1">
          {cluster.count} Toko, klik untuk memperbesar
        </div>
      </Tooltip>
    </Marker>
  );
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

  const showEarthquakes = activeLayer === "all" || activeLayer === "earthquake";
  const showStoresLayer = activeLayer === "all" || activeLayer === "stores";

  // Requirement: Radar is only visible when specifically enabled and zoomed in to prevent global watermark clutter.
  const isRadarEnabled = showRadar || activeLayer === "weather";
  const showWeatherLayer = isRadarEnabled;

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

    const result: BranchAggregation[] = [];
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

        {/* 1. DISASTER EPICENTERS & SPARTA MONITORING ZONES (Requirement 30) */}
        {showEarthquakes &&
          earthquakes.map((eq) => {
            const priorityRadius = eq.priorityRadiusKm || 50;
            const monitoringRadius = eq.monitoringRadiusKm || 110;

            return (
              <React.Fragment key={eq.id}>
                {/* Zona Prioritas Pantau SPARTA */}
                <Circle
                  center={[eq.latitude, eq.longitude]}
                  radius={priorityRadius * 1000}
                  pathOptions={{
                    color: "#dc2626",
                    fillColor: "#dc2626",
                    fillOpacity: 0.16,
                    weight: 2,
                    dashArray: "6, 6",
                  }}
                />

                {/* Zona Pantau SPARTA */}
                <Circle
                  center={[eq.latitude, eq.longitude]}
                  radius={monitoringRadius * 1000}
                  pathOptions={{
                    color: "#f59e0b",
                    fillColor: "#f59e0b",
                    fillOpacity: 0.05,
                    weight: 1.5,
                    dashArray: "4, 8",
                  }}
                />

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
                          <span className={`font-bold ${isDark ? "text-red-400" : "text-red-600"}`}>Zona Prioritas Pantau SPARTA:</span>
                          <span className={`font-mono font-bold ${isDark ? "text-white" : "text-slate-900"}`}>{priorityRadius} km</span>
                        </div>
                        <div className="flex justify-between items-center">
                          <span className={`font-bold ${isDark ? "text-amber-400" : "text-amber-600"}`}>Zona Pantau SPARTA:</span>
                          <span className={`font-mono font-bold ${isDark ? "text-white" : "text-slate-900"}`}>{monitoringRadius} km</span>
                        </div>
                      </div>

                      <p className={`text-[9px] italic leading-tight ${isDark ? "text-slate-400" : "text-slate-500"}`}>
                        Zona pantau merupakan estimasi operasional SPARTA berdasarkan parameter gempa dari BMKG.
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

        {/* DC mode: few master locations, always render INDIVIDUAL markers,
            independently of zoom. Click resolves the same LocationDetailPanel as stores. */}
        {showStoresLayer && locationMode === "dc" && stores.map((dc) => (
          <Marker
            key={dc.id}
            position={[dc.latitude, dc.longitude]}
            icon={createStoreIcon(dc, selectedStore?.id === dc.id)}
            eventHandlers={{ click: () => onSelectStore(dc) }}
          >
            <Tooltip direction="top" offset={[0, -18]} opacity={0.95}>
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
            {/* LEVEL NASIONAL / PROVINSI (Zoom <= 7): Titik Percabang (Kantor Cabang / DC) */}
            {currentZoom <= 7 &&
              branchAggregations.map((branch) => (
                <Marker
                  key={branch.cabang}
                  position={[branch.latitude, branch.longitude]}
                  icon={createBranchIcon(branch)}
                  eventHandlers={{
                    click: (e) => {
                      e.target._map?.flyTo([branch.latitude, branch.longitude], 10, {
                        duration: 1.2,
                      });
                    },
                  }}
                >
                  <Tooltip direction="top" offset={[0, -18]} opacity={0.95}>
                    <div className="text-xs font-semibold text-slate-900 px-1">
                      Klik untuk fokus ke {branch.cabang} ({branch.totalStores} Toko)
                    </div>
                  </Tooltip>
                </Marker>
              ))}

            {/* LEVEL REGIONAL / KABUPATEN (Zoom 8–12): Grid Clustering untuk Normal/Safe Stores (Req 12) */}
            {currentZoom >= 8 &&
              currentZoom <= 12 &&
              !incidentOnly &&
              clusteredSafeStores.map((cluster, idx) => {
                if (cluster.count === 1) {
                  const s = cluster.stores[0];
                  return (
                    <CircleMarker
                      key={`single-${s.id}`}
                      center={[s.latitude, s.longitude]}
                      radius={4}
                      pathOptions={{
                        color: "#059669",
                        fillColor: "#10b981",
                        fillOpacity: 0.8,
                        weight: 1,
                      }}
                      eventHandlers={{
                        click: () => onSelectStore(s),
                      }}
                    >
                      <Tooltip direction="top" offset={[0, -5]} opacity={0.9}>
                        <div className="text-[11px] font-medium text-slate-900 px-1">
                          <span className="font-bold text-emerald-700">[{s.kode_toko}]</span>{" "}
                          {s.nama_toko}
                        </div>
                      </Tooltip>
                    </CircleMarker>
                  );
                }

                return (
                  <ClusterMarkerItem
                    key={`cluster-${cluster.lat.toFixed(3)}_${cluster.lng.toFixed(3)}_${idx}`}
                    cluster={cluster}
                    zoom={currentZoom}
                  />
                );
              })}

            {/* LEVEL KOTA / JALAN (Zoom >= 13): Individual Safe Store Markers dengan Viewport Culling */}
            {currentZoom >= 13 &&
              !incidentOnly &&
              safeStores
                .filter((store) => !mapBounds || mapBounds.contains([store.latitude, store.longitude]))
                .map((store) => (
                  <CircleMarker
                    key={store.id}
                    center={[store.latitude, store.longitude]}
                    radius={6}
                    pathOptions={{
                      color: "#059669",
                      fillColor: "#10b981",
                      fillOpacity: 0.75,
                      weight: 1.5,
                    }}
                    eventHandlers={{
                      click: () => onSelectStore(store),
                    }}
                  >
                    <Tooltip direction="top" offset={[0, -5]} opacity={0.9}>
                      <div className="text-[11px] font-medium text-slate-900 px-1">
                        <span className="font-bold text-emerald-700">[{store.kode_toko}]</span>{" "}
                        {store.nama_toko} ({store.cabang})
                      </div>
                    </Tooltip>
                  </CircleMarker>
                ))}
          </>
        )}

        {/* 3. OPERATIONAL & AFFECTED STORES (Requirements 10, 11, 31)
            Always distinctly visible on Zoom >= 8 even if quake >72h old */}
        {showStoresLayer && locationMode !== "dc" &&
          currentZoom >= 8 &&
          operationalStores.map((store) => {
            const isDanger =
              store.visualStatus === "TERDAMPAK" || store.status === "PRIORITY_MONITOR";
            const isSelected = store.id === selectedStore?.id;

            return (
              <Marker
                key={store.id}
                position={[store.latitude, store.longitude]}
                icon={createStoreIcon(store, isSelected)}
                eventHandlers={{
                  click: (e) => {
                    onSelectStore(store);
                    e.target.openPopup();
                  },
                }}
              >
                <Tooltip direction="top" offset={[0, -18]} opacity={0.95}>
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

                {/* Final Store Popup (Requirement 31) */}
                <Popup className={`custom-leaflet-popup ${isDark ? "popup-dark" : "popup-light"}`}>
                  <div className={`p-3 rounded-xl border w-72 space-y-2 text-xs transition-colors ${
                    isDark ? "bg-slate-900 text-white border-slate-700 shadow-2xl" : "bg-white text-slate-900 border-slate-200 shadow-xl"
                  }`}>
                    <div className="flex items-center justify-between">
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-mono font-bold border ${
                        isDark ? "bg-slate-800 text-slate-300 border-slate-700" : "bg-slate-100 text-slate-700 border-slate-200"
                      }`}>
                        {store.kode_toko}
                      </span>
                      <span
                        className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                          store.visualStatus === "TERDAMPAK"
                            ? "bg-red-600 text-white animate-pulse"
                            : store.visualStatus === "DALAM_PENANGANAN"
                            ? "bg-blue-600 text-white"
                            : store.visualStatus === "PERLU_PERHATIAN"
                            ? "bg-amber-600 text-white"
                            : store.visualStatus === "SELESAI"
                            ? "bg-emerald-600 text-white"
                            : isDark ? "bg-slate-700 text-slate-300" : "bg-slate-200 text-slate-700"
                        }`}
                      >
                        {store.visualStatus === "TERDAMPAK"
                          ? "Terdampak"
                          : store.visualStatus === "DALAM_PENANGANAN"
                          ? "Dalam Penanganan"
                          : store.visualStatus === "PERLU_PERHATIAN"
                          ? "Perlu Perhatian"
                          : store.visualStatus === "SELESAI"
                          ? "Selesai"
                          : isDanger
                          ? "Prioritas Pantau"
                          : "Perlu Pantau"}
                      </span>
                    </div>

                    <h3 className={`font-bold text-sm leading-snug ${isDark ? "text-white" : "text-slate-900"}`}>
                      {store.nama_toko}
                    </h3>

                    <div className={`text-[11px] flex items-center gap-1 ${isDark ? "text-slate-400" : "text-slate-500"}`}>
                      <Building className="w-3 h-3 text-slate-400" />
                      <span>Cabang {store.cabang}</span>
                      <span className="text-slate-400">•</span>
                      <span className={`font-medium ${isDark ? "text-slate-300" : "text-slate-700"}`}>
                        {store.fr_type === "F" ? "Franchise" : "Reguler"}
                      </span>
                    </div>

                    {/* 2D Status Details (Requirement 9 & 31) */}
                    <div className={`p-2 rounded border text-[11px] space-y-1 ${
                      isDark ? "bg-slate-950/80 border-slate-800" : "bg-slate-50 border-slate-200 text-slate-700"
                    }`}>
                      <div className="flex justify-between">
                        <span className={isDark ? "text-slate-400" : "text-slate-500"}>Status Spasial:</span>
                        <span className={`font-semibold ${isDark ? "text-slate-200" : "text-slate-900"}`}>
                          {store.spatialRisk === "PRIORITY_MONITOR"
                            ? "Prioritas Pantau"
                            : store.spatialRisk === "MONITOR"
                            ? "Perlu Dipantau"
                            : "Aman"}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className={isDark ? "text-slate-400" : "text-slate-500"}>Status Operasional:</span>
                        <span className={`font-semibold ${isDark ? "text-slate-200" : "text-slate-900"}`}>
                          {store.operationalStatus === "CONFIRMED_AFFECTED"
                            ? "Terdampak Lapangan"
                            : store.operationalStatus === "NEED_CONFIRMATION"
                            ? "Perlu Konfirmasi"
                            : store.operationalStatus === "IN_PROGRESS" ||
                              store.operationalStatus === "ESTIMATION" ||
                              store.operationalStatus === "READY_FOR_WORK"
                            ? "Dalam Penanganan"
                            : store.operationalStatus === "RESOLVED" ||
                              store.operationalStatus === "WORK_COMPLETED"
                            ? "Selesai"
                            : "Tidak Ada Laporan"}
                        </span>
                      </div>
                      {store.riskSourceEvent && (
                        <div className={`flex justify-between text-[10px] pt-1 border-t ${
                          isDark ? "border-slate-800/80" : "border-slate-200"
                        }`}>
                          <span className={isDark ? "text-slate-400" : "text-slate-500"}>Sumber Risiko:</span>
                          <span
                            className="font-medium text-amber-600 dark:text-amber-300 text-right truncate max-w-[140px]"
                            title={store.riskSourceEvent.title}
                          >
                            M{store.riskSourceEvent.magnitude} {store.riskSourceEvent.title}
                          </span>
                        </div>
                      )}
                      {store.distanceFromDisasterKm !== undefined && (
                        <div className="flex justify-between text-[10px]">
                          <span className={isDark ? "text-slate-400" : "text-slate-500"}>Jarak Episentrum:</span>
                          <span className={`font-mono font-bold ${isDark ? "text-slate-200" : "text-slate-900"}`}>
                            {store.distanceFromDisasterKm} km
                          </span>
                        </div>
                      )}
                      {store.activeReportProgress !== undefined && (
                        <div className={`flex justify-between text-[10px] text-blue-500 dark:text-blue-300 pt-1 border-t ${
                          isDark ? "border-slate-800/80" : "border-slate-200"
                        }`}>
                          <span>Progress Penanganan:</span>
                          <span className="font-mono font-bold">
                            {store.activeReportProgress}%
                          </span>
                        </div>
                      )}
                    </div>

                    {store.floodWarning && (
                      <div className="p-1.5 rounded bg-blue-950/80 border border-blue-600/60 text-[10px] text-blue-200 flex items-center gap-1.5">
                        <span className="text-xs shrink-0">🌧️</span>
                        <div className="leading-tight">
                          <span className="font-bold text-blue-300">Waspada Potensi Banjir</span>
                          {store.rainIntensityMm && (
                            <span className="block text-slate-300 text-[9px]">
                              Curah Hujan: {store.rainIntensityMm} mm/jam
                            </span>
                          )}
                        </div>
                      </div>
                    )}

                    <button
                      onClick={() => onSelectStore(store)}
                      className="w-full mt-2 py-1.5 px-3 rounded-lg bg-red-600 hover:bg-red-500 text-white font-medium text-xs flex items-center justify-center gap-1 transition-colors"
                    >
                      <span>Lihat Detail</span>
                      <ChevronRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </Popup>
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
          !operationalStores.some((s) => s.id === selectedStore.id) && (
            <Marker
              key={`selected-${selectedStore.id}`}
              position={[selectedStore.latitude, selectedStore.longitude]}
              icon={createStoreIcon(selectedStore, true)}
              eventHandlers={{
                click: (e) => {
                  onSelectStore(selectedStore);
                  e.target.openPopup();
                },
              }}
            >
              <Tooltip direction="top" offset={[0, -18]} opacity={0.98} permanent>
                <div className="text-xs font-bold text-slate-900 px-1.5 py-0.5 flex items-center gap-1.5">
                  <span className="text-cyan-600 font-extrabold">🎯 [{selectedStore.kode_toko}]</span>
                  <span>{selectedStore.nama_toko}</span>
                  <span className="text-slate-500 font-normal">({selectedStore.cabang})</span>
                </div>
              </Tooltip>

              <Popup className={`custom-leaflet-popup ${isDark ? "popup-dark" : "popup-light"}`}>
                <div className={`p-3 rounded-xl border w-68 space-y-2 text-xs transition-colors ${
                  isDark ? "bg-slate-900 text-white border-slate-700 shadow-2xl" : "bg-white text-slate-900 border-slate-200 shadow-xl"
                }`}>
                  <div className="flex items-center justify-between">
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-mono font-bold bg-cyan-600/20 text-cyan-600 dark:text-cyan-400 border border-cyan-500/30">
                      {selectedStore.kode_toko}
                    </span>
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-emerald-600/20 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30">
                      Operasional Aman
                    </span>
                  </div>

                  <h3 className={`font-bold text-sm leading-snug ${isDark ? "text-white" : "text-slate-900"}`}>
                    {selectedStore.nama_toko}
                  </h3>

                  <div className={`text-[11px] flex items-center gap-1 ${isDark ? "text-slate-400" : "text-slate-500"}`}>
                    <Building className="w-3 h-3 text-slate-400" />
                    <span>Cabang {selectedStore.cabang}</span>
                    <span className="text-slate-400">•</span>
                    <span className={`font-medium ${isDark ? "text-slate-300" : "text-slate-700"}`}>
                      {selectedStore.fr_type === "F" ? "Franchise" : "Reguler"}
                    </span>
                  </div>

                  {selectedStore.floodWarning && (
                    <div className={`p-1.5 rounded border text-[10px] flex items-center gap-1.5 ${
                      isDark ? "bg-blue-950/80 border-blue-600/60 text-blue-200" : "bg-blue-50 border-blue-200 text-blue-900"
                    }`}>
                      <span className="text-xs shrink-0">🌧️</span>
                      <div className="leading-tight">
                        <span className="font-bold text-blue-500">Waspada Potensi Banjir</span>
                        {selectedStore.rainIntensityMm && (
                          <span className={`block text-[9px] ${isDark ? "text-slate-300" : "text-slate-600"}`}>
                            Curah Hujan: {selectedStore.rainIntensityMm} mm/jam
                          </span>
                        )}
                      </div>
                    </div>
                  )}

                  <button
                    onClick={() => onSelectStore(selectedStore)}
                    className="w-full mt-2 py-1.5 px-3 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white font-medium text-xs flex items-center justify-center gap-1 transition-colors shadow-sm"
                  >
                    <span>Lihat Detail</span>
                    <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </Popup>
            </Marker>
          )}
      </MapContainer>
    </div>
  );
}
