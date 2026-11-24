import { NextResponse } from "next/server";
import { applyProvisioningEvent, parseProvisioningEvent, verifyProvisioningRequest } from "@/lib/sparta-provisioning";
import { SpartaIntegrationError } from "@/lib/sparta-identity";

export const runtime = "nodejs";

async function readProvisioningBody(request: Request) {
  if (Number(request.headers.get("content-length")) > 65536) throw new SpartaIntegrationError("PAYLOAD_TOO_LARGE", "Payload terlalu besar.", 413);
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > 65536) {
        await reader.cancel();
        throw new SpartaIntegrationError("PAYLOAD_TOO_LARGE", "Payload terlalu besar.", 413);
      }
      chunks.push(value);
    }
    return Buffer.concat(chunks).toString("utf8");
  } finally { reader.releaseLock(); }
}

export async function POST(request: Request) {
  try {
    const raw = await readProvisioningBody(request);
    verifyProvisioningRequest(raw, request.headers, process.env.SPARTA_PROVISIONING_SECRET);
    let payload: unknown;
    try { payload = JSON.parse(raw); }
    catch { throw new SpartaIntegrationError("INVALID_JSON", "Payload JSON tidak valid."); }
    const event = parseProvisioningEvent(payload, request.headers.get("x-sparta-event-id"));
    return NextResponse.json(await applyProvisioningEvent(event));
  } catch (error) {
    if (error instanceof SpartaIntegrationError) {
      return NextResponse.json({ error: { code: error.code, message: error.message } }, { status: error.status });
    }
    return NextResponse.json({ error: { code: "PROVISIONING_UNAVAILABLE", message: "Provisioning belum dapat diproses." } }, { status: 503 });
  }
}
