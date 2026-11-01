# PRD & BLUEPRINT: SPARTA SIAGA (DISASTER & BRANCH MAPS MONITORING SYSTEM)

> [!WARNING] HISTORICAL BLUEPRINT & FOUNDING SPECIFICATION
> Dokumen ini merupakan cetak biru arsitektur pendirian (founding blueprint) modul SPARTA Maps / Disaster Monitoring.
> - **Status Dokumen:** HISTORICAL MILESTONE (Dipertahankan untuk dokumentasi silsilah arsitektur).
> - **Nama Proyek & ID Modul:** Nama tentatif `sparta-maps` / `sparta-disaster` telah digantikan secara kanonikal oleh **SPARTA SIAGA** (`sparta-siaga`).
> - **Port Pengembangan:** Port lokal kanonikal adalah `3004` (bukan 3005).
> - **Alur Proses Bisnis & Tata Kelola Operasional:** Alur penanganan insiden bencana dan otorisasi multi-peran kini diatur secara mutlak oleh [`docs/02-business-process/BUSINESS_PROCESS_SPARTA_SIAGA.md`](../02-business-process/BUSINESS_PROCESS_SPARTA_SIAGA.md) dan [`docs/02-business-process/COMPLETE_BUSINESS_PROCESS_GUIDE_SPARTA_SIAGA.md`](../02-business-process/COMPLETE_BUSINESS_PROCESS_GUIDE_SPARTA_SIAGA.md).
> - **Integrasi SPARTA Maintenance:** Integrasi estimasi dan pemeliharaan saat ini berjalan sebagai rute internal mock terverifikasi (`lib/sparta-external-integration.ts`), dengan status menunggu go-live integrasi ERP eksternal.

**Status:** Historical Blueprint (Superseded by Active Business Process Documentation)  
**Modul:** SPARTA Disaster & Branch Monitoring (Tentative ID: `sparta-maps` / `sparta-disaster`)  
**Ecosystem:** SPARTA Portal & Monorepo Framework  
**Target Folder:** Folder terpisah dalam `c:\buildingprocess25` (misal: `sparta-maps` atau `sparta-disaster`)

---

## 1. Executive Summary & Tujuan

SPARTA Disaster & Branch Monitoring System adalah modul web aplikasi terintegrasi dalam ekosistem SPARTA yang berfungsi untuk:
1. **Visualisasi Cabang & Toko Real-time:** Menampilkan sebaran seluruh cabang dan toko fisik pada peta interaktif lengkap dengan detail operasional, PIC, dan status.
2. **Pusat Informasi & Peringatan Dini Bencana Alam:** Mendeteksi dan menampilkan bencana alam terkini di Indonesia (Gempa Bumi, Tsunami, Cuaca Ekstrem, Banjir, Erupsi Vulkanik) yang bersumber dari BMKG, USGS, dan GDACS.
3. **Analisis Radius Dampak (Impact Radius Engine):** Menghitung jarak spasial secara otomatis (*Haversine Formula*) dari episentrum bencana terhadap posisi cabang/toko untuk mengidentifikasi toko-toko yang berada di zona bahaya.
4. **Prakiraan Cuaca Mendatang:** Menyediakan prakiraan cuaca (hourly & daily) untuk setiap lokasi cabang toko berdasarkan data cuaca BMKG dan Open-Meteo.
5. **Seamless SSO via SPARTA Portal:** Dapat diakses langsung melalui Module Launcher dari `login-sparta` dengan kredensial terpadu.

---

## 2. Analisis Ekosistem & Standar Teknologi Existing

Berdasarkan hasil inspeksi mendalam terhadap codebase existing (`login-sparta`, `sparta-fe`, dan `sparta-energy`):

