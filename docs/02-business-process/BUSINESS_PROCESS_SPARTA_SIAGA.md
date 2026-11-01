# 🏢 Dokumen Proses Bisnis & Logika Sistem: SPARTA Siaga
**Dokumen Acuan Alur Bisnis (Single Source of Truth) untuk Sistem Pemantauan Cabang & Mitigasi Bencana**

- **Modul:** SPARTA Siaga (`sparta-siaga`)
- **Organisasi:** Alfamart (PT Sumber Alfaria Trijaya Tbk) - SPARTA Ecosystem
- **Versi Dokumen:** 1.2.0 (Stabil & Terverifikasi dengan Data Riil 21.550 Toko)
- **Status:** Active / In-Production Operation Reference
- **Prinsip Utama:** *Setiap perubahan pada aturan atau alur di dokumen proses bisnis ini WAJIB diikuti dengan pembaruan pada implementasi kode program.*

> [!IMPORTANT] CANONICAL GOVERNANCE & ARCHITECTURE ALIGNMENT
> Dokumen ini merupakan Single Source of Truth (SSOT) untuk alur proses bisnis SPARTA SIAGA:
> 1. **Pemisahan Notifikasi Bencana vs Laporan Insiden Operasional:**
>    - **Sistem Peringatan Dini (Early Warning):** Mendeteksi gempa BMKG/USGS dan cuaca ekstrem secara otomatis, menghitung atenuasi seismik, dan memicu notifikasi peringatan. Notifikasi ini murni bersifat informasional dan terpisah dari siklus hidup laporan operasional.
>    - **Siklus Hidup Laporan Insiden (Operational Workflow):** Pelaporan kejadian (manual/otomatis) -> Penugasan cabang -> Pemeriksaan lapangan wajib foto bukti (BMS Toko, BES DC, BBS Gedung) -> Konfirmasi awal BnM Manajer (Ada Kerusakan, Tidak Ada Kerusakan, Perlu Klarifikasi). Jika ada kerusakan, dilanjutkan ke milestone pemeliharaan (10% Ceklis, 25% Estimasi, 30% Approve Proxy, 50% SPK, 100% Serah Terima) -> Review koordinator (BMC Toko, BEC DC, BBC Gedung) -> Persetujuan akhir dan Case Close oleh BnM Manajer.
> 2. **Penyempurnaan Peran Lapangan:** Istilah historis "Duty Officer DC" pada dokumen ini dipetakan secara kanonikal ke 8 peran operasional: Spesialis Lapangan (`bms`, `bes`, `bbs`), Koordinator Wilayah (`bmc`, `bec`, `bbc`), BnM Manajer (`bmm`), dan Head Office (`ho`).
> 3. **Head Office Strictly Monitoring-Only:** Akun Head Office (HO) memiliki akses pemantauan nasional secara read-only setelah laporan dikonfirmasi BnM Manajer, dan diblokir dari seluruh aksi operasional cabang.
> 4. **Zero Operational Bypass:** System Administrator dilarang melakukan aksi approval atau Case Close operasional lapangan.
> 5. **Status Kesiapan Produksi:** Pengembangan dan pengujian UAT browser interaktif telah selesai dan terverifikasi di lingkungan pengujian Aiven (`sparta_siaga_isolated`). Deployment produksi Dokploy (Phase 5) berstatus terkunci (locked) menunggu persetujuan cutover resmi.

---

## 📌 1. Filosofi & Latar Belakang Proses Bisnis

Alfamart mengoperasikan lebih dari 21.550 gerai toko fisik di 28 kantor cabang di seluruh kepulauan Indonesia. Wilayah Indonesia secara geografis berada di jalur *Ring of Fire* (Cincin Api Pasifik) dan pertemuan tiga lempeng tektonik aktif, yang menjadikannya sangat rentan terhadap bencana alam mendadak seperti:
- Gempa Bumi Tektonik & Vulkanik
- Tsunami di wilayah pesisir
- Cuaca ekstrem, curah hujan lebat, dan banjir lokal

