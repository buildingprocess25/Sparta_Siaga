import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { Pool } from "pg";
import {
  areSameDatabaseCredentials,
  isProductionDatabaseTarget,
} from "../lib/environment-policy";
import { verifyPostgresReadOnlyPermissions } from "../lib/db";

function loadEnvFile(filename: string): Record<string, string> {
  const fullPath = path.resolve(process.cwd(), filename);
  const parsed: Record<string, string> = {};
  if (!fs.existsSync(fullPath)) return parsed;
  for (const line of fs.readFileSync(fullPath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)?\s*$/);
    if (!match) continue;
    let val = (match[2] || "").trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    parsed[match[1]] = val;
  }
  return parsed;
}

function isIsolatedAivenUrl(value: string | undefined): value is string {
  if (!value) return false;
  const trimmed = value.trim();
  if (isProductionDatabaseTarget(trimmed)) return false;
  try {
    const url = new URL(trimmed);
    return (
      (url.protocol === "postgresql:" || url.protocol === "postgres:") &&
      url.hostname.toLowerCase().endsWith(".aivencloud.com") &&
      decodeURIComponent(url.pathname) === "/sparta_siaga_isolated" &&
      [...url.searchParams.keys()].every((key) => key === "sslmode")
    );
  } catch {
    return false;
  }
}

function isValidPostgresUrl(value: string | undefined): value is string {
  if (!value) return false;
  try {
    const url = new URL(value.trim());
    return (
      (url.protocol === "postgresql:" || url.protocol === "postgres:") &&
      url.hostname.trim().length > 0 &&
      decodeURIComponent(url.username).trim().length > 0 &&
      decodeURIComponent(url.pathname).replace(/^\/+/, "").length > 0
    );
  } catch {
    return false;
  }
}

function buildReadOnlySsl(roUrl: string, env: Record<string, string>) {
  const mode = (env.DATABASE_SSL_MODE || "").trim().toLowerCase();
  if (mode === "disable" || /sslmode=disable/i.test(roUrl)) return false as const;
  const caBase64 = (env.DATABASE_SSL_CA_BASE64 || "").trim();
  if ((mode === "verify-full" || /sslmode=verify-full/i.test(roUrl)) && caBase64) {
    return { rejectUnauthorized: true, ca: Buffer.from(caBase64, "base64").toString("utf8") };
  }
  return { rejectUnauthorized: false };
}

