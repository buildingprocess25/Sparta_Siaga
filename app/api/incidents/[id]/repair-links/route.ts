import { NextResponse } from "next/server";

import { getSessionUser } from "@/lib/auth";
import { getDbPool } from "@/lib/db";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await context.params;
  const values: unknown[] = [id];
  let scope = "";
  if (user.systemRole !== "ADMIN" && user.scope !== "HO") {
    values.push(user.branchCode || user.branch);
    scope = user.branchCode ? ` AND i.branch_code = $${values.length}` : ` AND i.branch = $${values.length}`;
  }
  const { rows } = await getDbPool().query(
    `SELECT l.repair_reference_id, l.verified_by, l.verification_notes, l.created_at
       FROM incident_repair_links l
       JOIN incidents i ON i.id = l.incident_id
      WHERE l.incident_id = $1${scope}
      ORDER BY l.created_at`,
    values
  );
  return NextResponse.json({ data: rows });
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.scope === "HO" && user.systemRole !== "ADMIN") {
    return NextResponse.json({ error: "HO hanya memiliki akses baca" }, { status: 403 });
  }
  if (user.systemRole !== "ADMIN" && !["bes", "bm"].includes(user.role || "")) {
    return NextResponse.json({ error: "Role tidak berwenang menautkan pekerjaan" }, { status: 403 });
  }
  const { id } = await context.params;
  const body = await request.json();
  if (!body.repairReferenceId) {
    return NextResponse.json({ error: "Referensi pekerjaan wajib diisi" }, { status: 400 });
  }
  const values: unknown[] = [id, body.repairReferenceId, user.id, body.notes || null];
  let scope = "";
  if (user.systemRole !== "ADMIN") {
    values.push(user.branchCode || user.branch);
    scope = user.branchCode ? ` AND branch_code = $${values.length}` : ` AND branch = $${values.length}`;
  }
  const client = await getDbPool().connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `INSERT INTO incident_repair_links
         (incident_id, repair_reference_id, verified_by, verification_notes)
       SELECT id, $2, $3, $4 FROM incidents
        WHERE id = $1${scope}
       ON CONFLICT (incident_id, repair_reference_id) DO NOTHING
       RETURNING *`, values
    );
    if (!result.rows[0]) { await client.query("ROLLBACK"); return NextResponse.json({ error: "Laporan tidak ditemukan atau tautan sudah ada" }, { status: 409 }); }
    await client.query(
      `INSERT INTO incident_repair_link_history
        (incident_id, repair_reference_id, action, actor_user_id, notes)
       VALUES ($1, $2, 'LINK', $3, $4)`, [id, body.repairReferenceId, user.id, body.notes || null]
    );
    await client.query("COMMIT");
    return NextResponse.json({ data: result.rows[0] }, { status: 201 });
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.scope === "HO" && user.systemRole !== "ADMIN") return NextResponse.json({ error: "HO hanya memiliki akses baca" }, { status: 403 });
  if (user.systemRole !== "ADMIN" && !["bes", "bm"].includes(user.role || "")) return NextResponse.json({ error: "Role tidak berwenang melepas tautan" }, { status: 403 });
  const { id } = await context.params;
  const body = await request.json();
  if (!body.repairReferenceId) return NextResponse.json({ error: "Referensi pekerjaan wajib diisi" }, { status: 400 });
  const client = await getDbPool().connect();
  try {
    await client.query("BEGIN");
    const values: unknown[] = [id, body.repairReferenceId];
    let scope = "";
    if (user.systemRole !== "ADMIN") { values.push(user.branchCode || user.branch); scope = user.branchCode ? ` AND i.branch_code = $${values.length}` : ` AND i.branch = $${values.length}`; }
    const removed = await client.query(
      `DELETE FROM incident_repair_links l USING incidents i
        WHERE l.incident_id = i.id AND l.incident_id = $1 AND l.repair_reference_id = $2${scope}
        RETURNING l.repair_reference_id`, values
    );
    if (!removed.rows[0]) { await client.query("ROLLBACK"); return NextResponse.json({ error: "Tautan tidak ditemukan" }, { status: 404 }); }
    await client.query(
      `INSERT INTO incident_repair_link_history
        (incident_id, repair_reference_id, action, actor_user_id, notes)
       VALUES ($1, $2, 'UNLINK', $3, $4)`, [id, body.repairReferenceId, user.id, body.notes || null]
    );
    await client.query("COMMIT");
    return NextResponse.json({ data: { removed: true } });
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}