### 1.1 Masalah dalam Proses Bisnis Konvensional (Sebelum SPARTA Siaga)
1. **Keterlambatan Deteksi:** Manajemen pusat dan cabang sering terlambat mengetahui toko mana saja yang terdampak gempa bumi karena laporan lapangan memerlukan waktu berjam-jam secara berjenjang.
2. **Ketiadaan Data Spasial Real-Time:** Tidak ada peta terpadu yang memetakan korelasi jarak antara koordinat episentrum gempa dengan koordinat fisik seluruh 21.550 toko.
3. **Kelemahan Penentuan Radius Manual:** Penggunaan slider radius manual tidak memiliki landasan ilmiah dan dapat menghasilkan data palsu (*false positive* / *false negative*) karena guncangan gempa bergantung pada magnitudo dan kedalaman hiposentrum.
4. **Pelanggaran Kode Etik Privasi Karyawan (UU PDP):** Menghubungi langsung nomor ponsel pribadi kasir/kru toko saat jam panik bencana melanggar kode etik perusahaan dan ketentuan UU Perlindungan Data Pribadi (UU PDP No. 27/2022).

### 1.2 Tujuan Bisnis SPARTA Siaga v1.2.0
Menyediakan sistem intelijen spasial berbasis web terintegrasi yang:
- Mengidentifikasi secara otomatis toko-toko yang berada di zona bahaya guncangan dalam hitungan detik setelah BMKG/USGS merilis parameter gempa.
- Menghitung zona dampak bahaya dan waspada secara **ilmiah dan otomatis** mengikuti hukum atenuasi seismik BMKG (berdasarkan energi magnitudo $M$ dan redaman kedalaman hiposentrum).
- Menghormati privasi personil gerai dengan mengarahkan seluruh komunikasi krisis ke **Jalur Komando Resmi Cabang / Distribution Center (Duty Officer DC)**.
- Mengurangi *Mean Time to Response* (MTTR) penanganan krisis gerai dari beberapa jam menjadi **di bawah 5 menit**.
- Menjaga kenyamanan visual dan performa peta tetap 60 FPS pada 21.550 toko dengan **Mode Fokus Krisis Otomatis** sebagai tampilan bawaan (*default view*).

> 💡 **KESIMPULAN BAGIAN 1:**  
> SPARTA Siaga v1.2.0 hadir sebagai pusat intelijen mitigasi bencana berskala enterprise yang mengawasi 21.550 toko secara ilmiah berbasis formula atenuasi BMKG, serta menjamin kepatuhan UU PDP dengan mengalihkan jalur eskalasi ke Duty Officer DC Cabang resmi.

---

## 🔄 2. Peta Alur Bisnis End-to-End (End-to-End Workflow)

Berikut diagram alur proses bisnis operasional SPARTA Siaga:

```text
┌─────────────────────────────┐         ┌─────────────────────────────┐
│ Master Toko Riil (21.550)   │         │ Feed Real-Time BMKG & USGS  │
│ (data/stores-master.csv)    │         │ (AutoGempa & Gempaterkini)  │
└──────────────┬──────────────┘         └──────────────┬──────────────┘
               │                                       │
               ▼                                       ▼
┌─────────────────────────────┐         ┌─────────────────────────────┐
│ In-Memory Fast Cache        │         │ Kalkulasi Atenuasi Seismik  │
│ Server TTL & Normalisasi    │         │ (R_danger & R_warning Auto) │
└──────────────┬──────────────┘         └──────────────┬──────────────┘
               │                                       │
               └──────────────────┬────────────────────┘
                                  │
                                  ▼
               ┌───────────────────────────────────────┐
               │ Spatial Impact Engine (Haversine)     │
               │ Evaluasi Risiko Spasial Toko-ke-Gempa │
               └──────────────────┬────────────────────┘
                                  │
               ┌──────────────────┴────────────────────┐
               ▼                                       ▼
┌───────────────────────────┐           ┌───────────────────────────┐
│ 🔴 Zona Bahaya (MMI ≥ VI) │           │ 🟡 Zona Waspada (MMI IV-V)│
│ R_danger (Pulsing Pin)    │           │ R_warning (Amber Pin)     │
└──────────────┬────────────┘           └──────────────┬────────────┘
               │                                       │
               └──────────────────┬────────────────────┘
                                  │
                                  ▼
               ┌───────────────────────────────────────┐
               │ Respon Command Center & Eskalasi      │
               │ - Mode Fokus Krisis (Default Aktif)   │
               │ - Bilah Peringatan / Alarm Tsunami    │
               │ - Duty Officer DC Cabang (24/7)       │
               │ - Tiket Investigasi Cabang Resmi      │
               │ - Notifikasi Darurat PWA ke Cabang    │
               │ - Pemantauan Cuaca 7 Hari Gerai       │
               └───────────────────────────────────────┘
```

