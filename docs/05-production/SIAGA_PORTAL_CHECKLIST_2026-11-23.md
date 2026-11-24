# Integrasi SIAGA ke Portal SPARTA: penerapan bertahap

**Pembaruan provisioning otomatis:** [SIAGA_SSO_ACTIVATION.md](./SIAGA_SSO_ACTIVATION.md) menggantikan ketentuan persetujuan scope manual dan pemeliharaan role lokal pada dokumen ini. Role modul kini mengikuti portal dan scope diturunkan otomatis. Urutan konversi cabang/toko tetap ditunda.

Diperbarui 23 November 2026. Perubahan ada di source lokal; belum di-push, di-deploy, atau diterapkan ke database production.

**Patch gabungan `sparta-siaga-portal-integration.patch` yang dibagikan sebelumnya sudah kedaluwarsa. Jangan gunakan patch itu atau menjalankan migrasi 019.** Dokumen ini menggantikan urutan penerapan sebelumnya.

## Urutan dan pengunci

| Tahap | Perubahan | Kondisi bawaan |
| --- | --- | --- |
| User / fase 1 dan 2B | ID portal untuk SSO, provisioning user, pencabutan sesi | Dapat disiapkan terpisah dari master cabang |
| Cabang dan toko / tahap terakhir | Kode cabang, alias, backfill, master toko portal | Terkunci: `SPARTA_BRANCH_MASTER_ENABLED=false` |
| Fasilitas | Perbandingan data SIAGA dengan CarbonTrack | Menunggu kesepakatan sumber dan API portal |

SIAGA tetap menyimpan database operasionalnya. Portal menjadi sumber identitas dan master yang disepakati. Data gempa, histori laporan, snapshot insiden, permission lokal, dan pengaturan fasilitas lokal tidak digabung atau ditulis ulang oleh tahap user.

## Perbaikan setelah audit

- Migrasi gabungan 019 dipindahkan ke `database/migrations-archive/` sebagai referensi, di luar direktori migrasi aktif.
- Migrasi **020** hanya menambahkan metadata provisioning user, data cabang portal tertunda, indeks ID portal, dan checkpoint event. Tidak menambahkan kode cabang pada insiden atau toko, tidak memasang trigger cabang, dan tidak mengonversi data cabang.
- Migrasi **021** memuat schema dan trigger untuk tahap cabang/toko. Runner biasa melewatinya. Runner memerlukan `--include-master-conversion` serta `SPARTA_BRANCH_MASTER_ENABLED=true` untuk menyertakannya. Kalau migrasi gabungan 019 sudah tercatat di ledger, runner berhenti untuk pemeriksaan manual.
- Provisioning pada tahap awal menyimpan cabang portal di `users.pending_portal_branch`; tidak menimpa `users.branch`, scope, business_role user lama, atau permission lokal. User baru memperoleh role awal tetapi menunggu pengaturan scope dan cabang oleh admin SIAGA sebelum SSO dapat mengaktifkannya.
- Query insiden dan akses cabang pada tahap awal memakai teks lama tanpa bergantung pada fungsi SQL atau kolom cabang dari migrasi 021.
- Alias hanya dipetakan ke cabang portal aktif. Kode cabang lama yang sudah nonaktif dapat menjadi alias cabang aktif. Alias ambigu atau tidak dikenal menghentikan konversi.
- Script toko tanpa argumen sekarang hanya preview. Penulisan perlu `--apply`, flag tahap akhir, dan migrasi 021. Sync penuh/pertama memerlukan `--confirm-full`; daemon tidak boleh melakukan sync penuh pertama secara diam-diam.
- Jika sumber toko portal diaktifkan tetapi flag tahap akhir mati, operasi toko ditolak; tidak beralih diam-diam ke sync sumber lama.
- Preview toko menampilkan jumlah toko baru/cocok, kode toko yang akan dinonaktifkan, dan jumlah data tanpa alamat portal. Preview tidak mengubah data atau histori sync.

## Posisi data aktual

Berdasarkan output readiness yang diberikan pengguna: LOCAL 21 user (10 tanpa external_user_id), SPARTA_SSO 563 user (seluruhnya terisi), tanpa kelompok duplikasi ID portal atau kode toko. `columns: []` menunjukkan kolom integrasi baru yang diperiksa belum ditemukan saat audit itu.

**Isi ID aktual belum dibandingkan dengan ekspor portal. Terisi bukan berarti sudah terbukti sama.** Pengguna telah melaporkan backup Dokploy database `siaga` selesai. Pemulihan backup belum diuji dalam pekerjaan ini.

## Pemulihan setelah percobaan tahap akhir

Percobaan yang dilaporkan pengguna berhenti pada checksum drift migrasi 016, sebelum loop penerapan migrasi. Karena itu log tersebut tidak menunjukkan 020 atau 021 diterapkan. Percobaan sync toko berhenti saat membaca tabel cursor yang belum ada; master toko belum ditulis, tetapi satu catatan histori gagal mungkin sudah dibuat oleh versi script sebelumnya.

Matikan flag di terminal yang tadi digunakan, lalu periksa ledger lewat mode status yang hanya membaca database:

```powershell
$env:SPARTA_BRANCH_MASTER_ENABLED = 'false'
node --env-file=.env.local scripts/migrate-production.mjs --status
```

`--status` membuka transaksi READ ONLY, membaca ledger dan kolom integrasi, lalu ROLLBACK. Perintah ini tidak membuat tabel ledger, tidak menjalankan SQL migrasi, dan tidak mengubah checksum. Exit code 1 jika ada drift merupakan temuan audit, bukan alasan untuk memaksa apply.

Audit status lanjutan dari pengguna memperlihatkan 001–015 APPLIED, 016–017 CHECKSUM_DRIFT, 018 dan 020 PENDING, serta 021 PENDING/deferred. Tidak ada file ledger tanpa pasangan lokal; kolom integrasi yang diperiksa belum ditemukan.

Riwayat Git seluruh branch lokal kemudian diperiksa. Kedua file dari commit `fea1c0f86e1b4adab8ed529a5df485bf81a0576f` menghasilkan SHA-256 yang persis sama dengan ledger production:

| Migrasi | SHA-256 yang cocok dengan ledger |
| --- | --- |
| 016 | `2fe1f9271485e5b614c559531d500a983cdd8f82d5fa3ab5f493a29f4eb83651` |
| 017 | `9625163ac23b72d05d7f5a2174111d8ab6d58b1c648ea54995ca334daff799eb` |

Perbedaan file hanya berupa spasi di akhir baris, baris kosong terakhir, dan line ending checkout Windows; perintah SQL tidak berubah. Kedua file lokal dipulihkan byte demi byte dari commit tersebut. Aturan `.gitattributes` terbatas pada dua file ini menjaga LF saat checkout berikutnya. File migrasi lain tidak dinormalisasi karena checksum-nya sudah cocok.

Ledger database tidak diubah dan validasi drift tidak dilonggarkan. Kesesuaian byte lokal sudah diuji; ulangi `--status` untuk konfirmasi baca langsung pada database. Hasil APPLIED pada 016/017 setelah pemulihan file tidak berarti SQL dijalankan ulang. Migrasi 018/020 tetap menunggu pengujian dan penerapan tahap user; 021 tetap ditunda.

Jika belum mempunyai ekspor portal, jangan menjalankan argumen `--portal-users` dengan path contoh. Konfigurasi master portal juga harus lengkap sebelum preview dapat berjalan; nilai internal API key tidak ditambahkan otomatis oleh SIAGA.

## Pemeriksaan yang boleh dijalankan sekarang

Perintah berikut memeriksa source atau membaca data. Tidak melakukan migrasi/backfill/sync.

```powershell
cd 'C:\buildingprocess25\sparta-siaga'
node scripts/migrate-production.mjs --plan
node scripts/migrate-production.mjs --validate-only
pnpm exec tsx --test tests/sparta-portal-checklist.test.ts tests/sparta-portal-cross-service.test.ts tests/sparta-store-ownership-render.test.tsx tests/sparta-migration-safety.test.mjs
```

Audit identitas memerlukan ekspor resmi portal. Tentukan path file aktual terlebih dahulu; `C:\temp\portal-users.json` sebelumnya hanya contoh nama file, bukan file yang sudah dibuat. Script sekarang memeriksa keberadaan dan format file sebelum membuka koneksi database.

Untuk preview master, isi `SPARTA_API_URL` dan `SPARTA_INTERNAL_API_KEY` sesuai backend portal tujuan. Jangan mengganti environment aplikasi production dengan contoh localhost. Endpoint master memakai header `x-sparta-internal-key`.

```powershell
node --env-file=.env.local --import tsx scripts/sparta-portal-branches.ts
node --env-file=.env.local --import tsx scripts/sparta-portal-stores.ts
```

Hasil cabang yang tidak terpetakan atau ambigu harus diselesaikan lewat alias portal, tanpa menebak kode. Preview dapat dijalankan sebelum migrasi 021.

## Tahap user: uji di database salinan terlebih dahulu

Gunakan database salinan terpisah yang dapat diakses. Jangan menjalankan tes yang menulis data dengan `.env.local` yang sekarang menunjuk production. Aiven tidak wajib; database pengujian boleh menggunakan PostgreSQL terpisah yang tersedia.