async function run() {
  const args = process.argv.slice(2);
  const dryRunEnv = args.includes("--dry-run-env");
  const rawArg = (args.find((a) => !a.startsWith("-")) || "isolated").trim().toLowerCase();

  let dataMode: "isolated" | "production-readonly";
  if (rawArg === "isolated" || rawArg === "development" || rawArg === "dev" || rawArg === "local") {
    dataMode = "isolated";
  } else if (rawArg === "prod-readonly" || rawArg === "production-readonly" || rawArg === "readonly") {
    dataMode = "production-readonly";
  } else if (rawArg === "uat" || rawArg === "staging") {
    console.error("[run-dev] Environment 'uat' telah dihapus. Gunakan 'pnpm dev:local' (Aiven terisolasi) atau 'pnpm dev:prod-readonly' (Production Read-Only).");
    process.exit(1);
  } else {
    console.error(`[run-dev] Mode '${rawArg}' tidak dikenali. Gunakan 'isolated' atau 'prod-readonly'.`);
    process.exit(1);
  }

  const envDevLocal = loadEnvFile(".env.development.local");
  const envLocal = loadEnvFile(".env.local");
  const combinedSourceEnv: Record<string, string> = {
    ...envLocal,
    ...envDevLocal,
    ...(Object.fromEntries(Object.entries(process.env).filter(([, v]) => typeof v === "string")) as Record<string, string>),
  };

  let mergedEnv: NodeJS.ProcessEnv;

  if (dataMode === "isolated") {
    const candidateDbUrl = [
      envDevLocal.DATABASE_URL,
      envDevLocal.SPARTA_ISOLATED_TEST_DATABASE_URL,
      process.env.SPARTA_ISOLATED_TEST_DATABASE_URL,
      envLocal.SPARTA_ISOLATED_TEST_DATABASE_URL,
      process.env.DATABASE_URL,
    ].find((val) => isIsolatedAivenUrl(val));

    if (!candidateDbUrl) {
      console.error("==================================================================");
      console.error("[SPARTA SIAGA] BLOCKED — Isolated Aiven DB URI belum dikonfigurasi.");
      console.error("Set Service URI Aiven 'sparta_siaga_isolated' pada .env.development.local (DATABASE_URL=...)");
      console.error("atau pada .env.local (SPARTA_ISOLATED_TEST_DATABASE_URL=...).");
      console.error("Catatan: Aiven memiliki batas 1 GB RAM / 1 GB Storage; jangan menyalin seluruh DB Production.");
      console.error("Runner menolak berjalan dengan target database production (/siaga).");
      console.error("==================================================================");
      process.exit(1);
    }

    mergedEnv = {
      ...envLocal,
      ...envDevLocal,
      ...process.env,
      NODE_ENV: "development",
      APP_ENV: "development",
      SPARTA_ENVIRONMENT: "development",
      SPARTA_DEV_DATA_MODE: "isolated",
      DATABASE_URL: candidateDbUrl,
      SPARTA_ISOLATED_TEST_DATABASE_URL: candidateDbUrl,
      SPARTA_PRODUCTION_READONLY_DATABASE_URL: "",
      SPARTA_WRITE_DATABASE_URL_FOR_CHECK: "",
      DATABASE_SSL_MODE: "require",
      SPARTA_AUTONOMOUS_WORKER_ENABLED: "false",
      SPARTA_AUTONOMOUS_WEATHER_ALERTS: "false",
      EMAIL_NOTIFICATIONS_ENABLED: "false",
      SPARTA_BRANCH_MASTER_ENABLED: "false",
      STORE_MASTER_SOURCE: "sheet",
      SPARTA_INTERNAL_API_KEY: "",
      SPARTA_PROVISIONING_SECRET: "",
      SPARTA_MAINTENANCE_API_KEY: "",
      SPARTA_MAINTENANCE_API_SECRET: "",
      ENGINEERING_SUPPORT_API_KEY: "",
      ENGINEERING_SUPPORT_API_SECRET: "",
    };

    console.log("==================================================================");
    console.log("SPARTA SIAGA — SERVER RUNNER [MODE: DEVELOPMENT ISOLATED]");
    console.log("• Database  : Aiven sparta_siaga_isolated (SSL require)");
    console.log("• Fungsi    : Quick Login 9 Role, simulasi, testing CRUD, migrate:isolated");
    console.log("• Worker    : DINONAKTIFKAN (autonomous worker & email alerts off)");
    console.log("• Integrasi : Kredensial eksternal production dikosongkan");
    console.log("• URL Local : http://localhost:3004");
    console.log("==================================================================");
  } else {
    const roUrl = [
      process.env.SPARTA_PRODUCTION_READONLY_DATABASE_URL,
      envDevLocal.SPARTA_PRODUCTION_READONLY_DATABASE_URL,
      envLocal.SPARTA_PRODUCTION_READONLY_DATABASE_URL,
    ]
      .find((val) => val && val.trim().length > 0)
      ?.trim();

    const writeDbUrl = (
      envDevLocal.DATABASE_URL ||
      envLocal.DATABASE_URL ||
      process.env.DATABASE_URL ||
      ""
    ).trim();

    if (!isValidPostgresUrl(roUrl)) {
      console.error("==================================================================");
      console.error("[SPARTA SIAGA] BLOCKED — SPARTA_PRODUCTION_READONLY_DATABASE_URL belum dikonfigurasi.");
      console.error("Tambahkan akun PostgreSQL SELECT-only di .env.local / .env.development.local:");
      console.error("  SPARTA_PRODUCTION_READONLY_DATABASE_URL=\"postgresql://sparta_siaga_readonly:<pw>@<host>:5432/siaga?sslmode=require\"");
      console.error("Provisioning role DBA tersedia di: database/readonly/setup_production_readonly_role.sql");
      console.error("Runner tidak pernah fallback ke DATABASE_URL biasa.");
      console.error("==================================================================");
      process.exit(1);
    }

    if (areSameDatabaseCredentials(roUrl, writeDbUrl)) {
      console.error("==================================================================");
      console.error("[SPARTA SIAGA] BLOCKED — SPARTA_PRODUCTION_READONLY_DATABASE_URL menggunakan kredensial yang sama dengan DATABASE_URL.");
      console.error("Mode Production Read-Only WAJIB memakai role PostgreSQL khusus read-only (mis. sparta_siaga_readonly).");
      console.error("==================================================================");
      process.exit(1);
    }

    if (!dryRunEnv) {
      const checkPool = new Pool({
        connectionString: roUrl.replace(/\?sslmode=[^&]+/, ""),
        max: 1,
        connectionTimeoutMillis: 10000,
        ssl: buildReadOnlySsl(roUrl, combinedSourceEnv),
        options: "-c default_transaction_read_only=on",
      });
      try {
        const audit = await verifyPostgresReadOnlyPermissions(checkPool);
        console.log(
          `[SPARTA SIAGA] Verifikasi PostgreSQL Read-Only OK: user='${audit.dbUser}', transaction_read_only=${audit.txReadOnly}`
        );
      } catch (err) {
        console.error("==================================================================");
        console.error("[SPARTA SIAGA] BLOCKED — Role PostgreSQL Production Read-Only gagal verifikasi:");
        console.error(err instanceof Error ? err.message : String(err));
        console.error("==================================================================");
        process.exit(1);
      } finally {
        await checkPool.end().catch(() => {});
      }
    }

    mergedEnv = {
      ...envLocal,
      ...envDevLocal,
      ...process.env,
      NODE_ENV: "development",
      APP_ENV: "development",
      SPARTA_ENVIRONMENT: "development",
      SPARTA_DEV_DATA_MODE: "production-readonly",
      SPARTA_PRODUCTION_READONLY_DATABASE_URL: roUrl,
      SPARTA_WRITE_DATABASE_URL_FOR_CHECK: writeDbUrl,
      DATABASE_URL: "postgresql://readonly-guard@127.0.0.1:5432/siaga_write_blocked",
      SPARTA_AUTONOMOUS_WORKER_ENABLED: "false",
      SPARTA_AUTONOMOUS_WEATHER_ALERTS: "false",
      SPARTA_ALLOW_TEST_SIMULATION: "false",
      EMAIL_NOTIFICATIONS_ENABLED: "false",
      VAPID_PRIVATE_KEY: "",
      SMTP_HOST: "",
      SMTP_USER: "",
      SMTP_PASS: "",
      SPARTA_INTERNAL_API_KEY: "",
      SPARTA_PROVISIONING_SECRET: "",
      SPARTA_INTERNAL_WORKER_SECRET: "",
      SPARTA_MAINTENANCE_API_KEY: "",
      SPARTA_MAINTENANCE_API_SECRET: "",
      ENGINEERING_SUPPORT_API_KEY: "",
      ENGINEERING_SUPPORT_API_SECRET: "",
    };

    console.log("==================================================================");
    console.log("SPARTA SIAGA — SERVER RUNNER [MODE: DEVELOPMENT PRODUCTION READ-ONLY]");
    console.log("• Database  : Production SELECT-Only (PostgreSQL permission-enforced)");
    console.log("• Auth      : Quick Login 9 Role in-memory (ZERO write ke Production DB)");
    console.log("• Proteksi  : Write/CRUD, simulasi, provisioning, worker, & notifikasi DIBLOKIR");
    console.log("• URL Local : http://localhost:3004");
    console.log("==================================================================");
  }

  if (dryRunEnv) {
    console.log(JSON.stringify({
      ok: true,
      dataMode,
      appEnv: mergedEnv.APP_ENV,
      spartaEnv: mergedEnv.SPARTA_ENVIRONMENT,
      devDataMode: mergedEnv.SPARTA_DEV_DATA_MODE,
      workerEnabled: mergedEnv.SPARTA_AUTONOMOUS_WORKER_ENABLED,
      emailEnabled: mergedEnv.EMAIL_NOTIFICATIONS_ENABLED,
    }));
    return;
  }

  const nextBin = path.resolve(process.cwd(), "node_modules/next/dist/bin/next");
  const bindHost = process.env.DEV_BIND_HOST?.trim() || "localhost";
  const child = spawn(
    process.execPath,
    ["--max-old-space-size=4096", nextBin, "dev", "-p", "3004", "-H", bindHost, "--webpack"],
    {
      stdio: "inherit",
      env: mergedEnv,
    }
  );

  child.on("exit", (code) => {
    process.exit(code ?? 0);
  });
}

run().catch((err) => {
  console.error("[run-dev] Fatal error:", err);
  process.exit(1);
});
