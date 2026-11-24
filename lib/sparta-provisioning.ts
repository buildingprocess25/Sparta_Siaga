import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type { Pool } from "pg";
import { getDbPool } from "./db";
import { branchMasterEnabled } from "./sparta-rollout";
import { CANONICAL_HUMAN_ROLES, deriveScopeFromBusinessRole } from "./role-catalog";
import { fetchPortalMaster } from "./sparta-master-sync";
import { normalizePortalAlias, parsePortalBranches, resolvePortalBranch } from "./sparta-master-contract";
import { identityParameters, selectSpartaIdentity, SPARTA_IDENTITY_WHERE, SpartaIntegrationError } from "./sparta-identity";

export interface ProvisioningEvent {
  eventId: string;
  type: "access.granted" | "access.revoked" | "user.updated" | "user.deactivated";
  occurredAt: string;
  moduleId: "siaga";
  user: { spartaUserId: string; employeeId: string | null; email: string; fullName: string;
    branch: string; branchCode: string; status: "ACTIVE" | "INACTIVE" | "LOCKED" };
  access: { isActive: boolean; role: string };
}

export function verifyProvisioningRequest(raw: string, headers: Headers, secret: string | undefined, now = Date.now()) {
  if (!secret || secret.length < 32) throw new SpartaIntegrationError("PROVISIONING_NOT_CONFIGURED", "Secret provisioning belum dikonfigurasi.", 503);
  const timestampText = headers.get("x-sparta-timestamp") || "";
  const timestamp = Number(timestampText);
  if (!/^\d+$/.test(timestampText) || !Number.isSafeInteger(timestamp) || Math.abs(now / 1000 - timestamp) > 300) {
    throw new SpartaIntegrationError("INVALID_SIGNATURE", "Timestamp provisioning tidak valid.", 401);
  }
  const signature = headers.get("x-sparta-signature") || "";
  const expected = "sha256=" + createHmac("sha256", secret).update(`${timestamp}.${raw}`).digest("hex");
  const supplied = Buffer.from(signature);
  const wanted = Buffer.from(expected);
  if (supplied.length !== wanted.length || !timingSafeEqual(supplied, wanted)) {
    throw new SpartaIntegrationError("INVALID_SIGNATURE", "Tanda tangan provisioning tidak valid.", 401);
  }
}

export function parseProvisioningEvent(value: unknown, eventHeader: string | null, now = Date.now()): ProvisioningEvent {
  const e = value as ProvisioningEvent | null;
  const text = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0 && v.length <= 1024;
  if (!e || !text(e.eventId) || e.eventId !== eventHeader || e.moduleId !== "siaga" ||
    !["access.granted", "access.revoked", "user.updated", "user.deactivated"].includes(e.type) ||
    !text(e.occurredAt) || !Number.isFinite(Date.parse(e.occurredAt)) || Date.parse(e.occurredAt) > now + 300000 ||
    !e.user || !text(e.user.spartaUserId) || !text(e.user.email) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.user.email) ||
    !text(e.user.fullName) || typeof e.user.branch !== "string" || typeof e.user.branchCode !== "string" ||
    !(e.user.employeeId === null || text(e.user.employeeId)) ||
    !["ACTIVE", "INACTIVE", "LOCKED"].includes(e.user.status) ||
    !e.access || typeof e.access.isActive !== "boolean" || typeof e.access.role !== "string") {
    throw new SpartaIntegrationError("INVALID_PROVISIONING_EVENT", "Payload provisioning SIAGA tidak valid.");
  }
  return e;
}

export function initialProvisioningRole(value: string) {
  const role = value.trim().toLowerCase();
  const known = CANONICAL_HUMAN_ROLES.find(r => r.key === role && r.key !== "tim_toko");
  if (!known) throw new SpartaIntegrationError("UNKNOWN_BUSINESS_ROLE", "Role portal belum terdaftar di katalog role SIAGA.", 422);
  return known.key;
}

