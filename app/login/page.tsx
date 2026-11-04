"use client";

import React, { useState, useEffect } from "react";
import Image from "next/image";
import {
  ShieldAlert,
  Loader2,
  LogIn,
  Terminal,
  Building2,
  ChevronRight,
  ShieldCheck,
  CheckCircle2,
  AlertTriangle
} from "lucide-react";

interface DevRoleOption {
  id: string;
  name: string;
  badge: string;
  description: string;
  requiresBranch: boolean;
  scope: string;
}

const DEV_ROLES: DevRoleOption[] = [
  {
    id: "sysadmin",
    name: "System Administrator",
    badge: "SYSADMIN",
    description: "Akses teknis tertinggi, konfigurasi sistem & audit data",
    requiresBranch: false,
    scope: "Head Office (National)",
  },
  {
    id: "admin",
    name: "Admin HO",
    badge: "HO ADMIN",
    description: "Monitoring nasional & pembuatan Instruksi Manajemen",
    requiresBranch: false,
    scope: "Head Office (National)",
  },
  {
    id: "bm",
    name: "BnM Manajer",
    badge: "BM / BNM",
    description: "Review & konfirmasi hasil pemeriksaan lapangan",
    requiresBranch: true,
    scope: "Branch Level",
  },
  {
    id: "bmc",
    name: "BMC",
    badge: "BMC",
    description: "Koordinator Perawatan Toko Cabang",
    requiresBranch: true,
    scope: "Branch Level",
  },
  {
    id: "bec",
    name: "BEC",
    badge: "BEC",
    description: "Koordinator Engineering DC & Fasilitas",
    requiresBranch: true,
    scope: "Branch Level",
  },
  {
    id: "bbc",
    name: "BBC",
    badge: "BBC",
    description: "Koordinator Gedung & Bangunan Cabang",
    requiresBranch: true,
    scope: "Branch Level",
  },
  {
    id: "bms",
    name: "BMS",
    badge: "BMS",
    description: "Pemeriksaan lapangan toko & upload bukti foto",
    requiresBranch: true,
    scope: "Branch Level",
  },
  {
    id: "bes",
    name: "BES",
    badge: "BES",
    description: "Pemeriksaan lapangan DC & fasilitas distribusi",
    requiresBranch: true,
    scope: "Branch Level",
  },
  {
    id: "bbs",
    name: "BBS",
    badge: "BBS",
    description: "Pemeriksaan bangunan gedung & infrastruktur",
    requiresBranch: true,
    scope: "Branch Level",
  },
];

const BRANCHES = [
  { id: "BANDUNG", name: "Cabang Bandung", code: "BDG" },
  { id: "CIKOKOL", name: "Cabang Cikokol", code: "CKL" },
];

