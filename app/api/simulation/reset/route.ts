import { NextResponse } from "next/server";

/**
 * SPARTA SIAGA — Simulation Reset Endpoint
 *
 * In Production Release Candidate (RC), simulation scripts and reset capabilities
 * are strictly excluded from the application bundle.
 * This endpoint unconditionally rejects all requests with HTTP 403,
 * without relying on environment variables or sessions.
 */
export async function POST(_request?: Request) {
  return NextResponse.json(
    {
      error: "SIMULATION_FORBIDDEN_IN_PRODUCTION: Fitur simulasi dan reset skenario dilarang keras di environment Production.",
      code: "SIMULATION_FORBIDDEN_IN_PRODUCTION",
    },
    { status: 403 }
  );
}

export async function GET(_request?: Request) {
  return NextResponse.json(
    {
      error: "SIMULATION_FORBIDDEN_IN_PRODUCTION: Fitur simulasi dan reset skenario dilarang keras di environment Production.",
      code: "SIMULATION_FORBIDDEN_IN_PRODUCTION",
    },
    { status: 403 }
  );
}
