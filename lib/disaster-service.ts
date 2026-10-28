import { Earthquake, DisasterFeedResponse, SourceHealth, DataFreshness } from "@/types/disaster";
import { calculateHaversineDistance, calculateSpartaMonitoringZone } from "./haversine";
import { dbUpsertEarthquakeEvent, dbGetRecentEarthquakeEvents } from "./earthquake-db";
import { getExternalApiConfig } from "./runtime-config";

// Cache in-memory for 30 seconds
let cachedDisasters: DisasterFeedResponse | null = null;
let lastFetchTime = 0;
const CACHE_TTL_MS = 30 * 1000;

let bmkgHealth: SourceHealth = { source: "BMKG", status: "offline", lastAttemptAt: new Date().toISOString(), freshness: "unavailable" };
let usgsHealth: SourceHealth = { source: "USGS", status: "offline", lastAttemptAt: new Date().toISOString(), freshness: "unavailable" };

/**
 * Conservative thresholds for cross-provider correlation (Requirement 6)
 * BMKG = Primary source for Indonesian territorial events.
 */
export const CANONICAL_CORRELATION_THRESHOLDS = {
  // BMKG AutoGempa vs BMKG Terkini matching:
  bmkgMaxTimeDeltaMs: 90 * 1000, // 90 seconds
  bmkgMaxCoordDiffDeg: 0.15,

  // USGS vs BMKG matching (Requirement 6):
  usgsMaxTimeDeltaMinutes: 1.5,
  usgsMaxDistanceKm: 25,
  usgsMaxMagnitudeDiff: 0.3,
};

/**
 * Indonesia operational monitoring footprint (including nearby offshore
 * seismic zones). This is a coarse GEOGRAPHIC filter, not an administrative
 * country-border determination. Never allow global high-magnitude exemptions.
 */
export function isInIndonesiaMonitoringArea(latitude: number, longitude: number, place = ""): boolean {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return false;

  // Include principal island groups and adjoining offshore seismic zones.
  // Separate ranges reduce false positives from the large Southeast Asia box.
  const regions: Array<[number, number, number, number]> = [
    [-8.0, 7.0, 93.5, 107.0],   // Sumatra / Andaman-adjacent
    [-12.0, -4.5, 104.0, 119.0], // Java / Bali and southern offshore
    [-13.0, -5.0, 118.0, 126.0], // Nusa Tenggara / Timor and offshore
    [-5.5, 5.0, 108.0, 120.0],  // Kalimantan
    [-6.5, 4.0, 118.0, 126.0],  // Sulawesi and surrounding seas
    [-9.0, 5.0, 124.0, 136.0],  // Maluku / Banda Sea
    [-11.0, 2.0, 132.0, 142.0], // Papua and surrounding waters
  ];
  const inside = regions.some(([south, north, west, east]) =>
    latitude >= south && latitude <= north &&
    longitude >= west && longitude <= east
  );
  if (!inside) return false;

  // USGS 'place' is descriptive, not an official jurisdiction classification.
  // Reject explicitly foreign-labelled epicenters inside overlapping boxes.
  if (/\b(?:Philippines|Malaysia|Thailand|Singapore|Vietnam|Cambodia|Papua New Guinea|Brunei|Timor-Leste|East Timor)\b/i.test(place)) {
    return false;
  }
  return true;
}

/**
 * Generate canonical event key
 */
export function getCanonicalEventKey(source: "BMKG" | "USGS", dateTimeStr?: string, timestamp?: number): string {
  if (dateTimeStr) {
    const clean = dateTimeStr.replace(/[^a-zA-Z0-9]/g, "-").replace(/-+/g, "-").replace(/^-+|-+$/g, "");
    if (clean) return `${source.toLowerCase()}-${clean}`;
  }
  if (timestamp && Number.isFinite(timestamp) && timestamp > 0) {
    return `${source.toLowerCase()}-${timestamp}`;
  }
  throw new Error(`Cannot generate canonical event key for ${source} without valid dateTimeStr or timestamp`);
}

/**
 * Validate and parse BMKG timestamp.
 * Rejects invalid, unparseable, or far-future timestamps.
 * NEVER substitutes the current time.
 */
