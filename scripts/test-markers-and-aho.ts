import assert from "node:assert/strict";
import {
  getAhoColor,
  getAhoIndividualStoreStatus,
  calculateAhoPercentage,
  formatAhoBadgeLabel,
} from "../lib/aho-utils";
import {
  getBranchFlagIconOptions,
  getClusterCircleIconOptions,
  getStoreTeardropIconOptions,
  getDcFacilityIconOptions,
} from "../components/map/map-marker-icons";
import type { Store } from "../types/store";

console.log("=================================================================");
console.log("SPARTA SIAGA — MAP MARKER SYSTEM & AHO COLOR QUALITY GATES");
console.log("=================================================================\n");

// ---------------------------------------------------------------------------
// 1. AHO Color Thresholds (Section 9)
// ---------------------------------------------------------------------------
console.log(">>> [TEST 1] AHO 4-Color Category Thresholds");
// Exact Boundaries:
// - 19.99% -> Green (#16a34a)
// - 20.00% -> Yellow (#facc15)
// - 49.99% -> Yellow (#facc15)
// - 50.00% -> Orange (#f97316)
// - 70.00% -> Orange (#f97316)
// - 70.01% -> Red (#dc2626)

const c1 = getAhoColor(19.99);
assert.equal(c1.color, "#16a34a", "19.99% must be Green");
assert.equal(c1.category, "< 20% (Sangat Rendah)");

const c2 = getAhoColor(20.00);
assert.equal(c2.color, "#facc15", "20.00% must be Yellow");
assert.equal(c2.category, "20% – <50% (Rendah)");

const c3 = getAhoColor(49.99);
assert.equal(c3.color, "#facc15", "49.99% must be Yellow");

const c4 = getAhoColor(50.00);
assert.equal(c4.color, "#f97316", "50.00% must be Orange");
assert.equal(c4.category, "50% – 70% (Sedang)");

const c5 = getAhoColor(70.00);
assert.equal(c5.color, "#f97316", "70.00% must be Orange");

const c6 = getAhoColor(70.01);
assert.equal(c6.color, "#dc2626", "70.01% must be Red");
assert.equal(c6.category, "> 70% (Tinggi)");

console.log(" [PASS] Exact boundary thresholds verified successfully:");
console.log("        19.99% -> #16a34a (Green)");
console.log("        20.00% -> #facc15 (Yellow)");
console.log("        49.99% -> #facc15 (Yellow)");
console.log("        50.00% -> #f97316 (Orange)");
console.log("        70.00% -> #f97316 (Orange)");
console.log("        70.01% -> #dc2626 (Red)");

// ---------------------------------------------------------------------------
// 2. Individual Store AHO States (Section 7.4)
// ---------------------------------------------------------------------------
console.log("\n>>> [TEST 2] Individual Store AHO Display States");
const sWithTicket = getAhoIndividualStoreStatus(true, true);
assert.equal(sWithTicket.color, "#dc2626", "Store with ticket must be Red #dc2626");
assert.equal(sWithTicket.label, "Ada Tiket Aktif");

const sNoTicket = getAhoIndividualStoreStatus(false, true);
assert.equal(sNoTicket.color, "#16a34a", "Store without ticket must be Green #16a34a");
assert.equal(sNoTicket.label, "Tanpa Tiket Aktif");

const sUnavailable = getAhoIndividualStoreStatus(false, false);
assert.equal(sUnavailable.color, "#64748b", "Unavailable data must be Neutral Gray #64748b");
assert.equal(sUnavailable.label, "Data Belum Tersedia");

console.log(" [PASS] Three distinct individual store states verified:");
console.log("        - Has active ticket   : #dc2626 (Red)");
console.log("        - Confirmed no ticket : #16a34a (Green)");
console.log("        - Data unavailable    : #64748b (Neutral Gray)");

// ---------------------------------------------------------------------------
// 3. Mathematical Formula for Aggregation
// ---------------------------------------------------------------------------
console.log("\n>>> [TEST 3] AHO Percentage Calculation Formula");
// Denominator: total stores, Numerator: stores with >= 1 ticket
const pct = calculateAhoPercentage(784, 294);
assert.equal(Math.round(pct), 38, "294/784 stores must round to 38%");
const label = formatAhoBadgeLabel(784, 294);
assert.equal(label, "38% (294/784)");
console.log(` [PASS] 294/784 -> ${pct.toFixed(2)}% -> Badge Label: "${label}"`);

