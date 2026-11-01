# SPARTA SIAGA  -  Final UI/UX Polish & Presentation Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Polish SPARTA SIAGA UI/UX into an executive-presentation-ready command system for two management simulations (Atasan 1 & Atasan 2), removing raw test markers from the display layer, redesigning the earthquake alert notification into a refined non-glaring banner, standardizing all notifications and status copy in natural Indonesian, perfecting the read-only Detail Laporan with prominent PDF download, refining Serah Terima and Milestones presentation, ensuring accurate store data sync indicators on Peta Monitoring, and verifying across desktop and mobile.

**Architecture:**
- **Sanitization & Display Helpers:** Introduce a centralized presentation formatter `lib/display-formatters.ts` that removes raw testing tags (`[UAT-ATASAN-1]`, `[UAT-ATASAN-2]`, `[SIMULASI]`, `[DUMMY]`) and formats event titles, notes, and statuses in clean, authentic Indonesian while preserving internal IDs and metadata in the database.
- **Notification Presentation:** Redesign the floating toast banner in `lib/desktop-notification.tsx` and in-sheet cards in `components/notifications/` with a disciplined, executive aesthetic (balanced header with `GEMPA BUMI` label and close button, natural dynamic body without damage speculation, clear timestamp, equal-height action buttons `[Lihat di Peta]` and `[Lihat Detail]`, responsive layout).
- **Read-Only Detail Laporan:** Enforce strict read-only behavior in `components/incident/maintenance-tracking-modal.tsx`, removing embedded inline inputs/edits, organizing into 11 well-spaced sections, and adding a prominent "Unduh PDF Laporan" button.
- **Milestones & Serah Terima Polish:** Separate Progres Pekerjaan (%) from Kelengkapan Dokumen, provide friendly document status copy (e.g. "Dokumen Estimasi belum diunggah"), format Serah Terima approval stages in natural Indonesian, and provide a direct path to Update Progress for revision.
- **Map & Store Sync Indicator:** Integrate `/api/stores/sync` status in `components/map/map-controls.tsx` and `map-toolbar.tsx` showing accurate last update timestamps without false claims, ensure no duplicate hamburger menus on mobile.

**Tech Stack:** Next.js 14+ App Router, React 18, TypeScript, Tailwind CSS, Lucide React, PostgreSQL (`pg` pool).

---

## Global Constraints
- **NO Prisma:** Use native `pg` pool exclusively.
- **NO Destructive DB Purge:** Keep internal IDs (`INC-UAT1-TOKO-001`, `INC-UAT2-DC-001`, `INC-UAT2-EQ-001`) and audit logs intact.
- **NO Cost Form:** Do not reintroduce any cost calculation form.
- **Antislop Rules:** Mode is `DURING`. Clean typography, no unnecessary gradients/glassmorphism/radial orbs, responsive layouts for mobile and desktop, accessibility touch targets ≥ 44px on mobile, natural human copy without AI buzzwords.

---

## Task Breakdown

### Task 1: Centralized Presentation Sanitizer & Display Helpers
- [ ] Create `lib/display-formatters.ts` providing:
  - `cleanDisplayTitle(title: string): string`: Strips `[UAT-ATASAN-1]`, `[UAT-ATASAN-2]`, `[SIMULASI]`, `[TESTING]`, `[DUMMY]` from display titles; maps e.g. `[UAT-ATASAN-2] Peringatan Gempa Otomatis M 5.2 Wilayah Jawa Barat` to `Peringatan Gempa M 5.2 di Wilayah Jawa Barat`.
  - `cleanDisplayText(text?: string | null): string`: Strips bracketed test markers from descriptions, notes, and timeline logs.
  - `formatEarthquakeBody(eq: { magnitude: number; depthKm: number; title?: string; place?: string; storeName?: string; radiusKm?: number }): string`: Generates natural alert text `Gempa berkekuatan M {mag} dengan kedalaman {depth} km terdeteksi di {region}. {store} berada dalam radius pemantauan {radius} km.` without damage claims.
  - `formatWibDateTime(dateStr?: string | Date | null): string`: Returns formatted `{dd} {MMM} {yyyy} • {HH.mm} WIB` or `{HH.mm} WIB · SPARTA SIAGA`.
- [ ] Write unit test in `scripts/test-display-formatters.ts` to verify all stripping and formatting edge cases.
- [ ] Run test and confirm 100% pass.

### Task 2: Earthquake Notification & Toast Banner Redesign
- [ ] Update `lib/desktop-notification.tsx`:
  - Header: Earthquake icon (ShieldAlert/Activity in subtle red/slate badge), clean label `GEMPA BUMI` (no full-red glare), and right-aligned close `X` button.
  - Body: Natural title via `cleanDisplayTitle`, dynamic body, timestamp `{time} WIB · SPARTA SIAGA`.
  - Actions: Equal height (`min-h-[36px]`), balanced padding, secondary `[Lihat di Peta]` and primary `[Lihat Detail]`.
  - Responsive: Width `w-[calc(100vw-32px)] sm:w-[380px] max-w-[380px]`, safe margin above mobile bottom nav.
  - Branch security: Suppress or guard detail opening if branch is restricted.
- [ ] Update `components/notifications/notification-center-sheet.tsx`:
  - Use `cleanDisplayTitle` and `cleanDisplayText` for notification titles and logs.
  - Replace raw `[SIMULASI]` badges with clean, professional category badge `Gempa Bumi • BMKG` or `Peringatan Sistem`.
  - Standardize notification titles and messages per Section 5 specifications.
- [ ] Update `components/notifications/incident-detail-modal.tsx`:
  - Clean title and header (remove `[SIMULASI] LATIHAN TANGGAP` and full warning banner).
  - Use sanitized Indonesian copy and structured info grid.
