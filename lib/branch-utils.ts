// ============================================================
// SPARTA SIAGA — CANONICAL BRANCH UTILITIES
// Browser-safe canonical branch definitions & normalization
// ============================================================

export interface CanonicalBranchRecord {
  code: string;
  name: string;
  aliases: string[];
  storeCount?: number;
}

/**
 * 28 Canonical Organizational Branches derived from stores master dataset.
 * A user assigned to a branch oversees all stores in that organizational territory.
 */
export const CANONICAL_BRANCH_LIST: readonly CanonicalBranchRecord[] = [
  { code: "BALI", name: "Cabang Bali", aliases: ["BLI", "DPS"] },
  { code: "BANDUNG", name: "Cabang Bandung", aliases: ["G002", "BDG"] },
  { code: "BANJARMASIN", name: "Cabang Banjarmasin", aliases: ["BJM"] },
  { code: "BATAM", name: "Cabang Batam", aliases: ["BTM"] },
  { code: "CIANJUR", name: "Cabang Cianjur", aliases: ["CJR"] },
  { code: "CIKOKOL", name: "Cabang Cikokol", aliases: ["G001", "TE76", "CKL"] },
  { code: "CILACAP", name: "Cabang Cilacap", aliases: ["CLP"] },
  { code: "CILEUNGSI_2", name: "Cabang Cileungsi 2", aliases: ["CILEUNGSI", "CILEUNGSI 2", "CLS"] },
  { code: "GORONTALO", name: "Cabang Gorontalo", aliases: ["GTO"] },
  { code: "JAMBI", name: "Cabang Jambi", aliases: ["JMB"] },
  { code: "JEMBER", name: "Cabang Jember", aliases: ["JBR"] },
  { code: "KLATEN", name: "Cabang Klaten", aliases: ["KLT"] },
  { code: "LAMPUNG", name: "Cabang Lampung", aliases: ["LPG"] },
  { code: "LOMBOK", name: "Cabang Lombok", aliases: ["LBK", "MATARAM"] },
  { code: "LUWU", name: "Cabang Luwu", aliases: ["LTO", "PALOPO"] },
  { code: "MADIUN", name: "Cabang Madiun", aliases: ["MDN_2", "MDIUN"] },
  { code: "MAKASSAR", name: "Cabang Makassar", aliases: ["MKS", "UPG"] },
  { code: "MALANG", name: "Cabang Malang", aliases: ["MLG"] },
  { code: "MANADO", name: "Cabang Manado", aliases: ["MND"] },
  { code: "MEDAN", name: "Cabang Medan", aliases: ["MDN", "KNO"] },
  { code: "PALEMBANG", name: "Cabang Palembang", aliases: ["PLB", "PLM"] },
  { code: "PEKANBARU", name: "Cabang Pekanbaru", aliases: ["PKU"] },
  { code: "PLUMBON", name: "Cabang Plumbon", aliases: ["PLB_2", "CRB", "CIREBON"] },
  { code: "PONTIANAK", name: "Cabang Pontianak", aliases: ["PTK"] },
  { code: "REMBANG", name: "Cabang Rembang", aliases: ["RBG"] },
  { code: "SEMARANG", name: "Cabang Semarang", aliases: ["SMG"] },
  { code: "SIDOARJO", name: "Cabang Sidoarjo", aliases: ["SDJ", "SDA", "SDR"] },
  { code: "TEGAL", name: "Cabang Tegal", aliases: ["TGL"] },
];

export const CANONICAL_BRANCHES = CANONICAL_BRANCH_LIST;

// Fast lookup map (canonical code or uppercase alias -> canonical code)
const BRANCH_LOOKUP = new Map<string, string>();

for (const b of CANONICAL_BRANCH_LIST) {
  BRANCH_LOOKUP.set(b.code.toUpperCase(), b.code);
  for (const alias of b.aliases) {
    BRANCH_LOOKUP.set(alias.toUpperCase(), b.code);
  }
}

/**
 * Finds a canonical branch by code or alias synchronously.
 */
export function findCanonicalBranch(codeOrAlias?: string | null): CanonicalBranchRecord | undefined {
  if (!codeOrAlias) return undefined;
  const canonicalCode = normalizeBranchCode(codeOrAlias);
  return CANONICAL_BRANCH_LIST.find((b) => b.code === canonicalCode);
}

/**
 * Checks whether a branch code or alias is recognized.
 */
export function isBranchCodeValid(codeOrAlias?: string | null): boolean {
  if (!codeOrAlias) return false;
  const normalized = normalizeBranchCode(codeOrAlias);
  return CANONICAL_BRANCH_LIST.some((b) => b.code === normalized);
}

/**
 * Normalizes any branch input (including legacy display strings like "CIKOKOL — ABDUL HADI",
 * aliases like "G001", or prefix "Cabang Cikokol") into the canonical branch code.
 */
export function normalizeBranchCode(rawInput?: string | null): string {
  if (!rawInput) return "";
  let clean = rawInput.trim();

  // If input contains separator "—" or " - ", extract first token (e.g. "CIKOKOL — ABDUL HADI")
  if (clean.includes("—")) {
    clean = clean.split("—")[0].trim();
  } else if (clean.includes(" - ")) {
    clean = clean.split(" - ")[0].trim();
  }

  // Strip prefix "Cabang " or "CABANG "
  clean = clean.replace(/^CABANG\s+/i, "").trim().toUpperCase();

  // Direct lookup via code or alias
  const resolved = BRANCH_LOOKUP.get(clean);
  if (resolved) return resolved;

  // Partial match fallback
  for (const b of CANONICAL_BRANCH_LIST) {
    if (b.code.toUpperCase() === clean || b.name.toUpperCase() === clean) {
      return b.code;
    }
  }

  // Return uppercase cleaned if not mapped
  return clean;
}
