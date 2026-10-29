import assert from "node:assert/strict";

import { canAccessReport } from "../lib/report-access-policy";
import { deriveWorkflowActions } from "../lib/workflow-actions";
import type { UserContext } from "../lib/report-permissions";
import type { IncidentRecord } from "../types/incident";

const ho: UserContext = {
  id: "ho-1",
  name: "HO",
  role: "ho_admin",
  systemRole: "USER",
  scope: "HO",
  branch: null,
};

const bms: UserContext = {
  id: "bms-1",
  name: "BMS Bandung",
  role: "bms",
  systemRole: "USER",
  scope: "BRANCH",
  branch: "BANDUNG",
};

const bm: UserContext = {
  id: "bm-1",
  name: "BnM Bandung",
  role: "bm",
  systemRole: "USER",
  scope: "BRANCH",
  branch: "BANDUNG",
};

function report(patch: Partial<IncidentRecord> = {}): IncidentRecord {
  return {
    id: "INC-POLICY-1",
    date: "2026-10-22",
    disasterType: "flood",
    reportOrigin: "manual",
    storeId: "S001",
    storeName: "Toko Bandung",
    branch: "BANDUNG",
    locationCity: "Bandung",
    status: "pending_confirmation",
    progress: 0,
    fieldPhotos: [],
    timeline: [],
    createdAt: "2026-10-22T00:00:00.000Z",
    updatedAt: "2026-10-22T00:00:00.000Z",
    ...patch,
  };
}

// Phase 1 Rules:
// 1. Unapproved reports (both manual and auto-earthquake) must NOT be visible to HO
assert.equal(canAccessReport(ho, report()), false, "HO must not see an unapproved manual report");
assert.equal(
  canAccessReport(ho, report({ reportOrigin: "automatic_earthquake", disasterType: "earthquake", status: "pending_confirmation" })),
  false,
  "Phase 1: HO must NOT see an unapproved automatic earthquake report before BnM confirmation"
);

// 2. Both manual and automatic earthquake reports become visible after BnM approval
assert.equal(
  canAccessReport(ho, report({
    status: "confirmed_affected",
    verification: {
      confirmedBy: "BMS Bandung",
      confirmedAt: "2026-10-22T01:00:00.000Z",
      isDamaged: true,
      photos: ["https://example.com/photo.jpg"],
      bmApproval: {
        decision: "approved",
        decidedBy: "BnM Bandung",
        decidedAt: "2026-10-22T02:00:00.000Z",
      },
    },
  })),
  true,
  "HO must see a manual report after initial BnM approval"
);

assert.equal(
  canAccessReport(ho, report({
    reportOrigin: "automatic_earthquake",
    disasterType: "earthquake",
    status: "confirmed_affected",
    verification: {
      confirmedBy: "BMS Bandung",
      confirmedAt: "2026-10-22T01:00:00.000Z",
      isDamaged: true,
      photos: ["https://example.com/photo.jpg"],
      bmApproval: {
        decision: "approved",
        decidedBy: "BnM Bandung",
        decidedAt: "2026-10-22T02:00:00.000Z",
      },
    },
  })),
  true,
  "Phase 1: HO must see an automatic earthquake report after initial BnM approval"
);

// Confirmed safe report must also be visible to HO
assert.equal(
  canAccessReport(ho, report({
    reportOrigin: "automatic_earthquake",
    disasterType: "earthquake",
    status: "confirmed_safe",
    verification: {
      confirmedBy: "BMS Bandung",
      confirmedAt: "2026-10-22T01:00:00.000Z",
      isDamaged: false,
      photos: ["https://example.com/photo_safe.jpg"],
      bmApproval: {
        decision: "safe",
        decidedBy: "BnM Bandung",
        decidedAt: "2026-10-22T02:00:00.000Z",
      },
    },
  })),
  true,
  "Phase 1: HO must see a confirmed safe report after BnM confirmation"
);

assert.equal(canAccessReport({ ...bms, branch: "JAKARTA" }, report()), false, "branch users must not cross branches");

assert.deepEqual(
  deriveWorkflowActions(bms, report(), {
    canInspect: true,
  }).map((action) => action.id),
  ["INSPECT"],
  "BMS should receive only the inspection action at the initial stage"
);

assert.deepEqual(
  deriveWorkflowActions(bm, report({ status: "pending_bm_approval" }), {
    canApproveInitial: true,
  }).map((action) => action.id),
  ["APPROVE_INITIAL"],
  "BnM should receive the initial approval action only after inspection"
);

assert.deepEqual(
  deriveWorkflowActions(bm, report({ status: "approved_pending_close", progress: 100 }), {
    canClose: true,
    completionStatus: "APPROVED_PENDING_CLOSE",
  }).map((action) => action.id),
  ["CASE_CLOSE"],
  "Case Close must remain a distinct action after Final Approval"
);

assert.deepEqual(
  deriveWorkflowActions(ho, report({ reportOrigin: "automatic_earthquake", disasterType: "earthquake" }), {
    canInspect: true,
    canApproveInitial: true,
    canUpdateProgress: true,
    canClose: true,
  }),
  [],
  "HO must never receive operational actions"
);

console.log("PASS Audit 001 report policy and workflow action contracts");
