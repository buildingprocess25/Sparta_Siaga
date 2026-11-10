/**
 * SPARTA SIAGA: Earthquake Monitoring-Range V1 Consistency Test Suite
 *
 * Verifies that the monitoring range across feeds, database records, map overlays,
 * and spatial risk assessments strictly adheres to the supervisor-provided V1
 * parameter table (revised 6 November 2026), eliminating the legacy 123/271 km
 * empirical formula.
 *
 * Requirements verified:
 * 1. Single source of truth: lib/earthquake-v1-parameters.ts (pure shared helper).
 * 2. M6.9, depth 34 km -> V1 160 km (NOT 123 km, NOT 271 km).
 * 3. M5.3, depth 20.5 km -> V1 50 km (depth group '>20–30 km').
 * 4. Excluded magnitude/depth combinations -> V1 null, isCovered: false (no zero/default/extrapolation).
 * 5. Magnitude < 4.0 -> V1 null, isCovered: false (monitoring only).
 * 6. Feed parser (BMKG & USGS) outputs V1 160 km for M6.9/34km and null for secondary monitoring radius.
 * 7. assessStoreRisk correctly classifies stores within 160 km as PRIORITY_MONITOR without 2.2x multiplier.
 * 8. Zero server/database dependencies in lib/earthquake-v1-parameters.ts for safe client bundling.
 *
 * Rule: Zero em dashes. Standard hyphens (-) or colons (:) only.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  getV1Coverage,
  getV1DepthGroup,
  isEarthquakeV1Eligible,
} from "../lib/earthquake-v1-parameters";
import {
  calculateSpartaMonitoringZone,
  assessStoreRisk,
} from "../lib/haversine";
import {
  validateAndParseUsgsFeature,
  validateAndParseBmkgRecord,
} from "../lib/disaster-service";
import type { Earthquake } from "../types/disaster";

test("V1 pure shared helper has zero external, node, or database dependencies", () => {
  const filePath = path.resolve(process.cwd(), "lib/earthquake-v1-parameters.ts");
  const fileContent = fs.readFileSync(filePath, "utf8");

  // Check no imports of server-only modules
  assert.ok(!fileContent.includes("from \"pg\""), "Must not import pg");
  assert.ok(!fileContent.includes("from \"node:"), "Must not import node builtins");
  assert.ok(!fileContent.includes("from \"fs\""), "Must not import fs");
  assert.ok(!fileContent.includes("from \"./db\""), "Must not import db");
  assert.ok(!fileContent.includes("process.env"), "Must not access server environment secrets");

  // Verify zero em dashes
  const emDashCount = (fileContent.match(/\u2014/g) || []).length;
  assert.equal(emDashCount, 0, "Must contain strictly zero em dashes");
});

test("Supervisor V1 parameter table produces exact distances across all specified test cases", () => {
  // Case 1: M6.9, depth 34 km -> V1 160 km (Supervisor table: 6.0 <= M < 7.0, depth up to 40 km)
  const lombok = getV1Coverage(6.9, 34);
  assert.equal(lombok.isCovered, true, "M6.9 depth 34 km must be covered by V1");
  assert.equal(lombok.v1DistanceKm, 160, "M6.9 depth 34 km must be 160 km");
  assert.notEqual(lombok.v1DistanceKm, 123, "Must not be legacy 123 km");
  assert.notEqual(lombok.v1DistanceKm, 271, "Must not be legacy 271 km");
  assert.equal(lombok.depthGroup, ">30–40 km");

  // Case 2: M5.3, depth 20.5 km -> V1 50 km (Supervisor table: 5.0 <= M < 6.0, depth up to 30 km)
  const shallow53 = getV1Coverage(5.3, 20.5);
  assert.equal(shallow53.isCovered, true, "M5.3 depth 20.5 km must be covered by V1");
  assert.equal(shallow53.v1DistanceKm, 50, "M5.3 depth 20.5 km must be 50 km");
  assert.equal(shallow53.depthGroup, ">20–30 km");

  // Case 3: Excluded magnitude/depth combinations return isCovered: false and v1DistanceKm: null
  // (Do not convert an unavailable V1 range into zero, a default radius, or an extrapolated value)
  const excludedM45 = getV1Coverage(4.5, 35); // 4.0 <= M < 5.0 only covers up to 30 km
  assert.equal(excludedM45.isCovered, false, "M4.5 depth 35 km is excluded from V1 table");
  assert.equal(excludedM45.v1DistanceKm, null, "Excluded cell must return null, not 0, 50, or default");

  const excludedM55 = getV1Coverage(5.5, 45); // 5.0 <= M < 6.0 only covers up to 30 km
  assert.equal(excludedM55.isCovered, false, "M5.5 depth 45 km is excluded from V1 table");
  assert.equal(excludedM55.v1DistanceKm, null, "Excluded cell must return null");

  const excludedM65 = getV1Coverage(6.5, 55); // 6.0 <= M < 7.0 only covers up to 40 km
  assert.equal(excludedM65.isCovered, false, "M6.5 depth 55 km is excluded from V1 table");
  assert.equal(excludedM65.v1DistanceKm, null, "Excluded cell must return null");

  const excludedM75 = getV1Coverage(7.5, 65); // 7.0 <= M < 8.0 only covers up to 50 km
  assert.equal(excludedM75.isCovered, false, "M7.5 depth 65 km is excluded from V1 table");
  assert.equal(excludedM75.v1DistanceKm, null, "Excluded cell must return null");

  // Case 4: M < 4.0 -> Monitoring only (isCovered: false, v1DistanceKm: null)
  const minorEq = getV1Coverage(3.8, 10);
  assert.equal(minorEq.isCovered, false, "M3.8 is below 4.0 threshold");
  assert.equal(minorEq.v1DistanceKm, null, "Below M4.0 must have null V1 distance");
  assert.equal(isEarthquakeV1Eligible(3.8), false, "M3.8 must not be eligible for automatic workflow");

  // Case 5: M >= 8.0 -> All depth groups covered (250 km)
  const majorDeep = getV1Coverage(8.3, 120);
  assert.equal(majorDeep.isCovered, true, "M >= 8.0 covers all depths");
  assert.equal(majorDeep.v1DistanceKm, 250, "M >= 8.0 distance is 250 km");
});

test("calculateSpartaMonitoringZone delegates to V1 table without legacy exponential formula or 2.2x multiplier", () => {
  // M6.9, depth 34 km
  const zonesLombok = calculateSpartaMonitoringZone(6.9, 34);
  assert.equal(zonesLombok.priorityRadiusKm, 160, "Priority radius must be 160 km from V1 table");
  assert.notEqual(zonesLombok.priorityRadiusKm, 123, "Must not be legacy 123 km");
  assert.notEqual(zonesLombok.monitoringRadiusKm, 271, "Must not invent 271 km secondary radius");

  // M5.3, depth 20.5 km
  const zones53 = calculateSpartaMonitoringZone(5.3, 20.5);
  assert.equal(zones53.priorityRadiusKm, 50, "Priority radius must be 50 km from V1 table");

  // M3.5 depth 10 km (below 4.0)
  const zonesMinor = calculateSpartaMonitoringZone(3.5, 10);
  assert.equal(zonesMinor.priorityRadiusKm, 0, "Below M4.0 has 0 V1 operational distance");
});

test("Feed parsers populate agreed V1 fields and eliminate legacy 123/271 km values", () => {
  // Mock USGS feature for Lombok 2018 (M6.9, depth 34 km)
  const usgsFeature = {
    id: "us1000g3ub",
    properties: {
      mag: 6.9,
      place: "Lombok Region, Indonesia",
      time: Date.now() - 60_000,
      tsunami: 0,
      title: "M 6.9 - Lombok Region, Indonesia",
    },
    geometry: {
      type: "Point",
      coordinates: [116.45, -8.28, 34.0], // lon, lat, depth
    },
  };

  const parsedUsgs = validateAndParseUsgsFeature(usgsFeature);
  assert.ok(parsedUsgs, "USGS feature must parse successfully");
  assert.equal(parsedUsgs.magnitude, 6.9);
  assert.equal(parsedUsgs.depthKm, 34);

  // V1 distance must be 160 km, NOT 123 km or 271 km
  assert.equal(parsedUsgs.v1DistanceKm, 160, "Parsed V1 distance must be 160 km");
  assert.equal(parsedUsgs.priorityRadiusKm, 160, "priorityRadiusKm must reflect V1 160 km for backward compatibility");
  assert.equal(parsedUsgs.monitoringRadiusKm, null, "monitoringRadiusKm must be null (no invented 2.2x multiplier)");
  assert.equal(parsedUsgs.v1Coverage?.isCovered, true);
  assert.equal(parsedUsgs.v1Coverage?.depthGroup, ">30–40 km");

  // Mock BMKG record for Cianjur (M5.6, depth 10 km)
  const bmkgRecord = {
    Tanggal: "21 Nov 2022",
    Jam: "13:21:10 WIB",
    DateTime: "2022-11-21T06:21:10+00:00",
    Coordinates: "-6.85,107.05",
    Lintang: "6.85 LS",
    Bujur: "107.05 BT",
    Magnitude: "5.6",
    Kedalaman: "10 km",
    Wilayah: "Cianjur, Jawa Barat",
    Potensi: "Tidak berpotensi tsunami",
  };

  const parsedBmkg = validateAndParseBmkgRecord(bmkgRecord);
  assert.ok(parsedBmkg, "BMKG record must parse successfully");
  assert.equal(parsedBmkg.magnitude, 5.6);
  assert.equal(parsedBmkg.depthKm, 10);
  assert.equal(parsedBmkg.v1DistanceKm, 50, "M5.6 depth 10 km must have V1 distance 50 km");
  assert.equal(parsedBmkg.priorityRadiusKm, 50);
  assert.equal(parsedBmkg.monitoringRadiusKm, null);
  assert.equal(parsedBmkg.v1Coverage?.depthGroup, "0–10 km");

  // Mock BMKG record for minor event (M3.5, depth 8 km)
  const bmkgMinor = {
    Tanggal: "01 Jan 2026",
    Jam: "10:00:00 WIB",
    DateTime: "2026-01-01T03:00:00+00:00",
    Coordinates: "-7.00,110.00",
    Magnitude: "3.5",
    Kedalaman: "8 km",
    Wilayah: "Jawa Tengah",
  };

  const parsedMinor = validateAndParseBmkgRecord(bmkgMinor);
  assert.ok(parsedMinor, "Minor BMKG record must parse");
  assert.equal(parsedMinor.v1DistanceKm, null, "Minor event must have null V1 distance");
  assert.equal(parsedMinor.priorityRadiusKm, null);
  assert.equal(parsedMinor.monitoringRadiusKm, null);
  assert.equal(parsedMinor.v1Coverage?.isCovered, false);
});

test("assessStoreRisk evaluates store spatial risk using V1 parameter table", () => {
  // Lombok epicenter at lat -8.28, lon 116.45 (M6.9, depth 34 km -> V1 = 160 km)
  const lombokEvent: Earthquake = {
    id: "usgs-lombok-test",
    source: "USGS",
    title: "M 6.9 - Lombok",
    magnitude: 6.9,
    depth: "34 km",
    depthKm: 34,
    latitude: -8.28,
    longitude: 116.45,
    timestamp: Date.now(),
    time: "2018-08-05T11:46:35Z",
    potensiTsunami: false,
    v1DistanceKm: 160,
    priorityRadiusKm: 160,
  };

  // Store A: 140 km from epicenter (Inside V1 160 km)
  // Coordinates approx lat -8.4, lon 115.2 (around Denpasar, Bali, ~140 km)
  const storeA = { latitude: -8.40, longitude: 115.20 };
  const riskA = assessStoreRisk(storeA, [lombokEvent]);
  assert.equal(riskA.spatialRisk, "PRIORITY_MONITOR", "Store at ~140 km is within V1 160 km and must be PRIORITY_MONITOR");
  assert.ok(riskA.distanceFromEventKm! <= 160, "Distance must be <= 160 km");

  // Store B: 180 km from epicenter (Outside V1 160 km with unavailable MMI)
  // Distance alone describes whether a store is inside or outside V1
  // Outside V1 with unavailable MMI is explicitly unknown/unassessed, NEVER automatically SAFE
  const storeB = { latitude: -8.50, longitude: 114.80 };
  const riskB = assessStoreRisk(storeB, [lombokEvent]);
  assert.equal(riskB.isInsideV1, false, "Store at ~180 km must have isInsideV1: false");
  assert.equal(riskB.spatialRisk, "UNASSESSED", "Store outside V1 with unavailable MMI must be UNASSESSED, never SAFE");
  assert.equal(riskB.intensityStatus, "UNASSESSED");

  // Store B2: Outside V1 (180 km) but with official MMI >= 6.0 (e.g. MMI 6.5)
  // Official MMI >= 6.0 outside V1 remains visible as meeting the intensity threshold
  const storeB2 = { latitude: -8.50, longitude: 114.80, officialMmi: 6.5 };
  const riskB2 = assessStoreRisk(storeB2, [lombokEvent]);
  assert.equal(riskB2.isInsideV1, false, "Distance alone describes being outside V1");
  assert.equal(riskB2.spatialRisk, "PRIORITY_MONITOR", "Official MMI >= 6.0 outside V1 meets intensity threshold");
  assert.equal(riskB2.intensityStatus, "INTENSITY_TRIGGERED");

  // Store B3: Outside V1 (180 km) with official MMI 4.2 (< 6.0)
  // MMI below 6.0 means below automatic inspection threshold, NOT proof of physical safety
  const storeB3 = { latitude: -8.50, longitude: 114.80, officialMmi: 4.2 };
  const riskB3 = assessStoreRisk(storeB3, [lombokEvent]);
  assert.equal(riskB3.isInsideV1, false);
  assert.equal(riskB3.spatialRisk, "UNASSESSED", "Outside V1 with MMI < 6.0 remains UNASSESSED (never safe)");
  assert.equal(riskB3.intensityStatus, "BELOW_INSPECTION_THRESHOLD");

  // Store C: Evaluated against a minor earthquake (M3.5, depth 10 km)
  // Below M4.0 has no applicable V1 range (v1DistanceKm: null); intensity unassessed
  const minorEvent: Earthquake = {
    id: "bmkg-minor-test",
    source: "BMKG",
    title: "M 3.5 - Minor",
    magnitude: 3.5,
    depth: "10 km",
    depthKm: 10,
    latitude: -6.90,
    longitude: 107.60,
    timestamp: Date.now(),
    time: "2026-01-01T00:00:00Z",
    potensiTsunami: false,
    v1DistanceKm: null,
  };
  const storeC = { latitude: -6.91, longitude: 107.61 }; // Very close (1.5 km)
  const riskC = assessStoreRisk(storeC, [minorEvent]);
  assert.equal(riskC.isInsideV1, false, "Below M4.0 has no applicable V1 range");
  assert.equal(riskC.spatialRisk, "UNASSESSED", "Minor event store remains UNASSESSED, not automatically SAFE");

  // Store D: When there are ZERO active earthquakes
  const riskD = assessStoreRisk(storeA, []);
  assert.equal(riskD.spatialRisk, "SAFE", "Store with zero active earthquakes is SAFE");
});

