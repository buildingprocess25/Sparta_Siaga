import { syncStoresFromGoogleSheets } from "./google-sheets-sync";
import { syncStoresFromPortal, type MasterSyncOptions } from "./sparta-master-sync";
import { portalStoresEnabled } from "./sparta-master-contract";

export function syncMasterStores(options?: MasterSyncOptions) {
  return portalStoresEnabled() ? syncStoresFromPortal(options) : syncStoresFromGoogleSheets();
}
