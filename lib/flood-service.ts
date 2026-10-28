import { DataFreshness } from "@/types/disaster";
import { getExternalApiConfig } from "./runtime-config";

export interface StoreFloodInfo {
  riskLevel: "normal" | "waspada" | "siaga" | "bahaya" | "unknown";
  waterLevelCm?: number;
  riverDischarge?: number;
  dischargeUnit?: "m3/s";
  nearbyReportCount: number;
  description: string;
  source: string;
  freshness: DataFreshness;
}

const floodCache = new Map<string, { data: StoreFloodInfo; timestamp: number }>();
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours for GloFAS hydrological model

export async function fetchStoreFloodRisk(lat: number, lng: number): Promise<StoreFloodInfo> {
  const cacheKey = `${lat.toFixed(3)},${lng.toFixed(3)}`;
  const cached = floodCache.get(cacheKey);

  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.data;
  }

  try {
    // Queries Open-Meteo Flood API (Copernicus GloFAS model)
    const apiConfig = getExternalApiConfig();
    const url = `${apiConfig.openMeteo.floodUrl}?latitude=${lat}&longitude=${lng}&daily=river_discharge&forecast_days=3`;
    const res = await fetch(url, { next: { revalidate: 900 } });

    if (!res.ok) {
      throw new Error(`Flood API error: ${res.status}`);
    }

    const data = await res.json();
    const discharge = data.daily?.river_discharge?.[0] ?? 0;

    let riskLevel: "normal" | "waspada" | "siaga" | "bahaya" = "normal";
    let description = "Tidak terdeteksi luapan sungai yang signifikan.";

    if (discharge > 800) {
      riskLevel = "bahaya";
      description = "Debit sungai kritis! Potensi luapan tinggi di sekitar gerai.";
    } else if (discharge > 400) {
      riskLevel = "siaga";
      description = "Peringatan Siaga: Debit aliran air meningkat di saluran drainase utama.";
    } else if (discharge > 150) {
      riskLevel = "waspada";
      description = "Waspada: Curah hujan hulu tinggi, pantau saluran air depan toko.";
    }

    const result: StoreFloodInfo = {
      riskLevel,
      waterLevelCm: undefined,
      riverDischarge: discharge,
      dischargeUnit: "m3/s",
      nearbyReportCount: riskLevel !== "normal" ? 1 : 0,
      description,
      source: "Copernicus GloFAS",
      freshness: "fresh",
    };

    floodCache.set(cacheKey, { data: result, timestamp: Date.now() });
    return result;
  } catch {
    const fallback: StoreFloodInfo = {
      riskLevel: "unknown",
      waterLevelCm: undefined,
      nearbyReportCount: 0,
      description: "Data risiko banjir sementara tidak tersedia. Status risiko belum dapat ditentukan.",
      source: "Copernicus GloFAS",
      freshness: "unavailable",
    };
    return fallback;
  }
}
