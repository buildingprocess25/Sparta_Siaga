import assert from "node:assert/strict";
import test from "node:test";
import { planSiagaReplay } from "../scripts/sparta-siaga-bootstrap";

test("initial replay grants only existing SIAGA entitlements and revokes accounts without that entitlement", () => {
  const plan = planSiagaReplay([
    { id: "maintenance-only", status: "ACTIVE", modules: [{ moduleId: "maintenance", role: "BMS", isActive: true }] },
    { id: "active", status: "ACTIVE", modules: [{ moduleId: "siaga", role: "BMS", isActive: true }] },
    { id: "revoked", status: "ACTIVE", modules: [{ moduleId: "siaga", role: "USER", isActive: false }] },
    { id: "inactive", status: "INACTIVE", modules: [{ moduleId: "siaga", role: "USER", isActive: true }] },
    { id: "legacy", status: "ACTIVE", modules: [{ moduleId: "siaga", role: "HO_ADMIN", isActive: true }] },
    { id: "invalid", status: "ACTIVE", modules: [{ moduleId: "siaga", role: "SUPER_ADMIN", isActive: true }] },
  ]);
  assert.deepEqual(plan.events, [
    { userId: "maintenance-only", type: "access.revoked" },
    { userId: "active", type: "access.granted" },
    { userId: "revoked", type: "access.revoked" },
    { userId: "inactive", type: "user.deactivated" },
  ]);
  assert.deepEqual(plan.invalid, [
    { userId: "legacy", role: "HO_ADMIN" },
    { userId: "invalid", role: "SUPER_ADMIN" },
  ]);
});
