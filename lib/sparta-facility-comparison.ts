export interface FacilityComparisonRow {
  code: string;
  name: string;
  type: string;
  latitude: number | null;
  longitude: number | null;
  branchCode: string | null;
}

export function compareFacilityMasters(siaga: FacilityComparisonRow[], carbontrack: FacilityComparisonRow[]) {
  const index = (rows: FacilityComparisonRow[]) => {
    const map = new Map<string, FacilityComparisonRow>();
    for (const row of rows) {
      const code = row.code?.trim().toUpperCase();
      if (!code || map.has(code)) throw new Error("Kode fasilitas kosong atau berulang; perbaiki ekspor sebelum dibandingkan.");
      map.set(code, row);
    }
    return map;
  };
  const left = index(siaga);
  const right = index(carbontrack);
  const different: Array<{ code: string; fields: string[] }> = [];
  const fields = ["name", "type", "latitude", "longitude", "branchCode"] as const;
  for (const [code, row] of left) {
    const other = right.get(code);
    if (!other) continue;
    const changed = fields.filter(field => row[field] !== other[field]);
    if (changed.length) different.push({ code, fields: changed });
  }
  return { siagaCount: left.size, carbontrackCount: right.size,
    onlySiaga: [...left.keys()].filter(code => !right.has(code)),
    onlyCarbontrack: [...right.keys()].filter(code => !left.has(code)), different,
    sourceDecision: "PENDING_AGREEMENT", portalSync: "BLOCKED_NO_PORTAL_FACILITY_CONTRACT" };
}