export async function applyProvisioningEvent(event: ProvisioningEvent, options: { pool?: Pool; fetchFn?: typeof fetch } = {}) {
  const pool = options.pool || getDbPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(7421841)");
    const checkpoint = await client.query("SELECT occurred_at FROM sparta_provisioning_state WHERE external_user_id=$1 FOR UPDATE", [event.user.spartaUserId.trim()]);
    if (checkpoint.rows[0] && Date.parse(event.occurredAt) <= new Date(checkpoint.rows[0].occurred_at).getTime()) {
      await client.query("COMMIT");
      return { result: "ignored", reason: "stale_event" };
    }
    const saveCheckpoint = () => client.query(`INSERT INTO sparta_provisioning_state(external_user_id,event_id,occurred_at)
      VALUES($1,$2,$3) ON CONFLICT(external_user_id) DO UPDATE SET event_id=EXCLUDED.event_id,occurred_at=EXCLUDED.occurred_at`,
    [event.user.spartaUserId.trim(), event.eventId, event.occurredAt]);
    const identity = { spartaUserId: event.user.spartaUserId, employeeId: event.user.employeeId, email: event.user.email };
    const { rows } = await client.query(`SELECT * FROM users WHERE ${SPARTA_IDENTITY_WHERE} FOR UPDATE`, identityParameters(identity));
    const user = selectSpartaIdentity(rows, identity);
    if (user?.last_provisioned_at && Date.parse(event.occurredAt) <= new Date(user.last_provisioned_at).getTime()) {
      await client.query("COMMIT");
      return { result: "ignored", reason: "stale_event" };
    }
    const disable = event.type === "access.revoked" || event.type === "user.deactivated" ||
      !event.access.isActive || event.user.status !== "ACTIVE";
    if (!user && disable) {
      await saveCheckpoint();
      await client.query("COMMIT");
      return { result: "ignored", reason: "unknown_user" };
    }
    const id = user?.id || `usr_sparta_${randomUUID()}`;
    const branchCode = event.user.branchCode.trim() || null;
    const convertBranch = branchMasterEnabled();
    const systemAdmin = user?.system_role === "ADMIN";
    const existingRole = user?.business_role ?? null;
    // user.updated from Portal only updates identity/status, never overwriting an established local SIAGA role or scope.
    const preserveLocalRole = !disable && !systemAdmin && event.type === "user.updated" && Boolean(existingRole);
    const role = disable || systemAdmin
      ? existingRole
      : preserveLocalRole
        ? existingRole
        : initialProvisioningRole(event.access.role);
    const scope = systemAdmin
      ? null
      : disable
        ? user?.scope ?? null
        : preserveLocalRole && (user?.scope === "HO" || user?.scope === "BRANCH")
          ? user.scope
          : deriveScopeFromBusinessRole(role);
    const existingBranch = user?.branch?.trim() && user.branch.trim() !== "-" ? user.branch.trim() : null;
    let assignedBranch = systemAdmin || scope === "HO" ? null : existingBranch;
    if (!disable && scope === "BRANCH" && (convertBranch || !existingBranch) && (!event.user.branch.trim() || event.user.branch.trim() === "-")) {
      throw new SpartaIntegrationError("BRANCH_ASSIGNMENT_REQUIRED", "User cabang harus memiliki cabang dari portal.", 422);
    }
    if (convertBranch && !disable && scope === "BRANCH") {
      if (!branchCode) throw new SpartaIntegrationError("BRANCH_ASSIGNMENT_REQUIRED", "Kode cabang portal wajib diisi.", 422);
      const branch = await client.query("SELECT code FROM sparta_master_branches WHERE code=$1 AND is_active=TRUE", [branchCode]);
      if (!branch.rows.length) throw new SpartaIntegrationError("UNKNOWN_PORTAL_BRANCH", "Sinkronkan master cabang sebelum provisioning user.", 503);
      assignedBranch = event.user.branch.trim();
    } else if (!disable && scope === "BRANCH" && !existingBranch) {
      const local = await client.query(`SELECT DISTINCT branch AS name FROM users WHERE NULLIF(BTRIM(branch),'') IS NOT NULL
        UNION SELECT DISTINCT cabang AS name FROM stores WHERE NULLIF(BTRIM(cabang),'') IS NOT NULL`);
      const names = [...new Set(local.rows.map(row => String(row.name).trim()))];
      let matches = names.filter(name => normalizePortalAlias(name) === normalizePortalAlias(event.user.branch));
      if (!matches.length) {
        const master = parsePortalBranches((await fetchPortalMaster("branches", { fetchFn: options.fetchFn })).data);
        const target = resolvePortalBranch(branchCode || event.user.branch, master);
        if (target) matches = names.filter(name => resolvePortalBranch(name, master) === target);
      }
      if (matches.length !== 1) throw new SpartaIntegrationError("LEGACY_BRANCH_MAPPING_REQUIRED",
        "Cabang portal belum memiliki satu padanan cabang SIAGA. Periksa alias pusat sebelum mengirim ulang event.", 422);
      assignedBranch = matches[0];
    }
    if (!user) {
      await client.query(`INSERT INTO users (id,external_user_id,nik,name,email,system_role,business_role,scope,
        branch,pending_portal_branch,status,source,sso_status,last_provisioned_at)
        VALUES($1,$2,$3,$4,$5,'USER',$6,$7,$8,$9::jsonb,'ACTIVE','SPARTA','ACTIVE',$10)`,
      [id, event.user.spartaUserId.trim(), event.user.employeeId?.trim() || null, event.user.fullName.trim(),
        event.user.email.trim().toLowerCase(), role, scope, assignedBranch, JSON.stringify({ branch: event.user.branch, branchCode }), event.occurredAt]);
    } else {
      const ssoStatus = disable ? "BLOCKED" : "ACTIVE";
      const status = disable ? "INACTIVE" : "ACTIVE";
      const changesAccess = disable || user.status !== status || user.sso_status !== ssoStatus ||
        user.business_role !== role || user.scope !== scope || (user.branch || null) !== assignedBranch ||
        user.source !== "SPARTA" || (convertBranch && (user.branch_code || null) !== branchCode);
      await client.query(`UPDATE users SET external_user_id=$2,nik=$3,name=$4,email=$5,
        pending_portal_branch=jsonb_build_object('branch',$6::text,'branchCode',$7::text),
        source='SPARTA',status=$8,sso_status=$9,last_provisioned_at=$10,
        token_version=COALESCE(token_version,1)+$11,business_role=$12,scope=$13,branch=$14,updated_at=NOW() WHERE id=$1`,
      [id, event.user.spartaUserId.trim(), event.user.employeeId?.trim() || null, event.user.fullName.trim(),
        event.user.email.trim().toLowerCase(), event.user.branch.trim() || null, branchCode, status, ssoStatus,
        event.occurredAt, changesAccess ? 1 : 0, role, scope, assignedBranch]);
      if (changesAccess) await client.query("UPDATE user_sessions SET is_revoked=TRUE WHERE user_id=$1", [id]);
    }
    if (convertBranch && !disable && branchCode) {
      await client.query(`UPDATE users SET branch=$2,branch_code=$3 WHERE id=$1
        AND system_role<>'ADMIN' AND COALESCE(scope,'')<>'HO'`, [id, event.user.branch, branchCode]);
    }
    await saveCheckpoint();
    await client.query("COMMIT");
    return { result: "applied", userId: id, requiresLocalScope: false, branchConversionDeferred: !convertBranch };
  } catch (error) {
    await client.query("ROLLBACK");
    if ((error as { code?: string }).code === "23505") {
      throw new SpartaIntegrationError("IDENTITY_CONFLICT", "Identitas user sudah digunakan oleh akun lain.", 409);
    }
    if (["42703", "42P01"].includes((error as { code?: string }).code || "")) {
      throw new SpartaIntegrationError("PROVISIONING_SCHEMA_NOT_READY",
        "Schema provisioning belum lengkap. Periksa migrasi tahap user 018/020 dan migrasi 021 hanya jika konversi akhir diaktifkan.", 503);
    }
    throw error;
  } finally { client.release(); }
}
