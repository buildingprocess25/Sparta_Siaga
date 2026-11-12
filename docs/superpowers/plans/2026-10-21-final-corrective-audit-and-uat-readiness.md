# SPARTA SIAGA  -  Final Corrective Audit & UAT Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Execute a comprehensive, multi-layered corrective audit and refinement of SPARTA SIAGA to align 100% with the canonical 7-page business flowchart, enforcing strict read-only Detail Laporan, simplified field inspection forms, complete role and permission overhaul unblocking operational roles (BMC, BEC, BBC, BBS) while keeping Tim Toko restricted, strict automatic earthquake validation guardrails, robust 5-milestone and Serah Terima workflows, refined notifications without redundant buttons, real PWA Push Service Worker architecture, rock-solid mobile responsiveness, clean natural Indonesian UI copy, safe account management preserving Admin, and finalized step-by-step executive simulation readiness.

**Architecture:**
- **Detail Laporan Read-Only:** Decouple mutative modals (`ProgressUpdateModal`, `StoreVerificationModal`, `EstimationModal`, target date editor) completely from `components/incident/maintenance-tracking-modal.tsx`. Retain full information display, PDF download, and Leaflet map navigation.
- **Simplified Field Inspection:** Streamline `components/incident/store-verification-modal.tsx` to essential inputs: Report & TKP identity, Damage toggle (Ada Kerusakan / Tidak Ada Kerusakan), min 1 photo, short description, and submit button. Separate unverified initial info route. Streamline BnM decision modal.
- **Role & Permission Restoration:** Remove `bmc`, `bec`, `bbs`, `bbc` from `DEACTIVATED_BUSINESS_ROLES` in `lib/auth.ts`. Mark them selectable in `lib/role-catalog.ts`. Strictly preserve Tim Toko & Rekanan restrictions. Enforce branch isolation across all operations.
- **Earthquake Rejection Guardrail:** Forbid rejecting automatic earthquake incidents as invalid in `app/api/incidents/[id]/confirm/route.ts` and UI. Support zero-work closure for safe inspections.
- **Milestones & Serah Terima:** 5 fixed milestones (10% Checklist, 25% Estimation upload, 30% Proxy, 50% SPK, 100% Handover). Serah Terima follows PIC submit -> Coordinator review -> BnM approval -> Case Close. Rejection requires reason and enters revision without resetting prior milestones.
- **Notifications & PWA:** Eliminate "Tandai Semua Dibaca" and redundant "Rincian Cabang". Make incident alerts viewable system-wide while restricting private report actions. Add real PWA Service Worker push & notificationclick handlers in `public/sw.js` and push subscription endpoints.
- **Mobile & Navigation:** Fix scroll bugs in `select-report-modal.tsx`, hide "Data Fasilitas" from primary user navigation, translate all disaster enums and dates into standard Indonesian, preserve System Administrator credentials.

**Tech Stack:** Next.js 16 (App Router), React 19, TypeScript, PostgreSQL (`pg` pool, strictly NO Prisma), Tailwind CSS, Lucide React, Web Push API, Service Worker.

---

## Global Constraints
- Strictly NO Prisma (native `pg` pool exclusively).
- Strictly NO destructive database purge or reset.
- Strictly preserve System Administrator account (`usr_seed_admin` / `admin@sparta-siaga.local` / `ADM0001`).
- Follow Antislop Mode: `during (session override)`.
- Never claim completion without fresh, empirical verification evidence.

---

## Task Breakdown

### Task 1: Detail Laporan  -  Absolute Read-Only Enforcement
**Files:**
- Modify: `components/incident/maintenance-tracking-modal.tsx`
- Modify: `components/dashboard/active-incidents-table.tsx`
- Modify: `components/reports/operational-report-center.tsx`
- Test: `scripts/test-detail-laporan-readonly.ts`

- [ ] **Step 1: Write verification test for read-only Detail Laporan**
  Create `scripts/test-detail-laporan-readonly.ts` checking that `maintenance-tracking-modal.tsx` contains NO mutating inputs, NO embedded update progress modal, NO verification form, and renders the PDF download link and map navigation link.
- [ ] **Step 2: Remove mutating controls from `maintenance-tracking-modal.tsx`**
  - Remove `handleSaveTarget`, `isEditingTarget`, target date input fields.
  - Remove `+ Tambah Update` button that triggered `setIsProgressModalOpen(true)`.
  - Remove embedded `ProgressUpdateModal`, `StoreVerificationModal`, and `EstimationModal` JSX subcomponents.
  - Add "Lihat di Peta" navigation button in modal header/summary linking to `/map?lat=...&lng=...&storeId=...`.
  - Ensure prominent "Unduh PDF Laporan" button linking to `/api/incidents/${incident.id}/export/pdf`.
