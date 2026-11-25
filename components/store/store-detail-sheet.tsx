"use client";

import React, { useEffect, useState } from "react";
import { Store, getStoreOwnership, getStoreOwnershipLabel } from "@/types/store";
import { WeatherResponse } from "@/types/weather";
import {
  X,
  MapPin,
  Building,
  AlertTriangle,
  CheckCircle,
  Clock,
  Sun,
  Wind,
  Droplets,
  Calendar,
  Copy,
  Check,
} from "lucide-react";

interface StoreDetailSheetProps {
  store: Store | null;
  onClose: () => void;
  theme?: "dark" | "light";
}

export function StoreDetailSheet({ store, onClose, theme = "dark" }: StoreDetailSheetProps) {
  const [weather, setWeather] = useState<WeatherResponse | null>(null);
  const [loadingWeather, setLoadingWeather] = useState(false);
  const [copied, setCopied] = useState(false);

  const hasValidCoords = Boolean(
    store &&
      typeof store.latitude === "number" &&
      typeof store.longitude === "number" &&
      Number.isFinite(store.latitude) &&
      Number.isFinite(store.longitude)
  );

  useEffect(() => {
    if (!store || !hasValidCoords) {
      setWeather(null);
      setLoadingWeather(false);
      return;
    }

    setLoadingWeather(true);

    fetch(
      `/api/weather?lat=${store.latitude}&lon=${store.longitude}&id=${store.id}&name=${encodeURIComponent(
        store.nama_toko
      )}`
    )
      .then((res) => {
        if (!res.ok) throw new Error("Weather fetch failed");
        return res.json();
      })
      .then((data) => {
        if (data && data.current && Array.isArray(data.daily)) {
          setWeather(data);
        } else {
          setWeather(null);
        }
      })
      .catch((err) => {
        console.warn("Could not load weather:", err);
        setWeather(null);
      })
      .finally(() => {
        setLoadingWeather(false);
      });
  }, [store, hasValidCoords]);

  if (!store) return null;

  const handleCopyCoord = () => {
    if (!hasValidCoords) return;
    navigator.clipboard.writeText(`${store.latitude}, ${store.longitude}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const ownership = getStoreOwnership(store.fr_type);
  const isFranchise = ownership === "FRANCHISE";
  const isUnknownOwnership = ownership === "UNKNOWN";
  const isDark = theme === "dark";

  return (
    <div
      className={`fixed inset-y-0 right-0 w-full sm:w-[440px] border-l z-[650] shadow-2xl flex flex-col backdrop-blur-xl animate-in slide-in-from-right duration-300 transition-colors ${
        isDark
          ? "bg-slate-900/95 border-slate-800 text-white"
          : "bg-white/98 border-slate-200 text-slate-900 shadow-2xl"
      }`}
    >
      {/* Header */}
      <div
        className={`p-4 border-b flex items-start justify-between gap-3 ${
          isDark ? "bg-slate-950/60 border-slate-800" : "bg-slate-50 border-slate-200"
        }`}
      >
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span className={`px-2 py-0.5 rounded text-[11px] font-mono font-bold border ${
              isDark 
                ? "bg-red-600/20 text-red-400 border-red-500/30" 
                : "bg-red-100 text-red-700 border-red-200"
            }`}>
              {store.kode_toko}
            </span>

            {/* Franchise / Reguler / Unknown badge */}
            <span
              className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border ${
                isFranchise
                  ? isDark ? "bg-purple-950/80 text-purple-300 border-purple-600/40" : "bg-purple-100 text-purple-800 border-purple-200"
                  : isUnknownOwnership
                  ? isDark ? "bg-slate-800 text-slate-300 border-slate-600/50" : "bg-slate-200 text-slate-700 border-slate-300"
                  : isDark ? "bg-blue-950/80 text-blue-300 border-blue-600/40" : "bg-blue-100 text-blue-800 border-blue-200"
              }`}
            >
              {getStoreOwnershipLabel(store.fr_type)}
            </span>

            <span
              className={`px-2 py-0.5 rounded text-[11px] font-bold uppercase tracking-wider flex items-center gap-1 border ${
                store.status === "PRIORITY_MONITOR"
                  ? "bg-red-600 text-white animate-pulse border-red-600"
                  : store.status === "MONITOR"
                  ? "bg-amber-600 text-white border-amber-600"
                  : store.status === "UNASSESSED"
                  ? isDark
                    ? "bg-slate-800 text-slate-300 border-slate-700"
                    : "bg-slate-100 text-slate-700 border-slate-300"
                  : isDark 
                    ? "bg-emerald-600/30 text-emerald-300 border-emerald-500/30"
                    : "bg-emerald-100 text-emerald-700 border-emerald-200"
              }`}
            >
              {store.status === "PRIORITY_MONITOR" ? (
                <>
                  <AlertTriangle className="w-3 h-3" />
                  Zona Prioritas Pantau (Dalam V1)
                </>
              ) : store.status === "MONITOR" ? (
                <>
                  <AlertTriangle className="w-3 h-3" />
                  Zona Pantau
                </>
              ) : store.status === "UNASSESSED" ? (
                <>
                  <Clock className="w-3 h-3" />
                  Di Luar V1 (Belum Terkaji)
                </>
              ) : (
                <>
                  <CheckCircle className="w-3 h-3" />
                  Normal (Tidak Terdampak)
                </>
              )}
            </span>
          </div>

          <h2 className={`text-base font-bold truncate ${isDark ? "text-white" : "text-slate-900"}`}>{store.nama_toko}</h2>
          <p className={`text-xs flex items-center gap-1 mt-0.5 ${isDark ? "text-slate-400" : "text-slate-600"}`}>
            <Building className={`w-3 h-3 shrink-0 ${isDark ? "text-slate-500" : "text-slate-400"}`} />
            <span>
              Cabang {store.cabang}
              {store.branch_code && store.branch_code.toUpperCase() !== store.cabang.toUpperCase()
                ? ` (${store.branch_code})`
                : ""}
            </span>
          </p>
        </div>

        <button
          onClick={onClose}
          className={`p-1.5 rounded-lg transition-colors ${
            isDark 
              ? "hover:bg-slate-800 text-slate-400 hover:text-white" 
              : "hover:bg-slate-200 text-slate-500 hover:text-slate-900"
          }`}
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Content scroll area */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Disaster alert context if in active earthquake footprint */}
        {store.distanceFromDisasterKm !== undefined && (store.status === "PRIORITY_MONITOR" || store.status === "MONITOR" || store.status === "UNASSESSED") && (
          <div
            className={`p-3 rounded-xl border text-xs ${
              store.status === "PRIORITY_MONITOR"
                ? isDark 
                  ? "bg-red-950/70 border-red-700/60 text-red-200" 
                  : "bg-red-50 border-red-200 text-red-800"
                : store.status === "MONITOR"
                ? isDark
                  ? "bg-amber-950/70 border-amber-700/60 text-amber-200"
                  : "bg-amber-50 border-amber-200 text-amber-800"
                : isDark
                  ? "bg-slate-900 border-slate-800 text-slate-300"
                  : "bg-slate-50 border-slate-200 text-slate-700"
            }`}
          >
            <div className="flex items-center gap-2 font-bold mb-1">
              <AlertTriangle className={`w-4 h-4 ${store.status === "PRIORITY_MONITOR" ? "text-red-500" : store.status === "MONITOR" ? "text-amber-500" : "text-slate-400"}`} />
              <span>
                {store.status === "UNASSESSED"
                  ? "Informasi Kedekatan Episentrum Gempa"
                  : "Peringatan Kedekatan Episentrum Gempa"}
              </span>
            </div>
            <p>
              Toko ini berjarak{" "}
              <strong className="underline decoration-red-500">
                {store.distanceFromDisasterKm} km
              </strong>{" "}
              dari episentrum ({store.nearestDisasterTitle || "Gempa Terkini"}).
              {store.status === "UNASSESSED" && (
                <span className="block mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                  Status: Di luar radius V1. Intensitas getaran resmi belum terkaji (berada di luar V1 tidak membuktikan keamanan fisik).
                </span>
              )}
            </p>
          </div>
        )}

        {/* Location & Coordinates */}
        <div className={`rounded-xl p-3 border space-y-2 text-xs ${isDark ? "bg-slate-800/60 border-slate-700/50" : "bg-slate-100 border-slate-200"}`}>
          <div className="flex items-start gap-2">
            <MapPin className={`w-4 h-4 shrink-0 mt-0.5 ${isDark ? "text-slate-400" : "text-slate-500"}`} />
            <p className={`leading-relaxed ${isDark ? "text-slate-300" : "text-slate-700 font-medium"}`}>
              {store.alamat?.trim() ? store.alamat : "Alamat belum tersedia di master toko"}
            </p>
          </div>

          <div className={`pt-2 border-t flex items-center justify-between font-mono ${isDark ? "border-slate-700/40 text-slate-400" : "border-slate-300 text-slate-600"}`}>
            <span>
              {hasValidCoords
                ? `${store.latitude.toFixed(4)}, ${store.longitude.toFixed(4)}`
                : "Koordinat belum tersedia"}
            </span>
            {hasValidCoords && (
              <button
                type="button"
                onClick={handleCopyCoord}
                className={`flex items-center gap-1 text-[11px] px-2 py-0.5 rounded transition-colors ${
                  isDark 
                    ? "bg-slate-700/60 hover:bg-slate-700 text-slate-200" 
                    : "bg-slate-200 hover:bg-slate-300 text-slate-800"
                }`}
              >
                {copied ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
                <span>{copied ? "Tersalin" : "Salin"}</span>
              </button>
            )}
          </div>
        </div>


        {/* Weather Forecast Section */}
        <div className={`rounded-xl p-3 border space-y-3 ${isDark ? "bg-slate-800/60 border-slate-700/50" : "bg-slate-100 border-slate-200"}`}>
          <div className="flex items-center justify-between">
            <span className={`text-xs font-bold flex items-center gap-1.5 ${isDark ? "text-white" : "text-slate-900"}`}>
              <Sun className={`w-3.5 h-3.5 ${isDark ? "text-amber-400" : "text-amber-500"}`} />
              Prakiraan Cuaca (Open-Meteo)
            </span>
            <span className={`text-[10px] ${isDark ? "text-slate-400" : "text-slate-500"}`}>Real-time update</span>
          </div>

          {loadingWeather ? (
            <div className="space-y-2 py-3 animate-pulse">
              <div className={`h-10 rounded-lg w-full ${isDark ? "bg-slate-700/50" : "bg-slate-200"}`} />
              <div className={`h-20 rounded-lg w-full ${isDark ? "bg-slate-700/50" : "bg-slate-200"}`} />
            </div>
          ) : weather && weather.current ? (
            <>
              {/* Current Weather Card */}
              <div className={`flex items-center justify-between p-3 rounded-lg border ${
                isDark ? "bg-slate-900/80 border-slate-700/60" : "bg-white border-slate-200 shadow-sm"
              }`}>
                <div className="flex items-center gap-3">
                  <div className={`text-2xl font-black font-mono ${isDark ? "text-white" : "text-slate-900"}`}>
                    {weather.current.temperature ?? "--"}°C
                  </div>
                  <div>
                    <p className={`text-xs font-semibold ${isDark ? "text-slate-200" : "text-slate-800"}`}>
                      {weather.current.weatherDescription || "Cerah Berawan"}
                    </p>
                    <p className={`text-[10px] ${isDark ? "text-slate-400" : "text-slate-500"}`}>
                      Terasa seperti {weather.current.apparentTemperature ?? "--"}°C
                    </p>
                  </div>
                </div>

                <div className={`text-right space-y-0.5 text-[11px] ${isDark ? "text-slate-300" : "text-slate-600"}`}>
                  <div className={`flex items-center gap-1 justify-end ${isDark ? "text-cyan-400" : "text-cyan-600"}`}>
                    <Droplets className="w-3 h-3" />
                    <span>{weather.current.humidity ?? 0}% {weather.current.precipitation ? `(${weather.current.precipitation} mm)` : ""}</span>
                  </div>
                  <div className={`flex items-center gap-1 justify-end ${isDark ? "text-slate-400" : "text-slate-500"}`}>
                    <Wind className="w-3 h-3" />
                    <span>{weather.current.windSpeed ?? 0} km/h</span>
                  </div>
                </div>
              </div>

              {/* Flood / Heavy Rain Warning Banner if detected */}
              {weather.current.floodWarning && (
                <div className={`p-2.5 rounded-lg border text-xs flex items-center gap-2 ${
                  isDark ? "bg-blue-950/80 border-blue-600/70 text-blue-200" : "bg-blue-50 border-blue-200 text-blue-800"
                }`}>
                  <Droplets className={`w-4 h-4 shrink-0 animate-bounce ${isDark ? "text-blue-400" : "text-blue-600"}`} />
                  <div>
                    <p className={`font-bold text-[11px] ${isDark ? "text-blue-300" : "text-blue-700"}`}>Waspada Potensi Banjir / Hujan Lebat</p>
                    <p className={`text-[10px] mt-0.5 ${isDark ? "text-slate-300" : "text-blue-600/90"}`}>
                      Curah hujan tinggi ({weather.current.precipitation ?? 0} mm/jam). Pastikan peninggian aset barang dagang dan tanggul banjir toko terpasang.
                    </p>
                  </div>
                </div>
              )}

              {/* 7-Day Forecast Row */}
              {Array.isArray(weather.daily) && weather.daily.length > 0 && (
                <div className="space-y-1.5 pt-1">
                  <div className={`text-[11px] font-semibold flex items-center gap-1 ${isDark ? "text-slate-400" : "text-slate-600"}`}>
                    <Calendar className="w-3 h-3" />
                    <span>Prakiraan 7 Hari Ke Depan</span>
                  </div>

                  <div className="space-y-1 max-h-48 overflow-y-auto pr-1">
                    {weather.daily.map((day, idx) => (
                      <div
                        key={idx}
                        className={`flex items-center justify-between p-2 rounded-md text-xs transition-colors ${
                          isDark 
                            ? "bg-slate-900/50 hover:bg-slate-900 text-slate-300" 
                            : "bg-white hover:bg-slate-50 border border-slate-100 text-slate-700"
                        }`}
                      >
                        <span className={`w-20 font-medium truncate ${isDark ? "text-slate-400" : "text-slate-600"}`}>
                          {new Date(day.date).toLocaleDateString("id-ID", {
                            weekday: "short",
                            day: "numeric",
                            month: "short",
                          })}
                        </span>

                        <span className={`text-[11px] flex-1 truncate px-2 ${isDark ? "text-slate-300" : "text-slate-600"}`}>
                          {day.weatherDescription}
                        </span>

                        <div className="flex items-center gap-2 font-mono text-[11px]">
                          <span className={isDark ? "text-amber-400" : "text-amber-600 font-semibold"}>{day.tempMax}°</span>
                          <span className={isDark ? "text-slate-500" : "text-slate-300"}>/</span>
                          <span className={isDark ? "text-blue-400" : "text-blue-600 font-semibold"}>{day.tempMin}°</span>
                          <span className={`text-[10px] ml-1 ${isDark ? "text-cyan-400" : "text-cyan-600 font-medium"}`}>
                            🌧️ {day.precipitationProbability}%
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          ) : (
            <p className={`text-xs text-center py-4 ${isDark ? "text-slate-500" : "text-slate-400"}`}>Data cuaca tidak tersedia</p>
          )}
        </div>
      </div>
    </div>
  );
}
