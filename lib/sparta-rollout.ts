import { SpartaIntegrationError } from "./sparta-identity";

export function branchMasterEnabled() {
  return process.env.SPARTA_BRANCH_MASTER_ENABLED === "true";
}

export function requireMasterConversion() {
  if (!branchMasterEnabled()) throw new SpartaIntegrationError("MASTER_CONVERSION_DISABLED", "Konversi cabang dan toko belum diaktifkan untuk tahap terakhir.", 409);
}

export function branchSqlKey(column: string) {
  if (!/^[a-z_.]+$/.test(column)) throw new Error("Invalid branch column");
  const prefix = column.includes(".") ? column.slice(0, column.lastIndexOf(".") + 1) : "";
  return branchMasterEnabled() ? `sparta_branch_key(COALESCE(${prefix}branch_code,${column}))` : `LOWER(TRIM(${column}))`;
}

export function branchSqlParameter(parameter: string) {
  if (!/^\$\d+$/.test(parameter)) throw new Error("Invalid SQL parameter");
  return branchMasterEnabled() ? `sparta_branch_key(${parameter})` : `LOWER(TRIM(${parameter}::text))`;
}
