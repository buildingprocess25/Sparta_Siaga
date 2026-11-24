import { currentSessionEnvironment } from "./session-environment";
import { SignJWT, jwtVerify } from "jose";
import { getJwtSecret } from "./runtime-config";

function getEncodedJwtSecret(): Uint8Array {
  return new TextEncoder().encode(getJwtSecret());
}

export const SESSION_VERSION = 2;

export interface SessionPayload {
  id: string;
  nik?: string | null;
  systemRole?: string;
  v?: number;
}

export async function signSession(payload: SessionPayload, expiresIn: string = "15m"): Promise<string> {
  const jwt = await new SignJWT({
    id: payload.id,
    nik: payload.nik,
    systemRole: payload.systemRole,
    v: payload.v || SESSION_VERSION,
  
    env: currentSessionEnvironment(),
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(getEncodedJwtSecret());
  return jwt;
}

export async function verifySession(token: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getEncodedJwtSecret());
    if (payload.env !== currentSessionEnvironment()) return null;
    return payload as unknown as SessionPayload;
  } catch {
    return null;
  }
}
