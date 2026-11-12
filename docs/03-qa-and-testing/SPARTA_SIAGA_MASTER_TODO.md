# SPARTA SIAGA: Master Project To-Do List

Dokumen pelacakan master untuk seluruh inisiatif rekayasa perangkat lunak, arsitektur, dan jaminan mutu (QA) SPARTA SIAGA.
Status diperbarui secara faktual dan berbasis bukti (*evidence-based*).

- **Target Database Dev:** `sparta_siaga_isolated` (Aiven Cloud PostgreSQL)
- **Database Production Guard:** Database produksi `siaga` dijaga 100% READ-ONLY (Dilarang keras melakukan write/mutasi)
- **Estimasi Progres Keseluruhan:** Phases 1 s.d. 4 Completed & Verified (100% Automated & Browser UAT Passed; Phase 5 Locked)
- **Terakhir Diperbarui:** 30 Oktober 2026

---

## 1. Master Task Tracker

| ID | Nama Task | Prioritas | Status | Progres | PIC / Catatan |
| :--- | :--- | :---: | :---: | :---: | :--- |
| **T01** | Core Laporan, Pemeriksaan, Milestone, Approval & Closing | HIGH | `COMPLETED` | 100% | 10/10 skenario pemeriksaan & approval lulus (`test-bms-bes-inspection-suite.ts`) |
| **T02** | Otomatisasi BMKG/USGS, Canonical Event & Deduplikasi | HIGH | `COMPLETED` | 100% | Worker daemon, canonical event, isolasi gempa susulan verified |
| **T03** | Master 67 Fasilitas & Import Excel | HIGH | `COMPLETED` | 100% | 67 fasilitas terdata di master DB; audit trail dan schema verified |
| **T04** | Autentikasi, Role & Permission | CRITICAL | `COMPLETED` | 100% | Multi-identifier (NIK, Username, ID), bcrypt, role BMS/BES/BMM/HO/Admin |
| **T05** | Hybrid Assignment & PIC | MEDIUM | `COMPLETED` | 100% | Assignment BMS (toko) & BES (fasilitas), delegasi cabang terisolasi |
| **T06** | Integrasi Pelaporan Toko dan Fasilitas | HIGH | `COMPLETED` | 100% | 10/10 skenario role & DC search verified (`test-role-and-dc-search-e2e.ts`) |
| **T07** | Redesign Peta Monitoring Desktop/Mobile | HIGH | `COMPLETED` | 100% | Overhaul layout desktop side-by-side & mobile full-screen, bottom sheets, 4/4 viewports pass |
| **T08** | Dashboard, UI Mobile & PWA | MEDIUM | `COMPLETED` | 100% | Mobile bottom navigation, PWA manifest, service worker caching |
| **T09** | Mapping Cabang dan Aktivasi Fasilitas | MEDIUM | `COMPLETED` | 100% | Audit trail fasilitas, rekonsiliasi manual admin, mapping filter |
| **T10** | Phase 4 UAT & Multi-Role Verification | CRITICAL | `COMPLETED` | 100% | 53/53 automated tests pass, 18/18 browser UAT pass (`scripts/run-browser-uat.ts`) |
| **T11** | One-to-Many Multi-Device Login | HIGH | `COMPLETED` | 100% | Stateless JWT multi-device + DB token_version revocation, 10/10 TDD HTTP pass, real multi-browser pass |
| **T12** | Urgent UI Implementation (Role POV, Sidebar & Status) | CRITICAL | `COMPLETED` | 100% | Restored sidebar (hide 3 only), BMS/BES notification response, BMM 4 KPIs, HO national table read-only, On Progress & target |
| **T13** | Database Remediation & Case-Insensitive Unique NIK | CRITICAL | `COMPLETED` | 100% | Single atomic tx, NIK ADM0001 reserved to usr_sysadmin_01, 9 UAT personas ACTIVE, lower unique index |
| **T14** | Phase 1 Business Rules & Report Lifecycle Hardening | CRITICAL | `COMPLETED` | 100% | 23/23 tests pass, outbox idempotency, atomic BnM transaction, BnM Case Close authority |
| **T15** | Phase 2 Reporting & Disaster Reconciliation | HIGH | `COMPLETED` | 100% | 9/9 tests pass, manual-first & auto-first reconciliation, advisory lock, aftershock separation |
| **T16** | Phase 3 HO Access & Auto Email Distribution | HIGH | `COMPLETED` | 100% | 22/22 tests pass, HO cross-branch read-only, outbox SKIP LOCKED, email deduplication |
| **T17** | Phase 5 Production Deployment Preflight | CRITICAL | `LOCKED` | 0% | Dokploy production migration locked pending explicit stakeholder authorization |

---

## 2. Detail Rincian Prioritas Aktif

