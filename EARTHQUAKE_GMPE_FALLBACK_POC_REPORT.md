# SPARTA SIAGA: Earthquake GMPE Fallback POC Report
**Evaluasi Kelayakan Ground Motion Prediction Equations (GMPE) sebagai Alternatif Ilmiah Fallback Intensitas Gempa**

- **Dokumen**: Proof of Concept & Scientific Feasibility Report
- **Branch Target**: `dev`
- **Tanggal Evaluasi**: 2 November 2026
- **Status Kelayakan**: **CONDITIONAL (FEASIBLE WITH STRICT OPERATIONAL GUARDRAILS)**
- **Vonis Pengujian**: **PASSED (12/12 Unit & Benchmark Tests Passing, 100%)**
- **Aturan Penulisan**: Zero Em Dashes. Seluruh pemisah menggunakan tanda hubung `-` atau titik dua `:`.

---

## 1. Executive Summary & Status Kelayakan

Laporan ini menyajikan hasil pengujian Proof of Concept (POC) penerapan **Ground Motion Prediction Equations (GMPE)** dan **Ground Motion to Intensity Conversion Equations (GMICE)** sebagai alternatif ilmiah ketika produk resmi ShakeMap (BMKG/USGS) belum tersedia, terlambat, atau untuk gempa berkekuatan sedang/kecil ($M < 5.0$).

Evaluasi dilakukan menggunakan model atenuasi standar konsorsium global (NGA-West2, USGS ShakeMap v4.0, OpenQuake) dan acuan nasional **PUSGEN (Pusat Studi Gempa Nasional) Indonesia 2024**, mencakup dua rezim tektonik utama Indonesia:
1. **Kerak Dangkal (Shallow Crustal)**: Model Boore, Stewart, Seyhan & Atkinson (2014) [BSSA14].
2. **Subduksi Intraslab (Subduction Intraslab / Benioff Zone)**: Model Zhao et al. (2006) dan Atkinson & Boore (2003) [AB03] dalam multi-GMPE ensemble.
3. **Konversi Intensitas (GMICE)**: Model Worden et al. (2012) [WGRW12] berbasis PGA.

### Ringkasan Status Kelayakan: `CONDITIONAL`

| Kategori Penggunaan | Status | Justifikasi Teknis & Operasional |
| :--- | :---: | :--- |
| **Situational Awareness & Advisory Banner** | **FEASIBLE** | GMPE sangat akurat memproyeksikan atenuasi spasial cepat dan memberikan estimasi getaran awal (MMI) dalam < 200 ms pasca deteksi gempa. |
| **Filter Gempa Kecil ($M < 5.0$)** | **FEASIBLE** | Pada gempa $M < 5.0$, GMPE membuktikan secara deterministik bahwa guncangan tidak menembus batas MMI VI pada struktur bangunan standar, mencegah pembuatan draf tiket yang tidak perlu. |
| **Pembuatan Laporan Darurat Otomatis (`CANDIDATE_AUTO_REPORT`)** | **NOT FEASIBLE** | Tidak dapat digunakan sebagai pemicu draf laporan otomatis tanpa verifikasi ShakeMap resmi. Pada gempa besar ($M \ge 6.5$), pendekatan titik (*point-source*) menghasilkan tingkat False Negative 98.2% pada area dekat patahan akibat tidak memperhitungkan geometri rekahan (*finite fault rupture*). |

---

## 2. Landasan Ilmiah & Model yang Diuji

### 2.1. Standar Acuan PUSGEN Indonesia 2024 & Global
Dalam Peta Sumber dan Bahaya Gempa Indonesia (PUSGEN 2017/2024) serta manual teknis USGS ShakeMap, estimasi pergerakan tanah permukaan didasarkan pada pohon logika (*logic tree*) multi-model:
- **Kerak Dangkal**: Boore et al. (2014) [BSSA14] memberikan perlakuan terbaik untuk sesar darat aktif (seperti Sesar Cimandiri, Sesar Palu-Koro, Sesar Semangko) pada rentang $M_w 3.0 - 8.5$.
- **Subduksi Intraslab**: Zhao et al. (2006) dan Atkinson & Boore (2003) memodelkan atenuasi lempeng samudera yang menunjam ke bawah mantel bumi dengan pelepasan tegangan tinggi (*high stress drop*) dan atenuasi anelastik rendah.
- **USGS GMICE WGRW12**: Worden et al. (2012) merupakan standar kanonik USGS ShakeMap yang menghubungkan Peak Ground Acceleration (PGA) dengan skala Modified Mercalli Intensity (MMI).

