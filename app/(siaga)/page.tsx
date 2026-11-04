"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Building,
  Building2,
  CheckCircle2,
  ClipboardList,
  Clock3,
  FilePlus2,
  FileText,
  MapPin,
  Plus,
  ShieldAlert,
  ShieldCheck,
  Store,
  UserCheck,
  UserPlus,
  UserRoundX,
  Users,
  Wrench,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSiaga } from "@/components/layout/siaga-context";
import { IncidentKpiRow } from "@/components/dashboard/incident-kpi-row";
import { ActiveIncidentsTable } from "@/components/dashboard/active-incidents-table";
import { MobileIncidentHome } from "@/components/mobile/mobile-incident-home";

interface CurrentUser {
  id: string;
  name: string;
  role?: string;
  businessRole?: string;
  systemRole?: string;
  scope?: string;
  branch?: string;
}

export default function DashboardPage() {
  const router = useRouter();
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);
  const [queue, setQueue] = useState<
    Array<{ id: string; waiting_seconds: string; primary_pic_user_id: string | null; location_kind?: string }>
  >([]);

  const {
    incidentStats,
    selectedCategory,
    setSelectedCategory,
    disasterData,
    dangerCount,
    activeIncidents,
    incidents,
    handleSelectIncidentForDetail,
    handleOpenReportModal,
    theme,
  } = useSiaga();

  // Load Current User Profile
  useEffect(() => {
    fetch("/api/auth/me", { cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) return null;
        const text = await res.text();
        return text ? JSON.parse(text) : null;
      })
      .then((data) => {
        if (data?.user) setCurrentUser(data.user);
        else if (data?.id) setCurrentUser(data);
      })
      .catch((err) => console.error("Failed to load user profile:", err));
  }, []);

  // Load Queue Items
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/incidents/shared-queue", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) return { data: [] };
        const text = await response.text();
        return text ? JSON.parse(text) : { data: [] };
      })
      .then((payload) => setQueue(payload.data || []))
      .catch((error) => {
        if (error instanceof Error && error.name !== "AbortError") setQueue([]);
      });
    return () => controller.abort();
  }, []);

  // Role Determination
  const roleInfo = useMemo(() => {
    const isAdmin = currentUser?.systemRole === "ADMIN";
    const isHO = currentUser?.scope === "HO" && !isAdmin;
    const r = (currentUser?.businessRole || currentUser?.role || "").toLowerCase();
    const isBMM = !isAdmin && !isHO && r === "bm";
    const isBES = !isAdmin && !isHO && r === "bes";
    const isBBS = !isAdmin && !isHO && r === "bbs";
    const isBMS = !isAdmin && !isHO && r === "bms";

    return { isAdmin, isHO, isBMM, isBES, isBBS, isBMS, roleCode: r };
  }, [currentUser]);

  // Derived Metrics
  const storeReports = useMemo(
    () => activeIncidents.filter((incident) => incident.locationKind !== "FACILITY"),
    [activeIncidents]
  );
  const facilityReports = useMemo(
    () => activeIncidents.filter((incident) => incident.locationKind === "FACILITY"),
    [activeIncidents]
  );
  const unassigned = useMemo(
    () => queue.filter((item) => !item.primary_pic_user_id).length,
    [queue]
  );
  const myTasks = useMemo(
    () => (currentUser?.id ? queue.filter((item) => item.primary_pic_user_id === currentUser.id).length : 0),
    [queue, currentUser]
  );

  const oldestWaiting = queue.length ? Math.max(...queue.map((item) => Number(item.waiting_seconds))) : 0;
  const oldestLabel =
    oldestWaiting >= 86400
      ? `${Math.floor(oldestWaiting / 86400)} hari`
      : oldestWaiting >= 3600
      ? `${Math.floor(oldestWaiting / 3600)} jam`
      : `${Math.floor(oldestWaiting / 60)} menit`;

  // Helper for categorizing report handling status
  const getHandlingStatusCategory = (inc: (typeof incidents)[number]) => {
    const s = inc.status?.toLowerCase() || "";
    if (s === "resolved" || s === "closed" || s === "selesai" || s === "confirmed_safe") {
      return "completed";
    }
    if (s === "waiting_approval" || s === "menunggu_approval" || s === "review" || s === "verifying" || s === "pending_bm_approval" || s === "pending_final_approval" || s === "awaiting_st") {
      return "waiting_approval";
    }
    if (inc.primaryPicUserId || s === "in_progress" || s === "handling" || s === "on_progress" || s === "in_maintenance" || s === "investigating") {
      return "on_progress";
    }
    return "unhandled";
  };

  // 3. POV BMM - 4 Core KPIs (Belum Ditangani, On Progress, Menunggu Approval, Selesai)
  const bmmKpis = useMemo(() => {
    let belumDitangani = 0;
    let onProgress = 0;
    let menungguApproval = 0;
    let selesai = 0;

    for (const inc of incidents) {
      const cat = getHandlingStatusCategory(inc);
      if (cat === "unhandled") belumDitangani++;
      else if (cat === "on_progress") onProgress++;
      else if (cat === "waiting_approval") menungguApproval++;
      else if (cat === "completed") selesai++;
    }

    return { belumDitangani, onProgress, menungguApproval, selesai };
  }, [incidents]);

  // 4. POV HO - National Summary KPIs & Monitoring Per Cabang
  const hoSummary = useMemo(() => {
    let total = incidents.length;
    let onProgress = 0;
    let menungguApproval = 0;
    let selesai = 0;

    for (const inc of incidents) {
      const cat = getHandlingStatusCategory(inc);
      if (cat === "on_progress") onProgress++;
      else if (cat === "waiting_approval") menungguApproval++;
      else if (cat === "completed") selesai++;
    }

    return { total, onProgress, menungguApproval, selesai };
  }, [incidents]);

  const hoBranchMonitoring = useMemo(() => {
    const now = new Date();
    const branchMap = new Map<
      string,
      {
        branch: string;
        total: number;
        belumDitangani: number;
        onProgress: number;
        menungguApproval: number;
        selesai: number;
        picCount: number;
        overdueCount: number;
      }
    >();

    for (const inc of incidents) {
      const branchName = inc.branch || "Nasional";
      if (!branchMap.has(branchName)) {
        branchMap.set(branchName, {
          branch: branchName,
          total: 0,
          belumDitangani: 0,
          onProgress: 0,
          menungguApproval: 0,
          selesai: 0,
          picCount: 0,
          overdueCount: 0,
        });
      }

      const row = branchMap.get(branchName)!;
      row.total++;
      const cat = getHandlingStatusCategory(inc);
      if (cat === "unhandled") row.belumDitangani++;
      else if (cat === "on_progress") row.onProgress++;
      else if (cat === "waiting_approval") row.menungguApproval++;
      else if (cat === "completed") row.selesai++;

      if (inc.primaryPicUserId || inc.primaryPicName) {
        row.picCount++;
      }

      // Indikator keterlambatan hanya jika target/deadline selesai tersedia dan terlewat
      if (inc.maintenanceTicket?.completedAt && cat !== "completed") {
        const targetDate = new Date(inc.maintenanceTicket.completedAt);
        if (!isNaN(targetDate.getTime()) && targetDate < now) {
          row.overdueCount++;
        }
      }
    }

    return Array.from(branchMap.values()).sort((a, b) => b.total - a.total);
  }, [incidents]);

  return (
    <div className="w-full">
      {/* MOBILE DASHBOARD (< 1024px) */}
      <div className="block lg:hidden">
        <MobileIncidentHome
          currentUser={currentUser}
          myTasksCount={myTasks}
          unassignedCount={unassigned}
          incidents={
            roleInfo.isBES
              ? facilityReports
              : roleInfo.isBMS
              ? storeReports
              : activeIncidents
          }
          onSelectIncident={handleSelectIncidentForDetail}
          onCreateReportClick={handleOpenReportModal}
          onViewAllClick={() => router.push("/reports")}
          theme={theme}
        />
      </div>

      {/* DESKTOP DASHBOARD (>= 1024px) */}
      <div className="hidden lg:block px-6 py-6 space-y-5 max-w-[1600px] mx-auto w-full">
        {/* Header: Contextual Role Welcome & Quick Actions */}
        <div className="flex items-center justify-between gap-4 bg-white dark:bg-slate-900 p-5 rounded-xl border border-slate-200 dark:border-slate-800 shadow-xs">
          <div>
            <div className="flex items-center gap-2">
              <span className="p-2 rounded-xl bg-[#1D5AA6]/10 text-[#1D5AA6]">
                {roleInfo.isAdmin ? (
                  <ShieldCheck className="w-5 h-5" />
                ) : roleInfo.isHO ? (
                  <Activity className="w-5 h-5 text-blue-700" />
                ) : roleInfo.isBMM ? (
                  <Users className="w-5 h-5 text-amber-600" />
                ) : roleInfo.isBES ? (
                  <Building2 className="w-5 h-5 text-emerald-600" />
                ) : (
                  <Store className="w-5 h-5" />
                )}
              </span>
              <h1 className="text-xl font-bold tracking-tight text-slate-900 dark:text-white">
                {roleInfo.isAdmin
                  ? "Administrasi SPARTA SIAGA"
                  : roleInfo.isHO
                  ? "Ringkasan Head Office"
                  : roleInfo.isBMM
                  ? `Monitoring Operasional Cabang ${currentUser?.branch || ""}`
                  : roleInfo.isBES
                  ? `Ringkasan Fasilitas • Cabang ${currentUser?.branch || ""}`
                  : `Ringkasan Toko • Cabang ${currentUser?.branch || ""}`}
              </h1>
            </div>
            <p className="text-xs text-slate-500 mt-1 ml-9">
              {roleInfo.isAdmin
                ? "Manajemen hak akses pengguna cabang dan pemantauan integritas laporan insiden."
                : roleInfo.isHO
                ? "Pemantauan komprehensif seluruh gerai dan fasilitas nasional (Read-Only)."
                : roleInfo.isBMM
                ? "Pengawasan 4 tahapan penanganan: Belum Ditangani, On Progress, Menunggu Approval, dan Selesai."
                : roleInfo.isBES
                ? "Penanganan laporan insiden khusus DC, Warehouse, Depo, Bulky, dan Store Hub."
                : "Penanganan laporan insiden gerai toko resmi Alfamart di wilayah cabang Anda."}
            </p>
          </div>

          {/* Contextual Action Buttons */}
          <div className="flex items-center gap-3">
            {roleInfo.isBMM && (
              <Link
                href="/reports"
                className="px-4 py-2.5 bg-amber-600 text-white rounded-xl text-xs font-bold hover:bg-amber-700 transition-colors flex items-center gap-2 shadow-xs"
              >
                <ClipboardList className="w-4 h-4" />
                <span>Pusat Laporan Cabang ({activeIncidents.length})</span>
              </Link>
            )}

            {roleInfo.isHO && (
              <Link
                href="/reports"
                className="px-4 py-2.5 bg-[#1D5AA6] text-white rounded-xl text-xs font-bold hover:bg-[#123B6D] transition-colors flex items-center gap-2 shadow-xs"
              >
                <FileText className="w-4 h-4" />
                <span>Seluruh Laporan Nasional ({incidents.length})</span>
              </Link>
            )}

            {(roleInfo.isBMS || roleInfo.isBES) && (
              <>
                <Link
                  href="/reports"
                  className="px-4 py-2.5 bg-slate-100 text-slate-700 hover:bg-slate-200 rounded-xl text-xs font-bold transition-colors flex items-center gap-2"
                >
                  <UserCheck className="w-4 h-4 text-blue-600" />
                  <span>Tugas Saya ({myTasks})</span>
                </Link>

                <button
                  onClick={() => handleOpenReportModal()}
                  className="px-4 py-2.5 bg-[#1D5AA6] text-white rounded-xl text-xs font-bold hover:bg-[#123B6D] transition-colors flex items-center gap-2 shadow-xs"
                >
                  <Plus className="w-4 h-4" />
                  <span>{roleInfo.isBES ? "Buat Laporan Fasilitas" : "Buat Laporan Toko"}</span>
                </button>
              </>
            )}
          </div>
        </div>

        {/* 3. BMM SIMPLIFIED 4 KPIS */}
        {roleInfo.isBMM && (
          <section aria-label="Monitoring Cabang 4 Status" className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <article className="rounded-2xl border border-amber-200 dark:border-amber-900/40 bg-amber-50/60 dark:bg-amber-950/20 p-5 shadow-xs">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-amber-800 dark:text-amber-400">
                  Belum Ditangani
                </span>
                <Clock3 className="w-5 h-5 text-amber-600" />
              </div>
              <p className="mt-3 text-3xl font-black text-amber-900 dark:text-amber-200">
                {bmmKpis.belumDitangani}
              </p>
              <p className="mt-1 text-[11px] text-amber-700 dark:text-amber-400">
                Memerlukan klaim PIC petugas lapangan
              </p>
            </article>

            <article className="rounded-2xl border border-blue-200 dark:border-blue-900/40 bg-blue-50/60 dark:bg-blue-950/20 p-5 shadow-xs">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-blue-800 dark:text-blue-400">
                  On Progress
                </span>
                <Wrench className="w-5 h-5 text-blue-600" />
              </div>
              <p className="mt-3 text-3xl font-black text-[#1D5AA6] dark:text-blue-300">
                {bmmKpis.onProgress}
              </p>
              <p className="mt-1 text-[11px] text-blue-700 dark:text-blue-400">
                Sedang dikerjakan oleh PIC terdaftar
              </p>
            </article>

            <article className="rounded-2xl border border-indigo-200 dark:border-indigo-900/40 bg-indigo-50/60 dark:bg-indigo-950/20 p-5 shadow-xs">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-indigo-800 dark:text-indigo-400">
                  Menunggu Approval
                </span>
                <ShieldAlert className="w-5 h-5 text-indigo-600" />
              </div>
              <p className="mt-3 text-3xl font-black text-indigo-900 dark:text-indigo-200">
                {bmmKpis.menungguApproval}
              </p>
              <p className="mt-1 text-[11px] text-indigo-700 dark:text-indigo-400">
                Menunggu review / persetujuan Anda
              </p>
            </article>

            <article className="rounded-2xl border border-emerald-200 dark:border-emerald-900/40 bg-emerald-50/60 dark:bg-emerald-950/20 p-5 shadow-xs">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-emerald-800 dark:text-emerald-400">
                  Selesai
                </span>
                <CheckCircle2 className="w-5 h-5 text-emerald-600" />
              </div>
              <p className="mt-3 text-3xl font-black text-emerald-900 dark:text-emerald-200">
                {bmmKpis.selesai}
              </p>
              <p className="mt-1 text-[11px] text-emerald-700 dark:text-emerald-400">
                Penanganan terverifikasi & ditutup
              </p>
            </article>
          </section>
        )}

        {/* 4. HO NATIONAL SUMMARY KPIS */}
        {roleInfo.isHO && (
          <section aria-label="Ringkasan Laporan Nasional" className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <article className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-xs">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400">
                  Total Laporan Nasional
                </span>
                <ClipboardList className="w-5 h-5 text-slate-700 dark:text-slate-300" />
              </div>
              <p className="mt-3 text-3xl font-black text-slate-900 dark:text-white">
                {hoSummary.total}
              </p>
              <p className="mt-1 text-[11px] text-slate-500">
                Seluruh gerai dan fasilitas se-Indonesia
              </p>
            </article>

            <article className="rounded-2xl border border-blue-200 dark:border-blue-900/40 bg-blue-50/50 dark:bg-blue-950/20 p-5 shadow-xs">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-blue-700 dark:text-blue-300">
                  On Progress Nasional
                </span>
                <Wrench className="w-5 h-5 text-blue-600" />
              </div>
              <p className="mt-3 text-3xl font-black text-[#1D5AA6] dark:text-blue-400">
                {hoSummary.onProgress}
              </p>
              <p className="mt-1 text-[11px] text-blue-600 dark:text-blue-400">
                Sedang ditangani oleh tim lapangan
              </p>
            </article>

            <article className="rounded-2xl border border-indigo-200 dark:border-indigo-900/40 bg-indigo-50/50 dark:bg-indigo-950/20 p-5 shadow-xs">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-indigo-700 dark:text-indigo-300">
                  Menunggu Approval
                </span>
                <ShieldAlert className="w-5 h-5 text-indigo-600" />
              </div>
              <p className="mt-3 text-3xl font-black text-indigo-900 dark:text-indigo-200">
                {hoSummary.menungguApproval}
              </p>
              <p className="mt-1 text-[11px] text-indigo-600 dark:text-indigo-400">
                Dalam proses verifikasi BM Cabang
              </p>
            </article>

            <article className="rounded-2xl border border-emerald-200 dark:border-emerald-900/40 bg-emerald-50/50 dark:bg-emerald-950/20 p-5 shadow-xs">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-300">
                  Selesai Nasional
                </span>
                <CheckCircle2 className="w-5 h-5 text-emerald-600" />
              </div>
              <p className="mt-3 text-3xl font-black text-emerald-900 dark:text-emerald-200">
                {hoSummary.selesai}
              </p>
              <p className="mt-1 text-[11px] text-emerald-600 dark:text-emerald-400">
                Pekerjaan tuntas dan terkonfirmasi
              </p>
            </article>
          </section>
        )}

        {/* 4. HO DEDICATED MONITORING PER CABANG TABLE */}
        {roleInfo.isHO && (
          <details className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            <summary className="cursor-pointer select-none text-sm font-semibold text-[#123B6D] dark:text-blue-300">Monitoring terperinci per cabang</summary>
            <section aria-label="Monitoring per Cabang" className="mt-4 p-2">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                  <Building className="w-5 h-5 text-[#1D5AA6]" />
                  <span>Monitoring Penanganan Per Cabang (Nasional)</span>
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Distribusi laporan operasional, PIC bertugas, dan indikator keterlambatan target selesai.
                </p>
              </div>
              <span className="px-2.5 py-1 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-[11px] font-bold rounded-lg border border-slate-200 dark:border-slate-700">
                {hoBranchMonitoring.length} Wilayah Cabang
              </span>
            </div>

            <div className="overflow-x-auto rounded-xl border border-slate-100 dark:border-slate-800">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 dark:bg-slate-800/70 text-slate-500 uppercase tracking-wider text-[10px] font-bold border-b border-slate-200 dark:border-slate-800">
                  <tr>
                    <th className="px-4 py-3">Nama Cabang</th>
                    <th className="px-4 py-3 text-center">Total Laporan</th>
                    <th className="px-4 py-3 text-center">Belum Ditangani</th>
                    <th className="px-4 py-3 text-center">On Progress</th>
                    <th className="px-4 py-3 text-center">Menunggu Approval</th>
                    <th className="px-4 py-3 text-center">Selesai</th>
                    <th className="px-4 py-3 text-center">Petugas / PIC</th>
                    <th className="px-4 py-3 text-center">Status Deadline</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {hoBranchMonitoring.map((b) => (
                    <tr key={b.branch} className="hover:bg-slate-50/60 dark:hover:bg-slate-800/40 transition-colors">
                      <td className="px-4 py-3 font-bold text-slate-900 dark:text-white flex items-center gap-2">
                        <MapPin className="w-3.5 h-3.5 text-[#1D5AA6]" />
                        <span>{b.branch}</span>
                      </td>
                      <td className="px-4 py-3 text-center font-bold text-slate-900 dark:text-white">
                        {b.total}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className={`px-2 py-0.5 rounded font-bold text-[11px] ${b.belumDitangani > 0 ? "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300" : "text-slate-400"}`}>
                          {b.belumDitangani}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className={`px-2 py-0.5 rounded font-bold text-[11px] ${b.onProgress > 0 ? "bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300" : "text-slate-400"}`}>
                          {b.onProgress}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className={`px-2 py-0.5 rounded font-bold text-[11px] ${b.menungguApproval > 0 ? "bg-indigo-100 text-indigo-800 dark:bg-indigo-950/60 dark:text-indigo-300" : "text-slate-400"}`}>
                          {b.menungguApproval}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center font-bold text-emerald-700 dark:text-emerald-400">
                        {b.selesai}
                      </td>
                      <td className="px-4 py-3 text-center font-medium text-slate-700 dark:text-slate-300">
                        {b.picCount} bertugas
                      </td>
                      <td className="px-4 py-3 text-center">
                        {b.overdueCount > 0 ? (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300 border border-rose-300">
                            {b.overdueCount} Terlambat
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400">
                            Sesuai Target
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                  {hoBranchMonitoring.length === 0 && (
                    <tr>
                      <td colSpan={8} className="px-4 py-6 text-center text-slate-400">
                        Belum ada data laporan per cabang.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            </section>
          </details>
        )}

        {/* DEFAULT KPI STRIP FOR BMS, BES & ADMIN */}
        {!roleInfo.isBMM && !roleInfo.isHO && (
          <>
            <div className="grid grid-cols-3 gap-3">
              {[
                { label: "Tugas Saya", value: myTasks },
                { label: "Laporan Aktif", value: roleInfo.isBES ? facilityReports.length : roleInfo.isBMS ? storeReports.length : activeIncidents.length },
                { label: "Belum Ditugaskan", value: unassigned },
              ].map(item => (
                <div key={item.label} className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
                  <p className="text-xs text-slate-500">{item.label}</p>
                  <p className="mt-2 text-2xl font-semibold text-slate-900 dark:text-white">{item.value}</p>
                </div>
              ))}
            </div>
            <details className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
              <summary className="cursor-pointer select-none text-sm font-semibold text-blue-700 dark:text-blue-300">Statistik tambahan</summary>
              <div className="mt-4 space-y-4">
            <IncidentKpiRow
              stats={incidentStats}
              dangerCount={dangerCount}
              selectedCategory={selectedCategory}
              onSelectCategory={setSelectedCategory}
            />

            <section
              className="grid grid-cols-2 gap-3 xl:grid-cols-5"
              aria-label="Ringkasan lokasi dan PIC"
            >
              {roleInfo.isBES ? (
                <>
                  <article className="rounded-xl border border-slate-200 bg-white p-4">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-xs font-semibold text-slate-500">Tugas PIC Saya</p>
                      <UserCheck className="h-4 w-4 text-[#1D5AA6]" />
                    </div>
                    <p className="mt-3 text-2xl font-bold tracking-tight text-[#1D5AA6]">{myTasks}</p>
                  </article>
                  <article className="rounded-xl border border-slate-200 bg-white p-4">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-xs font-semibold text-slate-500">Laporan Fasilitas</p>
                      <Building2 className="h-4 w-4 text-emerald-600" />
                    </div>
                    <p className="mt-3 text-2xl font-bold tracking-tight text-emerald-700">
                      {facilityReports.length}
                    </p>
                  </article>
                  <article className="rounded-xl border border-slate-200 bg-white p-4">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-xs font-semibold text-slate-500">Antrean Belum Ada PIC</p>
                      <UserRoundX className="h-4 w-4 text-amber-500" />
                    </div>
                    <p className="mt-3 text-2xl font-bold tracking-tight text-amber-600">{unassigned}</p>
                  </article>
                  <article className="rounded-xl border border-slate-200 bg-white p-4">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-xs font-semibold text-slate-500">Waktu Tunggu Terlama</p>
                      <Clock3 className="h-4 w-4 text-slate-400" />
                    </div>
                    <p className="mt-3 text-2xl font-bold tracking-tight text-slate-900">{oldestLabel}</p>
                  </article>
                  <article className="rounded-xl border border-slate-200 bg-white p-4">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-xs font-semibold text-slate-500">Peta & Episentrum</p>
                      <MapPin className="h-4 w-4 text-slate-400" />
                    </div>
                    <Link href="/monitoring" className="mt-3 block text-xs font-bold text-[#1D5AA6] hover:underline">
                      Buka Peta Monitoring →
                    </Link>
                  </article>
                </>
              ) : roleInfo.isBMS ? (
                <>
                  <article className="rounded-xl border border-slate-200 bg-white p-4">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-xs font-semibold text-slate-500">Tugas PIC Saya</p>
                      <UserCheck className="h-4 w-4 text-[#1D5AA6]" />
                    </div>
                    <p className="mt-3 text-2xl font-bold tracking-tight text-[#1D5AA6]">{myTasks}</p>
                  </article>
                  <article className="rounded-xl border border-slate-200 bg-white p-4">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-xs font-semibold text-slate-500">Laporan Toko Aktif</p>
                      <Store className="h-4 w-4 text-blue-600" />
                    </div>
                    <p className="mt-3 text-2xl font-bold tracking-tight text-slate-900">
                      {storeReports.length}
                    </p>
                  </article>
                  <article className="rounded-xl border border-slate-200 bg-white p-4">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-xs font-semibold text-slate-500">Antrean Bebas (Bisa Diambil)</p>
                      <UserRoundX className="h-4 w-4 text-amber-500" />
                    </div>
                    <p className="mt-3 text-2xl font-bold tracking-tight text-amber-600">{unassigned}</p>
                  </article>
                  <article className="rounded-xl border border-slate-200 bg-white p-4">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-xs font-semibold text-slate-500">Waktu Tunggu Terlama</p>
                      <Clock3 className="h-4 w-4 text-slate-400" />
                    </div>
                    <p className="mt-3 text-2xl font-bold tracking-tight text-slate-900">{oldestLabel}</p>
                  </article>
                  <article className="rounded-xl border border-slate-200 bg-white p-4">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-xs font-semibold text-slate-500">Peta & Episentrum</p>
                      <MapPin className="h-4 w-4 text-slate-400" />
                    </div>
                    <Link href="/monitoring" className="mt-3 block text-xs font-bold text-[#1D5AA6] hover:underline">
                      Buka Peta Monitoring →
                    </Link>
                  </article>
                </>
              ) : (
                [
                  { label: "Laporan Toko", value: storeReports.length, icon: Store },
                  { label: "Laporan Fasilitas", value: facilityReports.length, icon: Building2 },
                  { label: "Total Antrean Penugasan", value: queue.length, icon: Activity },
                  { label: "Belum Ditugaskan PIC", value: unassigned, icon: UserRoundX },
                  { label: "Waktu Tunggu Terlama", value: oldestLabel, icon: Clock3 },
                ].map((item) => (
                  <article key={item.label} className="rounded-xl border border-slate-200 bg-white p-4">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-xs font-semibold text-slate-500">{item.label}</p>
                      <item.icon className="h-4 w-4 text-[#1D5AA6]" />
                    </div>
                    <p className="mt-3 text-2xl font-bold tracking-tight text-slate-950">{item.value}</p>
                  </article>
                ))
              )}
            </section>
              </div>
            </details>
          </>
        )}

        {/* MAIN HERO: ACTIVE SITUATION PANEL */}
        {!roleInfo.isHO && <div className="flex flex-col lg:flex-row gap-6">
          <div className="w-full bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-6 flex flex-col shadow-xs">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-bold text-[#123B6D] dark:text-blue-400 uppercase tracking-wider flex items-center gap-2">
                <Activity className="w-4 h-4" />
                <span>Situasi Gempa & Kebencanaan Terkini</span>
              </h3>
              <Link
                href="/monitoring"
                className="text-xs font-bold text-[#1D5AA6] hover:text-[#123B6D] flex items-center gap-1"
              >
                <span>Lihat Peta Spasial</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </Link>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Left Column: Recent Alert */}
              <div>
                {disasterData?.latestBmkgEarthquake ? (
                  <div className="bg-[#D9272E]/10 border border-[#D9272E]/20 rounded-xl p-4 h-full">
                    <div className="flex items-center gap-2 text-[#D9272E] font-bold text-sm mb-2">
                      <Activity className="w-4 h-4" />
                      Gempa Terkini
                    </div>
                    <div className="text-2xl font-black text-[#D9272E] mb-1">
                      M {disasterData.latestBmkgEarthquake.magnitude}
                    </div>
                    <div className="text-xs font-semibold text-slate-800 dark:text-slate-200 mb-2">
                      {disasterData.latestBmkgEarthquake.title}
                    </div>
                    <div className="text-[10px] text-slate-500 mb-4">
                      {disasterData.latestBmkgEarthquake.time} • Kedalaman{" "}
                      {disasterData.latestBmkgEarthquake.depth}
                    </div>

                    <div className="bg-white dark:bg-slate-800 rounded-lg p-3 text-xs border border-[#D9272E]/10">
                      <div className="text-slate-500 mb-1">Estimasi Area Dampak SPARTA</div>
                      <div className="font-bold text-slate-800 dark:text-slate-100 text-lg">
                        {dangerCount} Toko dalam pantauan
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="bg-[#16A34A]/10 border border-[#16A34A]/20 rounded-xl p-6 h-full flex flex-col justify-center text-center">
                    <div className="text-[#16A34A] font-bold text-sm mb-1">Kondisi Aman</div>
                    <div className="text-[10px] text-slate-500">
                      Tidak ada peringatan bencana aktif saat ini.
                    </div>
                  </div>
                )}
              </div>

              {/* Right Column: Laporan Baru */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h4 className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                    {roleInfo.isBES
                      ? "Laporan Fasilitas Terbaru"
                      : roleInfo.isBMS
                      ? "Laporan Toko Terbaru"
                      : "Laporan Baru Masuk"}
                  </h4>
                  <Link
                    href="/reports"
                    className="text-[11px] font-bold text-[#1D5AA6] hover:underline"
                  >
                    Semua Laporan →
                  </Link>
                </div>

                {(roleInfo.isBES ? facilityReports : roleInfo.isBMS ? storeReports : activeIncidents)
                  .slice(0, 3)
                  .map((inc) => (
                    <div
                      key={inc.id}
                      onClick={() => handleSelectIncidentForDetail(inc)}
                      className="group cursor-pointer p-3 mb-2 rounded-xl border border-slate-100 dark:border-slate-800 hover:border-[#1D5AA6]/30 hover:bg-[#EAF2FB] dark:hover:bg-blue-900/10 transition-colors"
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-bold text-slate-900 dark:text-white truncate max-w-[200px] flex items-center gap-1.5">
                          {inc.locationKind === "FACILITY" && (
                            <span className="text-[9px] font-extrabold bg-emerald-100 text-emerald-800 px-1 py-0.5 rounded">
                              DC
                            </span>
                          )}
                          <span className="truncate">{inc.storeName}</span>
                        </span>
                        <span
                          className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${
                            inc.status === "verifying" || inc.status === "pending_confirmation"
                              ? "bg-[#F59E0B]/10 text-[#F59E0B]"
                              : "bg-[#EAF2FB] text-[#1D5AA6]"
                          }`}
                        >
                          {inc.status === "verifying" || inc.status === "pending_confirmation"
                            ? "Verifikasi"
                            : "Penanganan"}
                        </span>
                      </div>
                      <div className="text-[10px] text-slate-500 truncate">
                        {inc.disasterType === "flood"
                          ? "Banjir"
                          : inc.disasterType === "earthquake"
                          ? "Gempa"
                          : inc.disasterType}{" "}
                        • {inc.branch} • {inc.date}
                      </div>
                    </div>
                  ))}

                {(roleInfo.isBES ? facilityReports : roleInfo.isBMS ? storeReports : activeIncidents)
                  .length === 0 && (
                  <div className="text-xs text-slate-400 text-center py-8">
                    Belum ada laporan aktif dalam kategori ini.
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>}

        {/* Secondary report table stays available on demand. */}
        {!roleInfo.isHO && <details className="rounded-xl border border-slate-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-900">
          <summary className="cursor-pointer select-none text-sm font-semibold text-blue-700 dark:text-blue-300">Lihat seluruh laporan yang perlu perhatian</summary>
        <div className="pt-4">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-lg font-bold text-slate-900 dark:text-white">
                {roleInfo.isHO
                  ? "Daftar Seluruh Laporan Insiden Nasional"
                  : roleInfo.isBMM
                  ? `Daftar Laporan Operasional Cabang ${currentUser?.branch || ""}`
                  : roleInfo.isBES
                  ? "Daftar Laporan Fasilitas Memerlukan Perhatian"
                  : "Daftar Laporan Gerai Toko Memerlukan Perhatian"}
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                {roleInfo.isHO
                  ? "Pemantauan status penanganan, PIC penanggung jawab, progres fisik, dan target selesai nasional (Read-Only)."
                  : roleInfo.isBMM
                  ? "Pantau status penanganan, progres, waktu update, target selesai, dan berikan review/approval."
                  : roleInfo.isBES
                  ? "Menampilkan insiden aktif di Distribution Center, Warehouse, Depo, dan Bulky."
                  : "Menampilkan insiden aktif di Gerai Toko Alfamart cabang Anda."}
              </p>
            </div>

            <Link
              href="/reports"
              className="px-3.5 py-2 text-xs font-bold text-[#1D5AA6] bg-blue-50 hover:bg-blue-100 rounded-xl transition-colors"
            >
              Lihat Pusat Laporan →
            </Link>
          </div>

          <ActiveIncidentsTable
            incidents={
              roleInfo.isHO
                ? incidents
                : roleInfo.isBES
                ? facilityReports
                : roleInfo.isBMS
                ? storeReports
                : activeIncidents
            }
            onSelectIncident={handleSelectIncidentForDetail}
            onCreateReportClick={handleOpenReportModal}
            hideAction={false}
            currentUser={currentUser}
            onClaimSuccess={() => {
              // Refresh router to refetch data
              router.refresh();
            }}
          />
        </div>
        </details>}
      </div>
    </div>
  );
}
