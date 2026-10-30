/**
 * SPARTA SIAGA — PHASE 4: COMPREHENSIVE END-TO-END BUSINESS FLOW & MULTI-ROLE UAT SUITE
 * 
 * Target Environment: Aiven PostgreSQL (sparta_siaga_isolated)
 * Safety: Never connects to or modifies Dokploy production database (siaga).
 * 
 * Scope:
 * 1. Multi-Role Authentication & Session Resolution (10 Personas)
 * 2. E2E Lifecycle 1: Toko / BMS / BMC / BnM Manajer (Full Damaged & Maintenance Path)
 * 3. E2E Lifecycle 2: No-Damage Flow (Tidak Ada Kerusakan / Safe Path)
 * 4. E2E Lifecycle 3: Specialized Facilities (DC / BES / BEC and Building / BBS / BBC)
 * 5. Automatic Earthquake Ingestion, Spatial Calculation & Reconciliation
 * 6. Head Office Monitoring-Only & Administrative Outbox Guards
 * 7. Multi-Role Permission Matrix & Zero-Bypass Enforcements
 */

import { getDbPool, closeDbPool } from "../lib/db";
import { assertIsolatedDatabase } from "../lib/database-safety";
import { setMockEmailTransporter, clearRecentEmailDispatches } from "../lib/email-service";
import { processReportApprovalOutbox } from "../lib/approval-email-service";
import { IncidentRecord, DamageReport } from "../types/incident";
import { dbUpdateIncident, dbGetIncidentById } from "../lib/incident-db";
import { CompletionApprovalService } from "../lib/completion-approval-service";
import { EstimationIntegrationService } from "../lib/estimation-service";
import { submitMilestoneFlexible } from "../lib/milestone-service";
import { reconcileManualEarthquakeSubmission } from "../lib/earthquake-reconciliation";
import { canViewReport, isReportVisibleToHo } from "../lib/report-permissions";

interface TestResult {
  code: string;
  name: string;
  passed: boolean;
  detail: string;
  category: string;
}

const suiteResults: TestResult[] = [];

function record(code: string, category: string, name: string, passed: boolean, detail: string) {
  suiteResults.push({ code, category, name, passed, detail });
  const icon = passed ? "✔ [PASS]" : "❌ [FAIL]";
  console.log(`${icon} ${code.padEnd(10)} | ${name}`);
  if (detail) {
    console.log(`             Detail: ${detail}`);
  }
}

function extractCookie(res: any): string | null {
  const setCookie = res.headers?.get("set-cookie") || "";
  const match = setCookie.match(/siaga_session=([^;]+)/);
  return match ? match[1] : null;
}

