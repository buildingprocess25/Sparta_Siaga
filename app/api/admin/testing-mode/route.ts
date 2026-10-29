import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import {
  getTestingModeState,
  setTestingModeState,
  getTestingModeAuditLogs,
} from "@/lib/testing-mode-service";

export async function GET() {
  try {
    const sessionUser = await getSessionUser();
    if (!sessionUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const state = await getTestingModeState();
    let auditLogs: any[] = [];
    if (sessionUser.systemRole === "ADMIN") {
      auditLogs = await getTestingModeAuditLogs(15);
    }

    return NextResponse.json({
      success: true,
      state,
      auditLogs,
    });
  } catch (error: any) {
    console.error("[API testing-mode GET] Error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const sessionUser = await getSessionUser();
    if (!sessionUser || sessionUser.systemRole !== "ADMIN") {
      return NextResponse.json(
        { error: "Forbidden: Hanya System Administrator yang memiliki izin mengubah Mode Pengujian." },
        { status: 403 }
      );
    }

    const body = await request.json();
    if (typeof body.enabled !== "boolean") {
      return NextResponse.json(
        { error: "Bad Request: field 'enabled' bertipe boolean wajib disertakan." },
        { status: 400 }
      );
    }

    const updatedState = await setTestingModeState(
      body.enabled,
      { id: sessionUser.id, name: sessionUser.name },
      body.reason
    );

    return NextResponse.json({
      success: true,
      state: updatedState,
      message: body.enabled
        ? "Testing Mode berhasil DIAKTIFKAN. Operasi UAT dialihkan ke database terisolasi."
        : "Testing Mode berhasil DINONAKTIFKAN. Operasi dikembalikan ke database produksi.",
    });
  } catch (error: any) {
    console.error("[API testing-mode POST] Error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
