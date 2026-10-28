
import { readFile } from "node:fs/promises";
import * as XLSX from "xlsx";

export type FacilityType =
  | "DC"
  | "WAREHOUSE"
  | "DEPO"
  | "BULKY"
  | "STORE_HUB";

export interface FacilitySourceRow {
  "No."?: unknown;
  Kode?: unknown;
  "Nama Toko"?: unknown;
  Inisial?: unknown;
  CATEGORY?: unknown;
  Latitude?: unknown;
  Longitude?: unknown;
}

export interface FacilityImportRecord {
  sourceRow: number;
  code: string;
  name: string;
  initials: string | null;
  type: FacilityType;
  latitude: number;
  longitude: number;
}

export interface InvalidFacilityRow {
  sourceRow: number;
  code: string | null;
  reasons: string[];
}

export interface FacilityParseResult {
  records: FacilityImportRecord[];
  invalid: InvalidFacilityRow[];
}

export interface FacilitySourceAdapter {
  readonly sourceName: string;
  readRows(): Promise<FacilitySourceRow[]>;
}

const TYPE_BY_CATEGORY: Record<string, FacilityType> = {
  BRANCH: "DC",
  DC: "DC",
  WAREHOUSE: "WAREHOUSE",
  DEPO: "DEPO",
  BULKY: "BULKY",
  "STORE HUB": "STORE_HUB",
  STORE_HUB: "STORE_HUB",
};

function text(value: unknown): string {
  return typeof value === "string"
    ? value.trim()
    : String(value ?? "").trim();
}

function number(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value !== "string" || value.trim() === "") {
    return null;
  }

  const parsed = Number(value.replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

export function parseFacilityRows(
  rows: FacilitySourceRow[]
): FacilityParseResult {
  const codeCounts = new Map<string, number>();

  for (const row of rows) {
    const code = text(row.Kode).toUpperCase();

    if (code) {
      codeCounts.set(
        code,
        (codeCounts.get(code) ?? 0) + 1
      );
    }
  }

  const records: FacilityImportRecord[] = [];
  const invalid: InvalidFacilityRow[] = [];

  rows.forEach((row, index) => {
    const sourceRow = index + 2;

    const code = text(row.Kode).toUpperCase();
    const name = text(row["Nama Toko"]);
    const category = text(row.CATEGORY).toUpperCase();

    const type = TYPE_BY_CATEGORY[category];
    const latitude = number(row.Latitude);
    const longitude = number(row.Longitude);

    const reasons: string[] = [];

    if (!code) {
      reasons.push("Kode fasilitas kosong");
    }

    if (code && (codeCounts.get(code) ?? 0) > 1) {
      reasons.push("Kode fasilitas duplikat");
    }

    if (!name) {
      reasons.push("Nama fasilitas kosong");
    }

    if (!type) {
      reasons.push(
        `Kategori tidak dikenal: ${category || "(kosong)"}`
      );
    }

    if (
      latitude === null ||
      latitude < -90 ||
      latitude > 90
    ) {
      reasons.push(
        "Latitude harus berada pada rentang -90 sampai 90"
      );
    }

    if (
      longitude === null ||
      longitude < -180 ||
      longitude > 180
    ) {
      reasons.push(
        "Longitude harus berada pada rentang -180 sampai 180"
      );
    }

    if (
      reasons.length > 0 ||
      !type ||
      latitude === null ||
      longitude === null
    ) {
      invalid.push({
        sourceRow,
        code: code || null,
        reasons,
      });

      return;
    }

    records.push({
      sourceRow,
      code,
      name,
      initials: text(row.Inisial) || null,
      type,
      latitude,
      longitude,
    });
  });

  return {
    records,
    invalid,
  };
}

export class ExcelFacilitySource
  implements FacilitySourceAdapter
{
  readonly sourceName = "KOORDINAT GUDANG.xlsx";

  constructor(
    private readonly filePath: string
  ) {}

  async readRows(): Promise<FacilitySourceRow[]> {
    // Read the Excel file using native Node.js filesystem.
    // Avoid XLSX.readFile() compatibility issues in
    // Next.js production bundles.
    const fileBuffer = await readFile(this.filePath);

    // Parse Excel contents directly from the file buffer.
    const workbook = XLSX.read(fileBuffer, {
      type: "buffer",
    });

    if (workbook.SheetNames.length !== 1) {
      throw new Error(
        `Workbook fasilitas harus memiliki tepat satu sheet; ditemukan ${workbook.SheetNames.length}.`
      );
    }

    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];

    if (!sheet) {
      throw new Error(
        `Worksheet "${sheetName}" tidak ditemukan.`
      );
    }

    return XLSX.utils.sheet_to_json<FacilitySourceRow>(
      sheet,
      {
        defval: null,
        raw: true,
      }
    );
  }
}
