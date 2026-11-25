"use client";

import React, { useState, useEffect } from "react";
import { toast } from "sonner";
import {
  Search,
  UserCheck,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Plus,
  Trash2,
  Clock,
  Calendar,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  RefreshCw,
  Building,
  History,
  X,
  ChevronDown,
  ChevronUp,
  Info,
  Sliders,
  Store,
  User as UserIcon,
} from "lucide-react";
import {
  PermissionKey,
  PermissionEffect,
  UserPermissionOverrideRecord,
  PermissionAuditLogRecord,
  PermissionDefinition,
  ROLE_PERMISSION_CATALOG,
  evaluateOverridePolicyCompliance,
} from "@/types/permission";
import { CANONICAL_HUMAN_ROLES } from "@/lib/role-catalog";
import { AddOverrideModal } from "./add-override-modal";

interface UserSummary {
  id: string;
  nik: string | null;
  name: string;
  email: string | null;
  systemRole: "ADMIN" | "USER";
  businessRole: string | null;
  scope: "HO" | "BRANCH" | null;
  branch: string | null;
  branchCode?: string | null;
}

export function UserOverrideTab() {
  const [users, setUsers] = useState<UserSummary[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedUser, setSelectedUser] = useState<UserSummary | null>(null);
  const [inheritedPermissions, setInheritedPermissions] = useState<Record<PermissionKey, PermissionEffect> | null>(null);
  const [overrides, setOverrides] = useState<UserPermissionOverrideRecord[]>([]);
  const [auditLogs, setAuditLogs] = useState<PermissionAuditLogRecord[]>([]);
  const [definitions, setDefinitions] = useState<PermissionDefinition[]>([]);
  const [loadingUser, setLoadingUser] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  
  // State to toggle expandable detail for role default permissions (Section I)
  const [showRolePermissionsDetail, setShowRolePermissionsDetail] = useState(false);
  // State to toggle history of inactive/revoked overrides
  const [showHistoryOverrides, setShowHistoryOverrides] = useState(false);
  // State to toggle audit trail
  const [showAuditTrail, setShowAuditTrail] = useState(false);

  useEffect(() => {
    fetchUsersList();
  }, []);

  const fetchUsersList = async () => {
    try {
      const res = await fetch("/api/admin/users");
      if (res.ok) {
        const json = await res.json();
        // Filter out System Admins (Section F: System Admin tidak menggunakan Akses Khusus)
        const businessUsers = (json.data || []).filter((u: any) => u.systemRole !== "ADMIN");
        setUsers(businessUsers);
        if (businessUsers.length > 0 && !selectedUser) {
          handleSelectUser(businessUsers[0]);
        }
      }
    } catch (err) {
      console.error("Failed to load users:", err);
    }
  };

  const handleSelectUser = async (u: UserSummary) => {
    setSelectedUser(u);
    setLoadingUser(true);
    try {
      const res = await fetch(`/api/admin/permissions/users/${u.id}`);
      if (!res.ok) throw new Error("Gagal mengambil data permission user");
      const json = await res.json();
      setInheritedPermissions(json.data.inheritedPermissions);
      setOverrides(json.data.overrides || []);
      setAuditLogs(json.data.auditLogs || []);
      setDefinitions(json.data.definitions || []);
    } catch (err: any) {
      toast.error(err.message || "Gagal memuat permission user");
    } finally {
      setLoadingUser(false);
    }
  };

  const handleRevokeOverride = async (override: UserPermissionOverrideRecord) => {
    if (!selectedUser) return;
    const actionText = override.effect === "ALLOW" ? "mencabut akses khusus" : "mencabut pembatasan";
    const confirmed = window.confirm(`Apakah Anda yakin ingin ${actionText} ini?`);
    if (!confirmed) return;

    setRevokingId(override.id);

    try {
      const res = await fetch(`/api/admin/permissions/users/${selectedUser.id}/${override.id}`, {
        method: "DELETE",
      });

      if (!res.ok) {
        const errJson = await res.json();
        throw new Error(errJson.error || "Gagal mencabut pengaturan");
      }

      toast.success(override.effect === "ALLOW" ? "Akses khusus berhasil dicabut" : "Pembatasan berhasil dicabut");
      // Refresh user permissions
      handleSelectUser(selectedUser);
    } catch (err: any) {
      toast.error("Gagal memperbarui akses khusus", { description: err.message || "Gagal mencabut pengaturan" });
    } finally {
      setRevokingId(null);
    }
  };

  const filteredUsers = users.filter((u) => {
    const q = searchQuery.toLowerCase();
    return (
      u.name.toLowerCase().includes(q) ||
      (u.nik && u.nik.toLowerCase().includes(q)) ||
      (u.businessRole && u.businessRole.toLowerCase().includes(q)) ||
      (u.branch && u.branch.toLowerCase().includes(q)) ||
      (u.branchCode && u.branchCode.toLowerCase().includes(q))
    );
  });

  const getDefLabel = (key: PermissionKey) => {
    const d = definitions.find((def) => def.key === key);
    return d ? d.label : key;
  };

  const getBusinessRoleLabel = (roleKey: string | null) => {
    if (!roleKey) return "Tanpa Role";
    const role = CANONICAL_HUMAN_ROLES.find((r) => r.key === roleKey);
    return role ? role.label : roleKey.toUpperCase();
  };

  const isOverrideActive = (ov: UserPermissionOverrideRecord) => {
    if (ov.revokedAt) return false;
    const now = new Date();
    if (ov.startsAt && new Date(ov.startsAt) > now) return false;
    if (ov.expiresAt && new Date(ov.expiresAt) <= now) return false;
    return true;
  };

  const formatDateTime = (isoString?: string | null) => {
    if (!isoString) return "-";
    try {
      const d = new Date(isoString);
      return d.toLocaleDateString("id-ID", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      }) + " WIB";
    } catch {
      return isoString;
    }
  };

  // Active vs Inactive Overrides
  const activeOverrides = overrides.filter(isOverrideActive);
  const inactiveOverrides = overrides.filter((ov) => !isOverrideActive(ov));

  const policyConflictOverrides = activeOverrides.filter((ov) => {
    const comp = ov.policyCompliance || evaluateOverridePolicyCompliance(ov, selectedUser || undefined);
    return comp.statusCode === "POLICY_CONFLICT";
  });
  const effectiveActiveOverrides = activeOverrides.filter((ov) => {
    const comp = ov.policyCompliance || evaluateOverridePolicyCompliance(ov, selectedUser || undefined);
    return comp.statusCode !== "POLICY_CONFLICT";
  });

  // Role Catalog for the selected user's business role
  const selectedRoleCatalog: readonly PermissionKey[] =
    selectedUser?.businessRole
      ? ROLE_PERMISSION_CATALOG[selectedUser.businessRole.toLowerCase()] || []
      : [];

  // Role Default Active Count (Section I: hanya menghitung permission bawaan role tersebut)
  const roleDefaultActiveCount =
    inheritedPermissions && selectedRoleCatalog.length > 0
      ? selectedRoleCatalog.filter((key) => inheritedPermissions[key] === "ALLOW").length
      : 0;

  const categories = ["LAPORAN", "NOTIFIKASI", "MANAGEMENT", "ESTIMASI"] as const;

  return (
    <div className="space-y-6">
      {/* Bagian Atas: Cari User (Section H) */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-xs flex flex-col md:flex-row md:items-center gap-4">
        <div className="flex-1 relative">
          <label className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider block mb-1.5">
            Cari User
          </label>
          <div className="relative">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Cari NIK / Nama User / Role / Cabang..."
              className="w-full pl-10 pr-4 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl text-xs font-medium text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:outline-hidden"
            />
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
          </div>
        </div>

        {/* Quick User Selector Dropdown */}
        <div className="md:w-80">
          <label className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider block mb-1.5">
            Pilih User ({filteredUsers.length})
          </label>
          <select
            value={selectedUser?.id || ""}
            onChange={(e) => {
              const u = users.find((x) => x.id === e.target.value);
              if (u) handleSelectUser(u);
            }}
            className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl text-xs font-semibold text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:outline-hidden"
          >
            {filteredUsers.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name} ({u.nik || "---"}) — {getBusinessRoleLabel(u.businessRole)}
              </option>
            ))}
          </select>
        </div>
      </div>

      {loadingUser ? (
        <div className="flex flex-col items-center justify-center p-12 space-y-3">
          <RefreshCw className="w-6 h-6 animate-spin text-blue-500" />
          <p className="text-sm text-slate-500 dark:text-slate-400">Memuat detail akses khusus pengguna...</p>
        </div>
      ) : selectedUser ? (
        <div className="space-y-6">
          {/* Info Banner: Penjelasan Akses Khusus (Section Q) */}
          <div className="bg-blue-50/70 dark:bg-blue-950/20 border border-blue-200/80 dark:border-blue-900/40 rounded-xl p-4 flex items-start gap-3">
            <Info className="w-5 h-5 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
            <div className="text-xs text-blue-900 dark:text-blue-300 leading-relaxed">
              <p className="font-bold">Akses Khusus Pengguna</p>
              <p>
                Akses khusus hanya berlaku untuk user yang dipilih dan tidak mengubah role utamanya.
                Digunakan untuk kebutuhan operasional khusus, penugasan backup cabang, atau pembatasan sementara.
              </p>
            </div>
          </div>

          {/* Ringkasan User (Section H) & Tombol Tambah Akses Khusus (Section K) */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-xs">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-2xl bg-blue-500/10 text-blue-600 dark:text-blue-400 flex items-center justify-center font-black text-lg">
                  {selectedUser.name.slice(0, 2).toUpperCase()}
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-base font-bold text-slate-900 dark:text-white">
                      {selectedUser.name}
                    </h3>
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700 font-mono">
                      NIK: {selectedUser.nik || "---"}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 mt-1 text-xs text-slate-500 dark:text-slate-400">
                    <span className="font-semibold text-blue-600 dark:text-blue-400">
                      Role: {getBusinessRoleLabel(selectedUser.businessRole)}
                    </span>
                    <span>•</span>
                    <span className="flex items-center gap-1">
                      <Building className="w-3 h-3 text-slate-400" />
                      Scope: {selectedUser.scope || "-"}
                    </span>
                    {selectedUser.branch && (
                      <>
                        <span>•</span>
                        <span className="flex items-center gap-1">
                          <Store className="w-3 h-3 text-slate-400" />
                          Branch: {selectedUser.branch}
                        </span>
                      </>
                    )}
                  </div>
                </div>
              </div>

              {/* Button Tambah Akses Khusus (Section K) */}
              <div>
                <button
                  onClick={() => setIsAddModalOpen(true)}
                  className="w-full sm:w-auto px-4 py-2.5 rounded-xl font-bold text-xs bg-blue-600 hover:bg-blue-700 text-white flex items-center justify-center gap-2 shadow-sm transition-all"
                >
                  <Plus className="w-4 h-4 shrink-0" />
                  <span>Tambah Akses Khusus</span>
                </button>
              </div>
            </div>
          </div>

          {/* Ringkasan Ringkas: Hak Bawaan vs Akses Khusus (Section I) */}
          {/* TIDAK MENAMPILKAN FULL MATRIX BESAR SECARA DEFAULT */}
          <div className="bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 shadow-xs">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-6">
                <div>
                  <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">
                    Hak Akses Bawaan
                  </span>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-base font-black text-slate-800 dark:text-slate-200">
                      {roleDefaultActiveCount} aktif
                    </span>
                    <span className="text-xs text-slate-500 dark:text-slate-400">
                      (dari role {selectedUser.businessRole || "User"})
                    </span>
                  </div>
                </div>

                <div className="w-px h-8 bg-slate-200 dark:bg-slate-700" />

                <div>
                  <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">
                    Akses Khusus Aktif
                  </span>
                  <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                    <span className={`text-base font-black ${
                      effectiveActiveOverrides.length > 0 ? "text-blue-600 dark:text-blue-400" : "text-slate-700 dark:text-slate-300"
                    }`}>
                      {effectiveActiveOverrides.length}
                    </span>
                    <span className="text-xs text-slate-500 dark:text-slate-400">
                      efektif berlaku
                    </span>
                    {policyConflictOverrides.length > 0 && (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-200 border border-amber-300 dark:border-amber-700">
                        {policyConflictOverrides.length} bertentangan kebijakan
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* Link / Expandable Detail: Lihat Hak Akses Role (Section I) */}
              <div>
                <button
                  type="button"
                  onClick={() => setShowRolePermissionsDetail((prev) => !prev)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-white dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-700 transition-colors"
                >
                  <Shield className="w-3.5 h-3.5 text-blue-500" />
                  <span>{showRolePermissionsDetail ? "Sembunyikan Hak Akses Role" : "Lihat Hak Akses Role"}</span>
                  {showRolePermissionsDetail ? (
                    <ChevronUp className="w-3.5 h-3.5" />
                  ) : (
                    <ChevronDown className="w-3.5 h-3.5" />
                  )}
                </button>
              </div>
            </div>

            {/* Collapsible Role Default Permissions Detail (Only role catalog permissions) */}
            {showRolePermissionsDetail && (
              <div className="mt-4 pt-4 border-t border-slate-200 dark:border-slate-700 animate-in fade-in">
                <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">
                  Berikut daftar hak akses default yang berlaku dari role <strong>{selectedUser.businessRole}</strong>:
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
                  {definitions
                    .filter((def) => selectedRoleCatalog.includes(def.key))
                    .map((def) => {
                      const isAllowed = inheritedPermissions?.[def.key] === "ALLOW";
                      return (
                        <div
                          key={def.key}
                          className={`p-2.5 rounded-xl border text-xs flex items-center justify-between ${
                            isAllowed
                              ? "bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-200"
                              : "bg-slate-100/50 dark:bg-slate-900/40 border-slate-200/60 dark:border-slate-800/60 text-slate-400 opacity-60"
                          }`}
                        >
                          <span className="truncate pr-2 font-medium">{def.label}</span>
                          <span
                            className={`px-1.5 py-0.5 rounded text-[10px] font-black shrink-0 ${
                              isAllowed
                                ? "bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300"
                                : "bg-slate-200 dark:bg-slate-700 text-slate-500 dark:text-slate-400"
                            }`}
                          >
                            {isAllowed ? "ON" : "OFF"}
                          </span>
                        </div>
                      );
                    })}
                </div>
              </div>
            )}
          </div>

          {/* Section J: DAFTAR AKSES KHUSUS (FOKUS UTAMA TAB INI) */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden shadow-xs">
            <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <h4 className="text-xs font-bold text-slate-900 dark:text-white uppercase tracking-wider flex items-center gap-2">
                  <span>Akses Khusus Aktif</span>
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800">
                    {activeOverrides.length}
                  </span>
                </h4>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  Daftar hak akses khusus atau pembatasan yang saat ini aktif untuk pengguna ini.
                </p>
              </div>

              {inactiveOverrides.length > 0 && (
                <button
                  type="button"
                  onClick={() => setShowHistoryOverrides((prev) => !prev)}
                  className="text-xs text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 flex items-center gap-1 font-semibold"
                >
                  <History className="w-3.5 h-3.5" />
                  <span>
                    {showHistoryOverrides ? "Sembunyikan Riwayat Kadaluarsa/Dicabut" : `Lihat Riwayat (${inactiveOverrides.length})`}
                  </span>
                </button>
              )}
            </div>

            {/* Empty State jika belum ada Akses Khusus */}
            {activeOverrides.length === 0 ? (
              <div className="p-10 text-center space-y-3">
                <div className="w-12 h-12 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-400 flex items-center justify-center mx-auto">
                  <Sliders className="w-6 h-6" />
                </div>
                <div className="space-y-1">
                  <p className="text-sm font-semibold text-slate-700 dark:text-slate-300">
                    Tidak ada akses khusus aktif
                  </p>
                  <p className="text-xs text-slate-400 max-w-md mx-auto">
                    Pengguna saat ini hanya menggunakan hak akses bawaan dari role miliknya. Klik tombol &ldquo;Tambah Akses Khusus&rdquo; jika ingin memberikan izin tambahan atau pembatasan.
                  </p>
                </div>
              </div>
            ) : (
              /* Grouped Card / List Akses Khusus Aktif (Section J & W) */
              <div className="divide-y divide-slate-100 dark:divide-slate-800">
                {activeOverrides.map((ov) => {
                  const compliance = ov.policyCompliance || evaluateOverridePolicyCompliance(ov, selectedUser || undefined);
                  const isRevoked = compliance.statusCode === "REVOKED";
                  const isExpired = compliance.statusCode === "EXPIRED";
                  const isPolicyConflict = compliance.statusCode === "POLICY_CONFLICT";

                  const statusBadgeText = compliance.statusBadgeText;
                  const statusBadgeClass = compliance.statusBadgeClass;

                  // Cakupan Text (Section J & M)
                  let scopeDisplayText = "Scope User";
                  if (ov.scopeType === "SPECIFIC_BRANCH") {
                    scopeDisplayText = `Branch ${ov.branchCode || "N/A"}`;
                  } else if (ov.scopeType === "ALL_BRANCHES") {
                    scopeDisplayText = "Seluruh Cabang (Nasional)";
                  } else if (ov.scopeType === "OWN_SCOPE") {
                    scopeDisplayText = `Cabang Pengguna (${selectedUser.branch || selectedUser.scope || "N/A"})`;
                  }

                  return (
                    <div
                      key={ov.id}
                      className={`p-5 flex flex-col md:flex-row md:items-center justify-between gap-4 transition-colors ${
                        isPolicyConflict
                          ? "bg-amber-50/40 dark:bg-amber-950/20 border-l-4 border-amber-500 hover:bg-amber-50/60"
                          : "bg-white dark:bg-slate-900 hover:bg-slate-50/50 dark:hover:bg-slate-800/30"
                      }`}
                    >
                      <div className="space-y-2 flex-1 min-w-0">
                        {/* Title & Status Badge */}
                        <div className="flex flex-wrap items-center gap-2.5">
                          <span className="font-bold text-sm text-slate-900 dark:text-white">
                            {getDefLabel(ov.permissionKey)}
                          </span>

                          {/* Status Badge */}
                          <span
                            className={`px-2.5 py-0.5 rounded-full text-[10px] font-black border ${statusBadgeClass}`}
                          >
                            Status: {statusBadgeText}
                          </span>
                        </div>

                        {/* Policy Conflict Alert Warning */}
                        {isPolicyConflict && (
                          <div className="p-3 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 rounded-xl text-amber-900 dark:text-amber-200 text-xs flex items-start gap-2.5">
                            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
                            <div className="space-y-0.5">
                              <span className="font-bold block">Konfigurasi Tidak Berlaku Secara Efektif</span>
                              <p className="text-[11px] text-amber-800 dark:text-amber-300/90 leading-relaxed">
                                {compliance.policyWarning || "Hak akses operasional tidak diizinkan menggunakan cakupan seluruh cabang (ALL_BRANCHES). Tindakan operasional diblokir oleh sistem demi kepatuhan isolasi cabang."}
                              </p>
                            </div>
                          </div>
                        )}

                        {/* Detail Info: Cakupan, Masa Berlaku */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs text-slate-600 dark:text-slate-300">
                          <div className="flex items-center gap-1.5">
                            <Building className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                            <span>
                              <strong>Cakupan:</strong> {scopeDisplayText}
                            </span>
                          </div>

                          <div className="flex items-center gap-1.5">
                            <Clock className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                            <span>
                              <strong>Berlaku Sampai:</strong>{" "}
                              {ov.expiresAt ? formatDateTime(ov.expiresAt) : "Permanen"}
                            </span>
                          </div>
                        </div>

                        {/* Alasan & Diberikan oleh (Section J) */}
                        <div className="text-xs text-slate-500 dark:text-slate-400 space-y-0.5 pt-1">
                          <div>
                            <strong>Alasan:</strong> &ldquo;{ov.reason}&rdquo;
                          </div>
                          <div className="text-[11px] text-slate-400 dark:text-slate-500">
                            Diberikan oleh: {ov.grantedBy || "Admin SPARTA SIAGA"}
                          </div>
                        </div>
                      </div>

                      {/* Action Button */}
                      <div className="shrink-0 flex items-center">
                        <button
                          type="button"
                          onClick={() => handleRevokeOverride(ov)}
                          disabled={revokingId === ov.id}
                          className={`px-4 py-2 rounded-xl text-xs font-bold border flex items-center gap-1.5 transition-colors disabled:opacity-50 ${
                            isPolicyConflict
                              ? "border-amber-300 dark:border-amber-800 text-amber-800 dark:text-amber-300 bg-amber-50 hover:bg-amber-100 dark:bg-amber-950/40"
                              : ov.effect === "ALLOW"
                              ? "border-red-200 dark:border-red-900/60 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40"
                              : "border-amber-200 dark:border-amber-900/60 text-amber-700 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-950/40"
                          }`}
                        >
                          {revokingId === ov.id ? (
                            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <Trash2 className="w-3.5 h-3.5" />
                          )}
                          <span>
                            {isPolicyConflict
                              ? "Cabut Pengaturan Tidak Sesuai"
                              : ov.effect === "ALLOW"
                              ? "Cabut Akses"
                              : "Cabut Pembatasan"}
                          </span>
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Riwayat Kadaluarsa / Dicabut (Collapsible jika dipilih) */}
            {showHistoryOverrides && inactiveOverrides.length > 0 && (
              <div className="border-t border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50">
                <div className="px-5 py-3 bg-slate-100/70 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wider">
                    Riwayat Akses Khusus Yang Sudah Berakhir / Dicabut ({inactiveOverrides.length})
                  </span>
                </div>
                <div className="divide-y divide-slate-100 dark:divide-slate-800">
                  {inactiveOverrides.map((ov) => {
                    const isRevoked = !!ov.revokedAt;
                    const badgeText = isRevoked ? "DICABUT" : "KADALUARSA";
                    const badgeClass = isRevoked
                      ? "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-700"
                      : "bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800";

                    return (
                      <div key={ov.id} className="p-4 opacity-70 text-xs space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-slate-800 dark:text-slate-200">
                            {getDefLabel(ov.permissionKey)}
                          </span>
                          <span className={`px-2 py-0.5 rounded-full text-[9px] font-black border ${badgeClass}`}>
                            {badgeText}
                          </span>
                        </div>
                        <div className="text-slate-500">
                          Alasan: &ldquo;{ov.reason}&rdquo; • Berlaku s/d: {formatDateTime(ov.expiresAt)}
                        </div>
                        {isRevoked && ov.revokedBy && (
                          <div className="text-[10px] text-red-500">
                            Dicabut oleh: {ov.revokedBy} pada {formatDateTime(ov.revokedAt)}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Section: Audit Trail Collapsible (Optional) */}
          {auditLogs.length > 0 && (
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden shadow-xs">
              <button
                type="button"
                onClick={() => setShowAuditTrail((prev) => !prev)}
                className="w-full px-5 py-3.5 flex items-center justify-between text-left hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors"
              >
                <div className="flex items-center gap-2">
                  <History className="w-4 h-4 text-slate-400" />
                  <h4 className="text-xs font-bold text-slate-800 dark:text-slate-200 uppercase tracking-wider">
                    Log Riwayat Perubahan Permission ({auditLogs.length})
                  </h4>
                </div>
                {showAuditTrail ? (
                  <ChevronUp className="w-4 h-4 text-slate-400" />
                ) : (
                  <ChevronDown className="w-4 h-4 text-slate-400" />
                )}
              </button>

              {showAuditTrail && (
                <div className="p-5 pt-0 space-y-2 border-t border-slate-100 dark:border-slate-800 divide-y divide-slate-100 dark:divide-slate-800">
                  {auditLogs.map((log) => (
                    <div
                      key={log.id}
                      className="pt-2 text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-1"
                    >
                      <div>
                        <span className="font-bold text-slate-800 dark:text-slate-200">{log.action}:</span>{" "}
                        <span className="text-slate-600 dark:text-slate-400">
                          {log.permissionKey} ({log.effect})
                        </span>
                        {log.reason && (
                          <span className="text-slate-400 ml-1.5">&ldquo;{log.reason}&rdquo;</span>
                        )}
                      </div>
                      <div className="text-[11px] text-slate-400 shrink-0">
                        Oleh: {log.actorName || "Admin"} • {formatDateTime(log.createdAt)}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      ) : null}

      {/* Add Override Modal (Section K) */}
      {selectedUser && (
        <AddOverrideModal
          isOpen={isAddModalOpen}
          onClose={() => setIsAddModalOpen(false)}
          userId={selectedUser.id}
          userName={selectedUser.name}
          userRole={selectedUser.businessRole}
          userScope={selectedUser.scope}
          userBranch={selectedUser.branch}
          onSuccess={() => {
            toast.success("Akses khusus berhasil ditambahkan");
            handleSelectUser(selectedUser);
          }}
        />
      )}
    </div>
  );
}
