# Final Audit & Refinements Implementation Plan  -  SPARTA SIAGA

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Conduct a rigorous final audit and targeted refinement of SPARTA SIAGA covering private Google Sheets support without public publishing, autonomous scheduling, empirical map performance measurement, full multi-role Serah Terima lifecycle verification, database seeding safety checks, and definitive reporting.

**Architecture:** Maintain native PostgreSQL (`pg` pool) and App Router architecture. Add private Google Service Account authentication adapter to `lib/google-sheets-sync.ts`, autonomous scheduled job in `lib/server-daemon.ts`, empirical benchmarking scripts, and end-to-end multi-role tests.

**Tech Stack:** Next.js 16 (App Router), TypeScript, Native `pg` pool, Node.js `crypto` (JWT for Google Service Account), Leaflet / react-leaflet.

## Global Constraints
- Strictly NO PRISMA (Native `pg` pool only).
- Strictly NO DB RESET or data destruction on existing tables.
- Do NOT publish company data to the web; use legitimate private access architecture.
- Follow antislop mode: `during (session override)`.
- Never claim completion without fresh verification evidence.
- Categorize final report into: (1) Sudah berfungsi dan teruji, (2) Sudah dibuat tetapi belum teruji, (3) Masih menunggu akses atau penyelesaian.

---

### Task 1: Google Sheets Legitimate Private Access Support & Status Distinction

**Files:**
- Modify: `lib/google-sheets-sync.ts`
- Modify: `components/map/map-toolbar.tsx`
- Modify: `components/map/map-inner.tsx`
- Test: `scripts/test-google-sheets-private-access.ts`

- [ ] **Step 1: Write the failing test**
  Create `scripts/test-google-sheets-private-access.ts` testing:
  - Private access handler parses service account credentials or API key if provided.
  - When credentials are not provided or private access returns 401/403/302, status is explicitly `LOCAL_FALLBACK` with label "Master Toko Lokal".
  - When credentials succeed, status is `GOOGLE_SHEETS_SYNCED` with label "Google Sheets".
  - Clear distinction between local fallback and remote sync.

- [ ] **Step 2: Run test to make sure it fails**
  Run `pnpm exec tsx scripts/test-google-sheets-private-access.ts` and confirm failure.

- [ ] **Step 3: Implement private Google Sheets support in `lib/google-sheets-sync.ts`**
  - Implement Service Account JWT generation (using native `crypto.createSign("RSA-SHA256")`).
  - Add support for `GOOGLE_SERVICE_ACCOUNT_EMAIL` + `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` / `GOOGLE_SERVICE_ACCOUNT_JSON` or `GOOGLE_SHEETS_API_KEY`.
  - Refine sync statuses: `GOOGLE_SHEETS_SYNCED`, `LOCAL_FALLBACK`, `IN_PROGRESS`, `FAILED`.
  - Update `getLastStoreSyncHistory()` to return explicit `sourceType: "GOOGLE_SHEETS" | "LOCAL_MASTER"`.

- [ ] **Step 4: Update UI indicators in `map-toolbar.tsx` and `map-inner.tsx`**
  Display:
  - "Sumber: Master Toko Lokal (21.550 Toko)" when on local fallback.
  - "Sumber: Google Sheets (Sinkron)" when synced from remote.

- [ ] **Step 5: Run tests and confirm they pass**
  Run `pnpm exec tsx scripts/test-google-sheets-private-access.ts` and verify.

---

### Task 2: Autonomous Store Sync Scheduling

**Files:**
- Modify: `lib/server-daemon.ts`
- Modify: `scripts/worker-daemon.ts`
- Test: `scripts/test-autonomous-sync-scheduler.ts`

- [ ] **Step 1: Write test for autonomous store sync scheduling**
  Create `scripts/test-autonomous-sync-scheduler.ts` verifying that `runAutonomousStoreSyncCycle()` executes, records sync history, and handles interval ticks without blocking disaster cycle.

- [ ] **Step 2: Run test and observe output**

- [ ] **Step 3: Implement store sync scheduling in `lib/server-daemon.ts`**
  - Add `STORE_SYNC_INTERVAL_HOURS` (default: 24 hours).
  - Add initial check on server startup after 10s delay.
  - Add timer for daily automatic background execution.
  - Expose `runAutonomousStoreSyncCycle()` for testing and standalone worker.

- [ ] **Step 4: Verify test passes**
  Run `pnpm exec tsx scripts/test-autonomous-sync-scheduler.ts`.

---

### Task 3: Map Performance & Architecture Benchmark

**Files:**
- Create: `scripts/benchmark-map-performance.ts`

- [ ] **Step 1: Write empirical benchmark script**
  Measure:
  - Network payload: Full 21,550 stores JSON (raw bytes vs gzip bytes).
  - Spatial bounding box query payload (e.g. Jakarta/Bandung viewport with ~500-1000 stores).
  - In-memory V8 heap consumption of full store dataset vs viewport subset.
  - Server query time vs client-side Leaflet marker clustering CPU time.
  - Architectural comparison: Network request frequency on pan/zoom vs Single cache load.

- [ ] **Step 2: Run benchmark script and record exact numbers**
  Execute `pnpm exec tsx scripts/benchmark-map-performance.ts`.

---

### Task 4: Multi-Role Serah Terima Flow End-to-End Verification

**Files:**
- Create: `scripts/test-serah-terima-role-workflow.ts`

- [ ] **Step 1: Write end-to-end multi-role test**
  Cover the entire lifecycle:
  1. BMS submit Serah Terima with multi-file attachments -> `WAITING_COORDINATOR_APPROVAL`.
  2. BMC coordinator approves -> `WAITING_MANAGER_APPROVAL`.
  3. BnM manager rejection without reason -> blocked with 400.
  4. BnM manager rejection with mandatory reason -> `REVISION_REQUIRED`, milestones 10-50% remain intact.
  5. BMS resubmits revised documents -> `WAITING_COORDINATOR_APPROVAL`.
  6. BMC coordinator approves -> `WAITING_MANAGER_APPROVAL`.
  7. BnM manager approves -> `APPROVED`, report status closed/resolved.

- [ ] **Step 2: Run test and verify every stage passes**
  Run `pnpm exec tsx scripts/test-serah-terima-role-workflow.ts`.

---

### Task 5: Database Safety Audit for Demo Personas Seeding

**Files:**
- Inspect: `scripts/seed-demo-personas.ts`
- Inspect: `lib/database-safety.ts`
- Inspect: `.env` and runtime connection configs

- [ ] **Step 1: Test safety assertion under simulated operational DB**
  Verify `assertIsolatedDatabase` throws exception if `database_name` is not `sparta_siaga_isolated`.
- [ ] **Step 2: Audit database configuration**
  Verify production deployment safeguards (`NODE_ENV === 'production'` blocks demo seeding).

---

### Task 6: Full System Build, Git Summary, and Categorized Final Report

- [ ] **Step 1: Run full verification suite**
  - `pnpm typecheck`
  - `pnpm lint`
  - `pnpm build`
  - `git status` and `git diff --stat`
- [ ] **Step 2: Deliver categorized final report**
  - Section 1: Sudah berfungsi dan teruji
  - Section 2: Sudah dibuat tetapi belum teruji
  - Section 3: Masih menunggu akses atau penyelesaian (Google Sheets Service Account)
