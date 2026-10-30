import crypto from "crypto";
import { getDbPool } from "./db";
import { signSession, SessionPayload } from "./jwt";
import { dbGetUserById } from "./user-db";
import { detectDeviceType } from "./web-push-service";
import { UserModel } from "./user-db";
import { getJwtSecret } from "./runtime-config";

export interface DeviceSessionRecord {
  id: string;
  user_id: string;
  refresh_token_hash: string;
  previous_refresh_token_hash?: string | null;
  previous_token_expires_at?: string | null;
  current_token_encrypted?: string | null;
  device_type: string;
  user_agent?: string | null;
  ip_address?: string | null;
  token_version: number;
  is_revoked: boolean;
  created_at: string;
  last_used_at: string;
  expires_at: string;
}

export interface SessionCreationResult {
  sessionId: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
  user: UserModel;
}

export interface SessionRefreshResult {
  sessionId: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
  user: UserModel;
}

let tableEnsured = false;

/**
 * Ensures the user_sessions table exists with appropriate indexes and columns.
 */
export async function ensureUserSessionsTable(): Promise<void> {
  if (tableEnsured) return;
  const pool = getDbPool();
  await pool.query(`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS token_version INTEGER DEFAULT 1;

    CREATE TABLE IF NOT EXISTS user_sessions (
      id VARCHAR(64) PRIMARY KEY,
      user_id VARCHAR(64) NOT NULL,
      refresh_token_hash VARCHAR(64) NOT NULL UNIQUE,
      previous_refresh_token_hash VARCHAR(64),
      previous_token_expires_at TIMESTAMPTZ,
      current_token_encrypted TEXT,
      device_type VARCHAR(32) DEFAULT 'unknown',
      user_agent TEXT,
      ip_address VARCHAR(64),
      token_version INTEGER DEFAULT 1,
      is_revoked BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      last_used_at TIMESTAMPTZ DEFAULT NOW(),
      expires_at TIMESTAMPTZ NOT NULL
    );
    ALTER TABLE user_sessions ADD COLUMN IF NOT EXISTS previous_refresh_token_hash VARCHAR(64);
    ALTER TABLE user_sessions ADD COLUMN IF NOT EXISTS previous_token_expires_at TIMESTAMPTZ;
    ALTER TABLE user_sessions ADD COLUMN IF NOT EXISTS current_token_encrypted TEXT;

    CREATE INDEX IF NOT EXISTS idx_user_sessions_user ON user_sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_user_sessions_hash ON user_sessions(refresh_token_hash);
    CREATE INDEX IF NOT EXISTS idx_user_sessions_prev_hash ON user_sessions(previous_refresh_token_hash);
    CREATE INDEX IF NOT EXISTS idx_user_sessions_expires ON user_sessions(expires_at);
    CREATE INDEX IF NOT EXISTS idx_user_sessions_prev_token_grace ON user_sessions(previous_refresh_token_hash, previous_token_expires_at);
  `);
  tableEnsured = true;
}

/**
 * Derives a 256-bit symmetric key from JWT secret for AES-256-GCM.
 */
function getEncryptionKey(): Buffer {
  let secret: string;
  try {
    secret = getJwtSecret();
  } catch {
    secret = process.env.JWT_SECRET || "development-fallback-secret-at-least-32-chars-long";
  }
  return crypto.createHash("sha256").update(`session_token_enc:${secret}`).digest();
}

/**
 * Encrypts a raw token string using authenticated AES-256-GCM.
 */
