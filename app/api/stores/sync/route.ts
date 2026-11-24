import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getLastStoreSyncHistory } from "@/lib/google-sheets-sync";
import { getDbPool } from "@/lib/db";
import { syncMasterStores } from "@/lib/store-sync";
import { SpartaIntegrationError } from "@/lib/sparta-identity";
import { portalStoresEnabled } from "@/lib/sparta-master-contract";
import { previewPortalStores } from "@/lib/sparta-master-sync";

function getSyncIntervalHours(): number {
  const parsed = Number.parseInt(process.env.STORE_SYNC_INTERVAL_HOURS || "24", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 24;
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    if (url.searchParams.get("preview") === "true") {
      const sessionUser = await getSessionUser(request);
      if (!sessionUser) {
        return NextResponse.json({ error: "Unauthorized: Sesi login diperlukan." }, { status: 401 });
      }
      if (sessionUser.systemRole !== "ADMIN") {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      const preview = await previewPortalStores();
      return NextResponse.json({ success: true, data: preview });
    }

    const usePortal = (() => {
      try {
        return portalStoresEnabled();
      } catch {
        return false;
      }
    })();

    const lastSync = await getLastStoreSyncHistory();
    const pool = getDbPool();

    let totalStores = 0;
    let inactiveStores: number | undefined;
    if (usePortal) {
      const countRes = await pool.query<{ active_count: string; inactive_count: string }>(
        `SELECT
           COUNT(*) FILTER (WHERE is_active = TRUE AND master_source = 'SPARTA_PORTAL')::text AS active_count,
           COUNT(*) FILTER (WHERE is_active = FALSE AND master_source = 'SPARTA_PORTAL')::text AS inactive_count
         FROM stores`
      );
      totalStores = Number.parseInt(countRes.rows[0]?.active_count || "0", 10);
      inactiveStores = Number.parseInt(countRes.rows[0]?.inactive_count || "0", 10);
    } else {
      const countRes = await pool.query<{ count: string }>("SELECT COUNT(*) as count FROM stores");
      totalStores = Number.parseInt(countRes.rows[0]?.count || "0", 10);
    }

    return NextResponse.json({
      success: true,
      lastSync,
      totalStores,
      ...(inactiveStores !== undefined ? { inactiveStores } : {}),
      source: usePortal ? "SPARTA_PORTAL" : "LEGACY",
      intervalHours: getSyncIntervalHours(),
    });
  } catch (err: any) {
    if (err instanceof SpartaIntegrationError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
    }
    console.error("[GET /api/stores/sync]", err);
    return NextResponse.json(
      { error: "Gagal mengambil data riwayat sinkronisasi toko." },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const sessionUser = await getSessionUser(request);
    if (!sessionUser) {
      return NextResponse.json(
        { error: "Unauthorized: Sesi login diperlukan." },
        { status: 401 }
      );
    }

    if (sessionUser.systemRole !== "ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const body = await request.json().catch(() => ({})) as { full?: boolean; confirmFull?: boolean };
    const syncResult = await syncMasterStores({
      full: Boolean(body.full),
      confirmFull: Boolean(body.confirmFull),
    });

    const usePortal = portalStoresEnabled();
    const pool = getDbPool();
    const countRes = await pool.query<{ count: string }>(
      usePortal
        ? "SELECT COUNT(*) as count FROM stores WHERE is_active = TRUE AND master_source = 'SPARTA_PORTAL'"
        : "SELECT COUNT(*) as count FROM stores"
    );
    const totalStores = Number.parseInt(countRes.rows[0]?.count || "0", 10);

    return NextResponse.json({
      success: true,
      data: syncResult,
      totalStores,
    });
  } catch (err: any) {
    if (err instanceof SpartaIntegrationError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
    }
    console.error("[POST /api/stores/sync]", err);
    return NextResponse.json(
      { error: err.message || "Gagal melakukan sinkronisasi toko." },
      { status: 500 }
    );
  }
}
