import fs from "fs/promises";
import path from "path";
import crypto from "crypto";
import { getDbPool } from "./db";
import { Store } from "@/types/store";

export const DEFAULT_GOOGLE_SHEET_ID = "1wvweYqTkS4PA1WKXARRn-vubv7qn6lqISHiSdKSZKcg";
export const GOOGLE_SHEET_ID = process.env.GOOGLE_SHEET_ID?.trim() || DEFAULT_GOOGLE_SHEET_ID;
export const GOOGLE_SHEET_EXPORT_URL =
  process.env.GOOGLE_SHEET_EXPORT_URL?.trim() ||
  `https://docs.google.com/spreadsheets/d/${GOOGLE_SHEET_ID}/export?format=csv`;

export interface StoreSyncHistoryRecord {
  id: string;
  sync_source: string;
  sourceType?: "GOOGLE_SHEETS" | "LOCAL_MASTER";
  sourceLabel?: string;
  status: "COMPLETED" | "OFFLINE_SOURCE_PRESERVED" | "LOCAL_FALLBACK" | "IN_PROGRESS" | "FAILED";
  started_at: string;
  completed_at: string | null;
  records_read: number;
  records_added: number;
  records_updated: number;
  records_skipped: number;
  records_failed: number;
  error_message: string | null;
  created_at?: string;
}

export interface GoogleServiceAccountConfig {
  clientEmail?: string;
  privateKey?: string;
  apiKey?: string;
}

export function getGoogleCredentialsFromEnv(): GoogleServiceAccountConfig {
  if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    try {
      const parsed = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
      return {
        clientEmail: parsed.client_email,
        privateKey: parsed.private_key,
      };
    } catch {
      // Ignore JSON parse error and fallback
    }
  }

  return {
    clientEmail: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    privateKey: process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY
      ? process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY.replace(/\\n/g, "\n")
      : undefined,
    apiKey: process.env.GOOGLE_SHEETS_API_KEY,
  };
}

/**
 * Attempts to retrieve spreadsheet content legitimately through:
 * 1. Google Sheets API v4 using Service Account (JWT) credentials
 * 2. Google Sheets API Key if configured
 * 3. Standard CSV export URL (if internal VPC/proxy allows)
 */
export async function fetchPrivateGoogleSheetsCSV(
  sheetId: string = GOOGLE_SHEET_ID,
  creds?: GoogleServiceAccountConfig
): Promise<{ content: string; source: "GOOGLE_SHEETS_API" | "GOOGLE_SHEETS_CSV" } | null> {
  const config = creds || getGoogleCredentialsFromEnv();

  // 1. Service Account OAuth2 JWT to Sheets API v4
  if (config.clientEmail && config.privateKey) {
    try {
      const now = Math.floor(Date.now() / 1000);
      const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
      const claimSet = Buffer.from(
        JSON.stringify({
          iss: config.clientEmail,
          scope: "https://www.googleapis.com/auth/spreadsheets.readonly",
          aud: "https://oauth2.googleapis.com/token",
          exp: now + 3600,
          iat: now,
        })
      ).toString("base64url");

      const sign = crypto.createSign("RSA-SHA256");
      sign.update(`${header}.${claimSet}`);
      const signature = sign.sign(config.privateKey, "base64url");
      const jwt = `${header}.${claimSet}.${signature}`;

      const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
          assertion: jwt,
        }),
      });

      if (tokenRes.ok) {
        const tokenData = await tokenRes.json();
        const accessToken = tokenData.access_token;

        const sheetRes = await fetch(
          `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/A:Z`,
          {
            headers: { Authorization: `Bearer ${accessToken}` },
          }
        );

        if (sheetRes.ok) {
          const valuesData = await sheetRes.json();
          if (valuesData.values && Array.isArray(valuesData.values)) {
            const csv = valuesData.values
              .map((row: any[]) =>
                row
                  .map((cell) => {
                    const str = String(cell ?? "");
                    return str.includes(",") || str.includes('"') || str.includes("\n")
                      ? `"${str.replace(/"/g, '""')}"`
                      : str;
                  })
                  .join(",")
              )
              .join("\n");
            return { content: csv, source: "GOOGLE_SHEETS_API" };
          }
        }
      }
    } catch (apiErr) {
      console.warn("[Google Sheets API] Service account fetch error:", apiErr);
    }
  }

  // 2. Google Sheets API Key
  if (config.apiKey) {
    try {
      const sheetRes = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/A:Z?key=${config.apiKey}`
      );
      if (sheetRes.ok) {
        const valuesData = await sheetRes.json();
        if (valuesData.values && Array.isArray(valuesData.values)) {
          const csv = valuesData.values
            .map((row: any[]) =>
              row
                .map((cell) => {
                  const str = String(cell ?? "");
                  return str.includes(",") || str.includes('"') || str.includes("\n")
                    ? `"${str.replace(/"/g, '""')}"`
                    : str;
                })
                .join(",")
            )
            .join("\n");
          return { content: csv, source: "GOOGLE_SHEETS_API" };
        }
      }
    } catch (apiKeyErr) {
      console.warn("[Google Sheets API] API Key fetch error:", apiKeyErr);
    }
  }

  // 3. Export URL check
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);
    const targetExportUrl =
      sheetId === GOOGLE_SHEET_ID
        ? GOOGLE_SHEET_EXPORT_URL
        : `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv`;
    const res = await fetch(targetExportUrl, {
      signal: controller.signal,
      redirect: "follow",
      headers: { Accept: "text/csv, application/csv, text/plain" },
    });
    clearTimeout(timeout);

    const contentType = res.headers.get("content-type") || "";
    const text = await res.text();
    const isHtmlOrLogin =
      text.includes("<!DOCTYPE html") ||
      text.includes("accounts.google.com") ||
      text.includes("<html") ||
      contentType.includes("text/html") ||
      !res.ok;

    if (!isHtmlOrLogin) {
      return { content: text, source: "GOOGLE_SHEETS_CSV" };
    }
  } catch {
    // Network / timeout
  }

  return null;
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

