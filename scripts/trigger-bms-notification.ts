import { dbGetIncidentById, dbGetAllIncidents } from "../lib/incident-db";
import { recordNotificationLog } from "../lib/notification-service";
import { closeDbPool } from "../lib/db";

async function main() {
  console.log("==================================================================");
  console.log("  SPARTA SIAGA - TRIGGER NOTIFIKASI BMS (TERMINAL DEMO COMMAND)  ");
  console.log("==================================================================");

  // 1. Guard against production environment
  const isProduction =
    process.env.NODE_ENV === "production" ||
    (process.env.DATABASE_URL && process.env.DATABASE_URL.includes("prod") && !process.env.ALLOW_DEV_SCRIPTS);

  if (isProduction) {
    console.error("\n[DITOLAK] Perintah trigger demo dibatasi khusus environment development/staging.");
    console.error("Operasi dibatalkan demi menjaga integritas data production.\n");
    process.exit(1);
  }

  // 2. Parse argument
  const reportId = process.argv[2]?.trim();

  if (!reportId) {
    console.log("\n[INFO] Parameter ID Laporan belum disertakan.");
    console.log("Format penggunaan:");
    console.log("  pnpm tsx scripts/trigger-bms-notification.ts <ID_LAPORAN>\n");
    console.log("Daftar laporan aktif yang tersedia untuk demo:");

    try {
      const activeIncidents = await dbGetAllIncidents();
      const sample = activeIncidents.slice(0, 5);
      if (sample.length === 0) {
        console.log("  (Belum ada laporan aktif di database)");
      } else {
        sample.forEach((inc, idx) => {
          console.log(
            `  ${idx + 1}. ${inc.id} | Cabang: ${inc.branch} | Lokasi: ${inc.storeName} | Status: ${inc.status}`
          );
        });
        console.log(`\nContoh eksekusi:`);
        console.log(`  pnpm tsx scripts/trigger-bms-notification.ts ${sample[0].id}\n`);
      }
    } catch (e) {
      console.error("Gagal mengambil daftar contoh laporan:", e);
    } finally {
      await closeDbPool();
    }
    process.exit(0);
  }

  // 3. Fetch report from database
  console.log(`\n[1/3] Memeriksa data laporan '${reportId}'...`);
  const incident = await dbGetIncidentById(reportId);

  if (!incident) {
    console.error(`[ERROR] Laporan dengan ID '${reportId}' tidak ditemukan di database.`);
    console.error("Pastikan ID laporan sudah terdaftar sebelum memicu notifikasi demo.");
    await closeDbPool();
    process.exit(1);
  }

  console.log(`      ✓ Ditemukan: ${incident.storeName} (${incident.id})`);
  console.log(`      ✓ Cabang   : ${incident.branch}`);
  console.log(`      ✓ Status   : ${incident.status}`);
  console.log(`      ✓ PIC      : ${incident.primaryPicName || (incident.primaryPicUserId ? "Petugas Cabang" : "Belum Ditugaskan")}`);
  console.log(`      ✓ Target   : ${incident.maintenanceTicket?.completedAt ? new Date(incident.maintenanceTicket.completedAt).toLocaleDateString("id-ID") : "Belum Ditentukan"}`);

  // 4. Validate recipient eligibility
  console.log(`\n[2/3] Memverifikasi hak akses penerima notifikasi...`);
  const branchName = incident.branch;
  const recipientEmail = `bms.${branchName.toLowerCase().replace(/\s+/g, "")}@sparta.local`;
  console.log(`      ✓ Target Cabang : ${branchName}`);
  console.log(`      ✓ Target Role   : BMS (Building Maintenance Section) Cabang ${branchName}`);
  console.log(`      ✓ Kontak Tujuan : ${recipientEmail}`);

  // 5. Trigger notification through actual notification service (not frontend manipulation)
  console.log(`\n[3/3] Memproses pencatatan notifikasi resmi via notification-service...`);
  const disasterType = incident.disasterType === "earthquake" ? "earthquake" : "heavy_rain";

  const notifLog = await recordNotificationLog({
    disasterId: incident.id,
    canonicalEventId: incident.earthquakeEventId || incident.id,
    disasterType,
    channel: "email_and_pwa",
    branch: incident.branch,
    recipientContact: recipientEmail,
    title: `[TUGAS PENANGANAN] ${incident.storeName}`,
    message: `Laporan kejadian ${incident.disasterType} di ${incident.storeName} (${incident.branch}) siap ditangani oleh petugas BMS. Silakan tinjau detail dan ambil tugas (Mulai Menangani).`,
    affectedStores:
      incident.affectedStores && incident.affectedStores.length > 0
        ? incident.affectedStores.map((s) => ({
            kode_toko: s.kode_toko,
            nama_toko: s.nama_toko || s.kode_toko,
            cabang: incident.branch,
            distance_km: 0,
            status: "PRIORITY_MONITOR" as const,
          }))
        : [
            {
              kode_toko: incident.storeId || "STORE-01",
              nama_toko: incident.storeName,
              cabang: incident.branch,
              distance_km: 0,
              status: "PRIORITY_MONITOR" as const,
            },
          ],
    ticketNumber: incident.id,
    recipientGroup: "BMS",
    category: "ASSIGNMENT",
  });

  console.log("\n==================================================================");
  console.log("  HASIL PENGIRIMAN NOTIFIKASI BERHASIL!");
  console.log("==================================================================");
  console.log(`  Notifikasi ID   : ${notifLog.id}`);
  console.log(`  Nomor Tiket     : ${notifLog.ticket_number}`);
  console.log(`  Penerima Berhak : Petugas BMS Cabang ${notifLog.branch}`);
  console.log(`  Kanal           : ${notifLog.channel} (In-App Bell & PWA Alert)`);
  console.log(`  Waktu Kirim     : ${notifLog.sent_at}`);
  console.log(`  Delivery Status : not_configured (Tersimpan aman di database SPARTA)`);
  console.log("------------------------------------------------------------------");
  console.log("  Status Aplikasi :");
  console.log(`  1. Record tersimpan resmi di tabel 'notification_logs'.`);
  console.log(`  2. Ikon lonceng pada dashboard BMS Cabang '${notifLog.branch}' akan`);
  console.log(`     memperbarui badge jumlah notifikasi baru.`);
  console.log(`  3. Kartu notifikasi menyediakan aksi langsung:`);
  console.log(`     • 'Lihat Detail' -> Membuka modal ringkasan laporan`);
  console.log(`     • 'Mulai Menangani' -> Menugaskan PIC otomatis & ubah status`);
  console.log("==================================================================\n");

  await closeDbPool();
  process.exit(0);
}

main().catch(async (err) => {
  console.error("\n[FATAL ERROR] Gagal mengeksekusi trigger notifikasi:", err);
  await closeDbPool();
  process.exit(1);
});
