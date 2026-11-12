import { spawn } from "node:child_process";
import path from "node:path";

const targetEnv = (process.argv[2] || "development").trim().toLowerCase();
process.env.APP_ENV = targetEnv;
process.env.SPARTA_ENVIRONMENT = targetEnv;

console.log("==================================================================");
console.log(`SPARTA SIAGA — SERVER RUNNER [MODE: ${targetEnv.toUpperCase()}]`);
if (targetEnv === "development") {
  console.log("• Policy    : Quick Login AKTIF (Khusus loopback lokal)");
  console.log("• SSO       : Opsional");
  console.log("• URL Local : http://localhost:3004");
} else if (targetEnv === "uat" || targetEnv === "staging") {
  console.log("• Policy    : Wajib Autentikasi SSO Portal UAT");
  console.log("• SSO       : http://localhost:5173");
  console.log("• Callback  : http://localhost:3004/auth/sso/callback");
  console.log("• QuickLogin: DINONAKTIFKAN (Fail-closed)");
} else {
  console.log("• Policy    : PRODUCTION ENVIRONMENT (Fail-closed)");
}
console.log("==================================================================");

const nextBin = path.resolve(process.cwd(), "node_modules/next/dist/bin/next");
const child = spawn(
  process.execPath,
  ["--max-old-space-size=4096", nextBin, "dev", "-p", "3004", "--webpack"],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      APP_ENV: targetEnv,
      SPARTA_ENVIRONMENT: targetEnv,
    },
  }
);

child.on("exit", (code) => {
  process.exit(code ?? 0);
});

