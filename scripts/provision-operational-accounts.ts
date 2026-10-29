import fs from "fs/promises";
import path from "path";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import { getDbPool, closeDbPool } from "../lib/db";
import { revokeAllUserSessions } from "../lib/session-service";

export interface OperationalAccountConfig {
  id: string;
  nik: string;
  name: string;
  email: string;
  systemRole: "USER";
  businessRole: "bms" | "bmc" | "bes" | "bec" | "bbs" | "bbc" | "bm";
  scope: "BRANCH";
  branch: "BANDUNG" | "CIKOKOL";
  status: "ACTIVE";
  envPasswordKey: string;
  roleDescription: string;
}

export const OPERATIONAL_ACCOUNTS: OperationalAccountConfig[] = [
  // BANDUNG (7 Accounts)
  {
    id: "usr_bms_bdg_01",
    nik: "BMS0001",
    name: "BMS Bandung",
    email: "bms0001@sparta-siaga.local",
    systemRole: "USER",
    businessRole: "bms",
    scope: "BRANCH",
    branch: "BANDUNG",
    status: "ACTIVE",
    envPasswordKey: "UAT_BMS0001_PASSWORD",
    roleDescription: "Branch Maintenance Support — Pemeriksaan lapangan & bukti foto",
  },
  {
    id: "usr_bmc_bdg_01",
    nik: "BMC0001",
    name: "BMC Bandung",
    email: "bmc0001@sparta-siaga.local",
    systemRole: "USER",
    businessRole: "bmc",
    scope: "BRANCH",
    branch: "BANDUNG",
    status: "ACTIVE",
    envPasswordKey: "UAT_BMC0001_PASSWORD",
    roleDescription: "Branch Maintenance Coordinator — Verifikasi hasil & Serah Terima",
  },
  {
    id: "usr_bes_bdg_01",
    nik: "BES0001",
    name: "BES Bandung",
    email: "bes0001@sparta-siaga.local",
    systemRole: "USER",
    businessRole: "bes",
    scope: "BRANCH",
    branch: "BANDUNG",
    status: "ACTIVE",
    envPasswordKey: "UAT_BES0001_PASSWORD",
    roleDescription: "Branch Engineering Support — Pemeriksaan DC & fasilitas",
  },
  {
    id: "usr_bec_bdg_01",
    nik: "BEC0001",
    name: "BEC Bandung",
    email: "bec0001@sparta-siaga.local",
    systemRole: "USER",
    businessRole: "bec",
    scope: "BRANCH",
    branch: "BANDUNG",
    status: "ACTIVE",
    envPasswordKey: "UAT_BEC0001_PASSWORD",
    roleDescription: "Branch Engineering Coordinator — Verifikasi DC & fasilitas",
  },
  {
    id: "usr_bbs_bdg_01",
    nik: "BBS0001",
    name: "BBS Bandung",
    email: "bbs0001@sparta-siaga.local",
    systemRole: "USER",
    businessRole: "bbs",
    scope: "BRANCH",
    branch: "BANDUNG",
    status: "ACTIVE",
    envPasswordKey: "UAT_BBS0001_PASSWORD",
    roleDescription: "Branch Building Support — Pemeriksaan bangunan fisik",
  },
  {
    id: "usr_bbc_bdg_01",
    nik: "BBC0001",
    name: "BBC Bandung",
    email: "bbc0001@sparta-siaga.local",
    systemRole: "USER",
    businessRole: "bbc",
    scope: "BRANCH",
    branch: "BANDUNG",
    status: "ACTIVE",
    envPasswordKey: "UAT_BBC0001_PASSWORD",
    roleDescription: "Branch Building Coordinator — Verifikasi pekerjaan sipil bangunan",
  },
  {
    id: "usr_bm_bdg_01",
    nik: "BM0001",
    name: "BnM Manajer Bandung",
    email: "bm0001@sparta-siaga.local",
    systemRole: "USER",
    businessRole: "bm",
    scope: "BRANCH",
    branch: "BANDUNG",
    status: "ACTIVE",
    envPasswordKey: "UAT_BM0001_PASSWORD",
    roleDescription: "BnM Manajer Cabang — Konfirmasi kerusakan, approval & penutupan kasus",
  },

  // CIKOKOL (2 Accounts)
  {
    id: "usr_bms_ckl_02",
    nik: "BMS0002",
    name: "BMS Cikokol",
    email: "bms0002@sparta-siaga.local",
    systemRole: "USER",
    businessRole: "bms",
    scope: "BRANCH",
    branch: "CIKOKOL",
    status: "ACTIVE",
    envPasswordKey: "UAT_BMS0002_PASSWORD",
    roleDescription: "Branch Maintenance Support — Petugas lapangan cabang Cikokol",
  },
  {
    id: "usr_bm_ckl_02",
    nik: "BM0002",
    name: "BnM Manajer Cikokol",
    email: "bm0002@sparta-siaga.local",
    systemRole: "USER",
    businessRole: "bm",
    scope: "BRANCH",
    branch: "CIKOKOL",
    status: "ACTIVE",
    envPasswordKey: "UAT_BM0002_PASSWORD",
    roleDescription: "BnM Manajer Cabang — Pengambil keputusan cabang Cikokol",
  },
];

