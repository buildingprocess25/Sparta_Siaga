import { NextResponse } from "next/server";
import { resolveCurrentUserIdentity } from "@/lib/identity";

export async function GET(request: Request) {
  const identity = await resolveCurrentUserIdentity(request);
  if (!identity) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json(identity);
}
