import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import type { Pool } from "pg";
import { executeEarthquakeV1MmiWorkflow as execute, resetWorkflowMemoryState } from "../lib/earthquake-v1-mmi-service";
import { parseShakeMapCovJson, interpolateMmiFromGrid } from "../lib/earthquake-intensity-service";
import { fetchOfficialMmiForEarthquake } from "../lib/official-earthquake-mmi";
import type { Store } from "../types/store";

const t0 = new Date("2026-11-09T08:00:00Z");
const at = (minutes: number) => new Date(t0.getTime() + minutes * 60_000);
const earthquake = { id: "review-fixture", magnitude: 5.3, depthKm: 20.5, latitude: 0, longitude: 0, timestamp: t0.getTime(), source: "BMKG" };
const store = (code: string, latitude: number): Store => ({ id: code, kode_toko: code, nama_toko: code, alamat: "Fixture", cabang: "TEST", latitude, longitude: 0 });
const stores = [store("A", 0.1), store("B", 0.2)];
function gridPayload(mmi = 6.2) {
  return { domain: { axes: { x: { start: -1, stop: 1, num: 2 }, y: { start: -1, stop: 1, num: 2 } } }, ranges: { MMI: { values: [mmi, mmi, mmi, mmi], axisNames: ["y", "x"], shape: [2, 2] } } };
}
const grid = (mmi = 6.2, id = earthquake.id) => ({ provider: "BMKG" as const, grid: parseShakeMapCovJson(gridPayload(mmi), { eventId: id, sourceProvider: "BMKG" }) });

function transactionDouble() {
  let data = { metadata: {} as any, reports: [] as any[], notifications: [] as any[], grids: [] as any[], audits: [] as any[] };
  let queue = Promise.resolve();
  let failReport = "";
  let failNotification = false;
  async function run(state: typeof data, sql: string, args: any[] = []): Promise<{ rows: any[] }> {
    const q = sql.trim().replace(/\s+/g, " ").toUpperCase();
    if (q.startsWith("SELECT RAW_METADATA")) return { rows: [{ raw_metadata: structuredClone(state.metadata) }] };
    if (q.startsWith("UPDATE EARTHQUAKE_EVENTS")) { Object.assign(state.metadata, JSON.parse(args[0])); return { rows: [] }; }
    if (q.includes("FROM EARTHQUAKE_SHAKEMAPS")) return { rows: state.grids };
    if (q.startsWith("INSERT INTO EARTHQUAKE_SHAKEMAPS")) {
      const record = { id: `grid-${args[1]}-${args[2]}`, source_provider: args[1], version_number: args[2], raw_payload: JSON.parse(args[11]), is_new: true };
      state.grids = state.grids.filter((g) => g.source_provider !== args[1]); state.grids.push(record);
      return { rows: [record] };
    }
    if (q.startsWith("INSERT INTO EARTHQUAKE_FACILITY_INTENSITIES")) { state.audits.push(args); return { rows: [] }; }
    if (q.includes("FROM INCIDENTS") && q.includes("REPORT_ORIGIN = 'MANUAL'")) return { rows: [] };
    if (q.includes("FROM INCIDENTS")) return { rows: state.reports.filter((r) => r.event === args[0] && r.location === args[2]) };
    if (q.startsWith("INSERT INTO INCIDENTS")) {
      if (failReport === args[5]) { failReport = ""; throw new Error("Injected report failure"); }
      const row = { id: args[0], event: args[2], location: args[5] }; state.reports.push(row); return { rows: [row] };
    }
    if (q.startsWith("INSERT INTO NOTIFICATION_LOGS")) {
      if (failNotification) { failNotification = false; throw new Error("Injected notification failure"); }
      const row = { id: args[0], event: args[15], branch: args[4] }; state.notifications.push(row); return { rows: [row] };
    }
    if (q.startsWith("SELECT LOCK_EARTHQUAKE_LOCATION")) return { rows: [] };
    throw new Error(`Unexpected SQL in regression double: ${q}`);
  }
  const pool = {
    query: (sql: string, args?: any[]) => run(data, sql, args),
    connect: async () => {
      let local: typeof data | undefined;
      let unlock: (() => void) | undefined;
      return {
        async connect() { throw new Error("A checked-out pg client must not be connected again"); },
        release() { assert.equal(unlock, undefined, "transaction lock must be released"); },
        async query(sql: string, args?: any[]) {
          if (sql === "BEGIN") return { rows: [] };
          if (sql.startsWith("SELECT pg_advisory_xact_lock")) {
            const previous = queue; queue = new Promise<void>((resolve) => { unlock = resolve; });
            await previous; local = structuredClone(data); return { rows: [] };
          }
          if (sql === "COMMIT" || sql === "ROLLBACK") {
            if (sql === "COMMIT" && local) data = local;
            local = undefined; unlock?.(); unlock = undefined; return { rows: [] };
          }
          assert.ok(local, "SQL must use the locked transaction");
          return run(local, sql, args);
        },
      };
    },
  } as unknown as Pool;
  return { pool, state: () => data, failReportOnce: (code: string) => { failReport = code; }, failNotificationOnce: () => { failNotification = true; } };
}

