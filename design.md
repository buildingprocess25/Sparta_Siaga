SPARTA Siaga — Global Design System
Status: Revisi usulan v2 — 12 November 2026. Perlu ditinjau sebelum ditetapkan sebagai standar resmi.

Koreksi utama: SPARTA Maintenance adalah referensi implementasi komponen dan pola layout, BUKAN sumber warna, visual styling, branding, atau tema SPARTA Siaga.

Referensi teknis: SPARTA Maintenance, termasuk DESIGN.md, components/ui, components/app-sidebar.tsx, dan AdminDashboardShell. Jangan menyalin token warna dan brand Maintenance ke Siaga.

Panduan halaman: [`docs/monitoring-map-design.md`](docs/monitoring-map-design.md).

1. Tujuan dan identitas produk
   SPARTA Siaga adalah aplikasi monitoring bencana, kejadian, toko, fasilitas DC, pelaporan, dan notifikasi dalam ekosistem SPARTA. Antarmukanya harus terasa SPARTA Siaga, bukan replika SPARTA Maintenance.

Tujuan desain: menyederhanakan struktur halaman, memperjelas hierarki informasi, meningkatkan konsistensi dan keterbacaan, serta menjaga alur operasional. Perubahan struktur layout boleh besar, namun identitas visual Siaga tetap menjadi acuan.

Aturan yang paling penting:

- Maintenance menyediakan referensi tentang cara membangun antarmuka: pilihan dan komposisi komponen shadcn/ui, navigasi, pola sidebar/header, form, tabel, dialog, spacing, accessibility, dan responsive implementation.
- Siaga menentukan bagaimana antarmuka tersebut terlihat dan terasa: warna primer/sekunder, latar, sidebar, navigasi aktif, typography yang disetujui, ikon/branding, visual density, keadaan/semantik bencana, marker, legenda, dan karakter visual.
- Tidak ada kewajiban menyalin globals.css, CSS variables, components.json, theme, font, atau token warna dari Maintenance.
- Jika aturan implementasi Maintenance bertentangan dengan identitas Siaga, identitas Siaga menang. Jika konflik tersebut menghambat aksesibilitas atau fungsi, laporkan dan usulkan solusi tanpa mengubah standar diam-diam.

2. Sumber kebenaran dan prioritas
1. Keputusan visual pengguna untuk SPARTA Siaga serta design.md yang telah disetujui.
1. Brand dan styling Siaga yang sudah diverifikasi dalam source code aktual: theme/tokens CSS, komponen layout, aset resmi, dan screenshot Siaga yang telah disetujui.
1. Panduan spesifik halaman, misalnya docs/monitoring-map-design.md, untuk struktur dan perilaku halaman khusus.
1. Referensi Maintenance untuk teknik penyusunan layout dan cara memakai komponen shadcn/ui, bukan visual brand.
   Saat melakukan audit, bedakan elemen visual yang memang merupakan identitas Siaga dari elemen UI lama yang buruk. Warna dan identitas tidak boleh hilang; susunan card, spacing, atau interaksi yang berantakan justru boleh direstrukturisasi.

Batas bukti: repository Siaga yang berjalan di lokal adalah sumber utama token aktual. Screenshot lama hanya menunjukkan arah visual, bukan spesifikasi warna numerik yang sudah final. Jangan menebak token dari screenshot lalu menyatakannya resmi. 3. Warna dan tema — dimiliki SPARTA Siaga
Aturan tema

