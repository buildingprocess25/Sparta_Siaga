# 🏢 Panduan Lengkap Proses Bisnis & Alur Operasional: SPARTA Siaga
**Dokumen Referensi Arsitektur Bisnis, Logika Sistem, Detail Perhitungan Matematis, dan SOP Tanggap Bencana**

- **Modul:** SPARTA Siaga (`sparta-siaga`)
- **Organisasi:** Alfamart (PT Sumber Alfaria Trijaya Tbk) - SPARTA Ecosystem
- **Cakupan Aset:** 21.550 Gerai Toko Fisik & 28 Kantor Cabang / Distribution Center (DC)
- **Status Operasional:** Active Canonical Guide

> [!IMPORTANT] CANONICAL WORKFLOW & MULTI-ROLE ALIGNMENT
> Dokumen ini memuat panduan lengkap arsitektur bisnis, SOP, dan logika matematis SPARTA SIAGA:
> 1. **Alur Pelaporan & Penanganan Kerusakan:**
>    - **Pelaporan:** Dibuat secara manual atau otomatis via BMKG/USGS dengan status awal `pending_confirmation` dan progres `0%`.
>    - **Pemeriksaan Lapangan:** Spesialis Lapangan (BMS untuk Toko, BES untuk DC, BBS untuk Gedung) wajib mengunggah bukti foto nyata (minimal 1 foto).
>    - **Konfirmasi Awal BnM Manajer:** BnM Manajer mengevaluasi laporan dan menentukan 1 dari 3 keputusan:
>      - *Ada Kerusakan:* Menetapkan status `confirmed_affected`, mendistribusikan email outbox ke HO, dan membuka alur tracking milestone fisik.
>      - *Tidak Ada Kerusakan:* Menetapkan status `confirmed_safe` dengan progres 100%, selesai langsung tanpa pekerjaan pemeliharaan.
>      - *Perlu Klarifikasi:* Menetapkan status `clarification_requested`, mengembalikan tiket ke spesialis pemeriksa untuk revisi bukti.
>    - **Pekerjaan & Milestone:** 5 milestone dokumen (Ceklis 10%, Estimasi 25%, Approve Proxy 30%, SPK 50%, Serah Terima 100%). Menjaga aturan non-auto-close: status berada di `awaiting_st`.
>    - **Review Koordinator:** Koordinator wilayah (BMC untuk Toko, BEC untuk DC, BBC untuk Gedung) memverifikasi penyelesaian fisik. Upaya koordinasi silang ditolak (403 `COORDINATOR_MISMATCH`).
>    - **Persetujuan Akhir & Case Close:** BnM Manajer memberikan persetujuan akhir dan menutup tiket resmi (`closed`).
> 2. **Penyempurnaan Istilah "Duty Officer":** Penggunaan istilah historis "Duty Officer" pada dokumen ini dipetakan ke peran kanonikal: PIC Spesialis Lapangan (`bms`/`bes`/`bbs`), Koordinator (`bmc`/`bec`/`bbc`), BnM Manajer (`bmm`), dan Head Office (`ho`).
> 3. **Head Office Strictly Read-Only:** Pemantauan nasional bersifat read-only setelah laporan dikonfirmasi BnM Manajer. HO diblokir dari seluruh aksi mutasi operasional.
> 4. **Zero Operational Bypass:** System Administrator dilarang mengeksekusi konfirmasi lapangan atau Case Close.
- **Dokumen Terkait:** [PROGRESS_LOG_AND_CHANGELOG.md](../04-progress-and-changelog/PROGRESS_LOG_AND_CHANGELOG.md)

---