export function parseBmkgTimestamp(dateTimeStr?: string, tanggal?: string, jam?: string): number | null {
  if (dateTimeStr) {
    const ts = Date.parse(dateTimeStr);
    if (Number.isFinite(ts) && ts > 0) {
      if (ts > Date.now() + 15 * 60 * 1000) return null;
      return ts;
    }
  }

  if (tanggal && jam) {
    const monthMap: Record<string, string> = {
      jan: "01", feb: "02", mar: "03", apr: "04", mei: "05", jun: "06",
      jul: "07", agu: "08", agt: "08", sep: "09", okt: "10", nov: "11", des: "12",
      aug: "08", oct: "10", dec: "12",
    };
    const dateMatch = tanggal.trim().match(/^(\d{1,2})\s+([a-zA-Z]+)\s+(\d{4})/);
    const timeMatch = jam.trim().match(/^(\d{1,2}):(\d{1,2}):(\d{1,2})(?:\s*(WIB|WITA|WIT|UTC|Z))?/i);
    if (dateMatch && timeMatch) {
      const day = dateMatch[1].padStart(2, "0");
      const monthStr = dateMatch[2].toLowerCase().substring(0, 3);
      const month = monthMap[monthStr];
      const year = dateMatch[3];
      const hour = timeMatch[1].padStart(2, "0");
      const minute = timeMatch[2].padStart(2, "0");
      const second = timeMatch[3].padStart(2, "0");
      const tz = (timeMatch[4] || "WIB").toUpperCase();
      const tzOffset = tz === "WIT" ? "+09:00" : tz === "WITA" ? "+08:00" : (tz === "UTC" || tz === "Z") ? "+00:00" : "+07:00";
      if (month) {
        const iso = `${year}-${month}-${day}T${hour}:${minute}:${second}${tzOffset}`;
        const ts = Date.parse(iso);
        if (Number.isFinite(ts) && ts > 0) {
          if (ts > Date.now() + 15 * 60 * 1000) return null;
          return ts;
        }
      }
    }
  }

  return null;
}

/**
 * Validate and parse coordinates.
 * Ensures finite, within [-90, 90] & [-180, 180], and inside Indonesia monitoring footprint.
 */
export function parseBmkgCoordinates(coordStr?: string, lintang?: string, bujur?: string): { lat: number; lon: number } | null {
  let lat: number | null = null;
  let lon: number | null = null;

  if (coordStr) {
    const parts = coordStr.split(",");
    if (parts.length === 2) {
      const pLat = parseFloat(parts[0].trim());
      const pLon = parseFloat(parts[1].trim());
      if (Number.isFinite(pLat) && Number.isFinite(pLon)) {
        lat = pLat;
        lon = pLon;
      }
    }
  }

  if ((lat === null || lon === null) && lintang && bujur) {
    const latMatch = lintang.match(/(\d+(?:\.\d+)?)/);
    const lonMatch = bujur.match(/(\d+(?:\.\d+)?)/);
    if (latMatch && lonMatch) {
      const latVal = parseFloat(latMatch[1]);
      const lonVal = parseFloat(lonMatch[1]);
      if (Number.isFinite(latVal) && Number.isFinite(lonVal)) {
        lat = lintang.toLowerCase().includes("ls") ? -latVal : latVal;
        lon = bujur.toLowerCase().includes("bb") ? -lonVal : lonVal;
      }
    }
  }

  if (lat === null || lon === null) return null;

  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  if (!isInIndonesiaMonitoringArea(lat, lon)) return null;

  return { lat, lon };
}

/**
 * Validate magnitude.
 * Must be a positive finite number <= 10.0.
 */
export function parseMagnitude(magVal: unknown): number | null {
  if (magVal === undefined || magVal === null || magVal === "") return null;
  const num = typeof magVal === "number" ? magVal : parseFloat(String(magVal));
  if (!Number.isFinite(num)) return null;
  if (num <= 0 || num > 10.0) return null;
  return Math.round(num * 10) / 10;
}

/**
 * Validate and parse depth in km.
 * Must be a non-negative finite number <= 1000 km.
 */
export function parseDepthToKm(depthStr?: string | number): number | null {
  if (depthStr === undefined || depthStr === null || depthStr === "") return 10;
  if (typeof depthStr === "number") {
    if (!Number.isFinite(depthStr) || depthStr < 0 || depthStr > 1000) return null;
    return Math.round(depthStr);
  }
  const match = String(depthStr).match(/(\d+(?:\.\d+)?)/);
  if (!match) return null;
  const num = parseFloat(match[1]);
  if (!Number.isFinite(num) || num < 0 || num > 1000) return null;
  return Math.round(num);
}

/**
 * Validate and parse a raw BMKG record (autogempa, gempaterkini, or gempadirasakan).
 * Rejects invalid, incomplete, or out-of-bounds events.
 */