- Audit dan dokumentasikan warna Siaga saat ini dari app/globals.css, CSS variables, Tailwind theme, sidebar, navbar, tombol aktif, dan aset brand yang benar-benar dipakai.
- Pertahankan keluarga visual biru/navy Siaga yang terlihat pada navigasi, dengan aksen dan status yang sudah menjadi identitas Siaga; modernisasi dilakukan melalui kontras, proporsi, dan keteraturan, bukan mengganti semuanya menjadi palet Maintenance.
- Turunkan variasi hover, active, muted, border, focus, dan surface dari token Siaga. Tidak boleh mengambil #0069a7, #005a8f, #004b77, atau #00375c dari Maintenance sebagai token Siaga hanya karena tersedia di repo referensi.
- Pilih penggunaan light/dark sesuai kebutuhan Siaga. Basemap Dark tidak mengharuskan seluruh komponen UI menjadi dark, dan sebaliknya; periksa kontras overlay pada Dark/Light/OSM.
- Simpan palet aktual pada satu tempat (CSS variables / theme tokens), jangan menyebarkan hex hardcoded di banyak JSX.
  Token yang wajib ada dan diaudit
  Token semantik Fungsi Sumber nilai
  --primary Aksi utama, navigasi aktif, focus Siaga
  --primary-foreground Teks di atas primary Siaga
  --background, --foreground Latar dan teks Siaga
  --card, --card-foreground Permukaan panel Siaga
  --muted, --muted-foreground Informasi sekunder Siaga
  --border, --ring, --input Outline, focus, input Siaga
  --sidebar, --sidebar-_ Sidebar dan navigasi Siaga
  Token incident-_, aho-_, status-_ Visual indikator domain Siaga Semantik Siaga

Nilai hex/OKLCH harus diisi berdasarkan audit source code dan persetujuan desain Siaga. Jangan melakukan migrasi warna ke Maintenance secara implisit.
Semantik warna

- Warna gempa/bencana mengikuti aturan dan legendanya sendiri.
- Warna AHO menjelaskan keberadaan/persentase tiket, bukan dampak atau keparahan bencana.
- Status AHO New / Progress tidak boleh disamakan dengan status approval Maintenance.
- Data penting disampaikan melalui warna + label/angka, bukan warna saja.
- Warna merah aksi destruktif dan merah indikator peringatan tidak boleh disamakan tanpa konteks.

4. Style dan karakter visual SPARTA Siaga
   North Star: Serious, readable, recognizable Siaga monitoring. Jaga identitas Siaga, namun hilangkan kekacauan layout yang ada.

- Gunakan proporsi, tone, brand/logo, teks, dan icon treatment yang terasa milik Siaga.
- Komponen boleh mengikuti struktur shadcn/ui dan density enterprise Maintenance, tetapi styling-nya menggunakan theme Siaga.
- Pertahankan/tingkatkan keterbacaan. Jangan membuat semua konten terlalu kecil demi compactness.
- Hindari glow berlebihan, marker neon, shadow berat, nested cards, dan layout yang saling menutupi.
- Jangan menciptakan estetika baru seperti dark glass permanen atau Corporate Blue Maintenance tanpa persetujuan.
- Perubahan style yang signifikan (font, palet, dark/light default, logo, sidebar color) harus ditinjau sebagai keputusan desain, bukan efek samping migrasi komponen.

5. Typography

- Utamakan font yang sudah menjadi bagian styling Siaga dan telah disetujui. Audit dari app/layout.tsx, global CSS, next/font, dan komponen existing.
- Geist dari Maintenance hanyalah contoh implementasi typography, bukan font wajib Siaga.
- Jika font Siaga ternyata sama dengan Geist, gunakan konsisten. Jika berbeda, jangan mengganti hanya karena referensi Maintenance memakai Geist.
- Gunakan sistem heading, title, body, label, dan data teknis yang jelas; susun ukuran berdasarkan aksesibilitas dan kebutuhan konten Siaga.
- Kode toko, nomor tiket, koordinat, dan waktu harus mudah dipindai; monospace dapat dipakai selektif jika cocok dengan font system Siaga.

6. Komponen — implementasi berkiblat pada shadcn/ui / Maintenance
   Gunakan komponen shadcn/ui yang kompatibel dengan versi dependency Siaga. Audit components.json, components/ui, React/Next, Tailwind, dan library primitive yang terpasang. Jangan mengganti dependency besar agar persis sama dengan Maintenance.
   Kebutuhan Komponen/pola yang direkomendasikan
   Mode utama Tabs controlled
   Tombol aksi Button variants
   Filter dan pemilihan data Select, Input, Checkbox, ToggleGroup, Popover
   Panel/konten Card hanya bila perlu batas permukaan, Separator, Collapsible
   Detail dan mobile navigation Sheet atau Drawer
   Tabel Table, pagination, ScrollArea
   Status Badge dengan label semantik
   Loading/kosong/error Skeleton, Alert, Empty jika tersedia
   Navigasi aplikasi Pola Sidebar, header, breadcrumb yang kompatibel dengan layout Siaga

