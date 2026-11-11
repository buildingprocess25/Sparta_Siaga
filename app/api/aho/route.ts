import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getMasterAhoAggregations } from "@/lib/maintenance-aho-db";

export async function GET(request: Request) {
  try {
    const sessionUser = await getSessionUser(request);
    if (!sessionUser) {
      return NextResponse.json(
        { error: "Unauthorized: Autentikasi diperlukan untuk mengakses data AHO" },
        { status: 401 }
      );
    }

    const { searchParams } = new URL(request.url);
    const forceRefresh = searchParams.get("refresh") === "true";

    const aggregations = await getMasterAhoAggregations(forceRefresh);

    return NextResponse.json({
      success: true,
      counts: aggregations.counts,
      lastUpdated: aggregations.lastUpdated,
      totalActiveTickets: aggregations.totalActiveTickets,
      totalStoresWithTickets: aggregations.totalStoresWithTickets,
    });
  } catch (error: any) {
    console.error("[API /api/aho] Error fetching MasterAhoTicket aggregations:", error.message);
    return NextResponse.json(
      {
        success: false,
        error: "Gagal memuat data tiket AHO dari database SPARTA Maintenance",
        counts: {},
        lastUpdated: null,
        totalActiveTickets: 0,
        totalStoresWithTickets: 0,
      },
      { status: 503 }
    );
  }
}