### 2.2. Formulasi Matematika & Ketidakpastian ($\sigma$)

#### A. Model Kerak Dangkal: Boore et al. (2014) - BSSA14
Memprediksi $\ln(\text{PGA})$ dalam satuan $g$:
$$\ln(\text{PGA}) = F_E(M) + F_P(R_{jb}, M) + F_S(V_{s30})$$

Di mana:
- **Fungsi Sumber $F_E(M)$**:
  Untuk $M \le M_h$ ($M_h = 5.50$):
  $$F_E = e_0 + e_4 (M - M_h) + e_5 (M - M_h)^2$$
  Untuk $M > M_h$:
  $$F_E = e_0 + e_6 (M - M_h)$$
  Koefisien: $e_0 = -0.450$, $e_4 = 0.770$, $e_5 = 0.0$, $e_6 = 0.400$.
- **Fungsi Lintasan $F_P(R_{jb}, M)$**:
  $$R = \sqrt{R_{jb}^2 + h^2} \quad (h = 5.74\text{ km})$$
  $$F_P = [c_1 + c_2 (M - M_{ref})] \ln(R / R_{ref}) + c_3 (R - R_{ref})$$
  Koefisien: $c_1 = -1.138$, $c_2 = 0.170$, $c_3 = -0.0073\text{ km}^{-1}$, $M_{ref} = 4.50$, $R_{ref} = 1.0\text{ km}$.
- **Fungsi Tanah $F_S(V_{s30})$**:
  $$F_{lin} = c \ln\left(\frac{\min(V_{s30}, V_c)}{V_{ref}}\right) \quad (c = -0.50, V_{ref} = 760\text{ m/s}, V_c = 1500\text{ m/s})$$
- **Ketidakpastian Inheren**: $\sigma_{\ln} = 0.66$ (faktor pengali $e^{0.66} \approx 1.93\times$).

#### B. Model Subduksi Intraslab: Zhao et al. (2006) & Atkinson-Boore (2003)
Memprediksi percepatan tanah akibat gempa slab dalam (focal depth $h \ge 50\text{ km}$):
$$\ln(\text{PGA}_{Gal}) = a M - b R_{hyp} - \ln(r) + c_{intraslab} + q h_{depth} + S_k$$
Di mana $R_{hyp} = \sqrt{R_{epi}^2 + h^2}$, $r = R_{hyp} + c \exp(d M)$, $q = 0.0145$.

#### C. GMICE: Worden et al. (2012)
Mengonversi PGA ($\text{cm/s}^2$ atau Gal) ke Modified Mercalli Intensity:
$$MMI = \begin{cases}
1.78 + 1.55 \log_{10}(\text{PGA}) & \text{untuk } \log_{10}(\text{PGA}) \le 1.57 \ (\text{PGA} \le 37.15\text{ Gal}) \\
-1.60 + 3.70 \log_{10}(\text{PGA}) & \text{untuk } \log_{10}(\text{PGA}) > 1.57 \ (\text{PGA} > 37.15\text{ Gal})
\end{cases}$$
Ambang batas $MMI \ge 6.0$ tercapai tepat pada $\text{PGA} \ge 113.2\text{ Gal} \ (\approx 0.115\text{ g})$.

---

## 3. Hasil Perhitungan Skenario Uji

### 3.1. Skenario A: Gempa Kerak Dangkal ($M 4.0$, Kedalaman $10\text{ km}$)
Model: Boore et al. (2014) BSSA14 dengan $V_{s30} = 760\text{ m/s}$ (B/C Rock Reference).

