import { Pool, PoolClient, PoolConfig, QueryConfig } from "pg";
import { getRuntimeConfig, isTestExecutionContext } from "./runtime-config";
import {
  areSameDatabaseCredentials,
  isDevelopmentIsolatedMode,
  isDevelopmentReadOnlyMode,
  isProductionDatabaseTarget,
  validateProductionDatabaseAccess,
} from "./environment-policy";

export { isProductionDatabaseTarget };

export interface ReadOnlyRoleAudit {
  dbUser: string;
  txReadOnly: string;
  isPrivilegedRole: boolean;
  hasTableWritePrivilege: boolean;
  hasSchemaCreatePrivilege: boolean;
}

const globalForDb = globalThis as unknown as {
  pool: Pool | undefined;
  productionPool: Pool | undefined;
  isolatedPool: Pool | undefined;
  readOnlyPool: Pool | undefined;
  readOnlyVerified: Promise<ReadOnlyRoleAudit> | undefined;
  testingModeActive: boolean | undefined;
};

export function isTestingModeActiveSync(): boolean {
  return Boolean(globalForDb.testingModeActive);
}

export function setTestingModeActiveSync(active: boolean): void {
  globalForDb.testingModeActive = Boolean(active);
}

function stripSqlCommentsAndLiterals(sql: string): { withoutComments: string; sanitizedForKeywords: string } {
  // Remove block comments and line comments first, preserving spaces so adjacent tokens never merge.
  const withoutComments = sql
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--[^\r\n]*/g, " ")
    .trim();

  // Strip string literals, dollar-quoted blocks, and double-quoted identifiers before keyword inspection
  // so data values such as 'UPDATE' or column names like "updated_at" never trigger false positives.
  const sanitizedForKeywords = withoutComments
    .replace(/\$\$[\s\S]*?\$\$/g, " '' ")
    .replace(/'(?:[^']|'')*'/g, " '' ")
    .replace(/"(?:[^"]|"")*"/g, ' "" ');

  return { withoutComments, sanitizedForKeywords };
}

const READONLY_FORBIDDEN_KEYWORD_REGEX =
  /\b(?:INSERT|UPDATE|DELETE|TRUNCATE|CREATE|ALTER|DROP|GRANT|REVOKE|LOCK|VACUUM|ANALYZE|CLUSTER|REINDEX|REFRESH|COPY|CALL|DO|DISCARD|LISTEN|NOTIFY|UNLISTEN|PREPARE|EXECUTE|DEALLOCATE|PG_ADVISORY_LOCK|PG_TRY_ADVISORY_LOCK|PG_ADVISORY_XACT_LOCK|PG_ADVISORY_XACT_LOCK_SHARED|PG_TRY_ADVISORY_XACT_LOCK|FOR\s+UPDATE|FOR\s+NO\s+KEY\s+UPDATE|FOR\s+SHARE|FOR\s+KEY\s+SHARE)\b/i;

export function assertReadOnlySql(sql: string): void {
  const { withoutComments, sanitizedForKeywords } = stripSqlCommentsAndLiterals(sql);
  if (!withoutComments) {
    throw new Error("READ_ONLY_DATABASE_VIOLATION: Query kosong ditolak pada mode Development Read-Only.");
  }

  // Reject stacked statements (any semicolon followed by non-whitespace outside string literals).
  const bodyNoTrailingSemi = sanitizedForKeywords.replace(/;\s*$/, "").trim();
  if (bodyNoTrailingSemi.includes(";")) {
    throw new Error("READ_ONLY_DATABASE_VIOLATION: Multi-statement SQL diblokir pada mode Development Read-Only.");
  }

  const normalized = bodyNoTrailingSemi.replace(/\s+/g, " ").trim();
  if (
    /^SET\s+SESSION\s+CHARACTERISTICS\s+AS\s+TRANSACTION\s+READ\s+ONLY$/i.test(normalized) ||
    /^SHOW\s+[A-Za-z0-9_]+$/i.test(normalized) ||
    /^BEGIN\s+READ\s+ONLY$/i.test(normalized) ||
    /^(?:COMMIT|ROLLBACK)$/i.test(normalized)
  ) {
    return;
  }

  if (!/^(?:SELECT|WITH)\b/i.test(normalized)) {
    throw new Error("READ_ONLY_DATABASE_VIOLATION: Query tulis/lock diblokir pada mode Development Read-Only.");
  }

  if (READONLY_FORBIDDEN_KEYWORD_REGEX.test(normalized)) {
    throw new Error("READ_ONLY_DATABASE_VIOLATION: Query tulis/lock diblokir pada mode Development Read-Only.");
  }
}

