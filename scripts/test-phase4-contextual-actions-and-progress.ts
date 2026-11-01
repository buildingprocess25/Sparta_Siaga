/**
 * SPARTA SIAGA: Phase 4 Focused Refinement Regression Test Suite
 * Incident Follow-Up, Work Progress & Role-Based Action Workflows
 * 
 * Target Environment: Aiven PostgreSQL (sparta_siaga_isolated)
 * Safety: Never connects to or modifies Dokploy production database (siaga).
 * 
 * Test Categories:
 * 1. Numeric Progress Validation & Bounds (Reject slider, non-numeric, negative, >100, decreasing)
 * 2. Slider Absence Verification in Codebase (No type="range" in components/app)
 * 3. Premature Maintenance Progress Blocking (Pre-approval & terminal states)
 * 4. Facility-Based & Role-Based Access Isolation (BMS/BES/BBS on Toko/DC/Building)
 * 5. Progress 100% Non-Auto-Close Verification
 * 6. Coordinator Approval & BnM Case Close Separation
 * 7. Safe Path (Tidak Ada Kerusakan) & Clarification Loopback
 * 8. Contextual Action Resolution & Redundant Action Removal
 */

import { getDbPool, closeDbPool } from "../lib/db";
import { assertIsolatedDatabase } from "../lib/database-safety";
import { IncidentRecord } from "../types/incident";
import { dbUpdateIncident, dbGetIncidentById } from "../lib/incident-db";
import { ProgressService } from "../lib/progress-service";
import fs from "fs";
import path from "path";

interface TestResult {
  code: string;
  category: string;
  name: string;
  passed: boolean;
  detail: string;
}

const results: TestResult[] = [];

function record(code: string, category: string, name: string, passed: boolean, detail: string) {
  results.push({ code, category, name, passed, detail });
  const icon = passed ? "✔ [PASS]" : "❌ [FAIL]";
  console.log(`${icon} ${code.padEnd(14)} | ${name}`);
  if (detail) {
    console.log(`               Detail: ${detail}`);
  }
}

function extractCookie(res: any): string | null {
  const setCookie = res.headers?.get("set-cookie") || "";
  const match = setCookie.match(/siaga_session=([^;]+)/);
  return match ? match[1] : null;
}

