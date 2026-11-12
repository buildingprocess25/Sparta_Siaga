# SPARTA SIAGA — AI AGENT INSTRUCTIONS

<!-- antislop:start -->

**## antislop**
For UI, copy, people, mobile layout, or code comments work, read these installed skill files directly (use these paths even if a same-named global skill exists):

- Core filter, always on: `antislop`: `.agents/skills/antislop/SKILL.md`
- UI / visual: `antislop-ui`: `.agents/skills/antislop-ui/SKILL.md`
- Copy & text: `antislop-copywriting`: `.agents/skills/antislop-copywriting/SKILL.md`
- People: `antislop-human`: `.agents/skills/antislop-human/SKILL.md`
- Mobile / responsive: `antislop-layoutmobile`: `.agents/skills/antislop-layoutmobile/SKILL.md`
- Code comments: `antislop-code`: `.agents/skills/antislop-code/SKILL.md`

Before starting, follow the core's "Two Usage Modes" section in strict order: explicit session instruction first, then global preference, then ask. A session instruction always wins. For a resolved mode, say `antislop active: <mode> (session override).` or `antislop active: <mode> (global preference).` once before presenting findings or making edits, using the actual mode and source. Acknowledging the user's request without naming the source does not replace this notice.

Only an explicit choice of antislop during or after selects a session mode. A request to review, audit, or avoid file edits does not select a mode; read the global preference in that case. Another skill's mode does not select antislop's mode.

If the mode is unresolved, ask during/after and end the response; wait for the answer before any UI review, planning, or concept. For read-only tasks, put the active-mode notice only at the start of the final answer, never in progress messages. For editing tasks, announce before the first edit and omit it from the final answer.

To update antislop later: `npx antislop-ai --update`, or run `npx antislop-ai` and pick Overwrite them.

<!-- antislop:end -->

---

# SPARTA SIAGA — MANDATORY DESIGN SYSTEM RULES

## 1. Global Design Reference

SPARTA Siaga uses a centralized design system.

Before creating, modifying, or refactoring any UI/UX, AI agents MUST:

1. Read `/design.md` from the project root.
2. Follow the documented global design principles.
3. Use existing shadcn/ui components wherever applicable.
4. Follow the approved typography, colors, spacing, sizing, borders, and component variants.
5. Preserve the existing SPARTA Siaga branding and functionality.
6. Inspect the current implementation before introducing new components.
7. Avoid introducing inconsistent visual patterns.

The local `design.md` is the primary source of truth for SPARTA Siaga UI/UX.

## 2. Global Visual Reference — SPARTA Maintenance

SPARTA Siaga must follow the global visual identity established by SPARTA Maintenance.

Reference repository:

https://github.com/buildingprocess25/sparta-maintenance

Canonical reference:

https://github.com/buildingprocess25/sparta-maintenance/blob/main/DESIGN.md

The reference provides the foundation for:

- Corporate color system.
- Typography and visual hierarchy.
- Component styling.
- Navigation patterns.
- Spacing and sizing.
- Card and container design.
- Form and input design.
- Responsive layout.
- Status indicators.
- Accessibility principles.

The global visual identity must remain consistent across the SPARTA ecosystem.

However, SPARTA Siaga and SPARTA Maintenance are separate applications with different business requirements.

Do not copy Maintenance workflows, database logic, routes, or permissions into SPARTA Siaga.

The Maintenance repository is a visual reference, not an implementation dependency.

Do not automatically overwrite approved local design rules when the reference repository changes.

## 3. UI Technology Standards

Use the project's existing frontend stack.

Preferred component foundation:

- shadcn/ui
- Tailwind CSS
- Lucide Icons
- Existing React/Next.js components

Always inspect the installed dependencies and current shadcn configuration before modifying UI components.

Prefer reusable components from `components/ui`.

Do not recreate components that already exist.

Do not introduce another UI component library without an explicit architectural reason.

