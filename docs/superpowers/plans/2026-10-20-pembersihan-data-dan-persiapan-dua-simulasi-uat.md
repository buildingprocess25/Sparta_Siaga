# Rencana Implementasi: Pembersihan Data Testing & Persiapan Dua Simulasi UAT SPARTA SIAGA

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Membersihkan data pengujian lama di database terisolasi tanpa menyentuh akun System Administrator, menyiapkan akun demo UAT berhak akses lengkap, membuat dokumen contoh simulasi, dan mempersiapkan dua sesi demonstrasi UAT mandiri untuk dua atasan (Simulasi 1: Alur Laporan Toko & Penolakan Serah Terima; Simulasi 2: Alur Laporan DC & Pemantauan Gempa Otomatis) lengkap dengan panduan praktis berbahasa Indonesia.

**Architecture:** Database terisolasi PostgreSQL (`sparta_siaga_isolated`) diproteksi menggunakan guard `assertIsolatedDatabase`. Seluruh tabel dan berkas dicadangkan (backup dump) ke direktori `backups/uat_cleanup_<timestamp>`. Pembersihan dijalankan secara selektif (dry run lalu eksekusi) hanya menghapus record berawalan `TEST-`, `INC-REFINE-`, `INC-TEST-` dan akun demo perancah visual (`usr_*_verify`, `usr_*_test`). Akun System Administrator (`system_role = 'ADMIN'`, khususnya NIK `ADM0001`) diproteksi mutlak tanpa perubahan NIK/password. Penyiapan akun UAT menggunakan skrip idempotent terpisah (`scripts/prepare-uat-personas.ts`) dengan cabang valid (`BANDUNG` dan `CIKOKOL`). Dokumen simulasi PDF dan gambar disiapkan di `public/simulasi-uat/` berlabel jelas "SIMULASI UAT  -  BUKAN DOKUMEN RESMI".

**Tech Stack:** Next.js 16 (App Router), TypeScript, PostgreSQL (`pg` pool, NO PRISMA), bcryptjs, Leaflet, Node.js `fs`/`crypto`.

---

## Global Constraints

1. **NO PRISMA:** Sistem sepenuhnya menggunakan native `pg` pool. Jangan memasang atau memanggil Prisma.
2. **DATABASE SAFETY FIRST:** Seluruh eksekusi wajib memeriksa `assertIsolatedDatabase(pool)`. Jika bukan `sparta_siaga_isolated`, batalkan segera.
3. **SYSTEM ADMINISTRATOR PROTECTION:** Akun dengan `system_role = 'ADMIN'` (khususnya ID `usr_seed_admin` / NIK `ADM0001`) DILARANG DIHAPUS, DINONAKTIFKAN, DIUBAH PASSWORDNYA, MAUPUN DIUBAH ROLE/PERMISSION-NYA.
4. **NO DESTRUCTIVE RESET:** Dilarang menjalankan `DROP TABLE`, `TRUNCATE` menyeluruh, atau menghapus master toko, master DC, koordinat, cabang, maupun konfigurasi.
5. **ISOLASI DUA SIMULASI:** Data Simulasi 1 (`UAT-ATASAN-1`) dan Simulasi 2 (`UAT-ATASAN-2`) tidak boleh saling menimpa atau saling menghapus.
6. **NO SECRET LEAKAGE:** Password akun demo tidak boleh dicantumkan ke dalam commit Git atau laporan publik, melainkan diarahkan via file konfigurasi lokal (`.env.local`) dan panduan internal.

---

## Rincian File yang Terlibat

