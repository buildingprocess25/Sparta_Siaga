# SPARTA SIAGA  -  ADMIN PERMISSION LOGIC & PRE-DEMO ACCEPTANCE REPORT

## 1. Executive Summary & Root Cause Analysis

### A. Root Cause of Redundant Scope Selection
Pada form modal *"Tambah Akses Khusus User"* (`AddOverrideModal`), pemilihan hak akses `Lihat Semua Laporan (Nasional)` (`REPORT_VIEW_ALL`) sebelumnya tetap menampilkan dropdown pilihan cakupan (`SPECIFIC_BRANCH`, `OWN_SCOPE`, `ALL_BRANCHES`). Karena hak akses tersebut secara inheren mendefinisikan pembacaan skala nasional, menuntut administrator memilih ulang `"Semua Branch"` bersifat redundan, membingungkan, dan rawan kesalahan (*error-prone*). Lebih lanjut, jika branch selector disembunyikan secara kondisional, penomoran form melompati nomor (misal dari 3 langsung ke 5).

### B. Root Cause of National READ vs National WRITE Conflation
Secara arsitektur keamanan, izin melihat laporan secara nasional (`REPORT_VIEW_ALL`) **bukan** merupakan izin melakukan perubahan operasional lintas cabang (*Zero Cross-Branch Mutation*). Seorang Branch Manager yang diberi akses pemantauan nasional hanya berhak memantau status secara *read-only*. Upaya mutasi (seperti update progress, konfirmasi, atau penutupan laporan) di cabang lain harus tetap ditolak secara mutlak (`403 Forbidden`). Sebelumnya, query daftar insiden (`GET /api/incidents`) belum mengevaluasi override `REPORT_VIEW_ALL` pengguna cabang, sehingga laporan cabang lain tidak terambil dalam query list.

---

## 2. Canonical Scope Rules Architecture

Telah diimplementasikan tabel kebijakan cakupan kanonikal tersentralisasi pada `types/permission.ts`:

| Permission Key | Policy Type | Allowed Scopes | Default Scope | Read-Only Summary / UX Behavior |
| :--- | :--- | :--- | :--- | :--- |
| `REPORT_VIEW_ALL` | `FIXED_NATIONAL` | `ALL_BRANCHES` | `ALL_BRANCHES` | Dropdown disembunyikan. Menampilkan `Cakupan: Seluruh Cabang (Nasional)` (Badge: Read-Only). |
| `REPORT_VIEW_OWN` | `FIXED_OWN` | `OWN_SCOPE` | `OWN_SCOPE` | Dropdown disembunyikan. Menampilkan `Cakupan: Cabang Pengguna (${branch})`. |
| `NOTIFICATION_VIEW` | `FIXED_OWN` | `OWN_SCOPE` | `OWN_SCOPE` | Dropdown disembunyikan. Menampilkan `Cakupan: Global / Seluruh Notifikasi Bencana`. |
| `MANAGEMENT_INSTRUCTION_CREATE` | `FIXED_NATIONAL` | `ALL_BRANCHES` | `ALL_BRANCHES` | Dropdown disembunyikan. Menampilkan `Cakupan: Seluruh Cabang (Nasional)`. |
| `ESTIMATION_VIEW` | `FIXED_OWN` | `OWN_SCOPE` | `OWN_SCOPE` | Dropdown disembunyikan. Menampilkan `Cakupan: Cabang Pengguna (${branch})`. |
| `REPORT_CONFIRM` | `BRANCH_SCOPED` | `SPECIFIC_BRANCH`, `OWN_SCOPE` | `SPECIFIC_BRANCH` | Dropdown menampilkan pilihan Branch Tertentu atau Cabang Sendiri. `ALL_BRANCHES` dilarang keras. |
| `REPORT_FOLLOW_UP` | `BRANCH_SCOPED` | `SPECIFIC_BRANCH`, `OWN_SCOPE` | `SPECIFIC_BRANCH` | Dropdown menampilkan pilihan Branch Tertentu atau Cabang Sendiri. `ALL_BRANCHES` dilarang keras. |
| `REPORT_UPDATE_PROGRESS`| `BRANCH_SCOPED` | `SPECIFIC_BRANCH`, `OWN_SCOPE` | `SPECIFIC_BRANCH` | Dropdown menampilkan pilihan Branch Tertentu atau Cabang Sendiri. `ALL_BRANCHES` dilarang keras. |
| `REPORT_CLOSE` | `BRANCH_SCOPED` | `SPECIFIC_BRANCH`, `OWN_SCOPE` | `SPECIFIC_BRANCH` | Dropdown menampilkan pilihan Branch Tertentu atau Cabang Sendiri. `ALL_BRANCHES` dilarang keras. |
| `ESTIMATION_TRIGGER` | `BRANCH_SCOPED` | `SPECIFIC_BRANCH`, `OWN_SCOPE` | `SPECIFIC_BRANCH` | Dropdown menampilkan pilihan Branch Tertentu atau Cabang Sendiri. `ALL_BRANCHES` dilarang keras. |
| `WORK_READINESS_UPDATE` | `BRANCH_SCOPED` | `SPECIFIC_BRANCH`, `OWN_SCOPE` | `SPECIFIC_BRANCH` | Dropdown menampilkan pilihan Branch Tertentu atau Cabang Sendiri. `ALL_BRANCHES` dilarang keras. |
| `COMPLETION_SUBMIT` | `BRANCH_SCOPED` | `SPECIFIC_BRANCH`, `OWN_SCOPE` | `SPECIFIC_BRANCH` | Dropdown menampilkan pilihan Branch Tertentu atau Cabang Sendiri. `ALL_BRANCHES` dilarang keras. |
| `COMPLETION_APPROVE_COORDINATOR`| `BRANCH_SCOPED` | `SPECIFIC_BRANCH`, `OWN_SCOPE` | `SPECIFIC_BRANCH` | Dropdown menampilkan pilihan Branch Tertentu atau Cabang Sendiri. `ALL_BRANCHES` dilarang keras. |

