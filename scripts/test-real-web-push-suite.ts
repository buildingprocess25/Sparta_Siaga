import { getDbPool } from '../lib/db';
import { 
  getVapidConfig, 
  getVapidPublicKey, 
  ensureWebPushConfigured 
} from '../lib/web-push-config';
import { 
  ensurePushSubscriptionTable,
  detectDeviceType,
  savePushSubscription,
  deletePushSubscription,
  sendSinglePushNotification,
  dispatchEarthquakePushNotifications,
  PushSubscriptionRecord
} from '../lib/web-push-service';
import webpush from 'web-push';

async function runTestSuite() {
  console.log('===============================================================');
  console.log('SPARTA SIAGA — PUSH-01: Real Background Web Push Test Suite');
  console.log('===============================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, testName: string, detail?: string) {
    if (condition) {
      console.log(`✅ [PASS] ${testName}`);
      passed++;
    } else {
      console.error(`❌ [FAIL] ${testName}${detail ? ` - ${detail}` : ''}`);
      failed++;
    }
  }

  const pool = getDbPool();

  try {
    // -------------------------------------------------------------------------
    // TEST 1: VAPID Configuration & Key Cryptographic Validity
    // -------------------------------------------------------------------------
    console.log('--- TEST GROUP 1: VAPID Keys & Cryptographic Setup ---');
    const vapidConfig = getVapidConfig();
    assert(Boolean(vapidConfig.publicKey && vapidConfig.privateKey && vapidConfig.subject), 
      'VAPID configuration is complete (public, private, subject)');
    assert(vapidConfig.publicKey.length > 60, 'VAPID public key has valid P-256 base64url length');
    assert(vapidConfig.subject.startsWith('mailto:') || vapidConfig.subject.startsWith('https:'), 
      'VAPID subject follows RFC 8292 specification');

    ensureWebPushConfigured();
    assert(true, 'webpush.setVapidDetails succeeds without cryptographic error');

    // -------------------------------------------------------------------------
    // TEST 2: Database Schema & Migration Idempotency
    // -------------------------------------------------------------------------
    console.log('\n--- TEST GROUP 2: Push Subscription Database Schema ---');
    await ensurePushSubscriptionTable();

    const tableCheck = await pool.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'user_push_subscriptions'
    `);
    const colNames = new Set(tableCheck.rows.map((r: any) => r.column_name));
    assert(colNames.has('id'), 'Table user_push_subscriptions has id');
    assert(colNames.has('endpoint'), 'Table user_push_subscriptions has endpoint');
    assert(colNames.has('p256dh'), 'Table user_push_subscriptions has p256dh');
    assert(colNames.has('auth'), 'Table user_push_subscriptions has auth');
    assert(colNames.has('device_type'), 'Table user_push_subscriptions has device_type');
    assert(colNames.has('failure_count'), 'Table user_push_subscriptions has failure_count');
    assert(colNames.has('last_success_at'), 'Table user_push_subscriptions has last_success_at');
    assert(colNames.has('last_failure_at'), 'Table user_push_subscriptions has last_failure_at');

    const delTableCheck = await pool.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'push_event_deliveries'
    `);
    const delColNames = new Set(delTableCheck.rows.map((r: any) => r.column_name));
    assert(delColNames.has('event_id'), 'Table push_event_deliveries has event_id');
    assert(delColNames.has('endpoint'), 'Table push_event_deliveries has endpoint');
    assert(delColNames.has('status'), 'Table push_event_deliveries has status');

    // -------------------------------------------------------------------------
    // TEST 3: Device Type Detection (Android, iOS PWA, Desktop)
    // -------------------------------------------------------------------------
    console.log('\n--- TEST GROUP 3: Device Type Classification ---');
    const androidUa = 'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';
    const iosUa = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1';
    const desktopWinUa = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0';
    const desktopMacUa = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15';

    assert(detectDeviceType(androidUa) === 'android', 'Detects Android smartphone User-Agent');
    assert(detectDeviceType(iosUa) === 'ios', 'Detects iOS Safari/PWA User-Agent');
    assert(detectDeviceType(desktopWinUa) === 'desktop', 'Detects Windows Desktop Edge/Chrome');
    assert(detectDeviceType(desktopMacUa) === 'desktop', 'Detects macOS Desktop Safari/Chrome');
    assert(detectDeviceType(null) === 'unknown', 'Handles null User-Agent gracefully');

    // -------------------------------------------------------------------------
    // TEST 4: Subscription Lifecycle (Register, Update, Unregister)
    // -------------------------------------------------------------------------
    console.log('\n--- TEST GROUP 4: Subscription Registration & Lifecycle ---');
    const testUserId = `test_user_${Date.now()}`;
    const testEndpoint1 = `https://fcm.googleapis.com/fcm/send/test_tok_${Date.now()}_1`;
    const testEndpoint2 = `https://web.push.apple.com/test_tok_${Date.now()}_2`;
    const dummyP256dh = 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QT9AcUbVJaBoeWodhqqXdmooBj2i20ul-desMP2ZqMQEtuEI';
    const dummyAuth = 'tBHItJI5svbpez7KI4CCXg';

    const subId1 = await savePushSubscription({
      userId: testUserId,
      branch: 'SIDOARJO',
      endpoint: testEndpoint1,
      p256dh: dummyP256dh,
      auth: dummyAuth,
      userAgent: androidUa,
    });
    assert(Boolean(subId1 && subId1.startsWith('sub_')), 'Saves Android subscription with generated ID');

    // Verify row was inserted with correct device type
    const savedRowRes = await pool.query(`SELECT * FROM user_push_subscriptions WHERE id = $1`, [subId1]);
    assert(savedRowRes.rows.length === 1, 'Subscription retrieved from database');
    assert(savedRowRes.rows[0].device_type === 'android', 'Device type correctly recorded as android');
    assert(savedRowRes.rows[0].branch === 'SIDOARJO', 'Branch correctly associated with subscription');

    // Idempotent update on same endpoint (e.g. user re-registered or changed branch)
    await savePushSubscription({
      userId: testUserId,
      branch: 'MALANG',
      endpoint: testEndpoint1,
      p256dh: dummyP256dh,
      auth: dummyAuth,
      userAgent: androidUa,
    });
    const updatedRowRes = await pool.query(`SELECT branch FROM user_push_subscriptions WHERE id = $1`, [subId1]);
    assert(updatedRowRes.rows[0].branch === 'MALANG', 'Idempotent update updates existing subscription record without duplicate');

    // Test unregister / delete
    const unregResult = await deletePushSubscription(testEndpoint1, testUserId);
    assert(unregResult === true, 'deletePushSubscription successfully removes subscription');
    const checkDeleted = await pool.query(`SELECT id FROM user_push_subscriptions WHERE id = $1`, [subId1]);
    assert(checkDeleted.rows.length === 0, 'Subscription is no longer in database after unregister');

    // -------------------------------------------------------------------------
    // TEST 5: Earthquake Event Dispatch, Branch Targeting & Deduplication
    // -------------------------------------------------------------------------
    console.log('\n--- TEST GROUP 5: Earthquake Push Dispatch, Branch Permissions & National Deduplication ---');
    const eqEventId = `eq_test_${Date.now()}`;
    
    // Seed test subscriptions:
    // Sub A: Sidoarjo BMS (branch: SIDOARJO)
    // Sub B: Malang BMS (branch: MALANG)
    // Sub C: National HO (branch: NASIONAL)
    const endpA = `https://fcm.googleapis.com/fcm/send/test_sidoarjo_${Date.now()}`;
    const endpB = `https://fcm.googleapis.com/fcm/send/test_malang_${Date.now()}`;
    const endpC = `https://web.push.apple.com/test_national_ho_${Date.now()}`;

    await savePushSubscription({
      userId: 'user_sidoarjo_01',
      branch: 'SIDOARJO',
      endpoint: endpA,
      p256dh: dummyP256dh,
      auth: dummyAuth,
      userAgent: androidUa,
    });

    await savePushSubscription({
      userId: 'user_malang_01',
      branch: 'MALANG',
      endpoint: endpB,
      p256dh: dummyP256dh,
      auth: dummyAuth,
      userAgent: desktopWinUa,
    });

    await savePushSubscription({
      userId: 'user_national_ho',
      branch: 'NASIONAL',
      endpoint: endpC,
      p256dh: dummyP256dh,
      auth: dummyAuth,
      userAgent: iosUa,
    });

    // We stub webpush.sendNotification for test purposes to return mock outcomes
    const originalSendNotification = webpush.sendNotification;
    let pushAttempts: Array<{ endpoint: string; payload: string }> = [];

    (webpush as any).sendNotification = async (sub: any, payload: string, opts: any) => {
      pushAttempts.push({ endpoint: sub.endpoint, payload });
      return { statusCode: 201, headers: {}, body: 'mock-fcm-success' };
    };

    try {
      // 1. Dispatch for branch SIDOARJO:
      // Expect Sub A (Sidoarjo) and Sub C (National HO) to be sent push.
      // Sub B (Malang) must NOT receive it.
      pushAttempts = [];
      const summary1 = await dispatchEarthquakePushNotifications({
        title: '⚠️ GEMPA M 6.2 - CABANG SIDOARJO',
        body: '3 gerai berada di Zona Prioritas Pantau SPARTA.',
        branch: 'SIDOARJO',
        eventId: eqEventId,
        magnitude: 6.2,
      });

      const testDispatched1 = pushAttempts.filter(p => [endpA, endpB, endpC].includes(p.endpoint));
      assert(testDispatched1.length === 2, `Dispatch 1 targeted 2 test recipients (Sidoarjo + National HO), got ${testDispatched1.length}`);
      const dispatchedEndps1 = new Set(pushAttempts.map(p => p.endpoint));
      assert(dispatchedEndps1.has(endpA), 'Sidoarjo subscriber received Sidoarjo alert');
      assert(dispatchedEndps1.has(endpC), 'National HO subscriber received Sidoarjo alert');
      assert(!dispatchedEndps1.has(endpB), 'Malang subscriber was NOT sent Sidoarjo alert (Branch isolation verified)');

      // 2. Dispatch for branch MALANG for the SAME earthquake event:
      // Sub B (Malang) must receive it.
      // Sub C (National HO) must be SKIPPED by deduplication (already received EQ-1)!
      pushAttempts = [];
      const summary2 = await dispatchEarthquakePushNotifications({
        title: '⚠️ GEMPA M 6.2 - CABANG MALANG',
        body: '1 gerai berada di Zona Prioritas Pantau SPARTA.',
        branch: 'MALANG',
        eventId: eqEventId,
        magnitude: 6.2,
      });

      const testDispatched2 = pushAttempts.filter(p => [endpA, endpB, endpC].includes(p.endpoint));
      assert(testDispatched2.length === 1, `Dispatch 2 targeted only Malang test recipient (National HO deduplicated), got ${testDispatched2.length}`);
      const dispatchedEndps2 = new Set(pushAttempts.map(p => p.endpoint));
      assert(dispatchedEndps2.has(endpB), 'Malang subscriber received Malang alert');
      assert(!dispatchedEndps2.has(endpC), 'National HO subscriber was NOT duplicated for the same event (Deduplication verified)');

      // 3. Dispatch for branch SIDOARJO again for the same event:
      // All subscribers were already delivered; summary should report 0 additional deliveries.
      pushAttempts = [];
      const summary3 = await dispatchEarthquakePushNotifications({
        title: '⚠️ GEMPA M 6.2 - CABANG SIDOARJO',
        body: 'Duplicate trigger test',
        branch: 'SIDOARJO',
        eventId: eqEventId,
      });
      assert(summary3.delivered === 0, 'Subsequent dispatch of same event is completely deduplicated (Idempotency verified)');

    } finally {
      webpush.sendNotification = originalSendNotification;
    }

    // -------------------------------------------------------------------------
    // TEST 6: Delivery Outcomes, Expired Cleanup & Honesty
    // -------------------------------------------------------------------------
    console.log('\n--- TEST GROUP 6: Expired Subscription Cleanup (HTTP 410/404) & Delivery Honesty ---');
    const expiredEndpoint = `https://fcm.googleapis.com/fcm/send/expired_token_${Date.now()}`;
    await savePushSubscription({
      userId: 'user_expired_device',
      branch: 'SIDOARJO',
      endpoint: expiredEndpoint,
      p256dh: dummyP256dh,
      auth: dummyAuth,
      userAgent: androidUa,
    });

    // Verify it exists in DB
    const beforeExpiredCheck = await pool.query(`SELECT id FROM user_push_subscriptions WHERE endpoint = $1`, [expiredEndpoint]);
    assert(beforeExpiredCheck.rows.length === 1, 'Expired test subscription is in DB prior to dispatch');

    // Mock sendNotification to simulate HTTP 410 Gone (subscription revoked/expired)
    (webpush as any).sendNotification = async () => {
      const error: any = new Error('Received unexpected response code: 410 Gone');
      error.statusCode = 410;
      throw error;
    };

    try {
      const fakeSubRecord: PushSubscriptionRecord = {
        id: 'sub_expired_test',
        user_id: 'user_expired_device',
        endpoint: expiredEndpoint,
        p256dh: dummyP256dh,
        auth: dummyAuth,
        device_type: 'android',
      };

      const outcome = await sendSinglePushNotification(fakeSubRecord, {
        title: 'Test Expired',
        body: 'Test body',
      });

      assert(outcome.success === false, 'Delivery outcome honesty: reports success=false when push service fails');
      assert(outcome.expired === true, 'Outcome correctly flags expired=true on HTTP 410');
      assert(outcome.statusCode === 410, 'Outcome captures HTTP 410 status code');

      // Verify endpoint was automatically purged from DB
      const afterExpiredCheck = await pool.query(`SELECT id FROM user_push_subscriptions WHERE endpoint = $1`, [expiredEndpoint]);
      assert(afterExpiredCheck.rows.length === 0, 'HTTP 410 automatically purges expired subscription from database (Cleanup verified)');

      // Check delivery failure honesty: simulate HTTP 500
      (webpush as any).sendNotification = async () => {
        const error: any = new Error('Internal FCM Error 500');
        error.statusCode = 500;
        throw error;
      };

      const failOutcome = await sendSinglePushNotification({
        id: 'sub_fail_test',
        user_id: 'user_fail_test',
        endpoint: endpA,
        p256dh: dummyP256dh,
        auth: dummyAuth,
        device_type: 'android',
      }, { title: 'Test 500', body: 'Test' }, { maxRetries: 1 });

      assert(failOutcome.success === false, 'Never reports delivered when push service returns 500 (Delivery Honesty verified)');
      assert(failOutcome.statusCode === 500, 'Captures 500 error code');

    } finally {
      webpush.sendNotification = originalSendNotification;
    }

    // Clean up test subscriptions
    await pool.query(`DELETE FROM user_push_subscriptions WHERE endpoint IN ($1, $2, $3)`, [endpA, endpB, endpC]);
    await pool.query(`DELETE FROM push_event_deliveries WHERE event_id = $1`, [eqEventId]);

    console.log('\n===============================================================');
    console.log(`RESULTS: ${passed} PASSED, ${failed} FAILED`);
    console.log('===============================================================');

    if (failed > 0) {
      process.exit(1);
    }
  } catch (err) {
    console.error('Fatal error running push test suite:', err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

runTestSuite();
