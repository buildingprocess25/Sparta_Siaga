"use client";

import React, { useState, useEffect } from "react";
import {
  X,
  Settings,
  Bell,
  Volume2,
  VolumeX,
  Palette,
  Map,
  Shield,
  Check,
  Building,
  Monitor,
  CloudRain,
  Sun,
  Moon,
  Sparkles,
  FlaskConical,
  Mail,
  Send,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Loader2,
  RefreshCw,
} from "lucide-react";
import { toast } from "sonner";

export interface SystemSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  // 1. Notification & Branch
  permissionState: NotificationPermission;
  onRequestPermission: () => Promise<void>;
  monitoredBranch: string;
  onSelectMonitoredBranch: (branch: string) => void;
  branchList: string[];
  // 2. Audio & Alarm
  soundEnabled: boolean;
  onToggleSound: (enabled: boolean) => void;
  onTestSound: () => void;
  // 3. Theme & Appearance
  theme: "dark" | "light";
  onSelectTheme: (theme: "dark" | "light") => void;
  basemap: "esri-dark" | "esri-light" | "osm";
  onSelectBasemap: (basemap: "esri-dark" | "esri-light" | "osm") => void;
  showRadar: boolean;
  onToggleRadar: (show: boolean) => void;
  // 4. Testing Mode & Email
  currentUser?: any;
  testingMode?: boolean;
  onTestingModeChange?: (enabled: boolean) => void;
}

