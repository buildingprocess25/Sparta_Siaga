import { Pool, PoolConfig } from "pg";
import fs from "node:fs";
import path from "node:path";

export interface MasterAhoRow {
  code: string;
  total: number;
  last: string | Date | null;
}

export interface MasterAhoAggregations {
  counts: Record<string, number>;
  lastUpdated: string | null;
  totalActiveTickets: number;
  totalStoresWithTickets: number;
}

export interface AhoTicketDetail {
  id: string;
  problemNo: string;
  status: "New" | "Progress" | string;
  branchCode?: string | null;
  branchName?: string | null;
  updatedAt: string;
}

export interface StorePersonnelInfo {
  availability: "not_configured" | "available" | "error";
  bms: string | null;
  bmc: string | null;
  bnmManager: string | null;
  message: string;
}

export interface AhoStoreDetailResponse {
  storeCode: string;
  tickets: AhoTicketDetail[];
  totalActive: number;
  lastUpdated: string | null;
  personnel: StorePersonnelInfo;
}

const globalForAhoDb = globalThis as unknown as {
  maintenancePool: Pool | undefined;
  aggregationsCache: {
    data: MasterAhoAggregations;
    cachedAt: number;
  } | undefined;
};

// 5-minute cache TTL as specified in the Maintenance integration guide
const AHO_CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * Robust PostgreSQL connection string parser that safely handles passwords
 * containing special characters such as '@', ':', or '#' without failing URL parsing.
 */
function parsePgConnectionString(raw: string): PoolConfig {
  const protocolMatch = raw.match(/^(postgres(?:ql)?:\/\/)(.*)$/);
  if (!protocolMatch) {
    return { connectionString: raw };
  }

  const remainder = protocolMatch[2];
  const lastAtIndex = remainder.lastIndexOf("@");
  if (lastAtIndex === -1) {
    return { connectionString: raw };
  }

  const userinfo = remainder.substring(0, lastAtIndex);
  const hostPart = remainder.substring(lastAtIndex + 1);

  const colonIndex = userinfo.indexOf(":");
  let user = userinfo;
  let password = "";
  if (colonIndex !== -1) {
    user = decodeURIComponent(userinfo.substring(0, colonIndex));
    password = decodeURIComponent(userinfo.substring(colonIndex + 1));
  } else {
    user = decodeURIComponent(userinfo);
  }

  const slashIndex = hostPart.indexOf("/");
  const hostAndPort = slashIndex !== -1 ? hostPart.substring(0, slashIndex) : hostPart;
  const dbAndQuery = slashIndex !== -1 ? hostPart.substring(slashIndex + 1) : "";

  let host = hostAndPort;
  let port = 5432;
  const hostColonIndex = hostAndPort.lastIndexOf(":");
  if (hostColonIndex !== -1) {
    host = hostAndPort.substring(0, hostColonIndex);
    const parsedPort = parseInt(hostAndPort.substring(hostColonIndex + 1), 10);
    if (!isNaN(parsedPort)) {
      port = parsedPort;
    }
  }

  let database = "";
  let ssl: PoolConfig["ssl"] = undefined;
  if (dbAndQuery) {
    const qIndex = dbAndQuery.indexOf("?");
    if (qIndex !== -1) {
      database = dbAndQuery.substring(0, qIndex);
      const searchParams = new URLSearchParams(dbAndQuery.substring(qIndex + 1));
      const sslmode = searchParams.get("sslmode");
      if (sslmode === "disable") {
        ssl = false;
      } else if (sslmode === "require" || sslmode === "verify-ca" || sslmode === "verify-full") {
        ssl = { rejectUnauthorized: false };
      }
    } else {
      database = dbAndQuery;
    }
  }

  return {
    user,
    password,
    host,
    port,
    database: database || undefined,
    ssl,
  };
}

/**
 * Resolves MAINTENANCE_AHO_DATABASE_URL from process.env or .env.local without exposing secrets.
 */
