"use client";

import React, { useEffect, useState, useRef, useMemo } from "react";
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
  Users,
  CheckCircle2,
  XCircle,
  ShieldCheck,
  Building2,
  Globe,
  ChevronLeft,
  ChevronRight,
  Info,
  Store,
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
  externalUserId?: string | null;
  nik: string | null;
  name: string;
  email: string | null;
  systemRole: "ADMIN" | "USER";
  businessRole: string | null;
  scope: "HO" | "BRANCH" | null;
  branch: string | null;
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
  activeOverrides?: Array<{ key: string; effect: string; reason: string }>;
  tokenVersion?: number;
  createdAt?: string;
  updatedAt?: string;
}

export default function UserManagementPage() {
  const [users, setUsers] = useState<User[]>([]);
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

  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSsoInfoModalOpen, setIsSsoInfoModalOpen] = useState(false);
  const [selectedUserForDetail, setSelectedUserForDetail] = useState<User | null>(null);
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
    confirmPassword: "",
  });
  const [formError, setFormError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isResetPasswordOpen, setIsResetPasswordOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showConfirmClose, setShowConfirmClose] = useState(false);
  const [currentStep, setCurrentStep] = useState<1 | 2>(1);

  // Search Branch/Store State
  const [branchQuery, setBranchQuery] = useState("");
  const [branchResults, setBranchResults] = useState<any[]>([]);
  const [isSearchingBranch, setIsSearchingBranch] = useState(false);
  const [isBranchDropdownOpen, setIsBranchDropdownOpen] = useState(false);
  const [selectedLocationObj, setSelectedLocationObj] = useState<any>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

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
          (u.branch && u.branch.toLowerCase().includes(lower))
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
        setError("Akses Ditolak: Anda tidak memiliki hak akses (Hanya System Administrator yang dapat mengelola pengguna).");
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
      businessRole: "bms",
      scope: "BRANCH",
      branch: "",
      status: "ACTIVE",
      password: "",
      confirmPassword: "",
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
      source: user.source,
      password: "",
      confirmPassword: "",
    };
    setEditForm(initialState as any);
    setInitialEditForm(initialState);
    setFormError(null);
    setShowPassword(false);
    setShowConfirmPassword(false);
    setIsResetPasswordOpen(false);

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
      branch: newBranch,
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

    // Password validation only for LOCAL accounts
    const isLocalUser = editForm.source === "LOCAL" || formMode === "CREATE";
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
    } else if (isLocalUser && isResetPasswordOpen) {
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
      setIsSubmitting(true);
      const isCreate = formMode === "CREATE";
      const url = isCreate ? "/api/admin/users" : `/api/admin/users/${editForm.id}`;
      const method = isCreate ? "POST" : "PATCH";

      const payload: any = { ...editForm };
      if (!isCreate && (!isLocalUser || !isResetPasswordOpen || !editForm.password)) {
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

  const handleDelete = async (user: User) => {
    if (user.systemRole === "ADMIN" || user.id === "usr_seed_admin" || user.id === "usr_sysadmin_01") {
      alert("System Administrator dilindungi dan tidak dapat dihapus.");
      return;
    }

    if (user.source !== "LOCAL") {
      alert("Akun SSO dikelola melalui Portal Login Sparta dan tidak dapat dihapus dari SIAGA. Anda dapat menonaktifkan akun melalui menu Edit.");
      return;
    }

    const confirmed = confirm(
      `Peringatan: Apakah Anda yakin ingin menghapus user '${user.name}' (${user.nik})?\n\nJika user memiliki riwayat audit atau laporan, disarankan untuk menonaktifkan status user (INACTIVE) melalui menu Edit alih-alih menghapus data fisik.`
    );
    if (!confirmed) return;

    try {
      setIsDeleting(user.id);
      const res = await fetch(`/api/admin/users/${user.id}`, {
        method: "DELETE",
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
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={() => setIsSsoInfoModalOpen(true)}
              className="flex items-center justify-center gap-2 px-3.5 py-2 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-sm font-semibold rounded-lg border border-slate-300 dark:border-slate-700 transition-colors shadow-xs"
              title="Informasi Arsitektur SSO Portal Sparta"
            >
              <Globe className="w-4 h-4 text-blue-600 dark:text-blue-400" />
              <span>Integrasi SSO Sparta</span>
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
                              {user.scope === "BRANCH" && user.branch && (
                                <>
                                  <span className="text-slate-400 dark:text-slate-600 mx-1">•</span>
                                  <span className="text-slate-700 dark:text-slate-300 font-medium text-xs">
                                    {user.branch}
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
                              className="p-1.5 rounded-lg text-slate-500 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/30 dark:hover:text-blue-400 transition-colors"
                              title="Lihat Detail Izin Efektif Pengguna"
                            >
                              <Shield className="w-4 h-4" />
                            </button>

                            {/* Tombol Edit User */}
                            <button
                              type="button"
                              onClick={() => handleOpenEdit(user)}
                              className="p-1.5 rounded-lg text-slate-500 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/30 dark:hover:text-blue-400 transition-colors"
                              title={isSystemAdmin ? "Lihat Detail Admin" : "Edit User"}
                            >
                              <Edit className="w-4 h-4" />
                            </button>

                            {/* Tombol Hapus (Hanya untuk Lokal non-Admin) */}
                            {!isSystemAdmin && user.source === "LOCAL" && (
                              <button
                                type="button"
                                onClick={() => handleDelete(user)}
                                disabled={isDeleting === user.id}
                                className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/30 dark:hover:text-red-400 transition-colors disabled:opacity-50"
                                title="Hapus User Lokal"
                              >
                                {isDeleting === user.id ? (
                                  <Loader2 className="w-4 h-4 animate-spin" />
                                ) : (
                                  <Trash2 className="w-4 h-4" />
                                )}
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
                    <div className="font-semibold text-slate-800 dark:text-slate-200">{selectedUserForDetail.scope || "Nasional / N/A"} {selectedUserForDetail.branch ? `(Cabang ${selectedUserForDetail.branch})` : ""}</div>
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

            <div className="px-6 py-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between bg-slate-50/50 dark:bg-slate-900/50">
              <button
                type="button"
                onClick={() => {
                  setSelectedUserForDetail(null);
                  setActiveTab("overrides");
                }}
                className="text-xs font-bold text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1.5"
              >
                <Sliders className="w-3.5 h-3.5" /> Kelola di Tab Akses Khusus User →
              </button>
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
                  SSO Terpusat & Otorisasi Mandiri SPARTA SIAGA
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setIsSsoInfoModalOpen(false)}
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
                Portal Login Sparta adalah sumber identitas terpusat, autentikasi kredensial, dan grant modul ekosistem. Database SPARTA SIAGA adalah sumber tunggal penetapan role kanonikal, cakupan cabang, status akun SIAGA, dan hak perizinan internal.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
              <div className="p-3 border border-slate-200 dark:border-slate-800 rounded-xl space-y-1">
                <div className="font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600" /> Identitas SSO Sparta
                </div>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  Pencocokan akun dilakukan menggunakan <code className="font-mono bg-slate-100 dark:bg-slate-800 px-1 py-0.5 rounded">external_user_id</code>. Akun tidak dibuat secara otomatis dari email bebas.
                </p>
              </div>

              <div className="p-3 border border-slate-200 dark:border-slate-800 rounded-xl space-y-1">
                <div className="font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                  <ShieldCheck className="w-4 h-4 text-blue-600" /> Penetapan HO Mandiri
                </div>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  24 akun Head Office aktif terbagi menjadi 8 akun Monitoring + Instruksi dan 16 akun Monitoring Saja yang dilindungi oleh override perizinan internal.
                </p>
              </div>

              <div className="p-3 border border-slate-200 dark:border-slate-800 rounded-xl space-y-1">
                <div className="font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                  <Lock className="w-4 h-4 text-purple-600" /> Proteksi System Administrator
                </div>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  Akun System Administrator diisolasi dari peran bisnis dan operasional cabang (Zero Operational Bypass), serta dilindungi dari penghapusan atau demosi.
                </p>
              </div>

              <div className="p-3 border border-slate-200 dark:border-slate-800 rounded-xl space-y-1">
                <div className="font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4 text-slate-600" /> Penonaktifan Sinkronisasi Lama
                </div>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  Impor dataset staging/CSV lama telah dinonaktifkan dari UI operasional guna menjamin stabilitas dan integritas data pengguna Production.
                </p>
              </div>
            </div>
          </div>

          <div className="px-6 py-3 border-t border-slate-100 dark:border-slate-800 flex justify-end bg-slate-50/50 dark:bg-slate-900/50">
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
                  <span className={currentStep === 1 ? "text-blue-600 dark:text-blue-400 font-bold" : ""}>
                    1. Identitas & Penempatan
                  </span>
                  <span className="text-slate-300 dark:text-slate-600">→</span>
                  <span className={currentStep === 2 ? "text-blue-600 dark:text-blue-400 font-bold" : ""}>
                    2. Status & Konfirmasi
                  </span>
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

            {/* SSO Account Notice */}
            {formMode === "EDIT" && editForm.source !== "LOCAL" && (
              <div className="p-3 bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800 rounded-xl text-blue-900 dark:text-blue-300 text-xs flex items-center gap-2.5">
                <Globe className="w-4 h-4 text-blue-600 shrink-0" />
                <div>
                  <span className="font-bold">Akun Terhubung Portal Sparta SSO:</span> Kredensial dan kata sandi dikelola secara terpusat melalui Portal Login Sparta. SPARTA SIAGA mengelola peran bisnis, cabang, dan status akun internal.
                </div>
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
                        <label className="text-xs font-bold text-slate-700 dark:text-slate-400">
                          Nama Lengkap *
                        </label>
                        <input
                          required
                          value={editForm.name || ""}
                          onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
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
                          onChange={(e) => setEditForm({ ...editForm, nik: e.target.value })}
                          className="w-full border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-2.5 text-sm bg-slate-50 hover:bg-white dark:bg-slate-900 dark:hover:bg-slate-800 focus:bg-white dark:focus:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all text-slate-900 dark:text-slate-100"
                          placeholder="Mis. 24001234"
                        />
                      </div>
                      <div className="space-y-1.5 sm:col-span-2">
                        <label className="text-xs font-bold text-slate-700 dark:text-slate-400">Email</label>
                        <input
                          type="email"
                          value={editForm.email || ""}
                          onChange={(e) => setEditForm({ ...editForm, email: e.target.value })}
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
                        <div className="flex items-center gap-2">
                          <Shield className="w-4 h-4 text-blue-500" /> Peran & Penempatan
                        </div>
                        {formMode === "CREATE" && (
                          <span className="text-[10px] text-slate-400 font-normal italic">
                            Akun operasional (USER)
                          </span>
                        )}
                      </h3>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div className="space-y-1.5">
                          <label className="text-xs font-bold text-slate-700 dark:text-slate-400">
                            Business Role *
                          </label>
                          <select
                            value={editForm.businessRole || "bms"}
                            onChange={handleBusinessRoleChange}
                            className="w-full border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-2.5 text-sm bg-slate-50 dark:bg-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all text-slate-900 dark:text-slate-100 font-semibold"
                          >
                            <optgroup label="HEAD OFFICE (Cakupan Nasional)">
                              {HUMAN_SELECTABLE_HO_ROLES.map((r) => (
                                <option key={r.key} value={r.key}>
                                  {r.label}
                                </option>
                              ))}
                            </optgroup>
                            <optgroup label="BRANCH / CABANG (Cakupan Wilayah)">
                              {HUMAN_SELECTABLE_BRANCH_ROLES.map((r) => (
                                <option key={r.key} value={r.key}>
                                  {r.fullLabel ? `${r.label} \u2014 ${r.fullLabel}` : r.label}
                                </option>
                              ))}
                            </optgroup>
                            {!HUMAN_SELECTABLE_BRANCH_ROLES.some((r) => r.key === editForm.businessRole) &&
                              !HUMAN_SELECTABLE_HO_ROLES.some((r) => r.key === editForm.businessRole) &&
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
                          <label className="text-xs font-bold text-slate-700 dark:text-slate-400">
                            Otorisasi Scope
                          </label>
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
                            <div className="relative mt-1">
                              <input
                                placeholder="Cari cabang (misal: CIKOKOL, BANDUNG, G001)..."
                                value={branchQuery}
                                onChange={(e) => {
                                  setBranchQuery(e.target.value);
                                  if (editForm.branch) setEditForm({ ...editForm, branch: "" });
                                  setIsBranchDropdownOpen(true);
                                }}
                                onFocus={() => {
                                  setIsBranchDropdownOpen(true);
                                }}
                                className={`w-full border ${
                                  !editForm.branch && branchQuery ? "border-amber-400" : "border-slate-200 dark:border-slate-700"
                                } rounded-xl pl-10 pr-4 py-2.5 text-sm bg-slate-50 hover:bg-white dark:bg-slate-900 dark:hover:bg-slate-800 focus:bg-white dark:focus:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all text-slate-900 dark:text-slate-100`}
                              />
                              <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />

                              {/* Search Dropdown */}
                              {isBranchDropdownOpen &&
                                (branchResults.length > 0 || isSearchingBranch || branchQuery.length > 0) && (
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
                    <div className="text-xs text-slate-500 font-bold uppercase tracking-wider mb-2">
                      Ringkasan Identitas & Penempatan
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-sm">
                      <div className="text-slate-500">Nama Lengkap</div>
                      <div className="font-medium text-slate-900 dark:text-slate-100">{editForm.name || "-"}</div>
                      <div className="text-slate-500">Business Role</div>
                      <div className="font-medium text-slate-900 dark:text-slate-100">
                        {editForm.systemRole === "ADMIN" ? "System Admin" : getRoleDisplayLabel(editForm.businessRole) || "-"}
                      </div>
                      {editForm.systemRole !== "ADMIN" && (
                        <>
                          <div className="text-slate-500">Cabang / Scope</div>
                          <div className="font-medium text-slate-900 dark:text-slate-100">
                            {editForm.scope === "HO" ? "Head Office" : editForm.branch || "-"}
                          </div>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Password fields only for LOCAL accounts */}
                  {(formMode === "CREATE" || (formMode === "EDIT" && editForm.source === "LOCAL" && isResetPasswordOpen)) && (
                    <div className="space-y-4">
                      <h3 className="text-xs font-bold text-slate-900 dark:text-slate-300 border-b border-slate-100 dark:border-slate-800 pb-2 flex items-center gap-2">
                        <Lock className="w-4 h-4 text-blue-500" /> Keamanan Akun Lokal
                      </h3>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="space-y-1.5">
                          <label className="text-xs font-bold text-slate-700 dark:text-slate-400">Password *</label>
                          <div className="relative">
                            <input
                              type={showPassword ? "text" : "password"}
                              required
                              value={editForm.password || ""}
                              onChange={(e) => setEditForm({ ...editForm, password: e.target.value })}
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
                          <label className="text-xs font-bold text-slate-700 dark:text-slate-400">
                            Konfirmasi Password *
                          </label>
                          <div className="relative">
                            <input
                              type={showConfirmPassword ? "text" : "password"}
                              required
                              value={editForm.confirmPassword || ""}
                              onChange={(e) => setEditForm({ ...editForm, confirmPassword: e.target.value })}
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

                  {formMode === "EDIT" && editForm.source === "LOCAL" && (
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
                        {isResetPasswordOpen ? "Batal Ubah Password" : "Reset / Ubah Password Akun Lokal"}
                      </button>
                    </div>
                  )}

                  {/* Status Akun */}
                  <div className="space-y-4">
                    <h3 className="text-xs font-bold text-slate-900 dark:text-slate-300 border-b border-slate-100 dark:border-slate-800 pb-2 flex items-center gap-2">
                      <Sliders className="w-4 h-4 text-blue-500" /> Status Akun SIAGA
                    </h3>
                    <div className="space-y-1.5 w-full md:w-1/2">
                      <label className="text-xs font-bold text-slate-700 dark:text-slate-400">Status *</label>
                      <select
                        disabled={editForm.systemRole === "ADMIN"}
                        value={editForm.status || "ACTIVE"}
                        onChange={(e) => setEditForm({ ...editForm, status: e.target.value as any })}
                        className={`w-full border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-2.5 text-sm bg-slate-50 dark:bg-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all text-slate-900 dark:text-slate-100 ${
                          editForm.systemRole === "ADMIN" ? "opacity-60 cursor-not-allowed" : ""
                        }`}
                      >
                        <option value="ACTIVE">ACTIVE</option>
                        <option value="INACTIVE">INACTIVE</option>
                      </select>
                      {editForm.systemRole === "ADMIN" && (
                        <div className="text-[10px] text-slate-400">
                          Akun System Admin dilindungi dan harus selalu ACTIVE.
                        </div>
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
                {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}{" "}
                {isSubmitting
                  ? "Menyimpan..."
                  : formMode === "CREATE"
                  ? "Simpan User"
                  : "Simpan Perubahan"}
              </button>
            )}
          </div>
        </div>
      </AppDialog>

      {/* Confirmation Dialog Unsaved Changes */}
      <AlertDialog
        open={showConfirmClose}
        onOpenChange={(open) => {
          if (!open) setShowConfirmClose(false);
        }}
      >
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
    </div>
  );
}