| Kategori | Standar di Ekosistem SPARTA | Rekomendasi Modul Peta Baru |
| :--- | :--- | :--- |
| **Framework** | Next.js (App Router, v15/v16) & React 19 | **Next.js 16 (App Router) + React 19 + TypeScript 5** |
| **Styling & CSS** | Tailwind CSS v4 (`@tailwindcss/postcss`) | **Tailwind CSS v4** dengan arsitektur OKLCH semantic tokens |
| **UI Component Library** | **shadcn/ui** (Radix UI primitives) | **shadcn/ui** (Button, Card, Dialog, Sheet, Tabs, Badge, Command, DropdownMenu) |
| **Iconography** | `lucide-react` (utama) + `@hugeicons/react` | **`lucide-react`** |
| **Typography / Font** | **Geist** (`--font-sans`) & **Geist Mono** (`--font-mono`) | `Geist` & `Geist Mono` via `next/font/google` |
| **Design Rules** | *No manual spacing inside shadcn components; layout wrappers for gaps; dark/light theme support* | Patuhi `AI_RULES.md` SPARTA (shadcn first, reusable custom components, layout wrappers) |
| **Tema Warna Dasar** | Building: `#e6000b` (Merah Alfamart), Maintenance: `#0069a7`, Energy: `#007a55` | **Aksen Geospatial & Alert:** Biru/Slate Navy Dashboard (`#0f172a`), Danger Red (`#dc2626`), Warning Amber (`#f59e0b`), Safe Emerald (`#10b981`), Weather Cyan (`#06b6d4`) |
| **Autentikasi** | SPARTA SSO Contract (`POST /v1/sso/exchange` launch token TTL 2 menit) | Callback endpoint `/auth/sso/callback` terhubung ke SPARTA Login Portal API |

---

## 3. Hal-hal yang Perlu Dipersiapkan (Prerequisites & Readiness Checklist)

Selain instalasi awal Next.js yang sudah Anda pahami, berikut daftar komponen krusial yang wajib dipersiapkan:

### A. Integrasi SPARTA SSO & Module Registry
1. **Module Identification:** Tentukan `moduleId` untuk web baru ini (misal: `disaster` atau `maps`).
2. **Pendaftaran di `login-sparta`:**
   - Tambahkan ID ke enum `SpartaModuleId` di `login-sparta/apps/api/prisma/schema.prisma` dan `login-sparta/apps/shared/src/sparta.ts`.
   - Tambahkan entri card di launcher `login-sparta/apps/web/src/pages/module-launcher-page.tsx`.
   - Daftarkan callback URL modul di database seed (`login-sparta/apps/api/prisma/seed.ts`), misal: `http://localhost:3004/auth/sso/callback`.
3. **Endpoint Callback di Web Baru:**
   - Route `app/auth/sso/callback/route.ts` untuk menangkap query param `?token=...`, mengirim request exchange ke `SPARTA_API/v1/sso/exchange`, menyimpan session cookie (JWT/session token), dan meredirect user ke dashboard peta.
   - Middleware proteksi rute (`middleware.ts`).

### B. Sumber Data Cabang & Toko (Branch Master Data)
1. **Format Koordinat:** Pastikan master data cabang/toko memiliki field `latitude` dan `longitude` bertipe `Float` (desimal, format WGS84).
2. **Koneksi Sumber Data:**
   - **Opsi 1 (Direct DB):** Menggunakan PostgreSQL client (Prisma/pg) membaca tabel toko yang sudah ada (misal dari database `sparta-be` atau `sparta-energy`).
   - **Opsi 2 (Internal REST API):** Mengambil data cabang via internal API endpoint dari backend existing.
   - **Opsi 3 (Data Seeder / GeoJSON / Sync Worker):** Sinkronisasi berkala dari master sheet / CSV jika cabang diperbarui secara periodik.

### C. Library Peta & Basemap Tile Provider
1. **Engine Peta:**
   - **Leaflet + React-Leaflet (`react-leaflet`, `leaflet`)**: Sangat direkomendasikan karena sudah dipakai di `sparta-energy`, mudah dikustomisasi, ringan, dan zero-cost.
   - Atau **MapLibre GL (`maplibre-gl`)**: Jika ingin performa tinggi rendering vector tiles 3D dan puluhan ribu marker sekaligus.
2. **Marker Clustering:**
   - Mengingat jumlah toko Alfamart mencapai ribuan di seluruh Indonesia, wajib menggunakan library cluster (seperti `react-leaflet-cluster` atau `supercluster`) agar browser tidak lag saat zoom out.
