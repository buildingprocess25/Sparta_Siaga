"use client";

import React, { useState, useEffect } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { ShieldAlert, Loader2, LogIn } from "lucide-react";

export default function LoginPage() {
  const router = useRouter();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const spartaLoginUrl =
    process.env.NEXT_PUBLIC_SPARTA_LOGIN_URL ||
    "https://login.sparta-alfamart.web.id";

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const err = params.get("error");
    if (err) {
      const errorMap: Record<string, string> = {
        MissingToken: "Token SSO tidak ditemukan. Silakan masuk kembali melalui Portal SPARTA.",
        InvalidToken: "Token SSO tidak valid atau telah kedaluwarsa. Silakan coba kembali.",
        TokenExpired: "Sesi token peluncuran SSO telah kedaluwarsa (batas 2 menit). Silakan buka kembali dari Portal SPARTA.",
        TokenConsumed: "Token peluncuran SSO telah digunakan. Silakan luncurkan modul SIAGA kembali dari Portal SPARTA.",
        ModuleMismatch: "Token SSO tidak diperuntukkan bagi modul SPARTA SIAGA.",
        UnauthorizedModule: "Akun Anda tidak memiliki hak otorisasi untuk mengakses modul SPARTA SIAGA.",
        InvalidPayload: "Data autentikasi pengguna dari Portal SPARTA tidak lengkap atau tidak valid.",
        UserNotFound: "Akun Anda belum terdaftar di database pengguna SIAGA. Hubungi Administrator untuk sinkronisasi.",
        InactiveAccount: "Akun Anda berstatus nonaktif di database SIAGA. Hubungi Administrator.",
        AmbiguousIdentity: "Konflik identitas terdeteksi pada akun Anda. Hubungi Administrator.",
        DeactivatedRole: "Peran pengguna Anda telah dinonaktifkan dari sistem SIAGA.",
        SessionCreationFailed: "Gagal membuat sesi login perangkat SIAGA. Silakan coba beberapa saat lagi.",
        SsoServiceUnavailable: "Layanan autentikasi SPARTA Portal sedang tidak dapat dihubungi.",
        ServerError: "Terjadi kesalahan internal saat memproses autentikasi SSO.",
      };
      setError(errorMap[err] || `Autentikasi SSO gagal (${err}). Silakan coba kembali.`);
    }
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ identifier, password }),
      });

      const data = await res.json();

      if (res.ok) {
        window.location.href = "/";
      } else {
        setError(data.error || "Gagal masuk");
      }
    } catch (err) {
      setError("Terjadi kesalahan jaringan");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#f5f7f9] flex flex-col justify-center items-center p-4">
      <div className="w-full max-w-md bg-white rounded-3xl shadow-xl overflow-hidden">
        {/* Header Branding */}
        <div className="bg-[#123B6D] p-8 text-center flex flex-col items-center">
          <div className="flex gap-4 items-center mb-6">
            <div className="w-16 h-16 relative bg-white/10 rounded-xl p-2">
              <Image src="/brand/building_logo.png" alt="SPARTA Logo" fill className="object-contain" />
            </div>
          </div>
          
          <h1 className="text-2xl font-black text-white tracking-widest mb-1">SPARTA SIAGA</h1>
          <p className="text-blue-200 text-xs font-medium tracking-wider uppercase">
            Sistem Integrasi Analisis & Peringatan Bencana
          </p>
          
          <div className="mt-8 pt-6 border-t border-white/20 w-full flex justify-center">
            <Image src="/brand/alfamart_logo.png" alt="Alfamart" width={100} height={30} className="opacity-90" />
          </div>
        </div>

        {/* Login Form */}
        <div className="p-8">
          <h2 className="text-lg font-bold text-slate-800 mb-6 text-center">Masuk ke Sistem</h2>
          
          {error && (
            <div
              role="alert"
              aria-live="polite"
              data-testid="login-error-alert"
              className="mb-6 p-3.5 bg-red-50 text-red-800 rounded-xl text-xs font-semibold border border-red-200 flex items-start gap-2.5 shadow-xs"
            >
              <ShieldAlert className="w-4 h-4 mt-0.5 shrink-0 text-red-600" />
              <div className="flex-1">
                <p className="font-bold text-red-900">{error}</p>
                <p className="text-[11px] text-red-700/90 mt-0.5 font-normal leading-relaxed">
                  Pastikan NIK atau Username dan Password yang Anda masukkan sudah benar. Hubungi Administrator jika kendala berlanjut.
                </p>
              </div>
            </div>
          )}

          {/* Masuk via Portal SPARTA SSO */}
          <a
            href={spartaLoginUrl}
            data-testid="sso-portal-login-button"
            className="w-full py-3 px-4 bg-[#123B6D] hover:bg-[#0e2e56] text-white font-bold rounded-xl shadow-sm hover:shadow-md transition-all flex justify-center items-center gap-2 text-sm group focus:outline-hidden focus:ring-2 focus:ring-[#123B6D] focus:ring-offset-2"
          >
            <LogIn className="w-4 h-4 text-blue-200 group-hover:translate-x-0.5 transition-transform" />
            <span>Masuk via Portal SPARTA (SSO)</span>
          </a>

          {/* Divider */}
          <div className="relative my-6">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-slate-200" />
            </div>
            <div className="relative flex justify-center text-[11px] uppercase">
              <span className="bg-white px-3 text-slate-400 font-semibold tracking-wider">
                Atau Kredensial Khusus
              </span>
            </div>
          </div>

          <form action="#" onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label htmlFor="login-identifier" className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-2">
                NIK / Username
              </label>
              <input
                id="login-identifier"
                type="text"
                autoComplete="username"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                className="w-full px-4 py-3 bg-slate-50 border border-slate-300 rounded-xl text-sm focus:outline-hidden focus:ring-2 focus:ring-[#1D5AA6] focus:bg-white transition-all text-slate-900"
                placeholder="Masukkan NIK atau Username"
                required
              />
            </div>
            
            <div>
              <label htmlFor="login-password" className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-2">
                Password
              </label>
              <input
                id="login-password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-4 py-3 bg-slate-50 border border-slate-300 rounded-xl text-sm focus:outline-hidden focus:ring-2 focus:ring-[#1D5AA6] focus:bg-white transition-all text-slate-900"
                placeholder="••••••••"
                required
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3.5 bg-[#D9272E] hover:bg-[#b91e24] text-white font-bold rounded-xl shadow-md transition-all disabled:opacity-70 disabled:cursor-not-allowed flex justify-center items-center mt-2 focus:outline-hidden focus:ring-2 focus:ring-[#D9272E] focus:ring-offset-2"
            >
              {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : "Masuk"}
            </button>
          </form>

          <div className="mt-8 text-center text-xs text-slate-600">
            Pastikan Anda menggunakan kredensial internal yang valid.
            <br />
            Untuk bantuan, hubungi IT Helpdesk.
          </div>
        </div>
      </div>
    </div>
  );
}
