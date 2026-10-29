/**
 * SPARTA SIAGA — Real Operational UAT API Test Suite
 *
 * Validates actual workflows through application route handlers:
 * 1. BMS inspection → photo evidence → BnM confirmation.
 * 2. Confirmed damage → SPARTA Maintenance follow-up (repair linking).
 * 3. BMS → BMC → BnM → Case Close.
 * 4. BES → BEC → BnM (DC facility flow).
 * 5. BBS → BBC → BnM (Building damage flow).
 * 6. Rejection, revision, re-approval cycle.
 * 7. Branch isolation (CIKOKOL users rejected from BANDUNG incidents).
 * 8. HO monitoring (HO Admin read-only, full national visibility).
 *
 * Strictly executes against isolated UAT database (sparta_siaga_isolated).
 * Zero direct SQL status manipulation.
 */

import sharp from "sharp";
import { setTestingModeActiveSync, getIsolatedDbPool } from "../lib/db";
import { dbCreateIncident, dbGetIncidentById } from "../lib/incident-db";
import { createDeviceSession } from "../lib/session-service";
import { dbGetUserByIdentifier } from "../lib/user-db";
import { IncidentRecord } from "@/types/incident";
import { EstimationIntegrationService } from "../lib/estimation-service";
import { submitMilestoneFlexible } from "../lib/milestone-service";

// Import actual application route handlers
import * as confirmRoute from "../app/api/incidents/[id]/confirm/route";
import * as progressRoute from "../app/api/incidents/[id]/progress/route";
import * as completionSubmitRoute from "../app/api/incidents/[id]/completion/submit/route";
import * as completionApproveRoute from "../app/api/incidents/[id]/completion/approve/route";
import * as completionRejectRoute from "../app/api/incidents/[id]/completion/reject/route";
import * as closeRoute from "../app/api/incidents/[id]/close/route";
import * as repairLinksRoute from "../app/api/incidents/[id]/repair-links/route";

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

async function assertRes(res: Response, expectedStatus: number, desc: string) {
  if (res.status === expectedStatus) {
    console.log(`  [PASS] ${desc} (HTTP ${res.status})`);
    passed++;
  } else {
    let errBody = "";
    try {
      errBody = await res.text();
    } catch {}
    console.error(`  [FAIL] ${desc} -> Expected HTTP ${expectedStatus}, got ${res.status}. Body: ${errBody}`);
    failed++;
  }
}

async function getSampleImageFile(name: string = "test.png"): Promise<File> {
  const buffer = await sharp({
    create: {
      width: 400,
      height: 300,
      channels: 4,
      background: { r: 50, g: 150, b: 250, alpha: 1 },
    },
  })
    .png()
    .toBuffer();

  return new File([buffer], name, { type: "image/png" });
}

// Helper to create an authenticated Request with signed session cookies
async function makeAuthRequest(
  userId: string,
  url: string,
  method: string = "GET",
  body?: any
): Promise<Request> {
  const user = await dbGetUserByIdentifier(userId);
  if (!user) {
    throw new Error(`User ${userId} not found for UAT testing`);
  }

  const session = await createDeviceSession({
    userId: user.id,
    userAgent: "UAT Test Agent",
  });
  if (!session) {
    throw new Error(`Failed to create device session for user ${userId}`);
  }

  const headers = new Headers();
  headers.set("Cookie", `siaga_session=${session.accessToken}; siaga_refresh=${session.refreshToken}`);

  let requestBody: any = undefined;
  if (body) {
    if (typeof FormData !== "undefined" && body instanceof FormData) {
      requestBody = body;
    } else {
      headers.set("Content-Type", "application/json");
      requestBody = JSON.stringify(body);
    }
  }

  return new Request(url, {
    method,
    headers,
    body: requestBody,
  });
}

