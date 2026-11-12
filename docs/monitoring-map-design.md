# SPARTA Siaga — Peta Monitoring Design Specification

> **Status:** Design Specification — Revised 12 November 2026.
>
> **Global reference:** Read together with root `design.md` and `AGENTS.md`.
>
> **Component and layout reference:** SPARTA Maintenance — https://github.com/buildingprocess25/sparta-maintenance
>
> **Visual identity:** SPARTA Siaga.
>
> **Design principle:** Corporate Geospatial Monitoring Workspace — map-first, contextual, compact, and operational.

---

## 1. Scope and Design Philosophy

This document defines the UI/UX and interaction standards for **Peta Monitoring SPARTA Siaga**.

The purpose is to create a consistent, functional, and visually structured geospatial monitoring experience.

The redesign may restructure frontend components, layouts, marker presentation, and user interactions without rewriting existing business rules.

Preserve:

- BMKG integration.
- Earthquake and disaster monitoring.
- Incident and event monitoring.
- Store master data.
- Distribution Center data.
- AHO integration with SPARTA Maintenance.
- Reporting workflows.
- Notification workflows.
- Authentication and authorization.
- Database schemas and API business rules.

### 1.1 Global Design Relationship

**SPARTA Maintenance is a reference for component architecture and layout composition, not the source of SPARTA Siaga's visual identity.**

Adopt from SPARTA Maintenance:

- Proper implementation of shadcn/ui components.
- Component composition.
- Navigation patterns where appropriate.
- Layout organization.
- Form and panel structures.
- Spacing discipline.
- Responsive design practices.
- Reusable UI architecture.

Do not automatically copy:

- Primary colors.
- Sidebar colors.
- Background colors.
- Typography decisions.
- Global CSS variables.
- Branding assets.
- Product-specific styling.

**SPARTA Siaga must retain its own visual identity.**

The root `design.md` defines the approved global Siaga style.

### 1.2 Visual Philosophy

Peta Monitoring must be:

- Map-first.
- Visually clean.
- Information-focused.
- Corporate and professional.
- Consistent with SPARTA Siaga.
- Contextual to the selected monitoring mode.
- Accessible and responsive.

Avoid excessive decoration, visual clutter, overlapping panels, oversized markers, and unnecessary interface duplication.

---

## 2. Desktop Workspace Layout

| Region             | Purpose                                                      | Design Rule                |
| ------------------ | ------------------------------------------------------------ | -------------------------- |
| Workspace Header   | Title, mode navigation, search, fullscreen, relevant actions | Compact and consistent     |
| Left Control Rail  | Contextual filters, layers, basemap, overlays                | Collapsible and mode-aware |
| Map Canvas         | Primary geospatial workspace                                 | Maximum available space    |
| Contextual Legend  | Explains active map symbols                                  | Conditional and zoom-aware |
| Right Detail Panel | Selected event, store, branch, cluster, or DC                | Closed by default          |
| Map Controls       | Zoom, reset, navigation                                      | Compact and accessible     |

### 2.1 Header

Use existing shadcn/ui components where appropriate.

The header must:

- Remain compact.
- Follow SPARTA Siaga's branding.
- Avoid duplicated actions.
- Provide clear mode navigation.
- Keep the map as the visual priority.

### 2.2 Left Control Rail

The control rail contains only controls relevant to the current mode.

It must:

- Support collapse/expand.
- Use clear grouping.
- Avoid unnecessary nested cards.
- Use actual shadcn/ui components.
- Preserve sufficient map space.
- Work responsively.

### 2.3 Right Detail Panel

A right-side panel displays information about selected locations.

The panel must not be permanently visible when no feature is selected.

Avoid showing the same detailed information simultaneously in a large Leaflet popup and the right panel.

### 2.4 Map Canvas

The Leaflet map remains the primary workspace.

Do not cover important geographic information with oversized cards or controls.

All overlay elements must follow a consistent positioning and stacking system.

---

## 3. Mode-Aware Controls

Peta Monitoring has three primary modes:

1. Kejadian.
2. Toko.
3. DC.

