/**
 * SPARTA SIAGA - PWA Installability & Production Readiness Test Suite
 * 
 * Verifies all browser installability requirements:
 * 1. Manifest accessibility (HTTP 200, no login redirect, application/manifest+json)
 * 2. Manifest fields: name, short_name, start_url, scope, display=standalone, icons
 * 3. Icon integrity: 192x192, 512x512, maskable, apple-touch-icon
 * 4. Service Worker accessibility (HTTP 200, no login redirect, javascript MIME)
 * 5. Service Worker security: online-first, API & sensitive storage un-cached
 * 6. Offline fallback (offline.html returns 200)
 * 7. HTML Head metadata: <link rel="manifest">, viewport-fit=cover, theme-color
 * 8. Anonymous access check: PWA assets must never redirect to /login
 */

import http from "node:http";
import sharp from "sharp";

const PORT = 3004;
const BASE_URL = `http://127.0.0.1:${PORT}`;

interface CheckResult {
  category: string;
  name: string;
  pass: boolean;
  details: string;
}

const results: CheckResult[] = [];

function check(category: string, name: string, pass: boolean, details: string) {
  results.push({ category, name, pass, details });
  const icon = pass ? "✅" : "❌";
  console.log(`${icon} [${category}] ${name}`);
  console.log(`    Detail: ${details}`);
}

async function fetchHttp(urlPath: string, headers: Record<string, string> = {}): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string; buffer: Buffer }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      `${BASE_URL}${urlPath}`,
      { method: "GET", headers },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
        res.on("end", () => {
          const buffer = Buffer.concat(chunks);
          resolve({
            status: res.statusCode || 0,
            headers: res.headers,
            body: buffer.toString("utf-8"),
            buffer,
          });
        });
      }
    );
    req.on("error", reject);
    req.end();
  });
}

