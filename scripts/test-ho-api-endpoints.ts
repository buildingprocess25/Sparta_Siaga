import assert from "node:assert/strict";

const BASE_URL = "http://localhost:3004";

async function loginUser(identifier: string, password = "pass123"): Promise<string> {
  const res = await fetch(`${BASE_URL}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifier, password }),
  });
  if (!res.ok) {
    throw new Error(`Login failed for ${identifier}: ${res.status} ${await res.text()}`);
  }
  const cookieHeader = res.headers.get("set-cookie");
  if (!cookieHeader) throw new Error("No set-cookie returned");
  return cookieHeader.split(";")[0];
}

async function run() {
  console.log("==================================================================");
  console.log("  SPARTA SIAGA - HTTP API SECURITY & PERMISSION TESTS            ");
  console.log("==================================================================\n");

  const reportId = "LAP-EQ-DEMO-BDG-001";
  const photoKey = "wm_LAP-EQ-DEMO-BDG-001_1792054014408_fx98xg.jpg";

  // 1. Unauthenticated checks (must return 401)
  console.log("[1/4] Menguji Akses Tanpa Autentikasi (Harus 401)...");
  const unauthInitial = await fetch(`${BASE_URL}/api/incidents/${reportId}/export/initial-pdf`);
  assert.equal(unauthInitial.status, 401, "Initial PDF tanpa login harus 401");

  const unauthMonitoring = await fetch(`${BASE_URL}/api/incidents/${reportId}/export/monitoring-pdf`);
  assert.equal(unauthMonitoring.status, 401, "Monitoring PDF tanpa login harus 401");

  const unauthFinal = await fetch(`${BASE_URL}/api/incidents/${reportId}/export/final-pdf`);
  assert.equal(unauthFinal.status, 401, "Final PDF tanpa login harus 401");

  const unauthPhoto = await fetch(`${BASE_URL}/api/incidents/${reportId}/inspection/evidence/${photoKey}`);
  assert.equal(unauthPhoto.status, 401, "Evidence photo tanpa login harus 401");
  console.log("      ✓ Semua endpoint PDF & foto menolak request tanpa login (401)");

  // 2. HO User Tests (National Read-Only)
  console.log("\n[2/4] Menguji Akses Akun HO (ho / pass123)...");
  const hoCookie = await loginUser("ho", "pass123");
  console.log("      ✓ Login HO berhasil");

  // Initial PDF
  const hoInitial = await fetch(`${BASE_URL}/api/incidents/${reportId}/export/initial-pdf`, {
    headers: { Cookie: hoCookie },
  });
  assert.equal(hoInitial.status, 200, "HO harus bisa unduh Initial PDF");
  const hoInitialBuf = await hoInitial.arrayBuffer();
  assert.ok(hoInitialBuf.byteLength > 1000, "Initial PDF harus memiliki konten");
  console.log(`      ✓ Initial PDF berhasil diunduh HO (${hoInitialBuf.byteLength} bytes)`);

  // Monitoring PDF
  const hoMonitoring = await fetch(`${BASE_URL}/api/incidents/${reportId}/export/monitoring-pdf`, {
    headers: { Cookie: hoCookie },
  });
  assert.equal(hoMonitoring.status, 200, "HO harus bisa unduh Monitoring PDF");
  const hoMonitoringBuf = await hoMonitoring.arrayBuffer();
  assert.ok(hoMonitoringBuf.byteLength > 1000, "Monitoring PDF harus memiliki konten");
  console.log(`      ✓ Monitoring PDF berhasil diunduh HO (${hoMonitoringBuf.byteLength} bytes)`);

  // Final PDF (report status is confirmed_affected -> must be 422)
  const hoFinal = await fetch(`${BASE_URL}/api/incidents/${reportId}/export/final-pdf`, {
    headers: { Cookie: hoCookie },
  });
  assert.equal(hoFinal.status, 422, "Final PDF untuk laporan non-closed harus 422");
  const hoFinalJson = await hoFinal.json();
  assert.equal(hoFinalJson.code, "REPORT_NOT_CLOSED");
  console.log("      ✓ Final PDF ditolak dengan 422 REPORT_NOT_CLOSED (hanya closed/resolved)");

  // Evidence photo
  const hoPhoto = await fetch(`${BASE_URL}/api/incidents/${reportId}/inspection/evidence/${photoKey}`, {
    headers: { Cookie: hoCookie },
  });
  assert.equal(hoPhoto.status, 200, "HO harus bisa akses foto pemeriksaan");
  const hoPhotoBuf = await hoPhoto.arrayBuffer();
  assert.equal(hoPhotoBuf.byteLength, 66076, "Ukuran foto harus sesuai storage");
  console.log(`      ✓ Foto bukti berhasil diakses HO (${hoPhotoBuf.byteLength} bytes)`);

  // Read-only operational check: HO attempting to claim PIC must return 403
  const hoPicClaim = await fetch(`${BASE_URL}/api/incidents/${reportId}/pic`, {
    method: "POST",
    headers: { Cookie: hoCookie },
  });
  assert.equal(hoPicClaim.status, 403, "HO TIDAK boleh claim PIC (harus 403)");
  console.log("      ✓ HO ditolak 403 saat mencoba klaim PIC (strictly read-only)");

  // 3. Branch BMS User Tests
  console.log("\n[3/4] Menguji Akses Akun BMS Bandung (bms / pass123)...");
  const bmsCookie = await loginUser("bms", "pass123");
  console.log("      ✓ Login BMS Bandung berhasil");

  const bmsMonitoring = await fetch(`${BASE_URL}/api/incidents/${reportId}/export/monitoring-pdf`, {
    headers: { Cookie: bmsCookie },
  });
  assert.equal(bmsMonitoring.status, 200, "BMS Bandung harus bisa unduh Monitoring PDF cabang sendiri");
  console.log("      ✓ Monitoring PDF berhasil diunduh BMS Bandung");

  // 4. Security checks: Path traversal & unlinked photos
  console.log("\n[4/4] Menguji Proteksi Path Traversal & Unlinked Photo...");
  const traversal1 = await fetch(`${BASE_URL}/api/incidents/${reportId}/inspection/evidence/..%2Fsecret`, {
    headers: { Cookie: hoCookie },
  });
  assert.equal(traversal1.status, 400, "Path traversal dengan .. harus ditolak 400");

  const unlinked = await fetch(`${BASE_URL}/api/incidents/${reportId}/inspection/evidence/wm_unlinked_photo.jpg`, {
    headers: { Cookie: hoCookie },
  });
  assert.equal(unlinked.status, 404, "Foto tidak terhubung harus ditolak 404");
  console.log("      ✓ Path traversal ditolak 400, foto tidak terhubung ditolak 404");

  console.log("\n==================================================================");
  console.log("  SEMUA PENGUJIAN HTTP API & PERMISSIONS: 100% PASS!              ");
  console.log("==================================================================");
}

run().catch(err => {
  console.error("FAIL:", err);
  process.exit(1);
});