/**
 * Generates an easy-to-type, unambiguous lowercase alphanumeric password (minimum 12 chars).
 * Characters: abcdefghjkmnpqrstuvwxyz23456789 (14 chars)
 */
function generateEasyToTypePassword(length: number = 14): string {
  const chars = "abcdefghjkmnpqrstuvwxyz23456789";
  let password = "";
  const randomBytes = crypto.randomBytes(length);
  for (let i = 0; i < length; i++) {
    password += chars[randomBytes[i] % chars.length];
  }
  return password;
}

export async function provisionOperationalAccounts(): Promise<void> {
  const isApply = process.argv.includes("--apply");

  console.log("================================================================================");
  console.log(" SPARTA SIAGA — OPERATIONAL TEST ACCOUNTS PROVISIONING (9 ACCOUNTS)");
  console.log(` Mode: ${isApply ? "🔴 LIVE EXECUTION (--apply)" : "🔍 DRY RUN (Preview only)"}`);
  console.log("================================================================================\n");

  const pool = getDbPool();

  const dbRes = await pool.query("SELECT current_database() as db_name, version() as pg_version");
  const currentDb = dbRes.rows[0]?.db_name;
  console.log(`[Database] Connected to: ${currentDb}`);

  // Load existing credentials from .env.pilot-credentials.local
  const credFilePath = path.join(process.cwd(), ".env.pilot-credentials.local");
  let existingCredContent = "";
  const existingCreds: Record<string, string> = {};

  try {
    existingCredContent = await fs.readFile(credFilePath, "utf8");
    for (const line of existingCredContent.split("\n")) {
      const match = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*["']?([^"'\r\n]+)["']?\s*$/);
      if (match) {
        existingCreds[match[1]] = match[2];
      }
    }
  } catch {
    console.log("[Credentials] .env.pilot-credentials.local not found, will create fresh.");
  }

  const assignedPasswords: Record<string, string> = {};
  const newCredEntries: string[] = [];

  for (const acc of OPERATIONAL_ACCOUNTS) {
    if (existingCreds[acc.envPasswordKey]) {
      assignedPasswords[acc.envPasswordKey] = existingCreds[acc.envPasswordKey];
    } else {
      const genPassword = generateEasyToTypePassword(14);
      assignedPasswords[acc.envPasswordKey] = genPassword;
      newCredEntries.push(`${acc.envPasswordKey}="${genPassword}"`);
    }
  }

  // Preview accounts
  console.log("--- ACCOUNT SPECIFICATIONS ---");
  for (const acc of OPERATIONAL_ACCOUNTS) {
    const pwd = assignedPasswords[acc.envPasswordKey];
    console.log(`• NIK: ${acc.nik.padEnd(8)} | Role: ${acc.businessRole.padEnd(5)} | Branch: ${acc.branch.padEnd(8)} | Name: ${acc.name.padEnd(22)} | Key: ${acc.envPasswordKey} (${pwd.length} chars)`);
  }

  if (!isApply) {
    console.log("\n[DRY RUN COMPLETED] No database writes or file changes were performed.");
    console.log("Run with '--apply' to execute provisioning and update .env.pilot-credentials.local.");
    return;
  }

  // 1. Update .env.pilot-credentials.local without overwriting existing entries
  if (newCredEntries.length > 0) {
    console.log(`\n[Credentials] Appending ${newCredEntries.length} new operational credentials to .env.pilot-credentials.local...`);
    const header = existingCredContent.trim().length > 0 ? "\n\n# Operational Test Accounts (Bandung & Cikokol)\n" : "# Operational Test Accounts\n";
    const updatedContent = existingCredContent.trim() + header + newCredEntries.join("\n") + "\n";
    await fs.writeFile(credFilePath, updatedContent, "utf8");
    console.log("[Credentials] .env.pilot-credentials.local safely updated.");
  } else {
    console.log("\n[Credentials] All operational credentials already present. Preserving existing values.");
  }

  // 2. Ensure schema support for token_version
  await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS token_version INTEGER DEFAULT 1;");

  // 3. Upsert operational accounts
  console.log("\n[Database] Provisioning operational accounts in database...");
  for (const acc of OPERATIONAL_ACCOUNTS) {
    const rawPassword = assignedPasswords[acc.envPasswordKey];
    const passwordHash = await bcrypt.hash(rawPassword, 10);

    // Check if user already exists by NIK or ID
    const existing = await pool.query(
      "SELECT id, nik, name, password_hash FROM users WHERE nik = $1 OR id = $2",
      [acc.nik, acc.id]
    );

    if (existing.rows.length > 0) {
      const existingId = existing.rows[0].id;
      await pool.query(
        `UPDATE users SET
          nik = $1,
          name = $2,
          email = $3,
          system_role = $4,
          business_role = $5,
          scope = $6,
          branch = $7,
          status = 'ACTIVE',
          source = 'LOCAL',
          password_hash = $8,
          token_version = COALESCE(token_version, 1) + 1,
          updated_at = NOW()
        WHERE id = $9`,
        [
          acc.nik,
          acc.name,
          acc.email,
          acc.systemRole,
          acc.businessRole,
          acc.scope,
          acc.branch,
          passwordHash,
          existingId,
        ]
      );
      await revokeAllUserSessions(existingId);
      console.log(`  ✔ Updated: ${acc.nik} (${acc.name}) [branch: ${acc.branch}, role: ${acc.businessRole}]`);
    } else {
      await pool.query(
        `INSERT INTO users (
          id, nik, name, email, system_role, business_role, scope, branch,
          status, source, password_hash, token_version, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'ACTIVE', 'LOCAL', $9, 1, NOW(), NOW())`,
        [
          acc.id,
          acc.nik,
          acc.name,
          acc.email,
          acc.systemRole,
          acc.businessRole,
          acc.scope,
          acc.branch,
          passwordHash,
        ]
      );
      console.log(`  ✔ Created: ${acc.nik} (${acc.name}) [branch: ${acc.branch}, role: ${acc.businessRole}]`);
    }
  }

  console.log("\n================================================================================");
  console.log("🎉 ALL 9 OPERATIONAL ACCOUNTS SUCCESSFULLY PROVISIONED & VERIFIED!");
  console.log("================================================================================");
}

// Direct execution
if (process.argv[1]?.includes("provision-operational-accounts")) {
  provisionOperationalAccounts()
    .then(async () => {
      await closeDbPool();
      process.exit(0);
    })
    .catch(async (err) => {
      console.error("Provisioning error:", err);
      await closeDbPool();
      process.exit(1);
    });
}
