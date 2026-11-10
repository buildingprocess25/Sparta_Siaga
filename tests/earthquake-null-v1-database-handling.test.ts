/**
 * SPARTA SIAGA: Null V1 Database Handling & UAT Integration Test Suite
 *
 * Requirements:
 * 1. Verify actual database constraints on earthquake_events radius columns.
 * 2. In verified isolated UAT (sparta_siaga_isolated), test persistence and retrieval for:
 *    - M3.8, depth 10 km (below 4.0 threshold: monitoring only).
 *    - M4.5, depth 35 km (depth > 30 km: excluded from V1 table).
 * 3. Confirm both earthquakes remain recorded and visible.
 * 4. Confirm V1 remains null / not applicable (no default radius 50/110 or extrapolation).
 * 5. Confirm stores evaluated against these events receive UNASSESSED (never automatic SAFE).
 * 6. Report any conflict with existing storage columns and verify the explicit compatible representation.
 *
 * Rule: Zero em dashes. Standard hyphens (-) or colons (:) only.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { getOperationalDbPool } from "../lib/db";
import { assertSimulationAllowed } from "../lib/environment-policy";
import { getV1Coverage } from "../lib/earthquake-v1-parameters";
import { assessStoreRisk } from "../lib/haversine";
import {
  dbUpsertEarthquakeEvent,
  dbGetEarthquakeEventById,
  dbGetRecentEarthquakeEvents,
} from "../lib/earthquake-db";
import type { Earthquake } from "../types/disaster";

test("Database Schema Check: Verify radius column constraints in isolated database", async () => {
  assertSimulationAllowed();
  const pool = getOperationalDbPool();

  const connCheck = await pool.query("SELECT current_database() as db_name, current_user as db_user");
  const dbName = connCheck.rows[0].db_name;
  assert.equal(dbName, "sparta_siaga_isolated", "Must target isolated UAT database");

  // Query actual constraints from information_schema
  const { rows } = await pool.query(`
    SELECT column_name, is_nullable, column_default, data_type 
    FROM information_schema.columns 
    WHERE table_name = 'earthquake_events' 
      AND column_name IN ('priority_radius_km', 'monitoring_radius_km')
    ORDER BY column_name
  `);

  assert.equal(rows.length, 2, "Both priority_radius_km and monitoring_radius_km columns must exist");
  
  const monitoringCol = rows.find((r) => r.column_name === "monitoring_radius_km");
  const priorityCol = rows.find((r) => r.column_name === "priority_radius_km");

  // Document actual column constraints:
  // Both columns have NOT NULL constraint without default values.
  assert.equal(monitoringCol?.is_nullable, "NO", "monitoring_radius_km is NOT NULL in database schema");
  assert.equal(priorityCol?.is_nullable, "NO", "priority_radius_km is NOT NULL in database schema");
  assert.equal(monitoringCol?.data_type, "integer", "monitoring_radius_km is integer type");
  assert.equal(priorityCol?.data_type, "integer", "priority_radius_km is integer type");
});

test("Null V1 Case 1: M3.8, depth 10 km (Below M4.0 threshold: monitoring only)", async () => {
  assertSimulationAllowed();
  const pool = getOperationalDbPool();

  const eventId = `test-eq-uat-m38-${Date.now()}`;
  const now = Date.now();

  // 1. Evaluate V1 coverage
  const coverage = getV1Coverage(3.8, 10);
  assert.equal(coverage.isCovered, false, "M3.8 must have isCovered: false");
  assert.equal(coverage.v1DistanceKm, null, "M3.8 must have v1DistanceKm: null");
  assert.equal(coverage.depthGroup, "0–10 km");

  const eqRecord: Earthquake = {
    id: eventId,
    canonicalEventKey: eventId,
    source: "BMKG",
    sourcePrimary: "BMKG",
    title: "Gempa Bumi M 3.8 - UAT Persistence Verification",
    magnitude: 3.8,
    depth: "10 km",
    depthKm: 10,
    latitude: -6.900,
    longitude: 107.600,
    time: new Date(now).toISOString(),
    timestamp: now,
    potensiTsunami: false,
    v1DistanceKm: coverage.v1DistanceKm,
    v1Coverage: coverage,
    priorityRadiusKm: coverage.v1DistanceKm,
    monitoringRadiusKm: null,
  };

  try {
    // 2. Persist to database
    await dbUpsertEarthquakeEvent(eqRecord);

    // Verify row was written to database
    const directRow = await pool.query(
      "SELECT id, magnitude, depth_km, priority_radius_km, monitoring_radius_km, raw_metadata FROM earthquake_events WHERE id = $1",
      [eventId]
    );
    assert.equal(directRow.rows.length, 1, "Earthquake must be persisted");
    const raw = directRow.rows[0];
    assert.equal(Number(raw.magnitude), 3.8);
    assert.equal(Number(raw.depth_km), 10);
    // Explicit compatible representation: 0 stored in integer NOT NULL column
    assert.equal(raw.priority_radius_km, 0, "Integer NOT NULL column stores 0 as compatible representation");
    assert.equal(raw.monitoring_radius_km, 0, "Integer NOT NULL column stores 0 as compatible representation");

    // 3. Retrieve via dbGetRecentEarthquakeEvents
    const recentEvents = await dbGetRecentEarthquakeEvents(24);
    const retrieved = recentEvents.find((e) => e.id === eventId);
    assert.ok(retrieved, "Earthquake must be visible in recent events");
    assert.equal(retrieved.magnitude, 3.8);
    assert.equal(retrieved.depthKm, 10);

    // Confirm V1 remains null / not applicable (no default 50 or 110 radius)
    assert.equal(retrieved.v1DistanceKm, null, "Retrieved v1DistanceKm must be null");
    assert.equal(retrieved.v1Coverage?.isCovered, false, "Retrieved isCovered must be false");
    assert.notEqual(retrieved.priorityRadiusKm, 50, "Must not default to 50 km");
    assert.notEqual(retrieved.monitoringRadiusKm, 110, "Must not default to 110 km");

    // 4. Verify assessStoreRisk behavior
    const testStore = { latitude: -6.905, longitude: 107.605 }; // ~0.7 km away
    const risk = assessStoreRisk(testStore, [retrieved]);
    assert.equal(risk.isInsideV1, false, "Store cannot be inside V1 when V1 is null");
    assert.equal(risk.spatialRisk, "UNASSESSED", "Store must be UNASSESSED, never automatically SAFE");
    assert.notEqual(risk.spatialRisk, "SAFE", "Must never automatically assign SAFE");
  } finally {
    await pool.query("DELETE FROM earthquake_events WHERE id = $1", [eventId]);
  }
});

test("Null V1 Case 2: M4.5, depth 35 km (Excluded depth > 30 km: no applicable V1 range)", async () => {
  assertSimulationAllowed();
  const pool = getOperationalDbPool();

  const eventId = `test-eq-uat-m45-${Date.now()}`;
  const now = Date.now();

  // 1. Evaluate V1 coverage
  const coverage = getV1Coverage(4.5, 35);
  assert.equal(coverage.isCovered, false, "M4.5 depth 35 km is excluded from V1 table (covers up to 30 km)");
  assert.equal(coverage.v1DistanceKm, null, "Excluded cell must return v1DistanceKm: null");
  assert.equal(coverage.depthGroup, ">30–40 km");

  const eqRecord: Earthquake = {
    id: eventId,
    canonicalEventKey: eventId,
    source: "BMKG",
    sourcePrimary: "BMKG",
    title: "Gempa Bumi M 4.5 - Excluded Cell UAT Verification",
    magnitude: 4.5,
    depth: "35 km",
    depthKm: 35,
    latitude: -8.100,
    longitude: 115.100,
    time: new Date(now).toISOString(),
    timestamp: now,
    potensiTsunami: false,
    v1DistanceKm: coverage.v1DistanceKm,
    v1Coverage: coverage,
    priorityRadiusKm: coverage.v1DistanceKm,
    monitoringRadiusKm: null,
  };

  try {
    // 2. Persist to database
    await dbUpsertEarthquakeEvent(eqRecord);

    // Verify row was written to database
    const directRow = await pool.query(
      "SELECT id, magnitude, depth_km, priority_radius_km, monitoring_radius_km, raw_metadata FROM earthquake_events WHERE id = $1",
      [eventId]
    );
    assert.equal(directRow.rows.length, 1, "Earthquake must be persisted");
    const raw = directRow.rows[0];
    assert.equal(Number(raw.magnitude), 4.5);
    assert.equal(Number(raw.depth_km), 35);
    // Explicit compatible representation: 0 stored in integer NOT NULL column
    assert.equal(raw.priority_radius_km, 0, "Integer NOT NULL column stores 0 as compatible representation");
    assert.equal(raw.monitoring_radius_km, 0, "Integer NOT NULL column stores 0 as compatible representation");

    // 3. Retrieve via dbGetRecentEarthquakeEvents
    const recentEvents = await dbGetRecentEarthquakeEvents(24);
    const retrieved = recentEvents.find((e) => e.id === eventId);
    assert.ok(retrieved, "Earthquake must be visible in recent events");
    assert.equal(retrieved.magnitude, 4.5);
    assert.equal(retrieved.depthKm, 35);

    // Confirm V1 remains null / not applicable (no default 50 or 110 radius)
    assert.equal(retrieved.v1DistanceKm, null, "Retrieved v1DistanceKm must be null");
    assert.equal(retrieved.v1Coverage?.isCovered, false, "Retrieved isCovered must be false");
    assert.notEqual(retrieved.priorityRadiusKm, 50, "Must not default to 50 km");
    assert.notEqual(retrieved.monitoringRadiusKm, 110, "Must not default to 110 km");

    // 4. Verify assessStoreRisk behavior
    const testStore = { latitude: -8.150, longitude: 115.120 }; // ~6 km away
    const risk = assessStoreRisk(testStore, [retrieved]);
    assert.equal(risk.isInsideV1, false, "Store cannot be inside V1 when V1 is null");
    assert.equal(risk.spatialRisk, "UNASSESSED", "Store must be UNASSESSED, never automatically SAFE");
    assert.notEqual(risk.spatialRisk, "SAFE", "Must never automatically assign SAFE");
  } finally {
    await pool.query("DELETE FROM earthquake_events WHERE id = $1", [eventId]);
  }
});

test.after(async () => {
  await getOperationalDbPool().end();
});
