# SPARTA SIAGA: Panduan Simulasi Atasan & Pengujian UAT

Dokumen ini memuat panduan langkah demi langkah bagi Manajemen dan Penguji untuk memvalidasi alur bisnis SPARTA SIAGA sesuai flowchart kanonikal dan arsitektur otorisasi multi-peran.

---

## 🔑 Akun UAT Persona Pengujian

Seluruh akun di bawah ini telah dikonfigurasi di database pengujian Aiven (`sparta_siaga_isolated`) dan siap digunakan dengan kata sandi pengujian: **`<UAT_PASSWORD>`** (hubungi Administrator Sistem untuk memperoleh kredensial pengujian aktif).

| No | Peran / Jabatan | Username / NIK | Akun Email | Cabang | Fungsi Utama dalam Simulasi |
|---|---|---|---|---|---|
| 1 | **System Admin** | `ADM0001` | `admin@sparta-siaga.local` | HO (Nasional) | Manajemen teknis sistem & user. **Zero Operational Bypass**: Dilarang melakukan approval operasional atau Case Close tiket lapangan. |
| 2 | **GM HO** | `UAT_GM0001` | `gm.ho@sparta-siaga.local` | HO (Nasional) | Monitoring nasional eksekutif, penerbit Instruksi Manajemen krisis. Strictly read-only pada laporan operasional. |
| 3 | **HO Admin** | `UAT_HO0001` | `ho.admin@sparta-siaga.local` | HO (Nasional) | Monitoring nasional read-only laporan seluruh cabang. Menerima distribusi email resmi setelah laporan dikonfirmasi BnM Manajer. |
| 4 | **BnM Manajer** | `bmm` | `bm.bandung@sparta-siaga.local` | BANDUNG | Otoritas tunggal konfirmasi awal (3 keputusan: Ada Kerusakan, Tidak Ada Kerusakan, Perlu Klarifikasi), persetujuan milestone, dan Case Close resmi. |
| 5 | **BMC (Koordinator)** | `bmc` | `bmc.bandung@sparta-siaga.local` | BANDUNG | Review dan verifikasi penyelesaian fisik gerai Toko. Ditolak jika mencoba menyetujui fasilitas DC atau Gedung. |
| 6 | **BMS (PIC Toko)** | `bms` | `bms.bandung@sparta-siaga.local` | BANDUNG | Pelaporan toko, pemeriksaan lapangan wajib foto bukti, upload 5 milestone dokumen, dan pengajuan Serah Terima toko. |
| 7 | **BEC (Koordinator)** | `bec` | `bec.bandung@sparta-siaga.local` | BANDUNG | Review dan verifikasi penyelesaian fisik fasilitas Gudang / DC. Ditolak jika mencoba menyetujui gerai Toko atau Gedung. |
| 8 | **BES (PIC DC)** | `bes` | `bes.bandung@sparta-siaga.local` | BANDUNG | Pelaporan fasilitas DC, pemeriksaan lapangan DC wajib foto bukti, upload 5 milestone dokumen, dan pengajuan Serah Terima DC. |
| 9 | **BBC (Koordinator)** | `bbc` | `bbc.bandung@sparta-siaga.local` | BANDUNG | Review dan verifikasi penyelesaian fisik Gedung Kantor Cabang. Ditolak jika mencoba menyetujui Toko atau DC. |
| 10 | **BBS (PIC Gedung)** | `bbs` | `bbs.bandung@sparta-siaga.local` | BANDUNG | Pelaporan gedung kantor cabang, pemeriksaan lapangan sipil wajib foto bukti, upload 5 milestone, dan pengajuan Serah Terima gedung. |

---

## 🏪 Skenario Simulasi 1: Penanganan Bencana Gerai Toko (Damaged Lifecycle)

**Data Insiden:** `INC-UAT1-TOKO-001`  
**Lokasi:** Toko CICAHEUM (SAT-B081), Cabang BANDUNG  
**Bencana:** Banjir & Hujan Lebat (Plafon Gypsum Ambrol di Area Kasir)

### Langkah Demi Langkah:

1. **Langkah 1: Pembuatan Laporan & Pemeriksaan Lapangan oleh BMS (`bms`)**
   - Login sebagai `bms` (`<UAT_PASSWORD>`).
   - Buka menu **Laporan Kejadian** (`/reports`), buat laporan baru untuk gerai Toko (status awal: `pending_confirmation`, progres: `0%`).
   - Klik tombol **Aksi / Periksa Lapangan** pada tiket `INC-UAT1-TOKO-001`.
   - Perhatikan formulir pemeriksaan:
     - Identitas Toko & Laporan terisi otomatis sesuai sesi login BMS Cabang.
     - Pilih opsi **Ada Kerusakan** (kondisi fisik terdampak).
     - **Wajib Lampirkan Foto Bukti:** Ambil foto kamera atau unggah berkas foto dari galeri (minimal 1 foto valid). Sistem menolak jika tanpa bukti visual (HTTP 400).
     - Isi catatan pemeriksaan: *"Plafon gypsum area kasir ambrol sepanjang 3 meter akibat rembesan air atap, butuh penanganan perbaikan segera."*
     - Klik **Kirim Hasil Pemeriksaan**. Status laporan berpindah ke `pending_bm_approval`.

2. **Langkah 2: Keputusan Awal BnM Manajer (`bmm`)**
   - Login sebagai `bmm` (`<UAT_PASSWORD>`).
   - Masuk ke menu **Laporan Kejadian**, klik kartu tiket `INC-UAT1-TOKO-001`.
   - Tinjau rangkuman pemeriksaan lapangan, detail kerusakan, dan foto bukti yang dikirimkan BMS.
   - Pilih keputusan: **Ada Kerusakan (Setujui Penanganan)**.
     - *Catatan:* BnM Manajer memiliki 3 opsi keputusan:
       - **Ada Kerusakan:** Status berpindah ke `confirmed_affected`, memicu antrean email otomatis ke HO, dan membuka alur pekerjaan pemeliharaan.
       - **Tidak Ada Kerusakan:** Status berpindah ke `confirmed_safe`, progres otomatis 100%, tiket selesai langsung tanpa maintenance.
       - **Perlu Klarifikasi:** Status berpindah ke `clarification_requested`, tiket dikembalikan ke BMS untuk perbaikan bukti.
   - Klik **Konfirmasi Keputusan**. Laporan berpindah ke status `confirmed_affected`.

3. **Langkah 3: Pemantauan HO Read-Only (`UAT_HO0001`)**
   - Login sebagai `UAT_HO0001` (`<UAT_PASSWORD>`).
   - Laporan `INC-UAT1-TOKO-001` kini tampil pada dashboard pemantauan nasional HO (sebelumnya tersembunyi saat status masih `pending_confirmation`).
   - Perhatikan bahwa seluruh tombol mutasi (Konfirmasi, Update Progres, Selesaikan, Case Close) tidak tersedia / disembunyikan bagi akun HO.

4. **Langkah 4: Pelaksanaan & Unggah 5 Milestone Dokumen oleh BMS (`bms`)**
   - Login kembali sebagai BMS (`bms`).
   - Buka **Laporan Kejadian** -> Tab **Tracking Pekerjaan Fisik**:
     - **Milestone 1 (10%):** Unggah dokumen Ceklis Kerusakan (PDF/Foto). Progres menjadi 10%.
     - **Milestone 2 (25%):** Unggah berkas Estimasi Biaya Perbaikan. Progres menjadi 25%.
     - **Milestone 3 (30%):** Unggah bukti persetujuan estimasi (Approve Proxy). Progres menjadi 30%.
     - **Milestone 4 (50%):** Unggah Surat Perintah Kerja (SPK) rekanan/teknisi. Progres menjadi 50%.
     - **Milestone 5 (100%):** Unggah Berita Acara Serah Terima (ST) pekerjaan fisik. Progres menjadi 100%.
   - **Aturan Non-Auto-Close:** Walaupun progres mencapai 100%, tiket **TIDAK PERNAH** tertutup secara otomatis. Status berada pada `awaiting_st`.

5. **Langkah 5: Pengajuan Penyelesaian oleh BMS (`bms`)**
   - Pada kartu **Alur Persetujuan Penyelesaian**, klik **Ajukan Penyelesaian Fisik ke Koordinator (BMC)**.
   - Status beralih ke `WAITING_COORDINATOR_APPROVAL`.

6. **Langkah 6: Verifikasi & Persetujuan Koordinator BMC (`bmc`)**
   - Login sebagai BMC (`bmc`).
   - Buka laporan `INC-UAT1-TOKO-001`.
   - *Catatan Isolasi Peran:* Jika koordinator BEC (DC) atau BBC (Gedung) mencoba menyetujui laporan toko ini, sistem akan menolak dengan error HTTP 403 `COORDINATOR_MISMATCH`.
   - BMC menyetujui penyelesaian fisik. Status beralih ke `WAITING_MANAGER_APPROVAL`.

7. **Langkah 7: Persetujuan Akhir & Case Close oleh BnM Manajer (`bmm`)**
   - Login sebagai BnM Manajer (`bmm`).
   - Buka laporan `INC-UAT1-TOKO-001`.
   - Berikan persetujuan manajerial (`approved_pending_close`).
   - Klik tombol **Setujui Final & Tutup Laporan (Case Close)**.
   - Tiket berhasil ditutup secara resmi dengan status `closed` (penanganan selesai tuntas).