- [ ] **Step 3: Run test to verify read-only enforcement**
  Execute `pnpm exec tsx scripts/test-detail-laporan-readonly.ts`.

---

### Task 2: Sederhanakan Form Pemeriksaan Lapangan & Form Keputusan BnM
**Files:**
- Modify: `components/incident/store-verification-modal.tsx`
- Modify: `app/api/incidents/[id]/confirm/route.ts`
- Test: `scripts/test-simplified-inspection.ts`

- [ ] **Step 1: Write test for simplified inspection inputs**
  Verify that BMS/BES form only requires: condition (Ada/Tidak Ada Kerusakan), min 1 photo, and notes. Verify categories, severity, and operational status are eliminated from initial inspection submission.
- [ ] **Step 2: Refactor `components/incident/store-verification-modal.tsx`**
  - Simplify BMS/BES view:
    * Auto-filled report identity (ID, store/DC, date, disaster type).
    * Radio buttons: "Ada Kerusakan" vs "Tidak Ada Kerusakan".
    * Mandatory photo upload (camera or gallery, min 1 photo).
    * Short description textarea.
    * Submit button: "Kirim Hasil Pemeriksaan".
    * Remove category selector, severity selector, and operational status selector.
  - Keep separate tab/mode for "Informasi Awal  -  Belum Terverifikasi" when direct visit is not feasible.
  - Simplify BnM Manajer decision view:
    * Clean summary card of field inspection result & photos.
    * Decision buttons: Setujui (Ada Kerusakan) / Kondisi Aman / Tolak Laporan (Manual only) / Minta Klarifikasi.
    * Mandatory notes/reason only for Rejection or Clarification.
- [ ] **Step 3: Update `app/api/incidents/[id]/confirm/route.ts`**
  Ensure backend accepts simplified inspection payload, validates min 1 photo for initial inspection, and sets status to `pending_bm_approval` for BnM review.
- [ ] **Step 4: Run test and confirm pass**
  Execute `pnpm exec tsx scripts/test-simplified-inspection.ts`.

---

### Task 3: Perbaiki Role dan Permission Secara Total
**Files:**
- Modify: `lib/auth.ts`
- Modify: `lib/role-catalog.ts`
- Modify: `lib/report-permissions.ts`
- Modify: `types/permission.ts`
- Test: `scripts/test-role-permissions-overhaul.ts`

- [ ] **Step 1: Write test for all canonical roles login and action permissions**
  Test authentication and permissions for:
  - BMS: can create store report, inspect store, update milestones.
  - BES: can create DC report, inspect DC, update milestones.
  - BBS: can upload milestone evidence.
  - BMC: can login and approve Toko Serah Terima.
  - BEC: can login and approve DC Serah Terima.
  - BBC: can login and approve Building Serah Terima.
  - BnM: can confirm inspection & approve Case Close for own branch.
  - HO Admin & GM HO: read-only monitoring, cannot mutate reports.
  - Tim Toko & Rekanan: blocked from direct report creation.
- [ ] **Step 2: Update `lib/auth.ts`**
  Remove `bmc`, `bec`, `bbs`, `bbc` from `DEACTIVATED_BUSINESS_ROLES`. Only `tim_toko` and `rekanan` remain restricted.
- [ ] **Step 3: Update `lib/role-catalog.ts`**
  Set `selectable: true` for `bmc`, `bec`, `bbs`, `bbc` in `CANONICAL_HUMAN_ROLES`. Update descriptions to match flowchart authority.
- [ ] **Step 4: Run test and verify 100% pass**
  Execute `pnpm exec tsx scripts/test-role-permissions-overhaul.ts`.

---

### Task 4: Tolak Laporan & Konfirmasi Gempa Otomatis Guardrail
**Files:**
- Modify: `app/api/incidents/[id]/confirm/route.ts`
- Modify: `components/incident/store-verification-modal.tsx`
- Test: `scripts/test-earthquake-rejection-guardrail.ts`

- [ ] **Step 1: Write test for earthquake rejection guardrail**
  Verify:
  - Automatic earthquake reports cannot be rejected with `decision = "rejected"` (returns 400).
  - Automatic earthquake reports with "Tidak Ada Kerusakan" can be confirmed safe (`decision = "safe"`) and transition directly to safe closure without milestones.
  - Manual invalid reports can still be rejected with mandatory reason.
- [ ] **Step 2: Implement guardrail in `app/api/incidents/[id]/confirm/route.ts`**
  Add check before processing `decision === "rejected"`:
  ```typescript
  if (decision === "rejected" && (report.reportOrigin === "automatic_earthquake" || report.disasterType === "earthquake" && report.reportOrigin !== "manual")) {
    return NextResponse.json({
      error: "Laporan gempa otomatis tidak dapat ditolak sebagai laporan tidak valid. Jika tidak ada kerusakan di lapangan, pilih 'Tidak Ada Kerusakan' / 'Aman'.",
      code: "EARTHQUAKE_REJECTION_FORBIDDEN"
    }, { status: 400 });
  }
  ```
