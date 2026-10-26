import { dbCreateIncident, dbFindAutoEarthquakeReport } from "../lib/incident-db";
import { getDbPool } from "../lib/db";
import { assertIsolatedDatabase } from "../lib/database-safety";

async function main() {
  const pool = getDbPool();
  await assertIsolatedDatabase(pool);

  const inc: any = {
    id: "INC-TEST-" + Date.now(),
    date: new Date().toISOString(),
    disasterType: "earthquake",
    reportOrigin: "automatic_earthquake",
    earthquakeEventId: "EQ-TEST-001",
    storeId: "T001",
    storeName: "Test Store",
    branch: "Test Branch",
    locationCity: "Test City",
    status: "investigating",
    progress: 10,
    timeline: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  try {
    console.log("Inserting first incident...");
    const res1 = await dbCreateIncident(inc);
    console.log("Success 1:", res1.id);

    console.log("Inserting second incident (duplicate)...");
    const inc2 = { ...inc, id: "INC-TEST-" + (Date.now() + 1) };
    const res2 = await dbCreateIncident(inc2);
    console.log("Success 2 (caught and returned existing):", res2.id);
    
    if (res1.id === res2.id) {
      console.log("Test passed: Graceful duplicate handling works.");
      process.exit(0);
    } else {
      console.error("Test failed: IDs are different");
      process.exit(1);
    }
  } catch (error) {
    console.error("Test failed with error:", error);
    process.exit(1);
  }
}
main();
