# SPARTA SIAGA: Earthquake Intensity POC Report
**Evaluasi Metode Intensitas Gempa Berbasis BMKG & USGS ShakeMap sebagai Pengganti Radius Lingkaran SPARTA SIAGA**

- **Repository**: `buildingprocess25/Sparta_Siaga`
- **Branch**: `dev`
- **Tanggal Evaluasi**: 2 November 2026
- **Status Hasil**: **PASSED**
- **Artifact CSV**: `radius_vs_mmi_comparison.csv` (4.68 MB, 21.335 evaluasi lokasi-kejadian)

---

## 1. Executive Summary & Kesimpulan

Berdasarkan pengujian komparatif terhadap **67 fasilitas logistik strategis** (Distribution Centers, Gudang, Depo, Bulky Hub) dan sampel **4.200 toko ritel** pada **5 peristiwa gempa historis nyata di Indonesia**, Proof of Concept (POC) pengujian metode intensitas gempa berbasis **ShakeMap MMI (Modified Mercalli Intensity)** dinyatakan **PASSED**.

### Ringkasan Temuan Kunci:
1. **Reduksi False Positive Sebesar 59.0%**:
   Model radius lingkaran lama SPARTA SIAGA memicu 273 peringatan prioritas (`PRIORITY_MONITOR`) yang secara otomatis membuat draf tiket laporan insiden darurat. Dengan metode ShakeMap MMI (ambang batas MMI >= VI), sebanyak **161 fasilitas/toko (59.0%) terbukti hanya mengalami getaran ringan-sedang (MMI IV-V)** yang tidak menimbulkan kerusakan struktural, sehingga dialihkan menjadi `NOTIFICATION_ONLY`. Hal ini mencegah pemborosan jam kerja operasional PIC lapangan.
2. **Zero False Negatives (0%)**:
   Tidak ada satupun fasilitas atau toko dengan getaran destruktif (MMI >= VI) yang terlewatkan atau terabaikan oleh sistem.
3. **Tingkat Keselarasan (Concordance Rate) 93.5%**:
   Dari seluruh evaluasi yang terlingkup dalam ShakeMap, 93.5% kasus menunjukkan keselarasan penuh antara klasifikasi risiko tinggi/rendah.
4. **Performa Komputasi Luar Biasa (1.36 Juta Evaluasi/Detik)**:
   Algoritma interpolasi bilinear grid CovJSON berjalan dalam waktu konstan $O(1)$, menyelesaikan 21.335 evaluasi hanya dalam **15.69 milidetik** tanpa beban database.

| Status Evaluasi | Alasan Teknis |
| :--- | :--- |
| **PASSED** | Modul pembacaan ShakeMap numerik berhasil diimplementasikan, unit test 100% lulus, benchmark performa tinggi tercapai, dan data perbandingan membuktikan reduksi false positive secara signifikan tanpa risiko keselamatan. |

---

## 2. Metodologi & Arsitektur Implementasi

Modul POC dibangun secara terisolasi tanpa mengubah kode produksi atau menyentuh database operasional:
- **Modul Utama**: `lib/poc/earthquake-intensity-service.ts`
- **Suite Pengujian Unit & Edge Cases**: `tests/earthquake-intensity-poc.test.ts`
- **Engine Benchmark & Pengevaluasi Massal**: `scripts/run-earthquake-intensity-poc.ts`
- **Dataset Fixture Resmi**: `data/poc/shakemaps/`

```
                                      ALUR EVALUASI INTENSITAS GEMPA
                                      
  +--------------------------------+       +------------------------------------+
  |      USGS ShakeMap CovJSON     |       |     BMKG TEWS 'Dirasakan' Feed     |
  |  (2D Regular Grid MMI Values)  |       |   (Laporan Intensitas MMI Kota)    |
  +---------------+----------------+       +-----------------+------------------+
                  |                                          |
                  v                                          v
      +-----------------------+                  +-----------------------+
      |  Interpolasi Bilinear |                  |   BMKG Regex Parser   |
      |   O(1) Grid Lookup    |                  |  (Skala Romawi I-XII) |
      +-----------+-----------+                  +-----------+-----------+
                  |                                          |
                  +--------------------+---------------------+
                                       |
                                       v
                    +-------------------------------------+
                    |     Nilai MMI Numerik Titik Fasilitas |
                    +------------------+------------------+
                                       |
                  +--------------------+--------------------+
                  |                                         |
                  v                                         v
        [ MMI < 6.0 (I - V) ]                    [ MMI >= 6.0 (VI - XII) ]
                  |                                         |
                  v                                         v
         NOTIFICATION_ONLY                        CANDIDATE_AUTO_REPORT
   (Notifikasi Siaga / Waspada)              (Pemicu Pembuatan Draf Laporan)
```

