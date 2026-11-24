import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { dbGetAllUsers, dbCreateUser, dbGetUserByNik } from "@/lib/user-db";
import { isValidHumanBusinessRole, deriveScopeFromBusinessRole } from "@/lib/role-catalog";
import { getDbPool } from "@/lib/db";
import { isPortalManagedUser } from "@/lib/sparta-identity";
import { branchMasterEnabled } from "@/lib/sparta-rollout";
import { resolveActivePortalBranch } from "@/lib/branch-service";
import bcrypt from "bcryptjs";

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

    return NextResponse.json({ data: safeUsers });
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
        { error: "Forbidden: Hanya System Administrator yang dapat menambah user." },
        { status: 403 }
      );
    }

    const body = await request.json();

    // 1. Validasi Nama
    if (!body.name || typeof body.name !== "string" || !body.name.trim()) {
      return NextResponse.json({ error: "Nama user wajib diisi." }, { status: 400 });
    }

    // 2. Proteksi System Role: User creation melalui UI / normal API HANYA boleh bertipe USER
    if (body.systemRole === "ADMIN") {
      return NextResponse.json(
        { error: "System ADMIN hanya dapat dikonfigurasi melalui ENV / script seed terproteksi." },
        { status: 400 }
      );
    }
    const systemRole = "USER";

    // 3. Validasi NIK: Wajib untuk akun lokal, harus unik & ditrim
    if (!body.nik || typeof body.nik !== "string" || !body.nik.trim()) {
      return NextResponse.json({ error: "NIK wajib diisi." }, { status: 400 });
    }
    const trimmedNik = body.nik.trim();
    const existingUserWithNik = await dbGetUserByNik(trimmedNik);
    if (existingUserWithNik) {
      return NextResponse.json({ error: "NIK sudah terdaftar pada pengguna lain." }, { status: 400 });
    }

    // 4. Validasi Business Role dari Katalog Kanonikal
    const businessRole = typeof body.businessRole === "string" ? body.businessRole.trim().toLowerCase() : "";
    if (!isValidHumanBusinessRole(businessRole)) {
      return NextResponse.json(
        { error: `Business Role '${body.businessRole}' tidak valid atau bukan peran persona pengguna yang dapat dipilih.` },
        { status: 400 }
      );
    }

    // 5. Otoritatif Server-Derived Scope & Branch
    const derivedScope = deriveScopeFromBusinessRole(businessRole);
    if (!derivedScope) {
      return NextResponse.json({ error: "Gagal menurunkan cakupan (scope) untuk role tersebut." }, { status: 400 });
    }

    // Jika client mengirim scope yang bertentangan dengan katalog kanonikal, tolak
    if (body.scope && body.scope !== derivedScope) {
      return NextResponse.json(
        { error: `Scope '${body.scope}' tidak sesuai dengan Business Role '${businessRole}'. Scope yang benar adalah '${derivedScope}'.` },
        { status: 400 }
      );
    }

    let finalBranch: string | null = null;
    let finalBranchCode: string | null = null;
    if (derivedScope === "HO") {
      // Role HO tidak boleh memiliki branch
      finalBranch = null;
      finalBranchCode = null;
    } else {
      // Role BRANCH wajib memiliki branch yang valid
      if (!body.branch || typeof body.branch !== "string" || !body.branch.trim()) {
        return NextResponse.json(
          { error: "Cabang wajib dipilih untuk role dengan cakupan BRANCH." },
          { status: 400 }
        );
      }
      if (branchMasterEnabled()) {
        const resolved = await resolveActivePortalBranch(body.branch.trim());
        if (!resolved) {
          return NextResponse.json(
            { error: "Cabang tidak ditemukan pada master cabang Portal SPARTA." },
            { status: 400 }
          );
        }
        finalBranch = resolved.name;
        finalBranchCode = resolved.code;
      } else {
        finalBranch = body.branch.trim();
      }
    }

    // 6. Validasi Password untuk akun LOCAL
    const source = body.source === "SSO" ? "SSO" : "LOCAL";
    let passwordHash: string | null = null;
    if (source === "LOCAL") {
      if (!body.password || typeof body.password !== "string" || !body.password.trim()) {
        return NextResponse.json({ error: "Password wajib diisi untuk pengguna lokal." }, { status: 400 });
      }

      if (body.password.length < 8) {
        return NextResponse.json({ error: "Password minimal 8 karakter." }, { status: 400 });
      }

      if (body.confirmPassword !== undefined && body.password !== body.confirmPassword) {
        return NextResponse.json({ error: "Konfirmasi password tidak sesuai." }, { status: 400 });
      }

      passwordHash = await bcrypt.hash(body.password, 10);
    }

    const id = `usr_local_${Date.now()}`;
    const newUser = await dbCreateUser({
      id,
      name: body.name.trim(),
      nik: trimmedNik,
      email: body.email && typeof body.email === "string" ? body.email.trim() : null,
      systemRole,
      businessRole,
      scope: derivedScope,
      branch: finalBranch,
      branchCode: finalBranchCode,
      status: body.status === "INACTIVE" ? "INACTIVE" : "ACTIVE",
      source,
      passwordHash,
    });

    // Never expose passwordHash in response
    const { passwordHash: _, ...safeUser } = newUser;
    return NextResponse.json({ data: safeUser }, { status: 201 });
  } catch (error) {
    console.error("[POST /api/admin/users]", error);
    return NextResponse.json({ error: "Gagal membuat user" }, { status: 500 });
  }
}
