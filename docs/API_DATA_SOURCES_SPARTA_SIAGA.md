# DOKUMENTASI API & DATA SOURCE SPARTA SIAGA

Dokumen ini mendeskripsikan secara komprehensif seluruh integrasi *External Data Source/API* yang digunakan oleh *system engine* SPARTA SIAGA untuk keperluan *autonomous situational awareness*.

> [!IMPORTANT] ARSITEKTUR PEMISAHAN EARLY WARNING VS TIKET OPERASIONAL
> Seluruh penyedia data eksternal dalam dokumen ini (BMKG, USGS, Open-Meteo, RainViewer, PetaBencana) berfungsi **hanya untuk subsistem Early Warning & Autonomous Situational Awareness** (pendeteksian potensi ancaman alam dan pemicu radar/peringatan dini).
> Data peringatan dini ini **terpisah secara tegas** dari manajemen tiket insiden operasional (*Operational Incident Management*). Deteksi gempa otomatis menciptakan *draft event/alert*, namun pelaporan investigasi lapangan, penilaian kerusakan fisik (BMS/BES/BBS), konfirmasi BnM Manajer, perbaikan SPARTA Maintenance, hingga penutupan tiket (*Case Close*) berjalan dalam siklus kerja operasional berjenjang yang tidak dapat diotomasi atau ditutup oleh feed cuaca/seismik eksternal.

---

## RINGKASAN INTEGRASI

| Provider | Fungsi | SPARTA Check | Cache | Upstream Freshness | Trust Level | Visual Spatial |
|----------|--------|--------------|-------|--------------------|-------------|----------------|
| **BMKG (AutoGempa)** | Notifikasi Guncangan Gempa Bumi | 1 menit (Daemon) | None (Live) | Realtime Event-based | Official Indonesia earthquake | Epicenter & Shakemap |
| **BMKG (Terkini)** | Monitoring Peta (Riwayat) | 3 menit (Browser) | None (Live) | Realtime Event-based | Official Indonesia earthquake | Epicenter |
| **USGS** | Backup/Secondary Seismic | 3 menit (Browser) | None (Live) | Realtime Event-based | Official external / secondary seismic | Epicenter |
| **Open-Meteo (Weather)** | Peringatan Potensi Cuaca & Hujan | 1 menit (Daemon) | 300s (Next.js) | Forecast model periodik | Weather forecast/model | Tidak ada (Point of Interest) |
| **Open-Meteo (Flood/GloFAS)**| Indikasi Hidrologi Regional | 3 menit (Browser) | 300s (Next.js) | Pemodelan harian | Hydrological model / river discharge | Tidak ada |
| **RainViewer** | Observasi Radar Presipitasi Hujan | 3 menit (Browser) | 300s (Next.js) | Update per 5-10 menit | Radar observation | Radar Overlay (Tile) |
| **PetaBencana** | Laporan Banjir Berbasis Komunitas | 3 menit (Browser) | 300s (Next.js) | User generated (Realtime) | Community/field disaster report | Titik Lokasi |

*Catatan Penting: **SPARTA CHECK INTERVAL ≠ PROVIDER DATA UPDATE INTERVAL**. Walaupun daemon SPARTA melakukan polling setiap 1 menit (contoh: mengecek Open-Meteo), itu tidak berarti model prediksi (forecast) Open-Meteo diperbarui setiap 1 menit dari satelit. SPARTA hanya mengecek apakah ada event terbaru yang dilepas dari provider tersebut.*

---

## 1. BMKG (Auto Gempa & Gempa Terkini)

1. **Fungsi di SPARTA**: Sumber kebenaran utama (*Source of Truth*) untuk pendeteksian gempa bumi dan inisiasi protokol guncangan (notifikasi, *auto-report*).
2. **Endpoint**: 
   - `https://data.bmkg.go.id/DataMKG/TEWS/autogempa.json` (Daemon)
   - `https://data.bmkg.go.id/DataMKG/TEWS/gempaterkini.json` (Browser Map)
