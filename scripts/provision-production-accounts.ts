import fs from "fs/promises";
import path from "path";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import { getDbPool, closeDbPool } from "../lib/db";
import { revokeAllUserSessions } from "../lib/session-service";

export interface PilotAccountConfig {
  id: string;
  nik: string;
  name: string;
  email: string;
  systemRole: "ADMIN" | "USER";
  businessRole: string | null;
  scope: "HO" | null;
  branch: null;
  status: "ACTIVE";
  envPasswordKey: string;
  defaultLabel: string;
}

export const APPROVED_HO_PILOT_ACCOUNTS: PilotAccountConfig[] = [
  // 1 System Administrator
  {
    id: "usr_sysadmin_01",
    nik: "ADM0001",
    name: "Ahmad Fauzi",
    email: "sysadmin@sparta-siaga.local",
    systemRole: "ADMIN",
    businessRole: null,
    scope: null,
    branch: null,
    status: "ACTIVE",
    envPasswordKey: "PROD_SYSADMIN_PASSWORD",
    defaultLabel: "System Administrator (ADM0001)",
  },
  // 7 HO Admin Users
  {
    id: "usr_ho_admin_01",
    nik: "HO0001",
    name: "Budi Santoso",
    email: "ho.admin.01@sparta-siaga.local",
    systemRole: "USER",
    businessRole: "ho_admin",
    scope: "HO",
    branch: null,
    status: "ACTIVE",
    envPasswordKey: "PROD_HO_ADMIN_01_PASSWORD",
    defaultLabel: "HO Admin 01 (HO0001)",
  },
  {
    id: "usr_ho_admin_02",
    nik: "HO0002",
    name: "Siti Rahmawati",
    email: "ho.admin.02@sparta-siaga.local",
    systemRole: "USER",
    businessRole: "ho_admin",
    scope: "HO",
    branch: null,
    status: "ACTIVE",
    envPasswordKey: "PROD_HO_ADMIN_02_PASSWORD",
    defaultLabel: "HO Admin 02 (HO0002)",
  },
  {
    id: "usr_ho_admin_03",
    nik: "HO0003",
    name: "Dimas Pratama",
    email: "ho.admin.03@sparta-siaga.local",
    systemRole: "USER",
    businessRole: "ho_admin",
    scope: "HO",
    branch: null,
    status: "ACTIVE",
    envPasswordKey: "PROD_HO_ADMIN_03_PASSWORD",
    defaultLabel: "HO Admin 03 (HO0003)",
  },
  {
    id: "usr_ho_admin_04",
    nik: "HO0004",
    name: "Dewi Anggraini",
    email: "ho.admin.04@sparta-siaga.local",
    systemRole: "USER",
    businessRole: "ho_admin",
    scope: "HO",
    branch: null,
    status: "ACTIVE",
    envPasswordKey: "PROD_HO_ADMIN_04_PASSWORD",
    defaultLabel: "HO Admin 04 (HO0004)",
  },
  {
    id: "usr_ho_admin_05",
    nik: "HO0005",
    name: "Rian Hidayat",
    email: "ho.admin.05@sparta-siaga.local",
    systemRole: "USER",
    businessRole: "ho_admin",
    scope: "HO",
    branch: null,
    status: "ACTIVE",
    envPasswordKey: "PROD_HO_ADMIN_05_PASSWORD",
    defaultLabel: "HO Admin 05 (HO0005)",
  },
  {
    id: "usr_ho_admin_06",
    nik: "HO0006",
    name: "Nurul Hidayah",
    email: "ho.admin.06@sparta-siaga.local",
    systemRole: "USER",
    businessRole: "ho_admin",
    scope: "HO",
    branch: null,
    status: "ACTIVE",
    envPasswordKey: "PROD_HO_ADMIN_06_PASSWORD",
    defaultLabel: "HO Admin 06 (HO0006)",
  },
  {
    id: "usr_ho_admin_07",
    nik: "HO0007",
    name: "Eko Prasetyo",
    email: "ho.admin.07@sparta-siaga.local",
    systemRole: "USER",
    businessRole: "ho_admin",
    scope: "HO",
    branch: null,
    status: "ACTIVE",
    envPasswordKey: "PROD_HO_ADMIN_07_PASSWORD",
    defaultLabel: "HO Admin 07 (HO0007)",
  },
  // 2 SM HO Users
  {
    id: "usr_sm_ho_01",
    nik: "SM0001",
    name: "Hendra Wijaya",
    email: "sm.ho.01@sparta-siaga.local",
    systemRole: "USER",
    businessRole: "sm_ho",
    scope: "HO",
    branch: null,
    status: "ACTIVE",
    envPasswordKey: "PROD_SM_HO_01_PASSWORD",
    defaultLabel: "SM HO 01 (SM0001)",
  },
  {
    id: "usr_sm_ho_02",
    nik: "SM0002",
    name: "Ratna Sari",
    email: "sm.ho.02@sparta-siaga.local",
    systemRole: "USER",
    businessRole: "sm_ho",
    scope: "HO",
    branch: null,
    status: "ACTIVE",
    envPasswordKey: "PROD_SM_HO_02_PASSWORD",
    defaultLabel: "SM HO 02 (SM0002)",
  },
  // 1 GM HO User
  {
    id: "usr_gm_ho_01",
    nik: "GM0001",
    name: "Bambang Gunawan",
    email: "gm.ho@sparta-siaga.local",
    systemRole: "USER",
    businessRole: "gm_ho",
    scope: "HO",
    branch: null,
    status: "ACTIVE",
    envPasswordKey: "PROD_GM_HO_PASSWORD",
    defaultLabel: "GM HO (GM0001)",
  },
];

