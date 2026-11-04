# SPARTA SIAGA: Earthquake GMPE Fallback POC Report
**Evaluasi Kelayakan Ground Motion Prediction Equations (GMPE) sebagai Alternatif Ilmiah Fallback Intensitas Gempa (Task 3: Validasi Independen & Task 4: Validasi Data Empiris Tanpa ShakeMap)**

- **Dokumen**: Proof of Concept & Scientific Feasibility Report (Task 4 Data Validation Closeout)
- **Branch Target**: `dev`
- **Tanggal Evaluasi**: 3 November 2026
- **Status Validasi Eksternal**: **NOT INDEPENDENTLY VERIFIED** (Pustaka seismologi pihak ketiga bersertifikasi seperti OpenQuake engine atau py-shakemap USGS tidak terpasang di environment lokal; verifikasi numerik murni berupa penurunan ulang persamaan matematika internal terhadap tabel koefisien publikasi asli)
- **Status Validasi Data Empiris (Task 4)**: **PASS** (Seluruh 5 kejadian gempa dan 30 titik observasi telah diaudit, disinkronkan ke katalog resmi BMKG/USGS, dan diverifikasi dengan URL sumber terlacak)
- **Status Kelayakan Operasional**: **CONDITIONAL (FEASIBLE HANYA SEBAGAI PENELITIAN RISET TERISOLASI DAN ADVISORY BANNER; STRICTLY BLOCKED DARI PEMICU LAPORAN OTOMATIS)**
- **Keputusan Task 5**: **NO-GO untuk Otomatisasi Laporan Darurat (`CANDIDATE_AUTO_REPORT`); GO (CONDITIONAL) sebagai Riset Penelitian Terisolasi (Isolated Research Prototype)**
- **Vonis Pengujian Perangkat Lunak**: **PASSED (22/22 Unit & Benchmark Tests Passing, 100%)**
- **Catatan Integritas Ilmiah**: 22/22 pengujian unit membuktikan ketepatan implementasi matematika kode terhadap persamaan publikasi asli, BUKAN membuktikan kesempurnaan akurasi prediksi fisik terhadap alam.
- **Aturan Penulisan**: Zero Em Dashes. Seluruh pemisah menggunakan tanda hubung `-` atau titik dua `:`.

---

## 1. Executive Summary & Ringkasan Task 3-4

Task 3 dan Task 4 berfokus pada **validasi mandiri dan koreksi validitas data** terhadap seluruh persamaan atenuasi getaran tanah (GMPE), model konversi jarak rekahan sesar (PS2FF), dan persamaan konversi intensitas (GMICE) yang diimplementasikan pada SPARTA SIAGA:

1. Memverifikasi implementasi numerik terhadap kalkulator penurunan persamaan publikasi ilmiah acuan secara terpisah.
2. Memverifikasi koefisien, satuan fisik, parameter jarak ($R_{jb}, R_{rup}$), magnitudo ($M_w$), kecepatan gelombang geser tanah ($V_{s30}$), dan formulasi ketidakpastian ($\sigma$).
3. Mengevaluasi ulang benchmark 112 lokasi dengan estimasi ShakeMap MMI >= VI pada data resmi di 5 gempa historis Indonesia yang memiliki ShakeMap numerik.
4. Menjalankan audit dan validasi empiris Fase 2 terhadap 5 kejadian gempa historis Indonesia yang **tidak memiliki ShakeMap numerik di cache SPARTA**, menggunakan parameter katalog resmi dan 30 titik observasi resmi BMKG Dirasakan dan USGS DYFI (*Did You Feel It?*).
5. Membedakan secara tegas status ketersediaan ShakeMap resmi, format CovJSON numerik, dan status cache lokal SPARTA SIAGA.
6. Menghapus skenario sintetis dari kelompok validasi empiris, mencatat metode transformasi interval kualitatif BMKG, dan menghitung ulang statistik yang sah.
7. Menetapkan keputusan tegas **PASS / BLOCKED** dan **GO / NO-GO** untuk kelanjutan ke Task 5.

---

## 2. Validasi Numerik terhadap Publikasi Asli

