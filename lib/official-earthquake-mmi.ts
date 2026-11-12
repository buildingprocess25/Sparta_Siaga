import { calculateHaversineDistance } from "./haversine";
import { CANONICAL_CORRELATION_THRESHOLDS } from "./disaster-service";
import { parseShakeMapCovJson, type ShakeMapGrid } from "./earthquake-intensity-service";

interface EarthquakeOrigin {
  id: string;
  source?: string;
  magnitude: number;
  latitude: number;
  longitude: number;
  occurredAt?: Date | string | number;
  timestamp?: number;
}

function matchesOrigin(feature: any, earthquake: EarthquakeOrigin): boolean {
  const time = new Date(earthquake.occurredAt ?? earthquake.timestamp ?? NaN).getTime();
  const coordinates = feature?.geometry?.coordinates;
  const p = feature?.properties;
  if (!Array.isArray(coordinates) || !Number.isFinite(time) || !Number.isFinite(p?.time) || !Number.isFinite(p?.mag)) return false;
  if (p.type && p.type !== "earthquake") return false;
  return Math.abs(p.time - time) <= CANONICAL_CORRELATION_THRESHOLDS.usgsMaxTimeDeltaMinutes * 60_000
    && Math.abs(p.mag - earthquake.magnitude) <= CANONICAL_CORRELATION_THRESHOLDS.usgsMaxMagnitudeDiff
    && calculateHaversineDistance(earthquake.latitude, earthquake.longitude, coordinates[1], coordinates[0]) <= CANONICAL_CORRELATION_THRESHOLDS.usgsMaxDistanceKm;
}

function officialUsgsUrl(value: unknown): URL {
  const url = new URL(String(value));
  if (url.protocol !== "https:" || !(url.hostname === "earthquake.usgs.gov" || url.hostname.endsWith(".usgs.gov"))) {
    throw new Error("Untrusted USGS product URL");
  }
  return url;
}

export async function fetchOfficialMmiForEarthquake(
  earthquake: EarthquakeOrigin,
  fetcher: typeof fetch = fetch
): Promise<{ provider: "USGS"; grid: ShakeMapGrid; versionNumber: number } | null> {
  const time = new Date(earthquake.occurredAt ?? earthquake.timestamp ?? NaN).getTime();
  if (!Number.isFinite(time)) return null;
  const readJson = async (url: URL) => {
    const response = await fetcher(url, { signal: AbortSignal.timeout(10_000), redirect: "error" });
    if (!response.ok) throw new Error(`Official MMI HTTP ${response.status}`);
    return response.json();
  };
  try {
    let detail: any;
    if (earthquake.source?.toUpperCase() === "USGS" && /^usgs-[a-z0-9]+$/i.test(earthquake.id)) {
      detail = await readJson(new URL(`https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&eventid=${encodeURIComponent(earthquake.id.slice(5))}`));
    } else {
      const url = new URL("https://earthquake.usgs.gov/fdsnws/event/1/query");
      const seconds = CANONICAL_CORRELATION_THRESHOLDS.usgsMaxTimeDeltaMinutes * 60_000;
      const query = {
        format: "geojson", starttime: new Date(time - seconds).toISOString(),
        endtime: new Date(time + seconds).toISOString(),
        latitude: String(earthquake.latitude), longitude: String(earthquake.longitude),
        maxradiuskm: String(CANONICAL_CORRELATION_THRESHOLDS.usgsMaxDistanceKm),
        minmagnitude: String(earthquake.magnitude - CANONICAL_CORRELATION_THRESHOLDS.usgsMaxMagnitudeDiff),
        maxmagnitude: String(earthquake.magnitude + CANONICAL_CORRELATION_THRESHOLDS.usgsMaxMagnitudeDiff),
        eventtype: "earthquake", limit: "10",
      };
      for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
      const catalog = await readJson(url);
      const matches = (catalog.features ?? []).filter((feature: any) => matchesOrigin(feature, earthquake));
      // An ambiguous association must not assign an aftershock's intensity to the main event.
      if (matches.length !== 1) return null;
      detail = await readJson(officialUsgsUrl(matches[0].properties.detail));
    }
    if (!matchesOrigin(detail, earthquake)) return null;
    const products = (detail.properties?.products?.shakemap ?? []).filter((p: any) => p.status !== "DELETE");
    products.sort((a: any, b: any) => Number(b.preferredWeight ?? 0) - Number(a.preferredWeight ?? 0) || Number(b.updateTime ?? 0) - Number(a.updateTime ?? 0));
    const product = products[0];
    const productUrl = product?.contents?.["download/coverage_mmi_high_res.covjson"]?.url
      ?? product?.contents?.["download/coverage_mmi.covjson"]?.url;
    if (!productUrl) return null;
    const url = officialUsgsUrl(productUrl);
    const payload = await readJson(url);
    const versionNumber = Math.max(1, Math.floor(Number(product.updateTime) / 1000));
    if (!Number.isSafeInteger(versionNumber) || versionNumber > 2147483647) return null;
    const raw = {
      ...payload,
      spartaProvenance: {
        canonicalEventId: earthquake.id, providerEventId: detail.id,
        sourceUrl: url.href, productUpdatedAt: new Date(product.updateTime).toISOString(),
        provider: "USGS",
      },
    };
    return {
      provider: "USGS", versionNumber,
      grid: parseShakeMapCovJson(raw, { eventId: earthquake.id, sourceProvider: "USGS", versionNumber }),
    };
  } catch (error) {
    console.warn("[Earthquake MMI] Official numeric product unavailable:", error instanceof Error ? error.message : error);
    return null;
  }
}