---

## 3. UI/UX Form Redesign & Respon Kerapihan

1. **Penomoran Sekuensial Tanpa Lompatan (1, 2, 3, 4, 5):**
   - **1. Hak Akses:** Dropdown berbasis kategori disertai teks deskripsi ringkas fungsi hak akses.
   - **2. Jenis Pengaturan:** Tombol *Izinkan* (hijau) atau *Tolak* (merah).
   - **3. Cakupan:** Resolusi otomatis. Jika fixed, menampilkan summary card informatif. Jika selectable, menampilkan pilihan dan input pencarian branch target secara terpadu di dalam bagian 3.
   - **4. Masa Berlaku:** Pilihan *Sementara* (dengan input tanggal WIB lokal) atau *Permanen*.
   - **5. Alasan:** Area teks wajib diisi untuk audit logging.
2. **Kerapihan & Zero-Overflow Viewport:**
   - Dialog dibatasi `max-h-[88vh]` dengan container scroll internal yang mulus.
   - Tidak ada elemen yang terpotong pada resolusi laptop umum (1366 × 768, 1440 × 900, 1920 × 1080).
   - Banner peringatan diubah menjadi catatan kebijakan yang ringkas dan profesional.

---

## 4. Backend Validation & Security Enforcement

1. **Penolakan Payload Cakupan yang Bertentangan (HTTP 400):**
   - Pada `POST /api/admin/permissions/users/:userId`, backend memvalidasi `scopeType` terhadap `scopeRule.allowedScopes`.
   - Mengirimkan `SPECIFIC_BRANCH` atau `OWN_SCOPE` untuk `REPORT_VIEW_ALL` langsung ditolak dengan pesan kesalahan eksplisit.
   - Mengirimkan `ALL_BRANCHES` untuk izin operasional (`REPORT_UPDATE_PROGRESS`, `REPORT_CONFIRM`, dll.) langsung ditolak.