export async function ensureStoreSyncTables(): Promise<void> {
  const pool = getDbPool();

  await pool.query(`
    CREATE TABLE IF NOT EXISTS store_sync_history (
      id TEXT PRIMARY KEY,
      sync_source TEXT NOT NULL,
      status TEXT NOT NULL,
      started_at TIMESTAMPTZ NOT NULL,
      completed_at TIMESTAMPTZ,
      records_read INTEGER DEFAULT 0,
      records_added INTEGER DEFAULT 0,
      records_updated INTEGER DEFAULT 0,
      records_skipped INTEGER DEFAULT 0,
      records_failed INTEGER DEFAULT 0,
      error_message TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  // Ensure stores table exists and has unique constraint on kode_toko
  await pool.query(`
    CREATE TABLE IF NOT EXISTS stores (
      id TEXT PRIMARY KEY,
      kode_toko TEXT NOT NULL,
      nama_toko TEXT NOT NULL,
      cabang TEXT NOT NULL,
      alamat TEXT,
      latitude DOUBLE PRECISION,
      longitude DOUBLE PRECISION,
      fr_type TEXT,
      branch_emergency_contact TEXT
    );
  `);

  try {
    await pool.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'uq_stores_kode_toko'
        ) THEN
          ALTER TABLE stores ADD CONSTRAINT uq_stores_kode_toko UNIQUE (kode_toko);
        END IF;
      EXCEPTION WHEN OTHERS THEN
        NULL;
      END $$;
    `);
  } catch {
    // Ignore if constraint already exists
  }
}