### 3.1 Kejadian

Display existing incident and disaster monitoring functionality.

Use existing relevant layers such as:

- Semua.
- Gempa.
- Banjir.
- Toko, if supported by the existing incident view.

Earthquake period controls appear only when relevant.

**AHO must not appear as an available layer in Kejadian mode.**

### 3.2 Toko

Provide:

- Standar.
- Tiket AHO.

Store search and filters must remain functional.

AHO-specific markers and legend are available only when the AHO sublayer is selected.

### 3.3 DC

Display Distribution Center locations and existing relevant controls.

AHO is not available in DC mode.

### 3.4 State Synchronization

The application must maintain a consistent relationship between:

- Active mode.
- Active layer.
- Selected location.
- Filter state.
- Map center.
- Map zoom.
- Legend.
- Detail panel.

When switching modes:

- Normalize invalid layer selections.
- Remove stale markers.
- Remove irrelevant legends.
- Close invalid detail panels.
- Preserve center and zoom unless explicitly reset.

Do not rely on CSS hiding alone to resolve invalid mode/layer combinations.

---

# 4. Geospatial Marker Design System

## 4.1 Fundamental Rule

**Cabang, Cluster, Toko, and Distribution Center must not use the same marker silhouette.**

Each marker represents a different geographic or operational meaning.

Changing only colors, sizes, or text is insufficient.

Markers must be differentiated through:

- Shape.
- Iconography.
- Information density.
- Visual hierarchy.
- Interaction behavior.
- Geographic meaning.

The four marker families are:

| Type    | Visual Identity          | Geographic Meaning        |
| ------- | ------------------------ | ------------------------- |
| Cabang  | Anchored flag/label      | Branch aggregation        |
| Cluster | Circular aggregate/donut | Group of nearby locations |
| Toko    | Individual location pin  | Exact store               |
| DC      | Facility symbol          | Distribution Center       |

Do not implement every type using generic pill badges.

---

# 5. Marker Cabang — Branch Aggregation

## 5.1 Appearance

Use an **anchored flag-style marker**.

The marker consists of:

1. Geographic anchor or pointer.
2. Compact horizontal information label.
3. Branch name.
4. Relevant metric.

Unlike the previous floating pill design, the new marker must visually connect to a geographic position.

Recommended presentation:

**Standard Store Layer**

`[Branch Anchor] MEDAN | 784 Toko`

**AHO Layer**

`[Branch Anchor] MEDAN | 38%`

The examples represent information hierarchy, not literal component markup.

## 5.2 Visual Styling

- Use SPARTA Siaga theme tokens.
- Prefer solid surfaces over decorative glass effects.
- Use subtle borders.
- Avoid large outer glow.
- Keep height approximately 28–34 px.
- Allow width to follow content within a controlled maximum.
- Use consistent typography.
- Use tabular numbers for metrics.
- Keep geographic anchor visually distinct.

The branch label should not appear as a detached floating card.

## 5.3 Standard Branch Marker

Display:

- Branch name.
- Total stores.

Do not use AHO percentage colors when the Standard Store layer is selected.

Use the standard geographic/facility styling approved for Siaga.

## 5.4 AHO Branch Marker

Display:

- Branch name.
- Percentage of stores with active tickets.
- AHO category indicator.

The percentage must be calculated from actual data.

Example:

- Total stores: 784.
- Stores with active AHO tickets: 294.
- Percentage: approximately 37.5%.

A compact marker may display `38%`.

Detailed numerator and denominator information must remain accessible on interaction.

## 5.5 Interaction

**Hover:**

Display a compact tooltip containing relevant branch information.

**Click:**

Open the right detail panel with:

- Branch name.
- Total stores.
- Stores with active tickets.
- AHO percentage, where applicable.

Zoom interaction may be offered, but must not replace access to the aggregate information.

## 5.6 Zoom

Branch aggregation applies to AHO at:

**Zoom ≤ 7**

Preserve the branch aggregation business logic.

---

# 6. Marker Cluster — Geographic Aggregation

## 6.1 Appearance

Use a **circular aggregate marker**.

