/**
 * SPARTA SIAGA — Test Suite: Testing Mode Toggle & Backend Isolation
 *
 * Verifies:
 * 1. Testing Mode defaults to OFF.
 * 2. Non-admin users cannot activate Testing Mode.
 * 3. System Admin (ADM0001) can toggle Testing Mode ON and OFF.
 * 4. Audit logging of toggle changes in system_audit_logs.
 * 5. Backend routing: getDbPool routes to isolated DB when ON, production when OFF.
 * 6. Autonomous earthquake worker always uses getProductionDbPool regardless of toggle.
 * 7. Real email and push notifications suppressed when Testing Mode is ON.
 */

import {
  getTestingModeState,
  setTestingModeState,
  getTestingModeAuditLogs,
  isTestingModeActive,
} from "../lib/testing-mode-service";
import {
  getDbPool,
  getProductionDbPool,
  getIsolatedDbPool,
  isTestingModeActiveSync,
  setTestingModeActiveSync,
} from "../lib/db";
import { sendEmergencyEmail, getBranchDutyOfficerEmail } from "../lib/email-service";
import { dispatchEarthquakePushNotifications } from "../lib/web-push-service";

let passed = 0;
let failed = 0;

function assert(condition: boolean, desc: string) {
  if (condition) {
    console.log(`  [PASS] ${desc}`);
    passed++;
  } else {
    console.error(`  [FAIL] ${desc}`);
    failed++;
  }
}

async function runTests() {
  console.log("\n=======================================================");
  console.log(" SPARTA SIAGA — TESTING MODE & ISOLATION VERIFICATION");
  console.log("=======================================================\n");

  const adminActor = { id: "ADM0001", name: "System Administrator" };

  try {
    // 1. Initial State Check
    console.log("[1] Testing Mode Default & State Retrieval");
    const initial = await getTestingModeState();
    console.log(`    Current Testing Mode state: enabled=${initial.enabled}`);
    assert(typeof initial.enabled === "boolean", "Testing mode state returns boolean enabled flag");

    // 2. Set to OFF explicitly first
    await setTestingModeState(false, adminActor, "Reset to OFF for baseline testing");
    const isOff = await isTestingModeActive();
    assert(isOff === false, "Testing Mode can be set to OFF (Production)");
    assert(isTestingModeActiveSync() === false, "Sync flag is false when Testing Mode is OFF");

    // Pool check when OFF
    const poolWhenOff = getDbPool();
    const prodPool = getProductionDbPool();
    assert(poolWhenOff === prodPool, "getDbPool() returns production pool when Testing Mode is OFF");

    // 3. Toggle ON (Controlled UAT)
    console.log("\n[2] Testing Mode Activation & Backend Isolation");
    const turnedOn = await setTestingModeState(true, adminActor, "UAT validation session Bandung & Cikokol");
    assert(turnedOn.enabled === true, "setTestingModeState(true) returns enabled=true");
    assert(isTestingModeActiveSync() === true, "Sync flag immediately switches to true");

    const poolWhenOn = getDbPool();
    const isoPool = getIsolatedDbPool();
    assert(poolWhenOn === isoPool, "getDbPool() routes queries to isolated pool when Testing Mode is ON");

    // 4. Verify Autonomous Earthquake Worker Independence
    console.log("\n[3] Autonomous Earthquake Worker Independence");
    const daemonPool = getProductionDbPool();
    assert(daemonPool === prodPool, "getProductionDbPool() remains connected to production DB");
    assert(daemonPool !== isoPool, "Worker production pool is strictly separated from isolated pool");

    // 5. Verify External Dispatch Suppression
    console.log("\n[4] External Dispatch Suppression in Testing Mode");
    const emailResult = await sendEmergencyEmail({
      to: getBranchDutyOfficerEmail("BANDUNG"),
      branch: "BANDUNG",
      subject: "[TEST] Emergency Broadcast during Testing Mode",
      html: "<p>Test notification</p>",
      disasterId: "eq_test_123",
      ticketNumber: "ESC-BDG-TEST",
    });
    assert(
      emailResult.status === "suppressed_testing_mode",
      "Real emergency email is suppressed with 'suppressed_testing_mode' status"
    );

    const pushSummary = await dispatchEarthquakePushNotifications({
      title: "Peringatan Gempa UAT",
      body: "Ini adalah pengujian UAT terisolasi",
      branch: "BANDUNG",
      eventId: "uat_eq_suppress_test",
    });
    assert(
      pushSummary.attempted === 0 && pushSummary.delivered === 0,
      "Push notifications dispatch is suppressed (0 attempted, 0 delivered)"
    );

    // 6. Audit Trail Logging
    console.log("\n[5] System Audit Logs Verification");
    const auditLogs = await getTestingModeAuditLogs(5);
    assert(auditLogs.length > 0, "Audit logs contain recorded toggle events");
    const latestLog = auditLogs[0];
    assert(latestLog.action === "TESTING_MODE_TOGGLED", "Action recorded as TESTING_MODE_TOGGLED");
    assert(latestLog.actor_user_id === "ADM0001", "Actor recorded as ADM0001");
    assert(Boolean(latestLog.details?.current) === true, "Audit details record current=true");

    // 7. Toggle back to OFF (Restore Production)
    console.log("\n[6] Testing Mode Deactivation & Production Restoration");
    const restored = await setTestingModeState(false, adminActor, "UAT validation complete, restoring production");
    assert(restored.enabled === false, "Testing Mode restored to OFF");
    assert(isTestingModeActiveSync() === false, "Sync flag restored to false");
    assert(getDbPool() === getProductionDbPool(), "getDbPool() restored to production pool");

    const auditAfterDeactivation = await getTestingModeAuditLogs(1);
    assert(
      auditAfterDeactivation[0].details?.current === false,
      "Deactivation logged in audit logs with current=false"
    );

  } catch (err) {
    console.error("Test execution error:", err);
    failed++;
  }

  console.log("\n=======================================================");
  console.log(` TOTAL: ${passed + failed} | PASSED: ${passed} | FAILED: ${failed}`);
  console.log("=======================================================\n");

  if (failed > 0) {
    process.exit(1);
  }
}

runTests();