export async function verifyPostgresReadOnlyPermissions(queryable: {
  query: (sql: string) => Promise<{ rows: any[] }>;
}): Promise<ReadOnlyRoleAudit> {
  const { rows } = await queryable.query(`
    SELECT
      current_user AS db_user,
      current_setting('transaction_read_only') AS tx_read_only,
      COALESCE(r.rolsuper OR r.rolcreatedb OR r.rolcreaterole OR r.rolreplication OR r.rolbypassrls, true) AS is_privileged_role,
      EXISTS (
        SELECT 1
        FROM information_schema.tables t
        WHERE t.table_schema = 'public'
          AND t.table_type = 'BASE TABLE'
          AND (
            has_table_privilege(current_user, quote_ident(t.table_schema) || '.' || quote_ident(t.table_name), 'INSERT')
            OR has_table_privilege(current_user, quote_ident(t.table_schema) || '.' || quote_ident(t.table_name), 'UPDATE')
            OR has_table_privilege(current_user, quote_ident(t.table_schema) || '.' || quote_ident(t.table_name), 'DELETE')
            OR has_table_privilege(current_user, quote_ident(t.table_schema) || '.' || quote_ident(t.table_name), 'TRUNCATE')
          )
      ) AS has_table_write_privilege,
      has_schema_privilege(current_user, 'public', 'CREATE') AS has_schema_create_privilege
    FROM pg_roles r
    WHERE r.rolname = current_user
  `);

  const row = rows[0];
  if (!row) {
    throw new Error(
      "FATAL_READONLY_PERMISSION_VIOLATION: Role PostgreSQL aktif tidak dapat diverifikasi (pg_roles kosong). " +
      "Gunakan akun PostgreSQL SELECT-only (lihat database/readonly/setup_production_readonly_role.sql)."
    );
  }

  const audit: ReadOnlyRoleAudit = {
    dbUser: String(row.db_user || "unknown"),
    txReadOnly: String(row.tx_read_only || ""),
    isPrivilegedRole: Boolean(row.is_privileged_role),
    hasTableWritePrivilege: Boolean(row.has_table_write_privilege),
    hasSchemaCreatePrivilege: Boolean(row.has_schema_create_privilege),
  };

  if (
    audit.txReadOnly !== "on" ||
    audit.isPrivilegedRole ||
    audit.hasTableWritePrivilege ||
    audit.hasSchemaCreatePrivilege
  ) {
    throw new Error(
      `FATAL_READONLY_PERMISSION_VIOLATION: Role PostgreSQL '${audit.dbUser}' masih memiliki hak tulis/DDL ` +
      `atau transaction_read_only='${audit.txReadOnly}'. Gunakan akun PostgreSQL SELECT-only ` +
      "(lihat database/readonly/setup_production_readonly_role.sql)."
    );
  }

  return audit;
}