3. **Tile Provider (Basemap):**
   - **CartoDB Positron / Dark Matter:** Sangat elegan dan clean untuk map dashboard monitoring (tersedia versi light dan dark).
   - **OpenStreetMap (OSM) Standard:** Gratis dan informatif.
   - **Stadia Maps / Mapbox / Protomaps:** Jika membutuhkan styling khusus.

### D. Provider API Bencana Alam & Cuaca
1. **Gempa Bumi & Tsunami (BMKG Open Data - Gratis, Tanpa Key):**
   - Auto Gempa (Gempa M 5.0+ terbaru): `https://data.bmkg.go.id/DataMKG/TEWS/autogempa.json`
   - Daftar 15 Gempa Terkini: `https://data.bmkg.go.id/DataMKG/TEWS/gempaterkini.json`
   - Daftar Gempa Dirasakan: `https://data.bmkg.go.id/DataMKG/TEWS/gempadirasakan.json`
   - Potensi Tsunami: Didapatkan langsung dari payload tag `Potensi` pada response BMKG.
2. **Gempa Global (USGS API - Gratis GeoJSON):**
   - `https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson`
3. **Cuaca & Prakiraan Cuaca:**
   - **Open-Meteo Weather API:** `https://api.open-meteo.com/v1/forecast` (Suhu, hujan, angin, kelembapan, UV index, prakiraan 7 hari, gratis tanpa key, mendukung batch coordinate).
   - **BMKG Open Data Cuaca:** XML/JSON data prakiraan cuaca per kabupaten/kota.
4. **Bencana Banjir & Siklon (GDACS - PBB):**
   - RSS / GeoJSON feed bencana aktif GDACS (Banjir, Siklon Tropis, Vulkanik) di kawasan Indonesia / Asia Tenggara.

### E. Port & Environment Variables
- Tentukan local dev port agar tidak bertabrakan:
  - `login-sparta web`: `5173`
  - `login-sparta api`: `10000`
  - `sparta-fe`: `3002`
  - `sparta-energy`: `3000 / 3001`
  - **`sparta-maps` (modul baru): `3004` (atau `3005`)**

---

## 4. Arsitektur Teknis & Alur Kerja Sistem (Workflow)

```
[ SPARTA Login Portal ]
         │ User klik "Disaster & Maps"
         ▼ (Redirect URL + One-time Token)
[ Module: sparta-maps (/auth/sso/callback) ]
         │ POST /v1/sso/exchange ke SPARTA API
         ▼ Verifikasi token & set Auth Session Cookie
[ Main Dashboard Layout (Peta Interaktif) ]
   ├── Layer 1: Titik Cabang & Toko (Clustered Markers + Status Operasional)
   ├── Layer 2: Episentrum Bencana BMKG/USGS (Marker Gempa + Lingkaran Radius Bahaya)
   ├── Layer 3: Peringatan Cuaca Ekstrem / Hujan Badai
   │
   ▼
[ Spatial Disaster Matcher (Haversine Engine) ]
   ├── Hitung Jarak: Pusat Bencana ──(Radius km)──> Lokasi Toko
   ├── Jika jarak <= Radius Bahaya:
   │     • Toko masuk status: "Waspada / Berpotensi Terdampak"
   │     • Munculkan Banner Alert Darurat di Top Bar
   │     • List Toko Terancam di Side Panel (Quick Filter & Sorting Jarak)
   └── Panel Informasi Toko (Popup / Drawer):
         • Info Cabang, PIC, Telepon
         • Prakiraan Cuaca 3-7 hari ke depan
         • Jarak dari pusat gempa terdekat
```

---

## 5. Rencana Struktur Folder Modul Baru (`sparta-maps`)

