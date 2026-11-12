# Incident CRUD Database Integration  -  Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate incident data from `localStorage` to a real PostgreSQL database (Aiven Cloud) using the existing `pg` pool in `lib/db.ts`, implementing full CRUD via Next.js API Route Handlers.

**Architecture:**
- Existing `pg` Pool in `lib/db.ts` connects to Aiven PostgreSQL  -  we reuse this, no new DB client.
- New API routes under `app/api/incidents/` handle Create, Read, Update, Delete.
- `app/page.tsx` fetches from these routes instead of `localStorage`.
- `lib/incident-store.ts` keeps its helper functions (`calculateIncidentStats`, `mergeLiveDangerStoresIntoIncidents`) but drops the localStorage read/write functions.

**Tech Stack:** Next.js 16 App Router, `pg` (node-postgres), TypeScript, existing PostgreSQL on Aiven Cloud

## Global Constraints

- Use `getDbPool()` from `lib/db.ts`  -  never create a new Pool directly.
- All DB queries use parameterized queries (`$1`, `$2`, etc.)  -  never string interpolation.
- Preserve all existing `IncidentRecord`, `DamageReport`, `MaintenanceTicket`, `TimelineEvent` TypeScript types from `types/incident.ts`  -  no breaking changes.
- JSON columns in DB store `verification`, `maintenanceTicket`, `timeline`, `disasterMetadata` as JSONB.
- The `INITIAL_INCIDENTS` seed data from `lib/incident-store.ts` must be seeded into DB on first run.
- API routes return `{ data: T }` on success, `{ error: string }` on failure.

---

### Task 1: Create Database Schema & Migration Script

**Files:**
- Create: `scripts/migrate-incidents.ts`

**Interfaces:**
- Produces: Table `incidents` in PostgreSQL with columns matching `IncidentRecord`.

- [ ] **Step 1: Write the migration script**

```typescript
// scripts/migrate-incidents.ts
import { getDbPool } from "../lib/db.js";

async function migrate() {
  const pool = getDbPool();
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS incidents (
        id               TEXT PRIMARY KEY,
        date             TEXT NOT NULL,
        disaster_type    TEXT NOT NULL,
        store_id         TEXT NOT NULL,
        store_name       TEXT NOT NULL,
        branch           TEXT NOT NULL,
        location_city    TEXT NOT NULL,
        status           TEXT NOT NULL DEFAULT 'verifying',
        progress         INTEGER NOT NULL DEFAULT 0,
        disaster_metadata JSONB,
        verification     JSONB,
        maintenance_ticket JSONB,
        timeline         JSONB NOT NULL DEFAULT '[]',
        created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        closed_at        TIMESTAMPTZ
      );
    `);
    console.log("✅ Table 'incidents' created or already exists.");
  } finally {
    client.release();
    await pool.end();
  }
}

migrate().catch(console.error);
```

- [ ] **Step 2: Add migrate script to package.json**

In `package.json`, add to `scripts`:
```json
"migrate": "tsx scripts/migrate-incidents.ts"
```

- [ ] **Step 3: Run the migration**

```bash
pnpm migrate
```
Expected: `✅ Table 'incidents' created or already exists.` printed, exit code 0.

- [ ] **Step 4: Commit**

```bash
git add scripts/migrate-incidents.ts package.json
git commit -m "feat: add incidents table migration script"
```

---

### Task 2: Create Seed Script

**Files:**
- Create: `scripts/seed-incidents.ts`

**Interfaces:**
- Consumes: `INITIAL_INCIDENTS` from `lib/incident-store.ts`.
- Produces: 3 seed incident rows in the `incidents` table.

- [ ] **Step 1: Write the seed script**

```typescript
// scripts/seed-incidents.ts
import { getDbPool } from "../lib/db.js";
import { INITIAL_INCIDENTS } from "../lib/incident-store.js";

