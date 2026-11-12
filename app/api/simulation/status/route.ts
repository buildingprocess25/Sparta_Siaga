import { NextResponse } from "next/server";
import { isUatSimulationAllowed, getSpartaEnvironment } from "@/lib/environment-policy";
import { getDbPool } from "@/lib/db";

export async function GET() {
  const allowed = isUatSimulationAllowed();
  const environment = getSpartaEnvironment();

  if (!allowed) {
    return NextResponse.json({
      allowed: false,
      environment,
      message: "Simulasi dinonaktifkan secara fail-closed pada environment Production.",
    });
  }

  try {
    const pool = getDbPool();
    const activeUatIncidents = await pool.query(`
      SELECT id, disaster_type, tkp_type, store_name, branch, status, progress, created_at
      FROM incidents
      WHERE id LIKE 'INC-UAT%' OR id LIKE 'SIM-%'
      ORDER BY id
    `);

    return NextResponse.json({
      allowed: true,
      environment,
      activeScenarios: activeUatIncidents.rows,
    });
  } catch (err: any) {
    return NextResponse.json({
      allowed: true,
      environment,
      error: "Gagal memuat status skenario",
      details: err?.message,
    });
  }
}