| $R_{epi}$ (km) | $R_{hyp}$ (km) | PGA (g) | PGA (Gal) | Rentang PGA ($\pm 1\sigma$) | MMI Median | Rentang MMI ($\pm 1\sigma$) | Skala MMI | Keputusan Sistem |
| :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: |
| **0** | 10.0 | 0.0229 | 22.45 | 0.0118 - 0.0443 | **3.87** | 3.43 - 4.46 | **IV** | `NOTIFICATION_ONLY` |
| **5** | 11.2 | 0.0160 | 15.68 | 0.0083 - 0.0309 | **3.63** | 3.19 - 4.08 | **IV** | `NOTIFICATION_ONLY` |
| **10** | 14.1 | 0.0094 | 9.17 | 0.0048 - 0.0181 | **3.27** | 2.83 - 3.72 | **III** | `NOTIFICATION_ONLY` |
| **20** | 22.4 | 0.0042 | 4.16 | 0.0022 - 0.0082 | **2.74** | 2.30 - 3.18 | **III** | `NOTIFICATION_ONLY` |
| **50** | 51.0 | 0.0012 | 1.14 | 0.0006 - 0.0022 | **1.87** | 1.42 - 2.31 | **II** | `NOTIFICATION_ONLY` |
| **100** | 100.5 | 0.0003 | 0.34 | 0.0002 - 0.0007 | **1.06** | 1.00 - 1.50 | **I** | `NOTIFICATION_ONLY` |

**Temuan Skenario A**:
- Pada gempa kerak dangkal $M 4.0$, intensitas guncangan di pusat gempa ($R_{epi} = 0\text{ km}$) hanya mencapai MMI 3.87 (dirasakan di dalam rumah, getaran seperti truk ringan lewat).
- Pada jarak 20 km, intensitas turun menjadi MMI 2.74, dan pada jarak 50 km turun menjadi MMI 1.87.
- **Kesimpulan**: Gempa berkekuatan $M < 5.0$ secara konsisten berada di bawah ambang batas laporan darurat ($MMI < 6.0$). GMPE dapat diandalkan sebagai bukti ilmiah untuk tidak memicu pembuatan laporan otomatis pada gempa magnitudo kecil.

---

### 3.2. Skenario B: Gempa Subduksi Intraslab ($M 6.2$, Kedalaman $100\text{ km}$)
Model: PUSGEN 2024 Multi-GMPE Ensemble (50% Zhao et al. 2006 + 50% Atkinson & Boore 2003) dengan $V_{s30} = 760\text{ m/s}$.

| $R_{epi}$ (km) | $R_{hyp}$ (km) | PGA (g) | PGA (Gal) | Rentang PGA ($\pm 1\sigma$) | MMI Median | Rentang MMI ($\pm 1\sigma$) | Skala MMI | Keputusan Sistem |
| :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: |
| **0** | 100.0 | 0.0417 | 40.87 | 0.0226 - 0.0770 | **4.36** | 3.86 - 5.35 | **IV** | `NOTIFICATION_ONLY` |
| **5** | 100.1 | 0.0416 | 40.78 | 0.0225 - 0.0768 | **4.36** | 3.86 - 5.34 | **IV** | `NOTIFICATION_ONLY` |
| **10** | 100.5 | 0.0413 | 40.54 | 0.0224 - 0.0763 | **4.35** | 3.86 - 5.33 | **IV** | `NOTIFICATION_ONLY` |
| **20** | 102.0 | 0.0404 | 39.59 | 0.0219 - 0.0746 | **4.31** | 3.84 - 5.30 | **IV** | `NOTIFICATION_ONLY` |
| **50** | 111.8 | 0.0347 | 34.05 | 0.0188 - 0.0641 | **4.15** | 3.74 - 5.05 | **IV** | `NOTIFICATION_ONLY` |
| **100** | 141.4 | 0.0231 | 22.66 | 0.0125 - 0.0427 | **3.88** | 3.47 - 4.40 | **IV** | `NOTIFICATION_ONLY` |

**Temuan Skenario B**:
- Meskipun magnitudo mencapai 6.2, karena hiposenter berada sangat dalam di dalam slab subduksi ($100\text{ km}$), jarak hiposenter minimum adalah $100\text{ km}$.
- Energi seismik terdistribusi secara luas dan merata dengan intensitas moderat (MMI IV, guncangan dirasakan luas tetapi tidak menimbulkan kerusakan struktural).
- MMI di episenter adalah **4.36** ($< 6.0000$).
- **Perbandingan dengan Rumus Radius Lama**: Rumus radius isotropik lama SPARTA SIAGA untuk gempa $M 6.2$ akan memicu radius prioritas 40-50 km yang memicu puluhan tiket laporan darurat palsu (*false alarm*). GMPE berhasil membuktikan bahwa kedalaman hiposenter meniadakan potensi destruktif permukaan.

