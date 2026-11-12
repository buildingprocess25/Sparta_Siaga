"use client";

import type L from "leaflet";
import { Store, SpatialRisk } from "@/types/store";
import {
  getAhoColor,
  getAhoIndividualStoreStatus,
  calculateAhoPercentage,
} from "@/lib/aho-utils";

function toDivIcon(options: SpartaMarkerOptions): L.DivIcon {
  if (typeof window !== "undefined") {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Leaflet = require("leaflet");
    return Leaflet.divIcon(options);
  }
  return { options } as unknown as L.DivIcon;
}

/**
 * SPARTA SIAGA — MAP MARKER DESIGN SYSTEM
 * Reference: monitoring-map-design.md Sections 4 - 8
 * 
 * Distinct Marker Silhouettes:
 * 1. Cabang  : Anchored flag-style marker (Branch aggregation)
 * 2. Cluster : Circular aggregate / proportional donut (Geographic grouping)
 * 3. Toko    : Teardrop location pin (Individual store point)
 * 4. DC      : Facility marker with warehouse iconography (Distribution Center)
 */

export interface BranchAggregationData {
  cabang: string;
  latitude: number;
  longitude: number;
  totalStores: number;
  dangerCount?: number;
  warningCount?: number;
  storesWithTickets?: number;
  totalTickets?: number;
  percentage?: number;
}

export interface ClusterAggregationData {
  lat: number;
  lng: number;
  totalStores: number;
  storesWithTickets?: number;
  totalTickets?: number;
  percentage?: number;
  stores?: Store[];
}

export interface SpartaMarkerOptions {
  html: string;
  className: string;
  iconSize: [number, number];
  iconAnchor: [number, number];
  popupAnchor: [number, number];
}

/**
 * 1. MARKER CABANG: Anchored Flag-Style Marker
 * Height: 28-32px card, anchor at center-bottom stem.
 */
export function getBranchFlagIconOptions(
  branch: BranchAggregationData,
  isAho: boolean = false,
  isSelected: boolean = false
): SpartaMarkerOptions {
  const branchName = branch.cabang || "Lainnya";

  let indicatorColor = "bg-emerald-500";
  let metricText = `${branch.totalStores} Toko`;
  let metricBadgeClass = "bg-slate-800/90 text-slate-200 border-slate-700";
  let borderClass = isSelected
    ? "border-cyan-400 ring-2 ring-cyan-400/50"
    : "border-slate-700/80 hover:border-slate-400";

  if (isAho) {
    const pct = branch.percentage ?? 0;
    const ahoColor = getAhoColor(pct);
    indicatorColor = ahoColor.bgClass;
    metricText = `${Math.round(pct)}%`;
    metricBadgeClass = ahoColor.badgeClass;
    if (pct > 70) {
      borderClass = isSelected
        ? "border-cyan-400 ring-2 ring-cyan-400/50"
        : "border-red-600/80 hover:border-red-400";
    }
  } else {
    const hasDanger = (branch.dangerCount ?? 0) > 0;
    const hasWarning = (branch.warningCount ?? 0) > 0;
    if (hasDanger) {
      indicatorColor = "bg-red-500 animate-pulse";
      metricBadgeClass = "bg-red-950/80 text-red-200 border-red-800";
    } else if (hasWarning) {
      indicatorColor = "bg-amber-500";
      metricBadgeClass = "bg-amber-950/80 text-amber-200 border-amber-800";
    }
  }

  // Anchored flag with pointer stem
  const html = `
    <div class="sparta-branch-marker group cursor-pointer select-none flex flex-col items-center">
      <div class="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-slate-900/95 dark:bg-slate-950/95 border ${borderClass} text-slate-100 shadow-md backdrop-blur-xs transition-all duration-150 group-hover:scale-105 group-hover:z-50">
        <span class="w-2 h-2 rounded-full ${indicatorColor} shrink-0"></span>
        <span class="text-[11px] font-semibold tracking-tight text-slate-100 whitespace-nowrap max-w-[95px] truncate" title="${branchName}">
          ${branchName}
        </span>
        <span class="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded border ${metricBadgeClass} whitespace-nowrap">
          ${metricText}
        </span>
      </div>
      <div class="w-0 h-0 border-x-4 border-x-transparent border-t-5 border-t-slate-800 -mt-px"></div>
      <div class="w-1.5 h-1.5 rounded-full bg-cyan-400/90 border border-slate-950 shadow-xs -mt-0.5"></div>
    </div>
  `;

  return {
    html,
    className: "sparta-branch-div-icon",
    iconSize: [140, 34],
    iconAnchor: [70, 34],
    popupAnchor: [0, -34],
  };
}

