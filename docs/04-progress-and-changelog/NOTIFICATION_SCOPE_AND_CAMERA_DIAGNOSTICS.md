# SPARTA SIAGA  -  NOTIFICATION SCOPE CORRECTION & CAMERA ACCESS DIAGNOSTICS REPORT

**Date:** 2026-10-08  
**Branch:** `development`  
**Priority:** HIGH  
**Scope:** Disaster Notifications, Incident Visibility Isolation, Camera Permission Diagnostics

---

## 1. Executive Summary

This report documents the architectural separation between **Global Disaster Information** and **Branch-Scoped Operational Incident Reports**, alongside the empirical diagnosis and resolution of the persistent camera access denial in SPARTA SIAGA.

### Key Corrections Delivered:
1. **Global Disaster Information Scope:** Corrected `resolveNotificationReadScope` in `lib/notification-access.ts` and UI filtering in `components/notifications/notification-center-sheet.tsx` and `app/(siaga)/layout.tsx` so disaster notifications are available as pure informational alerts to all authenticated SPARTA SIAGA users across all branches and roles, without leaking operational incident details or breaking branch isolation.
2. **Strict Incident Report Isolation Preserved:** Operational incident reports remain protected by `canViewReport`, `canViewReportAsync`, and `checkMutationAuthorization`. Branch Cikokol users can only access Cikokol reports; Branch Manado users cannot access protected Cikokol records; System Admin has technical monitoring capability but no operational mutation rights.
3. **Camera Root Cause Diagnosed & Resolved:** Discovered that `next.config.mjs` was broadcasting `Permissions-Policy: camera=(), microphone=(), geolocation=()`, causing modern browsers to unconditionally reject all `getUserMedia()` calls with `NotAllowedError` / `SecurityError`. Corrected to `camera=(self), microphone=(), geolocation=(self)`. In addition, implemented a resilient constraint fallback (`facingMode: { ideal: "user" }` -> `video: true`), robust error classification, and an interactive diagnostic test panel in the Settings page.

---

## 2. Notification Architecture Audit & Three Types Separation

| Notification Category | Purpose & Characteristics | Recipients & Scope | Persistence & Delivery | Operational Authority |
|---|---|---|---|---|
| **1. Global Disaster Information** | Pure informational awareness (e.g., BMKG earthquakes, extreme rain/floods). | Available to **ALL authenticated users** (HO, System Admin, Branch Cikokol, Branch Manado, etc.). | Persisted in `notification_logs`, desktop popups, Notification Center sheet. | **None.** No approval, confirmation, or report mutation granted. |
| **2. Incident Workflow Notifications** | Associated with specific operational incident lifecycle (investigations, progress, handovers). | Distributed strictly to authorized operational roles for that branch (e.g., Branch Manager, BMS, Tim Toko). | Handled via `report_distributions`, `report_instructions`, and operational ticket logs. | **Strictly Branch-Scoped.** Cross-branch access denied (403). |
| **3. UI Action Feedback** | Ephemeral user interaction feedback (Save, Update, Delete, Error). | Current interactive user session only. | Local `sonner` toast notifications. Never persisted in DB. | Local UI only. |

---

## 3. Incident Reports Branch Scoping (Preserved Model)

- **Branch Isolation:** Cikokol operational reports remain visible only to Cikokol personnel (`canViewReport` checks `user.branch === report.branch`). Manado users receive 403 Forbidden on Cikokol records.
- **Head Office Oversight:** HO personas (`ho_admin`, `gm_ho`, `sm_ho`) retain read-only nationwide monitoring rights.
- **System Admin Authority:** Technical administration authority only (`MANAGE_USERS`, `MANAGE_ROLES`, `MANAGE_PERMISSIONS`). System Admin is strictly prohibited from mutating operational incident status.
- **Closed Reports:** Retain immutable protection and audit trails.

---

## 4. Camera Access Diagnostics Findings

### 4.1 Root Cause Identified
In commit `e114970`, a hardening header was introduced in `next.config.mjs`:
```javascript
{ key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' }
```
In W3C Permissions Policy specifications, `camera=()` defines an **empty allowlist**, instructing the browser engine to disallow all camera access across the entire origin. Any call to `navigator.mediaDevices.getUserMedia()` was immediately rejected with `NotAllowedError` before the browser ever presented a user prompt.

### 4.2 Fix Implemented
Updated `next.config.mjs`:
```javascript
{ key: 'Permissions-Policy', value: 'camera=(self), microphone=(), geolocation=(self)' }
```
This permits top-level SPARTA SIAGA pages on the origin (`self`) to access camera and geolocation hardware while keeping microphone disabled.

