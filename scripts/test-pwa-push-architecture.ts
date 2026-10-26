import fs from "fs";
import path from "path";

console.log("=== Testing PWA Push Architecture & Service Worker ===");

const swPath = path.join(process.cwd(), "public/sw.js");
const swContent = fs.readFileSync(swPath, "utf-8");

// 1. Check Push Event listener
if (!swContent.includes('self.addEventListener("push"') && !swContent.includes("self.addEventListener('push'")) {
  console.error("FAIL: push event listener missing from public/sw.js");
  process.exit(1);
}

// 2. Check Notification Click listener
if (!swContent.includes('self.addEventListener("notificationclick"') && !swContent.includes("self.addEventListener('notificationclick'")) {
  console.error("FAIL: notificationclick event listener missing from public/sw.js");
  process.exit(1);
}

// 3. Check Focus & Navigation
if (!swContent.includes("client.focus()") || !swContent.includes("targetUrl")) {
  console.error("FAIL: URL focus & navigation missing in notificationclick handler");
  process.exit(1);
}

// 4. Check push subscription route
const subRoutePath = path.join(process.cwd(), "app/api/notifications/push/subscribe/route.ts");
if (!fs.existsSync(subRoutePath)) {
  console.error("FAIL: app/api/notifications/push/subscribe/route.ts missing");
  process.exit(1);
}

const subRouteContent = fs.readFileSync(subRoutePath, "utf-8");
const webPushServiceContent = fs.readFileSync(path.join(process.cwd(), "lib/web-push-service.ts"), "utf-8");
if (!subRouteContent.includes("user_push_subscriptions") && !webPushServiceContent.includes("user_push_subscriptions")) {
  console.error("FAIL: user_push_subscriptions table not referenced in subscribe route or web-push-service");
  process.exit(1);
}

console.log("✔ PWA Push Service Worker & Subscription architecture verified successfully!");