```text
sparta-maps/
├── app/
│   ├── auth/
│   │   └── sso/
│   │       └── callback/
│   │           └── route.ts          # Handler pertukaran token SPARTA SSO
│   ├── api/
│   │   ├── branches/
│   │   │   └── route.ts              # API endpoint data cabang & toko
│   │   ├── disasters/
│   │   │   ├── earthquakes/route.ts  # Fetcher data gempa BMKG & USGS
│   │   │   └── alerts/route.ts       # Weather / flood / GDACS alerts
│   │   └── weather/
│   │       └── route.ts              # Fetcher prakiraan cuaca (Open-Meteo / BMKG)
│   ├── globals.css                   # Tailwind v4 theme + shadcn custom tokens
│   ├── layout.tsx                    # Root layout, font Geist, ThemeProvider
│   └── page.tsx                      # Dashboard Peta Utama
├── components/
│   ├── map/
│   │   ├── map-view.tsx              # Dynamic import Leaflet/MapLibre container
│   │   ├── branch-markers.tsx        # Layer marker toko dengan clustering
│   │   ├── disaster-overlay.tsx      # Layer titik gempa, lingkaran radius, heatmap
│   │   ├── radius-control.tsx        # Slider & preset kontrol radius bahaya
│   │   └── map-controls.tsx          # Layer switcher, filter cabang, zoom controls
│   ├── disaster/
│   │   ├── disaster-alert-bar.tsx    # Banner atas untuk peringatan bencana aktif
│   │   ├── disaster-card.tsx         # Card ringkasan detail gempa terkini
│   │   └── affected-stores-sheet.tsx # Drawer daftar toko yang masuk radius bahaya
│   ├── weather/
│   │   ├── weather-widget.tsx        # Widget ringkasan cuaca cabang
│   │   └── weather-forecast-modal.tsx# Prakiraan cuaca 7 hari per cabang
│   ├── layout/
│   │   ├── header.tsx                # App bar dengan profil user SSO & logout
│   │   └── sidebar.tsx               # Navigasi & filter wilayah cabang
│   └── ui/                           # Komponen shadcn/ui (Button, Card, Badge, dll)
├── hooks/
│   ├── use-disaster-data.ts          # SWR / React Query hook polling data BMKG
│   ├── use-branch-filter.ts          # State filter regional / status toko
│   └── use-impact-calculator.ts      # Hook kalkulasi jarak haversine
├── lib/
│   ├── haversine.ts                  # Algoritma perhitungan radius jarak spasial
│   ├── bmkg.ts                       # Helper & parser response data BMKG
│   ├── sso-client.ts                 # Service komunikasi ke SPARTA API
│   └── utils.ts                      # cn helper untuk Tailwind
├── types/
│   ├── store.ts                      # Interface Cabang & Toko
│   ├── disaster.ts                   # Interface Gempa & Bencana
│   └── weather.ts                    # Interface Cuaca & Forecast
├── .env.example
├── package.json
├── tsconfig.json
└── README.md
```

---

## 6. Keputusan Arsitektur Hasil Diskusi (Decisions & Specifications)

Berdasarkan diskusi dan kesepakatan bersama:

### 1. Nama & Identitas Modul
- **Nama Resmi:** **SPARTA Siaga**
- **Short Name:** `Siaga`
- **Module ID:** `siaga`
- **Nama Folder:** `sparta-siaga`
- **Makna & Filosofi:** SPARTA Siaga adalah modul kesiapsiagaan darurat dan pemantauan bencana yang senantiasa mengawasi potensi bahaya (gempa bumi, banjir, cuaca ekstrem) serta melindungi seluruh aset operasional retail (cabang dan toko).
- **Aksen Warna Tema:**
  - Status Normal / Safe: `#10b981` (Emerald)
  - Status Waspada / Warning: `#f59e0b` (Amber)
  - Status Bahaya / Disaster Alert: `#dc2626` (Red Crimson)
  - Weather Accent: `#0284c7` (Sky / Ocean Blue)
  - UI Shell Background: Slate Dark `#090d16` / Clean Enterprise Light `#f8fafc`

