import { Earthquake } from "./disaster";

export type SpatialRisk = "SAFE" | "MONITOR" | "PRIORITY_MONITOR" | "UNASSESSED";
export type StoreStatus = SpatialRisk; // Backward compatibility alias

export type OperationalStatus =
  | "NONE"
  | "NEED_CONFIRMATION"
  | "CONFIRMED_AFFECTED"
  | "ESTIMATION"
  | "READY_FOR_WORK"
  | "IN_PROGRESS"
  | "WORK_COMPLETED"
  | "RESOLVED";

export type MapVisualStatus =
  | "NORMAL"
  | "PERLU_PERHATIAN"
  | "TERDAMPAK"
  | "DALAM_PENANGANAN"
  | "SELESAI";

export interface Store {
  id: string;
  kode_toko: string;
  nama_toko: string;
  cabang: string;
  alamat: string;
  latitude: number;
  longitude: number;
  fr_type?: "R" | "F" | string; // Franchise or Regular
  branch_emergency_contact?: string; // Duty officer / DC hotline

  // Dimension 1: Spatial Risk
  status?: StoreStatus;
  spatialRisk?: SpatialRisk;
  isInsideV1?: boolean;
  officialMmi?: number | null;
  intensityStatus?: "INTENSITY_TRIGGERED" | "BELOW_INSPECTION_THRESHOLD" | "UNASSESSED";
  assessmentNote?: string;

  // Dimension 2: Operational Status
  operationalStatus?: OperationalStatus;
  activeReportId?: string;
  activeReportProgress?: number;

  // Final Derived Map Visual Status
  visualStatus?: MapVisualStatus;

  // Causative Risk Source
  distanceFromDisasterKm?: number;
  riskSourceEvent?: Earthquake;
  nearestDisasterTitle?: string;
  nearestDisasterMag?: number;
  nearestDisasterDepth?: string;

  floodWarning?: boolean;
  rainIntensityMm?: number;
  weatherSummary?: string;
}

export interface StoreFilterState {
  searchQuery: string;
  selectedBranch: string;
  statusFilter: "all" | StoreStatus;
  incidentOnly: boolean;
}