export default function LoginPage() {
  const [loading, setLoading] = useState(false);
  const [initLoading, setInitLoading] = useState(true);
  const [isDevMode, setIsDevMode] = useState(false);
  const [selectedRoleId, setSelectedRoleId] = useState("sysadmin");
  const [selectedBranch, setSelectedBranch] = useState("BANDUNG");
  const [error, setError] = useState("");
  const [ssoPortalUrl, setSsoPortalUrl] = useState(
    process.env.NEXT_PUBLIC_SPARTA_LOGIN_URL || "https://sparta-alfamart.web.id"
  );

  useEffect(() => {
    if (typeof window === "undefined") return;

    const params = new URLSearchParams(window.location.search);
    const err = params.get("error");
    if (err) {
      const errorMap: Record<string, string> = {
        MissingToken: "Token peluncuran SSO tidak ditemukan. Silakan buka kembali melalui Portal SPARTA.",
        InvalidToken: "Token SSO tidak valid atau sudah kedaluwarsa. Silakan coba kembali dari Portal SPARTA.",
        TokenExpired: "Sesi token peluncuran SSO kedaluwarsa (batas 2 menit). Buka kembali modul SIAGA dari Portal SPARTA.",
        TokenConsumed: "Token SSO telah digunakan. Silakan klik kembali modul SIAGA di Portal SPARTA.",
        ModuleMismatch: "Token SSO tidak diperuntukkan bagi modul SPARTA SIAGA.",
        UnauthorizedModule: "Akun Anda tidak memiliki otorisasi akses modul SPARTA SIAGA di Portal SPARTA.",
        InvalidPayload: "Data autentikasi pengguna dari Portal SPARTA tidak valid.",
        UserNotFound: "Akun Anda belum terdaftar di database SIAGA. Hubungi Administrator untuk sinkronisasi.",
        InactiveAccount: "Akun Anda berstatus nonaktif di database SIAGA. Hubungi Administrator.",
        AmbiguousIdentity: "Konflik identitas terdeteksi pada akun Anda. Hubungi Administrator.",
        DeactivatedRole: "Peran pengguna Anda dinonaktifkan dari sistem SIAGA.",
        PendingSsoGrant: "Akun Anda terdaftar di SIAGA, menunggu otorisasi modul 'siaga' di Portal SPARTA SSO.",
        UnmatchedSso: "Akun Anda belum terdaftar di Portal SPARTA SSO. Hubungi Administrator.",
        PendingReview: "Akun Anda masih dalam proses review perizinan oleh Administrator.",
        UserBlocked: "Akses akun Anda telah dinonaktifkan.",
        SessionCreationFailed: "Gagal membuat sesi login perangkat SIAGA. Silakan coba lagi.",
        SsoServiceUnavailable: "Layanan autentikasi SPARTA Portal sedang tidak dapat dihubungi.",
        ServerError: "Terjadi kesalahan internal saat memproses autentikasi SSO.",
      };
      setError(errorMap[err] || `Autentikasi SSO gagal (${err}). Silakan coba kembali.`);
    }

    // Determine environment policy
    fetch("/api/auth/env-status")
      .then((res) => res.json())
      .then((data) => {
        if (data.ssoPortalUrl) {
          setSsoPortalUrl(data.ssoPortalUrl);
        }

        if (data.isDevelopment && data.isQuickLoginAllowed) {
          setIsDevMode(true);
          setInitLoading(false);
        } else {
          setIsDevMode(false);
          // If in UAT or Production and there's NO error query parameter, redirect to Portal SSO immediately
          if (!err) {
            window.location.href = data.ssoPortalUrl || ssoPortalUrl;
          } else {
            setInitLoading(false);
          }
        }
      })
      .catch(() => {
        setIsDevMode(false);
        setInitLoading(false);
      });
  }, [ssoPortalUrl]);

  const handleQuickLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const res = await fetch("/api/auth/quick-login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          role: selectedRoleId,
          branch: selectedBranch,
        }),
      });

      const data = await res.json();

      if (res.ok && data.success) {
        window.location.href = data.redirectTo || "/";
      } else {
        setError(data.message || data.error || "Gagal masuk menggunakan Quick Login.");
      }
    } catch {
      setError("Terjadi kesalahan jaringan saat melakukan login.");
    } finally {
      setLoading(false);
    }
  };

  const selectedRole = DEV_ROLES.find((r) => r.id === selectedRoleId) || DEV_ROLES[0];

  // Initial redirecting state for UAT / Production when visiting /login without error
  if (initLoading && !error && !isDevMode) {
    return (
      <div className="min-h-screen bg-[#f5f7f9] flex flex-col justify-center items-center p-4">
        <div className="w-full max-w-md bg-white rounded-3xl shadow-xl p-8 text-center flex flex-col items-center">
          <Loader2 className="w-8 h-8 text-[#123B6D] animate-spin mb-4" />
          <p className="text-sm font-bold text-slate-800">Menghubungkan ke Portal SPARTA SSO...</p>
          <p className="text-xs text-slate-500 mt-1">Autentikasi UAT & Production wajib melalui SSO.</p>
        </div>
      </div>
    );
  }

  // UAT or Production Error Screen (No Direct Form, only SSO Portal Re-entry)
  if (!isDevMode) {
    return (
      <div className="min-h-screen bg-[#f5f7f9] flex flex-col justify-center items-center p-4">
        <div className="w-full max-w-md bg-white rounded-3xl shadow-xl overflow-hidden">
          <div className="bg-[#123B6D] p-8 text-center flex flex-col items-center">
            <div className="w-16 h-16 relative bg-white/10 rounded-xl p-2 mb-4">
              <Image src="/brand/building_logo.png" alt="SPARTA Logo" fill className="object-contain" priority />
            </div>
            <h1 className="text-2xl font-black text-white tracking-widest mb-1">SPARTA SIAGA</h1>
            <p className="text-blue-200 text-xs font-medium tracking-wider uppercase">
              Sistem Mitigasi &amp; Peringatan Bencana
            </p>
          </div>

          <div className="p-8">
            {error ? (
              <div
                role="alert"
                aria-live="polite"
                className="mb-6 p-4 bg-amber-50 text-amber-900 rounded-2xl border border-amber-200 flex items-start gap-3 shadow-xs"
              >
                <AlertTriangle className="w-5 h-5 mt-0.5 shrink-0 text-amber-600" />
                <div className="flex-1">
                  <p className="font-bold text-sm text-amber-900">Perhatian Autentikasi</p>
                  <p className="text-xs text-amber-800 mt-1 leading-relaxed">{error}</p>
                </div>
              </div>
            ) : (
              <div className="mb-6 p-4 bg-blue-50 text-blue-900 rounded-2xl border border-blue-200 text-center">
                <p className="font-bold text-sm">Autentikasi Tunggal Terpusat</p>
                <p className="text-xs text-blue-700 mt-1">
                  Akses SPARTA SIAGA wajib melalui Portal SPARTA SSO Corporate / UAT.
                </p>
              </div>
            )}

            <a
              href={ssoPortalUrl}
              className="w-full py-3.5 px-4 bg-[#123B6D] hover:bg-[#0e2e56] text-white font-bold rounded-xl shadow-md transition-all flex justify-center items-center gap-2 text-sm group"
            >
              <LogIn className="w-4 h-4 text-blue-200 group-hover:translate-x-0.5 transition-transform" />
              <span>Buka Portal SPARTA SSO</span>
            </a>

            <div className="mt-8 text-center text-xs text-slate-500">
              Direct password login ditiadakan untuk menjaga keamanan identitas dan hak akses modul.
            </div>
          </div>
        </div>
      </div>
    );
  }

  // LOCAL DEVELOPMENT ONLY — Quick Login with 9 Role Selection
  return (
    <div className="min-h-screen bg-[#0f172a] flex flex-col justify-center items-center p-4 py-8">
      <div className="w-full max-w-2xl bg-white dark:bg-slate-900 rounded-3xl shadow-2xl overflow-hidden border border-slate-800">
        {/* Header Branding */}
        <div className="bg-[#123B6D] p-6 text-white flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 relative bg-white/10 rounded-xl p-2 shrink-0">
              <Image src="/brand/building_logo.png" alt="SPARTA Logo" fill className="object-contain" priority />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-lg font-black tracking-wide">SPARTA SIAGA</h1>
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-extrabold bg-amber-400 text-slate-950 tracking-wider">
                  <Terminal className="w-3 h-3" />
                  LOCAL DEVELOPMENT ONLY
                </span>
              </div>
              <p className="text-blue-200 text-xs mt-0.5">Development Login &amp; Role Simulator</p>
            </div>
          </div>

          <div className="hidden sm:block text-right">
            <span className="text-[11px] font-semibold text-blue-200 bg-white/10 px-3 py-1.5 rounded-lg border border-white/15">
              Port 3004 • Loopback Safe
            </span>
          </div>
        </div>

        {/* Development Quick Login Body */}
        <div className="p-6 sm:p-8">
          <div className="mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 border-b border-slate-100 dark:border-slate-800 pb-4">
            <div>
              <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-emerald-600" />
                Pilih Role Developer
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Pilih salah satu dari 9 role resmi untuk testing UI, workflow, dan RBAC tanpa SSO.
              </p>
            </div>
          </div>

          {error && (
            <div
              role="alert"
              className="mb-6 p-3.5 bg-red-50 dark:bg-red-950/40 text-red-800 dark:text-red-300 rounded-xl text-xs font-semibold border border-red-200 dark:border-red-900 flex items-start gap-2.5"
            >
              <ShieldAlert className="w-4 h-4 mt-0.5 shrink-0 text-red-600" />
              <div className="flex-1">
                <p className="font-bold">{error}</p>
              </div>
            </div>
          )}

          <form onSubmit={handleQuickLogin} className="space-y-6">
            {/* 9 Roles Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 max-h-[340px] overflow-y-auto pr-1">
              {DEV_ROLES.map((role) => {
                const isSelected = selectedRoleId === role.id;
                return (
                  <button
                    key={role.id}
                    type="button"
                    onClick={() => setSelectedRoleId(role.id)}
                    className={`p-3 rounded-xl border text-left transition-all relative flex flex-col justify-between min-h-[96px] ${
                      isSelected
                        ? "border-[#123B6D] bg-blue-50/70 dark:bg-blue-950/40 ring-2 ring-[#123B6D] dark:ring-blue-400"
                        : "border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 bg-white dark:bg-slate-900/60"
                    }`}
                  >
                    <div>
                      <div className="flex items-center justify-between gap-1 mb-1">
                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                          {role.badge}
                        </span>
                        {isSelected && <CheckCircle2 className="w-4 h-4 text-[#123B6D] dark:text-blue-400 shrink-0" />}
                      </div>
                      <p className="text-xs font-bold text-slate-900 dark:text-white leading-tight">
                        {role.name}
                      </p>
                    </div>

                    <p className="text-[10px] text-slate-500 dark:text-slate-400 line-clamp-2 mt-1">
                      {role.description}
                    </p>
                  </button>
                );
              })}
            </div>

            {/* Branch Selector for Branch-Scoped Roles */}
            {selectedRole.requiresBranch ? (
              <div className="p-4 bg-slate-50 dark:bg-slate-800/50 rounded-2xl border border-slate-200 dark:border-slate-700">
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-2 flex items-center gap-1.5">
                  <Building2 className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                  Pilih Cabang Penugasan ({selectedRole.name})
                </label>
                <div className="grid grid-cols-2 gap-3">
                  {BRANCHES.map((b) => (
                    <button
                      key={b.id}
                      type="button"
                      onClick={() => setSelectedBranch(b.id)}
                      className={`py-2 px-3 rounded-xl text-xs font-bold border transition-all text-center flex items-center justify-center gap-2 ${
                        selectedBranch === b.id
                          ? "bg-[#123B6D] text-white border-[#123B6D] shadow-sm"
                          : "bg-white dark:bg-slate-800 border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700"
                      }`}
                    >
                      <span>{b.name}</span>
                      <span className="text-[10px] opacity-75">({b.code})</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="p-3 bg-blue-50/50 dark:bg-blue-950/20 rounded-xl border border-blue-100 dark:border-blue-900/40 text-xs text-blue-800 dark:text-blue-300 flex items-center justify-between">
                <span>Scope Wilayah: <strong>{selectedRole.scope}</strong></span>
                <span className="text-[11px] font-semibold text-blue-600 dark:text-blue-400">Semua Cabang / Nasional</span>
              </div>
            )}

            {/* Submit Action */}
            <button
              type="submit"
              disabled={loading}
              className="w-full py-3.5 bg-[#123B6D] hover:bg-[#0e2e56] text-white font-bold rounded-xl shadow-md transition-all disabled:opacity-70 disabled:cursor-not-allowed flex justify-center items-center gap-2 text-sm focus:outline-hidden focus:ring-2 focus:ring-[#123B6D] focus:ring-offset-2"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Membuat Sesi Developer...</span>
                </>
              ) : (
                <>
                  <span>Masuk sebagai {selectedRole.name} {selectedRole.requiresBranch ? `(${selectedBranch})` : ""}</span>
                  <ChevronRight className="w-4 h-4" />
                </>
              )}
            </button>
          </form>

          {/* Footer Warning */}
          <div className="mt-6 pt-4 border-t border-slate-100 dark:border-slate-800 text-center text-[11px] text-slate-500 dark:text-slate-400">
            Quick Login hanya aktif pada local loopback development. UAT dan Production wajib menggunakan autentikasi SSO terpusat.
          </div>
        </div>
      </div>
    </div>
  );
}