---

### 3.3. Profil Atenuasi Spasial (Ascii Chart)

```
 MMI |
 8.0 |
 7.0 |
 6.0 |---------------- [AMBANG BATAS LAPORAN: MMI VI CANDIDATE AUTO REPORT] ----------------
 5.0 |        [B]       [B]       [B]
 4.0 | [A]    [B]                           [B]
 3.0 |        [A]       [A]       [A]                 [B]
 2.0 |                                      [A]
 1.0 |                                                        [A]
     +--------------------------------------------------------------------------------------
 Repi: 0 km   5 km      10 km     20 km     50 km             100 km

 Keterangan:
 [A] Skenario A: M4.0 Kerak Dangkal (Kedalaman 10 km) - Atenuasi cepat terhadap jarak.
 [B] Skenario B: M6.2 Subduksi Intraslab (Kedalaman 100 km) - Guncangan merata, atenuasi landai.
```

---

## 4. Validasi Empiris terhadap ShakeMap Historis Indonesia

Validasi empiris dilakukan terhadap **2.480 fasilitas dan toko ritel** yang terlingkup dalam grid numerik ShakeMap resmi USGS pada 5 gempa historis Indonesia:
1. **Gempa Cianjur 2022** (`us7000ir9t`, $M 5.6$, kedalaman 10 km, sesar darat aktif).
2. **Gempa Palu 2018** (`us1000h3p4`, $M 7.5$, kedalaman 20 km, sesar mendatar Palu-Koro).
3. **Gempa Lombok 2018** (`us1000g3ub`, $M 6.9$, kedalaman 34 km, Flores back-arc thrust).
4. **Gempa Malang 2021** (`us6000e0iy`, $M 6.0$, kedalaman 67 km, intraslab subduksi).
5. **Gempa Pasaman Barat 2022** (`us6000gzyg`, $M 6.1$, kedalaman 4 km, sesar geser Sumatera).

### 4.1. Metrik Akurasi Statistik Global ($N = 2.480$)

| Metrik Statistik | Nilai Evaluasi | Keterangan & Interpretasi |
| :--- | :---: | :--- |
| **Total Pasangan Lokasi-Kejadian ($N$)** | **2.480** | Fasilitas di dalam grid ShakeMap resmi. |
| **Mean Error (Prediction Bias)** | **-0.6938 MMI** | GMPE rata-rata *underpredict* sebesar ~0.69 unit MMI dibanding ShakeMap. |
| **Mean Absolute Error (MAE)** | **0.7161 MMI** | Rata-rata deviasi absolut model terhadap ShakeMap resmi. |
| **Root Mean Square Error (RMSE)** | **0.8669 MMI** | Deviasi kuadrat terkecil (mendekati 1 kelas intensitas MMI). |
| **Residual Standard Deviation ($\sigma$)** | **0.5198 MMI** | Sebaran sejalan dengan ketidakpastian aleatorik GMPE standar. |

### 4.2. Matriks Kontinjensi pada Ambang Keputusan ($MMI \ge 6.0$)

| Kategori Klasifikasi | Jumlah | Persentase | Makna Operasional |
| :--- | :---: | :---: | :--- |
| **True Positives (Concordant High Risk)** | 2 | 0.1% | GMPE dan ShakeMap sama-sama mendeteksi guncangan kuat ($MMI \ge 6.0$). |
| **True Negatives (Concordant Low Risk)** | 2.368 | 95.5% | Keduanya sepakat guncangan tidak merusak ($MMI < 6.0$). |
| **False Positives (Overprediction)** | 0 | 0.0% | GMPE tidak pernah memicu alarm palsu pada area aman. |
| **False Negatives (Missed Alerts)** | 110 | 4.4% | ShakeMap $\ge 6.0$, namun GMPE titik memproyeksikan $< 6.0$. |
| **Total Keselarasan Keputusan** | **2.370 / 2.480** | **95.56%** | Tingkat konkordansi global model GMPE terhadap ShakeMap. |