async function runRefinementSuite() {
  console.log("================================================================================");
  console.log(" SPARTA SIAGA: WORK PROGRESS & ROLE-BASED ACTION REGRESSION SUITE");
  console.log(" Target: Aiven PostgreSQL sparta_siaga_isolated");
  console.log("================================================================================\n");

  const pool = getDbPool();
  await assertIsolatedDatabase(pool);

  // Dynamic Route Imports
  const loginRoute = await import("../app/api/auth/login/route");
  const progressRoute = await import("../app/api/incidents/[id]/progress/route");
  const milestonesRoute = await import("../app/api/incidents/[id]/milestones/route");
  const confirmRoute = await import("../app/api/incidents/[id]/confirm/route");
  const approvalRoute = await import("../app/api/incidents/[id]/approval/route");
  const compSubmitRoute = await import("../app/api/incidents/[id]/completion/submit/route");
  const compApproveRoute = await import("../app/api/incidents/[id]/completion/approve/route");
  const compCloseRoute = await import("../app/api/incidents/[id]/completion/close/route");
  const { submitMilestoneFlexible } = await import("../lib/milestone-service");
  const { EstimationIntegrationService } = await import("../lib/estimation-service");

  // Helper: Create minimal 800x600 JPEG buffer
  // Realistic dimensions for watermark processing
  const dummyJpegBuffer = Buffer.concat([
    Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x01, 0x00, 0x48, 0x00, 0x48, 0x00, 0x00]),
    Buffer.alloc(2000, 0xaa),
    Buffer.from([0xff, 0xd9])
  ]);

  // Read realistic JPEG fixture
  const fixturePath = path.join(process.cwd(), "tests/fixtures/test-evidence.jpg");
  const photoBuffer = fs.existsSync(fixturePath) ? fs.readFileSync(fixturePath) : dummyJpegBuffer;

  // Read pilot credentials if present
  const pilotCredsPath = path.join(process.cwd(), ".env.pilot-credentials.local");
  const creds: Record<string, string> = {};
  if (fs.existsSync(pilotCredsPath)) {
    const lines = fs.readFileSync(pilotCredsPath, "utf8").split("\n");
    for (const line of lines) {
      const match = line.match(/^([A-Z0-9_]+)=["']?([^"'\r\n]+)["']?/);
      if (match) creds[match[1]] = match[2].trim();
    }
  }
  const sysadminPassword = creds["PROD_SYSADMIN_PASSWORD"] || "pass123";

  // Helper: Authenticate Persona
  async function authUser(identifier: string, pass = "pass123"): Promise<string> {
    const req = new Request("http://localhost:3004/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identifier, password: pass }),
    });
    const res = await loginRoute.POST(req);
    const cookie = extractCookie(res);
    if (!cookie) throw new Error(`Login failed for identifier: ${identifier} (status: ${res.status})`);
    return cookie;
  }

  // 1. Authenticate Personas
  console.log("--> Authenticating Test Personas...");
  const bmsCookie = await authUser("bms", "pass123");
  const besCookie = await authUser("bes", "pass123");
  const bbsCookie = await authUser("bbs", "pass123");
  const bmcCookie = await authUser("bmc", "pass123");
  const becCookie = await authUser("bec", "pass123");
  const bmmCookie = await authUser("bmm", "pass123");
  const hoCookie = await authUser("UAT_HO0001", "pass123");
  const adminCookie = await authUser("ADM0001", sysadminPassword);

  // Ensure estimation routes table exists
  const { ensureEstimationRoutesTable } = await import("../lib/estimation-service");
  await ensureEstimationRoutesTable();

  // Helper: Seed Incident Directly into Aiven isolated database
  async function seedTestIncident(params: {
    id: string;
    branch: string;
    tkpType: "toko" | "dc" | "building";
    locationKind: "STORE" | "FACILITY";
    status: string;
    progress?: number;
    storeName: string;
    storeId?: string;
  }): Promise<void> {
    await pool.query(
      `INSERT INTO incidents (
        id, date, disaster_type, status, progress, branch,
        location_kind, location_id, store_id, store_name, tkp_type,
        created_at, updated_at, reporter
      ) VALUES ($1, NOW(), $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), NOW(), $11)
      ON CONFLICT (id) DO UPDATE SET
        status = EXCLUDED.status,
        progress = EXCLUDED.progress,
        updated_at = NOW()`,
      [
        params.id,
        "earthquake",
        params.status,
        params.progress ?? 0,
        params.branch,
        params.locationKind,
        params.storeId || params.id,
        params.storeId || params.id,
        params.storeName,
        params.tkpType,
        JSON.stringify({ id: "test_system", name: "Test System", role: "system" })
      ]
    );

    // Seed estimation route to READY_FOR_WORK if status is in_maintenance
    if (params.status === "in_maintenance" || params.status === "awaiting_st") {
      const handlerType = params.tkpType === "dc" ? "BES" : params.tkpType === "building" ? "BUILDING" : "BMS";
      await pool.query(
        `INSERT INTO report_estimation_routes (
          id, report_id, handler_type, target_system, routing_status, status, work_status,
          data_source, created_by, created_by_name, created_at, updated_at
        ) VALUES ($1, $2, $3, 'SPARTA_MAINTENANCE', 'READY_FOR_WORK', 'READY_FOR_WORK', 'READY_FOR_WORK', 'MANUAL', 'system', 'System', NOW(), NOW())
        ON CONFLICT (report_id) DO UPDATE SET
          work_status = EXCLUDED.work_status,
          updated_at = NOW()`,
        [`est_${params.id}`, params.id, handlerType]
      );
    }
  }

  // ============================================================================
  // CATEGORY 1: CODEBASE AUDIT (ZERO SLIDER IN CODEBASE)
  // ============================================================================
  console.log("\n--> Category 1: Codebase Audit (Zero Range Slider Verification)");
  {
    const filesToCheck = [
      "components/incident/progress-update-modal.tsx",
      "components/incident/maintenance-tracking-modal.tsx",
      "components/incident/milestone-progression-card.tsx",
      "components/reports/operational-report-center.tsx",
    ];

    let foundRange = false;
    let foundRangeFile = "";

    for (const f of filesToCheck) {
      const fullPath = path.join(process.cwd(), f);
      if (fs.existsSync(fullPath)) {
        const text = fs.readFileSync(fullPath, "utf8");
        if (text.includes('type="range"') || text.includes("type='range'")) {
          foundRange = true;
          foundRangeFile = f;
          break;
        }
      }
    }

    record(
      "SLIDER-01",
      "Codebase Audit",
      "Interactive percentage slider completely removed from progress modal & incident components",
      !foundRange,
      !foundRange ? "Zero type='range' found across all incident components." : `Found type='range' in ${foundRangeFile}`
    );
  }

  // ============================================================================
  // CATEGORY 2: NUMERIC PROGRESS VALIDATION & BOUNDS
  // ============================================================================
  console.log("\n--> Category 2: Numeric Progress Validation & Server-Side Bounds");
  {
    const testReportId = `test_num_val_${Date.now()}`;
    await seedTestIncident({
      id: testReportId,
      branch: "Bandung",
      tkpType: "toko",
      locationKind: "STORE",
      status: "in_maintenance",
      progress: 20,
      storeName: "Alfamart Dago Bandung",
    });

    // Helper: submit progress via multipart
    async function postProgress(cookie: string, percentage: any, desc = "Test work progress") {
      const boundary = "----WebKitFormBoundary" + Math.random().toString(36).substring(2);
      const parts: Buffer[] = [];

      parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="progress_percentage"\r\n\r\n${percentage}\r\n`));
      parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="description"\r\n\r\n${desc}\r\n`));
      parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="stage"\r\n\r\nPENGERJAAN\r\n`));
      parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="photo_type"\r\n\r\nPROGRESS\r\n`));

      // Append file
      parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="photos"; filename="test.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`));
      parts.push(photoBuffer);
      parts.push(Buffer.from(`\r\n--${boundary}--\r\n`));

      const bodyBuffer = Buffer.concat(parts);

      const req = new Request(`http://localhost:3004/api/incidents/${testReportId}/progress`, {
        method: "POST",
        headers: {
          "Content-Type": `multipart/form-data; boundary=${boundary}`,
          cookie: `siaga_session=${cookie}`,
        },
        body: bodyBuffer,
      });

      return await progressRoute.POST(req, { params: Promise.resolve({ id: testReportId }) });
    }

    // 2.1 Rejects non-numeric percentage
    const nonNumericRes = await postProgress(bmsCookie, "abc");
    const nonNumericJson = await nonNumericRes.json();
    record(
      "NUM-01",
      "Numeric Bounds",
      "Server rejects non-numeric progress percentage (string 'abc') with HTTP 400",
      nonNumericRes.status === 400 && String(nonNumericJson.error).includes("0% dan 100%"),
      `Status: ${nonNumericRes.status}, error: ${nonNumericJson.error}`
    );

    // 2.2 Rejects negative percentage
    const negativeRes = await postProgress(bmsCookie, -10);
    const negativeJson = await negativeRes.json();
    record(
      "NUM-02",
      "Numeric Bounds",
      "Server rejects negative percentage (-10%) with HTTP 400",
      negativeRes.status === 400 && String(negativeJson.error).includes("0% dan 100%"),
      `Status: ${negativeRes.status}, error: ${negativeJson.error}`
    );

    // 2.3 Rejects percentage > 100
    const over100Res = await postProgress(bmsCookie, 115);
    const over100Json = await over100Res.json();
    record(
      "NUM-03",
      "Numeric Bounds",
      "Server rejects progress percentage exceeding 100% (115%) with HTTP 400",
      over100Res.status === 400 && String(over100Json.error).includes("0% dan 100%"),
      `Status: ${over100Res.status}, error: ${over100Json.error}`
    );

    // 2.4 Rejects decreasing percentage (< latestProgress 20%)
    const lowerRes = await postProgress(bmsCookie, 15);
    const lowerJson = await lowerRes.json();
    record(
      "NUM-04",
      "Numeric Bounds",
      "Server enforces monotonic progress and rejects decreasing value (15% < 20%) with HTTP 400",
      lowerRes.status === 400 && String(lowerJson.error).includes("lebih kecil dari progress sebelumnya"),
      `Status: ${lowerRes.status}, error: ${lowerJson.error}`
    );

    // 2.5 Server rejects floating point/decimal percentage (50.5) without parseInt truncation
    const decimalRes = await postProgress(bmsCookie, "50.5");
    const decimalJson = await decimalRes.json();
    record(
      "NUM-06",
      "Numeric Bounds",
      "Server rejects decimal progress percentage (50.5) with HTTP 400 without auto-truncating",
      decimalRes.status === 400 && String(decimalJson.error).includes("bilangan bulat"),
      `Status: ${decimalRes.status}, error: ${decimalJson.error}`
    );

    // 2.6 Server rejects alphanumeric suffix percentage ("50abc") without parseInt truncation
    const suffixRes = await postProgress(bmsCookie, "50abc");
    const suffixJson = await suffixRes.json();
    record(
      "NUM-07",
      "Numeric Bounds",
      "Server rejects alphanumeric progress ('50abc') with HTTP 400 without parseInt truncation",
      suffixRes.status === 400 && String(suffixJson.error).includes("bilangan bulat"),
      `Status: ${suffixRes.status}, error: ${suffixJson.error}`
    );

    // 2.7 Valid monotonic progress update succeeds (50%)
    const validRes = await postProgress(bmsCookie, 50, "Pengerjaan struktur atap toko 50%");
    const validJson = await validRes.json();
    const updatedInc = await dbGetIncidentById(testReportId);
    record(
      "NUM-05",
      "Numeric Bounds",
      "Server accepts valid numeric progress update (50%) and persists to database",
      validRes.status === 201 && updatedInc?.progress === 50,
      `Status: ${validRes.status}, saved progress: ${updatedInc?.progress}%`
    );
  }

  // ============================================================================
  // CATEGORY 3: PREMATURE MAINTENANCE PROGRESS BLOCKING
  // ============================================================================
  console.log("\n--> Category 3: Premature Maintenance Progress Blocking");
  {
    // Helper function for sending simple progress request
    async function postProgressToReport(reportId: string, cookie: string) {
      const boundary = "----WebKitFormBoundary" + Math.random().toString(36).substring(2);
      const parts: Buffer[] = [
        Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="progress_percentage"\r\n\r\n30\r\n`),
        Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="description"\r\n\r\nPremature test\r\n`),
        Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="stage"\r\n\r\nPENGERJAAN\r\n`),
        Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="photos"; filename="test.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`),
        photoBuffer,
        Buffer.from(`\r\n--${boundary}--\r\n`)
      ];

      const req = new Request(`http://localhost:3004/api/incidents/${reportId}/progress`, {
        method: "POST",
        headers: {
          "Content-Type": `multipart/form-data; boundary=${boundary}`,
          cookie: `siaga_session=${cookie}`,
        },
        body: Buffer.concat(parts),
      });

      return await progressRoute.POST(req, { params: Promise.resolve({ id: reportId }) });
    }

    // 3.1 Block progress on pending_confirmation
    const unconfirmedId = `test_unconf_${Date.now()}`;
    await seedTestIncident({
      id: unconfirmedId,
      branch: "Bandung",
      tkpType: "toko",
      locationKind: "STORE",
      status: "pending_confirmation",
      storeName: "Alfamart Unconfirmed",
    });
    const unconfRes = await postProgressToReport(unconfirmedId, bmsCookie);
    const unconfJson = await unconfRes.json();
    record(
      "PRE-01",
      "Lifecycle Gating",
      "Server blocks progress updates on unconfirmed report (pending_confirmation) with HTTP 422 REPORT_NOT_APPROVED",
      unconfRes.status === 422 && unconfJson.code === "REPORT_NOT_APPROVED",
      `Status: ${unconfRes.status}, code: ${unconfJson.code}`
    );

    // 3.2 Block progress on pending_bm_approval
    const pendingBmId = `test_pend_bm_${Date.now()}`;
    await seedTestIncident({
      id: pendingBmId,
      branch: "Bandung",
      tkpType: "toko",
      locationKind: "STORE",
      status: "pending_bm_approval",
      storeName: "Alfamart Pending BnM",
    });
    const pendingBmRes = await postProgressToReport(pendingBmId, bmsCookie);
    const pendingBmJson = await pendingBmRes.json();
    record(
      "PRE-02",
      "Lifecycle Gating",
      "Server blocks progress updates while awaiting initial BnM confirmation with HTTP 422 REPORT_NOT_APPROVED",
      pendingBmRes.status === 422 && pendingBmJson.code === "REPORT_NOT_APPROVED",
      `Status: ${pendingBmRes.status}, code: ${pendingBmJson.code}`
    );

    // 3.3 Block progress on clarification_requested
    const clarId = `test_clar_${Date.now()}`;
    await seedTestIncident({
      id: clarId,
      branch: "Bandung",
      tkpType: "toko",
      locationKind: "STORE",
      status: "clarification_requested",
      storeName: "Alfamart Clarification",
    });
    const clarRes = await postProgressToReport(clarId, bmsCookie);
    const clarJson = await clarRes.json();
    record(
      "PRE-03",
      "Lifecycle Gating",
      "Server blocks progress updates on report undergoing clarification loopback with HTTP 422 REPORT_NOT_APPROVED",
      clarRes.status === 422 && clarJson.code === "REPORT_NOT_APPROVED",
      `Status: ${clarRes.status}, code: ${clarJson.code}`
    );

    // 3.4 Block progress on terminal safe report (confirmed_safe)
    const safeId = `test_safe_${Date.now()}`;
    await seedTestIncident({
      id: safeId,
      branch: "Bandung",
      tkpType: "toko",
      locationKind: "STORE",
      status: "confirmed_safe",
      progress: 100,
      storeName: "Alfamart Safe Report",
    });
    const safeRes = await postProgressToReport(safeId, bmsCookie);
    const safeJson = await safeRes.json();
    record(
      "TERM-01",
      "Terminal Gating",
      "Server blocks progress updates on no-damage safe report (confirmed_safe) with HTTP 422 REPORT_TERMINAL",
      safeRes.status === 422 && safeJson.code === "REPORT_TERMINAL",
      `Status: ${safeRes.status}, code: ${safeJson.code}`
    );

    // 3.5 Block progress on closed report
    const closedId = `test_closed_${Date.now()}`;
    await seedTestIncident({
      id: closedId,
      branch: "Bandung",
      tkpType: "toko",
      locationKind: "STORE",
      status: "closed",
      progress: 100,
      storeName: "Alfamart Closed Report",
    });
    const closedRes = await postProgressToReport(closedId, bmsCookie);
    const closedJson = await closedRes.json();
    record(
      "TERM-02",
      "Terminal Gating",
      "Server blocks progress updates on officially closed report with HTTP 422 REPORT_CLOSED",
      closedRes.status === 422 && closedJson.code === "REPORT_CLOSED",
      `Status: ${closedRes.status}, code: ${closedJson.code}`
    );
  }

  // ============================================================================
  // CATEGORY 4: FACILITY-BASED & ROLE-BASED ACCESS ISOLATION
  // ============================================================================
  console.log("\n--> Category 4: Facility-Based & Role-Based Access Isolation");
  {
    // Helper to send progress update
    async function submitProgress(reportId: string, cookie: string, pct = 25) {
      const boundary = "----WebKitFormBoundary" + Math.random().toString(36).substring(2);
      const parts: Buffer[] = [
        Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="progress_percentage"\r\n\r\n${pct}\r\n`),
        Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="description"\r\n\r\nFacility role test\r\n`),
        Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="stage"\r\n\r\nPENGERJAAN\r\n`),
        Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="photos"; filename="test.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`),
        photoBuffer,
        Buffer.from(`\r\n--${boundary}--\r\n`)
      ];

      const req = new Request(`http://localhost:3004/api/incidents/${reportId}/progress`, {
        method: "POST",
        headers: {
          "Content-Type": `multipart/form-data; boundary=${boundary}`,
          cookie: `siaga_session=${cookie}`,
        },
        body: Buffer.concat(parts),
      });

      return await progressRoute.POST(req, { params: Promise.resolve({ id: reportId }) });
    }

    // 4.1 Toko Facility Isolation
    const tokoReportId = `test_toko_fac_${Date.now()}`;
    await seedTestIncident({
      id: tokoReportId,
      branch: "Bandung",
      tkpType: "toko",
      locationKind: "STORE",
      status: "in_maintenance",
      progress: 0,
      storeName: "Alfamart Toko Test",
    });

    // BMS on Toko -> Allowed
    const bmsTokoRes = await submitProgress(tokoReportId, bmsCookie, 30);
    record(
      "FAC-01",
      "Facility Role RBAC",
      "BMS specialist is authorized to update work progress on Store (Toko) facility",
      bmsTokoRes.status === 201,
      `Status: ${bmsTokoRes.status}`
    );

    // BES on Toko -> Rejected HTTP 403 FACILITY_ROLE_MISMATCH
    const besTokoRes = await submitProgress(tokoReportId, besCookie, 40);
    const besTokoJson = await besTokoRes.json();
    record(
      "FAC-02",
      "Facility Role RBAC",
      "BES (DC specialist) is rejected with HTTP 403 FACILITY_ROLE_MISMATCH on Store (Toko) facility",
      besTokoRes.status === 403 && besTokoJson.code === "FACILITY_ROLE_MISMATCH",
      `Status: ${besTokoRes.status}, code: ${besTokoJson.code}`
    );

    // BBS on Toko -> Rejected HTTP 403 FACILITY_ROLE_MISMATCH
    const bbsTokoRes = await submitProgress(tokoReportId, bbsCookie, 40);
    const bbsTokoJson = await bbsTokoRes.json();
    record(
      "FAC-03",
      "Facility Role RBAC",
      "BBS (Building specialist) is rejected with HTTP 403 FACILITY_ROLE_MISMATCH on Store (Toko) facility",
      bbsTokoRes.status === 403 && bbsTokoJson.code === "FACILITY_ROLE_MISMATCH",
      `Status: ${bbsTokoRes.status}, code: ${bbsTokoJson.code}`
    );

    // 4.2 DC Facility Isolation
    const dcReportId = `test_dc_fac_${Date.now()}`;
    await seedTestIncident({
      id: dcReportId,
      branch: "Bandung",
      tkpType: "dc",
      locationKind: "FACILITY",
      status: "in_maintenance",
      progress: 0,
      storeName: "DC Warehouse Bandung",
    });

    // BES on DC -> Allowed
    const besDcRes = await submitProgress(dcReportId, besCookie, 30);
    record(
      "FAC-04",
      "Facility Role RBAC",
      "BES specialist is authorized to update work progress on DC (Distribution Center) facility",
      besDcRes.status === 201,
      `Status: ${besDcRes.status}`
    );

    // BMS on DC -> Rejected HTTP 403 FACILITY_ROLE_MISMATCH
    const bmsDcRes = await submitProgress(dcReportId, bmsCookie, 40);
    const bmsDcJson = await bmsDcRes.json();
    record(
      "FAC-05",
      "Facility Role RBAC",
      "BMS (Store specialist) is rejected with HTTP 403 FACILITY_ROLE_MISMATCH on DC facility",
      bmsDcRes.status === 403 && bmsDcJson.code === "FACILITY_ROLE_MISMATCH",
      `Status: ${bmsDcRes.status}, code: ${bmsDcJson.code}`
    );

    // 4.3 Building Facility Isolation
    const bldReportId = `test_bld_fac_${Date.now()}`;
    await seedTestIncident({
      id: bldReportId,
      branch: "Bandung",
      tkpType: "building",
      locationKind: "FACILITY",
      status: "in_maintenance",
      progress: 0,
      storeName: "Kantor Cabang Bandung",
    });

    // BBS on Building -> Allowed
    const bbsBldRes = await submitProgress(bldReportId, bbsCookie, 30);
    record(
      "FAC-06",
      "Facility Role RBAC",
      "BBS specialist is authorized to update work progress on Building (Office) facility",
      bbsBldRes.status === 201,
      `Status: ${bbsBldRes.status}`
    );

    // BMS on Building -> Rejected HTTP 403 FACILITY_ROLE_MISMATCH
    const bmsBldRes = await submitProgress(bldReportId, bmsCookie, 40);
    const bmsBldJson = await bmsBldRes.json();
    record(
      "FAC-07",
      "Facility Role RBAC",
      "BMS (Store specialist) is rejected with HTTP 403 FACILITY_ROLE_MISMATCH on Building facility",
      bmsBldRes.status === 403 && bmsBldJson.code === "FACILITY_ROLE_MISMATCH",
      `Status: ${bmsBldRes.status}, code: ${bmsBldJson.code}`
    );

    // 4.4 Milestone Upload Facility Check
    // Helper to post milestone document
    async function submitMilestone(reportId: string, cookie: string, stageKey = "CEKLIS") {
      const boundary = "----WebKitFormBoundary" + Math.random().toString(36).substring(2);
      const parts: Buffer[] = [
        Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="stage_key"\r\n\r\n${stageKey}\r\n`),
        Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="notes"\r\n\r\nMilestone upload test\r\n`),
        Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="test.pdf"\r\nContent-Type: application/pdf\r\n\r\n`),
        Buffer.from("%PDF-1.4 test document content %EOF"),
        Buffer.from(`\r\n--${boundary}--\r\n`)
      ];

      const req = new Request(`http://localhost:3004/api/incidents/${tokoReportId}/milestones`, {
        method: "POST",
        headers: {
          "Content-Type": `multipart/form-data; boundary=${boundary}`,
          cookie: `siaga_session=${cookie}`,
        },
        body: Buffer.concat(parts),
      });

      return await milestonesRoute.POST(req, { params: Promise.resolve({ id: tokoReportId }) });
    }

    // BES on Toko milestone -> Rejected HTTP 403 FACILITY_ROLE_MISMATCH
    const besMileRes = await submitMilestone(tokoReportId, besCookie);
    const besMileJson = await besMileRes.json();
    record(
      "MILE-01",
      "Facility Role RBAC",
      "BES specialist is rejected with HTTP 403 FACILITY_ROLE_MISMATCH on Store milestone upload",
      besMileRes.status === 403 && besMileJson.code === "FACILITY_ROLE_MISMATCH",
      `Status: ${besMileRes.status}, code: ${besMileJson.code}`
    );

    // 4.5 Cross-Branch Isolation
    // Seed Sidoarjo report, attempt update with Bandung BMS
    const sidoarjoReportId = `test_sid_rep_${Date.now()}`;
    await seedTestIncident({
      id: sidoarjoReportId,
      branch: "Sidoarjo",
      tkpType: "toko",
      locationKind: "STORE",
      status: "in_maintenance",
      progress: 0,
      storeName: "Alfamart Sidoarjo Test",
    });

    const crossBranchRes = await submitProgress(sidoarjoReportId, bmsCookie, 30);
    const crossBranchJson = await crossBranchRes.json();
    record(
      "BRANCH-01",
      "Branch Isolation",
      "Bandung specialist is rejected with HTTP 403 BRANCH_MISMATCH on Sidoarjo report",
      crossBranchRes.status === 403 && (crossBranchJson.code === "BRANCH_MISMATCH" || String(crossBranchJson.error).includes("cabang sendiri")),
      `Status: ${crossBranchRes.status}, code: ${crossBranchJson.code || "BRANCH_ISOLATION"}`
    );

    // 4.6 Head Office Operational Mutation Prohibition
    const hoProgressRes = await submitProgress(tokoReportId, hoCookie, 50);
    record(
      "HO-01",
      "HO Read-Only",
      "Head Office user is rejected with HTTP 403 Forbidden on progress update",
      hoProgressRes.status === 403,
      `Status: ${hoProgressRes.status}`
    );

    const hoMileRes = await submitMilestone(tokoReportId, hoCookie);
    record(
      "HO-02",
      "HO Read-Only",
      "Head Office user is rejected with HTTP 403 Forbidden on milestone document upload",
      hoMileRes.status === 403,
      `Status: ${hoMileRes.status}`
    );

    // 4.7 System Admin Operational Mutation Prohibition (Milestone Upload)
    const adminMileRes = await submitMilestone(tokoReportId, adminCookie);
    record(
      "ADMIN-MILE-01",
      "Admin Operational Separation",
      "System Administrator is rejected with HTTP 403 on operational milestone upload",
      adminMileRes.status === 403,
      `Status: ${adminMileRes.status}`
    );
  }

  // ============================================================================
  // CATEGORY 5: PROGRESS 100% NON-AUTO-CLOSE RULE
  // ============================================================================
  console.log("\n--> Category 5: Progress 100% Non-Auto-Close Rule");
  {
    const p100ReportId = `test_p100_${Date.now()}`;
    await seedTestIncident({
      id: p100ReportId,
      branch: "Bandung",
      tkpType: "toko",
      locationKind: "STORE",
      status: "in_maintenance",
      progress: 50,
      storeName: "Alfamart 100% Test",
    });

    // Submit progress to 100% with FINAL photo evidence
    const boundary = "----WebKitFormBoundary" + Math.random().toString(36).substring(2);
    const parts: Buffer[] = [
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="progress_percentage"\r\n\r\n100\r\n`),
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="description"\r\n\r\nFisik selesai 100%\r\n`),
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="stage"\r\n\r\nSELESAI\r\n`),
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="photo_type"\r\n\r\nFINAL\r\n`),
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="photos"; filename="final.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`),
      photoBuffer,
      Buffer.from(`\r\n--${boundary}--\r\n`)
    ];

    const req = new Request(`http://localhost:3004/api/incidents/${p100ReportId}/progress`, {
      method: "POST",
      headers: {
        "Content-Type": `multipart/form-data; boundary=${boundary}`,
        cookie: `siaga_session=${bmsCookie}`,
      },
      body: Buffer.concat(parts),
    });

    const p100Res = await progressRoute.POST(req, { params: Promise.resolve({ id: p100ReportId }) });
    const p100Inc = await dbGetIncidentById(p100ReportId);

    const isNonAutoClose =
      p100Res.status === 201 &&
      p100Inc?.progress === 100 &&
      p100Inc?.status !== "closed" &&
      p100Inc?.status !== "resolved";

    record(
      "NON-CLOSE-01",
      "Non-Auto-Close",
      "Progress reaching 100% updates progress to 100 but NEVER automatically closes or resolves incident",
      isNonAutoClose,
      `Status: ${p100Res.status}, incident progress: ${p100Inc?.progress}%, incident status: ${p100Inc?.status} (not closed/resolved)`
    );
  }

  // ============================================================================
  // CATEGORY 6: COORDINATOR APPROVAL & BNM CASE CLOSE SEPARATION
  // ============================================================================
  console.log("\n--> Category 6: Coordinator Review & BnM Case Close Separation");
  {
    const approvalReportId = `test_appr_sep_${Date.now()}`;
    await seedTestIncident({
      id: approvalReportId,
      branch: "Bandung",
      tkpType: "toko",
      locationKind: "STORE",
      status: "in_maintenance",
      progress: 100,
      storeName: "Alfamart Approval Sep",
    });

    // Update estimation route workStatus to IN_PROGRESS then COMPLETED
    await EstimationIntegrationService.updateWorkStatus(approvalReportId, "IN_PROGRESS", { bypassReadinessValidation: true });
    await EstimationIntegrationService.updateWorkStatus(approvalReportId, "COMPLETED", { bypassReadinessValidation: true });

    // Submit all 5 milestones required for manager approval
    const bmsUserCtx = {
      id: "usr_bms_bdg_01",
      name: "Demo BMS Bandung",
      role: "bms" as any,
      systemRole: "USER" as any,
      scope: "BRANCH" as any,
      branch: "BANDUNG",
    };
    const milestoneStages = [
      { key: "CEKLIS", file: "CEKLIS-001.pdf", desc: "Dokumen Ceklis" },
      { key: "ESTIMASI", file: "ESTIMASI-001.pdf", desc: "Dokumen Estimasi" },
      { key: "APPROVE_PROXY", file: "APPROVE-PROXY-001.pdf", desc: "Dokumen Proxy" },
      { key: "SPK", file: "SPK-001.pdf", desc: "Surat Perintah Kerja" },
      { key: "SERAH_TERIMA", file: "ST-001.pdf", desc: "Dokumen Serah Terima" },
    ];
    for (const m of milestoneStages) {
      await submitMilestoneFlexible({
        reportId: approvalReportId,
        stageKey: m.key as any,
        actor: bmsUserCtx,
        originalFilename: m.file,
        fileBuffer: Buffer.from(`%PDF-1.4 test ${m.desc}`),
        notes: `Test dokumen ${m.desc}`,
      });
    }

    // System Admin attempt to submit completion -> Rejected with HTTP 403
    const adminSubmitReq = new Request(`http://localhost:3004/api/incidents/${approvalReportId}/completion/submit`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        cookie: `siaga_session=${adminCookie}`,
      },
      body: JSON.stringify({ notes: "Attempted completion submit by System Admin." }),
    });
    const adminSubmitRes = await compSubmitRoute.POST(adminSubmitReq, { params: Promise.resolve({ id: approvalReportId }) });
    record(
      "ADMIN-SUBMIT-01",
      "Admin Operational Separation",
      "System Administrator is rejected with HTTP 403 from submitting operational completion",
      adminSubmitRes.status === 403,
      `Status: ${adminSubmitRes.status}`
    );

    // Coordinator attempt to approve BEFORE PIC submits completion -> Rejected with HTTP 400 INVALID_APPROVAL_STATE
    const earlyCoordReq = new Request(`http://localhost:3004/api/incidents/${approvalReportId}/completion/approve`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        cookie: `siaga_session=${bmcCookie}`,
      },
      body: JSON.stringify({ notes: "Early approve before submission." }),
    });
    const earlyCoordRes = await compApproveRoute.POST(earlyCoordReq, { params: Promise.resolve({ id: approvalReportId }) });
    const earlyCoordJson = await earlyCoordRes.json();
    record(
      "COORD-PRE-01",
      "Coordinator Gate",
      "Coordinator approval is rejected with HTTP 400 before PIC officially submits completion",
      earlyCoordRes.status === 400 && (earlyCoordJson.code === "INVALID_APPROVAL_STATE" || String(earlyCoordJson.error).includes("WAITING_PIC_SUBMISSION")),
      `Status: ${earlyCoordRes.status}, code: ${earlyCoordJson.code}`
    );

    // BMS submits completion (transitions to awaiting_st / WAITING_COORDINATOR_APPROVAL)
    const compSubmitReq = new Request(`http://localhost:3004/api/incidents/${approvalReportId}/completion/submit`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        cookie: `siaga_session=${bmsCookie}`,
      },
      body: JSON.stringify({ notes: "Pekerjaan fisik telah 100% dan dokumen ST terlampir." }),
    });
    const compSubmitRes = await compSubmitRoute.POST(compSubmitReq, { params: Promise.resolve({ id: approvalReportId }) });
    const submittedInc = await dbGetIncidentById(approvalReportId);
    record(
      "SUBMIT-SYNC-01",
      "Lifecycle Synchronization",
      "After PIC submits completion, incident status transitions to awaiting_st (not pending_final_approval)",
      compSubmitRes.status === 200 && submittedInc?.status === "awaiting_st",
      `Status: ${compSubmitRes.status}, incident status: ${submittedInc?.status}`
    );

    // Helper: Coordinator approval request
    async function postCoordApproval(cookie: string) {
      const req = new Request(`http://localhost:3004/api/incidents/${approvalReportId}/completion/approve`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          cookie: `siaga_session=${cookie}`,
        },
        body: JSON.stringify({ notes: "Pekerjaan fisik toko sesuai standar BMC." }),
      });
      return await compApproveRoute.POST(req, { params: Promise.resolve({ id: approvalReportId }) });
    }

    // 6.1 BEC (DC Coordinator) on Toko report -> Rejected HTTP 403 COORDINATOR_MISMATCH
    const becTokoRes = await postCoordApproval(becCookie);
    const becTokoJson = await becTokoRes.json();
    record(
      "COORD-01",
      "Coordinator Review",
      "BEC coordinator is rejected with HTTP 403 COORDINATOR_MISMATCH on Store (Toko) completion",
      becTokoRes.status === 403 && (becTokoJson.code === "COORDINATOR_MISMATCH" || String(becTokoJson.error).includes("BMC")),
      `Status: ${becTokoRes.status}, error: ${becTokoJson.error}`
    );

    // 6.2 BMC (Store Coordinator) on Toko report -> Authorized
    const bmcTokoRes = await postCoordApproval(bmcCookie);
    const coordApprovedInc = await dbGetIncidentById(approvalReportId);
    record(
      "COORD-02",
      "Coordinator Review",
      "BMC coordinator is authorized to approve Toko completion review",
      bmcTokoRes.status === 200,
      `Status: ${bmcTokoRes.status}`
    );
    record(
      "COORD-SYNC-01",
      "Lifecycle Synchronization",
      "After coordinator approves, incident status transitions to pending_final_approval for BnM Manajer",
      bmcTokoRes.status === 200 && coordApprovedInc?.status === "pending_final_approval",
      `Status: ${bmcTokoRes.status}, incident status: ${coordApprovedInc?.status}`
    );

    // 6.3 Coordinator cannot execute Case Close
    const coordCloseReq = new Request(`http://localhost:3004/api/incidents/${approvalReportId}/completion/close`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        cookie: `siaga_session=${bmcCookie}`,
      },
      body: JSON.stringify({ notes: "Attempted close by coordinator." }),
    });
    const coordCloseRes = await compCloseRoute.POST(coordCloseReq, { params: Promise.resolve({ id: approvalReportId }) });
    record(
      "COORD-03",
      "Case Close Authority",
      "BMC coordinator is rejected with HTTP 403 from executing official Case Close",
      coordCloseRes.status === 403,
      `Status: ${coordCloseRes.status}`
    );

    // 6.4 System Admin cannot bypass operational Case Close
    const adminCloseReq = new Request(`http://localhost:3004/api/incidents/${approvalReportId}/completion/close`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        cookie: `siaga_session=${adminCookie}`,
      },
      body: JSON.stringify({ notes: "Attempted close by System Admin." }),
    });
    const adminCloseRes = await compCloseRoute.POST(adminCloseReq, { params: Promise.resolve({ id: approvalReportId }) });
    record(
      "CLOSE-01",
      "Zero Admin Bypass",
      "System Administrator is rejected with HTTP 403 from executing operational Case Close",
      adminCloseRes.status === 403,
      `Status: ${adminCloseRes.status}`
    );

    // BnM Manajer grants final approval before Case Close
    const bmmApproveReq = new Request(`http://localhost:3004/api/incidents/${approvalReportId}/completion/approve`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        cookie: `siaga_session=${bmmCookie}`,
      },
      body: JSON.stringify({ notes: "Persetujuan final serah terima pekerjaan diberikan oleh BnM Manajer Bandung." }),
    });
    await compApproveRoute.POST(bmmApproveReq, { params: Promise.resolve({ id: approvalReportId }) });

    // 6.5 BnM Manajer executes official Case Close
    const bmmCloseReq = new Request(`http://localhost:3004/api/incidents/${approvalReportId}/completion/close`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        cookie: `siaga_session=${bmmCookie}`,
      },
      body: JSON.stringify({ notes: "Laporan resmi ditutup oleh BnM Manajer Bandung." }),
    });
    const bmmCloseRes = await compCloseRoute.POST(bmmCloseReq, { params: Promise.resolve({ id: approvalReportId }) });
    const finalInc = await dbGetIncidentById(approvalReportId);
    record(
      "CLOSE-02",
      "Case Close Authority",
      "BnM Manajer successfully executes official Case Close (status transitions to closed)",
      bmmCloseRes.status === 200 && (finalInc?.status === "closed" || finalInc?.status === "resolved"),
      `Status: ${bmmCloseRes.status}, incident final status: ${finalInc?.status}`
    );
  }

  // ============================================================================
  // CATEGORY 7: NO-DAMAGE (SAFE) & CLARIFICATION LIFECYCLES
  // ============================================================================
  console.log("\n--> Category 7: No-Damage Safe Resolution & Clarification Loopback");
  {
    // 7.1 Safe Path (Tidak Ada Kerusakan)
    const safeReportId = `test_safe_flow_${Date.now()}`;
    await seedTestIncident({
      id: safeReportId,
      branch: "Bandung",
      tkpType: "toko",
      locationKind: "STORE",
      status: "pending_confirmation",
      progress: 0,
      storeName: "Alfamart Safe Flow",
    });

    // BMS submits inspection with condition 'safe' and photographic evidence
    const bmsInspectReq = new Request(`http://localhost:3004/api/incidents/${safeReportId}/confirm`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        cookie: `siaga_session=${bmsCookie}`,
      },
      body: JSON.stringify({
        condition: "safe",
        inspection_method: "kunjungan_langsung",
        notes: "Pemeriksaan struktur gedung selesai: kondisi aman, tidak ada kerusakan fisik.",
        operational_status: "Buka Normal",
        photos: ["https://sparta-siaga.local/storage/evidence/p4_safe_test.jpg"],
      }),
    });
    await confirmRoute.POST(bmsInspectReq, { params: Promise.resolve({ id: safeReportId }) });

    // BnM confirms safe via approval route
    const safeDecisionReq = new Request(`http://localhost:3004/api/incidents/${safeReportId}/approval`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        cookie: `siaga_session=${bmmCookie}`,
      },
      body: JSON.stringify({
        decision: "safe",
        notes: "Kondisi fisik aman dan operasional normal tanpa kerusakan.",
      }),
    });
    const safeDecisionRes = await approvalRoute.POST(safeDecisionReq, { params: Promise.resolve({ id: safeReportId }) });
    const safeInc = await dbGetIncidentById(safeReportId);

    const isSafeResolved =
      safeDecisionRes.status === 200 &&
      safeInc?.status === "confirmed_safe" &&
      safeInc?.progress === 100;

    record(
      "SAFE-01",
      "No-Damage Flow",
      "BnM Manajer decision 'Tidak Ada Kerusakan' advances report directly to confirmed_safe with 100% progress and no maintenance required",
      isSafeResolved,
      `Status: ${safeDecisionRes.status}, incident status: ${safeInc?.status}, progress: ${safeInc?.progress}%`
    );

    // 7.2 Clarification Loopback
    const clarReportId = `test_clar_flow_${Date.now()}`;
    await seedTestIncident({
      id: clarReportId,
      branch: "Bandung",
      tkpType: "toko",
      locationKind: "STORE",
      status: "pending_confirmation",
      progress: 0,
      storeName: "Alfamart Clarify Flow",
    });

    // BMS submits preliminary inspection
    const bmsClarInspectReq = new Request(`http://localhost:3004/api/incidents/${clarReportId}/confirm`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        cookie: `siaga_session=${bmsCookie}`,
      },
      body: JSON.stringify({
        condition: "damaged",
        inspection_method: "kunjungan_langsung",
        notes: "Pemeriksaan awal terdapat retak plester.",
        operational_status: "Buka Terbatas",
        photos: ["https://sparta-siaga.local/storage/evidence/p4_clar_prelim.jpg"],
      }),
    });
    await confirmRoute.POST(bmsClarInspectReq, { params: Promise.resolve({ id: clarReportId }) });

    // BnM requests clarification via approval route
    const clarDecisionReq = new Request(`http://localhost:3004/api/incidents/${clarReportId}/approval`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        cookie: `siaga_session=${bmmCookie}`,
      },
      body: JSON.stringify({
        decision: "clarification_requested",
        reason: "Foto kurang jelas, mohon foto ulang tampak depan.",
      }),
    });
    const clarDecisionRes = await approvalRoute.POST(clarDecisionReq, { params: Promise.resolve({ id: clarReportId }) });
    const clarInc = await dbGetIncidentById(clarReportId);

    const isClarified =
      clarDecisionRes.status === 200 &&
      clarInc?.status === "clarification_requested";

    record(
      "CLAR-01",
      "Clarification Loopback",
      "BnM decision 'Perlu Klarifikasi' loops report back to clarification_requested for field inspector revision",
      isClarified,
      `Status: ${clarDecisionRes.status}, incident status: ${clarInc?.status}`
    );
  }

  // ============================================================================
  // SUMMARY OF TEST RESULTS
  // ============================================================================
  console.log("\n================================================================================");
  console.log(" SPARTA SIAGA: REFINEMENT REGRESSION SUITE EXECUTION SUMMARY");
  console.log("================================================================================");

  const total = results.length;
  const passed = results.filter((r) => r.passed).length;
  const failed = total - passed;

  console.log(` Total Checks : ${total}`);
  console.log(` Passed       : ${passed}`);
  console.log(` Failed       : ${failed}`);
  console.log(` Success Rate : ${((passed / total) * 100).toFixed(1)}%\n`);

  if (failed > 0) {
    console.error("❌ Some regression checks failed:");
    results.filter((r) => !r.passed).forEach((r) => {
      console.error(`  - ${r.code}: ${r.name} (${r.detail})`);
    });
    process.exit(1);
  } else {
    console.log("✔ All Phase 4 Refinement Regression Checks Passed 100%!");
  }
}

runRefinementSuite()
  .catch((err) => {
    console.error("Unhandled error during test suite:", err);
    process.exit(1);
  })
  .finally(async () => {
    await closeDbPool();
  });
