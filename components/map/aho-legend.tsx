"use client";

import React, { useState } from "react";
import { Wrench, ChevronUp, ChevronDown, Clock, ShieldCheck, AlertCircle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";

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
        second: "2-digit",
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
          className="h-9 px-3 gap-2 rounded-xl bg-slate-900/95 dark:bg-slate-950/95 border-slate-700/80 text-slate-100 shadow-xl backdrop-blur-md hover:bg-slate-800 hover:text-white transition-all hover:scale-105"
          title="Buka Legenda Tiket AHO"
          aria-label="Buka Legenda Tiket AHO"
        >
          <Wrench className="w-3.5 h-3.5 text-amber-400 shrink-0" />
          <span className="text-xs font-semibold">Legenda AHO</span>
          <ChevronUp className="w-3.5 h-3.5 text-slate-400" />
        </Button>
      </div>
    );
  }

  return (
    <Card className={`pointer-events-auto z-[400] w-[270px] sm:w-[295px] rounded-xl border border-slate-700/80 bg-slate-900/95 dark:bg-slate-950/95 backdrop-blur-md text-slate-100 shadow-2xl animate-in fade-in duration-150 p-3 space-y-2.5 ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between pb-1.5 border-b border-slate-800">
        <div className="flex items-center gap-1.5 min-w-0">
          <div className="w-5 h-5 rounded-md bg-amber-500/15 border border-amber-500/30 flex items-center justify-center shrink-0">
            <Wrench className="w-3 h-3 text-amber-400" />
          </div>
          <div className="min-w-0">
            <h4 className="text-xs font-bold text-slate-100 leading-tight">Legenda AHO</h4>
            <span className="text-[10px] text-slate-400 block leading-tight">
              {isIndividualStoreView ? "Status tiket toko" : "Monitoring tiket aktif"}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-1">
          <span className="text-[9px] px-1.5 py-0.5 rounded bg-slate-800 border border-slate-700 text-slate-300 font-mono">
            {isIndividualStoreView ? "Toko (z≥13)" : "Agregasi (z≤12)"}
          </span>
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={() => setIsCollapsed(true)}
            className="h-6 w-6 text-slate-400 hover:text-white hover:bg-slate-800 rounded-md"
            title="Ciutkan Legenda"
            aria-label="Ciutkan Legenda"
          >
            <ChevronDown className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>

      {/* Dynamic Content based on Zoom Level */}
      {isIndividualStoreView ? (
        /* Zoom >= 13: Status Tiket Toko Individual */
        <div className="space-y-1.5">
          <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
            Status Tiket per Toko
          </div>
          <div className="space-y-1.5 text-xs">
            <div className="flex items-center justify-between p-1.5 rounded-md bg-slate-950/60 border border-slate-800">
              <div className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-full bg-[#dc2626] border border-white/40 shrink-0 shadow-xs" />
                <span className="text-slate-200 font-medium text-[11px]">Ada Tiket Aktif</span>
              </div>
              <span className="text-[10px] font-mono text-red-400 font-semibold">New / Progress</span>
            </div>

            <div className="flex items-center justify-between p-1.5 rounded-md bg-slate-950/60 border border-slate-800">
              <div className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-full bg-[#16a34a] border border-white/40 shrink-0 shadow-xs" />
                <span className="text-slate-200 font-medium text-[11px]">Tanpa Tiket Aktif</span>
              </div>
              <span className="text-[10px] font-mono text-emerald-400 font-semibold">Terkonfirmasi</span>
            </div>

            <div className="flex items-center justify-between p-1.5 rounded-md bg-slate-950/60 border border-slate-800">
              <div className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-full bg-[#64748b] border border-white/40 shrink-0 shadow-xs" />
                <span className="text-slate-200 font-medium text-[11px]">Data Belum Tersedia</span>
              </div>
              <span className="text-[10px] font-mono text-slate-400">Menunggu</span>
            </div>
          </div>
        </div>
      ) : (
        /* Zoom <= 12: 4 Kategori Agregasi Persentase Toko Bertiket */
        <div className="space-y-2">
          <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider flex items-center justify-between">
            <span>Persentase Toko Bertiket</span>
            <span className="text-[9px] font-normal text-slate-500 lowercase">(cabang & cluster)</span>
          </div>

          <div className="grid grid-cols-2 gap-1.5 text-xs">
            <div className="flex items-center gap-1.5 p-1 rounded bg-slate-950/50 border border-slate-800">
              <span className="w-2.5 h-2.5 rounded-full bg-[#dc2626] shrink-0 border border-white/30" />
              <div className="min-w-0 leading-tight">
                <span className="font-bold text-[11px] text-red-400">&gt; 70%</span>
                <span className="text-[9px] text-slate-400 block">Tinggi</span>
              </div>
            </div>

            <div className="flex items-center gap-1.5 p-1 rounded bg-slate-950/50 border border-slate-800">
              <span className="w-2.5 h-2.5 rounded-full bg-[#f97316] shrink-0 border border-white/30" />
              <div className="min-w-0 leading-tight">
                <span className="font-bold text-[11px] text-orange-400">50% – 70%</span>
                <span className="text-[9px] text-slate-400 block">Sedang</span>
              </div>
            </div>

            <div className="flex items-center gap-1.5 p-1 rounded bg-slate-950/50 border border-slate-800">
              <span className="w-2.5 h-2.5 rounded-full bg-[#facc15] shrink-0 border border-white/30" />
              <div className="min-w-0 leading-tight">
                <span className="font-bold text-[11px] text-yellow-400">20% – &lt;50%</span>
                <span className="text-[9px] text-slate-400 block">Rendah</span>
              </div>
            </div>

            <div className="flex items-center gap-1.5 p-1 rounded bg-slate-950/50 border border-slate-800">
              <span className="w-2.5 h-2.5 rounded-full bg-[#16a34a] shrink-0 border border-white/30" />
              <div className="min-w-0 leading-tight">
                <span className="font-bold text-[11px] text-emerald-400">&lt; 20%</span>
                <span className="text-[9px] text-slate-400 block">Sangat Rendah</span>
              </div>
            </div>
          </div>
          <p className="text-[9px] text-slate-400 leading-tight">
            Persentase toko yang memiliki tiket AHO aktif dari total toko dalam kelompok.
          </p>
        </div>
      )}

      {/* Interpretive Clarification & Subtle Source Attribution */}
      <div className="pt-2 border-t border-slate-800 space-y-1">
        <p className="text-[9px] text-slate-400 italic leading-snug">
          * Warna hanya menunjukkan tiket AHO aktif, bukan tingkat keparahan bencana atau kerusakan fisik.
        </p>

        <div className="flex items-center justify-between text-[9px] text-slate-400 pt-1">
          <span className="text-slate-400 truncate">Sumber: SPARTA Maintenance</span>
          {lastUpdated && (
            <span className="flex items-center gap-1 shrink-0 text-slate-300 font-mono">
              <Clock className="w-2.5 h-2.5 text-cyan-400 shrink-0" />
              <span className="truncate">{formatWibDateTime(lastUpdated)}</span>
            </span>
          )}
        </div>
      </div>
    </Card>
  );
}

