import { writeFile } from 'node:fs/promises';
import { getDisasterCycleHealth, startServerDaemon, stopServerDaemon } from '../lib/server-daemon';
import { closeDbPool } from '../lib/db';

console.log('============================================================');
console.log('🚀 [SPARTA SIAGA WORKER] Standalone Autonomous Worker starting...');
console.log('   Service: 24/7 Earthquake (BMKG/USGS) Monitoring (weather auto-alerts off)');
console.log('============================================================');

startServerDaemon();

// The combined-container healthcheck reads this small, non-sensitive heartbeat.
const heartbeatFile = process.env.SPARTA_WORKER_HEARTBEAT_FILE?.trim();
async function writeWorkerHeartbeat() {
  if (!heartbeatFile) return;
  const cycle = getDisasterCycleHealth();
  await writeFile(heartbeatFile, JSON.stringify({
    pid: process.pid,
    recordedAt: new Date().toISOString(),
    lastStatus: cycle.lastStatus,
    lastCycleStart: cycle.lastCycleStart,
    lastCycleFinished: cycle.lastCycleFinished,
    lastError: cycle.lastError ? 'cycle_error' : null,
  }), { mode: 0o600 });
}
if (heartbeatFile) {
  writeWorkerHeartbeat().catch((err) => console.error('[SPARTA WORKER] Heartbeat write failed:', err.message));
}
const heartbeatTimer = heartbeatFile
  ? setInterval(() => {
      writeWorkerHeartbeat().catch((err) => console.error('[SPARTA WORKER] Heartbeat write failed:', err.message));
    }, 15000)
  : null;
heartbeatTimer?.unref();

let isShuttingDown = false;

async function handleShutdown(signal: string) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  console.log(`\n[SPARTA SIAGA WORKER] Received ${signal}, starting graceful shutdown...`);

  try {
    console.log('[SPARTA SIAGA WORKER] Stopping autonomous daemon timers & waiting for active cycles...');
    await stopServerDaemon(10000);
    console.log('[SPARTA SIAGA WORKER] Closing database connection pool...');
    await closeDbPool();
    console.log('[SPARTA SIAGA WORKER] Graceful shutdown completed cleanly.');
    process.exit(0);
  } catch (error) {
    console.error('[SPARTA SIAGA WORKER] Error during graceful shutdown:', error);
    process.exit(1);
  }
}

// OS signals (POSIX / Docker / Ctrl+C)
process.once('SIGINT', () => {
  handleShutdown('SIGINT').catch((err) => {
    console.error('[SPARTA SIAGA WORKER] Fatal error in SIGINT handler:', err);
    process.exit(1);
  });
});

process.once('SIGTERM', () => {
  handleShutdown('SIGTERM').catch((err) => {
    console.error('[SPARTA SIAGA WORKER] Fatal error in SIGTERM handler:', err);
    process.exit(1);
  });
});

// IPC messages (cross-platform process orchestrators and test harnesses)
if (process.send) {
  process.on('message', (msg) => {
    if (msg === 'SIGTERM' || msg === 'SIGINT') {
      handleShutdown(msg as string).catch((err) => {
        console.error(`[SPARTA SIAGA WORKER] Fatal error in ${msg} IPC handler:`, err);
        process.exit(1);
      });
    }
  });
}
