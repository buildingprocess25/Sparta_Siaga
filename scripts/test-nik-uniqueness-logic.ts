import { getIsolatedDbPool, closeDbPool } from "../lib/db";
import { dbGetUserByNik, dbCreateUser, dbAdminUpdateUser } from "../lib/user-db";

async function runTests() {
  console.log("================================================================================");
  console.log(" TESTING APPLICATION-LEVEL NIK UNIQUENESS & CASE-INSENSITIVITY");
  console.log("================================================================================\n");

  const pool = getIsolatedDbPool();

  try {
    // 1. Test case-insensitive lookup
    console.log("Test 1: Case-insensitive dbGetUserByNik");
    const u1 = await dbGetUserByNik("adm0001");
    const u2 = await dbGetUserByNik("ADM0001");
    const u3 = await dbGetUserByNik("  Adm0001  ");

    console.log(`  - adm0001: found=${Boolean(u1)}, id=${u1?.id}`);
    console.log(`  - ADM0001: found=${Boolean(u2)}, id=${u2?.id}`);
    console.log(`  -   Adm0001  : found=${Boolean(u3)}, id=${u3?.id}`);

    if (!u1 || !u2 || !u3) {
      throw new Error("FAIL: dbGetUserByNik failed case-insensitive match");
    }
    console.log("✔ Test 1 PASS\n");

    // 2. Test duplicate creation rejection
    console.log("Test 2: dbCreateUser duplicate NIK rejection");
    let caughtCreate = false;
    try {
      await dbCreateUser({
        id: "test_duplicate_nik_usr",
        nik: "adm0001", // lowercase of existing
        name: "Test Duplicate",
        businessRole: "bms",
        systemRole: "USER",
        scope: "BRANCH",
        branch: "BANDUNG",
      });
    } catch (err: any) {
      caughtCreate = true;
      console.log(`  - Correctly rejected with: "${err.message}"`);
    }
    if (!caughtCreate) {
      throw new Error("FAIL: dbCreateUser allowed duplicate NIK!");
    }
    console.log("✔ Test 2 PASS\n");

    // 3. Test duplicate update rejection
    console.log("Test 3: dbAdminUpdateUser duplicate NIK rejection");
    let caughtUpdate = false;
    try {
      // Try to update usr_ho_admin_02 with NIK "adm0001"
      await dbAdminUpdateUser("usr_ho_admin_02", {
        nik: "adm0001",
      });
    } catch (err: any) {
      caughtUpdate = true;
      console.log(`  - Correctly rejected with: "${err.message}"`);
    }
    if (!caughtUpdate) {
      throw new Error("FAIL: dbAdminUpdateUser allowed duplicate NIK!");
    }
    console.log("✔ Test 3 PASS\n");

    console.log("ALL APPLICATION-LEVEL NIK UNIQUENESS TESTS PASSED!");
  } finally {
    await closeDbPool();
  }
}

runTests().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});

