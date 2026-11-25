import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import {
  dbAdminUpdateUser,
  dbGetUserById,
} from "@/lib/user-db";
import {
  detectPortalIdentityFieldChanges,
  getSpartaPortalUserManagementUrl,
} from "@/lib/sparta-identity";
import bcrypt from "bcryptjs";

type RouteContext = { params: Promise<{ id: string }> };

function isProtectedAdminAccount(id: string, user: { systemRole: string; email?: string | null }) {
  return (
    user.systemRole === "ADMIN" ||
    id === "usr_seed_admin" ||
    id === "usr_sysadmin_01" ||
    user.email?.toLowerCase() === "siaga@admin.com"
  );
}

export async function PATCH(request: Request, { params }: RouteContext) {
  try {
    const sessionUser = await getSessionUser(request);
    
    if (!sessionUser || sessionUser.systemRole !== "ADMIN") {
      return NextResponse.json(
        { error: "Forbidden: Hanya System Administrator yang dapat mengubah data user." },
        { status: 403 }
      );
    }

    const { id } = await params;
    const body = await request.json();

    const existingUser = await dbGetUserById(id);
    if (!existingUser) {
      return NextResponse.json({ error: "User tidak ditemukan" }, { status: 404 });
    }

    if (id === sessionUser.id && body.status === "INACTIVE") {
      return NextResponse.json({ error: "Action Denied: Tidak dapat menonaktifkan diri sendiri." }, { status: 400 });
    }

    // 1. PROTEKSI SYSTEM ADMIN DARURAT (Zero Operational Bypass, Immutability, & Rotasi Password Lokal)
    if (isProtectedAdminAccount(id, existingUser)) {
      if (body.systemRole === "USER") {
        return NextResponse.json({ error: "Action Denied: Tidak dapat mencabut hak akses ADMIN dari antarmuka ini." }, { status: 400 });
      }
      if (body.businessRole !== undefined && body.businessRole !== null) {
        return NextResponse.json({ error: "Action Denied: System Admin tidak dapat diberikan Business Role." }, { status: 400 });
      }
      if (body.branch !== undefined && body.branch !== null) {
        return NextResponse.json({ error: "Action Denied: System Admin tidak dapat diberikan Cabang/Branch." }, { status: 400 });
      }
      if (body.scope !== undefined && body.scope !== null) {
        return NextResponse.json({ error: "Action Denied: System Admin tidak dapat diberikan Scope operasional." }, { status: 400 });
      }
      if (body.status === "INACTIVE") {
        return NextResponse.json({ error: "Action Denied: Akun System Administrator dilindungi dan tidak dapat dinonaktifkan." }, { status: 400 });
      }

      const changedIdentityFields = detectPortalIdentityFieldChanges(existingUser, body);
      if (changedIdentityFields.length > 0) {
        return NextResponse.json(
          {
            error: `Action Denied: Field identitas (${changedIdentityFields.join(", ")}) pada akun System Administrator tidak dapat diubah melalui antarmuka ini.`,
            code: "PROTECTED_SYSTEM_ADMIN",
          },
          { status: 400 }
        );
      }

      const hasPasswordInput = body.password !== undefined && body.password !== null && body.password !== "";
      if (!hasPasswordInput) {
        return NextResponse.json(
          {
            error: "Akun System Administrator darurat dilindungi; hanya rotasi password lokal yang diizinkan melalui antarmuka ini.",
            code: "PROTECTED_SYSTEM_ADMIN",
          },
          { status: 400 }
        );
      }

      if (existingUser.source !== "LOCAL") {
        return NextResponse.json(
          {
            error: "Action Denied: Password pengguna SSO dikelola terpusat di Portal Login Sparta dan tidak dapat diubah dari SIAGA.",
          },
          { status: 400 }
        );
      }

      if (typeof body.password !== "string" || body.password.length < 8) {
        return NextResponse.json({ error: "Password minimal 8 karakter." }, { status: 400 });
      }

      if (body.confirmPassword !== undefined && body.password !== body.confirmPassword) {
        return NextResponse.json({ error: "Konfirmasi password tidak sesuai." }, { status: 400 });
      }

      const passwordHash = await bcrypt.hash(body.password, 10);
      const updatedUser = await dbAdminUpdateUser(id, { passwordHash }, { revokeSessions: true });
      if (!updatedUser) {
        return NextResponse.json({ error: "User tidak ditemukan" }, { status: 404 });
      }

      const { passwordHash: _, ...safeUser } = updatedUser;
      return NextResponse.json({ data: safeUser });
    }

    // 2. PENGGUNA OPERASIONAL — TERPUSAT DI PORTAL SPARTA
    if (body.systemRole === "ADMIN") {
      return NextResponse.json({ error: "Action Denied: Tidak dapat meng-upgrade USER menjadi ADMIN dari antarmuka ini." }, { status: 400 });
    }

    if (body.password !== undefined && body.password !== null && body.password !== "" && existingUser.source !== "LOCAL") {
      return NextResponse.json(
        {
          error: "Action Denied: Password pengguna SSO dikelola terpusat di Portal Login Sparta dan tidak dapat diubah dari SIAGA.",
        },
        { status: 400 }
      );
    }

    return NextResponse.json(
      {
        error:
          "Pengelolaan akun pengguna (identitas, cabang, peran, status, dan akses modul) dipusatkan melalui Portal SPARTA. Gunakan tab Hak Akses Role atau Akses Khusus User untuk pengaturan permission internal SIAGA.",
        code: "PORTAL_USER_MANAGEMENT_REQUIRED",
        portalUserManagementUrl: getSpartaPortalUserManagementUrl(),
      },
      { status: 400 }
    );
  } catch (error) {
    console.error("[PATCH /api/admin/users/:id]", error);
    return NextResponse.json({ error: "Gagal memperbarui data user" }, { status: 500 });
  }
}