Cara pakai komponen meniru best practice Maintenance; warna dan style props mengikuti Siaga. Jangan cukup membuat div mirip shadcn, tetapi jangan juga mengimpor globals.css Maintenance ke Siaga. 7. Struktur global dan pola layout
Gunakan pola layout Maintenance sebagai inspirasi mekanik: sidebar yang terstruktur, header seperlunya, area konten jelas, navigasi aktif konsisten, sidebar responsive, dan panel detail yang tidak merusak konten. Jangan menyalin layout pixel-for-pixel.

- Sidebar Siaga beserta identitas SPARTA Siaga/Alfamart harus dipertahankan; struktur penataannya boleh dirapikan.
- Navigasi dan layout didasarkan pada modul Siaga (Dashboard, Peta Monitoring, Event Bencana, Laporan, dan seterusnya), bukan menu Maintenance.
- Halaman Peta Monitoring adalah pengecualian map-centric, bukan dashboard card biasa. Lihat panduan khusus.
- Satu fungsi utama cukup satu kontrol jelas; hindari tombol yang berulang tanpa kebutuhan berbeda.

8. Spacing, sizing, aksesibilitas
   Boleh menggunakan prinsip spacing, alignment, layout grid, radius dan responsive yang rapi seperti Maintenance, tetapi nilai akhirnya harus kompatibel dengan token Siaga. Periksa desktop, tablet, dan mobile.

- Aktif, hover, focus, disabled harus tampak jelas dan sesuai tema Siaga.
- Target sentuh mobile memadai (rekomendasi minimal 44×44px).
- Jaga label untuk ikon tanpa teks, focus keyboard, contrast WCAG AA pada teks penting dan overlay peta.
- Loading, error, kosong, tidak terkonfigurasi harus dibedakan.
- Kurangi motion dekoratif dan hormati prefers-reduced-motion.

9. Peta Monitoring — pengecualian domain
   Peta Monitoring mengikuti docs/monitoring-map-design.md untuk layout, interaksi, mode, marker, legenda, fullscreen, dan panel detail. Marker/cluster adalah visualisasi domain Siaga, bukan komponen yang disalin dari Maintenance. Semua aturan perhitungan, izin, dan sumber data tetap mengikuti business logic Siaga.
10. Aturan untuk AI agent
    Sebelum melakukan UI redesign:
11. Baca AGENTS.md termasuk antislop sesuai instruksi yang berlaku.
12. Baca design.md, lalu panduan halaman yang terkait.
13. Audit theme aktual SPARTA Siaga terlebih dahulu; catat nilai primary, sidebar, background, foreground, semantik kejadian/AHO, dan font.
14. Baca komponen shadcn dan pola layout Maintenance sebagai referensi struktur & implementasi saja.
15. Buat audit/mapping mana yang diambil dari Maintenance dan mana yang wajib mempertahankan Siaga.
16. Lakukan refactor visual/komponen; jangan mengubah aturan data atau keamanan.
17. Tinjau hasil di browser termasuk mobile, Dark/Light/OSM peta, dan fullscreen.
18. Jangan mengubah dokumen desain agar menyesuaikan hasil coding yang buruk; usulkan perubahan standar untuk mendapat persetujuan.
    Dilarang: menyamakan brand Siaga dengan Maintenance, menyalin CSS variables Maintenance, hardcode #0069a7 sebagai primary Siaga, memigrasi font secara diam-diam, mengganti logo, atau membuat alur tiket Maintenance di Siaga.
19. Acceptance checklist

- [ ] Nilai warna dan typography bersumber dari Siaga, bukan Maintenance.
- [ ] Sidebar dan identitas produk tetap SPARTA Siaga.
- [ ] Komponen shadcn/ui asli digunakan sesuai konfigurasi Siaga.
- [ ] Pola layout rapi, adaptif, tidak card-heavy; tidak meniru pixel-for-pixel Maintenance.
- [ ] Domain warna dan interaksi AHO/kejadian tetap benar.
- [ ] UI desktop/mobile/fullscreen diverifikasi secara visual.
- [ ] Business logic, database, API, permissions dan notifikasi tidak berubah sebagai efek samping redesign.
