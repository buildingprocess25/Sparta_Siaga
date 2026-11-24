import { syncStoresFromGoogleSheets } from "./google-sheets-sync";
import { syncStoresFromPortal } from "./sparta-master-sync";
import { portalStoresEnabled } from "./sparta-master-contract";

export function syncMasterStores() {
  return portalStoresEnabled() ? syncStoresFromPortal() : syncStoresFromGoogleSheets();
}