export function createBranchFlagIcon(
  branch: BranchAggregationData,
  isAho: boolean = false,
  isSelected: boolean = false
): L.DivIcon {
  return toDivIcon(getBranchFlagIconOptions(branch, isAho, isSelected));
}

/**
 * 2. MARKER CLUSTER: Circular Aggregate Marker (Zoom 8–12)
 * Distinct circle silhouette with optional mathematically exact proportional SVG donut.
 */
export function getClusterCircleIconOptions(
  totalStores: number,
  isAho: boolean = false,
  storesWithTickets: number = 0,
  percentage: number = 0,
  isSelected: boolean = false
): SpartaMarkerOptions {
  if (isAho) {
    // Proportional Donut Marker
    const ahoColor = getAhoColor(percentage);
    const size = 42;
    const radius = 16;
    const circumference = 2 * Math.PI * radius; // ~100.53
    // Exact proportional progress arc:
    const safePct = Math.min(100, Math.max(0, percentage));
    const arcLength = (safePct / 100) * circumference;
    const strokeColor = ahoColor.color;
    const selectedRing = isSelected ? "ring-2 ring-cyan-400 ring-offset-2 ring-offset-slate-900" : "";

    const html = `
      <div class="sparta-cluster-aho group cursor-pointer select-none relative flex items-center justify-center transition-transform duration-150 group-hover:scale-110 ${selectedRing}">
        <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" class="transform -rotate-90 drop-shadow-md">
          <!-- Background track -->
          <circle cx="21" cy="21" r="${radius}" fill="#0f172a" stroke="#334155" stroke-width="3" />
          <!-- Mathematically proportional active arc -->
          <circle
            cx="21"
            cy="21"
            r="${radius}"
            fill="none"
            stroke="${strokeColor}"
            stroke-width="3.5"
            stroke-dasharray="${arcLength.toFixed(2)} ${circumference.toFixed(2)}"
            stroke-linecap="round"
          />
        </svg>
        <div class="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <span class="font-mono text-[10px] font-extrabold leading-none text-white">${Math.round(percentage)}%</span>
          <span class="font-mono text-[8px] text-slate-400 leading-none mt-0.5">${storesWithTickets}/${totalStores}</span>
        </div>
      </div>
    `;

    return {
      html,
      className: "sparta-cluster-aho-icon",
      iconSize: [size, size],
      iconAnchor: [size / 2, size / 2],
      popupAnchor: [0, -size / 2],
    };
  }

  // Standard Store Cluster (Zoom 8–12)
  const size = totalStores > 100 ? 42 : totalStores > 20 ? 38 : 34;
  const selectedBorder = isSelected ? "border-cyan-400 ring-2 ring-cyan-400/50" : "border-emerald-600/70 hover:border-emerald-400";

  const html = `
    <div class="sparta-cluster-standard group cursor-pointer select-none flex items-center justify-center">
      <div style="width:${size}px; height:${size}px;" class="rounded-full bg-slate-900/95 dark:bg-slate-950/95 border-2 ${selectedBorder} text-slate-100 shadow-md flex items-center justify-center font-mono font-bold text-xs transition-transform duration-150 group-hover:scale-110">
        <span class="text-[11px] text-emerald-400 font-extrabold">${totalStores}</span>
      </div>
    </div>
  `;

  return {
    html,
    className: "sparta-cluster-std-icon",
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    popupAnchor: [0, -size / 2],
  };
}