function resolveMaintenanceDbUrl(): string {
  const fromEnv = process.env.MAINTENANCE_AHO_DATABASE_URL?.trim();
  if (fromEnv) return fromEnv;

  for (const filename of [".env.local", ".env"]) {
    try {
      const fullPath = path.join(process.cwd(), filename);
      if (fs.existsSync(fullPath)) {
        const content = fs.readFileSync(fullPath, "utf8");
        for (const line of content.split(/\r?\n/)) {
          const match = line.match(/^\s*MAINTENANCE_AHO_DATABASE_URL\s*=\s*(.*)?\s*$/);
          if (match) {
            let val = (match[1] || "").trim();
            if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
              val = val.slice(1, -1);
            }
            if (val) {
              process.env.MAINTENANCE_AHO_DATABASE_URL = val;
              return val;
            }
          }
        }
      }
    } catch {
      // ignore
    }
  }

  throw new Error("MAINTENANCE_AHO_DATABASE_URL environment variable is not configured");
}

/**
 * Returns the dedicated SPARTA Maintenance database pool.
 * Constraints:
 * - max: 2 (hard ceiling for siaga_aho_reader 3-connection limit)
 * - connectionTimeoutMillis: 5000 (5 seconds)
 * - query_timeout: 10000 (10 seconds)
 * - idleTimeoutMillis: 10000 (10 seconds idle release)
 * - Independent from Siaga main and testing pools
 */
export function getMaintenanceDbPool(): Pool {
  if (!globalForAhoDb.maintenancePool) {
    const rawUrl = resolveMaintenanceDbUrl();
    const config = parsePgConnectionString(rawUrl);

    globalForAhoDb.maintenancePool = new Pool({
      ...config,
      max: 2,
      connectionTimeoutMillis: 5000,
      idleTimeoutMillis: 10000,
      // statement_timeout / query timeout 10 seconds
      statement_timeout: 10000,
    });

    globalForAhoDb.maintenancePool.on("error", (err) => {
      console.error("[Maintenance AHO Pool] Unexpected idle client error:", err.message);
    });
  }

  return globalForAhoDb.maintenancePool;
}

/**
 * Fetches active AHO ticket counts aggregated by normalized storeCode.
 * Includes server-side 5-minute memory cache.
 */
export async function getMasterAhoAggregations(forceRefresh: boolean = false): Promise<MasterAhoAggregations> {
  const now = Date.now();
  if (
    !forceRefresh &&
    globalForAhoDb.aggregationsCache &&
    now - globalForAhoDb.aggregationsCache.cachedAt < AHO_CACHE_TTL_MS
  ) {
    return globalForAhoDb.aggregationsCache.data;
  }

  const pool = getMaintenanceDbPool();
  const query = `
    SELECT
      UPPER(TRIM("storeCode")) AS code,
      COUNT(*)::int AS total,
      MAX("updatedAt") AS last
    FROM public."MasterAhoTicket"
    WHERE "status" IN ('New', 'Progress')
    GROUP BY 1;
  `;

  const result = await pool.query<MasterAhoRow>(query);

  const counts: Record<string, number> = {};
  let maxUpdatedTime: Date | null = null;
  let totalActiveTickets = 0;

  for (const row of result.rows) {
    if (!row.code) continue;
    const storeCode = row.code.toUpperCase().trim();
    const total = Number(row.total) || 0;
    counts[storeCode] = total;
    totalActiveTickets += total;

    if (row.last) {
      const d = new Date(row.last);
      if (!isNaN(d.getTime())) {
        if (!maxUpdatedTime || d.getTime() > maxUpdatedTime.getTime()) {
          maxUpdatedTime = d;
        }
      }
    }
  }

  const data: MasterAhoAggregations = {
    counts,
    lastUpdated: maxUpdatedTime ? maxUpdatedTime.toISOString() : null,
    totalActiveTickets,
    totalStoresWithTickets: Object.keys(counts).length,
  };

  globalForAhoDb.aggregationsCache = {
    data,
    cachedAt: now,
  };

  return data;
}

