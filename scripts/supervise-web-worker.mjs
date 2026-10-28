import { spawn } from 'node:child_process';
import { rmSync } from 'node:fs';

// Keep web and worker isolated as processes, but managed by a single Dokploy application.
const workerEnabled = process.env.SPARTA_AUTONOMOUS_WORKER_ENABLED === 'true';
const heartbeatPath = process.env.SPARTA_WORKER_HEARTBEAT_FILE || '/tmp/sparta-siaga-worker-health.json';
let stopping = false;
const children = new Map();

function launch(name, args, env = process.env) {
  const child = spawn(process.execPath, args, {
    env,
    stdio: 'inherit',
    cwd: process.cwd(),
  });
  children.set(name, child);
  console.log(`[SPARTA SUPERVISOR] ${name} launched (pid ${child.pid ?? 'pending'}).`);
  child.once('error', (err) => {
    console.error(`[SPARTA SUPERVISOR] ${name} failed to start:`, err.message);
    shutdown(1);
  });
  child.once('exit', (code, signal) => {
    console.error(`[SPARTA SUPERVISOR] ${name} exited (code=${code}, signal=${signal}).`);
    if (!stopping) shutdown(1);
  });
  return child;
}

function shutdown(exitCode = 0) {
  if (stopping) return;
  stopping = true;
  console.log('[SPARTA SUPERVISOR] Stopping web and worker...');
  for (const child of children.values()) {
    if (child.exitCode === null && child.signalCode === null) {
      try { child.kill('SIGTERM'); } catch { /* already stopped */ }
    }
  }
  // Ensure PID 1 exits even when one child cannot shut down cleanly.
  const deadline = setTimeout(() => {
    for (const child of children.values()) {
      if (child.exitCode === null && child.signalCode === null) {
        try { child.kill('SIGKILL'); } catch { /* already stopped */ }
      }
    }
    process.exit(exitCode);
  }, 8000);
  deadline.unref();
  Promise.all([...children.values()].map((child) => new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) return resolve();
    child.once('exit', resolve);
  }))).then(() => process.exit(exitCode));
}

process.once('SIGINT', () => shutdown(0));
process.once('SIGTERM', () => shutdown(0));

if (workerEnabled) {
  if (process.env.NODE_ENV !== 'production') {
    console.error('[SPARTA SUPERVISOR] Worker requires NODE_ENV=production.');
    process.exit(1);
  }
  const dbName = (() => {
    try { return decodeURIComponent(new URL(process.env.DATABASE_URL || '').pathname.slice(1)); }
    catch { return ''; }
  })();
  if (dbName !== 'siaga') {
    console.error('[SPARTA SUPERVISOR] Refusing live worker: DATABASE_URL must target database siaga.');
    process.exit(1);
  }
  // A stale file must never make a new container appear healthy.
  try { rmSync(heartbeatPath, { force: true }); }
  catch (err) {
    console.error('[SPARTA SUPERVISOR] Cannot reset worker heartbeat:', err.message);
    process.exit(1);
  }
}

launch('web', ['server.js']);
if (workerEnabled) {
  launch('worker', ['node_modules/tsx/dist/cli.mjs', 'scripts/worker-daemon.ts'], {
    ...process.env,
    SPARTA_WORKER_HEARTBEAT_FILE: heartbeatPath,
    SPARTA_AUTONOMOUS_WEATHER_ALERTS: 'false',
  });
  console.log('[SPARTA SUPERVISOR] Autonomous earthquake worker enabled. Automatic weather dispatch disabled.');
} else {
  console.log('[SPARTA SUPERVISOR] Worker inactive. Enable explicitly with SPARTA_AUTONOMOUS_WORKER_ENABLED=true after readiness checks.');
}
