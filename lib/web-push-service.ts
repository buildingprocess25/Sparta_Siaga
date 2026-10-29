import webpush from 'web-push';
import crypto from 'crypto';
import { getDbPool, isTestingModeActiveSync } from './db';
import { ensureWebPushConfigured } from './web-push-config';

export type DeviceType = 'android' | 'ios' | 'desktop' | 'unknown';

export interface PushSubscriptionRecord {
  id: string;
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  user_agent?: string | null;
  branch?: string | null;
  device_type?: DeviceType;
  created_at?: string;
  updated_at?: string;
  last_success_at?: string | null;
  last_failure_at?: string | null;
  failure_count?: number;
}

export interface WebPushPayload {
  title: string;
  body: string;
  icon?: string;
  badge?: string;
  tag?: string;
  url?: string;
  disasterType?: 'earthquake' | 'heavy_rain' | 'flood' | 'tsunami';
  eventId?: string;
  urgency?: 'very-low' | 'low' | 'normal' | 'high';
  timestamp?: string;
}

export interface PushDeliveryOutcome {
  endpoint: string;
  userId: string;
  deviceType: DeviceType;
  branch: string | null;
  success: boolean;
  statusCode?: number;
  error?: string;
  expired?: boolean;
}

export interface PushDispatchSummary {
  attempted: number;
  delivered: number;
  failed: number;
  expiredCleaned: number;
  deviceBreakdown: {
    android: { attempted: number; delivered: number; failed: number };
    ios: { attempted: number; delivered: number; failed: number };
    desktop: { attempted: number; delivered: number; failed: number };
    unknown: { attempted: number; delivered: number; failed: number };
  };
  outcomes: PushDeliveryOutcome[];
}

let tableEnsured = false;

/**
 * Ensures the user_push_subscriptions table exists with all necessary columns for delivery tracking.
 */
