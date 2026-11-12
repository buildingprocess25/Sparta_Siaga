import assert from "node:assert/strict";
import test from "node:test";
import {
  isProductionEnvironment,
  isUatSimulationAllowed,
  assertSimulationAllowed,
  getSpartaEnvironment,
} from "../lib/environment-policy";
import { isProductionDatabaseTarget } from "../lib/db";
import { processEarthquakeAlertsAndReports } from "../lib/server-daemon";
import type { Earthquake } from "../types/disaster";
import type { Store } from "../types/store";

test("Production Guard: Database target fail-closed check", () => {
  const prodUrls = [
    "postgresql://aku-sparta:pass@103.127.99.241:5432/siaga",
    "postgresql://user:pass@db.internal:5432/siaga",
    "postgresql://user:pass@db.sparta-siaga.com:5432/siaga?sslmode=require",
  ];
  for (const url of prodUrls) {
    assert.equal(
      isProductionDatabaseTarget(url),
      true,
      `URL ${url} must be identified as production database target`
    );
  }

  const isolatedUrls = [
    "postgres://avnadmin:pass@sparta-sentinel-db.aivencloud.com:15196/sparta_siaga_isolated?sslmode=verify-full",
    "postgresql://user:pass@localhost:5432/sparta_siaga_isolated",
  ];
  for (const url of isolatedUrls) {
    assert.equal(
      isProductionDatabaseTarget(url),
      false,
      `Isolated URL ${url} must not be flagged as production target`
    );
  }
});

test("Production Guard: Environment policy fails closed when in production", () => {
  const savedAppEnv = process.env.APP_ENV;
  const savedSpartaEnv = process.env.SPARTA_ENVIRONMENT;
  const savedDbUrl = process.env.DATABASE_URL;

  try {
    process.env.APP_ENV = "production";
    delete process.env.SPARTA_ENVIRONMENT;
    process.env.DATABASE_URL = "postgresql://user:pass@103.127.99.241:5432/siaga";

    assert.equal(isProductionEnvironment(), true, "Must resolve to production environment");
    assert.equal(isUatSimulationAllowed(), false, "UAT simulation must be forbidden in production");
    assert.throws(
      () => assertSimulationAllowed(),
      /SIMULATION_FORBIDDEN_IN_PRODUCTION/,
      "assertSimulationAllowed must throw in production"
    );
  } finally {
    process.env.APP_ENV = savedAppEnv;
    if (savedSpartaEnv) process.env.SPARTA_ENVIRONMENT = savedSpartaEnv;
    else delete process.env.SPARTA_ENVIRONMENT;
    process.env.DATABASE_URL = savedDbUrl;
  }
});

test("Production Guard: [Daemon Alert Guard] rejects synthetic and simulation earthquakes in production", async () => {
  const savedAppEnv = process.env.APP_ENV;
  const savedSpartaEnv = process.env.SPARTA_ENVIRONMENT;
  const savedDbUrl = process.env.DATABASE_URL;

  try {
    // Force production environment
    process.env.APP_ENV = "production";
    delete process.env.SPARTA_ENVIRONMENT;
    process.env.DATABASE_URL = "postgresql://user:pass@103.127.99.241:5432/siaga";

    const syntheticEarthquakes: Earthquake[] = [
      {
        id: "SIM-EQ-TEST-001",
        title: "Gempa Simulasi Gorontalo M 5.2",
        magnitude: 5.2,
        depth: "10 km",
        depthKm: 10,
        latitude: 0.5,
        longitude: 122.5,
        time: new Date().toISOString(),
        timestamp: Date.now(),
        source: "SIMULASI UAT",
        sourcePrimary: "SIMULASI UAT",
        potensiTsunami: false,
        priorityRadiusKm: 50,
        monitoringRadiusKm: 100,
      },
      {
        id: "BMKG-TEST-DEMO-002",
        title: "Gempa Bumi Uji Coba Bandung M 5.5",
        magnitude: 5.5,
        depth: "15 km",
        depthKm: 15,
        latitude: -6.9,
        longitude: 107.6,
        time: new Date().toISOString(),
        timestamp: Date.now(),
        source: "BMKG",
        sourcePrimary: "BMKG",
        potensiTsunami: false,
        priorityRadiusKm: 50,
        monitoringRadiusKm: 100,
      },
    ];

    const mockStore: Store = {
      kode_toko: "TEST_STR_001",
      nama_toko: "Toko Uji",
      cabang: "GORONTALO",
      latitude: 0.5,
      longitude: 122.5,
      status: "ACTIVE",
    } as unknown as Store;

    // Execute with allowSimulation: true (simulating daemon parameter)
    // In production, isUatSimulationAllowed() is false, so simulationAuthorized MUST be false
    const res = await processEarthquakeAlertsAndReports(
      syntheticEarthquakes,
      [mockStore],
      true, // isEligibleForAlert
      true, // allowBackfill
      true  // allowSimulation
    );

    assert.equal(
      res.dispatchedAlerts,
      0,
      "Production daemon MUST reject synthetic earthquake alerts even when allowSimulation is passed"
    );
    assert.equal(
      res.createdReports,
      0,
      "Production daemon MUST reject synthetic earthquake reports even when allowSimulation is passed"
    );
  } finally {
    process.env.APP_ENV = savedAppEnv;
    if (savedSpartaEnv) process.env.SPARTA_ENVIRONMENT = savedSpartaEnv;
    else delete process.env.SPARTA_ENVIRONMENT;
    process.env.DATABASE_URL = savedDbUrl;
  }
});
