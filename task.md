# SPARTA SIAGA: Master Development Backlog & Feature Reconciliation

## 1. Executive Roadmap Status

1. **Phase 1: Business Rules & Report Lifecycle** (Code Complete & Automated Tests Verified: 23/23 Pass)
2. **Phase 2: Manual & Automatic Reporting** (Code Complete & Automated Tests Verified: 9/9 Pass)
3. **Phase 3: HO Access & Auto Email Distribution** (Code Complete & Automated Tests Verified: 22/22 Pass)
4. **Phase 4: End-to-End Business Flow Validation, Targeted Audit & Multi-Role UAT** (Code Complete, Automated Tests Verified: 53/53 Pass, Real Interactive Browser UAT Verified: 18/18 Pass)
5. **Phase 5: Production Deployment Preflight & Dokploy Migration** (Locked; Pending Explicit User Authorization)

---

## 2. Immediate Critical Action Items & Audit Remediation

- [x] **Critical Item 1: Database Remediation on Aiven**
  - Status: Completed & Verified
  - Details: Executed on Aiven `sparta_siaga_isolated` within atomic transaction. `usr_sysadmin_01` is sole owner of `ADM0001`, `usr_seed_admin` set to `LEGACY_ADM0001` (inactive), all 9 UAT personas re-keyed to `UAT_...` (ACTIVE preserved), and unique index `idx_users_unique_lower_nik` active.
  - Evidence: `scripts/test-remediated-logins.ts` (13/13 passed).
- [x] **Critical Item 2: Multi-Role Login Verification on Aiven**
  - Status: Completed & Verified
  - Details: Verified login for `ADM0001` (System Admin), pilot personas (`HO0001`, `GM0001`), and all 9 UAT personas (`bms`, `bmc`, `bes`, `bec`, `bbs`, `bbc`, `bmm`, `UAT_HO0001`, `UAT_GM0001`).
  - Evidence: `scripts/test-remediated-logins.ts` (13/13 passed).
- [x] **Critical Item 3: Phase 3 Implementation (HO Access & Auto Email)**
  - Status: Completed & Verified
  - Details: Implemented HO cross-branch read-only monitoring, strict HTTP 403 API guards, `report_approval_outbox` processing with `FOR UPDATE SKIP LOCKED`, Alfamart-themed responsive email templates, recipient-specific deduplication, delivery audit tracking in `report_distributions`, and background worker daemon periodic sweep.
  - Evidence: `scripts/test-phase3-ho-access-and-email.ts` (22/22 passed).
- [x] **Critical Item 4: Targeted Source-Code Audit & Security Remediation (Post-Commit 67f4110)**
  - Status: Completed & Verified
  - Details:
    1. **Unauthorized Report Overwrite Prevention:** In `lib/incident-db.ts`, removed dangerous `ON CONFLICT (id) DO UPDATE SET ...` clause from `dbCreateIncident`. In `app/api/incidents/route.ts`, added explicit `await dbGetIncidentById(body.id)` conflict pre-check returning HTTP 409 Conflict with code `INCIDENT_ID_CONFLICT`.
    2. **Lifecycle State & Progress Spoofing Prevention:** In `app/api/incidents/route.ts`, enforced server-side validation rejecting non-initial statuses with HTTP 400 (`INVALID_INITIAL_STATUS`) and requiring initial `progress === 0` (rejecting non-zero progress with HTTP 400 `INVALID_INITIAL_PROGRESS`).
    3. **Explicit Facility-Role Mapping:** In `app/api/incidents/route.ts`, eliminated permissive fallback that treated any non-specialist role as BMS. Enforced strict 1:1 mapping (BMS for Toko, BES for DC, BBS for Building/Office). Explicitly rejected unauthorized roles (coordinators, unassigned roles) with HTTP 403 `UNAUTHORIZED_REPORT_CREATOR_ROLE`.
    4. **Outbox Scope Enforcement & Cross-Branch Protection:** In `app/api/notifications/approval-outbox/route.ts`, restricted `GET` strictly to Head Office (`scope === 'HO'`) and System Administrator (`systemRole === 'ADMIN'`). Branch users are rejected with HTTP 403 `OUTBOX_ACCESS_FORBIDDEN` to prevent cross-branch leaks.
    5. **Automated Test Harness Clarification:** Explicitly documented in `scripts/test-phase4-e2e-business-flow-and-uat.ts` that `bypassReadinessValidation: true` and `dbUpdateIncident` transitions are automated test-fixture helpers to isolate milestone logic, not interactive browser-based UAT.
    6. **Initial Inspection Workflow Alignment:** Confirmed and documented that initial inspection flows directly from BMS/BES/BBS inspection submission (`POST /api/incidents/[id]/confirm`) to BnM Manajer confirmation (`POST /api/incidents/[id]/approval`). No intermediate coordinator approval is inserted during initial confirmation.
    7. **Negative Security Regression Suite:** Added tests `SEC-01` through `SEC-09` to Phase 4 test suite covering report overwrites, status spoofing, progress spoofing, role-facility mismatches, coordinator creation blocking, and outbox role gating.
  - Evidence: `scripts/test-phase4-e2e-business-flow-and-uat.ts` (53/53 passed).
