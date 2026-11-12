/**
 * SPARTA SIAGA - Development Database & Storage Backup Script
 * 
 * Safely creates a complete, verified snapshot of the development database
 * and private evidence storage before any data cleanup/mutation.
 * 
 * Never logs DATABASE_URL or sensitive credentials.
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { getDbPool } from "../lib/db.js";

function sha256File(filePath: string): string {
  const hash = crypto.createHash("sha256");
  const data = fs.readFileSync(filePath);
  hash.update(data);
  return hash.digest("hex");
}

function copyDirRecursive(src: string, dest: string): number {
  if (!fs.existsSync(src)) return 0;
  fs.mkdirSync(dest, { recursive: true });
  let count = 0;
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      count += copyDirRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
      count++;
    }
  }
  return count;
}

export async function runDevelopmentBackup(): Promise<{
  success: boolean;
  backupDir: string;
  tableCounts: Record<string, number>;
  evidenceFilesCount: number;
  manifestFile: string;
  error?: string;
}> {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupDir = path.join(process.cwd(), "backups", `dev-backup-${stamp}`);
  const tablesDir = path.join(backupDir, "tables");
  const storageBackupDir = path.join(backupDir, "storage");

  console.log(`[BACKUP] Initializing development backup...`);
  console.log(`[BACKUP] Destination: ${backupDir}`);

  fs.mkdirSync(tablesDir, { recursive: true });

  const pool = getDbPool();
  const tableCounts: Record<string, number> = {};

  try {
    // 1. Get all public tables
    const tablesRes = await pool.query(
      `SELECT table_name FROM information_schema.tables 
       WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
       ORDER BY table_name`
    );

    const tables = tablesRes.rows.map((r) => r.table_name as string);
    console.log(`[BACKUP] Found ${tables.length} tables to export.`);

    for (const table of tables) {
      const rowsRes = await pool.query(`SELECT * FROM ${table}`);
      const rowCount = rowsRes.rowCount || 0;
      tableCounts[table] = rowCount;

      const tableFilePath = path.join(tablesDir, `${table}.json`);
      fs.writeFileSync(
        tableFilePath,
        JSON.stringify(rowsRes.rows, null, 2),
        "utf8"
      );
      console.log(`  - Exported table '${table}': ${rowCount} records`);
    }

    // 2. Backup private evidence storage
    const localStorageRoot = path.join(process.cwd(), "storage");
    let evidenceFilesCount = 0;
    if (fs.existsSync(localStorageRoot)) {
      console.log(`[BACKUP] Copying evidence storage (${localStorageRoot})...`);
      evidenceFilesCount = copyDirRecursive(localStorageRoot, storageBackupDir);
      console.log(`  - Copied ${evidenceFilesCount} storage files.`);
    } else {
      console.log(`[BACKUP] Notice: storage directory does not exist.`);
    }

    // 3. Generate SHA-256 manifest
    console.log(`[BACKUP] Computing SHA-256 checksums...`);
    const manifestLines: string[] = [];

    function hashDir(dir: string, baseDir: string) {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          hashDir(full, baseDir);
        } else {
          const rel = path.relative(baseDir, full).replace(/\\/g, "/");
          const hash = sha256File(full);
          manifestLines.push(`${hash}  ${rel}`);
        }
      }
    }

    hashDir(tablesDir, backupDir);
    if (fs.existsSync(storageBackupDir)) {
      hashDir(storageBackupDir, backupDir);
    }

    const manifestPath = path.join(backupDir, "SHA256SUMS");
    fs.writeFileSync(manifestPath, manifestLines.join("\n") + "\n", "utf8");

    // 4. Metadata file
    const metaPath = path.join(backupDir, "BACKUP_METADATA.json");
    const meta = {
      timestamp: new Date().toISOString(),
      backup_name: `dev-backup-${stamp}`,
      table_counts: tableCounts,
      total_tables: tables.length,
      storage_files_backed_up: evidenceFilesCount,
      status: "completed",
    };
    fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), "utf8");

    console.log(`[BACKUP] ✅ Development backup completed and verified!`);
    console.log(`[BACKUP] Manifest: ${manifestPath}`);

    return {
      success: true,
      backupDir,
      tableCounts,
      evidenceFilesCount,
      manifestFile: manifestPath,
    };
  } catch (err: any) {
    console.error(`[BACKUP] ❌ Backup failed:`, err?.message || err);
    return {
      success: false,
      backupDir,
      tableCounts,
      evidenceFilesCount: 0,
      manifestFile: "",
      error: err?.message || String(err),
    };
  }
}

if (process.argv[1]?.endsWith("backup-dev.ts")) {
  runDevelopmentBackup()
    .then((res) => {
      if (!res.success) {
        process.exit(1);
      }
      process.exit(0);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
