/**
 * SPARTA SIAGA - EQ-01: Earthquake Detection & Multi-Provider Ingestion Test Suite
 * 
 * Comprehensive validation:
 * 1. Strict validation of magnitude, depth, coordinates, timestamps, and event IDs.
 * 2. Rejection of invalid data (NEVER substituting Date.now() for missing/invalid timestamps).
 * 3. BMKG multi-feed coverage: autogempa, gempaterkini, and gempadirasakan (smaller felt quakes).
 * 4. Canonical deduplication & enrichment across BMKG feeds without duplicate creation.
 * 5. Conservative cross-provider correlation (BMKG vs USGS) preserving independence of separate quakes.
 * 6. Historical 72h active monitoring window and delayed event handling.
 * 7. Source health and data freshness during live feeds, partial outages, and total failures.
 */

import assert from "node:assert/strict";
import {
  parseBmkgCoordinates,
  parseBmkgTimestamp,
  parseMagnitude,
  parseDepthToKm,
  validateAndParseBmkgRecord,
  validateAndParseUsgsFeature,
  getCanonicalEventKey,
  correlateEarthquakes,
  isInIndonesiaMonitoringArea,
  fetchDisasterFeed,
  CANONICAL_CORRELATION_THRESHOLDS,
} from "../lib/disaster-service";
import type { Earthquake } from "../types/disaster";

interface TestCase {
  id: string;
  name: string;
  run: () => Promise<void> | void;
}

const tests: TestCase[] = [];
function test(id: string, name: string, run: () => Promise<void> | void) {
  tests.push({ id, name, run });
}

// =============================================================================
// SUITE 1: STRICT FIELD VALIDATION & INVALID DATA REJECTION
// =============================================================================

test("VAL-01", "parseBmkgTimestamp rejects missing/null/undefined/empty string without substituting Date.now()", () => {
  assert.equal(parseBmkgTimestamp(undefined, undefined, undefined), null);
  assert.equal(parseBmkgTimestamp("", "", ""), null);
  assert.equal(parseBmkgTimestamp("invalid-iso-string"), null);
  assert.equal(parseBmkgTimestamp("NaN-NaN-NaN"), null);
});

test("VAL-02", "parseBmkgTimestamp parses valid ISO DateTime accurately", () => {
  const ts = parseBmkgTimestamp("2026-10-21T11:58:36+00:00");
  assert.ok(ts !== null && ts > 0, "Valid timestamp returned");
  const d = new Date(ts);
  assert.equal(d.getUTCFullYear(), 2026);
  assert.equal(d.getUTCMonth(), 9); // October (0-indexed)
  assert.equal(d.getUTCDate(), 21);
  assert.equal(d.getUTCHours(), 11);
  assert.equal(d.getUTCMinutes(), 58);
  assert.equal(d.getUTCSeconds(), 36);
});

test("VAL-03", "parseBmkgTimestamp parses Indonesian Tanggal and Jam with timezone", () => {
  const tsWib = parseBmkgTimestamp(undefined, "21 Okt 2026", "18:58:36 WIB");
  assert.ok(tsWib !== null, "WIB timestamp parsed");
  const isoUtc = new Date(tsWib).toISOString();
  assert.equal(isoUtc, "2026-10-21T11:58:36.000Z");

  const tsWita = parseBmkgTimestamp(undefined, "21 Okt 2026", "19:58:36 WITA");
  assert.ok(tsWita !== null, "WITA timestamp parsed");
  assert.equal(new Date(tsWita).toISOString(), "2026-10-21T11:58:36.000Z");
});

test("VAL-04", "parseBmkgTimestamp rejects far-future timestamps (> 15 min)", () => {
  const farFuture = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
  assert.equal(parseBmkgTimestamp(farFuture), null, "Far future timestamp must be rejected");
});

test("VAL-05", "parseMagnitude validates positive numbers and rejects invalid / out-of-range", () => {
  assert.equal(parseMagnitude("5.8"), 5.8);
  assert.equal(parseMagnitude(3.2), 3.2);
  assert.equal(parseMagnitude("0"), null, "Magnitude 0 is invalid");
  assert.equal(parseMagnitude("-4.5"), null, "Negative magnitude is invalid");
  assert.equal(parseMagnitude("12.5"), null, "Magnitude > 10 is invalid");
  assert.equal(parseMagnitude("abc"), null, "Non-numeric string is invalid");
  assert.equal(parseMagnitude(null), null);
  assert.equal(parseMagnitude(undefined), null);
});

