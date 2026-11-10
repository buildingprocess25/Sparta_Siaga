"use client";

import React from "react";
import dynamic from "next/dynamic";
import { Store, SpatialRisk } from "@/types/store";
import { Earthquake } from "@/types/disaster";
import { Loader2 } from "lucide-react";

const MapInner = dynamic(() => import("./map-inner"), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full flex flex-col items-center justify-center bg-slate-950 text-slate-400 gap-3">
      <Loader2 className="w-8 h-8 animate-spin text-red-500" />
      <p className="text-xs font-medium tracking-wide">
        Memuat Peta Spasial SPARTA Siaga...
      </p>
    </div>
  ),
});

interface MapViewProps {
  stores: Store[];
  locationMode?: "event" | "store" | "dc";
  earthquakes: Earthquake[];
  floodReports?: any[];
  basemap: "esri-dark" | "esri-light" | "osm";
  incidentOnly: boolean;
  statusFilter: "all" | SpatialRisk;
  selectedStore: Store | null;
  onSelectStore: (store: Store) => void;
  flyToTarget: { lat: number; lng: number; zoom?: number } | null;
  showRadar?: boolean;
  radarTileUrl?: string;
  activeLayer?: "all" | "earthquake" | "stores" | "weather" | "flood";
  theme?: "dark" | "light";
  onViewportChange?: (bounds: { north: number; south: number; east: number; west: number }) => void;
  selectedEarthquakeId?: string | null;
}

export function MapView(props: MapViewProps) {
  return (
    <div className="w-full h-full relative overflow-hidden">
      <MapInner {...props} />
    </div>
  );
}
