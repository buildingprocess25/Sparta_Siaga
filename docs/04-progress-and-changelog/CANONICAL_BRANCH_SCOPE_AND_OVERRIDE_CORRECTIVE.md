# SPARTA SIAGA  -  CANONICAL BRANCH SCOPE & EFFECTIVE PERMISSION CORRECTIVE

**Date:** 2026-10-08  
**Branch:** `development`  
**Latest Baseline Commit:** `bc0dff0`  
**Status:** IMPLEMENTED & VERIFIED  

---

## 1. Executive Summary

This corrective resolves two critical security and domain issues reported in SPARTA SIAGA Administration:
1. **Canonical Branch Identity in Edit User (Finding A):** The branch selector previously searched store-level records (`/api/stores/search?type=TOKO`), erroneously binding organizational users to single store labels (e.g. `CIKOKOL  -  ABDUL HADI`) and displaying `Cabang tidak ditemukan` upon autocomplete focus. We implemented an authoritative organizational Branch domain model (`lib/branch-service.ts` and `/api/branches`) containing the 28 canonical organizational branches covering all 21,550 stores.
2. **Legacy Override Compatibility & Effective Access Display (Findings B & C):** In "Akses Khusus User", legacy override `ovr_1791446489576_v05v7` (`REPORT_CONFIRM` with `ALLOW` and `ALL_BRANCHES`) was incorrectly rendered with an active green `DIIZINKAN` badge despite violating the security policy introduced in `bc0dff0` (which prohibits `ALL_BRANCHES` for operational actions). We separated stored configuration from effective operational authority: the UI now renders `Tidak Berlaku  -  Bertentangan dengan Kebijakan` with an amber badge, policy explanation warning banner, and a safe remediation revocation button. Backend authorization strictly denies cross-branch operational mutation, maintaining deny-safe isolation.

---

## 2. Canonical Branch Domain & Store Architecture

### 2.1 Domain Distinction
1. **Organizational Branch (`branches` / canonical 28):** Authoritative operational division (e.g. `CIKOKOL`, `BANDUNG`, `SIDOARJO`, `MEDAN`) overseeing a cluster of hundreds of stores.
2. **Store / Operational Location (`stores` table, 21,550 rows):** Specific physical gerai (e.g., store code `T770`, name `ABDUL HADI`, branch `CIKOKOL`).
3. **User's Assigned Branch:** Stored on `users.branch` as the canonical branch code (e.g., `CIKOKOL`). Governs report visibility and operational authority across all stores within that branch.
4. **Incident Affected Store & Owning Branch:** An incident report targets a specific affected store (`store_id`, `store_name`) and inherits its owning organizational branch (`branch`) from the store record.
5. **Permission Scope:**
   - `ALL_BRANCHES`: Allowed strictly for national monitoring (`REPORT_VIEW_ALL`, `MANAGEMENT_INSTRUCTION_CREATE`).
   - `SPECIFIC_BRANCH` & `OWN_SCOPE`: Required for operational actions (`REPORT_CONFIRM`, `REPORT_UPDATE_PROGRESS`, `ESTIMATION_TRIGGER`, `REPORT_CLOSE`).

### 2.2 Data Lineage Diagram
```
[21,550 Stores Dataset (stores)]
          │
          ├──> 28 Canonical Branches (CANONICAL_BRANCH_LIST)
          │         │
          │         ├──> User Branch Assignment (users.branch = "CIKOKOL")
          │         │         │
          │         │         ▼
          │         └───> Scope Comparison (user.branch === report.branch)
          │                   │
          ▼                   ▼
[Store T770: "ABDUL HADI"] ──> [Report INC-001 (branch: "CIKOKOL")] ──> [Authorized for Cikokol Roles]
```

### 2.3 Meaning of `CIKOKOL  -  ABDUL HADI`
In the master store dataset (`data/stores-master.csv` row 12,792), store `T770` has `nama_toko = "ABDUL HADI"` under `cabang = "CIKOKOL"`.  
The previous `handleOpenEdit` function erroneously queried `/api/stores/search?q=CIKOKOL&type=TOKO&limit=1`, matched store `T770`, and set `branch = "CIKOKOL  -  ABDUL HADI"`. When the user clicked the input to edit, the autocomplete queried store records matching `"CIKOKOL  -  ABDUL HADI"`, found 0 results, and printed `Cabang tidak ditemukan`.