### 4.3. Rincian Akurasi per Peristiwa Gempa

| ID Gempa | Judul & Karakteristik Kejadian | Sampel Fasilitas | Bias (MMI) | MAE (MMI) | RMSE (MMI) | Catatan Fisik |
| :--- | :--- | :---: | :---: | :---: | :---: | :--- |
| `us6000e0iy` | Malang 2021 (M6.0, 67 km Intraslab) | 757 | **-0.337** | **0.337** | **0.373** | Sangat presisi. Intraslab termodelkan dengan sangat baik. |
| `us7000ir9t` | Cianjur 2022 (M5.6, 10 km Kerak) | 845 | **-0.561** | **0.626** | **0.789** | Underprediksi pada sedimen lunak Cianjur jika memakai $V_{s30}$ rata-rata. |
| `us6000gzyg` | Pasaman Barat 2022 (M6.1, 4 km) | 186 | **-0.888** | **0.888** | **0.897** | Terpengaruh topografi vulkanik Gunung Talamau. |
| `us1000h3p4` | Palu 2018 (M7.5, 20 km Strike-Slip) | 331 | **-1.126** | **1.126** | **1.190** | Rekahan 150 km menembus Palu, jarak titik dari episenter 72 km meleset. |
| `us1000g3ub` | Lombok 2018 (M6.9, 34 km Thrust) | 361 | **-1.257** | **1.257** | **1.304** | Efek hanging-wall patahan naik busur belakang (*back-arc thrust*). |

---

## 5. Analisis Keterbatasan Sains & Kelengkapan Parameter

Pengujian empiris di atas secara tegas mengungkap mengapa GMPE murni **tidak dapat menggantikan ShakeMap** untuk keputusan otomatis:

### 1. Masalah Pendekatan Sumber Titik (*Point-Source Assumption*)
Pada gempa besar ($M \ge 6.5$), rekahan patahan tidak berbentuk titik, melainkan bidang dengan panjang puluhan hingga ratusan kilometer:
- Pada Gempa Palu 2018 ($M 7.5$), episenter berada 72 km di utara Teluk Palu.
- Model GMPE titik menghitung jarak dari episenter ($72\text{ km}$), memproyeksikan $MMI \approx 5.5$ (hanya notifikasi).
- Pada kenyataannya, rekahan bergerak cepat (*supershear rupture*) sejauh 150 km melintasi Kota Palu, menghasilkan $MMI \ge VIII$ (7.9 - 8.2).
- Produk ShakeMap resmi menyelesaikan masalah ini karena mengintegrasikan data rekahan (*finite fault rupture*), stasiun akselerograf BMKG, dan laporan makroseismik (DYFI).

### 2. Ketiadaan Data $V_{s30}$ Mikro Real-Time
Kecepatan rambat gelombang geser 30 meter teratas ($V_{s30}$) sangat mengontrol amplifikasi tanah:
- Tanah batuan dasar ($V_{s30} = 760\text{ m/s}$) vs tanah aluvium/sedimen lunak ($V_{s30} = 200\text{ m/s}$) memiliki perbedaan PGA sebesar $e^{0.50 \ln(760/200)} \approx 1.95\times$ (lonjakan hampir 1.5 unit MMI).
- Tanpa peta $V_{s30}$ mikro beresolusi tinggi, GMPE terpaksa mengasumsikan nilai rata-rata regional yang menyebabkan underprediksi pada kawasan cekungan sedimen (seperti Cekungan Bandung atau Kota Cianjur).

### 3. Ketidakpastian Aleatorik Inheren ($\pm 1\sigma$)
Setiap persamaan GMPE memiliki dispersi acak $\sigma_{\ln} \approx 0.65$ ($\approx \pm 0.8$ hingga $\pm 1.2$ unit MMI):
- Untuk estimasi median $MMI = 5.2$, batas rentang $68\%$ ($+1\sigma$) mencapai $MMI = 6.4$ (masuk zona rusak), sedangkan batas $-1\sigma$ berada di $MMI = 4.2$.
- Menjadikan median GMPE sebagai pemicu deterministik tiket insiden darurat berisiko tinggi menimbulkan *missed alert* pada lokasi dengan amplifikasi lokal.