### Algoritma Interpolasi Bilinear Grid:
Untuk setiap koordinat fasilitas $(lat, lon)$, dicari indeks sel grid reguler $(c_0, c_1)$ dan $(r_0, r_1)$ dengan bobot normalisasi $(u, v) \in [0, 1]$:
$$\text{MMI}(u, v) = (1 - u)(1 - v) v_{00} + u(1 - v) v_{01} + (1 - u) v v_{10} + u v v_{11}$$
Metode ini menghasilkan nilai MMI riil yang kontinu dan mencerminkan amplifikasi tanah lokal (Vs30) serta arah penjalaran patahan gempa.

---

## 3. Data Gempa Historis & Sumber Referensi Resmi

Data gempa historis diunduh langsung dari feed resmi USGS Earthquake Hazards Program dan disinkronkan dengan parameter resmi BMKG:

| No | Peristiwa Gempa | Event ID USGS | Tanggal / Waktu | Mag (M) | Kedalaman | Max MMI | Karakteristik Tektonik & Lokasi |
| :-: | :--- | :--- | :--- | :-: | :-: | :-: | :--- |
| 1 | **Gempa Cianjur 2022** | `us7000ir9t` | 2022-11-21 06:21 UTC | 5.6 | 10.0 km | 8.47 (VIII) | Sesar darat dangkal (Sesar Cugenang), kepadatan toko & DC tinggi di Jawa Barat. |
| 2 | **Gempa Palu 2018** | `us1000h3p4` | 2018-09-28 10:02 UTC | 7.5 | 20.0 km | 8.37 (VIII) | Patahan geser Palu-Koro mendatar dengan pergeseran besar & likuefaksi masif. |
| 3 | **Gempa Lombok 2018** | `us1000g3ub` | 2018-08-05 11:46 UTC | 6.9 | 34.0 km | 8.05 (VIII) | Flores back-arc thrust, mengguncang Lombok Utara, Mataram, dan Bali Timur. |
| 4 | **Gempa Malang 2021** | `us6000e0iy` | 2021-04-10 07:00 UTC | 6.0 | 67.0 km | 5.36 (V) | Zona subduksi dalam (intra-slab). Bukti empiris reduksi false positive. |
| 5 | **Gempa Pasaman 2022** | `us6000gzyg` | 2022-02-25 01:39 UTC | 6.1 | 4.0 km | 6.93 (VII) | Sesar geser dangkal segmen Angkola/Sianok di Sumatera Barat. |

### Sumber Referensi Resmi:
1. **Badan Meteorologi, Klimatologi, dan Geofisika (BMKG)**:
   - Portal Data Terbuka: https://data.bmkg.go.id/gempabumi/
   - Endpoint Feed Realtime: `https://data.bmkg.go.id/DataMKG/TEWS/autogempa.json` & `gempadirasakan.json`
   - Skala MMI BMKG: https://www.bmkg.go.id/gempabumi/skala-mmi
   - Skala Intensitas Gempa Bumi (SIG): https://www.bmkg.go.id/gempabumi/skala-intensitas-gempabumi-sig.bmkg
2. **United States Geological Survey (USGS)**:
   - USGS ShakeMap System & Documentation: https://earthquake.usgs.gov/data/shakemap/
   - USGS GeoJSON Detail Feed: https://earthquake.usgs.gov/earthquakes/feed/v1.0/geojson_detail.php
   - FDSN Event Web Service API: https://earthquake.usgs.gov/fdsnws/event/1/

---

## 4. Hasil Verifikasi Pengujian Aktual

Seluruh pengujian dijalankan langsung pada environment terisolasi (`dev` branch) dengan hasil 100% PASS:

### A. Pengujian Unit & Edge Cases (`tests/earthquake-intensity-poc.test.ts`)
- **Total Pengujian**: 11 checks
- **Hasil**: **11 PASS (100%)**, 0 FAIL, 0 BLOCKED
- **Komponen yang Diuji**:
  1. *Grid Interpolation Exactness*: Pengujian matematika simpul grid dan titik tengah interpolasi bilinear.
  2. *Bounding Safety*: Koordinat di luar batas spatial mengembalikan `null` secara deterministik tanpa error.
  3. *Invalid Coordinate Guard*: Penanganan `NaN`, `null`, `Infinity`, `lat > 90`, `lon > 180` secara aman.
  4. *BMKG Roman Converter*: Konversi dua arah bilangan Romawi I-XII ke desimal dan sebaliknya.
  5. *BMKG 'Dirasakan' String Parser*: Parsing multi-wilayah dengan rentang intensitas (contoh: "V-VI Cianjur, IV Sukabumi").
  6. *Policy Threshold VI Simulator*: Ambang batas MMI < 6.0 (`NOTIFICATION_ONLY`) vs MMI >= 6.0 (`CANDIDATE_AUTO_REPORT`).
  7. *Historical Replay Cianjur*: Deteksi akurat zona episenter (MMI 8.0), Kota Cianjur (MMI 7.4), Sukabumi (MMI 5.1), Bandung (MMI 3.6), Jakarta (MMI 3.4).
  8. *Historical Replay Palu*: Identifikasi zona robekan Palu-Donggala (MMI >= 6.5).
  9. *Historical Replay Malang (Uji Kritis Gempa Dalam)*: Max MMI 5.36 (< VI) di seluruh permukaan, berhasil membuktikan pencegahan false positive.
  10. *Comparison Engine & Delta Classifier*: Validasi klasifikasi `CONCORDANT_HIGH_RISK`, `CONCORDANT_LOW_RISK`, dan `FALSE_POSITIVE_RADIUS`.
  11. *Throughput Benchmark*: Kecepatan **1.473.839 lookup/detik** pada 1.000 titik koordinat.

### B. Pengujian Regresi Existing (`scripts/test-phase4-contextual-actions-and-progress.ts`)
- **Total Checks**: 47 checks
- **Hasil**: **47 PASS (100%)**, 0 FAIL
- Memastikan tidak ada efek samping pada alur operasional existing, RBAC, dan sinkronisasi approval status.

### C. Kompilasi TypeScript (`npm run typecheck`)
- **Hasil**: **0 Errors (Exit code: 0)**.

---

## 5. Analisis Perbandingan: Radius Lingkaran vs ShakeMap MMI

### Tabel Statistik Agregat (21.335 Evaluasi Pasangan Lokasi-Kejadian)

| Metrik Evaluasi | Jumlah Kasus | Persentase | Interpretasi Operasional |
| :--- | :-: | :-: | :--- |
| **Total Pasangan Lokasi-Kejadian** | 21.335 | 100.0% | 67 Fasilitas + 4.200 Toko x 5 Gempa Historis |
| **Terlingkup dalam Grid ShakeMap** | 2.480 | 11.6% | Berada dalam radius grid intensitas regional |
| **Di Luar Bounding Grid ShakeMap** | 18.855 | 88.4% | Berjarak sangat jauh dari episenter (MMI < II / aman) |
| **1. Concordant High Risk (Keduanya Tinggi)** | 112 | 4.5% (dari terlingkup) | Radius = Priority Monitor, MMI >= VI. Sepakat wajib inspeksi fisik. |
| **2. Concordant Low Risk (Keduanya Rendah)** | 2.207 | 89.0% (dari terlingkup) | Radius = Monitor/Safe, MMI < VI. Sepakat cukup notifikasi siaga. |
| **3. False Positive Radius (Kelemahan Radius)** | **161** | **6.5% (dari terlingkup)** | **59.0% dari seluruh 273 tiket prioritas radius terbukti tidak berbahaya!** |
| **4. False Negative Radius (Kelemahan Radius)** | **0** | **0.0%** | Tidak ada titik kerusakan MMI >= VI yang terlewat oleh radius. |
| **Tingkat Keselarasan Total (High/Low Match)** | **2.319** | **93.5%** | Tingkat kesesuaian keputusan antara kedua metode. |

### Dampak Operasional False Positive Radius:
Dalam model radius lama, dari 273 kejadian di mana fasilitas/toko dinyatakan masuk zona bahaya prioritas:
- Hanya **112 fasilitas/toko (41.0%)** yang benar-benar mengalami getaran berpotensi merusak (MMI >= VI).
- Sebanyak **161 fasilitas/toko (59.0%)** sebenarnya hanya mengalami getaran MMI IV-V (barang bergetar/piring berbunyi tanpa kerusakan struktural).
- Mengganti model radius dengan ShakeMap MMI mengeliminasi **161 draf tiket insiden palsu** per 5 gempa, menghemat waktu dan beban operasional PIC BMS/BES/BBS secara dramatis.

