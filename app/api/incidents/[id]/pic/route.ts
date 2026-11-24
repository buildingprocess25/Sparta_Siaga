import { NextResponse } from "next/server";

import { getSessionUser } from "@/lib/auth";
import { changeIncidentPic, claimIncidentPic, getIncidentPicDetails } from "@/lib/incident-assignment";
import { effectiveBranchValue } from "@/lib/sparta-rollout";

function canManage(user: Awaited<ReturnType<typeof getSessionUser>>) {
  return user?.systemRole === "ADMIN" || user?.role === "bm" || (user as { businessRole?: string })?.businessRole === "bm";
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await context.params;
  const data = await getIncidentPicDetails(id, user.systemRole === "ADMIN" || user.scope === "HO" ? undefined : effectiveBranchValue(user));
  if (!data) return NextResponse.json({ error: "Laporan tidak ditemukan" }, { status: 404 });
  return NextResponse.json({ data });
}

export async function POST() {
  return NextResponse.json(
    {
      error: "Mutasi manual PIC dinonaktifkan. Penugasan PIC dilakukan secara otomatis setelah tindakan operasional pertama yang valid dan bersifat permanen.",
      code: "MANUAL_PIC_MUTATION_DISABLED",
    },
    { status: 405 }
  );
}

export async function PATCH() {
  return NextResponse.json(
    {
      error: "Pengalihan manual PIC dinonaktifkan. PIC bersifat permanen (immutable) setelah ditetapkan otomatis.",
      code: "MANUAL_PIC_MUTATION_DISABLED",
    },
    { status: 405 }
  );
}

export async function DELETE() {
  return NextResponse.json(
    {
      error: "Pelepasan manual PIC dinonaktifkan. PIC bersifat permanen (immutable) setelah ditetapkan otomatis.",
      code: "MANUAL_PIC_MUTATION_DISABLED",
    },
    { status: 405 }
  );
}

