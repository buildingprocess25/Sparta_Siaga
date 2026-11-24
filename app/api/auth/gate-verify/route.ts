import { NextResponse } from "next/server";
import { isTestBrowserEnvironment, isGateEnabled, isGateTransportAllowed, verifyGatePasscode,
  issueGateToken, GATE_TOKEN_COOKIE, GATE_TOKEN_TTL_SECONDS, isLocalLoopbackRequest } from "@/lib/environment-policy";
export const runtime = "nodejs";
// Per-process global failure cap. Public reverse proxy must also enforce a distributed rate limit.
let failures = 0;
let windowEnds = 0;
function reply(error: string, status: number) {
  return NextResponse.json({ error }, { status, headers: { "Cache-Control": "no-store" } });
}
export async function POST(req: Request) {
  if (!isTestBrowserEnvironment()) return reply("GATE_FORBIDDEN", 403);
  if (!isGateEnabled()) return reply("GATE_NOT_CONFIGURED", 503);
  if (!isGateTransportAllowed(req)) return reply("HTTPS_REQUIRED", 403);
  const origin = req.headers.get("origin");
  const requestUrl = new URL(req.url);
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host") || requestUrl.host;
  const proto = req.headers.get("x-forwarded-proto") || requestUrl.protocol.slice(0, -1);
  if (req.headers.get("sec-fetch-site") === "cross-site" || (origin && origin !== `${proto}://${host}` && origin !== requestUrl.origin)) return reply("ORIGIN_FORBIDDEN", 403);
  const now = Date.now();
  if (now >= windowEnds) { failures = 0; windowEnds = now + 60_000; }
  if (failures >= 10) return reply("TOO_MANY_ATTEMPTS", 429);
  // Reserve an attempt before any asynchronous read.
  failures++;
  let passcode = req.headers.get("x-gate-passcode") || req.headers.get("x-dev-access-key") || "";
  if (!passcode) {
    try {
      const reader = req.body?.getReader();
      if (!reader) return reply("INVALID_REQUEST", 400);
      let size = 0; const chunks: Uint8Array[] = [];
      while (true) { const { done, value } = await reader.read(); if (done) break;
        size += value.byteLength; if (size > 4096) { await reader.cancel(); return reply("BODY_TOO_LARGE", 413); } chunks.push(value); }
      const data = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      if (typeof data?.passcode === "string") passcode = data.passcode;
    } catch { return reply("INVALID_REQUEST", 400); }
  }
  if (!verifyGatePasscode(passcode)) return reply("INVALID_PASSCODE", 403);
  try {
    const response = NextResponse.json({ success: true }, { headers: { "Cache-Control": "no-store" } });
    response.cookies.set(GATE_TOKEN_COOKIE, issueGateToken(), { httpOnly: true, sameSite: "strict", secure: !isLocalLoopbackRequest(req) || proto === "https", path: "/", maxAge: GATE_TOKEN_TTL_SECONDS });
    return response;
  } catch { return reply("GATE_NOT_CONFIGURED", 503); }
}
