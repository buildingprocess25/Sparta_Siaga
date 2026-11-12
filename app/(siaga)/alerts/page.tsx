"use client";

import React, { useState, useEffect, useCallback } from "react";
import {
  Activity,
  RefreshCw,
  AlertTriangle,
  MapPin,
  Clock,
  Radio,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Waves,
  CloudRain,
  Info,
  TrendingUp,
  Zap,
} from "lucide-react";
import { useSiaga } from "@/components/layout/siaga-context";
import { Earthquake, DisasterFeedResponse, SourceHealth } from "@/types/disaster";
import { getV1Coverage } from "@/lib/earthquake-v1-parameters";

// ─── Types ───────────────────────────────────────────────────────────────────

interface EventCardProps {
  eq: Earthquake;
  isDark: boolean;
  onFocusMap: (eq: Earthquake) => void;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getSeverityTier(mag: number): { label: string; color: string; bg: string; dot: string } {
  if (mag >= 7.0) return { label: "EKSTREM", color: "text-red-600 dark:text-red-400", bg: "bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800", dot: "bg-red-500" };
  if (mag >= 6.0) return { label: "KRITIS", color: "text-orange-600 dark:text-orange-400", bg: "bg-orange-50 dark:bg-orange-900/20 border-orange-200 dark:border-orange-800", dot: "bg-orange-500" };
  if (mag >= 5.0) return { label: "SIGNIFIKAN", color: "text-amber-600 dark:text-amber-400", bg: "bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800", dot: "bg-amber-500" };
  if (mag >= 4.0) return { label: "WASPADA", color: "text-yellow-600 dark:text-yellow-400", bg: "bg-yellow-50 dark:bg-yellow-900/20 border-yellow-200 dark:border-yellow-800", dot: "bg-yellow-400" };
  return { label: "RINGAN", color: "text-slate-500 dark:text-slate-400", bg: "bg-slate-50 dark:bg-slate-800/50 border-slate-200 dark:border-slate-700", dot: "bg-slate-400" };
}

function formatEventTime(timeStr: string): string {
  try {
    const d = new Date(timeStr);
    if (!isNaN(d.getTime())) {
      return d.toLocaleString("id-ID", {
        day: "numeric",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "Asia/Jakarta",
      }) + " WIB";
    }
  } catch {}
  return timeStr;
}

// ─── Earthquake Event Card ────────────────────────────────────────────────────

function EarthquakeCard({ eq, isDark, onFocusMap }: EventCardProps) {
  const [expanded, setExpanded] = useState(false);
  const severity = getSeverityTier(eq.magnitude);

  return (
    <div
      className={`rounded-lg border transition-colors ${
        isDark
          ? "bg-slate-900 border-slate-800 hover:border-slate-700"
          : "bg-white border-slate-200 hover:border-slate-300 shadow-sm"
      }`}
    >
      {/* Header row */}
      <div className="px-4 py-3 flex items-start gap-3">
        {/* Severity dot */}
        <div className="flex flex-col items-center gap-1 pt-0.5 shrink-0">
          <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${severity.dot}`} />
        </div>

        {/* Main content */}
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2 mb-1">
            {/* Severity badge */}
            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${severity.bg} ${severity.color}`}>
              {severity.label}
            </span>
            {/* Source */}
            <span className={`text-[10px] font-mono ${isDark ? "text-slate-500" : "text-slate-400"}`}>
              {eq.source}
            </span>
            {/* Tsunami warning */}
            {eq.potensiTsunami && (
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded border bg-red-600 text-white border-red-700">
                TSUNAMI
              </span>
            )}
          </div>

          <h3 className={`text-sm font-semibold leading-snug mb-1 ${isDark ? "text-slate-100" : "text-slate-900"}`}>
            {eq.title}
          </h3>

          {/* Key facts inline */}
          <div className={`flex flex-wrap items-center gap-x-4 gap-y-1 text-xs ${isDark ? "text-slate-400" : "text-slate-500"}`}>
            <span className="flex items-center gap-1">
              <Zap className="w-3 h-3" />
              M {eq.magnitude.toFixed(1)}
            </span>
            <span className="flex items-center gap-1">
              <TrendingUp className="w-3 h-3" />
              {eq.depth}
            </span>
            <span className="flex items-center gap-1">
              <Clock className="w-3 h-3" />
              {formatEventTime(eq.time)}
            </span>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => onFocusMap(eq)}
            title="Lihat di peta"
            className={`p-1.5 rounded-md transition-colors ${
              isDark
                ? "text-slate-400 hover:text-blue-400 hover:bg-slate-800"
                : "text-slate-400 hover:text-blue-600 hover:bg-slate-100"
            }`}
          >
            <MapPin className="w-4 h-4" />
          </button>
          <button
            onClick={() => setExpanded((p) => !p)}
            title="Detail"
            className={`p-1.5 rounded-md transition-colors ${
              isDark
                ? "text-slate-400 hover:text-slate-200 hover:bg-slate-800"
                : "text-slate-400 hover:text-slate-700 hover:bg-slate-100"
            }`}
          >
            {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div className={`px-4 pb-4 pt-0 border-t ${isDark ? "border-slate-800" : "border-slate-100"}`}>
          <div className="pt-3 grid grid-cols-2 sm:grid-cols-3 gap-3">
            <div>
              <div className={`text-[10px] uppercase tracking-wider font-semibold mb-0.5 ${isDark ? "text-slate-500" : "text-slate-400"}`}>
                Magnitudo
              </div>
              <div className={`text-sm font-bold ${severity.color}`}>
                M {eq.magnitude.toFixed(1)}
              </div>
            </div>
            <div>
              <div className={`text-[10px] uppercase tracking-wider font-semibold mb-0.5 ${isDark ? "text-slate-500" : "text-slate-400"}`}>
                Kedalaman
              </div>
              <div className={`text-sm font-semibold ${isDark ? "text-slate-200" : "text-slate-800"}`}>
                {eq.depth}
              </div>
            </div>
            <div>
              <div className={`text-[10px] uppercase tracking-wider font-semibold mb-0.5 ${isDark ? "text-slate-500" : "text-slate-400"}`}>
                Radius V1
              </div>
              <div className={`text-sm font-semibold ${isDark ? "text-slate-200" : "text-slate-800"}`}>
                {(() => {
                  const cov = eq.v1Coverage ?? getV1Coverage(eq.magnitude, eq.depthKm ?? 10);
                  const r = eq.v1DistanceKm ?? cov.v1DistanceKm;
                  return r !== null ? `${r} km` : (eq.magnitude < 4.0 ? "Hanya Pemantauan" : "Tidak Berlaku");
                })()}
              </div>
            </div>
            <div>
              <div className={`text-[10px] uppercase tracking-wider font-semibold mb-0.5 ${isDark ? "text-slate-500" : "text-slate-400"}`}>
                Kelompok Kedalaman
              </div>
              <div className={`text-sm font-semibold ${isDark ? "text-slate-200" : "text-slate-800"}`}>
                {(eq.v1Coverage ?? getV1Coverage(eq.magnitude, eq.depthKm ?? 10)).depthGroup}
              </div>
            </div>
            <div>
              <div className={`text-[10px] uppercase tracking-wider font-semibold mb-0.5 ${isDark ? "text-slate-500" : "text-slate-400"}`}>
                Koordinat
              </div>
              <div className={`text-xs font-mono ${isDark ? "text-slate-300" : "text-slate-700"}`}>
                {eq.latitude.toFixed(3)}, {eq.longitude.toFixed(3)}
              </div>
            </div>
            <div>
              <div className={`text-[10px] uppercase tracking-wider font-semibold mb-0.5 ${isDark ? "text-slate-500" : "text-slate-400"}`}>
                Potensi Tsunami
              </div>
              <div className={`text-sm font-semibold ${eq.potensiTsunami ? "text-red-500" : isDark ? "text-slate-400" : "text-slate-500"}`}>
                {eq.potensiTsunami ? "Ya" : "Tidak"}
              </div>
            </div>
          </div>

          {eq.feltArea && (
            <div className="mt-3">
              <div className={`text-[10px] uppercase tracking-wider font-semibold mb-0.5 ${isDark ? "text-slate-500" : "text-slate-400"}`}>
                Dirasakan di
              </div>
              <div className={`text-xs ${isDark ? "text-slate-300" : "text-slate-700"}`}>{eq.feltArea}</div>
            </div>
          )}

          {eq.shakemapUrl && (
            <div className="mt-3">
              <a
                href={eq.shakemapUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs text-blue-500 hover:text-blue-400 transition-colors"
              >
                <ExternalLink className="w-3 h-3" />
                Lihat Shakemap BMKG
              </a>
            </div>
          )}

          <div className={`mt-3 pt-3 border-t ${isDark ? "border-slate-800" : "border-slate-100"}`}>
            <div className="flex items-start gap-1.5">
              <Info className={`w-3.5 h-3.5 mt-0.5 shrink-0 ${isDark ? "text-slate-500" : "text-slate-400"}`} />
              <p className={`text-[11px] leading-relaxed ${isDark ? "text-slate-500" : "text-slate-400"}`}>
                Data event bersumber dari <strong>{eq.source}</strong>. Tindak lanjut operasional dilakukan melalui menu{" "}
                <strong>Laporan Kejadian</strong>.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Source Health Badge ──────────────────────────────────────────────────────

function SourceHealthBadge({ health, isDark }: { health: SourceHealth; isDark: boolean }) {
  const statusColor =
    health.status === "healthy"
      ? isDark ? "text-emerald-400" : "text-emerald-600"
      : health.status === "degraded"
      ? isDark ? "text-amber-400" : "text-amber-600"
      : isDark ? "text-red-400" : "text-red-500";

  return (
    <div className={`flex items-center gap-1.5 text-xs ${isDark ? "text-slate-400" : "text-slate-500"}`}>
      <Radio className={`w-3 h-3 ${statusColor}`} />
      <span className="font-mono">{health.source}</span>
      <span className={`font-semibold ${statusColor}`}>
        {health.status === "healthy" ? "Live" : health.status === "degraded" ? "Degraded" : "Offline"}
      </span>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function AlertsPage() {
  const { theme, handleFocusDisaster } = useSiaga();
  const isDark = theme === "dark";

  const [feed, setFeed] = useState<DisasterFeedResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filterType, setFilterType] = useState<"all" | "earthquake" | "heavy_rain">("all");

  const loadFeed = useCallback(async (force = false) => {
    if (force) setIsRefreshing(true);
    else setLoading(true);
    setError(null);

    try {
      const url = `/api/disasters/earthquakes${force ? "?refresh=true" : ""}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: DisasterFeedResponse = await res.json();
      setFeed(data);
    } catch (err: any) {
      setError(err.message || "Gagal memuat data kejadian bencana.");
    } finally {
      setLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadFeed();
  }, [loadFeed]);

  const earthquakes = feed?.recentEarthquakes ?? [];
  const sourcesHealth = feed?.sourcesHealth ?? [];
  const significant = earthquakes.filter((e) => e.isSignificant);

  const displayed = filterType === "all" ? earthquakes : filterType === "earthquake" ? earthquakes : [];

  return (
    <div className={`min-h-full ${isDark ? "bg-slate-950" : "bg-slate-50"}`}>
      <div className="max-w-5xl mx-auto px-4 py-6 pb-20 space-y-6">

        {/* ── Page Header ── */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className={`text-xl font-bold tracking-tight flex items-center gap-2 ${isDark ? "text-white" : "text-slate-900"}`}>
              <Activity className="w-5 h-5 text-blue-500" />
              Event Bencana
            </h1>
            <p className={`text-xs mt-1 ${isDark ? "text-slate-400" : "text-slate-500"}`}>
              Data kejadian bencana dari sumber resmi BMKG &amp; USGS. Bukan laporan operasional.
            </p>
          </div>

          <button
            onClick={() => loadFeed(true)}
            disabled={isRefreshing}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md transition-colors border ${
              isDark
                ? "border-slate-700 text-slate-300 hover:bg-slate-800 disabled:opacity-40"
                : "border-slate-200 text-slate-600 hover:bg-slate-100 shadow-sm disabled:opacity-40"
            }`}
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? "animate-spin" : ""}`} />
            Muat Ulang
          </button>
        </div>

        {/* ── Source Health ── */}
        {sourcesHealth.length > 0 && (
          <div className={`flex flex-wrap items-center gap-4 px-4 py-2.5 rounded-lg border text-xs ${
            isDark ? "bg-slate-900 border-slate-800" : "bg-white border-slate-200 shadow-sm"
          }`}>
            <span className={`text-xs font-semibold ${isDark ? "text-slate-500" : "text-slate-400"}`}>Sumber Data:</span>
            {sourcesHealth.map((h) => (
              <SourceHealthBadge key={h.source} health={h} isDark={isDark} />
            ))}
            {feed?.lastUpdated && (
              <span className={`ml-auto text-[10px] font-mono ${isDark ? "text-slate-600" : "text-slate-400"}`}>
                Diperbarui {new Date(feed.lastUpdated).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })} WIB
              </span>
            )}
          </div>
        )}

        {/* ── KPI Row ── */}
        {!loading && feed && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: "Total Event", value: earthquakes.length, icon: Activity, color: "text-blue-500" },
              { label: "Signifikan (M5+)", value: significant.length, icon: AlertTriangle, color: "text-amber-500" },
              { label: "Potensi Tsunami", value: earthquakes.filter((e) => e.potensiTsunami).length, icon: Waves, color: "text-red-500" },
              { label: "Status Data", value: feed.dataFreshness === "live" || feed.dataFreshness === "fresh" ? "Live" : feed.dataFreshness ?? "-", icon: Radio, color: "text-emerald-500", isText: true },
            ].map(({ label, value, icon: Icon, color, isText }) => (
              <div
                key={label}
                className={`px-4 py-3 rounded-lg border ${
                  isDark ? "bg-slate-900 border-slate-800" : "bg-white border-slate-200 shadow-sm"
                }`}
              >
                <div className={`flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide mb-1.5 ${isDark ? "text-slate-500" : "text-slate-400"}`}>
                  <Icon className={`w-3.5 h-3.5 ${color}`} />
                  {label}
                </div>
                <div className={`text-2xl font-bold ${isDark ? "text-white" : "text-slate-900"} ${isText ? "text-sm font-semibold" : ""}`}>
                  {value}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ── Filter Tabs ── */}
        <div className="flex items-center gap-2">
          {(
            [
              { key: "all", label: "Semua Event" },
              { key: "earthquake", label: "Gempa Bumi" },
            ] as const
          ).map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setFilterType(key)}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md border transition-colors ${
                filterType === key
                  ? "bg-blue-600 text-white border-blue-700"
                  : isDark
                  ? "bg-slate-900 text-slate-400 border-slate-700 hover:border-slate-600"
                  : "bg-white text-slate-500 border-slate-200 hover:border-slate-300"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* ── Content ── */}
        {loading ? (
          <div className="py-16 text-center">
            <RefreshCw className={`w-8 h-8 animate-spin mx-auto mb-3 ${isDark ? "text-slate-600" : "text-slate-300"}`} />
            <p className={`text-sm ${isDark ? "text-slate-500" : "text-slate-400"}`}>Memuat data kejadian bencana…</p>
          </div>
        ) : error ? (
          <div className={`py-12 text-center rounded-lg border ${isDark ? "bg-slate-900 border-slate-800" : "bg-white border-slate-200"}`}>
            <AlertTriangle className="w-8 h-8 mx-auto mb-3 text-amber-500" />
            <p className={`text-sm font-semibold mb-1 ${isDark ? "text-slate-300" : "text-slate-700"}`}>Gagal memuat data</p>
            <p className={`text-xs mb-4 ${isDark ? "text-slate-500" : "text-slate-400"}`}>{error}</p>
            <button
              onClick={() => loadFeed(true)}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-md transition-colors"
            >
              Coba Lagi
            </button>
          </div>
        ) : displayed.length === 0 ? (
          <div className={`py-16 text-center rounded-lg border ${isDark ? "bg-slate-900 border-slate-800" : "bg-white border-slate-200"}`}>
            <CloudRain className={`w-10 h-10 mx-auto mb-3 ${isDark ? "text-slate-700" : "text-slate-300"}`} />
            <p className={`text-sm font-semibold mb-1 ${isDark ? "text-slate-400" : "text-slate-500"}`}>Tidak ada event bencana aktif</p>
            <p className={`text-xs ${isDark ? "text-slate-600" : "text-slate-400"}`}>
              Data diperbarui secara otomatis. Tidak ada event berarti saat ini tidak terdeteksi aktivitas signifikan dari BMKG/USGS.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {/* Table header: desktop only */}
            <div className={`hidden sm:grid grid-cols-[1rem_1fr_auto] gap-3 px-4 py-2 text-[10px] font-bold uppercase tracking-widest ${isDark ? "text-slate-600" : "text-slate-400"}`}>
              <div />
              <div>Kejadian</div>
              <div className="text-right pr-1">Tindakan</div>
            </div>

            {displayed.map((eq) => (
              <EarthquakeCard
                key={eq.id}
                eq={eq}
                isDark={isDark}
                onFocusMap={(e) => {
                  handleFocusDisaster(e);
                  window.location.href = "/monitoring";
                }}
              />
            ))}
          </div>
        )}

        {/* Information Footer */}
        <div className={`flex items-start gap-2 p-3 rounded-lg border text-xs ${
          isDark ? "bg-slate-900 border-slate-800 text-slate-500" : "bg-slate-50 border-slate-200 text-slate-400"
        }`}>
          <Info className="w-4 h-4 shrink-0 mt-0.5" />
          <p>
            Halaman ini menampilkan <strong>informasi kejadian bencana</strong> dari sumber eksternal resmi. Data ini bersifat
            observasional: bukan laporan operasional. Untuk penanganan, verifikasi lapangan, dan tindak lanjut, gunakan menu{" "}
            <strong>Laporan Kejadian</strong>.
          </p>
        </div>

      </div>
    </div>
  );
}
