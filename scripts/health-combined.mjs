import { readFileSync } from 'node:fs';

async function main() {
  const port = Number(process.env.PORT || 3004);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT');
  const response = await fetch(`http://127.0.0.1:${port}/api/health/live`, {
    signal: AbortSignal.timeout(3000),
  });
  if (!response.ok) throw new Error(`Web health returned HTTP ${response.status}`);

  if (process.env.SPARTA_AUTONOMOUS_WORKER_ENABLED !== 'true') return;

  const heartbeatPath = process.env.SPARTA_WORKER_HEARTBEAT_FILE || '/tmp/sparta-siaga-worker-health.json';
  const state = JSON.parse(readFileSync(heartbeatPath, 'utf8'));
  const now = Date.now();
  const recordedAt = Date.parse(state.recordedAt || '');
  if (!Number.isInteger(state.pid) || state.pid < 1) throw new Error('Invalid worker PID');
  if (!Number.isFinite(recordedAt) || Math.abs(now - recordedAt) > 45000) {
    throw new Error('Worker heartbeat is stale');
  }
  process.kill(state.pid, 0); // Check that worker is still alive.

  if (state.lastStatus === 'error') throw new Error('Last autonomous cycle failed');
  if (state.lastStatus === 'running') {
    const startedAt = Date.parse(state.lastCycleStart || '');
    if (!Number.isFinite(startedAt) || now - startedAt > 10 * 60 * 1000) {
      throw new Error('Autonomous cycle is stuck');
    }
    return;
  }
  const finishedAt = Date.parse(state.lastCycleFinished || '');
  if (!Number.isFinite(finishedAt) || now - finishedAt > 5 * 60 * 1000) {
    throw new Error('No recent completed autonomous cycle');
  }
  if (state.lastStatus !== 'healthy') throw new Error(`Worker status: ${state.lastStatus}`);
}

main().then(() => process.exit(0)).catch((err) => {
  console.error('[SPARTA HEALTH]', err.message);
  process.exit(1);
});
