# SPARTA SIAGA: Earthquake GMPE Fallback POC Report
**Evaluasi Kelayakan Ground Motion Prediction Equations (GMPE) sebagai Alternatif Ilmiah Fallback Intensitas Gempa (Task 3: Validasi Independen, Verifikasi Numerik, dan Evaluasi GO/NO-GO)**

- **Dokumen**: Proof of Concept & Scientific Feasibility Report (Task 3 Independent Validation Closeout)
- **Branch Target**: `dev`
- **Tanggal Evaluasi**: 3 November 2026
- **Status Validasi Eksternal**: **NOT INDEPENDENTLY VERIFIED** (Pustaka seismologi pihak ketiga bersertifikasi seperti OpenQuake engine atau py-shakemap USGS tidak terpasang di environment lokal; verifikasi numerik saat ini murni berupa penurunan ulang persamaan matematika internal terhadap tabel koefisien publikasi asli)
- **Status Kelayakan Operasional**: **CONDITIONAL (FEASIBLE HANYA SEBAGAI PENELITIAN RISET TERISOLASI DAN ADVISORY BANNER; STRICTLY BLOCKED DARI PEMICU LAPORAN OTOMATIS)**
- **Keputusan Task 4**: **NO-GO untuk Otomatisasi Laporan Darurat (`CANDIDATE_AUTO_REPORT`); GO (CONDITIONAL) sebagai Riset Penelitian Terisolasi (Isolated Research Prototype)**
- **Vonis Pengujian Perangkat Lunak**: **PASSED (19/19 Unit & Functional Tests Passing, 100%)**
- **Catatan Integritas Ilmiah**: 19/19 pengujian unit membuktikan ketepatan implementasi matematika kode terhadap persamaan publikasi asli, BUKAN membuktikan kesempurnaan akurasi prediksi fisik terhadap alam.
- **Aturan Penulisan**: Zero Em Dashes. Seluruh pemisah menggunakan tanda hubung `-` atau titik dua `:`.

---

## 1. Executive Summary & Ringkasan Task 3

Task 3 berfokus pada **validasi mandiri** terhadap seluruh persamaan atenuasi getaran tanah (GMPE), model konversi jarak rekahan sesar (PS2FF), dan persamaan konversi intensitas (GMICE) yang diimplementasikan pada SPARTA SIAGA.

Tujuan utama evaluasi ini adalah:
1. Memverifikasi implementasi numerik terhadap kalkulator penurunan persamaan publikasi ilmiah acuan secara terpisah.
2. Memverifikasi koefisien, satuan fisik, parameter jarak ($R_{jb}, R_{rup}$), magnitudo ($M_w$), kecepatan gelombang geser tanah ($V_{s30}$), dan formulasi ketidakpastian ($\sigma$).
3. Mengevaluasi ulang benchmark 112 lokasi dengan estimasi ShakeMap MMI >= VI pada data resmi di 5 gempa historis Indonesia.
4. Mengidentifikasi kesalahan ilmiah, komponen penyederhanaan model, keterbatasan fisik, dan risiko *overfitting* tanpa manipulasi atau klaim berlebihan.
5. Menetapkan keputusan tegas **GO / NO-GO** untuk kelanjutan integrasi operasional (Task 4).

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

### Keterbatasan Fisik Tambahan & Risiko Overfitting:

6. **Keterbatasan Estimator PGA Tunggal vs PGV pada Kerusakan Struktur**:
   Publikasi Worden et al. (2012) menegaskan bahwa untuk intensitas guncangan kuat ($MMI \ge VI$), kecepatan puncak tanah (PGV) dan respon spektral periode menengah ($0.3 - 1.0\text{ s}$) memiliki korelasi kerusakan fisik yang jauh lebih tinggi dibanding PGA frekuensi tinggi sesaat.
7. **Risiko Overfitting Pemilihan Nilai $V_{s30}$ Statis**:
   Menurunkan nilai $V_{s30}$ seragam secara nasional ke $270\text{ m/s}$ atau $180\text{ m/s}$ semata-mata demi menaikkan sensitivitas deteksi pada gempa Cianjur dan Lombok berpotensi menimbulkan *overfitting*, yang memicu lonjakan alarm palsu (*False Positives*) pada gempa yang terjadi di formasi batuan keras.