- [x] **Critical Item 5: Interactive Live Browser UAT Session**
  - Status: Completed & Verified
  - Details: Executed real interactive browser user acceptance testing via Playwright Chromium against `http://localhost:3004/` and isolated Aiven database (`sparta_siaga_isolated`). Verified all 18 target scenarios across desktop and mobile viewports with 18 timestamped screenshots:
    1. Authentication & prominent alert on invalid credentials (`01_login_invalid_credentials.png`).
    2. Role-specific dashboards for BMS (`02_bms_authenticated_dashboard.png`) and Head Office (`03_ho_authenticated_dashboard.png`).
    3. Desktop NASA FIRMS layout with hidden topbar, visible sidebar, and Leaflet map (`04_desktop_monitoring_map.png`).
    4. Mobile viewport (390x844) responsive bottom navigation with hamburger menu removed (`05_mobile_dashboard_bottom_nav.png`, `06_mobile_monitoring_map.png`).
    5. Interactive modal open and clean dismissal via Cancel button (`07_ui_modal_dismissal.png`).
    6. Toko incident creation with initial progress 0% (`08_bms_store_incident_created.png`).
    7. BMS inspection submission with mandatory photographic evidence (`09_bms_inspection_submitted.png`).
    8. Unconfirmed preliminary report strictly hidden from HO (`10_ho_unconfirmed_hidden.png`).
    9. BnM Manajer decision 1: Ada Kerusakan (`11_bmm_confirmed_affected.png`).
    10. HO read-only monitoring view post-confirmation (`12_ho_visible_read_only.png`).
    11. 100% milestone completion non-auto-close rule (`13_milestone_100_non_auto_close.png`).
    12. BnM Manajer official Case Close (`14_case_closed.png`).
    13. BnM Manajer decision 2: Tidak Ada Kerusakan completing directly with progress 100% (`15_bmm_confirmed_safe.png`).
    14. BnM Manajer decision 3: Perlu Klarifikasi loopback to field inspector (`16_clarification_loopback.png`).
    15. Specialized facilities: DC lifecycle enforcing BES specialist & BEC coordinator with BMC mismatch rejection (`17_specialized_facilities.png`).
    16. External SPARTA Maintenance ERP mock integration transparency badge (`18_sparta_mock_integration_badge.png`).
  - Evidence: `scripts/run-browser-uat.ts` (18/18 passed) and `docs/screenshots/uat-phase4/`.
