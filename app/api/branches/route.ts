import { NextResponse } from "next/server";
import { searchCanonicalBranches } from "@/lib/branch-service";
import { getSessionUser } from "@/lib/auth";
import { branchMasterEnabled } from "@/lib/sparta-rollout";
import { SpartaIntegrationError } from "@/lib/sparta-identity";

export async function GET(request: Request) {
  try {
    const sessionUser = await getSessionUser();
    if (!sessionUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const q = searchParams.get("q") || "";

    const branches = await searchCanonicalBranches(q);
    return NextResponse.json({
      data: branches,
      source: branchMasterEnabled() ? "SPARTA_PORTAL" : "LEGACY",
    });
  } catch (err) {
    if (err instanceof SpartaIntegrationError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
    }
    console.error("[GET /api/branches]", err);
    return NextResponse.json({ error: "Gagal memuat data cabang" }, { status: 500 });
  }
}