### 4.3 Fallback Constraints & Diagnostics Hardening
1. **Constraint Resilience (`components/incident/camera-capture.tsx`):**
   - Laptops and PCs often lack environment-facing cameras. The component now requests `{ video: { facingMode: { ideal: "environment" } } }` with automatic fallback to `{ video: true }` if `OverconstrainedError` or `NotFoundError` is returned.
2. **Context Checking:** Explicitly checks `window.isSecureContext` (HTTPS or localhost) before requesting `getUserMedia` to provide immediate actionable guidance if accessed over plain HTTP on LAN.
3. **Interactive Diagnostics Panel (`app/(siaga)/settings/page.tsx`):**
   - "Uji Kamera" runs device enumeration (`enumerateDevices`), tests `getUserMedia`, displays live camera feed, and maps all errors (`NotAllowedError`, `NotFoundError`, `NotReadableError`, `SecurityError`) to clear, step-by-step remediation advice (including Windows OS Camera Privacy toggles).

---

### 4.4 Operational Camera Preview & Shutter Corrective (`components/incident/camera-capture.tsx`)
1. **Root Cause of Blank Live Preview:**
   - `<video ref={videoRef} ... />` was conditionally rendered only when `permissionState === 'GRANTED'`.
   - When `startCamera()` initiated, `permissionState` was `'REQUESTING'`, meaning the `<video>` element was not yet in the DOM (`videoRef.current === null`).
   - `videoRef.current.srcObject = mediaStream` silently failed. When `permissionState` changed to `'GRANTED'`, `<video>` mounted with `srcObject = null`, rendering a blank black element.
   - **Resolution:** `<video ref={videoRef} autoPlay playsInline muted ... />` is now persistently mounted in the DOM. A `useEffect([stream])` reliably attaches `video.srcObject = stream` and triggers `video.play()` with `muted = true` (complying with browser autoplay security policies).
2. **Root Cause of Nonfunctional Shutter:**
   - Shutter was active before video dimensions loaded, attempting to draw `videoWidth = 0` and `videoHeight = 0` onto the canvas, producing empty/corrupted blobs.
   - **Resolution:** Added `isVideoReady` gate tracking `onLoadedMetadata`, `onPlaying`, and `readyState >= 2`. Shutter is disabled until valid dimensions (>0) are acquired.
3. **Photo Review & Retake Workflow:**
   - Introduced a dedicated `REVIEW` state post-capture.
   - Displays full-screen captured preview with official SPARTA watermark.
   - Provides **"Foto Ulang"** (Retake) to revoke temporary blob URLs and resume live feed without remounting the camera.
   - Provides **"Gunakan Foto"** to attach the final `File` to parent form state (`FieldPhotoUploader` or `ProgressUpdateModal`) and cleanly stop camera tracks.

## 5. Verification Matrix & Test Results

### 5.1 Persona Matrix Verification (`scripts/test-notification-and-report-personas.ts`)
Verified across all 7 representative personas:
1. `HO Admin`
2. `GM HO`
3. `Manager Branch Cikokol`
4. `Tim Toko Cikokol`
5. `BMS Cikokol`
6. `Branch user Manado`
7. `System Admin`

**Results:**
- **Global Disaster Visibility:** PASS (35/35 checks passed). All 7 personas receive global disaster notifications across all branches.
- **Branch Report Isolation:** PASS. Cikokol personnel access Cikokol reports and are denied Manado reports; Manado personnel access Manado reports and are denied Cikokol reports.
- **HO Oversight:** PASS. HO users monitor reports nationwide.
- **Admin & Cross-Branch Denial:** PASS. System Admin and cross-branch actors are denied operational mutations (403).

### 5.2 Notification Branch Isolation Suite (`scripts/test-notification-branch-isolation.ts`)
- **Result:** 12/12 PASSED.
- Confirms global disaster notifications retrieval, optional branch query filtering, and 403 on notification mutation attempts.

### 5.3 Camera & Evidence Workflow Suite (`scripts/test-camera-and-evidence-workflow.ts`)
- **Result:** 9/9 PASSED.
- Confirms valid JPEG File output, non-empty byte buffer, watermark overlay contract, retake cancellation, and authorized evidence attachment.

### 5.4 Regression & Build Verification
- **TypeScript Check (`npx tsc --noEmit`):** PASS (0 errors).
- **ESLint (`npm run lint`):** PASS (0 errors).
- **Task 7 Readiness Suite (`scripts/test-production-readiness-task7.ts`):** PASS (15/15 passed).
- **Refined Permissions Suite (`scripts/test-refined-permissions.ts`):** PASS (10/10 passed).
- **Production Build (`npm run build`):** PASS (All 28 routes compiled successfully).