/**
 * Fetches active AHO tickets for a specific store.
 * Strictly uses parameterized queries and status filtering ('New', 'Progress').
 */
export async function getMasterAhoTicketsByStore(rawStoreCode: string): Promise<{
  tickets: AhoTicketDetail[];
  lastUpdated: string | null;
}> {
  if (!rawStoreCode || !rawStoreCode.trim()) {
    return { tickets: [], lastUpdated: null };
  }

  const storeCode = rawStoreCode.trim().toUpperCase();
  const pool = getMaintenanceDbPool();

  const query = `
    SELECT
      "id",
      "problemNo",
      "status",
      "branchCode",
      "branchName",
      "updatedAt"
    FROM public."MasterAhoTicket"
    WHERE "status" IN ('New', 'Progress')
      AND UPPER(TRIM("storeCode")) = $1
    ORDER BY "updatedAt" DESC;
  `;

  const result = await pool.query<{
    id: string;
    problemNo: string;
    status: string;
    branchCode?: string | null;
    branchName?: string | null;
    updatedAt: string | Date;
  }>(query, [storeCode]);

  let maxUpdated: Date | null = null;
  const tickets: AhoTicketDetail[] = [];

  for (const r of result.rows) {
    const updatedIso = r.updatedAt instanceof Date ? r.updatedAt.toISOString() : String(r.updatedAt);
    const d = new Date(r.updatedAt);
    if (!isNaN(d.getTime())) {
      if (!maxUpdated || d.getTime() > maxUpdated.getTime()) {
        maxUpdated = d;
      }
    }

    tickets.push({
      id: r.id,
      problemNo: r.problemNo,
      status: r.status,
      branchCode: r.branchCode || null,
      branchName: r.branchName || null,
      updatedAt: updatedIso,
    });
  }

  return {
    tickets,
    lastUpdated: maxUpdated ? maxUpdated.toISOString() : null,
  };
}

/**
 * Contract for store personnel (BMS, BMC, BnM Manager).
 *
 * Current State (Kondisi A):
 * Access to personnel tables in SPARTA Maintenance is not yet granted.
 * Returns availability: "not_configured" with null placeholders and explicit message.
 *
 * Future State (Kondisi B):
 * When permissions are granted by SPARTA Maintenance, extend this function with
 * the authorized query on the SAME pool (getMaintenanceDbPool).
 */
export async function getStorePersonnel(_rawStoreCode: string): Promise<StorePersonnelInfo> {
  // Kondisi A: Hak akses tabel personel Maintenance belum dibuka untuk akun siaga_aho_reader.
  // Jangan membuat query fiktif ke tabel yang belum diketahui.
  return {
    availability: "not_configured",
    bms: null,
    bmc: null,
    bnmManager: null,
    message: "Data belum tersedia (menunggu perluasan akses SPARTA Maintenance)",
  };
}

/**
 * Fetches combined store detail: AHO tickets + personnel info.
 */
export async function getAhoStoreDetail(storeCode: string): Promise<AhoStoreDetailResponse> {
  const normCode = (storeCode || "").trim().toUpperCase();

  // Execute ticket query and personnel resolution in parallel
  const [ticketResult, personnelResult] = await Promise.all([
    getMasterAhoTicketsByStore(normCode),
    getStorePersonnel(normCode).catch((err) => ({
      availability: "error" as const,
      bms: null,
      bmc: null,
      bnmManager: null,
      message: "Gagal membaca data penanggung jawab: " + err.message,
    })),
  ]);

  return {
    storeCode: normCode,
    tickets: ticketResult.tickets,
    totalActive: ticketResult.tickets.length,
    lastUpdated: ticketResult.lastUpdated,
    personnel: personnelResult,
  };
}