export function validateAndParseBmkgRecord(g: any): Earthquake | null {
  if (!g || typeof g !== "object") return null;

  const timestamp = parseBmkgTimestamp(g.DateTime, g.Tanggal, g.Jam);
  if (timestamp === null) return null;

  const coords = parseBmkgCoordinates(g.Coordinates, g.Lintang, g.Bujur);
  if (!coords) return null;

  const mag = parseMagnitude(g.Magnitude);
  if (mag === null) return null;

  const depthKm = parseDepthToKm(g.Kedalaman);
  if (depthKm === null) return null;

  const { priorityRadiusKm, monitoringRadiusKm } = calculateSpartaMonitoringZone(mag, depthKm);
  const hasTsunami = (g.Potensi || "").toLowerCase().includes("tsunami") && 
                     !(g.Potensi || "").toLowerCase().includes("tidak berpotensi");

  const canonicalId = getCanonicalEventKey("BMKG", g.DateTime, timestamp);
  const timeStr = (g.Tanggal && g.Jam)
    ? `${g.Tanggal} ${g.Jam}`
    : new Date(timestamp).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" }) + " WIB";

  return {
    id: canonicalId,
    canonicalEventKey: canonicalId,
    source: "BMKG",
    sourcePrimary: "BMKG",
    informationType: "official_event",
    verificationStatus: "official",
    title: `M ${mag} - ${g.Wilayah || "Indonesia"}`,
    place: g.Wilayah,
    magnitude: mag,
    depth: g.Kedalaman || `${depthKm} km`,
    depthKm,
    latitude: coords.lat,
    longitude: coords.lon,
    time: timeStr,
    timestamp,
    potensiTsunami: hasTsunami,
    potensiText: g.Potensi || (hasTsunami ? "Berpotensi Tsunami" : undefined),
    feltArea: g.Dirasakan || undefined,
    felt: g.Dirasakan || undefined,
    shakemapUrl: g.Shakemap
      ? `${getExternalApiConfig().bmkg.shakemapBaseUrl.replace(/\/$/, "")}/${g.Shakemap}`
      : undefined,
    isSignificant: mag >= 5.5,
    priorityRadiusKm,
    monitoringRadiusKm,
  };
}

/**
 * Validate and parse a raw USGS GeoJSON feature.
 * Rejects invalid coordinates, non-Indonesian regions, or corrupt fields.
 */
export function validateAndParseUsgsFeature(feat: any): Earthquake | null {
  if (!feat || !feat.geometry || !Array.isArray(feat.geometry.coordinates)) return null;
  const [lon, lat, rawDepth] = feat.geometry.coordinates;

  if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    return null;
  }

  const place = feat.properties?.place || "";
  if (!isInIndonesiaMonitoringArea(lat, lon, place)) {
    return null;
  }

  const mag = parseMagnitude(feat.properties?.mag);
  if (mag === null) return null;

  const depthKm = parseDepthToKm(rawDepth);
  if (depthKm === null) return null;

  const usgsTimestamp = feat.properties?.time;
  if (!Number.isFinite(usgsTimestamp) || usgsTimestamp <= 0 || usgsTimestamp > Date.now() + 15 * 60 * 1000) {
    return null;
  }

  const featId = feat.id || feat.properties?.code;
  if (!featId) return null;

  const { priorityRadiusKm, monitoringRadiusKm } = calculateSpartaMonitoringZone(mag, depthKm);
  const isTsunami = feat.properties?.tsunami === 1;
  const canonicalId = `usgs-${featId}`;

  return {
    id: canonicalId,
    canonicalEventKey: canonicalId,
    source: "USGS",
    sourcePrimary: "USGS",
    informationType: "official_event",
    verificationStatus: "official_external",
    title: feat.properties?.title || `M ${mag} - ${place || "Indonesia"}`,
    place,
    magnitude: mag,
    depth: `${depthKm} km`,
    depthKm,
    latitude: lat,
    longitude: lon,
    time: new Date(usgsTimestamp).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" }) + " WIB",
    timestamp: usgsTimestamp,
    potensiTsunami: isTsunami,
    potensiText: isTsunami ? "Peringatan Tsunami Global Aktif" : undefined,
    isSignificant: mag >= 6.0,
    priorityRadiusKm,
    monitoringRadiusKm,
  };
}

/**
 * Correlate raw/recent earthquakes from multi-provider feeds into canonical events (Requirement 6)
 */
