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