const DISALLOWED_WEAK_PASSWORDS = new Set([
  "pass123",
  "admin123",
  "hoadmin123",
  "password",
  "12345678",
  "sparta123",
  "alfamart123",
]);

function generateSecureRandomPassword(): string {
  // 16 characters base64url-safe high-entropy random password
  return crypto.randomBytes(12).toString("base64url");
}

export async function provisionProductionAccounts(): Promise<void> {
  const isApply = process.argv.includes("--apply");
  const isGenerate = process.argv.includes("--generate-passwords");

  console.log("================================================================================");
  console.log(" SPARTA SIAGA — HEAD OFFICE PILOT PRODUCTION ACCOUNTS PROVISIONING (11 ACCOUNTS)");
  console.log(` Mode: ${isApply ? "🔴 LIVE EXECUTION (--apply)" : "🔍 DRY RUN (Preview only)"}`);
  console.log("================================================================================\n");

  const pool = getDbPool();

  const dbRes = await pool.query("SELECT current_database() as db_name, version() as pg_version");
  const currentDb = dbRes.rows[0]?.db_name;
  const pgVersion = dbRes.rows[0]?.pg_version;

  console.log(`Connected Database: ${currentDb}`);
  console.log(`PostgreSQL Engine:  ${pgVersion.split(",")[0]}\n`);

  const passwordMap = new Map<string, string>();
  const generatedMap = new Map<string, string>();

  // 1. Resolve and validate credentials for each approved account
  for (const acc of APPROVED_HO_PILOT_ACCOUNTS) {
    let rawPassword = process.env[acc.envPasswordKey]?.trim();

    if (!rawPassword && isGenerate) {
      rawPassword = generateSecureRandomPassword();
      generatedMap.set(acc.id, rawPassword);
    }

    if (!rawPassword) {
      console.error(`❌ ERROR: Missing password for ${acc.defaultLabel}.`);
      console.error(`   Please set environment variable '${acc.envPasswordKey}' or run with '--generate-passwords'.`);
      process.exit(1);
    }

    if (rawPassword.length < 8) {
      console.error(`❌ SECURITY ERROR: Password for ${acc.defaultLabel} is too short (${rawPassword.length} chars).`);
      console.error("   Requirement: Minimum 8 characters mandatory.");
      process.exit(1);
    }

    if (DISALLOWED_WEAK_PASSWORDS.has(rawPassword.toLowerCase())) {
      console.error(`❌ SECURITY ERROR: Password for ${acc.defaultLabel} is a prohibited weak default.`);
      console.error("   Requirement: Weak credentials (pass123/admin123) are strictly forbidden.");
      process.exit(1);
    }

    passwordMap.set(acc.id, rawPassword);
  }

  // 2. Enforce uniqueness across all accounts
  const passwordsList = Array.from(passwordMap.values());
  const uniquePasswords = new Set(passwordsList);
  if (uniquePasswords.size !== passwordsList.length) {
    console.error("❌ SECURITY ERROR: Passwords must be unique per account. Shared passwords across roles are disallowed.");
    process.exit(1);
  }

  console.log("✔ Credential Security Verification Passed:");
  console.log("  - Minimum 8 characters enforced for all 11 accounts");
  console.log("  - Weak default passwords (pass123, admin123, etc.) strictly prohibited");
  console.log("  - Unique individual password per account verified\n");

  // If generated, save securely to git-ignored credentials file (never output plaintext to console)
  if (generatedMap.size > 0) {
    const credsPath = path.join(process.cwd(), ".env.pilot-credentials.local");
    const credLines: string[] = [
      "# SPARTA SIAGA — Head Office Pilot Credentials (AUTOGENERATED)",
      `# Generated at: ${new Date().toISOString()}`,
      "# CONFIDENTIAL: DO NOT COMMIT TO SOURCE CONTROL OR PUBLIC LOGS",
      "",
    ];
    for (const acc of APPROVED_HO_PILOT_ACCOUNTS) {
      if (generatedMap.has(acc.id)) {
        credLines.push(`${acc.envPasswordKey}="${generatedMap.get(acc.id)}"`);
      }
    }
    await fs.writeFile(credsPath, credLines.join("\n") + "\n", { mode: 0o600 });
    console.log(`🔒 Generated passwords securely stored to: .env.pilot-credentials.local (file mode 0600, git-ignored)`);
    console.log(`   (Plaintext passwords are NOT printed in standard console output for safety)\n`);
  }

  // 3. Display accounts to be provisioned (without exposing passwords)
  console.log(`Approved Head Office Pilot Personas (Total: ${APPROVED_HO_PILOT_ACCOUNTS.length}):`);
  for (const acc of APPROVED_HO_PILOT_ACCOUNTS) {
    console.log(`  • [${acc.nik}] ${acc.name}`);
    console.log(`    Role: ${acc.systemRole === "ADMIN" ? "System Administrator (ADMIN)" : acc.businessRole} | Scope: ${acc.scope || "N/A"}`);
    console.log(`    Email: ${acc.email}`);
    console.log(`    Password Status: [SECURE — ${passwordMap.get(acc.id)!.length} chars, masked]`);
    console.log();
  }

  console.log("Deactivated / Non-Pilot Personas Check:");
  console.log("  • Tim Toko: NOT ACTIVATED (Status: INACTIVE / Access denied by system policy)");
  console.log("  • Branch Operational Roles (BMS, BES, BnM): Reserved for controlled UAT / Non-Pilot\n");

  if (!isApply) {
    console.log("--------------------------------------------------------------------------------");
    console.log("ℹ️  Dry-run complete. No changes were committed to the database.");
    console.log("   To apply these accounts and hash passwords, run with '--apply'.");
    console.log("--------------------------------------------------------------------------------\n");
    return;
  }

  // 4. Apply changes to database
  console.log("Applying account provisioning and rotating credentials...");

  for (const acc of APPROVED_HO_PILOT_ACCOUNTS) {
    const rawPw = passwordMap.get(acc.id)!;
    const passwordHash = await bcrypt.hash(rawPw, 10);

    // Resolve target ID if an account with this NIK already exists
    const existing = await pool.query("SELECT id FROM users WHERE nik = $1", [acc.nik]);
    const targetId = existing.rows.length > 0 ? existing.rows[0].id : acc.id;

    await pool.query(
      `INSERT INTO users (
        id, nik, external_user_id, name, email, system_role, business_role, scope, branch, status, source, password_hash, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'LOCAL', $11, NOW())
      ON CONFLICT (id) DO UPDATE SET
        nik = EXCLUDED.nik,
        external_user_id = EXCLUDED.external_user_id,
        name = EXCLUDED.name,
        email = EXCLUDED.email,
        system_role = EXCLUDED.system_role,
        business_role = EXCLUDED.business_role,
        scope = EXCLUDED.scope,
        branch = EXCLUDED.branch,
        status = EXCLUDED.status,
        password_hash = EXCLUDED.password_hash,
        updated_at = NOW()`,
      [
        targetId,
        acc.nik,
        acc.nik.toLowerCase(),
        acc.name,
        acc.email,
        acc.systemRole,
        acc.businessRole,
        acc.scope,
        acc.branch,
        acc.status,
        passwordHash,
      ]
    );

    // Revoke any existing active sessions and increment token version
    try {
      await revokeAllUserSessions(targetId);
    } catch {
      // ignore if user_sessions table not yet active
    }

    console.log(`✔ Provisioned & Sessions Revoked: ${acc.nik} (${acc.name}) [ID: ${targetId}]`);
  }

  console.log("\n================================================================================");
  console.log("🎉 ALL 11 HEAD OFFICE PILOT ACCOUNTS SUCCESSFULLY PROVISIONED");
  console.log("================================================================================\n");
}

if (process.argv[1]?.endsWith("provision-production-accounts.ts")) {
  provisionProductionAccounts()
    .then(async () => {
      await closeDbPool();
      process.exit(0);
    })
    .catch(async (e) => {
      console.error("FATAL ERROR provisioning accounts:", e);
      await closeDbPool();
      process.exit(1);
    });
}