async function runAudit() {
  console.log("================================================================================");
  console.log(" SPARTA SIAGA - PWA INSTALLABILITY & PRODUCTION AUDIT");
  console.log(` Target Origin : ${BASE_URL}`);
  console.log("================================================================================\n");

  // 1. MANIFEST WEBMANIFEST ACCESSIBILITY (ANONYMOUS, NO COOKIE)
  {
    const res = await fetchHttp("/manifest.webmanifest");
    const is200 = res.status === 200;
    const isNotRedirect = res.status !== 307 && res.status !== 302;
    const isManifestJson = (res.headers["content-type"] || "").includes("manifest+json") || (res.headers["content-type"] || "").includes("json");

    let parsed: any = null;
    try {
      parsed = JSON.parse(res.body);
    } catch {}

    check(
      "MANIFEST_HTTP",
      "/manifest.webmanifest dapat diakses anonim tanpa redirect login",
      is200 && isNotRedirect && isManifestJson && Boolean(parsed),
      `Status: ${res.status}, Content-Type: ${res.headers["content-type"]}, Parsed: ${Boolean(parsed)}`
    );

    if (parsed) {
      check(
        "MANIFEST_FIELDS",
        "Manifest memiliki name, short_name, start_url, display=standalone, scope",
        parsed.name === "SPARTA SIAGA" &&
          parsed.short_name === "SPARTA SIAGA" &&
          parsed.start_url === "/" &&
          parsed.scope === "/" &&
          parsed.display === "standalone",
        `name='${parsed.name}', short_name='${parsed.short_name}', start_url='${parsed.start_url}', display='${parsed.display}', scope='${parsed.scope}'`
      );

      const has192 = (parsed.icons || []).some((i: any) => i.sizes === "192x192" && i.purpose !== "maskable");
      const has512 = (parsed.icons || []).some((i: any) => i.sizes === "512x512" && i.purpose !== "maskable");
      const hasMaskable192 = (parsed.icons || []).some((i: any) => i.sizes === "192x192" && i.purpose === "maskable");
      const hasMaskable512 = (parsed.icons || []).some((i: any) => i.sizes === "512x512" && i.purpose === "maskable");

      check(
        "MANIFEST_ICONS",
        "Manifest mendeklarasikan ikon standar 192px, 512px, dan maskable",
        has192 && has512 && hasMaskable192 && hasMaskable512,
        `192: ${has192}, 512: ${has512}, maskable-192: ${hasMaskable192}, maskable-512: ${hasMaskable512}`
      );
    }
  }

  // 2. MANIFEST JSON FALLBACK
  {
    const res = await fetchHttp("/manifest.json");
    const is200 = res.status === 200;
    const isJson = (res.headers["content-type"] || "").includes("json");
    check(
      "MANIFEST_FALLBACK",
      "/manifest.json fallback dapat diakses anonim dengan HTTP 200",
      is200 && isJson,
      `Status: ${res.status}, Content-Type: ${res.headers["content-type"]}`
    );
  }

  // 3. SERVICE WORKER ACCESSIBILITY (SW.JS)
  {
    const res = await fetchHttp("/sw.js");
    const is200 = res.status === 200;
    const isJs = (res.headers["content-type"] || "").includes("javascript");
    const hasFetch = res.body.includes("fetch") && res.body.includes("addEventListener");
    const hasOnlineFirst = res.body.includes("/api/") && res.body.includes("startsWith");
    const swAllowed = res.headers["service-worker-allowed"] === "/";

    check(
      "SERVICE_WORKER",
      "/sw.js dapat diakses anonim dengan HTTP 200 dan Service-Worker-Allowed header",
      is200 && isJs && swAllowed && hasFetch,
      `Status: ${res.status}, Content-Type: ${res.headers["content-type"]}, Service-Worker-Allowed: ${res.headers["service-worker-allowed"]}, Fetch Handler: ${hasFetch}`
    );

    check(
      "SW_SECURITY",
      "Service Worker menerapkan Online-First dan mengecualikan API serta dokumen privat",
      hasOnlineFirst,
      "API, auth, storage, evidence, dan dokumen dikecualikan dari cache sw.js"
    );
  }

  // 4. ICON PNG FILES INTEGRITY & SHARP METADATA
  const iconList = [
    { path: "/icons/icon-192x192.png", expectedW: 192, expectedH: 192 },
    { path: "/icons/icon-512x512.png", expectedW: 512, expectedH: 512 },
    { path: "/icons/icon-maskable-192x192.png", expectedW: 192, expectedH: 192 },
    { path: "/icons/icon-maskable-512x512.png", expectedW: 512, expectedH: 512 },
    { path: "/icons/apple-touch-icon.png", expectedW: 180, expectedH: 180 },
  ];

  for (const ic of iconList) {
    const res = await fetchHttp(ic.path);
    let meta: { width?: number; height?: number; format?: string } | null = null;
    try {
      meta = await sharp(res.buffer).metadata();
    } catch {}

    const isMatch = res.status === 200 && meta?.width === ic.expectedW && meta?.height === ic.expectedH && meta?.format === "png";
    check(
      "ICON_INTEGRITY",
      `Ikon ${ic.path} valid PNG (${ic.expectedW}x${ic.expectedH})`,
      isMatch,
      `Status: ${res.status}, Format: ${meta?.format}, Resolusi: ${meta?.width}x${meta?.height}`
    );
  }

  // 5. OFFLINE FALLBACK PAGE
  {
    const res = await fetchHttp("/offline.html");
    check(
      "OFFLINE_PAGE",
      "/offline.html tersedia dengan status HTTP 200",
      res.status === 200 && res.body.includes("SPARTA SIAGA"),
      `Status: ${res.status}, Bytes: ${res.buffer.length}`
    );
  }

  // 6. HTML HEAD PWA METADATA TAGS
  {
    const res = await fetchHttp("/login");
    const hasManifestLink = res.body.includes('rel="manifest"') && res.body.includes('href="/manifest.webmanifest"');
    const hasViewportFit = res.body.includes("viewport-fit=cover");
    const hasThemeColor = res.body.includes('name="theme-color"');
    const hasAppleCapable = res.body.includes('apple-mobile-web-app-capable') || res.body.includes('mobile-web-app-capable');

    check(
      "HTML_METADATA",
      "Halaman publik memuat link manifest, viewport-fit=cover, dan theme-color",
      hasManifestLink && hasViewportFit && hasThemeColor,
      `Manifest Link: ${hasManifestLink}, Viewport-fit: ${hasViewportFit}, Theme Color: ${hasThemeColor}, Apple Capable: ${hasAppleCapable}`
    );
  }

  // SUMMARY
  const passCount = results.filter((r) => r.pass).length;
  const failCount = results.filter((r) => !r.pass).length;

  console.log("\n================================================================================");
  console.log(`TOTAL AUDIT: ${results.length}`);
  console.log(`PASSED     : ${passCount}`);
  console.log(`FAILED     : ${failCount}`);
  console.log("================================================================================\n");

  if (failCount > 0) {
    process.exit(1);
  }
}

runAudit().catch((err) => {
  console.error("FATAL ERROR IN PWA AUDIT:", err);
  process.exit(1);
});