8. **Dilema Fundamental: Deterministik Median vs Batas Atas $+1\sigma$**:
   - Pada median (CFG-4), model memiliki tingkat bahaya terlewat (*Missed Alert Rate*) sebesar **63.39%**.
   - Pada batas atas $+1\sigma$ (CFG-6), tingkat bahaya terlewat ditekan hingga tinggal **5.36% (Recall 94.64%)**, namun menghasilkan **51 alarm palsu** pada toko-toko yang berada di zona guncangan rendah.

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

### Analisis Kritis Perbandingan Konfigurasi:
- **Baseline Fase 1 (CFG-1)**: Melewatkan 98.21% lokasi dengan estimasi ShakeMap MMI >= VI karena jarak dihitung murni dari titik episenter dan tanah diasumsikan seragam keras.
- **Penyempurnaan Fase 2 Deterministik (CFG-4)**: Deteksi meningkat dari 2 menjadi 41 lokasi, Recall naik ke 36.61% dengan Presisi 95.35%. Namun masih terdapat **63.39% lokasi yang terlewat**.
- **Batas Atas Kesiapsiagaan $+1\sigma$ (CFG-6)**: Menangkap 94.64% lokasi potensi guncangan kuat (106 lokasi), tetapi memicu 51 alarm palsu.

---

## 6. Keputusan Kelayakan: GO / NO-GO untuk Task 4

Berdasarkan evaluasi statistik dan keterbatasan fisik model di atas, diputuskan:

### 1. Pemicu Pembuatan Laporan Insiden Otomatis (`CANDIDATE_AUTO_REPORT`): **NO-GO (STRICTLY BLOCKED)**
- **Alasan Ilmiah**: Nilai median deterministik GMPE terbaik (CFG-4) masih melewatkan 63.39% lokasi dengan estimasi ShakeMap MMI >= VI (False Negative). Jika batas deteksi dinaikkan ke persentil $+1\sigma$ (CFG-6) untuk mengejar recall 94.64%, sistem menghasilkan 51 alarm palsu yang akan memicu tiket laporan darurat palsu di cabang yang aman.
- **Aturan Baku Operasional**: Pembuatan tiket insiden darurat otomatis pada database produksi SPARTA SIAGA **tetap wajib dipagari secara eksklusif hanya oleh produk ShakeMap resmi BMKG/USGS** yang terbit.

### 2. Kelayakan Melanjutkan Task 4: **GO HANYA SEBAGAI PENELITIAN RISET TERISOLASI (ISOLATED RESEARCH PROTOTYPE)**
- **Batasan Riset**: Task 4 diizinkan berjalan secara bersyarat murni sebagai modul eksperimen terisolasi untuk menguji visualisasi advisory banner atau evaluasi algoritma di sandbox pengujian, **tanpa integrasi ke alur pelaporan otomatis aktif, tanpa perubahan pada worker operasional, dan tanpa mutasi database produksi/staging**.

---

## 7. Bahan Pembaruan Dokumen Kajian / PDF Terdahulu

Untuk memperbarui dokumen presentasi atau materi kajian teknis sebelumnya, poin-poin koreksi berikut wajib disesuaikan:

1. **Koreksi Klaim Akurasi Global 95.56%**:
   - *Dokumen Lama*: Mengklaim akurasi sistem mencapai 95.56%.
   - *Pembaruan Wajib*: Jelaskan bahwa 95.56% adalah fenomena *Accuracy Paradox* yang didorong oleh 2.368 fasilitas aman di luar jangkauan gempa. Kemampuan deteksi pada lokasi dengan estimasi ShakeMap MMI >= VI pada model awal sebenarnya hanya 1.79% (2 dari 112 fasilitas).
2. **Ralat Generalisasi Gempa $M < 5.0$ Pasti Aman**:
   - *Dokumen Lama*: Mengklaim gempa $M < 5.0$ dipastikan aman.
   - *Pembaruan Wajib*: Cantumkan bahwa gempa dangkal ($h \le 5\text{ km}$) bermagnitudo $M 4.0 - 4.8$ di atas tanah lunak ($V_{s30} \le 180\text{ m/s}$) pada rentang $+1\sigma$ secara teoritis dapat memicu guncangan lokal MMI >= VI pada radius sangat dekat ($R \le 5\text{ km}$).