A cluster must look visually different from a branch.

Recommended design:

- Circular center.
- Numeric label.
- Optional ring representing AHO percentage.
- Small and consistent size.

Do not use a horizontal branch flag for clusters.

## 6.2 Standard Store Cluster

Display the number of stores in the geographic group.

Example:

`24`

The tooltip identifies the number as stores.

## 6.3 AHO Cluster

Display:

- Total stores as the primary count.
- A percentage ring or clearly separated category indicator.
- AHO percentage in tooltip/detail.

The ring can use the corresponding AHO color category.

**Important:** A color-coded ring must not imply a proportional progress ring unless the arc length is actually calculated from the percentage.

If a proportional donut is implemented, its geometry must accurately represent:

`Stores with active tickets / Total stores in cluster`

Do not use a decorative donut that suggests inaccurate numerical proportions.

## 6.4 Size and Styling

Recommended diameter:

- Compact: 36–40 px.
- Default: 40–44 px.
- Selected: slightly larger through border/focus treatment.

Avoid excessive animations.

Use readable foreground/background contrast across Dark, Light, and OSM basemaps.

## 6.5 Interaction

**Hover:**

Display:

- Total stores.
- Stores with active AHO tickets if applicable.
- Percentage if applicable.

**Click:**

Provide access to cluster summary.

Zoom-in may be offered as a secondary action.

Do not represent mixed-branch clusters as a single branch.

## 6.6 Zoom

AHO geographic clusters apply at:

**Zoom 8–12**

Preserve the existing geographic clustering calculations and location membership.

---

# 7. Marker Toko — Individual Store

## 7.1 Appearance

Use a **small geographic location pin**.

The store marker must be visually lighter than branch aggregation labels.

Recommended characteristics:

- Teardrop/pin silhouette.
- Distinct geographic point.
- Small center symbol if useful.
- No permanent full store name label.
- Clear hover and selected states.

Do not use large rectangular cards or horizontal branch-style pills for individual stores.

## 7.2 Recommended Sizing

- Default pin: approximately 22–26 px.
- Selected pin: approximately 28–32 px.
- Use a subtle outline to preserve visibility over the map.

Sizes are design targets and may be adjusted after real-map visual testing.

## 7.3 Standard Store Layer

Use the Siaga standard store marker styling.

Do not assign AHO ticket colors unless the AHO layer is actually active.

## 7.4 AHO Individual Store Layer

Individual store AHO status has exactly three meaningful display states:

| State               | Color           | Meaning                               |
| ------------------- | --------------- | ------------------------------------- |
| Has active ticket   | Red `#dc2626`   | One or more active AHO tickets        |
| No active ticket    | Green `#16a34a` | Confirmed no active tickets           |
| Unknown/unavailable | Neutral gray    | Data unavailable or not yet confirmed |

Do not use four aggregate percentage colors for individual stores.

Do not paint stores green when the Maintenance query fails.

## 7.5 Interaction

**Hover:**

Show a compact tooltip:

- Store name or code.
- Active ticket count when available.

**Click:**

Open the right detail panel.

Do not display a second large popup containing duplicate information.

## 7.6 Zoom

AHO individual stores are displayed at:

**Zoom ≥ 13**

---

# 8. Distribution Center Marker Design

## 8.1 Purpose

Distribution Centers are operational facilities.

Their markers must communicate facility identity rather than appearing as generic circles with `DC` text.

## 8.2 Appearance

Use a **facility marker** with:

- Rounded-square or facility-oriented silhouette.
- Warehouse/building icon.
- Geographic anchor where necessary.
- Siaga-specific facility color.
- Subtle border.
- Clear selected state.

Recommended icon: Lucide `warehouse` or an equivalent icon already available in the project.

The facility icon must remain readable at normal map scale.

## 8.3 Visual Restrictions

Avoid:

- Neon purple styling.
- Heavy glow.
- Multiple concentric decorative rings.
- Oversized `DC` text.
- Repeated decorative dots.
- Unnecessary shadows.

Do not create a competing brand color system for DC.

Use approved SPARTA Siaga tokens.

## 8.4 Size