- [ ] **Step 3: Update UI in `store-verification-modal.tsx`**
  Hide or disable the "Tolak Laporan" option if `report.reportOrigin === "automatic_earthquake"` or earthquake auto-alert.
- [ ] **Step 4: Run test and confirm pass**
  Execute `pnpm exec tsx scripts/test-earthquake-rejection-guardrail.ts`.

---

### Task 5: Perbaiki Milestone & Serah Terima Workflow
**Files:**
- Modify: `components/incident/milestone-progression-card.tsx`
- Modify: `components/incident/completion-approval-card.tsx`
- Modify: `lib/milestone-service.ts`
- Modify: `lib/completion-approval-service.ts`
- Test: `scripts/test-milestone-serah-terima-flow.ts`

- [ ] **Step 1: Write test for milestone completeness and Serah Terima rejection**
  Verify:
  - 5 milestones: Ceklis (10%), Estimasi (25%), Approve Proxy (30%), SPK (50%), Serah Terima (100%).
  - Estimasi has no calculator form, only document upload.
  - Serah Terima rejection records reason, sets status `REVISION_REQUIRED`, keeps milestones 10-50% intact.
  - Revision only requires resubmitting Serah Terima (100%).
  - Case Close is guarded until all mandatory documents are uploaded and BnM approves.
- [ ] **Step 2: Polish `milestone-progression-card.tsx` and `completion-approval-card.tsx`**
  Ensure document completeness copy is in natural Indonesian ("Dokumen Estimasi belum diunggah", "Serah Terima memerlukan perbaikan").
- [ ] **Step 3: Run test and confirm pass**
  Execute `pnpm exec tsx scripts/test-milestone-serah-terima-flow.ts`.

---

### Task 6: Perbaiki Seluruh Notifikasi & Redundansi Tombol
**Files:**
- Modify: `lib/notification-access.ts`
- Modify: `app/api/notifications/logs/route.ts`
- Modify: `components/notifications/notification-center-sheet.tsx`
- Modify: `lib/desktop-notification.tsx`
- Test: `scripts/test-notifications-and-cleanup.ts`

- [ ] **Step 1: Write test for notification accessibility**
  Verify disaster alerts are visible to branch users without scope violation error, while private incident operations remain branch-restricted.
- [ ] **Step 2: Update `lib/notification-access.ts` and `logs/route.ts`**
  Allow global notification view for all users, or query disaster logs nationally so every user is informed of major events.
- [ ] **Step 3: Clean up `notification-center-sheet.tsx`**
  - Remove "Tandai Semua Dibaca" button and unnecessary unread counters.
  - Remove redundant "Rincian Cabang" button from cards; leave "Lihat Detail".
  - Refine card spacing, typography, and contrast.
- [ ] **Step 4: Run test and confirm pass**
  Execute `pnpm exec tsx scripts/test-notifications-and-cleanup.ts`.

---

### Task 7: PWA Real Notification Architecture & Service Worker
**Files:**
- Modify: `public/sw.js`
- Create: `app/api/notifications/push/subscribe/route.ts`
- Create: `app/api/notifications/push/test/route.ts`
- Modify: `components/notifications/notification-permission-dialog.tsx`
- Test: `scripts/test-pwa-push-architecture.ts`

- [ ] **Step 1: Write test for PWA Push Service Worker handlers**
  Verify `public/sw.js` contains `push` and `notificationclick` listeners with URL focus/navigation logic.
- [ ] **Step 2: Implement Push event and notificationclick in `public/sw.js`**
  - Add `self.addEventListener("push", (event) => { ... })` parsing title, body, icon, data.url.
  - Add `self.addEventListener("notificationclick", (event) => { ... })` opening window or focusing existing window.
- [ ] **Step 3: Implement push subscription database table and API route**
  Create `app/api/notifications/push/subscribe/route.ts` to register endpoints for logged-in users.
- [ ] **Step 4: Run test and confirm pass**
  Execute `pnpm exec tsx scripts/test-pwa-push-architecture.ts`.

---

### Task 8: Mobile Responsive, Modal Stability & Bug Scroll
**Files:**
- Modify: `components/incident/select-report-modal.tsx`
- Modify: `components/layout/incident-app-shell.tsx`
- Modify: `components/mobile/mobile-bottom-nav.tsx`
- Test: `scripts/test-mobile-responsive-modals.ts`

- [ ] **Step 1: Write test for modal scroll containers**
  Inspect `select-report-modal.tsx` to verify fixed header/footer, isolated internal scroll container, absence of `touch-none` on touch devices, and proper back navigation.
