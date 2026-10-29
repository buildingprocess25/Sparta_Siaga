import { Pool, PoolConfig } from "pg";
import { getRuntimeConfig, isTestExecutionContext } from "./runtime-config";

const globalForDb = globalThis as unknown as {
  pool: Pool | undefined;
  productionPool: Pool | undefined;
  isolatedPool: Pool | undefined;
  testingModeActive: boolean | undefined;
};

export function isTestingModeActiveSync(): boolean {
  return Boolean(globalForDb.testingModeActive);
}

export function setTestingModeActiveSync(active: boolean): void {
  globalForDb.testingModeActive = Boolean(active);
}

export function isProductionDatabaseTarget(connectionString: string): boolean {
  if (!connectionString) return false;
  return (
    /103\.127\.99\.241/i.test(connectionString) ||
    /\/siaga(\?|$)/i.test(connectionString)
  );
}

export function getProductionDbPool(): Pool {
  // CRITICAL FAIL-CLOSED SAFETY GUARD:
  // Automated test scripts, test runners, or UAT simulations must NEVER connect to production database 'siaga'.
  if (isTestExecutionContext() && !process.env.ALLOW_PRODUCTION_TEST_RUN) {
    throw new Error(
      "FATAL_DATABASE_SAFETY_VIOLATION: Automated test execution context detected attempting to connect to getProductionDbPool(). " +
      "Connecting to production database 'siaga' (103.127.99.241) from test suites is strictly prohibited. " +
      "Use getIsolatedDbPool() instead."
    );
  }

  if (!globalForDb.productionPool) {
    const config = getRuntimeConfig();
    const rawConnectionString = config.databaseUrl;

    if (!rawConnectionString || rawConnectionString.includes("siaga_blocked")) {
      throw new Error(
        "FATAL_DATABASE_SAFETY_VIOLATION: Production database pool requested but DATABASE_URL is not configured."
      );
    }

    const connectionString = rawConnectionString.replace(/\?sslmode=[^&]+/, "");

    const poolConfig: PoolConfig = {
      connectionString,
      max: config.dbPoolMax,
      idleTimeoutMillis: config.dbIdleTimeoutMs,
      connectionTimeoutMillis: config.dbConnectionTimeoutMs,
    };

    if (config.dbSslMode === "disable") {
      poolConfig.ssl = false;
    } else if (config.dbSslMode === "verify-full") {
      poolConfig.ssl = {
        rejectUnauthorized: true,
        ca: config.dbSslCa,
      };
    } else {
      poolConfig.ssl = {
        rejectUnauthorized: false,
      };
    }

    globalForDb.productionPool = new Pool(poolConfig);

    globalForDb.productionPool.on("error", (err) => {
      console.error("[Production Database Pool] Unexpected error on idle client:", err);
    });
  }

  return globalForDb.productionPool;
}

export function getIsolatedDbPool(): Pool {
  if (!globalForDb.isolatedPool) {
    const config = getRuntimeConfig();
    // STRICT ISOLATION: NEVER fall back to config.databaseUrl (production).
    const rawConnectionString =
      config.isolatedDatabaseUrl ||
      process.env.SPARTA_ISOLATED_TEST_DATABASE_URL;

    if (!rawConnectionString) {
      throw new Error(
        "FATAL_DATABASE_SAFETY_VIOLATION: getIsolatedDbPool() called but no SPARTA_ISOLATED_TEST_DATABASE_URL is configured. " +
        "Automatic fallback from isolated testing database to production 'siaga' is strictly prohibited."
      );
    }

    if (isProductionDatabaseTarget(rawConnectionString)) {
      throw new Error(
        "FATAL_DATABASE_SAFETY_VIOLATION: SPARTA_ISOLATED_TEST_DATABASE_URL points to production database 'siaga' (103.127.99.241). " +
        "Isolated testing pool must strictly target the isolated Aiven database, never production."
      );
    }

    const connectionString = rawConnectionString.replace(/\?sslmode=[^&]+/, "");
    const ca = config.dbSslCa;

    const poolConfig: PoolConfig = {
      connectionString,
      max: config.dbPoolMax,
      idleTimeoutMillis: config.dbIdleTimeoutMs,
      connectionTimeoutMillis: config.dbConnectionTimeoutMs,
      ssl: ca ? { rejectUnauthorized: true, ca } : { rejectUnauthorized: false },
    };

    globalForDb.isolatedPool = new Pool(poolConfig);

    globalForDb.isolatedPool.on("error", (err) => {
      console.error("[Isolated Database Pool] Unexpected error on idle client:", err);
    });
  }

  return globalForDb.isolatedPool;
}

export function getOperationalDbPool(): Pool {
  // If running in test context (e.g. tsx test script, jest, test mode), ALWAYS route to isolated pool
  if (isTestExecutionContext() || isTestingModeActiveSync()) {
    return getIsolatedDbPool();
  }
  return getProductionDbPool();
}

export function getDbPool(): Pool {
  return getOperationalDbPool();
}

export async function closeDbPool(): Promise<void> {
  const prod = globalForDb.productionPool;
  const iso = globalForDb.isolatedPool;
  const legacy = globalForDb.pool;
  globalForDb.productionPool = undefined;
  globalForDb.isolatedPool = undefined;
  globalForDb.pool = undefined;
  if (prod) await prod.end();
  if (iso) await iso.end();
  if (legacy && legacy !== prod && legacy !== iso) await legacy.end();
}
