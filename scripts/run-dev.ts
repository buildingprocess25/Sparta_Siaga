import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

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
  if (/103\.127\.99\.241/i.test(trimmed) || /\/siaga(\?|$)/i.test(trimmed)) return false;
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

const rawArg = (process.argv[2] || "development").trim().toLowerCase();
const targetEnv = rawArg === "staging" ? "uat" : rawArg;
if (targetEnv !== "development" && targetEnv !== "uat") {
  console.error(`[run-dev] Unsupported target environment '${rawArg}'. Use 'development' or 'uat'.`);
  process.exit(1);
}

const envOverrideFile = `.env.${targetEnv}.local`;
const envOverride = loadEnvFile(envOverrideFile);
const envLocal = loadEnvFile(".env.local");

const candidateDbUrl = [
  envOverride.DATABASE_URL,
  envOverride.SPARTA_ISOLATED_TEST_DATABASE_URL,
  process.env.SPARTA_ISOLATED_TEST_DATABASE_URL,
  envLocal.SPARTA_ISOLATED_TEST_DATABASE_URL,
  process.env.DATABASE_URL,
].find((val) => isIsolatedAivenUrl(val));

if (!candidateDbUrl) {
  console.error("==================================================================");
  console.error(`[SPARTA SIAGA] BLOCKED — Isolated Aiven DB URI (${targetEnv.toUpperCase()}) belum dikonfigurasi.`);
  console.error(`Set Service URI Aiven 'sparta_siaga_isolated' pada ${envOverrideFile} (DATABASE_URL=...)`);
  console.error("atau pada .env.local (SPARTA_ISOLATED_TEST_DATABASE_URL=...).");
  console.error("Runner menolak berjalan dengan target database production (/siaga).");
  console.error("==================================================================");
  process.exit(1);
}

const mergedEnv: NodeJS.ProcessEnv = {
  ...envLocal,
  ...envOverride,
  ...process.env,
  APP_ENV: targetEnv,
  SPARTA_ENVIRONMENT: targetEnv,
  DATABASE_URL: candidateDbUrl,
  SPARTA_ISOLATED_TEST_DATABASE_URL: candidateDbUrl,
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
console.log(`SPARTA SIAGA — SERVER RUNNER [MODE: ${targetEnv.toUpperCase()}]`);
console.log("• Database  : Aiven sparta_siaga_isolated (SSL require)");
console.log("• Worker    : DINONAKTIFKAN (autonomous worker & email alerts off)");
console.log("• Integrasi : Kredensial eksternal production dikosongkan");
if (targetEnv === "development") {
  console.log("• Auth      : Quick Login 9 Role (loopback langsung; tunnel wajib Gate Passcode)");
  console.log("• SSO       : Tidak redirect ke Portal SPARTA SSO");
  console.log("• URL Local : http://localhost:3004");
} else {
  console.log("• Auth      : Quick Login 9 Role terproteksi Gate Passcode (termasuk localhost)");
  console.log("• SSO       : Tidak redirect ke Portal SPARTA SSO");
  console.log("• URL Local : http://localhost:3004");
  if (mergedEnv.SPARTA_TEST_GATE_ENABLED !== "true" || (mergedEnv.UAT_GATE_PASSCODE || "").trim().length < 12) {
    console.warn("• Peringatan: SPARTA_TEST_GATE_ENABLED=true & UAT_GATE_PASSCODE (>=12 karakter) diperlukan agar gate UAT aktif.");
  }
}
console.log("==================================================================");

const nextBin = path.resolve(process.cwd(), "node_modules/next/dist/bin/next");
const child = spawn(
  process.execPath,
  ["--max-old-space-size=4096", nextBin, "dev", "-p", "3004", "-H", "0.0.0.0", "--webpack"],
  {
    stdio: "inherit",
    env: mergedEnv,
  }
);

child.on("exit", (code) => {
  process.exit(code ?? 0);
});