async function runPhase4Suite() {
  console.log("================================================================================");
  console.log(" SPARTA SIAGA — PHASE 4: END-TO-END BUSINESS FLOW & MULTI-ROLE UAT SUITE");
  console.log(" Full Validation, Lifecycle Guards & Multi-Role Permission Matrix");
  console.log(" Target: Aiven sparta_siaga_isolated");
  console.log("================================================================================\n");

  const pool = getDbPool();
  await assertIsolatedDatabase(pool);

  // Load API Route Handlers
  const loginRoute = await import("../app/api/auth/login/route");
  const meRoute = await import("../app/api/auth/me/route");
  const incidentsRoute = await import("../app/api/incidents/route");
  const incidentDetailRoute = await import("../app/api/incidents/[id]/route");
  const confirmRoute = await import("../app/api/incidents/[id]/confirm/route");
  const approvalRoute = await import("../app/api/incidents/[id]/approval/route");
  const estimationRoute = await import("../app/api/incidents/[id]/estimation/route");
  const milestonesRoute = await import("../app/api/incidents/[id]/milestones/route");
  const compSubmitRoute = await import("../app/api/incidents/[id]/completion/submit/route");
  const compApproveRoute = await import("../app/api/incidents/[id]/completion/approve/route");
  const compCloseRoute = await import("../app/api/incidents/[id]/completion/close/route");
  const generalCloseRoute = await import("../app/api/incidents/[id]/close/route");
  const outboxApi = await import("../app/api/notifications/approval-outbox/route");

  // Track mock emails
  const capturedMails: any[] = [];
  setMockEmailTransporter({
    sendMail: async (options: any) => {
      capturedMails.push(options);
      return { messageId: `<mock-p4-${Date.now()}-${Math.random().toString(36).substring(2, 8)}@sparta.test>` };
    },
  } as any);
  clearRecentEmailDispatches();

  // Read pilot credentials if present
  const fs = await import("fs");
  const path = await import("path");
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

  // Test session cookies map
  const sessions: Record<string, string> = {};

  async function loginAs(identifier: string, pass = "pass123"): Promise<string> {
    const req = new Request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identifier, password: pass }),
    });
    const res = await loginRoute.POST(req);
    const cookie = extractCookie(res);
    if (!cookie) {
      throw new Error(`Login failed for ${identifier}: HTTP ${res.status}`);
    }
    return cookie;
  }

  // ============================================================================
  // SECTION 1: MULTI-ROLE AUTHENTICATION & IDENTITY RESOLUTION
  // ============================================================================
  console.log("--- SECTION 1: MULTI-ROLE AUTHENTICATION & IDENTITY RESOLUTION ---");

  const personas = [
    { key: "admin", id: "ADM0001", role: "ADMIN", scope: "GLOBAL", pass: sysadminPassword },
    { key: "bms", id: "bms", role: "bms", scope: "BRANCH", branch: "BANDUNG" },
    { key: "bmc", id: "bmc", role: "bmc", scope: "BRANCH", branch: "BANDUNG" },
    { key: "bes", id: "bes", role: "bes", scope: "BRANCH", branch: "BANDUNG" },
    { key: "bec", id: "bec", role: "bec", scope: "BRANCH", branch: "BANDUNG" },
    { key: "bbs", id: "bbs", role: "bbs", scope: "BRANCH", branch: "BANDUNG" },
    { key: "bbc", id: "bbc", role: "bbc", scope: "BRANCH", branch: "BANDUNG" },
    { key: "bm", id: "bmm", role: "bm", scope: "BRANCH", branch: "BANDUNG" },
    { key: "ho", id: "UAT_HO0001", role: "ho_admin", scope: "HO" },
    { key: "gm", id: "UAT_GM0001", role: "gm_ho", scope: "HO" },
  ];

  for (const p of personas) {
    try {
      const cookie = await loginAs(p.id, p.pass || "pass123");
      sessions[p.key] = cookie;

      const meReq = new Request("http://localhost/api/auth/me", {
        headers: { cookie: `siaga_session=${cookie}` },
      });
      const meRes = await meRoute.GET(meReq as any);
      const meJson = await meRes.json();

      const valid = meRes.status === 200 && (p.role === "ADMIN" ? meJson.systemRole === "ADMIN" : meJson.businessRole === p.role);
      record(
        `AUTH-${p.key.toUpperCase()}`,
        "AUTHENTICATION",
        `Persona '${p.id}' (${p.role}) authenticated successfully`,
        valid,
        `Name: '${meJson.name}', Scope: '${meJson.scope}', Branch: '${meJson.branch || "N/A"}'`
      );
    } catch (err: any) {
      record(`AUTH-${p.key.toUpperCase()}`, "AUTHENTICATION", `Persona '${p.id}' login`, false, err.message);
    }
  }

  // Verify inactive legacy seed admin is blocked
  {
    const req = new Request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identifier: "LEGACY_ADM0001", password: "pass" }),
    });
    const res = await loginRoute.POST(req);
    record(
      "AUTH-INACTIVE",
      "AUTHENTICATION",
      "Legacy deactivated account LEGACY_ADM0001 is rejected with HTTP 403",
      res.status === 403,
      `HTTP status: ${res.status}`
    );
  }

  // Pre-test purge of previous test artifacts
  await pool.query(`DELETE FROM report_completion_approvals WHERE report_id LIKE 'INC-P4-%' OR report_id LIKE 'LAP-P4-%'`);
  await pool.query(`DELETE FROM report_completion_approval_history WHERE report_id LIKE 'INC-P4-%' OR report_id LIKE 'LAP-P4-%'`);
  await pool.query(`DELETE FROM report_milestones WHERE report_id LIKE 'INC-P4-%' OR report_id LIKE 'LAP-P4-%'`);
  await pool.query(`DELETE FROM report_distributions WHERE report_id LIKE 'INC-P4-%' OR report_id LIKE 'LAP-P4-%'`);
  await pool.query(`DELETE FROM report_approval_outbox WHERE report_id LIKE 'INC-P4-%' OR report_id LIKE 'LAP-P4-%'`);
  await pool.query(`DELETE FROM report_estimation_routes WHERE report_id LIKE 'INC-P4-%' OR report_id LIKE 'LAP-P4-%'`);
  await pool.query(`DELETE FROM incident_pic_history WHERE incident_id LIKE 'INC-P4-%' OR incident_id LIKE 'LAP-P4-%'`);
  await pool.query(`DELETE FROM earthquake_reconciliation_cases WHERE incident_id LIKE 'INC-P4-%' OR incident_id LIKE 'LAP-P4-%'`);
  await pool.query(`DELETE FROM incidents WHERE id LIKE 'INC-P4-%' OR id LIKE 'LAP-P4-%'`);
  await pool.query(`DELETE FROM earthquake_events WHERE id LIKE 'bmkg_p4_test_%'`);

  // ============================================================================
  // SECTION 2: E2E LIFECYCLE 1 — STORE / BMS / BMC / BNM MANAJER (FULL DAMAGED PATH)
  // ============================================================================
  console.log("\n--- SECTION 2: E2E LIFECYCLE 1: STORE / BMS / BMC / BNM MANAJER (DAMAGED PATH) ---");

  const reportId1 = `INC-P4-STORE-${Date.now()}`;

  // 2.1 Incident Creation
  {
    const req = new Request("http://localhost/api/incidents", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        cookie: `siaga_session=${sessions["bms"]}`,
      },
      body: JSON.stringify({
        id: reportId1,
        disasterType: "flood",
        storeId: "T-BDG-001",
        storeName: "Alfamart Dago Raya Bandung",
        branch: "BANDUNG",
        locationCity: "Bandung",
        tkpType: "toko",
        reportOrigin: "manual",
        notes: "Lantai dasar toko tergenang banjir luapan sungai.",
      }),
    });
    const res = await incidentsRoute.POST(req);
    const json = await res.json();
    record(
      "FLOW1-01",
      "LIFECYCLE_TOKO",
      "BMS Bandung creates manual incident for Toko (status: pending_confirmation)",
      res.status === 201 && json.data?.status === "pending_confirmation",
      `Report ID: ${reportId1}, Status: ${json.data?.status}`
    );
  }

  // 2.2 Premature Estimation Handoff Gating
  {
    const req = new Request(`http://localhost/api/incidents/${reportId1}/estimation`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        cookie: `siaga_session=${sessions["bms"]}`,
      },
      body: JSON.stringify({ notes: "Attempt early handoff" }),
    });
    const res = await estimationRoute.POST(req, { params: Promise.resolve({ id: reportId1 }) });
    const json = await res.json();
    record(
      "FLOW1-02",
      "LIFECYCLE_TOKO",
      "Early maintenance handoff rejected before BnM confirmation with HTTP 422",
      res.status === 422 && json.code === "REPORT_NOT_CONFIRMED_AFFECTED",
      `HTTP ${res.status}, code: ${json.code}`
    );
  }

  // 2.3 Role & Location Gating on Inspection
  {
    // BES (DC specialist) attempts to inspect Toko -> 403
    const reqBes = new Request(`http://localhost/api/incidents/${reportId1}/confirm`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        cookie: `siaga_session=${sessions["bes"]}`,
      },
      body: JSON.stringify({
        condition: "damaged",
        photos: ["https://sparta-siaga.local/storage/test.jpg"],
        notes: "BES checking Toko",
      }),
    });
    const resBes = await confirmRoute.POST(reqBes, { params: Promise.resolve({ id: reportId1 }) });
    record(
      "FLOW1-03",
      "LIFECYCLE_TOKO",
      "BES attempting to inspect Toko is rejected with HTTP 403",
      resBes.status === 403,
      `HTTP status: ${resBes.status}`
    );

    // HO attempting to inspect Toko -> 403
    const reqHo = new Request(`http://localhost/api/incidents/${reportId1}/confirm`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        cookie: `siaga_session=${sessions["ho"]}`,
      },
      body: JSON.stringify({ condition: "damaged", notes: "HO inspecting" }),
    });
    const resHo = await confirmRoute.POST(reqHo, { params: Promise.resolve({ id: reportId1 }) });
    record(
      "FLOW1-04",
      "LIFECYCLE_TOKO",
      "HO attempting field inspection is rejected with HTTP 403",
      resHo.status === 403,
      `HTTP status: ${resHo.status}`
    );

    // Inspection without photos -> 400
    const reqNoPhoto = new Request(`http://localhost/api/incidents/${reportId1}/confirm`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        cookie: `siaga_session=${sessions["bms"]}`,
      },
      body: JSON.stringify({
        condition: "damaged",
        notes: "Pemeriksaan tanpa foto",
      }),
    });
    const resNoPhoto = await confirmRoute.POST(reqNoPhoto, { params: Promise.resolve({ id: reportId1 }) });
    record(
      "FLOW1-05",
      "LIFECYCLE_TOKO",
      "Inspection submission without photographic evidence is rejected with HTTP 400",
      resNoPhoto.status === 400,
      `HTTP status: ${resNoPhoto.status}`
    );
  }

  // 2.4 Valid Field Inspection Submission by BMS
  {
    const req = new Request(`http://localhost/api/incidents/${reportId1}/confirm`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        cookie: `siaga_session=${sessions["bms"]}`,
      },
      body: JSON.stringify({
        condition: "damaged",
        inspection_method: "kunjungan_langsung",
        notes: "Plafon jebol dan rak barang terendam air setinggi 30 cm.",
        categories: ["Rak Barang", "Plafon Toko", "Instalasi Listrik"],
        severity: "Sedang",
        operational_status: "Tutup Sementara",
        photos: [
          "https://sparta-siaga.local/storage/evidence/p4_dago_plafon.jpg",
          "https://sparta-siaga.local/storage/evidence/p4_dago_rak.jpg",
        ],
      }),
    });
    const res = await confirmRoute.POST(req, { params: Promise.resolve({ id: reportId1 }) });
    const json = await res.json();
    record(
      "FLOW1-06",
      "LIFECYCLE_TOKO",
      "BMS Bandung submits valid inspection with photographic evidence (moves to pending_bm_approval)",
      res.status === 200 && json.data?.status === "pending_bm_approval",
      `Status: ${json.data?.status}, Report: ${reportId1}`
    );
  }

  // 2.5 Preliminary Report Remains Hidden from HO
  {
    const repCheck = await (await incidentDetailRoute.GET(new Request(`http://localhost/api/incidents/${reportId1}`, {
      headers: { cookie: `siaga_session=${sessions["ho"]}` },
    }), { params: Promise.resolve({ id: reportId1 }) })).json();

    record(
      "FLOW1-07",
      "LIFECYCLE_TOKO",
      "Unconfirmed preliminary report is strictly HIDDEN from Head Office",
      repCheck.error !== undefined,
      `HO Access check: ${repCheck.error || "Accessible (VIOLATION)"}`
    );
  }

  // 2.6 Clarification Flow (Loopback to Field Inspector)
  {
    // BnM requests clarification
    const reqClar = new Request(`http://localhost/api/incidents/${reportId1}/approval`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        cookie: `siaga_session=${sessions["bm"]}`,
      },
      body: JSON.stringify({
        decision: "clarification_requested",
        reason: "Mohon lampirkan foto detail panel MCB listrik apakah ikut terendam.",
      }),
    });
    const resClar = await approvalRoute.POST(reqClar, { params: Promise.resolve({ id: reportId1 }) });
    const jsonClar = await resClar.json();

    // BMS re-submits revised inspection with clarified photo
    const reqResubmit = new Request(`http://localhost/api/incidents/${reportId1}/confirm`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        cookie: `siaga_session=${sessions["bms"]}`,
      },
      body: JSON.stringify({
        condition: "damaged",
        inspection_method: "kunjungan_langsung",
        notes: "Foto detail MCB telah ditambahkan. MCB aman di ketinggian 1.5 meter.",
        photos: [
          "https://sparta-siaga.local/storage/evidence/p4_dago_plafon.jpg",
          "https://sparta-siaga.local/storage/evidence/p4_dago_rak.jpg",
          "https://sparta-siaga.local/storage/evidence/p4_dago_mcb_safe.jpg",
        ],
      }),
    });
    const resResubmit = await confirmRoute.POST(reqResubmit, { params: Promise.resolve({ id: reportId1 }) });
    const jsonResubmit = await resResubmit.json();

    record(
      "FLOW1-08",
      "LIFECYCLE_TOKO",
      "Clarification loopback: BnM requests clarification -> BMS re-submits revised evidence",
      resClar.status === 200 && jsonClar.data?.decision === "clarification_requested" &&
      resResubmit.status === 200 && jsonResubmit.data?.status === "pending_bm_approval",
      `Clarification decision: ${jsonClar.data?.decision}, Re-submitted status: ${jsonResubmit.data?.status}`
    );
  }

  // 2.7 BnM Confirmation (Ada Kerusakan / Approved) & HO Publication
  {
    const req = new Request(`http://localhost/api/incidents/${reportId1}/approval`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        cookie: `siaga_session=${sessions["bm"]}`,
      },
      body: JSON.stringify({
        decision: "approved",
        notes: "Pemeriksaan valid. Kerusakan plafon dan rak disetujui untuk perbaikan teknis BMS.",
      }),
    });
    const res = await approvalRoute.POST(req, { params: Promise.resolve({ id: reportId1 }) });
    const json = await res.json();

    // Process approval outbox immediately if not already handled by background trigger
    const outboxRes = await processReportApprovalOutbox({ reportId: reportId1 });
    const { rows: outboxRows } = await pool.query(
      `SELECT * FROM report_approval_outbox WHERE report_id = $1`,
      [reportId1]
    );
    const outboxProcessed = outboxRows.length > 0 && (outboxRows[0].status === "PROCESSED" || outboxRes.length > 0 || capturedMails.length > 0);

    record(
      "FLOW1-09",
      "LIFECYCLE_TOKO",
      "BnM Manajer Bandung confirms damage (confirmed_affected) and triggers HO auto email",
      res.status === 200 && json.data?.decision === "approved" && json.data?.status === "confirmed_affected" && outboxProcessed,
      `Status: ${json.data?.status}, Outbox: ${outboxRows[0]?.status || "none"}, Emails captured: ${capturedMails.length}`
    );

    // Verify report is now visible to HO
    const repCheckHo = await (await incidentDetailRoute.GET(new Request(`http://localhost/api/incidents/${reportId1}`, {
      headers: { cookie: `siaga_session=${sessions["ho"]}` },
    }), { params: Promise.resolve({ id: reportId1 }) })).json();

    record(
      "FLOW1-10",
      "LIFECYCLE_TOKO",
      "Confirmed damaged report is now VISIBLE to Head Office",
      repCheckHo.data?.id === reportId1,
      `HO visible status: ${repCheckHo.data?.status}`
    );
  }

  // 2.8 SPARTA Maintenance Handoff & Estimation
  {
    const req = new Request(`http://localhost/api/incidents/${reportId1}/estimation`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        cookie: `siaga_session=${sessions["bms"]}`,
      },
      body: JSON.stringify({
        notes: "Handoff ke SPARTA Maintenance untuk estimasi perbaikan plafon & rak gerai.",
      }),
    });
    const res = await estimationRoute.POST(req, { params: Promise.resolve({ id: reportId1 }) });
    const json = await res.json();

    record(
      "FLOW1-11",
      "LIFECYCLE_TOKO",
      "BMS triggers SPARTA Maintenance handoff; estimation route created (handler: BMS)",
      res.status === 201 && json.data?.handlerType === "BMS" && json.data?.status === "WAITING_ESTIMATION",
      `Handler: ${json.data?.handlerType}, Estimation Status: ${json.data?.status}`
    );

    // Simulate work readiness confirmation to transition to READY_FOR_WORK and in_maintenance
    await EstimationIntegrationService.updateWorkStatus(reportId1, "READY_FOR_WORK", { bypassReadinessValidation: true });
    await dbUpdateIncident(reportId1, { status: "in_maintenance" });
  }

  // 2.9 Milestone Progression & 100% Non-Auto-Close Verification
  {
    const bmsUserCtx = {
      id: "usr_bms_bdg_01",
      name: "Demo BMS Bandung",
      role: "bms" as any,
      systemRole: "USER" as any,
      scope: "BRANCH" as any,
      branch: "BANDUNG",
    };

    // Submit milestone documents (CEKLIS 10%, ESTIMASI 25%, APPROVE_PROXY 30%, SPK 50%, SERAH_TERIMA 100%)
    await submitMilestoneFlexible({
      reportId: reportId1,
      stageKey: "CEKLIS",
      actor: bmsUserCtx,
      originalFilename: "CEKLIS-001.pdf",
      fileBuffer: Buffer.from("%PDF-1.4 test Ceklis document"),
      notes: "Dokumen ceklis kerusakan fisik gerai.",
    });

    await submitMilestoneFlexible({
      reportId: reportId1,
      stageKey: "ESTIMASI",
      actor: bmsUserCtx,
      originalFilename: "ESTIMASI-001.pdf",
      fileBuffer: Buffer.from("%PDF-1.4 test Estimasi document"),
      notes: "Dokumen estimasi biaya material perbaikan gerai.",
    });

    await submitMilestoneFlexible({
      reportId: reportId1,
      stageKey: "APPROVE_PROXY",
      actor: bmsUserCtx,
      originalFilename: "APPROVE-PROXY-001.pdf",
      fileBuffer: Buffer.from("%PDF-1.4 test Proxy Approval document"),
      notes: "Dokumen persetujuan proxy perbaikan.",
    });

    await submitMilestoneFlexible({
      reportId: reportId1,
      stageKey: "SPK",
      actor: bmsUserCtx,
      originalFilename: "SPK-001.pdf",
      fileBuffer: Buffer.from("%PDF-1.4 test SPK document"),
      notes: "Surat Perintah Kerja (SPK) diterbitkan.",
    });

    await submitMilestoneFlexible({
      reportId: reportId1,
      stageKey: "SERAH_TERIMA",
      actor: bmsUserCtx,
      originalFilename: "ST-001.pdf",
      fileBuffer: Buffer.from("%PDF-1.4 test Serah Terima document"),
      notes: "Dokumen serah terima fisik gerai lengkap.",
    });

    // Check incident status after 100% milestone
    const incAfterMilestones = await (await incidentDetailRoute.GET(new Request(`http://localhost/api/incidents/${reportId1}`, {
      headers: { cookie: `siaga_session=${sessions["bms"]}` },
    }), { params: Promise.resolve({ id: reportId1 }) })).json();

    const notAutoClosed = incAfterMilestones.data?.status !== "resolved" && incAfterMilestones.data?.status !== "closed";

    record(
      "FLOW1-12",
      "LIFECYCLE_TOKO",
      "All 5 milestones completed to 100%; Report is NOT automatically closed (status: awaiting_st)",
      notAutoClosed && incAfterMilestones.data?.status === "awaiting_st" && incAfterMilestones.data?.progress === 100,
      `Status: ${incAfterMilestones.data?.status}, Progress: ${incAfterMilestones.data?.progress}%`
    );
  }

  // 2.10 Physical Completion Submission by BMS
  {
    const req = new Request(`http://localhost/api/incidents/${reportId1}/completion/submit`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        cookie: `siaga_session=${sessions["bms"]}`,
      },
      body: JSON.stringify({
        notes: "Seluruh pekerjaan fisik plafon dan rak telah selesai 100% dan dokumen ST terlampir.",
      }),
    });
    const res = await compSubmitRoute.POST(req, { params: Promise.resolve({ id: reportId1 }) });
    const json = await res.json();

    record(
      "FLOW1-13",
      "LIFECYCLE_TOKO",
      "BMS submits completion (moves to WAITING_COORDINATOR_APPROVAL)",
      res.status === 200 && json.data?.status === "WAITING_COORDINATOR_APPROVAL",
      `Approval status: ${json.data?.status}`
    );
  }

  // 2.11 Coordinator Review & Gating (BMC)
  {
    // BEC (DC coordinator) attempts to approve Toko -> 403 COORDINATOR_MISMATCH
    const reqBec = new Request(`http://localhost/api/incidents/${reportId1}/completion/approve`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        cookie: `siaga_session=${sessions["bec"]}`,
      },
      body: JSON.stringify({ notes: "BEC cross-approval attempt" }),
    });
    const resBec = await compApproveRoute.POST(reqBec, { params: Promise.resolve({ id: reportId1 }) });
    const jsonBec = await resBec.json();

    record(
      "FLOW1-14",
      "LIFECYCLE_TOKO",
      "Cross-coordinator approval rejected: BEC blocked from approving Toko completion with HTTP 403",
      resBec.status === 403 && jsonBec.code === "COORDINATOR_MISMATCH",
      `HTTP: ${resBec.status}, code: ${jsonBec.code}`
    );

    // BMC Bandung approves Toko completion
    const reqBmc = new Request(`http://localhost/api/incidents/${reportId1}/completion/approve`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        cookie: `siaga_session=${sessions["bmc"]}`,
      },
      body: JSON.stringify({
        notes: "Hasil pekerjaan fisik telah diverifikasi langsung oleh Koordinator Toko (BMC) dan sesuai spesifikasi.",
      }),
    });
    const resBmc = await compApproveRoute.POST(reqBmc, { params: Promise.resolve({ id: reportId1 }) });
    const jsonBmc = await resBmc.json();

    record(
      "FLOW1-15",
      "LIFECYCLE_TOKO",
      "BMC Bandung approves completion; moves to WAITING_MANAGER_APPROVAL",
      resBmc.status === 200 && jsonBmc.data?.status === "WAITING_MANAGER_APPROVAL",
      `Status: ${jsonBmc.data?.status}`
    );
  }

  // 2.12 BnM Manajer Final Approval & Pending Close Transition
  {
    const req = new Request(`http://localhost/api/incidents/${reportId1}/completion/approve`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        cookie: `siaga_session=${sessions["bm"]}`,
      },
      body: JSON.stringify({
        notes: "Persetujuan final serah terima pekerjaan diberikan oleh BnM Manajer Bandung.",
      }),
    });
    const res = await compApproveRoute.POST(req, { params: Promise.resolve({ id: reportId1 }) });
    const json = await res.json();

    record(
      "FLOW1-16",
      "LIFECYCLE_TOKO",
      "BnM Manajer Bandung grants final approval (moves report to approved_pending_close)",
      res.status === 200 && json.data?.status === "approved_pending_close",
      `Status: ${json.data?.status}`
    );
  }

  // 2.13 Final Case Close Authority Guards
  {
    // HO attempting Case Close -> 403
    const reqHoClose = new Request(`http://localhost/api/incidents/${reportId1}/completion/close`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        cookie: `siaga_session=${sessions["ho"]}`,
      },
      body: JSON.stringify({ notes: "HO close attempt" }),
    });
    const resHoClose = await compCloseRoute.POST(reqHoClose, { params: Promise.resolve({ id: reportId1 }) });

    // System Admin attempting Case Close -> 403 (Zero Operational Bypass)
    const reqAdminClose = new Request(`http://localhost/api/incidents/${reportId1}/completion/close`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        cookie: `siaga_session=${sessions["admin"]}`,
      },
      body: JSON.stringify({ notes: "Admin close attempt" }),
    });
    const resAdminClose = await compCloseRoute.POST(reqAdminClose, { params: Promise.resolve({ id: reportId1 }) });

    record(
      "FLOW1-17",
      "LIFECYCLE_TOKO",
      "Case Close authority: HO and System Admin are strictly rejected with HTTP 403",
      resHoClose.status === 403 && resAdminClose.status === 403,
      `HO HTTP: ${resHoClose.status}, Admin HTTP: ${resAdminClose.status}`
    );

    // BnM Manajer Bandung executes Case Close
    const reqBmClose = new Request(`http://localhost/api/incidents/${reportId1}/completion/close`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        cookie: `siaga_session=${sessions["bm"]}`,
      },
      body: JSON.stringify({
        notes: "Seluruh tahapan mitigasi dan perbaikan selesai secara tuntas. Case resmi ditutup oleh BnM Manajer.",
      }),
    });
    const resBmClose = await compCloseRoute.POST(reqBmClose, { params: Promise.resolve({ id: reportId1 }) });
    const jsonBmClose = await resBmClose.json();

    record(
      "FLOW1-18",
      "LIFECYCLE_TOKO",
      "BnM Manajer Bandung executes official Case Close (status transitions to resolved)",
      resBmClose.status === 200 && (jsonBmClose.data?.status === "closed" || jsonBmClose.data?.status === "resolved"),
      `Final status: ${jsonBmClose.data?.status}, Report: ${reportId1}`
    );
  }

  // ============================================================================
  // SECTION 3: E2E LIFECYCLE 2 — NO-DAMAGE COMPLETION FLOW (TIDAK ADA KERUSAKAN)
  // ============================================================================
  console.log("\n--- SECTION 3: E2E LIFECYCLE 2: NO-DAMAGE FLOW (TIDAK ADA KERUSAKAN) ---");

  const reportId2 = `INC-P4-SAFE-${Date.now()}`;

  // 3.1 Create Incident
  {
    const req = new Request("http://localhost/api/incidents", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        cookie: `siaga_session=${sessions["bms"]}`,
      },
      body: JSON.stringify({
        id: reportId2,
        disasterType: "flood",
        storeId: "T-BDG-002",
        storeName: "Alfamart Pasteur Bandung",
        branch: "BANDUNG",
        locationCity: "Bandung",
        tkpType: "toko",
        reportOrigin: "manual",
        notes: "Guncangan gempa terasa di gerai.",
      }),
    });
    await incidentsRoute.POST(req);
  }

  // 3.2 BMS submits inspection: safe
  {
    const req = new Request(`http://localhost/api/incidents/${reportId2}/confirm`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        cookie: `siaga_session=${sessions["bms"]}`,
      },
      body: JSON.stringify({
        condition: "safe",
        inspection_method: "kunjungan_langsung",
        notes: "Pemeriksaan struktur gedung, rak, dan instalasi listrik selesai: kondisi aman, tidak ada kerusakan.",
        operational_status: "Buka Normal",
        photos: ["https://sparta-siaga.local/storage/evidence/p4_pasteur_safe.jpg"],
      }),
    });
    const res = await confirmRoute.POST(req, { params: Promise.resolve({ id: reportId2 }) });
    record(
      "FLOW2-01",
      "LIFECYCLE_SAFE",
      "BMS submits inspection with condition 'safe' and photographic evidence",
      res.status === 200,
      `HTTP status: ${res.status}`
    );
  }

  // 3.3 BnM Manajer confirms 'Tidak Ada Kerusakan' (safe)
  {
    const req = new Request(`http://localhost/api/incidents/${reportId2}/approval`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        cookie: `siaga_session=${sessions["bm"]}`,
      },
      body: JSON.stringify({
        decision: "safe",
        notes: "Kondisi toko dikonfirmasi aman. Tidak memerlukan tindakan pemeliharaan.",
      }),
    });
    const res = await approvalRoute.POST(req, { params: Promise.resolve({ id: reportId2 }) });
    const json = await res.json();

    record(
      "FLOW2-02",
      "LIFECYCLE_SAFE",
      "BnM Manajer confirms 'safe'; report status moves to confirmed_safe (progress 100%)",
      res.status === 200 && json.data?.status === "confirmed_safe" && json.data?.decision === "safe",
      `Decision: ${json.data?.decision}, Status: ${json.data?.status}`
    );
  }

  // 3.4 Verification that maintenance handoff is rejected on confirmed_safe
  {
    const req = new Request(`http://localhost/api/incidents/${reportId2}/estimation`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        cookie: `siaga_session=${sessions["bms"]}`,
      },
      body: JSON.stringify({ notes: "Attempt handoff for safe report" }),
    });
    const res = await estimationRoute.POST(req, { params: Promise.resolve({ id: reportId2 }) });
    const json = await res.json();

    record(
      "FLOW2-03",
      "LIFECYCLE_SAFE",
      "Maintenance handoff rejected on confirmed_safe report with HTTP 422",
      res.status === 422 && json.code === "REPORT_SAFE_NO_ESTIMATION",
      `HTTP ${res.status}, code: ${json.code}`
    );

    // Verify safe report is visible to HO
    const repCheckHo = await (await incidentDetailRoute.GET(new Request(`http://localhost/api/incidents/${reportId2}`, {
      headers: { cookie: `siaga_session=${sessions["ho"]}` },
    }), { params: Promise.resolve({ id: reportId2 }) })).json();

    record(
      "FLOW2-04",
      "LIFECYCLE_SAFE",
      "Confirmed safe report completes without maintenance and is visible to HO",
      repCheckHo.data?.status === "confirmed_safe",
      `HO visible status: ${repCheckHo.data?.status}`
    );
  }

  // ============================================================================
  // SECTION 4: E2E LIFECYCLE 3 — SPECIALIZED FACILITIES (DC & OFFICE)
  // ============================================================================
  console.log("\n--- SECTION 4: E2E LIFECYCLE 3: SPECIALIZED FACILITIES (DC & OFFICE) ---");

  // 4.1 DC Facility Lifecycle (BES & BEC)
  const reportIdDc = `INC-P4-DC-${Date.now()}`;
  {
    // Create DC Incident
    await incidentsRoute.POST(new Request("http://localhost/api/incidents", {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie: `siaga_session=${sessions["bes"]}` },
      body: JSON.stringify({
        id: reportIdDc,
        disasterType: "flood",
        storeId: "DC-BDG-01",
        facilityId: "DC-BDG-01",
        storeName: "Distribution Center Bandung Soekarno-Hatta",
        branch: "BANDUNG",
        locationCity: "Bandung",
        tkpType: "dc",
        reportOrigin: "manual",
        notes: "Area loading dock DC tergenang air.",
      }),
    }));

    // BMS blocked from inspecting DC -> 403
    const resBmsOnDc = await confirmRoute.POST(new Request(`http://localhost/api/incidents/${reportIdDc}/confirm`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie: `siaga_session=${sessions["bms"]}` },
      body: JSON.stringify({ condition: "damaged", photos: ["https://sparta-siaga.local/dc.jpg"], notes: "BMS inspecting DC" }),
    }), { params: Promise.resolve({ id: reportIdDc }) });

    // BES inspects DC
    const resBesInspect = await confirmRoute.POST(new Request(`http://localhost/api/incidents/${reportIdDc}/confirm`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie: `siaga_session=${sessions["bes"]}` },
      body: JSON.stringify({
        condition: "damaged",
        inspection_method: "kunjungan_langsung",
        notes: "Pintu rolling door DC macet terendam air.",
        photos: ["https://sparta-siaga.local/storage/evidence/p4_dc_door.jpg"],
      }),
    }), { params: Promise.resolve({ id: reportIdDc }) });

    // BnM Manajer approves
    await approvalRoute.POST(new Request(`http://localhost/api/incidents/${reportIdDc}/approval`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie: `siaga_session=${sessions["bm"]}` },
      body: JSON.stringify({ decision: "approved", notes: "Disetujui perbaikan rolling door DC." }),
    }), { params: Promise.resolve({ id: reportIdDc }) });

    // Transition DC route to READY_FOR_WORK and submit SERAH_TERIMA milestone (100%)
    const besUserCtx = {
      id: "usr_bes_bdg_01",
      name: "Demo BES Bandung",
      role: "bes" as any,
      systemRole: "USER" as any,
      scope: "BRANCH" as any,
      branch: "BANDUNG",
    };
    const dcIncident = await dbGetIncidentById(reportIdDc);
    await EstimationIntegrationService.createRoute({
      reportId: reportIdDc,
      handlerType: "BES",
      actor: { id: besUserCtx.id, name: besUserCtx.name, nik: "BES001" },
      report: dcIncident!,
    });
    await EstimationIntegrationService.updateWorkStatus(reportIdDc, "READY_FOR_WORK", { bypassReadinessValidation: true });
    await dbUpdateIncident(reportIdDc, { status: "in_maintenance" });
    await submitMilestoneFlexible({
      reportId: reportIdDc,
      stageKey: "SERAH_TERIMA",
      actor: besUserCtx,
      originalFilename: "ST-DC-001.pdf",
      fileBuffer: Buffer.from("%PDF-1.4 test DC Serah Terima document"),
      notes: "Dokumen serah terima rolling door DC lengkap.",
    });

    // BES submits completion
    const resCompSubmit = await compSubmitRoute.POST(new Request(`http://localhost/api/incidents/${reportIdDc}/completion/submit`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie: `siaga_session=${sessions["bes"]}` },
      body: JSON.stringify({ notes: "Perbaikan rolling door DC selesai oleh tim BES." }),
    }), { params: Promise.resolve({ id: reportIdDc }) });

    // BMC (store coordinator) blocked from DC approval -> 403 COORDINATOR_MISMATCH
    const resBmcOnDc = await compApproveRoute.POST(new Request(`http://localhost/api/incidents/${reportIdDc}/completion/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie: `siaga_session=${sessions["bmc"]}` },
      body: JSON.stringify({ notes: "BMC attempt on DC" }),
    }), { params: Promise.resolve({ id: reportIdDc }) });

    // BEC (DC coordinator) approves DC
    const resBecOnDc = await compApproveRoute.POST(new Request(`http://localhost/api/incidents/${reportIdDc}/completion/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie: `siaga_session=${sessions["bec"]}` },
      body: JSON.stringify({ notes: "Verifikasi pekerjaan DC disetujui oleh Koordinator Engineering (BEC)." }),
    }), { params: Promise.resolve({ id: reportIdDc }) });

    record(
      "FLOW3-01",
      "LIFECYCLE_FACILITIES",
      "DC Facility lifecycle enforces BES specialist & BEC coordinator (BMS & BMC blocked with 403)",
      resBmsOnDc.status === 403 && resBesInspect.status === 200 && resCompSubmit.status === 200 &&
      resBmcOnDc.status === 403 && resBecOnDc.status === 200,
      `BMS on DC: ${resBmsOnDc.status}, BMC on DC: ${resBmcOnDc.status}, BEC approved: ${resBecOnDc.status}`
    );
  }

  // 4.2 Building Facility Lifecycle (BBS & BBC)
  const reportIdOffice = `INC-P4-OFFICE-${Date.now()}`;
  {
    await incidentsRoute.POST(new Request("http://localhost/api/incidents", {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie: `siaga_session=${sessions["bbs"]}` },
      body: JSON.stringify({
        id: reportIdOffice,
        disasterType: "flood",
        storeId: "KANTOR-CABANG-BDG",
        facilityId: "KANTOR-CABANG-BDG",
        storeName: "Kantor Cabang Alfamart Bandung",
        branch: "BANDUNG",
        locationCity: "Bandung",
        tkpType: "building",
        reportOrigin: "manual",
        notes: "Dinding retak halus di lantai 2 kantor cabang.",
      }),
    }));

    // BBS inspects
    const resBbsInspect = await confirmRoute.POST(new Request(`http://localhost/api/incidents/${reportIdOffice}/confirm`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie: `siaga_session=${sessions["bbs"]}` },
      body: JSON.stringify({
        condition: "damaged",
        inspection_method: "kunjungan_langsung",
        notes: "Retak plesteran dinding non-struktural.",
        photos: ["https://sparta-siaga.local/storage/evidence/p4_office_wall.jpg"],
      }),
    }), { params: Promise.resolve({ id: reportIdOffice }) });

    // BnM Manajer approves
    await approvalRoute.POST(new Request(`http://localhost/api/incidents/${reportIdOffice}/approval`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie: `siaga_session=${sessions["bm"]}` },
      body: JSON.stringify({ decision: "approved", notes: "Disetujui perbaikan dinding kantor cabang." }),
    }), { params: Promise.resolve({ id: reportIdOffice }) });

    // Transition Office route to READY_FOR_WORK and submit SERAH_TERIMA milestone (100%)
    const bbsUserCtx = {
      id: "usr_bbs_bdg_01",
      name: "Demo BBS Bandung",
      role: "bbs" as any,
      systemRole: "USER" as any,
      scope: "BRANCH" as any,
      branch: "BANDUNG",
    };
    const officeIncident = await dbGetIncidentById(reportIdOffice);
    await EstimationIntegrationService.createRoute({
      reportId: reportIdOffice,
      handlerType: "BUILDING",
      actor: { id: bbsUserCtx.id, name: bbsUserCtx.name, nik: "BBS001" },
      report: officeIncident!,
    });
    await EstimationIntegrationService.updateWorkStatus(reportIdOffice, "READY_FOR_WORK", { bypassReadinessValidation: true });
    await dbUpdateIncident(reportIdOffice, { status: "in_maintenance" });
    await submitMilestoneFlexible({
      reportId: reportIdOffice,
      stageKey: "SERAH_TERIMA",
      actor: bbsUserCtx,
      originalFilename: "ST-OFFICE-001.pdf",
      fileBuffer: Buffer.from("%PDF-1.4 test Office Serah Terima document"),
      notes: "Dokumen serah terima perbaikan dinding kantor cabang lengkap.",
    });

    // BBS submits completion
    await compSubmitRoute.POST(new Request(`http://localhost/api/incidents/${reportIdOffice}/completion/submit`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie: `siaga_session=${sessions["bbs"]}` },
      body: JSON.stringify({ notes: "Pengecatan dan plesteran ulang selesai." }),
    }), { params: Promise.resolve({ id: reportIdOffice }) });

    // BBC (Building coordinator) approves
    const resBbcApprove = await compApproveRoute.POST(new Request(`http://localhost/api/incidents/${reportIdOffice}/completion/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie: `siaga_session=${sessions["bbc"]}` },
      body: JSON.stringify({ notes: "Pekerjaan gedung kantor cabang disetujui oleh BBC." }),
    }), { params: Promise.resolve({ id: reportIdOffice }) });

    record(
      "FLOW3-02",
      "LIFECYCLE_FACILITIES",
      "Building / Office lifecycle enforces BBS specialist & BBC coordinator approval",
      resBbsInspect.status === 200 && resBbcApprove.status === 200,
      `BBS inspect: ${resBbsInspect.status}, BBC approve: ${resBbcApprove.status}`
    );
  }

  // ============================================================================
  // SECTION 5: AUTOMATIC EARTHQUAKE INGESTION & RECONCILIATION
  // ============================================================================
  console.log("\n--- SECTION 5: AUTOMATIC EARTHQUAKE INGESTION & RECONCILIATION ---");

  const testEqStoreCode = `TEST_P4_T_${Date.now()}`;
  const testMainshockId = `bmkg_p4_test_main_${Date.now()}`;
  const testAftershockId = `bmkg_p4_test_after_${Date.now()}`;

  // Purge any stale test fixtures before running Section 5
  await pool.query(`DELETE FROM earthquake_events WHERE id LIKE 'bmkg_p4_test_%'`);
  await pool.query(`DELETE FROM earthquake_reconciliation_cases WHERE incident_id LIKE 'INC-P4-%' OR incident_id LIKE 'LAP-P4-%'`);

  // Insert store fixture
  await pool.query(
    `INSERT INTO stores (id, kode_toko, nama_toko, cabang, alamat, latitude, longitude, fr_type)
     VALUES ($1, $1, 'Alfamart P4 Dago Bandung', 'BANDUNG', 'Jl. Ir H Djuanda Bandung', -6.9175, 107.6191, 'Reguler')`,
    [testEqStoreCode]
  );

  // Insert genuine BMKG test earthquake: Mainshock (M6.1, depth 15km, near Bandung ~10km)
  await pool.query(
    `INSERT INTO earthquake_events (
       id, provider_event_id, source_primary, magnitude, depth_km,
       latitude, longitude, occurred_at, title, priority_radius_km, monitoring_radius_km,
       potensi_tsunami, first_seen_at, last_seen_at
     ) VALUES ($1, $1, 'BMKG', 6.1, 15, -7.00, 107.60, NOW() - INTERVAL '25 minutes', 'Gempa M6.1 Bandung Selatan', 60, 130, FALSE, NOW(), NOW())`,
    [testMainshockId]
  );

  // 5.1 Reconciliation: Manual-first linked to authentic BMKG earthquake
  let manualFirstIncidentId = "";
  {
    const manualReportInput = {
      id: `LAP-P4-MAN-${Date.now()}`,
      date: new Date().toISOString(),
      disasterType: "earthquake" as const,
      reportOrigin: "manual" as const,
      storeId: testEqStoreCode,
      storeName: "Alfamart P4 Dago Bandung",
      branch: "BANDUNG",
      locationCity: "Bandung",
      tkpType: "toko" as const,
      status: "pending_confirmation" as const,
      progress: 0,
      fieldPhotos: ["https://sparta-siaga.local/storage/p4_crack.jpg"],
      damageNotes: "Retak plesteran dinding akibat guncangan gempa.",
      timeline: [],
    };

    const recRes = await reconcileManualEarthquakeSubmission({
      sessionUser: {
        id: "usr_bms_bdg_01",
        name: "Demo BMS Bandung",
        role: "bms" as any,
        systemRole: "USER" as any,
        scope: "BRANCH" as any,
        branch: "BANDUNG",
      },
      body: manualReportInput as unknown as IncidentRecord,
    });

    manualFirstIncidentId = recRes.incident.id;

    record(
      "EQ-01",
      "EARTHQUAKE_RECONCILIATION",
      "Manual-first report seamlessly linked with canonical BMKG earthquake event",
      recRes.outcome === "linked_to_earthquake" && recRes.canonicalEventId === testMainshockId,
      `Outcome: ${recRes.outcome}, CanonicalEventId: ${recRes.canonicalEventId}`
    );
  }

  // 5.2 Duplicate Prevention: Second submission on same store and earthquake merges
  {
    const secondReportInput = {
      id: `LAP-P4-MAN2-${Date.now()}`,
      date: new Date().toISOString(),
      disasterType: "earthquake" as const,
      reportOrigin: "manual" as const,
      storeId: testEqStoreCode,
      storeName: "Alfamart P4 Dago Bandung",
      branch: "BANDUNG",
      locationCity: "Bandung",
      tkpType: "toko" as const,
      status: "pending_confirmation" as const,
      progress: 0,
      fieldPhotos: ["https://sparta-siaga.local/storage/p4_crack_detail.jpg"],
      damageNotes: "Pengecekan susulan kondisi gerai.",
      timeline: [],
    };

    const recSecondRun = await reconcileManualEarthquakeSubmission({
      sessionUser: {
        id: "usr_bms_bdg_01",
        name: "Demo BMS Bandung",
        role: "bms" as any,
        systemRole: "USER" as any,
        scope: "BRANCH" as any,
        branch: "BANDUNG",
      },
      body: secondReportInput as unknown as IncidentRecord,
    });

    record(
      "EQ-02",
      "EARTHQUAKE_RECONCILIATION",
      "Duplicate earthquake report prevented via automatic merge into existing incident",
      recSecondRun.outcome === "merged_into_existing" && recSecondRun.mergedIncidentId === manualFirstIncidentId,
      `Outcome: ${recSecondRun.outcome}, Merged into: ${recSecondRun.mergedIncidentId}`
    );
  }

  // 5.3 Aftershock creates distinct canonical event identity
  {
    await pool.query(
      `INSERT INTO earthquake_events (
         id, provider_event_id, source_primary, magnitude, depth_km,
         latitude, longitude, occurred_at, title, priority_radius_km, monitoring_radius_km,
         potensi_tsunami, first_seen_at, last_seen_at
       ) VALUES ($1, $1, 'BMKG', 4.8, 12, -7.02, 107.61, NOW() - INTERVAL '2 minutes', 'Gempa Susulan M4.8 Bandung Selatan', 40, 90, FALSE, NOW(), NOW())`,
      [testAftershockId]
    );

    const aftershockReportInput = {
      id: `LAP-P4-AFTER-${Date.now()}`,
      date: new Date().toISOString(),
      disasterType: "earthquake" as const,
      reportOrigin: "manual" as const,
      storeId: testEqStoreCode,
      storeName: "Alfamart P4 Dago Bandung",
      branch: "BANDUNG",
      locationCity: "Bandung",
      tkpType: "toko" as const,
      status: "pending_confirmation" as const,
      progress: 0,
      fieldPhotos: ["https://sparta-siaga.local/storage/p4_aftershock.jpg"],
      damageNotes: "Guncangan susulan terasa.",
      timeline: [],
    };

    const recAftershock = await reconcileManualEarthquakeSubmission({
      sessionUser: {
        id: "usr_bms_bdg_01",
        name: "Demo BMS Bandung",
        role: "bms" as any,
        systemRole: "USER" as any,
        scope: "BRANCH" as any,
        branch: "BANDUNG",
      },
      body: aftershockReportInput as unknown as IncidentRecord,
      windowMinutes: 10,
    });

    record(
      "EQ-03",
      "EARTHQUAKE_RECONCILIATION",
      "Aftershock receives distinct canonical event identity and does not overwrite mainshock",
      recAftershock.outcome === "linked_to_earthquake" && recAftershock.canonicalEventId === testAftershockId,
      `Aftershock Canonical ID: ${recAftershock.canonicalEventId}`
    );
  }

  // ============================================================================
  // SECTION 6: HEAD OFFICE MONITORING-ONLY & OUTBOX ADMINISTRATIVE GUARDS
  // ============================================================================
  console.log("\n--- SECTION 6: HEAD OFFICE MONITORING-ONLY & OUTBOX GUARDS ---");

  // 6.1 GET outbox status works for HO
  {
    const req = new Request("http://localhost/api/notifications/approval-outbox", {
      headers: { cookie: `siaga_session=${sessions["ho"]}` },
    });
    const res = await outboxApi.GET(req);
    const json = await res.json();

    record(
      "HO-01",
      "HO_MONITORING_ONLY",
      "GET /api/notifications/approval-outbox allows read-only monitoring to HO",
      res.status === 200 && json.success,
      `HTTP: ${res.status}, Total outbox: ${json.data?.total}`
    );
  }

  // 6.2 POST outbox flush REJECTED for HO (Strict Monitoring-Only)
  {
    const req = new Request("http://localhost/api/notifications/approval-outbox", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        cookie: `siaga_session=${sessions["ho"]}`,
      },
      body: JSON.stringify({}),
    });
    const res = await outboxApi.POST(req);
    const json = await res.json();

    record(
      "HO-02",
      "HO_MONITORING_ONLY",
      "POST /api/notifications/approval-outbox strictly blocks HO with HTTP 403 Forbidden",
      res.status === 403,
      `HTTP: ${res.status}, error: "${json.error}"`
    );
  }

  // 6.3 POST outbox flush ALLOWED for System Admin
  {
    const req = new Request("http://localhost/api/notifications/approval-outbox", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        cookie: `siaga_session=${sessions["admin"]}`,
      },
      body: JSON.stringify({ limit: 10 }),
    });
    const res = await outboxApi.POST(req);
    const json = await res.json();

    record(
      "HO-03",
      "HO_MONITORING_ONLY",
      "POST /api/notifications/approval-outbox allows manual queue flush to System Administrator",
      res.status === 200 && json.success,
      `HTTP: ${res.status}, message: "${json.message}"`
    );
  }

  // ============================================================================
  // SECTION 7: MULTI-ROLE NEGATIVE AUTHORIZATION MATRIX
  // ============================================================================
  console.log("\n--- SECTION 7: MULTI-ROLE NEGATIVE AUTHORIZATION MATRIX ---");

  // 7.1 Cross-Branch Isolation: BMS Bandung cannot modify Sidoarjo incident
  {
    const resCrossBranch = await confirmRoute.POST(new Request("http://localhost/api/incidents/INC-SID-TEST/confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie: `siaga_session=${sessions["bms"]}` },
      body: JSON.stringify({ condition: "damaged", photos: ["https://sparta-siaga.local/test.jpg"] }),
    }), { params: Promise.resolve({ id: "INC-SID-TEST" }) });

    record(
      "RBAC-01",
      "RBAC_MATRIX",
      "Cross-branch isolation enforced: BMS Bandung cannot modify Sidoarjo incidents",
      resCrossBranch.status === 403 || resCrossBranch.status === 404,
      `HTTP status: ${resCrossBranch.status}`
    );
  }

  // 7.2 Zero Operational Bypass: System Admin cannot bypass BnM Manajer on Case Close
  {
    const resAdminClose = await generalCloseRoute.POST(new Request(`http://localhost/api/incidents/${reportId1}/close`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie: `siaga_session=${sessions["admin"]}` },
      body: JSON.stringify({ reason: "Admin bypass attempt" }),
    }), { params: Promise.resolve({ id: reportId1 }) });

    record(
      "RBAC-02",
      "RBAC_MATRIX",
      "Zero Operational Bypass: System Admin blocked from executing Case Close as BnM Manajer",
      resAdminClose.status === 403,
      `HTTP status: ${resAdminClose.status}`
    );
  }

  // 7.3 HO cannot create manual incidents
  {
    const resHoCreate = await incidentsRoute.POST(new Request("http://localhost/api/incidents", {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie: `siaga_session=${sessions["ho"]}` },
      body: JSON.stringify({ id: "INC-HO-BLOCKED", disasterType: "flood", storeId: "T001" }),
    }));

    record(
      "RBAC-03",
      "RBAC_MATRIX",
      "HO users blocked from creating manual incidents with HTTP 403",
      resHoCreate.status === 403,
      `HTTP status: ${resHoCreate.status}`
    );
  }

  // Cleanup test artifacts
  console.log("\n--- CLEANING UP TEST FIXTURES ---");
  await pool.query(`DELETE FROM report_completion_approvals WHERE report_id LIKE 'INC-P4-%' OR report_id LIKE 'LAP-P4-%'`);
  await pool.query(`DELETE FROM report_completion_approval_history WHERE report_id LIKE 'INC-P4-%' OR report_id LIKE 'LAP-P4-%'`);
  await pool.query(`DELETE FROM report_milestones WHERE report_id LIKE 'INC-P4-%' OR report_id LIKE 'LAP-P4-%'`);
  await pool.query(`DELETE FROM report_distributions WHERE report_id LIKE 'INC-P4-%' OR report_id LIKE 'LAP-P4-%'`);
  await pool.query(`DELETE FROM report_approval_outbox WHERE report_id LIKE 'INC-P4-%' OR report_id LIKE 'LAP-P4-%'`);
  await pool.query(`DELETE FROM report_estimation_routes WHERE report_id LIKE 'INC-P4-%' OR report_id LIKE 'LAP-P4-%'`);
  await pool.query(`DELETE FROM incident_pic_history WHERE incident_id LIKE 'INC-P4-%' OR incident_id LIKE 'LAP-P4-%'`);
  await pool.query(`DELETE FROM earthquake_reconciliation_cases WHERE incident_id LIKE 'INC-P4-%' OR incident_id LIKE 'LAP-P4-%'`);
  await pool.query(`DELETE FROM incidents WHERE id LIKE 'INC-P4-%' OR id LIKE 'LAP-P4-%'`);
  await pool.query(`DELETE FROM earthquake_events WHERE id IN ($1, $2)`, [testMainshockId, testAftershockId]);
  await pool.query(`DELETE FROM stores WHERE id = $1`, [testEqStoreCode]);

  setMockEmailTransporter(null);
  await closeDbPool();

  // Print Summary
  const passedCount = suiteResults.filter((r) => r.passed).length;
  const failedCount = suiteResults.length - passedCount;

  console.log("\n================================================================================");
  console.log(` PHASE 4 TEST SUMMARY: TOTAL ${suiteResults.length} | PASS: ${passedCount} | FAIL: ${failedCount}`);
  console.log("================================================================================");

  if (failedCount > 0) {
    console.error(`\n❌ ${failedCount} tests failed.`);
    process.exit(1);
  } else {
    console.log("\n🎉 ALL PHASE 4 END-TO-END BUSINESS FLOW & UAT TESTS PASSED SUCCESSFULLY!");
  }
}

runPhase4Suite().catch((err) => {
  console.error("Unhandled error in Phase 4 suite:", err);
  process.exit(1);
});
