# Kebutuhan Data & Rekomendasi Koordinasi Portal SPARTA (SIAGA)

Dokumen ini merangkum kebutuhan data, penyelarasan katalog, serta langkah koordinasi yang perlu ditindaklanjuti bersama tim **Portal SPARTA (`login-sparta`)** sebelum aktivasi penuh **manajemen user terpusat** dan **master data** untuk SPARTA SIAGA. Seluruh rincian bersifat agregat dan tidak menyertakan data pribadi maupun kredensial.

---

## 1. Katalog `ModuleRole` Resmi Modul `SIAGA`

Pada source `login-sparta` branch `master`, katalog `ModuleRole` untuk modul `SIAGA` masih kosong (`0` baris). Sebelum webhook provisioning diaktifkan, Portal perlu mendaftarkan **8 role aktif selectable** berikut (huruf besar sesuai standar `ModuleRole.code` Portal):

| `code` | `label` | `isModuleAdmin` | Scope Turunan di SIAGA |
| --- | --- | --- | --- |
| `ADMIN` | Admin | `true` | `HO` *(bukan `SYSTEM_ADMIN`)* |
| `BM` | BnM Manajer | `false` | `BRANCH` |
| `BMC` | BMC | `false` | `BRANCH` |
| `BMS` | BMS | `false` | `BRANCH` |
| `BEC` | BEC | `false` | `BRANCH` |
| `BES` | BES | `false` | `BRANCH` |
| `BBC` | BBC | `false` | `BRANCH` |
| `BBS` | BBS | `false` | `BRANCH` |

Catatan:
- Role legacy non-selectable (`ho_admin`, `gm_ho`, `sm_ho`), nonaktif (`tim_toko`, `rekanan`), `SYSTEM_ADMIN`, dan role integrasi (`sparta_maintenance`, `bnm`) **tidak** didaftarkan sebagai pilihan baru dan ditolak oleh `initialProvisioningRole` (`422 UNKNOWN_BUSINESS_ROLE`).
- Pencabutan akses (`access.revoked` / `user.deactivated`) tetap diproses meskipun role lama user tidak termasuk 8 role aktif.

---

## 2. Kebutuhan Backfill & Penyelarasan Data Pengguna di Portal (Pra-Bootstrap)

Berdasarkan audit lintas database terhadap snapshot lokal Portal (`sparta_local`) dan DB SIAGA (`584` user):

| Kategori | Jumlah | Kondisi Saat Ini | Rekomendasi Tindakan di Portal / Koordinasi |
| --- | --- | --- | --- |
| Role modul `SIAGA` user aktif | **563** user SSO | Portal `UserModuleAccess.role` masih `"USER"` untuk seluruh 563 akun, sedangkan di SIAGA tercatat `bms` (431), `bmc` (54), `bm` (29), `bec` (25), `admin` (24). | **Wajib backfill di Portal sebelum bootstrap/aktivasi webhook**, agar `access.granted` membawa role aktual SIAGA (`BMS`, `BMC`, `BM`, `BEC`, `ADMIN`), bukan `"USER"`. |
| Ketersediaan NIK (`employeeId`) | **545** terisi di SIAGA + **18** kosong di kedua sisi | 545 akun SSO memiliki NIK di SIAGA namun `User.employeeId = NULL` di Portal. | Tim Portal dapat menarik backfill `employeeId` dari NIK SIAGA. Di sisi SIAGA, receiver kini memakai `COALESCE($3, nik)` sehingga `employeeId: null` tidak menimpa NIK existing. |
| Akun `LOCAL` nonaktif cocok email | **19** akun | Status di kedua DB sudah `INACTIVE` dan email cocok 1:1 (10 legacy HO + 9 role cabang). | Aman ditautkan otomatis oleh receiver provisioning saat replay berlangsung (histori laporan tetap terjaga). |
| Akun `bms` lokal aktif tanpa pasangan | **1** akun | `source = LOCAL`, `status = ACTIVE`, `external_user_id = NULL`, belum ada di `User` Portal. | Konfirmasi pemilik bisnis apakah akun didaftarkan ke Portal (lalu diberi akses `SIAGA:BMS`) atau dinonaktifkan jika sudah tidak dipakai. |
| Akun `SYSTEM_ADMIN` darurat lokal | **1** akun (`system_role=ADMIN`) | Email berpasangan dengan akun Portal `SIAGA:ADMIN`, namun akun ini dipakai sebagai administrator teknikal lokal (`Zero Operational Bypass`). | **Dipertahankan terisolasi** (`protected_system_admin` di provisioning & rotasi password lokal tetap tersedia) sampai pengganti/prosedur darurat produksi terverifikasi. |
| Perbedaan penulisan nama | **3** user SSO | Ejaan nama lengkap sedikit berbeda antara Portal dan SIAGA. | Akan otomatis terselaraskan oleh event `user.updated` / `access.granted` dari Portal. |