---

## 3. Implemented Correctives

### 3.1 Canonical Branch Service & API (`lib/branch-service.ts`, `app/api/branches/route.ts`)
- Defined the 28 authoritative branches (`BALI`, `BANDUNG`, `BANJARMASIN`, `BATAM`, `CIANJUR`, `CIKOKOL`, `CILACAP`, `CILEUNGSI_2`, `GORONTALO`, `JAMBI`, `JEMBER`, `KLATEN`, `LAMPUNG`, `LOMBOK`, `LUWU`, `MADIUN`, `MAKASSAR`, `MALANG`, `MANADO`, `MEDAN`, `PALEMBANG`, `PEKANBARU`, `PLUMBON`, `PONTIANAK`, `REMBANG`, `SEMARANG`, `SIDOARJO`, `TEGAL`).
- Handled legacy aliases (`G001` -> `CIKOKOL`, `G002` -> `BANDUNG`, `TE76` -> `CIKOKOL`).
- Created `/api/branches?q=...` returning canonical branch entities with store counts and aliases.

### 3.2 Edit User & Override Branch Selectors (`app/(siaga)/admin/users/page.tsx`, `components/admin/add-override-modal.tsx`)
- Changed label to `Cabang Penempatan *` with explanatory helper text: *"Pilih cabang organisasi penempatan pengguna (mencakup seluruh toko di bawah cabang ini)."*
- Uses `normalizeBranchCode()` upon modal open to resolve legacy store strings or aliases to canonical codes.
- Autocomplete searches `/api/branches`, displaying code, Indonesian branch name, store count, and aliases.
- Selected branch persists cleanly across saving and page refreshes.

### 3.3 Legacy Override Compliance Separation (`types/permission.ts`, `lib/permission-service.ts`, `components/admin/user-override-tab.tsx`)
- Implemented `evaluateOverridePolicyCompliance(override, user)` returning `policyCompliance` metadata.
- Distinguishes:
  - `ACTIVE_ALLOWED` (Effective ALLOW)
  - `ACTIVE_DENIED` (Effective DENY)
  - `POLICY_CONFLICT` (`Tidak Berlaku  -  Bertentangan dengan Kebijakan`  -  amber badge)
  - `EXPIRED` (`KADALUARSA`)
  - `REVOKED` (`DICABUT`)
- Displays an alert banner explaining that operational actions forbid `ALL_BRANCHES` due to branch isolation policy.
- Provides a direct `Cabut Pengaturan Tidak Sesuai` action for administrators to remediate safely.

### 3.4 Report Confirmation Workflow & Lifecycle Guards (`components/incident/maintenance-tracking-modal.tsx`, `components/reports/operational-report-center.tsx`, `app/api/incidents/[id]/estimation/route.ts`)
- Wired Step 2 (`KONFIRMASI_TOKO`) in `MaintenanceTrackingModal`:
  - When `canConfirm` is true: renders actionable button `Konfirmasi Kondisi Toko` opening `StoreVerificationModal`.
  - When `canConfirm` is false: renders lock notice explaining branch isolation (`"Konfirmasi terbatas untuk personil cabang pemilik laporan"`).
- In `operational-report-center.tsx`: table button renders `Review & Konfirmasi` for `pending_confirmation` reports.
- In `app/api/incidents/[id]/estimation/route.ts`: blocks estimation creation if report status is `pending_confirmation` (technical processing requires store confirmation first).

---

## 4. Test Matrix & Automated Verification

Automated suite `scripts/test-canonical-branch-and-legacy-overrides.ts`:
- **Section A: Canonical Branch Master & Store Association:** 11/11 tests PASS.
- **Section B: Legacy Override Compliance Evaluation:** 9/9 tests PASS.
- **Section C: Backend Operational Isolation & Persona Resolution:** 9/9 tests PASS.
- **Section D: Lifecycle Handoff (Tim Toko -> BMS -> BM Closure):** 4/4 tests PASS.
- **Total:** 33 / 33 tests PASSED (100%).

Existing regression suite `scripts/test-admin-permission-scopes.ts`:
- **Total:** 33 / 33 tests PASSED (100%).

Typecheck & Lint:
- `npx tsc --noEmit`: 0 errors (Code 0).
- `npm run lint`: 0 errors (Code 0).