export function getProductionDbPool(): Pool {
  if (isDevelopmentReadOnlyMode()) {
    throw new Error(
      "FATAL_DATABASE_SAFETY_VIOLATION: Write production pool is forbidden in Development Read-Only mode. " +
      "Use getProductionReadOnlyDbPool() instead."
    );
  }

  // CRITICAL FAIL-CLOSED SAFETY GUARD:
  // Automated test scripts, test runners, or simulations must NEVER connect to production database 'siaga'.
  if (isTestExecutionContext() && !process.env.ALLOW_PRODUCTION_TEST_RUN) {
    throw new Error(
      "FATAL_DATABASE_SAFETY_VIOLATION: Automated test execution context detected attempting to connect to getProductionDbPool(). " +
      "Connecting to production database 'siaga' (103.127.99.241) from test suites is strictly prohibited. " +
      "Use getIsolatedDbPool() instead."
    );
  }

  const prodAccess = validateProductionDatabaseAccess();
  if (!prodAccess.allowed) {
    throw new Error(`FATAL_DATABASE_SAFETY_VIOLATION: ${prodAccess.reason}`);
  }

  if (!globalForDb.productionPool) {
    const config = getRuntimeConfig();
    const rawConnectionString = config.databaseUrl;

    if (!rawConnectionString || rawConnectionString.includes("siaga_blocked") || rawConnectionString.includes("siaga_write_blocked")) {
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

function buildReadOnlyPoolSsl(roUrl: string, config: ReturnType<typeof getRuntimeConfig>): PoolConfig["ssl"] {
  const explicitSslMode = process.env.DATABASE_SSL_MODE?.trim().toLowerCase();
  if (explicitSslMode === "disable" || /sslmode=disable/i.test(roUrl)) {
    return false;
  }
  if ((explicitSslMode === "verify-full" || /sslmode=verify-full/i.test(roUrl)) && config.dbSslCa) {
    return {
      rejectUnauthorized: true,
      ca: config.dbSslCa,
    };
  }
  if (explicitSslMode === "require" || /sslmode=require/i.test(roUrl)) {
    return { rejectUnauthorized: false };
  }
  return config.dbSslMode === "disable" ? false : { rejectUnauthorized: false };
}

function wrapReadOnlyPool(rawPool: Pool): Pool {
  const ensureVerified = async () => {
    if (!globalForDb.readOnlyVerified) {
      globalForDb.readOnlyVerified = verifyPostgresReadOnlyPermissions(rawPool).catch((err) => {
        globalForDb.readOnlyVerified = undefined;
        throw err;
      });
    }
    return globalForDb.readOnlyVerified;
  };

  const extractSqlText = (queryTextOrConfig: string | QueryConfig): string =>
    typeof queryTextOrConfig === "string" ? queryTextOrConfig : queryTextOrConfig?.text || "";

  return new Proxy(rawPool, {
    get(target, prop, receiver) {
      if (prop === "query") {
        return async (queryTextOrConfig: string | QueryConfig, values?: unknown[]) => {
          await ensureVerified();
          assertReadOnlySql(extractSqlText(queryTextOrConfig));
          return values !== undefined
            ? (target.query as any)(queryTextOrConfig, values)
            : (target.query as any)(queryTextOrConfig);
        };
      }
      if (prop === "connect") {
        return async () => {
          await ensureVerified();
          const client: PoolClient = await target.connect();
          return new Proxy(client, {
            get(cTarget, cProp, cReceiver) {
              if (cProp === "query") {
                return async (queryTextOrConfig: string | QueryConfig, values?: unknown[]) => {
                  assertReadOnlySql(extractSqlText(queryTextOrConfig));
                  return values !== undefined
                    ? (cTarget.query as any)(queryTextOrConfig, values)
                    : (cTarget.query as any)(queryTextOrConfig);
                };
              }
              const val = Reflect.get(cTarget, cProp, cReceiver);
              return typeof val === "function" ? val.bind(cTarget) : val;
            },
          });
        };
      }
      const val = Reflect.get(target, prop, receiver);
      return typeof val === "function" ? val.bind(target) : val;
    },
  });
}

export function getProductionReadOnlyDbPool(): Pool {
  if (!isDevelopmentReadOnlyMode()) {
    throw new Error(
      "FATAL_DATABASE_SAFETY_VIOLATION: getProductionReadOnlyDbPool() is only available in Development Production-ReadOnly mode."
    );
  }

  if (!globalForDb.readOnlyPool) {
    const config = getRuntimeConfig();
    const roUrl = (config.productionReadOnlyDatabaseUrl || process.env.SPARTA_PRODUCTION_READONLY_DATABASE_URL || "").trim();
    const writeCheckUrl =
      process.env.SPARTA_WRITE_DATABASE_URL_FOR_CHECK?.trim() ||
      (isProductionDatabaseTarget(config.databaseUrl) ? config.databaseUrl : undefined);

    if (!roUrl || areSameDatabaseCredentials(roUrl, writeCheckUrl)) {
      throw new Error(
        "FATAL_DATABASE_SAFETY_VIOLATION: SPARTA_PRODUCTION_READONLY_DATABASE_URL missing or reuses write credentials."
      );
    }

    const connectionString = roUrl.replace(/\?sslmode=[^&]+/, "");
    const rawPool = new Pool({
      connectionString,
      max: Math.min(config.dbPoolMax, 4),
      idleTimeoutMillis: config.dbIdleTimeoutMs,
      connectionTimeoutMillis: config.dbConnectionTimeoutMs,
      ssl: buildReadOnlyPoolSsl(roUrl, config),
      options: "-c default_transaction_read_only=on",
    });

    rawPool.on("connect", (client) => {
      client.query("SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY").catch(() => {});
    });

    rawPool.on("error", (err) => {
      console.error("[Production Read-Only Database Pool] Unexpected error on idle client:", err);
    });

    globalForDb.readOnlyPool = wrapReadOnlyPool(rawPool);
  }

  return globalForDb.readOnlyPool;
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
  // Test runner processes ALWAYS route to isolated pool (or mock globalThis.isolatedPool).
  if (isTestExecutionContext()) {
    return getIsolatedDbPool();
  }
  if (isDevelopmentReadOnlyMode()) {
    return getProductionReadOnlyDbPool();
  }
  if (isDevelopmentIsolatedMode() || isTestingModeActiveSync()) {
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
  const ro = globalForDb.readOnlyPool;
  const legacy = globalForDb.pool;
  globalForDb.productionPool = undefined;
  globalForDb.isolatedPool = undefined;
  globalForDb.readOnlyPool = undefined;
  globalForDb.readOnlyVerified = undefined;
  globalForDb.pool = undefined;
  if (prod) await prod.end();
  if (iso) await iso.end();
  if (ro) await ro.end();
  if (legacy && legacy !== prod && legacy !== iso && legacy !== ro) await legacy.end();
}