---

## 3. Penyelarasan Master Cabang & User Beda Cabang

| Kategori | Jumlah | Kondisi Saat Ini | Rekomendasi Tindakan |
| --- | --- | --- | --- |
| Konversi kode Alfamart di Portal | **94** cabang lokal Portal (`93` non-baku) | Skrip `convert-branch-codes.ts` belum dijalankan di instance DB lokal Portal; tabel `BranchAlias` & `Area` masih kosong. | Jalankan `convert-branch-codes.ts` di lingkungan Portal tujuan sebelum fase konversi cabang (`SPARTA_BRANCH_MASTER_ENABLED=true`). |
| Pemetaan nama cabang lama SIAGA | **28 / 28** cabang SIAGA | Seluruh 28 cabang (termasuk `CILEUNGSI_2` → `JZ01`) sudah masuk katalog `alfamart-branch-codes.json`. | Pastikan alias `CILEUNGSI_2`, `CILEUNGSI`, `CILEUNGSI2`, `BALARAJA`, `PARUNG`, `SERANG`, `BEKASI`, `BOGOR`, `KARAWANG`, dan `HEAD`/`HEAD OFFICE` aktif di `BranchAlias` Portal. |
| Selisih cabang user yang selaras oleh alias/merger | **92 / 104** user | `CILEUNGSI_2` vs `CILEUNGSI`/`CILEUNGSI2` (**65**), `HO (NULL)` vs `HEAD OFFICE` (**24**), `CIKOKOL` vs `BALARAJA`/`PARUNG`/`SERANG` (**3**). | Selesai otomatis saat konversi cabang & backfill alias Portal aktif. |
| Selisih cabang yang butuh keputusan Portal/Bisnis | **12** user | `4` `BANDUNG RAYA`, `3` multi-cabang (`BEKASI, CILEUNGSI_2, ...`), `5` beda lintas cabang (`PALEMBANG` vs `BELITUNG`/`REMBANG`, `BANJARMASIN` vs `JEMBER`, `SIDOARJO` vs `NTT`, `JEMBER` vs `KLATEN`). | Tim Portal dan admin operasional menetapkan cabang tunggal resmi (`Branch.code`) sebelum tahap konversi cabang (Task 6/7). |
| Cabang resmi baru di luar 28 cabang SIAGA | **2** cabang (`1GYX` `PALANGKARAYA`, `PY06` `BENGKULU`) | Ada di `alfamart-branch-codes.json`, belum memiliki data di SIAGA. | Otomatis tersedia di SIAGA setelah sinkronisasi `/v1/master/branches` pada tahap master cabang. |

---

## 4. Kesiapan Master Toko & Fasilitas (Fase 3 & Fase 4)

1. **Master Toko (Fase 3):**
   - SIAGA memiliki **21.550** toko aktif lokal (`0` duplikat `kode_toko`, seluruhnya memiliki `alamat` dan koordinat valid), namun `Store` di DB lokal Portal masih kosong (`0` baris).
   - Sebelum `STORE_MASTER_SOURCE=portal` diaktifkan, tim Portal perlu mengisi & memverifikasi tabel `Store`, memastikan zona waktu DB Portal memakai **UTC** (agar kursor `updatedSince` akurat), serta mengonfirmasi bahwa kolom `alamat` tetap dikelola lokal oleh SIAGA karena belum tersedia di skema `Store` Portal.
2. **Master Fasilitas (Fase 4 — CarbonTrack ↔ SIAGA via Portal):**
   - Portal belum memiliki model `Facility` maupun endpoint `/v1/master/facilities`.
   - SIAGA memiliki **67** fasilitas (`28 DC`, `13 WAREHOUSE`, `12 STORE_HUB`, `9 DEPO`, `5 BULKY`), seluruhnya masih memiliki `branch_id = NULL` dan `mapping_verified_at = NULL`.
   - Langkah lanjut: kumpulkan file ekspor fasilitas CarbonTrack, jalankan `scripts/sparta-facility-compare.ts`, lalu sepakati skema `Facility` Portal dan pemetaan `branch_id` awal (dimulai dari 28 `DC` yang kodenya telah mengikuti kode cabang resmi Alfamart).

---

## 5. Checklist Aktivasi Terkendali (Urutan Aman)

