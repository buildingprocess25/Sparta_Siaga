import { NextResponse } from "next/server";
import { Store } from "@/types/store";
import fs from "fs/promises";
import path from "path";
import { getLastStoreSyncHistory } from "@/lib/google-sheets-sync";
import { portalStoresEnabled } from "@/lib/sparta-master-contract";
import { getOrLoadMasterStores } from "@/lib/store-master-loader";
import { canonicalBranchKey } from "@/lib/sparta-master-sync";
import { SpartaIntegrationError } from "@/lib/sparta-identity";

let cachedStores: Store[] | null = null;
let lastCacheTime = 0;
let cachedDataQuality: Record<string, number> | null = null;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours server-side cache

function parseCSVLine(text: string): string[] {
  const result: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      inQuotes = !inQuotes;
    } else if (c === "," && !inQuotes) {
      result.push(cur.trim());
      cur = "";
    } else {
      cur += c;
    }
  }
  result.push(cur.trim());
  return result;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const forceRefresh = searchParams.get("refresh") === "true";
  const branchFilter = searchParams.get("branch");

  let usePortalStores = false;
  try {
    usePortalStores = portalStoresEnabled();
  } catch (err) {
    if (err instanceof SpartaIntegrationError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
    }
    throw err;
  }

  if (usePortalStores) {
    try {
      const stores = await getOrLoadMasterStores(forceRefresh);
      const branchCode = branchFilter && branchFilter !== "all" ? await canonicalBranchKey(branchFilter) : null;
      const result = branchCode ? stores.filter(store => store.branch_code === branchCode) : stores;
      return NextResponse.json({ data: result, count: result.length, totalLoaded: stores.length,
        source: "SPARTA_PORTAL", lastSync: await getLastStoreSyncHistory() });
    } catch {
      return NextResponse.json({ error: "Master toko portal belum tersedia." }, { status: 503 });
    }
  }

  const now = Date.now();
  if (!forceRefresh && cachedStores && now - lastCacheTime < CACHE_TTL_MS) {
    let result = cachedStores;
    if (branchFilter && branchFilter !== "all") {
      result = cachedStores.filter(
        (s) => s.cabang.toLowerCase() === branchFilter.toLowerCase()
      );
    }
    return NextResponse.json({
      data: result,
      count: result.length,
      totalLoaded: cachedStores.length,
      source: "cache",
      cachedAt: new Date(lastCacheTime).toISOString(),
      meta: {
        dataQuality: cachedDataQuality || {
          totalRows: cachedStores.length,
          loadedStores: cachedStores.length,
          validCoordinates: cachedStores.length,
          invalidCoordinates: 0,
          missingCoordinates: 0,
          duplicateStoreCodes: 0,
        },
      },
      metadata: cachedDataQuality || undefined,
      lastSync: await getLastStoreSyncHistory(),
    });
  }

  try {
    const sanitizedStores: Store[] = [];
    const masterCsvPath = path.join(process.cwd(), "data", "stores-master.csv");
    let hasReadMasterCsv = false;

    let totalRows = 0;
    let validCoordinates = 0;
    let invalidCoordinates = 0;
    let missingCoordinates = 0;
    let duplicateStoreCodes = 0;
    const seenCodes = new Set<string>();

    // 1. Try reading real master CSV
    try {
      const csvBuffer = await fs.readFile(masterCsvPath, "utf-8");
      const lines = csvBuffer.split(/\r?\n/);
      let headerPassed = false;

      for (const line of lines) {
        if (!line.trim()) continue;
        if (!headerPassed) {
          headerPassed = true;
          continue;
        }

        const parts = parseCSVLine(line);
        if (parts.length >= 5) {
          totalRows++;
          const branch = parts[0].trim();
          const kode = parts[1].trim();
          const rawName = parts[2].trim().replace(/^"|"$/g, "");
          const fr = parts[3].trim().toUpperCase();
          const coordStr = parts[4].trim().replace(/^"|"$/g, "");

          if (seenCodes.has(kode)) {
            duplicateStoreCodes++;
          } else {
            seenCodes.add(kode);
          }

          if (!coordStr || coordStr === "-") {
            missingCoordinates++;
            continue;
          }

          // Parse coordinates (supports space or comma separation)
          const coords = coordStr.split(/[\s,]+/);
          const lat = parseFloat(coords[0]);
          const lon = parseFloat(coords[1]);

          // Validate coordinates within Indonesian bounds (-15 to 10 lat, 90 to 145 lon)
          if (
            !isNaN(lat) &&
            !isNaN(lon) &&
            lat >= -15 &&
            lat <= 15 &&
            lon >= 90 &&
            lon <= 145
          ) {
            validCoordinates++;
            sanitizedStores.push({
              id: `SAT-${kode}`,
              kode_toko: kode,
              nama_toko: rawName || `Alfamart ${kode}`,
              cabang: branch || "Nasional",
              alamat: `Alfamart ${rawName || kode}, Area Cabang ${branch}`,
              latitude: lat,
              longitude: lon,
              fr_type: fr === "F" ? "F" : "R",
              branch_emergency_contact: `Duty Officer DC Cabang ${branch}`,
              status: "SAFE",
            });
          } else {
            invalidCoordinates++;
          }
        }
      }

      if (sanitizedStores.length > 0) {
        hasReadMasterCsv = true;
        console.log(
          `[Stores API] Successfully parsed ${sanitizedStores.length} stores from stores-master.csv`
        );
      }
    } catch (csvErr) {
      console.warn(
        "[Stores API] stores-master.csv not accessible or failed, checking fallback:",
        csvErr
      );
    }

    // 2. Fallback evaluation (Requirement 15: HARD RULE)
    // NODE_ENV=production -> NEVER load stores-fallback.json, even if ALLOW_DEV_FALLBACK_DATA=true.
    // Real master failure in production MUST return 503 Service Unavailable.
    const isProd = process.env.NODE_ENV === "production";
    const allowDevFallback = process.env.ALLOW_DEV_FALLBACK_DATA === "true";

    if (!hasReadMasterCsv || sanitizedStores.length === 0) {
      if (isProd) {
        console.error("[Stores API] HARD RULE ENFORCED: Production environment refused fallback data. Real master unavailable.");
        return NextResponse.json(
          {
            error: "Data lokasi toko sedang tidak tersedia.",
            reason: "Master store data unavailable in production environment",
          },
          { status: 503 }
        );
      }

      if (allowDevFallback) {
        console.warn("[Stores API] Development mode: ALLOW_DEV_FALLBACK_DATA is true. Loading dev fallback.");
        try {
          const fallbackPath = path.join(process.cwd(), "data", "stores-fallback.json");
          const fallbackContent = await fs.readFile(fallbackPath, "utf-8");
          const rawFallback = JSON.parse(fallbackContent);

          for (const item of rawFallback) {
            const lat = typeof item.latitude === "number" ? item.latitude : parseFloat(item.latitude);
            const lon = typeof item.longitude === "number" ? item.longitude : parseFloat(item.longitude);

            if (!isNaN(lat) && !isNaN(lon) && lat >= -15 && lat <= 15 && lon >= 90 && lon <= 145) {
              validCoordinates++;
              sanitizedStores.push({
                id: item.id || `SAT-${item.kode_toko}`,
                kode_toko: String(item.kode_toko || "").trim(),
                nama_toko: String(item.nama_toko || "Alfamart").trim(),
                cabang: String(item.cabang || "Nasional").trim(),
                alamat: String(item.alamat || "").trim(),
                latitude: lat,
                longitude: lon,
                fr_type: item.fr_type || "R",
                branch_emergency_contact: `Duty Officer DC Cabang ${item.cabang || "Nasional"}`,
                status: "SAFE",
              });
            }
          }
        } catch (e) {
          console.warn("[Stores API] Fallback load failed:", e);
        }
      } else {
        console.warn("[Stores API] Master data unavailable. ALLOW_DEV_FALLBACK_DATA is not enabled in development. Returning 503.");
        return NextResponse.json(
          {
            error: "Data lokasi toko sedang tidak tersedia.",
            reason: "Development fallback disabled (set ALLOW_DEV_FALLBACK_DATA=true to allow in dev)",
          },
          { status: 503 }
        );
      }
    }

    const dataQuality = {
      totalRows,
      loadedStores: sanitizedStores.length,
      validCoordinates,
      invalidCoordinates,
      missingCoordinates,
      duplicateStoreCodes,
    };

    cachedStores = sanitizedStores;
    lastCacheTime = now;
    cachedDataQuality = dataQuality;

    let result = sanitizedStores;
    if (branchFilter && branchFilter !== "all") {
      result = sanitizedStores.filter(
        (s) => s.cabang.toLowerCase() === branchFilter.toLowerCase()
      );
    }

    return NextResponse.json({
      data: result,
      count: result.length,
      totalLoaded: sanitizedStores.length,
      source: "fresh",
      cachedAt: new Date(lastCacheTime).toISOString(),
      meta: {
        dataQuality,
      },
      metadata: dataQuality,
      lastSync: await getLastStoreSyncHistory(),
    });
  } catch (error: any) {
    console.error("[Stores API] Critical error loading stores:", error);
    return NextResponse.json(
      { error: "Gagal memuat data toko master", details: error?.message },
      { status: 500 }
    );
  }
}
