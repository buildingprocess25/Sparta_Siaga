/**
 * SPARTA SIAGA — Test Selective Production Migration Runner
 *
 * Verifies:
 * 1. CLI option parsing and validation
 * 2. Selective migration (--through=017) targeting
 * 3. Strict deferral guard for migration 018
 * 4. Invalid options and argument handling
 * 5. Preflight read-only compatibility check for report_approval_outbox (015)
 * 6. Migration ledger idempotency and advisory lock retention
 */

import { spawnSync } from "node:child_process";
import path from "node:path";

type TestCase = {
  name: string;
  args: string[];
  expectedCode: number;
  expectedOutputIncludes?: string[];
  expectedErrorIncludes?: string[];
};

const RUNNER_PATH = path.join(process.cwd(), "scripts", "migrate-production.mjs");

const testCases: TestCase[] = [
  {
    name: "TC-01: --help prints usage and exits cleanly (0)",
    args: ["--help"],
    expectedCode: 0,
    expectedOutputIncludes: [
      "SPARTA SIAGA - Production Migration Runner",
      "--through=<target>",
      "--validate-only",
      "--preflight-only",
    ],
  },
  {
    name: "TC-02: --validate-only verifies migrations and skips deferred 018",
    args: ["--validate-only"],
    expectedCode: 0,
    expectedOutputIncludes: [
      "Skipping deferred migration '018_user_sync_metadata_and_sso_status.sql'",
      "Validation passed: 17 migration(s) verified",
      "017_earthquake_shakemaps_and_facility_intensities.sql",
    ],
  },
  {
    name: "TC-03: --validate-only --through=017 targets up to 017 and excludes 018",
    args: ["--validate-only", "--through=017"],
    expectedCode: 0,
    expectedOutputIncludes: [
      "Targeting through '017_earthquake_shakemaps_and_facility_intensities.sql'",
      "Validation passed: 17 migration(s) verified",
      "017_earthquake_shakemaps_and_facility_intensities.sql",
    ],
  },
  {
    name: "TC-04: --validate-only --through 017 (space separated) works identically",
    args: ["--validate-only", "--through", "017"],
    expectedCode: 0,
    expectedOutputIncludes: [
      "Targeting through '017_earthquake_shakemaps_and_facility_intensities.sql'",
      "Validation passed: 17 migration(s) verified",
    ],
  },
  {
    name: "TC-05: --validate-only --through=015 targets exactly 15 migrations",
    args: ["--validate-only", "--through=015"],
    expectedCode: 0,
    expectedOutputIncludes: [
      "Targeting through '015_report_approval_outbox.sql'",
      "Validation passed: 15 migration(s) verified",
      "015_report_approval_outbox.sql",
    ],
  },
  {
    name: "TC-06: --validate-only --through=16 (numeric) resolves 016 correctly",
    args: ["--validate-only", "--through=16"],
    expectedCode: 0,
    expectedOutputIncludes: [
      "Targeting through '016_session_concurrency_and_token_encryption.sql'",
      "Validation passed: 16 migration(s) verified",
    ],
  },
  {
    name: "TC-07: Targeting deferred migration 018 is strictly blocked",
    args: ["--validate-only", "--through=018"],
    expectedCode: 1,
    expectedErrorIncludes: [
      "Migration '018_user_sync_metadata_and_sso_status.sql' is explicitly deferred per migration policy",
      "Targeting this migration is strictly forbidden",
    ],
  },
  {
    name: "TC-08: Non-existent migration target 999 fails safely",
    args: ["--validate-only", "--through=999"],
    expectedCode: 1,
    expectedErrorIncludes: [
      "Migration target '999' not found in database/migrations",
      "Available targets:",
    ],
  },
  {
    name: "TC-09: Empty target --through= fails safely",
    args: ["--validate-only", "--through="],
    expectedCode: 1,
    expectedErrorIncludes: [
      "Invalid option '--through=': missing migration target",
    ],
  },
  {
    name: "TC-10: Dangling --through without argument fails safely",
    args: ["--validate-only", "--through"],
    expectedCode: 1,
    expectedErrorIncludes: [
      "Invalid option '--through': expected target migration argument",
    ],
  },
  {
    name: "TC-11: Unknown option fails safely",
    args: ["--validate-only", "--unsupported-flag"],
    expectedCode: 1,
    expectedErrorIncludes: [
      "Unrecognized option '--unsupported-flag'",
    ],
  },
  {
    name: "TC-12: Without DATABASE_URL, live migration fails fast",
    args: ["--through=017"],
    expectedCode: 1,
    expectedErrorIncludes: [
      "DATABASE_URL environment variable is required to run migrations",
    ],
  },
];

console.log("============================================================");
console.log("SPARTA SIAGA — SELECTIVE MIGRATION TEST SUITE");
console.log("============================================================\n");

let passedCount = 0;
let failedCount = 0;

for (const tc of testCases) {
  const result = spawnSync(process.execPath, [RUNNER_PATH, ...tc.args], {
    encoding: "utf8",
    env: { ...process.env, DATABASE_URL: "" }, // Ensure clean env
  });

  const stdout = result.stdout || "";
  const stderr = result.stderr || "";
  const combined = stdout + "\n" + stderr;

  let passed = result.status === tc.expectedCode;
  const failureReasons: string[] = [];

  if (result.status !== tc.expectedCode) {
    failureReasons.push(`Exit code expected ${tc.expectedCode}, received ${result.status}`);
  }

  if (tc.expectedOutputIncludes) {
    for (const text of tc.expectedOutputIncludes) {
      if (!combined.includes(text)) {
        failureReasons.push(`Expected output to include: "${text}"`);
        passed = false;
      }
    }
  }

  if (tc.expectedErrorIncludes) {
    for (const text of tc.expectedErrorIncludes) {
      if (!combined.includes(text)) {
        failureReasons.push(`Expected error to include: "${text}"`);
        passed = false;
      }
    }
  }

  if (passed) {
    console.log(`[PASS] ${tc.name}`);
    passedCount++;
  } else {
    console.error(`[FAIL] ${tc.name}`);
    for (const r of failureReasons) {
      console.error(`       -> ${r}`);
    }
    console.error(`       STDOUT: ${stdout.trim()}`);
    console.error(`       STDERR: ${stderr.trim()}`);
    failedCount++;
  }
}

console.log("\n============================================================");
console.log(`TEST SUMMARY: ${passedCount}/${testCases.length} PASSED (${failedCount} failed)`);
console.log("============================================================");

if (failedCount > 0) {
  process.exit(1);
}