export function encryptToken(token: string): string {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${tag.toString("hex")}:${encrypted.toString("hex")}`;
}

/**
 * Decrypts an encrypted token string using authenticated AES-256-GCM.
 * Returns null if decryption or authentication tag validation fails.
 */
export function decryptToken(encryptedData: string | null | undefined): string | null {
  if (!encryptedData) return null;
  try {
    const parts = encryptedData.split(":");
    if (parts.length !== 3) return null;
    const [ivHex, tagHex, dataHex] = parts;
    const key = getEncryptionKey();
    const iv = Buffer.from(ivHex, "hex");
    const tag = Buffer.from(tagHex, "hex");
    const data = Buffer.from(dataHex, "hex");
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
    return decrypted.toString("utf8");
  } catch {
    return null;
  }
}

/**
 * Computes SHA-256 hash of a raw token for secure database storage.
 */
export function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

/**
 * Generates a cryptographically strong 256-bit base64url refresh token.
 */
export function generateRefreshToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

/**
 * Creates a persistent per-device session with a rotating refresh token (30-day sliding window).
 */
export async function createDeviceSession(params: {
  userId: string;
  userAgent?: string | null;
  ipAddress?: string | null;
  tokenVersion?: number;
}): Promise<SessionCreationResult | null> {
  await ensureUserSessionsTable();
  const pool = getDbPool();

  const user = await dbGetUserById(params.userId);
  if (!user || user.status !== "ACTIVE") {
    console.warn(`[Session Service] Cannot create session for missing/inactive user: ${params.userId}`);
    return null;
  }

  const sessionId = `sess_${user.id}_${crypto.randomBytes(8).toString("hex")}`;
  const rawRefreshToken = generateRefreshToken();
  const tokenHash = hashToken(rawRefreshToken);
  const encryptedToken = encryptToken(rawRefreshToken);
  const deviceType = detectDeviceType(params.userAgent || null);
  const tokenVersion = params.tokenVersion || user.tokenVersion || 1;

  // 30 days session expiration
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

  await pool.query(
    `INSERT INTO user_sessions (
      id, user_id, refresh_token_hash, current_token_encrypted, device_type, user_agent, ip_address,
      token_version, is_revoked, created_at, last_used_at, expires_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, FALSE, NOW(), NOW(), $9)`,
    [
      sessionId,
      user.id,
      tokenHash,
      encryptedToken,
      deviceType,
      params.userAgent || null,
      params.ipAddress || null,
      tokenVersion,
      expiresAt.toISOString(),
    ]
  );

  const accessToken = await signSession({
    id: user.id,
    nik: user.nik,
    systemRole: user.systemRole,
    v: tokenVersion,
  });

  return {
    sessionId,
    accessToken,
    refreshToken: rawRefreshToken,
    expiresAt,
    user,
  };
}

/**
 * Rotates an active refresh token (Refresh Token Rotation - RTR) and returns a new access/refresh pair.
 * Uses atomic row locking (FOR UPDATE) to prevent concurrency races.
 * In grace period, returns the current valid token to prevent cookie overwrites with stale tokens.
 */
export async function rotateDeviceSession(
  rawRefreshToken: string,
  options: {
    userAgent?: string | null;
    ipAddress?: string | null;
    allowGracePeriod?: boolean;
  } = {}
): Promise<SessionRefreshResult | null> {
  if (!rawRefreshToken || typeof rawRefreshToken !== "string") {
    return null;
  }

  await ensureUserSessionsTable();
  const pool = getDbPool();
  const tokenHash = hashToken(rawRefreshToken);
  const allowGrace = options.allowGracePeriod ?? false;

  const client = await pool.connect();

  try {
    await client.query("BEGIN TRANSACTION ISOLATION LEVEL READ COMMITTED");

    // Lock the session row FOR UPDATE to serialize concurrent rotation attempts
    const queryText = allowGrace
      ? `SELECT * FROM user_sessions 
         WHERE refresh_token_hash = $1 
            OR (previous_refresh_token_hash = $1 AND previous_token_expires_at > NOW())
         ORDER BY CASE WHEN refresh_token_hash = $1 THEN 0 ELSE 1 END
         LIMIT 1
         FOR UPDATE`
      : `SELECT * FROM user_sessions WHERE refresh_token_hash = $1 LIMIT 1 FOR UPDATE`;

    const { rows } = await client.query<DeviceSessionRecord>(queryText, [tokenHash]);

    if (rows.length === 0) {
      // Check if this was a reuse of an old rotated token whose grace period expired
      const reuseCheck = await client.query(
        `SELECT id, user_id FROM user_sessions 
         WHERE previous_refresh_token_hash = $1 AND previous_token_expires_at <= NOW()
         LIMIT 1`,
        [tokenHash]
      );
      if (reuseCheck.rows.length > 0) {
        console.warn(`[Session Service] Stale token used outside grace period for session ${reuseCheck.rows[0].id}. Revoking session family.`);
        await client.query(`UPDATE user_sessions SET is_revoked = TRUE WHERE id = $1`, [reuseCheck.rows[0].id]);
        await client.query("COMMIT");
        return null;
      }
      await client.query("ROLLBACK");
      return null;
    }

    const session = rows[0];

    // If token was already revoked, reject
    if (session.is_revoked) {
      await client.query("ROLLBACK");
      return null;
    }

    // Check expiration
    const expiresAtDate = new Date(session.expires_at);
    if (expiresAtDate.getTime() <= Date.now()) {
      await client.query("ROLLBACK");
      return null;
    }

    // Verify user status and token version in database (using existing client to prevent pool starvation)
    const user = await dbGetUserById(session.user_id, client);
    if (!user || user.status !== "ACTIVE") {
      await client.query(`UPDATE user_sessions SET is_revoked = TRUE WHERE id = $1`, [session.id]);
      await client.query("COMMIT");
      return null;
    }

    if (user.tokenVersion && session.token_version < user.tokenVersion) {
      await client.query(`UPDATE user_sessions SET is_revoked = TRUE WHERE id = $1`, [session.id]);
      await client.query("COMMIT");
      return null;
    }

    // Grace period match: recently rotated by a concurrent in-flight request
    const isGraceMatch = allowGrace && session.previous_refresh_token_hash === tokenHash && session.refresh_token_hash !== tokenHash;

    if (isGraceMatch) {
      // Decrypt the active refresh token so we return the NEWEST token, NOT the stale one!
      const activeRefreshToken = decryptToken(session.current_token_encrypted);

      await client.query(
        `UPDATE user_sessions SET last_used_at = NOW() WHERE id = $1`,
        [session.id]
      );

      await client.query("COMMIT");

      const newAccessToken = await signSession({
        id: user.id,
        nik: user.nik,
        systemRole: user.systemRole,
        v: user.tokenVersion || 1,
      });

      return {
        sessionId: session.id,
        accessToken: newAccessToken,
        refreshToken: activeRefreshToken || rawRefreshToken,
        expiresAt: new Date(session.expires_at),
        user,
      };
    }

    // PRIMARY ROTATION: generate brand new refresh token and update database
    const newRawRefreshToken = generateRefreshToken();
    const newTokenHash = hashToken(newRawRefreshToken);
    const newEncryptedToken = encryptToken(newRawRefreshToken);
    const newExpiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // extend sliding window (30 days)

    await client.query(
      `UPDATE user_sessions 
       SET previous_refresh_token_hash = refresh_token_hash,
           previous_token_expires_at = NOW() + INTERVAL '60 seconds',
           refresh_token_hash = $1,
           current_token_encrypted = $2,
           last_used_at = NOW(), 
           expires_at = $3,
           user_agent = COALESCE($4, user_agent),
           ip_address = COALESCE($5, ip_address)
       WHERE id = $6`,
      [
        newTokenHash,
        newEncryptedToken,
        newExpiresAt.toISOString(),
        options.userAgent || null,
        options.ipAddress || null,
        session.id,
      ]
    );

    await client.query("COMMIT");

    const newAccessToken = await signSession({
      id: user.id,
      nik: user.nik,
      systemRole: user.systemRole,
      v: user.tokenVersion || 1,
    });

    return {
      sessionId: session.id,
      accessToken: newAccessToken,
      refreshToken: newRawRefreshToken,
      expiresAt: newExpiresAt,
      user,
    };
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("[Session Service] Rotation error:", err);
    return null;
  } finally {
    client.release();
  }
}

/**
 * Revokes a single device session by its active refresh token.
 */
export async function revokeSessionByRefreshToken(rawRefreshToken: string): Promise<boolean> {
  if (!rawRefreshToken) return false;
  await ensureUserSessionsTable();
  const pool = getDbPool();
  const tokenHash = hashToken(rawRefreshToken);

  const res = await pool.query(
    `UPDATE user_sessions 
     SET is_revoked = TRUE, expires_at = NOW() 
     WHERE refresh_token_hash = $1 OR previous_refresh_token_hash = $1`,
    [tokenHash]
  );
  return (res.rowCount || 0) > 0;
}

/**
 * Revokes all active sessions for a user (Logout All Devices / Admin Revocation).
 * Also increments user token_version.
 */
export async function revokeAllUserSessions(userId: string): Promise<number> {
  await ensureUserSessionsTable();
  const pool = getDbPool();

  await pool.query(
    `UPDATE user_sessions SET is_revoked = TRUE, expires_at = NOW() WHERE user_id = $1`,
    [userId]
  );

  const { rows } = await pool.query(
    `UPDATE users 
     SET token_version = COALESCE(token_version, 1) + 1, updated_at = NOW() 
     WHERE id = $1 
     RETURNING token_version`,
    [userId]
  );

  return rows[0]?.token_version ?? 1;
}

/**
 * Fetches all active non-revoked sessions for a user (Device Management).
 */
export async function getUserActiveSessions(userId: string): Promise<Array<{
  id: string;
  deviceType: string;
  userAgent?: string | null;
  ipAddress?: string | null;
  createdAt: string;
  lastUsedAt: string;
  expiresAt: string;
}>> {
  await ensureUserSessionsTable();
  const pool = getDbPool();

  const { rows } = await pool.query<DeviceSessionRecord>(
    `SELECT id, device_type, user_agent, ip_address, created_at, last_used_at, expires_at
     FROM user_sessions 
     WHERE user_id = $1 AND is_revoked = FALSE AND expires_at > NOW()
     ORDER BY last_used_at DESC`,
    [userId]
  );

  return rows.map((r) => ({
    id: r.id,
    deviceType: r.device_type,
    userAgent: r.user_agent,
    ipAddress: r.ip_address,
    createdAt: r.created_at,
    lastUsedAt: r.last_used_at,
    expiresAt: r.expires_at,
  }));
}
