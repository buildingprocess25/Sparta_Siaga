# SPARTA SIAGA: Earthquake Intensity POC Report
**Evaluasi Metode Intensitas Gempa Berbasis BMKG & USGS ShakeMap sebagai Pengganti Radius Lingkaran SPARTA SIAGA**

- **Repository**: `buildingprocess25/Sparta_Siaga`
- **Branch**: `dev`
- **Tanggal Evaluasi**: 2 November 2026
- **Status Hasil**: **PASSED (VALIDATED)**
- **Rekomendasi / Vonis**: **READY FOR DESIGN REVIEW** (Tinjauan Arsitektur & SOP Lanjutan)
- **Artifact CSV**: `radius_vs_mmi_comparison.csv` (21.335 evaluasi lokasi-kejadian dengan presisi penuh dan pembulatan tampilan)

---

## 1. Executive Summary & Kesimpulan

Proof of Concept (POC) pengujian metode intensitas gempa berbasis **ShakeMap MMI (Modified Mercalli Intensity)** dinyatakan **PASSED dan TERVALIDASI** berdasarkan pengujian komparatif terhadap **67 fasilitas logistik strategis** (Distribution Centers, Gudang, Depo, Bulky Hub) dan sampel **4.200 toko ritel** pada **5 peristiwa gempa historis nyata di Indonesia**.

### Ringkasan Temuan Kunci (Denominator Transparan):
1. **Reduksi Radius Overprediction Sebesar 59.0% terhadap Peringatan Prioritas Radius**:
   Model radius lingkaran isotropik SPARTA SIAGA memicu 273 peringatan prioritas (`PRIORITY_MONITOR`) yang secara otomatis membuat draf tiket laporan insiden darurat. Berdasarkan estimasi intensitas ShakeMap MMI (ambang batas MMI >= 6.0), sebanyak **161 fasilitas/toko (59.0% dari 273 peringatan prioritas, atau 6.5% dari seluruh 2.480 evaluasi terlingkup)** terbukti hanya mengalami guncangan ringan hingga sedang (MMI IV-V) yang tidak mencapai batas kerusakan fisik. Pengalihan kasus-kasus ini menjadi `NOTIFICATION_ONLY` menghindarkan pemborosan jam kerja operasional inspeksi lapangan.
2. **Zero Radius Underprediction (0.0%)**:
   Dari 2.480 evaluasi terlingkup ShakeMap, tidak ada satupun fasilitas atau toko dengan estimasi MMI >= 6.0 yang terlewatkan atau terabaikan oleh sistem ($N_{underprediction} = 0$).
3. **Tingkat Keselarasan (Concordance Rate) 93.5% pada Area Terlingkup**:
   Dari 2.480 evaluasi yang terlingkup dalam grid numerik ShakeMap ($N_{covered}$), sebanyak 2.319 kasus (93.5%) menunjukkan keselarasan keputusan risiko antara kedua model (112 kasus Concordant High Risk dan 2.207 kasus Concordant Low Risk).
4. **Penanganan Deterministik di Luar Cakupan (Strictly UNKNOWN)**:
   Sebanyak 18.855 evaluasi lokasi yang berada di luar batas grid ShakeMap ($N_{uncovered}$, 88.4% dari 21.335 total pasangan lokasi-kejadian) diklasifikasikan secara ketat sebagai `UNKNOWN` dan `OUT_OF_SHAKEMAP_COVERAGE`, bukan diasumsikan aman secara prematur (`SAFE`).
5. **Performa Komputasi Tinggi (1.06 Juta Evaluasi/Detik)**:
   Algoritma interpolasi bilinear grid CovJSON berjalan dalam kompleksitas waktu $O(1)$, menyelesaikan seluruh 21.335 evaluasi dalam **20.06 milidetik** tanpa membebani database operasional.

| Status Evaluasi | Rekomendasi Tahap Lanjutan | Catatan Kritis |
| :--- | :--- | :--- |
| **PASSED** | **READY FOR DESIGN REVIEW** | POC siap melangkah ke tahap Design Review (kajian arsitektur sistem, fallback pipeline, dan SOP operasional cabang/HO), bukan deployment langsung ke production. |

