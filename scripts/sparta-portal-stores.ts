import { previewPortalStores, syncStoresFromPortal } from "../lib/sparta-master-sync";
import { closeDbPool } from "../lib/db";

try {
  const result = process.argv.includes("--apply")
    ? await syncStoresFromPortal({ full: process.argv.includes("--full"), confirmFull: process.argv.includes("--confirm-full") })
    : await previewPortalStores();
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : "Sinkronisasi toko gagal.");
  process.exitCode = 1;
} finally { await closeDbPool(); }
