import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getAhoStoreDetail } from "@/lib/maintenance-aho-db";

type RouteContext = { params: Promise<{ storeCode: string }> };

export async function GET(request: Request, { params }: RouteContext) {
  try {
    const sessionUser = await getSessionUser(request);
    if (!sessionUser) {
      return NextResponse.json(
        { error: "Unauthorized: Autentikasi diperlukan untuk mengakses detail toko AHO" },
        { status: 401 }
      );
    }

    const { storeCode } = await params;
    if (!storeCode || !storeCode.trim()) {
      return NextResponse.json(
        { error: "Bad Request: storeCode diperlukan" },
        { status: 400 }
      );
    }

    const detail = await getAhoStoreDetail(storeCode);

    return NextResponse.json({
      success: true,
      data: detail,
    });
  } catch (error: any) {
    console.error("[API /api/aho/stores] Error fetching store AHO detail:", error.message);
    return NextResponse.json(
      {
        success: false,
        error: "Gagal memuat detail tiket AHO toko dari SPARTA Maintenance",
      },
      { status: 503 }
    );
  }
}