export async function DELETE(request: Request, { params }: RouteContext) {
  try {
    const sessionUser = await getSessionUser(request);
    
    if (!sessionUser || sessionUser.systemRole !== "ADMIN") {
      return NextResponse.json({ error: "Forbidden: Hanya System Administrator yang dapat menghapus user." }, { status: 403 });
    }

    const { id } = await params;

    if (id === sessionUser.id) {
      return NextResponse.json({ error: "Action Denied: Tidak dapat menghapus akun sendiri." }, { status: 400 });
    }

    const existingUser = await dbGetUserById(id);
    if (!existingUser) {
      return NextResponse.json({ error: "User tidak ditemukan" }, { status: 404 });
    }

    if (isProtectedAdminAccount(id, existingUser)) {
      return NextResponse.json({ error: "Action Denied: System ADMIN dilindungi dan tidak dapat dihapus." }, { status: 403 });
    }

    if (existingUser.source !== "LOCAL") {
      return NextResponse.json(
        {
          error: "Action Denied: Pengguna SSO tidak dapat dihapus dari SIAGA. Kredensial dan akun dikelola melalui Portal Login Sparta. Silakan cabut akses SIAGA melalui Portal SPARTA.",
          code: "PORTAL_USER_MANAGEMENT_REQUIRED",
          portalUserManagementUrl: getSpartaPortalUserManagementUrl(),
        },
        { status: 400 }
      );
    }

    return NextResponse.json(
      {
        error:
          "Penghapusan akun melalui SIAGA dinonaktifkan untuk menjaga histori operasional dan pemusatan manajemen user. Kelola penonaktifan atau pencabutan akses melalui Portal SPARTA.",
        code: "PORTAL_USER_MANAGEMENT_REQUIRED",
        portalUserManagementUrl: getSpartaPortalUserManagementUrl(),
      },
      { status: 400 }
    );
  } catch (error: unknown) {
    console.error("[DELETE /api/admin/users/:id]", error);
    const message = error instanceof Error ? error.message : "Gagal menghapus user";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
