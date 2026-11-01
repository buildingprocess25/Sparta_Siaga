# Earthquake and Facility Integration Report

Date: 2026-10-14

## Existing audit

The repository already contained server-side earthquake ingestion, canonical event storage, radius evaluation for stores, automatic store reports, branch authorization, inspection and private evidence workflows, milestones, approvals, notification logs, Leaflet monitoring, and PWA assets. The implementation extended these paths instead of introducing another report lifecycle.

The previous automatic-report constraint covered only automatic store reports. It did not protect manual-first reconciliation or typed facility locations. Incident storage also required a legacy store ID and store name.

## Implemented changes

- Added permanent facility master, import runs, and facility audit history.
- Added typed incident identity and event/location snapshots without dummy store rows.
- Made legacy store fields nullable only where facility reports require it; existing store columns and records remain intact.
- Added generic unique earthquake identity `(canonical_event_id, location_kind, location_id)`.
- Added source-event provenance, reconciliation cases, atomic PIC history, and verified repair links.
- Added a guarded Excel adapter, preview/apply importer, and isolated migration runner.
- Tightened cross-provider correlation and prevented same-provider heuristic merging of aftershocks.
- Added non-destructive manual-first reconciliation under an advisory transaction lock.
- Extended the worker to evaluate active, mapped facilities and create facility reports without browser/PWA dependency.
- Added event/branch/recipient-group notification summaries with update-on-retry behavior.
- Added server-scoped facility admin, shared queue, PIC claim, and repair-link endpoints.
- Added responsive Admin Master Fasilitas with loading, error, empty, mapping, and activation states.
- Added coordinate editing and a guarded Excel preview/apply action to Master Fasilitas.
- Added Shared Queue operator screen with waiting age and atomic PIC claim.
- Added PIC detail/history plus transfer and release APIs with branch and role enforcement.
- Added an Admin reconciliation review screen with explicit link/dismiss decisions; linking uses row and advisory locks and records before/after identities.
- Added repair-link removal and append-only link/unlink audit history.
- Aligned the application shell, operational tables, compact actions, sidebar/header colors, and mobile navigation order with the supplied SPARTA Maintenance reference.
- Added scoped facility map feed, Mode Kejadian as the default, Mode Lokasi, and distinct facility markers.

## Database migrations

- `005_earthquake_facility_integration.sql`
- `006_facility_incident_nullable_legacy_fields.sql`
- `007_notification_event_summary.sql`
- `008_phase2_operational_audit.sql`

All four migrations were applied to `sparta_siaga_isolated`. Every migration contains an active-database guard. Import and test scripts independently validate the configured URL and `SELECT current_database()` before writes.

## Data verification

| Metric | Result |
|---|---:|
| Excel rows | 67 |
| Imported | 67 |
| Invalid | 0 |
| DC | 28 |
| Warehouse | 13 |
| Depo | 9 |
| Bulky | 5 |
| Store Hub | 12 |
| Verified branch mappings | 0 |
| Auto-report enabled | 0 |

The second apply reported 0 new, 0 changed, and 67 unchanged. WH BALARAJA1 (`KY10`) and WH BALARAJA2 (`KY11`) remain separate records with the same coordinates.

No branch was inferred from a name, code, city, or coordinate. Therefore imported facilities remain unmapped and auto-report is disabled until Admin verifies their ownership.

## Test evidence

| Verification | Result |
|---|---|
| Facility parser, categories, validation, shared coordinates, DB guard | PASS |
| Additive schema/static safety assertions | PASS |
| Conservative correlation and aftershock separation | PASS |
| Manual-first preservation, replay, concurrent creation | PASS |
| Notification summary retry/update | PASS |
| Atomic PIC concurrency and audit entry | PASS |
| Imported database counts and idempotency | PASS |
| Existing earthquake automation suite | PASS 18/18 |
| TypeScript `tsc --noEmit` | PASS |
| Next.js production build | PASS |
| ESLint | PASS with 389 pre-existing warnings and 0 errors |
| PWA HTTP/runtime audit | PASS 13/13 |
| Independent visual browser regression | PASS (Phase 4 Browser UAT) - 17 Playwright Chromium scenarios verified with screenshots |

The first run of the existing automation suite exposed a compatibility gap: legacy `dbCreateIncident` did not populate typed location identity, allowing concurrent inserts around the new constraint. The insert adapter now derives `canonical_event_id`, `STORE`, and `location_id`; the rerun passed 18/18.

The HTTP PWA audit ran against the local application and passed all 13 manifest, icon, service-worker, offline-page, and metadata checks. Automated screenshot/interaction regression was not run because no independent browser CLI is installed, while the available Next.js-specific browser workflow requires Next.js 16.3 or newer. Next.js was deliberately not upgraded.

## Remaining work

- Admin must supply and verify branch mappings before any facility can be activated for automatic reports.
- Google Sheets synchronization remains an adapter boundary only; credentials and Sheet identity were not provided.
- Repair linking and unlinking have protected audited endpoints but do not yet have a dedicated operator screen.
- Peta Monitoring has both required modes and facility markers; facility-specific filters, viewport query loading, and the dedicated mobile facility detail bottom sheet remain to be implemented.
- Dashboard cards and lists have not yet been extended with facility/PIC/waiting-age views.
- Facility audit is available through the protected API, but its timeline is not yet rendered in the Master Fasilitas screen.
- Transfer/release PIC endpoints and history are implemented; the Shared Queue UI currently exposes claim only.
- Several legacy pages still require a visual-density pass to fully match the reference; the shared shell, navigation, reconciliation table, and new admin workflows have been aligned first.
- Full authenticated interaction E2E and mobile viewport screenshots remain pending. PWA installability HTTP checks are complete.

## Database safety

Migration, import, and integration-test writes targeted `sparta_siaga_isolated` only. `defaultdb` was not modified. Test records used namespaced IDs and were removed by their test cleanup blocks. No credentials are included in this report.
