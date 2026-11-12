import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { assertSimulationAllowed } from "@/lib/environment-policy";
import { getDbPool } from "@/lib/db";
import { setupSimulation1 } from "@/scripts/setup-simulation-1";
import { setupSimulation2 } from "@/scripts/setup-simulation-2";

export async function POST(request: Request) {
  try {
    // 1. Strict Fail-Closed Production Guard
    assertSimulationAllowed();

    // 2. Authentication & Authorization Check
    const authHeader = request.headers.get("x-internal-worker-secret");
    const isInternalWorker =
      process.env.SPARTA_INTERNAL_WORKER_SECRET &&
      authHeader === process.env.SPARTA_INTERNAL_WORKER_SECRET;

    const sessionUser = await getSessionUser(request);
    if (!sessionUser && !isInternalWorker) {
      return NextResponse.json(
        { error: "Unauthorized: Diperlukan sesi pengguna untuk mereset skenario UAT." },
        { status: 401 }
      );
    }

    const pool = getDbPool();

    // 3. Clean temporary UAT simulation data safely
    // NEVER touch users, stores, or facilities
    const simulationPrefixes = [
      "INC-UAT%",
      "SIM-%",
      "TEST-%",
      "LAP-EQ-DEMO%",
    ];

    for (const prefix of simulationPrefixes) {
      await pool.query(
        `DELETE FROM report_completion_approval_history WHERE report_id LIKE $1`,
        [prefix]
      );
      await pool.query(
        `DELETE FROM report_completion_approvals WHERE report_id LIKE $1`,
        [prefix]
      );
      await pool.query(
        `DELETE FROM report_milestones WHERE report_id LIKE $1`,
        [prefix]
      );
      await pool.query(
        `DELETE FROM report_estimation_routes WHERE report_id LIKE $1`,
        [prefix]
      );
      await pool.query(
        `DELETE FROM report_distributions WHERE report_id LIKE $1`,
        [prefix]
      );
      await pool.query(
        `DELETE FROM incident_pic_history WHERE incident_id LIKE $1`,
        [prefix]
      );
      await pool.query(
        `DELETE FROM incidents WHERE id LIKE $1`,
        [prefix]
      );
    }

    await pool.query(
      `DELETE FROM notification_logs WHERE disaster_id LIKE 'SIM-%' OR disaster_id LIKE 'EQ-UAT%' OR disaster_id LIKE 'TEST-%'`
    );

    // 4. Re-initialize baseline simulations 1 & 2
    await setupSimulation1();
    await setupSimulation2();

    return NextResponse.json({
      success: true,
      message: "Data skenario pengujian UAT berhasil direset secara bersih ke kondisi baseline awal.",
      activeScenarios: [
        {
          id: "INC-UAT1-TOKO-001",
          name: "Simulasi 1: Toko Cicaheum (BMS -> BnM dengan penolakan/revisi)",
          status: "verifying",
        },
        {
          id: "INC-UAT2-DC-001",
          name: "Simulasi 2A: Fasilitas DC Bandung (BES -> BEC -> BnM)",
          status: "verifying",
        },
        {
          id: "INC-UAT2-EQ-001",
          name: "Simulasi 2B: Laporan Gempa Otomatis Babakan Sari (Evaluasi Aman)",
          status: "pending_confirmation",
        },
      ],
    });
  } catch (error: any) {
    if (error?.message?.includes("SIMULATION_FORBIDDEN_IN_PRODUCTION")) {
      return NextResponse.json(
        { error: error.message, code: "SIMULATION_FORBIDDEN_IN_PRODUCTION" },
        { status: 403 }
      );
    }

    console.error("[API Simulation Reset Error]:", error);
    return NextResponse.json(
      { error: "Gagal mereset skenario simulasi UAT", details: error?.message },
      { status: 500 }
    );
  }
}

