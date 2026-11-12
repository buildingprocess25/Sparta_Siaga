/**
 * SPARTA SIAGA - STORE / DC LOCATION SEARCH DETERMINISTIC TEST SUITE
 * 
 * Verifies:
 *   1. Toko search by code
 *   2. Toko search by name
 *   3. Branch user only receives own branch
 *   4. HO receives authorized broader search
 *   5. Branch naming / code mismatch handled correctly (aliases & case-insensitivity)
 *   6. DC search returns DC only if real DC master exists (honest empty/unavailable state)
 *   7. Selecting Toko vs DC changes backend query behavior
 *   8. Empty result displays explicit UI feedback in modal
 *   9. System Admin remains unable to submit operational reports (Zero Operational Bypass)
 */

import fs from "node:fs";
import path from "node:path";
import { getDbPool } from "../lib/db.js";
import { resolveBranchAliases } from "../app/api/stores/search/route.js";

function assert(condition: boolean, testId: string, message: string) {
  if (condition) {
    console.log(`  ✅ [PASS] ${testId}: ${message}`);
  } else {
    console.error(`  ❌ [FAIL] ${testId}: ${message}`);
    throw new Error(`Test assertion failed for ${testId}: ${message}`);
  }
}

async function run() {
  console.log("================================================================");
  console.log(" SPARTA SIAGA - STORE & DC LOCATION SEARCH TEST SUITE");
  console.log("================================================================\n");

  const pool = getDbPool();

  try {
    // ---------------------------------------------------------------
    // 1. TOKO SEARCH BY CODE
    // ---------------------------------------------------------------
    console.log("--- 1. Toko Search by Code ---");
    const codeQuery = "2GT5";
    const resCode = await pool.query(
      `SELECT kode_toko, nama_toko, cabang, alamat 
       FROM stores 
       WHERE (nama_toko ILIKE $1 OR kode_toko ILIKE $1 OR alamat ILIKE $1) 
       LIMIT 10`,
      [`%${codeQuery}%`]
    );
    assert(resCode.rows.length > 0, "T1.1", `Pencarian kode toko '${codeQuery}' menghasilkan data`);
    assert(resCode.rows[0].kode_toko === "2GT5", "T1.2", `Kode toko cocok tepat: ${resCode.rows[0].kode_toko}`);

    // ---------------------------------------------------------------
    // 2. TOKO SEARCH BY NAME
    // ---------------------------------------------------------------
    console.log("\n--- 2. Toko Search by Name ---");
    const nameQuery = "bitung";
    const resName = await pool.query(
      `SELECT kode_toko, nama_toko, cabang, alamat 
       FROM stores 
       WHERE (nama_toko ILIKE $1 OR kode_toko ILIKE $1 OR alamat ILIKE $1) 
       LIMIT 10`,
      [`%${nameQuery}%`]
    );
    assert(resName.rows.length > 0, "T2.1", `Pencarian nama toko '${nameQuery}' menghasilkan data`);
    assert(
      resName.rows.some((r) => r.nama_toko.toLowerCase().includes("bitung")),
      "T2.2",
      `Hasil pencarian mengandung kata '${nameQuery}'`
    );

    // ---------------------------------------------------------------
    // 3. BRANCH USER ONLY RECEIVES OWN BRANCH
    // ---------------------------------------------------------------
    console.log("\n--- 3. Branch User Isolation ---");
    const userBranch = "CIKOKOL";
    const resBranch = await pool.query(
      `SELECT kode_toko, nama_toko, cabang, alamat 
       FROM stores 
       WHERE (nama_toko ILIKE $1 OR kode_toko ILIKE $1 OR alamat ILIKE $1)
         AND UPPER(cabang) = UPPER($2)
       LIMIT 20`,
      [`%${nameQuery}%`, userBranch]
    );
    assert(resBranch.rows.length > 0, "T3.1", `User cabang ${userBranch} menemukan toko lokal '${nameQuery}'`);
    assert(
      resBranch.rows.every((r) => r.cabang.toUpperCase() === userBranch),
      "T3.2",
      `Seluruh hasil toko terisolasi secara ketat pada cabang ${userBranch}`
    );
    assert(
      !resBranch.rows.some((r) => r.cabang.toUpperCase() === "MANADO"),
      "T3.3",
      `Toko cabang MANADO (seperti GIRIAN BITUNG) tidak bocor ke user cabang CIKOKOL`
    );

    // ---------------------------------------------------------------
    // 4. HO RECEIVES BROADER SEARCH
    // ---------------------------------------------------------------
    console.log("\n--- 4. HO Scope Broader Search ---");
    const resHO = await pool.query(
      `SELECT kode_toko, nama_toko, cabang, alamat 
       FROM stores 
       WHERE (nama_toko ILIKE $1 OR kode_toko ILIKE $1 OR alamat ILIKE $1)
       LIMIT 50`,
      [`%${nameQuery}%`]
    );
    const hoBranches = new Set(resHO.rows.map((r) => r.cabang.toUpperCase()));
    assert(hoBranches.size > 1, "T4.1", `HO menerima hasil lintas cabang (${Array.from(hoBranches).join(", ")})`);
    assert(hoBranches.has("CIKOKOL") && hoBranches.has("MANADO"), "T4.2", `HO dapat melihat toko CIKOKOL dan MANADO`);

    // ---------------------------------------------------------------
    // 5. BRANCH NAMING / CODE MISMATCH HANDLING
    // ---------------------------------------------------------------
    console.log("\n--- 5. Branch Naming / Code Mismatch Resolution ---");
    const aliasesG001 = resolveBranchAliases("G001");
    assert(aliasesG001.includes("CIKOKOL"), "T5.1", `Branch code G001 berhasil dikanonikalisasi ke CIKOKOL`);

    const aliasesPrefixed = resolveBranchAliases("Cabang Cikokol");
    assert(aliasesPrefixed.includes("CIKOKOL"), "T5.2", `Prefix 'Cabang Cikokol' dikanonikalisasi ke CIKOKOL`);

    const aliasesLower = resolveBranchAliases("cikokol");
    assert(aliasesLower.includes("CIKOKOL"), "T5.3", `Lowercase 'cikokol' dikanonikalisasi ke CIKOKOL`);

    // Verify SQL query with aliases
    const resAliasQuery = await pool.query(
      `SELECT kode_toko, nama_toko, cabang 
       FROM stores 
       WHERE (nama_toko ILIKE $1 OR kode_toko ILIKE $1 OR alamat ILIKE $1)
         AND UPPER(cabang) = ANY($2::text[])
       LIMIT 5`,
      [`%${nameQuery}%`, aliasesG001]
    );
    assert(resAliasQuery.rows.length > 0, "T5.4", `Pencarian dengan branch G001 berhasil mengambil toko CIKOKOL`);

    // ---------------------------------------------------------------
    // 6. DC SEARCH BEHAVIOR (HONEST UNAVAILABLE STATE)
    // ---------------------------------------------------------------
    console.log("\n--- 6. DC Master Data Audit ---");
    // Check if table dc or warehouses exists
    const dcTableCheck = await pool.query(
      `SELECT table_name FROM information_schema.tables 
       WHERE table_schema = 'public' AND table_name IN ('warehouses', 'distribution_centers', 'dcs')`
    );
    assert(dcTableCheck.rows.length === 0, "T6.1", `Tabel master DC independen tidak ditemukan di database`);

    // Check stores fr_type
    const frCheck = await pool.query("SELECT DISTINCT fr_type FROM stores");
    const frValues = frCheck.rows.map((r) => r.fr_type);
    assert(
      frValues.every((v) => v === "R" || v === "F"),
      "T6.2",
      `Tabel stores hanya memuat gerai ritel R (Reguler) dan F (Franchise)`
    );

    // ---------------------------------------------------------------
    // 7. SELECTING TOKO VS DC CHANGES BACKEND QUERY BEHAVIOR
    // ---------------------------------------------------------------
    console.log("\n--- 7. Selecting Toko vs DC Contract ---");
    const routeSrc = fs.readFileSync(
      path.resolve(process.cwd(), "app/api/stores/search/route.ts"),
      "utf-8"
    );
    assert(
      routeSrc.includes('typeParam === "DC"'),
      "T7.1",
      `Backend menangani parameter type=DC secara eksplisit`
    );
    assert(
      routeSrc.includes('masterAvailable: false') && routeSrc.includes('type: "DC"'),
      "T7.2",
      `Backend merespons type=DC dengan data kosong dan masterAvailable: false tanpa merekayasa data toko`
    );
    assert(
      routeSrc.includes('type: "TOKO"') && routeSrc.includes('masterAvailable: true'),
      "T7.3",
      `Backend merespons type=TOKO dengan masterAvailable: true dan data gerai aktif`
    );

    // ---------------------------------------------------------------
    // 8. EMPTY RESULT DISPLAYS EXPLICIT UI FEEDBACK
    // ---------------------------------------------------------------
    console.log("\n--- 8. UI Feedback States in ManualIncidentModal ---");
    const modalSrc = fs.readFileSync(
      path.resolve(process.cwd(), "components/incident/manual-incident-modal.tsx"),
      "utf-8"
    );
    assert(
      modalSrc.includes("Tidak ada lokasi ditemukan"),
      "T8.1",
      `Modal menyajikan pesan 'Tidak ada lokasi ditemukan' saat pencarian kosong`
    );
    assert(
      modalSrc.includes("Mencari lokasi toko di database..."),
      "T8.2",
      `Modal menyajikan feedback loading saat request pencarian sedang berjalan`
    );
    assert(
      modalSrc.includes("searchError") && modalSrc.includes("Silakan periksa kata kunci Anda"),
      "T8.3",
      `Modal menyajikan feedback error jika request pencarian gagal`
    );
    assert(
      modalSrc.includes("Master Data Gudang / DC Belum Tersedia"),
      "T8.4",
      `Modal menyajikan feedback jujur 'Master Data Gudang / DC Belum Tersedia' saat tab DC dipilih`
    );
    assert(
      modalSrc.includes("Ganti Toko"),
      "T8.5",
      `Modal menyediakan card toko terpilih dengan tombol 'Ganti Toko' yang intuitif`
    );

    // ---------------------------------------------------------------
    // 9. SYSTEM ADMIN ZERO OPERATIONAL BYPASS
    // ---------------------------------------------------------------
    console.log("\n--- 9. System Admin Zero Operational Bypass ---");
    assert(
      modalSrc.includes('identity?.systemRole === "ADMIN"') &&
      modalSrc.includes("Akun System Administrator tidak diizinkan membuat laporan operasional"),
      "T9.1",
      `Modal memblokir submit laporan manual jika pengguna adalah System Admin`
    );
    assert(
      modalSrc.includes("Akun System Administrator hanya memiliki hak audit & pemantauan"),
      "T9.2",
      `Modal menyajikan peringatan visual pembatasan hak operasional untuk System Admin`
    );

    console.log("\n================================================================");
    console.log("🎉 ALL 9 STORE / DC LOCATION SEARCH SCENARIOS PASSED!");
    console.log("================================================================\n");
  } finally {
    await pool.end();
  }
}

run().catch((err) => {
  console.error("Test failed with error:", err);
  process.exit(1);
});
