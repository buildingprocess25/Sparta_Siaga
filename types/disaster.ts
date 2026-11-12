import type { V1CoverageResult } from "@/lib/earthquake-v1-parameters";

export type DataFreshness = "live" | "fresh" | "stale" | "unavailable";

export type InformationType =
  | "official_alert"
  | "official_event"
  | "observation"
  | "forecast"
  | "field_report"
  | "model";

export type VerificationStatus =
  | "unverified"
  | "system_detected"
  | "corroborated"
  | "official"
  | "official_external"
  | "community_report"
  | "field_confirmed";

export interface SourceHealth {
  source: string;
  status: "healthy" | "degraded" | "offline";
  lastSuccessAt?: string;
  lastAttemptAt: string;
  error?: string;
  freshness: DataFreshness;
}

export interface Earthquake {
  id: string;
  source: string;
  sourcePrimary?: string;
  canonicalEventKey?: string;
  informationType?: InformationType;
  verificationStatus?: VerificationStatus;
  title: string;
  place?: string;
  magnitude: number;
  depth: string; // e.g. "10 km"
  depthKm: number;
  latitude: number;
  longitude: number;
  time: string; // ISO or human readable
  date?: string;
  timestamp: number;
  potensiTsunami: boolean;
  potensiText?: string;
  feltArea?: string;
  felt?: string;
  shakemapUrl?: string;
  isSignificant?: boolean;
  priorityRadiusKm?: number | null; // Operational V1 parameter search radius (legacy-compatible)
  monitoringRadiusKm?: number | null; // Legacy monitoring zone field (omitted/null under V1)
  v1DistanceKm?: number | null; // Agreed supervisor V1 search distance (null when not covered or M < 4.0)
  v1Coverage?: V1CoverageResult;
}

export interface DisasterFeedResponse {
  latestBmkgEarthquake?: Earthquake;
  recentEarthquakes: Earthquake[];
  activeEarthquakes: Earthquake[];
  lastUpdated: string;
  totalActive: number;
  floodReports?: any[];
  dataFreshness?: DataFreshness;
  sourcesHealth?: SourceHealth[];
}
