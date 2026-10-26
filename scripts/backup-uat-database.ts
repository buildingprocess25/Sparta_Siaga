import fs from "fs";
import path from "path";
import crypto from "crypto";
import { getDbPool, closeDbPool } from "../lib/db";
import { assertIsolatedDatabase } from "../lib/database-safety";

export async function createUatBackup(): Promise<string> {
  const pool = getDbPool();
  await assertIsolatedDatabase(pool);

  const dbRes = await pool.query("SELECT current_database() as db_name");
  const dbName = dbRes.rows[0]?.db_name;
  console.log(`[Backup] Confirmed connected to isolated database: "${dbName}"`);

  const now = new Date();
  const timestamp = now.toISOString().replace(/[:.]/g, "-");
  const backupDirName = `uat_cleanup_${timestamp}`;
  const backupDirPath = path.resolve("backups", backupDirName);
  const tablesDirPath = path.join(backupDirPath, "tables");
  const storageDirPath = path.join(backupDirPath, "storage");

  fs.mkdirSync(tablesDirPath, { recursive: true });
  fs.mkdirSync(storageDirPath, { recursive: true });

  console.log(`[Backup] Initialized backup directory: ${backupDirPath}`);

  const tablesRes = await pool.query(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name"
  );
  const tablesToBackup = tablesRes.rows.map((r: any) => r.table_name as string);

  const tableRecordCounts: Record<string, number> = {};

  for (const table of tablesToBackup) {
    try {
      const res = await pool.query(`SELECT * FROM ${table}`);
      const filePath = path.join(tablesDirPath, `${table}.json`);
      fs.writeFileSync(filePath, JSON.stringify(res.rows, null, 2), "utf8");
      tableRecordCounts[table] = res.rows.length;
      console.log(`[Backup] Table "${table}": ${res.rows.length} rows exported`);
    } catch (err: any) {
      console.warn(`[Backup] Table "${table}" skipped or error: ${err.message}`);
      tableRecordCounts[table] = 0;
    }
  }

  // Backup storage files
  function copyRecursive(src: string, dest: string, countRef: { count: number }) {
    if (!fs.existsSync(src)) return;
    const stat = fs.statSync(src);
    if (stat.isDirectory()) {
      fs.mkdirSync(dest, { recursive: true });
      const items = fs.readdirSync(src);
      for (const item of items) {
        copyRecursive(path.join(src, item), path.join(dest, item), countRef);
      }
    } else {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(src, dest);
      countRef.count++;
    }
  }

  const fileCountRef = { count: 0 };
  const appStorageDir = path.resolve("storage");
  if (fs.existsSync(appStorageDir)) {
    copyRecursive(appStorageDir, path.join(storageDirPath, "storage"), fileCountRef);
  }

  const publicUploadsDir = path.resolve("public", "uploads");
  if (fs.existsSync(publicUploadsDir)) {
    copyRecursive(publicUploadsDir, path.join(storageDirPath, "public_uploads"), fileCountRef);
  }

  console.log(`[Backup] Storage files backed up: ${fileCountRef.count} files`);

  // Generate SHA256 checksums
  const shaLines: string[] = [];
  function hashFilesRecursive(dir: string) {
    const items = fs.readdirSync(dir);
    for (const item of items) {
      const full = path.join(dir, item);
      const stat = fs.statSync(full);
      if (stat.isDirectory()) {
        hashFilesRecursive(full);
      } else {
        const fileBuf = fs.readFileSync(full);
        const hash = crypto.createHash("sha256").update(fileBuf).digest("hex");
        const rel = path.relative(backupDirPath, full).replace(/\\/g, "/");
        shaLines.push(`${hash}  ${rel}`);
      }
    }
  }

  hashFilesRecursive(backupDirPath);
  fs.writeFileSync(path.join(backupDirPath, "SHA256SUMS"), shaLines.join("\n"), "utf8");

  // Metadata
  const metadata = {
    backupName: backupDirName,
    createdAt: now.toISOString(),
    databaseName: dbName,
    tableCounts: tableRecordCounts,
    backedUpFilesCount: fileCountRef.count,
    sha256SumsCount: shaLines.length,
    status: "SUCCESS",
  };

  fs.writeFileSync(
    path.join(backupDirPath, "BACKUP_METADATA.json"),
    JSON.stringify(metadata, null, 2),
    "utf8"
  );

  console.log(`[Backup] COMPLETED SUCCESSFULLY: ${backupDirPath}`);
  return backupDirPath;
}

if (process.argv[1]?.endsWith("backup-uat-database.ts")) {
  createUatBackup()
    .then(async () => {
      await closeDbPool();
      process.exit(0);
    })
    .catch(async (err) => {
      console.error("[Backup] Fatal error:", err);
      await closeDbPool();
      process.exit(1);
    });
}
