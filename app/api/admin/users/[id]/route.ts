import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import {
  dbAdminUpdateUser,
  dbGetUserById,
  dbGetUserByNik,
  dbCheckUserDependencies,
  dbDeleteUser,
} from "@/lib/user-db";
import { isValidHumanBusinessRole, deriveScopeFromBusinessRole } from "@/lib/role-catalog";
import bcrypt from "bcryptjs";

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: RouteContext) {
  try {
    const sessionUser = await getSessionUser();
    
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

    // 1. Validasi & Proteksi NIK
    if (body.nik !== undefined) {
      if (!body.nik || typeof body.nik !== "string" || !body.nik.trim()) {
        return NextResponse.json({ error: "NIK tidak boleh kosong." }, { status: 400 });
      }
      body.nik = body.nik.trim();
      if (body.nik !== existingUser.nik) {
        const existingUserWithNik = await dbGetUserByNik(body.nik);
        if (existingUserWithNik && existingUserWithNik.id !== id) {
          return NextResponse.json({ error: "NIK sudah terdaftar oleh pengguna lain." }, { status: 400 });
        }
      }
    }

    // 2. Cegah menonaktifkan akun sendiri
    if (id === sessionUser.id && body.status === "INACTIVE") {
      return NextResponse.json({ error: "Action Denied: Tidak dapat menonaktifkan diri sendiri." }, { status: 400 });
    }

    // 3. PROTEKSI SYSTEM ADMIN (Zero Operational Bypass & Immutability)
    if (id === "usr_seed_admin" || existingUser.systemRole === "ADMIN") {
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

      body.systemRole = "ADMIN";
      body.businessRole = null;
      body.scope = null;
      body.branch = null;
    } else {
      // 4. ATURAN PENGGUNA NORMAL (USER)
      if (body.systemRole === "ADMIN") {
        return NextResponse.json({ error: "Action Denied: Tidak dapat meng-upgrade USER menjadi ADMIN dari antarmuka ini." }, { status: 400 });
      }
      body.systemRole = "USER";
      
      if (body.businessRole !== undefined) {
        const roleKey = typeof body.businessRole === "string" ? body.businessRole.trim().toLowerCase() : "";
        if (!isValidHumanBusinessRole(roleKey)) {
          return NextResponse.json({ error: `Business Role '${body.businessRole}' tidak valid atau bukan peran persona pengguna aktif.` }, { status: 400 });
        }

        const derivedScope = deriveScopeFromBusinessRole(roleKey);
        body.businessRole = roleKey;
        body.scope = derivedScope;

        if (derivedScope === "HO") {
          body.branch = null;
        } else {
          const branchToCheck = body.branch !== undefined ? body.branch : existingUser.branch;
          if (!branchToCheck || typeof branchToCheck !== "string" || !branchToCheck.trim()) {
            return NextResponse.json({ error: "Cabang wajib diisi untuk role dengan cakupan BRANCH." }, { status: 400 });
          }
          body.branch = branchToCheck.trim();
        }
      } else if (body.branch !== undefined) {
        if (existingUser.scope === "HO") {
          body.branch = null;
        } else {
          if (!body.branch || typeof body.branch !== "string" || !body.branch.trim()) {
            return NextResponse.json({ error: "Cabang wajib diisi untuk role dengan cakupan BRANCH." }, { status: 400 });
          }
          body.branch = body.branch.trim();
        }
      }
    }

    // 5. Validasi keunikan NIK jika dikirimkan
    if (body.nik !== undefined) {
      if (typeof body.nik !== "string" || !body.nik.trim()) {
        return NextResponse.json({ error: "NIK tidak boleh kosong." }, { status: 400 });
      }
      const trimmedNik = body.nik.trim();
      const existingUserWithNik = await dbGetUserByNik(trimmedNik);
      if (existingUserWithNik && existingUserWithNik.id !== id) {
        return NextResponse.json({ error: "NIK sudah terdaftar pada pengguna lain." }, { status: 400 });
      }
      body.nik = trimmedNik;
    }

    // 6. Reset Password jika dikirimkan
    if (body.password !== undefined && body.password !== null && body.password !== "") {
      if (typeof body.password !== "string" || body.password.length < 8) {
        return NextResponse.json({ error: "Password minimal 8 karakter." }, { status: 400 });
      }

      if (body.confirmPassword !== undefined && body.password !== body.confirmPassword) {
        return NextResponse.json({ error: "Konfirmasi password tidak sesuai." }, { status: 400 });
      }

      body.passwordHash = await bcrypt.hash(body.password, 10);
    }
    delete body.password;
    delete body.confirmPassword;

    const updatedUser = await dbAdminUpdateUser(id, body);
    if (!updatedUser) {
      return NextResponse.json({ error: "User tidak ditemukan" }, { status: 404 });
    }

    // Never expose passwordHash in response
    const { passwordHash: _, ...safeUser } = updatedUser;
    return NextResponse.json({ data: safeUser });
  } catch (error) {
    console.error("[PATCH /api/admin/users/:id]", error);
    return NextResponse.json({ error: "Gagal memperbarui data user" }, { status: 500 });
  }
}

export async function DELETE(_: Request, { params }: RouteContext) {
  try {
    const sessionUser = await getSessionUser();
    
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

    // PROTEKSI SYSTEM ADMIN
    if (id === "usr_seed_admin" || existingUser.systemRole === "ADMIN") {
      return NextResponse.json({ error: "Action Denied: System ADMIN dilindungi dan tidak dapat dihapus." }, { status: 400 });
    }

    // Pemeriksaan dependensi audit & data historis
    const { hasDependencies, reasons } = await dbCheckUserDependencies(id);
    if (hasDependencies) {
      return NextResponse.json(
        {
          error: `User tidak dapat dihapus permanen karena memiliki riwayat audit/operasional (${reasons.join(", ")}). Silakan ubah status user menjadi INACTIVE (Nonaktifkan) alih-alih menghapus data fisik.`,
        },
        { status: 400 }
      );
    }

    const success = await dbDeleteUser(id);
    if (!success) {
      return NextResponse.json({ error: "User tidak dapat dihapus." }, { status: 400 });
    }

    return NextResponse.json({ data: { success: true } });
  } catch (error: unknown) {
    console.error("[DELETE /api/admin/users/:id]", error);
    const message = error instanceof Error ? error.message : "Gagal menghapus user";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
