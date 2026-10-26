import assert from 'node:assert';
import { getDbPool } from '../lib/db';
import { WORKER_DISASTER_ADVISORY_LOCK_ID } from '../lib/server-daemon';

async function testAdvisoryLockLifecycle() {
  console.log('============================================================');
  console.log('🔒 VERIFYING POSTGRESQL ADVISORY LOCK LIFECYCLE & CONCURRENCY');
  console.log('============================================================');

  const pool = getDbPool();

  // Test 1: Single client acquisition and release on same connection
  console.log('\n--- 1. Testing Acquisition and Release on Dedicated Connection ---');
  const client1 = await pool.connect();
  try {
    const res1 = await client1.query('SELECT pg_try_advisory_lock($1) AS acquired', [WORKER_DISASTER_ADVISORY_LOCK_ID]);
    const acquired1 = Boolean(res1.rows[0]?.acquired);
    console.log('Client 1 pg_try_advisory_lock:', acquired1);
    assert.strictEqual(acquired1, true, 'Client 1 must successfully acquire advisory lock');

    // Test 2: Concurrent client mutual exclusion
    console.log('\n--- 2. Testing Concurrent Worker Mutual Exclusion ---');
    const client2 = await pool.connect();
    try {
      const res2 = await client2.query('SELECT pg_try_advisory_lock($1) AS acquired', [WORKER_DISASTER_ADVISORY_LOCK_ID]);
      const acquired2 = Boolean(res2.rows[0]?.acquired);
      console.log('Client 2 pg_try_advisory_lock (while Client 1 holds lock):', acquired2);
      assert.strictEqual(acquired2, false, 'Client 2 must be rejected while Client 1 holds the lock');
    } finally {
      client2.release();
    }

    // Release Client 1
    const unlockRes1 = await client1.query('SELECT pg_advisory_unlock($1) AS unlocked', [WORKER_DISASTER_ADVISORY_LOCK_ID]);
    const unlocked1 = Boolean(unlockRes1.rows[0]?.unlocked);
    console.log('Client 1 pg_advisory_unlock:', unlocked1);
    assert.strictEqual(unlocked1, true, 'Client 1 must successfully release the advisory lock');
  } finally {
    client1.release();
  }

  // Test 3: Re-acquisition after release
  console.log('\n--- 3. Testing Lock Re-acquisition After Release ---');
  const client3 = await pool.connect();
  try {
    const res3 = await client3.query('SELECT pg_try_advisory_lock($1) AS acquired', [WORKER_DISASTER_ADVISORY_LOCK_ID]);
    const acquired3 = Boolean(res3.rows[0]?.acquired);
    console.log('Client 3 pg_try_advisory_lock after release:', acquired3);
    assert.strictEqual(acquired3, true, 'Client 3 must acquire lock after Client 1 released it');

    // Test 4: Disconnect cleanup (simulate crash / connection termination)
    console.log('\n--- 4. Testing Disconnect Cleanup on Crash / Rolling Restart ---');
    // Destroy client 3 connection stream directly without explicit pg_advisory_unlock
    (client3 as any).connection?.stream?.destroy();
    client3.release(true);
  } catch (e) {
    // client destroyed
  }

  // Allow backend over internet to detect TCP reset / termination
  for (let i = 0; i < 10; i++) {
    await new Promise(resolve => setTimeout(resolve, 300));
    const testClient = await pool.connect();
    try {
      const probeRes = await testClient.query('SELECT pg_try_advisory_lock($1) AS acquired', [WORKER_DISASTER_ADVISORY_LOCK_ID]);
      if (probeRes.rows[0]?.acquired) {
        console.log(`Backend released lock automatically on disconnect after ${(i + 1) * 300}ms!`);
        await testClient.query('SELECT pg_advisory_unlock($1)', [WORKER_DISASTER_ADVISORY_LOCK_ID]);
        break;
      }
    } finally {
      testClient.release();
    }
  }

  const client4 = await pool.connect();
  try {
    const res4 = await client4.query('SELECT pg_try_advisory_lock($1) AS acquired', [WORKER_DISASTER_ADVISORY_LOCK_ID]);
    const acquired4 = Boolean(res4.rows[0]?.acquired);
    console.log('Client 4 pg_try_advisory_lock after Client 3 socket destroy:', acquired4);
    assert.strictEqual(acquired4, true, 'Client 4 must acquire lock immediately after Client 3 disconnects/crashes');

    // Clean up
    await client4.query('SELECT pg_advisory_unlock($1)', [WORKER_DISASTER_ADVISORY_LOCK_ID]);
  } finally {
    client4.release();
  }

  console.log('\n🎉 ALL ADVISORY LOCK LIFECYCLE TESTS PASSED!');
  process.exit(0);
}

testAdvisoryLockLifecycle().catch(err => {
  console.error('FAILED:', err);
  process.exit(1);
});