3. **Data yang digunakan**: Koordinat, Magnitude, Kedalaman, Waktu (UTC/WIB), Lokasi Teks, Shakemap.
4. **File/service SPARTA**: `lib/disaster-service.ts`, `lib/server-daemon.ts`
5. **Polling browser**: Setiap 3 menit (via `layout.tsx`)
6. **Polling server/daemon**: Setiap 1 menit (Auto-EQ Lifecycle).
7. **Cache TTL**: Tidak ada cache buatan (langsung hit ke BMKG).
8. **Next.js revalidate**: Tidak digunakan.
9. **Effective refresh rate**: 1 menit di *background*.
10. **Freshness dari provider**: Aktual. Gempa masuk BMKG 3-5 menit setelah guncangan.
11. **Alasan memilih provider**: Otoritas resmi di wilayah Indonesia.
12. **Kelebihan**: Paling akurat dan dapat dipercaya untuk wilayah gerai SPARTA.
13. **Keterbatasan**: Server terkadang *down* saat *traffic* tinggi setelah gempa besar.
14. **Apa yang BOLEH disimpulkan dari data**: Ada kejadian gempa tektonik.
15. **Apa yang TIDAK BOLEH disimpulkan**: Kepastian 100% toko ambruk (membutuhkan konfirmasi dari toko/cabang).
16. **Failure/fallback behavior**: Melakukan iterasi ke data USGS.
17. **Status integrasi saat ini**: Stabil dan masuk ke inti SOP (Auto-EQ).
18. **Catatan production**: Jika BMKG down berturut-turut, sistem *silent* kecuali USGS menangkap gempanya.

---

## 2. USGS (United States Geological Survey)

1. **Fungsi di SPARTA**: *Fallback* sekunder untuk gempa bumi jika BMKG mengalami gangguan.
2. **Endpoint**: `https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_day.geojson`
3. **Data yang digunakan**: Fitur gempa magnitudo >4.5 (hanya memfilter koordinat Indonesia).
4. **File/service SPARTA**: `lib/disaster-service.ts`
5. **Polling browser**: Bersamaan dengan siklus BMKG (3 menit).
6. **Polling server/daemon**: 1 menit (Auto-EQ Lifecycle).
7. **Cache TTL**: -
8. **Next.js revalidate**: -
9. **Effective refresh rate**: 1 menit.
10. **Freshness dari provider**: Cepat (internasional), 2-4 menit setelah guncangan.
11. **Alasan memilih provider**: Sangat stabil dan redundan.
12. **Kelebihan**: Jarang *down*.
13. **Keterbatasan**: Hanya gempa M4.5+ dan terkadang parameter magnitude/lokasi sedikit berbeda dari BMKG.
14. **Apa yang BOLEH disimpulkan dari data**: Terjadi gempa besar.
15. **Apa yang TIDAK BOLEH disimpulkan**: Magnitude final untuk Indonesia (selalu utamakan BMKG).
16. **Failure/fallback behavior**: Jika USGS juga gagal, module *Earthquake* `unavailable`.
17. **Status integrasi saat ini**: Berfungsi sebagai jaring pengaman (*safety net*).
18. **Catatan production**: -

---

## 3. Open-Meteo (Weather Forecast)

1. **Fungsi di SPARTA**: Indikator potensi hujan lebat yang dapat mengancam gerai/toko.
2. **Endpoint**: `https://api.open-meteo.com/v1/forecast`
3. **Data yang digunakan**: `precipitation` (curah hujan) dan `weather_code`.
4. **File/service SPARTA**: `lib/weather-service.ts`, `lib/server-daemon.ts`
5. **Polling browser**: On-demand (klik POI toko/map).
6. **Polling server/daemon**: 1 menit untuk evaluasi seluruh koordinat Cabang (DC).
7. **Cache TTL**: Cache memori (Internal daemon logic + Next.js).
8. **Next.js revalidate**: `300` detik (5 menit).
9. **Effective refresh rate**: ~5 menit (karena terbentur cache revalidate).
10. **Freshness dari provider**: Berbasis model (GFS/ECMWF), diperbarui setiap beberapa jam.
11. **Alasan memilih provider**: Gratis, stabil, API ganda (forecast & historical).
12. **Kelebihan**: Mudah di-*batch* untuk banyak koordinat cabang.
13. **Keterbatasan**: Ini adalah **model**, bukan observasi satelit radar aktual.
14. **Apa yang BOLEH disimpulkan dari data**: Ada "Potensi Cuaca Buruk/Hujan Lebat".
15. **Apa yang TIDAK BOLEH disimpulkan**: "Banjir terkonfirmasi" (karena cuaca hanya probabilitas).
16. **Failure/fallback behavior**: Pengabaian (log peringatan).
17. **Status integrasi saat ini**: Digunakan untuk *push notification* "Siaga Hujan Lebat".
18. **Catatan production**: Menggunakan semantic "Potensi", dilarang menyebut "Banjir Aktual" dari data ini.

---

## 4. Open-Meteo (Flood API / GloFAS)

