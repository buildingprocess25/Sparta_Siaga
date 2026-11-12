# SPARTA SIAGA: Documentation Repository & Central Index

Welcome to the official technical documentation repository for **SPARTA SIAGA** (`sparta-siaga`), the enterprise disaster monitoring, spatial intelligence, and multi-role incident management system for Alfamart (PT Sumber Alfaria Trijaya Tbk).

This repository is maintained on the `dev` branch and serves as the single source of truth for architectural specifications, operational business processes, quality assurance, development changelogs, and production deployment runbooks.

---

## 1. Documentation Authority & Supersession Rules

To prevent conflicting interpretations across development sprints, all documentation within `docs/` is classified into two distinct tiers:

1. **Active Canonical Documentation (Current Authority):**
   - Documents marked as **Active Canonical** reflect the current approved business requirements, role-based authorization model, and verified codebase implementation.
   - Any modification to business requirements must be updated here first and mirrored in the [Master Development Backlog (`task.md`)](file:///C:/Users/Noval/.gemini/antigravity/brain/08e053e4-f5c6-4f40-acce-7dcc9e771d5b/task.md).
   - Core Canonical Documents:
     - [`docs/02-business-process/BUSINESS_PROCESS_SPARTA_SIAGA.md`](file:///c:/buildingprocess25/sparta-siaga/docs/02-business-process/BUSINESS_PROCESS_SPARTA_SIAGA.md): Single Source of Truth for disaster detection and operational incident lifecycles.
     - [`docs/02-business-process/COMPLETE_BUSINESS_PROCESS_GUIDE_SPARTA_SIAGA.md`](file:///c:/buildingprocess25/sparta-siaga/docs/02-business-process/COMPLETE_BUSINESS_PROCESS_GUIDE_SPARTA_SIAGA.md): Detailed mathematical models, SOPs, and role responsibilities.
     - [`docs/03-qa-and-testing/QA_TEST_PLAN_SPARTA_SIAGA.md`](file:///c:/buildingprocess25/sparta-siaga/docs/03-qa-and-testing/QA_TEST_PLAN_SPARTA_SIAGA.md): Master Quality Assurance test catalog across Phases 1 through 4.
     - [`docs/03-qa-and-testing/SPARTA_SIAGA_MASTER_TODO.md`](file:///c:/buildingprocess25/sparta-siaga/docs/03-qa-and-testing/SPARTA_SIAGA_MASTER_TODO.md): Consolidated engineering milestone backlog.

2. **Historical & Milestone Documentation (Preserved Context):**
   - Documents marked as **Historical Milestone** record specific engineering sprints, pre-production hardening baselines, or early draft proposals.
   - These documents are preserved for architectural lineage and must not be treated as overriding canonical rules where superseded:
     - *Legacy Project Names:* Early blueprints referencing `sparta-maps` or `sparta-disaster` are superseded by the canonical module name **SPARTA SIAGA** (`sparta-siaga`).
     - *Legacy Role Concepts:* Earlier references to "Duty Officer DC" or "HO operational override" are superseded by the 8 canonical roles (BMS, BES, BBS, BMC, BEC, BBC, BnM Manajer, HO) and strict Zero Operational Bypass for System Admin and Head Office.
     - *Integration Status:* Proposed external API contracts with SPARTA Maintenance are currently implemented as an internal mock route (`lib/sparta-external-integration.ts`) pending live corporate ERP connectivity.

---

## 2. Development & Operational Environment

| Parameter | Specification | Purpose / Security Guard |
| :--- | :--- | :--- |
| **Active Git Branch** | `dev` | All active feature engineering, UAT, and documentation maintenance. |
| **Development URL** | `http://localhost:3004/` | Local Next.js 16 development runtime. |
| **Active Target Database** | Aiven Cloud PostgreSQL (`sparta_siaga_isolated`) | Dedicated isolated environment for dev, automated testing, and browser UAT. |
| **Production Database** | Biznet PostgreSQL (`siaga`) | **LOCKED & PROTECTED.** No migrations or writes permitted during development. |
| **Production Deployment** | Dokploy Container Infrastructure | **Phase 5 LOCKED.** Awaiting explicit stakeholder sign-off prior to cutover. |

---

## 3. Executive Roadmap & Quality Gate Status

The SPARTA SIAGA development lifecycle follows a strict dual-track governance model:
- **Automated Testing Track:** 100% verified across 146 unit, integration, and security regression checks (0 failures).
- **Interactive Browser UAT Track:** 100% verified across 18 real Playwright Chromium browser scenarios (18/18 pass) with visual evidence stored in [`docs/screenshots/uat-phase4/`](file:///c:/buildingprocess25/sparta-siaga/docs/screenshots/uat-phase4/).

```text
[ Phase 1: Business Rules & Lifecycle Hardening ] ──> VERIFIED (23/23 Pass)
                       │
[ Phase 2: Manual & Automatic Reporting Ingestion ] ──> VERIFIED (9/9 Pass)
                       │
[ Phase 3: HO Access & Auto Email Distribution ] ──> VERIFIED (22/22 Pass)
                       │
[ Aiven NIK & Multi-Role Authentication Matrix ] ──> VERIFIED (39/39 Pass)
                       │
[ Phase 4: E2E Business Flow & Browser UAT ] ──> VERIFIED (53/53 Auto Pass, 18/18 Browser Pass)
                       │
[ Phase 5: Production Deployment & Dokploy Migration ] ──> LOCKED (Pending Cutover Preflight)
```

---

## 4. Complete Document Directory Index

### Root Documentation
- [`docs/README.md`](file:///c:/buildingprocess25/sparta-siaga/docs/README.md): Master documentation repository index, authority hierarchy, and environment description.
- [`docs/API_DATA_SOURCES_SPARTA_SIAGA.md`](file:///c:/buildingprocess25/sparta-siaga/docs/API_DATA_SOURCES_SPARTA_SIAGA.md): Comprehensive catalog of external disaster and meteorological feeds (BMKG, USGS, Open-Meteo, RainViewer, PetaBencana).
- [`docs/PANDUAN_SIMULASI_ATASAN_1_DAN_2.md`](file:///c:/buildingprocess25/sparta-siaga/docs/PANDUAN_SIMULASI_ATASAN_1_DAN_2.md): Step-by-step UAT simulation guide for management and testers across Store and Specialized Facility lifecycles.

### Category 01: PRD and Specifications (`docs/01-prd-and-specs/`)
- [`docs/01-prd-and-specs/PRD_SPARTA_MAPS_DISASTER_MONITORING.md`](file:///c:/buildingprocess25/sparta-siaga/docs/01-prd-and-specs/PRD_SPARTA_MAPS_DISASTER_MONITORING.md): Founding architectural PRD and blueprint (Historical Milestone: Superseded by active business process).
- [`docs/01-prd-and-specs/PRODUCTION_AUTHORIZATION_INCIDENT_HANDLING_BLUEPRINT.md`](file:///c:/buildingprocess25/sparta-siaga/docs/01-prd-and-specs/PRODUCTION_AUTHORIZATION_INCIDENT_HANDLING_BLUEPRINT.md): Production security and RBAC specification (Historical Milestone: Superseded regarding HO override).
- [`docs/01-prd-and-specs/OPENAPI_INTEGRATIONS_V1.md`](file:///c:/buildingprocess25/sparta-siaga/docs/01-prd-and-specs/OPENAPI_INTEGRATIONS_V1.md): Machine-to-Machine REST integration specification for external maintenance systems (Status: Mock / Internal route).
- [`docs/01-prd-and-specs/SPARTA_SIAGA_EXPANSION_FEATURES.md`](file:///c:/buildingprocess25/sparta-siaga/docs/01-prd-and-specs/SPARTA_SIAGA_EXPANSION_FEATURES.md): Functional design for operational innovations (Quick SitRep WhatsApp, dynamic radius sliders, War Room TV mode).

### Category 02: Business Process & SOPs (`docs/02-business-process/`)
- [`docs/02-business-process/BUSINESS_PROCESS_SPARTA_SIAGA.md`](file:///c:/buildingprocess25/sparta-siaga/docs/02-business-process/BUSINESS_PROCESS_SPARTA_SIAGA.md): **Canonical Single Source of Truth** for end-to-end disaster monitoring, scientific seismic attenuation, and incident handling.
- [`docs/02-business-process/COMPLETE_BUSINESS_PROCESS_GUIDE_SPARTA_SIAGA.md`](file:///c:/buildingprocess25/sparta-siaga/docs/02-business-process/COMPLETE_BUSINESS_PROCESS_GUIDE_SPARTA_SIAGA.md): In-depth operational guide, mathematical formulas (Haversine, attenuation, rainfall thresholds), RACI matrix, and PDP compliance.

### Category 03: QA and Testing (`docs/03-qa-and-testing/`)
- [`docs/03-qa-and-testing/QA_TEST_PLAN_SPARTA_SIAGA.md`](file:///c:/buildingprocess25/sparta-siaga/docs/03-qa-and-testing/QA_TEST_PLAN_SPARTA_SIAGA.md): Comprehensive Master Quality Assurance Test Plan covering Phase 1 through Phase 4 regression matrices (164/164 total tests).
- [`docs/03-qa-and-testing/SPARTA_SIAGA_MASTER_TODO.md`](file:///c:/buildingprocess25/sparta-siaga/docs/03-qa-and-testing/SPARTA_SIAGA_MASTER_TODO.md): Consolidated engineering milestone backlog aligned with the 25-feature development spreadsheet.
- [`docs/03-qa-and-testing/TASK_6_FINAL_INTEGRATION_AUDIT_REPORT.md`](file:///c:/buildingprocess25/sparta-siaga/docs/03-qa-and-testing/TASK_6_FINAL_INTEGRATION_AUDIT_REPORT.md): Historical milestone audit report verifying 20 critical criteria (F1 to F20) for RBAC and governance.
- [`docs/03-qa-and-testing/TASK_7_PRODUCTION_HARDENING_REPORT.md`](file:///c:/buildingprocess25/sparta-siaga/docs/03-qa-and-testing/TASK_7_PRODUCTION_HARDENING_REPORT.md): Historical milestone report verifying 15 readiness gates (P1 to P15) for containerization and environment security.
- [`docs/03-qa-and-testing/EARTHQUAKE_FACILITY_INTEGRATION_REPORT.md`](file:///c:/buildingprocess25/sparta-siaga/docs/03-qa-and-testing/EARTHQUAKE_FACILITY_INTEGRATION_REPORT.md): Technical report on facility master ingestion (67 DC/warehouse records) and canonical earthquake reconciliation.

### Category 04: Progress and Changelogs (`docs/04-progress-and-changelog/`)
- [`docs/04-progress-and-changelog/PROGRESS_LOG_AND_CHANGELOG.md`](file:///c:/buildingprocess25/sparta-siaga/docs/04-progress-and-changelog/PROGRESS_LOG_AND_CHANGELOG.md): Authoritative chronological changelog capturing all technical revisions from v1.0.0 through v1.4.0.
- [`docs/04-progress-and-changelog/CANONICAL_BRANCH_SCOPE_AND_OVERRIDE_CORRECTIVE.md`](file:///c:/buildingprocess25/sparta-siaga/docs/04-progress-and-changelog/CANONICAL_BRANCH_SCOPE_AND_OVERRIDE_CORRECTIVE.md): Corrective documentation for the 28 canonical organizational branches and user permission overrides.
- [`docs/04-progress-and-changelog/NOTIFICATION_SCOPE_AND_CAMERA_DIAGNOSTICS.md`](file:///c:/buildingprocess25/sparta-siaga/docs/04-progress-and-changelog/NOTIFICATION_SCOPE_AND_CAMERA_DIAGNOSTICS.md): Architecture report separating Global Disaster Information from Branch-Scoped Incident Reports, plus camera diagnostic fixes.
- [`docs/04-progress-and-changelog/ADMIN_UX_VISUAL_ACCEPTANCE.md`](file:///c:/buildingprocess25/sparta-siaga/docs/04-progress-and-changelog/ADMIN_UX_VISUAL_ACCEPTANCE.md): Visual acceptance report for administrative override forms and scope segregation.
- [`docs/04-progress-and-changelog/DEVICE_PERMISSIONS_UX_CORRECTIVE.md`](file:///c:/buildingprocess25/sparta-siaga/docs/04-progress-and-changelog/DEVICE_PERMISSIONS_UX_CORRECTIVE.md): Corrective UX report for camera pre-permission gating and enterprise toast notifications.

### Category 05: Production Runbooks (`docs/05-production/`)
- [`docs/05-production/DOKPLOY_DEPLOYMENT_GUIDE.md`](file:///c:/buildingprocess25/sparta-siaga/docs/05-production/DOKPLOY_DEPLOYMENT_GUIDE.md): End-to-end guide for deploying containerized SPARTA SIAGA standalone builds on Dokploy with Traefik reverse proxy.
- [`docs/05-production/ENVIRONMENT_REQUIREMENTS.md`](file:///c:/buildingprocess25/sparta-siaga/docs/05-production/ENVIRONMENT_REQUIREMENTS.md): Detailed specification of system hardware, PostgreSQL extensions, and mandatory runtime environment secrets.
- [`docs/05-production/TASK_7_PRODUCTION_READINESS_CHECKLIST.md`](file:///c:/buildingprocess25/sparta-siaga/docs/05-production/TASK_7_PRODUCTION_READINESS_CHECKLIST.md): Operational readiness checklist tracking 16 hardening categories (Phase 5 cutover preflight pending authorization).
- [`docs/05-production/INFRASTRUCTURE_RISK_LIST.md`](file:///c:/buildingprocess25/sparta-siaga/docs/05-production/INFRASTRUCTURE_RISK_LIST.md): Infrastructure and operational risk register identifying blockers, assigned owners, and mitigation actions.
- [`docs/05-production/BACKUP_AND_RESTORE.md`](file:///c:/buildingprocess25/sparta-siaga/docs/05-production/BACKUP_AND_RESTORE.md): Operational runbook for quiesced, matched PostgreSQL and evidence storage backups with cryptographic SHA-256 manifests.
- [`docs/05-production/ROLLBACK_PROCEDURE.md`](file:///c:/buildingprocess25/sparta-siaga/docs/05-production/ROLLBACK_PROCEDURE.md): Standard operating procedure for fast container image rollbacks, secret recovery, and database restoration.

---

## 5. Canonical Role-Based Access Control (RBAC) Summary

The SPARTA SIAGA incident lifecycle is governed by 8 canonical human roles operating under strict branch isolation and Zero Operational Bypass:

1. **BMS (Building Maintenance Specialist - Toko):** Conducts mandatory field inspections of retail stores, uploads required photo evidence, records repair milestones (10% to 100%), and submits completion for coordinator review.
2. **BES (Building Maintenance Specialist - DC / Warehouse):** Conducts field inspections of distribution centers and warehouses, records facility repair milestones, and submits completion to BEC.
3. **BBS (Building Maintenance Specialist - Building / Office):** Conducts field inspections of corporate and branch office buildings, records civil repair milestones, and submits completion to BBC.
4. **BMC (Building Maintenance Coordinator - Toko):** Verifies store repair milestones and grants coordinator approval for store completions. Blocked from DC/Building approvals (403 `COORDINATOR_MISMATCH`).
5. **BEC (Building Maintenance Coordinator - DC):** Verifies DC/warehouse milestones and grants coordinator approval. Blocked from store/office approvals (403 `COORDINATOR_MISMATCH`).
6. **BBC (Building Maintenance Coordinator - Building):** Verifies office building milestones and grants coordinator approval. Blocked from store/DC approvals (403 `COORDINATOR_MISMATCH`).
7. **BnM Manajer (Branch Maintenance Manager):** Sole branch authority for initial damage confirmation (Ada Kerusakan, Tidak Ada Kerusakan, Perlu Klarifikasi), milestone approvals, and final official Case Close.
8. **HO (Head Office - `ho_admin`, `gm_ho`, `sm_ho`):** Strictly monitoring-only across all 28 branches. Receives automated approval notifications via outbox queue. Blocked with HTTP 403 Forbidden from creating incidents, submitting inspections, approving milestones, or closing cases.
9. **System Admin (`ADM0001`):** Technical administration and user provisioning only. Zero Operational Bypass enforced: Admin cannot approve or close field operations.
