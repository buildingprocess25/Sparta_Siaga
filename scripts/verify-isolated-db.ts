import { Pool } from "pg";
import fs from "node:fs";
import path from "node:path";

function getIsolatedDbConfig() {
  const envContent = fs.readFileSync(path.join(process.cwd(), ".env.local"), "utf8");
  let isolatedUrl = "";
  for (const line of envContent.split(/\r?\n/)) {
    const match = line.match(/^\s*SPARTA_ISOLATED_TEST_DATABASE_URL\s*=\s*(.*)?\s*$/);
    if (match) {
      isolatedUrl = match[1].trim().replace(/^["']|["']$/g, "");
      break;
    }
  }

  if (!isolatedUrl) {
    throw new Error("SPARTA_ISOLATED_TEST_DATABASE_URL not found in .env.local");
  }

  const parsed = new URL(isolatedUrl);
  const host = parsed.hostname;
  const port = parsed.port;
  const dbName = parsed.pathname.replace(/^\//, "");
  const user = parsed.username;

  return {
    rawUrl: isolatedUrl,
    host,
    port,
    dbName,
    user,
  };
}

async function verify() {
  const config = getIsolatedDbConfig();
  console.log("=== ISOLATED DATABASE VERIFICATION ===");
  console.log(`Host: ${config.host}`);
  console.log(`Port: ${config.port}`);
  console.log(`Database Name: ${config.dbName}`);
  console.log(`User: ${config.user}`);
  console.log(`Is Isolated DB: ${config.dbName === "sparta_siaga_isolated" ? "YES (SAFE)" : "NO (UNSAFE)"}`);

  if (config.dbName !== "sparta_siaga_isolated") {
    console.error("FATAL: Target database is NOT sparta_siaga_isolated!");
    process.exit(1);
  }

  const cleanConnString = config.rawUrl.replace(/\?sslmode=[^&]+/, "");
  const pool = new Pool({
    connectionString: cleanConnString,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 10000,
  });

  try {
    const client = await pool.connect();
    console.log("Connection successful!");

    const currentDbRes = await client.query("SELECT current_database(), current_user;");
    console.log("Confirmed Current Database:", currentDbRes.rows[0].current_database);
    console.log("Confirmed Current User:", currentDbRes.rows[0].current_user);

    const tablesRes = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      ORDER BY table_name;
    `);
    console.log("Tables in public schema:", tablesRes.rows.map(r => r.table_name));

    const indexesRes = await client.query(`
      SELECT indexname, indexdef 
      FROM pg_indexes 
      WHERE tablename = 'incidents' 
      ORDER BY indexname;
    `);
    console.log("Indexes on incidents table:");
    for (const idx of indexesRes.rows) {
      console.log(` - ${idx.indexname}: ${idx.indexdef}`);
    }

    const testCountRes = await client.query("SELECT COUNT(*) FROM incidents WHERE id LIKE 'INC-TEST-%';");
    console.log("Test incidents (INC-TEST-*) found:", testCountRes.rows[0].count);

    const countRes = await client.query("SELECT COUNT(*) FROM incidents;");
    console.log("Total incidents in isolated DB:", countRes.rows[0].count);

    client.release();
  } catch (err) {
    console.error("Connection or query error:", err);
  } finally {
    await pool.end();
  }
}

verify();
