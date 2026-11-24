import { readFile } from "node:fs/promises";
import { compareFacilityMasters, type FacilityComparisonRow } from "../lib/sparta-facility-comparison";
import { getDbPool, closeDbPool } from "../lib/db";

try {
  const file = process.argv.find(arg => arg.startsWith("--carbontrack="))?.slice("--carbontrack=".length);
  if (!file) throw new Error("Sertakan --carbontrack=<export-fasilitas.json> dengan code,name,type,latitude,longitude,branchCode.");
  const carbontrack: FacilityComparisonRow[] = JSON.parse(await readFile(file, "utf8"));
  if (!Array.isArray(carbontrack)) throw new Error("Ekspor fasilitas harus berupa array JSON.");
  const { rows } = await getDbPool().query(`SELECT code,name,facility_type AS type,latitude,longitude,branch_id AS "branchCode" FROM facilities ORDER BY code`);
  console.log(JSON.stringify(compareFacilityMasters(rows, carbontrack), null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : "Perbandingan fasilitas gagal.");
  process.exitCode = 1;
} finally { await closeDbPool(); }