### T10: Phase 4 End-to-End Business Flow & Multi-Role UAT
- **Prioritas:** CRITICAL
- **Status:** `COMPLETED` (100% Verified)
- **Target:** Memvalidasi seluruh siklus hidup insiden secara end-to-end dengan browser riil Playwright Chromium dan automated negative regression matrix.
- **Checklist Implementasi:**
  - [x] Multi-Role Authentication Matrix (10 persona kanonikal tervalidasi).
  - [x] Toko Damaged Lifecycle (Inspeksi BMS foto wajib -> Approval BnM -> 5 milestone -> Non-auto-close `awaiting_st` -> Review BMC -> BnM Case Close `closed`).
  - [x] No-Damage Flow / Safe Resolution (Inspeksi BMS kondisi aman -> BnM konfirmasi aman -> `confirmed_safe`, progres 100% tuntas tanpa maintenance).
  - [x] Clarification Loopback (BnM minta klarifikasi -> Tiket kembali ke pemeriksa -> BMS upload bukti revisi -> Kembali ke approval BnM).
  - [x] Specialized Facilities (DC dikerjakan BES & disetujui BEC, BMC ditolak 403 `COORDINATOR_MISMATCH`; Gedung dikerjakan BBS & disetujui BBC).
  - [x] Zero Operational Bypass & Negative Security Suite (SEC-01 s.d. SEC-09 lulus: pencegahan overwrite, pencegahan spoofing status/progres, role-facility mismatch).
  - [x] Real Interactive Browser UAT Suite (18/18 lulus dengan bukti screenshot di `docs/screenshots/uat-phase4/`).

---

### T13: Aiven Database Remediation & Unique NIK Protection
- **Prioritas:** CRITICAL
- **Status:** `COMPLETED` (100% Verified)
- **Target:** Menghilangkan duplikasi identitas NIK `ADM0001` antara akun seed lama dan System Admin, mempertahankan seluruh 9 akun UAT persona tetap aktif.
- **Checklist Implementasi:**
  - [x] Transaksi tunggal atomik pada Aiven PostgreSQL `sparta_siaga_isolated`.
  - [x] Akun `usr_sysadmin_01` menjadi pemilik tunggal sah NIK `ADM0001`.
  - [x] Akun legacy `usr_seed_admin` dialihkan ke `LEGACY_ADM0001` dengan status INACTIVE.
  - [x] Seluruh 9 persona UAT (`bms`, `bmc`, `bes`, `bec`, `bbs`, `bbc`, `bmm`, `UAT_HO0001`, `UAT_GM0001`) dipertahankan ACTIVE dengan password asli.
  - [x] Pembuatan indeks PostgreSQL unik case-insensitive: `idx_users_unique_lower_nik` pada `LOWER(TRIM(nik))`.
  - [x] Validasi login seluruh 13 akun via `scripts/test-remediated-logins.ts` (13/13 pass).

---

### T14: Phase 1 Business Rules & Report Lifecycle Hardening
- **Prioritas:** CRITICAL
- **Status:** `COMPLETED` (100% Verified)
- **Target:** Penegakan aturan bisnis inti di level database dan API backend.
- **Checklist Implementasi:**
  - [x] Idempotensi antrean outbox di database PostgreSQL (`report_approval_outbox` dengan unique constraint pada `report_id`).
  - [x] Transaksi atomik konfirmasi BnM Manajer (`commitAtomicBmApprovalTransaction` dengan row lock `FOR UPDATE`).
  - [x] Otoritas penutupan resmi (Case Close) mutlak milik BnM Manajer; HO strictly read-only.
  - [x] Regresi automated suite via `scripts/test-phase1-business-rules.ts` (23/23 pass).

---

### T15: Phase 2 Reporting & Disaster Reconciliation
- **Prioritas:** HIGH
- **Status:** `COMPLETED` (100% Verified)
- **Target:** Integrasi pelaporan manual dan deteksi otomatis BMKG/USGS tanpa konflik atau duplikasi tiket.
- **Checklist Implementasi:**
  - [x] Formulir manual gempa cabang disederhanakan tanpa menuntut ID eksternal.
  - [x] Mesin rekonsiliasi otomatis (`earthquake-reconciliation.ts`) mencocokkan waktu, lokasi, dan proksimitas spasial.
  - [x] Advisory lock PostgreSQL `lock_earthquake_location` mencegah pembuatan insiden duplikat.
  - [x] Pemisahan tegas gempa susulan (aftershock) dari gempa utama (mainshock).
  - [x] Regresi automated suite via `scripts/test-phase2-reporting-reconciliation.ts` (9/9 pass).

---

### T16: Phase 3 HO Access & Auto Email Distribution
- **Prioritas:** HIGH
- **Status:** `COMPLETED` (100% Verified)
- **Target:** Pemantauan nasional Head Office dan pengiriman otomatis email resmi setelah konfirmasi BnM Manajer.
- **Checklist Implementasi:**
  - [x] Filter pemantauan lintas 28 cabang bagi HO setelah laporan dikonfirmasi BnM Manajer.
  - [x] Penguncian HO read-only: HTTP 403 Forbidden pada seluruh aksi operasional.
  - [x] Pemrosesan antrean outbox berkala dengan `FOR UPDATE SKIP LOCKED`.
  - [x] Template email resmi Alfamart responsif dengan deep link ke laporan.
  - [x] Deduplikasi penerima email mencegah spam email berulang saat cron worker berjalan.
  - [x] Regresi automated suite via `scripts/test-phase3-ho-access-and-email.ts` (22/22 pass).

