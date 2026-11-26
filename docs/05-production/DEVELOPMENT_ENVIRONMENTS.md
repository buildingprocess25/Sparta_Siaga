# SPARTA SIAGA — Arsitektur Environment Development & Production

SPARTA SIAGA hanya mengenal **dua environment utama**:

1. **Production** (`APP_ENV=production`, `SPARTA_ENVIRONMENT=production`)
   - Autentikasi wajib melalui Portal SSO SPARTA.
   - Menggunakan database operasional `siaga` + worker monitoring otonom dan notifikasi resmi (deployment Dokploy).
2. **Development** (`APP_ENV=development`, `SPARTA_ENVIRONMENT=development`)
   - Menyediakan **Quick Login 9 Role** dan pemisahan dua mode sumber data tanpa perlu mengubah `DATABASE_URL` secara manual.

_(Environment UAT terpisah telah dihapus. Proteksi `DEV_GATE_PASSCODE` tetap tersedia otomatis untuk akses non-loopback / tunnel di mode Development.)_

---

## Dua Pilihan Akses Data di Development

| Kebutuhan                               | Command                  | Sumber Data                                                                            | Yang Aktif                                                                                                          | Yang Diblokir                                                                                                         |
| --------------------------------------- | ------------------------ | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| **Development Normal (Terisolasi)**     | `pnpm dev` / `pnpm dev:local` | Aiven `sparta_siaga_isolated` (`SPARTA_ISOLATED_TEST_DATABASE_URL`)                    | Quick Login 9 Role, CRUD pengujian, simulasi gempa (`SPARTA_ALLOW_TEST_SIMULATION`), `pnpm migrate:isolated`        | DB Production, Portal SSO redirect, worker/email produksi                                                             |
| **Development Data Aktual (Read-Only)** | `pnpm dev:prod-readonly` | PostgreSQL Production (`SPARTA_PRODUCTION_READONLY_DATABASE_URL` berhak `SELECT` saja) | Melihat data aktual & uji tampilan memakai Quick Login 9 Role (session disimpan di memori & JWT, 0 penulisan ke DB) | Semua operasi tulis (`INSERT`/`UPDATE`/`DELETE`/DDL/lock), simulasi, provisioning, worker, sinkronisasi, email & push |

### Batasan Aiven (1 GB Storage / 1 GB RAM)

- **Jangan menyalin atau men-sync seluruh database Production ke Aiven.** Gunakan Aiven khusus untuk data uji secukupnya, pengujian CRUD, simulasi, dan pengujian migration (`pnpm migrate:isolated`).
- Untuk melihat data operasional nyata dalam skala penuh, gunakan `pnpm dev:prod-readonly`.

---

## Setup Sekali oleh DBA untuk `dev:prod-readonly`

1. Jalankan script SQL pada database PostgreSQL Production:
   - [setup_production_readonly_role.sql](../../database/readonly/setup_production_readonly_role.sql)
     Script ini membuat role `sparta_siaga_readonly` non-superuser dengan `default_transaction_read_only = on` dan hak akses hanya `CONNECT`, `USAGE`, dan `SELECT`.
2. Tambahkan ke `.env.local` (atau `.env.development.local`):
   ```env
   SPARTA_PRODUCTION_READONLY_DATABASE_URL="postgresql://sparta_siaga_readonly:<password>@<host>:5432/siaga?sslmode=require"
   ```
3. Jalankan `pnpm dev:prod-readonly`. Runner otomatis memeriksa katalog PostgreSQL (`pg_roles`, `information_schema.tables`, `transaction_read_only`) sebelum server Next.js dinyalakan dan menolak berjalan bila role masih memiliki izin tulis/DDL atau memakai kredensial yang sama dengan `DATABASE_URL`.
