/**
 * SPARTA SIAGA — Phase 3 Comprehensive Verification Suite
 * HO Access, Cross-Branch Monitoring & Automatic Email Distribution
 *
 * Target: Aiven PostgreSQL sparta_siaga_isolated
 */

import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import { getIsolatedDbPool, closeDbPool } from "../lib/db";
import { assertIsolatedDatabase } from "../lib/database-safety";
import {
  canViewReport,
  canActOnReport,
  canApproveAsBm,
  canCloseReport,
  isReportVisibleToHo,
} from "../lib/report-permissions";
import {
  getAuthorizedHoRecipients,
  generateHoApprovalEmailHtml,
  generateHoApprovalEmailText,
  processReportApprovalOutbox,
  getApprovalOutboxStatus,
} from "../lib/approval-email-service";
import {
  setMockEmailTransporter,
  clearRecentEmailDispatches,
  sendHoApprovalNotificationEmail,
} from "../lib/email-service";
import {
  commitAtomicBmApprovalTransaction,
  ReportApprovalEvent,
} from "../lib/approval-event-service";
import { IncidentRecord } from "../types/incident";

interface TestItem {
  id: string;
  name: string;
  passed: boolean;
  details?: string;
}

const suiteResults: TestItem[] = [];

function record(id: string, name: string, passed: boolean, details?: string) {
  suiteResults.push({ id, name, passed, details });
  const icon = passed ? "✔ [PASS]" : "❌ [FAIL]";
  console.log(`${icon} ${id.padEnd(10)} | ${name}`);
  if (details) {
    console.log(`             Detail: ${details}`);
  }
}

