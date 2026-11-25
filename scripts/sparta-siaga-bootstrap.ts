import path from "node:path";
import { pathToFileURL } from "node:url";
import { CANONICAL_HUMAN_ROLES } from "../lib/role-catalog";
import { initialProvisioningRole } from "../lib/sparta-provisioning";

type PortalUser = {
  id: string;
  status: string;
  modules: Array<{ moduleId: string; role: string; isActive: boolean }>;
};

type PortalDatabase = {
  appModule: {
    findUnique(args: unknown): Promise<{ isActive: boolean; provisioningUrl: string | null } | null>;
    update(args: unknown): Promise<unknown>;
  };
  moduleRole: { upsert(args: unknown): Promise<unknown> };
  $transaction<T>(work: (tx: PortalDatabase) => Promise<T>, options: { timeout: number }): Promise<T>;
  $disconnect(): Promise<void>;
};

export function planSiagaReplay(users: PortalUser[]) {
  const events: Array<{ userId: string; type: "access.granted" | "access.revoked" | "user.deactivated" }> = [];
  const invalid: Array<{ userId: string; role: string }> = [];
  for (const user of users) {
    const access = user.modules.find(module => module.moduleId === "siaga");
    if (!access) { events.push({ userId: user.id, type: "access.revoked" }); continue; }
    if (user.status !== "ACTIVE") events.push({ userId: user.id, type: "user.deactivated" });
    else if (!access.isActive) events.push({ userId: user.id, type: "access.revoked" });
    else {
      try { initialProvisioningRole(access.role); events.push({ userId: user.id, type: "access.granted" }); }
      catch { invalid.push({ userId: user.id, role: access.role }); }
    }
  }
  return { events, invalid };
}

async function main() {
  const portalRoot = path.resolve(process.env.SPARTA_PORTAL_REPO || path.join(process.cwd(), "..", "login-sparta"));
  const source = (file: string) => pathToFileURL(path.join(portalRoot, "apps/api/src", file)).href;
  let prisma: PortalDatabase | undefined;
  try {
    const apply = process.argv.includes("--apply");
    const { prisma: portalDb } = await import(source("db/prisma.ts"));
    const db = portalDb as PortalDatabase;
    prisma = db;
    const { PrismaUsersRepository } = await import(source("modules/users/users.repository.ts"));
    const { PrismaProvisioningRepository } = await import(source("modules/provisioning/provisioning.repository.ts"));
    const { ProvisioningService } = await import(source("modules/provisioning/provisioning.service.ts"));
    const module = await db.appModule.findUnique({ where: { id: "SIAGA" } });
    if (!module?.isActive) throw new Error("PORTAL_SIAGA_MODULE_NOT_ACTIVE");
    const explicitUrl = process.argv.find(arg => arg.startsWith("--receiver-url="))?.slice("--receiver-url=".length);
    const receiverUrl = explicitUrl || module.provisioningUrl || "https://siaga.sparta-alfamart.web.id/internal/sparta/provision";
    const url = new URL(receiverUrl);
    if ((url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname))) ||
      url.pathname !== "/internal/sparta/provision" || url.username || url.password || url.search || url.hash) {
      throw new Error("INVALID_SIAGA_RECEIVER_URL");
    }
    if (apply && (process.env.SPARTA_PROVISIONING_SECRET_SIAGA || "").length < 32) throw new Error("PORTAL_SIAGA_SECRET_NOT_CONFIGURED");
    if (apply && process.env.SPARTA_PROVISIONING_WORKER_ENABLED !== "true") throw new Error("PORTAL_PROVISIONING_WORKER_NOT_ENABLED");
    const repository = new PrismaUsersRepository(db);
    const users = await repository.listUsers();
    const plan = planSiagaReplay(users);
    const summary = { mode: apply ? "apply" : "preview", receiverUrl,
      totalPortalUsers: users.length, siagaEvents: plan.events.length,
      granted: plan.events.filter(e => e.type === "access.granted").length,
      revoked: plan.events.filter(e => e.type === "access.revoked").length,
      deactivated: plan.events.filter(e => e.type === "user.deactivated").length,
      invalidRoles: plan.invalid };
    if (!apply) { console.log(JSON.stringify(summary, null, 2)); return; }
    if (plan.invalid.length) throw new Error("INVALID_SIAGA_ROLES_RUN_PREVIEW");
    await db.$transaction(async (tx: PortalDatabase) => {
      await tx.appModule.update({ where: { id: "SIAGA" }, data: { provisioningUrl: receiverUrl } });
      for (const role of CANONICAL_HUMAN_ROLES.filter(r => r.selectable)) {
        const code = role.key.toUpperCase();
        await tx.moduleRole.upsert({ where: { moduleId_code: { moduleId: "SIAGA", code } },
          create: { moduleId: "SIAGA", code, label: role.label, isActive: true, isModuleAdmin: role.key === "admin" },
          update: { label: role.label, isActive: true, isModuleAdmin: role.key === "admin" } });
      }
      const publisher = new ProvisioningService(new PrismaProvisioningRepository(tx));
      const currentUsers = new PrismaUsersRepository(tx);
      for (const entry of plan.events) {
        const user = await currentUsers.findUserById(entry.userId);
        if (!user) continue;
        const current = planSiagaReplay([user]);
        if (current.invalid.length) throw new Error("SIAGA_ROLE_CHANGED_DURING_REPLAY");
        const event = current.events[0];
        if (!event) continue;
        await publisher.publishAccessChange(user, "siaga", event.type === "user.deactivated" ? "access.revoked" : event.type);
      }
    }, { timeout: 120000 });
    console.log(JSON.stringify({ ...summary, delivery: "QUEUED_CHECK_PORTAL_DELIVERY_STATUS" }, null, 2));
  } catch (error) {
    const message = error instanceof Error ? error.message : "BOOTSTRAP_FAILED";
    console.error(JSON.stringify({ error: /^[A-Z_]+$/.test(message) ? message : "BOOTSTRAP_FAILED", code: (error as { code?: string }).code }));
    process.exitCode = 1;
  } finally { await prisma?.$disconnect(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await main();
