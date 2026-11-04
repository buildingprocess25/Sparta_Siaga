import { spawn, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function assert(condition: boolean, testName: string, detail?: string) {
  if (!condition) {
    console.error(`[FAIL] ${testName}${detail ? ` - ${detail}` : ""}`);
    process.exit(1);
  }
  console.log(`[PASS] ${testName}`);
}

// -----------------------------------------------------------------------------
// Test A: WEB DEVELOPMENT RUNTIME ISOLATION
// -----------------------------------------------------------------------------
function testWebDevelopmentRuntime() {
  const code = `
    process.env.NEXT_RUNTIME = 'nodejs';
    process.env.NEXT_PHASE = 'phase-development-server';
    process.env.NODE_ENV = 'development';
    // Even if obsolete flag is accidentally set, Web must NEVER load/start daemon
    process.env.ENABLE_AUTONOMOUS_DAEMON_IN_DEV = 'true';
    process.env.DATABASE_URL = 'postgresql://user:pass@localhost/db';
    process.env.JWT_SECRET = '12345678901234567890123456789012';
    process.env.SPARTA_INTERNAL_WORKER_SECRET = '12345678901234567890123456789012';
    process.env.PRIVATE_STORAGE_ROOT = require('path').resolve('./storage');

    import('./instrumentation.ts').then(async (mod) => {
      try {
        await mod.register();
        const started = Boolean(globalThis.__sparta_daemon_started);
        const loaded = Boolean(globalThis.__sparta_server_daemon_module_loaded);
        if (started) {
          process.exit(101);
        }
        if (loaded) {
          process.exit(102);
        }
        process.exit(0);
      } catch (err) {
        console.error(err);
        process.exit(1);
      }
    });
  `;

  const result = spawnSync(
    process.execPath,
    ["./node_modules/tsx/dist/cli.mjs", "-e", code],
    { encoding: "utf8" }
  );

  assert(
    result.status === 0,
    "A. Web Development Runtime: Daemon is NOT started and server-daemon module is NOT evaluated",
    `Exit code: ${result.status}, stderr: ${result.stderr}`
  );
}

// -----------------------------------------------------------------------------
// Test B: WEB PRODUCTION RUNTIME ISOLATION
// -----------------------------------------------------------------------------
function testWebProductionRuntime() {
  const code = `
    process.env.NEXT_RUNTIME = 'nodejs';
    process.env.NEXT_PHASE = 'phase-production-server';
    process.env.NODE_ENV = 'production';
    process.env.DATABASE_URL = 'postgresql://user:pass@localhost/db';
    process.env.JWT_SECRET = '12345678901234567890123456789012';
    process.env.SPARTA_INTERNAL_WORKER_SECRET = '12345678901234567890123456789012';
    process.env.PRIVATE_STORAGE_ROOT = require('path').resolve('./storage');

    import('./instrumentation.ts').then(async (mod) => {
      try {
        await mod.register();
        const started = Boolean(globalThis.__sparta_daemon_started);
        const loaded = Boolean(globalThis.__sparta_server_daemon_module_loaded);
        if (started) {
          process.exit(201); // Web production must NOT start daemon
        }
        if (loaded) {
          process.exit(202); // Web production must NOT evaluate server-daemon module
        }

        // Verify web process lifecycle manages DB pool without owning daemon
        const { registerProcessLifecycle } = await import('./lib/process-lifecycle.ts');
        const lifecycle = registerProcessLifecycle();
        await lifecycle.shutdown('SIGTERM');

        process.exit(0);
      } catch (err) {
        console.error(err);
        process.exit(1);
      }
    });
  `;

  const result = spawnSync(
    process.execPath,
    ["./node_modules/tsx/dist/cli.mjs", "-e", code],
    { encoding: "utf8" }
  );

  assert(
    result.status === 0,
    "B. Web Production Runtime: Initializes cleanly without starting or owning daemon",
    `Exit code: ${result.status}, stderr: ${result.stderr}`
  );
}

// -----------------------------------------------------------------------------
// Test C: STANDALONE WORKER (SIGTERM & SIGINT CLEANUP)
// -----------------------------------------------------------------------------
async function testStandaloneWorkerSignal(signal: "SIGTERM" | "SIGINT"): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ["./node_modules/tsx/dist/cli.mjs", "scripts/worker-daemon.ts"],
      {
        env: {
          ...process.env,
          NODE_ENV: "production",
          DATABASE_URL: "postgresql://user:pass@localhost/db",
          JWT_SECRET: "12345678901234567890123456789012",
          SPARTA_INTERNAL_WORKER_SECRET: "12345678901234567890123456789012",
          PRIVATE_STORAGE_ROOT: "./storage",
        },
        stdio: ["ignore", "pipe", "pipe", "ipc"],
      }
    );

    let output = "";
    let signalSent = false;

    child.stdout?.on("data", (d) => {
      output += d.toString();
      if (!signalSent && output.includes("24/7 AUTONOMOUS SERVER DAEMON ACTIVATED")) {
        signalSent = true;
        // On Windows child.kill(signal) does TerminateProcess without emitting signal events.
        // IPC child.send(signal) triggers graceful shutdown handler accurately cross-platform.
        if (process.platform === "win32") {
          child.send(signal);
        } else {
          child.kill(signal);
        }
      }
    });

    child.stderr?.on("data", (d) => {
      output += d.toString();
    });

    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`Timeout waiting for worker ${signal} test. Output: ${output}`));
    }, 10000);

    child.on("close", (code) => {
      clearTimeout(timeout);
      const started = output.includes("24/7 AUTONOMOUS SERVER DAEMON ACTIVATED");
      const stoppingTimers = output.includes("Stopping autonomous daemon timers");
      const closingPool = output.includes("Closing database connection pool");
      const completedCleanly = output.includes("Graceful shutdown completed cleanly");

      if (code === 0 && started && stoppingTimers && closingPool && completedCleanly) {
        console.log(`[PASS] C. Standalone Worker: ${signal} initiates clean shutdown, stops daemon timers, closes DB pool, and exits with 0`);
        resolve();
      } else {
        console.error(`[FAIL] C. Standalone Worker ${signal} (exit: ${code})\nOutput:\n${output}`);
        reject(new Error(`Worker ${signal} test failed`));
      }
    });
  });
}

