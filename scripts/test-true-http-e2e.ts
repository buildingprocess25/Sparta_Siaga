/**
 * SPARTA SIAGA - TRUE HTTP END-TO-END TEST SUITE
 * 
 * Runs Next.js HTTP Server against sparta_siaga_isolated on dedicated test port 3005.
 * Executes all 14 scenarios via real HTTP socket requests with valid JWT cookies.
 * 
 * STRICT SAFETY:
 * - Operates ONLY on sparta_siaga_isolated.
 * - defaultdb is strictly untouched.
 */

import { spawn, ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { Pool } from "pg";
import sharp from "sharp";
import { signSession } from "../lib/jwt";
import { dbUpsertUser } from "../lib/user-db";
import { dbCreateIncident, dbGetIncidentById } from "../lib/incident-db";

// =============================================================================
// 1. ISOLATED ENVIRONMENT SETUP & SAFETY GUARD
// =============================================================================
function getIsolatedDbUrl(): string {
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

  return isolatedUrl;
}

const ISOLATED_URL = getIsolatedDbUrl();
const TEST_PORT = 3005;
const BASE_URL = `http://127.0.0.1:${TEST_PORT}`;
const WORKER_SECRET = "sparta_siaga_internal_worker_secret_key_32_chars_long_123";

process.env.DATABASE_URL = ISOLATED_URL;
process.env.DATABASE_SSL_MODE = "require";
process.env.SPARTA_INTERNAL_WORKER_SECRET = WORKER_SECRET;

interface TestResult {
  no: number;
  name: string;
  status: "PASS" | "FAIL";
  evidence: string;
}

const results: TestResult[] = [];

function record(no: number, name: string, pass: boolean, evidence: string) {
  const status = pass ? "PASS" : "FAIL";
  results.push({ no, name, status, evidence });
  const icon = pass ? "✅" : "❌";
  console.log(`${icon} [${status}] Skenario ${no.toString().padStart(2, "0")}: ${name}`);
  console.log(`        Bukti: ${evidence}\n`);
}

async function createSampleJpegBlob(): Promise<Blob> {
  const buf = await sharp({
    create: {
      width: 100,
      height: 100,
      channels: 3,
      background: { r: 200, g: 50, b: 50 },
    },
  })
    .jpeg()
    .toBuffer();
  return new Blob([new Uint8Array(buf)], { type: "image/jpeg" });
}

function createSamplePdfBlob(): Blob {
  const buf = Buffer.from("%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< >>\n%%EOF\n", "utf-8");
  return new Blob([new Uint8Array(buf)], { type: "application/pdf" });
}

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// =============================================================================
// MAIN E2E EXECUTION
// =============================================================================
async function runTrueHttpSuite() {
  console.log("================================================================================");
  console.log(" SPARTA SIAGA - TRUE HTTP END-TO-END VERIFICATION SUITE");
  console.log(" Target Database : sparta_siaga_isolated");
  console.log(` HTTP Wire Port   : ${TEST_PORT} (${BASE_URL})`);
  console.log(" Safety Guard     : defaultdb STRICTLY UNTOUCHED");
  console.log("================================================================================\n");

  const cleanConn = ISOLATED_URL.replace(/\?sslmode=[^&]+/, "");
  const pool = new Pool({
    connectionString: cleanConn,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 10000,
  });

  const client = await pool.connect();
  const dbCheck = await client.query("SELECT current_database() as db");
  client.release();

  if (dbCheck.rows[0].db !== "sparta_siaga_isolated") {
    throw new Error(`CRITICAL: Connected to wrong database ${dbCheck.rows[0].db}`);
  }
  console.log(`[Safety Guard] Active database verified: ${dbCheck.rows[0].db}\n`);

  // 1. Ensure migrations 001, 002, 003 on isolated DB
  for (const mig of ["001_earthquake_events.sql", "002_report_fields_update.sql", "003_milestone_progression.sql"]) {
    const migPath = path.join(process.cwd(), "database", "migrations", mig);
    if (fs.existsSync(migPath)) {
      const sql = fs.readFileSync(migPath, "utf8");
      await pool.query(sql);
    }
  }

  // 2. Provision test actors in sparta_siaga_isolated
  console.log("[Setup] Provisioning test actors in sparta_siaga_isolated...");
  await dbUpsertUser({
    id: "usr_http_bms_bdg",
    nik: "BMS_BDG_01",
    name: "Asep BMS Bandung",
    systemRole: "USER",
    businessRole: "bms",
    scope: "BRANCH",
    branch: "BANDUNG",
    status: "ACTIVE",
  });

  await dbUpsertUser({
    id: "usr_http_bms_crb",
    nik: "BMS_CRB_01",
    name: "Dedi BMS Cirebon",
    systemRole: "USER",
    businessRole: "bms",
    scope: "BRANCH",
    branch: "CIREBON",
    status: "ACTIVE",
  });

  await dbUpsertUser({
    id: "usr_http_bm_bdg",
    nik: "BM_BDG_01",
    name: "Hendro BM Bandung",
    systemRole: "USER",
    businessRole: "bm",
    scope: "BRANCH",
    branch: "BANDUNG",
    status: "ACTIVE",
  });

  await dbUpsertUser({
    id: "usr_http_bm_crb",
    nik: "BM_CRB_01",
    name: "Bambang BM Cirebon",
    systemRole: "USER",
    businessRole: "bm",
    scope: "BRANCH",
    branch: "CIREBON",
    status: "ACTIVE",
  });

  await dbUpsertUser({
    id: "usr_http_ho_adm",
    nik: "HO_ADM_01",
    name: "Citra HO Administrator",
    systemRole: "USER",
    businessRole: "ho_admin",
    scope: "HO",
    branch: null,
    status: "ACTIVE",
  });

  await dbUpsertUser({
    id: "usr_http_sys_adm",
    nik: "SYS_ADM_01",
    name: "Root System Admin",
    systemRole: "ADMIN",
    businessRole: null,
    scope: null,
    branch: null,
    status: "ACTIVE",
  });

  await dbUpsertUser({
    id: "usr_http_toko_bdg",
    nik: "TK_BDG_01",
    name: "Kasir Toko Dago",
    systemRole: "USER",
    businessRole: "tim_toko",
    scope: "BRANCH",
    branch: "BANDUNG",
    status: "ACTIVE",
  });

  // 3. Generate signed session tokens
  const tokenBmsBdg = await signSession({ id: "usr_http_bms_bdg", nik: "BMS_BDG_01", systemRole: "USER" });
  const tokenBmsCrb = await signSession({ id: "usr_http_bms_crb", nik: "BMS_CRB_01", systemRole: "USER" });
  const tokenBmBdg = await signSession({ id: "usr_http_bm_bdg", nik: "BM_BDG_01", systemRole: "USER" });
  const tokenBmCrb = await signSession({ id: "usr_http_bm_crb", nik: "BM_CRB_01", systemRole: "USER" });
  const tokenHo = await signSession({ id: "usr_http_ho_adm", nik: "HO_ADM_01", systemRole: "USER" });
  const tokenSysAdmin = await signSession({ id: "usr_http_sys_adm", nik: "SYS_ADM_01", systemRole: "ADMIN" });
  const tokenToko = await signSession({ id: "usr_http_toko_bdg", nik: "TK_BDG_01", systemRole: "USER" });

  // 4. Create primary test incidents in sparta_siaga_isolated
  const reportBdgId = `INC-HTTP-BDG-${Date.now()}`;
  const reportCrbId = `INC-HTTP-CRB-${Date.now()}`;
  const now = new Date().toISOString();

  await dbCreateIncident({
    id: reportBdgId,
    date: "13 Okt 2026",
    disasterType: "earthquake",
    reportOrigin: "automatic_earthquake",
    tkpType: "toko",
    storeId: "T-BDG-001",
    storeName: "Alfamart Dago Plaza",
    branch: "BANDUNG",
    locationCity: "Kota Bandung",
    status: "pending_confirmation",
    progress: 0,
    fieldPhotos: [],
    verification: undefined,
    createdAt: now,
    updatedAt: now,
    timeline: [{ stage: "Laporan Dibuat", label: "Gempa Otomatis Terdeteksi", timestamp: now, actor: "Sistem Otomasi" }],
  });

  await dbCreateIncident({
    id: reportCrbId,
    date: "13 Okt 2026",
    disasterType: "earthquake",
    reportOrigin: "automatic_earthquake",
    tkpType: "toko",
    storeId: "T-CRB-001",
    storeName: "Alfamart Kejaksan Cirebon",
    branch: "CIREBON",
    locationCity: "Kota Cirebon",
    status: "pending_confirmation",
    progress: 0,
    fieldPhotos: [],
    verification: undefined,
    createdAt: now,
    updatedAt: now,
    timeline: [{ stage: "Laporan Dibuat", label: "Gempa Otomatis Terdeteksi", timestamp: now, actor: "Sistem Otomasi" }],
  });

  // 5. Start dedicated Next.js HTTP server on test port 3005
  console.log(`[HTTP Server] Starting Next.js server on port ${TEST_PORT} against sparta_siaga_isolated...`);
  
  const serverEnv: NodeJS.ProcessEnv = {
    ...process.env,
    PORT: String(TEST_PORT),
    DATABASE_URL: ISOLATED_URL,
    DATABASE_SSL_MODE: "require",
    NODE_ENV: "test",
    SPARTA_API_URL: "https://localhost:10000",
    SPARTA_LOGIN_URL: "https://localhost:5173",
    APP_BASE_URL: "https://localhost:3005",
    NEXT_PUBLIC_APP_URL: "https://localhost:3005",
    JWT_SECRET: "sparta_siaga_super_secret_jwt_key_32_chars_long_123",
    PRIVATE_STORAGE_ROOT: path.join(process.cwd(), "storage"),
    SPARTA_INTERNAL_WORKER_SECRET: WORKER_SECRET,
    SPARTA_ALLOW_TEST_SIMULATION: "true",
  };

  const nextBin = process.platform === "win32"
    ? path.join(process.cwd(), "node_modules", ".bin", "next.cmd")
    : path.join(process.cwd(), "node_modules", ".bin", "next");

  const nextProcess: ChildProcess = spawn(
    nextBin,
    ["start", "-p", String(TEST_PORT)],
    {
      cwd: process.cwd(),
      env: serverEnv,
      shell: true,
      stdio: ["ignore", "pipe", "pipe"],
    }
  );

  let serverStarted = false;
  nextProcess.stdout?.on("data", (data) => {
    const text = data.toString();
    if (text.includes("Ready in") || text.includes("started server on") || text.includes(`:${TEST_PORT}`)) {
      serverStarted = true;
    }
  });

  nextProcess.stderr?.on("data", (data) => {
    console.error("[SERVER_STDERR]", data.toString());
  });

  // Wait for server health
  console.log("[HTTP Server] Waiting for server socket to become live...");
  let attempts = 0;
  while (attempts < 20) {
    try {
      const hRes = await fetch(`${BASE_URL}/api/health/live`);
      if (hRes.ok) {
        serverStarted = true;
        break;
      }
    } catch {
      // waiting
    }
    await sleep(1000);
    attempts++;
  }

  if (!serverStarted) {
    nextProcess.kill();
    throw new Error(`Failed to start Next.js server on port ${TEST_PORT} after 20 seconds`);
  }
  console.log(`[HTTP Server] Connected and verified live at ${BASE_URL}!\n`);

  try {
    // =========================================================================
    // SCENARIO 01: BMS Bandung membaca daftar laporan sesuai cabangnya via HTTP
    // =========================================================================
    {
      const res = await fetch(`${BASE_URL}/api/incidents`, {
        headers: { Cookie: `siaga_session=${tokenBmsBdg}` },
      });
      const json = await res.json();
      const list = json.data || [];
      const hasBdg = list.some((i: any) => i.id === reportBdgId);
      const hasCrb = list.some((i: any) => i.id === reportCrbId);

      record(
        1,
        "BMS Bandung membaca laporan cabang sendiri via HTTP",
        res.status === 200 && hasBdg && !hasCrb,
        `Status ${res.status}, Bandung report present: ${hasBdg}, Cirebon filtered out: ${!hasCrb}`
      );
    }

    // =========================================================================
    // SCENARIO 02: BMS Cirebon membaca daftar laporan sesuai cabangnya via HTTP
    // =========================================================================
    {
      const res = await fetch(`${BASE_URL}/api/incidents`, {
        headers: { Cookie: `siaga_session=${tokenBmsCrb}` },
      });
      const json = await res.json();
      const list = json.data || [];
      const hasBdg = list.some((i: any) => i.id === reportBdgId);
      const hasCrb = list.some((i: any) => i.id === reportCrbId);

      record(
        2,
        "BMS Cirebon membaca laporan cabang sendiri via HTTP",
        res.status === 200 && hasCrb && !hasBdg,
        `Status ${res.status}, Cirebon report present: ${hasCrb}, Bandung filtered out: ${!hasBdg}`
      );
    }

    // =========================================================================
    // SCENARIO 03: Penolakan akses detail laporan lintas cabang (403 Forbidden)
    // =========================================================================
    {
      const res = await fetch(`${BASE_URL}/api/incidents/${reportBdgId}`, {
        headers: { Cookie: `siaga_session=${tokenBmsCrb}` },
      });
      const json = await res.json();

      record(
        3,
        "BMS Cirebon ditolak saat mengakses laporan Bandung via HTTP",
        res.status === 403,
        `Status ${res.status} (Forbidden), Error: "${json.error || ""}"`
      );
    }

    // =========================================================================
    // SCENARIO 04: BMS Bandung mengirim pemeriksaan fisik via HTTP multipart
    // =========================================================================
    let uploadedPhotoId = "";
    {
      const formData = new FormData();
      formData.append("condition", "damaged");
      formData.append("severity", "Sedang");
      formData.append("notes", "Plafon depan runtuh 2 meter akibat gempa.");
      formData.append("inspection_method", "inspeksi_langsung");
      formData.append("source_category", "bms");
      formData.append("reporter_name", "Asep BMS");
      
      const blob = await createSampleJpegBlob();
      formData.append("photo", blob, "foto_kerusakan_dago.jpg");

      const res = await fetch(`${BASE_URL}/api/incidents/${reportBdgId}/confirm`, {
        method: "POST",
        headers: { Cookie: `siaga_session=${tokenBmsBdg}` },
        body: formData,
      });

      const resJson = await res.json().catch(() => ({}));
      const reportAfter = await dbGetIncidentById(reportBdgId);
      const photos = (reportAfter?.fieldPhotos && reportAfter.fieldPhotos.length > 0)
        ? reportAfter.fieldPhotos
        : (reportAfter?.verification?.photos || resJson.data?.photos || []);
      uploadedPhotoId = photos.length > 0 ? photos[0] : "";

      const pass =
        res.status === 200 &&
        reportAfter?.status === "pending_bm_approval" &&
        reportAfter?.progress === 0 &&
        Boolean(uploadedPhotoId);

      record(
        4,
        "BMS Bandung mengirim pemeriksaan via HTTP multipart",
        pass,
        `Status HTTP ${res.status}, Inc Status: '${reportAfter?.status}', Progress: ${reportAfter?.progress}%, Photo ID: ${uploadedPhotoId}`
      );
    }

    // =========================================================================
    // SCENARIO 05: Evidence photo retrieval & cross-branch protection
    // =========================================================================
    {
      const photoName = uploadedPhotoId.includes("/")
        ? uploadedPhotoId.split("/").pop()
        : uploadedPhotoId;

      // Authorized access by BMS Bandung
      const authRes = await fetch(
        `${BASE_URL}/api/incidents/${reportBdgId}/inspection/evidence/${photoName}`,
        { headers: { Cookie: `siaga_session=${tokenBmsBdg}` } }
      );

      // Unauthorized cross-branch access by BMS Cirebon
      const crossRes = await fetch(
        `${BASE_URL}/api/incidents/${reportBdgId}/inspection/evidence/${photoName}`,
        { headers: { Cookie: `siaga_session=${tokenBmsCrb}` } }
      );

      // Unauthenticated access
      const unauthRes = await fetch(
        `${BASE_URL}/api/incidents/${reportBdgId}/inspection/evidence/${photoName}`
      );

      const pass =
        authRes.status === 200 &&
        crossRes.status === 403 &&
        unauthRes.status === 401;

      record(
        5,
        "Pengambilan bukti foto terproteksi sesi & isolasi cabang via HTTP",
        pass,
        `BMS Bandung: ${authRes.status} (${authRes.headers.get("content-type")}), BMS Cirebon: ${crossRes.status} (403), Anon: ${unauthRes.status} (401)`
      );
    }

    // =========================================================================
    // SCENARIO 06: BM Bandung memberikan Approval Awal via HTTP
    // =========================================================================
    {
      // BM Cirebon trying to approve Bandung report -> 403
      const crossBmRes = await fetch(`${BASE_URL}/api/incidents/${reportBdgId}/approval`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: `siaga_session=${tokenBmCrb}`,
        },
        body: JSON.stringify({ decision: "approved", notes: "Mencoba approval lintas cabang" }),
      });

      // BM Bandung approves Bandung report -> 200
      const bmRes = await fetch(`${BASE_URL}/api/incidents/${reportBdgId}/approval`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: `siaga_session=${tokenBmBdg}`,
        },
        body: JSON.stringify({ decision: "approved", notes: "Kerusakan terkonfirmasi sah oleh Branch Manager Bandung" }),
      });

      const reportAfter = await dbGetIncidentById(reportBdgId);
      const pass =
        crossBmRes.status === 403 &&
        bmRes.status === 200 &&
        reportAfter?.status === "confirmed_affected" &&
        reportAfter?.progress === 0;

      record(
        6,
        "BM Bandung memberikan Approval Awal via HTTP",
        pass,
        `BM Cirebon: ${crossBmRes.status} (403), BM Bandung: ${bmRes.status} (200), Status Akhir: '${reportAfter?.status}', Progress: ${reportAfter?.progress}%`
      );
    }

    // =========================================================================
    // SCENARIO 07: Milestone Ceklis (10%) via HTTP multipart
    // =========================================================================
    {
      const formData = new FormData();
      formData.append("stage_key", "CEKLIS");
      formData.append("notes", "Pemeriksaan ceklis fisik telah selesai.");
      const blob = createSamplePdfBlob();
      formData.append("file", blob, "ceklis_toko.pdf");

      const res = await fetch(`${BASE_URL}/api/incidents/${reportBdgId}/milestones`, {
        method: "POST",
        headers: { Cookie: `siaga_session=${tokenBmsBdg}` },
        body: formData,
      });

      const reportAfter = await dbGetIncidentById(reportBdgId);
      const pass = res.status === 200 && reportAfter?.progress === 10;

      record(
        7,
        "Milestone Ceklis 10% diselesaikan via HTTP",
        pass,
        `Status HTTP: ${res.status}, Progres Bertambah Tepat: ${reportAfter?.progress}%`
      );
    }

    // =========================================================================
    // SCENARIO 08: Milestone Estimasi (25%) via HTTP multipart
    // =========================================================================
    {
      const formData = new FormData();
      formData.append("stage_key", "ESTIMASI");
      formData.append("notes", "Rincian estimasi biaya material & jasa perbaikan plafon.");
      const blob = createSamplePdfBlob();
      formData.append("file", blob, "estimasi_biaya.pdf");

      const res = await fetch(`${BASE_URL}/api/incidents/${reportBdgId}/milestones`, {
        method: "POST",
        headers: { Cookie: `siaga_session=${tokenBmsBdg}` },
        body: formData,
      });

      const reportAfter = await dbGetIncidentById(reportBdgId);
      const pass = res.status === 200 && reportAfter?.progress === 25;

      record(
        8,
        "Milestone Estimasi 25% diselesaikan via HTTP",
        pass,
        `Status HTTP: ${res.status}, Progres Bertambah Tepat: ${reportAfter?.progress}%`
      );
    }

    // =========================================================================
    // SCENARIO 09: Approve Proxy (30%) & SPK (50%) Berurutan via HTTP
    // =========================================================================
    {
      // 1. Submit Approve Proxy with external approval proof document
      const proxyForm = new FormData();
      proxyForm.append("stage_key", "APPROVE_PROXY");
      proxyForm.append("notes", "Upload bukti persetujuan eksternal.");
      const blob = createSamplePdfBlob();
      proxyForm.append("file", blob, "bukti_persetujuan_eksternal.pdf");

      const proxyRes = await fetch(`${BASE_URL}/api/incidents/${reportBdgId}/milestones`, {
        method: "POST",
        headers: { Cookie: `siaga_session=${tokenBmsBdg}` },
        body: proxyForm,
      });

      const reportAfterProxy = await dbGetIncidentById(reportBdgId);

      // 2. Normal sequential submission of SPK 50%
      const spkForm = new FormData();
      spkForm.append("stage_key", "SPK");
      spkForm.append("notes", "Penerbitan SPK Rekanan pasca persetujuan eksternal.");
      spkForm.append("file", blob, "spk_resmi.pdf");

      const spkRes = await fetch(`${BASE_URL}/api/incidents/${reportBdgId}/milestones`, {
        method: "POST",
        headers: { Cookie: `siaga_session=${tokenBmsBdg}` },
        body: spkForm,
      });

      const reportAfterSpk = await dbGetIncidentById(reportBdgId);

      const pass =
        proxyRes.status === 200 &&
        reportAfterProxy?.progress === 30 &&
        spkRes.status === 200 &&
        reportAfterSpk?.progress === 50;

      record(
        9,
        "Approve Proxy 30% upload bukti eksternal & SPK 50% berurutan via HTTP",
        pass,
        `Proxy Submit: ${proxyRes.status} (Progress: ${reportAfterProxy?.progress}%), SPK Submit: ${spkRes.status} (Progress: ${reportAfterSpk?.progress}%)`
      );
    }

    // =========================================================================
    // SCENARIO 10: Serah Terima (100%) via HTTP multipart
    // =========================================================================
    {
      const blob = createSamplePdfBlob();

      // Submit SERAH TERIMA
      const stForm = new FormData();
      stForm.append("stage_key", "SERAH_TERIMA");
      stForm.append("notes", "Berita Acara Serah Terima Pekerjaan 100% Selesai.");
      stForm.append("file", blob, "bast_100.pdf");

      const stRes = await fetch(`${BASE_URL}/api/incidents/${reportBdgId}/milestones`, {
        method: "POST",
        headers: {
          Cookie: `siaga_session=${tokenBmsBdg}`,
        },
        body: stForm,
      });

      const reportAfter = await dbGetIncidentById(reportBdgId);
      const pass =
        stRes.status === 200 &&
        reportAfter?.progress === 100 &&
        reportAfter?.status === "awaiting_st";

      record(
        10,
        "Serah Terima 100% via HTTP (Menunggu BM, BUKAN otomatis CLOSED)",
        pass,
        `BAST Status: ${stRes.status}, Progress: ${reportAfter?.progress}%, Status Laporan: '${reportAfter?.status}'`
      );
    }

    // =========================================================================
    // SCENARIO 11: BM Final Approval mengubah status menjadi CLOSED via HTTP
    // =========================================================================
    {
      // BMS cannot do final approval -> 403
      const bmsCloseRes = await fetch(`${BASE_URL}/api/incidents/${reportBdgId}/close`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: `siaga_session=${tokenBmsBdg}`,
        },
        body: JSON.stringify({ resolutionNotes: "BMS mencoba close sendiri" }),
      });

      // BM Bandung approves final closure -> 200
      const bmCloseRes = await fetch(`${BASE_URL}/api/incidents/${reportBdgId}/close`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: `siaga_session=${tokenBmBdg}`,
        },
        body: JSON.stringify({ resolutionNotes: "Pekerjaan fisik terverifikasi sempurna. Laporan resmi ditutup." }),
      });

      const reportAfter = await dbGetIncidentById(reportBdgId);
      const isClosed = reportAfter?.status === "closed" || reportAfter?.status === "resolved";

      // Verify automatic archive: report appears in /api/incidents/history and is excluded from active /api/incidents
      const histRes = await fetch(`${BASE_URL}/api/incidents/history`, {
        headers: { Cookie: `siaga_session=${tokenBmBdg}` },
      });
      const histJson = await histRes.json().catch(() => ({}));
      const inHistory = (histJson.data || []).some((i: any) => i.id === reportBdgId);

      const activeListRes = await fetch(`${BASE_URL}/api/incidents?status=active`, {
        headers: { Cookie: `siaga_session=${tokenBmBdg}` },
      });
      const activeListJson = await activeListRes.json().catch(() => ({}));
      const notInActive = !(activeListJson.data || []).some((i: any) => i.id === reportBdgId);

      const pass =
        bmsCloseRes.status === 403 &&
        bmCloseRes.status === 200 &&
        isClosed &&
        inHistory &&
        notInActive;

      record(
        11,
        "Persetujuan Final BM mengubah status menjadi CLOSED & otomatis arsip via HTTP",
        pass,
        `BMS Close: ${bmsCloseRes.status} (403), BM Bandung Close: ${bmCloseRes.status} (200), Status Akhir: '${reportAfter?.status}', Ada di Riwayat: ${inHistory}, Hilang dari Aktif: ${notInActive}`
      );
    }

    // =========================================================================
    // SCENARIO 12: Pengambilan PDF Laporan Awal & Final via HTTP
    // =========================================================================
    {
      // 1. Initial PDF by BMS Bandung
      const initPdfRes = await fetch(`${BASE_URL}/api/incidents/${reportBdgId}/export/initial-pdf`, {
        headers: { Cookie: `siaga_session=${tokenBmsBdg}` },
      });
      const initPdfBuf = Buffer.from(await initPdfRes.arrayBuffer());
      const initMagic = initPdfBuf.subarray(0, 8).toString("utf-8");

      // 2. Final PDF by BMS Bandung
      const finalPdfRes = await fetch(`${BASE_URL}/api/incidents/${reportBdgId}/export/final-pdf`, {
        headers: { Cookie: `siaga_session=${tokenBmsBdg}` },
      });
      const finalPdfBuf = Buffer.from(await finalPdfRes.arrayBuffer());
      const finalMagic = finalPdfBuf.subarray(0, 8).toString("utf-8");

      // 3. Cross-branch download protection: BMS Cirebon trying to download Bandung Final PDF -> 403
      const crossPdfRes = await fetch(`${BASE_URL}/api/incidents/${reportBdgId}/export/final-pdf`, {
        headers: { Cookie: `siaga_session=${tokenBmsCrb}` },
      });

      const pass =
        initPdfRes.status === 200 &&
        initMagic.startsWith("%PDF-") &&
        finalPdfRes.status === 200 &&
        finalMagic.startsWith("%PDF-") &&
        crossPdfRes.status === 403;

      record(
        12,
        "Pengambilan PDF Awal & Final terproteksi via HTTP",
        pass,
        `Initial PDF: ${initPdfRes.status} (${initPdfBuf.length} B, Magic: ${initMagic.trim()}), Final PDF: ${finalPdfRes.status} (${finalPdfBuf.length} B, Magic: ${finalMagic.trim()}), Cross-Branch: ${crossPdfRes.status} (403)`
      );
    }

    // =========================================================================
    // SCENARIO 13: HO Read-Only & Zero Operational Bypass System Admin via HTTP
    // =========================================================================
    {
      // 1. HO Admin reads all branches
      const hoListRes = await fetch(`${BASE_URL}/api/incidents`, {
        headers: { Cookie: `siaga_session=${tokenHo}` },
      });
      const hoJson = await hoListRes.json();
      const hoList = hoJson.data || [];
      const hoSeesBoth =
        hoList.some((i: any) => i.id === reportBdgId) &&
        hoList.some((i: any) => i.id === reportCrbId);

      // 2. HO Admin attempts operational confirmation -> 403
      const hoMutateRes = await fetch(`${BASE_URL}/api/incidents/${reportBdgId}/confirm`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: `siaga_session=${tokenHo}`,
        },
        body: JSON.stringify({ condition: "damaged" }),
      });

      // 3. System Admin performs initial approval across branches -> 200
      const sysAdminApproveRes = await fetch(`${BASE_URL}/api/incidents/${reportCrbId}/approval`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: `siaga_session=${tokenSysAdmin}`,
        },
        body: JSON.stringify({ decision: "approved" }),
      });

      const pass =
        hoListRes.status === 200 &&
        hoSeesBoth &&
        hoMutateRes.status === 403 &&
        sysAdminApproveRes.status === 200;

      record(
        13,
        "HO Read-Only & Admin Super Administrator Full Access via HTTP",
        pass,
        `HO Sees All: ${hoSeesBoth}, HO Mutasi Lapangan: ${hoMutateRes.status} (403), System Admin Approval: ${sysAdminApproveRes.status} (200)`
      );
    }

    // =========================================================================
    // SCENARIO 14: Tim Toko pelaporan mandiri dinonaktifkan via HTTP
    // =========================================================================
    {
      const res = await fetch(`${BASE_URL}/api/incidents`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: `siaga_session=${tokenToko}`,
        },
        body: JSON.stringify({
          disasterType: "flood",
          tkpType: "toko",
          storeId: "T-BDG-001",
        }),
      });

      const json = await res.json().catch(() => ({}));
      const pass = res.status === 401;

      record(
        14,
        "Tim Toko dinonaktifkan di session auth layer via HTTP",
        pass,
        `Status ${res.status} (401 Unauthorized Session Rejection) - Deactivated role blocked at entry`
      );
    }
  } catch (err: any) {
    console.error("[TEST EXECUTION ERROR IN SCENARIO]", err);
  } finally {
    // Graceful cleanup
    console.log("[Cleanup] Shutting down Next.js test server...");
    if (nextProcess.pid) {
      if (process.platform === "win32") {
        try {
          const { execSync } = await import("node:child_process");
          execSync(`taskkill /pid ${nextProcess.pid} /t /f`, { stdio: "ignore" });
        } catch {}
      } else {
        nextProcess.kill();
      }
    }

    console.log("[Cleanup] Cleaning up test fixtures from sparta_siaga_isolated...");
    await pool.query("DELETE FROM report_milestones WHERE report_id IN ($1, $2)", [reportBdgId, reportCrbId]);
    await pool.query("DELETE FROM incidents WHERE id IN ($1, $2)", [reportBdgId, reportCrbId]);
    await pool.query("DELETE FROM users WHERE id LIKE 'usr_http_%'");
    await pool.end();
    console.log("[Cleanup] Cleanup complete. defaultdb remains 100% untouched.");
  }

  // Summary
  const passedCount = results.filter((r) => r.status === "PASS").length;
  console.log("\n================================================================================");
  console.log(" REKAPITULASI HASIL TRUE HTTP END-TO-END TEST");
  console.log("================================================================================");
  console.log(`TOTAL SKENARIO: ${results.length}`);
  console.log(`LULUS (PASS)  : ${passedCount}`);
  console.log(`GAGAL (FAIL)  : ${results.length - passedCount}`);
  console.log("================================================================================\n");

  if (passedCount !== results.length) {
    process.exitCode = 1;
  }
}

runTrueHttpSuite().catch((err) => {
  console.error("FATAL ERROR IN TRUE HTTP E2E SUITE:", err);
  process.exit(1);
});
