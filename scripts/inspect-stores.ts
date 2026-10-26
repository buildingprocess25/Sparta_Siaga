import { getDbPool } from "../lib/db";

async function main() {
  const pool = getDbPool();
  const res = await pool.query("SELECT kode_toko, nama_toko, cabang FROM stores LIMIT 5");
  console.log("Stores:", res.rows);
  const count = await pool.query("SELECT count(*) FROM stores");
  console.log("Count:", count.rows[0]);
  process.exit(0);
}

main().catch(console.error);