1. **Fungsi di SPARTA**: Indikasi awal meluapnya sungai besar di sekitar wilayah pengawasan.
2. **Endpoint**: `https://flood-api.open-meteo.com/v1/flood`
3. **Data yang digunakan**: `river_discharge` (debit sungai).
4. **File/service SPARTA**: `lib/flood-service.ts`
5. **Polling browser**: 3 menit sekali.
6. **Polling server/daemon**: Tidak digunakan dalam daemon trigger.
7. **Cache TTL**: -
8. **Next.js revalidate**: `300` detik (5 menit).
9. **Effective refresh rate**: 5 menit.
10. **Freshness dari provider**: GloFAS memperbarui model hidrologi secara harian (*daily*).
11. **Alasan memilih provider**: API terbuka hidrologi sungai global terbesar.
12. **Kelebihan**: Memiliki cakupan seluruh Indonesia tanpa sensor khusus.
13. **Keterbatasan**: Resolusi regional (kurang akurat untuk titik gang/jalan perumahan sempit).
14. **Apa yang BOLEH disimpulkan dari data**: Indikator hidrologi debit sungai.
15. **Apa yang TIDAK BOLEH disimpulkan**: "Tinggi genangan banjir di depan toko adalah X cm".
16. **Failure/fallback behavior**: Menampilkan array kosong.
17. **Status integrasi saat ini**: Tersedia di panel Cuaca Map.
18. **Catatan production**: Harus disandingkan dengan laporan lapangan.

---

## 5. RainViewer

1. **Fungsi di SPARTA**: Menyajikan hamparan radar hujan bergerak (visual spasial) di atas peta.
2. **Endpoint**: `https://api.rainviewer.com/public/weather-maps.json`
3. **Data yang digunakan**: *Tile Server Path* (X/Y/Z) presipitasi terbaru.
4. **File/service SPARTA**: `app/api/weather/radar/route.ts`
5. **Polling browser**: Setiap pergantian layar peta atau request Layer (3-5 menit).
6. **Polling server/daemon**: -
7. **Cache TTL**: Memori Node.js caching internal selama 5 menit.
8. **Next.js revalidate**: `300` detik (5 menit).
9. **Effective refresh rate**: 5 menit.
10. **Freshness dari provider**: Update satelit riil per 5-10 menit.
11. **Alasan memilih provider**: Memiliki overlay radar satelit yang transparan dan *up-to-date*.
12. **Kelebihan**: Visualisasi yang sangat membantu tim *command center*.
13. **Keterbatasan**: Hanya menunjukkan intensitas titik-titik air di awan/permukaan, bukan ketinggian genangan bawah.
14. **Apa yang BOLEH disimpulkan dari data**: Sedang terjadi hujan di area berwarna.
15. **Apa yang TIDAK BOLEH disimpulkan**: Kedalaman banjir.
16. **Failure/fallback behavior**: Return HTTP 503 jika data/path terbaru tidak tersedia (mencegah *render map tile* lama/palsu).
17. **Status integrasi saat ini**: Digunakan penuh sebagai *overlay map layer*.
18. **Catatan production**: `fallback` palsu telah dihapus; murni `last-known-good` cache atau gagal.

---

## 6. PetaBencana

1. **Fungsi di SPARTA**: Menampilkan laporan banjir (*crowdsourcing* lapangan) oleh masyarakat/BNPB.
2. **Endpoint**: `https://data.petabencana.id/reports`
3. **Data yang digunakan**: `lat`, `lng`, `title`, `flood_depth`, `image_url`. (Mendukung GeoJSON dan TopoJSON parsers).
4. **File/service SPARTA**: `lib/petabencana-service.ts`
5. **Polling browser**: 3 menit (`layout.tsx`).
6. **Polling server/daemon**: -
7. **Cache TTL**: -
8. **Next.js revalidate**: `300` detik (5 menit).
9. **Effective refresh rate**: 5 menit.
10. **Freshness dari provider**: *Realtime* saat ada yang melaporkan.
11. **Alasan memilih provider**: Berafiliasi dengan BNPB, platform *crowdsource* paling aktif di Indonesia.
12. **Kelebihan**: Berupa bukti empiris lapangan (bukan sekadar prediksi model cuaca).
13. **Keterbatasan**: Sangat bergantung pada laporan warga sekitar; banyak lokasi tidak diliput jika tidak ada warga yang melapor.
14. **Apa yang BOLEH disimpulkan dari data**: Ada kejadian banjir di titik poin.
15. **Apa yang TIDAK BOLEH disimpulkan**: "Radius sekian km di sekitarnya pasti banjir" (karenanya poligon tiruan 2km dihilangkan).
16. **Failure/fallback behavior**: Laporan menjadi `[]` (kosong), `health` = `offline`.
17. **Status integrasi saat ini**: Digunakan penuh pada map *layer* genangan (titik biru).
18. **Catatan production**: Ketinggian (depth) menggunakan data riil, jika null/undefined ditulis "tidak tersedia", bukan angka palsu.