test("receipt deadline survives process-memory reset and origin-time updates", async () => {
  resetWorkflowMemoryState();
  const db = transactionDouble();
  const first = await execute({ earthquake, stores, officialGrids: [], currentTime: at(5), dbPool: db.pool });
  assert.equal(first.evaluation.deadlineAt.toISOString(), at(15).toISOString());
  resetWorkflowMemoryState();
  const result = await execute({ earthquake: { ...earthquake, timestamp: at(2).getTime() }, stores, officialGrids: [], currentTime: at(15), dbPool: db.pool });
  assert.equal(result.evaluation.deadlineAt.toISOString(), at(15).toISOString());
  assert.equal(result.createdInspectionReports, 2);
  assert.equal(db.state().metadata.v1_mmi_workflow.status, "FINALIZED");
});

test("report failure rolls back outputs; retry uses frozen targets even after late MMI", async () => {
  const db = transactionDouble(); db.failReportOnce("B");
  const p = { earthquake, stores, officialGrids: [], currentTime: at(11), windowStartedAt: t0, dbPool: db.pool };
  await assert.rejects(execute(p), /Injected report failure/);
  assert.equal(db.state().reports.length, 0);
  assert.equal(db.state().notifications.length, 0);
  assert.equal(db.state().metadata.v1_mmi_workflow.status, "DECIDED");
  resetWorkflowMemoryState();
  const result = await execute({ ...p, currentTime: at(20), officialGrids: [grid(5.8)] });
  assert.equal(result.createdInspectionReports, 2);
  assert.equal(db.state().notifications.length, 1);
});

test("notification failure rolls back reports and remains retryable", async () => {
  const db = transactionDouble(); db.failNotificationOnce();
  const p = { earthquake, stores, officialGrids: [grid()], currentTime: at(1), dbPool: db.pool };
  await assert.rejects(execute(p), /Injected notification failure/);
  assert.equal(db.state().reports.length, 0);
  assert.equal(db.state().notifications.length, 0);
  await execute(p);
  assert.equal(db.state().reports.length, 2);
  assert.equal(db.state().notifications.length, 1);
});

test("concurrent workers finalize once; restart and database-loaded late MMI cannot add stores", async () => {
  const db = transactionDouble();
  const p = { earthquake, stores, officialGrids: [grid()], currentTime: at(1), dbPool: db.pool };
  const results = await Promise.all([execute(p), execute(p)]);
  assert.equal(results.reduce((n, r) => n + r.createdInspectionReports, 0), 2);
  assert.equal(db.state().reports.length, 2);
  assert.equal(db.state().notifications.length, 1);
  resetWorkflowMemoryState();
  const result = await execute({ earthquake, stores: [...stores, store("OUTSIDE", 0.7)], currentTime: at(25), dbPool: db.pool, fetchOfficialMmi: async () => null });
  assert.equal(result.isDuplicateSuppressed, true);
  assert.equal(db.state().reports.length, 2);
  assert.ok(db.state().audits.length > 0);
});

test("mismatched grid cannot qualify a store, and empty decision creates no notifications", async () => {
  const db = transactionDouble();
  const result = await execute({ earthquake, stores: [store("OUTSIDE", 0.7)], officialGrids: [grid(7, "different-event")], currentTime: at(11), windowStartedAt: t0, dbPool: db.pool });
  assert.equal(result.createdInspectionReports, 0);
  assert.equal(result.dispatchedBranchNotifications, 0);
});

test("a finalized decision from the previous implementation is not reopened", async () => {
  const db = transactionDouble();
  db.state().metadata.v1_mmi_workflow = {
    status: "FINALIZED", window_started_at: t0.toISOString(), deadline_at: at(10).toISOString(),
  };
  const result = await execute({ earthquake, stores, officialGrids: [grid()], currentTime: at(20), dbPool: db.pool });
  assert.equal(result.isDuplicateSuppressed, true);
  assert.equal(db.state().reports.length, 0);
  assert.equal(db.state().notifications.length, 0);
});

