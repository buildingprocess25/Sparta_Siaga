import os from "os";

function getNetworkAddresses() {
  const interfaces = os.networkInterfaces();
  const addresses: string[] = [];
  for (const name of Object.keys(interfaces)) {
    for (const net of interfaces[name] || []) {
      if (net.family === "IPv4" && !net.internal) {
        addresses.push(net.address);
      }
    }
  }
  return addresses;
}

console.log("==================================================================");
console.log("SPARTA SIAGA — Panduan Akses Development (Laptop, LAN & Tunnel)");
console.log("==================================================================");
console.log("");
console.log("1. AKSES LOKAL (Laptop / PC):");
console.log("   - Mode Isolated (Aiven 1GB):   pnpm dev  (atau pnpm dev:local)");
console.log("   - Mode Prod Read-Only:         pnpm dev:prod-readonly  (khusus loopback 127.0.0.1 + wajib DEV_GATE_PASSCODE)");
console.log("   - URL:                         http://localhost:3004");
console.log("");
console.log("2. AKSES JARINGAN WIFI / LAN LOKAL (Khusus Mode Isolated; DILARANG pada Prod Read-Only):");
const ips = getNetworkAddresses();
if (ips.length > 0) {
  ips.forEach((ip) => {
    console.log(`   URL: http://${ip}:3004`);
  });
} else {
  console.log("   URL: http://<IP_LAPTOP>:3004");
}
console.log("");
console.log("3. AKSES HTTPS TUNNEL PUBLIK (Khusus Mode Isolated; DIBLOKIR total pada Mode Prod Read-Only):");
console.log("   Opsi A (localtunnel):");
console.log("      pnpm run tunnel:dev");
console.log("      atau: pnpm dlx localtunnel --port 3004");
console.log("");
console.log("   Opsi B (cloudflared / Cloudflare Tunnel):");
console.log("      cloudflared tunnel --url http://localhost:3004");
console.log("");
console.log("   Opsi C (ngrok):");
console.log("      ngrok http 3004");
console.log("");
console.log("==================================================================");