async function runPhase3TestSuite() {
  console.log("================================================================================");
  console.log(" SPARTA SIAGA — PHASE 3 COMPREHENSIVE VERIFICATION SUITE");
  console.log(" Head Office (HO) Access, Cross-Branch Monitoring & Auto Email Distribution");
  console.log(" Target: Aiven sparta_siaga_isolated");
  console.log("================================================================================\n");

  const pool = getIsolatedDbPool();
  await assertIsolatedDatabase(pool);

  // 1. Load credentials
  const pilotCredsPath = path.join(process.cwd(), ".env.pilot-credentials.local");
  const creds: Record<string, string> = {};
  if (fs.existsSync(pilotCredsPath)) {
    const lines = fs.readFileSync(pilotCredsPath, "utf8").split("\n");
    for (const line of lines) {
      const match = line.match(/^([A-Z0-9_]+)=["']?([^"'\r\n]+)["']?/);
      if (match) creds[match[1]] = match[2].trim();
    }
  }

  const sysadminPassword = creds["PROD_SYSADMIN_PASSWORD"] || "";
  const hoAdminPassword = creds["PROD_HO_ADMIN_01_PASSWORD"] || "";
  const gmHoPassword = creds["PROD_GM_HO_PASSWORD"] || "";
  const uatPassword = "pass123";

  // Dynamic route imports
  const loginRoute = await import("../app/api/auth/login/route");
  const meRoute = await import("../app/api/auth/me/route");
  const incidentsRoute = await import("../app/api/incidents/route");
  const confirmRoute = await import("../app/api/incidents/[id]/confirm/route");
  const approvalRoute = await import("../app/api/incidents/[id]/approval/route");
  const closeRoute = await import("../app/api/incidents/[id]/close/route");

  function extractCookie(res: Response): string | null {
    const setCookie = res.headers.get("set-cookie");
    if (!setCookie) return null;
    const match = setCookie.match(/siaga_session=([^;]+)/);
    return match ? match[1] : null;
  }

  // ============================================================================
  // TEST GROUP 1: AUTHENTICATION & MULTI-ROLE HO PERSONAS
  // ============================================================================
  console.log("--- TEST GROUP 1: AUTHENTICATION & IDENTITY OF HO PERSONAS ---");

  // 1.1 Remediated UAT_HO0001
  let uatHoCookie: string | null = null;
  {
    const req = new Request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identifier: "UAT_HO0001", password: uatPassword }),
    });
    const res = await loginRoute.POST(req);
    uatHoCookie = extractCookie(res);

    let meValid = false;
    let meName = "";
    if (uatHoCookie) {
      const meRes = await meRoute.GET(new Request("http://localhost/api/auth/me", {
        headers: { cookie: `siaga_session=${uatHoCookie}` },
      }) as any);
      const meJson = await meRes.json();
      meValid = meRes.status === 200 && meJson.businessRole === "ho_admin" && meJson.scope === "HO";
      meName = meJson.name;
    }

    record(
      "AUTH-01",
      "UAT_HO0001 Demo HO Admin login via pass123",
      res.status === 200 && meValid,
      `Name: '${meName}', Role: ho_admin, Scope: HO, HTTP: ${res.status}`
    );
  }

  // 1.2 Remediated UAT_GM0001
  let uatGmCookie: string | null = null;
  {
    const req = new Request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identifier: "UAT_GM0001", password: uatPassword }),
    });
    const res = await loginRoute.POST(req);
    uatGmCookie = extractCookie(res);

    let meValid = false;
    let meName = "";
    if (uatGmCookie) {
      const meRes = await meRoute.GET(new Request("http://localhost/api/auth/me", {
        headers: { cookie: `siaga_session=${uatGmCookie}` },
      }) as any);
      const meJson = await meRes.json();
      meValid = meRes.status === 200 && meJson.businessRole === "gm_ho" && meJson.scope === "HO";
      meName = meJson.name;
    }

    record(
      "AUTH-02",
      "UAT_GM0001 Demo GM HO login via pass123",
      res.status === 200 && meValid,
      `Name: '${meName}', Role: gm_ho, Scope: HO, HTTP: ${res.status}`
    );
  }

  // 1.3 Pilot HO0001
  {
    const req = new Request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identifier: "HO0001", password: hoAdminPassword }),
    });
    const res = await loginRoute.POST(req);
    const cookie = extractCookie(res);
    let meValid = false;
    if (cookie) {
      const meRes = await meRoute.GET(new Request("http://localhost/api/auth/me", {
        headers: { cookie: `siaga_session=${cookie}` },
      }) as any);
      const meJson = await meRes.json();
      meValid = meRes.status === 200 && meJson.businessRole === "ho_admin" && meJson.scope === "HO";
    }
    record(
      "AUTH-03",
      "Pilot HO0001 login with pilot credentials",
      res.status === 200 && meValid,
      `HTTP: ${res.status}, cookie present: ${Boolean(cookie)}`
    );
  }

  // 1.4 Pilot GM0001
  {
    const req = new Request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identifier: "GM0001", password: gmHoPassword }),
    });
    const res = await loginRoute.POST(req);
    const cookie = extractCookie(res);
    let meValid = false;
    if (cookie) {
      const meRes = await meRoute.GET(new Request("http://localhost/api/auth/me", {
        headers: { cookie: `siaga_session=${cookie}` },
      }) as any);
      const meJson = await meRes.json();
      meValid = meRes.status === 200 && meJson.businessRole === "gm_ho" && meJson.scope === "HO";
    }
    record(
      "AUTH-04",
      "Pilot GM0001 login with pilot credentials",
      res.status === 200 && meValid,
      `HTTP: ${res.status}, cookie present: ${Boolean(cookie)}`
    );
  }

  // ============================================================================
  // TEST GROUP 2: HO VISIBILITY & CROSS-BRANCH OBSERVABILITY RULES
  // ============================================================================
  console.log("\n--- TEST GROUP 2: HO VISIBILITY & CROSS-BRANCH OBSERVATION ---");

  const unconfirmedReport: IncidentRecord = {
    id: "INC-TEST-PH3-UNCONF",
    date: "2026-10-30",
    disasterType: "earthquake",
    reportOrigin: "automatic_earthquake",
    storeId: "TB01",
    storeName: "Toko Bandung Barat",
    branch: "BANDUNG",
    locationCity: "Bandung",
    status: "pending_confirmation",
    progress: 0,
    timeline: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const confirmedDamagedReport: IncidentRecord = {
    id: "INC-TEST-PH3-CONF-DAMAGED",
    date: "2026-10-30",
    disasterType: "flood",
    reportOrigin: "manual",
    storeId: "TS01",
    storeName: "Toko Sidoarjo Alun-alun",
    branch: "SIDOARJO",
    locationCity: "Sidoarjo",
    status: "confirmed_affected",
    progress: 10,
    verification: {
      confirmedBy: "Petugas Lapangan",
      confirmedAt: "2026-10-30 10:00 WIB",
      isDamaged: true,
      bmApproval: {
        decision: "approved",
        decidedBy: "BnM Manajer Sidoarjo",
        decidedAt: "2026-10-30 11:00 WIB",
        decisionNotes: "Kerusakan plafon & etalase disetujui untuk perbaikan.",
      },
    },
    timeline: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const confirmedSafeReport: IncidentRecord = {
    id: "INC-TEST-PH3-CONF-SAFE",
    date: "2026-10-30",
    disasterType: "earthquake",
    reportOrigin: "automatic_earthquake",
    storeId: "TM01",
    storeName: "Toko Medan Amplas",
    branch: "MEDAN",
    locationCity: "Medan",
    status: "confirmed_safe",
    progress: 100,
    verification: {
      confirmedBy: "Petugas Lapangan",
      confirmedAt: "2026-10-30 10:00 WIB",
      isDamaged: false,
      bmApproval: {
        decision: "safe",
        decidedBy: "BnM Manajer Medan",
        decidedAt: "2026-10-30 11:30 WIB",
        decisionNotes: "Pemeriksaan selesai, seluruh struktur toko aman.",
      },
    },
    timeline: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const hoUserContext = {
    id: "USR-HO-BUDI",
    name: "Budi Santoso",
    role: "ho_admin" as any,
    systemRole: "USER" as any,
    scope: "HO" as any,
    branch: null,
  };

  const bmsBandungContext = {
    id: "USR-BMS-001",
    name: "Demo BMS Bandung",
    role: "bms" as any,
    systemRole: "USER" as any,
    scope: "BRANCH" as any,
    branch: "BANDUNG",
  };

  // 2.1 Unconfirmed reports hidden from HO
  const unconfirmedVisible = canViewReport(hoUserContext, unconfirmedReport);
  record(
    "VIS-01",
    "Unconfirmed reports strictly HIDDEN from Head Office",
    unconfirmedVisible === false,
    `isReportVisibleToHo: ${isReportVisibleToHo(unconfirmedReport)}, canViewReport: ${unconfirmedVisible}`
  );

  // 2.2 Confirmed damaged report from Sidoarjo visible to HO
  const sidoarjoVisible = canViewReport(hoUserContext, confirmedDamagedReport);
  record(
    "VIS-02",
    "Confirmed damaged report from Sidoarjo VISIBLE to HO (Cross-Branch)",
    sidoarjoVisible === true,
    `isReportVisibleToHo: ${isReportVisibleToHo(confirmedDamagedReport)}, canViewReport: ${sidoarjoVisible}`
  );

  // 2.3 Confirmed safe report from Medan visible to HO
  const medanVisible = canViewReport(hoUserContext, confirmedSafeReport);
  record(
    "VIS-03",
    "Confirmed safe report from Medan VISIBLE to HO (Cross-Branch)",
    medanVisible === true,
    `isReportVisibleToHo: ${isReportVisibleToHo(confirmedSafeReport)}, canViewReport: ${medanVisible}`
  );

  // 2.4 Branch user isolation: Bandung BMS cannot see Sidoarjo or Medan reports
  const bdgCanSeeSidoarjo = canViewReport(bmsBandungContext, confirmedDamagedReport);
  const bdgCanSeeMedan = canViewReport(bmsBandungContext, confirmedSafeReport);
  record(
    "VIS-04",
    "Branch isolation enforced: Bandung BMS blocked from Sidoarjo/Medan reports",
    bdgCanSeeSidoarjo === false && bdgCanSeeMedan === false,
    `bdgCanSeeSidoarjo: ${bdgCanSeeSidoarjo}, bdgCanSeeMedan: ${bdgCanSeeMedan}`
  );

  // ============================================================================
  // TEST GROUP 3: STRICT HEAD OFFICE READ-ONLY ENFORCEMENT
  // ============================================================================
  console.log("\n--- TEST GROUP 3: STRICT HO READ-ONLY ACCESS ENFORCEMENT ---");

  // 3.1 Synchronous authorization helper check
  const hoCanAct = canActOnReport(hoUserContext, confirmedDamagedReport);
  const hoCanApproveBm = canApproveAsBm(hoUserContext, confirmedDamagedReport);
  const hoCanClose = canCloseReport(hoUserContext, confirmedDamagedReport);
  record(
    "RO-01",
    "Client helpers strictly disallow HO operational action, approval, or close",
    hoCanAct === false && hoCanApproveBm === false && hoCanClose === false,
    `canAct: ${hoCanAct}, canApproveBm: ${hoCanApproveBm}, canClose: ${hoCanClose}`
  );

  // 3.2 HTTP API Guard: HO blocked from creating manual incident (POST /api/incidents)
  {
    const req = new Request("http://localhost/api/incidents", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        cookie: `siaga_session=${uatHoCookie}`,
      },
      body: JSON.stringify({
        id: "INC-HO-FORBIDDEN",
        disasterType: "flood",
        storeId: "T001",
      }),
    });
    const res = await incidentsRoute.POST(req);
    const json = await res.json();
    record(
      "RO-02",
      "POST /api/incidents returns 403 Forbidden for HO user",
      res.status === 403 && json.code === "HO_READ_ONLY",
      `HTTP ${res.status}, error: "${json.error}"`
    );
  }

  // 3.3 HTTP API Guard: HO blocked from BM approval endpoint (POST /api/incidents/[id]/approval)
  {
    const req = new Request("http://localhost/api/incidents/INC-TEST-DUMMY/approval", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        cookie: `siaga_session=${uatHoCookie}`,
      },
      body: JSON.stringify({ decision: "approved" }),
    });
    const res = await approvalRoute.POST(req, { params: Promise.resolve({ id: "INC-TEST-DUMMY" }) });
    const json = await res.json();
    record(
      "RO-03",
      "POST /api/incidents/[id]/approval returns 403 Forbidden for HO user",
      res.status === 403,
      `HTTP ${res.status}, error: "${json.error}"`
    );
  }

  // 3.4 HTTP API Guard: HO blocked from BM confirm endpoint (POST /api/incidents/[id]/confirm)
  {
    const req = new Request("http://localhost/api/incidents/INC-TEST-DUMMY/confirm", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        cookie: `siaga_session=${uatHoCookie}`,
      },
      body: JSON.stringify({ decision: "approved" }),
    });
    const res = await confirmRoute.POST(req, { params: Promise.resolve({ id: "INC-TEST-DUMMY" }) });
    const json = await res.json();
    record(
      "RO-04",
      "POST /api/incidents/[id]/confirm returns 403 Forbidden for HO user",
      res.status === 403,
      `HTTP ${res.status}, error: "${json.error}"`
    );
  }

  // 3.5 HTTP API Guard: HO blocked from Case Close endpoint (POST /api/incidents/[id]/close)
  {
    const req = new Request("http://localhost/api/incidents/INC-TEST-DUMMY/close", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        cookie: `siaga_session=${uatHoCookie}`,
      },
      body: JSON.stringify({ reason: "Closing test" }),
    });
    const res = await closeRoute.POST(req, { params: Promise.resolve({ id: "INC-TEST-DUMMY" }) });
    const json = await res.json();
    record(
      "RO-05",
      "POST /api/incidents/[id]/close returns 403 Forbidden for HO user",
      res.status === 403,
      `HTTP ${res.status}, error: "${json.error}"`
    );
  }

  // ============================================================================
  // TEST GROUP 4: HO RECIPIENTS DISCOVERY & EMAIL TEMPLATE INTEGRITY
  // ============================================================================
  console.log("\n--- TEST GROUP 4: HO RECIPIENTS & EMAIL TEMPLATES ---");

  // 4.1 Discover authorized HO recipients from database
  const hoRecipients = await getAuthorizedHoRecipients();
  const hasHoAdmin = hoRecipients.some((r) => r.role === "ho_admin");
  const hasGmHo = hoRecipients.some((r) => r.role === "gm_ho");
  const hasUniqueEmails = new Set(hoRecipients.map((r) => r.email.toLowerCase())).size === hoRecipients.length;

  record(
    "EMAIL-01",
    "Discover active authorized HO recipients from DB",
    hoRecipients.length > 0 && hasHoAdmin && hasGmHo && hasUniqueEmails,
    `Found ${hoRecipients.length} recipients (Unique: ${hasUniqueEmails}, Roles: ho_admin, gm_ho present)`
  );

  // 4.2 Template generation: Damaged event
  const mockApprovalEventDamaged: ReportApprovalEvent = {
    eventId: "appr_INC-TEST-PH3-EMAIL",
    reportId: "INC-TEST-PH3-EMAIL",
    decision: "approved",
    outcomeStatus: "confirmed_affected",
    disasterType: "earthquake",
    branch: "BANDUNG",
    storeId: "T888",
    storeName: "Toko Bandung Pasteur",
    locationCity: "Bandung",
    decidedBy: {
      userId: "usr_bm_bdg_01",
      name: "Bambang BnM",
      role: "bm",
    },
    decidedAt: "30/10/2026, 11.45.00 WIB",
    decisionNotes: "Dinding retak dan plafon ambruk di area gudang.",
    condition: "damaged",
    evidenceCount: 3,
    publishedToHo: true,
    createdAt: new Date().toISOString(),
  };

  const htmlContent = generateHoApprovalEmailHtml(mockApprovalEventDamaged, "Budi Santoso");
  const textContent = generateHoApprovalEmailText(mockApprovalEventDamaged);

  const htmlContainsReportId = htmlContent.includes("INC-TEST-PH3-EMAIL");
  const htmlContainsStore = htmlContent.includes("Toko Bandung Pasteur");
  const htmlContainsDecider = htmlContent.includes("Bambang BnM");
  const htmlContainsStatus = htmlContent.includes("TERDAMPAK");
  const htmlContainsReadOnlyNotice = htmlContent.includes("Read-Only");

  record(
    "EMAIL-02",
    "HO Approval Email HTML template generates with all required metadata",
    htmlContainsReportId && htmlContainsStore && htmlContainsDecider && htmlContainsStatus && htmlContainsReadOnlyNotice,
    `Contains reportId: ${htmlContainsReportId}, store: ${htmlContainsStore}, decider: ${htmlContainsDecider}, readOnlyNotice: ${htmlContainsReadOnlyNotice}`
  );

  // ============================================================================
  // TEST GROUP 5: DURABLE OUTBOX PROCESSING & DELIVERY AUDITING
  // ============================================================================
  console.log("\n--- TEST GROUP 5: DURABLE OUTBOX & DELIVERY AUDITING ---");

  // Setup Mock Transporter to capture sent emails safely in memory
  const capturedEmails: any[] = [];
  const mockTransporter: any = {
    sendMail: async (mailOptions: any) => {
      capturedEmails.push({
        from: mailOptions.from,
        to: mailOptions.to,
        subject: mailOptions.subject,
        html: mailOptions.html,
      });
      return {
        messageId: `<mock-ho-mail-${Date.now()}-${Math.random().toString(36).slice(2)}@sparta.test>`,
      };
    },
    verify: async () => true,
  };

  setMockEmailTransporter(mockTransporter);
  clearRecentEmailDispatches();

  // 5.1 Test insert into outbox
  const testReportId = `INC-T5-EMAIL-${Date.now()}`;
  const testEventId = `appr_${testReportId}`;

  // Clean any previous test rows
  await pool.query(`DELETE FROM report_distributions WHERE report_id = $1`, [testReportId]);
  await pool.query(`DELETE FROM report_approval_outbox WHERE report_id = $1`, [testReportId]);

  const testEvent: ReportApprovalEvent = {
    eventId: testEventId,
    reportId: testReportId,
    decision: "approved",
    outcomeStatus: "confirmed_affected",
    disasterType: "earthquake",
    branch: "BANDUNG",
    storeId: "T999",
    storeName: "Toko Uji Outbox",
    locationCity: "Bandung",
    decidedBy: {
      userId: "usr_bm_bdg_01",
      name: "BnM Test",
      role: "bm",
    },
    decidedAt: "30/10/2026, 12.00.00 WIB",
    decisionNotes: "Uji coba outbox email",
    condition: "damaged",
    evidenceCount: 2,
    publishedToHo: true,
    createdAt: new Date().toISOString(),
  };

  // Direct insert to outbox table
  await pool.query(
    `INSERT INTO report_approval_outbox (
      id, report_id, decision, outcome_status, disaster_type,
      report_origin, branch, store_id, store_name, location_city,
      decided_by_user_id, decided_by_name, decided_by_role, decided_at,
      decision_notes, condition, evidence_count, published_to_ho,
      payload, created_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19::jsonb, NOW())`,
    [
      testEvent.eventId,
      testEvent.reportId,
      testEvent.decision,
      testEvent.outcomeStatus,
      testEvent.disasterType,
      "manual",
      testEvent.branch,
      testEvent.storeId,
      testEvent.storeName,
      testEvent.locationCity,
      testEvent.decidedBy.userId,
      testEvent.decidedBy.name,
      testEvent.decidedBy.role,
      testEvent.decidedAt,
      testEvent.decisionNotes,
      testEvent.condition,
      testEvent.evidenceCount,
      testEvent.publishedToHo,
      JSON.stringify(testEvent),
    ]
  );

  // 5.2 Process the outbox
  const outboxResults = await processReportApprovalOutbox({ reportId: testReportId });
  const processedItem = outboxResults.find((r) => r.reportId === testReportId);

  record(
    "OUTBOX-01",
    "Process pending item from report_approval_outbox with mock SMTP",
    Boolean(processedItem && processedItem.processed),
    `Processed: ${processedItem?.processed}, Recipients: ${processedItem?.totalRecipients}, Emails captured: ${capturedEmails.length}`
  );

  // 5.3 Verify DB state in report_approval_outbox
  const outboxDbRes = await pool.query(
    `SELECT processed_at, payload FROM report_approval_outbox WHERE report_id = $1`,
    [testReportId]
  );
  const outboxRow = outboxDbRes.rows[0];
  const outboxProcessed = Boolean(outboxRow?.processed_at);
  const outboxHasAudit = Boolean(outboxRow?.payload?.emailDistribution);

  record(
    "OUTBOX-02",
    "report_approval_outbox marked with processed_at and emailDistribution payload",
    outboxProcessed && outboxHasAudit,
    `processed_at: ${outboxRow?.processed_at}, successCount: ${outboxRow?.payload?.emailDistribution?.successCount}`
  );

  // 5.4 Verify report_distributions delivery log table
  const distDbRes = await pool.query(
    `SELECT report_id, channel, recipient, status, provider_message_id, attempted_at
     FROM report_distributions
     WHERE report_id = $1`,
    [testReportId]
  );

  record(
    "OUTBOX-03",
    "report_distributions contains persistent audit log for each recipient",
    distDbRes.rows.length > 0 && distDbRes.rows.every((r) => r.status === "sent" && r.channel === "email"),
    `Total distribution rows logged: ${distDbRes.rows.length}`
  );

  // ============================================================================
  // TEST GROUP 6: DEDUPLICATION & IDEMPOTENCY PROTECTION
  // ============================================================================
  console.log("\n--- TEST GROUP 6: DEDUPLICATION & IDEMPOTENCY ---");

  const emailCountBeforeSecondRun = capturedEmails.length;

  // Run processReportApprovalOutbox again for the same report ID
  const secondRunResults = await processReportApprovalOutbox({ reportId: testReportId });

  const emailCountAfterSecondRun = capturedEmails.length;
  const zeroNewEmailsSent = emailCountAfterSecondRun === emailCountBeforeSecondRun;

  record(
    "DEDUP-01",
    "Idempotency: Re-running outbox processor produces ZERO duplicate email dispatches",
    zeroNewEmailsSent && secondRunResults.length === 0,
    `Emails before: ${emailCountBeforeSecondRun}, after: ${emailCountAfterSecondRun}, items processed in 2nd run: ${secondRunResults.length}`
  );

  // 6.2 Dedup key in email-service
  const directSendAgain = await sendHoApprovalNotificationEmail({
    to: "ho.admin.01@sparta-siaga.local",
    subject: "Test Duplicate",
    html: "<p>Test</p>",
    reportId: testReportId,
    branch: "BANDUNG",
  });

  record(
    "DEDUP-02",
    "email-service rejects immediate duplicate dispatch to same recipient with deduplication flag",
    directSendAgain.status === "sent" && (directSendAgain.errorMessage || "").includes("deduplicated"),
    `Status: ${directSendAgain.status}, Note: "${directSendAgain.errorMessage}"`
  );

  // ============================================================================
  // TEST GROUP 7: OUTBOX STATUS API ENDPOINT
  // ============================================================================
  console.log("\n--- TEST GROUP 7: APPROVAL OUTBOX API ENDPOINT ---");

  const outboxApi = await import("../app/api/notifications/approval-outbox/route");

  // 7.1 GET /api/notifications/approval-outbox with HO session
  {
    const req = new Request("http://localhost/api/notifications/approval-outbox", {
      headers: { cookie: `siaga_session=${uatHoCookie}` },
    });
    const res = await outboxApi.GET(req);
    const json = await res.json();
    record(
      "API-01",
      "GET /api/notifications/approval-outbox returns status & metrics to authorized HO",
      res.status === 200 && json.success && typeof json.data.total === "number",
      `HTTP ${res.status}, total: ${json.data?.total}, unprocessed: ${json.data?.unprocessed}, processed: ${json.data?.processed}`
    );
  }

  // 7.2 POST /api/notifications/approval-outbox rejected for unauthorized branch user
  {
    const req = new Request("http://localhost/api/notifications/approval-outbox", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // No admin or HO cookie (unauthorized)
      },
      body: JSON.stringify({}),
    });
    const res = await outboxApi.POST(req);
    record(
      "API-02",
      "POST /api/notifications/approval-outbox rejects unauthenticated requests with 401",
      res.status === 401,
      `HTTP ${res.status}`
    );
  }

  // Cleanup test artifacts
  await pool.query(`DELETE FROM report_distributions WHERE report_id = $1`, [testReportId]);
  await pool.query(`DELETE FROM report_approval_outbox WHERE report_id = $1`, [testReportId]);

  // Reset mock transporter
  setMockEmailTransporter(null);

  await closeDbPool();

  // Summary
  const passedCount = suiteResults.filter((r) => r.passed).length;
  const failedCount = suiteResults.length - passedCount;

  console.log("\n================================================================================");
  console.log(` PHASE 3 TEST SUMMARY: TOTAL ${suiteResults.length} | PASS: ${passedCount} | FAIL: ${failedCount}`);
  console.log("================================================================================");

  if (failedCount > 0) {
    console.error(`\n❌ ${failedCount} tests failed.`);
    process.exit(1);
  } else {
    console.log("\n🎉 ALL PHASE 3 VERIFICATION TESTS PASSED SUCCESSFULLY!");
    process.exit(0);
  }
}

runPhase3TestSuite().catch(async (err) => {
  console.error("Fatal test runner error:", err);
  await closeDbPool();
  process.exit(1);
});

