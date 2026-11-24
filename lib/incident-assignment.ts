import { getDbPool } from "./db";
import { branchSqlKey, branchSqlParameter } from "./sparta-rollout";

export async function assignIncidentPicForPersistedAction(
  client: { query: (text: string, values?: unknown[]) => Promise<{ rows: any[]; rowCount?: number }> },
  input: {
    incidentId: string;
    userId: string;
    branch: string | null;
    role?: string | null;
    action: string;
  }
): Promise<{ assigned: boolean; currentPicUserId: string | null; reason?: string }> {
  const locked = await client.query(
    `SELECT primary_pic_user_id, location_kind, tkp_type, branch, to_jsonb(incidents)->>'branch_code' AS branch_code FROM incidents WHERE id = $1 FOR UPDATE`,
    [input.incidentId]
  );
  if (!locked.rows[0]) {
    return { assigned: false, currentPicUserId: null, reason: "INCIDENT_NOT_FOUND" };
  }

  const row = locked.rows[0];
  if (row.primary_pic_user_id) {
    return { assigned: false, currentPicUserId: row.primary_pic_user_id };
  }

  // Check branch
  if (input.branch && row.branch) {
    const match = await client.query(`SELECT ${branchSqlParameter("$1")}=${branchSqlParameter("$2")} AS same_branch`, [input.branch, row.branch_code || row.branch]);
    if (!match.rows[0]?.same_branch) {
      return { assigned: false, currentPicUserId: null, reason: "BRANCH_MISMATCH" };
    }
  }

  // Check role eligibility: BMS for store/non-facility, BES for DC/facility
  const isFacility = row.location_kind === "FACILITY" || row.tkp_type === "dc";
  const userRole = (input.role || "").toLowerCase();
  if (userRole === "bms" && isFacility) {
    return { assigned: false, currentPicUserId: null, reason: "BMS_STORE_ONLY" };
  }
  if (userRole === "bes" && !isFacility) {
    return { assigned: false, currentPicUserId: null, reason: "BES_FACILITY_ONLY" };
  }

  // Only assign if role is eligible (bms or bes, or if not specified/admin)
  if (userRole && !["bms", "bes"].includes(userRole)) {
    return { assigned: false, currentPicUserId: null, reason: "ROLE_NOT_ELIGIBLE" };
  }

  await client.query(
    `UPDATE incidents
     SET primary_pic_user_id = $2,
         primary_pic_claimed_at = NOW(),
         updated_at = NOW()
     WHERE id = $1 AND primary_pic_user_id IS NULL`,
    [input.incidentId, input.userId]
  );

  const reasonText = `Aksi operasional: ${input.action}`;
  await client.query(
    `INSERT INTO incident_pic_history
       (incident_id, action, to_user_id, actor_user_id, reason)
     VALUES ($1, 'AUTO_ASSIGN', $2, $2, $3)`,
    [input.incidentId, input.userId, reasonText]
  );

  return { assigned: true, currentPicUserId: input.userId };
}