async function seed() {
  const pool = getDbPool();
  const client = await pool.connect();
  try {
    for (const inc of INITIAL_INCIDENTS) {
      await client.query(
        `INSERT INTO incidents (
          id, date, disaster_type, store_id, store_name, branch, location_city,
          status, progress, disaster_metadata, verification, maintenance_ticket,
          timeline, created_at, updated_at, closed_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
        ON CONFLICT (id) DO NOTHING`,
        [
          inc.id, inc.date, inc.disasterType, inc.storeId, inc.storeName,
          inc.branch, inc.locationCity, inc.status, inc.progress,
          JSON.stringify(inc.disasterMetadata ?? null),
          JSON.stringify(inc.verification ?? null),
          JSON.stringify(inc.maintenanceTicket ?? null),
          JSON.stringify(inc.timeline),
          inc.createdAt, inc.updatedAt, inc.closedAt ?? null,
        ]
      );
    }
    console.log(`✅ Seeded ${INITIAL_INCIDENTS.length} incidents.`);
  } finally {
    client.release();
    await pool.end();
  }
}

seed().catch(console.error);
```

- [ ] **Step 2: Add seed script to package.json**

```json
"seed": "tsx scripts/seed-incidents.ts"
```

- [ ] **Step 3: Run the seed**

```bash
pnpm seed
```
Expected: `✅ Seeded 3 incidents.`

- [ ] **Step 4: Commit**

```bash
git add scripts/seed-incidents.ts package.json
git commit -m "feat: seed initial incidents into database"
```

---

### Task 3: Create DB Helper Layer

**Files:**
- Create: `lib/incident-db.ts`

**Interfaces:**
- Consumes: `getDbPool()` from `lib/db.ts`.
- Produces:
  - `dbGetAllIncidents(): Promise<IncidentRecord[]>`
  - `dbGetIncidentById(id: string): Promise<IncidentRecord | null>`
  - `dbCreateIncident(inc: IncidentRecord): Promise<IncidentRecord>`
  - `dbUpdateIncident(id: string, patch: Partial<IncidentRecord>): Promise<IncidentRecord | null>`
  - `dbDeleteIncident(id: string): Promise<boolean>`

- [ ] **Step 1: Write the db helper**

```typescript
// lib/incident-db.ts
import { getDbPool } from "./db.js";
import { IncidentRecord } from "@/types/incident";

function rowToIncident(row: any): IncidentRecord {
  return {
    id: row.id,
    date: row.date,
    disasterType: row.disaster_type,
    storeId: row.store_id,
    storeName: row.store_name,
    branch: row.branch,
    locationCity: row.location_city,
    status: row.status,
    progress: row.progress,
    disasterMetadata: row.disaster_metadata ?? undefined,
    verification: row.verification ?? undefined,
    maintenanceTicket: row.maintenance_ticket ?? undefined,
    timeline: row.timeline ?? [],
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at,
    closedAt: row.closed_at ? (row.closed_at instanceof Date ? row.closed_at.toISOString() : row.closed_at) : undefined,
  };
}

export async function dbGetAllIncidents(): Promise<IncidentRecord[]> {
  const pool = getDbPool();
  const { rows } = await pool.query(`SELECT * FROM incidents ORDER BY created_at DESC`);
  return rows.map(rowToIncident);
}

export async function dbGetIncidentById(id: string): Promise<IncidentRecord | null> {
  const pool = getDbPool();
  const { rows } = await pool.query(`SELECT * FROM incidents WHERE id = $1`, [id]);
  if (rows.length === 0) return null;
  return rowToIncident(rows[0]);
}

