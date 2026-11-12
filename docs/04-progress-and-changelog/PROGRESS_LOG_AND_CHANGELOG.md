# 📋 Progress Log & Riwayat Perubahan Sistem: SPARTA Siaga
**Dokumen Pelacakan Teknis, Log Perubahan Kode, dan Resolusi Isu**

- **Modul:** SPARTA Siaga (`sparta-siaga`)
- **Port / URL Dev:** `http://localhost:3004`
- **Versi Terkini:** `v1.4.0` (Stabil & Terverifikasi - Phase 4 Multi-Role Browser UAT & Security Hardening Complete)
- **Terakhir Diperbarui:** 2026-10-30 (Phase 4 Verified - 163/163 Tests Passed; Phase 5 Dokploy Deployment Locked)
- **Aturan Pelaporan:** Dibagi per shift operasional 12 jam (06:00–18:00 WIB & 18:00–06:00 WIB). Entri baru hanya dibuat jika ada perubahan kode/konfigurasi (*zero noise* saat tenang).

---

## 📌 1. Riwayat Versi & Log Pengerjaan (Changelog)

### [Versi 1.2.11] - 2026-09-25 (Shift Siang/Sore: 06:00 – 18:00 WIB)
- **Fokus Utama:** Perombakan Besar Tampilan Responsif & Adaptif Menyeluruh untuk Smartphone / Layar HP (Mobile) dan Monitor Desktop / Laptop (Command Center).
- **Detail Perubahan Teknis:**
  - [`components/layout/siaga-header.tsx`](file:///c:/buildingprocess25/sparta-siaga/components/layout/siaga-header.tsx):
    - **Header Adaptif:** Tinggi fleksibel (`h-14 sm:h-16 px-2.5 sm:px-4`), padding kompak pada tombol aksi, dan subtitle otomatis diringkas pada layar kecil (`< sm`).
    - Tombol pencarian, lonceng notifikasi (dengan badge darurat berdenyut), dan tombol fokus krisis otomatis beralih ke ikon touch-friendly tanpa memotong layar.
  - [`components/disaster/disaster-alert-bar.tsx`](file:///c:/buildingprocess25/sparta-siaga/components/disaster/disaster-alert-bar.tsx):
    - **Bilah Bencana Responsif:** Mengadopsi tata letak adaptif `flex-col md:flex-row`. Teks informasi gempa BMKG dan kontrol multi-bencana (`[◀ 1/15 ▶]`) tidak lagi meluber ke luar batas layar HP.
    - Tombol `[N Toko Terdampak]` dan `[Lihat Episentrum]` memiliki ukuran sentuh jempol yang proporsional.
  - [`components/map/map-controls.tsx`](file:///c:/buildingprocess25/sparta-siaga/components/map/map-controls.tsx):
    - **Mobile Collapsible Map Controls:** Di layar ponsel (`< sm`), kartu kontrol selebar 320px tidak lagi menutupi 90% peta secara permanen. Digantikan oleh tombol pill mengambang yang ringkas: `[⚡ Radar & Radius BMKG ▾]`.
    - Saat diketuk oleh pengguna HP, panel mengembang ke bawah/atas secara mulus dan dapat diciutkan kembali kapan saja dengan tombol `[Tutup ▲]`.
    - Lebar kartu kontrol beradaptasi dinamis (`w-full sm:w-80`) dengan batas layar smartphone.
  - [`components/notifications/incident-detail-modal.tsx`](file:///c:/buildingprocess25/sparta-siaga/components/notifications/incident-detail-modal.tsx):
    - **Dual View Table & Card List:**
      - Pada layar desktop (`hidden md:block`): Tetap menyajikan tabel multi-kolom teknis lengkap.
      - Pada layar mobile (`block md:hidden`): Otomatis bertransformasi menjadi **Daftar Kartu Toko (*Touch-Friendly Card List*)**. Setiap kartu menyajikan nama gerai, kode toko, badge zona bahaya/waspada, jarak episentrum, dan tombol aksi status besar setinggi 40px (`[🟢 Aman / 🔴 Terdampak / ⏳ Belum Dicek]`) yang sangat nyaman disentuh jempol satu tangan.
    - **Sticky Action Footer Responsif:** Di mobile, tombol penyelesaian insiden dan konfirmasi penanganan otomatis meluas penuh (`w-full sm:w-auto`) agar mudah ditekan di HP.
  - [`components/notifications/notification-center-sheet.tsx`](file:///c:/buildingprocess25/sparta-siaga/components/notifications/notification-center-sheet.tsx):
    - Mengambil 100% lebar layar di mobile (`w-full sm:w-[540px] md:w-[620px]`).
    - Baris tombol aksi (`[Pindai Bencana Baru]`, `[Simulasi Alert]`, `[Tandai Semua Dibaca]`) dan tab filter cabang dibuat fleksibel (*flex-wrap*) tanpa terpotong tepi layar.
  - [`components/search/spotlight-search.tsx`](file:///c:/buildingprocess25/sparta-siaga/components/search/spotlight-search.tsx):
    - Dialog pencarian menyesuaikan ruang atas HP (`pt-2 sm:pt-20 px-2 sm:px-4`) dengan input yang nyaman diketik pada virtual keyboard ponsel, serta filter zona dan dropdown cabang yang tersusun rapi.
  - [`components/settings/system-settings-modal.tsx`](file:///c:/buildingprocess25/sparta-siaga/components/settings/system-settings-modal.tsx):
    - Modal preferensi beradaptasi penuh di HP (`max-h-[92vh] sm:max-h-[88vh]`), dengan navigasi tab scroll horizontal yang empuk.
- **Hasil Verifikasi:** Teruji langsung via Browser Subagent (`verify_mobile_desktop_responsive`) pada viewport smartphone (390 x 844 px) dan desktop monitor (1280 x 800 px). Seluruh komponen berpindah mode secara dinamis, kartu checklist mobile interaktif, drawer tidak terpotong, dan kompilasi TypeScript 0 error.

---

### [Versi 1.2.10] - 2026-09-25 (Shift Siang/Sore: 06:00 – 18:00 WIB)
- **Fokus Utama:** Penyesuaian Tema Terang Penuh (*Adaptive Light Mode*) pada Panel Kontrol Peta & Drawer Notifikasi, serta Penghapusan Ikon Setting Redundan.
- **Detail Perubahan Teknis:**
  - [`components/map/map-controls.tsx`](file:///c:/buildingprocess25/sparta-siaga/components/map/map-controls.tsx):
    - Menerima prop `theme?: "dark" | "light"`.
    - Mengimplementasikan styling adaptif untuk kartu floating (Radius Bencana BMKG, Radar Hujan & Cuaca Ekstrem, dan Basemap Switcher). Pada mode terang, card menggunakan latar `bg-white/95 border-slate-200 shadow-xl text-slate-900`, kotak parameter `bg-slate-50 border-slate-200`, dan kontras tombol basemap yang jernih.
  - [`components/notifications/notification-center-sheet.tsx`](file:///c:/buildingprocess25/sparta-siaga/components/notifications/notification-center-sheet.tsx):
    - Menerima prop `theme?: "dark" | "light"`.
    - **Penghapusan Ikon Setting Redundan:** Menghilangkan tombol gear `[⚙️]` di sebelah kanan tombol `[Tes Alarm]` pada baris *Alarm Layar Desktop*, karena seluruh konfigurasi notifikasi, audio, dan cabang sudah disatukan di modal pengaturan terpadu (*Unified Settings Modal* di header).
    - Menghadirkan tampilan Mode Terang penuh: latar container drawer `bg-white text-slate-900`, banner alarm desktop `bg-slate-100 border-slate-200`, action bar dan filter pills yang adaptif, serta kartu-kartu insiden darurat dengan kontras tinggi (`bg-white border-slate-200 hover:bg-slate-50`).
  - [`components/notifications/incident-detail-modal.tsx`](file:///c:/buildingprocess25/sparta-siaga/components/notifications/incident-detail-modal.tsx):
    - Menerima prop `theme?: "dark" | "light"`.
    - Modal detail insiden, ringkasan parameter BMKG, tabel checklist gerai toko per cabang, dan panduan SOP kini otomatis tampil terang dan nyaman di mata saat tema Terang dipilih.
  - [`components/disaster/affected-stores-sheet.tsx`](file:///c:/buildingprocess25/sparta-siaga/components/disaster/affected-stores-sheet.tsx) & [`components/store/store-detail-sheet.tsx`](file:///c:/buildingprocess25/sparta-siaga/components/store/store-detail-sheet.tsx):
    - Ditambahkan dukungan `theme?: "dark" | "light"` sehingga drawer detail toko dan daftar toko terancam bencana ikut menyesuaikan mode terang secara konsisten.
  - [`app/page.tsx`](file:///c:/buildingprocess25/sparta-siaga/app/page.tsx):
    - Mengalirkan state `theme` ke seluruh komponen floating dan modal: `<MapControls theme={theme} />`, `<NotificationCenterSheet theme={theme} />`, `<StoreDetailSheet theme={theme} />`, `<AffectedStoresSheet theme={theme} />`, dan `<DisasterAlertBar theme={theme} />`.
- **Hasil Verifikasi:** Teruji langsung via Browser Subagent (`verify_light_theme_fix`). Pergantian tema ke Mode Terang mengubah seluruh antarmuka secara seragam tanpa ada komponen yang tertinggal dalam tema gelap, dan ikon gear pada baris desktop alert terverifikasi hilang bersih.

---

### [Versi 1.2.9] - 2026-09-25 (Shift Siang/Sore: 06:00 – 18:00 WIB)
- **Fokus Utama:** Modal Pengaturan Terpadu (*Unified Settings Modal*), Penyesuaian Tema Gelap & Terang Menyeluruh (*Full-System Dark & Light Mode*), Peningkatan Pencarian per Cabang & Tombol Close, Navigasi Episentrum Gempa Multi-Kejadian (*Multi-Disaster Switcher*), dan Navigasi Peta Dinamis (*Dynamic Focal Navigation*).
- **Detail Perubahan Teknis:**
  - [`components/settings/system-settings-modal.tsx`](file:///c:/buildingprocess25/sparta-siaga/components/settings/system-settings-modal.tsx):
    - Komponen baru modal pengaturan terpadu terpusat dengan 3 tab:
      - **Notifikasi & Cabang:** Izin notifikasi pop-up laptop, status koneksi, dan dropdown pemilihan cabang tanggung jawab penugasan.
      - **Alarm & Suara:** Toggle aktif/senyap audio chime siaga BMKG, dan tombol uji suara chime darurat.
      - **Tema & Peta:** Pemilihan tema sistem (**Mode Gelap / Mode Terang**), basemap (*Esri Dark Canvas, Esri Light Gray, OpenStreetMap*), dan layer radar cuaca Doppler RainViewer.
  - [`components/layout/siaga-header.tsx`](file:///c:/buildingprocess25/sparta-siaga/components/layout/siaga-header.tsx):
    - Ditambahkan tombol **`[⚙️]` Pengaturan** di header kanan untuk memicu `SystemSettingsModal`.
    - **Dukungan Tema Terang Penuh (*Full Light Theme*):** Header beradaptasi dengan latar putih elegan (`bg-white/95 text-slate-900 border-slate-200 shadow-sm`), status pills adaptif, dan kontras tajam.
  - [`components/search/spotlight-search.tsx`](file:///c:/buildingprocess25/sparta-siaga/components/search/spotlight-search.tsx):
    - **Peningkatan Kontrol Penutup:** Menambahkan tombol `[X]` Close eksplisit di sebelah bilah pencarian, dan mengaktifkan fitur penutupan otomatis saat klik di luar kotak (*click backdrop to close*).
    - **Filter & Penampil per Cabang:** Ditambahkan kartu aksi cepat `[🏢 Tampilkan Semua Toko Cabang Ini di Peta]` saat cabang dipilih/dicari, yang menerbangkan kamera peta membingkai seluruh gerai cabang tersebut.
  - [`components/disaster/disaster-alert-bar.tsx`](file:///c:/buildingprocess25/sparta-siaga/components/disaster/disaster-alert-bar.tsx):
    - **Multi-Earthquake Switcher:** Ditambahkan navigator indeks gempa (`[◀ N/15 ▶]`) sehingga operator dapat beralih antara 15 data gempa BMKG/USGS yang aktif.
    - Tombol `[📍 Lihat Episentrum]` kini terbang presisi ke episentrum gempa yang sedang aktif dipilih.
  - [`components/notifications/incident-detail-modal.tsx`](file:///c:/buildingprocess25/sparta-siaga/components/notifications/incident-detail-modal.tsx) & [`app/page.tsx`](file:///c:/buildingprocess25/sparta-siaga/app/page.tsx):
    - **Navigasi Presisi Dinamis (*Dynamic Coordinate Resolution*):** Menghapus koordinat dummy Sidoarjo statis pada tombol `[📍 Sorot di Peta]`. Sistem kini mencari episentrum bencana asli tiket atau menghitung koordinat titik tengah (*centroid*) toko cabang terancam secara real-time.
  - [`components/notifications/notification-center-sheet.tsx`](file:///c:/buildingprocess25/sparta-siaga/components/notifications/notification-center-sheet.tsx):
    - Menghapus ikon reload kecil duplikat di sebelah kanan tombol `[✓ Tandai Semua Dibaca]`.
- **Hasil Verifikasi:** Teruji di browser (`verify_all_requested_features`). Mode Terang/Gelap berganti sempurna di seluruh komponen sistem, pencarian per cabang berhasil, pergantian 15 gempa aktif berjalan mulus, dan navigasi "Sorot di Peta" terbang tepat ke sasaran.

---

### [Versi 1.2.8] - 2026-09-25 (Shift Siang/Sore: 06:00 – 18:00 WIB)
- **Fokus Utama:** Penguncian Ketat Tombol Selesaikan Insiden (*Prerequisite Store Verification Lock*) & Pembersihan Total Tampilan Drawer Notifikasi (*Notification Center UI/UX Best Practice*).
- **Detail Perubahan Teknis:**
  - [`components/notifications/incident-detail-modal.tsx`](file:///c:/buildingprocess25/sparta-siaga/components/notifications/incident-detail-modal.tsx):
    - **Validasi SOP Mutlak:** Tombol `[🏁 Selesaikan Insiden]` terkunci secara otomatis (`disabled={!allVerified}`) selama masih ada gerai cabang yang berstatus `⏳ Belum Dicek`.
    - **Visual Kunci & Peringatan:**
      - Menampilkan ikon gembok `Lock` dengan teks `🏁 Selesaikan Insiden (Terkunci)` serta styling redup non-interaktif (`bg-slate-800 text-slate-500 cursor-not-allowed opacity-60`).
      - Menampilkan teks peringatan di sebelah kiri footer: `⚠️ Verifikasi cabang belum lengkap (X/Y toko dicek). Tombol penyelesaian terkunci.`
    - **Backend & Client Guard:** Menambahkan early return + notifikasi toast error jika fungsi penyelesaian dipicu paksa saat `!allVerified`.
    - **Aktivasi Tombol:** Setelah seluruh toko cabang mencapai verifikasi 100% (`🟢 Aman` atau `🔴 Terdampak/Tutup`), tombol otomatis terbuka (`bg-emerald-600 animate-pulse cursor-pointer`) menjadi `[🏁 Selesaikan Insiden]` aktif.
  - [`components/notifications/notification-center-sheet.tsx`](file:///c:/buildingprocess25/sparta-siaga/components/notifications/notification-center-sheet.tsx):
    - **Pembersihan Istilah Teknis (Best Practice Enterprise UI):**
      - Judul header disederhanakan dari `Pusat Notifikasi & Background Worker` $\rightarrow$ **`Pusat Notifikasi Darurat`**.
      - Status pill disederhanakan dari `Worker Standby (60s)` $\rightarrow$ **`Auto-Sync (60d)`**.
      - Subtitle diubah menjadi lugas: `Monitoring peringatan darurat BMKG & eskalasi krisis cabang.`
    - **Banner Alarm Layar Desktop:**
      - Menghapus label sistem operasi teknis `(Windows/Mac/Linux)` yang berlebihan $\rightarrow$ kini bersih menjadi `Alarm Layar Desktop: ● Aktif`.
      - Tombol aksi diperpendek & dipertegas: `[🔊 Tes Pop-up Laptop]` $\rightarrow$ **`[🔊 Tes Alarm]`**.
      - Menghilangkan pemotongan teks terpotong (*truncated ellipsis*).
    - **Baris Kontrol Aksi (Action Bar):**
      - Tombol sinkronisasi diubah dari warna merah mencolok (*false alarm*) menjadi biru profesional: `[🔄 Evaluasi Worker Sekarang]` $\rightarrow$ **`[🔄 Pindai Bencana Baru]`** (`bg-blue-600 hover:bg-blue-500`).
      - Tombol `[Simulasi Alert Baru]` diperpendek menjadi **`[Simulasi Alert]`** dengan style sekunder slate.
      - Label `[Tandai Telah Dibaca]` distandarkan menjadi **`[Tandai Semua Dibaca]`**.
- **Hasil Verifikasi:** Teruji di browser (`verify_polished_notification_header`). Tampilan drawer kini bersih, rapi, bebas istilah teknis developer, dan memenuhi standar desain aplikasi Enterprise Command Center.

---

### [Versi 1.2.7] - 2026-09-25 (Shift Siang/Sore: 06:00 – 18:00 WIB)
- **Fokus Utama:** Transformasi Tampilan Ringkas (*Zero Clutter*), Modal Detail Insiden Terpadu, Verifikasi Ceklis Toko per Toko (*Store-by-Store Verification*), dan Alur Penutupan Insiden (`SELESAI DITANGANI`).
- **Detail Perubahan Teknis:**
  - [`components/notifications/incident-detail-modal.tsx`](file:///c:/buildingprocess25/sparta-siaga/components/notifications/incident-detail-modal.tsx):
    - Komponen modal baru untuk manajemen insiden komprehensif.
    - **Tabel Ceklis per Toko:** Menampilkan toko terdampak dengan status lapangan interaktif (`⏳ Belum Dicek`, `🟢 Aman`, `🔴 Terdampak/Tutup`).
    - **Progress Bar Verifikasi:** Menghitung persentase verifikasi gerai real-time (contoh: `10 / 10 Toko - 100% Terverifikasi`).
    - **Tombol Cepat `[Verifikasi Semua Aman]`:** Memungkinkan Duty Officer menandai serentak seluruh gerai aman saat ada konfirmasi kolektif dari Area Coordinator (AC).
    - **Tombol `[📍 Sorot di Peta]`:** Navigasi kamera peta mulus (*smooth fly-to & zoom*) tepat ke episentrum bencana dan toko terkait.
    - **Alur Status Berjenjang (Action Stepper):**
      - Tahap 1: `[✓ Terima & Mulai Penanganan]` (Menunggu Respon $\rightarrow$ Sedang Ditangani).
      - Tahap 2: `[🏁 Selesaikan Insiden]` (Aktif setelah toko terverifikasi $\rightarrow$ Selesai Ditangani).
  - [`components/notifications/notification-center-sheet.tsx`](file:///c:/buildingprocess25/sparta-siaga/components/notifications/notification-center-sheet.tsx):
    - Kartu luar diubah menjadi super ringkas: judul, ringkasan dampak, status pill, dan tombol **`[Buka Detail & Tindak Lanjut ➔]`**.
    - Menghapus tombol *Salin HTML* dan *Pratinjau Email* teknis yang membingungkan.
  - [`scripts/add-resolution-columns.ts`](file:///c:/buildingprocess25/sparta-siaga/scripts/add-resolution-columns.ts) & PostgreSQL:
    - Menambahkan kolom `resolved_at`, `resolved_by`, `resolution_notes`, dan `store_verifications` (JSONB) pada tabel `notification_logs`.
  - [`app/api/notifications/incident/route.ts`](file:///c:/buildingprocess25/sparta-siaga/app/api/notifications/incident/route.ts):
    - Endpoint RESTful terpadu untuk aksi insiden (`acknowledge`, `update_store`, `batch_verify_all`, `resolve`).
- **Hasil Verifikasi:** Teruji di browser via browser subagent. Alur dari pembukaan kartu ringkas, verifikasi status 10 toko hingga 100%, konfirmasi penanganan, hingga tombol `[🏁 Selesaikan Insiden]` berjalan mulus dan status tiket berhasil ditutup menjadi `SELESAI DITANGANI`.

---

### [Versi 1.2.6] - 2026-09-25 (Shift Pagi/Siang: 06:00 – 18:00 WIB)
- **Fokus Utama:** Penutupan Celah Notifikasi (Zero-Loophole Notification Engine): Modal Izin Proaktif, Alur Konfirmasi Penanganan (Incident ACK), Filter Cabang Operasional, dan Anti-Spam Aftershocks.
- **Detail Perubahan Teknis:**
  - [`components/notifications/notification-permission-dialog.tsx`](file:///c:/buildingprocess25/sparta-siaga/components/notifications/notification-permission-dialog.tsx):
    - Modal dialog persetujuan izin otomatis saat aplikasi dibuka jika browser belum mengizinkan notifikasi desktop.
    - Operator dapat memilih **Cabang Penugasan** (contoh: Cabang Sidoarjo, Jakarta, atau Semua Cabang HO Pusat) dan mengatur alarm audio siaga.
    - Tombol `[Setujui & Aktifkan Notifikasi Laptop]` yang memicu izin browser, membuka kunci audio autoplay, dan menyimpan preferensi ke `localStorage`.
  - [`components/layout/siaga-header.tsx`](file:///c:/buildingprocess25/sparta-siaga/components/layout/siaga-header.tsx):
    - Status pill interaktif tepat di samping ikon lonceng: Berkedip kuning `[⚠️ Izin Notifikasi]` jika belum disetujui, dan berubah hijau `[🟢 Siaga: {Cabang}]` jika sudah aktif.
  - [`lib/desktop-notification.ts`](file:///c:/buildingprocess25/sparta-siaga/lib/desktop-notification.ts):
    - **Audio Autoplay Unlocker:** Listener global satu kali pada interaksi pengguna pertama (`click`/`keydown`) agar Web Audio API tidak pernah diblokir kebijakan browser.
    - **Filter Cabang Personal:** Laptop operator cabang hanya menerima pop-up darurat untuk gerai cabangnya sendiri (mencegah kebanjiran alert luar wilayah), kecuali memilih mode Semua Cabang (HO Pusat).
  - [`scripts/add-ack-columns.ts`](file:///c:/buildingprocess25/sparta-siaga/scripts/add-ack-columns.ts) & PostgreSQL:
    - Menambahkan kolom `acknowledged_at`, `acknowledged_by`, dan `acknowledgment_notes` pada tabel `notification_logs`.
  - [`app/api/notifications/ack/route.ts`](file:///c:/buildingprocess25/sparta-siaga/app/api/notifications/ack/route.ts):
    - Endpoint RESTful untuk memproses konfirmasi respon Duty Officer dan mengubah status insiden dari `sent` menjadi `acknowledged`.
  - [`components/notifications/notification-center-sheet.tsx`](file:///c:/buildingprocess25/sparta-siaga/components/notifications/notification-center-sheet.tsx):
    - Menampilkan lencana status `MENUNGGU RESPON` (kuning) vs `DITANGANI (ACK)` (hijau centang).
    - Tombol aksi langsung `[Konfirmasi Tangani (ACK)]` pada setiap kartu insiden yang seketika memperbarui status ke database Aiven PostgreSQL.
  - [`lib/notification-service.ts`](file:///c:/buildingprocess25/sparta-siaga/lib/notification-service.ts):
    - Menambahkan filter cooldown 15 menit per cabang untuk meredam bombardir alert gempa susulan (*aftershocks storm*).
- **Hasil Verifikasi:** Teruji di browser via browser subagent. Dialog persetujuan izin muncul otomatis, simulasi alert berhasil dikonfirmasi ditangani (ACK), status badge berubah menjadi `DITANGANI (ACK)`, dan data tersimpan di PostgreSQL tanpa celah.

---

### [Versi 1.2.5] - 2026-09-25 (Shift Pagi/Siang: 06:00 – 18:00 WIB)
- **Fokus Utama:** Transformasi Penuh ke Server Daemon 24/7 Mandiri (Otomatis Tanpa Tergantung Browser) & Deteksi Banjir Multi-Cabang.
- **Detail Perubahan Teknis:**
  - [`instrumentation.ts`](file:///c:/buildingprocess25/sparta-siaga/instrumentation.ts) & [`next.config.mjs`](file:///c:/buildingprocess25/sparta-siaga/next.config.mjs):
    - Mengaktifkan hook server `instrumentationHook: true`.
    - Fungsi `register()` otomatis memulai daemon pemantau begitu server Next.js booting di backend (bekerja 24 jam nonstop tanpa perlu browser dibuka).
  - [`lib/server-daemon.ts`](file:///c:/buildingprocess25/sparta-siaga/lib/server-daemon.ts):
    - Siklus mandiri setiap 60 detik di level server Node.js.
    - Evaluasi gempa BMKG/USGS vs 21.550 toko dengan formula atenuasi seismik.
    - **Deteksi Hujan Ekstrem Multi-Cabang Real-Time:** Menghitung koordinat centroid 28 kantor cabang DC Alfamart dan memanggil API cuaca presipitasi Open-Meteo multi-koordinat secara paralel. Jika presipitasi $\ge 20\text{ mm/jam}$ atau badai ekstrem (kode 95+), sistem otomatis mendispatch alert PWA ke Duty Officer DC cabang terkait.
    - Deduplikasi otomatis 2 jam berbasis database Aiven PostgreSQL untuk mencegah spam alert.
  - [`scripts/worker-daemon.ts`](file:///c:/buildingprocess25/sparta-siaga/scripts/worker-daemon.ts) & [`package.json`](file:///c:/buildingprocess25/sparta-siaga/package.json):
    - Menambahkan script runner mandiri `"daemon": "tsx scripts/worker-daemon.ts"` untuk deployment standalone / Docker / PM2 di lingkungan server cloud.
- **Hasil Verifikasi:** Siklus uji mandiri berhasil mengevaluasi 19 gempa BMKG dan 28 cabang DC untuk deteksi hujan badai dalam 18 detik tanpa error.

---

### [Versi 1.2.4] - 2026-09-25 (Shift Pagi/Siang: 06:00 – 18:00 WIB)
- **Fokus Utama:** Mesin Notifikasi Otomatis (Background Worker) & Pusat Notifikasi Darurat.
- **Detail Perubahan Teknis:**
  - `Database Aiven PostgreSQL`: Membuat tabel `notification_logs` dengan index pada `(disaster_id, disaster_type)`, `branch`, dan `sent_at`.
  - [`lib/notification-service.ts`](file:///c:/buildingprocess25/sparta-siaga/lib/notification-service.ts):
    - Logika pemilahan kanal cerdas: Gempa/Tsunami kirim Email Resmi DC + Push PWA; Hujan Ekstrem/Banjir khusus Push PWA HP Dinas tanpa spam email.
    - Template HTML email darurat resmi: Berlogo SPARTA, nomor tiket (`#ESC-...`), parameter BMKG, tabel toko terdampak, dan 4 butir SOP tanggap darurat DC.
    - Deduplikasi otomatis jendela 2 jam untuk mencegah pengiriman alert berulang.
  - [`app/api/notifications/worker/route.ts`](file:///c:/buildingprocess25/sparta-siaga/app/api/notifications/worker/route.ts): Endpoint background worker untuk evaluasi berkala gempa BMKG vs 21.550 toko dan dispatch otomatis per cabang.
  - [`app/api/notifications/logs/route.ts`](file:///c:/buildingprocess25/sparta-siaga/app/api/notifications/logs/route.ts): Endpoint query riwayat log notifikasi dan preview format email.
  - [`components/notifications/notification-center-sheet.tsx`](file:///c:/buildingprocess25/sparta-siaga/components/notifications/notification-center-sheet.tsx): Drawer riwayat notifikasi, status liveness worker (60s), filter cabang/jenis bencana, tombol simulasi alert, dan modal pratinjau email DC.
  - [`components/layout/siaga-header.tsx`](file:///c:/buildingprocess25/sparta-siaga/components/layout/siaga-header.tsx) & [`app/page.tsx`](file:///c:/buildingprocess25/sparta-siaga/app/page.tsx):
    - Tombol lonceng `🔔` dengan badge counter darurat dinamis.
    - Interval background polling worker otomatis setiap 60 detik.
    - Audio chime darurat sintetis (Web Audio API A5 ke D5) saat alert baru masuk.
    - Auto-hide kontrol peta saat drawer notifikasi dibuka.
- **Hasil Verifikasi:** Worker memproses 19 gempa BMKG, mendispatch alert terstruktur ke DC Sidoarjo/Cikokol/Medan, dan merekam log ke Aiven PostgreSQL tanpa error.

---

### [Versi 1.2.3] - 2026-09-24 (Shift Pagi/Siang: 06:00 – 18:00 WIB)
- **Fokus Utama:** Integrasi Radar Cuaca & Indikator Risiko Banjir Gerai.
- **Detail Perubahan Teknis:**
  - [`app/api/weather/radar/route.ts`](file:///c:/buildingprocess25/sparta-siaga/app/api/weather/radar/route.ts): Endpoint proxy indeks radar satelit RainViewer live raster tile dengan cache 5 menit dan zona waktu WIB.
  - [`components/map/map-controls.tsx`](file:///c:/buildingprocess25/sparta-siaga/components/map/map-controls.tsx): Card kontrol "Radar Hujan & Cuaca Ekstrem" dengan toggle aktif/nonaktif dan legenda 4 tingkat intensitas (Ringan, Sedang, Lebat, Banjir).
  - [`components/map/map-inner.tsx`](file:///c:/buildingprocess25/sparta-siaga/components/map/map-inner.tsx) & [`map-view.tsx`](file:///c:/buildingprocess25/sparta-siaga/components/map/map-view.tsx):
    - Layer radar presipitasi (`opacity: 0.65`, `zIndex: 350`) di atas basemap.
    - Badge tetesan air `💧` dan ring aura biru berdenyut pada toko dengan peringatan banjir aktif.
  - [`lib/weather-service.ts`](file:///c:/buildingprocess25/sparta-siaga/lib/weather-service.ts) & [`store-detail-sheet.tsx`](file:///c:/buildingprocess25/sparta-siaga/components/store/store-detail-sheet.tsx): Parameter presipitasi Open-Meteo real-time (mm/jam) dan banner instruksi peninggian stok dagang.
- **Hasil Verifikasi:** Layer awan presipitasi tampil mulus di atas seluruh Indonesia; toggle radar responsif tanpa lag.

---

### [Versi 1.2.2] - 2026-09-24 (Shift Pagi/Siang: 06:00 – 18:00 WIB)
- **Fokus Utama:** Integrasi Cloud Database Aiven PostgreSQL & Search Bebas Lag (0ms).
- **Detail Perubahan Teknis:**
  - [`lib/db.ts`](file:///c:/buildingprocess25/sparta-siaga/lib/db.ts) & Cloud Database:
    - Setup connection pool Aiven PostgreSQL dengan SSL.
    - Migrasi 21.550 toko ke tabel `stores`.
    - Indexing B-Tree dan Trigram (`pg_trgm`) pada `kode_toko`, `nama_toko`, `cabang`, dan koordinat.
  - [`app/api/stores/search/route.ts`](file:///c:/buildingprocess25/sparta-siaga/app/api/stores/search/route.ts): Endpoint pencarian server-side terindeks.
  - [`components/search/spotlight-search.tsx`](file:///c:/buildingprocess25/sparta-siaga/components/search/spotlight-search.tsx):
    - Penerapan `React.useDeferredValue(query)` untuk menghilangkan lag pengetikan.
    - Penghapusan opsi dump "Semua (21.550)"; default state diubah ke layar panduan interaktif (0 baris di-render saat idle).
    - Kuota render dibatasi 40 gerai paling relevan.
  - [`components/map/map-inner.tsx`](file:///c:/buildingprocess25/sparta-siaga/components/map/map-inner.tsx): Toko hasil pencarian tetap dimunculkan di peta dengan pin target `🎯` dan aura cyan meski dalam Mode Fokus Krisis.
- **Hasil Verifikasi:** Modal `Ctrl + K` terbuka dalam 1ms; pencarian nama toko ("DELIMA", "SUDIRMAN") langsung fly-to ke lokasi tanpa membebani browser.

---

### [Versi 1.2.1] - 2026-09-24 (Shift Pagi/Siang: 06:00 – 18:00 WIB)
- **Fokus Utama:** Perbaikan UI Drawer Overlap & Pembakuan Siklus Dokumentasi 12 Jam.
- **Detail Perubahan Teknis:**
  - [`app/page.tsx`](file:///c:/buildingprocess25/sparta-siaga/app/page.tsx): Auto-hide floating card kontrol BMKG saat drawer toko kiri dibuka (`hidden={isSearchOpen || isAffectedSheetOpen}`).
  - [`components/disaster/affected-stores-sheet.tsx`](file:///c:/buildingprocess25/sparta-siaga/components/disaster/affected-stores-sheet.tsx): Elevasi lapisan drawer ke `z-[600]` dengan full backdrop blur.
  - Standarisasi siklus pelaporan 12 jam (Shift Pagi/Siang & Shift Malam/Dini Hari).
- **Hasil Verifikasi:** Card BMKG otomatis sembunyi saat tombol darurat diklik; daftar toko terdampak terlihat bersih 100% tanpa tabrakan visual.

---

### [Versi 1.2.0] - 2026-09-24 (Shift Pagi/Siang: 06:00 – 18:00 WIB)
- **Fokus Utama:** Ingest 21.550 Toko Riil, Radius Atenuasi Ilmiah BMKG, & Kepatuhan Privasi UU PDP.
- **Detail Perubahan Teknis:**
  - [`app/api/stores/route.ts`](file:///c:/buildingprocess25/sparta-siaga/app/api/stores/route.ts) & [`data/stores-master.csv`](file:///c:/buildingprocess25/sparta-siaga/data/stores-master.csv): Ingest 21.550 toko riil nasional dengan in-memory server cache (~120ms).
  - [`lib/haversine.ts`](file:///c:/buildingprocess25/sparta-siaga/lib/haversine.ts) & [`lib/disaster-service.ts`](file:///c:/buildingprocess25/sparta-siaga/lib/disaster-service.ts):
    - Hapus slider manual; gantikan dengan formula ilmiah atenuasi seismik BMKG berbasis magnitudo dan kedalaman hiposentrum:
      - Bahaya ($MMI \ge VI$): $R_{\text{danger}} = 10^{0.48 \cdot M - 1.15} \times \text{depthFactor}$.
      - Waspada ($MMI\ IV - V$): $R_{\text{warning}} \approx 2.2 \times R_{\text{danger}}$.
  - [`components/map/map-controls.tsx`](file:///c:/buildingprocess25/sparta-siaga/components/map/map-controls.tsx): Card ringkasan parameter BMKG otomatis dan toggle Mode Fokus Krisis vs Seluruh Jaringan.
  - [`components/store/store-detail-sheet.tsx`](file:///c:/buildingprocess25/sparta-siaga/components/store/store-detail-sheet.tsx):
    - Kepatuhan UU PDP No. 27/2022: Hapus kontak pribadi karyawan; alihkan ke Jalur Komando Krisis *Duty Officer DC Cabang (24/7)*.
    - Fitur penerbitan tiket resmi investigasi (`#ESC-...`) dan notifikasi darurat PWA.
  - [`components/map/map-inner.tsx`](file:///c:/buildingprocess25/sparta-siaga/components/map/map-inner.tsx): Dual-layer rendering Canvas CircleMarker untuk 21.480+ toko aman menjaga performa 60 FPS.
- **Hasil Verifikasi:** Perhitungan radius akurat mengikuti data gempa BMKG; peta lancar di 60 FPS pada 21.550 pin toko.

---

### [Versi 1.1.0] - 2026-09-24 (Shift Pagi/Siang: 06:00 – 18:00 WIB)
- **Fokus Utama:** Penyempurnaan Ergonomi UI, Basemap Bersih, & Filter Search.
- **Detail Perubahan Teknis:**
  - [`components/map/map-inner.tsx`](file:///c:/buildingprocess25/sparta-siaga/components/map/map-inner.tsx):
    - Ganti basemap CartoDB (ber-watermark API Key) ke ESRI World Dark & Light Gray Canvas (100% bersih).
    - Pindahkan tombol zoom Leaflet ke pojok kanan bawah (`bottomright`).
  - [`components/map/map-controls.tsx`](file:///c:/buildingprocess25/sparta-siaga/components/map/map-controls.tsx): Bar tombol preset cepat radius bahaya (`25k`, `50k`, `100k`, `150k`, `200k`).
  - [`components/search/spotlight-search.tsx`](file:///c:/buildingprocess25/sparta-siaga/components/search/spotlight-search.tsx): Elevasi z-index modal ke `z-[2000]`, filter pill status risiko, dropdown cabang, dan sorting jarak.
- **Hasil Verifikasi:** Basemap jernih tanpa watermark; kontrol peta ergonomis dan tidak saling bertumpuk.

---

### [Versi 1.0.0] - 2026-09-24 (Shift Pagi/Siang: 06:00 – 18:00 WIB)
- **Fokus Utama:** Inisialisasi Modul SPARTA Siaga.
- **Detail Perubahan Teknis:**
  - Setup Next.js 16 App Router, React 19, TypeScript 5, Tailwind CSS v4, port 3004.
  - Setup adapter API BMKG (`autogempa.json`, `gempaterkini.json`), USGS Real-time GeoJSON, dan Open-Meteo Weather API.
  - Komponen peta Leaflet: marker toko kustom pulsing beacon, lingkaran radius bencana, header status, alert bar atas, dan drawer detail toko.
  - Integrasi SSO SPARTA callback handler (`POST /v1/sso/exchange`).
- **Hasil Verifikasi:** Seluruh 30 test case di QA Test Plan lulus 100% Pass.

---

## 🔍 2. Matriks Status Isu & Resolusi Teknis

| No | Isu yang Ditemukan | Status | Solusi Teknis |
| :-: | :--- | :---: | :--- |
| 1 | Tombol Zoom tertutup Card Radius | ✅ **Resolved** | Pindah ke kanan bawah (`bottomright`). |
| 2 | Slider Radius manual tidak akurat | ✅ **Resolved** | Dihapus; diganti formula ilmiah atenuasi seismik BMKG otomatis. |
| 3 | Watermark pada basemap CartoDB | ✅ **Resolved** | Beralih ke ESRI Canvas Dark & Light (bebas watermark). |
| 4 | Kontrol peta tembus di modal Search | ✅ **Resolved** | Naikkan z-index modal ke `z-[2000]` dan auto-hide kontrol. |
| 5 | Search modal tidak ada filter | ✅ **Resolved** | Tambahkan filter status risiko, dropdown 28 cabang, dan sorting. |
| 6 | Card BMKG menutupi Drawer Toko kiri | ✅ **Resolved** | Auto-hide kontrol saat drawer terbuka & naikkan z-index drawer ke `z-[600]`. |
| 7 | Standar siklus laporan dokumentasi | ✅ **Resolved** | Dibakukan per shift 12 jam operasional (*zero noise* saat tenang). |
| 8 | Search lag saat memuat 21.550 toko | ✅ **Resolved** | Database Aiven PostgreSQL Trigram index + `useDeferredValue` (0ms lag). |
| 9 | Radar cuaca dan potensi banjir di peta | ✅ **Resolved** | RainViewer raster tile layer + badge tetesan air `💧` toko. |
| 10 | Otomasi notifikasi alert bencana & cuaca | ✅ **Resolved** | Worker background interval 60s, email resmi DC + push PWA, dan audio chime. |

---

## 🛡️ 3. Jaminan Keamanan, Performa & Integritas Sistem

1. **Kepatuhan Privasi (UU PDP No. 27/2022):** Tidak menampilkan kontak ponsel pribadi personil gerai; seluruh eskalasi diarahkan ke saluran resmi *Duty Officer DC Cabang*.
2. **Performa Peta & Database:** Rendering dual-layer Canvas CircleMarker stabil pada 60 FPS untuk 21.550 gerai; pencarian cloud terindeks `< 20ms`.
3. **Keandalan Background Worker:** Dilengkapi deduplikasi 2 jam di database PostgreSQL untuk mencegah pengiriman email/push duplikat ke cabang.
4. **Kompatibilitas SSO:** Integrasi token callback dengan sistem otentikasi portal `login-sparta` tetap terjaga utuh.
