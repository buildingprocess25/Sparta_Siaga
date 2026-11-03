import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { getSessionUser } from "@/lib/auth";
import {
  executeUserSynchronization,
  parseSpartaUserCsv,
} from "@/lib/user-sync-service";
import {
  RawSpartaUserRecord,
  FINALIZED_SIAGA_BUSINESS_ROLES,
} from "@/lib/user-sync-types";

function loadStagingDataset(): RawSpartaUserRecord[] {
  const filePath = path.resolve(process.cwd(), "data/sparta-users-staging-dataset.json");
  if (!fs.existsSync(filePath)) {
    return [];
  }
  const raw = fs.readFileSync(filePath, "utf8");
  return JSON.parse(raw);
}

export async function GET(request: Request) {
  try {
    const sessionUser = await getSessionUser(request);
    if (!sessionUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (sessionUser.systemRole !== "ADMIN") {
      return NextResponse.json(
        { error: "Forbidden: Hanya System Administrator yang dapat mengakses sinkronisasi user." },
        { status: 403 }
      );
    }

    const stagingData = loadStagingDataset();

    // Default dry run preview on staging dataset
    const preview = await executeUserSynchronization(stagingData, {
      dryRun: true,
      sourceModule: "ALL",
      allowUpdates: true,
    });

    return NextResponse.json({
      data: {
        allowedRoles: FINALIZED_SIAGA_BUSINESS_ROLES,
        stagingDatasetCount: stagingData.length,
        preview,
      },
    });
  } catch (error: any) {
    console.error("[GET /api/admin/users/sync]", error);
    return NextResponse.json(
      { error: "Gagal memproses pratinjau sinkronisasi: " + error.message },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const sessionUser = await getSessionUser(request);
    if (!sessionUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (sessionUser.systemRole !== "ADMIN") {
      return NextResponse.json(
        { error: "Forbidden: Hanya System Administrator yang dapat menjalankan sinkronisasi user." },
        { status: 403 }
      );
    }

    const body = await request.json().catch(() => ({}));
    const dryRun = body.dryRun !== false; // Default to dryRun: true for safety
    const allowUpdates = body.allowUpdates !== false;
    const sourceModule = body.sourceModule || "ALL";

    let recordsToSync: RawSpartaUserRecord[] = [];

    if (body.csvContent && typeof body.csvContent === "string") {
      recordsToSync = parseSpartaUserCsv(body.csvContent, sourceModule);
    } else if (Array.isArray(body.records) && body.records.length > 0) {
      recordsToSync = body.records;
    } else {
      // Fallback to isolated staging dataset
      recordsToSync = loadStagingDataset();
    }

    if (recordsToSync.length === 0) {
      return NextResponse.json(
        { error: "Tidak ada data user yang disediakan untuk disinkronkan." },
        { status: 400 }
      );
    }

    const report = await executeUserSynchronization(recordsToSync, {
      dryRun,
      sourceModule,
      allowUpdates,
      allowProductionSync: body.allowProductionSync === true,
    });

    return NextResponse.json({ data: report });
  } catch (error: any) {
    console.error("[POST /api/admin/users/sync]", error);
    return NextResponse.json(
      { error: "Gagal mengeksekusi sinkronisasi: " + error.message },
      { status: 500 }
    );
  }
}

