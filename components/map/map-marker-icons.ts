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
 * Surface: Clean white/light surface, dark text, status-colored ring/accent, no dark navy fills.
 */
export function getBranchFlagIconOptions(
  branch: BranchAggregationData,
  isAho: boolean = false,
  isSelected: boolean = false
): SpartaMarkerOptions {
  const branchName = branch.cabang || "Lainnya";

  let indicatorColor = "bg-emerald-500";
  let metricText = `${branch.totalStores} Toko`;
  let metricBadgeClass = "bg-slate-100 text-slate-800 border-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:border-slate-700";
  let borderClass = isSelected
    ? "border-[#0284c7] ring-2 ring-[#0284c7]/40 shadow-sm"
    : "border-slate-300 dark:border-slate-700 hover:border-slate-400";
  let dotAnchorColor = "bg-[#0284c7]";

  if (isAho) {
    const pct = branch.percentage ?? 0;
    const ahoColor = getAhoColor(pct);
    indicatorColor = ahoColor.bgClass;
    metricText = `${Math.round(pct)}%`;
    metricBadgeClass = ahoColor.badgeClass;
    dotAnchorColor = ahoColor.color === "#dc2626" ? "bg-red-600" : "bg-[#0284c7]";
    if (pct > 70) {
      borderClass = isSelected
        ? "border-red-600 ring-2 ring-red-400/50 shadow-sm"
        : "border-red-500/80 hover:border-red-400";
    }
  } else {
    const hasDanger = (branch.dangerCount ?? 0) > 0;
    const hasWarning = (branch.warningCount ?? 0) > 0;
    if (hasDanger) {
      indicatorColor = "bg-red-500 animate-pulse";
      metricBadgeClass = "bg-red-50 text-red-700 border-red-200 dark:bg-red-950/60 dark:text-red-300 dark:border-red-800";
      borderClass = isSelected
        ? "border-red-600 ring-2 ring-red-400/50 shadow-sm"
        : "border-red-500/80 hover:border-red-400";
      dotAnchorColor = "bg-red-600";
    } else if (hasWarning) {
      indicatorColor = "bg-amber-500";
      metricBadgeClass = "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/60 dark:text-amber-300 dark:border-amber-800";
      borderClass = isSelected
        ? "border-amber-500 ring-2 ring-amber-400/50 shadow-sm"
        : "border-amber-400/80 hover:border-amber-300";
      dotAnchorColor = "bg-amber-500";
    }
  }

  // Anchored flag with clean white surface, dark text, and precise bottom anchor
  const html = `
    <div class="sparta-branch-marker group cursor-pointer select-none flex flex-col items-center">
      <div class="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-white dark:bg-slate-900 border ${borderClass} text-slate-900 dark:text-slate-100 shadow-md transition-all duration-150 group-hover:scale-105 group-hover:z-50">
        <span class="w-2 h-2 rounded-full ${indicatorColor} shrink-0 shadow-xs"></span>
        <span class="text-[11px] font-bold tracking-tight text-slate-800 dark:text-slate-100 whitespace-nowrap max-w-[95px] truncate" title="${branchName}">
          ${branchName}
        </span>
        <span class="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded border ${metricBadgeClass} whitespace-nowrap">
          ${metricText}
        </span>
      </div>
      <div class="w-0 h-0 border-x-4 border-x-transparent border-t-5 border-t-white dark:border-t-slate-900 drop-shadow-[0_1px_1px_rgba(0,0,0,0.15)] -mt-px"></div>
      <div class="w-1.5 h-1.5 rounded-full ${dotAnchorColor} border border-white dark:border-slate-800 shadow-xs -mt-0.5"></div>
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
    // Proportional Donut Marker with clean white surface and status-colored arc
    const ahoColor = getAhoColor(percentage);
    const size = 42;
    const radius = 16;
    const circumference = 2 * Math.PI * radius; // ~100.53
    // Exact proportional progress arc:
    const safePct = Math.min(100, Math.max(0, percentage));
    const arcLength = (safePct / 100) * circumference;
    const strokeColor = ahoColor.color;
    const selectedRing = isSelected ? "ring-2 ring-[#0284c7] ring-offset-2 ring-offset-white dark:ring-offset-slate-950" : "";

    const html = `
      <div class="sparta-cluster-aho group cursor-pointer select-none relative flex items-center justify-center transition-transform duration-150 group-hover:scale-110 rounded-full ${selectedRing}">
        <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" class="transform -rotate-90 drop-shadow-md">
          <!-- Clean white circular background track -->
          <circle cx="21" cy="21" r="${radius}" fill="#ffffff" stroke="#e2e8f0" stroke-width="3.5" />
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
          <span class="font-mono text-[10px] font-extrabold leading-none text-slate-900">${Math.round(percentage)}%</span>
          <span class="font-mono text-[8px] font-semibold text-slate-500 leading-none mt-0.5">${storesWithTickets}/${totalStores}</span>
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

  // Standard Store Cluster (Zoom 8–12): Light surface, category-colored border ring, dark number
  const size = totalStores > 100 ? 42 : totalStores > 20 ? 38 : 34;
  const selectedBorder = isSelected
    ? "border-[#0284c7] ring-2 ring-[#0284c7]/40 shadow-sm"
    : "border-emerald-600 hover:border-emerald-500";

  const html = `
    <div class="sparta-cluster-standard group cursor-pointer select-none flex items-center justify-center">
      <div style="width:${size}px; height:${size}px;" class="rounded-full bg-white dark:bg-slate-900 border-[2.5px] ${selectedBorder} text-slate-900 dark:text-slate-100 shadow-md flex items-center justify-center font-mono font-bold transition-transform duration-150 group-hover:scale-110">
        <span class="text-[11px] text-slate-900 dark:text-slate-100 font-extrabold">${totalStores}</span>
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
 * Siluet pin lokasi: surface putih/terang, border warna status, aksen/dot warna status di tengah.
 * Bebas fill hitam/navy gelap.
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

  const pinFill = "#ffffff";
  let pinStroke = "#16a34a";
  let statusDotColor = "#16a34a";
  let innerContent = "";
  let pulseEffect = "";

  if (isAho) {
    const status = getAhoIndividualStoreStatus(hasTicket, isAhoAvailable);
    pinStroke = isSelected ? "#0284c7" : status.color;
    statusDotColor = status.color;
    if (hasTicket) {
      pulseEffect = isSelected
        ? '<div class="absolute -inset-2 bg-red-500/40 rounded-full animate-ping"></div>'
        : '<div class="absolute -inset-1 bg-red-500/25 rounded-full animate-pulse"></div>';
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
      pinStroke = "#0284c7";
      statusDotColor = "#0284c7";
      pulseEffect = '<div class="absolute -inset-2 bg-sky-500/30 rounded-full animate-ping"></div>';
    } else if (visualStatus === "TERDAMPAK") {
      pinStroke = "#dc2626";
      statusDotColor = "#dc2626";
      pulseEffect = '<div class="absolute -inset-1.5 bg-red-600/30 rounded-full animate-ping"></div>';
    } else if (visualStatus === "DALAM_PENANGANAN") {
      pinStroke = "#2563eb";
      statusDotColor = "#2563eb";
      pulseEffect = '<div class="absolute -inset-1 bg-blue-500/25 rounded-full animate-pulse"></div>';
    } else if (visualStatus === "PERLU_PERHATIAN") {
      pinStroke = "#f97316";
      statusDotColor = "#f97316";
    } else if (visualStatus === "SELESAI") {
      pinStroke = "#0d9488";
      statusDotColor = "#0d9488";
    } else {
      // Normal store
      pinStroke = "#16a34a";
      statusDotColor = "#16a34a";
    }
  }

  // Smooth SVG Teardrop Pin: White Surface, Status Outline, Status Center Indicator
  const html = `
    <div class="sparta-store-pin group cursor-pointer relative flex items-center justify-center">
      ${pulseEffect}
      <svg width="${width}" height="${height}" viewBox="0 0 24 30" fill="none" class="drop-shadow-md transition-transform duration-150 group-hover:scale-125">
        <!-- Pin Body (White surface with status stroke) -->
        <path
          d="M12 1.5C6.75 1.5 2.5 5.75 2.5 11C2.5 17.5 12 28.5 12 28.5C12 28.5 21.5 17.5 21.5 11C21.5 5.75 17.25 1.5 12 1.5Z"
          fill="${pinFill}"
          stroke="${pinStroke}"
          stroke-width="2.2"
          stroke-linejoin="round"
        />
        <!-- Inner Center Dot / Ticket Count Badge (No dark fills) -->
        ${
          innerContent
            ? `
              <circle cx="12" cy="11" r="5.5" fill="#fee2e2" stroke="#dc2626" stroke-width="1" />
              <text x="12" y="13.5" font-size="7.5" font-family="monospace" font-weight="900" fill="#dc2626" text-anchor="middle">${innerContent}</text>
            `
            : `
              <circle cx="12" cy="11" r="3.2" fill="${statusDotColor}" />
            `
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
 * Rounded square / facility silhouette, clear warehouse iconography, SPARTA Siaga corporate blue / white styling.
 * Warna biru khas Siaga atau putih dengan aksen biru, bebas fill hitam dominan.
 */
export function getDcFacilityIconOptions(
  dc: Store,
  isSelected: boolean = false
): SpartaMarkerOptions {
  const size = isSelected ? 36 : 30;
  const borderClass = isSelected
    ? "border-[#0284c7] ring-2 ring-[#0284c7]/50 shadow-[#0284c7]/30"
    : "border-[#0284c7] hover:border-sky-500";
  const bgSurface = isSelected ? "bg-sky-50 dark:bg-sky-950" : "bg-white dark:bg-slate-900";

  // Lucide warehouse icon SVG representation with Siaga corporate blue
  const html = `
    <div class="sparta-dc-facility group cursor-pointer select-none flex flex-col items-center">
      ${isSelected ? '<div class="absolute -inset-2 bg-sky-400/30 rounded-xl animate-ping"></div>' : ""}
      <div style="width:${size}px; height:${size}px;" class="rounded-lg ${bgSurface} border-2 ${borderClass} shadow-md flex items-center justify-center text-[#0284c7] transition-all duration-150 group-hover:scale-115 z-20">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#0284c7" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M22 8.35V20a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8.35A2 2 0 0 1 3.26 6.5l8-3.2a2 2 0 0 1 1.48 0l8 3.2A2 2 0 0 1 22 8.35Z"/>
          <path d="M6 18h12"/>
          <path d="M6 14h12"/>
          <rect width="12" height="12" x="6" y="10"/>
        </svg>
      </div>
      <!-- Precise downward facility anchor pointer in white/light with Siaga blue tip -->
      <div class="w-0 h-0 border-x-3.5 border-x-transparent border-t-5 border-t-white dark:border-t-slate-800 drop-shadow-[0_1px_1px_rgba(0,0,0,0.15)] -mt-px"></div>
      <div class="w-1.5 h-1.5 rounded-full bg-[#0284c7] border border-white dark:border-slate-800 -mt-0.5"></div>
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