| File / Direktori | Tipe | Tanggung Jawab & Deskripsi |
| :--- | :--- | :--- |
| `scripts/backup-uat-database.ts` | Create | Mengekspor dump JSON tabel terdampak & file storage ke `backups/uat_cleanup_<timestamp>/` |
| `scripts/clean-old-testing-data.ts` | Create | Script pembersihan aman: mode dry-run & live, menghapus data pengujian lama tanpa menyentuh Admin |
| `scripts/prepare-uat-personas.ts` | Create | Seeder akun UAT bersih (BMS, BES, BBS, BMC, BEC, BBC, BM, HO, GM HO) dengan proteksi mutlak pada Admin |
| `scripts/seed-simulation-documents.ts`| Create | Menghasilkan berkas PDF & foto simulasi dengan tanda air "SIMULASI UAT" untuk kedua skenario |
| `scripts/setup-uat-simulations.ts` | Create | Menyiapkan data awal untuk Simulasi 1 dan Simulasi 2 (kondisi siap didemokan) |
| `scripts/test-uat-full-lifecycle.ts` | Create | Script verifikasi otomatis menyeluruh untuk alur Simulasi 1 & Simulasi 2 |
| `docs/uat/DAFTAR_AKUN_SIMULASI.md` | Create | Daftar akun terverifikasi, NIK, role, cabang, fungsi, dan hasil uji login |
| `docs/uat/PANDUAN_SIMULASI_1_ATASAN_PERTAMA.md` | Create | Panduan demonstrasi interaktif langkah-demi-langkah Toko + Revisi Serah Terima |
| `docs/uat/PANDUAN_SIMULASI_2_ATASAN_KEDUA.md` | Create | Panduan demonstrasi interaktif langkah-demi-langkah DC + Gempa Otomatis + Peta |

---

## Tahapan Tugas (Tasks)

### Task 1: Audit & Backup Database UAT and Storage Assets

**Files:**
- Create: `scripts/backup-uat-database.ts`
- Test: `scripts/backup-uat-database.ts`

- [ ] **Step 1.1: Tulis script backup komprehensif**
  Mengecek `assertIsolatedDatabase(pool)`. Membaca tabel `users`, `incidents`, `report_milestones`, `report_completion_approvals`, `report_completion_approval_history`, `incident_confirmation_decisions`, `incident_inspection_submissions`, `incident_evidence`, `report_progress_photos`, `report_progress_updates`. Menyimpannya dalam format JSON di `backups/uat_cleanup_<timestamp>/tables/`. Menyalin berkas di `storage/` dan `public/uploads/` ke `backups/uat_cleanup_<timestamp>/storage/`. Menghitung SHA256SUMS dan menulis `BACKUP_METADATA.json`.
- [ ] **Step 1.2: Jalankan backup dan verifikasi integritasnya**
  Eksekusi `pnpm exec tsx scripts/backup-uat-database.ts`. Pastikan exit code 0 dan seluruh berkas backup terbaca sempurna.

---

### Task 2: Dry Run & Safe Data Cleanup (Isolating and Deleting Old Testing Data)

**Files:**
- Create: `scripts/clean-old-testing-data.ts`
- Test: `scripts/test-cleanup-safety.ts`

- [ ] **Step 2.1: Implementasi script pembersihan bertingkat (Dry Run & Live)**
  Kriteria penghapusan terverifikasi:
  - **Laporan testing lama:** ID dimulai dengan `TEST-`, `INC-REFINE-`, `INC-TEST-` beserta child records terkait di `report_milestones`, `report_completion_approvals`, `incident_evidence`, dsb.
  - **Akun testing lama:** ID berawalan `usr_bes_verify`, `usr_bms_verify`, `usr_t_`, `usr_vis_`, `usr_mv_`, `usr_pw_`, `u-test-`.
  - **PROTEKSI ADMINISTRATOR:** `WHERE system_role = 'ADMIN'` atau ID `usr_seed_admin` atau NIK `ADM0001` DIKECUALIKAN SECARA EKSPLISIT (`NOT IN / NOT EQUAL`).
  - **File storage:** Hanya menghapus file `storage/milestones/doc_<REPORT_ID>_*` yang report_id-nya masuk dalam daftar laporan testing yang dihapus.
- [ ] **Step 2.2: Eksekusi Dry Run & Tampilkan Ringkasan**
  Jalankan `pnpm exec tsx scripts/clean-old-testing-data.ts --dry-run` untuk menampilkan detail jumlah baris dan akun yang terdampak tanpa melakukan modifikasi.
- [ ] **Step 2.3: Eksekusi Live Cleanup & Verifikasi Pasca-Pembersihan**
  Jalankan `pnpm exec tsx scripts/clean-old-testing-data.ts --live`. Verifikasi bahwa akun `usr_seed_admin` tetap aktif, password tetap utuh, dan data master toko/DC tidak berkurang satu pun.

