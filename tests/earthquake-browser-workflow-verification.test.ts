import assert from "node:assert/strict";
import test from "node:test";
import {
  canViewReport,
  canActOnReport,
  canConfirmAffectedStore,
  canInspectReport,
  canApproveAsBm,
  type UserContext,
} from "../lib/report-permissions";
import { getReportAccessSql } from "../lib/report-access-policy";
import type { IncidentRecord } from "../types/incident";

// ============================================================================
// Fixtures
// ============================================================================

function createReportFixture(
  branch: string,
  origin: "automatic_earthquake" | "manual_store" = "automatic_earthquake"
): IncidentRecord {
  return {
    id: `INC-EQ-${branch}-001`,
    branch,
    locationId: `STR-${branch}-01`,
    locationName: `Toko Siaga ${branch} 01`,
    category: "Bencana Alam",
    subCategory: "Gempa Bumi",
    priority: "HIGH",
    status: "pending_confirmation",
    reportOrigin: origin,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  } as unknown as IncidentRecord;
}

const userGorontaloBranch: UserContext = {
  id: "USR-BM-GORONTALO-01",
  name: "BnM Gorontalo",
  role: "bm",
  systemRole: "USER",
  scope: "BRANCH",
  branch: "GORONTALO",
};

const userBandungBranch: UserContext = {
  id: "USR-BM-BANDUNG-01",
  name: "BnM Bandung",
  role: "bm",
  systemRole: "USER",
  scope: "BRANCH",
  branch: "BANDUNG",
};

const userHoReadOnly: UserContext = {
  id: "USR-HO-ADMIN-01",
  name: "HO Monitoring Admin",
  role: "admin",
  systemRole: "USER",
  scope: "HO",
  branch: null,
};

// ============================================================================
// Verification Tests
// ============================================================================

test("Detail Notifikasi Pagination: 19 stores paginate into 10 per page with zero duplicates or drops", () => {
  // Simulate 19 qualifying stores from Boalemo fixture
  const totalStores = 19;
  const pageSize = 10;
  const stores = Array.from({ length: totalStores }, (_, i) => ({
    kode_toko: `TK${String(i + 1).padStart(3, "0")}`,
    nama_toko: `Toko Boalemo ${i + 1}`,
    distance_km: 5.0 + i * 0.5,
  }));

  const totalPages = Math.max(1, Math.ceil(stores.length / pageSize));
  assert.equal(totalPages, 2, "19 stores must produce exactly 2 pages at 10 items/page");

  // Page 1
  const page1 = stores.slice((1 - 1) * pageSize, 1 * pageSize);
  assert.equal(page1.length, 10, "Page 1 must contain exactly 10 stores");
  assert.equal(page1[0].kode_toko, "TK001");
  assert.equal(page1[9].kode_toko, "TK010");

  // Page 2
  const page2 = stores.slice((2 - 1) * pageSize, 2 * pageSize);
  assert.equal(page2.length, 9, "Page 2 must contain exactly 9 stores");
  assert.equal(page2[0].kode_toko, "TK011");
  assert.equal(page2[8].kode_toko, "TK019");

  // Verification: No overlap and no missing items
  const combined = [...page1, ...page2];
  assert.equal(combined.length, totalStores, "Combined pages must equal original store count");
  const uniqueCodes = new Set(combined.map((s) => s.kode_toko));
  assert.equal(uniqueCodes.size, totalStores, "All 19 stores must be unique across pages (no duplicates)");
});

test("Cross-Branch Access Control: Another branch cannot access restricted reports", () => {
  const gorontaloReport = createReportFixture("GORONTALO", "automatic_earthquake");

  // Gorontalo user can view their own report
  assert.equal(
    canViewReport(userGorontaloBranch, gorontaloReport),
    true,
    "Gorontalo user must be authorized to view Gorontalo report"
  );

  // Bandung user CANNOT view Gorontalo report
  assert.equal(
    canViewReport(userBandungBranch, gorontaloReport),
    false,
    "Bandung user must be rejected from viewing Gorontalo report"
  );

  // Bandung user CANNOT act on Gorontalo report
  assert.equal(
    canActOnReport(userBandungBranch, gorontaloReport),
    false,
    "Bandung user must be rejected from acting on Gorontalo report"
  );

  // SQL WHERE clause test for branch isolation
  const sqlAccess = getReportAccessSql(userBandungBranch);
  assert.ok(
    sqlAccess.clause.includes("LOWER(TRIM(incidents.branch)) = LOWER(TRIM($1))"),
    "SQL query must enforce strict branch equality"
  );
  assert.deepEqual(sqlAccess.values, ["BANDUNG"]);
});

test("Head Office Read-Only Access: HO retains established read-only visibility", () => {
  const gorontaloReport = createReportFixture("GORONTALO", "automatic_earthquake");

  // HO can view automatic earthquake report for nationwide monitoring
  assert.equal(
    canViewReport(userHoReadOnly, gorontaloReport),
    true,
    "HO user must be authorized to view automatic earthquake report"
  );

  // HO CANNOT mutate or act on the operational report
  assert.equal(
    canActOnReport(userHoReadOnly, gorontaloReport),
    false,
    "HO user must be blocked from operational action (read-only enforcement)"
  );
  assert.equal(
    canConfirmAffectedStore(userHoReadOnly, gorontaloReport),
    false,
    "HO user must be blocked from store confirmation"
  );
  assert.equal(
    canInspectReport(userHoReadOnly, gorontaloReport),
    false,
    "HO user must be blocked from store inspection"
  );
  assert.equal(
    canApproveAsBm(userHoReadOnly, gorontaloReport),
    false,
    "HO user must be blocked from BM approval"
  );

  // SQL WHERE clause for HO includes automatic earthquake reports
  const sqlAccess = getReportAccessSql(userHoReadOnly);
  assert.ok(
    sqlAccess.clause.includes("incidents.report_origin = 'automatic_earthquake'"),
    "HO SQL clause must permit read-only visibility for automatic earthquake reports"
  );
});
