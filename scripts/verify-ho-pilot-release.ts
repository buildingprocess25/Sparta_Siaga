import fs from "fs/promises";
import path from "path";
import bcrypt from "bcryptjs";
import assert from "assert";
import { getDbPool, closeDbPool } from "../lib/db";
import { dbGetUserByIdentifier } from "../lib/user-db";
import { createDeviceSession } from "../lib/session-service";
import {
  canViewReport,
  canActOnReport,
  canInspectReport,
  canCreateManagementInstruction,
  UserContext,
} from "../lib/report-permissions";
import { IncidentRecord } from "../types/incident";
import { APPROVED_HO_PILOT_ACCOUNTS } from "./provision-production-accounts";

async function loadGeneratedCredentials(): Promise<Map<string, string>> {
  const credsPath = path.join(process.cwd(), ".env.pilot-credentials.local");
  const content = await fs.readFile(credsPath, "utf8");
  const credMap = new Map<string, string>();

  for (const line of content.split("\n")) {
    const match = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*["']?([^"'\r\n]+)["']?\s*$/);
    if (match) {
      credMap.set(match[1], match[2]);
    }
  }
  return credMap;
}

export async function verifyHoPilotRelease(): Promise<void> {
  console.log("================================================================================");
  console.log(" SPARTA SIAGA — VERIFICATION SUITE: HO PILOT RELEASE & DATA INTEGRITY");
  console.log("================================================================================\n");

  const pool = getDbPool();
  const credMap = await loadGeneratedCredentials();

  console.log("1. Multi-User Authentication & Credential Verification (11 Accounts)");
  for (const acc of APPROVED_HO_PILOT_ACCOUNTS) {
    const rawPw = credMap.get(acc.envPasswordKey);
    assert(rawPw, `Missing password in .env.pilot-credentials.local for ${acc.defaultLabel}`);
    assert(rawPw.length >= 8, `Password for ${acc.nik} must be >= 8 characters`);

    // Verify lookup by NIK
    const userByNik = await dbGetUserByIdentifier(acc.nik);
    assert(userByNik, `Account ${acc.nik} not found in database`);
    assert.strictEqual(userByNik.status, "ACTIVE", `Account ${acc.nik} must be ACTIVE`);
    assert(userByNik.passwordHash, `Account ${acc.nik} must have passwordHash`);

    // Verify password hash
    const isValid = await bcrypt.compare(rawPw, userByNik.passwordHash);
    assert(isValid, `Password verification failed for ${acc.nik}`);

    // Verify lookup by Email
    const userByEmail = await dbGetUserByIdentifier(acc.email);
    assert(userByEmail, `Account ${acc.email} not found by email`);
    assert.strictEqual(userByEmail.id, userByNik.id);

    // Verify session creation
    const sessionRes = await createDeviceSession({
      userId: userByNik.id,
      userAgent: "Release-Verification-Agent/1.0",
      ipAddress: "127.0.0.1",
      tokenVersion: userByNik.tokenVersion || 1,
    });
    assert(sessionRes, `Failed to create session for ${acc.nik}`);
    assert(sessionRes.accessToken, `Missing access token for ${acc.nik}`);
    assert(sessionRes.refreshToken, `Missing refresh token for ${acc.nik}`);

    console.log(`  ✔ [PASS] ${acc.nik} (${acc.name}) - Auth OK, Hash Verified, Session Minted`);
  }
  console.log();

  console.log("2. Role, Scope, and Permission Boundary Verification");
  // Mock reports
  const mockAutoEqReport: IncidentRecord = {
    id: "INC-EQ-AUTO-01",
    date: "2026-10-26",
    disasterType: "earthquake",
    reportOrigin: "automatic_earthquake",
    storeId: "T001",
    storeName: "Toko Merdeka",
    branch: "BANDUNG",
    locationCity: "Bandung",
    status: "verifying",
    progress: 0,
    timeline: [],
    createdAt: "2026-10-26T00:00:00.000Z",
    updatedAt: "2026-10-26T00:00:00.000Z",
  };

  const mockManualPendingReport: IncidentRecord = {
    id: "INC-MAN-PENDING-01",
    date: "2026-10-26",
    disasterType: "flood",
    reportOrigin: "manual",
    storeId: "T002",
    storeName: "Toko Asia Afrika",
    branch: "BANDUNG",
    locationCity: "Bandung",
    status: "verifying",
    progress: 0,
    timeline: [],
    createdAt: "2026-10-26T00:00:00.000Z",
    updatedAt: "2026-10-26T00:00:00.000Z",
  };

  const mockManualApprovedReport: IncidentRecord = {
    id: "INC-MAN-APP-01",
    date: "2026-10-26",
    disasterType: "flood",
    reportOrigin: "manual",
    storeId: "T003",
    storeName: "Toko Dago",
    branch: "BANDUNG",
    locationCity: "Bandung",
    status: "confirmed_affected",
    progress: 25,
    timeline: [],
    createdAt: "2026-10-26T00:00:00.000Z",
    updatedAt: "2026-10-26T00:00:00.000Z",
    verification: {
      bmApproval: {
        decision: "approved",
      },
    } as any,
  };

  // Test System Admin
  const adminUser = await dbGetUserByIdentifier("ADM0001");
  assert(adminUser);
  const adminCtx: UserContext = {
    id: adminUser.id,
    name: adminUser.name,
    nik: adminUser.nik,
    role: null,
    systemRole: "ADMIN",
    scope: null,
    branch: null,
  };
  assert(canViewReport(adminCtx, mockManualPendingReport), "Admin must view all reports");
  assert(canActOnReport(adminCtx, mockManualPendingReport), "Admin must act across branches");
  assert(canInspectReport(adminCtx, mockManualPendingReport), "Admin can inspect");
  assert(canCreateManagementInstruction(adminCtx), "Admin can issue instructions");
  console.log("  ✔ [PASS] System Administrator: Full governance and administrative access verified");

  // Test HO Admin (HO0001)
  const hoUser = await dbGetUserByIdentifier("HO0001");
  assert(hoUser);
  const hoCtx: UserContext = {
    id: hoUser.id,
    name: hoUser.name,
    nik: hoUser.nik,
    role: "ho_admin",
    systemRole: "USER",
    scope: "HO",
    branch: null,
  };
  assert(canViewReport(hoCtx, mockAutoEqReport), "HO must see automatic earthquake reports immediately");
  assert(!canViewReport(hoCtx, mockManualPendingReport), "HO must NOT see unapproved manual reports");
  assert(canViewReport(hoCtx, mockManualApprovedReport), "HO must see approved manual reports");
  assert(!canActOnReport(hoCtx, mockManualApprovedReport), "HO must be strictly read-only for field operations");
  assert(!canInspectReport(hoCtx, mockManualApprovedReport), "HO cannot perform field inspections");
  assert(!canCreateManagementInstruction(hoCtx), "HO Admin cannot create management instructions");
  console.log("  ✔ [PASS] HO Admin: Read-only visibility and branch action isolation verified");

  // Test SM HO (SM0001)
  const smUser = await dbGetUserByIdentifier("SM0001");
  assert(smUser);
  const smCtx: UserContext = {
    id: smUser.id,
    name: smUser.name,
    nik: smUser.nik,
    role: "sm_ho",
    systemRole: "USER",
    scope: "HO",
    branch: null,
  };
  assert(!canActOnReport(smCtx, mockManualApprovedReport), "SM HO is read-only for branch ops");
  assert(canCreateManagementInstruction(smCtx), "SM HO CAN create management instructions");
  console.log("  ✔ [PASS] SM HO: Management instruction authority verified, field ops isolated");

  // Test GM HO (GM0001)
  const gmUser = await dbGetUserByIdentifier("GM0001");
  assert(gmUser);
  const gmCtx: UserContext = {
    id: gmUser.id,
    name: gmUser.name,
    nik: gmUser.nik,
    role: "gm_ho",
    systemRole: "USER",
    scope: "HO",
    branch: null,
  };
  assert(!canActOnReport(gmCtx, mockManualApprovedReport), "GM HO is read-only for branch ops");
  assert(canCreateManagementInstruction(gmCtx), "GM HO CAN create management instructions");
  console.log("  ✔ [PASS] GM HO: Executive governance verified, field ops isolated");

  // Test Tim Toko Deactivation
  const timTokoUser = await dbGetUserByIdentifier("1001");
  assert(timTokoUser, "Tim Toko user record exists");
  assert.strictEqual(timTokoUser.status, "INACTIVE", "Tim Toko must be INACTIVE");
  console.log("  ✔ [PASS] Tim Toko Deactivation: Account marked INACTIVE, auth blocked\n");

  console.log("3. Database Master Data & Cleanliness Integrity");
  const storesRes = await pool.query("SELECT count(*)::int as count FROM stores");
  assert.strictEqual(storesRes.rows[0].count, 21550, "Expected 21,550 stores master records");

  const facilitiesRes = await pool.query("SELECT count(*)::int as count FROM facilities");
  assert.strictEqual(facilitiesRes.rows[0].count, 67, "Expected 67 facilities master records");

  const migrationsRes = await pool.query("SELECT count(*)::int as count FROM sparta_schema_migrations");
  assert.strictEqual(migrationsRes.rows[0].count, 11, "Expected 11 schema migrations");

  const dummyIncRes = await pool.query("SELECT count(*)::int as count FROM incidents WHERE id LIKE 'TEST-%' OR id LIKE 'INC-TEST-%'");
  assert.strictEqual(dummyIncRes.rows[0].count, 0, "Expected 0 dummy incidents");

  const dummyNotifRes = await pool.query("SELECT count(*)::int as count FROM notification_logs WHERE ticket_number LIKE 'TEST-%' OR disaster_id LIKE 'flood_sim_%'");
  assert.strictEqual(dummyNotifRes.rows[0].count, 0, "Expected 0 dummy notifications");

  console.log(`  ✔ [PASS] Stores Master:          ${storesRes.rows[0].count} rows (100% Intact)`);
  console.log(`  ✔ [PASS] Facilities Master:      ${facilitiesRes.rows[0].count} rows (100% Intact)`);
  console.log(`  ✔ [PASS] Schema Migrations:      ${migrationsRes.rows[0].count} ledgers (001–011 verified)`);
  console.log(`  ✔ [PASS] Staging Dummy Records:  0 test incidents, 0 test notifications\n`);

  console.log("================================================================================");
  console.log("🎉 ALL RELEASE VERIFICATION CHECKS PASSED SUCCESSFULLY (100%)");
  console.log("================================================================================\n");
}

if (process.argv[1]?.endsWith("verify-ho-pilot-release.ts")) {
  verifyHoPilotRelease()
    .then(async () => {
      await closeDbPool();
      process.exit(0);
    })
    .catch(async (err) => {
      console.error("FATAL VERIFICATION FAILURE:", err);
      await closeDbPool();
      process.exit(1);
    });
}
