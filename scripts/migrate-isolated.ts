import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { Pool } from 'pg';

process.loadEnvFile('.env.local');

const ADVISORY_LOCK_ID = 7421839;
const MIGRATIONS_DIR = path.join(process.cwd(), 'database', 'migrations');
const FILENAME_REGEX = /^\d{3}_[\w-]+\.sql$/;

function computeChecksum(content: string) {
  return crypto.createHash('sha256').update(content, 'utf8').digest('hex');
}

async function run() {
  const url = process.env.SPARTA_ISOLATED_TEST_DATABASE_URL;
  if (!url) {
    console.error('SPARTA_ISOLATED_TEST_DATABASE_URL not found in .env.local');
    process.exit(1);
  }

  const ca = process.env.DATABASE_SSL_CA_BASE64
    ? Buffer.from(process.env.DATABASE_SSL_CA_BASE64, 'base64').toString('utf8')
    : undefined;

  const pool = new Pool({
    connectionString: url.replace(/\?sslmode=[^&]+/, ''),
    ssl: ca ? { rejectUnauthorized: true, ca } : { rejectUnauthorized: false },
  });

  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [ADVISORY_LOCK_ID]);
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL UNIQUE,
        checksum VARCHAR(64) NOT NULL,
        executed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    const { rows: appliedRows } = await client.query('SELECT name, checksum FROM schema_migrations');
    const applied = new Map(appliedRows.map((r: any) => [r.name, r.checksum]));

    const entries = await fs.readdir(MIGRATIONS_DIR, { withFileTypes: true });
    const sqlFiles = entries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.sql'))
      .map((entry) => entry.name)
      .sort();

    console.log(`Checking ${sqlFiles.length} migration files on isolated DB...`);

    for (const name of sqlFiles) {
      if (!FILENAME_REGEX.test(name)) continue;
      const fullPath = path.join(MIGRATIONS_DIR, name);
      const content = await fs.readFile(fullPath, 'utf8');
      const checksum = computeChecksum(content);

      if (applied.has(name)) {
        console.log(`  [SKIP] ${name} already applied.`);
        continue;
      }

      console.log(`  [APPLYING] ${name}...`);
      await client.query('BEGIN');
      try {
        await client.query(content);
        await client.query(
          'INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)',
          [name, checksum]
        );
        await client.query('COMMIT');
        console.log(`  [DONE] ${name} applied.`);
      } catch (err) {
        await client.query('ROLLBACK');
        console.error(`  [ERROR] Failed to apply ${name}:`, err);
        throw err;
      }
    }

    console.log('Isolated database migrations complete.');
  } finally {
    try {
      await client.query('SELECT pg_advisory_unlock($1)', [ADVISORY_LOCK_ID]);
    } catch {}
    client.release();
    await pool.end();
  }
}

run().catch((err) => {
  console.error('Failed to migrate isolated db:', err);
  process.exit(1);
});
