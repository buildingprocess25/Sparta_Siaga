# SPARTA SIAGA — Final Environment Architecture & Security Specification

Dokumen ini mendefinisikan arsitektur final 3 tingkat environment untuk SPARTA SIAGA: **Development**, **UAT**, dan **Production**.

---

## 1. Ringkasan Matriks Environment

| Parameter / Fitur | DEVELOPMENT | UAT (User Acceptance Testing) | PRODUCTION |
| :--- | :--- | :--- | :--- |
| **Tujuan Utama** | Pengembangan lokal & visual testing HP via Dev Tunnel | Pengujian fitur, RBAC, workflow, & scope wilayah oleh evaluator | Operasional resmi SPARTA SIAGA |
| **Metode Autentikasi** | **Quick Login & Role Simulator** (9 Role Resmi) | **Quick Login & Role Simulator** (9 Role Resmi) | **Portal SPARTA SSO Production Existing** |
| **Akses Localhost** | Langsung terbuka (loopback-safe) | Terproteksi Gate Passcode | Dilarang (Wajib SSO) |
| **Akses Dev Tunnel / HP** | Wajib verifikasi Gate Passcode (`?gate=...` atau form passcode) | Wajib verifikasi Gate Passcode (`?gate=...` atau form passcode) | Nonaktif (Akses via domain resmi) |
| **Redirect SPARTA SSO** | **TIDAK** (Tetap di SPARTA SIAGA) | **TIDAK** (Tetap di SPARTA SIAGA) | **YA** (Wajib ke Portal SPARTA SSO) |
| **Redirect Logout** | `/login` (Kembali ke Role Simulator) | `/login` (Kembali ke Role Simulator) | Portal SPARTA SSO Launcher (`/#/modules`) |
| **Database Target** | `sparta_siaga_isolated` (Aiven Cloud Staging) | `sparta_siaga_isolated` (Aiven Cloud Staging) | `siaga` Production (Dokploy PostgreSQL) |
| **Fitur Simulasi Gempa** | Aktif | Aktif (Evaluasi Penanganan Bencana) | **DINONAKTIFKAN (Fail-closed)** |
| **Isolasi Sesi (JWT Claim)** | `env: "development"` | `env: "uat"` | `env: "production"` |
| **Penerimaan Token Dev/UAT di Prod** | **DITOLAK KERAS** | **DITOLAK KERAS** | **HANYA token bertanda `env: production`** |

---

## 2. Arsitektur Detail Tiap Environment

### A. Environment DEVELOPMENT
1. **Perilaku di Localhost (`127.0.0.1` / `localhost`)**:
   - Pengembang dapat langsung menggunakan 9 role Quick Login tanpa memasukkan passcode.
2. **Perilaku di Dev Tunnel / Perangkat Mobile (HP)**:
   - Akses melalui hostname tunnel publik (`*.devtunnels.ms`, `*.loca.lt`, `*.ngrok*`, dll.) wajib melalui verifikasi gate passcode pengembang.
   - Passcode dapat diberikan melalui:
     - Query Parameter: `?gate=<UAT_GATE_PASSCODE>`
     - Form Verifikasi: Mengisi passcode pada dialog login.
     - Header: `x-gate-passcode` atau `x-dev-access-key`.
   - Setelah terverifikasi, server menetapkan cookie `siaga_gate_token` sehingga perangkat HP dapat berpindah-pindah halaman dan mencoba 9 role secara leluasa.
   - Tunnel publik tanpa passcode yang valid akan menerima `HTTP 403 (GATE_VERIFICATION_REQUIRED)`.
3. **Keterpisahan SSO**:
   - Mode Development tidak pernah melakukan redirect ke SPARTA SSO.

---

### B. Environment UAT
1. **Tujuan**:
   - Memungkinkan penguji (evaluator cabang, HO, dan manajemen) menguji fungsionalitas 9 role tanpa harus bergantung pada sinkronisasi SSO eksternal.
2. **Mekanisme Akses**:
   - Menggunakan 9 role Quick Login & Role Simulator yang sama dengan Development.
   - Dibatasi hanya untuk penguji terotorisasi dengan memvalidasi `UAT_GATE_PASSCODE`.
   - Tidak diarahkan ke SPARTA SSO.
   - Saat logout, pengguna diarahkan kembali ke `/login` agar penguji dapat berpindah role untuk menguji alur kerja berikutnya (misal: BMS melapor -> BnM menyetujui).

---

### C. Environment PRODUCTION
1. **Prinsip Keamanan Tertinggi (Fail-Closed)**:
   - Mode Quick Login dan Role Simulator **wajib dinonaktifkan total** pada level kode server, API route, maupun antarmuka client.
   - Percobaan memanggil endpoint `/api/auth/quick-login` di Production selalu mengembalikan `HTTP 403 QUICK_LOGIN_FORBIDDEN`.
   - Jika target database adalah database Production (terdeteksi host/IP production), sistem secara otomatis mengunci diri ke mode Production (`isProductionEnvironment() === true`).
2. **Integrasi Portal SPARTA SSO Existing**:
   - Pengguna unauthenticated diarahkan ke portal resmi SPARTA SSO (`https://sparta-alfamart.web.id`).
   - Alur penerimaan token peluncuran one-time di `/auth/sso/callback` tetap bekerja memvalidasi hak modul `siaga`, mencocokkan identitas pengguna terdaftar, dan menerbitkan sesi resmi.
   - Saat logout, pengguna diarahkan ke launcher modul SPARTA SSO (`https://sparta-alfamart.web.id/#/modules`).
3. **Isolasi Sesi**:
   - Token JWT yang diterbitkan di Development (`env: development`) atau UAT (`env: uat`) secara ketat **ditolak** oleh server Production, mencegah kebocoran sesi pengujian ke lingkungan operasional nyata.

