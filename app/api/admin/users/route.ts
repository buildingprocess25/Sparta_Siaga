import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { dbGetAllUsers } from "@/lib/user-db";
import { getDbPool } from "@/lib/db";
import { getSpartaPortalUserManagementUrl, isPortalManagedUser } from "@/lib/sparta-identity";

export async function GET(request?: Request) {
  try {
    const sessionUser = await getSessionUser(request);
    
    if (!sessionUser || sessionUser.systemRole !== "ADMIN") {
      return NextResponse.json(
        { error: "Forbidden: Hanya System Administrator yang dapat mengakses manajemen user." },
        { status: 403 }
      );
    }

    const [users, overridesRes] = await Promise.all([
      dbGetAllUsers(),
      getDbPool().query(
        `SELECT user_id, permission_key, effect, scope_type, branch_code, reason, expires_at
         FROM user_permission_overrides
         WHERE revoked_at IS NULL AND (expires_at IS NULL OR expires_at > NOW())`
      ),
    ]);

    const overridesMap = new Map<string, Array<{ key: string; effect: string; reason: string }>>();
    for (const row of overridesRes.rows) {
      if (!overridesMap.has(row.user_id)) {
        overridesMap.set(row.user_id, []);
      }
      overridesMap.get(row.user_id)!.push({
        key: row.permission_key,
        effect: row.effect,
        reason: row.reason || "",
      });
    }

    const HO_INSTRUCTION_ROLES = ["admin", "ho_admin", "gm_ho", "sm_ho"];

    // Enrich users with honest SSO integration status (never equating local provisioning state to live Portal verification)
    const safeUsers = users.map(({ passwordHash, ...u }) => {
      const isSystemAdmin = u.systemRole === "ADMIN";
      const userOverrides = overridesMap.get(u.id) || [];
      const micDeny = userOverrides.some(
        (o) => o.key === "MANAGEMENT_INSTRUCTION_CREATE" && o.effect === "DENY"
      );
      const micAllow = userOverrides.some(
        (o) => o.key === "MANAGEMENT_INSTRUCTION_CREATE" && o.effect === "ALLOW"
      );

      let hasManagementInstruction = false;
      if (isSystemAdmin) {
        hasManagementInstruction = true;
      } else if (u.scope === "HO") {
        if (micDeny) {
          hasManagementInstruction = false;
        } else if (micAllow) {
          hasManagementInstruction = true;
        } else {
          hasManagementInstruction = HO_INSTRUCTION_ROLES.includes((u.businessRole || "").toLowerCase());
        }
      }

      let classification: "SYSTEM_ADMIN" | "HO_MANAGEMENT" | "HO_MONITORING" | "BRANCH_USER" | "OTHER" = "OTHER";
      if (isSystemAdmin) {
        classification = "SYSTEM_ADMIN";
      } else if (u.scope === "HO") {
        classification = hasManagementInstruction ? "HO_MANAGEMENT" : "HO_MONITORING";
      } else if (u.scope === "BRANCH") {
        classification = "BRANCH_USER";
      }

      const ssoConnected = isPortalManagedUser(u);

      let ssoGrantStatus: "ACTIVE" | "REVOKED" | "NO_GRANT" | "UNVERIFIED" | "LOCAL" = "UNVERIFIED";
      let ssoGrantStatusLabel = "Belum Diverifikasi";
      const lastVerifiedAt: string | null = null;
      let ssoGrantError: string | null = null;

      if (u.source === "LOCAL" || u.source === "DEVELOPMENT") {
        ssoGrantStatus = "LOCAL";
        ssoGrantStatusLabel = u.source === "DEVELOPMENT" ? "Akun Development" : "Akun Lokal";
      } else {
        ssoGrantStatus = "UNVERIFIED";
        ssoGrantStatusLabel = "Belum Diverifikasi (Tidak Ada Endpoint Cek Live Portal)";
        ssoGrantError = "Status akses Portal terkini hanya terverifikasi saat login SSO (/v1/sso/exchange). Status provisioning lokal di SIAGA tidak dijadikan bukti akses Portal terkini.";
      }

      return {
        ...u,
        isSystemAdmin,
        portalManaged: ssoConnected,
        hasManagementInstruction,
        classification,
        ssoConnected,
        ssoGrantStatus,
        ssoGrantStatusLabel,
        ssoGrantError,
        lastVerifiedAt,
        localProvisioningStatus: u.ssoStatus || null,
        lastProvisionedAt: u.lastProvisionedAt || null,
        activeOverrides: userOverrides,
      };
    });

    return NextResponse.json({
      data: safeUsers,
      meta: {
        centralizedInPortal: true,
        portalUserManagementUrl: getSpartaPortalUserManagementUrl(),
      },
    });
  } catch (error) {
    console.error("[GET /api/admin/users]", error);
    return NextResponse.json({ error: "Gagal memuat daftar user" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const sessionUser = await getSessionUser(request);

    if (!sessionUser || sessionUser.systemRole !== "ADMIN") {
      return NextResponse.json(
        { error: "Forbidden: Hanya System Administrator yang dapat mengakses manajemen user." },
        { status: 403 }
      );
    }

    return NextResponse.json(
      {
        error:
          "Pembuatan pengguna baru dikelola terpusat melalui Portal SPARTA. Tambahkan pengguna dan berikan akses modul SIAGA di Portal SPARTA agar otomatis tersinkronisasi ke SIAGA.",
        code: "PORTAL_USER_MANAGEMENT_REQUIRED",
        portalUserManagementUrl: getSpartaPortalUserManagementUrl(),
      },
      { status: 403 }
    );
  } catch (error) {
    console.error("[POST /api/admin/users]", error);
    return NextResponse.json({ error: "Gagal memproses permintaan manajemen user" }, { status: 500 });
  }
}