---

### Task 3: Safe UAT Personas Provisioning (Zero-Touch on Admin)

**Files:**
- Create: `scripts/prepare-uat-personas.ts`
- Test: `scripts/test-uat-personas-login.ts`

- [ ] **Step 3.1: Buat seeder akun UAT bersih tanpa menyentuh Admin**
  Akun yang disiapkan:
  - `BMS0001`: Demo BMS Bandung (Role: `bms`, Branch: `BANDUNG`)  -  Simulasi 1
  - `BES0001`: Demo BES Bandung (Role: `bes`, Branch: `BANDUNG`)  -  Simulasi 2
  - `BBS0001`: Demo BBS Bandung (Role: `bbs`, Branch: `BANDUNG`)  -  Jalur Building/Cabang
  - `BMC0001`: Demo BMC Koordinator Bandung (Role: `bmc`, Branch: `BANDUNG`)  -  Koordinator Toko
  - `BEC0001`: Demo BEC Koordinator Bandung (Role: `bec`, Branch: `BANDUNG`)  -  Koordinator DC
  - `BBC0001`: Demo BBC Koordinator Bandung (Role: `bbc`, Branch: `BANDUNG`)  -  Koordinator Building
  - `BM0001`: Demo BnM Manajer Bandung (Role: `bm`, Branch: `BANDUNG`)  -  Simulasi 1 & 2
  - `HO0001`: Demo HO Admin Monitoring (Role: `ho_admin`, Branch: `ALL`)  -  Simulasi 1 & 2
  - `GM0001`: Demo GM HO Monitoring (Role: `gm_ho`, Branch: `ALL`)  -  Simulasi 2
  - Akun Administrator (`ADM0001` / `usr_seed_admin`) dilewati sepenuhnya (`SKIPPED`) agar tidak tertimpa.
- [ ] **Step 3.2: Uji login dan otentikasi seluruh akun via API/bcrypt**
  Tulis `scripts/test-uat-personas-login.ts` untuk memverifikasi bahwa `ADM0001` dan seluruh akun demo dapat login dengan sukses dan memiliki permission yang tepat.

---

### Task 4: Sample UAT Document Generation

**Files:**
- Create: `scripts/seed-simulation-documents.ts`
- Output Dir: `public/simulasi-uat/`

- [ ] **Step 4.1: Buat generator dokumen contoh simulasi berlabel resmi**
  Menghasilkan berkas PDF dan JPG dummy di `public/simulasi-uat/`:
  - `foto_kejadian_awal_toko.jpg`, `foto_pemeriksaan_toko.jpg`
  - `ceklis_10_toko.pdf`, `estimasi_25_eksternal_sparta.pdf`, `approve_proxy_30.pdf`, `spk_50_toko.pdf`
  - `serah_terima_100_toko.pdf`, `foto_pekerjaan_selesai_toko.jpg`, `foto_before_after_toko.jpg`
  - `foto_revisi_tes_siram_atap.jpg` (untuk penolakan & perbaikan Simulasi 1)
  - `foto_kejadian_dc.jpg`, `dokumen_serah_terima_dc.pdf`, `foto_selesai_dc.jpg` (Simulasi 2)
  Seluruh dokumen diberi watermark dan teks tajam: "DOKUMEN SIMULASI UAT  -  BUKAN DOKUMEN RESMI".

---

### Task 5: Preparation of Simulation 1 (Toko Incident & Rejection/Revision Flow)

**Files:**
- Create: `scripts/setup-simulation-1.ts`
- Docs: `docs/uat/PANDUAN_SIMULASI_1_ATASAN_PERTAMA.md`

- [ ] **Step 5.1: Siapkan skenario data awal Simulasi 1**
  Menyediakan data awal yang belum selesai (agar dapat didemonstrasikan langsung oleh BMS dari pembuatan laporan, atau disiapkan di titik mulai pembuatan laporan):
  - Toko: `SAT-B081` (CICAHEUM, BANDUNG)
  - Penanda: `UAT-ATASAN-1`
  - Catatan kejadian: Kerusakan plafon dan kebocoran akibat hujan deras.