export async function getLastStoreSyncHistory(): Promise<StoreSyncHistoryRecord | null> {
  try {
    await ensureStoreSyncTables();
    const pool = getDbPool();
    const res = await pool.query(
      `SELECT id, sync_source, status, started_at, completed_at, records_read, records_added, records_updated, records_skipped, records_failed, error_message, created_at
       FROM store_sync_history
       ORDER BY started_at DESC
       LIMIT 1`
    );

    if (res.rows.length === 0) {
      return null;
    }

    const row = res.rows[0];
    const isRemote = row.sync_source === "GOOGLE_SHEET_REMOTE" || row.sync_source === "GOOGLE_SHEETS_API";
    const sourceType: "GOOGLE_SHEETS" | "LOCAL_MASTER" = isRemote ? "GOOGLE_SHEETS" : "LOCAL_MASTER";
    const sourceLabel = isRemote
      ? "Google Sheets (Sinkron)"
      : "Master Toko Lokal (Akses Google Sheets Privat Memerlukan Kredensial)";

    return {
      id: row.id,
      sync_source: row.sync_source,
      sourceType,
      sourceLabel,
      status: row.status,
      started_at: row.started_at ? new Date(row.started_at).toISOString() : "",
      completed_at: row.completed_at ? new Date(row.completed_at).toISOString() : null,
      records_read: Number(row.records_read || 0),
      records_added: Number(row.records_added || 0),
      records_updated: Number(row.records_updated || 0),
      records_skipped: Number(row.records_skipped || 0),
      records_failed: Number(row.records_failed || 0),
      error_message: row.error_message || null,
      created_at: row.created_at ? new Date(row.created_at).toISOString() : undefined,
    };
  } catch (err) {
    console.error("[Store Sync] Failed to get last store sync history:", err);
    return null;
  }
}

interface ParsedStoreRow {
  id: string;
  kode_toko: string;
  nama_toko: string;
  cabang: string;
  alamat: string;
  latitude: number;
  longitude: number;
  fr_type: string;
  branch_emergency_contact: string;
}

