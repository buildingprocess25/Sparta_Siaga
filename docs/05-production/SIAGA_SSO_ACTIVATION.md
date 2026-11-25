# Aktivasi pengelolaan user SIAGA dari SSO

Source SIAGA menerima pemberian akses, pembaruan identitas, dan pencabutan akses melalui `POST /internal/sparta/provision`. Dokumen ini memperbarui bagian provisioning pada `SIAGA_PORTAL_CHECKLIST_2026-11-23.md` agar selaras dengan kontrak `login-sparta` branch `master`; pengunci konversi cabang/toko tetap berlaku.

## Perilaku

- **Manajemen user terpusat di Portal SPARTA:** penambahan akun baru, perubahan identitas (`name`, `nik`, `email`), cabang, role operasional, status akun, serta pemberian/pencabutan akses modul SIAGA dilakukan melalui Portal SPARTA dan dikirim otomatis ke `POST /internal/sparta/provision` tanpa menunggu pengguna login pertama kali.
- Pada `access.granted`, SIAGA otomatis membuat akun lokal (atau mengaktifkan kembali akun yang sebelumnya dicabut), menetapkan `business_role` dari katalog 8 role aktif SIAGA (`admin`, `bm`, `bms`, `bmc`, `bes`, `bec`, `bbs`, `bbc`), dan menurunkan `scope` (`HO`/`BRANCH`) secara otomatis. `ADMIN` pada katalog modul berarti Admin HO, bukan System Admin.
- Pada `user.updated`, portal hanya menyinkronkan identitas (`spartaUserId`, `nik` dengan perlindungan `COALESCE` agar NIK existing tidak terhapus oleh `null`, `name`, `email`, `pending_portal_branch`) dan status nonaktif/blokir apabila akses dicabut; `business_role` dan `scope` lokal yang sudah ada tetap dipertahankan dan tidak ditimpa.
- Menu **Manajemen Pengguna & Peran** di SIAGA bersifat informasional untuk akun operasional (menonaktifkan pembuatan, pengeditan operasional, dan penghapusan user di SIAGA agar tidak menduplikasi Portal) sambil tetap mempertahankan daftar pengguna, detail izin efektif, **Hak Akses Role**, dan **Akses Khusus User**.
- User baru yang valid langsung `ACTIVE` tanpa password lokal. Perubahan role/status/scope/cabang atau pencabutan akses membatalkan sesi lama (`token_version` dinaikkan dan `user_sessions` dicabut). Role awal di luar 8 role aktif ditolak (`422`); pencabutan tetap diproses meskipun role lama tidak dikenal.
- Akun lama dicocokkan melalui ID portal, NIK, lalu email; penautan ulang ID legacy pada akun `LOCAL` non-admin diizinkan secara aman oleh provisioning, sedangkan konflik antar-akun SSO tetap ditolak (`409`). ID lokal dan referensi histori laporan tetap dipertahankan.
- Sebelum konversi akhir (`SPARTA_BRANCH_MASTER_ENABLED=false`), cabang akun lama yang masih valid dipertahankan. User baru (atau user yang baru mendapat cakupan `BRANCH` tanpa cabang valid) memakai padanan nama cabang SIAGA: kecocokan nama langsung atau alias resmi portal. Pada saat konversi aktif (`SPARTA_BRANCH_MASTER_ENABLED=true`), transisi `BRANCH` ↔ `HO` ikut menyelaraskan atau mengosongkan `branch` dan `branch_code`.
- Permission per role (`role_permissions`) dan override khusus (`user_permission_overrides`) tetap dikelola lokal di SIAGA. Akun `SYSTEM_ADMIN` darurat lokal dilindungi dari provisioning Portal (tidak dipromosikan, didemotasikan, maupun dinonaktifkan oleh event Portal) dan rotasi password darurat lokalnya tetap tersedia hingga pengganti terverifikasi.

Kebutuhan backfill dan koordinasi data Portal terdokumentasi di [SIAGA_PORTAL_DATA_COORDINATION.md](./SIAGA_PORTAL_DATA_COORDINATION.md).

## Penerapan

1. Uji source dan migrasi tahap user di database salinan, lalu terapkan ke target operasional yang benar. Database yang diaudit belum memiliki `sso_status`; endpoint memerlukan migrasi 018 dan 020. Runner biasa tetap menunda migrasi 021. Jangan menggunakan migrasi gabungan 019.
2. Deploy source SIAGA. Tetapkan `SPARTA_PROVISIONING_SECRET` SIAGA sama dengan `SPARTA_PROVISIONING_SECRET_SIAGA` pada backend portal, minimal 32 karakter. Portal memerlukan `SPARTA_PROVISIONING_WORKER_ENABLED=true`. Untuk pemetaan nama cabang baru melalui alias, SIAGA memerlukan URL API dan internal key portal yang benar.
3. Dari folder repo SIAGA, gunakan script bootstrap dengan environment **backend portal**, bukan `.env.local` SIAGA:

```powershell
node --env-file=<file-env-backend-portal-aktual> --import tsx scripts/sparta-siaga-bootstrap.ts
```

Argumen path di atas adalah placeholder, bukan perintah siap salin. Repo portal lokal dibaca dari `../login-sparta`, atau `SPARTA_PORTAL_REPO`. Preview menampilkan jumlah grant/revoke dan role tidak dikenal tanpa menulis database. Jangan menimpa environment deployment dengan file development/uat. Pastikan variabel DATABASE_URL pada shell tidak mengarah ke database lain karena env shell mengungguli `--env-file`.

4. Setelah preview dan uji receiver satu user sesuai, ulangi perintah dengan `--apply`. Script memasang katalog role SIAGA dan URL receiver, lalu mengantrekan snapshot akses dari database pusat dalam transaksi. Tidak mengubah grant pengguna di pusat. User pusat tanpa grant SIAGA dikirim sebagai pencabutan agar akun lama yang cocok tidak mempertahankan akses. Script tidak mengirim event ke modul lain.

   Default receiver: `https://siaga.sparta-alfamart.web.id/internal/sparta/provision`. Jika URL pada konfigurasi modul sudah ada, script memakainya. Override eksplisit tersedia melalui `--receiver-url=https://.../internal/sparta/provision`.

5. Periksa status pengiriman pada portal sampai DELIVERED. QUEUED bukan bukti SIAGA sudah menerima. Perbaiki alias/konflik yang gagal, kemudian retry lewat portal. Uji login user baru, ganti role, revoke, dan pastikan sesi lama ditolak. `SPARTA_BRANCH_MASTER_ENABLED` tetap false.

Akun SIAGA yang sama sekali tidak ada dalam database pusat tidak termasuk pengiriman ulang ini. Akun LOCAL tetap mengikuti kebijakan transisi. Periksa keduanya secara terpisah sebelum menghapus akses atau akun. Script tidak menghapus histori.

## Batas verifikasi

Tes source memakai adapter database tiruan serta router/worker portal lokal; tidak membuktikan migrasi atau delivery production. Sesi agent tidak dapat mengakses koneksi PostgreSQL operasional (EACCES). Tidak ada migrasi, perubahan environment, bootstrap production, atau deploy yang telah dilakukan oleh agent.