> 💡 **KESIMPULAN BAGIAN 2:**  
> Alur bisnis sistem berjalan 100% otomatis: Data 21.550 toko disandingkan dengan parameter gempa BMKG melalui perhitungan atenuasi ilmiah, menghasilkan status bahaya/waspada yang langsung ditindaklanjuti melalui jalur komando resmi DC Cabang.

---

## 📋 3. Rincian Tahapan Proses Bisnis (Standard Operating Procedures)

### 3.1 Proses 1: Ingestion & Manajemen Data Master 21.550 Toko
* **Aktor:** Geospatial Data Ingestion Layer (`app/api/stores/route.ts`).
* **Input Data:** File `data/stores-master.csv` (1.116.508 bytes, 21.550 gerai toko valid di 28 kantor cabang).
* **Aturan Bisnis (Business Rules):**
  1. **Validasi Koordinat WGS84:** Parser memisahkan koordinat lintang dan bujur secara presisi dalam batas wilayah Republik Indonesia (Latitude $-15$ s.d. $+10$, Longitude $90$ s.d. $145$). Toko yang tidak valid secara otomatis dilewati (*graceful sanitization*).
  2. **In-Memory Server Caching:** Data di-cache di memori server Next.js selama 24 jam. Response time API untuk menyajikan seluruh 21.550 toko ke dashboard adalah **$\le 150\text{ ms}$**.
  3. **Metadata Kepemilikan & DC:** Setiap toko dilengkapi tipe kepemilikan (`Reguler` atau `Franchise`) serta saluran eskalasi `Duty Officer DC Cabang [Nama Cabang]`.

### 3.2 Proses 2: Deteksi Bencana Alam Real-Time (BMKG & USGS Ingestion)
* **Aktor:** Background Worker & Disaster API Fetcher (`lib/disaster-service.ts`).
* **Sumber Data Eksternal:**
  1. **BMKG AutoGempa:** Endpoint `autogempa.json` untuk gempa terkini dengan magnitude signifikan ($M \ge 5.0$).
  2. **BMKG Gempa Terkini:** Endpoint `gempaterkini.json` untuk 15 gempa terbaru yang tercatat di wilayah Indonesia.
  3. **USGS Real-Time Feed:** Endpoint `4.5_day.geojson` untuk gempa regional dan potensi tsunami global.
* **Aturan Bisnis:**
  1. Sistem melakukan deduplikasi data antara BMKG dan USGS berdasarkan toleransi kedekatan koordinat ($\Delta \le 0.05^\circ$) dan waktu kejadian.
  2. Jika label `Potensi` BMKG mengandung teks *"Berpotensi Tsunami"*, sistem memicu status **DARURAT TSUNAMI (LEVEL 1)** pada bilah atas dashboard.

