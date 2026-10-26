/**
 * SPARTA SIAGA — Dummy Data Audit Script (Requirement 17)
 * 
 * Usage:
 *   npx tsx scripts/audit-dummy-data.ts           # DRY RUN (Default)
 *   npx tsx scripts/audit-dummy-data.ts --apply   # Apply deletion to explicit test namespace only
 */

import { getDbPool } from "../lib/db.js";

interface AuditFinding {
  table: string;
  recordId: string;
  matchedPattern: string;
  reason: string;
}

const TEST_PATTERNS = [
  { pattern: "INC-TEST-", reason: "Explicit test incident namespace" },
  { pattern: "TEST-",     reason: "Prefix TEST- marker" },
  { pattern: "QA-",       reason: "Prefix QA- test fixture marker" },
  { pattern: "test_",     reason: "Prefix test_ identifier" },
];

async function runAudit() {
  const isApply = process.argv.includes("--apply");
  console.log(`====================================================`);
  console.log(` SPARTA SIAGA — DUMMY & TEST DATA AUDIT`);
  console.log(` Mode: ${isApply ? "⚠️ APPLY DELETION" : "🔍 DRY RUN ONLY (Safe Inspection)"}`);
  console.log(`====================================================\n`);

  const pool = getDbPool();

  // Safety guard: block destructive operations on non-isolated databases
  if (isApply) {
    const dbNameRes = await pool.query("SELECT current_database() AS db_name");
    const currentDb = dbNameRes.rows[0]?.db_name;
    const ALLOWED_DATABASES = ["sparta_siaga_isolated", "sparta_siaga_dev", "sparta_siaga_uat"];
    if (!ALLOWED_DATABASES.includes(currentDb)) {
      console.error(`FATAL: Refusing destructive --apply on database "${currentDb}".`);
      console.error(`Allowed databases for deletion: ${ALLOWED_DATABASES.join(", ")}`);
      process.exit(1);
    }
    console.log(`Database guard passed: connected to "${currentDb}" (allowed for cleanup)\n`);
  }

  const findings: AuditFinding[] = [];

  try {
    // 1. Audit incidents table
    const incidentsRes = await pool.query(
      `SELECT id, store_id, store_name, branch, disaster_type, created_at 
       FROM incidents`
    );

    for (const row of incidentsRes.rows) {
      const id = String(row.id || "");
      const storeId = String(row.store_id || "");
      const storeName = String(row.store_name || "");

      for (const tp of TEST_PATTERNS) {
        if (id.startsWith(tp.pattern)) {
          findings.push({
            table: "incidents",
            recordId: id,
            matchedPattern: tp.pattern,
            reason: `${tp.reason} on incident ID`,
          });
          break;
        } else if (storeId.startsWith(tp.pattern) || storeName.toLowerCase().startsWith(tp.pattern.toLowerCase())) {
          findings.push({
            table: "incidents",
            recordId: id,
            matchedPattern: tp.pattern,
            reason: `${tp.reason} on store [${storeId}] ${storeName}`,
          });
          break;
        }
      }
    }

    // 2. Audit notification_logs table
    const notifRes = await pool.query(
      `SELECT id, disaster_id, ticket_number, branch, sent_at 
       FROM notification_logs`
    );

    for (const row of notifRes.rows) {
      const id = String(row.id || "");
      const ticket = String(row.ticket_number || "");
      const disasterId = String(row.disaster_id || "");

      for (const tp of TEST_PATTERNS) {
        if (id.startsWith(tp.pattern) || ticket.startsWith(tp.pattern) || disasterId.startsWith(tp.pattern)) {
          findings.push({
            table: "notification_logs",
            recordId: id,
            matchedPattern: tp.pattern,
            reason: `${tp.reason} on notification (ticket: ${ticket})`,
          });
          break;
        }
      }
    }

    // 3. Audit earthquake_events table
    try {
      const eqRes = await pool.query(
        `SELECT id, canonical_event_key, title, source_primary 
         FROM earthquake_events`
      );

      for (const row of eqRes.rows) {
        const id = String(row.id || "");
        const key = String(row.canonical_event_key || "");

        for (const tp of TEST_PATTERNS) {
          if (id.startsWith(tp.pattern) || key.startsWith(tp.pattern)) {
            findings.push({
              table: "earthquake_events",
              recordId: id,
              matchedPattern: tp.pattern,
              reason: `${tp.reason} on earthquake event key`,
            });
            break;
          }
        }
      }
    } catch {
      // Table might be freshly created or empty
    }

    // Output Report
    console.log(`Total Records Audited across database:`);
    console.log(`- Incidents: ${incidentsRes.rowCount || 0}`);
    console.log(`- Notification Logs: ${notifRes.rowCount || 0}`);
    console.log(`- Findings matching test patterns: ${findings.length}\n`);

    if (findings.length === 0) {
      console.log(`✅ Zero test/dummy records detected. Database is clean of test namespaces.`);
    } else {
      console.log(`Audit Findings Table:`);
      console.table(findings);

      if (isApply) {
        console.log(`\nExecuting deletion on explicitly identified test namespace records...`);
        for (const item of findings) {
          if (item.table === "incidents") {
            await pool.query(`DELETE FROM incidents WHERE id = $1`, [item.recordId]);
            console.log(`- Deleted incident record: ${item.recordId}`);
          } else if (item.table === "notification_logs") {
            await pool.query(`DELETE FROM notification_logs WHERE id = $1`, [item.recordId]);
            console.log(`- Deleted notification log: ${item.recordId}`);
          } else if (item.table === "earthquake_events") {
            await pool.query(`DELETE FROM earthquake_events WHERE id = $1`, [item.recordId]);
            console.log(`- Deleted earthquake event: ${item.recordId}`);
          }
        }
        console.log(`\n✅ Applied deletion for ${findings.length} test records successfully.`);
      } else {
        console.log(`\nℹ️ This was a DRY RUN. No records were deleted.`);
        console.log(`To delete only these explicit test records, run: npx tsx scripts/audit-dummy-data.ts --apply`);
      }
    }

  } catch (err) {
    console.error("Audit error:", err);
  } finally {
    await pool.end();
  }
}

runAudit();
