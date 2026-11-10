import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { getIsolatedDbPool, closeDbPool } from "../lib/db";
import { assertIsolatedDatabase } from "../lib/database-safety";
import { executeEarthquakeV1MmiWorkflow } from "../lib/earthquake-v1-mmi-service";
import type { Store } from "../types/store";

const BASE_URL = "http://localhost:3004";
const SSO_API_URL = "http://localhost:10000";
const EVENT_ID = "SIM-EQ-UAT-BROWSER-01";
let gorontaloIncidentId: string;

function getEvaluatorPassword(): string {
  const credPath = path.resolve(process.cwd(), "EVALUATOR_CREDENTIALS.txt");
  const content = fs.readFileSync(credPath, "utf-8");
  const match = content.match(/Password\s*:\s*(.+)/);
  if (!match) throw new Error("Could not find password in EVALUATOR_CREDENTIALS.txt");
  return match[1].trim();
}

async function authenticateSsoUser(email: string) {
  const password = getEvaluatorPassword();

  // 1. Login to SPARTA Login Portal API on port 10000
  const loginRes = await fetch(`${SSO_API_URL}/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  assert.equal(loginRes.status, 200, `SSO Login for ${email} must succeed`);
  const cookieHeader = loginRes.headers.get("set-cookie") || "";
  const matchSession = cookieHeader.match(/sparta_session=([^;]+)/);
  assert.ok(matchSession, "Must receive sparta_session from portal");
  const spartaSession = matchSession[1];

  // 2. Launch SIAGA module to get one-time launch token
  const launchRes = await fetch(`${SSO_API_URL}/v1/modules/siaga/launch`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: `sparta_session=${spartaSession}`,
    },
  });
  assert.equal(launchRes.status, 200, "SSO Launch must succeed");
  const launchData = await launchRes.json();
  const redirectUrl = launchData?.data?.redirectUrl;
  assert.ok(redirectUrl, "Redirect URL with launch token must be returned");

  // 3. Follow redirect to SIAGA SSO callback on port 3004
  const callbackRes = await fetch(redirectUrl, {
    method: "GET",
    redirect: "manual",
  });
  assert.equal(callbackRes.status, 307, "SIAGA callback must redirect to dashboard");
  const siagaCookies = callbackRes.headers.get("set-cookie") || "";
  assert.ok(siagaCookies.includes("siaga_session"), "Must receive siaga_session cookie");

  const cookiesList = siagaCookies
    .split(/,(?=[^;]+=[^;]+)/)
    .map((c) => c.split(";")[0].trim())
    .join("; ");

  // 4. Verify identity via /api/auth/me
  const meRes = await fetch(`${BASE_URL}/api/auth/me`, {
    headers: { Cookie: cookiesList },
  });
  assert.equal(meRes.status, 200, "GET /api/auth/me must return 200");
  const me = await meRes.json();

  return { email, user: me, cookies: cookiesList };
}

// 19 simulated stores for Boalemo, Gorontalo (epicenter: 0.49701, 122.28157)
// M 4.2, depth 15 km -> V1 radius 20 km
// All 19 stores placed within 0.05 deg (~5.5 km) of epicenter
const mockStores19: Store[] = Array.from({ length: 19 }, (_, i) => ({
  kode_toko: `TG${String(i + 1).padStart(3, "0")}`,
  nama_toko: `Alfamart Boalemo ${i + 1}`,
  cabang: "GORONTALO",
  latitude: 0.49701 + (i * 0.002),
  longitude: 122.28157 + (i * 0.002),
  status: "ACTIVE",
} as unknown as Store));

test.before(async () => {
  const pool = getIsolatedDbPool();
  const client = await pool.connect();
  try {
    await assertIsolatedDatabase(client);

    // Initial clean-up
    await client.query(`DELETE FROM incidents WHERE canonical_event_id = $1`, [EVENT_ID]);
    await client.query(`DELETE FROM notification_logs WHERE canonical_event_id = $1`, [EVENT_ID]);
    await client.query(`DELETE FROM earthquake_events WHERE id = $1`, [EVENT_ID]);

    const T0 = new Date(Date.now() - 12 * 60 * 1000); // Window started 12m ago
    const T_deadline = new Date(Date.now()); // Now (> 10m deadline elapsed)

    // Pre-record earthquake event in database
    await client.query(
      `INSERT INTO earthquake_events (
        id, magnitude, depth_km, latitude, longitude, occurred_at, title, source_primary,
        priority_radius_km, monitoring_radius_km, first_seen_at, last_seen_at, raw_metadata
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11, '{}'::jsonb)`,
      [
        EVENT_ID,
        4.2,
        15,
        0.49701,
        122.28157,
        T0,
        "Gempa Bumi Simulasi M 4.2 Boalemo UAT Browser Verification",
        "SIMULASI UAT",
        20,
        50,
        T0,
      ]
    );

    // Execute real workflow against isolated database
    const wfResult = await executeEarthquakeV1MmiWorkflow({
      earthquake: {
        id: EVENT_ID,
        magnitude: 4.2,
        depthKm: 15.0,
        latitude: 0.49701,
        longitude: 122.28157,
        title: "Gempa Bumi Simulasi M 4.2 Boalemo UAT Browser Verification",
        source: "SIMULASI UAT",
      },
      stores: mockStores19,
      officialGrids: [],
      windowStartedAt: T0,
      currentTime: T_deadline,
      dbPool: pool,
    });

    assert.equal(wfResult.createdInspectionReports, 19, "Must create 19 reports in database");
    assert.equal(wfResult.dispatchedBranchNotifications, 1, "Must dispatch 1 notification in database");

    // Fetch one incident ID for cross-branch testing
    const incRes = await client.query(
      `SELECT id FROM incidents WHERE canonical_event_id = $1 LIMIT 1`,
      [EVENT_ID]
    );
    gorontaloIncidentId = incRes.rows[0].id;
    assert.ok(gorontaloIncidentId, "Must have created incident ID");
  } finally {
    client.release();
  }
});

test.after(async () => {
  const pool = getIsolatedDbPool();
  const client = await pool.connect();
  try {
    await assertIsolatedDatabase(client);
    await client.query(`DELETE FROM incidents WHERE canonical_event_id = $1`, [EVENT_ID]);
    await client.query(`DELETE FROM notification_logs WHERE canonical_event_id = $1`, [EVENT_ID]);
    await client.query(`DELETE FROM earthquake_events WHERE id = $1`, [EVENT_ID]);
  } finally {
    client.release();
    await closeDbPool();
  }
});

test("Scenario 1: Authenticated SSO Identity Establishment", async () => {
  const bmBandung = await authenticateSsoUser("bm0001@sparta-siaga.local");
  assert.equal(bmBandung.user.businessRole, "bm");
  assert.equal(bmBandung.user.branch, "BANDUNG");
  assert.equal(bmBandung.user.scope, "BRANCH");

  const bmCikokol = await authenticateSsoUser("bm0002@sparta-siaga.local");
  assert.equal(bmCikokol.user.businessRole, "bm");
  assert.equal(bmCikokol.user.branch, "CIKOKOL");
  assert.equal(bmCikokol.user.scope, "BRANCH");

  const hoAdmin = await authenticateSsoUser("budi.santoso@sparta-siaga.local");
  assert.equal(hoAdmin.user.businessRole, "ho_admin");
  assert.equal(hoAdmin.user.scope, "HO");
  assert.equal(hoAdmin.user.branch, null);
});

test("Scenario 2: Earthquake Visibility in Map and Event Feeds", async () => {
  const { cookies } = await authenticateSsoUser("bm0001@sparta-siaga.local");

  const res = await fetch(`${BASE_URL}/api/disasters/earthquakes`, {
    headers: { Cookie: cookies },
  });
  assert.equal(res.status, 200, "GET /api/disasters/earthquakes must return 200");
  const data = await res.json();

  assert.ok(Array.isArray(data.recentEarthquakes), "Feed must contain recentEarthquakes array");
  const found = data.recentEarthquakes.find((e: any) => e.id === EVENT_ID);
  assert.ok(found, "Fixture earthquake must be present in disaster feed");
  assert.equal(found.magnitude, 4.2);
  assert.equal(found.latitude, 0.49701);
  assert.equal(found.longitude, 122.28157);
});

test("Scenario 3: Branch Notification and Detail Notifikasi 19-Store Pagination", async () => {
  const { cookies } = await authenticateSsoUser("bm0001@sparta-siaga.local");

  const res = await fetch(`${BASE_URL}/api/notifications/logs?limit=50`, {
    headers: { Cookie: cookies },
  });
  assert.equal(res.status, 200, "GET /api/notifications/logs must return 200");
  const body = await res.json();

  const notifs = body.logs || body.data || body;
  assert.ok(Array.isArray(notifs), "Must return notification logs array");
  const notif = notifs.find((n: any) => n.disaster_id === EVENT_ID || n.canonical_event_id === EVENT_ID);
  assert.ok(notif, "Notification for EVENT_ID must be present in logs");
  assert.equal(notif.branch, "GORONTALO");
  assert.equal(notif.affected_stores_count, 19);

  // Verify full 19 stores in sample
  const stores = notif.affected_stores_sample || [];
  assert.equal(stores.length, 19, "All 19 stores must be present in affected_stores_sample");

  // Verify pagination behavior identical to IncidentDetailModal:
  // pageSize = 10 -> totalPages = 2
  const pageSize = 10;
  const totalPages = Math.max(1, Math.ceil(stores.length / pageSize));
  assert.equal(totalPages, 2, "19 stores must produce 2 pages");

  // Page 1: items 1-10 (10 stores)
  const page1 = stores.slice((1 - 1) * pageSize, 1 * pageSize);
  assert.equal(page1.length, 10, "Page 1 must contain exactly 10 stores");
  assert.equal(page1[0].kode_toko, "TG001");
  assert.equal(page1[9].kode_toko, "TG010");

  // Page 2: items 11-19 (9 stores)
  const page2 = stores.slice((2 - 1) * pageSize, 2 * pageSize);
  assert.equal(page2.length, 9, "Page 2 must contain exactly 9 stores");
  assert.equal(page2[0].kode_toko, "TG011");
  assert.equal(page2[8].kode_toko, "TG019");

  // No omission or repetition
  const combined = [...page1, ...page2];
  assert.equal(combined.length, 19);
  const uniqueKeys = new Set(combined.map((s: any) => s.kode_toko));
  assert.equal(uniqueKeys.size, 19, "Zero duplicated or dropped stores across pagination pages");
});

test("Scenario 4: Per-Store Inspection Reports Creation in Database", async () => {
  const pool = getIsolatedDbPool();
  const client = await pool.connect();
  try {
    await assertIsolatedDatabase(client);
    const res = await client.query(
      `SELECT id, location_id, location_name_snapshot, branch, report_origin, status
       FROM incidents WHERE canonical_event_id = $1 ORDER BY id`,
      [EVENT_ID]
    );
    assert.equal(res.rows.length, 19, "Exactly 19 inspection reports must exist in incidents table");
    for (const row of res.rows) {
      assert.equal(row.branch, "GORONTALO");
      assert.equal(row.report_origin, "automatic_earthquake");
      assert.equal(row.status, "pending_confirmation");
    }
  } finally {
    client.release();
  }
});

test("Scenario 5: Cross-Branch Access Denial via Direct URL and API Requests", async () => {
  // Bandung BM trying to access Gorontalo incident
  const bandungUser = await authenticateSsoUser("bm0001@sparta-siaga.local");
  assert.equal(bandungUser.user.branch, "BANDUNG");

  // 1. Direct GET /api/incidents/:id for Gorontalo incident
  const directGetRes = await fetch(`${BASE_URL}/api/incidents/${gorontaloIncidentId}`, {
    headers: { Cookie: bandungUser.cookies },
  });
  assert.equal(
    directGetRes.status,
    403,
    "Bandung user must be rejected with 403 Forbidden when requesting Gorontalo incident"
  );
  const directGetBody = await directGetRes.json();
  assert.ok(
    directGetBody.error?.includes("Unauthorized") || directGetBody.error?.includes("ditolak"),
    "Error message must indicate access denied"
  );

  // 2. GET /api/incidents list for Bandung user must not include Gorontalo incidents
  const listRes = await fetch(`${BASE_URL}/api/incidents`, {
    headers: { Cookie: bandungUser.cookies },
  });
  assert.equal(listRes.status, 200);
  const listData = await listRes.json();
  const incidents = listData.data || [];
  const foundGorontalo = incidents.find((i: any) => i.id === gorontaloIncidentId);
  assert.equal(
    foundGorontalo,
    undefined,
    "Bandung user incident list must not leak Gorontalo incidents"
  );

  // 3. Cikokol BM trying to access Gorontalo incident
  const cikokolUser = await authenticateSsoUser("bm0002@sparta-siaga.local");
  assert.equal(cikokolUser.user.branch, "CIKOKOL");

  const directGetCklRes = await fetch(`${BASE_URL}/api/incidents/${gorontaloIncidentId}`, {
    headers: { Cookie: cikokolUser.cookies },
  });
  assert.equal(
    directGetCklRes.status,
    403,
    "Cikokol user must be rejected with 403 Forbidden when requesting Gorontalo incident"
  );
});

test("Scenario 6: Head Office Read-Only Behavior and Write Denial", async () => {
  const hoUser = await authenticateSsoUser("budi.santoso@sparta-siaga.local");
  assert.equal(hoUser.user.scope, "HO");

  // 1. HO can VIEW automatic earthquake report (GET 200) for nationwide situational awareness
  const getRes = await fetch(`${BASE_URL}/api/incidents/${gorontaloIncidentId}`, {
    headers: { Cookie: hoUser.cookies },
  });
  assert.equal(getRes.status, 200, "HO user must be permitted to read automatic earthquake reports");
  const getBody = await getRes.json();
  assert.equal(getBody.data?.id, gorontaloIncidentId);
  assert.equal(getBody.data?.branch, "GORONTALO");

  // 2. HO CANNOT mutate/modify operational report via PATCH (REJECTED 403)
  const patchRes = await fetch(`${BASE_URL}/api/incidents/${gorontaloIncidentId}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Cookie: hoUser.cookies,
    },
    body: JSON.stringify({ priority: "LOW" }),
  });
  assert.equal(
    patchRes.status,
    403,
    "HO user must be blocked with 403 Forbidden from modifying operational reports"
  );
  const patchBody = await patchRes.json();
  assert.ok(
    patchBody.error?.includes("read-only") || patchBody.error?.includes("Head Office"),
    "Error message must indicate HO read-only restriction"
  );

  // 3. HO CANNOT create operational reports via POST /api/incidents (REJECTED 403)
  const postRes = await fetch(`${BASE_URL}/api/incidents`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: hoUser.cookies,
    },
    body: JSON.stringify({
      locationId: "STR_TEST",
      locationName: "Toko Test",
      branch: "BANDUNG",
      category: "Bencana Alam",
      subCategory: "Gempa Bumi",
      priority: "HIGH",
    }),
  });
  assert.equal(
    postRes.status,
    403,
    "HO user must be blocked with 403 Forbidden from creating operational incidents"
  );
  const postBody = await postRes.json();
  assert.equal(postBody.code, "HO_READ_ONLY");
});