### 3.3 Proses 3: Kalkulasi Radius Bencana Ilmiah BMKG (Otomatis & Non-Manual)
* **Aktor:** Seismic Attenuation Engine (`lib/haversine.ts`).
* **Prinsip Ilmiah:** Menggantikan slider manual dengan formula atenuasi percepatan tanah puncak (*Peak Ground Acceleration*) dan intensitas MMI (*Modified Mercalli Intensity*):
  - **Energi Magnitudo:**
    $$R_{\text{base}} = 10^{0.48 \cdot M - 1.15}$$
  - **Faktor Redaman Kedalaman (*Depth Attenuation*):**
    Gempa dangkal ($\le 20\text{ km}$) memiliki faktor redaman $1.0$ (energi permukaan maksimal). Gempa dalam ($> 100\text{ km}$) memiliki faktor redaman $0.45 - 0.3$ karena energi terdisipasi sebelum mencapai kerak atas.
  - **Radius Bahaya ($MMI \ge VI$):**
    $$R_{\text{danger}} = \max\left(15, \text{round}\left(R_{\text{base}} \times \text{depthFactor}\right)\right)\text{ km}$$
  - **Radius Waspada ($MMI\ IV - V$):**
    $$R_{\text{warning}} = \text{round}\left(R_{\text{danger}} \times 2.2\right)\text{ km}$$

### 3.4 Proses 4: Jalur Komando Resmi Cabang & Kepatuhan Privasi UU PDP
* **Aktor:** Command Center Pusat, Duty Officer Cabang, DC Hotline.
* **Aturan Bisnis Kepatuhan (Compliance Rules):**
  1. **Larangan Kontak Pribadi:** Nomor telepon genggam kasir atau kru toko **tidak boleh** ditampilkan secara vulgar di dashboard dan tidak boleh dihubungi secara personal untuk menjaga etika kerja dan kepatuhan terhadap UU No. 27/2022 (UU PDP).
  2. **Eskalasi Jalur Komando DC Cabang:** Seluruh penanganan krisis diarahkan kepada Duty Officer DC Cabang terkait yang membawahi gerai tersebut (tersedia standby 24/7).
  3. **Penerbitan Tiket Investigasi:** Operator dapat mengklik `[ Buat Tiket Investigasi Cabang ]` yang menerbitkan nomor tiket pelacakan terpadu (format `#ESC-[KODE_TOKO]-[RANDOM]`).
  4. **Notifikasi Darurat PWA ke Cabang:** Operator dapat mengirim sinyal darurat instan melalui Push Notification PWA ke gawai dinas Duty Officer Cabang.

### 3.5 Proses 5: Manajemen Kepadatan Peta (*Map Clutter Management*) & Performa 60 FPS
* **Aktor:** Map Rendering Engine (`components/map/map-inner.tsx`).
* **Aturan Tampilan:**
  1. **Mode Fokus Krisis (Default On):** Saat dashboard dibuka, hanya toko yang berstatus Bahaya dan Waspada yang ditampilkan di peta (dengan *pulsing beacon*). Hal ini mencegah kelelahan visual operator dan menjaga konsentrasi pada titik kritis.
  2. **Mode Seluruh Jaringan (Toggleable):** Operator dapat mengaktifkan `[ 🌐 Tampilkan Seluruh Jaringan Toko ]` jika ingin melihat sebaran menyeluruh 21.550 toko.
  3. **Dual-Layer Canvas Rendering:** Toko berstatus aman dirender menggunakan *HTML5 Canvas CircleMarker*, menjamin interaksi geser (*pan*) dan pembesaran (*zoom*) peta tetap mulus pada 60 FPS tanpa membebani browser.

### 3.6 Proses 6: Pemantauan Prakiraan Cuaca 7 Hari Gerai (Open-Meteo)
* **Aktor:** Toko / PIC Wilayah / Tim Logistik Distribusi.
* **Sumber Data:** Open-Meteo API.
* **Aturan Bisnis:**
  - Setiap toko menyediakan data suhu, kelembapan udara, kecepatan angin, dan prakiraan hujan 7 hari ke depan.
  - Peringatan hujan lebat didistribusikan secara terarah ke gawai dinas tanpa melalui email massal untuk mencegah banjir inbox.