export async function dbCreateIncident(inc: IncidentRecord): Promise<IncidentRecord> {
  const pool = getDbPool();
  const { rows } = await pool.query(
    `INSERT INTO incidents (
      id, date, disaster_type, store_id, store_name, branch, location_city,
      status, progress, disaster_metadata, verification, maintenance_ticket,
      timeline, created_at, updated_at, closed_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
    RETURNING *`,
    [
      inc.id, inc.date, inc.disasterType, inc.storeId, inc.storeName,
      inc.branch, inc.locationCity, inc.status, inc.progress,
      JSON.stringify(inc.disasterMetadata ?? null),
      JSON.stringify(inc.verification ?? null),
      JSON.stringify(inc.maintenanceTicket ?? null),
      JSON.stringify(inc.timeline),
      inc.createdAt, inc.updatedAt, inc.closedAt ?? null,
    ]
  );
  return rowToIncident(rows[0]);
}

export async function dbUpdateIncident(id: string, patch: Partial<IncidentRecord>): Promise<IncidentRecord | null> {
  const pool = getDbPool();
  const setClauses: string[] = [];
  const values: any[] = [];
  let idx = 1;

  const fieldMap: Record<string, string> = {
    status: "status",
    progress: "progress",
    disasterType: "disaster_type",
    storeName: "store_name",
    branch: "branch",
    locationCity: "location_city",
    date: "date",
  };

  for (const [key, col] of Object.entries(fieldMap)) {
    if (key in patch) {
      setClauses.push(`${col} = $${idx++}`);
      values.push((patch as any)[key]);
    }
  }

  // JSONB fields
  if (patch.verification !== undefined) {
    setClauses.push(`verification = $${idx++}`);
    values.push(JSON.stringify(patch.verification));
  }
  if (patch.maintenanceTicket !== undefined) {
    setClauses.push(`maintenance_ticket = $${idx++}`);
    values.push(JSON.stringify(patch.maintenanceTicket));
  }
  if (patch.timeline !== undefined) {
    setClauses.push(`timeline = $${idx++}`);
    values.push(JSON.stringify(patch.timeline));
  }
  if (patch.disasterMetadata !== undefined) {
    setClauses.push(`disaster_metadata = $${idx++}`);
    values.push(JSON.stringify(patch.disasterMetadata));
  }
  if (patch.closedAt !== undefined) {
    setClauses.push(`closed_at = $${idx++}`);
    values.push(patch.closedAt);
  }

  setClauses.push(`updated_at = NOW()`);

  if (setClauses.length === 1) return dbGetIncidentById(id); // only updated_at, nothing else

  values.push(id);
  const { rows } = await pool.query(
    `UPDATE incidents SET ${setClauses.join(", ")} WHERE id = $${idx} RETURNING *`,
    values
  );
  if (rows.length === 0) return null;
  return rowToIncident(rows[0]);
}

export async function dbDeleteIncident(id: string): Promise<boolean> {
  const pool = getDbPool();
  const { rowCount } = await pool.query(`DELETE FROM incidents WHERE id = $1`, [id]);
  return (rowCount ?? 0) > 0;
}
```

- [ ] **Step 2: Verify TypeScript**

```bash
pnpm typecheck
```
Expected: exit code 0, no errors.

- [ ] **Step 3: Commit**

```bash
git add lib/incident-db.ts
git commit -m "feat: add incident-db helper layer"
```

---

### Task 4: Create API Route Handlers

**Files:**
- Create: `app/api/incidents/route.ts` (GET all, POST create)
- Create: `app/api/incidents/[id]/route.ts` (GET one, PATCH update, DELETE)

**Interfaces:**
- Consumes: All 5 functions from `lib/incident-db.ts`.
- Produces: REST endpoints `/api/incidents` and `/api/incidents/:id`.

- [ ] **Step 1: Write the collection route**

```typescript
// app/api/incidents/route.ts
import { NextResponse } from "next/server";
import { dbGetAllIncidents, dbCreateIncident } from "@/lib/incident-db";
import { IncidentRecord } from "@/types/incident";

