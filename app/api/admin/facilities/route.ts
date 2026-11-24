import { NextResponse } from "next/server";

import { getSessionUser } from "@/lib/auth";
import { listFacilities, updateFacilityAdmin } from "@/lib/facility-service";
import { SpartaIntegrationError } from "@/lib/sparta-identity";

export async function GET(request: Request) {
  const user = await getSessionUser(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.systemRole !== "ADMIN" && user.scope !== "HO") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const url = new URL(request.url);
  const data = await listFacilities({
    type: url.searchParams.get("type") || undefined,
    branch: url.searchParams.get("branch") || undefined,
    mapping: (url.searchParams.get("mapping") as "mapped" | "unmapped" | null) || undefined,
    query: url.searchParams.get("q") || undefined,
  });
  return NextResponse.json({ data });
}

export async function PATCH(request: Request) {
  const user = await getSessionUser(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.systemRole !== "ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    const body = await request.json();
    if (!body.id) return NextResponse.json({ error: "Facility ID wajib diisi" }, { status: 400 });
    const data = await updateFacilityAdmin({ ...body, actorUserId: user.id });
    return NextResponse.json({ data });
  } catch (error) {
    if (error instanceof SpartaIntegrationError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "Gagal memperbarui fasilitas";
    return NextResponse.json({ error: message }, { status: message === "FACILITY_NOT_FOUND" ? 404 : 400 });
  }
}
