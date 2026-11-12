# Integrasi Gempa dan Master Fasilitas  -  Design

## Tujuan

Memperluas SPARTA SIAGA agar satu kejadian gempa kanonis dapat mengevaluasi Toko dan 67 fasilitas, membuat tepat satu laporan per kejadian dan lokasi, menempatkannya dalam shared queue berbasis cabang, serta mempertahankan workflow, histori, keamanan, dan PWA yang sudah berjalan. Seluruh operasi database pengembangan dibatasi ke `sparta_siaga_isolated`; `defaultdb` tidak boleh menerima operasi tulis.

## Hasil audit existing

- Next.js 16, React 19, TypeScript, PostgreSQL `pg`, Leaflet marker clustering, dan PWA sudah digunakan.
- `earthquake_events`, worker server-side, korelasi BMKG/USGS, evaluasi radius, laporan otomatis, permission backend, notification log, evidence privat, milestone, approval completion, peta, dashboard, dan histori sudah tersedia.
- Migration `002_earthquake_store_dedup.sql` memberi unique index hanya untuk laporan `automatic_earthquake` pada `(earthquake_event_id, store_id)`. Ini belum melindungi manual-first, fasilitas, atau identitas lokasi bertipe.
- `incidents.store_id`, `store_name`, dan `branch` masih wajib. Kompatibilitas harus dijaga sembari menambah identitas lokasi generik dan snapshot.
- Excel `data/KOORDINAT GUDANG.xlsx` memiliki satu sheet, 67 record valid: DC 28 (source category `BRANCH`), Warehouse 13, Depo 9, Bulky 5, Store Hub 12. Kode unik. WH BALARAJA1 dan WH BALARAJA2 memiliki koordinat sama dan tetap dua fasilitas.
- Worktree sudah memiliki perubahan pengguna pada `app/layout.tsx`, `scripts/test-pwa-installability.ts`, serta file Excel untracked. Perubahan itu tidak boleh ditimpa.

## Alternatif yang dipertimbangkan

### A. Menyimpan fasilitas di `stores`

Perubahan paling sedikit, tetapi jenis lokasi, ownership, dan query store lama menjadi ambigu. Risiko regresi non-gempa tinggi.

### B. Modul fasilitas paralel

Schema bersih, tetapi menggandakan laporan, approval, evidence, notification, dan peta. Ini bertentangan dengan kebutuhan satu sistem terintegrasi.

### C. Master fasilitas terpisah + identitas lokasi kompatibel

Pilihan yang digunakan. `facilities` menjadi master fasilitas, sedangkan `incidents` mendapat `location_kind`, `location_id`, snapshot lokasi, dan field assignment secara additive. Kolom store lama dipertahankan untuk kompatibilitas. Semua lokasi tetap memakai lifecycle laporan yang sama.

## Model data

Migration additive membuat:

- `facilities`: kode stabil unik, nama, jenis, koordinat, `branch_id` nullable, status, `auto_report_enabled`, metadata sumber, waktu sinkronisasi, timestamps.
- `facility_import_runs` dan `facility_audit_logs`: hasil preview/import dan perubahan field tanpa kredensial atau payload sensitif.
- `earthquake_source_events`: identitas provider dan relasi ke canonical event sehingga BMKG/USGS dapat dikorelasikan tanpa kehilangan provenance.
- `incident_pic_history`: histori claim, transfer, dan release PIC.
- `incident_repair_links`: many-to-many antara laporan dan pekerjaan perbaikan existing, dengan verifikasi manusia.
- `earthquake_reconciliation_cases`: kasus manual lama atau pencocokan ambigu yang memerlukan review Admin.

Kolom additive pada `incidents`:

- `canonical_event_id`, `location_kind`, `location_id`.
- `location_code_snapshot`, `location_name_snapshot`, `location_type_snapshot`, `latitude_snapshot`, `longitude_snapshot`, `branch_snapshot`.
- `primary_pic_user_id`, `primary_pic_claimed_at`.

Constraint unik menggunakan `(canonical_event_id, location_kind, location_id)` untuk semua laporan gempa yang sudah tertaut, bukan hanya laporan otomatis. Baris legacy tanpa canonical event tetap valid. Linking manual-first dilakukan dalam transaksi dengan advisory lock berbasis kandidat event+lokasi; kecocokan ambigu masuk reconciliation case dan tidak menggabungkan data.

## Import fasilitas

Parser source-independent menghasilkan record ternormalisasi dan daftar error. Adapter Excel membaca workbook saat import saja; worker selalu membaca database. Source category `BRANCH` dipetakan ke tipe fasilitas `DC`, bukan ke cabang organisasi.

Alur import:

1. Parse dan validasi header, kode, kategori, serta rentang koordinat.
2. Preview `new`, `changed`, `unchanged`, `invalid` tanpa menulis.
3. Pada apply, verifikasi `SELECT current_database()` bernilai tepat `sparta_siaga_isolated`.
4. Upsert berdasarkan kode fasilitas dalam transaksi.
5. Update koordinat/source fields, tetapi pertahankan `branch_id` dan `auto_report_enabled` yang dikelola Admin.
6. Jangan menghapus record yang hilang dari source.
7. Catat import run dan audit perubahan.

`FacilitySourceAdapter` menjaga jalur Google Sheets di masa depan tanpa OAuth atau konfigurasi palsu sekarang.

## Canonical event dan pembuatan laporan

