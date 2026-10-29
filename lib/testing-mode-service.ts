import { getProductionDbPool, setTestingModeActiveSync, isTestingModeActiveSync } from './db';

export interface TestingModeState {
  enabled: boolean;
  enabledAt?: string;
  enabledBy?: string;
  reason?: string;
}

export interface SystemAuditLogEntry {
  id: string;
  action: string;
  target: string;
  details: any;
  actor_user_id: string;
  actor_name?: string;
  created_at: string;
}

let cachedState: { state: TestingModeState; expiresAt: number } | null = null;
const CACHE_TTL_MS = 5000;

/**
 * Retrieves the current Testing Mode state from production DB (or cache).
 * Synchronizes the in-memory sync flag in lib/db.ts.
 */
export async function getTestingModeState(): Promise<TestingModeState> {
  const now = Date.now();
  if (cachedState && cachedState.expiresAt > now) {
    return cachedState.state;
  }

  try {
    const pool = getProductionDbPool();
    const result = await pool.query(
      `SELECT value, updated_at, updated_by FROM system_settings WHERE key = 'testing_mode' LIMIT 1`
    );

    if (result.rowCount && result.rows[0]) {
      const row = result.rows[0];
      const val = row.value || {};
      const state: TestingModeState = {
        enabled: Boolean(val.enabled),
        enabledAt: row.updated_at ? new Date(row.updated_at).toISOString() : val.enabledAt,
        enabledBy: row.updated_by || val.enabledBy,
        reason: val.reason,
      };

      setTestingModeActiveSync(state.enabled);
      cachedState = { state, expiresAt: now + CACHE_TTL_MS };
      return state;
    }
  } catch (error) {
    console.warn('[Testing Mode Service] Warning reading testing mode state:', error);
  }

  // Fallback to safe default (OFF)
  const fallbackState: TestingModeState = { enabled: false };
  setTestingModeActiveSync(false);
  return fallbackState;
}

/**
 * Checks if Testing Mode is active asynchronously.
 */
export async function isTestingModeActive(): Promise<boolean> {
  const state = await getTestingModeState();
  return state.enabled;
}

/**
 * Toggles Testing Mode state. Admin-only operation.
 * Persists to system_settings, writes to system_audit_logs, updates sync flag.
 */
export async function setTestingModeState(
  enabled: boolean,
  actor: { id: string; name: string },
  reason?: string
): Promise<TestingModeState> {
  const pool = getProductionDbPool();
  const now = new Date().toISOString();

  // Fetch current state for audit log comparison
  let previousState = false;
  try {
    const prevRes = await pool.query(
      `SELECT value FROM system_settings WHERE key = 'testing_mode' LIMIT 1`
    );
    if (prevRes.rowCount && prevRes.rows[0]) {
      previousState = Boolean(prevRes.rows[0].value?.enabled);
    }
  } catch {
    // ignore
  }

  const newStateVal = {
    enabled,
    reason: reason || (enabled ? 'UAT Testing enabled by administrator' : 'UAT Testing disabled, production restored'),
    enabledAt: now,
    enabledBy: actor.name || actor.id,
  };

  // Upsert system_settings
  await pool.query(
    `INSERT INTO system_settings (key, value, updated_at, updated_by)
     VALUES ('testing_mode', $1, NOW(), $2)
     ON CONFLICT (key) DO UPDATE
     SET value = EXCLUDED.value,
         updated_at = EXCLUDED.updated_at,
         updated_by = EXCLUDED.updated_by`,
    [JSON.stringify(newStateVal), actor.id]
  );

  // Write audit trail
  try {
    await pool.query(
      `INSERT INTO system_audit_logs (action, target, details, actor_user_id, actor_name, created_at)
       VALUES ($1, $2, $3, $4, $5, NOW())`,
      [
        'TESTING_MODE_TOGGLED',
        'system_settings',
        JSON.stringify({
          previous: previousState,
          current: enabled,
          reason: newStateVal.reason,
        }),
        actor.id,
        actor.name,
      ]
    );
  } catch (auditErr) {
    console.warn('[Testing Mode Service] Warning writing system audit log:', auditErr);
  }

  // Update sync flag immediately
  setTestingModeActiveSync(enabled);

  const updatedState: TestingModeState = {
    enabled,
    enabledAt: now,
    enabledBy: newStateVal.enabledBy,
    reason: newStateVal.reason,
  };

  cachedState = { state: updatedState, expiresAt: Date.now() + CACHE_TTL_MS };
  return updatedState;
}

/**
 * Fetch recent audit logs for system settings and testing mode
 */
export async function getTestingModeAuditLogs(limit: number = 20): Promise<SystemAuditLogEntry[]> {
  try {
    const pool = getProductionDbPool();
    const result = await pool.query(
      `SELECT id, action, target, details, actor_user_id, actor_name, created_at
       FROM system_audit_logs
       ORDER BY created_at DESC
       LIMIT $1`,
      [limit]
    );
    return result.rows.map((r) => ({
      id: r.id,
      action: r.action,
      target: r.target,
      details: r.details,
      actor_user_id: r.actor_user_id,
      actor_name: r.actor_name,
      created_at: new Date(r.created_at).toISOString(),
    }));
  } catch (error) {
    console.warn('[Testing Mode Service] Warning fetching audit logs:', error);
    return [];
  }
}