3. **Penyertaan Model Rupture Thompson & Worden (2018)**:
   - Tambahkan diagram penjelasan mengapa jarak sumber titik ($R_{epi}$) mengalami distorsi pada gempa bermagnitudo $\ge 6.0$ dan bagaimana integrasi $E[R_{jb}]$ memulihkan estimasi jarak sesar di Lombok dan Palu.
4. **Pemisahan Tiga Rezim Tektonik & Atribusi Model**:
   - Cantumkan pemisahan eksplisit: Kerak Dangkal (BSSA14), Subduksi Interface (Zhao06 + AB03 Interface), dan Subduksi Intraslab (Zhao06 + AB03 Intraslab).
   - Nyatakan bahwa model subduksi saat ini adalah representasi empiris terbatas, bukan pohon logika komprehensif PUSGEN 2024.
5. **Penetapan Batasan Operasional Dual-Track**:
   - Tegaskan bahwa GMPE hanya berfungsi sebagai *advisory banner* kesiapsiagaan visual dan **bukan** pemicu pembuatan laporan otomatis insiden fasilitas.

---

## 8. Referensi Ilmiah Lengkap & DOI

1. **Boore, D. M., Stewart, J. P., Seyhan, E., & Atkinson, G. M. (2014)**. *NGA-West2 Equations for Predicting PGA, PGV, and 5% Damped PSA for Shallow Crustal Earthquakes*. Earthquake Spectra, 30(3), 1057-1085. DOI: [10.1193/070113EQS184M](https://doi.org/10.1193/070113EQS184M).
2. **Zhao, J. X., Zhang, J., Asano, A., Ohno, Y., Oouchi, T., Takahashi, T., Ogawa, H., Irikura, K., Thio, H. K., Somerville, P. G., Fukushima, Y., & Fukushima, Y. (2006)**. *Attenuation Relations of Strong Ground Motion in Japan Using Site Classification Based on Predominant Period*. Bulletin of the Seismological Society of America, 96(3), 898-913. DOI: [10.1785/0120050122](https://doi.org/10.1785/0120050122).
3. **Atkinson, G. M., & Boore, D. M. (2003)**. *Empirical Ground-Motion Relations for Subduction-Zone Earthquakes and Their Application to Cascadia and Other Regions*. Bulletin of the Seismological Society of America, 93(4), 1703-1729. DOI: [10.1785/0120020156](https://doi.org/10.1785/0120020156).
4. **Thompson, E. M., & Worden, C. B. (2018)**. *Estimating Rupture Distances without a Rupture*. Bulletin of the Seismological Society of America, 108(1), 371-379. DOI: [10.1785/0120170174](https://doi.org/10.1785/0120170174).
5. **Worden, C. B., Gerstenberger, M. C., Rhoades, D. A., & Wald, D. J. (2012)**. *Probabilistic Relationships between Ground-Motion Parameters and Modified Mercalli Intensity in California*. Bulletin of the Seismological Society of America, 102(1), 204-221. DOI: [10.1785/0120110156](https://doi.org/10.1785/0120110156).
6. **Wells, D. L., & Coppersmith, K. J. (1994)**. *New Empirical Relationships among Magnitude, Rupture Length, Rupture Width, Rupture Area, and Surface Displacement*. Bulletin of the Seismological Society of America, 84(4), 974-1002. DOI: [10.1785/BSSA0840040974](https://doi.org/10.1785/BSSA0840040974).
7. **Leonard, M. (2010)**. *Earthquake Fault Scaling: Self-Consistent Relating of Rupture Length, Width, Average Displacement, and Moment Release*. Bulletin of the Seismological Society of America, 100(5A), 1971-1988. DOI: [10.1785/0120090189](https://doi.org/10.1785/0120090189).
8. **Pusat Studi Gempa Nasional (PUSGEN) (2017, 2024)**. *Peta Sumber dan Bahaya Gempa Indonesia Tahun 2017 & Pemutakhiran Acuan PUSGEN 2024*. Pusat Penelitian dan Pengembangan Perumahan dan Permukiman, Balitbang Kementerian Pekerjaan Umum dan Perumahan Rakyat, Bandung.