export async function claimIncidentPic(input: {
  incidentId: string;
  userId: string;
  branch: string | null;
  systemRole: string;
  role?: string | null;
}): Promise<{ claimed: boolean; currentPicUserId: string | null; status?: string; claimedAt?: string; error?: string }> {
  const client = await getDbPool().connect();
  try {
    await client.query("BEGIN");
    const values: unknown[] = [input.incidentId];
    let branchClause = "";
    if (input.systemRole !== "ADMIN") {
      values.push(input.branch);
      branchClause = ` AND ${branchSqlKey("branch")} = ${branchSqlParameter(`$${values.length}`)}`;
    }

    const checkRes = await client.query<{ primary_pic_user_id: string | null; location_kind: string | null; tkp_type: string | null; status: string }>(
      `SELECT primary_pic_user_id, location_kind, tkp_type, status FROM incidents WHERE id = $1${branchClause} FOR UPDATE`,
      values
    );

    if (!checkRes.rows[0]) {
      await client.query("COMMIT");
      return { claimed: false, currentPicUserId: null, error: "INCIDENT_NOT_FOUND" };
    }

    const row = checkRes.rows[0];

    // Check role eligibility if not ADMIN
    if (input.systemRole !== "ADMIN" && input.role) {
      const isFacility = row.location_kind === "FACILITY" || row.tkp_type === "dc";
      if (input.role === "bms" && isFacility) {
        await client.query("COMMIT");
        return { claimed: false, currentPicUserId: row.primary_pic_user_id, error: "BMS_STORE_ONLY" };
      }
      if (input.role === "bes" && !isFacility) {
        await client.query("COMMIT");
        return { claimed: false, currentPicUserId: row.primary_pic_user_id, error: "BES_FACILITY_ONLY" };
      }
    }

    // Check if already claimed
    if (row.primary_pic_user_id) {
      await client.query("COMMIT");
      return {
        claimed: false,
        currentPicUserId: row.primary_pic_user_id,
        status: row.status,
      };
    }

    const result = await client.query<{ primary_pic_user_id: string; status: string; primary_pic_claimed_at: string }>(
      `UPDATE incidents
          SET primary_pic_user_id = $2,
              primary_pic_claimed_at = NOW(),
              status = CASE WHEN status IN ('pending_confirmation', 'verifying', 'confirmed_affected') THEN 'investigating' ELSE status END,
              updated_at = NOW()
        WHERE id = $1 AND primary_pic_user_id IS NULL
        RETURNING primary_pic_user_id, status, primary_pic_claimed_at`,
      [input.incidentId, input.userId]
    );

    if (result.rows[0]) {
      await client.query(
        `INSERT INTO incident_pic_history
           (incident_id, action, to_user_id, actor_user_id)
         VALUES ($1, 'CLAIM', $2, $2)`,
        [input.incidentId, input.userId]
      );
      await client.query("COMMIT");
      return {
        claimed: true,
        currentPicUserId: input.userId,
        status: result.rows[0].status,
        claimedAt: result.rows[0].primary_pic_claimed_at,
      };
    }

    await client.query("COMMIT");
    return {
      claimed: false,
      currentPicUserId: null,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function changeIncidentPic(input: {
  incidentId: string;
  actorUserId: string;
  nextUserId: string | null;
  branch: string | null;
  systemRole: string;
  reason?: string;
}) {
  const client = await getDbPool().connect();
  try {
    await client.query("BEGIN");
    const values: unknown[] = [input.incidentId];
    let scope = "";
    if (input.systemRole !== "ADMIN") {
      values.push(input.branch);
      scope = ` AND ${branchSqlKey("branch")} = ${branchSqlParameter(`$${values.length}`)}`;
    }
    const locked = await client.query<{ primary_pic_user_id: string | null; location_kind: string | null }>(
      `SELECT primary_pic_user_id, location_kind FROM incidents WHERE id = $1${scope} FOR UPDATE`, values
    );
    if (!locked.rows[0]) throw new Error("INCIDENT_NOT_FOUND");
    const previous = locked.rows[0].primary_pic_user_id;
    if (!previous && !input.nextUserId) throw new Error("PIC_NOT_ASSIGNED");
    if (input.nextUserId) {
      const requiredRole = locked.rows[0].location_kind === "FACILITY" ? "bes" : "bms";
      const eligible = await client.query(
        `SELECT id FROM users WHERE id = $1 AND status = 'ACTIVE'
          AND ${branchSqlKey("branch")} = (SELECT ${branchSqlKey("branch")} FROM incidents WHERE id = $2)
          AND business_role = $3`,
        [input.nextUserId, input.incidentId, requiredRole]
      );
      if (!eligible.rows[0]) throw new Error("TARGET_PIC_NOT_ELIGIBLE");
    }
    await client.query(
      `UPDATE incidents SET primary_pic_user_id = $2,
         primary_pic_claimed_at = CASE WHEN $2::text IS NULL THEN NULL ELSE NOW() END,
         updated_at = NOW() WHERE id = $1`,
      [input.incidentId, input.nextUserId]
    );
    const action = !previous ? "ASSIGN" : input.nextUserId ? "TRANSFER" : "RELEASE";
    await client.query(
      `INSERT INTO incident_pic_history
        (incident_id, action, from_user_id, to_user_id, actor_user_id, reason)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [input.incidentId, action, previous,
        input.nextUserId, input.actorUserId, input.reason ?? null]
    );
    await client.query("COMMIT");
    return { previousPicUserId: previous, currentPicUserId: input.nextUserId };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}

export async function getIncidentPicDetails(incidentId: string, branch?: string | null) {
  const values: unknown[] = [incidentId];
  let scope = "";
  if (branch !== undefined) { values.push(branch); scope = ` AND ${branchSqlKey("i.branch")} = ${branchSqlParameter(`$${values.length}`)}`; }
  const incident = await getDbPool().query(
    `SELECT i.id, i.branch, to_jsonb(i)->>'branch_code' AS branch_code, i.location_kind, i.primary_pic_user_id, u.name AS primary_pic_name
       FROM incidents i LEFT JOIN users u ON u.id = i.primary_pic_user_id
      WHERE i.id = $1${scope}`, values
  );
  if (!incident.rows[0]) return null;
  const [history, eligible] = await Promise.all([
    getDbPool().query(
      `SELECT h.*, actor.name AS actor_name, previous.name AS from_user_name,
              target.name AS to_user_name
         FROM incident_pic_history h
         LEFT JOIN users actor ON actor.id = h.actor_user_id
         LEFT JOIN users previous ON previous.id = h.from_user_id
         LEFT JOIN users target ON target.id = h.to_user_id
        WHERE h.incident_id = $1 ORDER BY h.created_at DESC`, [incidentId]
    ),
    getDbPool().query(
      `SELECT id, name, business_role FROM users
        WHERE ${branchSqlKey("branch")} = ${branchSqlParameter("$1")} AND status = 'ACTIVE'
          AND business_role = CASE WHEN $2 = 'FACILITY' THEN 'bes' ELSE 'bms' END
        ORDER BY name`, [incident.rows[0].branch_code || incident.rows[0].branch, incident.rows[0].location_kind]
    ),
  ]);
  return { ...incident.rows[0], history: history.rows, eligibleUsers: eligible.rows };
}
