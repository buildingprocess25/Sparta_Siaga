"use client";

import React, { createContext, useContext } from "react";
import { Store, StoreStatus } from "@/types/store";
import { Earthquake, DisasterFeedResponse } from "@/types/disaster";
import { RoleType, IncidentRecord } from "@/types/incident";

export interface SiagaContextType {
  rawStores: Store[];
  computedStores: Store[];
  disasterData: DisasterFeedResponse | null;
  loading: boolean;
  isRefreshing: boolean;
  activeRole: RoleType;
  setActiveRole: (role: RoleType) => void;
  activeLayer: "all" | "earthquake" | "stores" | "weather" | "flood" | "aho";
  setActiveLayer: (layer: "all" | "earthquake" | "stores" | "weather" | "flood" | "aho") => void;
  incidents: IncidentRecord[];
  activeIncidents: IncidentRecord[];
  archivedIncidents: IncidentRecord[];
  incidentStats: any;
  handleUpdateIncidents: (inc: IncidentRecord[]) => void;
  handleSelectIncidentForDetail: (inc: IncidentRecord) => void;
  refreshIncidents: () => Promise<void>;
  handleOpenReportModal: (storeId?: string, incId?: string, reportOrigin?: "manual" | "automatic_earthquake") => void;
  incidentOnly: boolean;
  setIncidentOnly: React.Dispatch<React.SetStateAction<boolean>>;
  statusFilter: "all" | StoreStatus;
  setStatusFilter: React.Dispatch<React.SetStateAction<"all" | StoreStatus>>;
  basemap: "esri-dark" | "esri-light" | "osm";
  setBasemap: React.Dispatch<React.SetStateAction<"esri-dark" | "esri-light" | "osm">>;
  theme: "dark" | "light";
  handleToggleTheme: () => void;
  showRadar: boolean;
  setShowRadar: React.Dispatch<React.SetStateAction<boolean>>;
  radarData: { tileUrl: string; timeFormatted: string } | null;
  selectedStore: Store | null;
  setSelectedStore: (s: Store | null) => void;
  handleSelectStore: (s: Store | null) => void;
  flyToTarget: { lat: number; lng: number; zoom?: number } | null;
  setFlyToTarget: (target: { lat: number; lng: number; zoom?: number } | null) => void;
  dangerCount: number;
  warningCount: number;
  handleResetView: () => void;
  handleFocusDisaster: (eqOrLat: Earthquake | number, maybeLng?: number) => void;
  selectedCategory: string | null;
  setSelectedCategory: (cat: string | null) => void;
  setIsAffectedSheetOpen: (open: boolean) => void;

  // Requirement 3: Map Time Filter (24 Jam vs 3 Hari)
  mapTimeFilter: "24h" | "3d";
  setMapTimeFilter: (filter: "24h" | "3d") => void;

  // Requirement 7: True Event Focus Mode
  selectedEarthquake: Earthquake | null;
  setSelectedEarthquake: (eq: Earthquake | null) => void;
  clearEventFocus: () => void;
}

const SiagaContext = createContext<SiagaContextType | null>(null);

export function useSiaga() {
  const ctx = useContext(SiagaContext);
  if (!ctx) throw new Error("useSiaga must be used within SiagaProvider");
  return ctx;
}

export function SiagaProvider({
  children,
  value,
}: {
  children: React.ReactNode;
  value: SiagaContextType;
}) {
  return <SiagaContext.Provider value={value}>{children}</SiagaContext.Provider>;
}