## 📑 DAFTAR ISI
1. [Latar Belakang & Nilai Bisnis Sistem](#1-latar-belakang--nilai-bisnis-sistem)
2. [Siklus Pembaruan Data Real-Time (Update Interval)](#2-siklus-pembaruan-data-real-time-update-interval)
3. [Peta Alur Kerja End-to-End (Workflow Diagram)](#3-peta-alur-kerja-end-to-end-workflow-diagram)
4. [Detail Rumus Perhitungan & Contoh Kasus Nyata](#4-detail-rumus-perhitungan--contoh-kasus-nyata)
   - [4.1 Perhitungan Jarak Spasial (Haversine Formula) & Contoh](#41-perhitungan-jarak-spasial-haversine-formula--contoh)
   - [4.2 Perhitungan Radius Atenuasi Seismik BMKG & Contoh](#42-perhitungan-radius-atenuasi-seismik-bmkg--contoh)
   - [4.3 Perhitungan Ambang Batas Curah Hujan & Potensi Banjir](#43-perhitungan-ambang-batas-curah-hujan--potensi-banjir)
   - [4.4 Logika Deduplikasi Notifikasi Otomatis (Anti-Spam)](#44-logika-deduplikasi-notifikasi-otomatis-anti-spam)
5. [Rincian 4 Pilar Utama Sistem](#5-rincian-4-pilar-utama-sistem)
6. [Matriks Peran & Tanggung Jawab Aktor (RACI)](#6-matriks-peran--tanggung-jawab-aktor-raci)
7. [Standard Operating Procedure (SOP) Langkah Demi Langkah](#7-standard-operating-procedure-sop-langkah-demi-langkah)
8. [Kepatuhan Etika & UU Perlindungan Data Pribadi (UU PDP)](#8-kepatuhan-etika--uu-perlindungan-data-pribadi-uu-pdp)

---

## 1. Latar Belakang & Nilai Bisnis Sistem

### 1.1 Tantangan Operasional Ritel Skala Nasional
Alfamart mengoperasikan **21.550 gerai toko fisik** yang disuplai oleh **28 Kantor Cabang / Distribution Center (DC)** di seluruh kepulauan Indonesia. Wilayah Indonesia berada di jalur *Ring of Fire* (Cincin Api Pasifik) serta pertemuan lempeng tektonik Indo-Australia, Eurasia, dan Pasifik yang menjadikannya sangat rentan terhadap:
- **Gempa Bumi Tektonik & Vulkanik:** Kerusakan integritas fisik bangunan gerai, plafon runtuh, dan ancaman keselamatan kru/pelanggan.
- **Tsunami Pesisir:** Gelombang laut destruktif akibat gempa dangkal dasar laut.
- **Cuaca Ekstrem & Banjir:** Curah hujan lebat mendadak yang merendam inventori stok dagang di lantai dasar toko dan memutus rute truk pasokan DC.

### 1.2 Nilai Bisnis & Solusi SPARTA Siaga
SPARTA Siaga bertindak sebagai **Pusat Intelijen Spasial & Tanggap Bencana Otomatis** yang:
- Mengidentifikasi toko terdampak dalam hitungan detik setelah BMKG merilis parameter gempa.
- Menggunakan kalkulasi ilmiah atenuasi BMKG (berdasarkan magnitudo dan kedalaman hiposentrum) menggantikan perkiraan manual.
- Mengoperasikan *background worker* otomatis untuk mengeskalasi peringatan darurat ke Duty Officer DC Cabang.
- Memangkas waktu tanggap krisis (*Mean Time to Response*) dari hitungan jam menjadi **di bawah 2 menit**.

---

## 2. Siklus Pembaruan Data Real-Time (Update Interval)

Sistem mengadopsi siklus penarikan data berkala (*continuous automated polling*) dengan jeda pembaruan sebagai berikut:

| Sumber Data | Frekuensi Pembaruan | Mekanisme Teknis | Keterangan Operasional |
| :--- | :---: | :--- | :--- |
| **BMKG AutoGempa & Gempa Terkini** | **Setiap 60 Detik (1 Menit)** | Polling API BMKG dengan *Server In-Memory Cache TTL 60s* | Menangkap gempa berkekuatan $M \ge 5.0$, gempa berpotensi tsunami, dan 15 gempa terbaru secara seketika. |
| **USGS Real-Time Feed** | **Setiap 60 Detik (1 Menit)** | Polling GeoJSON USGS bersamaan dengan feed BMKG | Sinyal pembanding dan pelengkap untuk gempa perbatasan/regional laut. |
| **Background Worker Engine** | **Setiap 60 Detik (1 Menit)** | Background Interval `POST /api/notifications/worker` | Mengevaluasi radius bencana vs 21.550 toko; jika ada toko di zona bahaya baru, langsung kirim Email DC & Push PWA. |
| **Radar Cuaca Satelit (RainViewer)** | **Setiap 5 Menit (300 Detik)** | Proxy endpoint `/api/weather/radar` (Cache TTL 300s) | Mengikuti perputaran citra komposit radar global RainViewer yang diperbarui per 10 menit. |
| **Prakiraan Cuaca Toko (Open-Meteo)** | **On-Demand (Per Jam)** | Diambil saat drawer toko dibuka / saat evaluasi cuaca gerai | Memuat data suhu, kecepatan angin, dan intensitas hujan real-time (mm/jam). |
| **Master Toko (Aiven PostgreSQL)** | **Real-Time / 24 Jam Cache** | Di-cache di memori server dan disinkronkan ke PostgreSQL | Membaca 21.550 koordinat toko dalam $\le 120\text{ ms}$. |

---

## 3. Peta Alur Kerja End-to-End (Workflow Diagram)

```text
 ┌────────────────────────────────────────────────────────────────────────┐
 │                      1. DATA INGESTION ENGINE                          │
 │  • 21.550 Toko Alfamart di Cloud Aiven PostgreSQL                      │
 │  • Feed Gempa BMKG & USGS (Update Tiap 60 Detik)                       │
 │  • Radar Cuaca Doppler RainViewer (Update Tiap 5 Menit)                │
 └──────────────────────────────────┬─────────────────────────────────────┘
                                    │
                                    ▼
 ┌────────────────────────────────────────────────────────────────────────┐
 │                   2. SPATIAL & RISK IMPACT ENGINE                      │
 │  • Hitung Jarak Lingkaran Besar (Haversine Formula)                    │
 │  • Hitung Atenuasi Seismik BMKG (R_danger & R_warning Otomatis)        │
 │  • Klasifikasi Status Toko: 🔴 Bahaya | 🟡 Waspada | 🟢 Aman           │
 │  • Evaluasi Presipitasi Hujan Ekstrem (≥ 20 mm/jam) 💧                 │
 └──────────────────────────────────┬─────────────────────────────────────┘
                                    │
                  ┌─────────────────┴─────────────────┐
                  ▼                                   ▼
 ┌─────────────────────────────────┐ ┌────────────────────────────────────┐
 │  3. PETA COMMAND CENTER (UI/UX) │ │ 4. BACKGROUND WORKER OTOMATIS      │
 │  • Mode Fokus Krisis (Default)  │ │ • Siklus Evaluasi Tiap 60 Detik    │
 │  • Layer Radar Cuaca Satelit    │ │ • Gempa: Email Resmi DC + PWA Alert│
 │  • Spotlight Search (0ms Lag)   │ │ • Banjir: Khusus Push PWA HP Dinas │
 │  • Pin Target 🎯 & Beacon Denyut│ │ • Deduplikasi 2 Jam (Anti-Spam)    │
 │  • Audio Emergency Chime        │ │ • Log Terstruktur Aiven PostgreSQL │
 └─────────────────────────────────┘ └─────────────────┬──────────────────┘
                                                       │
                                                       ▼
 ┌────────────────────────────────────────────────────────────────────────┐
 │                    5. TINDAKAN LAPANGAN & ESKALASI                     │
 │  • Duty Officer DC Cabang menerima Email Resmi + Tiket (#ESC-SID-...)  │
 │  • Panggilan Komando ke Area Coordinator (AC) / Area Manager (AM)      │
 │  • SOP Gerai: Evakuasi Pelanggan, Matikan Listrik MCB, Tanggul Banjir  │
 │  • Pelaporan Status Operasional (Buka / Tutup Sementara / Rusak)       │
 └────────────────────────────────────────────────────────────────────────┘
```

---

## 4. Detail Rumus Perhitungan & Contoh Kasus Nyata

Sistem SPARTA Siaga menerapkan kalkulasi matematis presisi tanpa tebakan manual. Berikut rincian rumus lengkap beserta contoh langkah demi langkah:

### 4.1 Perhitungan Jarak Spasial (Haversine Formula) & Contoh

#### A. Rumus Matematis:
Rumus *Haversine* digunakan untuk menghitung jarak lingkaran besar (*great-circle distance*) antara dua titik koordinat pada permukaan bola bumi:

$$\Delta \phi = (\text{lat}_2 - \text{lat}_1) \times \frac{\pi}{180}$$

$$\Delta \lambda = (\text{lon}_2 - \text{lon}_1) \times \frac{\pi}{180}$$

$$a = \sin^2\left(\frac{\Delta \phi}{2}\right) + \cos\left(\text{lat}_1 \times \frac{\pi}{180}\right) \cdot \cos\left(\text{lat}_2 \times \frac{\pi}{180}\right) \cdot \sin^2\left(\frac{\Delta \lambda}{2}\right)$$

$$c = 2 \cdot \text{atan2}\left(\sqrt{a}, \sqrt{1 - a}\right)$$

$$d = R \cdot c \quad (\text{dengan } R = 6.371\text{ km, jari-jari rata-rata bumi})$$

Hasil akhir $d$ dibulatkan hingga 1 desimal.

---

#### B. Contoh Kasus Nyata:
- **Titik Bencana (Episentrum Gempa Cianjur):**
  - $\text{lat}_1 = -6.834^\circ$, $\text{lon}_1 = 107.095^\circ$
- **Titik Toko (Alfamart SAT012 Raya Sukabumi):**
  - $\text{lat}_2 = -6.820^\circ$, $\text{lon}_2 = 107.140^\circ$

**Langkah Perhitungan:**
1. Hitung selisih radian:
   - $\Delta \phi = (-6.820 - (-6.834)) \times \frac{\pi}{180} = 0.014 \times 0.0174533 = 0.0002443\text{ rad}$
   - $\Delta \lambda = (107.140 - 107.095) \times \frac{\pi}{180} = 0.045 \times 0.0174533 = 0.0007854\text{ rad}$
2. Hitung komponen $a$:
   - $\sin^2(\Delta \phi / 2) = \sin^2(0.00012215) \approx 1.492 \times 10^{-8}$
   - $\cos(\text{lat}_1) \times \cos(\text{lat}_2) = \cos(-6.834^\circ) \times \cos(-6.820^\circ) = 0.99289 \times 0.99292 \approx 0.98586$
   - $\sin^2(\Delta \lambda / 2) = \sin^2(0.0003927) \approx 1.542 \times 10^{-7}$
   - $a = 1.492 \times 10^{-8} + (0.98586 \times 1.542 \times 10^{-7}) = 1.492 \times 10^{-8} + 1.520 \times 10^{-7} \approx 1.669 \times 10^{-7}$
3. Hitung jarak angular $c$:
   - $c = 2 \cdot \text{atan2}(\sqrt{1.669 \times 10^{-7}}, \sqrt{1 - 1.669 \times 10^{-7}}) \approx 2 \times 0.0004085 = 0.000817\text{ rad}$
4. Hitung jarak kilometer $d$:
   - $d = 6.371 \times 0.000817 \approx \mathbf{5.2\text{ km}}$

**Hasil:** Toko berjarak **5.2 km** dari episentrum gempa.

---

### 4.2 Perhitungan Radius Atenuasi Seismik BMKG & Contoh

#### A. Rumus Matematis:
Percepatan tanah dan intensitas getaran gempa di permukaan meluruh (*attenuates*) terhadap jarak hiposentrum. Berdasarkan hubungan empiris energi seismik BMKG:

1. **Radius Dasar Bahaya ($MMI \ge VI$ - Guncangan Merusak):**
   $$R_{\text{base}} = 10^{0.48 \cdot M - 1.15}$$
   *(di mana $M$ adalah Magnitudo gempa)*

2. **Faktor Redaman Kedalaman Hiposentrum ($\text{depthFactor}$):**
   Energi gempa dangkal terkonsentrasi penuh ke permukaan kerak bumi, sedangkan gempa dalam terdisipasi sebelum mencapai permukaan:

   | Kedalaman Hiposentrum ($D$) | Kategori Gempa | Faktor Redaman ($\text{depthFactor}$) |
   | :--- | :--- | :---: |
   | $D \le 20\text{ km}$ | Dangkal (*Shallow Crustal*) | **1.00** (Energi 100% tembus permukaan) |
   | $20 < D \le 50\text{ km}$ | Menengah-Dangkal | **0.85** |
   | $50 < D \le 100\text{ km}$ | Menengah | **0.65** |
   | $100 < D \le 200\text{ km}$ | Dalam (*Deep Subduction*) | **0.45** |
   | $D > 200\text{ km}$ | Sangat Dalam | **0.30** |

3. **Radius Bahaya ($R_{\text{danger}}$):**
   - Jika $M < 4.5$: Menggunakan nilai batas default aman: $R_{\text{danger}} = 15\text{ km}$, $R_{\text{warning}} = 35\text{ km}$.
   - Jika $M \ge 4.5$:
     $$R_{\text{danger}} = \max\left(15, \text{round}\left(R_{\text{base}} \times \text{depthFactor}\right)\right)\text{ km}$$

4. **Radius Waspada ($R_{\text{warning}}$ - $MMI\ IV - V$, Siaga Operasional):**
   Zona penyangga kewaspadaan diperhitungkan sebesar $2.2 \times$ radius bahaya:
   $$R_{\text{warning}} = \text{round}(R_{\text{danger}} \times 2.2)\text{ km}$$

---

#### B. Contoh Kasus 1: Gempa Dangkal Signifikan (M 5.6, Kedalaman 10 km)
*Kasus riil tipikal gempa sesar aktif darat (contoh: Gempa Darat Jawa Barat).*
- **Parameter:** $M = 5.6$, $D = 10\text{ km}$.
- **Langkah 1: Hitung $R_{\text{base}}$**
  $$R_{\text{base}} = 10^{0.48 \times 5.6 - 1.15} = 10^{2.688 - 1.15} = 10^{1.538} \approx 34.51\text{ km}$$
- **Langkah 2: Tentukan $\text{depthFactor}$**
  Karena $D = 10\text{ km} \le 20\text{ km}$, maka $\text{depthFactor} = \mathbf{1.0}$.
- **Langkah 3: Hitung $R_{\text{danger}}$**
  $$R_{\text{danger}} = \max(15, \text{round}(34.51 \times 1.0)) = \mathbf{35\text{ km}}$$
- **Langkah 4: Hitung $R_{\text{warning}}$**
  $$R_{\text{warning}} = \text{round}(35 \times 2.2) = \mathbf{77\text{ km}}$$

**Evaluasi Status Toko:**
- Toko dengan jarak $12\text{ km} \le 35\text{ km} \rightarrow$ 🔴 **ZONA BAHAYA** (Marker Merah Denyut, Wajib Evakuasi).
- Toko dengan jarak $50\text{ km}$ ($> 35\text{ km}$ dan $\le 77\text{ km}$) $\rightarrow$ 🟡 **ZONA WASPADA** (Marker Oranye, Siaga Operasional).
- Toko dengan jarak $95\text{ km} > 77\text{ km} \rightarrow$ 🟢 **AMAN**.

---

#### C. Contoh Kasus 2: Gempa Dalam Subduksi (M 6.2, Kedalaman 120 km)
*Kasus riil gempa lempeng subduksi laut dalam.*
- **Parameter:** $M = 6.2$, $D = 120\text{ km}$.
- **Langkah 1: Hitung $R_{\text{base}}$**
  $$R_{\text{base}} = 10^{0.48 \times 6.2 - 1.15} = 10^{2.976 - 1.15} = 10^{1.826} \approx 66.99\text{ km}$$
- **Langkah 2: Tentukan $\text{depthFactor}$**
  Karena $D = 120\text{ km}$ berada di rentang $100 < D \le 200$, maka $\text{depthFactor} = \mathbf{0.45}$.
- **Langkah 3: Hitung $R_{\text{danger}}$**
  $$R_{\text{danger}} = \max(15, \text{round}(66.99 \times 0.45)) = \max(15, \text{round}(30.15)) = \mathbf{30\text{ km}}$$
- **Langkah 4: Hitung $R_{\text{warning}}$**
  $$R_{\text{warning}} = \text{round}(30 \times 2.2) = \mathbf{66\text{ km}}$$

> 💡 **Wawasan Bisnis Utama:**  
> Meskipun Magnitudonya jauh lebih besar ($6.2$ dibanding $5.6$), karena kedalamannya $120\text{ km}$, radius bahaya permukaan justru **lebih kecil ($30\text{ km}$ dibanding $35\text{ km}$)**. Inilah bukti keunggulan formula ilmiah BMKG dibanding slider manual yang akan keliru menganggap gempa M 6.2 selalu berakibat lebih merusak di darat.

---

### 4.3 Perhitungan Ambang Batas Curah Hujan & Potensi Banjir

Sistem mengambil data presipitasi curah hujan dari satelit radar cuaca RainViewer dan Open-Meteo API dengan satuan **milimeter per jam (mm/jam)**:

| Intensitas Presipitasi ($P$) | Kategori Cuaca | Kode Warna Peta | Status Toko & Tindakan |
| :--- | :--- | :---: | :--- |
| $0.0 \le P < 5.0\text{ mm/jam}$ | Hujan Ringan / Gerimis | 🟩 Hijau | **Aman** (Operasional toko berjalan normal). |
| $5.0 \le P < 20.0\text{ mm/jam}$ | Hujan Sedang | 🟨 Kuning | **Waspada Ringan** (Pantau saluran air gerai). |
| $20.0 \le P < 50.0\text{ mm/jam}$ | Hujan Lebat (*Heavy Rain*) | 🟧 Oranye | 💧 **Potensi Banjir Aktif** (Badge tetesan air + ring aura biru). |
| $P \ge 50.0\text{ mm/jam}$ | Hujan Ekstrem / Badai | 🟥 Merah | 💧 **Darurat Banjir Bandang** (Penaikan stok dagang + tanggul gerai). |

#### Contoh Kasus Nyata:
- **Toko Alfamart Kaligawe (Semarang):** Mengalami curah hujan terukur $P = 32.4\text{ mm/jam}$.
- **Evaluasi Sistem:** Karena $32.4\text{ mm/jam} \ge 20.0\text{ mm/jam}$, sistem otomatis:
  1. Mengaktifkan flag `floodWarning = true` pada data toko.
  2. Pin gerai di peta memunculkan badge tetesan air `💧` dan ring aura biru berdenyut.
  3. Drawer detail toko memunculkan banner peringatan: *"Siaga Banjir: Segera Amankan Aset Dagang Lantai Dasar"*.
  4. Worker otomatis mengirim Push Notification PWA ke Duty Officer DC Cabang Semarang.

---

### 4.4 Logika Deduplikasi Notifikasi Otomatis (Anti-Spam)

Agar kotak masuk (*inbox*) email dan gawai dinas Duty Officer DC Cabang tidak dibanjiri spam peringatan berulang setiap 60 detik untuk bencana yang sama, sistem menerapkan **Deduplikasi Waktu Berbasis Database**:

$$\text{Duplikat} = \begin{cases} 
\text{TRUE (Skip kirim)}, & \text{jika } \exists \text{ log dengan } (\text{disaster\_id}, \text{branch}) \text{ dan } t_{\text{sent}} > (t_{\text{sekarang}} - 2\text{ jam}) \\
\text{FALSE (Kirim alert)}, & \text{lainnya}
\end{cases}$$

#### Contoh Kasus Nyata:
1. **Pukul 08:00:15 WIB:** Gempa bumi M 5.2 terjadi di pesisir Jawa Timur (`disaster_id = bmkg-20260925-0800`).
2. **Pukul 08:00:45 WIB:** Worker berjalan. Toko Cabang Sidoarjo masuk zona waspada. Belum ada log sebelumnya $\rightarrow$ **Alert dikirim (Email Resmi + PWA)** dengan nomor tiket `#ESC-SID-7767`. Record dicatat di Aiven PostgreSQL.
3. **Pukul 08:01:45 WIB (60 detik kemudian):** Worker berjalan lagi. Gempa `bmkg-20260925-0800` masih aktif di feed BMKG. Sistem query ke `notification_logs`:
   `WHERE disaster_id = 'bmkg-20260925-0800' AND branch = 'SIDOARJO' AND sent_at > NOW() - INTERVAL '2 hours'`
   $\rightarrow$ Ditemukan 1 baris (terkirim 60 detik lalu).
   $\rightarrow$ **Keputusan: SKIP / Dilewati.** Email tidak dikirim ulang.
4. **Hasil Operasional:** Nol spam email, Duty Officer fokus menjalankan instruksi mitigasi tiket `#ESC-SID-7767`.

---

## 5. Rincian 4 Pilar Utama Sistem

### Pilar 1: Penarikan Data (Data Ingestion)
- **Master Data Toko (Aiven Cloud PostgreSQL):**
  21.550 gerai toko terindeks dengan kolom: `kode_toko`, `nama_toko`, `cabang`, `alamat`, `latitude`, `longitude`, `fr_type` (Reguler/Franchise), dan `branch_emergency_contact`.
- **Feed BMKG & USGS:**
  Update live setiap 60 detik untuk mendeteksi setiap getaran gempa bumi baru dan status ancaman tsunami.
- **Radar Cuaca Satelit RainViewer & Open-Meteo:**
  Pembaruan live tile radar setiap 5 menit untuk visualisasi pergerakan awan hujan.

---

### Pilar 2: Mesin Analisis Risiko Spasial (Impact Calculation)
- Menjalankan formula Haversine dan atenuasi seismik BMKG secara otomatis di background server.
- Mengkategorisasikan 21.550 toko secara instan ke dalam 3 zona (Bahaya, Waspada, Aman).
- Mengidentifikasi toko-toko yang terpapar hujan ekstrem $\ge 20\text{ mm/jam}$.

---

### Pilar 3: Antarmuka Peta Command Center (UI/UX)
- **Mode Fokus Krisis (Default On):** Menghilangkan 21.480+ toko aman agar peta tidak macet dan konsentrasi operator tertuju 100% pada titik bahaya.
- **Spotlight Search (`Ctrl + K`):** Pencarian toko secepat kilat (0ms lag) berbasis `useDeferredValue`. Toko yang dicari langsung disorot dengan pin target `🎯` dan aura cyan di peta.
- **Layer Radar Cuaca:** Kontrol toggle untuk menyalakan/mematikan visualisasi citra awan hujan satelit.
- **Top Emergency Alert Bar:** Spanduk atas merah mencolok saat ada gempa bumi aktif atau bahaya tsunami.

---

### Pilar 4: Mesin Notifikasi Otomatis (Background Worker)
- **Worker 60 Detik:** Mengevaluasi kondisi krisis secara otomatis tanpa menunggu klik manual operator.
- **Pemilahan Kanal Cerdas:**
  - 📧 **Gempa / Tsunami:** Email Resmi Tanggap Darurat + Notifikasi Push PWA ke DC Cabang.
  - 🌧️ **Hujan Ekstrem / Banjir:** Khusus Notifikasi Push PWA ke HP Dinas DC (mencegah banjir email).
- **Template Email Resmi Berstandar SOP:** Memuat parameter BMKG, daftar toko terdekat, nomor tiket investigasi resmi (`#ESC-...`), dan 4 butir langkah evakuasi.
- **Pusat Notifikasi (`🔔`):** Drawer riwayat pengiriman, pratinjau email DC, dan tombol uji simulasi.

---

## 6. Matriks Peran & Tanggung Jawab Aktor (RACI)

| Aktivitas Operasional | Operator Command Center | Duty Officer DC Cabang | Area Coordinator (AC/AM) | Kru / Kasir Toko |
| :--- | :---: | :---: | :---: | :---: |
| **Pemantauan Peta Dashboard** | **A / R** | I | I | - |
| **Penerimaan Alert Otomatis Worker** | I | **A / R** | I | - |
| **Verifikasi Status & Kontak Gerai** | I | **A** | **R** | C |
| **Evakuasi Fisik & Pemadaman Listrik** | - | I | A | **R** |
| **Pelaporan Status Operasional Gerai** | I | A | **R** | C |
| **Penyelamatan Stok Dagang (Banjir)** | - | I | A | **R** |

*Keterangan:*  
- **R (Responsible):** Pihak pelaksana tindakan operasional langsung.  
- **A (Accountable):** Penanggung jawab penuh atas keputusan krisis.  
- **C (Consulted):** Pihak yang dimintai laporan kondisi fisik di lapangan.  
- **I (Informed):** Pihak yang menerima pemberitahuan / data situasi.

---

## 7. Standard Operating Procedure (SOP) Langkah Demi Langkah

### 🟢 FASE 0: Periode Normal (Pemantauan Siaga 24/7)
1. Dashboard SPARTA Siaga beroperasi di Command Center dalam **Mode Fokus Krisis**.
2. Background worker memeriksa feed BMKG dan radar cuaca setiap 60 detik.
3. Seluruh 21.550 toko terpantau aman (0 gerai di zona bahaya).

---

### 🟡 FASE 1: Deteksi Bencana ($T + 0 \text{ s.d. } T + 30 \text{ Detik}$)
1. BMKG merilis parameter gempa bumi atau radar mendeteksi hujan badai ekstrem.
2. Sistem otomatis menghitung jarak spasial dan radius bahaya seismik.
3. Bilah darurat atas menyala merah; audio *chime alert* berbunyi di browser Command Center.
4. Pin toko di zona bahaya berkedip merah; toko berisiko banjir memunculkan ikon `💧`.

---

### 🔴 FASE 2: Eskalasi & Notifikasi Otomatis ($T + 30 \text{ s.d. } T + 60 \text{ Detik}$)
1. Background worker menerbitkan tiket investigasi resmi (contoh: `#ESC-SID-7767`).
2. Notifikasi terkirim otomatis:
   - **Email Resmi Tanggap Darurat** masuk ke inbox `dc.[cabang]@alfamart.co.id`.
   - **PWA Push Alert** bergetar di gawai dinas Duty Officer DC Cabang terkait.
3. Seluruh data terekam permanen di Aiven PostgreSQL.

---

### ⚡ FASE 3: Tindakan Cepat Duty Officer & Tim Lapangan ($T + 1 \text{ s.d. } T + 15 \text{ Menit}$)
1. Duty Officer DC Cabang memeriksa daftar toko terdampak di email atau dashboard.
2. Duty Officer mengontak Area Coordinator (AC) / Area Manager (AM) terkait via radio/telepon dinas.
3. **Instruksi Tanggap Darurat:**
   - **Jika Gempa:** Evakuasi personil/pelanggan ke luar gedung; matikan saklar listrik utama (MCB) toko.
   - **Jika Banjir:** Pasang tanggul air gerai dan naikkan karton barang dagang ke atas pallet susun.
4. AC/AM melaporkan status operasional toko: **(A) Operasional Normal**, **(B) Tutup Sementara**, atau **(C) Kerusakan Bangunan**.

---

### 🔵 FASE 4: Penutupan Insiden & Pemulihan Pasokan
1. Data status toko diperbarui di sistem.
2. Tiket investigasi diselesaikan (*Closed*) setelah personil dan aset dipastikan aman.
3. Tim logistik DC menyiapkan jalur distribusi alternatif jika akses menuju gerai terdampak terputus.

---

## 8. Kepatuhan Etika & UU Perlindungan Data Pribadi (UU PDP)

Sistem mematuhi sepenuhnya ketentuan **Undang-Undang No. 27 Tahun 2022 tentang Perlindungan Data Pribadi (UU PDP)**:

1. **Larangan Kontak Personal Karyawan:**  
   Sistem tidak memuat maupun menampilkan nomor telepon pribadi kasir/kru toko pada antarmuka peta demi melindungi privasi dan mencegah kepanikan liar.
2. **Jalur Komando Lembaga (Duty Officer DC):**  
   Seluruh eskalasi bencana dialirkan ke akun dinas struktural resmi: *Duty Officer DC Cabang (Standby 24/7)*.
3. **Audit Trail Terenkripsi:**  
   Seluruh riwayat dispatches, tiket darurat, dan koordinat bencana tersimpan aman di database cloud Aiven PostgreSQL dengan koneksi SSL terenkripsi.