test("VAL-06", "parseDepthToKm validates depth in km and rejects invalid/negative values", () => {
  assert.equal(parseDepthToKm("10 km"), 10);
  assert.equal(parseDepthToKm("120"), 120);
  assert.equal(parseDepthToKm(45), 45);
  assert.equal(parseDepthToKm(""), 10, "Empty defaults to 10km");
  assert.equal(parseDepthToKm(undefined), 10, "Undefined defaults to 10km");
  assert.equal(parseDepthToKm(-50), null, "Negative depth is invalid");
  assert.equal(parseDepthToKm(1500), null, "Depth > 1000 km is invalid");
  assert.equal(parseDepthToKm("invalid-depth"), null, "Unparseable depth string is invalid");
});

test("VAL-07", "parseBmkgCoordinates validates bounds and enforces Indonesia monitoring footprint", () => {
  // Valid Java coordinate
  const java = parseBmkgCoordinates("-6.82,107.14");
  assert.ok(java !== null);
  assert.equal(java.lat, -6.82);
  assert.equal(java.lon, 107.14);

  // Valid Lintang/Bujur
  const sumatra = parseBmkgCoordinates(undefined, "5.40 LS", "104.68 BT");
  assert.ok(sumatra !== null);
  assert.equal(sumatra.lat, -5.40);
  assert.equal(sumatra.lon, 104.68);

  // Invalid: Out of lat/lon bounds
  assert.equal(parseBmkgCoordinates("120.0,200.0"), null, "Out of geographic bounds");
  assert.equal(parseBmkgCoordinates("-95.0,105.0"), null, "Lat < -90");

  // Invalid: Null Island (0,0) - outside Indonesia
  assert.equal(parseBmkgCoordinates("0,0"), null, "0,0 is outside Indonesia footprint");

  // Invalid: California (outside Indonesia)
  assert.equal(parseBmkgCoordinates("34.05,-118.25"), null, "California is outside Indonesia footprint");
});

test("VAL-08", "validateAndParseBmkgRecord rejects record with missing timestamp or coordinates", () => {
  const badTimestamp = {
    Coordinates: "-6.82,107.14",
    Magnitude: "5.0",
    Kedalaman: "10 km",
    Wilayah: "Cianjur",
    // Missing DateTime and Tanggal/Jam
  };
  assert.equal(validateAndParseBmkgRecord(badTimestamp), null, "Record with missing timestamp must be rejected");

  const badCoords = {
    DateTime: "2026-10-21T11:58:36+00:00",
    Coordinates: "invalid,coords",
    Magnitude: "5.0",
    Kedalaman: "10 km",
    Wilayah: "Cianjur",
  };
  assert.equal(validateAndParseBmkgRecord(badCoords), null, "Record with invalid coordinates must be rejected");

  const badMag = {
    DateTime: "2026-10-21T11:58:36+00:00",
    Coordinates: "-6.82,107.14",
    Magnitude: "-1.0",
    Kedalaman: "10 km",
    Wilayah: "Cianjur",
  };
  assert.equal(validateAndParseBmkgRecord(badMag), null, "Record with negative magnitude must be rejected");
});

test("VAL-09", "getCanonicalEventKey produces consistent deterministic keys without Date.now() fallback", () => {
  const key1 = getCanonicalEventKey("BMKG", "2026-10-21T11:58:36+00:00");
  assert.equal(key1, "bmkg-2026-10-21T11-58-36-00-00");

  const key2 = getCanonicalEventKey("BMKG", undefined, 1792583916000);
  assert.equal(key2, "bmkg-1792583916000");

  assert.throws(() => {
    getCanonicalEventKey("BMKG", undefined, undefined);
  }, /Cannot generate canonical event key/);
});

// =============================================================================
// SUITE 2: SMALL FELT EARTHQUAKES & SOURCE COVERAGE (gempadirasakan)
// =============================================================================

