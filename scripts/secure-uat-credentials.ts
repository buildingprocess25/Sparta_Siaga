import crypto from "crypto";
import fs from "fs";
import path from "path";
import bcrypt from "bcryptjs";
import { getDbPool } from "../lib/db";

async function secureCredentials() {
  console.log("==================================================================");
  console.log("SPARTA SIAGA — SECURING UAT EVALUATOR CREDENTIALS");
  console.log("==================================================================");

  // 1. Generate high-entropy secure password (20 chars)
  const securePassword = "UAT@" + crypto.randomBytes(9).toString("base64url") + "!";
  
  // 2. Generate high-entropy gate passcode (24 chars)
  const gatePasscode = "GATE-" + crypto.randomBytes(12).toString("hex").toUpperCase();

  // 3. Hash with bcrypt
  const salt = await bcrypt.genSalt(10);
  const passwordHash = await bcrypt.hash(securePassword, salt);

  // 4. Update UAT users in staging database (sparta_siaga_isolated)
  const pool = getDbPool();
  try {
    const updateResult = await pool.query(
      `UPDATE users 
       SET password_hash = $1, updated_at = NOW() 
       WHERE email LIKE '%@sparta-siaga.local' OR sso_status = 'UAT_PERSONA'`,
      [passwordHash]
    );

    console.log(`[SECURE] Updated password_hash for ${updateResult.rowCount} UAT accounts in database.`);

    // Confirm that 669 synced candidate users were NOT touched (they have password_hash IS NULL)
    const syncedCheck = await pool.query(
      `SELECT COUNT(*) as count FROM users WHERE sso_status = 'PENDING_SSO_GRANT' AND password_hash IS NOT NULL`
    );
    const touchedSynced = parseInt(syncedCheck.rows[0].count, 10);
    if (touchedSynced > 0) {
      throw new Error(`CRITICAL_SAFETY_VIOLATION: ${touchedSynced} synced candidate users were modified!`);
    }
    console.log("[SECURE] Task 1 synced candidate users (669 users) remain completely untouched (password_hash IS NULL).");

    // 5. Write to local, gitignored file
    const rootDir = process.cwd();
    const credFilePath = path.join(rootDir, "EVALUATOR_CREDENTIALS.txt");

    const content = [
      "==================================================================",
      "SPARTA SIAGA — KREDENSIAL PENGUJIAN UAT EVALUATOR (RAHASIA)",
      "==================================================================",
      `Tanggal Pembuatan: ${new Date().toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })} WIB`,
      "Database Target  : sparta_siaga_isolated (Aiven Cloud Staging)",
      "Status Keamanan  : Default password dihapus total dari database.",
      "",
      "1. GATE PASSCODE (Proteksi Tunnel UAT):",
      `   Passcode   : ${gatePasscode}`,
      `   Query Param: ?gate=${gatePasscode}`,
      "",
      "2. KREDENSIAL LOGIN AKUN EVALUATOR (Semua Persona UAT & System Admin):",
      `   Password   : ${securePassword}`,
      "",
      "3. DAFTAR AKUN PERSONA UAT UNTUK PENGUJIAN:",
      "   [SYSTEM ADMINISTRATOR]",
      "   - Email : sysadmin@sparta-siaga.local",
      "   - NIK   : ADM0001",
      "   - Hak   : Akses Master Data Fasilitas, Role Permissions, Rekonsiliasi Gempa",
      "",
      "   [HEAD OFFICE (HO ADMIN)]",
      "   - Email : budi.santoso@sparta-siaga.local (atau ho.admin.01@sparta-siaga.local)",
      "   - NIK   : UAT_HO0001 (atau HO0001)",
      "   - Hak   : Monitoring Nasional, Buat Instruksi Manajemen (Dilarang Verifikasi/Approval Cabang)",
      "",
      "   [CABANG BANDUNG]",
      "   - BnM Manajer : bm0001@sparta-siaga.local   (NIK: BM0001)  -> Review & Approval Lapangan",
      "   - BMC         : bmc0001@sparta-siaga.local  (NIK: BMC0001) -> Approval Penyelesaian Pekerjaan Toko",
      "   - BEC         : bec0001@sparta-siaga.local  (NIK: BEC0001) -> Approval Penyelesaian Pekerjaan DC",
      "   - BBC         : bbc0001@sparta-siaga.local  (NIK: BBC0001) -> Koordinator Konstruksi",
      "   - BMS         : bms0001@sparta-siaga.local  (NIK: BMS0001) -> Laporan Toko, Bukti Foto, PIC",
      "   - BES         : bes0001@sparta-siaga.local  (NIK: BES0001) -> Laporan DC Bandung, PIC Fasilitas",
      "   - BBS         : bbs0001@sparta-siaga.local  (NIK: BBS0001) -> Spv Konstruksi",
      "",
      "   [CABANG CIKOKOL]",
      "   - BnM Manajer : bm0002@sparta-siaga.local   (NIK: BM0002)",
      "   - BMS         : bms0002@sparta-siaga.local  (NIK: BMS0002)",
      "",
      "CATATAN PENTING:",
      "- File ini HANYA tersimpan di laptop lokal Anda dan diabaikan oleh Git (.gitignore).",
      "- Password dan Gate Passcode di atas TIDAK PERNAH dicatat di log publik/laporan.",
      "==================================================================",
    ].join("\r\n");

    fs.writeFileSync(credFilePath, content, { encoding: "utf-8" });
    console.log(`[SECURE] Successfully generated private credentials file at: ${credFilePath}`);

    // 6. Update .env.local with UAT_GATE_PASSCODE
    const envLocalPath = path.join(rootDir, ".env.local");
    if (fs.existsSync(envLocalPath)) {
      let envContent = fs.readFileSync(envLocalPath, "utf-8");
      if (envContent.includes("UAT_GATE_PASSCODE=")) {
        envContent = envContent.replace(/UAT_GATE_PASSCODE=.*(\r?\n|$)/, `UAT_GATE_PASSCODE=${gatePasscode}$1`);
      } else {
        envContent += `\r\nUAT_GATE_PASSCODE=${gatePasscode}\r\n`;
      }
      fs.writeFileSync(envLocalPath, envContent, "utf-8");
      console.log("[SECURE] Synchronized UAT_GATE_PASSCODE with .env.local");
    }

    console.log("==================================================================");
    console.log("CREDENTIAL HARDENING COMPLETED.");
    console.log("==================================================================");
  } finally {
    await pool.end();
  }
}

secureCredentials().catch((err) => {
  console.error("FATAL: Failed to secure credentials:", err);
  process.exit(1);
});