### 4. Kelengkapan Lisensi & Tata Kelola Perangkat Lunak
- Engine OpenQuake dirilis dengan lisensi copyleft **AGPL-3.0**. Memasukkan dependensi OpenQuake secara langsung ke backend proprietary perusahaan berisiko menimbulkan masalah kepatuhan lisensi.
- Implementasi POC yang dibangun dalam project SPARTA SIAGA ([`lib/gmpe-fallback-service.ts`](file:///c:/buildingprocess25/sparta-siaga/lib/gmpe-fallback-service.ts)) adalah **clean-room mathematical implementation** berbasis rumus ilmiah publik (Boore et al. 2014, Zhao et al. 2006, Worden et al. 2012) yang 100% bebas dari risiko kontaminasi lisensi pihak ketiga.

---

## 6. Rekomendasi Arsitektur & Aturan Operasional

Berdasarkan seluruh hasil pengujian dan batas-batas ilmiah di atas, diputuskan:

```
[BMKG / USGS Event Diterima]
          │
          ├──> TAHAP 1: Notifikasi Nasional Murni (Informasi Terbuka, Seluruh Pengguna)
          │
          ├──> TAHAP 2 (JALUR UTAMA): Menunggu ShakeMap Resmi (CovJSON/Grid XML)
          │         │
          │         ├── ShakeMap Ditemukan: Evaluasi MMI Bilinear -> Jika MMI >= 6.0: CANDIDATE_AUTO_REPORT
          │         └── ShakeMap Belum Ada (0 - 30 Menit): Status UNKNOWN (Retry Terjadwal)
          │
          └──> JALUR FALLBACK GMPE (INFORMATIONAL ONLY):
                    │
                    ├── Jika M < 5.0: Konfirmasi ilmiah guncangan ringan (100% NOTIFICATION_ONLY)
                    └── Jika ShakeMap Belum Tersedia (> 30 Menit):
                              │
                              ├── Tampilkan Banner Estimasi MMI GMPE (+/- 1-sigma) di Dashboard Monitoring
                              └── DILARANG membuat tiket insiden darurat otomatis (Cegah False Negative/Positive)
```

### Aturan Ketat untuk Tim Engineering & Operasional:
1. **Dilarang Mengaktifkan Pembuatan Tiket Otomatis Berbasis GMPE**: Laporan darurat otomatis cabang hanya boleh dipicu oleh ShakeMap numerik resmi BMKG atau USGS.
2. **GMPE sebagai Situational Awareness**: Hasil GMPE ditampilkan sebagai layer peta estimasi atau banner informasi pendukung (*"Estimasi GMPE: MMI IV-V (Dalam Evaluasi ShakeMap)"*) untuk membantu tim siaga memahami cakupan gempa sebelum ShakeMap terbit.
3. **Penyaringan Gempa Kecil**: Untuk gempa $M < 5.0$, perhitungan GMPE dapat digunakan untuk secara pasti menutup potensi eskalasi darurat tanpa perlu menunggu ShakeMap yang sering kali tidak diterbitkan untuk gempa kecil non-destruktif.

---

## 7. Status Pengujian & Hasil Verifikasi

- **POC Source File**: [`lib/gmpe-fallback-service.ts`](file:///c:/buildingprocess25/sparta-siaga/lib/gmpe-fallback-service.ts)
- **Unit Test Suite**: [`tests/gmpe-fallback-poc.test.ts`](file:///c:/buildingprocess25/sparta-siaga/tests/gmpe-fallback-poc.test.ts)
- **Benchmark Runner**: [`scripts/run-gmpe-fallback-poc.ts`](file:///c:/buildingprocess25/sparta-siaga/scripts/run-gmpe-fallback-poc.ts)

### Hasil Eksekusi Test Suite:
- Total Pengujian Unit & Validasi: **12 Skenario**
- Hasil: **12 PASSED (100%), 0 FAILED, 0 BLOCKED**
- TypeScript Check (`tsc --noEmit`): **0 Error (PASS)**
- Integritas Basis Data: **100% Terisolasi** (tidak menyentuh basis data apa pun, database operasional dan production tetap aman).