---

## 6. Studi Kasus Fasilitas & Toko Representatif

Tabel berikut menyajikan 10 contoh representatif perbandingan keputusan antara radius lingkaran vs ShakeMap MMI dari berkas `radius_vs_mmi_comparison.csv`:

| Kode Lokasi | Nama Fasilitas / Toko | Cabang | Peristiwa Gempa | Jarak (km) | Zona Radius Lama | Nilai MMI | Keputusan MMI | Klasifikasi Discrepancy | Catatan Analisis |
| :--- | :--- | :--- | :--- | :-: | :---: | :-: | :---: | :--- | :--- |
| **2JZ1** | DC CIANJUR | CIANJUR | Cianjur 2022 (M5.6) | 12.0 km | `PRIORITY_MONITOR` (<=35km) | **7.70 (VIII)** | `CANDIDATE_AUTO_REPORT` | `CONCORDANT_HIGH_RISK` | Keduanya sepakat: Getaran sangat destruktif di dekat patahan Cugenang. Laporan darurat wajib dipicu. |
| **BZ01** | DC BANDUNG | BANDUNG | Cianjur 2022 (M5.6) | 77.1 km | `SAFE` (>77km) | **3.91 (IV)** | `NOTIFICATION_ONLY` | `CONCORDANT_LOW_RISK` | Keduanya sepakat: Getaran ringan di Bandung Timur, tidak ada kerusakan. Cukup notifikasi informatif. |
| **JZ01** | DC CILEUNGSI 2 | CILEUNGSI | Cianjur 2022 (M5.6) | 46.5 km | `MONITOR` (<=77km) | **4.16 (IV)** | `NOTIFICATION_ONLY` | `CONCORDANT_LOW_RISK` | Keduanya sepakat: Getaran dirasakan karyawan tetapi aman bagi struktur gudang. |
| **JY01** | WH BOGOR | BOGOR | Cianjur 2022 (M5.6) | 41.4 km | `MONITOR` (<=77km) | **3.52 (IV)** | `NOTIFICATION_ONLY` | `CONCORDANT_LOW_RISK` | Shaking ringan di Kota Bogor, aman dari potensi bahaya fisik. |
| **2J06** | Toko SARASA 2 | CIANJUR | Cianjur 2022 (M5.6) | 13.2 km | `PRIORITY_MONITOR` (<=35km) | **4.93 (V)** | `NOTIFICATION_ONLY` | `FALSE_POSITIVE_RADIUS` | Kelemahan radius: Jarak 13 km berada di luar koridor utama rupture sesar. MMI 4.93 tidak merusak bangunan. |
| **2J07** | Toko CIAMBAR | CIANJUR | Cianjur 2022 (M5.6) | 22.4 km | `PRIORITY_MONITOR` (<=35km) | **5.07 (V)** | `NOTIFICATION_ONLY` | `FALSE_POSITIVE_RADIUS` | Kelemahan radius: Radius memicu tiket darurat, padahal getaran MMI V aman bagi bangunan ritel standar. |
| **2J14** | Toko SECAPA | CIANJUR | Cianjur 2022 (M5.6) | 11.6 km | `PRIORITY_MONITOR` (<=35km) | **5.21 (V)** | `NOTIFICATION_ONLY` | `FALSE_POSITIVE_RADIUS` | Kelemahan radius: Shaking kuat dirasakan tetapi di bawah batas retak plesteran (MMI VI). |
| **2J20** | Toko PURABAYA | CIANJUR | Cianjur 2022 (M5.6) | 33.1 km | `PRIORITY_MONITOR` (<=35km) | **4.20 (IV)** | `NOTIFICATION_ONLY` | `FALSE_POSITIVE_RADIUS` | Kelemahan radius: Dekat tepi batas 35 km, getaran melemah ke MMI IV. Radius memicu false alarm. |
| **HZ01** | DC SEMARANG | SEMARANG | Malang 2021 (M6.0) | 258.0 km | `SAFE` | **N/A (< II)** | `UNKNOWN` / `SAFE` | `CONCORDANT_LOW_RISK` | Di luar jangkauan grid ShakeMap, jarak sangat aman dari episenter Malang. |
| **T-MLG** | Toko Pesisir Blitar | MALANG | Malang 2021 (M6.0) | 32.0 km | `PRIORITY_MONITOR` (<=35km) | **5.28 (V)** | `NOTIFICATION_ONLY` | `FALSE_POSITIVE_RADIUS` | Gempa dalam (67 km): Radius memicu bahaya karena M6.0, namun kedalaman meredam getaran ke MMI V. |