export function correlateEarthquakes(rawList: Earthquake[]): Earthquake[] {
  const canonicalList: Earthquake[] = [];

  for (const eq of rawList) {
    const match = canonicalList.find((existing) => {
      // 1. Same canonical key
      if (eq.canonicalEventKey && existing.canonicalEventKey && eq.canonicalEventKey === existing.canonicalEventKey) {
        return true;
      }
      // Provider-specific IDs are authoritative within one provider. Nearby
      // same-provider events may be aftershocks and must remain independent.
      if (eq.source === existing.source) return false;

      // Cross-provider matching is deliberately narrow. A wider operational
      // window is useful for review, but is not sufficient evidence to merge.
      const isCrossProvider =
        (eq.source === "USGS" && existing.source === "BMKG") ||
        (eq.source === "BMKG" && existing.source === "USGS");
      if (isCrossProvider) {
        const timeDeltaMin = Math.abs(eq.timestamp - existing.timestamp) / (60 * 1000);
        if (timeDeltaMin <= CANONICAL_CORRELATION_THRESHOLDS.usgsMaxTimeDeltaMinutes) {
          const distKm = calculateHaversineDistance(eq.latitude, eq.longitude, existing.latitude, existing.longitude);
          const magDiff = Math.abs(eq.magnitude - existing.magnitude);
          if (
            distKm <= CANONICAL_CORRELATION_THRESHOLDS.usgsMaxDistanceKm &&
            magDiff <= CANONICAL_CORRELATION_THRESHOLDS.usgsMaxMagnitudeDiff
          ) {
            return true;
          }
        }
      }
      return false;
    });

    if (match) {
      if (match.source !== "BMKG" && eq.source === "BMKG") {
        const idx = canonicalList.indexOf(match);
        canonicalList[idx] = {
          ...eq,
          feltArea: eq.feltArea || match.feltArea,
          felt: eq.felt || match.felt,
          shakemapUrl: eq.shakemapUrl || match.shakemapUrl,
          potensiText: eq.potensiText || match.potensiText,
        };
      } else {
        if (!match.shakemapUrl && eq.shakemapUrl) match.shakemapUrl = eq.shakemapUrl;
        if (!match.feltArea && eq.feltArea) match.feltArea = eq.feltArea;
        if (!match.felt && eq.felt) match.felt = eq.felt;
        if (!match.potensiText && eq.potensiText) match.potensiText = eq.potensiText;
        if (eq.potensiTsunami && !match.potensiTsunami) match.potensiTsunami = true;
      }
    } else {
      canonicalList.push(eq);
    }
  }

  return canonicalList;
}

export const correlateDisasters = correlateEarthquakes;