function officialTransport(options: { ambiguous?: boolean; mismatch?: boolean; untrusted?: boolean } = {}) {
  const requested: string[] = [];
  const feature = { id: "usfixture", geometry: { coordinates: [0, 0, 20.5] }, properties: { time: t0.getTime(), mag: 5.3, type: "earthquake", detail: "https://earthquake.usgs.gov/detail-fixture" } };
  const fetcher = (async (input: any) => {
    const url = String(input); requested.push(url);
    if (url.includes("/query?")) return Response.json({ features: options.ambiguous ? [feature, feature] : [feature] });
    if (url.endsWith("detail-fixture")) return Response.json({ ...feature, properties: { ...feature.properties, time: options.mismatch ? at(5).getTime() : t0.getTime(), products: { shakemap: [{ updateTime: t0.getTime(), status: "UPDATE", contents: { "download/coverage_mmi_high_res.covjson": { url: options.untrusted ? "https://invalid.example/grid" : "https://earthquake.usgs.gov/product-fixture" } } }] } } });
    if (url.endsWith("product-fixture")) return Response.json(gridPayload());
    throw new Error("Unexpected fixture URL");
  }) as typeof fetch;
  return { fetcher, requested };
}

test("official transport validates origin and preserves source provenance", async () => {
  const { fetcher, requested } = officialTransport();
  const product = await fetchOfficialMmiForEarthquake(earthquake, fetcher);
  assert.ok(product);
  assert.equal(product.grid.eventId, earthquake.id);
  assert.equal(product.grid.rawPayload.spartaProvenance.providerEventId, "usfixture");
  assert.equal(requested.length, 3);
  const db = transactionDouble();
  const result = await execute({ earthquake, stores, currentTime: at(1), dbPool: db.pool, fetchOfficialMmi: (eq) => fetchOfficialMmiForEarthquake(eq, fetcher) });
  assert.equal(result.createdInspectionReports, 2);
  assert.equal(result.evaluation.qualifyingStores[0].mmiSource, "USGS");
});

test("ambiguous, mismatched, missing, and untrusted products remain unavailable", async () => {
  for (const options of [{ ambiguous: true }, { mismatch: true }, { untrusted: true }]) {
    const transport = officialTransport(options);
    assert.equal(await fetchOfficialMmiForEarthquake(earthquake, transport.fetcher), null);
    assert.ok(transport.requested.every((url) => !url.includes("invalid.example")));
  }
  assert.equal(await fetchOfficialMmiForEarthquake(earthquake, (async () => new Response("unavailable", { status: 503 })) as typeof fetch), null);
});

test("daemon and HTTP evaluation use the same workflow without legacy radius or national push", () => {
  const daemon = fs.readFileSync(new URL("../lib/server-daemon.ts", import.meta.url), "utf8");
  const route = fs.readFileSync(new URL("../app/api/earthquakes/[id]/evaluate/route.ts", import.meta.url), "utf8");
  const db = fs.readFileSync(new URL("../lib/earthquake-db.ts", import.meta.url), "utf8");
  assert.ok(!daemon.includes("calculateSpartaMonitoringZone"));
  assert.ok(!daemon.includes("dispatchStageOneNationalNotification"));
  assert.ok(!daemon.includes("isEarthquakeIntensityEnabled"));
  assert.ok(daemon.includes("dbGetPendingEarthquakeEvents()"));
  assert.ok(route.includes("executeEarthquakeV1MmiWorkflow"));
  assert.ok(!route.includes("processStageTwoIntensityEvaluation"));
  assert.ok(!route.includes("LIMIT 2000"));
  assert.ok(db.includes("COALESCE(earthquake_events.raw_metadata, '{}'::jsonb) || EXCLUDED.raw_metadata"));
});

test("high-resolution grids do not exceed the JavaScript argument stack", () => {
  const payload = gridPayload();
  payload.domain.axes.x.num = 401;
  payload.domain.axes.y.num = 400;
  payload.ranges.MMI.shape = [400, 401];
  payload.ranges.MMI.values = Array(160400).fill(6.7);
  const parsed = parseShakeMapCovJson(payload);
  assert.equal(parsed.maxMmi, 6.7);
  assert.equal(interpolateMmiFromGrid(parsed, 0, 0), 6.7);
});

test("longitude-first grids are normalized before location lookup", () => {
  const payload = gridPayload();
  payload.domain.axes.y.num = 3;
  payload.ranges.MMI.shape = [2, 3];
  payload.ranges.MMI.axisNames = ["x", "y"];
  payload.ranges.MMI.values = [1, 2, 3, 4, 5, 6];
  const parsed = parseShakeMapCovJson(payload);
  assert.equal(interpolateMmiFromGrid(parsed, 0, -1), 2);
  assert.equal(interpolateMmiFromGrid(parsed, 0, 1), 5);
});