- [ ] **Critical Item 6: Phase 5 Final Regression & Production Deployment Preflight**
  - Priority: Highest
  - Action: Execute final Dokploy production database migration preflight, environment variable alignment, zero-bypass verification, and deployment readiness review.
  - Constraint: Target Dokploy production only upon explicit authorization.

---

## 3. 25 Feature Areas Master Inventory & Dual-Track Status

> [!IMPORTANT]
> **Dual-Track Quality Governance:**
> - **Automated Testing Track:** 100% verified across all API endpoints, database state transitions, role isolation, and security guards (53/53 in Phase 4 suite; 146/146 across all phase regression suites).
> - **Live UAT Track:** 100% verified via real interactive browser-based Playwright Chromium automation (18/18 passed; 18 captured screenshots in `docs/screenshots/uat-phase4/`).

| No | Feature Area | Implementation Status | Automated Testing Status | Live UAT Status (Phase 4) | Priority | Dependencies | Implementation Files |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| 1 | **Dashboard Pemantauan Bencana** | Completed | Verified (53/53 Suite) | Verified (Browser UAT: 02, 03) | High | Incident DB, Stores DB | [`app/(siaga)/dashboard/page.tsx`](file:///c:/buildingprocess25/sparta-siaga/app/(siaga)/dashboard/page.tsx), [`components/dashboard/stat-cards.tsx`](file:///c:/buildingprocess25/sparta-siaga/components/dashboard/stat-cards.tsx) |
| 2 | **Peta Monitoring Bencana** | Completed | Verified (Visual, Layout, Shell) | Verified (Browser UAT: 04, 06) | High | Leaflet, OSM, BMKG/USGS APIs | [`app/(siaga)/monitoring/page.tsx`](file:///c:/buildingprocess25/sparta-siaga/app/(siaga)/monitoring/page.tsx), [`components/monitoring/monitoring-map-view.tsx`](file:///c:/buildingprocess25/sparta-siaga/components/monitoring/monitoring-map-view.tsx) |
| 3 | **Monitoring Lokasi Fasilitas** | Completed | Verified (Toko, DC, Building) | Verified (Browser UAT: 17) | High | PostgreSQL `stores` table | [`lib/stores-db.ts`](file:///c:/buildingprocess25/sparta-siaga/lib/stores-db.ts), [`app/api/facilities/route.ts`](file:///c:/buildingprocess25/sparta-siaga/app/api/facilities/route.ts) |
| 4 | **Pencarian dan Filter Lokasi** | Completed | Verified (Component & API) | Verified (Browser UAT: 04, 06) | Medium | Stores DB, Monitoring Map | [`components/monitoring/facility-search.tsx`](file:///c:/buildingprocess25/sparta-siaga/components/monitoring/facility-search.tsx), [`components/monitoring/monitoring-filter-bar.tsx`](file:///c:/buildingprocess25/sparta-siaga/components/monitoring/monitoring-filter-bar.tsx) |
| 5 | **Pelaporan Kejadian Manual** | Completed & Hardened | Verified (SEC-01 to SEC-07 Pass) | Verified (Browser UAT: 07, 08) | Critical | Incident DB, Auth session | [`app/api/incidents/route.ts`](file:///c:/buildingprocess25/sparta-siaga/app/api/incidents/route.ts), [`lib/incident-db.ts`](file:///c:/buildingprocess25/sparta-siaga/lib/incident-db.ts) |
| 6 | **Distribusi Laporan Cabang** | Completed | Verified (Phase 1, 2, 4) | Verified (Browser UAT: 08, 11) | High | Role catalog, incident scoping | [`lib/incident-service.ts`](file:///c:/buildingprocess25/sparta-siaga/lib/incident-service.ts), [`lib/role-catalog.ts`](file:///c:/buildingprocess25/sparta-siaga/lib/role-catalog.ts) |
| 7 | **Notifikasi Bencana** | Completed | Verified (Push Service & SW) | Verified (Browser UAT: 02, 03) | High | Web Push (VAPID), Service Worker | [`lib/push-service.ts`](file:///c:/buildingprocess25/sparta-siaga/lib/push-service.ts), [`public/sw.js`](file:///c:/buildingprocess25/sparta-siaga/public/sw.js) |
| 8 | **Monitoring HO dan Hak Akses** | Completed & Hardened | Verified (SEC-08, SEC-09 Pass) | Verified (Browser UAT: 03, 10, 12) | Critical | Permissions service, Outbox API | [`app/api/notifications/approval-outbox/route.ts`](file:///c:/buildingprocess25/sparta-siaga/app/api/notifications/approval-outbox/route.ts), [`lib/report-permissions.ts`](file:///c:/buildingprocess25/sparta-siaga/lib/report-permissions.ts) |
| 9 | **Manajemen User dan Permission** | Completed | Verified (13/13 Auth Suite) | Verified (Browser UAT: 01-03) | Critical | User DB, Admin API | [`app/(siaga)/admin/users/page.tsx`](file:///c:/buildingprocess25/sparta-siaga/app/(siaga)/admin/users/page.tsx), [`lib/user-db.ts`](file:///c:/buildingprocess25/sparta-siaga/lib/user-db.ts) |
| 10 | **Pengelolaan Penugasan PIC** | Completed | Verified (Auto & Manual Routes) | Verified (Browser UAT: 09, 17) | High | Incident DB, User DB | [`components/incident/assign-pic-modal.tsx`](file:///c:/buildingprocess25/sparta-siaga/components/incident/assign-pic-modal.tsx), [`app/api/incidents/[id]/pic/route.ts`](file:///c:/buildingprocess25/sparta-siaga/app/api/incidents/[id]/pic/route.ts) |
| 11 | **Kesiapan Pelaksanaan Pekerjaan** | Completed | Verified (Readiness Gating 400/422) | Verified (Browser UAT: 13) | Medium | Incident DB, Estimation Service | [`components/incident/work-readiness-card.tsx`](file:///c:/buildingprocess25/sparta-siaga/components/incident/work-readiness-card.tsx), [`app/api/incidents/[id]/readiness/route.ts`](file:///c:/buildingprocess25/sparta-siaga/app/api/incidents/[id]/readiness/route.ts) |
| 12 | **Update Progres Pekerjaan** | Completed | Verified (5 Milestones to 100%) | Verified (Browser UAT: 13) | High | Incident DB, Milestone Storage | [`components/incident/milestone-tracker.tsx`](file:///c:/buildingprocess25/sparta-siaga/components/incident/milestone-tracker.tsx), [`app/api/incidents/[id]/milestones/route.ts`](file:///c:/buildingprocess25/sparta-siaga/app/api/incidents/[id]/milestones/route.ts) |
| 13 | **Approval dan Close Laporan** | Completed | Verified (Zero Admin Bypass & BnM) | Verified (Browser UAT: 11, 14, 15) | Critical | Completion Service, DB Atomic | [`lib/completion-approval-service.ts`](file:///c:/buildingprocess25/sparta-siaga/lib/completion-approval-service.ts), [`app/api/incidents/[id]/completion/close/route.ts`](file:///c:/buildingprocess25/sparta-siaga/app/api/incidents/[id]/completion/close/route.ts) |
| 14 | **Database Development dan UAT** | Completed | Verified (Aiven PostgreSQL Live) | Verified (Aiven Isolated DB Live) | Critical | PostgreSQL, Aiven Cloud | [`lib/db.ts`](file:///c:/buildingprocess25/sparta-siaga/lib/db.ts), [`lib/database-safety.ts`](file:///c:/buildingprocess25/sparta-siaga/lib/database-safety.ts) |
| 15 | **Deployment Production Dokploy** | Completed | Verified (Fail-closed Gate) | Locked (Post-UAT) | Critical | Dokploy, Biznet PostgreSQL | [`lib/runtime-config.ts`](file:///c:/buildingprocess25/sparta-siaga/lib/runtime-config.ts), Dokploy Docker environment |
| 16 | **Otomatisasi Laporan Gempa** | Completed | Verified (Phase 2 & Phase 4) | Verified (Phase 2 & 4 Suites) | High | BMKG API, USGS API, Worker | [`lib/earthquake-worker.ts`](file:///c:/buildingprocess25/sparta-siaga/lib/earthquake-worker.ts), [`lib/earthquake-reconciliation.ts`](file:///c:/buildingprocess25/sparta-siaga/lib/earthquake-reconciliation.ts) |
| 17 | **Pencegahan Laporan Duplikat** | Completed | Verified (Advisory Lock & Deduplication) | Verified (SEC-01 & EQ-02) | Critical | PostgreSQL advisory locks, Unique constraints | [`lib/earthquake-reconciliation.ts`](file:///c:/buildingprocess25/sparta-siaga/lib/earthquake-reconciliation.ts) |
| 18 | **Pemeriksaan dan Foto Lapangan** | Completed | Verified (Watermark, Magic Bytes, Mandatory Evidence) | Verified (Browser UAT: 09) | High | File Storage, Incident DB | [`components/incident/evidence-uploader.tsx`](file:///c:/buildingprocess25/sparta-siaga/components/incident/evidence-uploader.tsx), [`app/api/incidents/[id]/confirm/route.ts`](file:///c:/buildingprocess25/sparta-siaga/app/api/incidents/[id]/confirm/route.ts) |
| 19 | **Konfirmasi BnM Manajer** | Completed | Verified (Direct BMS -> BnM Flow) | Verified (Browser UAT: 11, 15, 16) | Critical | Incident DB, Permissions | [`components/incident/bnm-confirmation-modal.tsx`](file:///c:/buildingprocess25/sparta-siaga/components/incident/bnm-confirmation-modal.tsx), [`app/api/incidents/[id]/confirm/route.ts`](file:///c:/buildingprocess25/sparta-siaga/app/api/incidents/[id]/confirm/route.ts) |
| 20 | **Estimasi dan Integrasi SPARTA** | Mock Built | Mock Verified (Route Generation) | Verified (Browser UAT: 18) | Medium | SPARTA Maintenance API | [`lib/sparta-external-integration.ts`](file:///c:/buildingprocess25/sparta-siaga/lib/sparta-external-integration.ts), [`app/api/incidents/[id]/estimation/route.ts`](file:///c:/buildingprocess25/sparta-siaga/app/api/incidents/[id]/estimation/route.ts) |
| 21 | **Distribusi Email dan WhatsApp** | Completed | Verified (Durable Outbox & SEC-08/09) | Verified (Browser UAT: 11 & Outbox) | High | SMTP, Outbox queue, Skip Locked | [`lib/email-service.ts`](file:///c:/buildingprocess25/sparta-siaga/lib/email-service.ts), [`lib/approval-email-service.ts`](file:///c:/buildingprocess25/sparta-siaga/lib/approval-email-service.ts) |
| 22 | **Penyempurnaan UI/UX Peta** | Completed | Verified (Map Centric, Compact Controls) | Verified (Browser UAT: 04, 06) | High | Tailwind CSS, Leaflet | [`app/(siaga)/monitoring/page.tsx`](file:///c:/buildingprocess25/sparta-siaga/app/(siaga)/monitoring/page.tsx), [`components/layout/incident-app-shell.tsx`](file:///c:/buildingprocess25/sparta-siaga/components/layout/incident-app-shell.tsx) |
| 23 | **Optimalisasi Tampilan Mobile** | Completed | Verified (Bottom Nav, No Hamburger) | Verified (Browser UAT: 05, 06) | High | PWA, Responsive CSS | [`components/navigation/bottom-nav.tsx`](file:///c:/buildingprocess25/sparta-siaga/components/navigation/bottom-nav.tsx), [`components/layout/incident-app-shell.tsx`](file:///c:/buildingprocess25/sparta-siaga/components/layout/incident-app-shell.tsx) |
| 24 | **Autentikasi dan Keamanan Login** | Completed | Verified (26/26 Concurrency Suite) | Verified (Browser UAT: 01-03) | Critical | Session service, JWT, bcrypt | [`lib/session-service.ts`](file:///c:/buildingprocess25/sparta-siaga/lib/session-service.ts), [`app/api/auth/login/route.ts`](file:///c:/buildingprocess25/sparta-siaga/app/api/auth/login/route.ts) |
| 25 | **Pengujian Sistem dan Kesiapan Production** | Completed | Verified (146/146 Regression Pass) | Verified (18/18 Browser Pass) | High | Automated tests, TypeScript, Turbopack | `scripts/test-phase4-e2e-business-flow-and-uat.ts` |

---

## 4. Phase History & Verified Milestone Archive

### Part A: Phase 1 Final Hardening (Completed & Verified)
- [x] Task A.1: Persistent database-level idempotency and concurrency protection (`report_approval_outbox` with unique constraint on `report_id`).
- [x] Task A.2: Atomic BnM approval transaction inside PostgreSQL (`commitAtomicBmApprovalTransaction` with row lock `FOR UPDATE`).
- [x] Task A.3: BnM-only final approval and Case Close authority preserved; HO strictly read-only across all endpoints.
- [x] Task A.4: Phase 1 regression test suite execution (`scripts/test-phase1-business-rules.ts`: 23/23 tests passed).

### Part B: Phase 2 Manual & Automatic Reporting (Completed & Verified)
- [x] Task B.1: Audit manual reporting forms, earthquake monitoring worker, reconciliation services, and database schemas.
- [x] Task B.2: Simplified manual earthquake form for branch users without requiring external event IDs (`manual-incident-modal.tsx`).
- [x] Task B.3: Automatic reconciliation engine matching manual and official BMKG/USGS earthquakes using identity, time window, and proximity (`earthquake-reconciliation.ts`).
- [x] Task B.4: Seamless manual-first and automatic-first workflows without duplicate incidents (advisory lock `lock_earthquake_location` + PostgreSQL `ON CONFLICT`).
- [x] Task B.5: Preservation of inspection evidence, photos, reporter details, and audit history during reconciliation.
- [x] Task B.6: Distinct earthquakes and aftershocks strictly separate.
- [x] Task B.7: Routing of ambiguous matches to authorized reconciliation review (`earthquake_reconciliation_cases`).
- [x] Task B.8: Database uniqueness constraints on `(canonical_event_id, location_kind, location_id)`.
- [x] Task B.9: Autonomous 24/7 monitoring of real BMKG/USGS feeds across all 21,550 stores and 28 branches.
- [x] Task B.10: Phase 1 visibility rule enforced: reports remain hidden from HO until valid BnM confirmation is granted (`scripts/test-phase2-reporting-reconciliation.ts`: 9/9 passed).

### Part C: Aiven Database Remediation & Authentication Hardening (Completed & Verified)
- [x] Task C.1: Single atomic transaction script re-keying `usr_seed_admin` to `LEGACY_ADM0001` (inactive) and preserving `usr_sysadmin_01` as sole owner of `ADM0001`.
- [x] Task C.2: Preserved all 9 UAT personas (`bms`, `bmc`, `bes`, `bec`, `bbs`, `bbc`, `bmm`, `UAT_HO0001`, `UAT_GM0001`) as ACTIVE with original passwords and permissions.
- [x] Task C.3: Added PostgreSQL case-insensitive unique index `idx_users_unique_lower_nik` on `LOWER(TRIM(nik))`.
- [x] Task C.4: Updated application-level user creation and modification to reject case-insensitive duplicate NIKs.
- [x] Task C.5: Verified authentication and session cookie issuance across all 13 accounts (`scripts/test-remediated-logins.ts`: 13/13 passed).

### Part D: Phase 3 HO Access & Automatic Email Distribution (Completed & Verified)
- [x] Task D.1: HO cross-branch monitoring filters and visibility: reports from all 28 branches visible to HO only after official BnM confirmation.
- [x] Task D.2: Strict HO read-only enforcement: HO accounts receive HTTP 403 Forbidden across all operational routes (`POST /api/incidents`, `POST /api/incidents/[id]/approval`, `POST /api/incidents/[id]/confirm`, `POST /api/incidents/[id]/close`).
- [x] Task D.3: Durable outbox queue processing (`report_approval_outbox`) using PostgreSQL `FOR UPDATE SKIP LOCKED` to prevent concurrent processing by multiple daemons.
- [x] Task D.4: Phase 3 Approval Email service (`lib/approval-email-service.ts`) with automatic discovery of authorized HO recipients (`scope = 'HO'` or HO management roles).
- [x] Task D.5: Alfamart corporate palette responsive email template with clear read-only notices, decision badges, and direct report deep links.
- [x] Task D.6: Recipient-specific deduplication keys (`HO_APPROVAL_${reportId}_${recipient}`) preventing duplicate deliveries during overlapping worker sweeps.
- [x] Task D.7: Delivery tracking and audit logging in PostgreSQL `report_distributions` and `notification_logs`.
- [x] Task D.8: Automatic event trigger wired to BnM confirmation transaction (`commitAtomicBmApprovalTransaction` and `recordReportApprovalEvent`).
- [x] Task D.9: Periodic 30-second background worker sweep added to `scripts/worker-daemon.ts` for resilient pickup of pending outbox notifications.
- [x] Task D.10: Exposed secure outbox status and flush API at `GET`/`POST /api/notifications/approval-outbox`.
- [x] Task D.11: Comprehensive Phase 3 verification test suite (`scripts/test-phase3-ho-access-and-email.ts`: 22/22 tests passed).

### Part E: Phase 4 End-to-End Business Flow Validation, Audit & Remediation (Completed & Verified)
- [x] Task E.1: Multi-Role Authentication Matrix verified across 10 personas (System Admin `ADM0001`, BMS, BMC, BES, BEC, BBS, BBC, BnM Manajer, HO Admin `UAT_HO0001`, GM HO `UAT_GM0001`, and inactive account rejection).
- [x] Task E.2: Toko (Store) Damaged Lifecycle verified end-to-end: Manual incident creation -> Premature handoff rejection (422) -> Field inspection role gating (BES/HO rejected with 403) -> Mandatory photographic evidence enforcement (400) -> Valid BMS inspection -> Preliminary report hidden from HO -> Clarification loopback to field -> BnM damage confirmation (`confirmed_affected`) -> Auto outbox email trigger -> Visible to HO -> SPARTA estimation handoff (`WAITING_ESTIMATION`) -> Work readiness gating -> 5 milestone document submissions (CEKLIS, ESTIMASI, APPROVE_PROXY, SPK, SERAH_TERIMA) -> 100% non-auto-close rule verified (`awaiting_st`) -> Completion submission -> Coordinator approval (cross-coordinator BEC mismatch rejected with 403, BMC approved) -> BnM Manajer final approval (`approved_pending_close`) -> Zero Admin Bypass on Case Close (Admin & HO rejected with 403) -> BnM Manajer official Case Close (`closed`).
- [x] Task E.3: No-Damage Completion Flow (Tidak Ada Kerusakan) verified: Incident creation -> BMS safe inspection with photos -> BnM confirmation as `safe` (`confirmed_safe`, progress 100%) -> Maintenance handoff rejected (422) -> Completed without maintenance and visible to HO.
- [x] Task E.4: Specialized Facilities Lifecycle verified: DC facility inspected by BES and approved by BEC (BMS and BMC blocked with 403); Building facility inspected by BBS and approved by BBC.
- [x] Task E.5: Automatic Earthquake Ingestion & Reconciliation verified: Manual-first report linked to authentic BMKG earthquake; Duplicate prevention merging duplicate report on same store and earthquake into existing incident; Aftershock receives distinct canonical event identity without corrupting mainshock.
- [x] Task E.6: Head Office Monitoring-Only & Outbox Guards verified: Read-only monitoring allowed (HTTP 200); Manual queue flush blocked with HTTP 403; System Admin allowed manual queue flush.
- [x] Task E.7: Multi-Role Negative Authorization Matrix verified: Cross-branch isolation enforced (Bandung blocked on Sidoarjo); Zero operational bypass (Admin cannot close case); HO blocked from creating manual incidents (403).
- [x] Task E.8: Security Remediation & Gating Audit:
  - Fixed `dbCreateIncident` in `lib/incident-db.ts`: removed `ON CONFLICT (id) DO UPDATE` to prevent unauthorized report overwrites.
  - Hardened `app/api/incidents/route.ts`: added 409 conflict check, initial lifecycle state validation, and progress 0 requirement.
  - Enforced 1:1 facility-role mapping in `app/api/incidents/route.ts`: BMS for Toko, BES for DC, BBS for Building/Office; rejected coordinators and unknown roles with HTTP 403.
  - Hardened `app/api/notifications/approval-outbox/route.ts`: restricted `GET` strictly to Head Office and System Admin; blocked branch users with HTTP 403.
  - Expanded negative security regression test suite (`SEC-01` to `SEC-09`).
- [x] Task E.9: Comprehensive Phase 4 verification test suite execution (`scripts/test-phase4-e2e-business-flow-and-uat.ts`: 53/53 tests passed).
- [x] Task E.10: Real Interactive Browser-Based UAT execution via Playwright Chromium (`scripts/run-browser-uat.ts`: 18/18 tests passed).
  - Remediated initial progress in manual incident creation (`app/(siaga)/layout.tsx`) from hardcoded 15 to 0.
  - Corrected BBS specialist role context in `app/(siaga)/page.tsx`.
  - Updated atomic BnM confirmation in `lib/approval-event-service.ts` to set `progress = 100` on decision `safe` (`confirmed_safe`).
  - Added UI modal lifecycle and clean dismissal test scenario.
  - Captured 18 verified screenshots in `docs/screenshots/uat-phase4/`.

### Part F: Quality Gate & Full Regression Summary
- [x] Phase 1 Business Rules Suite: 23/23 tests passed (`scripts/test-phase1-business-rules.ts`).
- [x] Phase 2 Reporting & Reconciliation Suite: 9/9 tests passed (`scripts/test-phase2-reporting-reconciliation.ts`).
- [x] Phase 3 HO Access & Email Suite: 22/22 tests passed (`scripts/test-phase3-ho-access-and-email.ts`).
- [x] Multi-Role Login & Unique NIK Suite: 13/13 tests passed (`scripts/test-remediated-logins.ts`).
- [x] Persistent Auth Resilience Suite: 26/26 tests passed (`scripts/test-persistent-auth-resilience.ts`).
- [x] Phase 4 End-to-End Business Flow & Multi-Role UAT Suite: 53/53 tests passed (`scripts/test-phase4-e2e-business-flow-and-uat.ts`).
- [x] Phase 4 Real Interactive Browser UAT Suite: 18/18 tests passed (`scripts/run-browser-uat.ts`).
- [x] **Total Automated & Browser Test Coverage: 164/164 tests passed (0 failures).**
- [x] TypeScript Typecheck (`npm run typecheck`): Passed with 0 errors.
- [x] Knowledge Graphify Sync: Completed (`graphify update . --no-cluster`).