---

## 3. Log Riwayat Pengujian & Evidence

| Tanggal | ID Task | Nama Uji / Skrip | Hasil | Keterangan |
| :--- | :---: | :--- | :---: | :--- |
| 30/10/2026 | T10 | `scripts/run-browser-uat.ts` | **PASS (18/18)** | Real interactive browser Playwright Chromium suite (18 screenshot bukti) |
| 30/10/2026 | T10 | `scripts/test-phase4-e2e-business-flow-and-uat.ts` | **PASS (53/53)** | Full Phase 4 E2E lifecycle, negative security SEC-01 s.d. SEC-09 |
| 30/10/2026 | T13 | `scripts/test-remediated-logins.ts` | **PASS (13/13)** | Multi-role login validation on remediated Aiven database |
| 30/10/2026 | T16 | `scripts/test-phase3-ho-access-and-email.ts` | **PASS (22/22)** | Phase 3 HO read-only guards & auto email outbox processing |
| 30/10/2026 | T15 | `scripts/test-phase2-reporting-reconciliation.ts` | **PASS (9/9)** | Manual & automatic disaster reporting reconciliation |
| 30/10/2026 | T14 | `scripts/test-phase1-business-rules.ts` | **PASS (23/23)** | Phase 1 core business rules, idempotency, atomic approval |
| 30/10/2026 | T11 | `scripts/test-persistent-auth-resilience.ts` | **PASS (26/26)** | Persistent multi-device session resilience & token revocation |
| 30/10/2026 | ALL | `npm run typecheck` | **PASS** | TypeScript validasi bersih (0 error) |
| 30/10/2026 | ALL | `graphify update . --no-cluster` | **PASS** | Knowledge graph synchronized (2150 nodes, 5143 edges) |

---

## 4. Screenshot Evidence Artifacts (Phase 4 UAT)

Tersedia di direktori `docs/screenshots/uat-phase4/`:
1. `01_login_invalid_credentials.png`: Alert kredensial tidak valid saat password salah.
2. `02_bms_authenticated_dashboard.png`: Dashboard terautentikasi BMS cabang Bandung.
3. `03_ho_authenticated_dashboard.png`: Dashboard monitoring nasional Head Office.
4. `04_desktop_monitoring_map.png`: Layout NASA FIRMS desktop (topbar tersembunyi, sidebar & map aktif).
5. `05_mobile_dashboard_bottom_nav.png`: Tampilan mobile (390x844) dengan navigasi bawah tanpa hamburger.
6. `06_mobile_monitoring_map.png`: Peta monitoring mobile dengan kontrol peta tanpa obstruksi.
7. `07_ui_modal_dismissal.png`: Interaksi modal manual dibuka via UI dan ditutup bersih (dismissed) pada tombol Batal.
8. `08_bms_store_incident_created.png`: Pembuatan insiden toko manual dengan progres awal 0%.
9. `09_bms_inspection_submitted.png`: Pengiriman bukti inspeksi lapangan BMS wajib foto bukti.
10. `10_ho_unconfirmed_hidden.png`: Laporan unconfirmed tersembunyi dari pantauan Head Office (403).
11. `11_bmm_confirmed_affected.png`: Keputusan 1 BnM Manajer: Ada Kerusakan (`confirmed_affected`).
12. `12_ho_visible_read_only.png`: Laporan terkonfirmasi kini tampil pada HO dalam mode read-only.
13. `13_milestone_100_non_auto_close.png`: Milestone 100% tidak auto-close tiket (status: `awaiting_st`).
14. `14_case_closed.png`: Penutupan resmi tiket (Case Close) oleh BnM Manajer (`closed`).
15. `15_bmm_confirmed_safe.png`: Keputusan 2 BnM Manajer: Tidak Ada Kerusakan (`confirmed_safe`, 100%).
16. `16_clarification_loopback.png`: Keputusan 3 BnM Manajer: Perlu Klarifikasi loopback ke pemeriksa.
17. `17_specialized_facilities.png`: Fasilitas khusus DC (spesialis BES, koordinator BEC; BMC ditolak 403).
18. `18_sparta_mock_integration_badge.png`: Identifikasi transparan integrasi ERP SPARTA Maintenance sebagai rute mock internal.

---

## 5. Catatan Blocker & Ketergantungan

- **Database Safety Guard:** Koneksi basis data selalu divalidasi dengan `assertIsolatedDatabase()`. Modifikasi hanya diizinkan pada `sparta_siaga_isolated`. Database produksi `siaga` dijaga 100% tanpa write.
- **Phase 5 Production Deployment Safeguard:** Phase 5 (Dokploy production database migration dan deployment) berstatus **TERKUNCI (LOCKED)**. Seluruh tahapan cutover membutuhkan otorisasi resmi pemangku kepentingan.
