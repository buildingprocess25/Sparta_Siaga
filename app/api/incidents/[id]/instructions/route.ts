/**
 * SPARTA SIAGA — Management Instruction API
 * POST /api/incidents/[id]/instructions
 * GET  /api/incidents/[id]/instructions
 *
 * Per flowchart: GM/SM HO dapat memberi arahan/instruksi ke cabang via Web SPARTA,
 * kemudian didistribusikan via Auto WA ke BnM, BBC, BMC, BES.
 *
 * Authorization rules:
 * - Only gm_ho and sm_ho can create instructions.
 * - All authenticated users can view instructions (as part of report history).
 *
 * NOTE: WA delivery is NOT yet integrated. delivery_status will be 'not_configured'.
 * This endpoint records the instruction and will trigger delivery when a provider is connected.
 */

import { NextResponse } from "next/server";
import { dbGetIncidentById, dbCreateInstruction, dbGetInstructionsByReport } from "@/lib/incident-db";
import { canCreateManagementInstructionAsync } from "@/lib/permission-service";
import { ManagementInstruction, SpartaRole } from "@/types/incident";
import { getSessionUser } from "@/lib/auth";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_: Request, { params }: RouteContext) {
  try {
    const sessionUser = await getSessionUser();
    if (!sessionUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;

    const report = await dbGetIncidentById(id);
    if (!report) {
      return NextResponse.json({ error: "Laporan tidak ditemukan" }, { status: 404 });
    }

    // Role-based visibility: System Admin and HO scope can view instructions for any branch
    const canViewAll = sessionUser.systemRole === "ADMIN" || sessionUser.scope === "HO";
    if (!canViewAll) {
      if (report.branch.trim().toLowerCase() !== (sessionUser.branch || "").trim().toLowerCase()) {
        return NextResponse.json({ error: "Unauthorized: Cabang tidak berhak mengakses laporan ini" }, { status: 403 });
      }
    }

    const instructions = await dbGetInstructionsByReport(id);
    return NextResponse.json({ data: instructions });
  } catch (err) {
    console.error("[GET /api/incidents/:id/instructions]", err);
    return NextResponse.json({ error: "Gagal memuat instruksi" }, { status: 500 });
  }
}

export async function POST(request: Request, { params }: RouteContext) {
  try {
    const { id } = await params;

    const report = await dbGetIncidentById(id);
    if (!report) {
      return NextResponse.json({ error: "Laporan tidak ditemukan" }, { status: 404 });
    }

    const sessionUser = await getSessionUser();
    if (!sessionUser) {
      return NextResponse.json(
        { error: "Unauthorized: Server identity missing or invalid" },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { instruction_text } = body as {
      instruction_text: string;
    };

    if (!instruction_text) {
      return NextResponse.json(
        { error: "instruction_text wajib diisi" },
        { status: 400 }
      );
    }

    // Server-side authorization from trusted identity
    const isAllowed = await canCreateManagementInstructionAsync(sessionUser);
    if (!isAllowed) {
      return NextResponse.json(
        { error: "Unauthorized: Hanya Pengguna Head Office (Admin/GM/SM HO) yang berhak membuat instruksi manajemen" },
        { status: 403 }
      );
    }

    const roleTag = (sessionUser.role || "ho").toUpperCase();
    const instructionId = `INS-${roleTag}-${Date.now().toString().slice(-8)}`;
    const instruction: ManagementInstruction = {
      instruction_id: instructionId,
      report_id: id,
      instruction_text: instruction_text.trim(),
      author_id: sessionUser.id,
      author_name: sessionUser.name,
      author_role: sessionUser.role as "gm_ho" | "sm_ho",
      created_at: new Date().toISOString(),
      // WA provider not yet integrated — delivery is honest: not_configured
      delivery_status: "not_configured",
      target_roles: ["bnm", "bbc", "bmc", "bes"],
      delivery_channel: "wa",
      delivery_log: "WA provider belum terkonfigurasi. Instruksi tersimpan di SPARTA, distribusi via WA tertunda.",
    };

    await dbCreateInstruction(instruction);

    // TODO: When WA provider is available, trigger delivery here and update delivery_status.
    // Per flowchart: Auto WA ke BnM, BBC, BMC, BES.

    return NextResponse.json({ data: instruction }, { status: 201 });
  } catch (err) {
    console.error("[POST /api/incidents/:id/instructions]", err);
    return NextResponse.json({ error: "Gagal membuat instruksi" }, { status: 500 });
  }
}
