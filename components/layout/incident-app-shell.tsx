"use client";

import React, { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  MapPin,
  ClipboardList,
  Activity,
  History,
  Settings,
  Bell,
  Search,
  Calendar,
  ShieldAlert,
  Store,
  ChevronDown,
  ChevronUp,
  Menu,
  X,
  Sun,
  Moon,
  UserCog,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  Wrench,
} from "lucide-react";
import { RoleType } from "@/types/incident";
import { PwaInstallPrompt } from "@/components/pwa/pwa-install-prompt";

export interface IncidentAppShellProps {
  activeRole: RoleType;
  onRoleChange: (role: RoleType) => void;
  activeIncidentCount?: number;
  onOpenNotifications?: () => void;
  onSearchClick?: () => void;
  theme?: "dark" | "light";
  onToggleTheme?: () => void;
  onOpenReportModal?: () => void;
  testingMode?: boolean;
  children: React.ReactNode;
}

export function IncidentAppShell({
  activeRole,
  onRoleChange,
  activeIncidentCount = 0,
  onOpenNotifications,
  onSearchClick,
  theme = "light",
  onToggleTheme,
  onOpenReportModal,
  testingMode: testingModeProp,
  children,
}: IncidentAppShellProps) {
  const [internalTestingMode, setInternalTestingMode] = useState<boolean>(Boolean(testingModeProp));

  React.useEffect(() => {
    if (typeof testingModeProp === "boolean") {
      setInternalTestingMode(testingModeProp);
      return;
    }
    const checkTestingMode = () => {
      fetch("/api/admin/testing-mode")
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (data?.state) {
            setInternalTestingMode(Boolean(data.state.enabled));
          }
        })
        .catch(() => {});
    };
    checkTestingMode();
    const interval = setInterval(checkTestingMode, 15000);
    return () => clearInterval(interval);
  }, [testingModeProp]);

  const activeTestingMode = typeof testingModeProp === "boolean" ? testingModeProp : internalTestingMode;
  const [isRoleDropdownOpen, setIsRoleDropdownOpen] = useState(false);
  const [isMoreSheetOpen, setIsMoreSheetOpen] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const profileMenuRef = React.useRef<HTMLDivElement>(null);
  const [identity, setIdentity] = useState<{
    id: string;
    nik?: string | null;
    name: string;
    avatarUrl?: string | null;
    role?: string | null;
    businessRole?: string | null;
    branch?: string | null;
    systemRole: string;
    scope?: string | null;
  } | null>(null);
  const pathname = usePathname();

  const businessRoleDisplayMap: Record<string, string> = {
    ho_admin: "HO Admin",
    gm_ho: "GM HO",
    sm_ho: "SM HO",
    bm: "BnM Manajer",
    bnm: "BnM",
    bbc: "BBC",
    bmc: "BMC",
    bec: "BEC",
    bes: "BES",
    bms: "BMS",
    tim_toko: "Tim Toko",
    tim_maintenance: "Sparta Maintenance",
    tim_office: "Tim Office",
    tim_warehouse: "Tim Warehouse",
    sparta_maintenance: "Sparta Maintenance",
    store_manager_affected: "Store Manager",
    store_manager_normal: "Store Manager",
  };

  const getRoleSubtitle = (user: typeof identity) => {
    if (!user) return "";
    if (user.systemRole === "ADMIN") {
      return "System Administrator";
    }
    const business = user.businessRole 
      ? (businessRoleDisplayMap[user.businessRole] || user.businessRole) 
      : "User";
    const loc = user.scope === "HO" ? "Head Office" : (user.branch || "Cabang");
    return `${business} • ${loc}`;
  };

  const getPageTitle = (currentPath: string) => {
    if (currentPath === "/") return "Ringkasan Operasional";
    if (currentPath.startsWith("/monitoring")) return "Peta Monitoring Spasial";
    if (currentPath.startsWith("/alerts")) return "Event & Deteksi Bencana";
    if (currentPath.startsWith("/reports/tracking")) return "Laporan Kejadian";
    if (currentPath.startsWith("/reports/history")) return "Riwayat Laporan Historis";
    if (currentPath.startsWith("/reports/shared-queue")) return "Penugasan";
    if (currentPath.startsWith("/reports")) return "Pusat Laporan Kejadian";
    if (currentPath.startsWith("/settings")) return "Pengaturan Sistem";
    if (currentPath.startsWith("/admin/facilities")) return "Master Fasilitas";
    if (currentPath.startsWith("/admin/reconciliation")) return "Rekonsiliasi Gempa";
    if (currentPath.startsWith("/admin")) return "Manajemen User & Hak Akses";
    return "Sistem Mitigasi";
  };

  // Lock body scroll when mobile sheet is open
  React.useEffect(() => {
    if (isMoreSheetOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [isMoreSheetOpen]);

  // Close menus and sheets on Escape key
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (isRoleDropdownOpen) setIsRoleDropdownOpen(false);
        if (isMoreSheetOpen) setIsMoreSheetOpen(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isRoleDropdownOpen, isMoreSheetOpen]);

  React.useEffect(() => {
    fetch("/api/auth/me")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data) {
          setIdentity(data.user || data);
        }
      })
      .catch(() => {});
  }, []);

  const isDark = theme === "dark";
  const isHoViewer = identity?.scope === "HO" && identity?.systemRole !== "ADMIN";
  const pageTitle = getPageTitle(pathname);
  const isMonitoringPage = pathname.startsWith("/monitoring");


  const roleLabels: Record<RoleType, { title: string; subtitle: string; icon: React.ReactNode }> = {
    ho_admin: {
      title: "Admin HO",
      subtitle: "Head Office Command Center",
      icon: <ShieldAlert className="w-4 h-4 text-red-500" />,
    },
    store_manager_affected: {
      title: "SM Toko Cibubur",
      subtitle: "Store Manager (Terdampak)",
      icon: <Store className="w-4 h-4 text-amber-500" />,
    },
    store_manager_normal: {
      title: "SM Toko Bandung",
      subtitle: "Store Manager (Aman)",
      icon: <Store className="w-4 h-4 text-emerald-500" />,
    },
    sparta_maintenance: {
      title: "Sparta Maintenance",
      subtitle: "Tim Fasilitas & Perbaikan",
      icon: <Wrench className="w-4 h-4 text-blue-500" />,
    },
  };

  interface NavItem {
    id: string;
    href: string;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    badge?: string;
  }

  interface NavGroup {
    title: string;
    items: NavItem[];
  }

  const navGroups: NavGroup[] = [
    {
      title: "Utama",
      items: [
        { id: "dashboard", href: "/", label: "Dashboard", icon: LayoutDashboard },
      ],
    },
    {
      title: "Monitoring",
      items: [
        { id: "map", href: "/monitoring", label: "Peta Monitoring", icon: MapPin },
        { id: "incidents", href: "/alerts", label: "Event Bencana", icon: Bell },
      ],
    },
    {
      title: "Pelaporan",
      items: [
        { id: "history", href: "/reports", label: "Laporan Kejadian", icon: ClipboardList, badge: activeIncidentCount > 0 ? activeIncidentCount.toString() : undefined },
        { id: "history-browse", href: "/reports/history", label: "Riwayat Laporan", icon: History },
      ],
    },
    {
      title: "Sistem",
      items: [
        { id: "settings", href: "/settings", label: "Pengaturan", icon: Settings },
      ],
    },
  ];

  if (identity?.systemRole === "ADMIN") {
    navGroups.push({
      title: "Administrasi",
      items: [
        { id: "user-management", href: "/admin/users", label: "Manajemen User & Role", icon: ShieldAlert },
      ],
    });
  }

  const isNavActive = (href: string, currentPath: string) => {
    if (href === "/reports") return currentPath === "/reports";
    return currentPath === href || currentPath.startsWith(`${href}/`);
  };

  return (
    <div
      className={`flex h-screen w-full antialiased overflow-hidden font-sans transition-colors duration-200 ${
        isDark ? "bg-slate-950 text-slate-100" : "bg-slate-100 text-slate-800"
      }`}
    >
      {/* DESKTOP SIDEBAR */}
      <aside 
        className={`hidden lg:flex flex-col shrink-0 border-r-0 z-30 transition-all duration-300 ${
          isSidebarCollapsed ? "w-20" : "w-[260px]"
        } bg-[#123B6D] text-white shadow-lg`}
      >
        {/* Brand Header */}
        <div className={`flex flex-col justify-center py-4 shrink-0 border-b border-white/10 ${isSidebarCollapsed ? "items-center px-2" : "px-5"}`}>
          {!isSidebarCollapsed ? (
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5 min-w-0">
                  <Image src="/brand/building_logo.png" alt="Logo SPARTA SIAGA" width={40} height={40} className="h-10 w-10 shrink-0 object-contain" />
                  <div className="min-w-0">
                    <span className="block text-[15px] font-bold tracking-tight text-white leading-tight">SPARTA SIAGA</span>
                    <span className="mt-0.5 block text-[10px] leading-tight text-blue-100/75 truncate">
                      Mitigasi Bencana &amp; Fasilitas
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setIsSidebarCollapsed(true)}
                  className="p-1.5 rounded-lg text-blue-200 hover:text-white hover:bg-white/10 transition-colors shrink-0"
                  title="Kecilkan sidebar"
                  aria-label="Kecilkan sidebar"
                >
                  <PanelLeftClose className="w-4 h-4" />
                </button>
              </div>
              <div className="flex items-center justify-between border-t border-white/10 pt-2.5">
                <Image src="/brand/alfamart_logo.png" alt="Alfamart" width={80} height={26} className="h-6 w-auto object-contain" />
                <span className="text-[9px] font-semibold uppercase tracking-wider text-blue-100/60 bg-white/5 px-1.5 py-0.5 rounded">Internal</span>
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-3">
              <Image src="/brand/building_logo.png" alt="SPARTA" width={32} height={32} className="h-8 w-8 object-contain" />
              <button
                type="button"
                onClick={() => setIsSidebarCollapsed(false)}
                className="p-1.5 rounded-lg text-blue-200 hover:text-white hover:bg-white/10 transition-colors"
                title="Perluas sidebar"
                aria-label="Perluas sidebar"
              >
                <PanelLeftOpen className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>

        {/* Navigation Items */}
        <nav className={`flex-1 py-6 space-y-6 overflow-y-auto overflow-x-hidden ${isSidebarCollapsed ? "px-2" : "px-4"}`}>
          {navGroups.map((group, gIdx) => (
            <div key={gIdx} className="space-y-1.5">
              {!isSidebarCollapsed && (
                <div className="text-[10px] uppercase font-bold tracking-wider text-[#EAF2FB]/50 mb-2 px-2">
                  {group.title}
                </div>
              )}
              {group.items.map((item) => {
                const Icon = item.icon;
                const isActive = isNavActive(item.href, pathname);
                return (
                  <Link
                    key={item.id}
                    href={item.href}
                    title={isSidebarCollapsed ? item.label : undefined}
                    className={`w-full relative flex items-center ${isSidebarCollapsed ? "justify-center px-0 py-3 rounded-xl" : "justify-between px-4 py-2.5 rounded-lg"} text-sm font-medium transition-all ${
                      isActive
                        ? "bg-[#1D5AA6] text-white shadow-sm border border-white/10"
                        : "text-blue-100 hover:bg-white/10 hover:text-white border border-transparent"
                    }`}
                  >
                    <div className={`flex items-center ${isSidebarCollapsed ? "justify-center" : "gap-3"}`}>
                      <Icon className={`w-4 h-4 shrink-0 ${isActive ? "text-[#F6C800]" : "text-blue-200"}`} />
                      {!isSidebarCollapsed && <span className="whitespace-nowrap font-medium">{item.label}</span>}
                    </div>
                    {!isSidebarCollapsed && item.badge && (
                      <span
                        className="text-[10px] px-2 py-0.5 rounded-full font-bold bg-[#D9272E] text-white"
                      >
                        {item.badge}
                      </span>
                    )}
                    {isSidebarCollapsed && item.badge && (
                      <span className="absolute top-2 right-2 w-2 h-2 rounded-full bg-[#D9272E]" />
                    )}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        {/* Desktop Sidebar Bottom: User Profile Card (Task 3) */}
        <div ref={profileMenuRef} className="p-3 mt-auto border-t border-white/10 relative">
          <button
            type="button"
            onClick={() => setIsRoleDropdownOpen(!isRoleDropdownOpen)}
            className={`w-full flex items-center gap-2.5 p-2 rounded-xl transition-all text-left ${
              isRoleDropdownOpen
                ? "bg-white/20 text-white"
                : "hover:bg-white/10 text-white"
            } ${isSidebarCollapsed ? "justify-center px-0" : "justify-between"}`}
            title={isSidebarCollapsed ? (identity?.name || "Profil Pengguna") : undefined}
            aria-expanded={isRoleDropdownOpen}
            aria-label="Menu profil pengguna"
          >
            <div className="flex items-center gap-2.5 min-w-0">
              {identity?.avatarUrl ? (
                <img
                  src={identity.avatarUrl}
                  alt={identity.name}
                  className="w-9 h-9 rounded-full object-cover border-2 border-white/20 shrink-0"
                />
              ) : (
                <div className="w-9 h-9 rounded-full bg-[#1D5AA6] text-white flex items-center justify-center font-bold text-xs shrink-0 border-2 border-white/20 shadow-xs">
                  {identity?.name ? identity.name.charAt(0).toUpperCase() : "U"}
                </div>
              )}
              {!isSidebarCollapsed && (
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-bold truncate text-white leading-tight">
                    {identity ? identity.name : "Memuat..."}
                  </div>
                  <div className="text-[10px] text-blue-200/80 truncate leading-tight mt-0.5">
                    {getRoleSubtitle(identity)}
                  </div>
                </div>
              )}
            </div>
            {!isSidebarCollapsed && (
              <ChevronUp className={`w-4 h-4 text-blue-200/70 shrink-0 transition-transform duration-200 ${isRoleDropdownOpen ? "rotate-180" : ""}`} />
            )}
          </button>

          {/* Upward Profile Menu Popover */}
          {isRoleDropdownOpen && (
            <div
              className={`absolute z-50 rounded-2xl shadow-2xl border overflow-hidden animate-in fade-in slide-in-from-bottom-2 ${
                isSidebarCollapsed
                  ? "bottom-2 left-20 ml-2 w-72"
                  : "bottom-full left-2 right-2 mb-2"
              } ${
                isDark
                  ? "bg-slate-900 border-slate-800 text-slate-200"
                  : "bg-white border-slate-200 text-slate-800"
              }`}
            >
              <div className={`p-4 flex items-center gap-3 border-b ${isDark ? "border-slate-800 bg-slate-800/50" : "border-slate-100 bg-slate-50"}`}>
                {identity?.avatarUrl ? (
                  <img src={identity.avatarUrl} alt="Avatar" className="w-12 h-12 rounded-full object-cover border-2 border-white dark:border-slate-700 shadow-sm shrink-0" />
                ) : (
                  <div className="w-12 h-12 rounded-full bg-[#1D5AA6] text-white flex items-center justify-center font-bold text-lg shrink-0 shadow-sm border-2 border-white dark:border-slate-700">
                    {identity?.name ? identity.name.charAt(0).toUpperCase() : "U"}
                  </div>
                )}
                <div className="overflow-hidden min-w-0">
                  <div className="font-bold text-sm text-[#1D5AA6] dark:text-blue-400 truncate">{identity ? identity.name : "Memuat..."}</div>
                  <div className="text-xs font-mono text-slate-500 dark:text-slate-400 truncate mt-0.5">{identity?.nik || "-"}</div>
                  <div className="text-[10px] font-medium text-slate-400 dark:text-slate-500 mt-1 truncate">
                    {getRoleSubtitle(identity)}
                  </div>
                </div>
              </div>

              <div className="p-2 space-y-1">
                <Link
                  href="/settings"
                  onClick={() => setIsRoleDropdownOpen(false)}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left text-sm font-medium transition-colors ${
                    isDark ? "hover:bg-slate-800 text-slate-300" : "hover:bg-slate-100 text-slate-700"
                  }`}
                >
                  <UserCog className="w-4 h-4 text-slate-400" />
                  <span>Pengaturan Akun</span>
                </Link>

                {process.env.NEXT_PUBLIC_ENABLE_ROLE_SIMULATION === "true" && (
                  <div className="mt-2 mb-1">
                    <div className={`px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider border-t ${isDark ? "text-slate-500 border-slate-800" : "text-slate-400 border-slate-100"}`}>
                      Simulasi Dev Role
                    </div>
                    {(Object.keys(roleLabels) as RoleType[]).map((roleKey) => {
                      const isSelected = activeRole === roleKey;
                      return (
                        <button
                          key={roleKey}
                          type="button"
                          onClick={() => {
                            onRoleChange(roleKey);
                            setIsRoleDropdownOpen(false);
                          }}
                          className={`w-full flex items-center gap-3 px-3 py-2 rounded-xl text-left text-xs transition-colors ${
                            isSelected
                              ? isDark
                                ? "bg-blue-900/30 text-blue-400 font-semibold"
                                : "bg-blue-50 text-blue-700 font-semibold"
                              : isDark
                              ? "hover:bg-slate-800 text-slate-400"
                              : "hover:bg-slate-50 text-slate-600"
                          }`}
                        >
                          <div className={`p-1.5 rounded-md shrink-0 ${isDark ? "bg-slate-800" : "bg-slate-100"}`}>
                            {roleLabels[roleKey].icon}
                          </div>
                          <div>
                            <div className="font-medium">{roleLabels[roleKey].title}</div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className={`p-2 border-t ${isDark ? "border-slate-800 bg-slate-900" : "border-slate-100 bg-white"}`}>
                <button
                  type="button"
                  onClick={async () => {
                    await fetch('/api/auth/logout', { method: 'POST' });
                    window.location.href = '/login';
                  }}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left text-sm font-bold transition-colors text-red-600 dark:text-red-400 ${
                    isDark ? "hover:bg-red-950/50" : "hover:bg-red-50"
                  }`}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><polyline points="16 17 21 12 16 7"></polyline><line x1="21" y1="12" x2="9" y2="12"></line></svg>
                  <span>Logout</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </aside>

      {/* MAIN CONTENT AREA */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Persistent TESTING MODE Indicator Banner */}
        {activeTestingMode && (
          <div className="bg-amber-500 text-slate-950 px-3.5 py-1.5 text-xs font-bold flex items-center justify-between border-b border-amber-600 shadow-md shrink-0 z-50">
            <div className="flex items-center gap-2 min-w-0">
              <span className="flex h-2 w-2 relative shrink-0">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-900 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-slate-950"></span>
              </span>
              <span className="truncate">
                ⚠️ MODE PENGUJIAN AKTIF — Transaksi UAT dialihkan ke database terisolasi. Notifikasi email &amp; push eksternal diblokir.
              </span>
            </div>
            <span className="bg-slate-950/20 text-slate-950 px-2 py-0.5 rounded text-[10px] font-mono font-black uppercase tracking-wider shrink-0 ml-2">
              UAT ISOLATED
            </span>
          </div>
        )}

        {/* TOP BAR / HEADER (Hidden on Peta Monitoring, Task 1 & Task 4) */}
        {!isMonitoringPage && (
          <header
            className={`h-16 flex items-center justify-between px-3 sm:px-4 lg:px-6 shrink-0 z-40 border-b transition-colors duration-200 ${
              isDark ? "bg-slate-900 border-slate-800 text-white" : "bg-white border-slate-200 text-slate-900"
            }`}
          >
            {/* Left: Mobile hamburger & title, Desktop Breadcrumbs */}
            <div className="flex items-center gap-3 flex-1 min-w-0">              {/* Mobile Header Title */}
              <div className="lg:hidden flex items-center gap-2.5 min-w-0">
                <Image src="/brand/building_logo.png" alt="SPARTA" width={28} height={28} className="shrink-0 object-contain" />
                <div className="min-w-0">
                  <h1 className="text-xs sm:text-sm font-bold text-slate-900 dark:text-white truncate leading-tight">
                    {getPageTitle(pathname)}
                  </h1>
                  <span className="text-[10px] text-slate-500 dark:text-slate-400 truncate block leading-tight">
                    SPARTA SIAGA
                  </span>
                </div>
              </div>

              {/* Desktop Breadcrumbs (SPARTA Enterprise Style) */}
              <div className="hidden xl:flex items-center gap-2 text-xs shrink-0">
                <span className="font-bold text-[#123B6D] dark:text-blue-400">SPARTA SIAGA</span>
                <span className="text-slate-300 dark:text-slate-600">/</span>
                <span className="text-slate-800 dark:text-slate-200 font-semibold">{pageTitle}</span>
              </div>

              {/* Universal Search Bar */}
              <div
                onClick={onSearchClick}
                className={`hidden md:flex items-center gap-2.5 px-3.5 py-2 border rounded-lg cursor-pointer transition-colors text-sm max-w-xs w-full ${
                  isDark
                    ? "bg-slate-800/80 hover:bg-slate-800 border-slate-700 text-slate-300"
                    : "bg-slate-100/80 hover:bg-slate-100 border-slate-200 text-slate-500"
                }`}
              >
                <Search className="w-4 h-4 text-slate-400 shrink-0" />
                <span className="truncate text-xs">
                  {pathname.startsWith("/reports") ? "Cari laporan dan lokasi..." : "Cari laporan, toko, atau lokasi..."}
                </span>
                <kbd
                  className={`hidden md:inline-block ml-auto text-[10px] border px-1.5 py-0.5 rounded font-mono ${
                    isDark ? "bg-slate-900 border-slate-700 text-slate-400" : "bg-white border-slate-200 text-slate-400"
                  }`}
                >
                  Ctrl K
                </kbd>
              </div>
            </div>

            {/* Right: PWA Install, Buat Laporan, Notifications */}
            <div className="flex items-center gap-1 sm:gap-2 shrink-0">
              <div className="hidden 2xl:block"><PwaInstallPrompt variant="compact" /></div>

              {identity?.systemRole !== "ADMIN" && !isHoViewer && (
                <button
                  type="button"
                  onClick={() => {
                    if (onOpenReportModal) {
                      onOpenReportModal();
                    } else {
                      const event = new CustomEvent('open-manual-report');
                      window.dispatchEvent(event);
                    }
                  }}
                  className="hidden lg:flex items-center gap-2 px-3.5 py-2 bg-[#1D5AA6] hover:bg-[#123B6D] text-white text-xs font-semibold rounded-lg shadow-sm transition-colors min-h-[38px]"
                >
                  <ClipboardList className="w-4 h-4" />
                  <span>Buat Laporan</span>
                </button>
              )}

              {/* Accessible mobile universal search */}
              <button
                type="button"
                onClick={onSearchClick}
                aria-label="Cari toko, DC atau laporan"
                className="flex h-10 w-10 items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800 md:hidden"
              >
                <Search className="h-5 w-5"/>
              </button>

              {/* Notification Bell */}
              <button
                type="button"
                onClick={onOpenNotifications}
                className={`relative p-2 rounded-lg transition-colors ${
                  isDark ? "text-slate-300 hover:bg-slate-800" : "text-slate-600 hover:bg-slate-100"
                }`}
                aria-label="Notifikasi"
              >
                <Bell className="w-5 h-5" />
              </button>
            </div>
          </header>
        )}

        {/* MAIN BODY VIEW */}
        <main
          className={`relative flex-1 transition-colors duration-200 flex flex-col min-w-0 min-h-0 ${
            isMonitoringPage
              ? "p-0 m-0 w-full h-full overflow-hidden pb-16 lg:pb-0"
              : `overflow-y-auto pb-[calc(4.5rem+env(safe-area-inset-bottom,0px))] lg:pb-6 lg:px-5 ${
                  isDark ? "bg-slate-900" : "bg-[#f5f7fa]"
                }`
          }`}
        >
          {isMonitoringPage ? (
            children
          ) : (
            <div className="max-w-[1600px] mx-auto w-full flex-1 flex flex-col">
              {children}
            </div>
          )}
        </main>

        {/* MOBILE BOTTOM NAVIGATION BAR (Always visible on mobile across all pages) */}
        <nav
          className={`lg:hidden fixed bottom-0 left-0 right-0 h-16 safe-area-bottom border-t flex items-center justify-around z-40 px-1 shadow-lg transition-colors duration-200 ${
            isDark ? "bg-slate-900/95 border-slate-800 backdrop-blur-md" : "bg-white/95 border-slate-200 backdrop-blur-md"
          }`}
        >
          <Link
            href="/"
            className={`flex flex-col items-center justify-center gap-1 py-1 px-2.5 rounded-xl text-[10px] font-semibold transition-colors min-h-[44px] min-w-[52px] ${
              pathname === "/"
                ? "text-[#1D5AA6] dark:text-blue-400 font-bold"
                : isDark
                ? "text-slate-400 hover:text-white"
                : "text-slate-500 hover:text-slate-900"
            }`}
          >
            <LayoutDashboard className="w-5 h-5" />
            <span>Beranda</span>
          </Link>

          <Link
            href="/reports"
            className={`flex flex-col items-center justify-center gap-1 py-1 px-2.5 rounded-xl text-[10px] font-semibold transition-colors min-h-[44px] min-w-[52px] ${
              pathname === "/reports"
                ? "text-[#1D5AA6] dark:text-blue-400 font-bold"
                : isDark
                ? "text-slate-400 hover:text-white"
                : "text-slate-500 hover:text-slate-900"
            }`}
          >
            <ClipboardList className="w-5 h-5" />
            <span>Laporan</span>
          </Link>

          <Link
            href="/monitoring"
            className={`flex flex-col items-center justify-center gap-1 py-1 px-2.5 rounded-xl text-[10px] font-semibold transition-colors relative min-h-[44px] min-w-[52px] ${
              pathname.startsWith("/monitoring")
                ? "text-[#1D5AA6] dark:text-blue-400 font-bold"
                : isDark
                ? "text-slate-400 hover:text-white"
                : "text-slate-500 hover:text-slate-900"
            }`}
          >
            <MapPin className="w-5 h-5" />
            <span>Peta</span>
            {(activeIncidentCount ?? 0) > 0 && (
              <span className="absolute top-1 right-2.5 w-2 h-2 rounded-full bg-red-500" />
            )}
          </Link>

          <Link
            href="/alerts"
            className={`flex flex-col items-center justify-center gap-1 py-1 px-2.5 rounded-xl text-[10px] font-semibold transition-colors min-h-[44px] min-w-[52px] ${
              pathname.startsWith("/alerts")
                ? "text-[#1D5AA6] dark:text-blue-400 font-bold"
                : isDark
                ? "text-slate-400 hover:text-white"
                : "text-slate-500 hover:text-slate-900"
            }`}
          >
            <Bell className="w-5 h-5" />
            <span>Event</span>
          </Link>

          <button
            type="button"
            onClick={() => setIsMoreSheetOpen(true)}
            className={`flex flex-col items-center justify-center gap-1 py-1 px-2.5 rounded-xl text-[10px] font-semibold transition-colors min-h-[44px] min-w-[52px] ${
              isMoreSheetOpen || pathname.startsWith("/alerts") || pathname.startsWith("/reports/history") || pathname.startsWith("/settings") || pathname.startsWith("/admin")
                ? "text-[#1D5AA6] dark:text-blue-400 font-bold"
                : isDark
                ? "text-slate-400 hover:text-white"
                : "text-slate-500 hover:text-slate-900"
            }`}
            aria-expanded={isMoreSheetOpen}
            aria-label="Buka Menu Lainnya"
          >
            <MoreHorizontal className="w-5 h-5" />
            <span>Lainnya</span>
          </button>
        </nav>
      </div>

      {/* MOBILE "LAINNYA" ACCESSIBLE BOTTOM SHEET (antislop-layoutmobile & antislop-human) */}
      {isMoreSheetOpen && (
        <div
          className="lg:hidden fixed inset-0 z-[3000] flex flex-col justify-end"
          role="dialog"
          aria-modal="true"
          aria-label="Menu Navigasi Lainnya"
        >
          {/* Backdrop */}
          <div
            className="fixed inset-0 bg-slate-950/70 backdrop-blur-xs transition-opacity"
            onClick={() => setIsMoreSheetOpen(false)}
          />

          {/* Bottom Sheet Card */}
          <div className="relative w-full rounded-t-2xl shadow-2xl p-4 sm:p-5 border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-900 dark:text-white max-h-[85vh] overflow-y-auto animate-in slide-in-from-bottom duration-200">
            {/* Sheet Handle */}
            <div className="w-12 h-1.5 bg-slate-300 dark:bg-slate-700 rounded-full mx-auto mb-3" />

            {/* Sheet Header */}
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <div className="flex items-center gap-2.5">
                <Image src="/brand/building_logo.png" alt="SPARTA Logo" width={28} height={28} className="shrink-0" />
                <div>
                  <h3 className="font-bold text-sm text-slate-900 dark:text-white leading-tight">
                    Menu & Akses Sistem
                  </h3>
                  <span className="text-[10px] text-slate-500 dark:text-slate-400 leading-tight block">
                    SPARTA SIAGA • Ekosistem Terpadu
                  </span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsMoreSheetOpen(false)}
                className="p-2 rounded-xl text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center"
                aria-label="Tutup Menu"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Current User Info Card */}
            {identity && (
              <div className="mt-3 p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-700/60 flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-[#1D5AA6] text-white flex items-center justify-center font-bold text-sm shrink-0">
                  {identity.name ? identity.name.charAt(0).toUpperCase() : "U"}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="font-bold text-xs text-slate-900 dark:text-white truncate">
                    {identity.name}
                  </div>
                  <div className="text-[10px] text-slate-500 dark:text-slate-400 truncate">
                    {getRoleSubtitle(identity)}
                  </div>
                </div>
              </div>
            )}

            {/* Navigation Grid / List */}
            <div className="mt-4 space-y-4">
              <div>
                <span className="text-[10px] uppercase font-bold tracking-wider text-slate-400 dark:text-slate-500 px-1 mb-2 block">
                  Alur Laporan & Penanganan
                </span>
                <div className="grid grid-cols-2 gap-2">
                  <Link
                    href="/alerts"
                    onClick={() => setIsMoreSheetOpen(false)}
                    className="flex items-center gap-2.5 p-3 rounded-xl border border-slate-200/90 dark:border-slate-800 hover:border-blue-500 hover:bg-blue-50/50 dark:hover:bg-blue-900/20 transition-all text-xs font-semibold col-span-2"
                  >
                    <Bell className="w-4 h-4 text-amber-500 shrink-0" />
                    <div className="min-w-0">
                      <div>Event Bencana & Deteksi</div>
                      <div className="text-[10px] text-slate-400 font-normal">Notifikasi gempa BMKG & cuaca ekstrem</div>
                    </div>
                  </Link>

                  <Link
                    href="/reports/history"
                    onClick={() => setIsMoreSheetOpen(false)}
                    className="flex items-center gap-2.5 p-3 rounded-xl border border-slate-200/90 dark:border-slate-800 hover:border-blue-500 hover:bg-blue-50/50 dark:hover:bg-blue-900/20 transition-all text-xs font-semibold"
                  >
                    <History className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0" />
                    <span>Riwayat Laporan</span>
                  </Link>
                </div>
              </div>

              <div>
                <span className="text-[10px] uppercase font-bold tracking-wider text-slate-400 dark:text-slate-500 px-1 mb-2 block">
                  Pengaturan & Akun
                </span>
                <div className="space-y-1.5">
                  <Link
                    href="/settings"
                    onClick={() => setIsMoreSheetOpen(false)}
                    className="w-full flex items-center justify-between p-3 rounded-xl border border-slate-200/90 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800 transition-all text-xs font-semibold min-h-[44px]"
                  >
                    <div className="flex items-center gap-2.5">
                      <Settings className="w-4 h-4 text-slate-500 shrink-0" />
                      <span>Pengaturan Sistem</span>
                    </div>
                  </Link>

                  {identity?.systemRole === "ADMIN" && (
                    <div className="space-y-1.5">
                      <Link
                        href="/admin/users"
                        onClick={() => setIsMoreSheetOpen(false)}
                        className="w-full flex items-center justify-between p-3 rounded-xl border border-slate-200/90 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800 transition-all text-xs font-semibold min-h-[44px]"
                      >
                        <div className="flex items-center gap-2.5">
                          <ShieldAlert className="w-4 h-4 text-amber-500 shrink-0" />
                          <span>Manajemen User & Hak Akses</span>
                        </div>
                      </Link>
                    </div>
                  )}
                </div>
              </div>

              {/* Install PWA Prompt */}
              <div className="pt-2 border-t border-slate-100 dark:border-slate-800">
                <PwaInstallPrompt variant="compact" className="w-full justify-center" />
              </div>

              {/* Logout Action */}
              <div className="pt-2">
                <button
                  type="button"
                  onClick={async () => {
                    await fetch('/api/auth/logout', { method: 'POST' });
                    window.location.href = '/login';
                  }}
                  className="w-full flex items-center justify-center gap-2 p-3 rounded-xl border border-red-200 dark:border-red-900/50 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 text-xs font-bold transition-colors min-h-[44px]"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><polyline points="16 17 21 12 16 7"></polyline><line x1="21" y1="12" x2="9" y2="12"></line></svg>
                  Keluar dari Sesi (Logout)
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