2. **Penanganan Override Ganda & Berselisih (Superseding):**
   - Saat override baru untuk suatu `permissionKey` dibuat, catatan override aktif sebelumnya untuk `permissionKey` tersebut otomatis ditutup (`revoked_at = NOW()`, `revoked_by = 'Admin (Digantikan)'`), menjaga tabel override tetap bersih tanpa duplikasi.
3. **Isolasi Mutasi Lintas Cabang (Zero Cross-Branch Mutation):**
   - Pada `lib/permission-service.ts` dan `lib/client-permissions.ts`, fungsi `doesOverrideScopeMatch` menolak pencocokan `ALL_BRANCHES` untuk seluruh izin bertipe operasional.
   - Branch Manager dengan override `REPORT_VIEW_ALL` dapat membaca seluruh laporan insiden secara nasional, tetapi permintaan mutasi (progress/close/confirm) pada laporan cabang lain tetap diblokir secara tegas (`403 Forbidden`).

---

## 5. Alur Insiden: Tim Toko → Konfirmasi → BMS Technical Handoff

- **Insiden Baru:** Saat Tim Toko membuat laporan insiden, status awalnya adalah `pending_confirmation`.
- **Visibilitas BMS:** Petugas BMS pada cabang yang sama tetap dapat membaca laporan insiden baru tersebut melalui `REPORT_VIEW_OWN`.
- **Kelayakan Tindakan Teknis:** Petugas BMS hanya dapat membuat estimasi teknis (`ESTIMATION_TRIGGER`) atau memperbarui progress setelah kondisi kerusakan diverifikasi dan dikonfirmasi (`in_maintenance`), sesuai kontrak siklus hidup operasional SPARTA SIAGA.

---

## 6. Hasil Pengujian Terautomasi & Verifikasi

1. **TypeScript Typecheck (`npx tsc --noEmit`):** **0 Errors**
2. **Linting Check (`npm run lint`):** **0 Errors**
3. **Admin Permission Scopes & Overrides (`scripts/test-admin-permission-scopes.ts`):** **33 / 33 PASSED (100%)**
   - Katalog Scope Rule: PASS
   - Fixed National Scope Auto-Resolution: PASS
   - Penolakan Cakupan Bertentangan: PASS
   - Isolasi Mutasi Operasional Lintas Cabang: PASS
   - Preseden Override DENY: PASS
   - Filter Kadaluarsa & Pencabutan: PASS
   - Zero Operational Bypass System Admin: PASS
   - Siklus BMS Technical Handoff: PASS
4. **Camera & Evidence Integration (`scripts/test-camera-and-evidence-workflow.ts`):** **9 / 9 PASSED**
5. **Persona Authorization & Branch Isolation (`scripts/test-notification-and-report-personas.ts`):** **35 / 35 PASSED**
6. **Production Build (`npm run build`):** **28 Routes Compiled Successfully**

---

## 7. Manual Browser Acceptance Steps

Jika pengujian browser otomatis subagent terkendala limit kapasitas server (503), berikut langkah verifikasi manual:
1. Login sebagai `usr_seed_admin` pada `http://localhost:3004/admin/users`.
2. Klik tab **"Akses Khusus User"**.
3. Pilih pengguna: `Demo Manager Branch` (Role `bm`, Cabang `CIKOKOL`).
4. Klik tombol **"Tambah Akses Khusus"**.
5. Pada pilihan *1. Hak Akses*, pilih **"Lihat Semua Laporan (Nasional)"**.
6. **Verifikasi:**
   - Bagian *3. Cakupan* langsung menampilkan kartu informatif: `Cakupan: Seluruh Cabang (Nasional)` (Read-Only).
   - Tidak ada dropdown cakupan yang redundan.
   - Urutan penomoran tetap 1, 2, 3, 4, 5 tanpa nomor yang terlewat.
7. Pilih jenis *Izinkan*, masukkan alasan valid, lalu klik **"Simpan Akses Khusus"**.
8. Refresh halaman dan pastikan status `DIIZINKAN` dengan cakupan `Seluruh Cabang (Nasional)` tetap persisten.
9. Buka menu Laporan sebagai Demo Manager Branch dan pastikan laporan dari cabang lain dapat dibaca namun tidak dapat diubah progress-nya.
