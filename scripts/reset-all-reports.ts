/**
 * SPARTA SIAGA - Reset Seluruh Data Laporan (Database Development/Staging)
 *
 * Menghapus SEMUA laporan kejadian, relasi turunan, dan notifikasi terkait laporan
 * pada database sparta_siaga_isolated, serta membersihkan file evidence terkait.
 */

import fs from "node:fs";
import path from "node:path";
import { getDbPool, closeDbPool } from "../lib/db";
import { getRuntimeConfig } from "../lib/runtime-config";

async function resetAllReports() {
  console.log("================================================================================");
  console.log("  SPARTA SIAGA - RESET SELURUH DATA LAPORAN (DEVELOPMENT/STAGING)");
  console.log("================================================================================");

  // 1. Validasi Lingkungan Database
  const config = getRuntimeConfig();
  const dbUrl = new URL(config.databaseUrl);
  const dbName = dbUrl.pathname.replace(/^\//, "");

  console.log(`\n[1/5] Memeriksa database target...`);
  console.log(`  Database Host : ${dbUrl.hostname}`);
  console.log(`  Database Name : ${dbName}`);

  if (dbName !== "sparta_siaga_isolated") {
    console.error(`[DITOLAK] Script ini HANYA boleh dijalankan pada database 'sparta_siaga_isolated'!`);
    console.error(`Database saat ini: '${dbName}'. Operasi dibatalkan demi keamanan.`);
    process.exit(1);
  }
  console.log(`  ✓ Konfirmasi: Database aman (development/staging 'sparta_siaga_isolated').`);

  const pool = getDbPool();
  const client = await pool.connect();

  try {
    // 2. Cek Data Awal
    console.log(`\n[2/5] Memeriksa data laporan yang ada...`);
    const incidentRows = await client.query("SELECT id, store_name, branch, status FROM incidents");
    console.log(`  Total laporan sebelum reset: ${incidentRows.rows.length}`);
    for (const inc of incidentRows.rows) {
      console.log(`    • ${inc.id} | ${inc.store_name} (${inc.branch}) - ${inc.status}`);
    }

    const notifCountBefore = await client.query("SELECT COUNT(*) as cnt FROM notification_logs");
    console.log(`  Total notifikasi sebelum reset: ${notifCountBefore.rows[0].cnt}`);

    // 3. Jalankan Transaksi Reset
    console.log(`\n[3/5] Menjalankan transaksi pembersihan relasi dan laporan...`);
    await client.query("BEGIN");

    // Hapus data turunan laporan
    await client.query("DELETE FROM report_progress_photos");
    await client.query("DELETE FROM report_progress_updates");
    await client.query("DELETE FROM report_estimation_routes");
    await client.query("DELETE FROM estimations");
    await client.query("DELETE FROM report_instructions");
    await client.query("DELETE FROM report_distributions");
    await client.query("DELETE FROM incident_confirmation_decisions");
    await client.query("DELETE FROM incident_inspection_submissions");
    await client.query("DELETE FROM incident_evidence");
    await client.query("DELETE FROM incident_earthquake_match_reviews");
    await client.query("DELETE FROM earthquake_reconciliation_audit");
    await client.query("DELETE FROM earthquake_reconciliation_cases");
    await client.query("DELETE FROM incident_repair_link_history");
    await client.query("DELETE FROM incident_repair_links");
    await client.query("DELETE FROM incident_pic_history");
    await client.query("DELETE FROM report_milestones");
    await client.query("DELETE FROM report_completion_approval_history");
    await client.query("DELETE FROM report_completion_approvals");
    await client.query("DELETE FROM integration_sync_logs");

    // Hapus notifikasi terkait laporan (BMS, BnM Manajer, HO, atau yang merujuk laporan)
    const delNotifRes = await client.query(`
      DELETE FROM notification_logs
      WHERE disaster_id LIKE 'INC-%'
         OR ticket_number LIKE 'INC-%'
         OR notification_category IN ('ASSIGNMENT', 'APPROVAL')
         OR recipient_group IN ('BMS', 'BES', 'BMM')
         OR title LIKE '%[TUGAS PENANGANAN]%'
         OR title LIKE '%[APPROVAL]%'
         OR disaster_id IN (SELECT id FROM incidents)
         OR ticket_number IN (SELECT id FROM incidents)
    `);
    console.log(`  ✓ Berhasil menghapus ${delNotifRes.rowCount} notifikasi terkait laporan.`);

    // Hapus seluruh laporan kejadian
    const delIncRes = await client.query("DELETE FROM incidents");
    console.log(`  ✓ Berhasil menghapus ${delIncRes.rowCount} laporan kejadian dari tabel 'incidents'.`);

    await client.query("COMMIT");
    console.log(`  ✓ Transaksi database berhasil di-commit.`);

    // 4. Bersihkan File Evidence Storage
    console.log(`\n[4/5] Membersihkan file evidence storage milik laporan...`);
    const storageRoot = path.join(process.cwd(), "storage");
    let deletedFilesCount = 0;

    function cleanStorage(dir: string) {
      if (!fs.existsSync(dir)) return;
      for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, ent.name);
        if (ent.isDirectory()) {
          cleanStorage(full);
        } else {
          // File milestone / evidence laporan
          if (ent.name.startsWith("doc_INC-") || ent.name.includes("INC-")) {
            fs.unlinkSync(full);
            deletedFilesCount++;
            console.log(`    - Dihapus: ${ent.name}`);
          }
        }
      }
    }

    cleanStorage(storageRoot);
    console.log(`  ✓ Total file evidence laporan yang dihapus: ${deletedFilesCount}`);

    // 5. Verifikasi Integritas Akhir
    console.log(`\n[5/5] Memverifikasi kondisi akhir sistem...`);
    const finalIncidents = await client.query("SELECT COUNT(*) as count FROM incidents");
    const totalIncidents = Number(finalIncidents.rows[0].count);

    const finalReportNotifs = await client.query(`
      SELECT COUNT(*) as count FROM notification_logs 
      WHERE disaster_id LIKE 'INC-%' 
         OR ticket_number LIKE 'INC-%'
         OR notification_category IN ('ASSIGNMENT', 'APPROVAL')
         OR recipient_group IN ('BMS', 'BES', 'BMM')
    `);
    const totalReportNotifs = Number(finalReportNotifs.rows[0].count);

    const userCount = await client.query("SELECT COUNT(*) as count FROM users");
    const facilityCount = await client.query("SELECT COUNT(*) as count FROM facilities");

    console.log(`  • Total Laporan Kejadian       : ${totalIncidents} (Wajib: 0)`);
    console.log(`  • Notifikasi Terkait Laporan   : ${totalReportNotifs} (Wajib: 0)`);
    console.log(`  • Data Master Pengguna (Users) : ${userCount.rows[0].count} (Utuh)`);
    console.log(`  • Data Master Fasilitas        : ${facilityCount.rows[0].count} (Utuh)`);

    if (totalIncidents !== 0 || totalReportNotifs !== 0) {
      throw new Error(`[GAGAL] Verifikasi akhir gagal! Laporan=${totalIncidents}, Notifikasi=${totalReportNotifs}`);
    }

    console.log("\n================================================================================");
    console.log("  RESET DATABASE DEVELOPMENT BERHASIL!");
    console.log("================================================================================");

  } catch (err) {
    await client.query("ROLLBACK");
    console.error("\n[GAGAL] Terjadi kesalahan, transaksi di-rollback:", err);
    throw err;
  } finally {
    client.release();
    await closeDbPool();
  }
}

resetAllReports().catch((e) => {
  console.error(e);
  process.exit(1);
});