### 2. Sumber Data Toko & Koordinat (Spreadsheet Adapter)
- **Mekanisme:** Menggunakan **Spreadsheet Ingestion Layer**.
- **Metode Sinkronisasi:**
  - Next.js API Route (`/api/stores`) membaca Google Sheets (melalui Published CSV/JSON link atau Google Sheets API v4) atau file Excel/CSV lokal.
  - Dilengkapi sistem **In-Memory Server-Side Caching** (Next.js `revalidate` / Cache Tag) dengan interval waktu yang dapat disesuaikan (misal 1 jam - 1 hari), sehingga loading peta instan dan tidak membebani limit request Google Sheets.
  - Data yang diparsing mencakup: `kode_toko`, `nama_toko`, `cabang`, `alamat`, `latitude`, `longitude`, `pic_name`, `pic_phone`.

### 3. Engine Peta: Leaflet + React-Leaflet + Clustering
- **Pilihan Utama:** **Leaflet** bersama **React-Leaflet** dan **Marker Clustering (`react-leaflet-cluster` / `supercluster`)**.
- **Custom Icon Toko Alfamart:**
  - Setiap toko yang memiliki koordinat dari spreadsheet akan dirender menggunakan **Custom Pin Marker / Icon Toko Alfamart** (menggunakan `L.divIcon`).
  - **Dynamic Status Indicator pada Pin Toko:**
    - 🟢 **Normal / Aman:** Pin khas Alfamart (Merah-Biru-Kuning) dengan ring hijau tenang.
    - 🟡 **Waspada (Warning):** Pin dengan aura ring kuning (misal saat ada peringatan cuaca buruk atau gempa dalam radius 100-200 km).
    - 🔴 **Terdampak / Bahaya (Alert):** Pin berdenyut (*pulsing animation*) merah terang saat toko berada di dalam radius bahaya episentrum gempa/bencana aktif.
  - **Interaktivitas Marker Toko:**
    - Hover: Tooltip cepat menampilkan nama & kode toko.
    - Klik: Membuka Card Popup interaktif berisi ringkasan info toko, jarak dari bencana terdekat, cuaca saat ini, serta tombol *"Lihat Detail & Prakiraan Cuaca Lengkap"*.
- **Tile Basemap:** **CartoDB Positron** (Mode Terang) dan **CartoDB Dark Matter** (Mode Gelap) + OpenStreetMap fallback.
- **Strategi Anti-Clutter & Visual Overload (Pencegah Peta Penuh Sesak):**
  1. **Incident-Only Focus Mode (Mode Fokus Krisis - Default):**
     - Opsi toggle cepat di bar kontrol: *"Hanya Tampilkan Toko di Radius Bahaya"*.
     - Toko yang aman secara otomatis disembunyikan dari peta, sehingga visual peta 100% bersih dan mata tim manajemen langsung tertuju pada toko yang membutuhkan bantuan.
  2. **Zoom-Adaptive Level of Detail (LOD):**
     - **Zoom Jauh (Skala Nasional / Pulau - Zoom < 8):** Toko individual disembunyikan; hanya menampilkan titik Kantor Cabang / DC (Distribution Center) dan ringkasan angka agregat toko per cabang.
     - **Zoom Sedang (Skala Kota / Kabupaten - Zoom 8–12):** Menggunakan Smart Cluster bubble.
     - **Zoom Dekat (Skala Jalan / Kecamatan - Zoom >= 13):** Seluruh pin toko Alfamart individual muncul dengan detail.
     - *Priority Override:* Toko berstatus **Bahaya / Terdampak** SELALU dimunculkan di level zoom mana pun sebagai penanda darurat (*beacon*).
  3. **Filter Cepat Berdasarkan Status Risiko (Quick Status Filter Pills):**
     - Bar tombol cepat di atas peta:
       - `[🔴 Terdampak / Radius Bahaya (X toko)]`
       - `[🟡 Waspada Cuaca / Siaga (Y toko)]`
       - `[🟢 Normal / Aman (Z toko) - Dapat disembunyikan]`
  4. **Viewport / Bounding Box Rendering:**
     - Marker yang dimuat ke dalam memori DOM Leaflet hanyalah toko-toko yang berada di dalam area layar yang sedang dilihat pengguna (*visible bounding box*), bukan seluruh Indonesia sekaligus.
  5. **Spotlight Search & Smooth Fly-To:**
     - Kotak pencarian cepat (Command Palette `Ctrl + K`): Pengguna cukup mengetik kode toko / nama toko (misal: `"Dago"` atau `"SAT012"`), peta akan langsung *smooth zoom* dan menyorot toko tersebut tanpa perlu mencari di antara ribuan icon.
