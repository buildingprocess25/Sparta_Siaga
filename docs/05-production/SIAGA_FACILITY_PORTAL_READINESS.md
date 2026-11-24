# Kesiapan Integrasi Master Fasilitas SIAGA ↔ CarbonTrack melalui Portal SPARTA (Task 5)

Dokumen ini merangkum hasil pemeriksaan kode `login-sparta` (branch `master`) dan implementasi SIAGA terkait rencana **Fase 4: Master Fasilitas**.

## 1. Status Kesiapan Aktual

### Portal SPARTA (`login-sparta`, branch `master`)
- `apps/api/prisma/schema.prisma` belum memiliki model `Facility`, tipe enum fasilitas, maupun aturan visibilitas modul fasilitas.
- `apps/api/src/modules/master/master.routes.ts` baru menyediakan endpoint `/v1/master/branches`, `/v1/master/areas`, dan `/v1/master/stores` — belum ada endpoint `/v1/master/facilities`.
- `docs/plan/sisa-plan-sparta.md` mencatat **Fase 4 (Master Fasilitas)** berstatus `Belum`, dengan prasyarat awal membandingkan data fasilitas CarbonTrack dan SIAGA sebelum menyepakati sumber master dan kontrak API Portal.

### SPARTA SIAGA (`sparta-siaga`, branch `dev`)
- SIAGA sudah memiliki tabel `facilities`, `facility_import_runs`, dan `facility_audit_logs` ([005_earthquake_facility_integration.sql](../../database/migrations/005_earthquake_facility_integration.sql)).
- Insiden gempa fasilitas menyimpan snapshot lokasi lokal (`location_kind='FACILITY'`, `location_id`, `location_code_snapshot`, `location_name_snapshot`, `location_type_snapshot`, `latitude_snapshot`, `longitude_snapshot`, `branch_snapshot`) sehingga laporan historis tidak terhapus jika master fasilitas berubah.
- Penyesuaian kode cabang Task 3 (`branch_id` dinormalisasi ke `branchCode` resmi Portal lewat `resolveActivePortalBranch` saat `SPARTA_BRANCH_MASTER_ENABLED=true`, dan query memakai `branchValueSqlKey`/`branchSqlParameter`) sudah siap.
- Utility rekonsiliasi pra-integrasi telah ditingkatkan pada [sparta-facility-comparison.ts](../../lib/sparta-facility-comparison.ts) dan [sparta-facility-compare.ts](../../scripts/sparta-facility-compare.ts).

## 2. Pemisahan Kepemilikan Data (Data Ownership)

Agar sinkronisasi di masa depan tidak menghapus histori atau pengaturan operasional masing-masing aplikasi:

| Pemilik Data | Atribut / Tabel | Aturan |
| --- | --- | --- |
| **Portal SPARTA** *(calon master bersama Fase 4)* | `code`, `name`, `initials`, `facilityType`, `branchCode`, `latitude`, `longitude`, `isActive`, `updatedAt` | Kode fasilitas bersifat permanen (soft-delete via `isActive=false`, tidak pernah dihapus permanen). `branchCode` mengacu ke master cabang Portal (`Branch.code`). |
| **SPARTA SIAGA** *(pengaturan operasional lokal)* | `mapping_verified_at`, `mapping_verified_by`, `operational_status`, `auto_report_enabled`, `facility_import_runs`, `facility_audit_logs`, snapshot lokasi `incidents` | Sinkronisasi master hanya boleh memperbarui identitas/lokasi/status master dan **tidak boleh** mengaktifkan/menonaktifkan `auto_report_enabled` atau menimpa verifikasi mapping SIAGA secara sepihak. |
| **CarbonTrack** *(atribut emisi lokal)* | `region` / pemetaan grid listrik & pencatatan energi | Tetap dikelola secara lokal oleh CarbonTrack tanpa mengubah data SIAGA. |

## 3. Kebutuhan Kontrak Portal SPARTA yang Masih Harus Dipenuhi

Sebelum client sinkronisasi Portal untuk fasilitas dapat diimplementasikan di SIAGA, Portal SPARTA dan pemilik bisnis perlu memenuhi lima hal berikut:

1. **Keputusan Sumber Master Awal:** rekonsiliasi hasil perbandingan data fasilitas SIAGA vs CarbonTrack untuk menetapkan sumber awal dan penyelesaian konflik kode/koordinat.
2. **Skema Master Fasilitas di Portal:** tabel `Facility` dengan kode unik permanen, relasi ke `Branch.code`, `isActive` untuk penonaktifan lunak, dan aturan keikutsertaan modul (`siaga`, `carbontrack`, dst.).
3. **Standarisasi Taksonomi Jenis Fasilitas:** penyelarasan tipe antara SIAGA (`DC`, `WAREHOUSE`, `DEPO`, `BULKY`, `STORE_HUB`) dan tipe fasilitas CarbonTrack (mis. mapping `STORE HUB` -> `STORE_HUB`).
4. **Kontrak API Internal Portal:** endpoint read-only internal (mis. `GET /v1/master/facilities?moduleId=siaga&updatedSince=...`) dengan autentikasi `x-sparta-internal-key`, respons `{ data, meta: { syncedAt, count } }` selaras dengan `/v1/master/stores`.
5. **Kebijakan Validitas Koordinat & Kode Cabang:** kejelasan apakah koordinat boleh bernilai `null` di Portal dan bagaimana perlakuan evaluasi gempa SIAGA jika fasilitas non-aktif atau belum berkoordinat valid.

## 4. Prosedur Rekonsiliasi Pra-Integrasi (Read-Only)

Semua perintah berikut bersifat **read-only** terhadap database SIAGA dan tidak mengubah tabel atau migration apa pun:

1. **Ekspor master fasilitas SIAGA** untuk dibagikan ke tim Portal & CarbonTrack:
   ```powershell
   node --env-file=.env.local --import tsx scripts/sparta-facility-compare.ts --export-siaga=scratch/siaga-facilities.json
   ```
2. **Bandingkan dengan ekspor fasilitas CarbonTrack** (menggunakan resolusi alias cabang resmi Portal bila file cabang atau API Portal tersedia):
   ```powershell
   node --env-file=.env.local --import tsx scripts/sparta-facility-compare.ts --carbontrack=<path-export-carbontrack.json> --from-portal-branches
   ```
   Atau secara offline menggunakan JSON hasil `/v1/master/branches`:
   ```powershell
   node --import tsx scripts/sparta-facility-compare.ts --carbontrack=<path-export-carbontrack.json> --branches=<path-portal-branches.json>
   ```

Laporan JSON akan merinci `onlySiaga`, `onlyCarbontrack`, `different` (beserta nilai sisi SIAGA dan CarbonTrack), `missingCoordinates`, dan `unmappedBranches` untuk ditindaklanjuti sebelum kontrak API fasilitas Portal dibangun.