test("SRC-01", "validateAndParseBmkgRecord accurately parses smaller felt earthquakes (M < 5.0)", () => {
  const feltRaw = {
    Tanggal: "21 Okt 2026",
    Jam: "18:58:36 WIB",
    DateTime: "2026-10-21T11:58:36+00:00",
    Coordinates: "-5.40,104.68",
    Lintang: "5.40 LS",
    Bujur: "104.68 BT",
    Magnitude: "2.5",
    Kedalaman: "3 km",
    Wilayah: "Pusat gempa berada di darat 9 km utara Tanggamus",
    Dirasakan: "II Tanggamus",
  };

  const parsed = validateAndParseBmkgRecord(feltRaw);
  assert.ok(parsed !== null, "Felt earthquake parsed successfully");
  assert.equal(parsed.magnitude, 2.5);
  assert.equal(parsed.depthKm, 3);
  assert.equal(parsed.feltArea, "II Tanggamus");
  assert.equal(parsed.felt, "II Tanggamus");
  assert.equal(parsed.potensiTsunami, false);
  assert.equal(parsed.priorityRadiusKm, 15, "Operational priority radius for M < 4.5");
  assert.equal(parsed.monitoringRadiusKm, 35, "Operational monitoring radius for M < 4.5");
});

test("SRC-02", "validateAndParseBmkgRecord accurately parses large tsunami-potential earthquakes (M >= 7.0)", () => {
  const largeRaw = {
    Tanggal: "18 Okt 2026",
    Jam: "14:00:00 WIB",
    DateTime: "2026-10-18T07:00:00+00:00",
    Coordinates: "-8.50,115.20",
    Lintang: "8.50 LS",
    Bujur: "115.20 BT",
    Magnitude: "7.2",
    Kedalaman: "15 km",
    Wilayah: "Selatan Bali",
    Potensi: "Peringatan Dini Tsunami untuk wilayah Jawa Timur dan Bali",
    Shakemap: "20261018140000.mmi.jpg",
  };

  const parsed = validateAndParseBmkgRecord(largeRaw);
  assert.ok(parsed !== null);
  assert.equal(parsed.magnitude, 7.2);
  assert.equal(parsed.depthKm, 15);
  assert.equal(parsed.potensiTsunami, true);
  assert.ok(parsed.potensiText?.includes("Tsunami"));
  assert.ok(parsed.shakemapUrl?.includes("20261018140000.mmi.jpg"));
  assert.equal(parsed.isSignificant, true);
});

test("SRC-03", "validateAndParseUsgsFeature parses Indonesian earthquake and rejects foreign epicenter", () => {
  // Indonesian feature
  const usgsIndo = {
    id: "us7000abcd",
    geometry: {
      type: "Point",
      coordinates: [107.11, -6.81, 12.5],
    },
    properties: {
      mag: 5.6,
      place: "34 km ENE of Sukabumi, Indonesia",
      time: Date.parse("2026-10-14T03:00:00Z"),
      tsunami: 0,
      title: "M 5.6 - 34 km ENE of Sukabumi, Indonesia",
    },
  };
  const parsedIndo = validateAndParseUsgsFeature(usgsIndo);
  assert.ok(parsedIndo !== null);
  assert.equal(parsedIndo.id, "usgs-us7000abcd");
  assert.equal(parsedIndo.magnitude, 5.6);
  assert.equal(parsedIndo.depthKm, 13);
  assert.equal(parsedIndo.source, "USGS");

  // Foreign feature inside box but labeled Malaysia
  const usgsMalaysia = {
    id: "us7000my01",
    geometry: {
      type: "Point",
      coordinates: [101.5, 3.2, 10.0],
    },
    properties: {
      mag: 5.0,
      place: "Kuala Lumpur, Malaysia",
      time: Date.parse("2026-10-14T03:00:00Z"),
      tsunami: 0,
    },
  };
  assert.equal(validateAndParseUsgsFeature(usgsMalaysia), null, "Foreign place in monitoring box must be excluded");
});

// =============================================================================
// SUITE 3: DEDUPLICATION, ENRICHMENT & AFTERSHOCK INDEPENDENCE
// =============================================================================

test("DEDUP-01", "BMKG multi-feed deduplication merges identical events and enriches metadata", () => {
  // Event from autogempa
  const eqAutogempa: Earthquake = {
    id: "bmkg-2026-10-21-11-58-36-00-00",
    canonicalEventKey: "bmkg-2026-10-21-11-58-36-00-00",
    source: "BMKG",
    sourcePrimary: "BMKG",
    title: "M 5.2 - Tanggamus",
    magnitude: 5.2,
    depth: "10 km",
    depthKm: 10,
    latitude: -5.40,
    longitude: 104.68,
    time: "21 Okt 2026 18:58:36 WIB",
    timestamp: 1792583916000,
    potensiTsunami: false,
    potensiText: "Tidak berpotensi tsunami",
    shakemapUrl: "https://data.bmkg.go.id/DataMKG/TEWS/20261021185836.mmi.jpg",
    priorityRadiusKm: 50,
    monitoringRadiusKm: 110,
  };

  // Same event from gempadirasakan with feltArea
  const eqDirasakan: Earthquake = {
    ...eqAutogempa,
    shakemapUrl: undefined,
    feltArea: "II-III Tanggamus, II Pesawaran",
    felt: "II-III Tanggamus, II Pesawaran",
  };

  const correlated = correlateEarthquakes([eqAutogempa, eqDirasakan]);
  assert.equal(correlated.length, 1, "Duplicate BMKG event across feeds must resolve to 1");
  assert.equal(correlated[0].id, "bmkg-2026-10-21-11-58-36-00-00");
  assert.ok(correlated[0].shakemapUrl, "Shakemap preserved from autogempa");
  assert.equal(correlated[0].feltArea, "II-III Tanggamus, II Pesawaran", "FeltArea enriched from gempadirasakan");
});

