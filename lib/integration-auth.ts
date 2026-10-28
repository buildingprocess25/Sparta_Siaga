import { getDbPool } from "./db";
import bcrypt from "bcryptjs";

export interface IntegrationClientContext {
  id: string;
  appName: string;
  scope: "TOKO_ONLY" | "DC_ONLY" | "ALL";
  branchRestriction: string | null;
  rateLimitPerMinute: number;
}

// In-memory rate-limiter: client key -> timestamps[]
const rateLimitMap = new Map<string, number[]>();

export function getIntegrationCredentialsConfig() {
  const isProd = process.env.NODE_ENV === "production";
  return {
    SPARTA_MAINTENANCE: {
      appName: "sparta_maintenance",
      apiKey:
        process.env.SPARTA_MAINTENANCE_API_KEY?.trim() ||
        (isProd ? "" : "key_sparta_maint_dev_local"),
      secret:
        process.env.SPARTA_MAINTENANCE_API_SECRET?.trim() ||
        (isProd ? "" : "sec_maint_dev_secret_local_only"),
      scope: "TOKO_ONLY" as const,
    },
    ENGINEERING_SUPPORT: {
      appName: "engineering_support",
      apiKey:
        process.env.ENGINEERING_SUPPORT_API_KEY?.trim() ||
        (isProd ? "" : "key_sparta_eng_dev_local"),
      secret:
        process.env.ENGINEERING_SUPPORT_API_SECRET?.trim() ||
        (isProd ? "" : "sec_eng_dev_secret_local_only"),
      scope: "DC_ONLY" as const,
    },
  };
}

export const getKnownIntegrationKeys = getIntegrationCredentialsConfig;

export const KNOWN_INTEGRATION_KEYS = new Proxy(
  {} as ReturnType<typeof getIntegrationCredentialsConfig>,
  {
    get(_target, prop: keyof ReturnType<typeof getIntegrationCredentialsConfig>) {
      return getIntegrationCredentialsConfig()[prop];
    },
    ownKeys() {
      return Object.keys(getIntegrationCredentialsConfig());
    },
    getOwnPropertyDescriptor(target, prop) {
      return {
        enumerable: true,
        configurable: true,
        value:
          getIntegrationCredentialsConfig()[
            prop as keyof ReturnType<typeof getIntegrationCredentialsConfig>
          ],
      };
    },
  }
);

let keysSeeded = false;

