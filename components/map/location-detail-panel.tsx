"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import {
  X,
  Building,
  Store,
  MapPin,
  ShieldAlert,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Wrench,
  UserCheck,
  User,
  ExternalLink,
  ChevronRight,
  FileText,
  Activity,
  Layers,
  Loader2,
} from "lucide-react";
import { Store as StoreType } from "@/types/store";
import type { AhoStoreDetailResponse } from "@/lib/maintenance-aho-db";
import { getAhoColor } from "@/lib/aho-utils";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Button, buttonVariants } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

export type FacilityDetail = {
  id: string;
  code: string;
  name: string;
  facility_type: string;
  latitude: number;
  longitude: number;
  branch_id: string | null;
  operational_status: string;
  auto_report_enabled: boolean;
  mapping_verified_at: string | null;
};

export interface BranchSummaryDetail {
  cabang: string;
  totalStores: number;
  latitude: number;
  longitude: number;
  dangerCount?: number;
  warningCount?: number;
  storesWithTickets?: number;
  totalTickets?: number;
  percentage?: number;
}

export interface ClusterSummaryDetail {
  lat: number;
  lng: number;
  totalStores: number;
  storesWithTickets?: number;
  totalTickets?: number;
  percentage?: number;
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

interface LocationDetailPanelProps {
  location?: StoreType | null;
  facility?: FacilityDetail | null;
  branch?: BranchSummaryDetail | null;
  cluster?: ClusterSummaryDetail | null;
  onClose: () => void;
  isMobile?: boolean;
  locationMode?: "event" | "store" | "dc";
  currentEarthquake?: {
    latitude: number;
    longitude: number;
    magnitude: number;
    title?: string;
  } | null;
  activeRole?: string;
  activeLayer?: "all" | "earthquake" | "stores" | "weather" | "flood" | "aho";
  onFlyTo?: (lat: number, lng: number, zoom: number) => void;
}

export function LocationDetailPanel({
  location,
  facility,
  branch,
  cluster,
  onClose,
  isMobile = false,
  locationMode = "store",
  currentEarthquake,
  activeRole,
  activeLayer,
  onFlyTo,
}: LocationDetailPanelProps) {
  // SPARTA Maintenance AHO tickets and personnel state
  const [ahoData, setAhoData] = useState<AhoStoreDetailResponse | null>(null);
  const [loadingAho, setLoadingAho] = useState(false);
  const [ahoError, setAhoError] = useState<string | null>(null);

  useEffect(() => {
    // Only fetch AHO details for real store locations, not DC facilities
    const isFac = Boolean(facility || location?.id?.startsWith("FACILITY:"));
    if (!location || isFac) {
      setAhoData(null);
      return;
    }

    const code = (location.kode_toko || "").trim().toUpperCase();
    if (!code) return;

    const controller = new AbortController();
    setLoadingAho(true);
    setAhoError(null);

    fetch(`/api/aho/stores/${encodeURIComponent(code)}`, {
      signal: controller.signal,
    })
      .then(async (res) => {
        const payload = await res.json();
        if (!res.ok || !payload.success) {
          throw new Error(payload.error || "Gagal memuat data AHO toko");
        }
        setAhoData(payload.data || null);
      })
      .catch((err) => {
        if (err.name !== "AbortError") {
          setAhoError(err.message || "Gagal memuat tiket AHO");
        }
      })
      .finally(() => {
        setLoadingAho(false);
      });

    return () => controller.abort();
  }, [location?.kode_toko, facility, location?.id]);

  // Compute distance from current earthquake epicenter if available
  const distanceKm = React.useMemo(() => {
    if (locationMode !== "event" || !location || !currentEarthquake) return null;
    const lat1 = location.latitude;
    const lon1 = location.longitude;
    const lat2 = currentEarthquake.latitude;
    const lon2 = currentEarthquake.longitude;
    const R = 6371; // km
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLon = ((lon2 - lon1) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos((lat1 * Math.PI) / 180) *
        Math.cos((lat2 * Math.PI) / 180) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return Math.round(R * c * 10) / 10;
  }, [locationMode, location, currentEarthquake]);

  const isFacility = locationMode === "dc" || Boolean(facility || location?.id?.startsWith("FACILITY:"));
  const locCode = facility?.code || location?.kode_toko || "-";
  const locName = facility?.name || location?.nama_toko || "Lokasi";
  const locType = facility?.facility_type
    ? facility.facility_type.replace(/_/g, " ")
    : "Toko Alfamart";
  const branchName = facility?.branch_id || location?.cabang || "Belum dipetakan";
  const isMapped = Boolean(facility?.mapping_verified_at || (!isFacility && location?.cabang));

  // Determine standardized operational terminology (antislop & SPARTA guidelines)
  const getTerminologyBadge = () => {
    if (!location) return null;

    if (location.visualStatus === "SELESAI" || location.operationalStatus === "RESOLVED") {
      return {
        label: "Selesai",
        sub: "Laporan penanganan telah ditutup (CLOSED)",
        variant: "secondary" as const,
        icon: CheckCircle2,
      };
    }
    if (location.visualStatus === "DALAM_PENANGANAN") {
      return {
        label: "Dalam Penanganan",
        sub: "Proses perbaikan atau SPK sedang berjalan",
        variant: "default" as const,
        icon: Wrench,
      };
    }
    if (location.visualStatus === "TERDAMPAK") {
      return {
        label: "Kerusakan Terkonfirmasi",
        sub: "Kerusakan fisik telah diverifikasi oleh tim lapangan",
        variant: "destructive" as const,
        icon: ShieldAlert,
      };
    }
    // Earthquake-specific radius terminology only applies when in event mode
    if (locationMode === "event") {
      if (location.status === "PRIORITY_MONITOR") {
        return {
          label: "Radius Evaluasi (V1)",
          sub: "Dalam radius evaluasi gempa BMKG (V1)",
          variant: "outline" as const,
          icon: AlertTriangle,
        };
      }
      if (location.status === "MONITOR") {
        return {
          label: "Radius Pemantauan",
          sub: "Dalam radius pemantauan operasional wilayah",
          variant: "outline" as const,
          icon: Clock,
        };
      }
    }
    return {
      label: "Operasional Normal",
      sub: "Kondisi operasional normal",
      variant: "secondary" as const,
      icon: CheckCircle2,
    };
  };

  // ---------------------------------------------------------------------------
  // Branch Summary View (When Branch Aggregation Marker is Clicked)
  // ---------------------------------------------------------------------------
  if (branch) {
    const isAho = activeLayer === "aho";
    const ahoColor = isAho ? getAhoColor(branch.percentage ?? 0) : null;

    return (
      <>
        {isMobile && (
          <div
            className="fixed inset-0 bg-slate-950/50 backdrop-blur-xs z-[1190] transition-opacity"
            onClick={onClose}
            aria-hidden="true"
          />
        )}
        <aside
          onTouchStart={(e) => e.stopPropagation()}
          onTouchMove={(e) => e.stopPropagation()}
          onWheel={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
          className={`bg-card text-card-foreground border-border z-[1200] flex flex-col min-h-0 transition-all duration-200 ${
            isMobile
              ? "fixed inset-x-0 bottom-0 max-h-[85vh] rounded-t-2xl border-t shadow-2xl overflow-y-auto overscroll-y-contain pb-24 animate-in slide-in-from-bottom"
              : "w-96 md:w-[400px] h-full border-l shadow-lg shrink-0 overflow-hidden"
          }`}
          aria-label="Panel Detail Agregasi Cabang"
        >
          {isMobile && (
            <div className="w-full flex justify-center pt-2.5 pb-1">
              <div className="w-12 h-1 bg-muted-foreground/30 rounded-full" />
            </div>
          )}

          {/* Header */}
          <div className="p-3.5 border-b border-border flex items-start justify-between gap-2.5 shrink-0 bg-muted/20">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap mb-1">
                <Badge variant="outline" className="text-[10px] uppercase font-semibold gap-1">
                  <Building className="w-3 h-3 text-primary" />
                  <span>Agregasi Cabang</span>
                </Badge>
                {ahoColor && (
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded text-white ${ahoColor.bgClass}`}>
                    {ahoColor.category}
                  </span>
                )}
              </div>
              <h2 className="text-sm font-semibold text-foreground truncate" title={branch.cabang}>
                Cabang {branch.cabang}
              </h2>
              <p className="text-xs text-muted-foreground truncate mt-0.5">
                Cakupan Agregasi Wilayah Operasional
              </p>
            </div>

            <Button
              variant="ghost"
              size="icon-xs"
              onClick={onClose}
              className="h-7 w-7 text-muted-foreground hover:text-foreground shrink-0"
              aria-label="Tutup panel detail"
            >
              <X className="w-4 h-4" />
            </Button>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto p-3.5 space-y-3.5 text-xs">
            <div className="space-y-3.5">
              {/* Stats Card */}
              <Card>
                <CardHeader className="p-3 pb-2 flex-row items-center justify-between space-y-0">
                  <div className="flex items-center gap-1.5">
                    {isAho ? <Wrench className="w-3.5 h-3.5 text-amber-500" /> : <Store className="w-3.5 h-3.5 text-primary" />}
                    <CardTitle className="text-xs">{isAho ? "Metrik Tiket AHO Cabang" : "Statistik Jaringan Toko"}</CardTitle>
                  </div>
                </CardHeader>
                <CardContent className="p-3 pt-0 space-y-2 text-xs">
                  <div className="p-2.5 rounded-lg border border-border bg-muted/30 space-y-1.5">
                    <div className="flex justify-between items-center">
                      <span className="text-muted-foreground">Total Toko di Cabang:</span>
                      <strong className="text-foreground font-semibold">{branch.totalStores} Toko</strong>
                    </div>

                    {isAho && (
                      <>
                        <div className="flex justify-between items-center">
                          <span className="text-muted-foreground">Toko Bertiket Aktif:</span>
                          <strong className="text-red-500 font-bold">{branch.storesWithTickets ?? 0} Toko</strong>
                        </div>
                        <div className="flex justify-between items-center">
                          <span className="text-muted-foreground">Total Tiket AHO Aktif:</span>
                          <strong className="text-amber-500 font-bold">{branch.totalTickets ?? 0} Tiket</strong>
                        </div>
                        <Separator />
                        <div className="flex justify-between items-center pt-0.5">
                          <span className="text-muted-foreground font-medium">Persentase Toko Bertiket:</span>
                          <strong className={`font-mono text-sm font-bold ${ahoColor?.textClass}`}>
                            {(branch.percentage ?? 0).toFixed(1)}%
                          </strong>
                        </div>
                      </>
                    )}

                    {!isAho && (
                      <>
                        {(branch.dangerCount ?? 0) > 0 && (
                          <div className="flex justify-between items-center">
                            <span className="text-red-500 font-medium">Prioritas Pantau:</span>
                            <strong className="text-red-600 font-bold">{branch.dangerCount} Toko</strong>
                          </div>
                        )}
                        {(branch.warningCount ?? 0) > 0 && (
                          <div className="flex justify-between items-center">
                            <span className="text-amber-500 font-medium">Perlu Perhatian:</span>
                            <strong className="text-amber-600 font-bold">{branch.warningCount} Toko</strong>
                          </div>
                        )}
                      </>
                    )}
                  </div>

                  {isAho && (
                    <p className="text-[10px] text-muted-foreground leading-snug italic pt-1">
                      * Dihitung dari toko yang memiliki minimal satu tiket AHO aktif (berstatus New atau Progress) di SPARTA Maintenance.
                    </p>
                  )}
                </CardContent>
              </Card>

              {/* Coordinates */}
              <div className="p-2.5 rounded-lg border border-border bg-muted/30 flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Titik Koordinat Agregasi:</span>
                <span className="font-mono text-foreground font-medium">
                  {branch.latitude.toFixed(4)}, {branch.longitude.toFixed(4)}
                </span>
              </div>

              {/* Action */}
              <div className="pt-1">
                <Button
                  onClick={() => onFlyTo?.(branch.latitude, branch.longitude, 10)}
                  className="w-full text-xs h-9 justify-center gap-2"
                >
                  <MapPin className="w-3.5 h-3.5" />
                  <span>Fokus ke Cabang Ini (Perbesar Peta)</span>
                </Button>
              </div>
            </div>
          </div>
        </aside>
      </>
    );
  }

  // ---------------------------------------------------------------------------
  // Cluster Summary View (When Geographic Cluster Marker is Clicked)
  // ---------------------------------------------------------------------------
  if (cluster) {
    const isAho = activeLayer === "aho";
    const ahoColor = isAho ? getAhoColor(cluster.percentage ?? 0) : null;

    return (
      <>
        {isMobile && (
          <div
            className="fixed inset-0 bg-slate-950/50 backdrop-blur-xs z-[1190] transition-opacity"
            onClick={onClose}
            aria-hidden="true"
          />
        )}
        <aside
          onTouchStart={(e) => e.stopPropagation()}
          onTouchMove={(e) => e.stopPropagation()}
          onWheel={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
          className={`bg-card text-card-foreground border-border z-[1200] flex flex-col min-h-0 transition-all duration-200 ${
            isMobile
              ? "fixed inset-x-0 bottom-0 max-h-[85vh] rounded-t-2xl border-t shadow-2xl overflow-y-auto overscroll-y-contain pb-24 animate-in slide-in-from-bottom"
              : "w-96 md:w-[400px] h-full border-l shadow-lg shrink-0 overflow-hidden"
          }`}
          aria-label="Panel Detail Cluster Geografis"
        >
          {isMobile && (
            <div className="w-full flex justify-center pt-2.5 pb-1">
              <div className="w-12 h-1 bg-muted-foreground/30 rounded-full" />
            </div>
          )}

          {/* Header */}
          <div className="p-3.5 border-b border-border flex items-start justify-between gap-2.5 shrink-0 bg-muted/20">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap mb-1">
                <Badge variant="outline" className="text-[10px] uppercase font-semibold gap-1">
                  <Layers className="w-3.5 h-3.5 text-primary" />
                  <span>Cluster Geografis</span>
                </Badge>
                {ahoColor && (
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded text-white ${ahoColor.bgClass}`}>
                    {Math.round(cluster.percentage ?? 0)}%
                  </span>
                )}
              </div>
              <h2 className="text-sm font-semibold text-foreground truncate">
                Cluster ({cluster.totalStores} Toko)
              </h2>
              <p className="text-xs text-muted-foreground truncate mt-0.5">
                Pengelompokan Spasial Titik Terdekat
              </p>
            </div>

            <Button
              variant="ghost"
              size="icon-xs"
              onClick={onClose}
              className="h-7 w-7 text-muted-foreground hover:text-foreground shrink-0"
              aria-label="Tutup panel detail"
            >
              <X className="w-4 h-4" />
            </Button>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto p-3.5 space-y-3.5 text-xs">
            <div className="space-y-3.5">
              <Card>
                <CardHeader className="p-3 pb-2 flex-row items-center justify-between space-y-0">
                  <div className="flex items-center gap-1.5">
                    {isAho ? <Wrench className="w-3.5 h-3.5 text-amber-500" /> : <Store className="w-3.5 h-3.5 text-primary" />}
                    <CardTitle className="text-xs">Informasi Agregasi Cluster</CardTitle>
                  </div>
                </CardHeader>
                <CardContent className="p-3 pt-0 space-y-2 text-xs">
                  <div className="p-2.5 rounded-lg border border-border bg-muted/30 space-y-1.5">
                    <div className="flex justify-between items-center">
                      <span className="text-muted-foreground">Total Toko dalam Cluster:</span>
                      <strong className="text-foreground font-semibold">{cluster.totalStores} Toko</strong>
                    </div>

                    {isAho && (
                      <>
                        <div className="flex justify-between items-center">
                          <span className="text-muted-foreground">Toko Bertiket Aktif:</span>
                          <strong className="text-red-500 font-bold">{cluster.storesWithTickets ?? 0} Toko</strong>
                        </div>
                        <div className="flex justify-between items-center">
                          <span className="text-muted-foreground">Total Tiket AHO:</span>
                          <strong className="text-amber-500 font-bold">{cluster.totalTickets ?? 0} Tiket</strong>
                        </div>
                        <Separator />
                        <div className="flex justify-between items-center pt-0.5">
                          <span className="text-muted-foreground font-medium">Persentase:</span>
                          <strong className={`font-mono text-sm font-bold ${ahoColor?.textClass}`}>
                            {(cluster.percentage ?? 0).toFixed(1)}%
                          </strong>
                        </div>
                      </>
                    )}
                  </div>
                </CardContent>
              </Card>

              {/* Coordinates */}
              <div className="p-2.5 rounded-lg border border-border bg-muted/30 flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Koordinat Pusat Cluster:</span>
                <span className="font-mono text-foreground font-medium">
                  {cluster.lat.toFixed(4)}, {cluster.lng.toFixed(4)}
                </span>
              </div>

              {/* Action Button */}
              <div className="pt-1">
                <Button
                  onClick={() => onFlyTo?.(cluster.lat, cluster.lng, 13)}
                  className="w-full text-xs h-9 justify-center gap-2"
                >
                  <MapPin className="w-3.5 h-3.5" />
                  <span>Perbesar Cluster Ini ke Toko Individual</span>
                </Button>
              </div>
            </div>
          </div>
        </aside>
      </>
    );
  }

  const termBadge = getTerminologyBadge();

  if (!location) return null;

  return (
    <>
      {isMobile && (
        <div
          className="fixed inset-0 bg-slate-950/50 backdrop-blur-xs z-[1190] transition-opacity"
          onClick={onClose}
          aria-hidden="true"
        />
      )}
      <aside
        onTouchStart={(e) => e.stopPropagation()}
        onTouchMove={(e) => e.stopPropagation()}
        onWheel={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
        className={`bg-card text-card-foreground border-border z-[1200] flex flex-col min-h-0 transition-all duration-200 ${
          isMobile
            ? "fixed inset-x-0 bottom-0 max-h-[85vh] rounded-t-2xl border-t shadow-2xl overflow-y-auto overscroll-y-contain pb-24 animate-in slide-in-from-bottom"
            : "w-96 md:w-[400px] h-full border-l shadow-lg shrink-0 overflow-hidden"
        }`}
        aria-label="Panel Detail Objek Monitoring"
      >
        {/* Mobile Drag Indicator */}
        {isMobile && (
          <div className="w-full flex justify-center pt-2.5 pb-1">
            <div className="w-12 h-1 bg-muted-foreground/30 rounded-full" />
          </div>
        )}

        {/* Panel Header */}
        <div className="p-3.5 border-b border-border flex items-start justify-between gap-2.5 shrink-0 bg-muted/20">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <Badge variant="outline" className="text-[10px] uppercase font-semibold gap-1">
                {isFacility ? <Building className="w-3 h-3" /> : <Store className="w-3 h-3" />}
                <span>{locType}</span>
              </Badge>
              <span className="text-xs font-mono text-muted-foreground font-semibold">
                {locCode}
              </span>
            </div>
            <h2 className="text-sm font-semibold text-foreground truncate" title={locName}>
              {locName}
            </h2>
            <p className="text-xs text-muted-foreground truncate mt-0.5">
              {location.alamat || (isFacility ? "Master Fasilitas Logistik" : "Jaringan Toko Alfamart")}
            </p>
          </div>

          <Button
            variant="ghost"
            size="icon-xs"
            onClick={onClose}
            className="h-7 w-7 text-muted-foreground hover:text-foreground shrink-0"
            aria-label="Tutup panel detail"
          >
            <X className="w-4 h-4" />
          </Button>
        </div>

        {/* Scrollable Content Body */}
        <div className="flex-1 min-h-0 overflow-y-auto p-3.5 space-y-3.5 text-xs">
          <div className="space-y-3.5">
            {/* Status Terminology Card */}
            {termBadge && (
              <div className="p-2.5 rounded-lg border border-border bg-muted/40 flex items-start gap-2.5">
                <termBadge.icon className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                <div className="min-w-0">
                  <span className="font-semibold text-xs text-foreground block">
                    {termBadge.label}
                  </span>
                  <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug">
                    {termBadge.sub}
                  </p>
                </div>
              </div>
            )}

            {/* Earthquake Exposure Info (strictly isolated to Mode Kejadian) */}
            {locationMode === "event" && distanceKm !== null && currentEarthquake && (
              <Card>
                <CardContent className="p-3 space-y-1.5 text-xs">
                  <div className="flex items-center justify-between text-muted-foreground">
                    <span className="flex items-center gap-1.5">
                      <Activity className="w-3.5 h-3.5 text-red-500" />
                      Jarak dari Episentrum
                    </span>
                    <strong className="text-foreground font-mono">{distanceKm} km</strong>
                  </div>
                  <Separator />
                  <div className="flex items-center justify-between text-muted-foreground text-[11px]">
                    <span>Status Evaluasi:</span>
                    <span className="font-medium text-foreground">
                      {location.status === "PRIORITY_MONITOR"
                        ? "Dalam Radius V1"
                        : location.status === "MONITOR"
                        ? "Radius Pantauan"
                        : "Di Luar Radius Gempa"}
                    </span>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Location Metadata Grid */}
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="p-2.5 rounded-lg border border-border bg-muted/30">
                <span className="text-[10px] text-muted-foreground uppercase font-semibold block mb-0.5">
                  Cabang
                </span>
                <strong className={`block truncate ${isMapped ? "text-foreground" : "text-amber-600"}`}>
                  {branchName}
                </strong>
              </div>
              <div className="p-2.5 rounded-lg border border-border bg-muted/30">
                <span className="text-[10px] text-muted-foreground uppercase font-semibold block mb-0.5">
                  Koordinat
                </span>
                <span className="font-mono text-muted-foreground block truncate">
                  {location.latitude.toFixed(4)}, {location.longitude.toFixed(4)}
                </span>
              </div>
            </div>

            {/* ========================================================================= */}
            {/* BAGIAN B: Penanggung Jawab Toko (BMS, BMC, BnM Manager)                    */}
            {/* ========================================================================= */}
            {!isFacility && (
              <Card>
                <CardHeader className="p-3 pb-2 flex-row items-center justify-between space-y-0">
                  <div className="flex items-center gap-1.5">
                    <UserCheck className="w-3.5 h-3.5 text-primary" />
                    <CardTitle className="text-xs">Penanggung Jawab Toko</CardTitle>
                  </div>
                  <Badge variant="outline" className="text-[9px] font-mono">
                    Maintenance
                  </Badge>
                </CardHeader>
                <CardContent className="p-3 pt-0 space-y-1.5 text-xs">
                  {/* BMS */}
                  <div className="p-2 rounded-md bg-muted/30 border border-border flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground uppercase font-semibold">
                        <span>BMS</span>
                        <span className="text-[9px] lowercase font-normal opacity-80">(supervisor)</span>
                      </div>
                      <div className="font-medium text-xs text-foreground mt-0.5 truncate" title={ahoData?.personnel?.bms || "-"}>
                        {ahoData?.personnel?.bms || "Data belum tersedia"}
                      </div>
                    </div>
                    <Badge variant={ahoData?.personnel?.bms ? "default" : "outline"} className="text-[9px] shrink-0 font-medium">
                      {ahoData?.personnel?.bms ? "Aktif" : "Menunggu Akses"}
                    </Badge>
                  </div>

                  {/* BMC */}
                  <div className="p-2 rounded-md bg-muted/30 border border-border flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground uppercase font-semibold">
                        <span>BMC</span>
                        <span className="text-[9px] lowercase font-normal opacity-80">(koordinator)</span>
                      </div>
                      <div className="font-medium text-xs text-foreground mt-0.5 truncate" title={ahoData?.personnel?.bmc || "-"}>
                        {ahoData?.personnel?.bmc || "Data belum tersedia"}
                      </div>
                    </div>
                    <Badge variant={ahoData?.personnel?.bmc ? "default" : "outline"} className="text-[9px] shrink-0 font-medium">
                      {ahoData?.personnel?.bmc ? "Aktif" : "Menunggu Akses"}
                    </Badge>
                  </div>

                  {/* BnM Manager */}
                  <div className="p-2 rounded-md bg-muted/30 border border-border flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground uppercase font-semibold">
                        <span>BnM Manager</span>
                        <span className="text-[9px] lowercase font-normal opacity-80">(cabang)</span>
                      </div>
                      <div className="font-medium text-xs text-foreground mt-0.5 truncate" title={ahoData?.personnel?.bnmManager || "-"}>
                        {ahoData?.personnel?.bnmManager || "Data belum tersedia"}
                      </div>
                    </div>
                    <Badge variant={ahoData?.personnel?.bnmManager ? "default" : "outline"} className="text-[9px] shrink-0 font-medium">
                      {ahoData?.personnel?.bnmManager ? "Aktif" : "Menunggu Akses"}
                    </Badge>
                  </div>

                  <p className="text-[10px] text-muted-foreground italic pt-1 leading-snug">
                    * Bersumber dari database SPARTA Maintenance (Kondisi A: menunggu perluasan izin SELECT).
                  </p>
                </CardContent>
              </Card>
            )}

            {/* ========================================================================= */}
            {/* BAGIAN C: Informasi Tiket AHO (SPARTA Maintenance)                        */}
            {/* ========================================================================= */}
            {!isFacility && (
              <Card>
                <CardHeader className="p-3 pb-2 flex-row items-center justify-between space-y-0">
                  <div className="flex items-center gap-1.5">
                    <Wrench className="w-3.5 h-3.5 text-amber-500" />
                    <CardTitle className="text-xs">Tiket AHO Aktif</CardTitle>
                  </div>
                  {loadingAho ? (
                    <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                      <Loader2 className="w-3 h-3 animate-spin text-primary" />
                      <span>Memuat...</span>
                    </span>
                  ) : ahoData ? (
                    <Badge
                      variant={ahoData.totalActive > 0 ? "destructive" : "secondary"}
                      className="text-[10px] font-mono"
                    >
                      {ahoData.totalActive} Tiket Aktif
                    </Badge>
                  ) : null}
                </CardHeader>

                <CardContent className="p-3 pt-0 space-y-2 text-xs">
                  {loadingAho ? (
                    <div className="py-4 flex flex-col items-center justify-center gap-2 text-muted-foreground text-xs">
                      <Loader2 className="w-5 h-5 animate-spin text-primary" />
                      <span>Mengambil data tiket AHO...</span>
                    </div>
                  ) : ahoError ? (
                    <div className="p-2 rounded-md bg-amber-500/10 border border-amber-500/30 text-amber-700 dark:text-amber-300 text-xs flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4 shrink-0 text-amber-600" />
                      <span>{ahoError}</span>
                    </div>
                  ) : ahoData && ahoData.totalActive > 0 ? (
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                        <span className="uppercase font-semibold">Daftar Tiket:</span>
                        {ahoData.lastUpdated && (
                          <span className="flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            <span>{formatWibDateTime(ahoData.lastUpdated)}</span>
                          </span>
                        )}
                      </div>
                      <div className="space-y-1.5 max-h-48 overflow-y-auto pr-0.5">
                        {ahoData.tickets.map((ticket, idx) => (
                          <div
                            key={ticket.id || idx}
                            className="p-2 rounded-md bg-muted/30 border border-border space-y-1"
                          >
                            <div className="flex items-center justify-between">
                              <span className="font-mono font-semibold text-xs text-foreground">
                                {ticket.problemNo}
                              </span>
                              <Badge
                                variant={ticket.status === "New" ? "default" : "outline"}
                                className="text-[9px]"
                              >
                                {ticket.status}
                              </Badge>
                            </div>
                            <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                              <span>Cabang: {ticket.branchName || ticket.branchCode || branchName}</span>
                              <span>{formatWibDateTime(ticket.updatedAt)}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="p-2.5 rounded-md bg-emerald-500/10 border border-emerald-500/30 flex items-start gap-2 text-xs text-emerald-800 dark:text-emerald-300">
                      <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                      <div>
                        <strong className="block font-medium">Tidak Ada Tiket Aktif</strong>
                        <p className="text-[10px] opacity-90 mt-0.5">
                          Toko ini tidak memiliki tiket berstatus New atau Progress.
                        </p>
                      </div>
                    </div>
                  )}

                  <p className="text-[9px] text-muted-foreground italic pt-0.5">
                    * Sumber data: PostgreSQL SPARTA Maintenance (read-only).
                  </p>
                </CardContent>
              </Card>
            )}

            {/* Facility Verification Card */}
            {isFacility && (
              <Card>
                <CardContent className="p-3 text-xs space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Verifikasi Cabang:</span>
                    <Badge variant={facility?.mapping_verified_at ? "default" : "outline"} className="text-[10px]">
                      {facility?.mapping_verified_at ? "Terverifikasi" : "Belum Dipetakan"}
                    </Badge>
                  </div>
                  <Separator />
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Auto-Report Bencana:</span>
                    <span className="font-medium text-foreground">
                      {facility?.auto_report_enabled ? "Aktif" : "Nonaktif"}
                    </span>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Action Buttons */}
            <div className="pt-1 flex flex-col gap-2">
              <Link
                href={`/reports?store=${encodeURIComponent(locCode)}`}
                className={cn(buttonVariants({ variant: "default" }), "w-full text-xs h-9 justify-center gap-2")}
              >
                <FileText className="w-3.5 h-3.5" />
                <span>Lihat Riwayat & Laporan Lokasi Ini</span>
              </Link>

              <Link
                href="/reports/shared-queue"
                className={cn(buttonVariants({ variant: "outline" }), "w-full text-xs h-9 justify-center gap-2")}
              >
                <UserCheck className="w-3.5 h-3.5 text-primary" />
                <span>Periksa Penugasan Cabang</span>
              </Link>
            </div>
          </div>
        </div>
      </aside>
    </>
  );
}