1. Pastikan skema SIAGA memiliki migrasi tahap user (`018` & `020`) pada database uji terisolasi terlebih dahulu (migrasi `021` tetap ditunda sampai konversi cabang/toko).
2. Di sisi Portal: isi catalog `ModuleRole` untuk `SIAGA`, lakukan backfill role 563 user aktif (+ backfill `employeeId` yang tersedia), set `AppModule[SIAGA].provisioningUrl` = `https://<host-siaga>/internal/sparta/provision`, samakan `SPARTA_PROVISIONING_SECRET_SIAGA` dengan `SPARTA_PROVISIONING_SECRET` SIAGA (min. 32 karakter), dan aktifkan `SPARTA_PROVISIONING_WORKER_ENABLED=true`.
3. Preview lalu jalankan `scripts/sparta-siaga-bootstrap.ts` dengan env Portal di lingkungan uji untuk memastikan pembuatan user baru, update identitas/cabang, serta pencabutan akses/sesi berjalan otomatis tanpa menunggu login pertama.
4. Tetap pertahankan akses admin darurat lokal (`SYSTEM_ADMIN`) sampai prosedur penggantian dan login admin Portal produksi terbukti stabil.

---

## 6. Ringkasan Kesiapan Internal SIAGA (Task 1–6) & Prasyarat Saat Beralih ke `login-sparta`

### Sudah Selesai di `sparta-siaga` (Terisolasi, Belum Migrasi/Deploy Production)
- **Konfigurasi, Gate, & Keamanan Env (Task 1):** Arsitektur Dev/UAT/Prod, Quick Login 9 role dev-only, guard fail-closed isolasi pool DB, serta penyelarasan `.env.example` dan dokumentasi env selesai.
- **Identitas, Provisioning, & Manajemen User Terpusat (Task 2 & Task 6):**
  - Endpoint `POST /internal/sparta/provision` (HMAC-SHA256, checkpoint idempotensi `sparta_provisioning_state`, auto-create akun baru saat `access.granted` tanpa tunggu login pertama, `COALESCE` perlindungan NIK existing, relinking aman akun `LOCAL` non-admin, proteksi `SYSTEM_ADMIN` darurat lokal, validasi 8 role aktif, pencabutan sesi instan).
  - Menu & API Manajemen User SIAGA kini tidak menduplikasi fungsi Portal (`POST`, `PATCH`, dan `DELETE` user operasional diarahkan ke Portal SPARTA; rotasi password admin darurat lokal, daftar pengguna, detail izin efektif, `Hak Akses Role`, dan `Akses Khusus User` dipertahankan).
- **Master Cabang, Toko, & Pemisahan Fasilitas (Task 3–6):**
  - Client & backfill `/v1/master/branches` (`Branch.code` + `aliases`), query helper `branchValueSqlKey`/`effectiveBranchValue`, sync otomatis `/v1/master/stores?moduleId=siaga` dengan advisory lock daemon, preservasi alamat lokal, serta penanganan `branch_code`, alamat kosong, koordinat `null`, dan ownership `UNKNOWN` pada worker gempa, daemon cuaca, dan seluruh komponen UI utama (`StoreDetailSheet`, `AffectedStoresSheet`, Peta Monitoring, Admin Fasilitas, Manajemen User).
  - Utility rekonsiliasi pra-integrasi fasilitas (`scripts/sparta-facility-compare.ts`) dan kesiapan skema migrasi `018`, `020`, `021` (tervalidasi offline, belum dieksekusi).

### Prasyarat Eksternal Saat Beralih ke Repository `login-sparta` / Tahap Selanjutnya
1. **Daftarkan 8 `ModuleRole` `SIAGA`**, isi `AppModule[SIAGA].provisioningUrl` + `SPARTA_PROVISIONING_SECRET_SIAGA`, dan aktifkan worker provisioning di Portal.
2. **Backfill data Portal** (563 role aktif dari `"USER"`, backfill `employeeId`/NIK, keputusan 1 akun `bms` lokal aktif & 12 user beda cabang) sebelum replay/aktivasi provisioning.
3. **Jalankan konversi cabang Portal (`convert-branch-codes.ts`) & isi master `Store` Portal** (DB UTC) agar `SPARTA_BRANCH_MASTER_ENABLED=true` dan `STORE_MASTER_SOURCE=portal` dapat diaktifkan di lingkungan uji/staging.
4. **Sediakan ekspor fasilitas CarbonTrack & kontrak `Facility` Portal** untuk rekonsiliasi Fase 4 dan implementasi sync fasilitas.
5. **Uji DB terisolasi (Aiven `sparta_siaga_isolated`)** + apply migrasi bertahap (`018`, `020`, lalu `021` setelah konversi siap) sebelum validasi Task 7 dan cutover.