export async function GET() {
  try {
    const incidents = await dbGetAllIncidents();
    return NextResponse.json({ data: incidents });
  } catch (err) {
    console.error("[GET /api/incidents]", err);
    return NextResponse.json({ error: "Gagal memuat data laporan" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body: IncidentRecord = await request.json();
    if (!body.id || !body.disasterType || !body.storeId) {
      return NextResponse.json({ error: "Data tidak lengkap" }, { status: 400 });
    }
    const created = await dbCreateIncident(body);
    return NextResponse.json({ data: created }, { status: 201 });
  } catch (err) {
    console.error("[POST /api/incidents]", err);
    return NextResponse.json({ error: "Gagal membuat laporan" }, { status: 500 });
  }
}
```

- [ ] **Step 2: Write the item route**

```typescript
// app/api/incidents/[id]/route.ts
import { NextResponse } from "next/server";
import { dbGetIncidentById, dbUpdateIncident, dbDeleteIncident } from "@/lib/incident-db";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const incident = await dbGetIncidentById(id);
    if (!incident) return NextResponse.json({ error: "Tidak ditemukan" }, { status: 404 });
    return NextResponse.json({ data: incident });
  } catch (err) {
    console.error("[GET /api/incidents/:id]", err);
    return NextResponse.json({ error: "Gagal memuat laporan" }, { status: 500 });
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const patch = await request.json();
    const updated = await dbUpdateIncident(id, patch);
    if (!updated) return NextResponse.json({ error: "Tidak ditemukan" }, { status: 404 });
    return NextResponse.json({ data: updated });
  } catch (err) {
    console.error("[PATCH /api/incidents/:id]", err);
    return NextResponse.json({ error: "Gagal memperbarui laporan" }, { status: 500 });
  }
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const deleted = await dbDeleteIncident(id);
    if (!deleted) return NextResponse.json({ error: "Tidak ditemukan" }, { status: 404 });
    return NextResponse.json({ data: { success: true } });
  } catch (err) {
    console.error("[DELETE /api/incidents/:id]", err);
    return NextResponse.json({ error: "Gagal menghapus laporan" }, { status: 500 });
  }
}
```

- [ ] **Step 3: Verify TypeScript**

```bash
pnpm typecheck
```
Expected: exit code 0.

- [ ] **Step 4: Commit**

```bash
git add app/api/incidents/route.ts app/api/incidents/[id]/route.ts
git commit -m "feat: add incident CRUD API routes"
```

---

### Task 5: Wire page.tsx to API (Replace localStorage)

**Files:**
- Modify: `app/page.tsx`
- Modify: `lib/incident-store.ts` (remove localStorage functions)

**Interfaces:**
- Consumes: `GET /api/incidents`, `POST /api/incidents`, `PATCH /api/incidents/:id`, `DELETE /api/incidents/:id`.
- Produces: Incidents loaded from DB on mount; all mutations call the API.

- [ ] **Step 1: Replace incident loading in page.tsx**

Find the `useEffect` that calls `getStoredIncidents()` and replace it with an API fetch:

```typescript
// Replace getStoredIncidents() call in useEffect with:
const res = await fetch("/api/incidents");
const json = await res.json();
const dbIncidents: IncidentRecord[] = json.data ?? [];
const merged = mergeLiveDangerStoresIntoIncidents(dbIncidents, dangerStores);
setIncidents(merged.updatedIncidents);
```

- [ ] **Step 2: Replace handleUpdateIncidents with API mutations**

Currently `handleUpdateIncidents` calls `saveStoredIncidents`. Replace with a helper that fires PATCH/POST/DELETE to the API:

```typescript
const saveIncidentToDb = async (incident: IncidentRecord) => {
  await fetch(`/api/incidents/${incident.id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(incident),
  });
};

const createIncidentInDb = async (incident: IncidentRecord) => {
  await fetch("/api/incidents", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(incident),
  });
};

const deleteIncidentFromDb = async (id: string) => {
  await fetch(`/api/incidents/${id}`, { method: "DELETE" });
};
```

- [ ] **Step 3: Update handleUpdateIncidents**

```typescript
const handleUpdateIncidents = useCallback(async (updated: IncidentRecord[]) => {
  // Find new incidents (not in current state) → POST
  // Find changed incidents → PATCH
  // Diff by id against current `incidents` state
  const currentIds = new Set(incidents.map(i => i.id));
  for (const inc of updated) {
    if (!currentIds.has(inc.id)) {
      await createIncidentInDb(inc);
    } else {
      await saveIncidentToDb(inc);
    }
  }
  // Find deleted (in current but not in updated) → DELETE
  const updatedIds = new Set(updated.map(i => i.id));
  for (const inc of incidents) {
    if (!updatedIds.has(inc.id)) {
      await deleteIncidentFromDb(inc.id);
    }
  }
  setIncidents(updated);
}, [incidents]);
```

- [ ] **Step 4: Add Delete button to ActiveIncidentsTable**

In `components/dashboard/active-incidents-table.tsx`, add a `onDeleteIncident` prop and a delete button (with confirmation) on each row:

```typescript
// In the row actions section, after existing action buttons:
<button
  onClick={() => {
    if (confirm(`Hapus laporan ${inc.id}? Tindakan ini tidak bisa dibatalkan.`)) {
      onDeleteIncident(inc.id);
    }
  }}
  className="p-1.5 rounded-lg text-red-400 hover:text-red-600 hover:bg-red-50 transition-colors"
  title="Hapus Laporan"
>
  <Trash2 className="w-4 h-4" />
</button>
```

- [ ] **Step 5: Remove localStorage from incident-store.ts**

Delete `getStoredIncidents()` and `saveStoredIncidents()` functions. Keep `INITIAL_INCIDENTS`, `calculateIncidentStats`, and `mergeLiveDangerStoresIntoIncidents`.

- [ ] **Step 6: TypeScript check**

```bash
pnpm typecheck
```
Expected: exit code 0.

- [ ] **Step 7: Verify in browser**

Open `http://localhost:3004`, go to Laporan Kejadian tab. Confirm incidents load from DB (not localStorage). Create a new report via "Buat Laporan Baru" and verify it persists after hard refresh.

- [ ] **Step 8: Commit**

```bash
git add app/page.tsx lib/incident-store.ts components/dashboard/active-incidents-table.tsx
git commit -m "feat: wire incident CRUD to PostgreSQL API, remove localStorage"
```

---

### Task 6: Add Edit Incident Modal

**Files:**
- Create: `components/incident/edit-incident-modal.tsx`
- Modify: `app/page.tsx` (add edit state + modal render)

**Interfaces:**
- Consumes: `IncidentRecord`.
- Produces: `EditIncidentModalProps` with `onSave(patch: Partial<IncidentRecord>)`.

- [ ] **Step 1: Write EditIncidentModal**

```tsx
// components/incident/edit-incident-modal.tsx
"use client";
import React, { useState } from "react";
import { X, Save } from "lucide-react";
import { IncidentRecord, DisasterType, IncidentStatus } from "@/types/incident";

interface EditIncidentModalProps {
  incident: IncidentRecord | null;
  isOpen: boolean;
  onClose: () => void;
  onSave: (id: string, patch: Partial<IncidentRecord>) => void;
}

export function EditIncidentModal({ incident, isOpen, onClose, onSave }: EditIncidentModalProps) {
  const [disasterType, setDisasterType] = useState<DisasterType>(incident?.disasterType ?? "other");
  const [status, setStatus] = useState<IncidentStatus>(incident?.status ?? "verifying");
  const [progress, setProgress] = useState(incident?.progress ?? 0);
  const [notes, setNotes] = useState(incident?.verification?.notes ?? "");

  if (!isOpen || !incident) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-xs animate-in fade-in">
      <div className="bg-white rounded-2xl max-w-md w-full overflow-hidden shadow-2xl border border-slate-200">
        <div className="flex items-center justify-between px-6 py-4 border-b bg-slate-50/50">
          <h3 className="font-bold text-slate-900 text-sm">Edit Laporan #{incident.id}</h3>
          <button onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100"><X className="w-5 h-5" /></button>
        </div>
        <form onSubmit={(e) => {
          e.preventDefault();
          onSave(incident.id, {
            disasterType,
            status,
            progress,
            verification: incident.verification ? { ...incident.verification, notes } : undefined,
          });
        }} className="p-6 space-y-4">
          <div>
            <label className="text-xs font-bold text-slate-700 block mb-1">Jenis Kejadian:</label>
            <select value={disasterType} onChange={e => setDisasterType(e.target.value as DisasterType)} className="w-full border p-2 rounded-lg text-xs bg-slate-50">
              <option value="earthquake">Gempa Bumi</option>
              <option value="flood">Banjir / Genangan</option>
              <option value="fire">Kebakaran</option>
              <option value="theft">Pencurian</option>
              <option value="wind">Angin Kencang</option>
              <option value="other">Lainnya</option>
            </select>
          </div>
          <div>
            <label className="text-xs font-bold text-slate-700 block mb-1">Status:</label>
            <select value={status} onChange={e => setStatus(e.target.value as IncidentStatus)} className="w-full border p-2 rounded-lg text-xs bg-slate-50">
              <option value="verifying">Menunggu Verifikasi</option>
              <option value="investigating">Investigasi</option>
              <option value="in_maintenance">Dalam Perbaikan</option>
              <option value="resolved">Selesai</option>
            </select>
          </div>
          <div>
            <label className="text-xs font-bold text-slate-700 block mb-1">Progress ({progress}%):</label>
            <input type="range" min={0} max={100} step={5} value={progress} onChange={e => setProgress(Number(e.target.value))} className="w-full" />
          </div>
          <div>
            <label className="text-xs font-bold text-slate-700 block mb-1">Catatan Tambahan:</label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3} className="w-full border p-2 rounded-lg text-xs bg-slate-50 resize-none" />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-xs font-bold bg-slate-100 rounded-xl hover:bg-slate-200">Batal</button>
            <button type="submit" className="px-4 py-2 text-xs font-bold bg-blue-600 text-white rounded-xl hover:bg-blue-700 flex items-center gap-1.5">
              <Save className="w-4 h-4" /> Simpan Perubahan
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Wire EditIncidentModal in page.tsx**

Add state:
```typescript
const [isEditModalOpen, setIsEditModalOpen] = useState(false);
const [incidentToEdit, setIncidentToEdit] = useState<IncidentRecord | null>(null);
```

Add render:
```tsx
<EditIncidentModal
  incident={incidentToEdit}
  isOpen={isEditModalOpen}
  onClose={() => setIsEditModalOpen(false)}
  onSave={async (id, patch) => {
    const updated = incidents.map(inc => inc.id === id ? { ...inc, ...patch, updatedAt: new Date().toISOString() } : inc);
    await handleUpdateIncidents(updated);
    setIsEditModalOpen(false);
  }}
/>
```

- [ ] **Step 3: Add Edit button in ActiveIncidentsTable**

Add `onEditIncident` prop and an edit button per row:
```tsx
<button onClick={() => onEditIncident(inc)} className="p-1.5 rounded-lg text-blue-400 hover:text-blue-600 hover:bg-blue-50" title="Edit Laporan">
  <Pencil className="w-4 h-4" />
</button>
```

- [ ] **Step 4: TypeScript check**

```bash
pnpm typecheck
```
Expected: exit code 0.

- [ ] **Step 5: Commit**

```bash
git add components/incident/edit-incident-modal.tsx app/page.tsx components/dashboard/active-incidents-table.tsx
git commit -m "feat: add edit incident modal (Update in CRUD)"
```