Pengujian numerik dilakukan dengan membandingkan luaran fungsi pada [`lib/gmpe-fallback-service.ts`](file:///c:/buildingprocess25/sparta-siaga/lib/gmpe-fallback-service.ts) terhadap kalkulator referensi yang diturunkan secara terisolasi berdasarkan persamaan matematika dari makalah acuan asli:
- **BSSA14**: Boore et al. (2014), *Earthquake Spectra*, Vol. 30, No. 3, Tabel 4 & 5.
- **Zhao 2006**: Zhao et al. (2006), *BSSA*, Vol. 96, No. 3, Tabel 4.
- **AB03**: Atkinson & Boore (2003), *BSSA*, Vol. 93, No. 4, Tabel 4.
- **WGRW12**: Worden et al. (2012), *BSSA*, Vol. 102, No. 1, Tabel 3.
- **WC94 / PS2FF**: Wells & Coppersmith (1994) & Thompson & Worden (2018), *BSSA*, Vol. 108, No. 1.

> [!NOTE]
> **Catatan Validasi Eksternal (Status: NOT INDEPENDENTLY VERIFIED):**
> Karena paket perangkat lunak seismologi eksternal bersertifikasi (misalnya OpenQuake engine atau py-shakemap USGS) tidak tersedia pada environment lokal, hasil numerik di bawah ini diverifikasi terhadap kalkulator penurunan matematis internal dari tabel publikasi asli, dan berstatus **NOT INDEPENDENTLY VERIFIED** terhadap pustaka eksternal.

### Tabel Perbandingan Hasil Numerik: Implementasi SPARTA SIAGA vs Penurunan Mandiri

| Model & Vektor Uji | Parameter Input ($M_w, R, V_{s30}$, Mekanisme) | Hasil Implementasi Kode | Hasil Penurunan Mandiri | Selisih Mutlak ($\Delta$) | Status Verifikasi |
| :--- | :--- | :---: | :---: | :---: | :---: |
| **BSSA14 (Shallow Crustal)** | $M_w 6.0, R_{jb}=10\text{ km}, V_{s30}=760\text{ m/s}$, Strike-Slip | $0.08326\text{ g}$ | $0.08326\text{ g}$ | $0.000\times 10^0$ | **MATCH (Internal Derivation)** |
| **BSSA14 (Tanah Lunak D)** | $M_w 6.0, R_{jb}=10\text{ km}, V_{s30}=270\text{ m/s}$, Strike-Slip | $0.13969\text{ g}$ | $0.13969\text{ g}$ | $0.000\times 10^0$ | **MATCH (Internal Derivation)** |
| **BSSA14 (Gempa Besar Reverse)** | $M_w 7.0, R_{jb}=25\text{ km}, V_{s30}=760\text{ m/s}$, Reverse | $0.10717\text{ g}$ | $0.10717\text{ g}$ | $0.000\times 10^0$ | **MATCH (Internal Derivation)** |
| **BSSA14 (Sesar Turun Normal)** | $M_w 5.0, R_{jb}=5\text{ km}, V_{s30}=450\text{ m/s}$, Normal | $0.05294\text{ g}$ | $0.05294\text{ g}$ | $0.000\times 10^0$ | **MATCH (Internal Derivation)** |
| **Zhao 2006 (Megathrust Interface)** | $M_w 6.5, R_{epi}=30\text{ km}, h=25\text{ km}, V_{s30}=760\text{ m/s}$ | $0.03335\text{ g}$ | $0.03335\text{ g}$ | $0.000\times 10^0$ | **MATCH (Internal Derivation)** |
| **Zhao 2006 (Interface Kelas D)** | $M_w 7.0, R_{epi}=50\text{ km}, h=30\text{ km}, V_{s30}=270\text{ m/s}$ | $0.05742\text{ g}$ | $0.05742\text{ g}$ | $0.000\times 10^0$ | **MATCH (Internal Derivation)** |
| **Zhao 2006 (Intraslab Batuan)** | $M_w 6.2, R_{epi}=20\text{ km}, h=80\text{ km}, V_{s30}=760\text{ m/s}$ | $0.02993\text{ g}$ | $0.02993\text{ g}$ | $0.000\times 10^0$ | **MATCH (Internal Derivation)** |
| **Zhao 2006 (Intraslab Kelas D)** | $M_w 6.8, R_{epi}=40\text{ km}, h=100\text{ km}, V_{s30}=270\text{ m/s}$ | $0.07877\text{ g}$ | $0.07877\text{ g}$ | $0.000\times 10^0$ | **MATCH (Internal Derivation)** |
| **Atkinson-Boore 2003 (Interface)** | $M_w 6.5, R_{epi}=30\text{ km}, h=25\text{ km}, V_{s30}=760\text{ m/s}$ | $0.39555\text{ g}$ | $0.39555\text{ g}$ | $0.000\times 10^0$ | **MATCH (Internal Derivation)** |
| **Atkinson-Boore 2003 (Intraslab)** | $M_w 6.2, R_{epi}=20\text{ km}, h=80\text{ km}, V_{s30}=760\text{ m/s}$ | $0.06684\text{ g}$ | $0.06684\text{ g}$ | $0.000\times 10^0$ | **MATCH (Internal Derivation)** |
| **GMICE Worden 2012 (Getaran Rendah)** | $\text{PGA} = 0.020\text{ g} \ (\approx 19.61\text{ Gal} \le 37.15\text{ Gal})$ | $MMI = 3.7835$ | $MMI = 3.7835$ | $0.000\times 10^0$ | **MATCH (Internal Derivation)** |
| **GMICE Worden 2012 (Getaran Kuat)** | $\text{PGA} = 0.250\text{ g} \ (\approx 245.17\text{ Gal} > 37.15\text{ Gal})$ | $MMI = 7.2410$ | $MMI = 7.2410$ | $0.000\times 10^0$ | **MATCH (Internal Derivation)** |
| **Dimensi Sesar Wells-Coppersmith** | $M_w 6.5$, Sesar Naik (Reverse) | $L=22.39\text{ km}, W=11.35\text{ km}$ | $L=22.39\text{ km}, W=11.35\text{ km}$ | $0.000\times 10^0$ | **MATCH (Internal Derivation)** |
| **Dimensi Sesar Wells-Coppersmith** | $M_w 7.5$, Sesar Geser (Strike-Slip) | $L=120.23\text{ km}, W=18.41\text{ km}$ | $L=120.23\text{ km}, W=18.41\text{ km}$ | $0.000\times 10^0$ | **MATCH (Internal Derivation)** |

---

## 3. Status Evaluasi Setiap Model (PASS / FAIL / BLOCKED)

| Nama Model | Domain Tektonik | Status Kode | Status Operasional | Evaluasi Kritis & Alasan |
| :--- | :--- | :---: | :---: | :--- |
| **Boore et al. (2014) [BSSA14]** | Kerak Dangkal Aktif (*Shallow Crustal*) | **PASS** | **FEASIBLE (Advisory Saja)** | Persamaan NGA-West2 konsisten dalam atenuasi jarak dan magnitudo. Efektif memodelkan sesar dangkal Indonesia bila didukung estimasi jarak rekahan $E[R_{jb}]$. |
| **Zhao et al. (2006) [Zhao06]** | Megathrust Interface & Intraslab | **PASS** | **FEASIBLE (Advisory Saja)** | Koefisien Tabel 4 sesuai rujukan. Memiliki pemisahan tegas antara Interface ($S_I = 0.0$) dan Intraslab ($S_{SS} = 0.323$). Mencegah kesalahan overestimasi getaran megathrust. |
| **Atkinson & Boore (2003) [AB03]** | Subduksi Interface & In-Slab | **PASS** | **CONDITIONAL (Perlu Kalibrasi)** | Implementasi kode tepat secara matematis. Namun pada jarak dekat, model Interface AB03 menghasilkan nilai PGA frekuensi tinggi yang sangat tinggi (~10x Zhao06), mencerminkan disparitas model empiris lama sebelum era NGA-Subduction. |
| **Thompson & Worden (2018) [PS2FF]** | Estimasi Jarak Rekahan Sesar Tanpa Sesar | **PASS** | **FEASIBLE (Komponen Wajib Advisory)** | Penting untuk mengatasi inflasi jarak sumber titik pada gempa $M_w \ge 6.0$. Menghindari penalti jarak hiposenter berlebihan pada sesar panjang. |
| **Worden et al. (2012) [WGRW12]** | Konversi Ground Motion ke Intensitas (GMICE) | **PASS** | **FEASIBLE (Advisory Saja)** | Hubungan dwilogaritmik PGA ke MMI tepat pada ambang batas transisi $\log_{10}(PGA) = 1.57$ ($37.15\text{ Gal}$). Ambang MMI VI ($6.0$) berada pada $113.25\text{ Gal}$ ($0.1155\text{ g}$). |
| **Ensemble PUSGEN 2024 Penuh** | Multi-Model PUSGEN | **BLOCKED** | **BLOCKED** | Membutuhkan pohon logika regional lengkap (NGA-Subduction) dan data mikrozonasi geoteknik tanah nasional yang berada di luar cakupan fallback ringan. |

---

## 4. Identifikasi Komponen Sederhana, Kesalahan Ilmiah, Keterbatasan Fisik & Risiko Overfitting

### Daftar Lengkap Komponen GMPE yang Disederhanakan (Simplifications & Approximations):

1. **Amplifikasi Tanah Non-Linier BSSA14 ($F_{nl}$)**:
   Implementasi hanya mengadopsi suku linier $F_{S,lin} = f_7 \ln(V_{s30}/V_{ref})$ tanpa menyertakan fungsi non-linier ($f_4, f_5, f_6$) yang bergantung pada percepatan batuan dasar $PGA_{rock}$. Pada getaran sangat kuat ($PGA > 0.2\text{ g}$), tanah lunak mengalami peningkatan redaman histeresis yang secara fisik membatasi amplifikasi puncak. Pengabaian $F_{nl}$ menyebabkan sedikit overestimasi pada tanah lunak di dekat episenter gempa besar.
2. **Kedalaman Cekungan Sedimen Dalam ($z_1, z_{2.5}$)**:
   Suku kedalaman cekungan sedimen diabaikan (menggunakan nilai default regional). Amplifikasi gelombang permukaan periode panjang akibat resonansi cekungan dalam (seperti cekungan Jakarta atau Bandung) belum tertangkap.
3. **Geometri Patahan 3D dan Batuan Gantung (Hanging-Wall Effect)**:
   Model Thompson & Worden (2018) yang diterapkan menggunakan simplifikasi integrasi orientasi jurus (*strike*) horizontal 1D vertikal ($\delta = 90^\circ, Z_{tor} = 0$). Untuk sesar naik miring seperti Sesar Flores di Lombok ($\delta \approx 30^\circ - 45^\circ$), bidang patahan berada miring di bawah batuan gantung (*hanging wall*), sehingga pendekatan 1D menghasilkan sedikit underprediksi di sisi gantung.
4. **Klasifikasi Sumber dan Ketebalan Subduksi**:
   Pemisahan zona interface megathrust dan intraslab dilakukan berdasarkan ambang kedalaman katalog titik ($h \le 50\text{ km}$ vs $h > 50\text{ km}$) tanpa pemodelan geometri lempeng subduksi 3D (seperti USGS Slab2).
5. **Penyederhanaan Ketidakpastian Parameter (Aleatory & Epistemic Uncertainty)**:
   - Ketidakpastian aleatori tidak memisahkan variabilitas antar-kejadian (*inter-event* $\tau$) dan dalam-kejadian (*intra-event* $\phi$) dengan autokorelasi spasial.
   - Ketidakpastian epistemik dari parameter input katalog (galat magnitudo $\Delta M_w$, galat kedalaman $\Delta h$, dan heterogenitas $V_{s30}$ mikrozonasi lokal) tidak dirambatkan secara stokastik.

---

## 5. Evaluasi Ulang Benchmark 112 Lokasi dengan Estimasi ShakeMap MMI >= VI

### Pencocokan Identitas Lima Gempa Historis Fixture:

Evaluasi dijalankan ulang secara ketat terhadap seluruh 2.480 pasang data fasilitas pada 5 gempa historis resmi USGS ShakeMap yang ada dalam repositori:

1. `us7000ir9t`: Cianjur 2022 ($M_w 5.6, h = 10\text{ km}$, Shallow Crustal Strike-Slip, Sesar Cugenang)
2. `us1000h3p4`: Palu 2018 ($M_w 7.5, h = 20\text{ km}$, Shallow Crustal Strike-Slip, Sesar Palu-Koro)
3. `us1000g3ub`: Lombok 2018 ($M_w 6.9, h = 34\text{ km}$, Shallow Crustal Back-arc Thrust, Sesar Flores)
4. `us6000e0iy`: Malang 2021 ($M_w 6.0, h = 67\text{ km}$, Subduction Intraslab)
5. `us6000gzyg`: Pasaman 2022 ($M_w 6.1, h = 4\text{ km}$, Shallow Crustal Strike-Slip, Sesar Besar Sumatera)

> [!IMPORTANT]
> **Penyelesaian Inkonsistensi Palu 2018 vs Majene 2021:**
> - Gempa Majene 2021 ($M_w 6.2$) sempat disebutkan dalam catatan konseptual sebelumnya, namun **tidak pernah menjadi bagian dari fixture data resmi di repositori SPARTA SIAGA**.
> - Gempa ke-5 yang sebenarnya tersimpan pada `data/poc/shakemaps/us1000h3p4` adalah **Palu 2018 (us1000h3p4)**.
> - **Karakteristik Grid Palu 2018**: Seluruh toko Alfamart yang tercakup dalam benchmark berada di pulau Jawa, Bali, Lombok, dan Sumatera. Tidak ada fasilitas toko di Sulawesi Tengah dalam subset data uji ini, sehingga seluruh fasilitas untuk gempa Palu 2018 berada di luar jangkauan grid ShakeMap (`UNKNOWN`, 0 fasilitas dalam grid).
> - **Distribusi 112 Lokasi ShakeMap MMI >= VI**: Sebanyak 112 fasilitas dengan estimasi ShakeMap MMI >= VI seluruhnya terdistribusi pada dua gempa dangkal, yaitu **Cianjur 2022 (43 fasilitas, MMI 6.01 hingga 8.10)** dan **Lombok 2018 (69 fasilitas, MMI 6.03 hingga 7.41)**. Pada Malang 2021 (intraslab dalam) dan Pasaman 2022, tidak ada fasilitas dalam katalog yang mencapai ShakeMap MMI >= VI.

### Tabel Evaluasi Benchmark Multi-Konfigurasi (2.480 Pasang Data)

| Konfigurasi Pengujian | Bias (MMI) | MAE (MMI) | RMSE (MMI) | True Positives (Deteksi Estimasi ShakeMap MMI >= VI) | False Negatives (Terlewat dari ShakeMap MMI >= VI) | False Positives (Alarm Palsu MMI < VI) | True Negatives (Tepat di Bawah MMI VI) | Recall / Sensitivitas | Tingkat Terlewat | Presisi | Akurasi Global |
| :--- | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: |
| **CFG-1: Baseline POC (Point-Source, $V_{s30}=450$)** | **$-0.679$** | $0.701$ | $0.844$ | 2 / 112 | 110 | 0 | 2.368 | **1.79%** | **98.21%** | 100.0% | 95.56% |
| **CFG-2: Point-Source + Tanah Kelas D ($V_{s30}=270$)** | $-0.502$ | $0.553$ | $0.688$ | 11 / 112 | 101 | 0 | 2.368 | **9.82%** | **90.18%** | 100.0% | 95.93% |
| **CFG-3: Model Rupture TW18 $E[R_{jb}]$ ($V_{s30}=450$)** | $-0.622$ | $0.651$ | $0.782$ | 12 / 112 | 100 | 0 | 2.368 | **10.71%** | **89.29%** | 100.0% | 95.97% |
| **CFG-4: TW18 $E[R_{jb}]$ + Tanah Kelas D ($V_{s30}=270$)** | **$-0.443$** | **$0.507$** | **$0.631$** | **41 / 112** | **71** | **2** | **2.366** | **36.61%** | **63.39%** | **95.35%** | **97.06%** |
| **CFG-5: TW18 $E[R_{jb}]$ + Tanah Lunak Kelas E ($V_{s30}=180$)** | $-0.315$ | $0.416$ | $0.531$ | 78 / 112 | 34 | 12 | 2.356 | **69.64%** | **30.36%** | 86.67% | 98.15% |
| **CFG-6: TW18 $E[R_{jb}]$ + Kelas D pada $+1\sigma$ Upper Bound** | **$+0.089$** | **$0.367$** | **$0.467$** | **106 / 112** | **6** | **51** | **2.317** | **94.64%** | **5.36%** | **67.52%** | **97.70%** |

---

## 6. Hasil Validasi Task 4: Audit Validitas Data & Evaluasi Gempa Tanpa ShakeMap Numerik

Task 4 telah diaudit secara menyeluruh untuk memastikan validitas katalog, memverifikasi ID resmi, membedakan status ketersediaan ShakeMap, dan memvalidasi setiap titik observasi menggunakan sumber resmi yang dapat ditelusuri.

### Penegasan Perbedaan Status Ketersediaan ShakeMap:
1. **`SHAKEMAP_NOT_PUBLISHED`**: Produk ShakeMap resmi memang **tidak diterbitkan oleh lembaga resmi (USGS maupun BMKG)** karena magnitudo gempa berada di bawah ambang produksi otomatis ($M < 5.0$). Contoh: Gempa Sumedang 2023 (`us6000m0tt`) dan Susulan Cianjur 2023 (`us6000jlxv`).
2. **`SHAKEMAP_AVAILABLE_NOT_CACHED`**: Produk ShakeMap resmi **diterbitkan oleh USGS** (tersedia file CovJSON numerik di API USGS), namun **belum diunduh atau disimpan dalam cache lokal SPARTA SIAGA** (`data/poc/shakemaps/`). Contoh: Gempa Laut Jawa Dalam 2023 (`us6000k49j`), Gempa Tanimbar 2023 (`us7000j36j`), dan Gempa Bawean 2024 (`us6000mkfz`).
3. **`SHAKEMAP_COVJSON_UNAVAILABLE`**: BMKG merilis informasi intensitas dalam format narasi teks atau peta isoseismal grafis, namun **format grid CovJSON numerik tidak diproduksi oleh BMKG**.

### Catatan Kritis Terhadap Angka Desimal Hasil Transformasi:
> [!IMPORTANT]
> **Metode Transformasi Intensitas Kualitatif BMKG**:
> Data observasi BMKG disajikan dalam format skala intensitas Romawi kualitatif atau rentang interval ordinal (seperti "III MMI", "III-IV MMI", "IV-V MMI"). Angka desimal pada kolom "Titik Tengah Matematis" (misalnya $3.50$ untuk III-IV atau $2.50$ untuk II-III) adalah **titik tengah representasi analitis matematis untuk perhitungan residual, BUKAN hasil pengukuran desimal fisik dari BMKG**.
> Sebaliknya, data USGS DYFI menyajikan angka desimal berbasis respon komunitas (*Community Determined Intensity* - CDI, e.g. CDI 5.4 atau CDI 3.8).
> Seluruh evaluasi juga menyertakan **Interval Containment** untuk memeriksa apakah estimasi GMPE berada di dalam batas rentang observasi kualitatif $[I_{min}, I_{max}]$. Skenario sintetis hipotetis telah dikeluarkan secara penuh dari kelompok validasi empiris.

---

### Tabel 1: Daftar Kejadian Gempa Terverifikasi terhadap Katalog Resmi BMKG / USGS

| No | Kejadian Gempa | ID Resmi USGS / BMKG | Waktu Resmi (WIB / UTC) | Magnitudo ($M_w$) | Kedalaman Hiposenter | Koordinat Episenter | Rezim & Sesar | Status Ketersediaan ShakeMap | URL Katalog Resmi |
| :-: | :--- | :--- | :--- | :-: | :-: | :-: | :--- | :--- | :--- |
| 1 | **Gempa Sumedang 2023** | `us6000m0tt` | 31 Des 2023 20:34:21 WIB<br>(13:34:21 UTC) | $4.8$ | $12.16\text{ km}$<br>(BMKG: $5\text{ km}$) | $-6.7592^\circ\text{ S}$<br>$107.8299^\circ\text{ E}$ | Shallow Crustal<br>(Sesar Sumedang, Strike-Slip) | `SHAKEMAP_NOT_PUBLISHED`<br>(Tidak diproduksi, $M < 5$) | [USGS Event us6000m0tt](https://earthquake.usgs.gov/earthquakes/eventpage/us6000m0tt) |
| 2 | **Susulan Cianjur 2023** | `us6000jlxv` | 24 Jan 2023 02:45:00 WIB<br>(23 Jan 19:45:00 UTC) | $4.5$<br>(BMKG: $4.3$) | $10.84\text{ km}$<br>(BMKG: $5\text{ km}$) | $-6.8426^\circ\text{ S}$<br>$106.9767^\circ\text{ E}$ | Shallow Crustal<br>(Sesar Cugenang, Strike-Slip) | `SHAKEMAP_NOT_PUBLISHED`<br>(Tidak diproduksi, $M < 5$) | [USGS Event us6000jlxv](https://earthquake.usgs.gov/earthquakes/eventpage/us6000jlxv) |
| 3 | **Laut Jawa Dalam 2023** | `us6000k49j` | 14 Apr 2023 16:55:45 WIB<br>(09:55:45 UTC) | $7.0$<br>(BMKG: $6.6$) | $597.00\text{ km}$ | $-6.0413^\circ\text{ S}$<br>$112.0478^\circ\text{ E}$ | Subduction Intraslab<br>(Deep Mantle Slab) | `SHAKEMAP_AVAILABLE_NOT_CACHED`<br>(Ada di USGS, belum di cache SPARTA) | [USGS Event us6000k49j](https://earthquake.usgs.gov/earthquakes/eventpage/us6000k49j) |
| 4 | **Gempa Tanimbar 2023** | `us7000j36j` | 10 Jan 2023 00:47:35 WIT<br>(09 Jan 17:47:35 UTC) | $7.6$<br>(BMKG: $7.5$) | $104.95\text{ km}$ | $-7.0586^\circ\text{ S}$<br>$130.0090^\circ\text{ E}$ | Subduction Intraslab<br>(Busur Banda) | `SHAKEMAP_AVAILABLE_NOT_CACHED`<br>(Ada di USGS, belum di cache SPARTA) | [USGS Event us7000j36j](https://earthquake.usgs.gov/earthquakes/eventpage/us7000j36j) |
| 5 | **Gempa Bawean 2024** | `us6000mkfz` | 22 Mar 2024 15:52:58 WIB<br>(08:52:58 UTC) | $6.4$<br>(BMKG: $6.5$) | $9.47\text{ km}$ | $-5.8754^\circ\text{ S}$<br>$112.3646^\circ\text{ E}$ | Shallow Crustal<br>(Sesar Laut Jawa, Strike-Slip) | `SHAKEMAP_AVAILABLE_NOT_CACHED`<br>(Ada di USGS, belum di cache SPARTA) | [USGS Event us6000mkfz](https://earthquake.usgs.gov/earthquakes/eventpage/us6000mkfz) |

---

### Tabel 2: Sumber Observasi Per Lokasi & Perbandingan Estimasi GMPE (30 Titik Tervalidasi)

Dijalankan secara terisolasi via [`scripts/run-task4-no-shakemap-validation.ts`](file:///c:/buildingprocess25/sparta-siaga/scripts/run-task4-no-shakemap-validation.ts) menggunakan koordinat episenter resmi dan formula jarak lingkaran besar Haversine:

| Event ID | Lokasi Pengamatan | Jarak ($R_{epi}$) | Format Nilai Asli | Rentang Batas | Titik Tengah Matematis | Estimasi GMPE Median | Selisih ($Err$) | Status Rentang | URL Sumber Resmi Terlacak |
| :--- | :--- | :-: | :--- | :-: | :-: | :-: | :-: | :---: | :--- |
| `us6000m0tt` | Sumedang Kota | $14.2\text{ km}$ | CDI 5.4 (DYFI) / IV-V MMI | $[4.0, 5.4]$ | $5.40$ | $4.07$ | $-1.33$ | **DALAM RENTANG** | [USGS DYFI us6000m0tt](https://earthquake.usgs.gov/earthquakes/eventpage/us6000m0tt/dyfi) |
| `us6000m0tt` | Cileunyi / Rancaekek | $22.0\text{ km}$ | III MMI | $[3.0, 3.0]$ | $3.00$ | $3.71$ | $+0.71$ | DI LUAR RENTANG | [BMKG Gempadirasakan](https://data.bmkg.go.id/DataMKG/TEWS/gempadirasakan.json) |
| `us6000m0tt` | Lembang | $23.9\text{ km}$ | III MMI | $[3.0, 3.0]$ | $3.00$ | $3.55$ | $+0.55$ | DI LUAR RENTANG | [BMKG Gempadirasakan](https://data.bmkg.go.id/DataMKG/TEWS/gempadirasakan.json) |
| `us6000m0tt` | Bandung Kota | $29.5\text{ km}$ | II-III MMI | $[2.0, 3.0]$ | $2.50$ | $3.47$ | $+0.97$ | DI LUAR RENTANG | [BMKG Gempadirasakan](https://data.bmkg.go.id/DataMKG/TEWS/gempadirasakan.json) |
| `us6000m0tt` | Subang | $22.4\text{ km}$ | II-III MMI | $[2.0, 3.0]$ | $2.50$ | $3.61$ | $+1.11$ | DI LUAR RENTANG | [BMKG Gempadirasakan](https://data.bmkg.go.id/DataMKG/TEWS/gempadirasakan.json) |
| `us6000m0tt` | Garut | $51.8\text{ km}$ | II MMI | $[2.0, 2.0]$ | $2.00$ | $2.87$ | $+0.87$ | DI LUAR RENTANG | [BMKG Gempadirasakan](https://data.bmkg.go.id/DataMKG/TEWS/gempadirasakan.json) |
| `us6000jlxv` | Cianjur Kota | $18.2\text{ km}$ | III-IV MMI | $[3.0, 4.0]$ | $3.50$ | $3.61$ | $+0.11$ | **DALAM RENTANG** | [BMKG Gempadirasakan](https://data.bmkg.go.id/DataMKG/TEWS/gempadirasakan.json) |
| `us6000jlxv` | Cipanas | $14.3\text{ km}$ | III MMI | $[3.0, 3.0]$ | $3.00$ | $3.72$ | $+0.72$ | DI LUAR RENTANG | [BMKG Gempadirasakan](https://data.bmkg.go.id/DataMKG/TEWS/gempadirasakan.json) |
| `us6000jlxv` | Cikalongkulon | $27.9\text{ km}$ | III MMI | $[3.0, 3.0]$ | $3.00$ | $3.21$ | $+0.21$ | DI LUAR RENTANG | [BMKG Gempadirasakan](https://data.bmkg.go.id/DataMKG/TEWS/gempadirasakan.json) |
| `us6000jlxv` | Sukabumi | $10.0\text{ km}$ | II MMI | $[2.0, 2.0]$ | $2.00$ | $3.93$ | $+1.93$ | DI LUAR RENTANG | [BMKG Gempadirasakan](https://data.bmkg.go.id/DataMKG/TEWS/gempadirasakan.json) |
| `us6000jlxv` | Bogor | $34.2\text{ km}$ | II MMI | $[2.0, 2.0]$ | $2.00$ | $2.97$ | $+0.97$ | DI LUAR RENTANG | [BMKG Gempadirasakan](https://data.bmkg.go.id/DataMKG/TEWS/gempadirasakan.json) |
| `us6000k49j` | Tuban | $95.5\text{ km}$ | CDI 3.8 (DYFI) / III-IV MMI | $[3.0, 4.0]$ | $3.80$ | $3.96$ | $+0.16$ | **DALAM RENTANG** | [USGS DYFI us6000k49j](https://earthquake.usgs.gov/earthquakes/eventpage/us6000k49j/dyfi) |
| `us6000k49j` | Rembang / Blora | $107.9\text{ km}$ | III-IV MMI | $[3.0, 4.0]$ | $3.50$ | $3.87$ | $+0.37$ | **DALAM RENTANG** | [BMKG Gempadirasakan](https://data.bmkg.go.id/DataMKG/TEWS/gempadirasakan.json) |
| `us6000k49j` | Surabaya | $155.2\text{ km}$ | CDI 3.6 (DYFI) / III-IV MMI | $[3.0, 4.0]$ | $3.60$ | $3.92$ | $+0.32$ | **DALAM RENTANG** | [USGS DYFI us6000k49j](https://earthquake.usgs.gov/earthquakes/eventpage/us6000k49j/dyfi) |
| `us6000k49j` | Karangkates / Malang | $238.6\text{ km}$ | V MMI (Anomali Aluvium) | $[5.0, 5.0]$ | $5.00$ | $3.83$ | $-1.17$ | DI LUAR RENTANG | [BMKG Gempadirasakan](https://data.bmkg.go.id/DataMKG/TEWS/gempadirasakan.json) |
| `us6000k49j` | Bandung / Garut | $499.7\text{ km}$ | II-III MMI | $[2.0, 3.0]$ | $2.50$ | $3.14$ | $+0.64$ | DI LUAR RENTANG | [BMKG Gempadirasakan](https://data.bmkg.go.id/DataMKG/TEWS/gempadirasakan.json) |
| `us6000k49j` | Jakarta | $574.9\text{ km}$ | CDI 2.7 (DYFI) / II-III MMI | $[2.0, 3.0]$ | $2.70$ | $3.03$ | $+0.33$ | DI LUAR RENTANG | [USGS DYFI us6000k49j](https://earthquake.usgs.gov/earthquakes/eventpage/us6000k49j/dyfi) |
| `us6000k49j` | Denpasar / Bali | $455.0\text{ km}$ | CDI 2.9 (DYFI) / II-III MMI | $[2.0, 3.0]$ | $2.90$ | $3.26$ | $+0.36$ | DI LUAR RENTANG | [USGS DYFI us6000k49j](https://earthquake.usgs.gov/earthquakes/eventpage/us6000k49j/dyfi) |
| `us7000j36j` | Saumlaki | $175.4\text{ km}$ | CDI 5.4 (DYFI) / V MMI | $[5.0, 6.0]$ | $5.40$ | $6.41$ | $+1.01$ | DI LUAR RENTANG | [USGS DYFI us7000j36j](https://earthquake.usgs.gov/earthquakes/eventpage/us7000j36j/dyfi) |
| `us7000j36j` | Tiakur / Moa | $259.3\text{ km}$ | IV MMI | $[4.0, 4.0]$ | $4.00$ | $5.29$ | $+1.29$ | DI LUAR RENTANG | [BMKG Gempadirasakan](https://data.bmkg.go.id/DataMKG/TEWS/gempadirasakan.json) |
| `us7000j36j` | Dobo | $486.9\text{ km}$ | III-IV MMI | $[3.0, 4.0]$ | $3.50$ | $3.41$ | $-0.09$ | **DALAM RENTANG** | [BMKG Gempadirasakan](https://data.bmkg.go.id/DataMKG/TEWS/gempadirasakan.json) |
| `us7000j36j` | Ambon | $425.8\text{ km}$ | III-IV MMI | $[3.0, 4.0]$ | $3.50$ | $3.68$ | $+0.18$ | **DALAM RENTANG** | [BMKG Gempadirasakan](https://data.bmkg.go.id/DataMKG/TEWS/gempadirasakan.json) |
| `us7000j36j` | Sorong | $700.7\text{ km}$ | III MMI | $[3.0, 3.0]$ | $3.00$ | $2.48$ | $-0.52$ | DI LUAR RENTANG | [BMKG Gempadirasakan](https://data.bmkg.go.id/DataMKG/TEWS/gempadirasakan.json) |
| `us7000j36j` | Alor | $598.4\text{ km}$ | III MMI | $[3.0, 3.0]$ | $3.00$ | $2.90$ | $-0.10$ | DI LUAR RENTANG | [BMKG Gempadirasakan](https://data.bmkg.go.id/DataMKG/TEWS/gempadirasakan.json) |
| `us6000mkfz` | Pulau Bawean | $31.8\text{ km}$ | V-VI MMI | $[5.0, 6.0]$ | $5.50$ | $5.67$ | $+0.17$ | **DALAM RENTANG** | [BMKG Gempadirasakan](https://data.bmkg.go.id/DataMKG/TEWS/gempadirasakan.json) |
| `us6000mkfz` | Tuban | $118.8\text{ km}$ | III-IV MMI | $[3.0, 4.0]$ | $3.50$ | $3.58$ | $+0.08$ | **DALAM RENTANG** | [BMKG Gempadirasakan](https://data.bmkg.go.id/DataMKG/TEWS/gempadirasakan.json) |
| `us6000mkfz` | Gresik | $146.3\text{ km}$ | III-IV MMI | $[3.0, 4.0]$ | $3.50$ | $3.35$ | $-0.15$ | **DALAM RENTANG** | [BMKG Gempadirasakan](https://data.bmkg.go.id/DataMKG/TEWS/gempadirasakan.json) |
| `us6000mkfz` | Surabaya | $158.7\text{ km}$ | III-IV MMI | $[3.0, 4.0]$ | $3.50$ | $3.24$ | $-0.26$ | **DALAM RENTANG** | [BMKG Gempadirasakan](https://data.bmkg.go.id/DataMKG/TEWS/gempadirasakan.json) |
| `us6000mkfz` | Semarang | $246.9\text{ km}$ | II-III MMI | $[2.0, 3.0]$ | $2.50$ | $2.52$ | $+0.02$ | **DALAM RENTANG** | [BMKG Gempadirasakan](https://data.bmkg.go.id/DataMKG/TEWS/gempadirasakan.json) |
| `us6000mkfz` | Yogyakarta | $307.1\text{ km}$ | II-III MMI | $[2.0, 3.0]$ | $2.50$ | $1.97$ | $-0.53$ | DI LUAR RENTANG | [BMKG Gempadirasakan](https://data.bmkg.go.id/DataMKG/TEWS/gempadirasakan.json) |

---

### Tabel 3: Metrik Kinerja Statistik Sah Hasil Audit Data (Task 4)

| Metrik Validasi | Nilai Sah Terverifikasi | Interpretasi Ilmiah & Catatan Audit |
| :--- | :---: | :--- |
| **Total Kejadian Gempa Sah** | **5 Kejadian** | Seluruhnya terdaftar pada katalog resmi BMKG dan USGS; skenario sintetis dikeluarkan. |
| **Total Titik Observasi Terverifikasi** | **30 Titik** | 100% memiliki rujukan resmi terlacak (USGS DYFI atau BMKG Gempadirasakan). |
| **Rata-rata Bias Global (Median GMPE)** | **$+0.298\text{ MMI}$** | Model memiliki kecenderungan sedikit *overprediction* (+0.3 MMI), sifat yang aman untuk sistem peringatan dini. |
| **Mean Absolute Error (MAE)** | **$0.574\text{ MMI}$** | Deviasi rata-rata absolut sekitar setengah skala MMI. |
| **Root Mean Square Error (RMSE)** | **$0.740\text{ MMI}$** | Deviasi kuadratik rata-rata terpelihara di bawah 1 unit skala MMI. |
| **Interval Containment Rate** | **$40.0\%$ (12/30 Titik)** | Proporsi di mana nilai estimasi jatuh tepat di dalam rentang interval observasi kualitatif $[I_{min}, I_{max}]$. |
| **Event Terbaik (Bawean `us6000mkfz`)** | **MAE $0.202\text{ MMI}$, Match $83.3\%$** | Thompson-Worden $E[R_{jb}]$ terbukti sangat akurat pada sesar dangkal $M_w 6.4$. |
| **Event dengan Deviasi Tertinggi (Sumedang & Cianjur)** | **Bias $+0.48$ s.d. $+0.79\text{ MMI}$** | Konfirmasi overprediksi BSSA14 pada jarak jauh untuk gempa $M < 5$. |

---

## 7. Keputusan Kelayakan: GO / NO-GO Menuju Task 5

Berdasarkan hasil koreksi validitas data empiris Task 4:

### 1. Status Validasi Data Task 4: **PASS**
- Seluruh 5 ID gempa, koordinat hiposenter, tanggal kejadian, dan 30 titik observasi resmi telah tervalidasi 100% terhadap katalog USGS dan BMKG.
- Skenario sintetis telah dipisahkan secara disiplin dari evaluasi empiris.

### 2. Pemicu Pembuatan Laporan Insiden Otomatis (`CANDIDATE_AUTO_REPORT`): **STRICTLY NO-GO (BLOCKED PERMANEN)**
- **Alasan Ilmiah**: Deviasi residual lokal masih mencapai $-1.33\text{ MMI}$ pada Sumedang dan $+1.29\text{ MMI}$ pada Tiakur. Ketidakpastian lokal ini menegaskan bahwa GMPE tidak boleh digunakan untuk memicu tiket insiden otomatis di database produksi tanpa validasi instrumen ShakeMap resmi BMKG/USGS.
- **Aturan Baku Operasional**: Pembuatan tiket insiden darurat otomatis pada database produksi SPARTA SIAGA **tetap wajib dipagari secara eksklusif hanya oleh produk ShakeMap resmi BMKG/USGS** yang terbit.

### 3. Kelayakan Melanjutkan ke Task 5: **GO (CONDITIONAL)**
- **Kondisi Kelayakan**: Task 5 diizinkan berjalan secara bersyarat **hanya sebagai penelitian riset terisolasi (*Isolated Research Prototype*)**, yang berfokus pada evaluasi arsitektur modul advisory situasional, **tanpa modifikasi antarmuka aktif, tanpa aktivasi worker, dan tanpa mutasi database produksi/staging**.

---

## 8. Bahan Pembaruan Dokumen Kajian / PDF Terdahulu

Untuk memperbarui dokumen presentasi atau materi kajian teknis sebelumnya, poin-poin koreksi berikut wajib disesuaikan:

1. **Koreksi ID dan Sumber Resmi Lima Gempa Non-ShakeMap**:
   - Ganti ID tidak resmi dengan ID definitif USGS/BMKG: Sumedang (`us6000m0tt`), Susulan Cianjur (`us6000jlxv`), Laut Jawa Dalam (`us6000k49j`), Tanimbar (`us7000j36j`), dan Bawean (`us6000mkfz`).
2. **Koreksi Tiga Kategori Status ShakeMap**:
   - Cantumkan pembedaan status: `SHAKEMAP_NOT_PUBLISHED` (M < 5), `SHAKEMAP_AVAILABLE_NOT_CACHED` (ada di USGS API, belum di cache lokal), dan `SHAKEMAP_COVJSON_UNAVAILABLE` (BMKG tidak memproduksi CovJSON).
3. **Penyajian Metrik Sah Hasil Audit Data**:
   - Cantumkan metrik empiris yang sah: Global Bias $+0.298\text{ MMI}$, Global MAE $0.574\text{ MMI}$, Global RMSE $0.740\text{ MMI}$, dan Interval Containment $40.0\%$ (dengan Bawean mencapai $83.3\%$).
4. **Klarifikasi Titik Tengah Matematis vs Nilai Desimal Fisik**:
   - Tegaskan bahwa desimal dari BMKG adalah titik tengah interval analitis, bukan pembacaan sensor desimal kontinu.

---

## 9. Referensi Ilmiah Lengkap & DOI

1. **Boore, D. M., Stewart, J. P., Seyhan, E., & Atkinson, G. M. (2014)**. *NGA-West2 Equations for Predicting PGA, PGV, and 5% Damped PSA for Shallow Crustal Earthquakes*. Earthquake Spectra, 30(3), 1057-1085. DOI: [10.1193/070113EQS184M](https://doi.org/10.1193/070113EQS184M).
2. **Zhao, J. X., Zhang, J., Asano, A., Ohno, Y., Oouchi, T., Takahashi, T., Ogawa, H., Irikura, K., Thio, H. K., Somerville, P. G., Fukushima, Y., & Fukushima, Y. (2006)**. *Attenuation Relations of Strong Ground Motion in Japan Using Site Classification Based on Predominant Period*. Bulletin of the Seismological Society of America, 96(3), 898-913. DOI: [10.1785/0120050122](https://doi.org/10.1785/0120050122).
3. **Atkinson, G. M., & Boore, D. M. (2003)**. *Empirical Ground-Motion Relations for Subduction-Zone Earthquakes and Their Application to Cascadia and Other Regions*. Bulletin of the Seismological Society of America, 93(4), 1703-1729. DOI: [10.1785/0120020156](https://doi.org/10.1785/0120020156).
4. **Thompson, E. M., & Worden, C. B. (2018)**. *Estimating Rupture Distances without a Rupture*. Bulletin of the Seismological Society of America, 108(1), 371-379. DOI: [10.1785/0120170174](https://doi.org/10.1785/0120170174).
5. **Worden, C. B., Gerstenberger, M. C., Rhoades, D. A., & Wald, D. J. (2012)**. *Probabilistic Relationships between Ground-Motion Parameters and Modified Mercalli Intensity in California*. Bulletin of the Seismological Society of America, 102(1), 204-221. DOI: [10.1785/0120110156](https://doi.org/10.1785/0120110156).
6. **Wells, D. L., & Coppersmith, K. J. (1994)**. *New Empirical Relationships among Magnitude, Rupture Length, Rupture Width, Rupture Area, and Surface Displacement*. Bulletin of the Seismological Society of America, 84(4), 974-1002. DOI: [10.1785/BSSA0840040974](https://doi.org/10.1785/BSSA0840040974).
7. **Leonard, M. (2010)**. *Earthquake Fault Scaling: Self-Consistent Relating of Rupture Length, Width, Average Displacement, and Moment Release*. Bulletin of the Seismological Society of America, 100(5A), 1971-1988. DOI: [10.1785/0120090189](https://doi.org/10.1785/0120090189).
8. **Pusat Studi Gempa Nasional (PUSGEN) (2017, 2024)**. *Peta Sumber dan Bahaya Gempa Indonesia Tahun 2017 & Pemutakhiran Acuan PUSGEN 2024*. Pusat Penelitian dan Pengembangan Perumahan dan Permukiman, Balitbang Kementerian Pekerjaan Umum dan Perumahan Rakyat, Bandung.
9. **Badan Meteorologi, Klimatologi, dan Geofisika (BMKG) (2023, 2024)**. *Katalog Gempabumi Dirasakan dan Rilis Pers Gempa Bumi Sumedang, Bawean, dan Laut Jawa*. Pusat Gempabumi dan Tsunami, BMKG, Jakarta.
10. **United States Geological Survey (USGS) (2023, 2024)**. *Comprehensive Earthquake Catalog (ComCat) & Did You Feel It? (DYFI) Scientific Datasets*. USGS Earthquake Hazards Program, Golden, CO.