1. Bandingkan ID dengan ekspor portal, periksa duplikasi dan ledger migrasi, lalu uji backup/restore pada database salinan.
2. Pertahankan `SPARTA_BRANCH_MASTER_ENABLED=false` dan sumber toko lama (`STORE_MASTER_SOURCE=sheet` jika memakai mekanisme lama).
3. Pada database salinan saja, jalankan runner biasa. Runner menerapkan migrasi lama yang belum tercatat serta 020, dan melewati 021. Periksa ledger sebelum menerapkannya ke production.
4. Siapkan `SPARTA_PROVISIONING_SECRET` SIAGA sama dengan `SPARTA_PROVISIONING_SECRET_SIAGA` di portal, minimal 32 karakter. Secret tetap berada di environment, bukan repo.
5. Portal harus memiliki katalog role SIAGA serta provisioning URL `https://siaga.sparta-alfamart.web.id/internal/sparta/provision`. Katalog role SIAGA pada source portal yang diperiksa masih perlu diisi oleh pengelola portal.
6. Uji satu user: grant, penetapan scope/cabang lokal, login SSO dengan ID portal, akses hanya cabangnya, lalu revoke/deactivate dan penolakan sesi lama. Pastikan cabang user lama tidak berubah akibat `user.updated`.
7. Login lokal bagi `source=LOCAL` selama transisi membutuhkan `SPARTA_LOCAL_LOGIN_TRANSITION_ENABLED=true` pada production/UAT. Akun portal tetap memakai SSO. Nilai bawaan flag ini false.
8. Setelah pengujian salinan lulus, tentukan jadwal penerapan tahap user. Tahap cabang/toko tetap ditunda.

Katalog role yang diterima: admin, ho_admin, gm_ho, sm_ho, bm, bms, bmc, bes, bec, bbs, bbc. Receiver tidak memberikan system role ADMIN. Role tim_toko dan rekanan tetap ditolak.

## Tahap terakhir: cabang dan toko

Lakukan hanya setelah seluruh modul siap dan pengelola portal mengoordinasikan konversi terakhir. Jangan menjalankan perintah ini sekarang di production.

1. Ulangi preview cabang dan toko terhadap master portal final. Sepakati daftar perubahan sekitar 120 user bersama tim portal, termasuk pemetaan nama lama seperti CILEUNGSI dan BALARAJA. Jangan memasukkan mapping tersebut secara hardcode di SIAGA.
2. Selesaikan alamat toko bersama portal: API yang diperiksa belum mengirim `address`. Adapter SIAGA menerima address bila tersedia; alamat lama dipertahankan saat field itu tidak ada, sedangkan toko baru dapat kosong.
3. Buat backup terbaru dan hentikan sementara penulisan aplikasi, worker, sync toko lama, serta pengiriman provisioning selama konversi. Ini mencegah proses lama mengubah data di tengah perpindahan.
4. Setelah semua prasyarat dipenuhi, susun urutan migrasi 021, backfill cabang, dan sync penuh yang menghentikan proses saat satu langkah gagal. Uji urutan tersebut pada database salinan. Perintah penulisan tidak disertakan di bagian ini agar tidak ikut dijalankan sebagai langkah pemeriksaan sekarang. Runner tahap akhir juga mensyaratkan konfigurasi portal lengkap sebelum membuka koneksi database.

5. Setelah seluruh langkah berhasil, set environment runtime aplikasi/worker `SPARTA_BRANCH_MASTER_ENABLED=true` dan `STORE_MASTER_SOURCE=portal`, lalu restart. Flag dalam shell PowerShell tidak otomatis mengubah environment Dokploy.
6. Periksa hasil kode cabang user/toko/insiden, approval/override/audit permission, pembatasan akses cabang, jumlah toko aktif, histori sync, dan snapshot insiden. Baru lanjutkan penulisan dan pengiriman provisioning.

Jangan menganggap mematikan flag sebagai rollback data: konversi mengubah nilai pada kolom kode dan sumber toko. Jika gagal di tengah tahap terakhir, pertahankan penghentian penulisan dan periksa hasil transaksi serta backup sebelum melanjutkan atau memulihkan.

## Fasilitas

Utility `scripts/sparta-facility-compare.ts` hanya membandingkan registry SIAGA dengan ekspor CarbonTrack. Pemilihan master awal dan kontrak API fasilitas masih memerlukan kesepakatan. Sync fasilitas belum diimplementasikan. `auto_report_enabled` dan `mapping_verified_*` tetap lokal.

## Validasi lokal dan batasnya

- 64 tes integrasi/regresi lulus, termasuk mode awal tanpa master cabang, pengunci konversi, alias cabang nonaktif, preview toko tanpa penulisan, dan konfirmasi sync penuh.
- Tes kontrak menggunakan router/worker dari source lokal login-sparta dengan transport dalam proses dan adapter database tiruan. Hasil ini belum membuktikan deployment portal atau migrasi PostgreSQL aktual.
- Typecheck terfokus lulus. Typecheck seluruh workspace masih memiliki tiga error lama pada `app/api/auth/gate-verify/route.ts`, di luar perubahan integrasi.
- ESLint modul integrasi dan tes lulus tanpa error. `lib/incident-assignment.ts` memiliki satu warning `any` yang sudah ada sebelumnya.
- Validator nama/checksum menerima 20 file migrasi aktif; validator tidak menjalankan SQL. Rencana bawaan menandai 020 eligible dan 021 deferred.
- Agent tidak mengubah `.env.local`, database production, konfigurasi Dokploy, atau repo portal. Percobaan perintah oleh pengguna beserta kemungkinan catatan histori sync dicatat pada bagian pemulihan di atas. Tidak ada commit, push, atau deploy oleh agent.

Belum dinyatakan siap production sampai migrasi dan alur user berhasil diuji pada database salinan serta ID aktual selesai dibandingkan dengan portal.
