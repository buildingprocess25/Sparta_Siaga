"use client";

import React, { useState, useMemo, useEffect } from "react";
import { Earthquake } from "@/types/disaster";
import { getV1Coverage } from "@/lib/earthquake-v1-parameters";
import { AppDialog } from "@/components/shared/app-dialog";
import {
  X,
  Activity,
  Waves,
  MapPin,
  Search,
  Filter,
  Clock,
} from "lucide-react";

interface EarthquakeListModalProps {
  isOpen: boolean;
  onClose: () => void;
  earthquakes: Earthquake[];
  onSelectEarthquake: (eq: Earthquake) => void;
  selectedEarthquakeId?: string;
  theme?: "dark" | "light";
}

export function EarthquakeListModal({
  isOpen,
  onClose,
  earthquakes,
  onSelectEarthquake,
  selectedEarthquakeId,
  theme = "dark",
}: EarthquakeListModalProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const [minMagnitude, setMinMagnitude] = useState<number | "all">("all");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const filteredEarthquakes = useMemo(() => {
    return earthquakes.filter((eq) => {
      const matchSearch =
        eq.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
        eq.source.toLowerCase().includes(searchTerm.toLowerCase());
      const matchMag =
        minMagnitude === "all" ? true : eq.magnitude >= minMagnitude;
      return matchSearch && matchMag;
    });
  }, [earthquakes, searchTerm, minMagnitude]);

  if (!isOpen || !mounted) return null;

  const isDark = theme === "dark";

  return (
    <AppDialog
      open={isOpen}
      onClose={onClose}
      title="Daftar Gempa Bumi Terkini"
      description="Data real-time BMKG & USGS dengan parameter evaluasi V1 SPARTA"
      className="sm:!max-w-2xl"
    >
      <div className={`rounded-2xl w-full max-w-2xl max-h-[90dvh] sm:max-h-[85dvh] flex flex-col shadow-2xl overflow-hidden transition-colors border overscroll-contain touch-auto select-text ${
        isDark ? "bg-slate-900 border-slate-700/80 text-slate-100" : "bg-white border-slate-200 text-slate-900"
      }`}>
        {/* Header */}
        <div className={`p-4 sm:p-5 border-b flex items-center justify-between shrink-0 ${
          isDark ? "border-slate-800 bg-slate-950/50" : "border-slate-100 bg-slate-50"
        }`}>
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-red-500/10 border border-red-500/20 text-red-500">
              <Activity className="w-5 h-5 animate-pulse" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="font-bold text-base sm:text-lg">
                  Daftar Gempa Bumi Terkini
                </h2>
                <span className="px-2 py-0.5 rounded-full bg-red-500/10 border border-red-500/20 text-red-500 font-mono font-bold text-xs">
                  {earthquakes.length} Aktif
                </span>
              </div>
              <p className={`text-xs ${isDark ? "text-slate-400" : "text-slate-500"}`}>
                Data real-time BMKG & USGS dengan parameter evaluasi V1 SPARTA
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className={`p-1.5 rounded-lg transition-colors ${
              isDark ? "hover:bg-slate-800 text-slate-400 hover:text-white" : "hover:bg-slate-200 text-slate-500 hover:text-slate-900"
            }`}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Filter & Search Bar */}
        <div className={`p-3 sm:p-4 border-b flex flex-col sm:flex-row items-center gap-2.5 ${
          isDark ? "border-slate-800 bg-slate-900/50" : "border-slate-100 bg-white"
        }`}>
          <div className="relative w-full sm:flex-1">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Cari wilayah gempa (misal: Jawa Barat)..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className={`w-full h-9 pl-9 pr-3 rounded-lg border text-xs outline-none transition-colors ${
                isDark 
                  ? "bg-slate-950 border-slate-800 text-white placeholder-slate-500 focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500/30" 
                  : "bg-slate-50 border-slate-200 text-slate-900 placeholder-slate-400 focus:border-cyan-600 focus:ring-1 focus:ring-cyan-600/30"
              }`}
            />
          </div>

          <div className="flex items-center gap-1.5 w-full sm:w-auto">
            <Filter className={`w-3.5 h-3.5 shrink-0 ${isDark ? "text-slate-400" : "text-slate-500"}`} />
            <button
              type="button"
              onClick={() => setMinMagnitude("all")}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all touch-target-min ${
                minMagnitude === "all"
                  ? isDark ? "bg-slate-800 text-white font-bold border border-slate-700" : "bg-slate-200 text-slate-900 font-bold border border-slate-300"
                  : isDark ? "text-slate-400 hover:text-white" : "text-slate-500 hover:text-slate-900"
              }`}
            >
              Semua
            </button>
            <button
              type="button"
              onClick={() => setMinMagnitude(5.0)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all touch-target-min ${
                minMagnitude === 5.0
                  ? "bg-red-500/10 text-red-600 dark:text-red-400 font-bold border border-red-500/30"
                  : isDark ? "text-slate-400 hover:text-white" : "text-slate-500 hover:text-slate-900"
              }`}
            >
              M ≥ 5.0
            </button>
            <button
              type="button"
              onClick={() => setMinMagnitude(6.0)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all touch-target-min ${
                minMagnitude === 6.0
                  ? "bg-red-600 text-white font-bold shadow-sm"
                  : isDark ? "text-slate-400 hover:text-white" : "text-slate-500 hover:text-slate-900"
              }`}
            >
              M ≥ 6.0
            </button>
          </div>
        </div>

        {/* Earthquake List */}
        <div className={`flex-1 overflow-y-auto p-3 sm:p-4 space-y-2.5 divide-y ${
          isDark ? "divide-slate-800/40" : "divide-slate-100"
        }`}>
          {filteredEarthquakes.length === 0 ? (
            <div className={`py-12 text-center text-xs ${isDark ? "text-slate-400" : "text-slate-500"}`}>
              Tidak ada data gempa yang cocok dengan filter pencarian.
            </div>
          ) : (
            filteredEarthquakes.map((eq, index) => {
              const isSelected = eq.id === selectedEarthquakeId;
              const isTsunami = eq.potensiTsunami;
              const isHigh = eq.magnitude >= 6.0;
              const isMedium = eq.magnitude >= 5.0;

              return (
                <div
                  key={eq.id || index}
                  className={`pt-2.5 first:pt-0 p-3 rounded-xl border transition-all duration-200 ${
                    isSelected
                      ? isDark ? "bg-cyan-950/20 border-cyan-500/40" : "bg-cyan-50 border-cyan-300"
                      : isDark ? "bg-slate-950/30 border-slate-800 hover:border-slate-700" : "bg-white border-slate-200 hover:border-slate-300 shadow-sm"
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    {/* Left Magnitude Badge */}
                    <div
                      className={`w-12 h-12 rounded-xl flex flex-col items-center justify-center shrink-0 border ${
                        isTsunami
                          ? "bg-red-500/10 border-red-500/30 text-red-600 dark:text-red-500 animate-pulse"
                          : isHigh
                          ? "bg-red-50 border-red-200 text-red-600 dark:bg-red-500/10 dark:border-red-500/20 dark:text-red-400"
                          : isMedium
                          ? "bg-amber-50 border-amber-200 text-amber-600 dark:bg-amber-500/10 dark:border-amber-500/20 dark:text-amber-400"
                          : "bg-slate-50 border-slate-200 text-slate-600 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-300"
                      }`}
                    >
                      <span className="text-[10px] uppercase font-bold tracking-tight opacity-80">Mag</span>
                      <span className="text-base font-black font-mono leading-none">
                        {eq.magnitude}
                      </span>
                    </div>

                    {/* Middle Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <span className={`px-1.5 py-0.5 rounded text-[9px] font-mono font-bold border ${
                          isDark ? "bg-slate-800 text-slate-300 border-slate-700" : "bg-slate-100 text-slate-600 border-slate-200"
                        }`}>
                          {eq.source}
                        </span>
                        {isTsunami && (
                          <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-red-500/10 text-red-600 dark:text-red-400 border border-red-500/20 animate-pulse flex items-center gap-1">
                            <Waves className="w-3 h-3" />
                            POTENSI TSUNAMI
                          </span>
                        )}
                        <span className={`text-[10px] flex items-center gap-1 font-semibold ${isDark ? "text-slate-400" : "text-slate-500"}`}>
                          <Clock className="w-3 h-3" />
                          {eq.time}
                        </span>
                      </div>

                      <h3 className={`font-bold text-sm leading-snug ${isDark ? "text-slate-100" : "text-slate-900"}`}>
                        {eq.title}
                      </h3>

                      <div className={`grid grid-cols-2 sm:grid-cols-3 gap-2 mt-2 text-[10px] ${isDark ? "text-slate-400" : "text-slate-500"}`}>
                        <div>
                          <span>Kedalaman:</span>{" "}
                          <strong className={isDark ? "text-slate-300" : "text-slate-700"}>{eq.depth}</strong>
                        </div>
                        <div>
                          <span>Koordinat:</span>{" "}
                          <span className={`font-mono ${isDark ? "text-slate-300" : "text-slate-700"}`}>
                            {eq.latitude.toFixed(2)}, {eq.longitude.toFixed(2)}
                          </span>
                        </div>
                        <div className="col-span-2 sm:col-span-1">
                          <span>Radius V1:</span>{" "}
                          <span className="font-mono font-bold text-red-500">
                            {(() => {
                              const cov = eq.v1Coverage ?? getV1Coverage(eq.magnitude, eq.depthKm ?? 10);
                              const r = eq.v1DistanceKm ?? cov.v1DistanceKm;
                              return r !== null ? `${r} km` : (eq.magnitude < 4.0 ? "Pemantauan" : "Tidak Berlaku");
                            })()}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Right Fly-To Action */}
                    <button
                      type="button"
                      data-testid="focus-earthquake-btn"
                      aria-label={`Pusatkan peta ke ${eq.title || "gempa"}`}
                      onClick={() => {
                        onSelectEarthquake(eq);
                        onClose();
                      }}
                      className={`px-3 py-2 rounded-xl font-semibold text-xs flex items-center gap-1.5 shrink-0 transition-colors border ${
                        isSelected 
                          ? "bg-cyan-600 text-white border-cyan-500 shadow-sm" 
                          : isDark ? "bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700" : "bg-white hover:bg-slate-50 text-slate-700 border-slate-200 shadow-sm"
                      } self-center sm:self-auto`}
                    >
                      <MapPin className="w-3.5 h-3.5" />
                      <span className="hidden sm:inline">Fokus</span>
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className={`p-3 sm:p-4 border-t flex items-center justify-between text-[11px] font-medium shrink-0 ${
          isDark ? "border-slate-800 bg-slate-950/50 text-slate-400" : "border-slate-100 bg-slate-50 text-slate-500"
        }`}>
          <span>Menampilkan {filteredEarthquakes.length} dari {earthquakes.length} gempa bumi</span>
          <button
            type="button"
            onClick={onClose}
            className={`px-4 py-1.5 rounded-lg border font-semibold transition-colors touch-target-min ${
              isDark ? "border-slate-700 hover:bg-slate-800 text-slate-200" : "border-slate-300 hover:bg-slate-200 text-slate-700"
            }`}
          >
            Tutup
          </button>
        </div>
      </div>
    </AppDialog>
  );
}