Recommended default marker:

Approximately 30–36 px.

Selected state may increase size slightly or use a stronger outline.

## 8.5 Information Display

At lower zoom:

- Show compact facility markers.
- Avoid permanent long labels.

At higher zoom:

- Display facility name/code when space allows.
- Preserve readable geographic context.

## 8.6 Interaction

**Hover:**

Display short facility identity.

**Click:**

Open the right detail panel with the actual DC information available in SPARTA Siaga.

Preserve all existing DC business rules and mapping-status information.

## 8.7 Density Handling

Nearby DC markers must remain individually accessible.

If geographic overlap occurs, use an appropriate interaction or clustering strategy without inventing facilities or altering their coordinates.

Do not display duplicate markers for the same facility unless they represent documented separate data.

---

# 9. AHO Color System

## 9.1 Color Categories

Restore the clearly differentiated four-color AHO palette.

| Percentage | Category      | Color  | Hex       |
| ---------- | ------------- | ------ | --------- |
| >70%       | Tinggi        | Red    | `#dc2626` |
| 50–70%     | Sedang        | Orange | `#f97316` |
| 20–<50%    | Rendah        | Yellow | `#facc15` |
| <20%       | Sangat Rendah | Green  | `#16a34a` |

The visual order must follow descending percentage:

**Red → Orange → Yellow → Green**

Do not use visually similar dark orange and ochre tones that make the middle categories difficult to distinguish.

## 9.2 Boundary Rules

Use the raw percentage before rounding for category determination.

Examples:

- 19.99% → Green.
- 20.00% → Yellow.
- 49.99% → Yellow.
- 50.00% → Orange.
- 70.00% → Orange.
- 70.01% → Red.

## 9.3 Contrast

The category color must remain recognizable on Dark, Light, and OSM basemaps.

Use neutral surface and contrasting text if necessary.

Colors can be applied to:

- Category indicator.
- Marker ring.
- Badge background.
- Pin fill.

Do not change the actual category color definitions without updating the approved design specification.

## 9.4 Semantics

AHO percentage represents:

**Percentage of stores with one or more active tickets.**

It does not represent:

- Earthquake intensity.
- Disaster risk.
- Physical damage severity.
- Maintenance urgency.
- Number of tickets divided by total stores.

Keep those interpretations separate.

---

# 10. Marker Overlap and Geographic Density

## 10.1 Primary Problem

Some geographic areas, especially Java, contain dense branches, stores, and facilities.

Permanent text labels can overlap, causing unreadable maps.

This must be treated as a geographic visualization problem, not merely a CSS styling problem.

## 10.2 Required Handling

Implement an appropriate label-collision strategy.

Possible approaches include:

- Viewport-aware label placement.
- Priority-based label visibility.
- Temporary expansion on hover.
- Interactive grouped-location selection.
- Zoom-based label detail.
- Marker stacking priority.

## 10.3 Data Integrity

Visual decluttering must never:

- Delete underlying locations.
- Change aggregate calculations.
- Modify store coordinates.
- Change ticket counts.
- Distort branch denominators.
- Hide data permanently from user access.

If labels cannot all be displayed simultaneously, users must still be able to access every represented location through interaction.

## 10.4 Leaflet Compatibility

Ensure marker layout remains anchored to actual coordinates.

If custom HTML markers are used, verify:

- Correct geographic anchor.
- Proper z-index.
- Click/hover behavior.
- Correct resize behavior.
- Stable rendering while zooming and panning.

---

# 11. Contextual AHO Legend Design

## 11.1 General Principles

AHO legend must be:

- Compact.
- Contextual.
- Easy to scan.
- Consistent with SPARTA Siaga.
- Accessible.
- Collapsible.
- Zoom-aware.

Avoid oversized dark cards with excessive borders, tags, and small descriptive text.

Do not visually prioritize the data source badge over the legend itself.

## 11.2 Visibility

Render AHO legend only if:

`locationMode === "store" && activeLayer === "aho"`

The legend must disappear when AHO is no longer active.

## 11.3 Branch and Cluster Legend

At zoom ≤12, display four categories:

**Persentase Toko Bertiket**

- Red — >70%.
- Orange — 50–70%.
- Yellow — 20–<50%.
- Green — <20%.

Use clearly differentiated color indicators and labels.

Display a concise explanation:

"Persentase toko yang memiliki tiket AHO aktif."

## 11.4 Individual Store Legend

At zoom ≥13, replace aggregate categories with:

**Status Tiket Toko**

- Red — Ada tiket aktif.
- Green — Tidak ada tiket aktif.
- Gray — Data belum tersedia, when relevant.

Do not show the four aggregate percentage categories when only individual store pins are displayed.

## 11.5 Legend Header

Use a compact header:

**Legenda AHO**

Optional secondary text:

"Monitoring tiket aktif"

Use a collapse/expand control.

Do not use a large decorative badge for "SPARTA Maintenance".

If attribution is needed, use subtle source text.

## 11.6 Footer

Include a short clarification that colors do not indicate disaster risk or physical damage severity.

Display the actual latest ticket update timestamp when available.

Do not label it as the last IRIS import unless that information is explicitly provided.

## 11.7 Loading and Error States

If AHO data is loading, use a suitable loading state.

If Maintenance is unavailable, show an error/unavailable state.

Do not show an all-green legend with misleading store statuses after an API failure.

---

# 12. Marker Interaction and Detail Behavior

## 12.1 Interaction Hierarchy

Follow this pattern:

**Hover → Quick information**

**Click → Detailed information**

**Right Detail Panel → Complete data**

Avoid multiple large overlapping information surfaces.

## 12.2 Branch Selection

Clicking an aggregated branch marker opens:

- Branch identity.
- Total stores.
- Stores with active AHO tickets.
- Percentage.
- Other existing relevant branch data.

## 12.3 Cluster Selection

Clicking a cluster opens:

- Total stores.
- Stores with active tickets.
- Percentage.
- Geographic grouping context.

Allow users to zoom further to individual stores.

## 12.4 Store Selection

Clicking a store opens the right detail panel.

Preserve:

**Store Identity**

- Store code.
- Store name.
- Branch.
- Location information.

**Responsible Personnel**

- BMS.
- BMC.
- BnM Manager.

Until Maintenance grants access to a documented source for responsible personnel, display:

"Data belum tersedia"

Use the same Maintenance database environment variable:

`MAINTENANCE_AHO_DATABASE_URL`

No additional database connection is required.

**Active AHO Tickets**

- Ticket count.
- Ticket number.
- Status.
- Update timestamp.

AHO must remain read-only.

## 12.5 DC Selection

Clicking a DC marker opens the applicable facility detail.

Use existing SPARTA Siaga DC data and permissions.

## 12.6 Closing Details

Closing the detail panel must:

- Clear the selected marker state.
- Preserve center and zoom.
- Keep the active layer.
- Avoid unnecessary data refetching.

---

# 13. Fullscreen and Responsive Design

## 13.1 Fullscreen

The fullscreen workspace must contain:

- Map.
- Relevant toolbar.
- Mode selector.
- Active control panel.
- Legend.
- Detail panel.
- Map navigation controls.

Use the Browser Fullscreen API where supported.

Synchronize state through `fullscreenchange`.

Resize Leaflet appropriately without remounting the map.

Ensure Portal-based UI components remain visible within the fullscreen context.

## 13.2 Desktop

Prioritize the map.

Avoid overlapping the left control rail and right detail panel.

Use compact information surfaces.

## 13.3 Tablet

Provide collapsible controls.

Maintain practical map visibility.

Prevent toolbar and detail panel overlap.

## 13.4 Mobile

Use a map-first layout.

Controls and detail panels may use Sheet/Drawer.

Do not simply shrink desktop marker labels or panels.

Use appropriate touch target sizes and interaction states.

Avoid horizontal overflow.

---

# 14. Component Standards

Use actual existing shadcn/ui components where appropriate.

Recommended:

- Button.
- Tabs.
- ToggleGroup.
- Card.
- Collapsible.
- Badge.
- Tooltip.
- Sheet.
- ScrollArea.
- Separator.
- Skeleton.