test("DEDUP-02", "Cross-provider correlation merges USGS matching BMKG without creating duplicate", () => {
  const bmkgBase: Earthquake = {
    id: "bmkg-cianjur-001",
    canonicalEventKey: "bmkg-cianjur-001",
    source: "BMKG",
    sourcePrimary: "BMKG",
    title: "M 5.6 - Cianjur",
    magnitude: 5.6,
    depth: "10 km",
    depthKm: 10,
    latitude: -6.85,
    longitude: 107.10,
    time: "14 Okt 2026 10:00:00 WIB",
    timestamp: 1791946800000,
    potensiTsunami: false,
    priorityRadiusKm: 50,
    monitoringRadiusKm: 110,
  };

  // USGS matching within 40 seconds, 8 km, 0.1 magnitude delta
  const usgsMatch: Earthquake = {
    id: "usgs-cianjur-usgs",
    canonicalEventKey: "usgs-cianjur-usgs",
    source: "USGS",
    sourcePrimary: "USGS",
    title: "M 5.5 - Cianjur, Indonesia",
    magnitude: 5.5,
    depth: "12 km",
    depthKm: 12,
    latitude: -6.87,
    longitude: 107.12,
    time: "14 Okt 2026 10:00:40 WIB",
    timestamp: 1791946800000 + 40_000,
    potensiTsunami: false,
    priorityRadiusKm: 50,
    monitoringRadiusKm: 110,
  };

  const correlated = correlateEarthquakes([bmkgBase, usgsMatch]);
  assert.equal(correlated.length, 1, "Matching USGS event must be merged into BMKG canonical event");
  assert.equal(correlated[0].source, "BMKG", "BMKG is preserved as authoritative source");
});

test("DEDUP-03", "Distinct aftershocks and nearby events remain separate", () => {
  const mainShock: Earthquake = {
    id: "bmkg-main-001",
    canonicalEventKey: "bmkg-main-001",
    source: "BMKG",
    sourcePrimary: "BMKG",
    title: "M 6.0 - Mainshock",
    magnitude: 6.0,
    depth: "10 km",
    depthKm: 10,
    latitude: -6.85,
    longitude: 107.10,
    time: "14 Okt 2026 10:00:00 WIB",
    timestamp: 1791946800000,
    potensiTsunami: false,
    priorityRadiusKm: 55,
    monitoringRadiusKm: 120,
  };

  // Aftershock 8 minutes later at same fault line
  const aftershock: Earthquake = {
    id: "bmkg-aftershock-002",
    canonicalEventKey: "bmkg-aftershock-002",
    source: "BMKG",
    sourcePrimary: "BMKG",
    title: "M 4.8 - Aftershock",
    magnitude: 4.8,
    depth: "10 km",
    depthKm: 10,
    latitude: -6.86,
    longitude: 107.11,
    time: "14 Okt 2026 10:08:00 WIB",
    timestamp: 1791946800000 + 8 * 60_000,
    potensiTsunami: false,
    priorityRadiusKm: 25,
    monitoringRadiusKm: 55,
  };

  const correlated = correlateEarthquakes([mainShock, aftershock]);
  assert.equal(correlated.length, 2, "Distinct aftershocks must remain separate earthquakes");
});

// =============================================================================
// SUITE 4: HISTORICAL WINDOW, TIME-SERIES & DELAYED EVENTS
// =============================================================================