export async function ensurePushSubscriptionTable(): Promise<void> {
  if (tableEnsured) return;
  const pool = getDbPool();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_push_subscriptions (
      id VARCHAR(64) PRIMARY KEY,
      user_id VARCHAR(64) NOT NULL,
      endpoint TEXT NOT NULL UNIQUE,
      p256dh TEXT NOT NULL,
      auth TEXT NOT NULL,
      user_agent TEXT,
      branch VARCHAR(64),
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_push_sub_user ON user_push_subscriptions(user_id);
    CREATE INDEX IF NOT EXISTS idx_push_sub_branch ON user_push_subscriptions(branch);

    ALTER TABLE user_push_subscriptions ADD COLUMN IF NOT EXISTS device_type VARCHAR(32) DEFAULT 'unknown';
    ALTER TABLE user_push_subscriptions ADD COLUMN IF NOT EXISTS last_success_at TIMESTAMPTZ;
    ALTER TABLE user_push_subscriptions ADD COLUMN IF NOT EXISTS last_failure_at TIMESTAMPTZ;
    ALTER TABLE user_push_subscriptions ADD COLUMN IF NOT EXISTS failure_count INTEGER DEFAULT 0;

    CREATE TABLE IF NOT EXISTS push_event_deliveries (
      id VARCHAR(128) PRIMARY KEY,
      event_id VARCHAR(64) NOT NULL,
      endpoint TEXT NOT NULL,
      user_id VARCHAR(64) NOT NULL,
      branch VARCHAR(64),
      device_type VARCHAR(32),
      status VARCHAR(32) NOT NULL,
      status_code INTEGER,
      error_message TEXT,
      dispatched_at TIMESTAMPTZ DEFAULT NOW(),
      CONSTRAINT uq_push_event_endpoint UNIQUE (event_id, endpoint)
    );
    CREATE INDEX IF NOT EXISTS idx_push_event_del_event ON push_event_deliveries(event_id);
  `);
  tableEnsured = true;
}

/**
 * Derives device type from HTTP User-Agent.
 */
export function detectDeviceType(userAgent: string | null): DeviceType {
  if (!userAgent) return 'unknown';
  if (/iPhone|iPad|iPod/i.test(userAgent)) return 'ios';
  if (/Android/i.test(userAgent)) return 'android';
  if (/Windows|Macintosh|Linux|X11/i.test(userAgent)) return 'desktop';
  return 'unknown';
}

/**
 * Registers or updates a user push subscription.
 */
export async function savePushSubscription(params: {
  userId: string;
  branch: string | null;
  endpoint: string;
  p256dh: string;
  auth: string;
  userAgent?: string | null;
}): Promise<string> {
  await ensurePushSubscriptionTable();
  const pool = getDbPool();
  const endpointHash = crypto.createHash("sha256").update(params.endpoint).digest("hex").slice(0, 24);
  const subId = `sub_${endpointHash}`;
  const deviceType = detectDeviceType(params.userAgent || null);

  const res = await pool.query<{ id: string }>(
    `INSERT INTO user_push_subscriptions (
      id, user_id, endpoint, p256dh, auth, user_agent, branch, device_type, failure_count, updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 0, NOW())
    ON CONFLICT (endpoint) DO UPDATE SET
      user_id = EXCLUDED.user_id,
      p256dh = EXCLUDED.p256dh,
      auth = EXCLUDED.auth,
      user_agent = EXCLUDED.user_agent,
      branch = EXCLUDED.branch,
      device_type = EXCLUDED.device_type,
      failure_count = 0,
      updated_at = NOW()
    RETURNING id`,
    [
      subId,
      params.userId,
      params.endpoint,
      params.p256dh,
      params.auth,
      params.userAgent || null,
      params.branch || null,
      deviceType,
    ]
  );

  return res.rows[0]?.id || subId;
}

/**
 * Unsubscribes a user device by endpoint.
 */
export async function deletePushSubscription(endpoint: string, userId?: string): Promise<boolean> {
  await ensurePushSubscriptionTable();
  const pool = getDbPool();
  let res;
  if (userId) {
    res = await pool.query(
      `DELETE FROM user_push_subscriptions WHERE endpoint = $1 AND user_id = $2`,
      [endpoint, userId]
    );
  } else {
    res = await pool.query(
      `DELETE FROM user_push_subscriptions WHERE endpoint = $1`,
      [endpoint]
    );
  }
  return (res.rowCount || 0) > 0;
}

/**
 * Sends a real Web Push notification to a single client subscription with retries and expired cleanup.
 */
export async function sendSinglePushNotification(
  sub: PushSubscriptionRecord,
  payload: WebPushPayload,
  options: { maxRetries?: number } = {}
): Promise<PushDeliveryOutcome> {
  const deviceType: DeviceType = (sub.device_type as DeviceType) || detectDeviceType(sub.user_agent || null);

  if (isTestingModeActiveSync()) {
    return {
      endpoint: sub.endpoint,
      userId: sub.user_id,
      deviceType,
      branch: sub.branch || null,
      success: false,
      error: 'Suppressed: Testing Mode is active',
    };
  }

  ensureWebPushConfigured();
  const pool = getDbPool();
  const maxRetries = options.maxRetries ?? 2;

  const pushSubscription = {
    endpoint: sub.endpoint,
    keys: {
      p256dh: sub.p256dh,
      auth: sub.auth,
    },
  };

  const payloadString = JSON.stringify({
    title: payload.title,
    body: payload.body,
    icon: payload.icon || "/icons/icon-192x192.png",
    badge: payload.badge || "/icons/icon-192x192.png",
    tag: payload.tag || `earthquake-alert-${payload.eventId || Date.now()}`,
    url: payload.url || "/monitoring",
    disasterType: payload.disasterType || "earthquake",
    eventId: payload.eventId,
    timestamp: payload.timestamp || new Date().toISOString(),
  });

  const sendOptions: webpush.RequestOptions = {
    TTL: 3600, // 1 hour time-to-live for critical alerts
    urgency: payload.urgency || 'high',
  };

  let attempt = 0;
  while (attempt <= maxRetries) {
    try {
      const response = await webpush.sendNotification(pushSubscription, payloadString, sendOptions);
      const statusCode = response.statusCode || 201;

      // Delivery confirmed by Push Service provider (FCM / Apple APNs / Mozilla)
      await pool.query(
        `UPDATE user_push_subscriptions 
         SET last_success_at = NOW(), failure_count = 0 
         WHERE endpoint = $1`,
        [sub.endpoint]
      ).catch(() => {});

      return {
        endpoint: sub.endpoint,
        userId: sub.user_id,
        deviceType,
        branch: sub.branch || null,
        success: true,
        statusCode,
      };
    } catch (err: unknown) {
      attempt++;
      const pushError = err as { statusCode?: number; message?: string };
      const statusCode = pushError?.statusCode;

      // HTTP 404 Not Found or 410 Gone: The subscription has expired or was revoked by the user
      // Requirement 5: Expired-subscription cleanup
      if (statusCode === 404 || statusCode === 410) {
        console.warn(`[Web Push] Subscription expired/revoked (${statusCode}) for user ${sub.user_id}. Cleaning up endpoint.`);
        await pool.query(
          `DELETE FROM user_push_subscriptions WHERE endpoint = $1`,
          [sub.endpoint]
        ).catch(() => {});

        return {
          endpoint: sub.endpoint,
          userId: sub.user_id,
          deviceType,
          branch: sub.branch || null,
          success: false,
          statusCode,
          expired: true,
          error: "Subscription expired or revoked on client device (HTTP 410/404)",
        };
      }

      // If temporary network/rate-limiting error and retries remain, back off briefly
      if (attempt <= maxRetries && (statusCode === 429 || !statusCode || statusCode >= 500)) {
        await new Promise((resolve) => setTimeout(resolve, 300 * attempt));
        continue;
      }

      // Record failure in database
      await pool.query(
        `UPDATE user_push_subscriptions 
         SET last_failure_at = NOW(), failure_count = COALESCE(failure_count, 0) + 1 
         WHERE endpoint = $1`,
        [sub.endpoint]
      ).catch(() => {});

      return {
        endpoint: sub.endpoint,
        userId: sub.user_id,
        deviceType,
        branch: sub.branch || null,
        success: false,
        statusCode,
        expired: false,
        error: pushError?.message || "Failed to dispatch push notification",
      };
    }
  }

  return {
    endpoint: sub.endpoint,
    userId: sub.user_id,
    deviceType,
    branch: sub.branch || null,
    success: false,
    error: "Exhausted retries dispatching push notification",
  };
}

/**
 * Dispatches real Web Push notifications for an earthquake event.
 * Preserves branch permissions, national informational visibility, and deduplicates national recipients.
 */
export async function dispatchEarthquakePushNotifications(params: {
  title: string;
  body: string;
  branch: string;
  eventId: string;
  magnitude?: number;
  priorityStoresCount?: number;
  url?: string;
}): Promise<PushDispatchSummary> {
  await ensurePushSubscriptionTable();
  const pool = getDbPool();

  const summary: PushDispatchSummary = {
    attempted: 0,
    delivered: 0,
    failed: 0,
    expiredCleaned: 0,
    deviceBreakdown: {
      android: { attempted: 0, delivered: 0, failed: 0 },
      ios: { attempted: 0, delivered: 0, failed: 0 },
      desktop: { attempted: 0, delivered: 0, failed: 0 },
      unknown: { attempted: 0, delivered: 0, failed: 0 },
    },
    outcomes: [],
  };

  if (isTestingModeActiveSync()) {
    console.log('[Web Push] 🛑 SUPPRESSED: Testing Mode active. Real push notifications blocked.');
    return summary;
  }

  try {
    // 1. Fetch eligible subscriptions:
    // - Branch-specific subscribers (e.g. BMS/BES in affected branch)
    // - National subscribers (HO Users with branch IS NULL, 'NASIONAL', or empty)
    const targetBranch = params.branch.trim().toUpperCase();
    const subsRes = await pool.query<PushSubscriptionRecord>(
      `SELECT s.id, s.user_id, s.endpoint, s.p256dh, s.auth, s.user_agent, s.branch, s.device_type, s.failure_count
       FROM user_push_subscriptions s
       LEFT JOIN users u ON s.user_id = u.id
       WHERE (u.id IS NULL OR (u.status = 'ACTIVE' AND LOWER(COALESCE(u.business_role, '')) NOT IN ('tim_toko', 'rekanan')))
         AND (UPPER(s.branch) = $1 
          OR s.branch IS NULL 
          OR UPPER(s.branch) = 'NASIONAL'
          OR s.branch = '')`,
      [targetBranch]
    );

    if (subsRes.rows.length === 0) {
      console.log(`[Web Push] No active push subscriptions found for branch ${targetBranch} or HO national; skipping dispatches.`);
      return summary;
    }

    // 2. Event deduplication check: Skip endpoints that have already received this earthquake event
    // Ensures National HO subscribers and overlapping branch cycles are never double-notified.
    const alreadyDeliveredRes = await pool.query<{ endpoint: string }>(
      `SELECT endpoint FROM push_event_deliveries WHERE event_id = $1 AND status = 'DELIVERED'`,
      [params.eventId]
    );
    const deliveredEndpoints = new Set(alreadyDeliveredRes.rows.map((r) => r.endpoint));

    const subsToDispatch = subsRes.rows.filter((sub) => {
      if (deliveredEndpoints.has(sub.endpoint)) {
        console.log(`[Web Push] Deduplicating endpoint ${sub.endpoint.slice(0, 24)}... (already delivered for event ${params.eventId})`);
        return false;
      }
      return true;
    });

    if (subsToDispatch.length === 0) {
      console.log(`[Web Push] All ${subsRes.rows.length} subscriptions for event ${params.eventId} already received push; deduplication complete.`);
      return summary;
    }

    const payload: WebPushPayload = {
      title: params.title,
      body: params.body,
      icon: "/icons/icon-192x192.png",
      badge: "/icons/icon-192x192.png",
      tag: `earthquake-${params.eventId}`,
      url: params.url || `/monitoring?disasterId=${encodeURIComponent(params.eventId)}`,
      disasterType: 'earthquake',
      eventId: params.eventId,
      urgency: 'high',
      timestamp: new Date().toISOString(),
    };

    // 3. Dispatch in parallel with outcomes tracking
    const dispatchPromises = subsToDispatch.map(async (sub) => {
      const outcome = await sendSinglePushNotification(sub, payload);

      // Record delivery outcome for deduplication and audit trail
      const deliveryId = `del_${crypto.createHash('sha256').update(`${params.eventId}:${outcome.endpoint}`).digest('hex').slice(0, 32)}`;
      const status = outcome.success ? 'DELIVERED' : (outcome.expired ? 'EXPIRED' : 'FAILED');
      await pool.query(
        `INSERT INTO push_event_deliveries (
          id, event_id, endpoint, user_id, branch, device_type, status, status_code, error_message, dispatched_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
        ON CONFLICT (id) DO UPDATE SET
          status = EXCLUDED.status,
          status_code = EXCLUDED.status_code,
          error_message = EXCLUDED.error_message,
          dispatched_at = NOW()`,
        [
          deliveryId,
          params.eventId,
          outcome.endpoint,
          outcome.userId,
          outcome.branch,
          outcome.deviceType,
          status,
          outcome.statusCode || null,
          outcome.error || null,
        ]
      ).catch((err) => console.warn('[Web Push] Failed to record push delivery audit log:', err));

      return outcome;
    });

    const results = await Promise.allSettled(dispatchPromises);

    for (const res of results) {
      if (res.status === 'fulfilled') {
        const outcome = res.value;
        summary.attempted++;
        summary.outcomes.push(outcome);

        const devType = outcome.deviceType in summary.deviceBreakdown ? outcome.deviceType : 'unknown';
        summary.deviceBreakdown[devType].attempted++;

        if (outcome.success) {
          summary.delivered++;
          summary.deviceBreakdown[devType].delivered++;
        } else {
          summary.failed++;
          summary.deviceBreakdown[devType].failed++;
          if (outcome.expired) {
            summary.expiredCleaned++;
          }
        }
      }
    }

    console.log(
      `[Web Push] Dispatched earthquake alert: attempted=${summary.attempted}, ` +
      `delivered=${summary.delivered}, failed=${summary.failed}, expiredCleaned=${summary.expiredCleaned}`
    );

    return summary;
  } catch (err) {
    console.error("[Web Push] Fatal error during push dispatch:", err);
    return summary;
  }
}
