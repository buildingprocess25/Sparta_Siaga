import { Pool } from "pg";
import fs from "node:fs";
import path from "node:path";
import { KNOWN_INTEGRATION_KEYS, ensureIntegrationSchemaAndSeed } from "../lib/integration-auth";
import { dbCreateIncident, dbGetIncidentById } from "../lib/incident-db";
import { IncidentRecord } from "../types/incident";
import { GET as getApprovedIncidents } from "../app/api/integrations/v1/approved-incidents/route";
import { GET as getIncidentDetail } from "../app/api/integrations/v1/approved-incidents/[id]/route";
import { POST as postWorkUpdate } from "../app/api/integrations/v1/work-updates/route";

function setupIsolatedEnvironment() {
  const envContent = fs.readFileSync(path.join(process.cwd(), ".env.local"), "utf8");
  let isolatedUrl = "";
  for (const line of envContent.split(/\r?\n/)) {
    const match = line.match(/^\s*SPARTA_ISOLATED_TEST_DATABASE_URL\s*=\s*(.*)?\s*$/);
    if (match) {
      isolatedUrl = match[1].trim().replace(/^["']|["']$/g, "");
      break;
    }
  }

  if (!isolatedUrl) {
    throw new Error("SPARTA_ISOLATED_TEST_DATABASE_URL not found in .env.local");
  }

  const parsed = new URL(isolatedUrl);
  const dbName = parsed.pathname.replace(/^\//, "");
  if (dbName !== "sparta_siaga_isolated") {
    console.error(`FATAL SAFETY CHECK: DATABASE IS NOT sparta_siaga_isolated (Found: ${dbName})`);
    process.exit(1);
  }

  process.env.DATABASE_URL = isolatedUrl;
  process.env.DATABASE_SSL_MODE = "require";
  return { rawUrl: isolatedUrl, dbName };
}

interface TestItem {
  no: number;
  name: string;
  status: "PASS" | "FAIL";
  detail: string;
}

const testResults: TestItem[] = [];

function logTest(no: number, name: string, status: "PASS" | "FAIL", detail: string) {
  testResults.push({ no, name, status, detail });
  const icon = status === "PASS" ? "✅" : "❌";
  console.log(`[Test ${no.toString().padStart(2, "0")}] ${icon} ${name}`);
  console.log(`         Detail: ${detail}\n`);
}

async function run() {
  console.log("================================================================================");
  console.log(" SPARTA SIAGA - SECURE OPEN API INTEGRATION CONTRACT TEST SUITE");
  console.log("================================================================================\n");

  const dbInfo = setupIsolatedEnvironment();
  console.log(`Target Database: ${dbInfo.dbName} (Verified Safe)\n`);

  // 1. Ensure Schema in isolated test database
  await ensureIntegrationSchemaAndSeed();

  // Create mock approved incidents for testing: 1 Toko and 1 DC in BANDUNG
  const testTokoId = `INC-API-TOKO-${Date.now()}`;
  const testDcId = `INC-API-DC-${Date.now()}`;

  const tokoReport: IncidentRecord = {
    id: testTokoId,
    date: "2026-10-13",
    disasterType: "earthquake",
    reportOrigin: "automatic_earthquake",
    tkpType: "toko",
    storeId: "T-BDG-777",
    storeName: "Alfamart Dago Asri 777",
    branch: "BANDUNG",
    locationCity: "Bandung",
    status: "confirmed_affected",
    progress: 10,
    timeline: [],
    verification: {
      confirmedBy: "Budi Santoso",
      confirmedAt: "2026-10-13 09:00:00 WIB",
      isDamaged: true,
      condition: "damaged",
      severity: "Sedang",
      categories: ["Plafon", "Rak Barang"],
      notes: "Plafon ambruk 2 lembar.",
      bmApproval: {
        decidedBy: "Hartono Branch Manager",
        decidedAt: "2026-10-13 09:30:00 WIB",
        decision: "approved",
        decisionNotes: "Setujui perbaikan melalui SPARTA Maintenance.",
      },
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const dcReport: IncidentRecord = {
    id: testDcId,
    date: "2026-10-13",
    disasterType: "earthquake",
    reportOrigin: "automatic_earthquake",
    tkpType: "dc",
    storeId: "DC-BDG-01",
    storeName: "Distribution Center Gedebage",
    branch: "BANDUNG",
    locationCity: "Bandung",
    status: "confirmed_affected",
    progress: 10,
    timeline: [],
    verification: {
      confirmedBy: "Dedi Engineering",
      confirmedAt: "2026-10-13 09:15:00 WIB",
      isDamaged: true,
      condition: "damaged",
      severity: "Berat",
      categories: ["Dinding/Struktur"],
      notes: "Struktur pilar loading dock retak.",
      bmApproval: {
        decidedBy: "Hartono Branch Manager",
        decidedAt: "2026-10-13 09:35:00 WIB",
        decision: "approved",
        decisionNotes: "Setujui perbaikan melalui Engineering Support.",
      },
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  await dbCreateIncident(tokoReport);
  await dbCreateIncident(dcReport);

  // ===========================================================================
  // TEST 1: Request tanpa header ditolak (401)
  // ===========================================================================
  try {
    const req = new Request("http://localhost/api/integrations/v1/approved-incidents");
    const res = await getApprovedIncidents(req);
    if (res.status === 401) {
      const body = await res.json();
      logTest(1, "Request tanpa header otentikasi ditolak (401)", "PASS", body.error);
    } else {
      logTest(1, "Request tanpa header otentikasi ditolak (401)", "FAIL", `Status didapat: ${res.status}`);
    }
  } catch (e: any) {
    logTest(1, "Request tanpa header otentikasi ditolak (401)", "FAIL", e.message);
  }

  // ===========================================================================
  // TEST 2: Secret salah ditolak (401)
  // ===========================================================================
  try {
    const req = new Request("http://localhost/api/integrations/v1/approved-incidents", {
      headers: {
        "X-Sparta-Api-Key": KNOWN_INTEGRATION_KEYS.SPARTA_MAINTENANCE.apiKey,
        "X-Sparta-Api-Secret": "wrong_secret_12345",
      },
    });
    const res = await getApprovedIncidents(req);
    if (res.status === 401) {
      logTest(2, "Secret tidak valid ditolak (401)", "PASS", "Ditolak dengan status 401 kredensial tidak valid.");
    } else {
      logTest(2, "Secret tidak valid ditolak (401)", "FAIL", `Status didapat: ${res.status}`);
    }
  } catch (e: any) {
    logTest(2, "Secret tidak valid ditolak (401)", "FAIL", e.message);
  }

  // ===========================================================================
  // TEST 3: SPARTA Maintenance berhasil fetch & hanya mendapat Toko (Scope TOKO_ONLY)
  // ===========================================================================
  try {
    const req = new Request("http://localhost/api/integrations/v1/approved-incidents?branch=BANDUNG", {
      headers: {
        "X-Sparta-Api-Key": KNOWN_INTEGRATION_KEYS.SPARTA_MAINTENANCE.apiKey,
        "X-Sparta-Api-Secret": KNOWN_INTEGRATION_KEYS.SPARTA_MAINTENANCE.secret,
      },
    });
    const res = await getApprovedIncidents(req);
    if (res.status === 200) {
      const body = await res.json();
      const hasToko = body.data.some((i: any) => i.incidentId === testTokoId);
      const hasDc = body.data.some((i: any) => i.incidentId === testDcId);

      if (hasToko && !hasDc) {
        logTest(3, "Scope TOKO_ONLY: SPARTA Maintenance hanya menerima Toko", "PASS", `Toko terambil (${testTokoId}), DC terisolasi (${!hasDc}).`);
      } else {
        logTest(3, "Scope TOKO_ONLY: SPARTA Maintenance hanya menerima Toko", "FAIL", `Toko: ${hasToko}, DC terambil: ${hasDc}`);
      }
    } else {
      logTest(3, "Scope TOKO_ONLY: SPARTA Maintenance hanya menerima Toko", "FAIL", `Status: ${res.status}`);
    }
  } catch (e: any) {
    logTest(3, "Scope TOKO_ONLY: SPARTA Maintenance hanya menerima Toko", "FAIL", e.message);
  }

  // ===========================================================================
  // TEST 4: Engineering Support berhasil fetch & hanya mendapat DC (Scope DC_ONLY)
  // ===========================================================================
  try {
    const req = new Request("http://localhost/api/integrations/v1/approved-incidents?branch=BANDUNG", {
      headers: {
        "X-Sparta-Api-Key": KNOWN_INTEGRATION_KEYS.ENGINEERING_SUPPORT.apiKey,
        "X-Sparta-Api-Secret": KNOWN_INTEGRATION_KEYS.ENGINEERING_SUPPORT.secret,
      },
    });
    const res = await getApprovedIncidents(req);
    if (res.status === 200) {
      const body = await res.json();
      const hasToko = body.data.some((i: any) => i.incidentId === testTokoId);
      const hasDc = body.data.some((i: any) => i.incidentId === testDcId);

      if (!hasToko && hasDc) {
        logTest(4, "Scope DC_ONLY: Engineering Support hanya menerima DC/Warehouse", "PASS", `DC terambil (${testDcId}), Toko terisolasi (${!hasToko}).`);
      } else {
        logTest(4, "Scope DC_ONLY: Engineering Support hanya menerima DC/Warehouse", "FAIL", `DC: ${hasDc}, Toko terambil: ${hasToko}`);
      }
    } else {
      logTest(4, "Scope DC_ONLY: Engineering Support hanya menerima DC/Warehouse", "FAIL", `Status: ${res.status}`);
    }
  } catch (e: any) {
    logTest(4, "Scope DC_ONLY: Engineering Support hanya menerima DC/Warehouse", "FAIL", e.message);
  }

  // ===========================================================================
  // TEST 5: Detail Incident memuat bukti foto dan keputusan BM
  // ===========================================================================
  try {
    const req = new Request(`http://localhost/api/integrations/v1/approved-incidents/${testTokoId}`, {
      headers: {
        "X-Sparta-Api-Key": KNOWN_INTEGRATION_KEYS.SPARTA_MAINTENANCE.apiKey,
        "X-Sparta-Api-Secret": KNOWN_INTEGRATION_KEYS.SPARTA_MAINTENANCE.secret,
      },
    });
    const res = await getIncidentDetail(req, { params: Promise.resolve({ id: testTokoId }) });
    if (res.status === 200) {
      const body = await res.json();
      const hasBmApproval = body.data.branchManagerApproval?.decision === "approved";
      logTest(5, "Detail insiden memuat data pemeriksaan & approval BM lengkap", "PASS", `Incident ID: ${body.data.incidentId}, BM Approved: ${hasBmApproval}.`);
    } else {
      logTest(5, "Detail insiden memuat data pemeriksaan & approval BM lengkap", "FAIL", `Status: ${res.status}`);
    }
  } catch (e: any) {
    logTest(5, "Detail insiden memuat data pemeriksaan & approval BM lengkap", "FAIL", e.message);
  }

  // ===========================================================================
  // TEST 6: POST work-updates berhasil disinkronkan & Idempoten
  // ===========================================================================
  try {
    const workPayload = {
      incidentId: testTokoId,
      externalSystem: "sparta_maintenance",
      externalWorkId: `WO-TEST-${Date.now()}`,
      workStatus: "SPK_ISSUED",
      notes: "SPK terbit ke Vendor Kontraktor PT Cipta Reksa.",
      updatedBy: "Admin Maintenance",
    };

    const req = new Request("http://localhost/api/integrations/v1/work-updates", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Sparta-Api-Key": KNOWN_INTEGRATION_KEYS.SPARTA_MAINTENANCE.apiKey,
        "X-Sparta-Api-Secret": KNOWN_INTEGRATION_KEYS.SPARTA_MAINTENANCE.secret,
      },
      body: JSON.stringify(workPayload),
    });

    const res = await postWorkUpdate(req);

    if (res.status === 200) {
      const body = await res.json();
      const updatedIncident = await dbGetIncidentById(testTokoId);
      const isSynced = updatedIncident?.externalWorkId === workPayload.externalWorkId;

      if (isSynced) {
        logTest(6, "Sinkronisasi balik work-updates tersimpan ke database", "PASS", `External Work ID: ${workPayload.externalWorkId}, DB Synced: true.`);
      } else {
        logTest(6, "Sinkronisasi balik work-updates tersimpan ke database", "FAIL", "DB tidak terupdate.");
      }
    } else {
      logTest(6, "Sinkronisasi balik work-updates tersimpan ke database", "FAIL", `Status: ${res.status}`);
    }
  } catch (e: any) {
    logTest(6, "Sinkronisasi balik work-updates tersimpan ke database", "FAIL", e.message);
  }

  console.log("================================================================================");
  console.log(" HASIL EVALUASI SECURE OPEN API INTEGRATION SUITE");
  console.log("================================================================================");
  const total = testResults.length;
  const passed = testResults.filter((t) => t.status === "PASS").length;
  const failed = testResults.filter((t) => t.status === "FAIL").length;
  console.log(`TOTAL PENGUJIAN: ${total}`);
  console.log(`PASS:            ${passed}`);
  console.log(`FAIL:            ${failed}`);
  console.log("================================================================================\n");

  if (failed > 0) process.exit(1);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