// -----------------------------------------------------------------------------
// Test D: WEB / WORKER ISOLATION
// -----------------------------------------------------------------------------
function testWebWorkerIsolation() {
  const instrumentationSrc = readFileSync(resolve("instrumentation.ts"), "utf8");
  const lifecycleSrc = readFileSync(resolve("lib/process-lifecycle.ts"), "utf8");

  assert(
    !instrumentationSrc.includes("server-daemon") &&
    !instrumentationSrc.includes("startServerDaemon") &&
    !instrumentationSrc.includes("ENABLE_AUTONOMOUS_DAEMON_IN_DEV"),
    "D1. Web Isolation: instrumentation.ts contains zero server-daemon or daemon flag references"
  );

  assert(
    !lifecycleSrc.includes("server-daemon") &&
    !lifecycleSrc.includes("stopServerDaemon") &&
    !lifecycleSrc.includes("__sparta_daemon_started"),
    "D2. Web Isolation: lib/process-lifecycle.ts contains zero server-daemon or worker state references"
  );
}

// -----------------------------------------------------------------------------
// MAIN HARNESS
// -----------------------------------------------------------------------------
async function runAll() {
  console.log("============================================================");
  console.log("SPARTA SIAGA - ARCHITECTURE SEPARATION: WEB VS WORKER");
  console.log("============================================================");

  testWebDevelopmentRuntime();
  testWebProductionRuntime();
  await testStandaloneWorkerSignal("SIGTERM");
  await testStandaloneWorkerSignal("SIGINT");
  testWebWorkerIsolation();

  console.log("============================================================");
  console.log("ALL WEB & WORKER SEPARATION ARCHITECTURE TESTS PASSED");
  console.log("============================================================");
}

runAll().catch((err) => {
  console.error("Fatal test failure:", err);
  process.exit(1);
});