export async function fetchDisasterFeed(forceRefresh: boolean = false): Promise<DisasterFeedResponse> {
  const now = Date.now();
  if (!forceRefresh && cachedDisasters && now - lastFetchTime < CACHE_TTL_MS) {
    return cachedDisasters;
  }

  const earthquakes: Earthquake[] = [];
  let latestBmkgEarthquake: Earthquake | undefined;
  let bmkgSuccessCount = 0;

  bmkgHealth.lastAttemptAt = new Date().toISOString();

  // Helper to upsert BMKG earthquake with enrichment across feeds
  const upsertBmkgEarthquake = (eq: Earthquake) => {
    const existing = earthquakes.find((e) => {
      if (e.id === eq.id || (e.canonicalEventKey && eq.canonicalEventKey && e.canonicalEventKey === eq.canonicalEventKey)) {
        return true;
      }
      const timeDelta = Math.abs(e.timestamp - eq.timestamp);
      const latDelta = Math.abs(e.latitude - eq.latitude);
      const lonDelta = Math.abs(e.longitude - eq.longitude);
      return (
        timeDelta <= CANONICAL_CORRELATION_THRESHOLDS.bmkgMaxTimeDeltaMs &&
        latDelta <= CANONICAL_CORRELATION_THRESHOLDS.bmkgMaxCoordDiffDeg &&
        lonDelta <= CANONICAL_CORRELATION_THRESHOLDS.bmkgMaxCoordDiffDeg
      );
    });

    if (existing) {
      if (!existing.potensiText && eq.potensiText) existing.potensiText = eq.potensiText;
      if (!existing.potensiTsunami && eq.potensiTsunami) existing.potensiTsunami = true;
      if (!existing.feltArea && eq.feltArea) {
        existing.feltArea = eq.feltArea;
        existing.felt = eq.felt;
      }
      if (!existing.shakemapUrl && eq.shakemapUrl) existing.shakemapUrl = eq.shakemapUrl;
      return existing;
    } else {
      earthquakes.push(eq);
      return eq;
    }
  };

  const apiConfig = getExternalApiConfig();

  // 1. Fetch BMKG AutoGempa (Gempa M5.0+ terbaru / berpotensi tsunami)
  try {
    const bmkgAutoRes = await fetch(apiConfig.bmkg.autogempaUrl, {
      next: { revalidate: 30 },
      headers: { "User-Agent": "SpartaSiaga/1.0" },
    });

    if (bmkgAutoRes.ok) {
      const data = await bmkgAutoRes.json();
      const parsed = validateAndParseBmkgRecord(data?.Infogempa?.gempa);
      if (parsed) {
        latestBmkgEarthquake = upsertBmkgEarthquake(parsed);
        bmkgSuccessCount++;
      }
    }
  } catch (err: any) {
    console.error("[Disaster Service] Error fetching BMKG autogempa:", err);
  }

  // 2. Fetch BMKG 15 Gempa Terkini (M >= 5.0)
  try {
    const bmkgListRes = await fetch(apiConfig.bmkg.gempaterkiniUrl, {
      next: { revalidate: 60 },
      headers: { "User-Agent": "SpartaSiaga/1.0" },
    });

    if (bmkgListRes.ok) {
      const listData = await bmkgListRes.json();
      const list = listData?.Infogempa?.gempa;
      if (Array.isArray(list)) {
        let validInList = 0;
        for (const item of list) {
          const parsed = validateAndParseBmkgRecord(item);
          if (parsed) {
            upsertBmkgEarthquake(parsed);
            validInList++;
          }
        }
        if (validInList > 0) bmkgSuccessCount++;
      }
    }
  } catch (err) {
    console.error("[Disaster Service] Error fetching BMKG gempaterkini:", err);
  }

  // 3. Fetch BMKG 15 Gempa Dirasakan (Includes smaller felt earthquakes M < 5.0)
  try {
    const bmkgFeltRes = await fetch(apiConfig.bmkg.gempadirasakanUrl, {
      next: { revalidate: 60 },
      headers: { "User-Agent": "SpartaSiaga/1.0" },
    });

    if (bmkgFeltRes.ok) {
      const feltData = await bmkgFeltRes.json();
      const list = feltData?.Infogempa?.gempa;
      if (Array.isArray(list)) {
        let validInFelt = 0;
        for (const item of list) {
          const parsed = validateAndParseBmkgRecord(item);
          if (parsed) {
            upsertBmkgEarthquake(parsed);
            validInFelt++;
          }
        }
        if (validInFelt > 0) bmkgSuccessCount++;
      }
    }
  } catch (err) {
    console.error("[Disaster Service] Error fetching BMKG gempadirasakan:", err);
  }

  // Update BMKG Health based on all sub-feeds
  if (bmkgSuccessCount > 0) {
    bmkgHealth.status = "healthy";
    bmkgHealth.lastSuccessAt = new Date().toISOString();
    bmkgHealth.freshness = "live";
    bmkgHealth.error = undefined;
  } else {
    bmkgHealth.status = "degraded";
    bmkgHealth.error = "All BMKG feeds failed or empty";
    bmkgHealth.freshness = cachedDisasters ? "stale" : "unavailable";
  }

  usgsHealth.lastAttemptAt = new Date().toISOString();

  // 4. Fetch USGS Real-time Feed (M4.5+ in the past 7 days to cover full 72h window)
  try {
    const usgsRes = await fetch(
      apiConfig.usgs.earthquakeFeedUrl,
      {
        next: { revalidate: 60 },
        headers: { "User-Agent": "SpartaSiaga/1.0" },
      }
    );

    if (usgsRes.ok) {
      const geojson = await usgsRes.json();
      const features = geojson?.features || [];

      for (const feat of features) {
        const parsed = validateAndParseUsgsFeature(feat);
        if (!parsed) continue;

        // CANONICAL CORRELATION: USGS vs BMKG (Requirement 6)
        const matchingBmkg = earthquakes.find((e) => {
          if (e.source !== "BMKG") return false;
          const timeDeltaMin = Math.abs(e.timestamp - parsed.timestamp) / (60 * 1000);
          if (timeDeltaMin > CANONICAL_CORRELATION_THRESHOLDS.usgsMaxTimeDeltaMinutes) return false;

          const distKm = calculateHaversineDistance(parsed.latitude, parsed.longitude, e.latitude, e.longitude);
          if (distKm > CANONICAL_CORRELATION_THRESHOLDS.usgsMaxDistanceKm) return false;

          const magDiff = Math.abs(e.magnitude - parsed.magnitude);
          if (magDiff > CANONICAL_CORRELATION_THRESHOLDS.usgsMaxMagnitudeDiff) return false;

          return true;
        });

        if (matchingBmkg) {
          // Strong match -> Associate to canonical BMKG event, do not create duplicate
          matchingBmkg.verificationStatus = "official";
        } else {
          // Ambiguous or independent event -> Keep separate
          if (!earthquakes.some((e) => e.id === parsed.id)) {
            earthquakes.push(parsed);
          }
        }
      }
      usgsHealth.status = "healthy";
      usgsHealth.lastSuccessAt = new Date().toISOString();
      usgsHealth.freshness = "live";
      usgsHealth.error = undefined;
    } else {
      usgsHealth.status = "degraded";
      usgsHealth.error = "Non-200 response";
      usgsHealth.freshness = cachedDisasters ? "stale" : "unavailable";
    }
  } catch (err: any) {
    console.error("[Disaster Service] Error fetching USGS feed:", err);
    usgsHealth.status = "degraded";
    usgsHealth.error = err.message || "Fetch failed";
    usgsHealth.freshness = cachedDisasters ? "stale" : "unavailable";
  }

  // 5. Merge persistent historical earthquakes from database (ensures past 72h events are preserved)
  try {
    const dbEvents = await dbGetRecentEarthquakeEvents(72);
    for (const dbe of dbEvents) {
      if (!earthquakes.some((e) => e.id === dbe.id)) {
        earthquakes.push(dbe);
      }
    }
  } catch (dbErr) {
    console.warn("[Disaster Service] Warning merging DB earthquake events:", dbErr);
  }

  // Canonical deduplication and correlation
  const canonicalEarthquakes = correlateEarthquakes(earthquakes);

  // Sort earthquakes by timestamp descending
  canonicalEarthquakes.sort((a, b) => b.timestamp - a.timestamp);

  // Requirement 4: Persist all processed earthquakes to persistent table asynchronously
  for (const eq of canonicalEarthquakes) {
    dbUpsertEarthquakeEvent(eq).catch((err) =>
      console.warn("[Disaster Service] Warning persisting earthquake:", err)
    );
  }

  if (canonicalEarthquakes.length === 0) {
    if (cachedDisasters && cachedDisasters.recentEarthquakes.length > 0) {
      console.log("[Disaster Service] Providers degraded. Using stale cache as last-known-good.");
      bmkgHealth.freshness = "stale";
      usgsHealth.freshness = "stale";
      return {
        ...cachedDisasters,
        dataFreshness: "stale",
        sourcesHealth: [bmkgHealth, usgsHealth],
      };
    } else {
      console.log("[Disaster Service] Providers offline. No cache available.");
      bmkgHealth.freshness = "unavailable";
      usgsHealth.freshness = "unavailable";
      return {
        latestBmkgEarthquake: undefined,
        recentEarthquakes: [],
        activeEarthquakes: [],
        lastUpdated: new Date().toISOString(),
        totalActive: 0,
        dataFreshness: "unavailable",
        sourcesHealth: [bmkgHealth, usgsHealth],
      };
    }
  }

  // Filter active earthquakes: Max 72 hours window for active map monitoring (Requirement 2 & 3)
  const activeWindowMs = 72 * 60 * 60 * 1000; // 72 hours
  const activeEarthquakes = canonicalEarthquakes.filter((eq) => now - eq.timestamp <= activeWindowMs);

  const response: DisasterFeedResponse = {
    latestBmkgEarthquake: latestBmkgEarthquake || canonicalEarthquakes.find((e) => e.source === "BMKG") || canonicalEarthquakes[0],
    recentEarthquakes: canonicalEarthquakes, // all historical/provider context
    activeEarthquakes, // strictly <= 72 hours for operational map and auto-reports
    lastUpdated: new Date().toISOString(),
    totalActive: activeEarthquakes.length,
    dataFreshness: (bmkgHealth.status === "healthy" || usgsHealth.status === "healthy") ? "fresh" : "stale",
    sourcesHealth: [bmkgHealth, usgsHealth],
  };

  cachedDisasters = response;
  lastFetchTime = now;

  return response;
}