// ---------------------------------------------------------------------------
// 4. Marker Silhouettes & Anchoring Checks
// ---------------------------------------------------------------------------
console.log("\n>>> [TEST 4] Marker Silhouette & Geographic Anchor Verification");

// 4.1 Cabang Marker
const branchOpts = getBranchFlagIconOptions({
  cabang: "MEDAN",
  latitude: 3.5952,
  longitude: 98.6722,
  totalStores: 784,
  storesWithTickets: 294,
  percentage: 37.5,
}, true);
assert(branchOpts.html.includes("sparta-branch-marker"), "Must have sparta-branch-marker class");
assert(branchOpts.html.includes("MEDAN"), "Must contain branch name");
assert(branchOpts.html.includes("38%"), "Must contain rounded percentage");
assert.deepEqual(branchOpts.iconAnchor, [70, 34], "Branch anchor must be centered at bottom stem tip [70, 34]");
console.log(" [PASS] Cabang Marker: Anchored flag silhouette with stem anchor [70, 34]");

// 4.2 Cluster Marker
const clusterOpts = getClusterCircleIconOptions(24, true, 8, 33.33);
assert(clusterOpts.html.includes("sparta-cluster-aho"), "Must have sparta-cluster-aho class");
assert(clusterOpts.html.includes("stroke-dasharray"), "Must have proportional stroke-dasharray SVG donut");
assert.deepEqual(clusterOpts.iconAnchor, [21, 21], "Cluster anchor must be center point [21, 21]");
console.log(" [PASS] Cluster Marker: Circular aggregation with proportional SVG donut [21, 21]");

// 4.3 Toko Individual Pin
const dummyStore: Store = {
  id: "STORE_001",
  kode_toko: "1G2R",
  nama_toko: "ALFAMART CIKOKOL",
  cabang: "CIKOKOL",
  latitude: -6.18,
  longitude: 106.63,
  alamat: "Jl. Sudirman No. 1",
  status: "SAFE",
  spatialRisk: "SAFE",
  operationalStatus: "NONE",
  visualStatus: "NORMAL",
};
const storeOpts = getStoreTeardropIconOptions(dummyStore, true, true, 2);
assert(storeOpts.html.includes("sparta-store-pin"), "Must have sparta-store-pin class");
assert(storeOpts.html.includes("d=\"M12 1.5C6.75 1.5 2.5 5.75 2.5 11"), "Must have teardrop pin SVG path");
assert.deepEqual(storeOpts.iconAnchor, [11, 28], "Store pin anchor must be bottom pin tip [11, 28]");
console.log(" [PASS] Toko Individual: Geographic teardrop location pin with tip anchor [11, 28]");

// 4.4 DC Facility Marker
const dummyDc: Store = {
  id: "FACILITY:DC_001",
  kode_toko: "DC_TGR",
  nama_toko: "DC TANGERANG",
  cabang: "CIKOKOL",
  latitude: -6.2,
  longitude: 106.65,
  alamat: "Jl. Sudirman No. 1",
  status: "SAFE",
  spatialRisk: "SAFE",
  operationalStatus: "NONE",
  visualStatus: "NORMAL",
  fr_type: "FACILITY_DC",
};
const dcOpts = getDcFacilityIconOptions(dummyDc);
assert(dcOpts.html.includes("sparta-dc-facility"), "Must have sparta-dc-facility class");
assert(dcOpts.html.includes("M22 8.35V20"), "Must contain warehouse icon SVG path");
assert.deepEqual(dcOpts.iconAnchor, [17, 38], "DC anchor must be at pointer tip [17, 38]");
console.log(" [PASS] DC Facility: Warehouse facility marker with pointer anchor [17, 38]");

console.log("\n=================================================================");
console.log("ALL MARKER SYSTEM & COLOR QUALITY GATES PASSED (100%)");
console.log("=================================================================\n");
