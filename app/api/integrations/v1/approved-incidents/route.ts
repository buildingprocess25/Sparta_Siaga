import { NextResponse } from "next/server";
import {
  authenticateIntegrationRequest,
  logIntegrationSync,
} from "@/lib/integration-auth";
import { getDbPool } from "@/lib/db";
import { rowToIncident } from "@/lib/incident-db";
import { canonicalBranchKey } from "@/lib/sparta-master-sync";
import { branchSqlKey, branchSqlParameter } from "@/lib/sparta-rollout";

export async function GET(request: Request) {
  const auth = await authenticateIntegrationRequest(request);
  if (!auth.success) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const { client } = auth;
  const { searchParams } = new URL(request.url);
  const branchParam = searchParams.get("branch");
  const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
  const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") || "20", 10)));
  const offset = (page - 1) * limit;

  const pool = getDbPool();

  try {
    let query = `
      SELECT * FROM incidents 
      WHERE status = 'confirmed_affected'
    `;
    const params: unknown[] = [];

    // Scope filter (Toko vs DC)
    if (client.scope === "TOKO_ONLY") {
      params.push("toko");
      query += ` AND (tkp_type = $${params.length} OR tkp_type IS NULL)`;
    } else if (client.scope === "DC_ONLY") {
      params.push("dc");
      query += ` AND tkp_type = $${params.length}`;
    }

    // Branch restriction from API Key or Query Param
    const effectiveBranch = client.branchRestriction || branchParam;
    if (effectiveBranch) {
      params.push(await canonicalBranchKey(effectiveBranch));
      query += ` AND ${branchSqlKey("branch")} = ${branchSqlParameter(`$${params.length}`)}`;
    }

    // Count total matching
    const countRes = await pool.query(
      `SELECT COUNT(*) FROM (${query}) AS total_subquery`,
      params
    );
    const totalCount = parseInt(countRes.rows[0].count, 10);

    // Add pagination & sorting
    query += ` ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit, offset);

    const res = await pool.query(query, params);
    const incidents = res.rows.map(rowToIncident);

    // Format clean external DTO for SPARTA Maintenance / Engineering Support
    const data = incidents.map((inc) => ({
      incidentId: inc.id,
      storeId: inc.storeId,
      storeName: inc.storeName,
      branch: inc.branch,
      branchCode: inc.branchCode ?? null,
      locationCity: inc.locationCity,
      disasterType: inc.disasterType,
      reportOrigin: inc.reportOrigin,
      tkpType: inc.tkpType || "toko",
      status: inc.status,
      severity: inc.verification?.severity || "Sedang",
      condition: inc.verification?.condition || "damaged",
      damageCategories: inc.verification?.categories || [],
      inspection: {
        method: inc.verification?.inspectionMethod || "kunjungan_langsung",
        confirmedBy: inc.verification?.confirmedBy || "-",
        confirmedAt: inc.verification?.confirmedAt || "-",
        officerSource: inc.verification?.officerSource || null,
        evidencePhotosCount:
          inc.verification?.evidenceDetails?.length ||
          inc.verification?.photos?.length ||
          0,
        notes: inc.verification?.notes || "",
      },
      branchManagerApproval: {
        decidedBy: inc.verification?.bmApproval?.decidedBy || "BnM Manajer",
        decidedAt: inc.verification?.bmApproval?.decidedAt || "-",
        decisionNotes:
          inc.verification?.bmApproval?.decisionNotes ||
          inc.verification?.bmApproval?.rejectionReason ||
          "Disetujui untuk penanganan teknis.",
      },
      externalWork: {
        synced: Boolean(inc.externalWorkId),
        externalWorkId: inc.externalWorkId || null,
        externalSystem: inc.externalSystem || null,
        externalWorkStatus: inc.externalWorkStatus || null,
        externalSyncedAt: inc.externalSyncedAt || null,
      },
      createdAt: inc.createdAt,
      updatedAt: inc.updatedAt,
    }));

    await logIntegrationSync({
      incidentId: "ALL",
      externalSystem: client.appName,
      action: "FETCH_APPROVED_INCIDENTS",
      payload: { page, limit, branch: effectiveBranch, totalFound: totalCount },
      responseStatus: 200,
    });

    return NextResponse.json({
      success: true,
      data,
      pagination: {
        page,
        limit,
        totalItems: totalCount,
        totalPages: Math.ceil(totalCount / limit),
      },
      meta: {
        clientApp: client.appName,
        clientScope: client.scope,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (err: any) {
    console.error("[GET /api/integrations/v1/approved-incidents] Error:", err);
    return NextResponse.json(
      { error: "Gagal mengambil daftar insiden terverifikasi." },
      { status: 500 }
    );
  }
}
