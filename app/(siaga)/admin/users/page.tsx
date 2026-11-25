"use client";

import React, { useEffect, useState, useMemo } from "react";
import { toast } from "sonner";
import { AppDialog } from "@/components/shared/app-dialog";
import {
  ShieldAlert,
  UserCog,
  X,
  Search,
  Loader2,
  Eye,
  EyeOff,
  KeyRound,
  User as UserIcon,
  Shield,
  Sliders,
  Lock,
  AlertTriangle,
  RotateCcw,
  CheckCircle2,
  XCircle,
  ShieldCheck,
  Globe,
  ChevronLeft,
  ChevronRight,
  Info,
  Store,
  ExternalLink,
} from "lucide-react";
import { RolePermissionTab } from "@/components/admin/role-permission-tab";
import { UserOverrideTab } from "@/components/admin/user-override-tab";
import { getRoleDisplayLabel } from "@/lib/role-catalog";

interface User {
  id: string;
  externalUserId?: string | null;
  nik: string | null;
  name: string;
  email: string | null;
  systemRole: "ADMIN" | "USER";
  businessRole: string | null;
  scope: "HO" | "BRANCH" | null;
  branch: string | null;
  branchCode?: string | null;
  status: "ACTIVE" | "INACTIVE";
  source: string;
  ssoStatus?: string | null;
  isSystemAdmin?: boolean;
  hasManagementInstruction?: boolean;
  classification?: "SYSTEM_ADMIN" | "HO_MANAGEMENT" | "HO_MONITORING" | "BRANCH_USER" | "OTHER";
  ssoConnected?: boolean;
  ssoGrantStatus?: "ACTIVE" | "REVOKED" | "NO_GRANT" | "UNVERIFIED" | "LOCAL" | "VERIFIED" | "PENDING_GRANT" | "BLOCKED";
  ssoGrantStatusLabel?: string;
  lastVerifiedAt?: string | null;
  ssoGrantError?: string | null;
  localProvisioningStatus?: string | null;
  lastProvisionedAt?: string | null;
  activeOverrides?: Array<{ key: string; effect: string; reason: string }>;
  tokenVersion?: number;
  createdAt?: string;
  updatedAt?: string;
}