export function createClusterCircleIcon(
  totalStores: number,
  isAho: boolean = false,
  storesWithTickets: number = 0,
  percentage: number = 0,
  isSelected: boolean = false
): L.DivIcon {
  return toDivIcon(getClusterCircleIconOptions(totalStores, isAho, storesWithTickets, percentage, isSelected));
}

/**
 * 3. MARKER TOKO INDIVIDUAL: Geographic Teardrop Location Pin (Zoom >= 13)
 * Siluet pin lokasi dengan titik anchor pada ujung bawah pin.
 */
export function getStoreTeardropIconOptions(
  store: Store,
  isAho: boolean = false,
  hasTicket: boolean = false,
  ticketCount: number = 0,
  isSelected: boolean = false,
  isAhoAvailable: boolean = true
): SpartaMarkerOptions {
  const width = isSelected ? 28 : 22;
  const height = isSelected ? 34 : 28;
  const anchorX = width / 2;
  const anchorY = height;

  let pinFill = "#0f172a";
  let pinStroke = "#334155";
  let innerBadgeColor = "#10b981";
  let innerContent = "";
  let pulseEffect = "";

  if (isAho) {
    const status = getAhoIndividualStoreStatus(hasTicket, isAhoAvailable);
    pinFill = status.color;
    pinStroke = isSelected ? "#38bdf8" : "#ffffff";
    innerBadgeColor = "#ffffff";
    if (hasTicket) {
      pulseEffect = isSelected
        ? '<div class="absolute -inset-2 bg-red-500/40 rounded-full animate-ping"></div>'
        : '<div class="absolute -inset-1 bg-red-500/30 rounded-full animate-pulse"></div>';
      innerContent = ticketCount > 9 ? "9+" : String(ticketCount || 1);
    } else {
      innerContent = "";
    }
  } else {
    // Standard Mode Status
    const visualStatus = store.visualStatus || (
      store.status === "PRIORITY_MONITOR" ? "TERDAMPAK" :
      store.status === "MONITOR" ? "PERLU_PERHATIAN" : "NORMAL"
    );

    if (isSelected) {
      pinFill = "#0284c7";
      pinStroke = "#38bdf8";
      pulseEffect = '<div class="absolute -inset-2 bg-cyan-400/40 rounded-full animate-ping"></div>';
    } else if (visualStatus === "TERDAMPAK") {
      pinFill = "#dc2626";
      pinStroke = "#ffffff";
      pulseEffect = '<div class="absolute -inset-1.5 bg-red-600/40 rounded-full animate-ping"></div>';
    } else if (visualStatus === "DALAM_PENANGANAN") {
      pinFill = "#2563eb";
      pinStroke = "#ffffff";
      pulseEffect = '<div class="absolute -inset-1 bg-blue-500/30 rounded-full animate-pulse"></div>';
    } else if (visualStatus === "PERLU_PERHATIAN") {
      pinFill = "#d97706";
      pinStroke = "#ffffff";
    } else if (visualStatus === "SELESAI") {
      pinFill = "#0d9488";
      pinStroke = "#ffffff";
    } else {
      // Normal store
      pinFill = "#059669";
      pinStroke = "#ffffff";
    }
  }

  // Smooth SVG Teardrop Pin Path
  const html = `
    <div class="sparta-store-pin group cursor-pointer relative flex items-center justify-center">
      ${pulseEffect}
      <svg width="${width}" height="${height}" viewBox="0 0 24 30" fill="none" class="drop-shadow-md transition-transform duration-150 group-hover:scale-125">
        <!-- Pin Body -->
        <path
          d="M12 1.5C6.75 1.5 2.5 5.75 2.5 11C2.5 17.5 12 28.5 12 28.5C12 28.5 21.5 17.5 21.5 11C21.5 5.75 17.25 1.5 12 1.5Z"
          fill="${pinFill}"
          stroke="${pinStroke}"
          stroke-width="1.75"
          stroke-linejoin="round"
        />
        <!-- Inner Center Circle -->
        <circle cx="12" cy="11" r="${innerContent ? 6.5 : 4}" fill="#0f172a" stroke="${pinStroke}" stroke-width="1" />
        ${
          innerContent
            ? `<text x="12" y="13.5" font-size="8" font-family="monospace" font-weight="900" fill="#ffffff" text-anchor="middle">${innerContent}</text>`
            : `<circle cx="12" cy="11" r="2.5" fill="#ffffff" />`
        }
      </svg>
    </div>
  `;

  return {
    html,
    className: "sparta-store-div-icon",
    iconSize: [width, height],
    iconAnchor: [anchorX, anchorY],
    popupAnchor: [0, -anchorY],
  };
}