export async function syncStoresFromGoogleSheets(): Promise<StoreSyncHistoryRecord> {
  await ensureStoreSyncTables();
  const pool = getDbPool();

  const syncId = `sync_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const startedAt = new Date().toISOString();

  let syncSource = `GOOGLE_SHEET:${GOOGLE_SHEET_ID}`;
  let syncStatus: "COMPLETED" | "OFFLINE_SOURCE_PRESERVED" | "LOCAL_FALLBACK" | "FAILED" = "COMPLETED";
  let errorMessage: string | null = null;
  let csvContent = "";

  // 1. Initial IN_PROGRESS record
  await pool.query(
    `INSERT INTO store_sync_history (id, sync_source, status, started_at, records_read, records_added, records_updated, records_skipped, records_failed, error_message)
     VALUES ($1, $2, 'IN_PROGRESS', $3, 0, 0, 0, 0, 0, NULL)`,
    [syncId, syncSource, startedAt]
  );

  // 2. Try private / legitimate Google Sheets retrieval
  const remoteResult = await fetchPrivateGoogleSheetsCSV(GOOGLE_SHEET_ID);

  if (remoteResult && remoteResult.content) {
    csvContent = remoteResult.content;
    syncSource = remoteResult.source;
    syncStatus = "COMPLETED";
  } else {
    // Graceful fallback to local canonical dataset
    syncStatus = "OFFLINE_SOURCE_PRESERVED";
    errorMessage =
      "Akses Google Sheets privat/terproteksi (memerlukan Service Account korporat). Sistem mempertahankan integritas operasional menggunakan data master lokal data/stores-master.csv (21.550 toko).";
    syncSource = "FALLBACK_LOCAL_CSV";
  }

  // 3. Fallback to local CSV if remote was private or failed
  if (!csvContent) {
    const localCsvPath = path.join(process.cwd(), "data", "stores-master.csv");
    try {
      csvContent = await fs.readFile(localCsvPath, "utf-8");
    } catch (readErr: any) {
      const completedAt = new Date().toISOString();
      const failError = `Gagal membaca dataset master lokal: ${readErr.message}`;
      await pool.query(
        `UPDATE store_sync_history
         SET status = 'FAILED', completed_at = $2, error_message = $3
         WHERE id = $1`,
        [syncId, completedAt, failError]
      );
      throw new Error(failError);
    }
  }

  // 4. Parse CSV content
  const lines = csvContent.split(/\r?\n/);
  let headerPassed = false;
  let recordsRead = 0;
  let recordsSkipped = 0;
  let recordsFailed = 0;
  const parsedStores: ParsedStoreRow[] = [];
  const seenCodes = new Set<string>();

  for (const line of lines) {
    if (!line.trim()) continue;
    if (!headerPassed) {
      headerPassed = true;
      continue;
    }

    recordsRead++;
    const parts = parseCSVLine(line);
    if (parts.length >= 5) {
      const branch = parts[0].trim();
      const kode = parts[1].trim();
      const rawName = parts[2].trim().replace(/^"|"$/g, "");
      const fr = parts[3].trim().toUpperCase() === "F" ? "F" : "R";
      const coordStr = parts[4].trim().replace(/^"|"$/g, "");

      if (!kode || seenCodes.has(kode)) {
        recordsSkipped++;
        continue;
      }
      seenCodes.add(kode);

      if (!coordStr || coordStr === "-") {
        recordsSkipped++;
        continue;
      }

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
        parsedStores.push({
          id: `SAT-${kode}`,
          kode_toko: kode,
          nama_toko: rawName || `Alfamart ${kode}`,
          cabang: branch || "Nasional",
          alamat: `Alfamart ${rawName || kode}, Area Cabang ${branch}`,
          latitude: lat,
          longitude: lon,
          fr_type: fr,
          branch_emergency_contact: `Duty Officer DC Cabang ${branch}`,
        });
      } else {
        recordsSkipped++;
      }
    } else {
      recordsFailed++;
    }
  }

  // 5. Query existing store codes to count added vs updated
  const existingRes = await pool.query("SELECT kode_toko FROM stores");
  const existingSet = new Set(existingRes.rows.map((r) => r.kode_toko));

  let recordsAdded = 0;
  let recordsUpdated = 0;

  for (const s of parsedStores) {
    if (existingSet.has(s.kode_toko)) {
      recordsUpdated++;
    } else {
      recordsAdded++;
    }
  }

  // 6. Batch upsert into PostgreSQL stores in chunks of 500
  const CHUNK_SIZE = 500;
  for (let i = 0; i < parsedStores.length; i += CHUNK_SIZE) {
    const chunk = parsedStores.slice(i, i + CHUNK_SIZE);

    const valueClauses: string[] = [];
    const params: any[] = [];
    let pIdx = 1;

    for (const s of chunk) {
      valueClauses.push(
        `($${pIdx}, $${pIdx + 1}, $${pIdx + 2}, $${pIdx + 3}, $${pIdx + 4}, $${pIdx + 5}, $${pIdx + 6}, $${pIdx + 7}, $${pIdx + 8})`
      );
      params.push(
        s.id,
        s.kode_toko,
        s.nama_toko,
        s.cabang,
        s.alamat,
        s.latitude,
        s.longitude,
        s.fr_type,
        s.branch_emergency_contact
      );
      pIdx += 9;
    }

    const query = `
      INSERT INTO stores (id, kode_toko, nama_toko, cabang, alamat, latitude, longitude, fr_type, branch_emergency_contact)
      VALUES ${valueClauses.join(", ")}
      ON CONFLICT (id) DO UPDATE SET
        kode_toko = EXCLUDED.kode_toko,
        nama_toko = EXCLUDED.nama_toko,
        cabang = EXCLUDED.cabang,
        alamat = EXCLUDED.alamat,
        latitude = EXCLUDED.latitude,
        longitude = EXCLUDED.longitude,
        fr_type = EXCLUDED.fr_type,
        branch_emergency_contact = EXCLUDED.branch_emergency_contact;
    `;

    await pool.query(query, params);
  }

  const completedAt = new Date().toISOString();

  // 7. Update store_sync_history record
  await pool.query(
    `UPDATE store_sync_history
     SET status = $2, completed_at = $3, records_read = $4, records_added = $5, records_updated = $6, records_skipped = $7, records_failed = $8, error_message = $9, sync_source = $10
     WHERE id = $1`,
    [
      syncId,
      syncStatus,
      completedAt,
      recordsRead,
      recordsAdded,
      recordsUpdated,
      recordsSkipped,
      recordsFailed,
      errorMessage,
      syncSource,
    ]
  );

  return {
    id: syncId,
    sync_source: syncSource,
    status: syncStatus,
    started_at: startedAt,
    completed_at: completedAt,
    records_read: recordsRead,
    records_added: recordsAdded,
    records_updated: recordsUpdated,
    records_skipped: recordsSkipped,
    records_failed: recordsFailed,
    error_message: errorMessage,
  };
}
