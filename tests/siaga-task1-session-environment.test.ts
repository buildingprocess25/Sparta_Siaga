import test from "node:test";
import assert from "node:assert/strict";

// Explicit dummy configuration: this suite never connects to PostgreSQL.
test("environment policy, gate and session tokens isolate isolated-dev, readonly-dev, and production and fail closed on legacy 'uat'", async () => {
  process.env.DATABASE_URL = "postgresql://dummy:dummy@fixture.aivencloud.com:5432/sparta_siaga_isolated?sslmode=require";
  process.env.JWT_SECRET = "fixture-only-not-a-real-secret-01234567890123456789";
  process.env.DEV_GATE_PASSCODE = "fixture-passcode-dev-0123456789";
  process.env.SPARTA_TEST_GATE_ENABLED = "true";
  delete process.env.SPARTA_DEV_DATA_MODE;
  delete process.env.SPARTA_PRODUCTION_READONLY_DATABASE_URL;
  delete process.env.SPARTA_WRITE_DATABASE_URL_FOR_CHECK;
  delete process.env.SPARTA_FORCE_DEV_GATE;

  const env = (value: string) => {
    process.env.APP_ENV = value;
    process.env.SPARTA_ENVIRONMENT = value;
  };
  env("development");

  const policy = await import("../lib/environment-policy");
  const isolation = await import("../lib/session-environment");
  const jwt = await import("../lib/jwt");
  const sessions = await import("../lib/session-service");

  const local = new Request("http://localhost:3004/login", { headers: { host: "localhost:3004" } });
  const tunnel = new Request("https://fixture.devtunnels.ms/login", { headers: { host: "fixture.devtunnels.ms" } });

  // 1. Development Isolated mode
  assert.equal(policy.getSpartaEnvironment(), "development");
  assert.equal(policy.getDevelopmentDataMode(), "isolated");
  assert.equal(policy.isDevelopmentIsolatedMode(), true);
  assert.equal(policy.isDevelopmentReadOnlyMode(), false);
  assert.equal(policy.isSimulationAllowed(), true);
  assert.equal(policy.isQuickLoginPermitted(local).allowed, true);
  assert.equal(policy.isQuickLoginPermitted(tunnel).allowed, false);

  const devGate = policy.issueGateToken();
  assert.equal(policy.verifyGateToken(devGate), true);
  assert.equal(policy.verifyGateToken(devGate + "x"), false);
  const gatedTunnel = new Request(tunnel.url, { headers: { host: "fixture.devtunnels.ms", cookie: `siaga_gate_token=${devGate}` } });
  assert.equal(policy.isQuickLoginPermitted(gatedTunnel).allowed, true);

  const devAccess = await jwt.signSession({ id: "fixture", nik: "DEV_FIXTURE", systemRole: "USER", v: 1 });
  assert.ok(await jwt.verifySession(devAccess));
  const devRefresh = sessions.generateRefreshToken();
  assert.equal(isolation.hasCurrentRefreshEnvironment(devRefresh), true);

  // 2. Development Production-ReadOnly mode: distinct session/gate isolation, simulation disabled
  process.env.SPARTA_DEV_DATA_MODE = "production-readonly";
  process.env.SPARTA_PRODUCTION_READONLY_DATABASE_URL = "postgresql://sparta_siaga_readonly:ro-pass@prod.example.internal:5432/siaga?sslmode=require";
  process.env.SPARTA_WRITE_DATABASE_URL_FOR_CHECK = "postgresql://siaga_writer:pw@prod.example.internal:5432/siaga?sslmode=require";

  assert.equal(policy.getSpartaEnvironment(), "development");
  assert.equal(policy.getDevelopmentDataMode(), "production-readonly");
  assert.equal(policy.isDevelopmentReadOnlyMode(), true);
  assert.equal(policy.isSimulationAllowed(), false);
  assert.throws(() => policy.assertSimulationAllowed(), /SIMULATION_FORBIDDEN_IN_PRODUCTION/);
  assert.equal(policy.verifyGateToken(devGate), false, "Isolated dev gate token must not validate in readonly-dev");
  assert.equal(await jwt.verifySession(devAccess), null, "Isolated dev JWT must not validate in readonly-dev");
  assert.equal(isolation.hasCurrentRefreshEnvironment(devRefresh), false);

  const roGate = policy.issueGateToken();
  assert.equal(policy.verifyGateToken(roGate), true);
  const roAccess = await jwt.signSession({ id: "fixture", nik: "DEV_FIXTURE", systemRole: "USER", v: 1 });
  assert.ok(await jwt.verifySession(roAccess));
  assert.equal(policy.getLogoutRedirectUrl(), "/login");

  // 3. Retired 'uat' and 'staging' flags fail closed to production
  delete process.env.SPARTA_DEV_DATA_MODE;
  for (const legacy of ["uat", "staging"]) {
    env(legacy);
    assert.equal(policy.getSpartaEnvironment(), "production", `${legacy} must fail closed to production`);
    assert.equal(policy.isProductionEnvironment(), true);
    assert.equal(policy.isQuickLoginPermitted(local).allowed, false);
    assert.equal(policy.isSimulationAllowed(), false);
    assert.equal(policy.verifyGateToken(devGate), false);
    assert.equal(policy.verifyGateToken(roGate), false);
    assert.equal(await jwt.verifySession(devAccess), null);
    assert.equal(await jwt.verifySession(roAccess), null);
    assert.match(policy.getLogoutRedirectUrl(), /\/#\/modules$/);
  }

  // 4. Production environment
  env("production");
  assert.equal(policy.isQuickLoginPermitted(gatedTunnel).allowed, false);
  assert.equal(policy.isSimulationAllowed(), false);
  assert.equal(await jwt.verifySession(devAccess), null);
  assert.equal(isolation.canUseSessionIdentity({ id: "fixture", source: "DEVELOPMENT" }), false);
  const prodAccess = await jwt.signSession({ id: "fixture", nik: "FIXTURE", systemRole: "USER", v: 1 });
  assert.ok(await jwt.verifySession(prodAccess));

  env("development");
  assert.equal(await jwt.verifySession(prodAccess), null);

  // 5. Production-like target in isolated mode forces production
  process.env.DATABASE_URL = "postgresql://dummy:dummy@localhost:5432/siaga";
  assert.equal(policy.getSpartaEnvironment(), "production");
  assert.equal(policy.isQuickLoginPermitted(local).allowed, false);
});
