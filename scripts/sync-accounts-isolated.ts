import { getProductionDbPool, getIsolatedDbPool } from "../lib/db";

async function run() {
  const prodPool = getProductionDbPool();
  const isoPool = getIsolatedDbPool();

  console.log("Fetching users from production siaga database...");
  const { rows: prodUsers } = await prodPool.query("SELECT * FROM users ORDER BY nik");
  console.log(`Found ${prodUsers.length} users in production.`);

  console.log("Upserting users into isolated sparta_siaga_isolated database...");
  let count = 0;
  for (const u of prodUsers) {
    await isoPool.query(
      `INSERT INTO users (
        id, external_user_id, nik, name, email, system_role,
        business_role, scope, branch, status, source, password_hash,
        avatar_url, token_version, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
      ON CONFLICT (id) DO UPDATE SET
        nik = EXCLUDED.nik,
        name = EXCLUDED.name,
        email = EXCLUDED.email,
        system_role = EXCLUDED.system_role,
        business_role = EXCLUDED.business_role,
        scope = EXCLUDED.scope,
        branch = EXCLUDED.branch,
        status = EXCLUDED.status,
        password_hash = EXCLUDED.password_hash,
        token_version = EXCLUDED.token_version,
        updated_at = NOW()`,
      [
        u.id,
        u.external_user_id,
        u.nik,
        u.name,
        u.email,
        u.system_role,
        u.business_role,
        u.scope,
        u.branch,
        u.status,
        u.source,
        u.password_hash,
        u.avatar_url,
        u.token_version || 1,
        u.created_at,
        u.updated_at,
      ]
    );
    count++;
  }

  console.log(`Successfully synced ${count} users to isolated database.`);
  process.exit(0);
}

run().catch((err) => {
  console.error("Failed to sync users to isolated database:", err);
  process.exit(1);
});
