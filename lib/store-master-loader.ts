import fs from "fs/promises";
import path from "path";
import type { Pool } from "pg";
import { Store } from "@/types/store";
import { getDbPool } from "./db";
import { portalStoresEnabled } from "./sparta-master-contract";

export interface BranchCentroid {
  cabang: string;
  lat: number;
  lon: number;
  store_count: number;
}

let cachedStores: Store[] | null = null;
let lastCacheTime = 0;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export function invalidateMasterStoresCache() {
  cachedStores = null;
  lastCacheTime = 0;
}

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

/**
 * Loads stores with priority:
 * 1. In-memory cache (if valid)
 * 2. PostgreSQL `stores` table (if rows > 0)
 * 3. Canonical `data/stores-master.csv` file (21,550 stores)
 */
export async function getOrLoadMasterStores(
  forceRefresh: boolean = false,
  options?: { pool?: Pool }
): Promise<Store[]> {
  const now = Date.now();
  if (!options?.pool && !forceRefresh && cachedStores && cachedStores.length > 0 && now - lastCacheTime < CACHE_TTL_MS) {
    return cachedStores;
  }

  // 1. Try querying PostgreSQL stores table first
  try {
    const pool = options?.pool || getDbPool();
    const res = await pool.query(
      `SELECT id, kode_toko, nama_toko, cabang, alamat, latitude, longitude, fr_type, branch_emergency_contact
       ${portalStoresEnabled() ? ", branch_code" : ""}
       FROM stores 
       WHERE latitude IS NOT NULL AND longitude IS NOT NULL
       ${portalStoresEnabled() ? "AND is_active=TRUE AND master_source='SPARTA_PORTAL'" : ""}
       LIMIT 25000`
    );
    if (res.rows && res.rows.length > 0) {
      const mappedStores: Store[] = res.rows.map((r) => ({
        id: r.id || `SAT-${r.kode_toko}`,
        kode_toko: r.kode_toko,
        nama_toko: r.nama_toko,
        cabang: r.cabang,
        branch_code: r.branch_code ?? null,
        alamat: r.alamat?.trim() || `Alfamart ${r.nama_toko}, Cabang ${r.cabang}`,
        latitude: parseFloat(r.latitude),
        longitude: parseFloat(r.longitude),
        fr_type: r.fr_type || "UNKNOWN",
        branch_emergency_contact: r.branch_emergency_contact || `Duty Officer DC Cabang ${r.cabang}`,
        status: "SAFE",
      }));
      if (!options?.pool) {
        cachedStores = mappedStores;
        lastCacheTime = now;
      }
      return mappedStores;
    }
  } catch (dbErr) {
    console.warn("[Store Master Loader] Database master toko tidak tersedia:", dbErr);
    if (portalStoresEnabled()) throw dbErr;
  }

  if (portalStoresEnabled()) {
    if (!options?.pool) {
      cachedStores = [];
      lastCacheTime = now;
    }
    return [];
  }

  // 2. Read from canonical data/stores-master.csv
  const masterCsvPath = path.join(process.cwd(), "data", "stores-master.csv");
  try {
    const csvBuffer = await fs.readFile(masterCsvPath, "utf-8");
    const lines = csvBuffer.split(/\r?\n/);
    let headerPassed = false;
    const sanitizedStores: Store[] = [];
    const seenCodes = new Set<string>();

    for (const line of lines) {
      if (!line.trim()) continue;
      if (!headerPassed) {
        headerPassed = true;
        continue;
      }

      const parts = parseCSVLine(line);
      if (parts.length >= 5) {
        const branch = parts[0].trim();
        const kode = parts[1].trim();
        const rawName = parts[2].trim().replace(/^"|"$/g, "");
        const fr = parts[3].trim().toUpperCase();
        const coordStr = parts[4].trim().replace(/^"|"$/g, "");

        if (seenCodes.has(kode)) continue;
        seenCodes.add(kode);

        if (!coordStr || coordStr === "-") continue;

        const coords = coordStr.split(/[\s,]+/);
        const lat = parseFloat(coords[0]);
        const lon = parseFloat(coords[1]);

        if (
          !isNaN(lat) &&
          !isNaN(lon) &&
          lat >= -15 &&
          lat <= 15 &&
          lon >= 90 &&
          lon <= 145
        ) {
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
        }
      }
    }

    if (sanitizedStores.length > 0) {
      cachedStores = sanitizedStores;
      lastCacheTime = now;
      return cachedStores;
    }
  } catch (csvErr) {
    console.error("[Store Master Loader] Failed to read stores-master.csv:", csvErr);
  }

  return cachedStores || [];
}

/**
 * Calculates branch centroids from the loaded stores dataset.
 */
export function getBranchCentroidsFromStores(stores: Store[]): BranchCentroid[] {
  const branchMap = new Map<string, { sumLat: number; sumLon: number; count: number }>();

  for (const s of stores) {
    if (s.latitude == null || s.longitude == null || !s.cabang) continue;
    const existing = branchMap.get(s.cabang);
    if (!existing) {
      branchMap.set(s.cabang, { sumLat: s.latitude, sumLon: s.longitude, count: 1 });
    } else {
      existing.sumLat += s.latitude;
      existing.sumLon += s.longitude;
      existing.count += 1;
    }
  }

  const result: BranchCentroid[] = [];
  branchMap.forEach((val, cabang) => {
    result.push({
      cabang,
      lat: Math.round((val.sumLat / val.count) * 10000) / 10000,
      lon: Math.round((val.sumLon / val.count) * 10000) / 10000,
      store_count: val.count,
    });
  });

  result.sort((a, b) => b.store_count - a.store_count);
  return result;
}
