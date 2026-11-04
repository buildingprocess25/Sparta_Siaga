"use client";

import React, { useEffect, useState, useRef } from "react";
import { toast } from "sonner";
import { AppDialog } from "@/components/shared/app-dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  ShieldAlert,
  UserCog,
  Edit,
  Trash2,
  Plus,
  X,
  Search,
  CheckCircle,
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
  ArrowUpDown,
  Filter,
  Users,
} from "lucide-react";
import { RolePermissionTab } from "@/components/admin/role-permission-tab";
import { UserOverrideTab } from "@/components/admin/user-override-tab";
import {
  HUMAN_SELECTABLE_HO_ROLES,
  HUMAN_SELECTABLE_BRANCH_ROLES,
  getRoleDisplayLabel,
  deriveScopeFromBusinessRole,
} from "@/lib/role-catalog";
import { normalizeBranchCode } from "@/lib/branch-utils";

interface User {
  id: string;
  nik: string | null;
  name: string;
  email: string | null;
  systemRole: "ADMIN" | "USER";
  businessRole: string | null;
  scope: "HO" | "BRANCH" | null;
  branch: string | null;
  status: "ACTIVE" | "INACTIVE";
  source: string;
}

export default function UserManagementPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [filteredUsers, setFilteredUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [activeTab, setActiveTab] = useState<"users" | "roles" | "overrides">("users");
  const [searchTerm, setSearchTerm] = useState("");
  const [filterRole, setFilterRole] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [filterScope, setFilterScope] = useState("");
  const [filterSource, setFilterSource] = useState("");
  const [sortBy, setSortBy] = useState<"hierarchy" | "name-asc" | "name-desc" | "nik-asc" | "status-active">("hierarchy");

  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSyncModalOpen, setIsSyncModalOpen] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncReport, setSyncReport] = useState<any>(null);
  const [syncModule, setSyncModule] = useState<"ALL" | "BUILDING" | "MAINTENANCE" | "ENGINEERING">("ALL");
  const [syncDryRun, setSyncDryRun] = useState(true);
  const [isDeleting, setIsDeleting] = useState<string | null>(null);
  const [formMode, setFormMode] = useState<"CREATE" | "EDIT">("CREATE");
  const [initialEditForm, setInitialEditForm] = useState<any>(null);
  const [editForm, setEditForm] = useState<Partial<User> & { password?: string; confirmPassword?: string }>({
    name: "",
    nik: "",
    email: "",
    systemRole: "USER",
    businessRole: "bms",
    scope: "BRANCH",
    branch: "",
    status: "ACTIVE",
    password: "",
    confirmPassword: ""
  });
  const [formError, setFormError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isResetPasswordOpen, setIsResetPasswordOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showConfirmClose, setShowConfirmClose] = useState(false);
  const [currentStep, setCurrentStep] = useState<1 | 2>(1);
  const [mounted, setMounted] = useState(false);

  // Search Branch/Store State
  const [branchQuery, setBranchQuery] = useState("");
  const [branchResults, setBranchResults] = useState<any[]>([]);
  const [isSearchingBranch, setIsSearchingBranch] = useState(false);
  const [isBranchDropdownOpen, setIsBranchDropdownOpen] = useState(false);
  const [selectedLocationObj, setSelectedLocationObj] = useState<any>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    setMounted(true);
    fetchUsers();
  }, []);

  // Role Hierarchy Weights for organizational ordering
  const getHierarchyWeight = (u: User): number => {
    if (u.systemRole === "ADMIN") return 10;
    const r = (u.businessRole || "").toLowerCase();
    switch (r) {
      case "admin": return 20;
      case "gm_ho": return 20;
      case "sm_ho": return 25;
      case "ho_admin": return 30;
      case "bm": return 40;
      case "bmc": return 50;
      case "bec": return 51;
      case "bbc": return 52;
      case "bms": return 60;
      case "bes": return 61;
      case "bbs": return 62;
      case "store_crew":
      case "tim_toko": return 70;
      default: return 80;
    }
  };

  useEffect(() => {
    let result = [...users];

    // Search filter: nama, NIK, or email
    if (searchTerm.trim()) {
      const lower = searchTerm.trim().toLowerCase();
      result = result.filter(u =>
        (u.name && u.name.toLowerCase().includes(lower)) ||
        (u.nik && u.nik.toLowerCase().includes(lower)) ||
        (u.email && u.email.toLowerCase().includes(lower))
      );
    }

    // Role filter: specific role or system admin
    if (filterRole) {
      if (filterRole === "ADMIN") {
        result = result.filter(u => u.systemRole === "ADMIN");
      } else {
        result = result.filter(u => u.systemRole !== "ADMIN" && u.businessRole?.toLowerCase() === filterRole.toLowerCase());
      }
    }

    // Status filter: ACTIVE or INACTIVE
    if (filterStatus) {
      result = result.filter(u => u.status === filterStatus);
    }

    // Scope filter: HO or BRANCH
    if (filterScope) {
      result = result.filter(u => u.scope === filterScope);
    }

    // Source filter: LOCAL or SPARTA_SYNC
    if (filterSource) {
      if (filterSource === "LOCAL") {
        result = result.filter(u => u.source === "LOCAL");
      } else {
        result = result.filter(u => u.source !== "LOCAL");
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
      return 0;
    });

    setFilteredUsers(result);
  }, [users, searchTerm, filterRole, filterStatus, filterScope, sortBy]);

  // Click outside to close branch dropdown
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsBranchDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Debounced search for canonical organizational branches
  useEffect(() => {
    if (!branchQuery.trim() || branchQuery.length < 1) {
      setBranchResults([]);
      setIsSearchingBranch(false);
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      return;
    }

    // Don't trigger search dropdown if the query matches current selected branch
    if (
      selectedLocationObj &&
      (branchQuery.trim().toUpperCase() === selectedLocationObj.code?.toUpperCase() ||
        branchQuery.trim() === `${selectedLocationObj.code} — ${selectedLocationObj.name}`)
    ) {
      return;
    }

    const delay = setTimeout(async () => {
      setIsSearchingBranch(true);
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      abortControllerRef.current = new AbortController();

      try {
        const res = await fetch(`/api/branches?q=${encodeURIComponent(branchQuery)}`, {
          signal: abortControllerRef.current.signal,
        });
        if (res.ok) {
          const data = await res.json();
          setBranchResults(data.data || []);
          setIsBranchDropdownOpen(true);
        }
      } catch (err: any) {
        if (err.name !== "AbortError") {
          console.error("Branch search failed", err);
        }
      } finally {
        setIsSearchingBranch(false);
      }
    }, 200);

    return () => clearTimeout(delay);
  }, [branchQuery, selectedLocationObj]);

  const fetchUsers = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/users");
      if (res.status === 403) {
        setError("Anda tidak memiliki hak akses (System Admin diperlukan).");
        return;
      }
      if (!res.ok) throw new Error("Gagal mengambil data user");
      const json = await res.json();
      setUsers(json.data || []);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleOpenCreate = () => {
    setFormMode("CREATE");
    const initialState = {
      name: "",
      nik: "",
      email: "",
      systemRole: "USER",
      businessRole: "tim_toko",
      scope: "BRANCH",
      branch: "",
      status: "ACTIVE",
      password: "",
      confirmPassword: ""
    };
    setEditForm(initialState as any);
    setInitialEditForm(initialState);
    setBranchQuery("");
    setSelectedLocationObj(null);
    setFormError(null);
    setShowPassword(false);
    setShowConfirmPassword(false);
    setIsResetPasswordOpen(false);
    setCurrentStep(1);
    setIsModalOpen(true);
  };

  const handleOpenEdit = async (user: User) => {
    setFormMode("EDIT");
    const derived = deriveScopeFromBusinessRole(user.businessRole) || user.scope;
    const initialState = {
      id: user.id,
      name: user.name,
      nik: user.nik || "",
      email: user.email || "",
      systemRole: user.systemRole,
      businessRole: user.businessRole || "",
      scope: derived,
      branch: user.branch,
      status: user.status,
      password: "",
      confirmPassword: ""
    };
    setEditForm(initialState as any);
    setInitialEditForm(initialState);
    setFormError(null);
    setShowPassword(false);
    setShowConfirmPassword(false);
    setIsResetPasswordOpen(false);

    // Resolve canonical organizational branch for edit
    if (derived === "BRANCH" && user.branch) {
      const canonical = normalizeBranchCode(user.branch) || user.branch;
      initialState.branch = canonical;
      setEditForm(initialState as any);
      setBranchQuery(canonical);
      setIsSearchingBranch(true);
      try {
        const res = await fetch(`/api/branches?q=${encodeURIComponent(canonical)}`);
        if (res.ok) {
          const data = await res.json();
          if (data.data && data.data.length > 0) {
            const found = data.data.find((b: any) => b.code === canonical) || data.data[0];
            setSelectedLocationObj(found);
            setBranchQuery(`${found.code} — ${found.name}`);
          } else {
            setSelectedLocationObj({ code: canonical, name: `Cabang ${canonical}` });
            setBranchQuery(canonical);
          }
        }
      } catch (e) {
        console.error(e);
        setSelectedLocationObj({ code: canonical, name: `Cabang ${canonical}` });
        setBranchQuery(canonical);
      } finally {
        setIsSearchingBranch(false);
      }
    } else {
      setBranchQuery("");
      setSelectedLocationObj(null);
    }

    setCurrentStep(1);
    setIsModalOpen(true);
  };

  const handleLocationSelect = (loc: any) => {
    const code = loc.code || loc.cabang || loc.kode_toko;
    const name = loc.name || `Cabang ${code}`;
    setSelectedLocationObj({ ...loc, code, name });
    setBranchQuery(`${code} — ${name}`);
    setEditForm({ ...editForm, branch: code });
    setIsBranchDropdownOpen(false);
  };

  const handleBusinessRoleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const role = e.target.value;
    const newScope = deriveScopeFromBusinessRole(role) || "BRANCH";
    let newBranch = editForm.branch;

    if (newScope === "HO") {
      newBranch = null;
      setBranchQuery("");
      setSelectedLocationObj(null);
    }

    setEditForm({
      ...editForm,
      businessRole: role,
      scope: newScope,
      branch: newBranch
    });
  };

  const handleCloseModal = () => {
    const isDirty = JSON.stringify(editForm) !== JSON.stringify(initialEditForm);
    if (isDirty) {
      setShowConfirmClose(true);
    } else {
      setIsModalOpen(false);
    }
  };

  const handleNextStep = () => {
    setFormError(null);
    if (!editForm.name || !editForm.name.trim()) {
      setFormError("Nama lengkap wajib diisi.");
      return;
    }
    if (formMode === "CREATE" && (!editForm.nik || !editForm.nik.trim())) {
      setFormError("NIK wajib diisi untuk pengguna baru.");
      return;
    }
    if (editForm.systemRole !== "ADMIN") {
      if (!editForm.businessRole) {
        setFormError("Business Role wajib dipilih.");
        return;
      }
      if (editForm.scope === "BRANCH" && (!editForm.branch || !editForm.branch.trim())) {
        setFormError("Cabang / Toko wajib dipilih untuk role dengan cakupan BRANCH.");
        return;
      }
    }
    setCurrentStep(2);
  };

  const handlePrevStep = () => {
    setFormError(null);
    setCurrentStep(1);
  };

  const confirmCloseModal = () => {
    setShowConfirmClose(false);
    setIsModalOpen(false);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (!editForm.name || !editForm.name.trim()) {
      setFormError("Nama lengkap wajib diisi.");
      return;
    }

    // NIK wajib untuk create akun lokal
    if (formMode === "CREATE") {
      if (!editForm.nik || !editForm.nik.trim()) {
        setFormError("NIK wajib diisi untuk pengguna lokal.");
        return;
      }
    }

    if (editForm.systemRole !== "ADMIN") {
      if (!editForm.businessRole) {
        setFormError("Business Role wajib dipilih.");
        return;
      }

      if (editForm.scope === "BRANCH" && (!editForm.branch || !editForm.branch.trim())) {
        setFormError("Cabang / Toko wajib dipilih untuk role dengan cakupan BRANCH.");
        return;
      }
    }

    // Password validation for CREATE mode
    if (formMode === "CREATE") {
      if (!editForm.password || !editForm.password.trim()) {
        setFormError("Password wajib diisi.");
        return;
      }
      if (editForm.password.length < 8) {
        setFormError("Password minimal 8 karakter.");
        return;
      }
      if (editForm.password !== editForm.confirmPassword) {
        setFormError("Konfirmasi password tidak sesuai.");
        return;
      }
    }

    // Password validation for EDIT mode
    if (formMode === "EDIT" && isResetPasswordOpen) {
      if (!editForm.password || !editForm.password.trim()) {
        setFormError("Password baru wajib diisi jika ingin mereset password.");
        return;
      }
      if (editForm.password.length < 8) {
        setFormError("Password minimal 8 karakter.");
        return;
      }
      if (editForm.password !== editForm.confirmPassword) {
        setFormError("Konfirmasi password tidak sesuai.");
        return;
      }
    }

    try {
      const isCreate = formMode === "CREATE";
      const url = isCreate ? "/api/admin/users" : `/api/admin/users/${editForm.id}`;
      const method = isCreate ? "POST" : "PATCH";

      const payload: any = { ...editForm };
      if (!isCreate && (!isResetPasswordOpen || !editForm.password)) {
        delete payload.password;
        delete payload.confirmPassword;
      }

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const json = await res.json();
        throw new Error(json.error || "Gagal menyimpan data");
      }

      await fetchUsers();
      setIsModalOpen(false);
      toast.success(isCreate ? "User berhasil ditambahkan" : "Perubahan berhasil disimpan", {
        description: isCreate ? "Akun pengguna baru berhasil disimpan." : "Data pengguna berhasil diperbarui.",
      });
    } catch (err: any) {
      setFormError(err.message);
      toast.error("Gagal menyimpan perubahan", {
        description: err.message,
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRunSync = async (dryRunMode: boolean) => {
    try {
      setIsSyncing(true);
      const res = await fetch("/api/admin/users/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dryRun: dryRunMode,
          sourceModule: syncModule,
          allowUpdates: true,
        }),
      });

      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error || "Gagal menjalankan sinkronisasi user");
      }

      setSyncReport(json.data);
      if (!dryRunMode) {
        await fetchUsers();
        toast.success("Sinkronisasi SPARTA Berhasil!", {
          description: `${json.data.newCount} user baru ditambahkan, ${json.data.updatedCount} diperbarui.`,
        });
      } else {
        toast.info("Pratinjau (Dry-Run) Selesai", {
          description: `${json.data.validCount} valid dari ${json.data.totalScanned} records. Belum ada data disimpan.`,
        });
      }
    } catch (err: any) {
      toast.error("Gagal sinkronisasi", { description: err.message });
    } finally {
      setIsSyncing(false);
    }
  };

  const handleDelete = async (user: User) => {
    if (user.systemRole === "ADMIN" || user.id === "usr_seed_admin") {
      alert("System Administrator dilindungi dan tidak dapat dihapus.");
      return;
    }

    const confirmed = confirm(
      `Peringatan: Apakah Anda yakin ingin menghapus user '${user.name}' (${user.nik})?\n\nJika user memiliki riwayat audit atau laporan, disarankan untuk menonaktifkan status user (INACTIVE) melalui menu Edit alih-alih menghapus data fisik.`
    );
    if (!confirmed) return;

    try {
      setIsDeleting(user.id);
      const res = await fetch(`/api/admin/users/${user.id}`, {
        method: "DELETE"
      });
      if (!res.ok) {
        const json = await res.json();
        throw new Error(json.error || "Gagal menghapus user");
      }
      await fetchUsers();
      toast.success(user.status === "ACTIVE" ? "User berhasil dihapus/dinonaktifkan" : "Status user berhasil diubah");
    } catch (err: any) {
      toast.error("Gagal menghapus user", { description: err.message });
    } finally {
      setIsDeleting(null);
    }
  };

  if (loading) {
    return (
      <div className="flex h-[50vh] items-center justify-center text-slate-500 dark:text-slate-400">
        <Loader2 className="w-6 h-6 animate-spin mr-2" />
        <span>Memuat data user...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-8">
        <div className="bg-red-50 dark:bg-red-950/30 text-red-600 dark:text-red-400 p-6 rounded-2xl flex items-center gap-4 max-w-2xl mx-auto shadow-sm border border-red-100 dark:border-red-900/50">
          <ShieldAlert className="w-8 h-8" />
          <div>
            <h2 className="font-bold text-lg">Akses Ditolak</h2>
            <p className="text-sm mt-1">{error}</p>
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
            <h1 className="text-xl font-bold text-slate-900 dark:text-white tracking-tight">Manajemen User & Role</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400 font-medium">Pengaturan akses, peran bisnis kanonikal, dan ruang lingkup pengguna SPARTA SIAGA</p>
          </div>
        </div>
        {activeTab === "users" && (
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={() => {
                setSyncReport(null);
                setIsSyncModalOpen(true);
              }}
              className="flex items-center justify-center gap-2 px-3.5 py-2 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-sm font-semibold rounded-lg border border-slate-300 dark:border-slate-700 transition-colors shadow-xs"
            >
              <RotateCcw className="w-4 h-4 text-blue-600 dark:text-blue-400" /> Sinkronisasi SPARTA
            </button>
            <button
              onClick={handleOpenCreate}
              className="flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 dark:bg-blue-600 dark:hover:bg-blue-700 text-white text-sm font-semibold rounded-lg shadow-sm transition-colors"
            >
              <Plus className="w-4 h-4" /> Tambah User
            </button>
          </div>
        )}
      </div>

      {/* 3 Tabs Navigation Bar */}
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
          User
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
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-sm overflow-hidden flex flex-col">
          {/* Quick Summary Badges */}
          <div className="px-4 py-2.5 bg-slate-50/80 dark:bg-slate-950/80 border-b border-slate-100 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2 text-xs">
            <div className="flex flex-wrap items-center gap-2.5 sm:gap-4 text-slate-600 dark:text-slate-400">
              <span className="font-semibold text-slate-900 dark:text-white flex items-center gap-1.5">
                <Users className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                Total: <span className="font-bold">{users.length}</span>
              </span>
              <span className="text-slate-300 dark:text-slate-700 hidden sm:inline">•</span>
              <span className="text-emerald-700 dark:text-emerald-400 font-medium">
                Aktif: <span className="font-bold">{users.filter(u => u.status === "ACTIVE").length}</span>
              </span>
              <span className="text-slate-300 dark:text-slate-700 hidden sm:inline">•</span>
              <span className="text-slate-500 dark:text-slate-400">
                Nonaktif: <span className="font-bold">{users.filter(u => u.status === "INACTIVE").length}</span>
              </span>
              <span className="text-slate-300 dark:text-slate-700 hidden sm:inline">•</span>
              <span className="text-purple-700 dark:text-purple-400 font-medium">
                Admin: <span className="font-bold">{users.filter(u => u.systemRole === "ADMIN").length}</span>
              </span>
              <span className="text-slate-300 dark:text-slate-700 hidden sm:inline">•</span>
              <span className="text-blue-700 dark:text-blue-400 font-medium">
                SPARTA Sync: <span className="font-bold">{users.filter(u => u.source !== "LOCAL").length}</span>
              </span>
            </div>
            <div className="text-slate-500 dark:text-slate-400 text-[11px]">
              Menampilkan <span className="font-bold text-slate-800 dark:text-slate-200">{filteredUsers.length}</span> dari {users.length} akun
            </div>
          </div>

          {/* Filters & Search Bar */}
          <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex flex-col md:flex-row gap-3 bg-white dark:bg-slate-900">
            {/* Search Input with Clear Button */}
            <div className="relative flex-1">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500" />
              <input
                type="text"
                placeholder="Cari nama, NIK, atau email..."
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
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

            {/* Filter Role Dropdown */}
            <select
              value={filterRole}
              onChange={e => setFilterRole(e.target.value)}
              className="border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-sm bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-200 min-w-[150px] focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">Semua Peran / Role</option>
              <optgroup label="System Administrator">
                <option value="ADMIN">System Administrator (ADMIN)</option>
              </optgroup>
              <optgroup label="Head Office (HO)">
                <option value="admin">Admin (HO Administrator)</option>
              </optgroup>
              <optgroup label="Manajemen Cabang">
                <option value="bm">BnM Manajer (Branch)</option>
              </optgroup>
              <optgroup label="Koordinator Cabang">
                <option value="bmc">BMC (Koordinator BMS)</option>
                <option value="bec">BEC (Koordinator BES)</option>
                <option value="bbc">BBC (Koordinator BBS)</option>
              </optgroup>
              <optgroup label="Petugas Lapangan">
                <option value="bms">BMS (Maintenance Staff)</option>
                <option value="bes">BES (Engineering Staff)</option>
                <option value="bbs">BBS (Building Staff)</option>
              </optgroup>
            </select>

            {/* Filter Status Aktif/Nonaktif */}
            <select
              value={filterStatus}
              onChange={e => setFilterStatus(e.target.value)}
              className="border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-sm bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-200 min-w-[130px] focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">Semua Status</option>
              <option value="ACTIVE">Aktif (ACTIVE)</option>
              <option value="INACTIVE">Nonaktif (INACTIVE)</option>
            </select>

            {/* Filter Scope */}
            <select
              value={filterScope}
              onChange={e => setFilterScope(e.target.value)}
              className="border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-sm bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-200 min-w-[130px] focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">Semua Scope</option>
              <option value="HO">HO (Head Office)</option>
              <option value="BRANCH">BRANCH (Cabang)</option>
            </select>

            {/* Filter Sumber Data */}
            <select
              value={filterSource}
              onChange={e => setFilterSource(e.target.value)}
              className="border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-sm bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-200 min-w-[130px] focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">Semua Sumber</option>
              <option value="LOCAL">Lokal (LOCAL)</option>
              <option value="SPARTA_SYNC">SPARTA Sync</option>
            </select>

            {/* Urutan Akun (Sort By) */}
            <select
              value={sortBy}
              onChange={e => setSortBy(e.target.value as any)}
              className="border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-sm bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-200 min-w-[170px] focus:outline-none focus:ring-2 focus:ring-blue-500 font-medium"
            >
              <option value="hierarchy">Urut: Hierarki Jabatan</option>
              <option value="name-asc">Urut: Nama (A - Z)</option>
              <option value="name-desc">Urut: Nama (Z - A)</option>
              <option value="nik-asc">Urut: NIK (Terkecil)</option>
              <option value="status-active">Urut: Status (Aktif Teratas)</option>
            </select>

            {/* Reset Filter Button */}
            {(searchTerm || filterRole || filterStatus || filterScope || sortBy !== "hierarchy") && (
              <button
                type="button"
                onClick={() => {
                  setSearchTerm("");
                  setFilterRole("");
                  setFilterStatus("");
                  setFilterScope("");
                  setSortBy("hierarchy");
                }}
                className="flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-700 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 rounded-lg transition-colors whitespace-nowrap border border-slate-200 dark:border-slate-700"
                title="Reset Semua Filter"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                Reset
              </button>
            )}
          </div>

          <div className="overflow-x-auto flex-1">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="bg-slate-50 dark:bg-slate-950/50 border-b border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400">
                  <th className="py-3 px-4 font-semibold uppercase tracking-wider text-[10px]">User Identity</th>
                  <th className="py-3 px-4 font-semibold uppercase tracking-wider text-[10px]">Business Role</th>
                  <th className="py-3 px-4 font-semibold uppercase tracking-wider text-[10px]">Scope / Cabang</th>
                  <th className="py-3 px-4 font-semibold uppercase tracking-wider text-[10px]">Status</th>
                  <th className="py-3 px-4 font-semibold uppercase tracking-wider text-[10px] text-right">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {filteredUsers.map(user => {
                  const isSystemAdmin = user.systemRole === "ADMIN";
                  return (
                    <tr key={user.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/50 transition-colors">
                      <td className="py-3 px-4">
                        <div className="font-bold text-slate-900 dark:text-slate-200 flex items-center gap-1.5 flex-wrap">
                          {isSystemAdmin && <Shield className="w-3.5 h-3.5 text-purple-600 shrink-0" />}
                          <span>{user.name}</span>
                          {user.source !== "LOCAL" && (
                            <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-blue-50 text-blue-700 border border-blue-200 dark:bg-blue-950/60 dark:text-blue-300 dark:border-blue-800">
                              SPARTA
                            </span>
                          )}
                        </div>
                        <div className="flex flex-col gap-0.5 mt-0.5">
                          <div className="text-[10px] text-slate-500 dark:text-slate-400 font-mono flex items-center gap-1">
                            <span className="font-semibold">NIK:</span> {user.nik ? user.nik : "---"}
                          </div>
                          {user.email && <div className="text-[10px] text-slate-500 dark:text-slate-400 truncate max-w-[150px]">{user.email}</div>}
                        </div>
                      </td>

                      <td className="py-3 px-4">
                        {isSystemAdmin ? (
                          <div className="flex flex-col items-start gap-1">
                            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[10px] font-black bg-purple-100 text-purple-800 dark:bg-purple-950/60 dark:text-purple-300 border border-purple-200 dark:border-purple-800">
                              <Lock className="w-3 h-3 text-purple-600 dark:text-purple-400" /> ADMIN
                            </span>
                            <span className="text-[10px] text-purple-600 dark:text-purple-400 italic">Technical Administrator</span>
                          </div>
                        ) : (
                          <span className="font-bold text-xs text-slate-800 dark:text-slate-200 bg-slate-50 dark:bg-slate-800/80 px-2.5 py-1.5 rounded-lg border border-slate-200/60 dark:border-slate-700/60 inline-block max-w-[200px] truncate" title={getRoleDisplayLabel(user.businessRole)}>
                            {getRoleDisplayLabel(user.businessRole)}
                          </span>
                        )}
                      </td>

                      <td className="py-3 px-4">
                        {isSystemAdmin ? (
                          <span className="text-xs text-slate-400 dark:text-slate-500 font-mono">-</span>
                        ) : (
                          <div>
                            <span className="font-bold text-xs text-blue-700 dark:text-blue-400">
                              {user.scope}
                            </span>
                            {user.scope === "BRANCH" && user.branch && (
                              <>
                                <span className="text-slate-400 dark:text-slate-600 mx-1">•</span>
                                <span className="text-slate-700 dark:text-slate-300 font-medium text-xs">{user.branch}</span>
                              </>
                            )}
                          </div>
                        )}
                      </td>

                      <td className="py-3 px-4">
                        <span className={`inline-flex px-2 py-0.5 rounded-full border text-[10px] font-bold ${user.status === "ACTIVE" ? "bg-emerald-50 border-emerald-200 text-emerald-700 dark:bg-emerald-900/20 dark:border-emerald-800/50 dark:text-emerald-400" : "bg-slate-100 border-slate-200 text-slate-500 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-400"}`}>
                          {user.status}
                        </span>
                      </td>

                      <td className="py-3 px-4 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => handleOpenEdit(user)}
                            className="p-1.5 rounded-lg text-slate-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/30 dark:hover:text-blue-400 transition-colors"
                            title={isSystemAdmin ? "Lihat Detail Admin" : "Edit User"}
                          >
                            <Edit className="w-4 h-4" />
                          </button>
                          {!isSystemAdmin && user.source === "LOCAL" && (
                            <button
                              onClick={() => handleDelete(user)}
                              disabled={isDeleting === user.id}
                              className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/30 dark:hover:text-red-400 transition-colors disabled:opacity-50"
                              title="Hapus / Nonaktifkan User"
                            >
                              {isDeleting === user.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {filteredUsers.length === 0 && (
                  <tr>
                    <td colSpan={5} className="py-12 text-center">
                      <div className="text-slate-400 dark:text-slate-500 mb-2">Belum ada pengguna ditemukan.</div>
                      <button onClick={handleOpenCreate} className="text-sm font-semibold text-blue-600 dark:text-blue-400 hover:underline">
                        + Tambah User
                      </button>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab === "roles" && (
        <RolePermissionTab />
      )}

      {activeTab === "overrides" && (
        <UserOverrideTab />
      )}

      {/* Modal Create / Edit User */}
      <AppDialog
        open={isModalOpen}
        onClose={handleCloseModal}
        title={formMode === "CREATE" ? "Tambah User Baru" : "Edit Data User"}
        description="Form manajemen akun dan penempatan operasional SPARTA SIAGA"
        className="sm:!max-w-2xl"
      >
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl w-full max-w-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90dvh] sm:max-h-[85dvh] overscroll-contain touch-auto select-text">
          {/* Modal Header */}
          <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between bg-slate-50/50 dark:bg-slate-900/50 shrink-0">
            <div className="flex items-center gap-3">
              <div className="p-2.5 bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 rounded-xl">
                {formMode === "CREATE" ? <Plus className="w-5 h-5" /> : <Edit className="w-5 h-5" />}
              </div>
              <div>
                <h2 className="font-bold text-lg text-slate-900 dark:text-white">
                  {formMode === "CREATE" ? "Tambah User Baru" : "Edit Data User"}
                </h2>
                <div className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-2 mt-0.5 font-medium">
                  <span className={currentStep === 1 ? "text-blue-600 dark:text-blue-400" : ""}>1. Identitas & Penempatan</span>
                  <span className="text-slate-300 dark:text-slate-600">→</span>
                  <span className={currentStep === 2 ? "text-blue-600 dark:text-blue-400" : ""}>2. Keamanan & Konfirmasi</span>
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={handleCloseModal}
              aria-label="Tutup modal"
              className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

            {/* Modal Body */}
            <div className="p-6 overflow-y-auto overscroll-contain flex-1 space-y-6">
              {formError && (
                <div className="p-3 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 rounded-xl text-red-600 dark:text-red-400 text-xs font-semibold flex items-center gap-2">
                  <ShieldAlert className="w-4 h-4 shrink-0" />
                  <span>{formError}</span>
                </div>
              )}

              {/* Protected System Admin Notice */}
              {editForm.systemRole === "ADMIN" && (
                <div className="p-4 bg-purple-50 dark:bg-purple-950/40 border border-purple-200 dark:border-purple-800 rounded-xl text-purple-900 dark:text-purple-300 text-xs space-y-1">
                  <div className="font-bold flex items-center gap-1.5">
                    <Shield className="w-4 h-4 text-purple-600" />
                    <span>Akun System Administrator SPARTA SIAGA Dilindungi</span>
                  </div>
                  <p className="text-[11px] leading-relaxed text-purple-800 dark:text-purple-300/80">
                    Akun ini bertindak sebagai administrator teknikal sistem. Tidak memiliki Business Role atau Cabang operasional (Zero Operational Bypass), dan tidak dapat diubah menjadi akun USER.
                  </p>
                </div>
              )}

              <form id="user-form" onSubmit={handleSave} className="space-y-6">

                {currentStep === 1 && (
                  <div className="space-y-6 animate-in fade-in slide-in-from-right-4">
                    {/* SECTION A: Informasi Pengguna */}
                    <div className="space-y-4">
                      <h3 className="text-xs font-bold text-slate-900 dark:text-slate-300 border-b border-slate-100 dark:border-slate-800 pb-2 flex items-center gap-2">
                        <UserIcon className="w-4 h-4 text-blue-500" /> Informasi Pengguna
                      </h3>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div className="space-y-1.5">
                          <label className="text-xs font-bold text-slate-700 dark:text-slate-400">Nama Lengkap *</label>
                          <input
                            required
                            value={editForm.name || ""}
                            onChange={e => setEditForm({...editForm, name: e.target.value})}
                            className="w-full border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-2.5 text-sm bg-slate-50 hover:bg-white dark:bg-slate-900 dark:hover:bg-slate-800 focus:bg-white dark:focus:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all text-slate-900 dark:text-slate-100"
                            placeholder="Mis. Ahmad Fauzi"
                          />
                        </div>
                        <div className="space-y-1.5">
                          <label className="text-xs font-bold text-slate-700 dark:text-slate-400">
                            NIK {formMode === "CREATE" && "*"}
                          </label>
                          <input
                            required={formMode === "CREATE"}
                            value={editForm.nik || ""}
                            onChange={e => setEditForm({...editForm, nik: e.target.value})}
                            className="w-full border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-2.5 text-sm bg-slate-50 hover:bg-white dark:bg-slate-900 dark:hover:bg-slate-800 focus:bg-white dark:focus:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all text-slate-900 dark:text-slate-100"
                            placeholder="Mis. 24001234 atau DEMO-BMS-01"
                          />
                        </div>
                        <div className="space-y-1.5 sm:col-span-2">
                          <label className="text-xs font-bold text-slate-700 dark:text-slate-400">Email</label>
                          <input
                            type="email"
                            value={editForm.email || ""}
                            onChange={e => setEditForm({...editForm, email: e.target.value})}
                            className="w-full border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-2.5 text-sm bg-slate-50 hover:bg-white dark:bg-slate-900 dark:hover:bg-slate-800 focus:bg-white dark:focus:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all text-slate-900 dark:text-slate-100"
                            placeholder="user@sparta.com"
                          />
                        </div>
                      </div>
                    </div>

                    {/* SECTION B: Peran & Penempatan */}
                    {editForm.systemRole !== "ADMIN" && (
                      <div className="space-y-4">
                        <h3 className="text-xs font-bold text-slate-900 dark:text-slate-300 border-b border-slate-100 dark:border-slate-800 pb-2 flex items-center justify-between">
                          <div className="flex items-center gap-2"><Shield className="w-4 h-4 text-blue-500" /> Peran & Penempatan</div>
                          {formMode === "CREATE" && <span className="text-[10px] text-slate-400 font-medium italic font-normal">Akun operasional (USER)</span>}
                        </h3>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          <div className="space-y-1.5">
                            <label className="text-xs font-bold text-slate-700 dark:text-slate-400">Business Role *</label>
                            <select
                              value={editForm.businessRole || "bms"}
                              onChange={handleBusinessRoleChange}
                              className="w-full border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-2.5 text-sm bg-slate-50 dark:bg-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all text-slate-900 dark:text-slate-100 font-semibold"
                            >
                              <optgroup label="HEAD OFFICE (Cakupan Nasional)">
                                {HUMAN_SELECTABLE_HO_ROLES.map((r) => (
                                  <option key={r.key} value={r.key}>{r.label}</option>
                                ))}
                              </optgroup>
                              <optgroup label="BRANCH / CABANG (Cakupan Wilayah)">
                                {HUMAN_SELECTABLE_BRANCH_ROLES.map((r) => (
                                  <option key={r.key} value={r.key}>{r.fullLabel ? `${r.label} \u2014 ${r.fullLabel}` : r.label}</option>
                                ))}
                              </optgroup>
                              {!HUMAN_SELECTABLE_BRANCH_ROLES.some(r => r.key === editForm.businessRole) &&
                               !HUMAN_SELECTABLE_HO_ROLES.some(r => r.key === editForm.businessRole) &&
                               editForm.businessRole && (
                                <optgroup label="PERAN NONAKTIF / HISTORIS">
                                  <option value={editForm.businessRole} disabled>
                                    {getRoleDisplayLabel(editForm.businessRole)} (Nonaktif)
                                  </option>
                                </optgroup>
                              )}
                            </select>
                          </div>

                          <div className="space-y-1.5">
                            <label className="text-xs font-bold text-slate-700 dark:text-slate-400">Otorisasi Scope</label>
                            <div className="w-full border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-2.5 text-sm bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-slate-100 font-bold flex items-center justify-between">
                              <span>{editForm.scope}</span>
                              <span className="text-[10px] text-slate-400 font-normal">
                                {editForm.scope === "HO" ? "Nasional (HO)" : "Terbatas Cabang"}
                              </span>
                            </div>
                          </div>

                          {editForm.scope === "BRANCH" && (
                            <div className="space-y-1.5 relative sm:col-span-2" ref={dropdownRef}>
                              <div className="flex items-center justify-between">
                                <label className="text-xs font-bold text-slate-700 dark:text-slate-400">
                                  Cabang Penempatan *
                                </label>
                                <span className="text-[10px] text-slate-400">Unit Cabang Organisasi</span>
                              </div>
                              <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-tight">
                                Menentukan cabang operasional pengguna yang membawahi seluruh gerai dalam wilayahnya.
                              </p>
                              <div className="relative mt-1">
                                <input
                                  placeholder="Cari cabang (misal: CIKOKOL, BANDUNG, G001)..."
                                  value={branchQuery}
                                  onChange={e => {
                                    setBranchQuery(e.target.value);
                                    if (editForm.branch) setEditForm({ ...editForm, branch: "" });
                                    setIsBranchDropdownOpen(true);
                                  }}
                                  onFocus={() => {
                                    setIsBranchDropdownOpen(true);
                                  }}
                                  className={`w-full border ${(!editForm.branch && branchQuery) ? 'border-amber-400' : 'border-slate-200 dark:border-slate-700'} rounded-xl pl-10 pr-4 py-2.5 text-sm bg-slate-50 hover:bg-white dark:bg-slate-900 dark:hover:bg-slate-800 focus:bg-white dark:focus:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all text-slate-900 dark:text-slate-100`}
                                />
                                <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />

                                {/* Search Dropdown */}
                                {isBranchDropdownOpen && (branchResults.length > 0 || isSearchingBranch || branchQuery.length > 0) && (
                                  <div className="absolute z-10 w-full mt-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl shadow-xl max-h-64 overflow-y-auto text-sm animate-in fade-in slide-in-from-top-2">
                                    {isSearchingBranch ? (
                                      <div className="p-4 text-center text-slate-500 flex items-center justify-center gap-2">
                                        <Loader2 className="w-4 h-4 animate-spin text-blue-600" /> Mencari data cabang...
                                      </div>
                                    ) : branchResults.length > 0 ? (
                                      <ul className="py-1">
                                        {branchResults.map((loc, idx) => {
                                          const code = loc.code || loc.cabang || loc.kode_toko;
                                          const name = loc.name || `Cabang ${code}`;
                                          return (
                                            <li
                                              key={idx}
                                              onClick={() => handleLocationSelect(loc)}
                                              className="px-4 py-2.5 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer flex flex-col border-b border-slate-50 dark:border-slate-800/50 last:border-0"
                                            >
                                              <div className="flex items-center justify-between">
                                                <span className="font-bold text-slate-800 dark:text-slate-200">{code}</span>
                                                {loc.storeCount !== undefined && (
                                                  <span className="text-[10px] text-blue-600 dark:text-blue-400 font-semibold bg-blue-50 dark:bg-blue-950/60 px-2 py-0.5 rounded-full">
                                                    {loc.storeCount.toLocaleString("id-ID")} Toko
                                                  </span>
                                                )}
                                              </div>
                                              <div className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1.5 mt-0.5">
                                                <span>{name}</span>
                                                {loc.aliases && loc.aliases.length > 0 && (
                                                  <span className="text-[10px] text-slate-400 font-mono">
                                                    (Alias: {loc.aliases.join(", ")})
                                                  </span>
                                                )}
                                              </div>
                                            </li>
                                          );
                                        })}
                                      </ul>
                                    ) : (
                                      <div className="p-4 text-center text-slate-500">Cabang tidak ditemukan</div>
                                    )}
                                  </div>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {currentStep === 2 && (
                  <div className="space-y-6 animate-in fade-in slide-in-from-right-4">
                    {/* SUMMARY */}
                    <div className="p-4 bg-slate-50 dark:bg-slate-900/50 border border-slate-100 dark:border-slate-800 rounded-xl space-y-2">
                      <div className="text-xs text-slate-500 font-bold uppercase tracking-wider mb-2">Ringkasan Identitas</div>
                      <div className="grid grid-cols-2 gap-2 text-sm">
                        <div className="text-slate-500">Nama Lengkap</div>
                        <div className="font-medium text-slate-900 dark:text-slate-100">{editForm.name || "-"}</div>
                        <div className="text-slate-500">Business Role</div>
                        <div className="font-medium text-slate-900 dark:text-slate-100">{editForm.systemRole === "ADMIN" ? "System Admin" : getRoleDisplayLabel(editForm.businessRole) || "-"}</div>
                        {editForm.systemRole !== "ADMIN" && (
                          <>
                            <div className="text-slate-500">Cabang / Scope</div>
                            <div className="font-medium text-slate-900 dark:text-slate-100">{editForm.scope === "HO" ? "Head Office" : editForm.branch || "-"}</div>
                          </>
                        )}
                      </div>
                    </div>

                    {/* SECTION C: Keamanan Akun */}
                    {(formMode === "CREATE" || (formMode === "EDIT" && isResetPasswordOpen)) && (
                      <div className="space-y-4">
                        <h3 className="text-xs font-bold text-slate-900 dark:text-slate-300 border-b border-slate-100 dark:border-slate-800 pb-2 flex items-center gap-2">
                          <Lock className="w-4 h-4 text-blue-500" /> Keamanan Akun
                        </h3>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div className="space-y-1.5">
                            <label className="text-xs font-bold text-slate-700 dark:text-slate-400">Password *</label>
                            <div className="relative">
                              <input
                                type={showPassword ? "text" : "password"}
                                required
                                value={editForm.password || ""}
                                onChange={e => setEditForm({...editForm, password: e.target.value})}
                                className="w-full border border-slate-200 dark:border-slate-700 rounded-xl pl-4 pr-10 py-2.5 text-sm bg-slate-50 hover:bg-white dark:bg-slate-900 dark:hover:bg-slate-800 focus:bg-white dark:focus:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all text-slate-900 dark:text-slate-100"
                                placeholder="Min. 8 karakter"
                              />
                              <button
                                type="button"
                                onClick={() => setShowPassword(!showPassword)}
                                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
                              >
                                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                              </button>
                            </div>
                          </div>

                          <div className="space-y-1.5">
                            <label className="text-xs font-bold text-slate-700 dark:text-slate-400">Konfirmasi Password *</label>
                            <div className="relative">
                              <input
                                type={showConfirmPassword ? "text" : "password"}
                                required
                                value={editForm.confirmPassword || ""}
                                onChange={e => setEditForm({...editForm, confirmPassword: e.target.value})}
                                className="w-full border border-slate-200 dark:border-slate-700 rounded-xl pl-4 pr-10 py-2.5 text-sm bg-slate-50 hover:bg-white dark:bg-slate-900 dark:hover:bg-slate-800 focus:bg-white dark:focus:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all text-slate-900 dark:text-slate-100"
                                placeholder="Ulangi password"
                              />
                              <button
                                type="button"
                                onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
                              >
                                {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}

                    {formMode === "EDIT" && (
                      <div className="pt-1">
                        <button
                          type="button"
                          onClick={() => {
                            setIsResetPasswordOpen(!isResetPasswordOpen);
                            setEditForm({ ...editForm, password: "", confirmPassword: "" });
                          }}
                          className="inline-flex items-center gap-2 text-xs font-bold text-[#1D5AA6] dark:text-blue-400 hover:underline"
                        >
                          <KeyRound className="w-3.5 h-3.5" />
                          {isResetPasswordOpen ? "Batal Ubah Password" : "Reset / Ubah Password"}
                        </button>
                      </div>
                    )}

                    {/* SECTION D: Status */}
                    <div className="space-y-4">
                      <h3 className="text-xs font-bold text-slate-900 dark:text-slate-300 border-b border-slate-100 dark:border-slate-800 pb-2 flex items-center gap-2">
                        <Sliders className="w-4 h-4 text-blue-500" /> Status Akun
                      </h3>
                      <div className="space-y-1.5 w-full md:w-1/2">
                        <label className="text-xs font-bold text-slate-700 dark:text-slate-400">Status *</label>
                        <select
                          disabled={editForm.systemRole === "ADMIN"}
                          value={editForm.status || "ACTIVE"}
                          onChange={e => setEditForm({...editForm, status: e.target.value as any})}
                          className={`w-full border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-2.5 text-sm bg-slate-50 dark:bg-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all text-slate-900 dark:text-slate-100 ${editForm.systemRole === "ADMIN" ? "opacity-60 cursor-not-allowed" : ""}`}
                        >
                          <option value="ACTIVE">ACTIVE</option>
                          <option value="INACTIVE">INACTIVE</option>
                        </select>
                        {editForm.systemRole === "ADMIN" && (
                          <div className="text-[10px] text-slate-400">Akun System Admin dilindungi dan harus selalu ACTIVE.</div>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </form>
            </div>

            {/* Modal Footer */}
            <div className="px-6 py-4 border-t border-slate-100 dark:border-slate-800 flex justify-between gap-3 bg-slate-50/50 dark:bg-slate-900/50 shrink-0">
              {currentStep === 2 ? (
                <button
                  type="button"
                  onClick={handlePrevStep}
                  className="px-5 py-2.5 text-sm font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-800 rounded-xl transition-colors"
                >
                  Kembali
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleCloseModal}
                  className="px-5 py-2.5 text-sm font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-800 rounded-xl transition-colors"
                >
                  Batal
                </button>
              )}

              {currentStep === 1 ? (
                <button
                  type="button"
                  onClick={handleNextStep}
                  className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-xl shadow-sm transition-colors"
                >
                  Lanjut
                </button>
              ) : (
                <button
                  type="submit"
                  form="user-form"
                  disabled={isSubmitting}
                  className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-xl shadow-sm transition-colors disabled:opacity-50"
                >
                  {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />} {isSubmitting ? "Menyimpan..." : (formMode === "CREATE" ? "Simpan User" : "Simpan Perubahan")}
                </button>
              )}
            </div>
          </div>
        </AppDialog>

      {/* Confirmation Dialog Unsaved Changes */}
      <AlertDialog open={showConfirmClose} onOpenChange={(open) => { if (!open) setShowConfirmClose(false); }}>
        <AlertDialogContent className="max-w-sm rounded-2xl p-6">
          <AlertDialogHeader>
            <div className="flex items-center gap-3 text-amber-600 dark:text-amber-400">
              <div className="p-2.5 rounded-xl bg-amber-50 dark:bg-amber-950/50">
                <AlertTriangle className="w-6 h-6" />
              </div>
              <AlertDialogTitle className="text-base font-bold text-slate-900 dark:text-white">
                Perubahan Belum Disimpan
              </AlertDialogTitle>
            </div>
            <AlertDialogDescription className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed text-left pt-2">
              Ada perubahan yang belum disimpan. Apakah Anda yakin ingin menutup tanpa menyimpan?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex items-center justify-end gap-3 pt-2">
            <AlertDialogCancel
              onClick={() => setShowConfirmClose(false)}
              className="rounded-xl text-xs font-bold"
            >
              Batal
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmCloseModal}
              className="rounded-xl text-xs font-bold bg-amber-600 hover:bg-amber-700 text-white"
            >
              Ya, Tutup
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Modal Sinkronisasi SPARTA */}
      <AppDialog
        open={isSyncModalOpen}
        onClose={() => setIsSyncModalOpen(false)}
        title="Sinkronisasi User SPARTA"
        description="Sinkronisasi pengguna dari data Building, Maintenance, dan Engineering ke 9 peran kanonikal SIAGA"
        className="sm:!max-w-3xl"
      >
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl w-full max-w-3xl shadow-2xl overflow-hidden flex flex-col max-h-[90dvh] sm:max-h-[85dvh] overscroll-contain">
          {/* Header */}
          <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between bg-slate-50/50 dark:bg-slate-900/50 shrink-0">
            <div className="flex items-center gap-3">
              <div className="p-2.5 bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 rounded-xl">
                <RotateCcw className="w-5 h-5" />
              </div>
              <div>
                <h2 className="font-bold text-lg text-slate-900 dark:text-white">Sinkronisasi User SPARTA</h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Idempoten, validasi identitas, proteksi duplikasi NIK, dan isolasi role 9 persona kanonikal.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setIsSyncModalOpen(false)}
              className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Body */}
          <div className="p-6 overflow-y-auto space-y-5">
            {/* Source Module Selection */}
            <div className="bg-slate-50 dark:bg-slate-800/40 p-4 rounded-xl border border-slate-200/60 dark:border-slate-700/60 space-y-3">
              <label className="text-xs font-bold text-slate-700 dark:text-slate-300 block">
                Sumber Data Ekosistem SPARTA:
              </label>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {[
                  { id: "ALL", label: "Semua Modul" },
                  { id: "MAINTENANCE", label: "Maintenance" },
                  { id: "BUILDING", label: "Building" },
                  { id: "ENGINEERING", label: "Engineering" },
                ].map((mod) => (
                  <button
                    key={mod.id}
                    type="button"
                    onClick={() => setSyncModule(mod.id as any)}
                    className={`py-2 px-3 rounded-lg text-xs font-semibold border transition-all text-center ${
                      syncModule === mod.id
                        ? "bg-blue-600 text-white border-blue-600 shadow-xs"
                        : "bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700"
                    }`}
                  >
                    {mod.label}
                  </button>
                ))}
              </div>

              <div className="flex flex-wrap items-center gap-3 pt-2">
                <button
                  type="button"
                  disabled={isSyncing}
                  onClick={() => handleRunSync(true)}
                  className="px-4 py-2 bg-slate-200 hover:bg-slate-300 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-800 dark:text-slate-200 rounded-lg text-xs font-bold transition-colors flex items-center gap-2 disabled:opacity-50"
                >
                  {isSyncing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Eye className="w-3.5 h-3.5" />}
                  Uji Coba (Dry-Run Preview)
                </button>
                <button
                  type="button"
                  disabled={isSyncing}
                  onClick={() => handleRunSync(false)}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold transition-colors flex items-center gap-2 shadow-xs disabled:opacity-50"
                >
                  {isSyncing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle className="w-3.5 h-3.5" />}
                  Jalankan Sinkronisasi Database
                </button>
              </div>
            </div>

            {/* Sync Report / Results Preview */}
            {syncReport && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                    Hasil {syncReport.dryRun ? "Pratinjau (Dry-Run)" : "Eksekusi Sinkronisasi"}
                  </h3>
                  <span className="text-[11px] text-slate-400 font-mono">{syncReport.timestamp}</span>
                </div>

                {/* Counters */}
                <div className="grid grid-cols-2 sm:grid-cols-6 gap-2 text-center text-xs">
                  <div className="p-3 bg-slate-50 dark:bg-slate-800/60 rounded-xl border border-slate-200/60 dark:border-slate-700">
                    <div className="text-slate-400 text-[10px] uppercase font-semibold">Total Data</div>
                    <div className="text-base font-black text-slate-800 dark:text-slate-100 mt-0.5">
                      {syncReport.totalScanned}
                    </div>
                  </div>
                  <div className="p-3 bg-emerald-50 dark:bg-emerald-950/30 rounded-xl border border-emerald-200/60 dark:border-emerald-800/40">
                    <div className="text-emerald-700 dark:text-emerald-400 text-[10px] uppercase font-semibold">User Baru</div>
                    <div className="text-base font-black text-emerald-800 dark:text-emerald-300 mt-0.5">
                      {syncReport.newCount}
                    </div>
                  </div>
                  <div className="p-3 bg-blue-50 dark:bg-blue-950/30 rounded-xl border border-blue-200/60 dark:border-blue-800/40">
                    <div className="text-blue-700 dark:text-blue-400 text-[10px] uppercase font-semibold">Diperbarui</div>
                    <div className="text-base font-black text-blue-800 dark:text-blue-300 mt-0.5">
                      {syncReport.updatedCount}
                    </div>
                  </div>
                  <div className="p-3 bg-slate-50 dark:bg-slate-800/60 rounded-xl border border-slate-200/60 dark:border-slate-700">
                    <div className="text-slate-500 text-[10px] uppercase font-semibold">Tetap / Sesuai</div>
                    <div className="text-base font-black text-slate-600 dark:text-slate-300 mt-0.5">
                      {syncReport.unchangedCount}
                    </div>
                  </div>
                  <div className="p-3 bg-amber-50 dark:bg-amber-950/30 rounded-xl border border-amber-200/60 dark:border-amber-800/40">
                    <div className="text-amber-700 dark:text-amber-400 text-[10px] uppercase font-semibold">Dilewati</div>
                    <div className="text-base font-black text-amber-800 dark:text-amber-300 mt-0.5">
                      {syncReport.skippedCount}
                    </div>
                  </div>
                  <div className="p-3 bg-purple-50 dark:bg-purple-950/30 rounded-xl border border-purple-200/60 dark:border-purple-800/40">
                    <div className="text-purple-700 dark:text-purple-400 text-[10px] uppercase font-semibold">Perlu Review</div>
                    <div className="text-base font-black text-purple-800 dark:text-purple-300 mt-0.5">
                      {syncReport.flaggedForReviewCount || 0}
                    </div>
                  </div>
                </div>

                {/* Detailed Table Preview */}
                <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden max-h-64 overflow-y-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-50 dark:bg-slate-800/80 text-slate-600 dark:text-slate-400 border-b border-slate-200 dark:border-slate-700 sticky top-0">
                      <tr>
                        <th className="py-2 px-3">Identitas (NIK/Email/SSO)</th>
                        <th className="py-2 px-3">Nama</th>
                        <th className="py-2 px-3">Modul</th>
                        <th className="py-2 px-3">Role Target</th>
                        <th className="py-2 px-3">Cabang</th>
                        <th className="py-2 px-3">Status</th>
                        <th className="py-2 px-3">Keterangan</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {syncReport.records.map((r: any, idx: number) => (
                        <tr key={idx} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/40">
                          <td className="py-2 px-3 font-mono font-bold text-slate-800 dark:text-slate-200 truncate max-w-[130px]" title={r.identifier || r.nik || r.email || "-"}>
                            {r.identifier || r.nik || r.email || "-"}
                          </td>
                          <td className="py-2 px-3 text-slate-900 dark:text-slate-100">{r.name}</td>
                          <td className="py-2 px-3 font-mono text-[10px] text-slate-500">{r.sourceModule}</td>
                          <td className="py-2 px-3 font-semibold text-blue-700 dark:text-blue-400">
                            {r.targetRole ? getRoleDisplayLabel(r.targetRole) : "-"}
                          </td>
                          <td className="py-2 px-3 text-slate-600 dark:text-slate-300">{r.targetBranch || "HO"}</td>
                          <td className="py-2 px-3">
                            <span
                              className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                                r.status === "NEW"
                                  ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
                                  : r.status === "UPDATE"
                                  ? "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300"
                                  : r.status === "UNCHANGED"
                                  ? "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400"
                                  : r.status === "FLAGGED_FOR_REVIEW"
                                  ? "bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-300"
                                  : "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300"
                              }`}
                            >
                              {r.status === "FLAGGED_FOR_REVIEW" ? "REVIEW" : r.status}
                            </span>
                          </td>
                          <td className="py-2 px-3 text-[11px] text-slate-500 max-w-xs truncate" title={r.reason}>
                            {r.reason}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="px-6 py-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-end bg-slate-50/50 dark:bg-slate-900/50">
            <button
              type="button"
              onClick={() => setIsSyncModalOpen(false)}
              className="px-4 py-2 bg-slate-200 hover:bg-slate-300 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-lg text-xs font-bold transition-colors"
            >
              Tutup
            </button>
          </div>
        </div>
      </AppDialog>
    </div>
  );
}