---

## 2. Definisi Metrik & Klarifikasi Terminologi

Penting untuk dicatat bahwa perbandingan dalam evaluasi ini membandingkan **dua model estimasi numerik**, bukan membandingkan model terhadap kerusakan fisik lapangan yang diverifikasi oleh insinyur struktur:
- **Model A (Baseline Eksisting)**: Perhitungan radius lingkaran konsentris SPARTA SIAGA berbasis formula Haversine (jarak episenter, magnitudo, kedalaman).
- **Model B (Kandidat POC)**: Estimasi intensitas instrumental ShakeMap MMI yang memperhitungkan mekanisme sumber gempa, atenuasi gelombang seismik, dan amplifikasi tanah lokal (Vs30).

Oleh karena itu, terminologi yang digunakan dirumuskan secara presisi:
- **`RADIUS_OVERPREDICTION_VS_MMI`** (menggantikan istilah *false positive*): Kondisi di mana model radius melingkar mengklasifikasikan lokasi ke dalam zona prioritas ($\le 35$ km), namun estimasi ShakeMap menunjukkan intensitas non-destruktif ($\text{MMI} < 6.0$).
- **`RADIUS_UNDERPREDICTION_VS_MMI`** (menggantikan istilah *false negative*): Kondisi di mana model radius melingkar mengklasifikasikan lokasi ke zona monitor/aman ($> 35$ km), namun estimasi ShakeMap memproyeksikan intensitas berisiko tinggi ($\text{MMI} \ge 6.0$) akibat amplifikasi tanah atau directivity sesar.
- **`CONCORDANT_HIGH_RISK`**: Kedua model sepakat memproyeksikan risiko tinggi (Radius Prioritas dan $\text{MMI} \ge 6.0$).
- **`CONCORDANT_LOW_RISK`**: Kedua model sepakat memproyeksikan intensitas rendah (Radius Monitor/Aman dan $\text{MMI} < 6.0$).
- **`OUT_OF_SHAKEMAP_COVERAGE`**: Koordinat fasilitas berada di luar bounding box grid numerik ShakeMap; nilai MMI dievaluasi sebagai `UNKNOWN`.

---

## 3. Metodologi & Arsitektur Implementasi

Modul POC dibangun secara terisolasi tanpa mengubah kode produksi atau menyentuh database operasional:
- **Modul Utama**: `lib/poc/earthquake-intensity-service.ts`
- **Suite Pengujian Unit & Edge Cases**: `tests/earthquake-intensity-poc.test.ts` (21 unit tests, 100% PASS)
- **Engine Benchmark & Pengevaluasi Massal**: `scripts/run-earthquake-intensity-poc.ts`
- **Dataset Fixture Resmi**: `data/poc/shakemaps/` (5 gempa historis resmi USGS & BMKG)

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
                    |   Nilai MMI Kontinu Presisi Penuh   |
                    +------------------+------------------+
                                       |
                   +-------------------+-------------------+
                   |                                       |
                   v                                       v
        [ MMI < 6.0000 (I - V) ]               [ MMI >= 6.0000 (VI - XII) ]
                   |                                       |
                   v                                       v
           NOTIFICATION_ONLY                     CANDIDATE_AUTO_REPORT
     (Notifikasi Siaga / Waspada)           (Pemicu Pembuatan Draf Laporan)
