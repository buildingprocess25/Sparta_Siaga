import { backfillPortalBranches } from "../lib/sparta-master-sync";
import { closeDbPool } from "../lib/db";

try {
  const result = await backfillPortalBranches({ apply: process.argv.includes("--apply") });
  console.log(JSON.stringify(result, null, 2));
  if (result.unmapped.length) process.exitCode = 1;
} catch (error) {
  console.error(error instanceof Error ? error.message : "Pemetaan cabang gagal.");
  process.exitCode = 1;
} finally { await closeDbPool(); }
