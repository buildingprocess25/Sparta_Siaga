"use client";

import { useCallback, useEffect, useState } from "react";
import { Building2, CheckCircle2, FileSpreadsheet, History, Loader2, MapPin, Search, TriangleAlert, X } from "lucide-react";
import { toast } from "sonner";

type Facility = {
  id: string;
  code: string;
  name: string;
  facility_type: string;
  latitude: number;
  longitude: number;
  branch_id: string | null;
  mapping_verified_at: string | null;
  operational_status: "ACTIVE" | "INACTIVE";
  auto_report_enabled: boolean;
};

export default function FacilityAdminPage() {
  const [facilities, setFacilities] = useState<Facility[]>([]);
  const [branches, setBranches] = useState<Array<{ code: string; name: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [type, setType] = useState("");
  const [mapping, setMapping] = useState("");
  const [savingId, setSavingId] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [preview, setPreview] = useState<{ total: number; newCount: number; changedCount: number; unchangedCount: number; invalidCount: number } | null>(null);
  const [auditFacility, setAuditFacility] = useState<Facility | null>(null);
  const [audit, setAudit] = useState<Array<{ action: string; changed_fields: Record<string, unknown>; actor_user_id: string | null; created_at: string }>>([]);
  const [auditLoading, setAuditLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams();
    if (query) params.set("q", query);
    if (type) params.set("type", type);
    if (mapping) params.set("mapping", mapping);
    try {
      const response = await fetch(`/api/admin/facilities?${params}`, { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Gagal memuat fasilitas");
      setFacilities(payload.data);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Gagal memuat fasilitas");
    } finally {
      setLoading(false);
    }
  }, [mapping, query, type]);

  useEffect(() => {
    const timeout = window.setTimeout(load, 250);
    return () => window.clearTimeout(timeout);
  }, [load]);

  useEffect(() => {
    fetch("/api/branches", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((payload) => {
        if (Array.isArray(payload?.data)) {
          setBranches(payload.data.map((b: { code: string; name: string }) => ({ code: b.code, name: b.name })));
        }
      })
      .catch(() => {
        setBranches([]);
      });
  }, []);

  async function updateFacility(id: string, patch: Record<string, unknown>) {
    setSavingId(id);
    try {
      const response = await fetch("/api/admin/facilities", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, ...patch }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Perubahan ditolak");
      setFacilities((current) => current.map((item) => item.id === id ? payload.data : item));
      toast.success("Master fasilitas diperbarui");
    } catch (updateError) {
      toast.error(updateError instanceof Error ? updateError.message : "Gagal menyimpan perubahan");
    } finally {
      setSavingId(null);
    }
  }

  const mapped = facilities.filter((item) => item.mapping_verified_at).length;
  const active = facilities.filter((item) => item.auto_report_enabled).length;

  async function previewImport() {
    setImporting(true);
    try {
      const response = await fetch("/api/admin/facilities/import", { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Preview import gagal");
      setPreview(payload.data);
    } catch (importError) { toast.error(importError instanceof Error ? importError.message : "Preview import gagal"); }
    finally { setImporting(false); }
  }

  async function applyImport() {
    setImporting(true);
    try {
      const response = await fetch("/api/admin/facilities/import", { method: "POST" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Import gagal");
      toast.success(`Import ${payload.data.total} fasilitas selesai`);
      setPreview(null); await load();
    } catch (importError) { toast.error(importError instanceof Error ? importError.message : "Import gagal"); }
    finally { setImporting(false); }
  }

  async function openAudit(facility: Facility) {
    setAuditFacility(facility); setAuditLoading(true); setAudit([]);
    try {
      const response = await fetch(`/api/admin/facilities/${facility.id}/audit`, { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Gagal memuat audit");
      setAudit(payload.data);
    } catch (auditError) { toast.error(auditError instanceof Error ? auditError.message : "Gagal memuat audit"); }
    finally { setAuditLoading(false); }
  }

  return (
    <section className="p-4 sm:p-6 lg:p-8 space-y-5 text-slate-900 dark:text-slate-100">
      <header className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight">Master Fasilitas</h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            Mapping cabang dan aktivasi evaluasi gempa untuk DC, warehouse, depo, bulky, dan store hub.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3"><div className="text-sm text-slate-600 dark:text-slate-400" aria-live="polite">
          {facilities.length} fasilitas · {mapped} terpetakan · {active} auto-report aktif
        </div><button type="button" onClick={previewImport} disabled={importing} className="sparta-button"><FileSpreadsheet />{importing ? "Memeriksa…" : "Preview import"}</button></div>
      </header>

      {preview && <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-slate-800"><div className="flex flex-wrap items-center justify-between gap-3"><div><strong>KOORDINAT GUDANG.xlsx</strong><p className="mt-1 text-xs text-slate-600">{preview.total} baris · {preview.newCount} baru · {preview.changedCount} berubah · {preview.unchangedCount} tetap · {preview.invalidCount} invalid</p></div><div className="flex gap-2"><button className="sparta-button" onClick={() => setPreview(null)}>Batal</button><button className="sparta-button primary" disabled={importing || preview.invalidCount > 0} onClick={applyImport}>Terapkan import</button></div></div></div>}

      <div className="grid gap-3 sm:grid-cols-[minmax(220px,1fr)_180px_180px]">
        <label className="relative">
          <span className="sr-only">Cari kode atau nama fasilitas</span>
          <Search className="absolute left-3 top-3.5 h-4 w-4 text-slate-400" aria-hidden="true" />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Cari kode atau nama"
            className="min-h-11 w-full rounded-lg border border-slate-300 bg-white pl-10 pr-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-blue-600 dark:border-slate-700 dark:bg-slate-900" />
        </label>
        <select value={type} onChange={(event) => setType(event.target.value)} aria-label="Filter jenis fasilitas"
          className="min-h-11 rounded-lg border border-slate-300 bg-white px-3 text-sm focus-visible:ring-2 focus-visible:ring-blue-600 dark:border-slate-700 dark:bg-slate-900">
          <option value="">Semua jenis</option><option value="DC">DC</option><option value="WAREHOUSE">Warehouse</option>
          <option value="DEPO">Depo</option><option value="BULKY">Bulky</option><option value="STORE_HUB">Store Hub</option>
        </select>
        <select value={mapping} onChange={(event) => setMapping(event.target.value)} aria-label="Filter status mapping"
          className="min-h-11 rounded-lg border border-slate-300 bg-white px-3 text-sm focus-visible:ring-2 focus-visible:ring-blue-600 dark:border-slate-700 dark:bg-slate-900">
          <option value="">Semua mapping</option><option value="mapped">Sudah terpetakan</option><option value="unmapped">Perlu mapping</option>
        </select>
      </div>

      {loading ? (
        <div className="flex min-h-48 items-center justify-center gap-3 text-sm text-slate-600 dark:text-slate-400" role="status">
          <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" /> Memuat master fasilitas…
        </div>
      ) : error ? (
        <div className="rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200" role="alert">
          <TriangleAlert className="mr-2 inline h-4 w-4" aria-hidden="true" />{error}
          <button onClick={load} className="ml-3 min-h-11 rounded-md px-3 font-semibold underline focus-visible:ring-2 focus-visible:ring-red-700">Coba lagi</button>
        </div>
      ) : facilities.length === 0 ? (
        <div className="rounded-lg border border-slate-300 p-8 text-center dark:border-slate-700">
          <Building2 className="mx-auto h-8 w-8 text-slate-400" aria-hidden="true" />
          <p className="mt-3 font-semibold">Tidak ada fasilitas yang cocok</p><p className="mt-1 text-sm text-slate-500">Ubah filter atau kata pencarian.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {facilities.map((facility) => (
            <article key={facility.id} className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-950">
              <div className="grid gap-4 md:grid-cols-[minmax(200px,1fr)_220px_240px_160px] md:items-center">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2"><strong>{facility.code}</strong><span className="text-xs font-semibold text-blue-700 dark:text-blue-300">{facility.facility_type.replace("_", " ")}</span></div>
                  <p className="mt-1 truncate text-sm">{facility.name}</p>
                  <p className="mt-1 flex items-center gap-1 text-xs text-slate-500"><MapPin className="h-3.5 w-3.5" aria-hidden="true" />{facility.latitude}, {facility.longitude}</p>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <label className="text-xs font-semibold text-slate-600">Latitude<input type="number" step="any" defaultValue={facility.latitude} onBlur={(event) => { const value = Number(event.target.value); if (Number.isFinite(value) && value !== facility.latitude) updateFacility(facility.id, { latitude: value }); }} className="mt-1 min-h-11 w-full rounded-md border border-slate-300 px-2 text-sm font-normal" /></label>
                  <label className="text-xs font-semibold text-slate-600">Longitude<input type="number" step="any" defaultValue={facility.longitude} onBlur={(event) => { const value = Number(event.target.value); if (Number.isFinite(value) && value !== facility.longitude) updateFacility(facility.id, { longitude: value }); }} className="mt-1 min-h-11 w-full rounded-md border border-slate-300 px-2 text-sm font-normal" /></label>
                </div>
                <label className="text-xs font-semibold text-slate-600 dark:text-slate-400">Cabang penanggung jawab
                  {branches.length > 0 ? (
                    <select
                      value={facility.branch_id || ""}
                      disabled={savingId === facility.id}
                      onChange={(event) => {
                        const next = event.target.value.trim() || null;
                        if (next !== facility.branch_id) updateFacility(facility.id, { branchId: next });
                      }}
                      className="mt-1 min-h-11 w-full rounded-md border border-slate-300 bg-white px-3 text-sm font-normal text-slate-900 focus-visible:ring-2 focus-visible:ring-blue-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                    >
                      <option value="">Belum dipetakan</option>
                      {facility.branch_id &&
                        !branches.some((b) => b.code.toUpperCase() === facility.branch_id?.toUpperCase()) && (
                          <option value={facility.branch_id}>{facility.branch_id} (Legacy)</option>
                        )}
                      {branches.map((b) => (
                        <option key={b.code} value={b.code}>
                          {b.code.toUpperCase() === b.name.toUpperCase() ? b.name : `${b.code} — ${b.name}`}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input defaultValue={facility.branch_id || ""} placeholder="Belum dipetakan"
                      onBlur={(event) => { const next = event.target.value.trim() || null; if (next !== facility.branch_id) updateFacility(facility.id, { branchId: next }); }}
                      className="mt-1 min-h-11 w-full rounded-md border border-slate-300 bg-white px-3 text-sm font-normal text-slate-900 focus-visible:ring-2 focus-visible:ring-blue-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100" />
                  )}
                </label>
                <div className="grid gap-2"><button type="button" disabled={savingId === facility.id || !facility.mapping_verified_at}
                  onClick={() => updateFacility(facility.id, { autoReportEnabled: !facility.auto_report_enabled })}
                  className="min-h-11 rounded-md border border-slate-300 px-3 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-blue-600 dark:border-slate-700">
                  {savingId === facility.id ? "Menyimpan…" : facility.auto_report_enabled ? <><CheckCircle2 className="mr-1 inline h-4 w-4" />Auto-report aktif</> : "Aktifkan auto-report"}
                </button><button type="button" onClick={() => openAudit(facility)} className="sparta-button"><History />Riwayat perubahan</button></div>
              </div>
            </article>
          ))}
        </div>
      )}
      {auditFacility && <div className="fixed inset-0 z-[900] flex items-end bg-slate-950/55 sm:items-center sm:justify-center sm:p-5" role="dialog" aria-modal="true" aria-labelledby="audit-title" onMouseDown={(event) => { if (event.target === event.currentTarget) setAuditFacility(null); }}><div className="flex max-h-[88dvh] w-full flex-col overflow-hidden rounded-t-2xl border border-slate-200 bg-white text-slate-900 shadow-2xl sm:max-w-xl sm:rounded-xl"><header className="flex items-center justify-between border-b border-slate-200 px-4 py-3"><div><h2 id="audit-title" className="font-bold">Riwayat perubahan</h2><p className="text-xs text-slate-500">{auditFacility.code} · {auditFacility.name}</p></div><button className="touch-target-min grid place-items-center rounded-lg hover:bg-slate-100" onClick={() => setAuditFacility(null)} aria-label="Tutup"><X className="h-5 w-5" /></button></header><div className="min-h-0 flex-1 overflow-y-auto p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">{auditLoading ? <div className="grid min-h-32 place-items-center"><Loader2 className="animate-spin" /></div> : audit.length === 0 ? <p className="text-sm text-slate-500">Belum ada perubahan tercatat.</p> : <ol className="space-y-3">{audit.map((entry, index) => <li key={`${entry.created_at}-${index}`} className="border-l-2 border-blue-600 pl-3"><div className="flex items-center justify-between gap-3"><strong className="text-sm">{entry.action.replaceAll("_", " ")}</strong><time className="text-xs text-slate-500">{new Date(entry.created_at).toLocaleString("id-ID")}</time></div><p className="mt-1 text-xs text-slate-500">Actor: {entry.actor_user_id || "Import sistem"}</p><pre className="mt-2 overflow-x-auto rounded-md bg-slate-50 p-2 text-[11px] text-slate-600">{JSON.stringify(entry.changed_fields, null, 2)}</pre></li>)}</ol>}</div></div></div>}
    </section>
  );
}
