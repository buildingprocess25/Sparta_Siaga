import { NextResponse } from "next/server";
import { getDbPool } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { getOrLoadMasterStores } from "@/lib/store-master-loader";
import { portalStoresEnabled } from "@/lib/sparta-master-contract";
import { canonicalBranchKey } from "@/lib/sparta-master-sync";
import { SpartaIntegrationError } from "@/lib/sparta-identity";
import {
  branchMasterEnabled,
  branchSqlKey,
  branchSqlParameter,
  branchValueSqlKey,
  effectiveBranchValue,
} from "@/lib/sparta-rollout";

// Known canonical branch alias mappings (e.g. testing codes / historical prefixes)
const BRANCH_CANONICAL_MAP: Record<string, string> = {
  G001: "CIKOKOL",
  G002: "BANDUNG",
  TE76: "CIKOKOL",
};

export function resolveBranchAliases(branchRaw?: string | null): string[] {
  if (!branchRaw) return [];
  const clean = branchRaw.trim();
  const upper = clean.toUpperCase();
  const unprefix = upper.replace(/^CABANG\s+/i, "").trim();

  const aliases = new Set<string>();
  aliases.add(upper);
  aliases.add(unprefix);

  if (BRANCH_CANONICAL_MAP[upper]) {
    aliases.add(BRANCH_CANONICAL_MAP[upper]);
  }
  if (BRANCH_CANONICAL_MAP[unprefix]) {
    aliases.add(BRANCH_CANONICAL_MAP[unprefix]);
  }

  return Array.from(aliases);
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q") || "";
  const typeParam = (searchParams.get("type") || "TOKO").trim().toUpperCase();
  const limit = Math.min(parseInt(searchParams.get("limit") || "40", 10), 100);

  try {
    const sessionUser = await getSessionUser(request);
    if (!sessionUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const isAdmin = sessionUser.systemRole === "ADMIN";
    const isHO = sessionUser.scope === "HO" && !isAdmin;
    const r = (sessionUser.role || "").toLowerCase();
    const isBMM = !isAdmin && !isHO && r === "bm";
    const isBES = !isAdmin && !isHO && r === "bes";
    const isBMS = !isAdmin && !isHO && !isBMM && !isBES;

    // DC / FACILITY MODE: Query the PostgreSQL facilities table
    if (typeParam === "DC" || typeParam === "FACILITY") {
      // BMS is strictly prohibited from searching facilities
      if (isBMS) {
        return NextResponse.json(
          {
            error: "Akses ditolak: Petugas BMS hanya berwenang mencari dan melaporkan Toko.",
            code: "ROLE_NOT_AUTHORIZED_FOR_FACILITIES",
          },
          { status: 403 }
        );
      }

      const canSearchAllFacilities = isAdmin || isHO;
      const pool = getDbPool();
      const conditions: string[] = [];
      const values: unknown[] = [];
      let paramIndex = 1;

      if (q.trim()) {
        conditions.push(
          `(name ILIKE $${paramIndex} OR code ILIKE $${paramIndex} OR facility_type ILIKE $${paramIndex})`
        );
        values.push(`%${q.trim()}%`);
        paramIndex++;
      }

      // Role and Branch scoping for facilities
      if (!canSearchAllFacilities) {
        if (branchMasterEnabled()) {
          const actorBranch = effectiveBranchValue(sessionUser);
          if (!actorBranch) {
            conditions.push("FALSE");
          } else {
            conditions.push(`${branchValueSqlKey("branch_id")} = ${branchSqlParameter(`$${paramIndex}`)}`);
            values.push(actorBranch);
            paramIndex++;
          }
        } else {
          // Operational branch roles (BES, BMM) can only search facilities mapped to their branch or matching branch name
          const aliases = resolveBranchAliases(sessionUser.branch);
          const branchClauses: string[] = [];
          if (aliases.length > 0) {
            branchClauses.push(`UPPER(COALESCE(branch_id, '')) = ANY($${paramIndex}::text[])`);
            values.push(aliases.map((a) => a.toUpperCase()));
            paramIndex++;

            for (const alias of aliases) {
              branchClauses.push(`name ILIKE $${paramIndex}`);
              values.push(`%${alias}%`);
              paramIndex++;
            }
          } else {
            branchClauses.push(`branch_id = $${paramIndex}`);
            values.push(sessionUser.branch || "");
            paramIndex++;
          }
          conditions.push(`(${branchClauses.join(" OR ")})`);
        }
      }

      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
      const query = `
        SELECT id::text, code, name, facility_type, latitude, longitude,
               branch_id, operational_status, auto_report_enabled, mapping_verified_at
        FROM facilities
        ${whereClause}
        ORDER BY name ASC
        LIMIT $${paramIndex};
      `;
      values.push(limit);

      const res = await pool.query(query, values);
      const formatted = res.rows.map((row) => ({
        id: `FACILITY:${row.id}`,
        kode_toko: row.code,
        nama_toko: row.name,
        cabang: row.branch_id || sessionUser.branch || "Cabang Terkait",
        alamat: `${row.facility_type.replace(/_/g, " ")} (${row.operational_status === "ACTIVE" ? "Aktif" : "Non-aktif"})`,
        latitude: Number(row.latitude),
        longitude: Number(row.longitude),
        fr_type: `FACILITY_${row.facility_type}`,
        locationKind: "FACILITY",
        locationId: row.id,
        facilityType: row.facility_type,
        operationalStatus: row.operational_status,
        mappingVerified: Boolean(row.mapping_verified_at),
      }));

      let diagnosticMessage: string | null = null;
      if (formatted.length === 0 && !canSearchAllFacilities) {
        diagnosticMessage = `Belum ada fasilitas yang terhubung dengan cabang Anda (${sessionUser.branch || "Cabang belum ditentukan"}). Hubungi Admin untuk memverifikasi master fasilitas.`;
      }

      return NextResponse.json({
        data: formatted,
        count: formatted.length,
        type: typeParam,
        masterAvailable: true,
        source: "aiven-postgresql-facilities",
        message: diagnosticMessage,
      });
    }

    // TOKO MODE
    // BES is strictly prohibited from searching Toko
    if (isBES) {
      return NextResponse.json(
        {
          error: "Akses ditolak: Petugas BES hanya berwenang mencari dan melaporkan Fasilitas (DC/Warehouse/Depo/Bulky/Hub).",
          code: "ROLE_NOT_AUTHORIZED_FOR_STORES",
        },
        { status: 403 }
      );
    }

    const canSearchAllStores = isAdmin || isHO;
    if (portalStoresEnabled()) {
      const pool = getDbPool();
      const code = canSearchAllStores ? null : await canonicalBranchKey(sessionUser.branchCode || sessionUser.branch);
      if (!canSearchAllStores && !code) return NextResponse.json({ data: [], count: 0, type: "TOKO", source: "SPARTA_PORTAL" });
      const { rows } = await pool.query(`SELECT id,kode_toko,nama_toko,cabang,branch_code,alamat,latitude,longitude,
        fr_type,branch_emergency_contact FROM stores WHERE is_active=TRUE AND master_source='SPARTA_PORTAL'
        AND ($1::text IS NULL OR branch_code=$1)
        AND (nama_toko ILIKE $2 OR kode_toko ILIKE $2 OR alamat ILIKE $2)
        ORDER BY nama_toko LIMIT $3`, [code, `%${q.trim()}%`, Number.isFinite(limit) ? Math.max(1, limit) : 40]);
      const data = rows.map(row => ({ ...row, locationKind: "STORE", locationId: row.kode_toko }));
      return NextResponse.json({ data, count: data.length, type: "TOKO", masterAvailable: true, source: "SPARTA_PORTAL" });
    }
    let formattedStores: Array<{
      id: string;
      kode_toko: string;
      nama_toko: string;
      cabang: string;
      alamat: string;
      latitude: number;
      longitude: number;
      fr_type?: string;
      branch_emergency_contact?: string;
      locationKind: string;
      locationId: string;
    }> = [];

    // 1. Try querying PostgreSQL stores table first
    try {
      const pool = getDbPool();
      const conditions: string[] = [];
      const values: unknown[] = [];
      let paramIndex = 1;

      if (q.trim()) {
        conditions.push(
          `(nama_toko ILIKE $${paramIndex} OR kode_toko ILIKE $${paramIndex} OR alamat ILIKE $${paramIndex})`
        );
        values.push(`%${q.trim()}%`);
        paramIndex++;
      }

      // Server-side enforcement of branch scope with canonical aliases & case-insensitivity
      if (!canSearchAllStores) {
        if (branchMasterEnabled()) {
          const actorBranch = effectiveBranchValue(sessionUser);
          if (!actorBranch) {
            conditions.push("FALSE");
          } else {
            conditions.push(`${branchSqlKey("cabang")} = ${branchSqlParameter(`$${paramIndex}`)}`);
            values.push(actorBranch);
            paramIndex++;
          }
        } else {
          const aliases = resolveBranchAliases(sessionUser.branch);
          if (aliases.length > 0) {
            conditions.push(`UPPER(cabang) = ANY($${paramIndex}::text[])`);
            values.push(aliases);
            paramIndex++;
          } else {
            conditions.push(`cabang = $${paramIndex}`);
            values.push(sessionUser.branch || "");
            paramIndex++;
          }
        }
      }

      const whereClause =
        conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

      const query = `
        SELECT id, kode_toko, nama_toko, cabang, alamat, latitude, longitude, fr_type, branch_emergency_contact
        FROM stores
        ${whereClause}
        ORDER BY nama_toko ASC
        LIMIT $${paramIndex};
      `;
      values.push(limit);

      const res = await pool.query(query, values);
      if (res.rows && res.rows.length > 0) {
        formattedStores = res.rows.map((row) => ({
          ...row,
          latitude: Number(row.latitude),
          longitude: Number(row.longitude),
          locationKind: "STORE",
          locationId: row.kode_toko,
        }));
      }
    } catch (dbErr) {
      console.warn("[Search API] Direct DB store query failed or empty, falling back to master CSV stores:", dbErr);
    }

    // 2. If DB returned 0 rows, use authoritative master stores dataset (21,550 stores)
    if (formattedStores.length === 0) {
      const masterStores = await getOrLoadMasterStores();
      const aliases = resolveBranchAliases(sessionUser.branch).map((a) => a.toUpperCase());

      let filtered = masterStores;
      if (!canSearchAllStores) {
        filtered = filtered.filter((s) => {
          const b = (s.cabang || "").toUpperCase().trim();
          return aliases.some((alias) => b === alias || b.includes(alias) || alias.includes(b));
        });
      }

      if (q.trim()) {
        const qLower = q.trim().toLowerCase();
        filtered = filtered.filter(
          (s) =>
            s.nama_toko.toLowerCase().includes(qLower) ||
            s.kode_toko.toLowerCase().includes(qLower) ||
            (s.alamat && s.alamat.toLowerCase().includes(qLower))
        );
      }

      formattedStores = filtered.slice(0, limit).map((s) => ({
        id: s.id,
        kode_toko: s.kode_toko,
        nama_toko: s.nama_toko,
        cabang: s.cabang,
        alamat: s.alamat,
        latitude: s.latitude,
        longitude: s.longitude,
        fr_type: s.fr_type,
        branch_emergency_contact: s.branch_emergency_contact,
        locationKind: "STORE",
        locationId: s.kode_toko,
      }));
    }

    return NextResponse.json({
      data: formattedStores,
      count: formattedStores.length,
      type: "TOKO",
      masterAvailable: true,
      source: "aiven-postgresql-with-master-fallback",
    });
  } catch (error: unknown) {
    if (error instanceof SpartaIntegrationError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    console.error("[Search API] Error searching locations:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: "Gagal mencari data lokasi", details: message },
      { status: 500 }
    );
  }
}