export function createStoreTeardropIcon(
  store: Store,
  isAho: boolean = false,
  hasTicket: boolean = false,
  ticketCount: number = 0,
  isSelected: boolean = false,
  isAhoAvailable: boolean = true
): L.DivIcon {
  return toDivIcon(getStoreTeardropIconOptions(store, isAho, hasTicket, ticketCount, isSelected, isAhoAvailable));
}

/**
 * 4. MARKER DISTRIBUTION CENTER (DC): Facility Marker with Warehouse Icon
 * Rounded square / facility silhouette, clear warehouse iconography, SPARTA Siaga corporate styling.
 */
export function getDcFacilityIconOptions(
  dc: Store,
  isSelected: boolean = false
): SpartaMarkerOptions {
  const size = isSelected ? 36 : 30;
  const borderClass = isSelected
    ? "border-cyan-400 ring-2 ring-cyan-400/60 shadow-cyan-400/40"
    : "border-sky-500/80 hover:border-sky-300";
  const bgSurface = isSelected ? "bg-sky-950" : "bg-slate-900";

  // Lucide warehouse icon SVG representation
  const html = `
    <div class="sparta-dc-facility group cursor-pointer select-none flex flex-col items-center">
      ${isSelected ? '<div class="absolute -inset-2 bg-cyan-400/30 rounded-xl animate-ping"></div>' : ""}
      <div style="width:${size}px; height:${size}px;" class="rounded-lg ${bgSurface} border-2 ${borderClass} shadow-lg flex items-center justify-center text-sky-400 transition-all duration-150 group-hover:scale-115 z-20">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M22 8.35V20a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8.35A2 2 0 0 1 3.26 6.5l8-3.2a2 2 0 0 1 1.48 0l8 3.2A2 2 0 0 1 22 8.35Z"/>
          <path d="M6 18h12"/>
          <path d="M6 14h12"/>
          <rect width="12" height="12" x="6" y="10"/>
        </svg>
      </div>
      <!-- Precise downward facility anchor pointer -->
      <div class="w-0 h-0 border-x-3.5 border-x-transparent border-t-5 border-t-slate-800 -mt-px"></div>
      <div class="w-1.5 h-1.5 rounded-full bg-sky-400 border border-slate-950 -mt-0.5"></div>
    </div>
  `;

  return {
    html,
    className: "sparta-dc-div-icon",
    iconSize: [size + 4, size + 8],
    iconAnchor: [(size + 4) / 2, size + 8],
    popupAnchor: [0, -(size + 8)],
  };
}

export function createDcFacilityIcon(
  dc: Store,
  isSelected: boolean = false
): L.DivIcon {
  return toDivIcon(getDcFacilityIconOptions(dc, isSelected));
}