- [ ] **Step 5.2: Tulis panduan lengkap Simulasi 1 untuk Atasan Pertama**
  Panduan 10 langkah operasional dari pembuatan laporan, inspeksi, konfirmasi BnM, Update Progress milestone fleksibel, multi-file Serah Terima, persetujuan BMC, penolakan berwajib alasan oleh BnM, perbaikan terisolasi oleh BMS, persetujuan ulang BMC & BnM, hingga unduh PDF laporan oleh HO Admin.

---

### Task 6: Preparation of Simulation 2 (DC Incident & Automated Earthquake Monitoring)

**Files:**
- Create: `scripts/setup-simulation-2.ts`
- Docs: `docs/uat/PANDUAN_SIMULASI_2_ATASAN_KEDUA.md`

- [ ] **Step 6.1: Siapkan skenario data awal Simulasi 2**
  - DC Facility valid: DC Bandung (dari master `facilities`)
  - Penanda: `UAT-ATASAN-2`
  - Skenario DC: Kerusakan rolling door DC akibat benturan saat bongkar muat $\rightarrow$ BES lapor $\rightarrow$ BnM konfirmasi $\rightarrow$ Milestone $\rightarrow$ Serah Terima $\rightarrow$ BEC approve $\rightarrow$ BnM approve.
  - Skenario Gempa Otomatis: Laporan kejadian gempa otomatis terisolasi untuk Toko Pantauan (menunjukkan status "Belum Diperiksa", opsi BMS "Ada Kerusakan" vs "Tidak Ada Kerusakan", konfirmasi BnM tanpa opsi "Tolak Laporan", dan penutupan otomatis jika tidak ada kerusakan).
  - Peta Monitoring & Notifikasi lintas cabang.
- [ ] **Step 6.2: Tulis panduan lengkap Simulasi 2 untuk Atasan Kedua**
  Panduan operasional lengkap dari alur DC, alur gempa otomatis, notifikasi, hingga eksplorasi Peta Monitoring dan monitoring nasional oleh HO.

---

### Task 7: Comprehensive Verification & Role Access Validation

**Files:**
- Create: `scripts/test-uat-full-lifecycle.ts`

- [ ] **Step 7.1: Tulis automated test siklus hidup kedua simulasi**
  Menguji secara programatis seluruh alur peran:
  - Login & hak akses setiap role
  - Simulasi 1: BMS submit $\rightarrow$ BnM confirm $\rightarrow$ Milestones submit $\rightarrow$ ST multi-file submit $\rightarrow$ BMC approve $\rightarrow$ BnM reject (empty reason blocked, with reason succeeds) $\rightarrow$ BMS revise ST $\rightarrow$ BMC re-approve $\rightarrow$ BnM approve $\rightarrow$ Close $\rightarrow$ HO read-only & PDF download.
  - Simulasi 2: BES submit $\rightarrow$ BnM confirm $\rightarrow$ BEC approve $\rightarrow$ BnM approve $\rightarrow$ Auto-EQ inspection ("Tidak Ada Kerusakan") $\rightarrow$ BnM confirm $\rightarrow$ Auto-resolve tanpa perbaikan.
- [ ] **Step 7.2: Jalankan test dan pastikan 100% PASS**
  Eksekusi `pnpm exec tsx scripts/test-uat-full-lifecycle.ts`.

---

### Task 8: Deliverables & Documentation Finalization

**Files:**
- Create: `docs/uat/DAFTAR_AKUN_SIMULASI.md`
- Create: `docs/uat/LAPORAN_PEMBERSIHAN_DATA.md`
- Verify: `pnpm typecheck` dan `pnpm build`

- [ ] **Step 8.1: Buat dokumen Daftar Akun Simulasi Terverifikasi**
  Menampilkan tabel lengkap akun, NIK, role, cabang, fungsi, peruntukan simulasi, dan status verifikasi login.
- [ ] **Step 8.2: Buat dokumen Laporan Pembersihan Data**
  Ringkasan data sebelum dan sesudah pembersihan, konfirmasi keamanan System Administrator, serta status backup.
- [ ] **Step 8.3: Verifikasi build & typecheck akhir**
  Pastikan `pnpm typecheck` (0 error) dan dev server aktif normal pada port 3004.
