/**
 * SPARTA SIAGA — AHO Layer Utilities & Color Thresholds
 * Reference: siaga-aho-map-guide.md
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
 * Returns refined, enterprise-grade color styling based on active AHO ticket percentage.
 * Category Thresholds (siaga-aho-map-guide.md):
 * - > 70%     : Muted Deep Red     (#b91c1c / Rose 700)
 * - 50% - 70% : Muted Burnt Orange (#c2410c / Orange 700)
 * - 20% - <50%: Muted Warm Ochre   (#ca8a04 / Amber 700)
 * - < 20%     : Muted Forest Green (#15803d / Emerald 700)
 * 
 * Note: Uses unrounded raw percentage to determine color category.
 */
export function getAhoColor(percentage: number): AhoColorInfo {
  if (percentage > 70) {
    return {
      color: "#b91c1c",
      bgClass: "bg-rose-600",
      borderClass: "border-rose-500/70",
      textClass: "text-rose-400 dark:text-rose-400",
      ringClass: "ring-rose-500/20",
      badgeClass: "bg-rose-950/70 text-rose-300 border border-rose-800/60",
      category: "> 70% (Tinggi)",
    };
  }
  if (percentage >= 50) {
    return {
      color: "#c2410c",
      bgClass: "bg-orange-600",
      borderClass: "border-orange-500/70",
      textClass: "text-orange-400 dark:text-orange-400",
      ringClass: "ring-orange-500/20",
      badgeClass: "bg-orange-950/70 text-orange-300 border border-orange-800/60",
      category: "50% – 70% (Sedang)",
    };
  }
  if (percentage >= 20) {
    return {
      color: "#ca8a04",
      bgClass: "bg-amber-600",
      borderClass: "border-amber-500/70",
      textClass: "text-amber-400 dark:text-amber-400",
      ringClass: "ring-amber-500/20",
      badgeClass: "bg-amber-950/70 text-amber-300 border border-amber-800/60",
      category: "20% – <50% (Rendah)",
    };
  }
  return {
    color: "#15803d",
    bgClass: "bg-emerald-600",
    borderClass: "border-emerald-500/70",
    textClass: "text-emerald-400 dark:text-emerald-400",
    ringClass: "ring-emerald-500/20",
    badgeClass: "bg-emerald-950/70 text-emerald-300 border border-emerald-800/60",
    category: "< 20% (Sangat Rendah)",
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