export function SystemSettingsModal({
  isOpen,
  onClose,
  permissionState,
  onRequestPermission,
  monitoredBranch,
  onSelectMonitoredBranch,
  branchList,
  soundEnabled,
  onToggleSound,
  onTestSound,
  theme,
  onSelectTheme,
  basemap,
  onSelectBasemap,
  showRadar,
  onToggleRadar,
  currentUser,
  testingMode = false,
  onTestingModeChange,
}: SystemSettingsModalProps) {
  const [activeTab, setActiveTab] = useState<"general" | "audio" | "appearance" | "testing" | "email">("general");

  // Testing mode state
  const [testingModeActive, setTestingModeActive] = useState(testingMode);
  const [testingReason, setTestingReason] = useState("");
  const [isUpdatingTestingMode, setIsUpdatingTestingMode] = useState(false);
  const [testingAuditLogs, setTestingAuditLogs] = useState<any[]>([]);

  // Email status state
  const [emailConfig, setEmailConfig] = useState<any>(null);
  const [recentEmailLogs, setRecentEmailLogs] = useState<any[]>([]);
  const [testEmailRecipient, setTestEmailRecipient] = useState("novalalfian90@gmail.com");
  const [isSendingTestEmail, setIsSendingTestEmail] = useState(false);
  const [testEmailResult, setTestEmailResult] = useState<any>(null);
  const [isLoadingEmailData, setIsLoadingEmailData] = useState(false);

  const isAdmin = currentUser?.systemRole === "ADMIN";

  // Sync testingMode prop
  useEffect(() => {
    setTestingModeActive(testingMode);
  }, [testingMode]);

  // Fetch testing mode status & logs
  const fetchTestingModeData = async () => {
    try {
      const res = await fetch("/api/admin/testing-mode");
      if (res.ok) {
        const data = await res.json();
        if (data.state) {
          setTestingModeActive(Boolean(data.state.enabled));
        }
        if (data.auditLogs) {
          setTestingAuditLogs(data.auditLogs);
        }
      }
    } catch (e) {
      console.warn("Failed to fetch testing mode data:", e);
    }
  };

  // Fetch email status data
  const fetchEmailData = async () => {
    if (!isAdmin) return;
    setIsLoadingEmailData(true);
    try {
      const res = await fetch("/api/admin/email");
      if (res.ok) {
        const data = await res.json();
        setEmailConfig(data.configuration);
        const combined = [
          ...(data.recentDeliveries?.notifications || []).map((n: any) => ({
            ...n,
            source: "incident",
          })),
          ...(data.recentDeliveries?.distributions || []).map((d: any) => ({
            ...d,
            source: "distribution",
          })),
        ];
        combined.sort((a, b) => new Date(b.sent_at || b.attempted_at).getTime() - new Date(a.sent_at || a.attempted_at).getTime());
        setRecentEmailLogs(combined.slice(0, 20));
      }
    } catch (e) {
      console.warn("Failed to fetch email status:", e);
    } finally {
      setIsLoadingEmailData(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchTestingModeData();
      if (isAdmin) {
        fetchEmailData();
      }
    }
  }, [isOpen, isAdmin]);

  const handleToggleTestingMode = async () => {
    if (!isAdmin || isUpdatingTestingMode) return;
    const targetState = !testingModeActive;
    setIsUpdatingTestingMode(true);
    try {
      const res = await fetch("/api/admin/testing-mode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enabled: targetState,
          reason: testingReason.trim() || undefined,
        }),
      });

      const data = await res.json();
      if (res.ok && data.success) {
        setTestingModeActive(targetState);
        onTestingModeChange?.(targetState);
        toast.success(
          targetState
            ? "Mode Pengujian DIAKTIFKAN. Seluruh aksi operasional dialihkan ke database UAT terisolasi."
            : "Mode Pengujian DINONAKTIFKAN. Operasi normal produksi dipulihkan."
        );
        fetchTestingModeData();
      } else {
        toast.error(data.error || "Gagal mengubah status Mode Pengujian.");
      }
    } catch (err: any) {
      toast.error(err.message || "Gagal menghubungi server.");
    } finally {
      setIsUpdatingTestingMode(false);
    }
  };

  const handleSendTestEmail = async () => {
    if (!isAdmin || isSendingTestEmail) return;
    setIsSendingTestEmail(true);
    setTestEmailResult(null);

    try {
      const res = await fetch("/api/admin/email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetEmail: testEmailRecipient }),
      });

      const data = await res.json();
      if (res.ok && data.success) {
        setTestEmailResult({
          success: true,
          message: data.message,
          providerMessageId: data.result?.providerMessageId,
        });
        toast.success("Email uji coba berhasil dikonfirmasi oleh provider SMTP!");
        fetchEmailData();
      } else {
        setTestEmailResult({
          success: false,
          message: data.error || data.message || "Pengiriman gagal.",
        });
        toast.error(data.error || "Gagal mengirim email uji coba.");
      }
    } catch (err: any) {
      setTestEmailResult({
        success: false,
        message: err.message || "Gagal menghubungi server.",
      });
      toast.error(err.message || "Kesalahan jaringan.");
    } finally {
      setIsSendingTestEmail(false);
    }
  };

  if (!isOpen) return null;

  const isDark = theme === "dark";

  return (
    <div
      className="fixed inset-0 z-[2100] flex items-center justify-center p-2.5 sm:p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        className={`w-full max-w-2xl max-h-[92vh] sm:max-h-[88vh] rounded-2xl border shadow-2xl overflow-hidden flex flex-col animate-in zoom-in-95 duration-200 ${
          isDark
            ? "bg-slate-900 border-slate-700/90 text-white"
            : "bg-white border-slate-200 text-slate-900"
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className={`p-3.5 sm:p-4 border-b flex items-center justify-between gap-2.5 sm:gap-3 ${
            isDark ? "bg-slate-950/80 border-slate-800" : "bg-slate-50 border-slate-200"
          }`}
        >
          <div className="flex items-center gap-2 sm:gap-2.5 min-w-0">
            <div className="p-1.5 sm:p-2 rounded-xl bg-gradient-to-br from-red-600 to-rose-600 text-white shadow-md shadow-red-600/20 shrink-0">
              <Settings className="w-4 h-4 sm:w-5 sm:h-5" />
            </div>
            <div className="min-w-0">
              <h2 className="text-xs sm:text-sm font-bold tracking-tight truncate">Pengaturan Command Center</h2>
              <p className={`text-[10px] sm:text-[11px] truncate ${isDark ? "text-slate-400" : "text-slate-500"}`}>
                Preferensi sistem, mode pengujian UAT terisolasi, dan status email darurat
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className={`p-1.5 rounded-lg transition-colors ${
              isDark ? "hover:bg-slate-800 text-slate-400" : "hover:bg-slate-100 text-slate-500"
            }`}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tab Navigation */}
        <div
          className={`flex border-b text-xs font-semibold px-2 sm:px-4 gap-1 sm:gap-2 overflow-x-auto ${
            isDark ? "bg-slate-950/40 border-slate-800" : "bg-slate-50/60 border-slate-200"
          }`}
        >
          <button
            onClick={() => setActiveTab("general")}
            className={`py-3 px-3 border-b-2 transition-all flex items-center gap-1.5 shrink-0 ${
              activeTab === "general"
                ? "border-red-500 text-red-500 font-bold"
                : isDark
                ? "border-transparent text-slate-400 hover:text-slate-200"
                : "border-transparent text-slate-600 hover:text-slate-900"
            }`}
          >
            <Bell className="w-3.5 h-3.5" />
            <span>Notifikasi & Cabang</span>
          </button>

          <button
            onClick={() => setActiveTab("audio")}
            className={`py-3 px-3 border-b-2 transition-all flex items-center gap-1.5 shrink-0 ${
              activeTab === "audio"
                ? "border-red-500 text-red-500 font-bold"
                : isDark
                ? "border-transparent text-slate-400 hover:text-slate-200"
                : "border-transparent text-slate-600 hover:text-slate-900"
            }`}
          >
            <Volume2 className="w-3.5 h-3.5" />
            <span>Alarm & Suara</span>
          </button>

          <button
            onClick={() => setActiveTab("appearance")}
            className={`py-3 px-3 border-b-2 transition-all flex items-center gap-1.5 shrink-0 ${
              activeTab === "appearance"
                ? "border-red-500 text-red-500 font-bold"
                : isDark
                ? "border-transparent text-slate-400 hover:text-slate-200"
                : "border-transparent text-slate-600 hover:text-slate-900"
            }`}
          >
            <Palette className="w-3.5 h-3.5" />
            <span>Tema & Peta</span>
          </button>

          {isAdmin && (
            <>
              <button
                onClick={() => setActiveTab("testing")}
                className={`py-3 px-3 border-b-2 transition-all flex items-center gap-1.5 shrink-0 ${
                  activeTab === "testing"
                    ? "border-amber-500 text-amber-500 font-bold"
                    : isDark
                    ? "border-transparent text-slate-400 hover:text-slate-200"
                    : "border-transparent text-slate-600 hover:text-slate-900"
                }`}
              >
                <FlaskConical className="w-3.5 h-3.5 text-amber-500" />
                <span>Mode Pengujian</span>
                {testingModeActive && (
                  <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
                )}
              </button>

              <button
                onClick={() => setActiveTab("email")}
                className={`py-3 px-3 border-b-2 transition-all flex items-center gap-1.5 shrink-0 ${
                  activeTab === "email"
                    ? "border-blue-500 text-blue-500 font-bold"
                    : isDark
                    ? "border-transparent text-slate-400 hover:text-slate-200"
                    : "border-transparent text-slate-600 hover:text-slate-900"
                }`}
              >
                <Mail className="w-3.5 h-3.5 text-blue-500" />
                <span>Status & Uji Email</span>
              </button>
            </>
          )}
        </div>

        {/* Content Body */}
        <div className="p-5 overflow-y-auto max-h-[60vh] space-y-5 text-xs">
          {/* TAB 1: General (Notifikasi & Cabang) */}
          {activeTab === "general" && (
            <div className="space-y-4">
              <div
                className={`p-4 rounded-xl border flex items-start justify-between gap-3 ${
                  isDark ? "bg-slate-950/60 border-slate-800" : "bg-slate-50 border-slate-200"
                }`}
              >
                <div className="flex items-start gap-3">
                  <div className="p-2 rounded-lg bg-cyan-600/20 text-cyan-400 border border-cyan-500/30 shrink-0">
                    <Monitor className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-bold text-sm">Notifikasi Pop-up Desktop</span>
                      {permissionState === "granted" && (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                          Aktif
                        </span>
                      )}
                    </div>
                    <p className={`text-[11px] leading-relaxed ${isDark ? "text-slate-400" : "text-slate-600"}`}>
                      Pop-up OS instan saat gempa terdeteksi di cabang yang dipantau.
                    </p>
                  </div>
                </div>

                {permissionState !== "granted" ? (
                  <button
                    onClick={onRequestPermission}
                    className="px-3.5 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white font-bold text-xs shrink-0 shadow-md shadow-cyan-600/20"
                  >
                    Izinkan
                  </button>
                ) : (
                  <div className="p-1.5 rounded-full bg-emerald-500/20 text-emerald-400 shrink-0">
                    <Check className="w-4 h-4" />
                  </div>
                )}
              </div>

              {/* Monitored Branch Selector */}
              <div
                className={`p-4 rounded-xl border space-y-3 ${
                  isDark ? "bg-slate-950/60 border-slate-800" : "bg-slate-50 border-slate-200"
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <div className="p-2 rounded-lg bg-red-600/20 text-red-400 border border-red-500/30 shrink-0">
                    <Building className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="font-bold text-xs">Fokus Cabang Siaga</div>
                    <p className={`text-[11px] ${isDark ? "text-slate-400" : "text-slate-600"}`}>
                      Alarm dan notifikasi akan diprioritaskan untuk cabang ini
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1">
                  <button
                    onClick={() => onSelectMonitoredBranch("all")}
                    className={`p-2.5 rounded-xl border text-center font-medium transition-all ${
                      monitoredBranch === "all"
                        ? isDark ? "border-red-500 bg-red-500/10 text-red-400 font-bold" : "border-red-500 bg-red-50 text-red-600 font-bold"
                        : isDark
                        ? "bg-slate-900 border-slate-800 text-slate-400 hover:border-slate-700 hover:text-white"
                        : "bg-white border-slate-200 text-slate-600 hover:border-slate-300 hover:text-slate-900"
                    }`}
                  >
                    Semua Cabang
                  </button>
                  {branchList.map((branch) => (
                    <button
                      key={branch}
                      onClick={() => onSelectMonitoredBranch(branch)}
                      className={`p-2.5 rounded-xl border text-center font-medium truncate transition-all ${
                        monitoredBranch === branch
                          ? isDark ? "border-red-500 bg-red-500/10 text-red-400 font-bold" : "border-red-500 bg-red-50 text-red-600 font-bold"
                          : isDark
                          ? "bg-slate-900 border-slate-800 text-slate-400 hover:border-slate-700 hover:text-white"
                          : "bg-white border-slate-200 text-slate-600 hover:border-slate-300 hover:text-slate-900"
                      }`}
                    >
                      {branch}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: Audio & Alarm */}
          {activeTab === "audio" && (
            <div className="space-y-4">
              <div
                className={`p-4 rounded-xl border flex items-center justify-between gap-3 ${
                  isDark ? "bg-slate-950/60 border-slate-800" : "bg-slate-50 border-slate-200"
                }`}
              >
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-red-600/20 text-red-400 border border-red-500/30">
                    {soundEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
                  </div>
                  <div>
                    <div className="font-semibold text-xs">Alarm Sirine Siaga Gempa</div>
                    <div className="text-[11px] text-slate-400">Bunyi darurat otomatis saat terdeteksi gempa M ≥ 5.0</div>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={onTestSound}
                    className={`px-2.5 py-1.5 rounded-lg border text-xs font-semibold ${
                      isDark ? "bg-slate-900 border-slate-700 text-slate-300 hover:bg-slate-800" : "bg-white border-slate-300 text-slate-700 hover:bg-slate-50"
                    }`}
                  >
                    Uji Suara
                  </button>
                  <button
                    onClick={() => onToggleSound(!soundEnabled)}
                    className={`px-3 py-1.5 rounded-lg font-bold text-xs ${
                      soundEnabled ? "bg-red-600 text-white" : "bg-slate-800 text-slate-400"
                    }`}
                  >
                    {soundEnabled ? "Aktif" : "Mati"}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: Theme & Appearance */}
          {activeTab === "appearance" && (
            <div className="space-y-4">
              <div
                className={`p-4 rounded-xl border space-y-3 ${
                  isDark ? "bg-slate-950/60 border-slate-800" : "bg-slate-50 border-slate-200"
                }`}
              >
                <div className="font-bold text-xs">Tema Antarmuka</div>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => onSelectTheme("dark")}
                    className={`p-3 rounded-xl border text-center font-medium flex items-center justify-center gap-2 ${
                      theme === "dark"
                        ? "border-red-500 bg-red-500/10 text-red-400 font-bold"
                        : "bg-slate-900 border-slate-800 text-slate-400"
                    }`}
                  >
                    <Moon className="w-4 h-4" />
                    <span>Mode Gelap</span>
                  </button>
                  <button
                    onClick={() => onSelectTheme("light")}
                    className={`p-3 rounded-xl border text-center font-medium flex items-center justify-center gap-2 ${
                      theme === "light"
                        ? "border-red-500 bg-red-50 text-red-600 font-bold"
                        : "bg-white border-slate-200 text-slate-600"
                    }`}
                  >
                    <Sun className="w-4 h-4" />
                    <span>Mode Terang</span>
                  </button>
                </div>
              </div>

              {/* Basemap Selection */}
              <div
                className={`p-4 rounded-xl border space-y-3 ${
                  isDark ? "bg-slate-950/60 border-slate-800" : "bg-slate-50 border-slate-200"
                }`}
              >
                <div className="font-bold text-xs">Pilihan Peta Dasar (Basemap)</div>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    onClick={() => onSelectBasemap("esri-dark")}
                    className={`p-2.5 rounded-xl border text-center font-medium ${
                      basemap === "esri-dark" ? "border-red-500 bg-red-500/10 text-red-400 font-bold" : "bg-slate-900 border-slate-800 text-slate-400"
                    }`}
                  >
                    <Map className="w-4 h-4 mx-auto mb-1" />
                    <span>Esri Dark</span>
                  </button>
                  <button
                    onClick={() => onSelectBasemap("esri-light")}
                    className={`p-2.5 rounded-xl border text-center font-medium ${
                      basemap === "esri-light" ? "border-red-500 bg-red-500/10 text-red-400 font-bold" : "bg-slate-900 border-slate-800 text-slate-400"
                    }`}
                  >
                    <Map className="w-4 h-4 mx-auto mb-1" />
                    <span>Esri Light</span>
                  </button>
                  <button
                    onClick={() => onSelectBasemap("osm")}
                    className={`p-2.5 rounded-xl border text-center font-medium ${
                      basemap === "osm" ? "border-red-500 bg-red-500/10 text-red-400 font-bold" : "bg-slate-900 border-slate-800 text-slate-400"
                    }`}
                  >
                    <Map className="w-4 h-4 mx-auto mb-1" />
                    <span>OSM</span>
                  </button>
                </div>
              </div>

              {/* Radar Doppler Toggle */}
              <div
                className={`p-4 rounded-xl border flex items-center justify-between gap-3 ${
                  isDark ? "bg-slate-950/60 border-slate-800" : "bg-slate-50 border-slate-200"
                }`}
              >
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-blue-600/20 text-cyan-400 border border-blue-500/30">
                    <CloudRain className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="font-semibold text-xs">Live Doppler Weather Radar</div>
                    <div className="text-[11px] text-slate-400">Layer satelit cuaca BMKG & RainViewer</div>
                  </div>
                </div>

                <button
                  onClick={() => onToggleRadar(!showRadar)}
                  className={`px-3 py-1.5 rounded-lg font-bold text-xs ${
                    showRadar ? "bg-blue-600 text-white" : "bg-slate-800 text-slate-400"
                  }`}
                >
                  {showRadar ? "Aktif" : "Nonaktif"}
                </button>
              </div>
            </div>
          )}

          {/* TAB 4: Testing Mode (Admin Only) */}
          {activeTab === "testing" && isAdmin && (
            <div className="space-y-4">
              {/* Toggle Box */}
              <div
                className={`p-4 rounded-xl border transition-all ${
                  testingModeActive
                    ? "bg-amber-500/10 border-amber-500/40 text-amber-200"
                    : isDark
                    ? "bg-slate-950/60 border-slate-800 text-slate-300"
                    : "bg-slate-50 border-slate-200 text-slate-700"
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3">
                    <div
                      className={`p-2 rounded-lg shrink-0 ${
                        testingModeActive
                          ? "bg-amber-500/20 text-amber-400 border border-amber-500/40"
                          : "bg-slate-800 text-slate-400 border border-slate-700"
                      }`}
                    >
                      <FlaskConical className="w-5 h-5" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-bold text-sm">Mode Pengujian Operasional (UAT)</span>
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                            testingModeActive
                              ? "bg-amber-500 text-slate-950 font-black animate-pulse"
                              : "bg-slate-700 text-slate-300"
                          }`}
                        >
                          {testingModeActive ? "AKTIF (UAT TERISOLASI)" : "NONAKTIF (PRODUKSI)"}
                        </span>
                      </div>
                      <p className="text-[11px] leading-relaxed text-slate-400">
                        {testingModeActive
                          ? "Transaksi operasional (pemeriksaan BMS/BES, approval BMC/BnM, progres) diarahkan ke database UAT terisolasi. Email & push eksternal diblokir untuk mencegah kepanikan."
                          : "Sistem beroperasi normal menggunakan database produksi Biznet PostgreSQL siaga."}
                      </p>
                    </div>
                  </div>

                  <button
                    onClick={handleToggleTestingMode}
                    disabled={isUpdatingTestingMode}
                    className={`px-4 py-2 rounded-xl font-bold text-xs shrink-0 transition-all shadow-md flex items-center gap-1.5 ${
                      testingModeActive
                        ? "bg-red-600 hover:bg-red-500 text-white shadow-red-600/30"
                        : "bg-amber-500 hover:bg-amber-400 text-slate-950 shadow-amber-500/30 font-black"
                    }`}
                  >
                    {isUpdatingTestingMode && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                    <span>{testingModeActive ? "Matikan Testing Mode" : "Aktifkan Testing Mode"}</span>
                  </button>
                </div>

                <div className="mt-3 pt-3 border-t border-slate-800/60">
                  <label className="block text-[11px] font-medium text-slate-400 mb-1">
                    Catatan Alasan Perubahan (Audit Log):
                  </label>
                  <input
                    type="text"
                    value={testingReason}
                    onChange={(e) => setTestingReason(e.target.value)}
                    placeholder="Contoh: Pengujian alur operasional BMS-BMC Bandung"
                    className={`w-full px-3 py-1.5 rounded-lg text-xs border outline-none ${
                      isDark
                        ? "bg-slate-900 border-slate-800 text-slate-200 focus:border-amber-500"
                        : "bg-white border-slate-300 text-slate-800 focus:border-amber-500"
                    }`}
                  />
                </div>
              </div>

              {/* Production Safety Note */}
              <div className="p-3 rounded-lg bg-blue-950/40 border border-blue-800/40 text-blue-200 text-[11px] flex items-start gap-2.5">
                <Shield className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />
                <div>
                  <span className="font-bold">Keamanan Data Produksi:</span> Autonomous 24/7 Earthquake Worker
                  berjalan independen memonitor BMKG/USGS dan selalu terhubung ke database produksi. Gempa bumi nyata
                  tidak pernah dimanipulasi atau dihentikan oleh status Mode Pengujian ini.
                </div>
              </div>

              {/* Audit Logs Table */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-xs flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5 text-slate-400" />
                    Riwayat Perubahan Status (Audit Logs)
                  </span>
                  <button
                    onClick={fetchTestingModeData}
                    className="text-[11px] text-blue-400 hover:text-blue-300 flex items-center gap-1"
                  >
                    <RefreshCw className="w-3 h-3" />
                    Segarkan
                  </button>
                </div>

                <div className="rounded-xl border border-slate-800 overflow-hidden bg-slate-950/60">
                  {testingAuditLogs.length === 0 ? (
                    <div className="p-4 text-center text-slate-500 text-[11px]">
                      Belum ada riwayat perubahan status testing mode.
                    </div>
                  ) : (
                    <div className="max-h-40 overflow-y-auto divide-y divide-slate-800 text-[11px]">
                      {testingAuditLogs.map((log) => (
                        <div key={log.id} className="p-2.5 flex items-center justify-between gap-2">
                          <div>
                            <div className="font-medium text-slate-200">
                              {log.details?.current ? (
                                <span className="text-amber-400 font-bold">AKTIFKAN UAT</span>
                              ) : (
                                <span className="text-emerald-400 font-bold">NONAKTIFKAN (PRODUKSI)</span>
                              )}
                              <span className="text-slate-500 ml-2">oleh {log.actor_name || log.actor_user_id}</span>
                            </div>
                            {log.details?.reason && (
                              <div className="text-slate-400 text-[10px] mt-0.5 italic">
                                &ldquo;{log.details.reason}&rdquo;
                              </div>
                            )}
                          </div>
                          <div className="text-slate-500 text-[10px] shrink-0 font-mono">
                            {new Date(log.created_at).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* TAB 5: Email Status & Test (Admin Only) */}
          {activeTab === "email" && isAdmin && (
            <div className="space-y-4">
              {/* Configuration Status Card */}
              <div
                className={`p-4 rounded-xl border space-y-3 ${
                  isDark ? "bg-slate-950/60 border-slate-800" : "bg-slate-50 border-slate-200"
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 font-bold text-xs">
                    <Mail className="w-4 h-4 text-blue-400" />
                    <span>Konfigurasi Penyedia SMTP</span>
                  </div>
                  <span
                    className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                      emailConfig?.configured
                        ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                        : "bg-red-500/10 text-red-400 border border-red-500/20"
                    }`}
                  >
                    {emailConfig?.configured ? "TERHUBUNG / AKTIF" : "BELUM DIKONFIGURASI"}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-2 text-[11px] font-mono text-slate-400">
                  <div>
                    <span className="text-slate-500 block">Host:</span>
                    <span className="text-slate-200">{emailConfig?.smtpHost || "(kosong / not_configured)"}</span>
                  </div>
                  <div>
                    <span className="text-slate-500 block">Port / Secure:</span>
                    <span className="text-slate-200">
                      {emailConfig?.smtpPort || 587} {emailConfig?.smtpSecure ? "(SSL)" : "(TLS)"}
                    </span>
                  </div>
                  <div className="col-span-2">
                    <span className="text-slate-500 block">Pengirim Resmi (From):</span>
                    <span className="text-slate-200">{emailConfig?.smtpFrom}</span>
                  </div>
                  <div className="col-span-2">
                    <span className="text-slate-500 block">Whitelist Penerima Uji Coba:</span>
                    <span className="text-blue-300">
                      {emailConfig?.approvedTestRecipients?.join(", ") || "novalalfian90@gmail.com"}
                    </span>
                  </div>
                </div>
              </div>

              {/* Test Email Dispatch Form */}
              <div
                className={`p-4 rounded-xl border space-y-3 ${
                  isDark ? "bg-slate-950/60 border-slate-800" : "bg-slate-50 border-slate-200"
                }`}
              >
                <div className="font-bold text-xs flex items-center gap-1.5">
                  <Send className="w-3.5 h-3.5 text-blue-400" />
                  <span>Kirim Email Uji Coba (Approved Inbox Only)</span>
                </div>

                <div className="flex gap-2">
                  <input
                    type="email"
                    value={testEmailRecipient}
                    onChange={(e) => setTestEmailRecipient(e.target.value)}
                    placeholder="Penerima whitelist (novalalfian90@gmail.com)"
                    className={`flex-1 px-3 py-2 rounded-lg text-xs border outline-none font-mono ${
                      isDark
                        ? "bg-slate-900 border-slate-800 text-slate-200 focus:border-blue-500"
                        : "bg-white border-slate-300 text-slate-800 focus:border-blue-500"
                    }`}
                  />
                  <button
                    onClick={handleSendTestEmail}
                    disabled={isSendingTestEmail}
                    className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs flex items-center gap-1.5 shadow-md shadow-blue-600/20 shrink-0"
                  >
                    {isSendingTestEmail ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Send className="w-3.5 h-3.5" />
                    )}
                    <span>Kirim Uji Coba</span>
                  </button>
                </div>

                {testEmailResult && (
                  <div
                    className={`p-2.5 rounded-lg border text-[11px] ${
                      testEmailResult.success
                        ? "bg-emerald-950/40 border-emerald-800/40 text-emerald-300"
                        : "bg-red-950/40 border-red-800/40 text-red-300"
                    }`}
                  >
                    <div className="font-bold mb-0.5">
                      {testEmailResult.success ? "✓ Terkirim" : "✗ Gagal"}
                    </div>
                    <div>{testEmailResult.message}</div>
                    {testEmailResult.providerMessageId && (
                      <div className="font-mono text-[10px] text-emerald-400/80 mt-1">
                        Message ID: {testEmailResult.providerMessageId}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Delivery History Table */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-xs">Riwayat Pengiriman Otomatis</span>
                  <button
                    onClick={fetchEmailData}
                    className="text-[11px] text-blue-400 hover:text-blue-300 flex items-center gap-1"
                  >
                    <RefreshCw className="w-3 h-3" />
                    Segarkan
                  </button>
                </div>

                <div className="rounded-xl border border-slate-800 overflow-hidden bg-slate-950/60 max-h-48 overflow-y-auto">
                  {recentEmailLogs.length === 0 ? (
                    <div className="p-4 text-center text-slate-500 text-[11px]">
                      Belum ada catatan pengiriman email.
                    </div>
                  ) : (
                    <table className="w-full text-[11px] text-left">
                      <thead className="bg-slate-900/80 text-slate-400 text-[10px] uppercase font-mono border-b border-slate-800">
                        <tr>
                          <th className="p-2">Insiden / Laporan</th>
                          <th className="p-2">Cabang / Target</th>
                          <th className="p-2">Status Provider</th>
                          <th className="p-2">Waktu</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800 font-mono">
                        {recentEmailLogs.map((log, idx) => (
                          <tr key={log.id || idx} className="hover:bg-slate-900/40">
                            <td className="p-2 font-bold text-slate-300 truncate max-w-[120px]">
                              {log.ticket_number || log.report_id || log.disaster_id}
                            </td>
                            <td className="p-2 text-slate-400 truncate max-w-[140px]">
                              {log.recipient_contact || log.recipient || log.branch}
                            </td>
                            <td className="p-2">
                              {log.delivery_status === "sent" || log.status === "sent" ? (
                                <span className="px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400 font-bold text-[10px]">
                                  SENT
                                </span>
                              ) : log.delivery_status === "suppressed_testing_mode" || log.status === "suppressed_testing_mode" ? (
                                <span className="px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400 font-bold text-[10px]">
                                  SUPPRESSED (UAT)
                                </span>
                              ) : log.delivery_status === "failed" || log.status === "failed" ? (
                                <span className="px-1.5 py-0.5 rounded bg-red-500/20 text-red-400 font-bold text-[10px]">
                                  FAILED
                                </span>
                              ) : (
                                <span className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 text-[10px]">
                                  NOT CONFIGURED
                                </span>
                              )}
                            </td>
                            <td className="p-2 text-slate-500 text-[10px]">
                              {new Date(log.sent_at || log.attempted_at).toLocaleTimeString("id-ID", {
                                timeZone: "Asia/Jakarta",
                              })}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          className={`p-3.5 border-t flex items-center justify-end text-xs ${
            isDark ? "bg-slate-950 border-slate-800" : "bg-slate-50 border-slate-200"
          }`}
        >
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg bg-red-600 hover:bg-red-500 text-white font-bold text-xs transition-colors shadow-md shadow-red-600/20"
          >
            Selesai
          </button>
        </div>
      </div>
    </div>
  );
}
