/**
 * SPARTA SIAGA — AHO Layer Utilities & Color Thresholds
 * Reference: monitoring-map-design.md & Section 9 AHO Color System
 */

export interface AhoColorInfo {
  color: string;
  bgClass: string;
  borderClass: string;
  textClass: string;
  ringClass: string;
  badgeClass: string;
  category: string;
}

/**
 * Returns distinct standard color styling based on active AHO ticket percentage.
 * Category Thresholds (monitoring-map-design.md Section 9):
 * - > 70%      : Red    (#dc2626)
 * - 50% - 70%  : Orange (#f97316)
 * - 20% - <50% : Yellow (#facc15)
 * - < 20%      : Green  (#16a34a)
 * 
 * Note: Uses unrounded raw percentage to determine color category.
 * Exact boundaries:
 * - 19.99% -> Green
 * - 20.00% -> Yellow
 * - 49.99% -> Yellow
 * - 50.00% -> Orange
 * - 70.00% -> Orange
 * - 70.01% -> Red
 */
export function getAhoColor(percentage: number): AhoColorInfo {
  if (percentage > 70) {
    return {
      color: "#dc2626",
      bgClass: "bg-red-600",
      borderClass: "border-red-500",
      textClass: "text-red-600 dark:text-red-400",
      ringClass: "ring-red-500/30",
      badgeClass: "bg-red-950/80 text-red-200 border border-red-800",
      category: "> 70% (Tinggi)",
    };
  }
  if (percentage >= 50) {
    return {
      color: "#f97316",
      bgClass: "bg-orange-500",
      borderClass: "border-orange-400",
      textClass: "text-orange-500 dark:text-orange-400",
      ringClass: "ring-orange-500/30",
      badgeClass: "bg-orange-950/80 text-orange-200 border border-orange-800",
      category: "50% – 70% (Sedang)",
    };
  }
  if (percentage >= 20) {
    return {
      color: "#facc15",
      bgClass: "bg-amber-400",
      borderClass: "border-yellow-400",
      textClass: "text-amber-500 dark:text-yellow-400",
      ringClass: "ring-yellow-400/30",
      badgeClass: "bg-yellow-950/80 text-yellow-200 border border-yellow-800",
      category: "20% – <50% (Rendah)",
    };
  }
  return {
    color: "#16a34a",
    bgClass: "bg-emerald-600",
    borderClass: "border-emerald-500",
    textClass: "text-emerald-600 dark:text-emerald-400",
    ringClass: "ring-emerald-500/30",
    badgeClass: "bg-emerald-950/80 text-emerald-200 border border-emerald-800",
    category: "< 20% (Sangat Rendah)",
  };
}

export interface AhoStoreStatusInfo {
  color: string;
  label: string;
  bgClass: string;
  borderClass: string;
  textClass: string;
  badgeClass: string;
}

/**
 * Individual store AHO status (Zoom >= 13).
 * Exactly three meaningful display states (monitoring-map-design.md Section 7.4):
 * - Has active ticket: Red #dc2626
 * - Confirmed no active tickets: Green #16a34a
 * - Data unavailable / unknown: Neutral gray #64748b
 */
export function getAhoIndividualStoreStatus(
  hasTicket: boolean,
  isAvailable: boolean = true
): AhoStoreStatusInfo {
  if (!isAvailable) {
    return {
      color: "#64748b",
      label: "Data Belum Tersedia",
      bgClass: "bg-slate-500",
      borderClass: "border-slate-400",
      textClass: "text-slate-400",
      badgeClass: "bg-slate-900 text-slate-300 border border-slate-700",
    };
  }
  if (hasTicket) {
    return {
      color: "#dc2626",
      label: "Ada Tiket Aktif",
      bgClass: "bg-red-600",
      borderClass: "border-red-500",
      textClass: "text-red-500",
      badgeClass: "bg-red-950/80 text-red-200 border border-red-800",
    };
  }
  return {
    color: "#16a34a",
    label: "Tanpa Tiket Aktif",
    bgClass: "bg-emerald-600",
    borderClass: "border-emerald-500",
    textClass: "text-emerald-500",
    badgeClass: "bg-emerald-950/80 text-emerald-200 border border-emerald-800",
  };
}

/**
 * Calculates raw AHO percentage.
 * Formula: (Jumlah toko dengan tiket aktif / Total toko dalam kelompok) * 100%
 */
export function calculateAhoPercentage(totalStores: number, storesWithTickets: number): number {
  if (!totalStores || totalStores <= 0) return 0;
  return (storesWithTickets / totalStores) * 100;
}

/**
 * Formats AHO badge label: e.g. "23% (23/100)"
 */
export function formatAhoBadgeLabel(totalStores: number, storesWithTickets: number): string {
  const pct = calculateAhoPercentage(totalStores, storesWithTickets);
  return `${Math.round(pct)}% (${storesWithTickets}/${totalStores})`;
}

