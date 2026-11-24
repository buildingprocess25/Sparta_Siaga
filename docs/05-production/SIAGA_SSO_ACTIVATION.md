# Aktivasi pengelolaan user SIAGA dari SSO

Source SIAGA kini menerima pemberian akses, perubahan role, dan pencabutan melalui `POST /internal/sparta/provision`. Ini menggantikan langkah persetujuan scope manual pada provisioning sebelumnya. Dokumen ini memperbarui bagian provisioning pada `SIAGA_PORTAL_CHECKLIST_2026-11-23.md`; pengunci konversi cabang/toko tetap berlaku.

## Perilaku

- Role modul SIAGA dari portal menjadi `business_role`. Scope HO/BRANCH diturunkan dari katalog SIAGA. `ADMIN` pada katalog modul berarti Admin HO, bukan System Admin.
- User baru yang valid langsung ACTIVE dan tidak mendapat password lokal. Perubahan role/status/scope membatalkan sesi lama. Role tidak dikenal ditolak; pencabutan tetap diproses meskipun role lama tidak dikenal.
- Akun lama dicocokkan melalui ID portal, NIK, lalu email. Konflik identitas dibatalkan tanpa mengganti akun. ID lokal dan referensi histori laporan tetap dipertahankan.
- Sebelum konversi akhir, cabang akun lama dipertahankan. User baru memakai padanan nama cabang SIAGA: kecocokan nama langsung atau alias resmi portal. Padanan yang tidak ada/ambigu ditolak dan terlihat sebagai event gagal di portal.
- Perpindahan cabang akun lama mengikuti tahap konversi akhir. Area belum dikirim dalam kontrak provisioning portal; jangan menganggap area sudah tersinkronisasi.
- Permission per role dan override khusus tetap lokal. System Admin yang sudah ada tidak dipromosikan/didemotasikan dari role modul portal.

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
