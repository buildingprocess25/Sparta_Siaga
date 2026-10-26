import { getDbPool } from '../lib/db';
import { assertIsolatedDatabase } from '../lib/database-safety';
import { runAutonomousDisasterCycle } from '../lib/server-daemon';

async function test() {
  // Prevent accidental execution against production or operational databases.
  // runAutonomousDisasterCycle() fetches live BMKG/USGS data and creates real
  // incident reports + notification logs, so it must only run against isolated DBs.
  const pool = getDbPool();
  await assertIsolatedDatabase(pool);

  if (process.env.NODE_ENV === 'production') {
    console.error('FATAL: test-cycle.ts must not run in NODE_ENV=production.');
    process.exit(1);
  }

  console.log('Running test cycle of autonomous server daemon (isolated DB only)...');
  await runAutonomousDisasterCycle();
  console.log('Test cycle finished successfully!');
  process.exit(0);
}

test().catch(err => {
  console.error('Fatal in test cycle:', err);
  process.exit(1);
});