---

## 🏭 Skenario Simulasi 2: Fasilitas DC & Deteksi Gempa Otomatis Aman

Skenario ini memvalidasi 2 alur bisnis spesifik:
1. **Peringatan Gempa Otomatis Kondisi Aman:** Konfirmasi **Tidak Ada Kerusakan** yang langsung menyelesaikan tiket tanpa pekerjaan lanjutan.
2. **Insiden Fasilitas Khusus DC:** Alur penanganan `BES -> BEC -> BnM Manajer`.

### Bagian A: Peringatan Gempa Otomatis Aman (`INC-UAT2-EQ-001`)
**Lokasi:** Toko BABAKAN SARI (SAT-B017), Cabang BANDUNG  
**Asal Laporan:** Otomatis BMKG (SPARTA SIAGA Sensor M 5.2)

1. **Langkah 1: Pemeriksaan Lapangan oleh BMS (`bms`)**
   - Login sebagai `bms`.
   - Buka tiket gempa `INC-UAT2-EQ-001`.
   - Klik **Periksa Lapangan**.
   - Pilih opsi **Tidak Ada Kerusakan** (Kondisi Aman).
   - Unggah foto bukti kondisi toko yang rapi, utuh, dan aman (foto wajib dilampirkan).
   - Tulis catatan: *"Struktur bangunan toko kokoh, etalase aman, operasional berjalan normal."*
   - Klik **Kirim Hasil Pemeriksaan**. Status berpindah ke `pending_bm_approval`.

2. **Langkah 2: Konfirmasi Kondisi Aman oleh BnM Manajer (`bmm`)**
   - Login sebagai BnM Manajer (`bmm`).
   - Buka tiket `INC-UAT2-EQ-001`.
   - Perhatikan bahwa opsi **Tolak Laporan (Hoax)** dinonaktifkan/dilindungi secara sistem karena laporan bersumber dari sensor otomatis BMKG yang valid.
   - Klik **Konfirmasi Kondisi Aman (Tidak Ada Kerusakan)**.
   - Tiket langsung berpindah ke status `confirmed_safe` dengan progres 100%. Tiket selesai tanpa membuka tahapan estimasi atau milestone pemeliharaan fisik.

---

### Bagian B: Fasilitas DC Bandung (`INC-UAT2-DC-001`)
**Lokasi:** DC BANDUNG (BZ01)  
**Kerusakan:** Rel Rolling Door Loading Dock Macet Akibat Badai

1. **BES (`bes`)** membuat laporan fasilitas DC, memeriksa kondisi fisik, melampirkan foto bukti, dan melaporkan kerusakan rel rolling dock.
2. **BnM Manajer (`bmm`)** menyetujui penanganan fasilitas DC (`confirmed_affected`).
3. **BES (`bes`)** mengunggah 5 dokumen milestone DC dan mengajukan Serah Terima ke Koordinator BEC.
4. **BMC Koordinator (`bmc`) mencoba menyetujui:** Ditolak sistem dengan HTTP 403 `COORDINATOR_MISMATCH` (jalur DC wajib disetujui BEC).
5. **BEC Koordinator (`bec`)** mereview berkas dan menyetujui pekerjaan DC. Status berpindah ke persetujuan BnM Manajer.
6. **BnM Manajer (`bmm`)** memberikan persetujuan akhir dan menutup tiket DC secara resmi (Case Close).

---

## 🛡️ Catatan Keamanan & Batasan Operasional

1. **Zero Operational Bypass:** Akun System Administrator (`ADM0001`) tidak memiliki hak eksekusi untuk menyetujui inspeksi, mengunggah milestone, atau mengeksekusi Case Close laporan cabang. Hak Admin murni bersifat teknis sistem dan audit.
2. **Isolasi Cabang yang Ketat:** Akun Cabang Bandung (`bms`, `bmc`, `bmm`) diblokir total dari melihat atau memodifikasi tiket operasional cabang lain (misal: Sidoarjo atau Medan).
3. **Hak Akses Head Office Read-Only:** Akun Head Office (`UAT_HO0001`, `UAT_GM0001`) dapat memantau seluruh 28 cabang secara nasional, namun diblokir dari seluruh aksi mutasi operasional (HTTP 403 Forbidden).
4. **Privasi & Keamanan:** Seluruh kata sandi dilindungi menggunakan hashing bcrypt. Dilarang mendokumentasikan kata sandi riil atau token sesi aktif pada dokumentasi publik.
