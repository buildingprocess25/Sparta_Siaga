# SPARTA Ecosystem Machine-to-Machine Integration API Specification

> [!NOTE] INTEGRATION STATUS & ACTIVE ARCHITECTURE
> Dokumen ini mendefinisikan spesifikasi antarmuka API Machine-to-Machine (M2M) antara SPARTA SIAGA dan subsistem pemeliharaan fisik.
> - **Status Implementasi:** MOCK / INTERNAL ROUTE (`lib/sparta-external-integration.ts`, `app/api/incidents/[id]/estimation/route.ts`).
> - **Status Integrasi Eksternal:** PENDING (Menunggu integrasi live ERP korporat SPARTA Maintenance).
> - **Keamanan Kredensial:** Contoh nilai API key dan secret pada dokumen ini adalah placeholder fiktif untuk dokumentasi arsitektur. Dilarang menggunakan kredensial produksi pada berkas ini.

**Version:** 1.0.0  
**Target Consumer:** SPARTA Maintenance (BMS Toko) & Engineering Support (BES DC/Warehouse)  
**Security:** Header-based Machine Authentication (`X-Sparta-Api-Key` & `X-Sparta-Api-Secret`)  
**Base URL:** `https://<domain>/api/integrations/v1` (Local: `http://localhost:3004/api/integrations/v1`)

---

## 1. Authentication & Security Policy

All endpoints require two mandatory HTTP headers:
- `X-Sparta-Api-Key`: Registered Client ID for the external system.
- `X-Sparta-Api-Secret`: High-entropy private client secret (never exposed to client/browsers).

### Registered Applications & Scopes:
| Application Name | Target User | Allowed Scope | Description |
|---|---|---|---|
| `sparta_maintenance` | BMS Cabang | `TOKO_ONLY` | Menangani perbaikan fisik toko yang disetujui BM. |
| `engineering_support` | BES Cabang | `DC_ONLY` | Menangani perbaikan fisik gudang/DC yang disetujui BM. |

---

## 2. API Endpoints

### A. GET `/api/integrations/v1/approved-incidents`
Mengambil antrean insiden yang telah diverifikasi dan **disetujui oleh Branch Manager** (`status = confirmed_affected`).

#### Query Parameters:
- `branch` (optional, string): Filter cabang tertentu (misal: `BANDUNG`, `SIDOARJO`).
- `page` (optional, integer, default: 1): Nomor halaman.
- `limit` (optional, integer, default: 20, max: 100): Jumlah item per halaman.

#### Sample Request:
```bash
curl -X GET "http://localhost:3004/api/integrations/v1/approved-incidents?branch=BANDUNG&limit=10" \
  -H "X-Sparta-Api-Key: <API_KEY_PLACEHOLDER>" \
  -H "X-Sparta-Api-Secret: <API_SECRET_PLACEHOLDER>"
```

#### Sample Response (200 OK):
```json
{
  "success": true,
  "data": [
    {
      "incidentId": "INC-BDG-20261013-001",
      "storeId": "T-BDG-099",
      "storeName": "Alfamart Setiabudi 99",
      "branch": "BANDUNG",
      "locationCity": "Bandung",
      "disasterType": "earthquake",
      "tkpType": "toko",
      "status": "confirmed_affected",
      "severity": "Sedang",
      "condition": "damaged",
      "damageCategories": ["Plafon", "Rak Barang"],
      "inspection": {
        "method": "kunjungan_langsung",
        "confirmedBy": "Budi Santoso (BMS)",
        "confirmedAt": "2026-10-13 09:00:00 WIB",
        "evidencePhotosCount": 2,
        "notes": "Plafon runtuh sebagian, barang berjatuhan."
      },
      "branchManagerApproval": {
        "decidedBy": "Hartono (Branch Manager)",
        "decidedAt": "2026-10-13 09:45:00 WIB",
        "decisionNotes": "Disetujui untuk perbaikan teknis via SPARTA Maintenance."
      },
      "externalWork": {
        "synced": false,
        "externalWorkId": null
      }
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 10,
    "totalItems": 1,
    "totalPages": 1
  }
}
```

---

### B. GET `/api/integrations/v1/approved-incidents/{id}`
Mengambil detail lengkap satu insiden, termasuk URL bukti foto pemeriksaan lapangan dan catatan keputusan Branch Manager.

#### Sample Request:
```bash
curl -X GET "http://localhost:3004/api/integrations/v1/approved-incidents/INC-BDG-20261013-001" \
  -H "X-Sparta-Api-Key: <API_KEY_PLACEHOLDER>" \
  -H "X-Sparta-Api-Secret: <API_SECRET_PLACEHOLDER>"
```

---

### C. POST `/api/integrations/v1/work-updates`
Mengirimkan pembaruan status pengerjaan fisik dari sistem eksternal kembali ke SPARTA SIAGA agar BMS/BES tidak perlu input manual dua kali.

#### Request Body:
```json
{
  "incidentId": "INC-BDG-20261013-001",
  "externalSystem": "sparta_maintenance",
  "externalWorkId": "WO-MAINT-BDG-2026-8801",
  "workStatus": "SPK_ISSUED",
  "notes": "Surat Perintah Kerja diterbitkan ke Kontraktor PT Cipta Reksa.",
  "updatedBy": "Admin SPARTA Maintenance"
}
```

#### Response (200 OK):
```json
{
  "success": true,
  "message": "Sinkronisasi pekerjaan 'WO-MAINT-BDG-2026-8801' berhasil dicatat di SPARTA SIAGA.",
  "data": {
    "incidentId": "INC-BDG-20261013-001",
    "externalWorkId": "WO-MAINT-BDG-2026-8801",
    "externalSystem": "sparta_maintenance",
    "workStatus": "SPK_ISSUED",
    "syncedAt": "2026-10-13T04:10:00.000Z"
  }
}
```