- [ ] Verify notification appearance and test dispatch via `scripts/test-notification-polish.ts`.

### Task 3: Detail Laporan (Read-Only Enforcement & PDF Download)
- [ ] Update `components/incident/maintenance-tracking-modal.tsx`:
  - Remove mutating controls: target date editor inputs, "Input Pemeriksaan Lapangan" button, inline upload buttons.
  - Add prominent "Unduh PDF Laporan" button linking to `/api/incidents/${incident.id}/export/pdf` in the header action bar and in the Summary tab.
  - Organize into clean, readable sections:
    1. Informasi kejadian
    2. Identitas lokasi
    3. Pemeriksaan lapangan
    4. Bukti foto
    5. Konfirmasi awal BnM Manajer
    6. Progres pekerjaan
    7. Dokumen milestone
    8. Serah Terima
    9. Persetujuan
    10. Riwayat aktivitas
    11. Unduhan PDF
  - Sanitize timeline entries and notes using `cleanDisplayText`.
  - Ensure mobile modal height and back button allow easy exit without trapping user.
- [ ] Verify Detail Laporan rendering and PDF button link via automated script.

### Task 4: Milestone & Update Progress Refinement
- [ ] Update `components/incident/milestone-progression-card.tsx`:
  - Clearly separate visual indicators: *Progres Pekerjaan* (%) vs *Kelengkapan Dokumen* ("Lengkap" / "Belum Lengkap").
  - Simple, non-technical copy: e.g. "Dokumen Estimasi belum diunggah", "Dokumen Estimasi tersedia", "Serah Terima memerlukan perbaikan".
  - Replace raw database enums (`REVISION_REQUIRED`, `SUBMITTED`) with user-friendly Indonesian copy.
  - Ensure flexible milestone submission works smoothly while guarding case close until all documents are uploaded.
- [ ] Update `components/incident/progress-update-modal.tsx`:
  - Verify that Update Progress remains the single dedicated place for operational updates.
  - Confirm cost calculation form is absent.
  - Ensure smooth upload for Milestone 25% (Estimasi), 30% (Proxy), 50% (SPK), and 100% (Serah Terima).

### Task 5: Serah Terima Presentation & Rejection Handling
- [ ] Update `components/incident/completion-approval-card.tsx`:
  - Show complete handover details: submitter role, uploaded documents list, photo evidence thumbnails, current reviewer.
  - Present standard Indonesian statuses: `Menunggu Pemeriksaan Koordinator`, `Menunggu Persetujuan BnM Manajer`, `Memerlukan Perbaikan`, `Disetujui`, `Selesai`.
  - Clear, prominent rejection reason box when revision is requested, with action button "Perbaiki Serah Terima" that guides user to Update Progress.
  - Display re-submission history timeline without resetting milestones 10%–50%.
- [ ] Verify Serah Terima flow and rejection state with test script.

### Task 6: Peta Monitoring & Data Source Indicator
- [ ] Update `components/map/map-controls.tsx` and `components/map/map-toolbar.tsx`:
  - Fetch last sync information from `/api/stores/sync`.
  - Render accurate data source indicator:
    `Data toko terakhir diperbarui: {datetime} ({sourceLabel} · 21.550 toko)`
  - Handle private Google Sheets fallback honestly without false sync claims.
  - Optimize mobile layout: ensure no duplicate hamburger menu on mobile, keep control panel within bounds (`max-h-[80vh]`), and prevent blocking bottom navigation.
- [ ] Verify map controls and sync indicator.

### Task 7: Report Lists & HO Monitoring Polish
- [ ] Update `components/dashboard/active-incidents-table.tsx` and `components/reports/operational-report-center.tsx`:
  - Sanitize all incident titles and notes using `cleanDisplayTitle` and `cleanDisplayText`.
  - Standardize status badges using `getStandardizedOperationalStatus`.
  - Polish desktop table and mobile card layout with clean whitespace and Indonesian labels.
- [ ] Update `components/reports/ho-report-monitoring.tsx`:
  - Clean executive summary and branch filters.
  - Add single unified PDF download button (`/api/incidents/${id}/export/pdf`).
  - Sanitize timeline notes and event titles.

### Task 8: Two Simulation Scenarios Polish & Re-run
- [ ] Update `scripts/setup-simulation-1.ts` and `scripts/setup-simulation-2.ts`:
  - Ensure incident notes and titles have natural operational Indonesian text without raw test prefixes in user fields, while maintaining `INC-UAT1-TOKO-001`, `INC-UAT2-DC-001`, `INC-UAT2-EQ-001` as internal primary keys and metadata.
  - Run `setup-simulation-1.ts` and `setup-simulation-2.ts` to refresh the isolated UAT dataset.
  - Confirm accounts: BMS (`eko.bms`), BES (`hendra.bes`), Koordinator BMC (`andi.bmc`), Koordinator BEC (`budi.bec`), BnM Manajer (`agus.bm`), HO Admin (`ho_admin`), GM HO (`gm_ho`), and System Administrator (`admin_sparta`).

### Task 9: Comprehensive Verification, Build & Visual QA
- [ ] Create and run master verification script `scripts/verify-presentation-readiness.ts`.
- [ ] Run `pnpm typecheck` and `pnpm build` to verify 0 errors.
- [ ] Run browser subagent visual QA:
  - Capture desktop and mobile screenshots of Dashboard, Peta Monitoring, Notifikasi Popup, Detail Laporan, Update Progress, and HO Monitoring.
- [ ] Compile comprehensive final report in Indonesian matching Sections A through H.
