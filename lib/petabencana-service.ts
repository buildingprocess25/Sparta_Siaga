import { SourceHealth } from "@/types/disaster";
import { getExternalApiConfig } from "./runtime-config";

export interface PetabencanaReport {
  id: string;
  lat: number;
  lng: number;
  title: string;
  depth?: number | null;
  imageUrl?: string;
  timestamp: string;
  source: string;
  locationName?: string;
  description?: string;
  verificationStatus?: string;
  geometryType: "Point" | "Polygon";
  polygonCoordinates?: [number, number][];
}

export interface PetabencanaResult {
  reports: PetabencanaReport[];
  health: SourceHealth;
}

function parseGeometryItem(item: any): PetabencanaReport | null {
  const props = item.properties || {};
  if (props.disaster_type && props.disaster_type !== "flood") {
    return null;
  }

  const rawId = String(props.pkey || props.id || "");
  if (!rawId) return null;

  let lat = 0;
  let lng = 0;
  let geometryType: "Point" | "Polygon" = "Point";
  let polygonCoordinates: [number, number][] | undefined = undefined;

  const geomType = item.type || item.geometry?.type || "Point";

  if (geomType === "Point") {
    const rawCoords = item.coordinates || item.geometry?.coordinates;
    if (!Array.isArray(rawCoords) || rawCoords.length < 2) return null;

    let c0 = Number(rawCoords[0]);
    let c1 = Number(rawCoords[1]);
    if (isNaN(c0) || isNaN(c1)) return null;

    // GeoJSON standard: [lng, lat]
    // Indonesia bounds: lat [-12, 7], lng [94, 142]
    if (c0 >= -15 && c0 <= 15 && c1 >= 90 && c1 <= 150) {
      // Coordinates were reversed [lat, lng]
      lat = c0;
      lng = c1;
    } else {
      lng = c0;
      lat = c1;
    }

    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  } else if (geomType === "Polygon" || geomType === "MultiPolygon") {
    geometryType = "Polygon";
    const rings = geomType === "Polygon"
      ? (item.coordinates || item.geometry?.coordinates || [])[0]
      : (item.coordinates || item.geometry?.coordinates || [])[0]?.[0];

    if (Array.isArray(rings) && rings.length >= 3) {
      polygonCoordinates = rings.map((pt: any) => {
        const c0 = Number(pt[0]);
        const c1 = Number(pt[1]);
        if (c0 >= -15 && c0 <= 15 && c1 >= 90 && c1 <= 150) {
          return [c0, c1] as [number, number];
        }
        return [c1, c0] as [number, number];
      });

      // Centroid approximation
      lat = polygonCoordinates.reduce((acc, c) => acc + c[0], 0) / polygonCoordinates.length;
      lng = polygonCoordinates.reduce((acc, c) => acc + c[1], 0) / polygonCoordinates.length;
    } else {
      return null;
    }
  } else {
    return null;
  }

  const cityName = props.tags?.city || props.tags?.instance_region_code || undefined;
  const description = typeof props.text === "string" && props.text.trim().length > 0 ? props.text.trim() : undefined;
  const imageUrl = typeof props.image_url === "string" && props.image_url.startsWith("http") ? props.image_url : undefined;

  let verificationStatus: string | undefined = undefined;
  if (props.status === "confirmed") {
    verificationStatus = "Laporan Terverifikasi";
  } else if (typeof props.status === "string" && props.status.trim().length > 0) {
    verificationStatus = `Status: ${props.status.trim()}`;
  }

  const rawDepth = props.report_data?.flood_depth;
  const depth = typeof rawDepth === "number" ? rawDepth : (rawDepth ? Number(rawDepth) : null);

  return {
    id: rawId,
    lat,
    lng,
    title: props.title || (cityName ? `Laporan Banjir di ${cityName}` : "Laporan Banjir Lapangan (PetaBencana)"),
    depth: isNaN(depth as any) ? null : depth,
    imageUrl,
    timestamp: props.created_at || new Date().toISOString(),
    source: "PetaBencana",
    locationName: cityName,
    description,
    verificationStatus,
    geometryType,
    polygonCoordinates,
  };
}

export async function fetchPetabencanaReports(): Promise<PetabencanaResult> {
  const now = new Date().toISOString();
  try {
    // Try 48-hour window first; if low count, fallback to 7 days for stable monitoring
    const apiConfig = getExternalApiConfig();
    const reportsBaseUrl = apiConfig.petaBencana.reportsUrl.replace(/\/$/, "");
    const urls = [
      `${reportsBaseUrl}?timeperiod=172800`,
      `${reportsBaseUrl}?timeperiod=604800`,
      reportsBaseUrl,
    ];

    let items: any[] = [];

    for (const url of urls) {
      try {
        const res = await fetch(url, {
          next: { revalidate: 300 },
          headers: { Accept: "application/json" },
        });

        if (res.ok) {
          const data = await res.json();
          const geoms = data?.result?.objects?.output?.geometries || data?.result?.features || [];
          if (Array.isArray(geoms) && geoms.length > 0) {
            items = geoms;
            break;
          }
        }
      } catch {
        // try next URL
      }
    }

    const reports: PetabencanaReport[] = [];
    for (const item of items) {
      const parsed = parseGeometryItem(item);
      if (parsed) reports.push(parsed);
    }

    return {
      reports,
      health: {
        source: "PetaBencana",
        status: "healthy",
        freshness: "live",
        lastAttemptAt: now,
        lastSuccessAt: now,
      },
    };
  } catch (error: any) {
    console.error("Petabencana fetch failed", error);
    return {
      reports: [],
      health: {
        source: "PetaBencana",
        status: "offline",
        freshness: "unavailable",
        lastAttemptAt: now,
        error: error.message || "Fetch failed",
      },
    };
  }
}