export default function UserManagementPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [portalManagementUrl, setPortalManagementUrl] = useState("https://sparta-alfamart.web.id/#/manajemen-user");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Tabs
  const [activeTab, setActiveTab] = useState<"users" | "roles" | "overrides">("users");

  // Filters
  const [searchTerm, setSearchTerm] = useState("");
  const [filterClassification, setFilterClassification] = useState("");
  const [filterRole, setFilterRole] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [filterScope, setFilterScope] = useState("");
  const [filterSource, setFilterSource] = useState("");
  const [filterGrant, setFilterGrant] = useState("");
  const [sortBy, setSortBy] = useState<"hierarchy" | "name-asc" | "name-desc" | "nik-asc" | "status-active" | "source">("hierarchy");

  // Pagination
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(25);

  // Detail & Emergency Admin Password Modal State
  const [isSsoInfoModalOpen, setIsSsoInfoModalOpen] = useState(false);
  const [selectedUserForDetail, setSelectedUserForDetail] = useState<User | null>(null);
  const [adminPasswordTarget, setAdminPasswordTarget] = useState<User | null>(null);
  const [adminPassword, setAdminPassword] = useState("");
  const [adminConfirmPassword, setAdminConfirmPassword] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    fetchUsers();
  }, []);

  // Role Hierarchy Weights for organizational ordering
  const getHierarchyWeight = (u: User): number => {
    if (u.systemRole === "ADMIN") return 10;
    const r = (u.businessRole || "").toLowerCase();
    switch (r) {
      case "admin":
      case "gm_ho":
        return u.hasManagementInstruction ? 18 : 22;
      case "sm_ho":
        return u.hasManagementInstruction ? 23 : 26;
      case "ho_admin":
        return 30;
      case "bm":
        return 40;
      case "bmc":
        return 50;
      case "bec":
        return 51;
      case "bbc":
        return 52;
      case "bms":
        return 60;
      case "bes":
        return 61;
      case "bbs":
        return 62;
      case "store_crew":
      case "tim_toko":
        return 70;
      default:
        return 80;
    }
  };

  // Dynamic KPI Metrics (Calculated from actual DB data)
  const metrics = useMemo(() => {
    const total = users.length;
    const active = users.filter((u) => u.status === "ACTIVE").length;
    const inactive = users.filter((u) => u.status === "INACTIVE").length;
    const sysAdmins = users.filter((u) => u.systemRole === "ADMIN").length;
    const hoActive = users.filter((u) => u.scope === "HO" && u.status === "ACTIVE" && u.systemRole !== "ADMIN").length;
    const hoManagement = users.filter((u) => u.scope === "HO" && u.status === "ACTIVE" && u.hasManagementInstruction && u.systemRole !== "ADMIN").length;
    const hoMonitoring = users.filter((u) => u.scope === "HO" && u.status === "ACTIVE" && !u.hasManagementInstruction && u.systemRole !== "ADMIN").length;
    const branchActive = users.filter((u) => u.scope === "BRANCH" && u.status === "ACTIVE").length;
    const ssoUsers = users.filter((u) => u.source !== "LOCAL" && u.source !== "DEVELOPMENT").length;
    const localUsers = users.filter((u) => u.source === "LOCAL" || u.source === "DEVELOPMENT").length;

    return {
      total,
      active,
      inactive,
      sysAdmins,
      hoActive,
      hoManagement,
      hoMonitoring,
      branchActive,
      ssoUsers,
      localUsers,
    };
  }, [users]);

  // Filtered & Sorted Users
  const filteredUsers = useMemo(() => {
    let result = [...users];

    // Search filter: nama, NIK, email, externalUserId, branch
    if (searchTerm.trim()) {
      const lower = searchTerm.trim().toLowerCase();
      result = result.filter(
        (u) =>
          (u.name && u.name.toLowerCase().includes(lower)) ||
          (u.nik && u.nik.toLowerCase().includes(lower)) ||
          (u.email && u.email.toLowerCase().includes(lower)) ||
          (u.externalUserId && u.externalUserId.toLowerCase().includes(lower)) ||
          (u.branch && u.branch.toLowerCase().includes(lower)) ||
          (u.branchCode && u.branchCode.toLowerCase().includes(lower))
      );
    }

    // Classification filter
    if (filterClassification) {
      if (filterClassification === "SYSTEM_ADMIN") {
        result = result.filter((u) => u.systemRole === "ADMIN");
      } else if (filterClassification === "HO_MANAGEMENT") {
        result = result.filter((u) => u.scope === "HO" && u.systemRole !== "ADMIN" && u.hasManagementInstruction);
      } else if (filterClassification === "HO_MONITORING") {
        result = result.filter((u) => u.scope === "HO" && u.systemRole !== "ADMIN" && !u.hasManagementInstruction);
      } else if (filterClassification === "BRANCH_USER") {
        result = result.filter((u) => u.scope === "BRANCH");
      }
    }

    // Role filter
    if (filterRole) {
      if (filterRole === "ADMIN") {
        result = result.filter((u) => u.systemRole === "ADMIN");
      } else {
        result = result.filter(
          (u) => u.systemRole !== "ADMIN" && u.businessRole?.toLowerCase() === filterRole.toLowerCase()
        );
      }
    }

    // Status filter: ACTIVE or INACTIVE
    if (filterStatus) {
      result = result.filter((u) => u.status === filterStatus);
    }

    // Scope filter: HO or BRANCH
    if (filterScope) {
      result = result.filter((u) => u.scope === filterScope);
    }

    // Source filter: SSO, LOCAL, DEVELOPMENT
    if (filterSource) {
      if (filterSource === "SSO") {
        result = result.filter((u) => u.source !== "LOCAL" && u.source !== "DEVELOPMENT");
      } else if (filterSource === "LOCAL") {
        result = result.filter((u) => u.source === "LOCAL");
      } else if (filterSource === "DEVELOPMENT") {
        result = result.filter((u) => u.source === "DEVELOPMENT");
      }
    }

    // Grant filter: ACTIVE, REVOKED, NO_GRANT, UNVERIFIED, LOCAL
    if (filterGrant) {
      if (filterGrant === "ACTIVE") {
        result = result.filter(
          (u) => u.ssoGrantStatus === "ACTIVE" || u.ssoGrantStatus === "VERIFIED"
        );
      } else if (filterGrant === "REVOKED") {
        result = result.filter(
          (u) => u.ssoGrantStatus === "REVOKED" || u.ssoGrantStatus === "BLOCKED"
        );
      } else if (filterGrant === "NO_GRANT") {
        result = result.filter(
          (u) =>
            u.ssoGrantStatus === "NO_GRANT" ||
            u.ssoGrantStatus === "PENDING_GRANT"
        );
      } else {
        result = result.filter((u) => u.ssoGrantStatus === filterGrant);
      }
    }

    // Sort order
    result.sort((a, b) => {
      if (sortBy === "hierarchy") {
        const weightDiff = getHierarchyWeight(a) - getHierarchyWeight(b);
        if (weightDiff !== 0) return weightDiff;
        const branchDiff = (a.branch || "").localeCompare(b.branch || "");
        if (branchDiff !== 0) return branchDiff;
        return a.name.localeCompare(b.name);
      }
      if (sortBy === "name-asc") {
        return a.name.localeCompare(b.name);
      }
      if (sortBy === "name-desc") {
        return b.name.localeCompare(a.name);
      }
      if (sortBy === "nik-asc") {
        return (a.nik || "").localeCompare(b.nik || "");
      }
      if (sortBy === "status-active") {
        if (a.status !== b.status) {
          return a.status === "ACTIVE" ? -1 : 1;
        }
        return a.name.localeCompare(b.name);
      }
      if (sortBy === "source") {
        return a.source.localeCompare(b.source);
      }
      return 0;
    });

    return result;
  }, [
    users,
    searchTerm,
    filterClassification,
    filterRole,
    filterStatus,
    filterScope,
    filterSource,
    filterGrant,
    sortBy,
  ]);

  // Reset pagination to page 1 when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [
    searchTerm,
    filterClassification,
    filterRole,
    filterStatus,
    filterScope,
    filterSource,
    filterGrant,
    sortBy,
    pageSize,
  ]);

  // Paginated slice
  const paginatedUsers = useMemo(() => {
    if (pageSize === -1) return filteredUsers;
    const start = (currentPage - 1) * pageSize;
    return filteredUsers.slice(start, start + pageSize);
  }, [filteredUsers, currentPage, pageSize]);

  const totalPages = pageSize === -1 ? 1 : Math.max(1, Math.ceil(filteredUsers.length / pageSize));

  const fetchUsers = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/users");
      if (res.status === 403) {
        setError("Akses Ditolak: Anda tidak memiliki hak akses (Hanya System Administrator yang dapat mengelola pengguna).");
        return;
      }
      if (!res.ok) throw new Error("Gagal mengambil data user");
      const json = await res.json();
      setUsers(json.data || []);
      if (typeof json.meta?.portalUserManagementUrl === "string" && json.meta.portalUserManagementUrl.trim()) {
        setPortalManagementUrl(json.meta.portalUserManagementUrl.trim());
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const isPortalManagedAccount = (u: Partial<User>) =>
    Boolean(u.externalUserId) ||
    (Boolean(u.source) && u.source !== "LOCAL" && u.source !== "DEVELOPMENT");

  const openAdminPasswordModal = (user: User) => {
    setAdminPasswordTarget(user);
    setAdminPassword("");
    setAdminConfirmPassword("");
    setShowPassword(false);
    setShowConfirmPassword(false);
    setFormError(null);
  };

  const handleSaveAdminPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!adminPasswordTarget) return;
    setFormError(null);

    if (!adminPassword || adminPassword.length < 8) {
      setFormError("Password minimal 8 karakter.");
      return;
    }
    if (adminPassword !== adminConfirmPassword) {
      setFormError("Konfirmasi password tidak sesuai.");
      return;
    }

    try {
      setIsSubmitting(true);
      const res = await fetch(`/api/admin/users/${adminPasswordTarget.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          password: adminPassword,
          confirmPassword: adminConfirmPassword,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error || "Gagal memperbarui password admin darurat");
      }
      await fetchUsers();
      setAdminPasswordTarget(null);
      toast.success("Password System Administrator diperbarui", {
        description: "Seluruh sesi lama admin darurat dicabut untuk keamanan.",
      });
    } catch (err: any) {
      setFormError(err.message);
      toast.error("Gagal memperbarui password", { description: err.message });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleResetFilters = () => {
    setSearchTerm("");
    setFilterClassification("");
    setFilterRole("");
    setFilterStatus("");
    setFilterScope("");
    setFilterSource("");
    setFilterGrant("");
    setSortBy("hierarchy");
    setCurrentPage(1);
  };

  if (loading) {
    return (
      <div className="flex h-[50vh] items-center justify-center text-slate-500 dark:text-slate-400">
        <Loader2 className="w-6 h-6 animate-spin mr-2" />
        <span>Memuat data pengguna & perizinan...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-8">
        <div className="bg-red-50 dark:bg-red-950/30 text-red-600 dark:text-red-400 p-6 rounded-2xl flex items-center gap-4 max-w-2xl mx-auto shadow-sm border border-red-100 dark:border-red-900/50">
          <ShieldAlert className="w-8 h-8 shrink-0" />
          <div>
            <h2 className="font-bold text-lg">Akses Ditolak</h2>
            <p className="text-sm mt-1 leading-relaxed">{error}</p>
            <p className="text-xs text-red-500 dark:text-red-400/80 mt-2">
              Menu ini hanya dapat diakses oleh akun dengan System Role ADMIN. Pengguna Head Office dengan peran bisnis Admin tidak memiliki hak administratif aplikasi.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 md:p-8 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-blue-50 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400 rounded-xl border border-blue-100 dark:border-blue-800">
            <UserCog className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900 dark:text-white tracking-tight">
              Manajemen Pengguna & Peran
            </h1>
            <p className="text-sm text-slate-500 dark:text-slate-400 font-medium">
              Pengaturan hak akses, peran kanonikal SIAGA, dan integrasi identitas Portal Login Sparta SSO
            </p>
          </div>
        </div>
        {activeTab === "users" && (
          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              onClick={() => setIsSsoInfoModalOpen(true)}
              className="flex items-center justify-center gap-2 px-3.5 py-2 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-sm font-semibold rounded-lg border border-slate-300 dark:border-slate-700 transition-colors shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
              title="Informasi Arsitektur SSO Portal Sparta"
            >
              <Globe className="w-4 h-4 text-blue-600 dark:text-blue-400" />
              <span>Integrasi SSO Sparta</span>
            </button>
            <a
              href={portalManagementUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-lg shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
            >
              <ExternalLink className="w-4 h-4" />
              <span>Kelola di Portal SPARTA</span>
            </a>
          </div>
        )}
      </div>

      {/* Tabs Navigation */}
      <div className="flex items-center gap-2 border-b border-slate-200 dark:border-slate-800 pb-2">
        <button
          type="button"
          onClick={() => setActiveTab("users")}
          className={`px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-2 transition-all ${
            activeTab === "users"
              ? "bg-blue-600 text-white shadow-sm"
              : "text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
          }`}
        >
          <UserIcon className="w-4 h-4" />
          Pengguna ({users.length})
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("roles")}
          className={`px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-2 transition-all ${
            activeTab === "roles"
              ? "bg-blue-600 text-white shadow-sm"
              : "text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
          }`}
        >
          <Shield className="w-4 h-4" />
          Hak Akses Role
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("overrides")}
          className={`px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-2 transition-all ${
            activeTab === "overrides"
              ? "bg-blue-600 text-white shadow-sm"
              : "text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
          }`}
        >
          <Sliders className="w-4 h-4" />
          Akses Khusus User
        </button>
      </div>

      {activeTab === "users" && (
        <div className="space-y-4">
          <div className="bg-blue-50/80 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-start gap-3">
              <Info className="w-5 h-5 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
              <div className="text-xs text-slate-700 dark:text-slate-300 space-y-1">
                <div className="font-bold text-slate-900 dark:text-white">
                  Pengelolaan Pengguna Terpusat di Portal SPARTA
                </div>
                <p className="leading-relaxed">
                  Pembuatan akun, perubahan identitas (Nama, NIK, Email), cabang, peran operasional, status aktif, dan pencabutan akses modul SIAGA dilakukan melalui Portal SPARTA dan otomatis disinkronkan ke SIAGA tanpa perlu menunggu pengguna login pertama. Gunakan tab <strong>Hak Akses Role</strong> dan <strong>Akses Khusus User</strong> untuk pengaturan perizinan internal SIAGA.
                </p>
              </div>
            </div>
            <a
              href={portalManagementUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold bg-white dark:bg-slate-900 text-blue-700 dark:text-blue-300 border border-blue-300 dark:border-blue-700 hover:bg-blue-50 dark:hover:bg-slate-800 transition-colors shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              Buka Portal SPARTA
            </a>
          </div>

          {/* Dynamic KPI Summary Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-3 shadow-xs">
              <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Total Akun</div>
              <div className="text-xl font-bold text-slate-900 dark:text-white mt-0.5">{metrics.total}</div>
              <div className="text-[10px] text-slate-400 mt-0.5">Aktif: {metrics.active} • Nonaktif: {metrics.inactive}</div>
            </div>

            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-3 shadow-xs">
              <div className="text-[11px] font-semibold text-purple-600 dark:text-purple-400 uppercase tracking-wider flex items-center gap-1">
                <Shield className="w-3 h-3" /> System Admin
              </div>
              <div className="text-xl font-bold text-purple-700 dark:text-purple-300 mt-0.5">{metrics.sysAdmins}</div>
              <div className="text-[10px] text-slate-400 mt-0.5">Technical Administrator</div>
            </div>

            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-3 shadow-xs">
              <div className="text-[11px] font-semibold text-emerald-600 dark:text-emerald-400 uppercase tracking-wider flex items-center gap-1">
                <ShieldCheck className="w-3 h-3" /> HO Manajemen
              </div>
              <div className="text-xl font-bold text-emerald-700 dark:text-emerald-300 mt-0.5">{metrics.hoManagement}</div>
              <div className="text-[10px] text-emerald-600 dark:text-emerald-400/80 mt-0.5">Monitoring + Instruksi</div>
            </div>

            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-3 shadow-xs">
              <div className="text-[11px] font-semibold text-blue-600 dark:text-blue-400 uppercase tracking-wider flex items-center gap-1">
                <Eye className="w-3 h-3" /> HO Monitoring
              </div>
              <div className="text-xl font-bold text-blue-700 dark:text-blue-300 mt-0.5">{metrics.hoMonitoring}</div>
              <div className="text-[10px] text-blue-600 dark:text-blue-400/80 mt-0.5">Override: Instruksi DENY</div>
            </div>

            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-3 shadow-xs">
              <div className="text-[11px] font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wider flex items-center gap-1">
                <Store className="w-3 h-3" /> Pengguna Cabang
              </div>
              <div className="text-xl font-bold text-slate-800 dark:text-slate-200 mt-0.5">{metrics.branchActive}</div>
              <div className="text-[10px] text-slate-400 mt-0.5">Operasional Lapangan Aktif</div>
            </div>

            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-3 shadow-xs">
              <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider flex items-center gap-1">
                <Globe className="w-3 h-3 text-blue-500" /> Sumber Akun
              </div>
              <div className="text-xl font-bold text-slate-900 dark:text-white mt-0.5">{metrics.ssoUsers} <span className="text-xs font-normal text-slate-400">SSO</span></div>
              <div className="text-[10px] text-slate-400 mt-0.5">Lokal / Tester: {metrics.localUsers}</div>
            </div>
          </div>

          {/* Main User Card Table */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-sm overflow-hidden flex flex-col">
            {/* Filters Bar */}
            <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex flex-col gap-3 bg-white dark:bg-slate-900">
              {/* Row 1: Search & Reset */}
              <div className="flex flex-col md:flex-row gap-3">
                <div className="relative flex-1">
                  <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500" />
                  <input
                    type="text"
                    placeholder="Cari nama, NIK, email, SSO ID, atau cabang..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="w-full pl-9 pr-8 py-2 border border-slate-200 dark:border-slate-700 rounded-lg text-sm bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-shadow"
                  />
                  {searchTerm && (
                    <button
                      type="button"
                      onClick={() => setSearchTerm("")}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 p-0.5 rounded"
                      title="Hapus pencarian"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

                {(searchTerm ||
                  filterClassification ||
                  filterRole ||
                  filterStatus ||
                  filterScope ||
                  filterSource ||
                  filterGrant ||
                  sortBy !== "hierarchy") && (
                  <button
                    type="button"
                    onClick={handleResetFilters}
                    className="flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-700 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 rounded-lg transition-colors whitespace-nowrap border border-slate-200 dark:border-slate-700"
                    title="Reset Semua Filter"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    Reset Filter
                  </button>
                )}
              </div>

              {/* Row 2: Dropdown Filters */}
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
                {/* Filter Klasifikasi HO / Cabang */}
                <select
                  value={filterClassification}
                  onChange={(e) => setFilterClassification(e.target.value)}
                  className="border border-slate-200 dark:border-slate-700 rounded-lg px-2.5 py-1.5 text-xs bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">Semua Klasifikasi</option>
                  <option value="SYSTEM_ADMIN">System Admin</option>
                  <option value="HO_MANAGEMENT">HO Monitoring + Instruksi</option>
                  <option value="HO_MONITORING">HO Monitoring Saja</option>
                  <option value="BRANCH_USER">Pengguna Cabang</option>
                </select>

                {/* Filter Scope */}
                <select
                  value={filterScope}
                  onChange={(e) => setFilterScope(e.target.value)}
                  className="border border-slate-200 dark:border-slate-700 rounded-lg px-2.5 py-1.5 text-xs bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">Semua Scope</option>
                  <option value="HO">HO (Head Office)</option>
                  <option value="BRANCH">BRANCH (Cabang)</option>
                </select>

                {/* Filter Peran Kanonikal */}
                <select
                  value={filterRole}
                  onChange={(e) => setFilterRole(e.target.value)}
                  className="border border-slate-200 dark:border-slate-700 rounded-lg px-2.5 py-1.5 text-xs bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">Semua Peran Bisnis</option>
                  <optgroup label="System">
                    <option value="ADMIN">System Administrator</option>
                  </optgroup>
                  <optgroup label="Head Office">
                    <option value="admin">Admin HO</option>
                    <option value="gm_ho">GM HO</option>
                    <option value="sm_ho">SM HO</option>
                    <option value="ho_admin">HO Admin</option>
                  </optgroup>
                  <optgroup label="Cabang">
                    <option value="bm">Branch Manager (BM)</option>
                    <option value="bmc">BMC (Koordinator BMS)</option>
                    <option value="bec">BEC (Koordinator BES)</option>
                    <option value="bbc">BBC (Koordinator BBS)</option>
                    <option value="bms">BMS (Maintenance)</option>
                    <option value="bes">BES (Engineering)</option>
                    <option value="bbs">BBS (Building)</option>
                  </optgroup>
                </select>

                {/* Filter Status */}
                <select
                  value={filterStatus}
                  onChange={(e) => setFilterStatus(e.target.value)}
                  className="border border-slate-200 dark:border-slate-700 rounded-lg px-2.5 py-1.5 text-xs bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">Semua Status</option>
                  <option value="ACTIVE">ACTIVE (Aktif)</option>
                  <option value="INACTIVE">INACTIVE (Nonaktif)</option>
                </select>

                {/* Filter Sumber Identitas */}
                <select
                  value={filterSource}
                  onChange={(e) => setFilterSource(e.target.value)}
                  className="border border-slate-200 dark:border-slate-700 rounded-lg px-2.5 py-1.5 text-xs bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">Semua Sumber</option>
                  <option value="SSO">Portal Sparta SSO</option>
                  <option value="LOCAL">Akun Lokal</option>
                  <option value="DEVELOPMENT">Tester / Dev</option>
                </select>

                {/* Filter Status Grant Modul SIAGA */}
                <select
                  value={filterGrant}
                  onChange={(e) => setFilterGrant(e.target.value)}
                  className="border border-slate-200 dark:border-slate-700 rounded-lg px-2.5 py-1.5 text-xs bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">Semua Status Grant</option>
                  <option value="ACTIVE">Grant: Aktif</option>
                  <option value="REVOKED">Grant: Dicabut / Tidak Aktif</option>
                  <option value="NO_GRANT">Grant: Tidak Ada Grant</option>
                  <option value="UNVERIFIED">Grant: Belum Diverifikasi</option>
                  <option value="LOCAL">Grant: Akun Lokal</option>
                </select>

                {/* Filter Urutan */}
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as any)}
                  className="border border-slate-200 dark:border-slate-700 rounded-lg px-2.5 py-1.5 text-xs bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500 font-medium"
                >
                  <option value="hierarchy">Urut: Hierarki Jabatan</option>
                  <option value="name-asc">Urut: Nama (A - Z)</option>
                  <option value="name-desc">Urut: Nama (Z - A)</option>
                  <option value="nik-asc">Urut: NIK</option>
                  <option value="status-active">Urut: Status Aktif</option>
                  <option value="source">Urut: Sumber Akun</option>
                </select>
              </div>
            </div>

            {/* Quick Status Subheader */}
            <div className="px-4 py-2 bg-slate-50/80 dark:bg-slate-950/80 border-b border-slate-100 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-400">
              <div>
                Menampilkan <span className="font-bold text-slate-800 dark:text-slate-200">{filteredUsers.length}</span> dari {users.length} akun terdaftar
              </div>
              <div className="flex items-center gap-2">
                <span>Per Halaman:</span>
                <select
                  value={pageSize}
                  onChange={(e) => setPageSize(Number(e.target.value))}
                  className="border border-slate-200 dark:border-slate-700 rounded px-1.5 py-0.5 text-xs bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200"
                >
                  <option value={25}>25</option>
                  <option value={50}>50</option>
                  <option value={100}>100</option>
                  <option value={-1}>Semua</option>
                </select>
              </div>
            </div>

            {/* Table */}
            <div className="overflow-x-auto flex-1">
              <table className="w-full text-left border-collapse text-sm">
                <thead>
                  <tr className="bg-slate-50 dark:bg-slate-950/50 border-b border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400">
                    <th className="py-3 px-4 font-semibold uppercase tracking-wider text-[10px]">Identitas Pengguna</th>
                    <th className="py-3 px-4 font-semibold uppercase tracking-wider text-[10px]">Klasifikasi & Peran</th>
                    <th className="py-3 px-4 font-semibold uppercase tracking-wider text-[10px]">Scope / Cabang</th>
                    <th className="py-3 px-4 font-semibold uppercase tracking-wider text-[10px]">Integrasi SSO & Grant</th>
                    <th className="py-3 px-4 font-semibold uppercase tracking-wider text-[10px]">Status Akun</th>
                    <th className="py-3 px-4 font-semibold uppercase tracking-wider text-[10px] text-right">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {paginatedUsers.map((user) => {
                    const isSystemAdmin = user.systemRole === "ADMIN";
                    const isHoUser = user.scope === "HO" && !isSystemAdmin;
                    const isHoManagement = isHoUser && user.hasManagementInstruction;
                    const isHoMonitoring = isHoUser && !user.hasManagementInstruction;

                    return (
                      <tr key={user.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/50 transition-colors">
                        {/* 1. Identitas Pengguna */}
                        <td className="py-3 px-4">
                          <div className="font-bold text-slate-900 dark:text-slate-200 flex items-center gap-1.5 flex-wrap">
                            {isSystemAdmin && <Shield className="w-3.5 h-3.5 text-purple-600 shrink-0" />}
                            <span>{user.name}</span>
                            {user.source !== "LOCAL" && user.source !== "DEVELOPMENT" ? (
                              <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-blue-50 text-blue-700 border border-blue-200 dark:bg-blue-950/60 dark:text-blue-300 dark:border-blue-800 flex items-center gap-1">
                                <Globe className="w-2.5 h-2.5" /> SSO
                              </span>
                            ) : user.source === "LOCAL" ? (
                              <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-slate-100 text-slate-600 border border-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700">
                                LOKAL
                              </span>
                            ) : (
                              <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-950/60 dark:text-amber-400 dark:border-amber-800">
                                TESTER
                              </span>
                            )}
                          </div>
                          <div className="flex flex-col gap-0.5 mt-0.5 text-[10px] text-slate-500 dark:text-slate-400">
                            <div className="font-mono flex items-center gap-1">
                              <span className="font-semibold text-slate-600 dark:text-slate-400">NIK:</span> {user.nik ? user.nik : "---"}
                              {user.externalUserId && (
                                <>
                                  <span className="text-slate-300 dark:text-slate-600">•</span>
                                  <span className="text-slate-400 dark:text-slate-500" title={`SSO External User ID: ${user.externalUserId}`}>
                                    ID: {user.externalUserId.slice(0, 14)}...
                                  </span>
                                </>
                              )}
                            </div>
                            {user.email && (
                              <div className="text-slate-500 dark:text-slate-400 truncate max-w-[200px]" title={user.email}>
                                {user.email}
                              </div>
                            )}
                          </div>
                        </td>

                        {/* 2. Klasifikasi & Peran */}
                        <td className="py-3 px-4">
                          {isSystemAdmin ? (
                            <div className="flex flex-col items-start gap-1">
                              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md text-[10px] font-black bg-purple-100 text-purple-800 dark:bg-purple-950/60 dark:text-purple-300 border border-purple-200 dark:border-purple-800">
                                <Lock className="w-3 h-3 text-purple-600 dark:text-purple-400" /> SYSTEM ADMIN
                              </span>
                              <span className="text-[10px] text-purple-600 dark:text-purple-400 italic">Technical Administrator</span>
                            </div>
                          ) : isHoUser ? (
                            <div className="flex flex-col items-start gap-1">
                              {isHoManagement ? (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                                  <ShieldCheck className="w-3 h-3 text-emerald-600" /> HO Monitoring + Instruksi
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
                                  <Eye className="w-3 h-3 text-blue-600 dark:text-blue-400" /> HO Monitoring Saja
                                </span>
                              )}
                              <span className="text-[10px] font-semibold text-slate-600 dark:text-slate-400">
                                Peran: {getRoleDisplayLabel(user.businessRole)}
                              </span>
                            </div>
                          ) : (
                            <div className="flex flex-col items-start gap-0.5">
                              <span className="font-bold text-xs text-slate-800 dark:text-slate-200 bg-slate-50 dark:bg-slate-800/80 px-2 py-1 rounded border border-slate-200/60 dark:border-slate-700/60 inline-block max-w-[180px] truncate" title={getRoleDisplayLabel(user.businessRole)}>
                                {getRoleDisplayLabel(user.businessRole)}
                              </span>
                              <span className="text-[10px] text-slate-400">Operasional Cabang</span>
                            </div>
                          )}
                        </td>

                        {/* 3. Scope / Cabang */}
                        <td className="py-3 px-4">
                          {isSystemAdmin ? (
                            <span className="text-xs text-slate-400 dark:text-slate-500 font-mono">-</span>
                          ) : (
                            <div>
                              <span className="font-bold text-xs text-blue-700 dark:text-blue-400">
                                {user.scope}
                              </span>
                              {user.scope === "BRANCH" && (user.branch || user.branchCode) && (
                                <>
                                  <span className="text-slate-400 dark:text-slate-600 mx-1">•</span>
                                  <span className="text-slate-700 dark:text-slate-300 font-medium text-xs">
                                    {user.branch || user.branchCode}
                                    {user.branch &&
                                      user.branchCode &&
                                      user.branchCode.toUpperCase() !== user.branch.toUpperCase()
                                      ? ` (${user.branchCode})`
                                      : ""}
                                  </span>
                                </>
                              )}
                              {user.scope === "HO" && (
                                <div className="text-[10px] text-slate-400">Cakupan Nasional</div>
                              )}
                            </div>
                          )}
                        </td>

                        {/* 4. Integrasi SSO & Grant */}
                        <td className="py-3 px-4">
                          <div className="flex flex-col gap-1 items-start">
                            {/* Keterhubungan SSO */}
                            <div className="flex items-center gap-1.5 text-[11px]">
                              {user.ssoConnected ? (
                                <span className="inline-flex items-center gap-1 font-semibold text-blue-700 dark:text-blue-300">
                                  <CheckCircle2 className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400 shrink-0" /> Terhubung SSO
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 text-slate-500 dark:text-slate-400">
                                  <XCircle className="w-3.5 h-3.5 text-slate-400 shrink-0" /> Akun Lokal
                                </span>
                              )}
                            </div>

                            {/* Status Grant Modul SIAGA */}
                            <div>
                              {user.ssoGrantStatus === "ACTIVE" || user.ssoGrantStatus === "VERIFIED" ? (
                                <span
                                  className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800"
                                  title={user.lastVerifiedAt ? `Diverifikasi: ${new Date(user.lastVerifiedAt).toLocaleString("id-ID")}` : "Grant aktif di Portal Sparta"}
                                >
                                  Grant: Aktif
                                </span>
                              ) : user.ssoGrantStatus === "REVOKED" || user.ssoGrantStatus === "BLOCKED" ? (
                                <span
                                  className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-rose-50 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300 border border-rose-200 dark:border-rose-800"
                                  title={user.lastVerifiedAt ? `Dicabut: ${new Date(user.lastVerifiedAt).toLocaleString("id-ID")}` : "Grant dicabut / nonaktif"}
                                >
                                  Grant: Dicabut / Tidak Aktif
                                </span>
                              ) : user.ssoGrantStatus === "NO_GRANT" || user.ssoGrantStatus === "PENDING_GRANT" ? (
                                <span
                                  className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400 border border-zinc-200 dark:border-zinc-700"
                                  title="Tidak memiliki akses modul SIAGA"
                                >
                                  Grant: Tidak Ada Grant
                                </span>
                              ) : user.ssoGrantStatus === "LOCAL" ? (
                                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400">
                                  Grant: Akun Lokal
                                </span>
                              ) : (
                                <span
                                  className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-400 border border-amber-200 dark:border-amber-800"
                                  title={user.ssoGrantError || "Status grant belum dapat dibaca secara aman dari Login Sparta"}
                                >
                                  Grant: Belum Diverifikasi
                                </span>
                              )}
                            </div>
                          </div>
                        </td>

                        {/* 5. Status Akun SIAGA */}
                        <td className="py-3 px-4">
                          <span
                            className={`inline-flex px-2 py-0.5 rounded-full border text-[10px] font-bold ${
                              user.status === "ACTIVE"
                                ? "bg-emerald-50 border-emerald-200 text-emerald-700 dark:bg-emerald-900/20 dark:border-emerald-800/50 dark:text-emerald-400"
                                : "bg-slate-100 border-slate-200 text-slate-500 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-400"
                            }`}
                          >
                            {user.status}
                          </span>
                        </td>

                        {/* 6. Aksi */}
                        <td className="py-3 px-4 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            {/* Tombol Detail Izin Efektif */}
                            <button
                              type="button"
                              onClick={() => setSelectedUserForDetail(user)}
                              aria-label={`Lihat Detail Izin Efektif ${user.name}`}
                              className="p-2 rounded-lg text-slate-500 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/30 dark:hover:text-blue-400 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                              title="Lihat Detail Izin Efektif Pengguna"
                            >
                              <Shield className="w-4 h-4" />
                            </button>

                            {/* Rotasi Password Khusus System Admin Darurat Lokal */}
                            {isSystemAdmin && user.source === "LOCAL" && (
                              <button
                                type="button"
                                onClick={() => openAdminPasswordModal(user)}
                                aria-label={`Ubah Password Admin Darurat ${user.name}`}
                                className="p-2 rounded-lg text-purple-600 hover:text-purple-700 hover:bg-purple-50 dark:text-purple-400 dark:hover:bg-purple-900/30 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500"
                                title="Ubah Password Admin Darurat Lokal"
                              >
                                <KeyRound className="w-4 h-4" />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {filteredUsers.length === 0 && (
                    <tr>
                      <td colSpan={6} className="py-12 text-center">
                        <div className="text-slate-400 dark:text-slate-500 mb-2">
                          Tidak ada pengguna yang cocok dengan kriteria filter.
                        </div>
                        <button
                          type="button"
                          onClick={handleResetFilters}
                          className="text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline"
                        >
                          Reset Filter Pencarian
                        </button>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Pagination Controls */}
            {pageSize !== -1 && totalPages > 1 && (
              <div className="p-3 border-t border-slate-100 dark:border-slate-800 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-slate-500 dark:text-slate-400 bg-slate-50/50 dark:bg-slate-900/50">
                <div>
                  Halaman <span className="font-bold text-slate-800 dark:text-slate-200">{currentPage}</span> dari{" "}
                  <span className="font-bold text-slate-800 dark:text-slate-200">{totalPages}</span> (
                  {filteredUsers.length} total akun)
                </div>

                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                    disabled={currentPage === 1}
                    className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-100 dark:hover:bg-slate-700"
                    title="Halaman Sebelumnya"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>

                  <div className="flex items-center gap-1 px-1">
                    {Array.from({ length: Math.min(5, totalPages) }, (_, idx) => {
                      let pageNumber: number;
                      if (totalPages <= 5) {
                        pageNumber = idx + 1;
                      } else if (currentPage <= 3) {
                        pageNumber = idx + 1;
                      } else if (currentPage >= totalPages - 2) {
                        pageNumber = totalPages - 4 + idx;
                      } else {
                        pageNumber = currentPage - 2 + idx;
                      }

                      return (
                        <button
                          key={pageNumber}
                          type="button"
                          onClick={() => setCurrentPage(pageNumber)}
                          className={`w-7 h-7 rounded-lg text-xs font-bold transition-all ${
                            currentPage === pageNumber
                              ? "bg-blue-600 text-white"
                              : "border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700"
                          }`}
                        >
                          {pageNumber}
                        </button>
                      );
                    })}
                  </div>

                  <button
                    type="button"
                    onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                    disabled={currentPage === totalPages}
                    className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-100 dark:hover:bg-slate-700"
                    title="Halaman Selanjutnya"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === "roles" && <RolePermissionTab />}

      {activeTab === "overrides" && <UserOverrideTab />}

      {/* Modal Detail Izin Efektif Pengguna */}
      {selectedUserForDetail && (
        <AppDialog
          open={Boolean(selectedUserForDetail)}
          onClose={() => setSelectedUserForDetail(null)}
          title="Detail Izin Efektif Pengguna"
          description={`Ringkasan kewenangan otoritatif dan perizinan internal SIAGA untuk ${selectedUserForDetail.name}`}
          className="sm:!max-w-2xl"
        >
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl w-full max-w-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90dvh]">
            <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between bg-slate-50/50 dark:bg-slate-900/50">
              <div className="flex items-center gap-3">
                <div className="p-2.5 bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 rounded-xl">
                  <Shield className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="font-bold text-base text-slate-900 dark:text-white">
                    Detail Izin Efektif Pengguna
                  </h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400 font-mono">
                    ID: {selectedUserForDetail.id}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelectedUserForDetail(null)}
                className="p-1.5 rounded-xl text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 overflow-y-auto space-y-4">
              {/* Ringkasan Profil */}
              <div className="p-4 bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-slate-200/60 dark:border-slate-700/60 space-y-2">
                <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Profil & Penempatan</div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <span className="text-slate-400">Nama Lengkap:</span>
                    <div className="font-bold text-slate-900 dark:text-slate-100">{selectedUserForDetail.name}</div>
                  </div>
                  <div>
                    <span className="text-slate-400">NIK:</span>
                    <div className="font-mono font-medium text-slate-900 dark:text-slate-100">{selectedUserForDetail.nik || "---"}</div>
                  </div>
                  <div>
                    <span className="text-slate-400">Email:</span>
                    <div className="text-slate-800 dark:text-slate-200">{selectedUserForDetail.email || "---"}</div>
                  </div>
                  <div>
                    <span className="text-slate-400">Sumber Akun:</span>
                    <div className="font-semibold text-blue-600 dark:text-blue-400">{selectedUserForDetail.source}</div>
                  </div>
                  <div>
                    <span className="text-slate-400">Peran Bisnis:</span>
                    <div className="font-semibold text-slate-800 dark:text-slate-200">{getRoleDisplayLabel(selectedUserForDetail.businessRole)}</div>
                  </div>
                  <div>
                    <span className="text-slate-400">Cakupan (Scope):</span>
                    <div className="font-semibold text-slate-800 dark:text-slate-200">
                      {selectedUserForDetail.scope || "Nasional / N/A"}
                      {selectedUserForDetail.branch
                        ? ` (Cabang ${selectedUserForDetail.branch}${
                            selectedUserForDetail.branchCode &&
                            selectedUserForDetail.branchCode.toUpperCase() !== selectedUserForDetail.branch.toUpperCase()
                              ? ` — ${selectedUserForDetail.branchCode}`
                              : ""
                          })`
                        : selectedUserForDetail.branchCode
                          ? ` (${selectedUserForDetail.branchCode})`
                          : ""}
                    </div>
                  </div>
                </div>
              </div>

              {/* Status Integrasi & Grant Portal Login Sparta */}
              <div className="p-4 bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-slate-200/60 dark:border-slate-700/60 space-y-2">
                <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 flex items-center justify-between">
                  <span>Status Integrasi Portal Sparta</span>
                  <span className="text-[10px] font-mono text-slate-400">External ID: {selectedUserForDetail.externalUserId || "Tidak Terdaftar"}</span>
                </div>
                <div className="flex flex-wrap items-center gap-2 pt-1 text-xs">
                  <div className="flex items-center gap-1.5 font-medium">
                    <span className="text-slate-500">Status Grant SIAGA:</span>
                    {selectedUserForDetail.ssoGrantStatus === "ACTIVE" || selectedUserForDetail.ssoGrantStatus === "VERIFIED" ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" /> Aktif
                      </span>
                    ) : selectedUserForDetail.ssoGrantStatus === "REVOKED" || selectedUserForDetail.ssoGrantStatus === "BLOCKED" ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-bold bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300">
                        <XCircle className="w-3.5 h-3.5 text-rose-600" /> Dicabut / Tidak Aktif
                      </span>
                    ) : selectedUserForDetail.ssoGrantStatus === "NO_GRANT" || selectedUserForDetail.ssoGrantStatus === "PENDING_GRANT" ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-bold bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                        <AlertTriangle className="w-3.5 h-3.5 text-zinc-500" /> Tidak Ada Grant
                      </span>
                    ) : selectedUserForDetail.ssoGrantStatus === "LOCAL" ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                        Akun Lokal SIAGA
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                        <Info className="w-3.5 h-3.5 text-amber-600" /> Belum Diverifikasi
                      </span>
                    )}
                  </div>
                  {selectedUserForDetail.lastVerifiedAt && (
                    <div className="text-[11px] text-slate-400 ml-auto">
                      Diverifikasi: {new Date(selectedUserForDetail.lastVerifiedAt).toLocaleString("id-ID")}
                    </div>
                  )}
                </div>
                {selectedUserForDetail.ssoGrantError && (
                  <div className="text-[11px] text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/40 p-2 rounded-lg border border-amber-200 dark:border-amber-800/60 mt-1">
                    {selectedUserForDetail.ssoGrantError}
                  </div>
                )}
                {isPortalManagedAccount(selectedUserForDetail) && (
                  <div className="pt-2 mt-2 border-t border-slate-200/70 dark:border-slate-700/70 grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px]">
                    <div>
                      <span className="text-slate-500">Status Provisioning Lokal (Bukan Verifikasi Live Portal):</span>
                      <div className="font-mono font-semibold text-slate-800 dark:text-slate-200">
                        {selectedUserForDetail.localProvisioningStatus || "BELUM TERCATAT"}
                      </div>
                    </div>
                    <div>
                      <span className="text-slate-500">Event Provisioning Terakhir:</span>
                      <div className="font-mono text-slate-700 dark:text-slate-300">
                        {selectedUserForDetail.lastProvisionedAt
                          ? new Date(selectedUserForDetail.lastProvisionedAt).toLocaleString("id-ID")
                          : "Belum ada"}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Status Hak Instruksi Manajemen */}
              <div className="space-y-1.5">
                <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                  Kewenangan Instruksi Manajemen Bencana
                </div>
                {selectedUserForDetail.systemRole === "ADMIN" ? (
                  <div className="p-3 bg-purple-50 dark:bg-purple-950/40 border border-purple-200 dark:border-purple-800 rounded-xl text-purple-900 dark:text-purple-300 text-xs">
                    <div className="font-bold flex items-center gap-1.5">
                      <Lock className="w-4 h-4 text-purple-600" />
                      <span>System Administrator — Akses Administratif Penuh</span>
                    </div>
                    <p className="text-[11px] text-purple-800 dark:text-purple-300/80 mt-1">
                      Mengelola seluruh konfigurasi teknis sistem SIAGA dan katalog peran.
                    </p>
                  </div>
                ) : selectedUserForDetail.scope === "HO" ? (
                  selectedUserForDetail.hasManagementInstruction ? (
                    <div className="p-3 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 rounded-xl text-emerald-900 dark:text-emerald-300 text-xs">
                      <div className="font-bold flex items-center gap-1.5">
                        <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                        <span>DIIZINKAN (ALLOW) — HO Monitoring + Instruksi</span>
                      </div>
                      <p className="text-[11px] text-emerald-800 dark:text-emerald-300/80 mt-1">
                        Pengguna memiliki kewenangan membuat dan menerbitkan instruksi manajemen tanggap bencana nasional.
                      </p>
                    </div>
                  ) : (
                    <div className="p-3 bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800 rounded-xl text-blue-900 dark:text-blue-300 text-xs">
                      <div className="font-bold flex items-center gap-1.5">
                        <Eye className="w-4 h-4 text-blue-600" />
                        <span>DITOLAK (DENY) — HO Monitoring Saja</span>
                      </div>
                      <p className="text-[11px] text-blue-800 dark:text-blue-300/80 mt-1">
                        Hak akses dibatasi hanya untuk monitoring read-only. Hak pembuatan instruksi manajemen dinonaktifkan melalui override perizinan khusus (<code className="font-mono bg-blue-100 dark:bg-blue-900/60 px-1 py-0.5 rounded">MANAGEMENT_INSTRUCTION_CREATE = DENY</code>).
                      </p>
                    </div>
                  )
                ) : (
                  <div className="p-3 bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-700 dark:text-slate-300 text-xs">
                    <div className="font-semibold">Peran Operasional Cabang</div>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                      Pengguna cabang bertugas menanggapi dan melaksanakan instruksi manajemen sesuai wilayah cabang masing-masing.
                    </p>
                  </div>
                )}
              </div>

              {/* Catatan Hak Akses Khusus (User Overrides) */}
              <div className="space-y-1.5">
                <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                  Override Akses Khusus Pengguna ({selectedUserForDetail.activeOverrides?.length || 0})
                </div>
                {selectedUserForDetail.activeOverrides && selectedUserForDetail.activeOverrides.length > 0 ? (
                  <div className="border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden text-xs">
                    <table className="w-full text-left">
                      <thead className="bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border-b border-slate-200 dark:border-slate-700">
                        <tr>
                          <th className="py-2 px-3">Permission Key</th>
                          <th className="py-2 px-3">Efek</th>
                          <th className="py-2 px-3">Alasan Kebijakan</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                        {selectedUserForDetail.activeOverrides.map((ovr, i) => (
                          <tr key={i}>
                            <td className="py-2 px-3 font-mono font-bold text-slate-800 dark:text-slate-200">{ovr.key}</td>
                            <td className="py-2 px-3">
                              <span
                                className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                                  ovr.effect === "ALLOW"
                                    ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
                                    : "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300"
                                }`}
                              >
                                {ovr.effect}
                              </span>
                            </td>
                            <td className="py-2 px-3 text-slate-600 dark:text-slate-300 text-[11px]">{ovr.reason}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="p-3 bg-slate-50 dark:bg-slate-800/40 border border-slate-200/60 dark:border-slate-700/60 rounded-xl text-xs text-slate-500">
                    Pengguna ini tidak memiliki override akses khusus dan sepenuhnya mengikuti aturan bawaan role kanonikal.
                  </div>
                )}
              </div>
            </div>

            <div className="px-6 py-3 border-t border-slate-100 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2 bg-slate-50/50 dark:bg-slate-900/50">
              <div className="flex flex-wrap items-center gap-4">
                <button
                  type="button"
                  onClick={() => {
                    setSelectedUserForDetail(null);
                    setActiveTab("overrides");
                  }}
                  className="text-xs font-bold text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1.5"
                >
                  <Sliders className="w-3.5 h-3.5" /> Kelola di Tab Akses Khusus User
                </button>
                {selectedUserForDetail.systemRole !== "ADMIN" && (
                  <a
                    href={portalManagementUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs font-bold text-slate-700 dark:text-slate-300 hover:text-blue-600 dark:hover:text-blue-400 hover:underline flex items-center gap-1.5"
                  >
                    <ExternalLink className="w-3.5 h-3.5" /> Ubah Akun / Role di Portal SPARTA
                  </a>
                )}
              </div>
              <button
                type="button"
                onClick={() => setSelectedUserForDetail(null)}
                className="px-4 py-2 bg-slate-200 hover:bg-slate-300 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-lg text-xs font-bold transition-colors"
              >
                Tutup
              </button>
            </div>
          </div>
        </AppDialog>
      )}

      {/* Modal Informasi Integrasi SSO */}
      <AppDialog
        open={isSsoInfoModalOpen}
        onClose={() => setIsSsoInfoModalOpen(false)}
        title="Arsitektur Integrasi Portal Login Sparta SSO"
        description="Pemisahan tanggung jawab Single Sign-On dan Otorisasi Internal SPARTA SIAGA"
        className="sm:!max-w-2xl"
      >
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl w-full max-w-2xl shadow-2xl overflow-hidden flex flex-col">
          <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between bg-slate-50/50 dark:bg-slate-900/50">
            <div className="flex items-center gap-3">
              <div className="p-2.5 bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 rounded-xl">
                <Globe className="w-5 h-5" />
              </div>
              <div>
                <h2 className="font-bold text-base text-slate-900 dark:text-white">
                  Integrasi Portal Login Sparta SSO
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Manajemen User Terpusat & Otorisasi Internal SPARTA SIAGA
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setIsSsoInfoModalOpen(false)}
              aria-label="Tutup informasi integrasi"
              className="p-1.5 rounded-xl text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="p-6 space-y-4 text-xs leading-relaxed text-slate-700 dark:text-slate-300">
            <div className="p-3 bg-blue-50/70 dark:bg-blue-950/40 border border-blue-200/80 dark:border-blue-800/80 rounded-xl space-y-1">
              <div className="font-bold text-blue-900 dark:text-blue-300 flex items-center gap-1.5">
                <Info className="w-4 h-4 text-blue-600" />
                <span>Prinsip Otoritas Tunggal (Single Source of Truth)</span>
              </div>
              <p className="text-blue-800 dark:text-blue-300/80 text-[11px]">
                Portal SPARTA adalah pusat tunggal penambahan user, perubahan identitas (Nama, NIK, Email), cabang, role operasional SIAGA, status akun, dan pencabutan akses modul. Perubahan dari Portal disinkronkan otomatis ke database SIAGA melalui provisioning tanpa menunggu login pertama.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
              <div className="p-3 border border-slate-200 dark:border-slate-800 rounded-xl space-y-1">
                <div className="font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600" /> Provisioning Otomatis & Aman
                </div>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  Pencocokan akun memakai <code className="font-mono bg-slate-100 dark:bg-slate-800 px-1 py-0.5 rounded">external_user_id</code>, NIK, lalu email agar tidak terjadi duplikasi dan menjaga histori laporan tetap utuh.
                </p>
              </div>

              <div className="p-3 border border-slate-200 dark:border-slate-800 rounded-xl space-y-1">
                <div className="font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                  <ShieldCheck className="w-4 h-4 text-blue-600" /> Permission & Histori Lokal SIAGA
                </div>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  Matriks <strong>Hak Akses Role</strong> dan <strong>Akses Khusus User</strong> (termasuk pembatasan instruksi HO) tetap dikelola mandiri di SIAGA tanpa tertimpa saat sync Portal.
                </p>
              </div>

              <div className="p-3 border border-slate-200 dark:border-slate-800 rounded-xl space-y-1">
                <div className="font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                  <Lock className="w-4 h-4 text-purple-600" /> Proteksi System Admin Darurat
                </div>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  Akun System Administrator lokal tetap dilindungi dari demosi, penghapusan, maupun provisioning Portal, dan hanya mendukung rotasi password darurat di SIAGA.
                </p>
              </div>

              <div className="p-3 border border-slate-200 dark:border-slate-800 rounded-xl space-y-1">
                <div className="font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4 text-slate-600" /> Penonaktifan Form Duplikatif
                </div>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  Form tambah, edit operasional, dan hapus user di SIAGA dinonaktifkan agar tidak menduplikasi Portal SPARTA atau menghapus histori laporan.
                </p>
              </div>
            </div>
          </div>

          <div className="px-6 py-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between bg-slate-50/50 dark:bg-slate-900/50">
            <a
              href={portalManagementUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs font-bold text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1.5"
            >
              <ExternalLink className="w-3.5 h-3.5" /> Buka Manajemen User Portal SPARTA
            </a>
            <button
              type="button"
              onClick={() => setIsSsoInfoModalOpen(false)}
              className="px-4 py-2 bg-slate-200 hover:bg-slate-300 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-lg text-xs font-bold transition-colors"
            >
              Mengerti
            </button>
          </div>
        </div>
      </AppDialog>

      {/* Modal Rotasi Password System Admin Darurat Lokal */}
      <AppDialog
        open={Boolean(adminPasswordTarget)}
        onClose={() => setAdminPasswordTarget(null)}
        title="Ubah Password System Administrator Darurat"
        description="Rotasi password lokal untuk akun System Administrator darurat SIAGA"
        className="sm:!max-w-md"
      >
        {adminPasswordTarget && (
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl w-full max-w-md shadow-2xl overflow-hidden flex flex-col">
            <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between bg-slate-50/50 dark:bg-slate-900/50">
              <div className="flex items-center gap-3">
                <div className="p-2.5 bg-purple-50 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400 rounded-xl">
                  <KeyRound className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="font-bold text-base text-slate-900 dark:text-white">
                    Ubah Password Admin Darurat
                  </h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {adminPasswordTarget.name} ({adminPasswordTarget.id})
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setAdminPasswordTarget(null)}
                aria-label="Tutup modal ubah password"
                className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveAdminPassword} className="p-6 space-y-4">
              {formError && (
                <div className="p-3 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 rounded-xl text-red-600 dark:text-red-400 text-xs font-semibold flex items-center gap-2">
                  <ShieldAlert className="w-4 h-4 shrink-0" />
                  <span>{formError}</span>
                </div>
              )}

              <div className="p-3 bg-purple-50 dark:bg-purple-950/40 border border-purple-200 dark:border-purple-800 rounded-xl text-[11px] text-purple-900 dark:text-purple-300 leading-relaxed">
                Akun ini merupakan akses administrator darurat lokal. Perubahan password akan otomatis mencabut sesi login lama untuk menjaga keamanan.
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-700 dark:text-slate-400">
                  Password Baru *
                </label>
                <div className="relative">
                  <input
                    type={showPassword ? "text" : "password"}
                    required
                    value={adminPassword}
                    onChange={(e) => setAdminPassword(e.target.value)}
                    className="w-full border border-slate-200 dark:border-slate-700 rounded-xl pl-4 pr-10 py-2.5 text-sm bg-slate-50 hover:bg-white dark:bg-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 text-slate-900 dark:text-slate-100"
                    placeholder="Minimal 8 karakter"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    aria-label={showPassword ? "Sembunyikan password baru" : "Tampilkan password baru"}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-700 dark:text-slate-400">
                  Konfirmasi Password Baru *
                </label>
                <div className="relative">
                  <input
                    type={showConfirmPassword ? "text" : "password"}
                    required
                    value={adminConfirmPassword}
                    onChange={(e) => setAdminConfirmPassword(e.target.value)}
                    className="w-full border border-slate-200 dark:border-slate-700 rounded-xl pl-4 pr-10 py-2.5 text-sm bg-slate-50 hover:bg-white dark:bg-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 text-slate-900 dark:text-slate-100"
                    placeholder="Ulangi password baru"
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    aria-label={showConfirmPassword ? "Sembunyikan konfirmasi password" : "Tampilkan konfirmasi password"}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
                  >
                    {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <div className="pt-2 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setAdminPasswordTarget(null)}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="flex items-center gap-1.5 px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white text-xs font-semibold rounded-lg shadow-sm transition-colors disabled:opacity-50"
                >
                  {isSubmitting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <KeyRound className="w-3.5 h-3.5" />}
                  {isSubmitting ? "Menyimpan..." : "Simpan Password"}
                </button>
              </div>
            </form>
          </div>
        )}
      </AppDialog>
    </div>
  );
}