async function runRealOperationalUat() {
  console.log("\n=======================================================");
  console.log(" SPARTA SIAGA — REAL OPERATIONAL UAT API SUITE");
  console.log("=======================================================\n");

  // Strictly enforce Testing Mode & Isolated Database
  setTestingModeActiveSync(true);
  const pool = getIsolatedDbPool();

  try {
    // -------------------------------------------------------------------------
    // WORKFLOW 1: BMS → BMC → BnM (Store Damage, Rejection & Case Close)
    // -------------------------------------------------------------------------
    console.log("[1] Store Damage Lifecycle: BMS → BMC → BnM with Revision & Close");

    const storeIncidentId = `UAT-STORE-${Date.now()}`;
    const initialStoreIncident: IncidentRecord = {
      id: storeIncidentId,
      date: new Date().toISOString().split("T")[0],
      disasterType: "earthquake",
      reportOrigin: "manual",
      storeId: "T001",
      storeName: "Alfamart Dago Bandung",
      branch: "BANDUNG",
      locationCity: "Bandung",
      tkpType: "toko",
      status: "verifying",
      progress: 0,
      timeline: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await dbCreateIncident(initialStoreIncident);
    console.log(`    Created baseline incident on isolated DB: ${storeIncidentId}`);

    // Step 1: BMS0001 submits inspection with photo evidence
    const bmsInspectReq = await makeAuthRequest(
      "BMS0001",
      `http://localhost:3004/api/incidents/${storeIncidentId}/confirm`,
      "POST",
      {
        condition: "damaged",
        method: "onsite",
        photos: ["/storage/uat-damage-photo-01.jpg"],
        notes: "Dinding retak dan rak roboh akibat getaran gempa.",
        damage_items: [
          {
            category: "STRUKTUR",
            severity: "RUSAK_SEDANG",
            action_type: "PERBAIKAN",
            description: "Dinding retak geser",
          },
        ],
      }
    );

    const bmsInspectRes = await confirmRoute.POST(bmsInspectReq, {
      params: Promise.resolve({ id: storeIncidentId }),
    });
    assert(bmsInspectRes.status === 200, "BMS0001 submits inspection successfully (HTTP 200)");

    let current = await dbGetIncidentById(storeIncidentId);
    assert(current?.status === "pending_bm_approval", "Incident status transitioned to 'pending_bm_approval'");

    // Step 2: BM0001 confirms damage
    const bmConfirmReq = await makeAuthRequest(
      "BM0001",
      `http://localhost:3004/api/incidents/${storeIncidentId}/confirm`,
      "POST",
      {
        decision: "approved",
        notes: "Kerusakan terverifikasi oleh BnM Manajer. Lanjut SPARTA Maintenance.",
      }
    );

    const bmConfirmRes = await confirmRoute.POST(bmConfirmReq, {
      params: Promise.resolve({ id: storeIncidentId }),
    });
    assert(bmConfirmRes.status === 200, "BM0001 confirms damage inspection (HTTP 200)");

    current = await dbGetIncidentById(storeIncidentId);
    assert(current?.status === "confirmed_affected", "Incident status transitioned to 'confirmed_affected'");

    // Step 3: SPARTA Maintenance Follow-up (Repair Linking)
    const repairLinkReq = await makeAuthRequest(
      "BM0001",
      `http://localhost:3004/api/incidents/${storeIncidentId}/repair-links`,
      "POST",
      {
        repairReferenceId: "SPARTA-MT-2026-BDG-001",
        notes: "Ditautkan ke SPARTA Maintenance tiket perbaikan sipil",
      }
    );
    const repairLinkRes = await repairLinksRoute.POST(repairLinkReq, {
      params: Promise.resolve({ id: storeIncidentId }),
    });
    await assertRes(repairLinkRes, 201, "SPARTA Maintenance repair ticket linked successfully (HTTP 201)");

    // Initialize estimation route and set work readiness
    await EstimationIntegrationService.createRoute({
      reportId: storeIncidentId,
      handlerType: "BMS",
      actor: { id: "USR-BM-01", name: "Bambang BM" },
      report: current!,
    });
    await EstimationIntegrationService.updateWorkStatus(storeIncidentId, "READY_FOR_WORK", {
      bypassReadinessValidation: true,
    });

    // Step 4: BMS0001 updates progress to 50%
    const image50 = await getSampleImageFile("progress-50.png");
    const form50 = new FormData();
    form50.set("progress", "50");
    form50.set("description", "Pekerjaan penambalan dinding 50% selesai.");
    form50.set("stage", "PENGERJAAN");
    form50.set("photo_type", "PROGRESS");
    form50.set("file", image50);

    const progressReq50 = await makeAuthRequest(
      "BMS0001",
      `http://localhost:3004/api/incidents/${storeIncidentId}/progress`,
      "POST",
      form50
    );
    const progressRes50 = await progressRoute.POST(progressReq50, {
      params: Promise.resolve({ id: storeIncidentId }),
    });
    await assertRes(progressRes50, 201, "BMS0001 updates progress to 50% via Progress API (HTTP 201)");

    // BMS0001 updates progress to 100% with mandatory HANDOVER evidence
    const image100 = await getSampleImageFile("progress-100.png");
    const form100 = new FormData();
    form100.set("progress", "100");
    form100.set("description", "Pekerjaan dinding tuntas 100% dan serah terima.");
    form100.set("stage", "SERAH_TERIMA");
    form100.set("photo_type", "HANDOVER");
    form100.set("file", image100);

    const progressReq100 = await makeAuthRequest(
      "BMS0001",
      `http://localhost:3004/api/incidents/${storeIncidentId}/progress`,
      "POST",
      form100
    );
    const progressRes100 = await progressRoute.POST(progressReq100, {
      params: Promise.resolve({ id: storeIncidentId }),
    });
    await assertRes(progressRes100, 201, "BMS0001 updates progress to 100% with HANDOVER evidence (HTTP 201)");

    // Step 5: BMS0001 submits completion at 100%
    const compSubmitReq = await makeAuthRequest(
      "BMS0001",
      `http://localhost:3004/api/incidents/${storeIncidentId}/completion/submit`,
      "POST",
      {
        notes: "Seluruh perbaikan dinding dan rak telah tuntas 100%.",
      }
    );
    const compSubmitRes = await completionSubmitRoute.POST(compSubmitReq, {
      params: Promise.resolve({ id: storeIncidentId }),
    });
    assert(compSubmitRes.status === 200, "BMS0001 submits completion (HTTP 200)");

    // Step 6: BMC0001 approves completion
    const bmcApproveReq = await makeAuthRequest(
      "BMC0001",
      `http://localhost:3004/api/incidents/${storeIncidentId}/completion/approve`,
      "POST",
      {
        notes: "Hasil pekerjaan telah diverifikasi oleh Koordinator BMC.",
      }
    );
    const bmcApproveRes = await completionApproveRoute.POST(bmcApproveReq, {
      params: Promise.resolve({ id: storeIncidentId }),
    });
    assert(bmcApproveRes.status === 200, "BMC0001 coordinator approves completion (HTTP 200)");

    // Step 7: BM0001 rejects with revision note (Rejection Cycle)
    const bmRejectReq = await makeAuthRequest(
      "BM0001",
      `http://localhost:3004/api/incidents/${storeIncidentId}/completion/reject`,
      "POST",
      {
        reason: "Cat dinding belum rapi, harap dicat ulang lapisan kedua.",
      }
    );
    const bmRejectRes = await completionRejectRoute.POST(bmRejectReq, {
      params: Promise.resolve({ id: storeIncidentId }),
    });
    assert(bmRejectRes.status === 200, "BM0001 requests revision with rejection reason (HTTP 200)");

    // Step 8: BMS0001 re-submits after revision
    const bmsResubmitReq = await makeAuthRequest(
      "BMS0001",
      `http://localhost:3004/api/incidents/${storeIncidentId}/completion/submit`,
      "POST",
      {
        notes: "Pengecatan ulang lapisan kedua telah selesai dan rapi.",
      }
    );
    const bmsResubmitRes = await completionSubmitRoute.POST(bmsResubmitReq, {
      params: Promise.resolve({ id: storeIncidentId }),
    });
    assert(bmsResubmitRes.status === 200, "BMS0001 re-submits revised completion (HTTP 200)");

    // Step 9: BMC0001 re-approves
    const bmcReapproveReq = await makeAuthRequest(
      "BMC0001",
      `http://localhost:3004/api/incidents/${storeIncidentId}/completion/approve`,
      "POST",
      { notes: "Pengecatan kedua sudah rapi." }
    );
    const bmcReapproveRes = await completionApproveRoute.POST(bmcReapproveReq, {
      params: Promise.resolve({ id: storeIncidentId }),
    });
    assert(bmcReapproveRes.status === 200, "BMC0001 re-approves revised completion");

    // Submit all 5 mandatory milestone documents required for final manager approval
    for (const stage of ["CEKLIS", "ESTIMASI", "APPROVE_PROXY", "SPK", "SERAH_TERIMA"] as const) {
      await submitMilestoneFlexible({
        reportId: storeIncidentId,
        stageKey: stage,
        notes: `Dokumen ${stage} lengkap`,
        actor: {
          id: "usr_bms_bdg_01",
          name: "BMS Bandung",
          role: "bms",
          branch: "BANDUNG",
          systemRole: "USER",
        } as any,
        fileBuffer: Buffer.from(`%PDF-1.4 DUMMY_${stage}_DOCUMENT`),
        originalFilename: `dokumen_${stage.toLowerCase()}.pdf`,
      });
    }

    // Step 10: BM0001 approves completion
    const bmFinalApproveReq = await makeAuthRequest(
      "BM0001",
      `http://localhost:3004/api/incidents/${storeIncidentId}/completion/approve`,
      "POST",
      { notes: "Pekerjaan diterima tuntas oleh BnM Manajer." }
    );
    const bmFinalApproveRes = await completionApproveRoute.POST(bmFinalApproveReq, {
      params: Promise.resolve({ id: storeIncidentId }),
    });
    await assertRes(bmFinalApproveRes, 200, "BM0001 gives final manager approval");

    // Step 11: BM0001 performs explicit Case Close
    const closeReq = await makeAuthRequest(
      "BM0001",
      `http://localhost:3004/api/incidents/${storeIncidentId}/close`,
      "POST",
      { notes: "Insiden resmi ditutup. Gerai kembali beroperasi normal." }
    );
    const closeRes = await closeRoute.POST(closeReq, {
      params: Promise.resolve({ id: storeIncidentId }),
    });
    await assertRes(closeRes, 200, "BM0001 performs Case Close successfully (HTTP 200)");

    current = await dbGetIncidentById(storeIncidentId);
    assert(
      current?.status === "closed" || current?.status === "resolved",
      "Incident final status verified as 'closed' / 'resolved'"
    );

    // -------------------------------------------------------------------------
    // WORKFLOW 2: BES → BEC → BnM (DC Facility Workflow)
    // -------------------------------------------------------------------------
    console.log("\n[2] DC Facility Lifecycle: BES → BEC → BnM");
    const facIncidentId = `UAT-FAC-${Date.now()}`;
    const initialFacIncident: IncidentRecord = {
      id: facIncidentId,
      date: new Date().toISOString().split("T")[0],
      disasterType: "earthquake",
      reportOrigin: "manual",
      storeId: "DC-BDG",
      storeName: "Distribution Center Bandung",
      branch: "BANDUNG",
      locationCity: "Bandung",
      tkpType: "dc",
      status: "verifying",
      progress: 0,
      timeline: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await dbCreateIncident(initialFacIncident);

    // BES0001 inspects
    const besInspectReq = await makeAuthRequest(
      "BES0001",
      `http://localhost:3004/api/incidents/${facIncidentId}/confirm`,
      "POST",
      {
        condition: "damaged",
        method: "onsite",
        photos: ["/storage/dc-inspection-01.jpg"],
        notes: "Gudang DC: Racking zona C miring 5 derajat.",
        damage_items: [
          { category: "RACKING", severity: "RUSAK_BERAT", action_type: "PENGGANTIAN" },
        ],
      }
    );
    const besInspectRes = await confirmRoute.POST(besInspectReq, {
      params: Promise.resolve({ id: facIncidentId }),
    });
    assert(besInspectRes.status === 200, "BES0001 inspects DC facility successfully");

    // BM0001 confirms inspection
    const bmFacConfirmReq = await makeAuthRequest(
      "BM0001",
      `http://localhost:3004/api/incidents/${facIncidentId}/confirm`,
      "POST",
      { decision: "approved", notes: "Racking DC disetujui untuk perbaikan." }
    );
    const bmFacConfirmRes = await confirmRoute.POST(bmFacConfirmReq, {
      params: Promise.resolve({ id: facIncidentId }),
    });
    assert(bmFacConfirmRes.status === 200, "BM0001 confirms DC damage inspection");

    // Setup estimation route for BES
    let facCurrent = await dbGetIncidentById(facIncidentId);
    await EstimationIntegrationService.createRoute({
      reportId: facIncidentId,
      handlerType: "BES",
      actor: { id: "USR-BM-01", name: "Bambang BM" },
      report: facCurrent!,
    });
    await EstimationIntegrationService.updateWorkStatus(facIncidentId, "READY_FOR_WORK", {
      bypassReadinessValidation: true,
    });

    // BES updates progress to 100% with HANDOVER evidence
    const facImage100 = await getSampleImageFile("fac-handover.png");
    const facForm100 = new FormData();
    facForm100.set("progress", "100");
    facForm100.set("description", "Perbaikan racking DC zona C selesai 100%.");
    facForm100.set("stage", "SERAH_TERIMA");
    facForm100.set("photo_type", "HANDOVER");
    facForm100.set("file", facImage100);

    const facProgressReq = await makeAuthRequest(
      "BES0001",
      `http://localhost:3004/api/incidents/${facIncidentId}/progress`,
      "POST",
      facForm100
    );
    const facProgressRes = await progressRoute.POST(facProgressReq, {
      params: Promise.resolve({ id: facIncidentId }),
    });
    await assertRes(facProgressRes, 201, "BES0001 updates facility progress to 100% (HTTP 201)");

    // BES0001 submits completion
    const besSubmitReq = await makeAuthRequest(
      "BES0001",
      `http://localhost:3004/api/incidents/${facIncidentId}/completion/submit`,
      "POST",
      { notes: "Racking zona C telah ditegakkan dan diperkuat." }
    );
    const besSubmitRes = await completionSubmitRoute.POST(besSubmitReq, {
      params: Promise.resolve({ id: facIncidentId }),
    });
    assert(besSubmitRes.status === 200, "BES0001 submits facility completion");

    // BEC0001 approves
    const becApproveReq = await makeAuthRequest(
      "BEC0001",
      `http://localhost:3004/api/incidents/${facIncidentId}/completion/approve`,
      "POST",
      { notes: "Struktur racking DC aman dan kokoh." }
    );
    const becApproveRes = await completionApproveRoute.POST(becApproveReq, {
      params: Promise.resolve({ id: facIncidentId }),
    });
    assert(becApproveRes.status === 200, "BEC0001 approves facility completion");

    // Submit all 5 mandatory milestone documents required for final manager approval
    for (const stage of ["CEKLIS", "ESTIMASI", "APPROVE_PROXY", "SPK", "SERAH_TERIMA"] as const) {
      await submitMilestoneFlexible({
        reportId: facIncidentId,
        stageKey: stage,
        notes: `Dokumen ${stage} lengkap`,
        actor: {
          id: "usr_bes_bdg_01",
          name: "BES Bandung",
          role: "bes",
          branch: "BANDUNG",
          systemRole: "USER",
        } as any,
        fileBuffer: Buffer.from(`%PDF-1.4 DUMMY_${stage}_DOCUMENT`),
        originalFilename: `dokumen_${stage.toLowerCase()}.pdf`,
      });
    }

    // BM0001 approves & closes
    const bmFacApproveReq = await makeAuthRequest(
      "BM0001",
      `http://localhost:3004/api/incidents/${facIncidentId}/completion/approve`,
      "POST",
      { notes: "Penyelesaian DC disetujui BnM Manajer." }
    );
    const bmFacApproveRes = await completionApproveRoute.POST(bmFacApproveReq, {
      params: Promise.resolve({ id: facIncidentId }),
    });
    await assertRes(bmFacApproveRes, 200, "BM0001 approves facility completion");

    const bmFacCloseReq = await makeAuthRequest(
      "BM0001",
      `http://localhost:3004/api/incidents/${facIncidentId}/close`,
      "POST",
      { notes: "Insiden DC resmi diselesaikan." }
    );
    const bmFacCloseRes = await closeRoute.POST(bmFacCloseReq, {
      params: Promise.resolve({ id: facIncidentId }),
    });
    await assertRes(bmFacCloseRes, 200, "BM0001 closes facility incident");

    // -------------------------------------------------------------------------
    // WORKFLOW 3: BBS → BBC → BnM (Building Damage Workflow)
    // -------------------------------------------------------------------------
    console.log("\n[3] Building Damage Lifecycle: BBS → BBC → BnM");
    const bldgIncidentId = `UAT-BLDG-${Date.now()}`;
    const initialBldgIncident: IncidentRecord = {
      id: bldgIncidentId,
      date: new Date().toISOString().split("T")[0],
      disasterType: "earthquake",
      reportOrigin: "manual",
      storeId: "T002",
      storeName: "Alfamart Sukajadi",
      branch: "BANDUNG",
      locationCity: "Bandung",
      tkpType: "building",
      status: "verifying",
      progress: 0,
      timeline: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await dbCreateIncident(initialBldgIncident);

    const bbsInspectReq = await makeAuthRequest(
      "BBS0001",
      `http://localhost:3004/api/incidents/${bldgIncidentId}/confirm`,
      "POST",
      {
        condition: "damaged",
        method: "onsite",
        photos: ["/storage/bldg-crack.jpg"],
        notes: "Fasad bangunan depan retak rambut.",
        damage_items: [{ category: "FASAD", severity: "RUSAK_RINGAN", action_type: "PERBAIKAN" }],
      }
    );
    const bbsInspectRes = await confirmRoute.POST(bbsInspectReq, {
      params: Promise.resolve({ id: bldgIncidentId }),
    });
    await assertRes(bbsInspectRes, 200, "BBS0001 inspects building damage");

    const bmBldgConfirmReq = await makeAuthRequest(
      "BM0001",
      `http://localhost:3004/api/incidents/${bldgIncidentId}/confirm`,
      "POST",
      { decision: "approved", notes: "Perbaikan fasad disetujui." }
    );
    const bmBldgConfirmRes = await confirmRoute.POST(bmBldgConfirmReq, {
      params: Promise.resolve({ id: bldgIncidentId }),
    });
    await assertRes(bmBldgConfirmRes, 200, "BM0001 confirms building inspection");

    // Setup estimation route for BUILDING
    let bldgCurrent = await dbGetIncidentById(bldgIncidentId);
    await EstimationIntegrationService.createRoute({
      reportId: bldgIncidentId,
      handlerType: "BUILDING",
      actor: { id: "USR-BM-01", name: "Bambang BM" },
      report: bldgCurrent!,
    });
    await EstimationIntegrationService.updateWorkStatus(bldgIncidentId, "READY_FOR_WORK", {
      bypassReadinessValidation: true,
    });

    // BBS updates progress to 100% with HANDOVER evidence
    const bldgImage100 = await getSampleImageFile("bldg-handover.png");
    const bldgForm100 = new FormData();
    bldgForm100.set("progress", "100");
    bldgForm100.set("description", "Plesteran dan pengecatan fasad tuntas 100%.");
    bldgForm100.set("stage", "SERAH_TERIMA");
    bldgForm100.set("photo_type", "HANDOVER");
    bldgForm100.set("file", bldgImage100);

    const bldgProgressReq = await makeAuthRequest(
      "BBS0001",
      `http://localhost:3004/api/incidents/${bldgIncidentId}/progress`,
      "POST",
      bldgForm100
    );
    const bldgProgressRes = await progressRoute.POST(bldgProgressReq, {
      params: Promise.resolve({ id: bldgIncidentId }),
    });
    await assertRes(bldgProgressRes, 201, "BBS0001 updates building progress to 100% (HTTP 201)");

    const bbsSubmitReq = await makeAuthRequest(
      "BBS0001",
      `http://localhost:3004/api/incidents/${bldgIncidentId}/completion/submit`,
      "POST",
      { notes: "Fasad depan telah diplester ulang." }
    );
    const bbsSubmitRes = await completionSubmitRoute.POST(bbsSubmitReq, {
      params: Promise.resolve({ id: bldgIncidentId }),
    });
    assert(bbsSubmitRes.status === 200, "BBS0001 submits building completion");

    const bbcApproveReq = await makeAuthRequest(
      "BBC0001",
      `http://localhost:3004/api/incidents/${bldgIncidentId}/completion/approve`,
      "POST",
      { notes: "Plesteran fasad rapi dan solid." }
    );
    const bbcApproveRes = await completionApproveRoute.POST(bbcApproveReq, {
      params: Promise.resolve({ id: bldgIncidentId }),
    });
    assert(bbcApproveRes.status === 200, "BBC0001 approves building completion");

    // Submit all 5 mandatory milestone documents required for final manager approval
    for (const stage of ["CEKLIS", "ESTIMASI", "APPROVE_PROXY", "SPK", "SERAH_TERIMA"] as const) {
      await submitMilestoneFlexible({
        reportId: bldgIncidentId,
        stageKey: stage,
        notes: `Dokumen ${stage} lengkap`,
        actor: {
          id: "usr_bbs_bdg_01",
          name: "BBS Bandung",
          role: "bbs",
          branch: "BANDUNG",
          systemRole: "USER",
        } as any,
        fileBuffer: Buffer.from(`%PDF-1.4 DUMMY_${stage}_DOCUMENT`),
        originalFilename: `dokumen_${stage.toLowerCase()}.pdf`,
      });
    }

    const bmBldgApproveReq = await makeAuthRequest(
      "BM0001",
      `http://localhost:3004/api/incidents/${bldgIncidentId}/completion/approve`,
      "POST",
      { notes: "Selesai disetujui BnM Manajer." }
    );
    const bmBldgApproveRes = await completionApproveRoute.POST(bmBldgApproveReq, {
      params: Promise.resolve({ id: bldgIncidentId }),
    });
    await assertRes(bmBldgApproveRes, 200, "BM0001 gives final manager approval for building");

    const bmBldgCloseReq = await makeAuthRequest(
      "BM0001",
      `http://localhost:3004/api/incidents/${bldgIncidentId}/close`,
      "POST",
      { notes: "Insiden gedung selesai ditutup." }
    );
    const bmBldgCloseRes = await closeRoute.POST(bmBldgCloseReq, {
      params: Promise.resolve({ id: bldgIncidentId }),
    });
    await assertRes(bmBldgCloseRes, 200, "BM0001 closes building incident");

    // -------------------------------------------------------------------------
    // WORKFLOW 4: Branch Isolation & HO Monitoring Security
    // -------------------------------------------------------------------------
    console.log("\n[4] Branch Isolation & HO Monitoring Security");

    // 4.1 CIKOKOL BMS cannot modify BANDUNG incident
    const cikokolCrossReq = await makeAuthRequest(
      "BMS0002",
      `http://localhost:3004/api/incidents/${storeIncidentId}/confirm`,
      "POST",
      { condition: "damaged", method: "onsite", notes: "Unauthorized cross-branch attempt" }
    );
    const cikokolCrossRes = await confirmRoute.POST(cikokolCrossReq, {
      params: Promise.resolve({ id: storeIncidentId }),
    });
    assert(
      cikokolCrossRes.status === 403 || cikokolCrossRes.status === 422,
      `BMS0002 (Cikokol) rejected from modifying Bandung incident (HTTP ${cikokolCrossRes.status})`
    );

    // 4.2 CIKOKOL BM cannot approve BANDUNG incident
    // Create an active Bandung incident waiting for approval to test cross-branch check
    const crossIncidentId = `UAT-CROSS-${Date.now()}`;
    await dbCreateIncident({
      id: crossIncidentId,
      date: new Date().toISOString().split("T")[0],
      disasterType: "earthquake",
      reportOrigin: "manual",
      storeId: "T003",
      storeName: "Alfamart Asia Afrika Bandung",
      branch: "BANDUNG",
      locationCity: "Bandung",
      tkpType: "toko",
      status: "pending_bm_approval",
      progress: 0,
      timeline: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const cikokolBmCrossReq = await makeAuthRequest(
      "BM0002",
      `http://localhost:3004/api/incidents/${crossIncidentId}/confirm`,
      "POST",
      { decision: "approved", notes: "Unauthorized cross-branch approval attempt" }
    );
    const cikokolBmCrossRes = await confirmRoute.POST(cikokolBmCrossReq, {
      params: Promise.resolve({ id: crossIncidentId }),
    });
    assert(
      cikokolBmCrossRes.status === 403,
      `BM0002 (Cikokol) rejected with 403 Forbidden on Bandung incident (HTTP ${cikokolBmCrossRes.status})`
    );

    // 4.3 HO Admin (HO0001) cannot perform operational write/approval
    const hoWriteReq = await makeAuthRequest(
      "HO0001",
      `http://localhost:3004/api/incidents/${bldgIncidentId}/confirm`,
      "POST",
      { condition: "damaged", notes: "HO cannot write operational data" }
    );
    const hoWriteRes = await confirmRoute.POST(hoWriteReq, {
      params: Promise.resolve({ id: bldgIncidentId }),
    });
    assert(
      hoWriteRes.status === 403,
      "HO0001 (HO Admin) strictly forbidden from operational writes (HTTP 403)"
    );

    // 4.4 HO Monitoring visibility (read-only verification across branches)
    const hoGetReq = await makeAuthRequest(
      "HO0001",
      `http://localhost:3004/api/incidents/${storeIncidentId}/progress`
    );
    const hoGetRes = await progressRoute.GET(hoGetReq, {
      params: Promise.resolve({ id: storeIncidentId }),
    });
    assert(
      hoGetRes.status === 200,
      "HO0001 (HO Admin) has full monitoring visibility into Bandung incident (HTTP 200)"
    );

  } catch (err) {
    console.error("UAT Execution Error:", err);
    failed++;
  }

  console.log("\n=======================================================");
  console.log(` TOTAL: ${passed + failed} | PASSED: ${passed} | FAILED: ${failed}`);
  console.log("=======================================================");

  if (failed > 0) {
    process.exit(1);
  }
  process.exit(0);
}

runRealOperationalUat();