- [ ] **Step 2: Update `select-report-modal.tsx`**
  - Fix modal wrapper: `max-h-[85dvh] flex flex-col`.
  - Fix header & search bar: `shrink-0`.
  - List container: `flex-1 min-h-0 overflow-y-auto overscroll-contain`.
  - Ensure background scroll lock with `useBodyScrollLock`.
  - Replace raw enum badges with clean Indonesian text.
- [ ] **Step 3: Verify mobile bottom navigation has no duplicate hamburger**
- [ ] **Step 4: Run test and confirm pass**
  Execute `pnpm exec tsx scripts/test-mobile-responsive-modals.ts`.

---

### Task 9: Rapikan UI, Menu Navigasi, dan Standarisasi Bahasa
**Files:**
- Modify: `components/layout/incident-app-shell.tsx`
- Modify: `components/mobile/mobile-incident-home.tsx`
- Modify: `lib/display-formatters.ts`
- Test: `scripts/test-ui-menu-and-language.ts`

- [ ] **Step 1: Write test for navigation items and disaster translation**
  Verify "Data Fasilitas" is hidden from user navigation menus. Verify disaster enums (`earthquake`, `flood`, `heavy_rain`) format to Indonesian.
- [ ] **Step 2: Hide "Data Fasilitas" from user navigation**
  In `components/layout/incident-app-shell.tsx` and `mobile-incident-home.tsx`, remove or hide `location-management` / `/admin/facilities` from the sidebar and bottom nav items.
- [ ] **Step 3: Standardize disaster labels & formatters**
  Ensure clean Indonesian labels everywhere: "Gempa Bumi", "Banjir", "Hujan Lebat / Badai", "Kebakaran", "Pencurian", "Bangunan Rusak Parah".
- [ ] **Step 4: Run test and confirm pass**
  Execute `pnpm exec tsx scripts/test-ui-menu-and-language.ts`.

---

### Task 10: Audit dan Rapikan Manajemen Akun
**Files:**
- Modify: `app/(siaga)/admin/users/page.tsx`
- Inspect: `scripts/prepare-uat-personas.ts`
- Test: `scripts/test-user-management-audit.ts`

- [ ] **Step 1: Write test for user management audit**
  Verify System Administrator (`usr_seed_admin` / `ADM0001`) is preserved with intact password. Verify all 10 canonical UAT users are active.
- [ ] **Step 2: Update `app/(siaga)/admin/users/page.tsx`**
  - Include all canonical operational roles (`bmc`, `bec`, `bbs`, `bbc`, `bms`, `bes`, `bm`, `ho_admin`, `gm_ho`) in role filter and creation form.
  - Improve table readability and role badges.
- [ ] **Step 3: Run test and confirm pass**
  Execute `pnpm exec tsx scripts/test-user-management-audit.ts`.

---

### Task 11: Finalisasi Dua Simulasi Atasan & Dataset UAT
**Files:**
- Modify: `scripts/setup-simulation-1.ts`
- Modify: `scripts/setup-simulation-2.ts`
- Create: `scripts/verify-simulation-scenarios.ts`
- Create: `docs/PANDUAN_SIMULASI_ATASAN_1_DAN_2.md`

- [ ] **Step 1: Update setup scripts for clean presentation data**
  - `setup-simulation-1.ts`: Toko Cicaheum (`INC-UAT1-TOKO-001`). Clean titles and natural Indonesian notes.
  - `setup-simulation-2.ts`: DC Bandung (`INC-UAT2-DC-001`) and Toko Babakan Sari (`INC-UAT2-EQ-001`).
- [ ] **Step 2: Create automated end-to-end simulation runner**
  `scripts/verify-simulation-scenarios.ts` executing the complete lifecycle for Simulation 1, Simulation 2, and Earthquake auto-report.
- [ ] **Step 3: Write comprehensive user click-through guide**
  `docs/PANDUAN_SIMULASI_ATASAN_1_DAN_2.md`.
- [ ] **Step 4: Run simulation verification and verify pass**
  Execute `pnpm exec tsx scripts/verify-simulation-scenarios.ts`.

---

### Task 12: Pengujian Menyeluruh, Typecheck, Build & Browser QA
**Files:**
- Create: `scripts/run-all-corrective-audits.ts`

- [ ] **Step 1: Run comprehensive automated test suite**
  Execute all unit & integration tests.
- [ ] **Step 2: Run typecheck and build**
  - `pnpm typecheck`
  - `pnpm lint`
  - `pnpm build`
- [ ] **Step 3: Browser Subagent Visual QA**
  Capture desktop and mobile screenshots across all key screens.
- [ ] **Step 4: Compile Final Deliverable Report**
  Provide all 8 required output sections.
