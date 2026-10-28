import { NextResponse } from "next/server";
import { getExternalApiConfig } from "@/lib/runtime-config";

let cachedRadar: {
  tileUrl: string;
  timestamp: number;
  timeFormatted: string;
  source: string;
} | null = null;
let lastFetchTime = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes cache

export async function GET() {
  const now = Date.now();
  if (cachedRadar && now - lastFetchTime < CACHE_TTL_MS) {
    return NextResponse.json({ ...cachedRadar, cached: true });
  }

  try {
    const apiConfig = getExternalApiConfig();
    const res = await fetch(apiConfig.rainViewer.radarMapsUrl, {
      next: { revalidate: 300 },
      headers: { "User-Agent": "SpartaSiaga/1.0" },
    });

    if (res.ok) {
      const data = await res.json();
      const pastRadars = data?.radar?.past;
      if (Array.isArray(pastRadars) && pastRadars.length > 0) {
        const latest = pastRadars[pastRadars.length - 1];
        const host = data.host || apiConfig.rainViewer.tileHostFallback;
        const tileUrl = `${host}${latest.path}/256/{z}/{x}/{y}/2/1_1.png`;

        const date = new Date(latest.time * 1000);
        const timeFormatted = date.toLocaleTimeString("id-ID", {
          hour: "2-digit",
          minute: "2-digit",
          timeZone: "Asia/Jakarta",
        }) + " WIB";

        cachedRadar = {
          tileUrl,
          timestamp: latest.time,
          timeFormatted,
          source: "RainViewer Open Radar API",
        };
        lastFetchTime = now;

        return NextResponse.json(cachedRadar);
      }
    }

    throw new Error("Invalid response structure from RainViewer");
  } catch (err: any) {
    console.error("[Radar API] Error fetching RainViewer data, using fallback:", err);

    if (cachedRadar) {
      console.log("[Radar API] Returning last-known-good cached radar.");
      return NextResponse.json({ ...cachedRadar, stale: true });
    }

    return NextResponse.json({
      unavailable: true,
      error: "Radar API offline",
    }, { status: 503 });
  }
}