- **Justifikasi Teknis:**
  - 100% Free & Open Source (tanpa batasan API key / tagihan tak terduga).
  - Konsisten dengan stack yang telah sukses diimplementasikan pada `sparta-energy`.
  - Sangat mudah dikustomisasi marker dan popup-nya menggunakan elemen React dan kelas utilitas Tailwind CSS v4.
  - Marker clustering mencegah penurunan performa (FPS drop) saat merender ribuan toko Alfamart di peta nasional.



### 4. Strategi Fitur: Monitoring Interaktif (Read-Only)
- **Pemantauan Jaringan Toko:** Menampilkan sebaran seluruh cabang dan toko fisik di seluruh Indonesia secara interaktif.
- **Peta Bencana Real-Time:** Menampilkan titik episentrum gempa bumi BMKG (M 5.0+, gempa terkini, dan gempa dirasakan) dengan indikator kedalaman dan potensi tsunami.
- **Deteksi Radius Bahaya Otomatis (*Haversine Impact Engine*):** Menghitung jarak pusat bencana ke seluruh lokasi toko dan menandai toko-toko yang berada di dalam radius bahaya.
- **Prakiraan Cuaca 7 Hari:** Prakiraan cuaca (hourly & daily) untuk lokasi toko/cabang bersumber dari BMKG dan Open-Meteo.
- **Drawer Detail Toko:** Panel informasi saat toko diklik yang memuat nama toko, kode, cabang, alamat, kontak PIC, jarak bencana, dan cuaca.
- **Banner Peringatan Darurat:** Banner notifikasi di bagian atas peta yang muncul secara dinamis saat ada bencana baru terdeteksi.

---

## 7. Roadmap & Tahapan Implementasi (Execution Plan)

1. **Tahap 1: Inisialisasi Proyek**
   - Setup Next.js 16 (App Router) + TypeScript.
   - Konfigurasi Tailwind CSS v4, shadcn/ui components, dan font Geist/Geist Mono.
   - Setup arsitektur folder dan environment variables (`PORT=3004`).

2. **Tahap 2: Engine Data & Ingestion Layer**
   - Pembuatan adapter ingestion data toko dari spreadsheet (`/api/stores`) lengkap dengan in-memory server cache.
   - Pembuatan fetcher dan parser API BMKG (`autogempa.json`, `gempaterkini.json`) dan Open-Meteo Weather API.
   - Implementasi modul kalkulasi Haversine Formula (`lib/haversine.ts`).

3. **Tahap 3: Implementasi Visualisasi Peta (Core Interactive Map)**
   - Integrasi Leaflet + React-Leaflet + CartoDB Basemap (Light/Dark).
   - Render marker toko Alfamart dengan custom SVG/icon dan smart clustering.
   - Render episentrum gempa BMKG dengan lingkaran radius bahaya dinamis.
   - Implementasi 5 strategi anti-clutter (LOD, Viewport rendering, Incident focus, Quick pills, Spotlight Search `Ctrl+K`).

4. **Tahap 4: Dashboard Control & Sheet Detail Toko**
   - Pembuatan panel drawer detail toko dengan prakiraan cuaca 7 hari.
   - Pembuatan modal ringkasan gempa dan daftar toko terdampak.
   - Banner darurat di top bar saat terjadi gempa baru.

5. **Tahap 5: Integrasi SSO SPARTA Portal**
   - Pembuatan endpoint `/auth/sso/callback` untuk pertukaran token dengan SPARTA API.
   - Pendaftaran modul di `login-sparta` (schema, shared types, dan launcher card).
   - Pengujian end-to-end: Login di portal SPARTA -> Launcher -> Masuk ke dashboard monitoring.
