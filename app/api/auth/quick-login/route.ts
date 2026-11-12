import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { isQuickLoginPermitted } from "@/lib/environment-policy";
import { getDbPool } from "@/lib/db";
import { 
  createDeviceSession, 
  revokeSessionByRefreshToken, 
  revokeAllUserSessions 
} from "@/lib/session-service";
import {
  ACCESS_TOKEN_COOKIE,
  REFRESH_TOKEN_COOKIE,
  getAccessTokenCookieOptions,
  getRefreshTokenCookieOptions,
} from "@/lib/session-config";
import { getSessionUser } from "@/lib/auth";

interface QuickLoginPayload {
  role: string;
  branch?: string;
}

interface RoleDefinition {
  systemRole: "ADMIN" | "USER";
  businessRole: string | null;
  scope: "HO" | "BRANCH";
  branch: string;
  name: string;
  nik: string;
  email: string;
}

const SUPPORTED_BRANCHES = ["BANDUNG", "CIKOKOL"];

export async function POST(req: Request) {
  // 1. Strict server-side policy check (Fail-closed)
  const permission = isQuickLoginPermitted(req);
  if (!permission.allowed) {
    return NextResponse.json(
      {
        error: "QUICK_LOGIN_FORBIDDEN",
        message: permission.reason || "Quick Login tidak diizinkan di lingkungan ini.",
      },
      { status: 403 }
    );
  }

  try {
    const body: QuickLoginPayload = await req.json().catch(() => ({ role: "" }));
    const rawRole = (body.role || "").trim().toLowerCase();
    const branchCandidate = (body.branch || "BANDUNG").trim().toUpperCase();
    const branch = SUPPORTED_BRANCHES.includes(branchCandidate) ? branchCandidate : "BANDUNG";
    const branchCode = branch === "CIKOKOL" ? "CKL" : "BDG";

    // 2. Map requested role to verified specification
    let def: RoleDefinition;

    switch (rawRole) {
      case "sysadmin":
      case "system_admin":
      case "system_administrator":
        def = {
          systemRole: "ADMIN",
          businessRole: null,
          scope: "HO",
          branch: "HEAD OFFICE",
          name: "Dev System Administrator",
          nik: "DEV_ADM01",
          email: "dev.sysadmin@sparta-siaga.local",
        };
        break;

      case "admin":
      case "ho_admin":
      case "admin_ho":
        def = {
          systemRole: "USER",
          businessRole: "admin",
          scope: "HO",
          branch: "HEAD OFFICE",
          name: "Dev Admin HO",
          nik: "DEV_HO01",
          email: "dev.ho.admin@sparta-siaga.local",
        };
        break;

      case "bm":
      case "bnm":
      case "bnm_manajer":
        def = {
          systemRole: "USER",
          businessRole: "bm",
          scope: "BRANCH",
          branch,
          name: `Dev BnM Manajer (${branch})`,
          nik: `DEV_BM_${branchCode}`,
          email: `dev.bm.${branch.toLowerCase()}@sparta-siaga.local`,
        };
        break;

      case "bmc":
        def = {
          systemRole: "USER",
          businessRole: "bmc",
          scope: "BRANCH",
          branch,
          name: `Dev BMC (${branch})`,
          nik: `DEV_BMC_${branchCode}`,
          email: `dev.bmc.${branch.toLowerCase()}@sparta-siaga.local`,
        };
        break;

      case "bec":
        def = {
          systemRole: "USER",
          businessRole: "bec",
          scope: "BRANCH",
          branch,
          name: `Dev BEC (${branch})`,
          nik: `DEV_BEC_${branchCode}`,
          email: `dev.bec.${branch.toLowerCase()}@sparta-siaga.local`,
        };
        break;

      case "bbc":
        def = {
          systemRole: "USER",
          businessRole: "bbc",
          scope: "BRANCH",
          branch,
          name: `Dev BBC (${branch})`,
          nik: `DEV_BBC_${branchCode}`,
          email: `dev.bbc.${branch.toLowerCase()}@sparta-siaga.local`,
        };
        break;

      case "bms":
        def = {
          systemRole: "USER",
          businessRole: "bms",
          scope: "BRANCH",
          branch,
          name: `Dev BMS (${branch})`,
          nik: `DEV_BMS_${branchCode}`,
          email: `dev.bms.${branch.toLowerCase()}@sparta-siaga.local`,
        };
        break;

      case "bes":
        def = {
          systemRole: "USER",
          businessRole: "bes",
          scope: "BRANCH",
          branch,
          name: `Dev BES (${branch})`,
          nik: `DEV_BES_${branchCode}`,
          email: `dev.bes.${branch.toLowerCase()}@sparta-siaga.local`,
        };
        break;

      case "bbs":
        def = {
          systemRole: "USER",
          businessRole: "bbs",
          scope: "BRANCH",
          branch,
          name: `Dev BBS (${branch})`,
          nik: `DEV_BBS_${branchCode}`,
          email: `dev.bbs.${branch.toLowerCase()}@sparta-siaga.local`,
        };
        break;

      default:
        return NextResponse.json(
          {
            error: "INVALID_ROLE",
            message: `Role '${body.role}' tidak dikenali. Pilih salah satu dari 9 role resmi SIAGA.`,
          },
          { status: 400 }
        );
    }

    const pool = getDbPool();
    const userId = `usr_${def.nik.toLowerCase()}`;

    // 3. Upsert synthetic developer user record into database
    await pool.query(
      `INSERT INTO users (
        id, nik, name, email, system_role, business_role, scope, branch, status, source, sso_status, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'ACTIVE', 'DEVELOPMENT', NULL, NOW(), NOW())
      ON CONFLICT (id) DO UPDATE SET
        nik = EXCLUDED.nik,
        name = EXCLUDED.name,
        email = EXCLUDED.email,
        system_role = EXCLUDED.system_role,
        business_role = EXCLUDED.business_role,
        scope = EXCLUDED.scope,
        branch = EXCLUDED.branch,
        status = 'ACTIVE',
        source = 'DEVELOPMENT',
        sso_status = NULL,
        updated_at = NOW()`,
      [
        userId,
        def.nik,
        def.name,
        def.email,
        def.systemRole,
        def.businessRole,
        def.scope,
        def.branch,
      ]
    );

    // 4. Revoke previous session if currently authenticated to cleanly switch privileges
    const existingSession = await getSessionUser(req);
    if (existingSession && existingSession.id) {
      await revokeAllUserSessions(existingSession.id).catch(() => undefined);
    }
    const cookieHeader = req.headers.get("cookie") || "";
    const refreshMatch = cookieHeader.match(/siaga_refresh=([^;]+)/);
    if (refreshMatch && refreshMatch[1]) {
      await revokeSessionByRefreshToken(refreshMatch[1]).catch(() => undefined);
    }

    // 5. Create fresh device session
    const userAgent = req.headers.get("user-agent") || null;
    const ipAddress = req.headers.get("x-forwarded-for") || null;

    const sessionResult = await createDeviceSession({
      userId,
      userAgent,
      ipAddress,
    });

    if (!sessionResult) {
      return NextResponse.json(
        { error: "SESSION_FAILED", message: "Gagal membuat sesi login developer." },
        { status: 500 }
      );
    }

    // 6. Set secure cookies and respond
    const response = NextResponse.json({
      success: true,
      redirectTo: "/",
      user: {
        id: userId,
        nik: def.nik,
        name: def.name,
        role: def.businessRole,
        systemRole: def.systemRole,
        scope: def.scope,
        branch: def.branch,
      },
    });

    response.cookies.set(
      ACCESS_TOKEN_COOKIE,
      sessionResult.accessToken,
      getAccessTokenCookieOptions()
    );
    response.cookies.set(
      REFRESH_TOKEN_COOKIE,
      sessionResult.refreshToken,
      getRefreshTokenCookieOptions()
    );

    try {
      const cookieStore = await cookies();
      cookieStore.set(
        ACCESS_TOKEN_COOKIE,
        sessionResult.accessToken,
        getAccessTokenCookieOptions()
      );
      cookieStore.set(
        REFRESH_TOKEN_COOKIE,
        sessionResult.refreshToken,
        getRefreshTokenCookieOptions()
      );
    } catch {
      // Ignored outside async storage context
    }

    return response;
  } catch (error) {
    console.error("[Quick Login] Unexpected error:", error);
    return NextResponse.json(
      { error: "SERVER_ERROR", message: "Terjadi kesalahan internal server." },
      { status: 500 }
    );
  }
}

