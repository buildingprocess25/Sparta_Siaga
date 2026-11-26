import { getDbPool, closeDbPool } from "../lib/db";
import { fetchDisasterFeed } from "../lib/disaster-service";
import { calculateHaversineDistance, calculateSpartaMonitoringZone } from "../lib/haversine";
import { AUTO_EARTHQUAKE_MAX_AGE_MINUTES } from "../lib/server-daemon";

process.env.DATABASE_POOL_MAX = "2";

async function main() {
  const pool = getDbPool();
  const storeRes = await pool.query(
    `SELECT id, kode_toko, nama_toko, cabang, alamat, latitude, longitude, fr_type 
     FROM stores
     ORDER BY kode_toko ASC`
  );
  const stores = storeRes.rows;
  console.log(`Total stores fetched from DB: ${stores.length}`);

  const feed = await fetchDisasterFeed(true);
  console.log(`Active quakes count: ${feed.activeEarthquakes?.length}`);
  console.log(`AUTO_EARTHQUAKE_MAX_AGE_MINUTES: ${AUTO_EARTHQUAKE_MAX_AGE_MINUTES}`);

  for (const eq of feed.activeEarthquakes || []) {
    const { priorityRadiusKm, monitoringRadiusKm } = calculateSpartaMonitoringZone(eq.magnitude, eq.depthKm);
    const eventTimestamp = eq.timestamp || (eq.time ? new Date(eq.time).getTime() : Date.now());
    const eventAgeMinutes = (Date.now() - eventTimestamp) / (1000 * 60);

    console.log(`\nEvaluating Quake: ${eq.id} (${eq.title})`);
    console.log(` - Magnitude: ${eq.magnitude}, Depth: ${eq.depthKm} km`);
    console.log(` - Epicenter: ${eq.latitude}, ${eq.longitude}`);
    console.log(` - Age: ${eventAgeMinutes.toFixed(1)} mins (max allowed: ${AUTO_EARTHQUAKE_MAX_AGE_MINUTES}m)`);
    console.log(` - Priority Radius: ${priorityRadiusKm} km | Monitoring Radius: ${monitoringRadiusKm} km`);

    let priorityMatches = 0;
    let monitoringMatches = 0;
    let closestStore: any = null;
    let minDistance = Infinity;

    for (const store of stores) {
      if (store.latitude == null || store.longitude == null) continue;
      const d = calculateHaversineDistance(eq.latitude, eq.longitude, store.latitude, store.longitude);
      if (d < minDistance) {
        minDistance = d;
        closestStore = store;
      }
      if (d <= priorityRadiusKm) {
        priorityMatches++;
        console.log(`   [PRIORITY MATCH] ${store.kode_toko} (${store.nama_toko}, ${store.cabang}) - Distance: ${d} km`);
      } else if (d <= monitoringRadiusKm) {
        monitoringMatches++;
      }
    }

    console.log(` - Closest store: ${closestStore?.kode_toko} (${closestStore?.nama_toko}, ${closestStore?.cabang}) at ${minDistance} km`);
    console.log(` - Stores in Priority Zone (<= ${priorityRadiusKm} km): ${priorityMatches}`);
    console.log(` - Stores in Monitoring Zone (<= ${monitoringRadiusKm} km): ${monitoringMatches}`);
  }
}

main().catch(console.error).finally(async () => {
  await closeDbPool();
});
