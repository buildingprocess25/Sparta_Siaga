/**
 * SPARTA SIAGA - Role Access & DC Search Regression Test Suite
 * 
 * Verifies strict server-side role separation, facility search scoping,
 * unmapped facility diagnostics, and incident mutation guards.
 * 
 * Target: sparta_siaga_isolated ONLY. defaultdb is 100% UNTOUCHED.
 */

import fs from "node:fs";
import path from "node:path";
import { Pool } from "pg";
import { signSession } from "../lib/jwt";
import { dbUpsertUser } from "../lib/user-db";

import { getDbPool, closeDbPool } from "../lib/db";

function verifyIsolatedTarget(): string {
  const envContent = fs.readFileSync(path.join(process.cwd(), ".env.local"), "utf8");
  let url = "";
  for (const line of envContent.split(/\r?\n/)) {
    const match = line.match(/^\s*SPARTA_ISOLATED_TEST_DATABASE_URL\s*=\s*(.*)?\s*$/);
    if (match) {
      url = match[1].trim().replace(/^["']|["']$/g, "");
      break;
    }
  }
  if (!url || new URL(url).pathname !== "/sparta_siaga_isolated") {
    throw new Error("FATAL: Test must run against sparta_siaga_isolated.");
  }
  process.env.DATABASE_URL = url;
  process.env.DATABASE_SSL_MODE = "require";
  process.env.DATABASE_POOL_MAX = "3";
  return url;
}

const DB_URL = verifyIsolatedTarget();

interface TestResult {
  no: number;
  name: string;
  passed: boolean;
  details: string;
}

const results: TestResult[] = [];

function record(no: number, name: string, passed: boolean, details: string) {
  results.push({ no, name, passed, details });
  console.log(`[Test ${String(no).padStart(2, "0")}] ${passed ? "✅ PASS" : "❌ FAIL"}: ${name}`);
  console.log(`         Detail: ${details}\n`);
}

async function run() {
  console.log("================================================================================");
  console.log(" SPARTA SIAGA - ROLE ACCESS & DC SEARCH SPECIFICATION TEST");
  console.log(" Target Database : sparta_siaga_isolated");
  console.log(" Safety Guard     : defaultdb STRICTLY UNTOUCHED");
  console.log("================================================================================\n");

  const pool = getDbPool();
  const client = await pool.connect();

  try {
    const dbCheck = await client.query("SELECT current_database();");
    if (dbCheck.rows[0].current_database !== "sparta_siaga_isolated") {
      throw new Error("Refusing to run: not connected to sparta_siaga_isolated");
    }

    // Provision test fixtures:
    // 1. One test facility mapped to BANDUNG
    const testFacId = "00000000-0000-4000-a000-000000000001";
    await client.query(`
      INSERT INTO facilities (id, code, name, initials, facility_type, latitude, longitude, branch_id, mapping_verified_at, mapping_verified_by, operational_status, auto_report_enabled, source_name)
      VALUES ($1, 'DC-BDG-TEST', 'DC BANDUNG TESTING', 'BDG', 'DC', -6.9147, 107.6098, 'BANDUNG', NOW(), 'ADMIN_TEST', 'ACTIVE', FALSE, 'MANUAL_TEST')
      ON CONFLICT (code) DO UPDATE
      SET branch_id = 'BANDUNG', mapping_verified_at = NOW(), operational_status = 'ACTIVE';
    `, [testFacId]);

    // 2. One unmapped facility
    const testUnmappedId = "00000000-0000-4000-a000-000000000002";
    await client.query(`
      INSERT INTO facilities (id, code, name, initials, facility_type, latitude, longitude, branch_id, mapping_verified_at, operational_status, auto_report_enabled, source_name)
      VALUES ($1, 'DC-UNMAPPED-TEST', 'DC UNMAPPED TESTING', 'UNM', 'DC', -6.2000, 106.8166, NULL, NULL, 'ACTIVE', FALSE, 'MANUAL_TEST')
      ON CONFLICT (code) DO UPDATE
      SET branch_id = NULL, mapping_verified_at = NULL;
    `, [testUnmappedId]);

    // 3. User fixtures
    await Promise.all([
      dbUpsertUser({ id: "usr_t_bms", nik: "T_BMS", name: "BMS Bandung Test", systemRole: "USER", businessRole: "bms", scope: "BRANCH", branch: "BANDUNG", status: "ACTIVE" }),
      dbUpsertUser({ id: "usr_t_bes", nik: "T_BES", name: "BES Bandung Test", systemRole: "USER", businessRole: "bes", scope: "BRANCH", branch: "BANDUNG", status: "ACTIVE" }),
      dbUpsertUser({ id: "usr_t_bes_crb", nik: "T_BES_CRB", name: "BES Cirebon Test", systemRole: "USER", businessRole: "bes", scope: "BRANCH", branch: "CIREBON", status: "ACTIVE" }),
      dbUpsertUser({ id: "usr_t_bmm", nik: "T_BMM", name: "BMM Bandung Test", systemRole: "USER", businessRole: "bm", scope: "BRANCH", branch: "BANDUNG", status: "ACTIVE" }),
      dbUpsertUser({ id: "usr_t_ho", nik: "T_HO", name: "HO ReadOnly Test", systemRole: "USER", businessRole: "ho_admin", scope: "HO", branch: null, status: "ACTIVE" }),
      dbUpsertUser({ id: "usr_t_admin", nik: "T_ADMIN", name: "Admin SPARTA Test", systemRole: "ADMIN", businessRole: null, scope: null, branch: null, status: "ACTIVE" }),
    ]);

    const [tokenBms, tokenBes, tokenBesCrb, tokenBmm, tokenHo, tokenAdmin] = await Promise.all([
      signSession({ id: "usr_t_bms", nik: "T_BMS", systemRole: "USER" }),
      signSession({ id: "usr_t_bes", nik: "T_BES", systemRole: "USER" }),
      signSession({ id: "usr_t_bes_crb", nik: "T_BES_CRB", systemRole: "USER" }),
      signSession({ id: "usr_t_bmm", nik: "T_BMM", systemRole: "USER" }),
      signSession({ id: "usr_t_ho", nik: "T_HO", systemRole: "USER" }),
      signSession({ id: "usr_t_admin", nik: "T_ADMIN", systemRole: "ADMIN" }),
    ]);

    console.log("Test actors & facility fixtures provisioned.\n");

    // Dynamic import of Route Handlers
    const searchRoute = await import("../app/api/stores/search/route");
    const incidentRoute = await import("../app/api/incidents/route");

    // TEST 1: BMS mencari DC via API stores/search?type=DC -> Ditolak 403 Server-Side
    {
      const req = new Request("http://localhost/api/stores/search?type=DC&q=BANDUNG", {
        headers: { cookie: `siaga_session=${tokenBms}` },
      });
      const res = await searchRoute.GET(req);
      const json = await res.json();
      record(
        1,
        "BMS mencari DC ditolak server-side (403)",
        res.status === 403 && json.code === "ROLE_NOT_AUTHORIZED_FOR_FACILITIES",
        `HTTP Status=${res.status}, Error="${json.error}", Code="${json.code}"`
      );
    }

    // TEST 2: BMS mengirim request laporan manual dengan locationKind FACILITY -> Ditolak 403 Server-Side
    {
      const fakeReport = {
        id: `INC-TEST-BMS-FAC-${Date.now()}`,
        disasterType: "flood",
        branch: "BANDUNG",
        storeId: "DC-BDG-TEST",
        storeName: "DC BANDUNG TESTING",
        locationKind: "FACILITY",
        locationId: testFacId,
        status: "pending_confirmation",
        progress: 0,
        reporterName: "BMS Bandung",
        reporterRole: "bms",
        createdAt: new Date().toISOString(),
      };
      const req = new Request("http://localhost/api/incidents", {
        method: "POST",
        headers: { "Content-Type": "application/json", cookie: `siaga_session=${tokenBms}` },
        body: JSON.stringify(fakeReport),
      });
      const res = await incidentRoute.POST(req);
      const json = await res.json();
      record(
        2,
        "BMS membuat laporan fasilitas ditolak server-side (403)",
        res.status === 403 && json.code === "BMS_FACILITY_REPORT_FORBIDDEN",
        `HTTP Status=${res.status}, Error="${json.error}", Code="${json.code}"`
      );
    }

    // TEST 3: BES mencari fasilitas cabangnya yang valid (BANDUNG) -> Berhasil dan mendapatkan data DC
    {
      const req = new Request("http://localhost/api/stores/search?type=DC&q=DC-BDG-TEST", {
        headers: { cookie: `siaga_session=${tokenBes}` },
      });
      const res = await searchRoute.GET(req);
      const json = await res.json();
      const found = json.data?.find((d: any) => d.kode_toko === "DC-BDG-TEST");
      record(
        3,
        "BES mencari fasilitas cabangnya (BANDUNG) berhasil",
        res.status === 200 && Boolean(found),
        `Status=${res.status}, Count=${json.count}, Found=${found?.nama_toko || "none"}`
      );
    }

    // TEST 4: BES Cirebon mencari fasilitas cabang Bandung -> Hasil kosong & terisolasi
    {
      const req = new Request("http://localhost/api/stores/search?type=DC&q=DC-BDG-TEST", {
        headers: { cookie: `siaga_session=${tokenBesCrb}` },
      });
      const res = await searchRoute.GET(req);
      const json = await res.json();
      const found = json.data?.find((d: any) => d.kode_toko === "DC-BDG-TEST");
      record(
        4,
        "BES Cirebon tidak dapat melihat fasilitas cabang Bandung (isolasi cabang)",
        res.status === 200 && !found && json.count === 0,
        `Status=${res.status}, Count=${json.count}, Found=${Boolean(found)}`
      );
    }

    // TEST 5: Admin mencari seluruh fasilitas (termasuk yang belum dipetakan) -> Berhasil
    {
      const req = new Request("http://localhost/api/stores/search?type=FACILITY&q=DC-UNMAPPED-TEST", {
        headers: { cookie: `siaga_session=${tokenAdmin}` },
      });
      const res = await searchRoute.GET(req);
      const json = await res.json();
      const found = json.data?.find((d: any) => d.kode_toko === "DC-UNMAPPED-TEST");
      record(
        5,
        "Admin dapat mencari fasilitas tanpa mapping cabang",
        res.status === 200 && Boolean(found),
        `Status=${res.status}, Count=${json.count}, Unmapped facility found: ${found?.nama_toko}`
      );
    }

    // TEST 6: HO membaca fasilitas -> Berhasil, mutasi laporan -> Ditolak 403
    {
      const reqGet = new Request("http://localhost/api/stores/search?type=FACILITY&limit=5", {
        headers: { cookie: `siaga_session=${tokenHo}` },
      });
      const resGet = await searchRoute.GET(reqGet);

      const fakeReport = {
        id: `INC-TEST-HO-${Date.now()}`,
        disasterType: "flood",
        branch: "BANDUNG",
        storeId: "TKO-TEST-01",
        storeName: "Toko Test",
        status: "pending_confirmation",
        progress: 0,
      };
      const reqPost = new Request("http://localhost/api/incidents", {
        method: "POST",
        headers: { "Content-Type": "application/json", cookie: `siaga_session=${tokenHo}` },
        body: JSON.stringify(fakeReport),
      });
      const resPost = await incidentRoute.POST(reqPost);

      record(
        6,
        "HO read-only: membaca fasilitas berhasil, mutasi ditolak (403)",
        resGet.status === 200 && resPost.status === 403,
        `GET Status=${resGet.status}, POST Mutasi Status=${resPost.status}`
      );
    }

    // TEST 7: BES mencari pada cabang yang belum memiliki fasilitas mapped -> Memberikan pesan jelas
    {
      const req = new Request("http://localhost/api/stores/search?type=DC", {
        headers: { cookie: `siaga_session=${tokenBesCrb}` },
      });
      const res = await searchRoute.GET(req);
      const json = await res.json();
      record(
        7,
        "BES tanpa mapping cabang menerima pesan diagnostik yang jelas",
        res.status === 200 && json.count === 0 && typeof json.message === "string" && json.message.includes("Belum ada fasilitas yang terhubung"),
        `Status=${res.status}, Message="${json.message}"`
      );
    }

    // TEST 8: BES dilarang mencari Toko (type=TOKO) -> 403
    {
      const req = new Request("http://localhost/api/stores/search?type=TOKO&q=ALFAMART", {
        headers: { cookie: `siaga_session=${tokenBes}` },
      });
      const res = await searchRoute.GET(req);
      const json = await res.json();
      record(
        8,
        "BES mencari Toko ditolak server-side (403)",
        res.status === 403 && json.code === "ROLE_NOT_AUTHORIZED_FOR_STORES",
        `HTTP Status=${res.status}, Error="${json.error}", Code="${json.code}"`
      );
    }

    // TEST 9: BES membuat laporan fasilitas valid cabangnya -> Berhasil (201)
    {
      const reportId = `INC-TEST-BES-VALID-${Date.now()}`;
      const validFacReport = {
        id: reportId,
        disasterType: "flood",
        branch: "BANDUNG",
        storeId: "DC-BDG-TEST",
        storeName: "DC BANDUNG TESTING",
        locationKind: "FACILITY",
        locationId: testFacId,
        locationTypeSnapshot: "DC",
        branchSnapshot: "BANDUNG",
        status: "pending_confirmation",
        progress: 0,
        reporterName: "BES Bandung",
        reporterRole: "bes",
        createdAt: new Date().toISOString(),
      };
      const req = new Request("http://localhost/api/incidents", {
        method: "POST",
        headers: { "Content-Type": "application/json", cookie: `siaga_session=${tokenBes}` },
        body: JSON.stringify(validFacReport),
      });
      const res = await incidentRoute.POST(req);
      const json = await res.json();
      record(
        9,
        "BES membuat laporan fasilitas valid cabangnya berhasil (201)",
        res.status === 201 && json.data?.id === reportId,
        `Status=${res.status}, ID=${json.data?.id}`
      );

      // Clean up report
      await client.query("DELETE FROM incidents WHERE id = $1", [reportId]);
    }

    // TEST 10: Auto-report disabled tidak memblokir pembuatan manual
    {
      const facCheck = await client.query("SELECT auto_report_enabled FROM facilities WHERE code = 'DC-BDG-TEST'");
      record(
        10,
        "Fasilitas dengan auto_report_enabled = false tetap dapat dilaporkan manual",
        facCheck.rows[0].auto_report_enabled === false,
        `auto_report_enabled=${facCheck.rows[0].auto_report_enabled}`
      );
    }

  } finally {
    // Clean up test fixtures
    await client.query("DELETE FROM facilities WHERE code IN ('DC-BDG-TEST', 'DC-UNMAPPED-TEST')");
    await client.query("DELETE FROM users WHERE id IN ('usr_t_bms', 'usr_t_bes', 'usr_t_bes_crb', 'usr_t_bmm', 'usr_t_ho', 'usr_t_admin')");
    client.release();
    await closeDbPool();
  }

  console.log("================================================================================");
  const total = results.length;
  const pass = results.filter((r) => r.passed).length;
  const fail = results.filter((r) => !r.passed).length;
  console.log(`TOTAL: ${total} | PASS: ${pass} | FAIL: ${fail}`);
  console.log("================================================================================");

  if (fail > 0) process.exit(1);
}

run().catch((err) => {
  console.error("Test failed with exception:", err);
  process.exit(1);
});