### 3.7 Proses 7: Investigasi Cepat & Pencarian Multi-Kriteria (`Ctrl + K`)
* **Aktor:** Operator Command Center, Koordinator Wilayah.
* **Fitur:** Modal pencarian cerdas terpadu (*Spotlight Search*).
* **Aturan Bisnis:**
  1. Menyaring 21.550 toko secara instan berdasarkan nama, kode toko, atau cabang.
  2. Filter status risiko: `Semua`, `🔴 Bahaya`, `🟡 Waspada`, `🟢 Aman`.
  3. Filter per 28 kantor cabang administratif Alfamart.
  4. Pengurutan toko berdasarkan jarak terdekat ke episentrum bencana.

> 💡 **KESIMPULAN BAGIAN 3:**  
> Rincian SOP di atas menyatukan integritas data 21.550 gerai toko, kalkulasi seismik ilmiah BMKG, penegakan etika privasi UU PDP via Duty Officer DC Cabang, serta optimasi visual dual-layer 60 FPS.

---

## 🛡️ 4. Matriks Dampak: Hubungan Proses Bisnis dengan Kode Program

| Aturan Bisnis yang Berubah | Komponen / File yang Wajib Diubah | Dampak pada Sistem |
| :--- | :--- | :--- |
| **Kalkulasi Radius Bencana Ilmiah BMKG** | `lib/haversine.ts`, `lib/disaster-service.ts`, `components/map/map-controls.tsx` | Slider manual dihapus; radius bahaya dan waspada dihitung otomatis dari $M$ dan kedalaman. |
| **Pembaruan Dataset Master Toko (CSV)** | `data/stores-master.csv`, `app/api/stores/route.ts` | Parser CSV memproses 21.550 baris dengan sanitasi koordinat dan in-memory caching. |
| **Protokol Privasi & UU PDP (Tanpa Kontak Pribadi)** | `components/store/store-detail-sheet.tsx`, `components/disaster/affected-stores-sheet.tsx` | Tombol telepon/WA kasir diganti Jalur Komando DC Cabang, Tiket Investigasi, dan Notifikasi PWA. |
| **Mode Tampilan Fokus Krisis vs Seluruh Jaringan** | `components/map/map-inner.tsx`, `components/map/map-controls.tsx`, `app/page.tsx` | Default hanya tampilkan toko terdampak; Canvas CircleMarker aktif saat 21.550 toko dibuka. |
| **Pencarian Cepat Multi-Kriteria (`Ctrl + K`)** | `components/search/spotlight-search.tsx` | Pencarian instan mencakup 21.550 toko dengan filter cabang, status risiko, dan sorting jarak. |

> 💡 **KESIMPULAN BAGIAN 4:**  
> Matriks dampak ini menjamin sinkronisasi mutlak antara keputusan bisnis dan kode program: setiap perubahan kebijakan mitigasi atau data master Alfamart langsung memiliki rujukan file kode yang jelas untuk dimodifikasi.

---

## 📝 5. Kesimpulan Utama Dokumen
Dokumen ini menetapkan standar baku operasional SPARTA Siaga v1.2.0. Seluruh sistem kini beroperasi dengan data riil 21.550 toko, kalkulasi ilmiah otomatis BMKG, kepatuhan etika privasi UU PDP, dan performa tinggi 60 FPS.

> 💡 **KESIMPULAN BAGIAN 5:**  
> SPARTA Siaga telah menyelesaikan seluruh pengembangan inti dan verifikasi pengujian UAT browser interaktif 100% tervalidasi pada lingkungan pengujian Aiven (`sparta_siaga_isolated`). Pelaksanaan deployment ke infrastruktur produksi Dokploy (Phase 5) berstatus terkunci (locked) dan siap dijalankan setelah otorisasi cutover resmi.