Avoid manually rebuilding components that are already provided by shadcn/ui.

## 4. Design Consistency

All pages must follow the approved design system.

This includes:

- Dashboard.
- Peta Monitoring.
- Notifikasi.
- Laporan.
- Detail pages.
- Settings.
- Forms.
- Tables.
- Dialogs.
- Navigation.

Use shared design tokens instead of arbitrary colors and spacing values.

Do not introduce new typography, component styles, or layout conventions without justification.

Avoid excessive:

- Floating cards.
- Nested cards.
- Decorative gradients.
- Glassmorphism.
- Oversized shadows.
- Unnecessary animation.
- Inconsistent button styles.
- Unstructured layouts.

Prioritize clarity, information hierarchy, usability, and consistency.

## 5. Peta Monitoring — Specialized Design Rules

When creating, modifying, or refactoring Peta Monitoring, AI agents MUST also read:

`/docs/monitoring-map-design.md`

This document defines the specialized interface requirements for geospatial monitoring.

It covers:

- Map-centric layout.
- Monitoring toolbar.
- Mode navigation.
- Kejadian / Toko / DC.
- Contextual layer selection.
- Floating controls.
- Map markers and clusters.
- Dynamic legends.
- Location detail panels.
- Fullscreen behavior.
- Responsive monitoring interface.
- Map interaction patterns.

The global `design.md` defines visual identity and shared components.

The `monitoring-map-design.md` defines map-specific behavior and layout.

Both documents must be followed.

If a map-specific requirement differs from a generic layout pattern, use the specialized rule while preserving the global visual language.

## 6. UI/UX Implementation Workflow

Before making UI changes:

1. Resolve and apply the required antislop mode.
2. Read the applicable antislop skill files.
3. Read `/design.md`.
4. Read any relevant page-specific design document.
5. Audit the existing source code and components.
6. Identify the necessary design and interaction changes.
7. Reuse existing components where appropriate.
8. Implement changes without breaking business logic.
9. Validate visual consistency and responsive behavior.
10. Run relevant checks and tests.

Do not treat a successful TypeScript build as proof that the UI is visually correct.

Perform actual UI verification whenever the development environment supports it.

## 7. Design Documentation Governance

Design documentation is maintained intentionally.

AI agents MUST NOT:

- Modify `design.md` merely to justify generated UI.
- Silently replace approved design conventions.
- Automatically copy new changes from SPARTA Maintenance.
- Change unrelated pages during a targeted UI task.
- Introduce new design patterns without documenting the reason.
- Ignore specialized page design specifications.

If a design change requires updating the approved standards, explain the proposed change and obtain approval before updating the design documentation.

Changes to implementation should follow the design documents, not the other way around.

## 8. Business Logic Protection

Visual refactoring must not change established business rules unless explicitly requested.

Preserve:

- Existing authentication and authorization.
- Monitoring data sources.
- BMKG integration.
- SPARTA Maintenance read-only integration.
- Notification workflows.
- Reporting workflows.
- Existing database schemas.
- Existing API behavior.
- User and branch access restrictions.

Do not modify backend systems simply to accommodate a visual redesign unless technically necessary and authorized.

## 9. Final UI Quality Checklist

Before reporting UI work as complete, verify:

- The applicable design documents were followed.
- Existing shadcn/ui components were reused appropriately.
- Colors and typography match approved tokens.
- Spacing and alignment are consistent.
- Layout works on supported screen sizes.
- Interactive controls function correctly.
- Loading, empty, and error states are handled.
- Accessibility basics are preserved.
- Existing features still work.
- Changes outside the requested scope are identified.
- Actual verification results are reported accurately.

Do not claim completion without verification.

## 10. Instruction Priority

The antislop instructions remain active and must not be removed.

The design documents provide the visual and interaction standards.

Page-specific design specifications provide additional requirements.

If instructions conflict, follow higher-priority project or user instructions and report material conflicts rather than silently inventing a new standard.
