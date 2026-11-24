"use client";

import React, { useState } from "react";
import { Wrench, ChevronUp, ChevronDown, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";

interface AhoLegendProps {
  zoom: number;
  lastUpdated?: string | null;
  className?: string;
}

function formatWibDateTime(isoStr?: string | null): string {
  if (!isoStr) return "-";
  try {
    const d = new Date(isoStr);
    if (isNaN(d.getTime())) return isoStr;
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
    return isoStr;
  }
}

export function AhoLegend({ zoom, lastUpdated, className = "" }: AhoLegendProps) {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const isIndividualStoreView = zoom >= 13;

  if (isCollapsed) {
    return (
      <div className={`pointer-events-auto z-[400] ${className}`}>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setIsCollapsed(false)}
          className="h-8 px-2.5 gap-1.5 rounded-lg bg-white dark:bg-card border border-border text-slate-800 dark:text-slate-100 shadow-md hover:bg-slate-50 dark:hover:bg-muted transition-all"
          title="Buka Legenda Tiket AHO"
          aria-label="Buka Legenda Tiket AHO"
        >
          <Wrench className="w-3.5 h-3.5 text-amber-500 shrink-0" />
          <span className="text-xs font-semibold">Legenda AHO</span>
          <ChevronUp className="w-3.5 h-3.5 text-slate-400" />
        </Button>
      </div>
    );
  }

  return (
    <div className={`pointer-events-auto z-[400] w-[250px] sm:w-[265px] rounded-lg border border-border bg-white dark:bg-card text-foreground shadow-lg animate-in fade-in duration-150 p-3 space-y-2.5 ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between pb-2 border-b border-border">
        <div className="flex items-center gap-1.5 min-w-0">
          <div className="w-5 h-5 rounded bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 flex items-center justify-center shrink-0">
            <Wrench className="w-3 h-3 text-amber-600 dark:text-amber-400" />
          </div>
          <div className="min-w-0">
            <h4 className="text-xs font-bold text-slate-900 dark:text-slate-100 leading-tight">Legenda AHO</h4>
            <span className="text-[10px] text-muted-foreground block leading-tight truncate">
              {isIndividualStoreView ? "Status tiket toko" : "Monitoring tiket aktif"}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <span className="text-[9px] px-1.5 py-0.5 rounded bg-slate-100 dark:bg-muted text-slate-600 dark:text-slate-300 font-mono">
            {isIndividualStoreView ? "z≥13" : "z≤12"}
          </span>
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={() => setIsCollapsed(true)}
            className="h-6 w-6 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 rounded"
            title="Ciutkan Legenda"
            aria-label="Ciutkan Legenda"
          >
            <ChevronDown className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>

      {/* Dynamic Content based on Zoom Level - Clean rows without nested cards */}
      {isIndividualStoreView ? (
        /* Zoom >= 13: Status Tiket Toko Individual */
        <div className="space-y-1.5">
          <div className="text-[10px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
            Status Tiket Toko
          </div>
          <div className="space-y-1.5 text-xs">
            <div className="flex items-center justify-between py-1 px-1.5 rounded hover:bg-slate-50 dark:hover:bg-muted/50 transition-colors">
              <div className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-full bg-[#dc2626] border border-white dark:border-slate-800 shrink-0 shadow-xs" />
                <span className="text-slate-800 dark:text-slate-200 font-medium text-[11px]">Ada Tiket Aktif</span>
              </div>
              <span className="text-[9px] font-mono font-bold text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 px-1.5 py-0.5 rounded">
                Aktif
              </span>
            </div>

            <div className="flex items-center justify-between py-1 px-1.5 rounded hover:bg-slate-50 dark:hover:bg-muted/50 transition-colors">
              <div className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-full bg-[#16a34a] border border-white dark:border-slate-800 shrink-0 shadow-xs" />
                <span className="text-slate-800 dark:text-slate-200 font-medium text-[11px]">Tanpa Tiket Aktif</span>
              </div>
              <span className="text-[9px] font-mono font-medium text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 px-1.5 py-0.5 rounded">
                Normal
              </span>
            </div>

            <div className="flex items-center justify-between py-1 px-1.5 rounded hover:bg-slate-50 dark:hover:bg-muted/50 transition-colors">
              <div className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-full bg-[#64748b] border border-white dark:border-slate-800 shrink-0 shadow-xs" />
                <span className="text-slate-600 dark:text-slate-400 font-medium text-[11px]">Data Belum Tersedia</span>
              </div>
              <span className="text-[9px] font-mono text-slate-500 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 px-1.5 py-0.5 rounded">
                Offline
              </span>
            </div>
          </div>
        </div>
      ) : (
        /* Zoom <= 12: 4 Kategori Agregasi Persentase Toko Bertiket */
        <div className="space-y-2">
          <div className="text-[10px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider flex items-center justify-between">
            <span>Persentase Toko Bertiket</span>
          </div>

          <div className="grid grid-cols-2 gap-1.5 text-xs">
            <div className="flex items-center gap-1.5 p-1 rounded hover:bg-slate-50 dark:hover:bg-muted/50 transition-colors">
              <span className="w-2.5 h-2.5 rounded-full bg-[#dc2626] shrink-0 border border-white dark:border-slate-800 shadow-xs" />
              <div className="min-w-0 leading-tight">
                <span className="font-bold text-[11px] text-red-600 dark:text-red-400">&gt; 70%</span>
                <span className="text-[9px] text-slate-500 dark:text-slate-400 block">Tinggi</span>
              </div>
            </div>

            <div className="flex items-center gap-1.5 p-1 rounded hover:bg-slate-50 dark:hover:bg-muted/50 transition-colors">
              <span className="w-2.5 h-2.5 rounded-full bg-[#f97316] shrink-0 border border-white dark:border-slate-800 shadow-xs" />
              <div className="min-w-0 leading-tight">
                <span className="font-bold text-[11px] text-orange-600 dark:text-orange-400">50% – 70%</span>
                <span className="text-[9px] text-slate-500 dark:text-slate-400 block">Sedang</span>
              </div>
            </div>

            <div className="flex items-center gap-1.5 p-1 rounded hover:bg-slate-50 dark:hover:bg-muted/50 transition-colors">
              <span className="w-2.5 h-2.5 rounded-full bg-[#facc15] shrink-0 border border-white dark:border-slate-800 shadow-xs" />
              <div className="min-w-0 leading-tight">
                <span className="font-bold text-[11px] text-amber-600 dark:text-yellow-400">20% – &lt;50%</span>
                <span className="text-[9px] text-slate-500 dark:text-slate-400 block">Rendah</span>
              </div>
            </div>

            <div className="flex items-center gap-1.5 p-1 rounded hover:bg-slate-50 dark:hover:bg-muted/50 transition-colors">
              <span className="w-2.5 h-2.5 rounded-full bg-[#16a34a] shrink-0 border border-white dark:border-slate-800 shadow-xs" />
              <div className="min-w-0 leading-tight">
                <span className="font-bold text-[11px] text-emerald-600 dark:text-emerald-400">&lt; 20%</span>
                <span className="text-[9px] text-slate-500 dark:text-slate-400 block">Sangat Rendah</span>
              </div>
            </div>
          </div>
          <p className="text-[9px] text-slate-500 dark:text-slate-400 leading-tight">
            Persentase toko bertiket aktif per kelompok.
          </p>
        </div>
      )}

      {/* Interpretive Clarification & Subtle Source Attribution */}
      <div className="pt-2 border-t border-border space-y-1">
        <p className="text-[9px] text-slate-500 dark:text-slate-400 italic leading-snug">
          * Menunjukkan tiket pemeliharaan, bukan risiko bencana.
        </p>

        <div className="flex items-center justify-between text-[9px] text-slate-500 dark:text-slate-400 pt-0.5">
          <span className="truncate">SPARTA Maintenance</span>
          {lastUpdated && (
            <span className="flex items-center gap-1 shrink-0 font-mono text-slate-600 dark:text-slate-300">
              <Clock className="w-2.5 h-2.5 text-sky-500 shrink-0" />
              <span className="truncate">{formatWibDateTime(lastUpdated)}</span>
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