Leaflet markers themselves may use custom SVG or HTML because geographic symbols are specialized map primitives.

However, surrounding controls, tooltips, panels, and dialogs should remain consistent with the project's component system.

Use approved SPARTA Siaga design tokens.

Do not import SPARTA Maintenance styling or global CSS into Siaga.

---

# 15. Verification and Acceptance Criteria

## 15.1 Marker Appearance

- [ ] Cabang uses an anchored flag-style label.
- [ ] Cluster uses a circular aggregation shape.
- [ ] Toko uses a compact location pin.
- [ ] DC uses a facility-oriented marker.
- [ ] All four types are visually distinguishable without relying on color alone.
- [ ] Marker labels remain readable at supported zoom levels.
- [ ] Dense regions do not become permanently inaccessible due to overlapping markers.

## 15.2 AHO Colors

- [ ] Red `#dc2626` for >70%.
- [ ] Orange `#f97316` for 50–70%.
- [ ] Yellow `#facc15` for 20–<50%.
- [ ] Green `#16a34a` for <20%.
- [ ] Threshold boundaries are calculated correctly.
- [ ] Toko individual uses red/green status, not four aggregate categories.
- [ ] Unknown status never appears as confirmed green.

## 15.3 Legend

- [ ] AHO legend appears only in Toko + AHO.
- [ ] Aggregate legend uses four colors.
- [ ] Individual store legend uses ticket-presence status.
- [ ] Legend adapts to zoom.
- [ ] Legend can collapse.
- [ ] Timestamp and explanatory text are accurate.

## 15.4 Interaction

- [ ] Hover shows concise information.
- [ ] Click opens the correct detail panel.
- [ ] Large duplicate Leaflet popups are avoided.
- [ ] Branch/cluster details remain accessible.
- [ ] Store and DC details display correctly.
- [ ] Closing detail does not reset the map.
- [ ] Changing mode clears invalid selections and UI.

## 15.5 Functional Integrity

- [ ] BMKG monitoring remains functional.
- [ ] Store and DC master data remain unchanged.
- [ ] AHO aggregation counts are accurate.
- [ ] Maintenance API integration is unchanged.
- [ ] No new Maintenance write operations are introduced.
- [ ] Authentication and authorization remain intact.
- [ ] Reporting and notification workflows are unaffected.

## 15.6 Visual and Technical Validation

- [ ] Review screenshots at zoom ≤7, 8–12, and ≥13.
- [ ] Verify Dark, Light, and OSM basemaps.
- [ ] Verify areas with dense markers, especially Java.
- [ ] Verify selected marker state.
- [ ] Verify desktop, tablet, and mobile.
- [ ] Verify fullscreen behavior.
- [ ] Run relevant TypeScript, lint, build, and regression tests.
- [ ] Report actual failures instead of claiming success without evidence.

---

# 16. Design Governance

This document is the approved page-specific design reference for Peta Monitoring.

For global application visual design, follow:

`design.md`

For AI development instructions, follow:

`AGENTS.md`

### Reference Priority

1. Explicitly approved SPARTA Siaga requirements.
2. Global SPARTA Siaga design system.
3. Peta Monitoring specialized specification.
4. Existing reusable Siaga components.
5. SPARTA Maintenance component/layout reference.

If a map-specific requirement needs a specialized interaction or component, implement it without violating SPARTA Siaga's visual identity.

### Non-Negotiable Rules

- Do not copy SPARTA Maintenance colors or branding into Siaga.
- Do not confuse marker types through nearly identical silhouettes.
- Do not use similar-looking colors for different AHO categories.
- Do not modify aggregation mathematics for styling purposes.
- Do not invent source data.
- Do not weaken security or permission checks.
- Do not declare UI changes complete without actual visual verification.
- Do not silently modify this specification to justify generated UI.

**Final Objective:** Deliver a clear, professional, geographically meaningful Peta Monitoring interface where Cabang, Cluster, Toko, and DC each have distinct visual identities, while the overall application remains unmistakably SPARTA Siaga.