export async function ensureIntegrationSchemaAndSeed(): Promise<void> {
  if (keysSeeded) return;
  const pool = getDbPool();

  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS integration_api_keys (
        id VARCHAR(64) PRIMARY KEY,
        app_name VARCHAR(64) NOT NULL,
        api_key VARCHAR(128) UNIQUE NOT NULL,
        secret_hash VARCHAR(255) NOT NULL,
        scope VARCHAR(64) NOT NULL DEFAULT 'ALL',
        branch_restriction VARCHAR(64),
        status VARCHAR(32) NOT NULL DEFAULT 'ACTIVE',
        rate_limit_per_minute INT NOT NULL DEFAULT 120,
        description TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS integration_sync_logs (
        id VARCHAR(64) PRIMARY KEY,
        incident_id VARCHAR(64) NOT NULL,
        external_system VARCHAR(64) NOT NULL,
        external_work_id VARCHAR(128),
        action VARCHAR(64) NOT NULL,
        payload JSONB,
        response_status INT NOT NULL DEFAULT 200,
        ip_address VARCHAR(64),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      ALTER TABLE incidents ADD COLUMN IF NOT EXISTS external_work_id VARCHAR(128);
      ALTER TABLE incidents ADD COLUMN IF NOT EXISTS external_system VARCHAR(64);
      ALTER TABLE incidents ADD COLUMN IF NOT EXISTS external_work_status VARCHAR(64);
      ALTER TABLE incidents ADD COLUMN IF NOT EXISTS external_synced_at TIMESTAMPTZ;
    `);

    // Seed configured keys if not present
    for (const keyDef of Object.values(KNOWN_INTEGRATION_KEYS)) {
      if (!keyDef.apiKey || !keyDef.secret) continue;
      const existing = await pool.query(
        "SELECT id FROM integration_api_keys WHERE api_key = $1",
        [keyDef.apiKey]
      );
      if (existing.rows.length === 0) {
        const hash = await bcrypt.hash(keyDef.secret, 10);
        await pool.query(
          `INSERT INTO integration_api_keys (id, app_name, api_key, secret_hash, scope, status, rate_limit_per_minute)
           VALUES ($1, $2, $3, $4, $5, 'ACTIVE', 120)`,
          [
            `key_${keyDef.appName}`,
            keyDef.appName,
            keyDef.apiKey,
            hash,
            keyDef.scope,
          ]
        );
      }
    }

    keysSeeded = true;
  } catch (err) {
    console.warn("[IntegrationAuth] ensureSchema notice:", err);
  }
}

export async function authenticateIntegrationRequest(
  request: Request
): Promise<
  | { success: true; client: IntegrationClientContext }
  | { success: false; status: number; error: string }
> {
  await ensureIntegrationSchemaAndSeed();

  const apiKey =
    request.headers.get("x-sparta-api-key") ||
    request.headers.get("X-Sparta-Api-Key") ||
    "";
  const apiSecret =
    request.headers.get("x-sparta-api-secret") ||
    request.headers.get("X-Sparta-Api-Secret") ||
    "";

  if (!apiKey || !apiSecret) {
    return {
      success: false,
      status: 401,
      error:
        "Otentikasi Mesin-ke-Mesin Gagal: Header 'X-Sparta-Api-Key' dan 'X-Sparta-Api-Secret' wajib dilampirkan.",
    };
  }

  // Rate Limiting Check
  const now = Date.now();
  const windowMs = 60 * 1000;
  const timestamps = (rateLimitMap.get(apiKey) || []).filter(
    (t) => now - t < windowMs
  );
  if (timestamps.length >= 120) {
    return {
      success: false,
      status: 429,
      error: "Batas permintaan terlampaui (Rate Limit: 120 req/menit). Silakan coba lagi.",
    };
  }
  timestamps.push(now);
  rateLimitMap.set(apiKey, timestamps);

  const pool = getDbPool();
  try {
    const res = await pool.query(
      `SELECT id, app_name, api_key, secret_hash, scope, branch_restriction, status, rate_limit_per_minute 
       FROM integration_api_keys 
       WHERE api_key = $1`,
      [apiKey]
    );

    if (res.rows.length === 0) {
      return {
        success: false,
        status: 401,
        error: "Kredensial API Key tidak terdaftar.",
      };
    }

    const row = res.rows[0];
    if (row.status !== "ACTIVE") {
      return {
        success: false,
        status: 403,
        error: `API Key dinonaktifkan (Status: ${row.status}).`,
      };
    }

    const isValidSecret = await bcrypt.compare(apiSecret, row.secret_hash);
    if (!isValidSecret) {
      return {
        success: false,
        status: 401,
        error: "Kredensial Secret tidak valid.",
      };
    }

    return {
      success: true,
      client: {
        id: row.id,
        appName: row.app_name,
        scope: row.scope as "TOKO_ONLY" | "DC_ONLY" | "ALL",
        branchRestriction: row.branch_restriction,
        rateLimitPerMinute: row.rate_limit_per_minute,
      },
    };
  } catch (err: any) {
    console.error("[IntegrationAuth] DB error:", err);
    // In production, reject authentication immediately without in-memory fallback
    if (process.env.NODE_ENV === "production") {
      return {
        success: false,
        status: 500,
        error: "Kesalahan internal otentikasi integrasi.",
      };
    }

    // Non-production (dev/test) in-memory fallback if database query temporarily fails
    for (const keyDef of Object.values(KNOWN_INTEGRATION_KEYS)) {
      if (keyDef.apiKey && keyDef.secret && keyDef.apiKey === apiKey && keyDef.secret === apiSecret) {
        return {
          success: true,
          client: {
            id: `key_${keyDef.appName}`,
            appName: keyDef.appName,
            scope: keyDef.scope,
            branchRestriction: null,
            rateLimitPerMinute: 120,
          },
        };
      }
    }

    return {
      success: false,
      status: 500,
      error: "Kesalahan internal otentikasi integrasi.",
    };
  }
}

export async function logIntegrationSync(params: {
  incidentId: string;
  externalSystem: string;
  externalWorkId?: string;
  action: string;
  payload?: Record<string, unknown>;
  responseStatus?: number;
  ipAddress?: string;
}): Promise<void> {
  try {
    const pool = getDbPool();
    const id = `log_sync_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    await pool.query(
      `INSERT INTO integration_sync_logs (id, incident_id, external_system, external_work_id, action, payload, response_status, ip_address)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        id,
        params.incidentId,
        params.externalSystem,
        params.externalWorkId || null,
        params.action,
        JSON.stringify(params.payload || {}),
        params.responseStatus || 200,
        params.ipAddress || null,
      ]
    );
  } catch (err) {
    console.warn("[IntegrationSyncLog] Logging warning:", err);
  }
}