Korelasi sumber memakai time window configurable, toleransi jarak episentrum, magnitudo, dan kedalaman. Match menghubungkan source event ke canonical event; tidak mengubah identitas canonical yang sudah dipakai laporan. Event berbeda - termasuk susulan dalam 15 menit - tetap terpisah bila tidak memenuhi seluruh toleransi korelasi.

Worker memuat Toko dan fasilitas aktif yang telah memiliki mapping cabang terverifikasi. Evaluasi radius memakai rule existing. Pembuatan laporan berjalan per lokasi dalam transaksi dan menggunakan constraint generik serta conflict handling agar dua worker menghasilkan satu record. Retry hanya memperbarui metadata source/correlation yang aman; laporan `CLOSED` tidak dibuka atau ditimpa.

Manual-first menautkan laporan yang cocok secara non-destruktif dan mempertahankan status, evidence, serta timeline manual. Automatic-first mengembalikan laporan existing kepada flow manual. Kecocokan yang tidak tunggal tidak dipaksakan.

## Shared queue, PIC, dan repair link

- BMS melihat queue Toko dalam cabangnya.
- BES melihat queue fasilitas dalam cabangnya.
- BMM melihat keduanya dalam cabangnya.
- HO hanya membaca nasional; Admin memiliki akses administratif lintas cabang.

Claim PIC menggunakan conditional `UPDATE ... WHERE primary_pic_user_id IS NULL` di dalam transaksi. Hanya satu claim berhasil. Transfer/release memerlukan capability backend dan selalu menulis histori. PIC tidak mengubah identitas laporan.

Satu pekerjaan perbaikan dapat ditautkan ke beberapa laporan melalui relasi many-to-many. Tautan dibuat oleh petugas berwenang setelah verifikasi; sistem tidak menyalin biaya atau progres.

## Notifikasi

Ringkasan menggunakan key idempoten `(canonical_event_id, branch_id, recipient_group, category)`. Bertambahnya lokasi memperbarui ringkasan existing. Kegagalan delivery dicatat setelah transaksi laporan dan tidak membatalkan laporan. Approval action tetap memakai jalur notifikasi existing.

## API dan otorisasi

Semua endpoint memakai identitas session server-side dan policy terpusat:

- Admin: CRUD mapping, activation, preview/apply sync, audit fasilitas.
- BMS/BES/BMM: list queue sesuai jenis lokasi dan cabang; claim/transfer sesuai capability.
- HO: GET nasional; seluruh mutation ditolak server-side.
- Evidence dan dokumen tetap melalui protected endpoint dan validasi magic bytes/MIME existing.

Filter UI bukan batas keamanan. Query database selalu memuat predicate scope yang sama dengan policy endpoint.

## UI dan arah visual

Arah visual mengikuti aplikasi existing: biru korporat SPARTA, surface terang/gelap existing, densitas operasional, dan komponen yang sudah dipakai. Tidak membuat aset visual baru.

Design Read: ENERGY 2, RHYTHM 2, MOTION 1. Tujuannya adalah keterbacaan operasional, bukan dekorasi. Warna status selalu disertai label/ikon. Kontrol minimum 44×44 px. Focus state, empty/loading/error, keyboard flow, dan Escape pada dialog wajib tersedia.

- Admin Master Fasilitas: tabel responsif, filter kategori/cabang/status mapping, edit koordinat/mapping/activation, preview sync, dan audit drawer.
- Shared Queue: pemisahan Toko/Fasilitas sesuai role, urut waktu tunggu, status, dan PIC; mobile memakai list, bukan tabel terjepit.
- Peta default Mode Kejadian; Mode Lokasi tersedia melalui segmented control. Marker membedakan paparan, belum diperiksa, tidak terdampak, rusak, ditangani, selesai tanpa menyamakan radius dengan kerusakan.
- Detail marker desktop memakai panel; mobile memakai bottom sheet yang tidak menutup kontrol dan menghormati safe area.
- Dashboard memakai KPI dan action list existing, menambah fasilitas, queue, PIC, serta waiting age tanpa statistik dekoratif.

## Failure handling dan observability

- Semua script mutasi database gagal sebelum write bila current database bukan isolated.
- Import invalid melaporkan nomor baris dan alasan; valid rows tidak diterapkan bila mode atomic dipilih.
- Worker failure per lokasi tidak menghentikan lokasi lain, tetapi dicatat dengan canonical event dan location identity.
- Ambiguous reconciliation, notification failure, PIC conflict, dan skipped unmapped facility memiliki audit record terstruktur tanpa credential.

## Strategi pengujian

Perubahan perilaku dibuat dengan red-green-refactor. Suite mencakup 27 skenario wajib dari master prompt, dikelompokkan menjadi parser/import, database constraints/concurrency, canonical correlation, workflow/authorization, notification aggregation, map/API, mobile/PWA, dan regression non-earthquake.

Verifikasi akhir menjalankan lint, TypeScript, build, integration tests terhadap `sparta_siaga_isolated`, serta E2E desktop/mobile bila runtime browser tersedia. Setiap hasil dilaporkan PASS/FAIL berdasarkan output aktual. Tidak ada klaim untuk test yang tidak dijalankan.

## Urutan delivery

1. Database safety, schema additive, parser/import preview/apply.
2. Canonical source correlation dan deduplikasi generic.
3. Worker fasilitas, shared queue, atomic PIC, repair link.
4. API ber-scope dan notifikasi ringkasan.
5. Admin, peta dua mode, dashboard, mobile/PWA.
6. Migration/import isolated, regression, E2E, dan laporan implementasi.

Setiap tahap harus dapat diuji sendiri dan tidak memerlukan deployment, commit, push, atau akses production.
