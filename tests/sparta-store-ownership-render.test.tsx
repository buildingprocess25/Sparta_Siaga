import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { StoreDetailSheet } from "../components/store/store-detail-sheet";
import { AffectedStoresSheet } from "../components/disaster/affected-stores-sheet";
import type { Store } from "../types/store";

for (const theme of ["dark", "light"] as const) {
  for (const [type, label] of [["FRANCHISE", "Franchise"], ["REGULAR", "Reguler"], ["UNKNOWN", "Belum diketahui"]]) {
    test(`actual store panels render ${type} correctly in ${theme} theme`, () => {
      const store: Store = { id: "test-store", kode_toko: "T001", nama_toko: "Toko pengujian", cabang: "CIKOKOL",
        alamat: "Alamat pengujian", latitude: -6, longitude: 106, fr_type: type, status: "MONITOR", distanceFromDisasterKm: 1 };
      const detail = renderToStaticMarkup(<StoreDetailSheet store={store} onClose={() => {}} theme={theme} />);
      const affected = renderToStaticMarkup(<AffectedStoresSheet isOpen affectedStores={[store]} onClose={() => {}} onSelectStore={() => {}} theme={theme} />);
      assert.ok(detail.includes(`>${label}</span>`));
      assert.ok(affected.includes(`>${label}</span>`));
      if (type === "UNKNOWN") { assert.ok(!detail.includes(">Reguler</span>")); assert.ok(!affected.includes(">Reguler</span>")); }
    });
  }
}

test("store panels display branch_code and handle empty address or nullable coordinates safely", () => {
  const store: Store = {
    id: "test-portal-store",
    kode_toko: "T002",
    nama_toko: "Toko Portal Minim Data",
    cabang: "CIKOKOL",
    branch_code: "KZ01",
    alamat: "",
    latitude: null as unknown as number,
    longitude: Number.NaN,
    fr_type: "UNKNOWN",
    status: "MONITOR",
    distanceFromDisasterKm: 2,
  };
  const detail = renderToStaticMarkup(<StoreDetailSheet store={store} onClose={() => {}} theme="light" />);
  const affected = renderToStaticMarkup(<AffectedStoresSheet isOpen affectedStores={[store]} onClose={() => {}} onSelectStore={() => {}} theme="light" />);

  assert.ok(detail.includes("Cabang CIKOKOL (KZ01)"));
  assert.ok(affected.includes("Cabang CIKOKOL (KZ01)"));
  assert.ok(detail.includes("Alamat belum tersedia di master toko"));
  assert.ok(detail.includes("Koordinat belum tersedia"));
});