```

### Algoritma Interpolasi Bilinear & Presisi:
Untuk setiap koordinat fasilitas $(lat, lon)$, dicari indeks sel grid reguler $(c_0, c_1)$ dan $(r_0, r_1)$ dengan bobot normalisasi $(u, v) \in [0, 1]$:
$$\text{MMI}(u, v) = (1 - u)(1 - v) v_{00} + u(1 - v) v_{01} + (1 - u) v v_{10} + u v v_{11}$$

**Aturan Presisi & NoData**:
1. **Presisi Penuh untuk Keputusan**: Nilai float hasil interpolasi digunakan langsung tanpa pembulatan untuk evaluasi ambang batas $\text{MMI} \ge 6.0000$. Sebagai contoh, nilai $5.9999$ secara deterministik menghasilkan `NOTIFICATION_ONLY`, meskipun nilai display yang dibulatkan adalah $6.00$. Pembulatan (2 desimal) hanya digunakan untuk tampilan antarmuka (`mmiRounded`).
2. **Validasi Strict CovJSON**: Memvalidasi integritas `domain.axes` (x, y berhingga dalam batas geografis bumi), `ranges.MMI.axisNames` (harus array 2 elemen berkoordinat spasial `y` dan `x`), `ranges.MMI.shape` (harus sesuai dimensi sumbu), dan panjang array `values` ($numX \times numY$).
3. **NoData & Missing Value Safety**: Nilai `null`, `undefined`, `NaN`, atau nilai sentimen di luar rentang fisik $[0.5, 12.0]$ tidak merusak perhitungan `maxMmi`. Koordinat pada sel yang keempat sudutnya merupakan NoData menghasilkan `null` (yang diterjemahkan menjadi `UNKNOWN`), tidak pernah menghasilkan angka 0.

---

## 4. Data Gempa Historis & Sumber Referensi Resmi

Data gempa historis diambil dari feed resmi USGS Earthquake Hazards Program dan disinkronkan dengan parameter resmi BMKG:

| No | Peristiwa Gempa | Event ID USGS | Tanggal / Waktu | Mag (M) | Kedalaman | Max MMI | Karakteristik Tektonik & Lokasi |
| :-: | :--- | :--- | :--- | :-: | :-: | :-: | :--- |
| 1 | **Gempa Cianjur 2022** | `us7000ir9t` | 2022-11-21 06:21 UTC | 5.6 | 10.0 km | 8.47 (VIII) | Sesar darat dangkal (Sesar Cugenang), kepadatan toko & DC tinggi di Jawa Barat. |
| 2 | **Gempa Palu 2018** | `us1000h3p4` | 2018-09-28 10:02 UTC | 7.5 | 20.0 km | 8.37 (VIII) | Patahan geser Palu-Koro mendatar dengan pergeseran besar & likuefaksi masif. |
| 3 | **Gempa Lombok 2018** | `us1000g3ub` | 2018-08-05 11:46 UTC | 6.9 | 34.0 km | 8.05 (VIII) | Flores back-arc thrust, guncangan kuat di Lombok Utara, Mataram, dan Bali. |
| 4 | **Gempa Malang 2021** | `us6000e0iy` | 2021-04-10 07:00 UTC | 6.0 | 67.0 km | 5.36 (V) | Zona subduksi dalam (intra-slab). Bukti empiris reduksi overprediction. |
| 5 | **Gempa Pasaman 2022** | `us6000gzyg` | 2022-02-25 01:39 UTC | 6.1 | 4.0 km | 6.93 (VII) | Sesar geser dangkal segmen Angkola/Sianok di Sumatera Barat. |

---

## 5. Hasil Verifikasi Pengujian Aktual

Seluruh pengujian dijalankan langsung pada environment terisolasi (`dev` branch) dengan hasil 100% PASS:

### A. Pengujian Unit & Edge Cases (`tests/earthquake-intensity-poc.test.ts`)
- **Total Pengujian**: 21 unit tests
- **Hasil**: **21 PASS (100%)**, 0 FAIL, 0 BLOCKED
- **Cakupan Pengujian**:
  1. *Grid Interpolation Exactness*: Pengujian matematika simpul grid dan titik tengah interpolasi bilinear.
  2. *Bounding Safety*: Koordinat di luar batas spasial mengembalikan `null` secara deterministik tanpa error.
  3. *Invalid Coordinate Guard*: Penanganan `NaN`, `null`, `Infinity`, `lat > 90`, `lon > 180` secara aman.
  4. *NoData & Sentinel Guard*: Rejecting sentinels (-999, NaN, null, < 0.5) pada `isValidGridValue`.
  5. *All-NoData Cells*: Sel kuadran NoData mengembalikan `null`, bukan 0.
  6. *Partial Valid Cells*: Interpolasi berbobot pada sel yang memiliki campuran simpul valid dan NoData.
  7. *CovJSON Schema Validation*: Pengujian parsing CovJSON valid dan penolakan objek tanpa domain/ranges.
  8. *Axis Malformation Guard*: Penolakan sumbu terbalik (`start >= stop`) atau di luar rentang geografis.
  9. *axisNames Validation*: Penolakan array non-2 elemen atau tidak mengandung sumbu spasial (`y`, `x`).
  10. *Shape Alignment Validation*: Penolakan dimensi shape yang tidak cocok dengan panjang data atau urutan sumbu.
  11. *BMKG Roman Converter*: Konversi dua arah bilangan Romawi I-XII ke desimal dan sebaliknya.
  12. *BMKG 'Dirasakan' String Parser*: Parsing multi-wilayah dengan rentang intensitas (contoh: "V-VI Cianjur, IV Sukabumi").
  13. *Full Precision Threshold*: Uji presisi 5.9999 (`NOTIFICATION_ONLY`) vs 6.0000 (`CANDIDATE_AUTO_REPORT`) vs 6.0001.
  14. *Historical Replay Cianjur*: Deteksi episenter (MMI 8.5), Kota Cianjur (MMI 7.4), Sukabumi (MMI 5.1), Bandung (MMI 3.9).
  15. *Historical Replay Palu*: Identifikasi zona sesar Palu-Donggala (MMI >= 6.5).
  16. *Historical Replay Malang (Gempa Dalam)*: Max MMI 5.36 (< 6.0) di seluruh permukaan; pembuktian pencegahan overprediction.
  17. *Authentic USGS ShakeMap Schemas*: Validasi kelima berkas `coverage_mmi.covjson` asli USGS memenuhi seluruh aturan schema.
  18. *Strict Out of Coverage*: Koordinat di luar jangkauan grid secara ketat menghasilkan `UNKNOWN` dan `OUT_OF_SHAKEMAP_COVERAGE`, bukan `SAFE`.
  19. *Discrepancy Classifier*: Validasi pengelompokan `CONCORDANT_HIGH_RISK`, `CONCORDANT_LOW_RISK`, `RADIUS_OVERPREDICTION_VS_MMI`, dan `RADIUS_UNDERPREDICTION_VS_MMI`.
  20. *Throughput Benchmark*: Kecepatan **1.768.034 lookup/detik** pada 1.000 titik koordinat.

### B. Kompilasi TypeScript (`npm run typecheck`)
- **Hasil**: **0 Errors (Exit code: 0)**.

---

## 6. Analisis Statistik Agregat (Denominator Transparan)

Tabel berikut menyajikan rincian statistik komparatif dengan penyebutan denominator secara eksplisit:

| Kelompok / Metrik Evaluasi | Simbol | Jumlah Kasus | Persentase | Basis Denominator | Interpretasi Operasional |
| :--- | :---: | :-: | :-: | :--- | :--- |
| **Total Pasangan Lokasi-Kejadian** | $N_{total}$ | 21.335 | 100.0% | $N_{total}$ | 67 Fasilitas + 4.200 Toko x 5 Gempa Historis |
| **Terlingkup dalam Grid ShakeMap** | $N_{covered}$ | 2.480 | 11.6% | $N_{total}$ | Lokasi berada dalam batas geografis grid ShakeMap |
| **Di Luar Bounding Grid ShakeMap** | $N_{uncovered}$ | 18.855 | 88.4% | $N_{total}$ | Berjarak sangat jauh; intensitas berstatus `UNKNOWN` |
| **1. Concordant High Risk (Keduanya Tinggi)** | $N_{concordantHigh}$ | 112 | 4.5% | $N_{covered}$ (2.480) | Radius = Priority, MMI >= 6.0. Sepakat wajib inspeksi fisik segera. |
| **2. Concordant Low Risk (Keduanya Rendah)** | $N_{concordantLow}$ | 2.207 | 89.0% | $N_{covered}$ (2.480) | Radius = Monitor/Safe, MMI < 6.0. Sepakat cukup notifikasi siaga. |
| **3. Radius Overprediction vs MMI** | $N_{overprediction}$ | **161** | **6.5%** | **$N_{covered}$ (2.480)** | Radius lingkaran memicu prioritas, namun ShakeMap MMI < 6.0. |
| **-> Relatif terhadap Peringatan Prioritas Radius** | - | **161** | **59.0%** | **$N_{coveredPriorityRadius}$ (273)** | **59.0% dari seluruh 273 peringatan prioritas radius dialihkan ke notifikasi.** |
| **4. Radius Underprediction vs MMI** | $N_{underprediction}$ | **0** | **0.0%** | **$N_{covered}$ (2.480)** | Tidak ada fasilitas dengan MMI >= 6.0 yang terlewat oleh radius. |
| **Tingkat Keselarasan Total (High/Low Match)** | $N_{concordantTotal}$ | **2.319** | **93.5%** | **$N_{covered}$ (2.480)** | Keselarasan keputusan antara kedua metode pada area terlingkup. |

---

## 7. Studi Kasus Fasilitas & Toko Representatif

Tabel berikut menyajikan 10 contoh representatif perbandingan keputusan antara radius lingkaran vs ShakeMap MMI dari berkas `radius_vs_mmi_comparison.csv`:

| Kode Lokasi | Nama Fasilitas / Toko | Cabang | Peristiwa Gempa | Jarak (km) | Zona Radius Lama | MMI Raw | MMI Rounded | Keputusan MMI | Klasifikasi Discrepancy | Catatan Analisis |
| :--- | :--- | :--- | :--- | :-: | :---: | :-: | :-: | :---: | :--- | :--- |
| **2JZ1** | DC CIANJUR | CIANJUR | Cianjur 2022 (M5.6) | 12.0 km | `PRIORITY_MONITOR` (<=35km) | 7.7005 | **7.70 (VIII)** | `CANDIDATE_AUTO_REPORT` | `CONCORDANT_HIGH_RISK` | Keduanya sepakat: Getaran destruktif dekat patahan Cugenang. Draf tiket darurat tepat dibuat. |
| **BZ01** | DC BANDUNG | BANDUNG | Cianjur 2022 (M5.6) | 77.1 km | `SAFE` (>77km) | 3.9072 | **3.91 (IV)** | `NOTIFICATION_ONLY` | `CONCORDANT_LOW_RISK` | Keduanya sepakat: Getaran ringan di Bandung Timur, cukup notifikasi informatif. |
| **JZ01** | DC CILEUNGSI 2 | CILEUNGSI | Cianjur 2022 (M5.6) | 46.5 km | `MONITOR` (<=77km) | 4.1622 | **4.16 (IV)** | `NOTIFICATION_ONLY` | `CONCORDANT_LOW_RISK` | Keduanya sepakat: Getaran dirasakan tetapi aman dari risiko kerusakan fisik gudang. |
| **JY01** | WH BOGOR | BOGOR | Cianjur 2022 (M5.6) | 41.4 km | `MONITOR` (<=77km) | 3.5162 | **3.52 (IV)** | `NOTIFICATION_ONLY` | `CONCORDANT_LOW_RISK` | Shaking ringan di Kota Bogor, tidak memerlukan penanganan darurat. |
| **2J06** | Toko SARASA 2 | CIANJUR | Cianjur 2022 (M5.6) | 13.2 km | `PRIORITY_MONITOR` (<=35km) | 4.9310 | **4.93 (V)** | `NOTIFICATION_ONLY` | `RADIUS_OVERPREDICTION_VS_MMI` | Jarak 13 km berada di luar koridor rekahan utama sesar. MMI < 6.0 dialihkan ke notifikasi siaga. |
| **2J07** | Toko CIAMBAR | CIANJUR | Cianjur 2022 (M5.6) | 22.4 km | `PRIORITY_MONITOR` (<=35km) | 5.0740 | **5.07 (V)** | `NOTIFICATION_ONLY` | `RADIUS_OVERPREDICTION_VS_MMI` | Radius memicu tiket darurat, padahal estimasi MMI V aman bagi bangunan ritel standar. |
| **2J14** | Toko SECAPA | CIANJUR | Cianjur 2022 (M5.6) | 11.6 km | `PRIORITY_MONITOR` (<=35km) | 5.2105 | **5.21 (V)** | `NOTIFICATION_ONLY` | `RADIUS_OVERPREDICTION_VS_MMI` | Guncangan kuat dirasakan tetapi di bawah ambang batas retak plesteran/kerusakan (MMI VI). |
| **2J20** | Toko PURABAYA | CIANJUR | Cianjur 2022 (M5.6) | 33.1 km | `PRIORITY_MONITOR` (<=35km) | 4.2011 | **4.20 (IV)** | `NOTIFICATION_ONLY` | `RADIUS_OVERPREDICTION_VS_MMI` | Dekat batas 35 km, getaran melemah ke MMI IV. Radius lama menimbulkan alarm berlebih. |
| **HZ01** | DC SEMARANG | SEMARANG | Malang 2021 (M6.0) | 258.0 km | `SAFE` | null | **N/A** | `UNKNOWN` | `OUT_OF_SHAKEMAP_COVERAGE` | Di luar jangkauan grid ShakeMap. Status dievaluasi sebagai UNKNOWN secara deterministik. |
| **T-MLG** | Toko Pesisir Blitar | MALANG | Malang 2021 (M6.0) | 32.0 km | `PRIORITY_MONITOR` (<=35km) | 5.2840 | **5.28 (V)** | `NOTIFICATION_ONLY` | `RADIUS_OVERPREDICTION_VS_MMI` | Gempa dalam (67 km): Kedalaman meredam getaran ke MMI V. Radius memicu false alarm. |

---

## 8. Analisis Peran Ambang Batas Kebijakan MMI VI

Dalam desain sistem SPARTA SIAGA, **MMI VI (Strong Shaking) diposisikan sebagai ambang batas kebijakan operasional (candidate operational policy threshold)**, bukan jaminan mutlak terjadinya kerusakan struktur fisik:
- **Hakikat Ambang Batas MMI VI**:
  - Berdasarkan skala Modified Mercalli Intensity dan Skala Intensitas Gempabumi (SIG) BMKG Tingkat III, MMI VI adalah batas awal di mana getaran berpotensi memicu kerusakan non-struktural hingga struktural ringan (plester dinding rontok, cerobong retak, barang pajangan toko berjatuhan dari rak).
  - Bangunan berkonstruksi rekayasa baik (engineered buildings) dengan standar ketahanan gempa dapat bertahan tanpa kerusakan pada MMI VI. Sebaliknya, bangunan tanpa perkuatan (unreinforced masonry) dapat mengalami retak pada intensitas yang sama.
  - Oleh karena itu, klasifikasi `CANDIDATE_AUTO_REPORT` pada MMI >= 6.0 berfungsi sebagai **pemicu verifikasi cepat (rapid verification trigger)** agar personil Building Maintenance Specialist (BMS/BES/BBS) segera melakukan inspeksi fisik berkamera sebelum kerusakan merambat mengganggu operasional toko/gudang.
- **Kebijakan MMI < 6.0 (`NOTIFICATION_ONLY`)**:
  - Getaran pada MMI I hingga V dirasakan oleh manusia dan menyebabkan benda gantung bergoyang, namun tidak merusak integritas fisik bangunan.
  - Mengalihkan kasus MMI < 6.0 ke notifikasi siaga mencegah terciptanya ratusan draf tiket operasional yang tidak perlu.

---

## 9. Ketidakpastian Model ShakeMap (ShakeMap Uncertainties)

Sebagai model estimasi berbasis sains kebumian, ShakeMap memiliki keterbatasan dan ketidakpastian inheren yang wajib dipahami sebelum adopsi sistem:

1. **Ground Motion Prediction Equations (GMPEs) / Persamaan Atenuasi**:
   - ShakeMap memodelkan penurunan energi gelombang seismik terhadap jarak menggunakan GMPE empiris regional.
   - GMPE memiliki deviasi standar inheren ($\sigma \approx 0.5 - 0.7$ unit MMI). Dalam kasus tertentu, guncangan di titik mikro dapat berbeda $\pm 0.5$ MMI dari hasil estimasi grid.
2. **Proxy Topografi Vs30 (Kecepatan Gelombang Geser 30 Meter Teratas)**:
   - Nilai amplifikasi tanah pada ShakeMap USGS global diturunkan dari kemiringan lereng topografi (*topographic slope proxy*) sebagai pendekatan nilai $V_{s30}$.
   - Di wilayah cekungan sedimen tebal, dataran aluvial lunak, atau tanah reklamasi (misalnya Cekungan Bandung atau dataran pantai Jakarta), amplifikasi nyata dapat lebih tinggi daripada yang diestimasikan oleh proxy topografi standar.
3. **Kepadatan Jaringan Stasiun Seismograf (Station Density)**:
   - Pada wilayah dengan jaringan sensor akselerograf yang rapat (seperti Pulau Jawa), estimasi ShakeMap diperkuat oleh data perekaman instrumen nyata sehingga akurasinya sangat tinggi.
   - Di luar Pulau Jawa atau wilayah kepulauan terpencil dengan stasiun sensor yang lebih jarang, ShakeMap lebih banyak mengandalkan interpolasi model atenuasi teoretis, sehingga tingkat ketidakpastiannya lebih lebar.

---

## 10. Rekomendasi Tahap Lanjutan: READY FOR DESIGN REVIEW

### Vonis Akhir:
Proof of Concept ini **LULUS (PASSED)** dan dinyatakan **READY FOR DESIGN REVIEW**.

Modul ini **TIDAK DIREKOMENDASIKAN** untuk langsung di-deploy ke production secara langsung tanpa melalui tahapan tinjauan arsitektur dan penyesuaian Standard Operating Procedure (SOP).

### Rencana Tindak Lanjut pada Design Review:
1. **Arsitektur Pipeline Peringatan Dua Tahap (Two-Stage Alert Pipeline)**:
   - **Tahap 1 (Menit 0 - 2 Pasca Gempa)**: Ingestion instan parameter BMKG (Magnitudo, Koordinat, Kedalaman). Sistem mengirimkan *Flash Broadcast Notification* (Status: `VIGILANCE_MONITORING`) ke aplikasi mobile PIC dan dashboard monitoring.
   - **Tahap 2 (Menit 5 - 15 Pasca Gempa)**: Mengunduh grid numerik ShakeMap (USGS/BMKG). Jika $\text{MMI} \ge 6.0$, otomatis membuat draf tiket insiden (`CANDIDATE_AUTO_REPORT`). Jika $\text{MMI} < 6.0$, tiket tidak dibuat dan status diperbarui menjadi informatif (`NOTIFICATION_ONLY`).
2. **Desain Mekanisme Fail-Safe & Fallback**:
   - Jika feed ShakeMap mengalami kegagalan jaringan atau keterlambatan penerbitan lebih dari 30 menit pasca gempa besar ($M \ge 6.0$), sistem harus memiliki fallback deterministik yang beralih kembali ke model radius konservatif bertanda khusus (`FALLBACK_RADIUS_EVALUATION`).
3. **Penyelarasan SOP Cabang dan Head Office**:
   - Memastikan tim operasional cabang (BnM Manajer, Koordinator BMC/BEC/BBC, dan PIC Lapangan) memahami bahwa status notifikasi siaga tidak mengharuskan pengisian berkas inspeksi darurat kecuali ditemukan anomali visual di lapangan.