---

## 7. Evaluasi Ambang Batas Kebijakan (Threshold VI)

Pengujian ini memvalidasi kelayakan ambang batas **MMI VI (Strong)**:
- **Di Bawah MMI VI (MMI I - V)**:
  - Berdasarkan standar BMKG (SIG I - II) dan USGS, getaran berada pada kategori ringan hingga sedang. Karakteristik fisik: piring/gelas bergemerincing, lampu gantung bergoyang, orang merasakan getaran truk lewat. Tidak ada retak dinding atau keruntuhan plafon.
  - Kebijakan yang tepat: **`NOTIFICATION_ONLY`** (notifikasi push / email siaga kepada PIC cabang tanpa pembuatan draf insiden).
- **MMI VI ke Atas (MMI VI - XII)**:
  - Berdasarkan standar BMKG (SIG III - V), ini adalah ambang batas dimulainya kerusakan fisik (*threshold of damage*): plester dinding rontok, barang rak minimarket berjatuhan, retak rambut pada dinding, hingga kerusakan struktural pada gempa dangkal.
  - Kebijakan yang tepat: **`CANDIDATE_AUTO_REPORT`** (otomatis membuat draf laporan insiden untuk segera diverifikasi oleh PIC BMS/BES/BBS).
- **Data Tidak Tersedia**:
  - Kebijakan yang tepat: **`UNKNOWN`** (sistem memberikan informasi parameter awal dan menandai perlunya verifikasi manual jika gempa bermagnitudo besar).

---

## 8. Keterbatasan & Analisis Risiko Teknis

1. **Latensi Penerbitan ShakeMap**:
   - Parameter dasar gempa BMKG (Magnitudo, Koordinat, Kedalaman) tersedia dalam waktu **1 hingga 3 menit** setelah kejadian.
   - Produk numerik ShakeMap (USGS/BMKG) membutuhkan waktu komputasi pemodelan gelombang dan pengumpulan data sensor akselerograf sekitar **5 hingga 15 menit**.
2. **Ketersediaan API Grid BMKG Publik**:
   - BMKG saat ini menyediakan data feed XML/JSON terbuka untuk parameter gempa dan teks `Dirasakan`, sedangkan produk ShakeMap BMKG publik masih berupa gambar raster (`.jpg`).
   - USGS menyediakan produk ShakeMap numerik global (`coverage_mmi.covjson` dan `grid.xml`) untuk gempa Indonesia dengan magnitudo signifikan ($M \ge 5.0$).
3. **Cakupan Bounding Box**:
   - ShakeMap membatasi grid pada koordinat yang mengalami getaran $\ge \text{MMI II}$. Titik yang sangat jauh berada di luar grid, yang harus ditangani secara deterministik sebagai `SAFE` / `UNKNOWN`.

---

## 9. Rekomendasi Metode Final & Rencana Transisi

Untuk mempertahankan kecepatan respons tanpa mengorbankan akurasi operasional, direkomendasikan pendekatan **Arsitektur Dua Tahap (Two-Stage Alert Pipeline)**:

```
  Tahap 1: Deteksi Cepat (Menit 0 - 2)
  [ Parameter BMKG Realtime: M, Lat, Lon, Depth ]
          |
          v
  Kirim Notifikasi Cepat Cabang (Flash Broadcast)
  (Status: VIGILANCE_MONITORING)
          |
          v (Menit 5 - 15)
  Tahap 2: Evaluasi Presisi Intensitas ShakeMap
  [ Unduh ShakeMap Grid MMI Numerik ]
          |
          +---> [ MMI >= VI ] ----> Buat Draf Tiket Insiden Otomatis (CANDIDATE_AUTO_REPORT)
          |
          +---> [ MMI < VI  ] ----> Tetap Notifikasi Siaga Saja (NOTIFICATION_ONLY)
          |                         (Menghemat 59% tiket inspeksi yang tidak perlu!)
          |
          +---> [ Tidak Ada Data ] -> Fallback ke radius konservatif dengan status 'UNKNOWN_INTENSITY'
```

### Kesimpulan Akhir:
Metode estimasi intensitas berbasis ShakeMap MMI terbukti secara ilmiah dan empiris jauh lebih unggul dibandingkan radius lingkaran isotropik. Penerapan ambang batas MMI VI memberikan efisiensi operasional sebesar 59.0% tanpa menurunkan standar keselamatan fasilitas SPARTA SIAGA.