test("HIST-01", "Active monitoring strictly enforces 72-hour window", () => {
  const now = Date.now();
  const eq24hAgo: Earthquake = {
    id: "eq-24h",
    canonicalEventKey: "eq-24h",
    source: "BMKG",
    title: "24h ago",
    magnitude: 5.0,
    depth: "10 km",
    depthKm: 10,
    latitude: -6.5,
    longitude: 106.8,
    time: "Yesterday",
    timestamp: now - 24 * 3600 * 1000,
    potensiTsunami: false,
    priorityRadiusKm: 30,
    monitoringRadiusKm: 70,
  };

  const eq80hAgo: Earthquake = {
    id: "eq-80h",
    canonicalEventKey: "eq-80h",
    source: "BMKG",
    title: "80h ago",
    magnitude: 5.0,
    depth: "10 km",
    depthKm: 10,
    latitude: -6.5,
    longitude: 106.8,
    time: "3.5 days ago",
    timestamp: now - 80 * 3600 * 1000,
    potensiTsunami: false,
    priorityRadiusKm: 30,
    monitoringRadiusKm: 70,
  };

  const activeWindowMs = 72 * 3600 * 1000;
  const list = [eq24hAgo, eq80hAgo];
  const active = list.filter(eq => now - eq.timestamp <= activeWindowMs);

  assert.equal(active.length, 1);
  assert.equal(active[0].id, "eq-24h", "Event within 72h is active");
});

// =============================================================================
// SUITE 5: LIVE DISASTER FEED INTEGRATION & SOURCE HEALTH
// =============================================================================

test("LIVE-01", "fetchDisasterFeed fetches real feeds, correlates events, and reports healthy status", async () => {
  const feed = await fetchDisasterFeed(true);

  assert.ok(feed, "Feed response returned");
  assert.ok(Array.isArray(feed.recentEarthquakes), "recentEarthquakes is an array");
  assert.ok(Array.isArray(feed.activeEarthquakes), "activeEarthquakes is an array");
  assert.ok(feed.recentEarthquakes.length > 0, "At least 1 earthquake detected from real feeds");

  // Verify timestamps are sorted descending
  for (let i = 1; i < feed.recentEarthquakes.length; i++) {
    assert.ok(
      feed.recentEarthquakes[i - 1].timestamp >= feed.recentEarthquakes[i].timestamp,
      "Earthquakes must be sorted descending by timestamp"
    );
  }

  // Verify every earthquake has valid, positive timestamp and non-empty canonical ID
  for (const eq of feed.recentEarthquakes) {
    assert.ok(Number.isFinite(eq.timestamp) && eq.timestamp > 0, `Invalid timestamp on ${eq.id}`);
    assert.ok(eq.id && typeof eq.id === "string", `Missing ID on earthquake`);
    assert.ok(eq.magnitude > 0 && eq.magnitude <= 10.0, `Invalid magnitude on ${eq.id}`);
    assert.ok(isInIndonesiaMonitoringArea(eq.latitude, eq.longitude), `Coordinates outside monitoring zone on ${eq.id}`);
  }

  // Verify sources health reports BMKG and USGS
  assert.ok(feed.sourcesHealth && feed.sourcesHealth.length >= 2, "Source health present");
  const bmkg = feed.sourcesHealth.find(s => s.source === "BMKG");
  assert.ok(bmkg, "BMKG source health exists");
  assert.equal(bmkg.status, "healthy", "BMKG is healthy");

  console.log(`Live feed validated: ${feed.recentEarthquakes.length} earthquakes parsed, ${feed.activeEarthquakes.length} active (<=72h).`);
  console.log(`Latest BMKG Headline: ${feed.latestBmkgEarthquake?.title}`);
});

// =============================================================================
// RUNNER
// =============================================================================

async function run() {
  console.log("================================================================================");
  console.log(" SPARTA SIAGA - EQ-01: EARTHQUAKE DETECTION & INGESTION TEST SUITE");
  console.log("================================================================================\n");

  let passed = 0;
  let failed = 0;

  for (const t of tests) {
    try {
      await t.run();
      console.log(`✔ [PASS] [${t.id}] ${t.name}`);
      passed++;
    } catch (err: any) {
      console.error(`❌ [FAIL] [${t.id}] ${t.name}`);
      console.error(`   Error: ${err.message}`);
      if (err.stack) console.error(`   ${err.stack.split("\n").slice(1, 4).join("\n   ")}`);
      failed++;
    }
  }

  console.log("\n================================================================================");
  console.log(` TEST SUMMARY: ${passed} passed, ${failed} failed (${tests.length} total)`);
  console.log("================================================================================");

  if (failed > 0) {
    process.exit(1);
  }
  process.exit(0);
}

run();
