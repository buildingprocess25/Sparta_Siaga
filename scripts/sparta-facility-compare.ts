import { readFile, writeFile } from "node:fs/promises";
import {
  compareFacilityMasters,
  projectSiagaFacilityForComparison,
  type FacilityComparisonRow,
} from "../lib/sparta-facility-comparison";
import { parsePortalBranches, type PortalBranch } from "../lib/sparta-master-contract";
import { fetchPortalMaster } from "../lib/sparta-master-sync";
import { getDbPool, closeDbPool } from "../lib/db";

function argValue(prefix: string): string | undefined {
  const exact = process.argv.find((arg) => arg.startsWith(prefix));
  return exact ? exact.slice(prefix.length) : undefined;
}

try {
  const hasExportFlag = process.argv.some((arg) => arg === "--export-siaga" || arg.startsWith("--export-siaga="));
  const exportPath = argValue("--export-siaga=");
  const carbontrackPath = argValue("--carbontrack=");
  const branchesPath = argValue("--branches=");
  const useLivePortalBranches = process.argv.includes("--from-portal-branches");

  if (!hasExportFlag && !carbontrackPath) {
    throw new Error(
      "Gunakan --carbontrack=<export-fasilitas.json> [--branches=<portal-branches.json> | --from-portal-branches] atau --export-siaga[=<output.json>]."
    );
  }

  // Validate input files strictly before opening any database connection.
  let carbontrack: FacilityComparisonRow[] = [];
  if (carbontrackPath) {
    const parsed = JSON.parse(await readFile(carbontrackPath, "utf8"));
    if (!Array.isArray(parsed)) {
      throw new Error("Ekspor fasilitas CarbonTrack harus berupa array JSON.");
    }
    carbontrack = parsed;
  }

  let portalBranches: PortalBranch[] | undefined;
  if (branchesPath) {
    const parsedBranches = JSON.parse(await readFile(branchesPath, "utf8"));
    portalBranches = parsePortalBranches(
      Array.isArray(parsedBranches) ? parsedBranches : parsedBranches?.data
    );
  } else if (useLivePortalBranches) {
    const master = await fetchPortalMaster("branches");
    portalBranches = parsePortalBranches(master.data);
  }

  const { rows } = await getDbPool().query(
    `SELECT code, name, facility_type AS type, latitude, longitude, branch_id AS "branchCode"
       FROM facilities
      ORDER BY code`
  );
  const siagaRows = rows.map(projectSiagaFacilityForComparison);

  if (hasExportFlag) {
    const payload = JSON.stringify(siagaRows, null, 2);
    if (exportPath) {
      await writeFile(exportPath, payload, "utf8");
      console.log(JSON.stringify({ exported: siagaRows.length, file: exportPath }, null, 2));
    } else {
      console.log(payload);
    }
  } else {
    console.log(
      JSON.stringify(compareFacilityMasters(siagaRows, carbontrack, { portalBranches }), null, 2)
    );
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : "Perbandingan fasilitas gagal.");
  process.exitCode = 1;
} finally {
  await closeDbPool();
}
