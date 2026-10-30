"use client";

import React, { useState, useEffect, useMemo, useCallback, useRef, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";
import { toast } from "sonner";
import { Info, X } from "lucide-react";
import { Store, StoreStatus } from "@/types/store";
import { Earthquake, DisasterFeedResponse } from "@/types/disaster";
import { RoleType, IncidentRecord, DamageReport, isActiveStatus, isHistoryStatus } from "@/types/incident";
import {
  calculateIncidentStats,
} from "@/lib/incident-store";

import { assessStoreRisk } from "@/lib/haversine";
import { deriveStoreStatuses } from "@/lib/store-status";
import { IncidentAppShell } from "@/components/layout/incident-app-shell";
import { SiagaProvider } from "@/components/layout/siaga-context";
import { StoreVerificationModal } from "@/components/incident/store-verification-modal";
import { ManualIncidentModal } from "@/components/incident/manual-incident-modal";
import { MaintenanceTrackingModal } from "@/components/incident/maintenance-tracking-modal";
import { StoreDetailSheet } from "@/components/store/store-detail-sheet";
import { AffectedStoresSheet } from "@/components/disaster/affected-stores-sheet";
import { SpotlightSearch } from "@/components/search/spotlight-search";
import { NotificationCenterSheet } from "@/components/notifications/notification-center-sheet";
import { NotificationPermissionDialog } from "@/components/notifications/notification-permission-dialog";
import { IncidentDetailModal } from "@/components/notifications/incident-detail-modal";
import { SystemSettingsModal } from "@/components/settings/system-settings-modal";
import {
  triggerDesktopPopup,
  setupAudioAutoplayUnlocker,
  getNotificationPermission,
  getUserMonitoredBranch,
  hasUserDismissedPermissionPrompt,
  requestDesktopNotificationPermission,
} from "@/lib/desktop-notification";

export default function SiagaLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [rawStores, setRawStores] = useState<Store[]>([]);
  const [disasterData, setDisasterData] = useState<DisasterFeedResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Core App Shell & Role State
  const [activeRole, setActiveRole] = useState<RoleType>("ho_admin");
  const [activeLayer, setActiveLayer] = useState<"all" | "earthquake" | "stores" | "weather" | "flood">("all");

  // Persistent Incidents State
  const [incidents, setIncidents] = useState<IncidentRecord[]>([]);
  const [selectedIncidentForAction, setSelectedIncidentForAction] = useState<IncidentRecord | null>(null);
  const [selectedReadOnlyIncident, setSelectedReadOnlyIncident] = useState<IncidentRecord | null>(null);
  const [isVerificationModalOpen, setIsVerificationModalOpen] = useState(false);
  const [isManualModalOpen, setIsManualModalOpen] = useState(false);
  const [isMaintenanceModalOpen, setIsMaintenanceModalOpen] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);

  // Map and filter states
  const [incidentOnly, setIncidentOnly] = useState<boolean>(true);
  const [statusFilter, setStatusFilter] = useState<"all" | StoreStatus>("all");
  const [basemap, setBasemap] = useState<"esri-dark" | "esri-light" | "osm">("esri-dark");
  const [theme, setTheme] = useState<"dark" | "light">("light");
  const [showRadar, setShowRadar] = useState<boolean>(true);
  const [radarData, setRadarData] = useState<{ tileUrl: string; timeFormatted: string } | null>(null);

  // Requirement 3: Map Time Filter (24 Jam vs 3 Hari)
  const [mapTimeFilter, setMapTimeFilter] = useState<"24h" | "3d">("3d");

  // Requirement 7: True Event Focus Mode
  const [selectedEarthquake, setSelectedEarthquake] = useState<Earthquake | null>(null);

  // Interaction & Dialog states
  const [selectedStore, setSelectedStore] = useState<Store | null>(null);
  const [isAffectedSheetOpen, setIsAffectedSheetOpen] = useState<boolean>(false);
  const [isSearchOpen, setIsSearchOpen] = useState<boolean>(false);
  const [isNotificationCenterOpen, setIsNotificationCenterOpen] = useState<boolean>(false);
  const [selectedNotificationId, setSelectedNotificationId] = useState<string | null>(null);
  const [isPermissionDialogOpen, setIsPermissionDialogOpen] = useState<boolean>(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState<boolean>(false);
  const [soundEnabled, setSoundEnabled] = useState<boolean>(true);
  const [permissionState, setPermissionState] = useState<NotificationPermission>("default");
  const [monitoredBranch, setMonitoredBranch] = useState<string>("all");
  const seenNotificationIdsRef = useRef<Set<string>>(new Set());
  const hasLoadedNotificationFeedRef = useRef(false);
  const [flyToTarget, setFlyToTarget] = useState<{ lat: number; lng: number; zoom?: number } | null>(null);

  // Load incidents from database API on mount
  const [currentUser, setCurrentUser] = useState<any>(null);
  const inFlightCheckRef = useRef<Promise<void> | null>(null);
  const lastVisibilityCheckRef = useRef<number>(0);

  const checkAndRenewSession = useCallback(async () => {
    // Coalesce concurrent calls into a single in-flight promise
    if (inFlightCheckRef.current) {
      return inFlightCheckRef.current;
    }

    const executeCheck = async () => {
      try {
        const res = await fetch("/api/auth/me", { cache: "no-store" });
        if (res.ok) {
          const data = await res.json();
          const user = data.user || data;
          setCurrentUser(user);
          if (user.role || user.businessRole) {
            setActiveRole((user.role || user.businessRole) as RoleType);
          }
          return;
        }

        // If access token expired (401), attempt proactive transparent renewal
        if (res.status === 401) {
          // If offline or network unavailable, do NOT force logout; keep existing view
          if (typeof navigator !== "undefined" && !navigator.onLine) {
            console.warn("[Layout] Network offline; retaining current session state");
            return;
          }

          const refreshRes = await fetch("/api/auth/refresh", { 
            method: "POST",
            headers: { "Content-Type": "application/json" },
            cache: "no-store",
          });

          if (refreshRes.ok) {
            const refreshData = await refreshRes.json();
            if (refreshData.user) {
              setCurrentUser(refreshData.user);
              if (refreshData.user.role || refreshData.user.businessRole) {
                setActiveRole((refreshData.user.role || refreshData.user.businessRole) as RoleType);
              }
              return;
            }
          } else if (refreshRes.status === 401) {
            // Only redirect to login when refresh token is explicitly confirmed invalid/revoked
            router.push("/login");
          }
        }
      } catch (err) {
        // Transient network failures or server errors must never force logout
        console.warn("[Layout] Session verification error (preserved session):", err);
      } finally {
        inFlightCheckRef.current = null;
      }
    };

    inFlightCheckRef.current = executeCheck();
    return inFlightCheckRef.current;
  }, [router]);

  useEffect(() => {
    checkAndRenewSession();

    // Proactive background session renewal every 10 minutes (before 15-minute access token expiry)
    const sessionRenewInterval = setInterval(() => {
      fetch("/api/auth/refresh", { method: "POST" })
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (data?.user) {
            setCurrentUser(data.user);
          }
        })
        .catch(() => {});
    }, 10 * 60 * 1000);

    // Re-verify and renew session transparently when PWA returns to foreground
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        const now = Date.now();
        // Throttle foreground checks to at most once every 5 seconds to eliminate duplicate focus + visibilitychange races
        if (now - lastVisibilityCheckRef.current > 5000) {
          lastVisibilityCheckRef.current = now;
          checkAndRenewSession();
        }
        if (typeof window !== "undefined" && "Notification" in window && Notification.permission === "granted") {
          import("@/lib/pwa-push-client").then(({ registerPushSubscription }) => {
            registerPushSubscription().catch(() => {});
          });
        }
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("focus", handleVisibilityChange);

    fetch("/api/incidents")
      .then((res) => res.json())
      .then((json) => {
        if (json.data) setIncidents(json.data);
      })
      .catch((err) => console.error("[Sparta Siaga] Failed to load incidents from DB:", err));

    return () => {
      clearInterval(sessionRenewInterval);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("focus", handleVisibilityChange);
    };
  }, [checkAndRenewSession]);

  const refreshIncidents = useCallback(async () => {
    const response = await fetch("/api/incidents", { cache: "no-store" });
    if (!response.ok) throw new Error("Gagal memuat ulang laporan.");
    const json = await response.json();
    if (Array.isArray(json.data)) setIncidents(json.data);
  }, []);

  // Sync incidents: POST new, PATCH existing
  const handleUpdateIncidents = useCallback(async (newIncidents: IncidentRecord[]) => {
    setIncidents(newIncidents);
    // Fire-and-forget: persist each changed/new incident to DB
    const currentIds = new Set(incidents.map((i) => i.id));
    for (const inc of newIncidents) {
      try {
        if (!currentIds.has(inc.id)) {
          // New incident → POST
          await fetch("/api/incidents", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(inc),
          });
        } else {
          // Existing → PATCH
          await fetch(`/api/incidents/${inc.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(inc),
          });
        }
      } catch (err) {
        console.error(`[Sparta Siaga] Failed to sync incident ${inc.id}:`, err);
      }
    }
  }, [incidents]);

  // Role-based filtering
  const filteredIncidentsByRole = useMemo(() => {
    const isStoreManager = activeRole.startsWith("store_manager");
    if (!isStoreManager) return incidents;
    return incidents.filter((i) => i.branch === monitoredBranch);
  }, [incidents, activeRole, monitoredBranch]);

  // Stats summary calculation
  const incidentStats = useMemo(() => {
    return calculateIncidentStats(filteredIncidentsByRole);
  }, [filteredIncidentsByRole]);

  // Active vs History partition: CLOSED, RESOLVED, and ARCHIVED automatically go to history
  const activeIncidents = useMemo(() => {
    return filteredIncidentsByRole.filter((i) => isActiveStatus(i.status));
  }, [filteredIncidentsByRole]);

  const archivedIncidents = useMemo(() => {
    return filteredIncidentsByRole.filter((i) => isHistoryStatus(i.status));
  }, [filteredIncidentsByRole]);

  // Initialize theme from localStorage & apply to document.documentElement
  useEffect(() => {
    if (typeof window !== "undefined") {
      const storedTheme = localStorage.getItem("sparta_theme") as "dark" | "light" | null;
      const initialTheme = storedTheme || "light";
      setTheme(initialTheme);
      document.documentElement.classList.toggle("dark", initialTheme === "dark");
    }
  }, []);

  const handleToggleTheme = useCallback(() => {
    setTheme((prev) => {
      const next = prev === "dark" ? "light" : "dark";
      if (typeof window !== "undefined") {
        localStorage.setItem("sparta_theme", next);
        document.documentElement.classList.toggle("dark", next === "dark");
      }
      return next;
    });
  }, []);

  // Initialize sound alert preference from localStorage
  useEffect(() => {
    if (typeof window !== "undefined") {
      const storedSound = localStorage.getItem("sparta_sound_alert");
      if (storedSound !== null) {
        setSoundEnabled(storedSound === "true");
      }
    }
  }, []);

  // Play subtle command-center emergency chime
  const playEmergencyChime = useCallback(() => {
    if (!soundEnabled) return;
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = "sine";
      osc.frequency.setValueAtTime(880, ctx.currentTime); // A5
      osc.frequency.exponentialRampToValueAtTime(587.33, ctx.currentTime + 0.3); // D5

      gain.gain.setValueAtTime(0.12, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.55);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start();
      osc.stop(ctx.currentTime + 0.55);
    } catch {
      // Audio autoplay policy or unsupported
    }
  }, [soundEnabled]);

  // Initial data loading
  const loadInitialData = useCallback(async (isRefresh: boolean = false) => {
    if (isRefresh) setIsRefreshing(true);
    else setLoading(true);

    try {
      const [storesRes, disastersRes, radarRes, floodsRes] = await Promise.all([
        fetch(`/api/stores${isRefresh ? "?refresh=true" : ""}`),
        fetch(`/api/disasters/earthquakes${isRefresh ? "?refresh=true" : ""}`),
        fetch(`/api/weather/radar`),
        fetch(`/api/disasters/floods`),
      ]);

      const storesJson = await storesRes.json();
      const disastersJson = await disastersRes.json();
      if (radarRes.ok) {
        const radarJson = await radarRes.json();
        setRadarData(radarJson);
      }
      
      let floodReports = [];
      if (floodsRes.ok) {
        const floodsJson = await floodsRes.json();
        floodReports = floodsJson.data || [];
      }

      setRawStores(storesJson.data || []);
      setDisasterData({
        ...disastersJson,
        floodReports, // Attach to disasterData
      });
    } catch (err) {
      console.error("[Sparta Siaga Dashboard] Error fetching initial data:", err);
    } finally {
      setLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadInitialData();
  }, [loadInitialData]);

  // Notification permission setup
  useEffect(() => {
    setupAudioAutoplayUnlocker();
    if (typeof window !== "undefined") {
      const perm = getNotificationPermission();
      setPermissionState(perm);
      setMonitoredBranch(getUserMonitoredBranch());

      if (perm === "granted") {
        import("@/lib/pwa-push-client").then(({ registerPushSubscription }) => {
          registerPushSubscription().catch((e) => {
            console.warn("[Layout] Initial push registration sync skipped:", e);
          });
        });
      } else if (perm === "default" && !hasUserDismissedPermissionPrompt()) {
        const timer = setTimeout(() => {
          setIsPermissionDialogOpen(true);
        }, 1200);
        return () => clearTimeout(timer);
      }
    }
  }, []);

  // Keyboard shortcut listener for Ctrl+K
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setIsSearchOpen((prev) => !prev);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const handleFlyToIncident = useCallback((incident: any) => {
    setIsNotificationCenterOpen(false);
    router.push("/monitoring");

    if (incident.disaster_type === "earthquake") {
      setActiveLayer("earthquake");
      const allEqs = [
        ...(disasterData?.activeEarthquakes || []),
        ...(disasterData?.recentEarthquakes || []),
      ];
      const eq = allEqs.find((e) => e.id === incident.disaster_id || (incident.disaster_id && e.id.includes(incident.disaster_id)));
      if (eq) {
        setSelectedEarthquake(eq); // Requirement 23: Activates Event Focus Mode!
        setFlyToTarget({ lat: eq.latitude, lng: eq.longitude, zoom: 11 });
      }
    } else if (incident.disaster_type === "heavy_rain" || incident.disaster_type === "flood") {
      setActiveLayer("weather");
      
      // Check if spatial data exists in floodReports
      const flood = disasterData?.floodReports?.find((f: any) => f.id === incident.disaster_id);
      if (flood) {
        setFlyToTarget({ lat: flood.lat, lng: flood.lng, zoom: 12 });
      } else {
        // Honest message
        toast.custom((t) => (
          <div className="flex items-start gap-2 bg-slate-900 dark:bg-slate-800 text-white px-3 py-3 rounded-lg shadow-md max-w-sm pointer-events-auto">
            <Info className="w-4 h-4 text-blue-400 mt-0.5 shrink-0" />
            <div>
              <p className="text-xs font-semibold">Visual area banjir belum tersedia</p>
              <p className="text-[10px] text-slate-300 mt-0.5">Data sumber hanya memberikan indikasi cuaca, bukan area spasial lapangan.</p>
            </div>
            <button onClick={() => toast.dismiss(t)} className="ml-auto p-1 shrink-0 text-slate-400 hover:text-white transition-colors">
              <X className="w-3 h-3" />
            </button>
          </div>
        ), { duration: 5000 });
        
        // We can still try to fly to the branch's center if we have stores
        if (incident.branch) {
          const branchStores = rawStores.filter(s => s.cabang?.toLowerCase() === incident.branch?.toLowerCase());
          if (branchStores.length > 0) {
            const avgLat = branchStores.reduce((acc, s) => acc + s.latitude, 0) / branchStores.length;
            const avgLng = branchStores.reduce((acc, s) => acc + s.longitude, 0) / branchStores.length;
            setFlyToTarget({ lat: avgLat, lng: avgLng, zoom: 11 });
          }
        }
      }
    }
  }, [router, disasterData, rawStores]);

  // Requirement 2 & 3: Time filtered earthquakes according to mapTimeFilter (24h or 3d <=72h)
  const timeFilteredEarthquakes = useMemo(() => {
    const allActive = disasterData?.activeEarthquakes || [];
    const maxHours = mapTimeFilter === "24h" ? 24 : 72;
    const maxAgeMs = maxHours * 60 * 60 * 1000;
    const now = Date.now();
    return allActive.filter((eq) => now - eq.timestamp <= maxAgeMs);
  }, [disasterData, mapTimeFilter]);

  // Contextual earthquakes for spatial risk calculation across active time window (Requirement 2, 3 & 7)
  const effectiveEarthquakesForRisk = timeFilteredEarthquakes;

  // Index incidents by store ID and affected stores for 2D operational status derivation (Requirement 9 & 10)
  const incidentByStoreCode = useMemo(() => {
    const map = new Map<string, IncidentRecord>();
    for (const inc of incidents) {
      if (inc.storeId) {
        if (!map.has(inc.storeId) || map.get(inc.storeId)?.status === "resolved") {
          map.set(inc.storeId, inc);
        }
      }
      if (Array.isArray(inc.affectedStores)) {
        for (const aff of inc.affectedStores) {
          if (aff.kode_toko) {
            if (!map.has(aff.kode_toko) || map.get(aff.kode_toko)?.status === "resolved") {
              map.set(aff.kode_toko, inc);
            }
          }
        }
      }
    }
    return map;
  }, [incidents]);

  // 2-Dimensional Spatial & Operational calculation engine
  const computedStores = useMemo(() => {
    return rawStores.map((store) => {
      const risk = assessStoreRisk(
        { latitude: store.latitude, longitude: store.longitude },
        effectiveEarthquakesForRisk
      );

      const matchingIncident = incidentByStoreCode.get(store.kode_toko) || incidentByStoreCode.get(store.id);
      const { operationalStatus, visualStatus } = deriveStoreStatuses(risk.spatialRisk, matchingIncident);

      return {
        ...store,
        status: risk.spatialRisk,
        spatialRisk: risk.spatialRisk,
        operationalStatus,
        visualStatus,
        activeReportId: matchingIncident?.id,
        activeReportProgress: matchingIncident?.progress,
        distanceFromDisasterKm: risk.distanceFromEventKm,
        riskSourceEvent: risk.riskSourceEvent,
        nearestDisasterTitle: risk.riskSourceEvent?.title,
        nearestDisasterMag: risk.riskSourceEvent?.magnitude,
        nearestDisasterDepth: risk.riskSourceEvent?.depth,
      };
    });
  }, [rawStores, effectiveEarthquakesForRisk, incidentByStoreCode]);

  // Dynamically feeding BMKG danger stores into operational incidents
  // has been REMOVED from the browser. The server daemon is the single
  // source of truth for creating auto-incidents based on BMKG events.


  // Read-only Background Polling (Browser is a consumer, not a worker)
  useEffect(() => {
    // 1. Notification State & Earthquake Feed (60 seconds)
    const fetchFastFeeds = async () => {
      try {
        const logsRes = await fetch("/api/notifications/logs?limit=100");
        if (logsRes.ok) {
          const logsJson = await logsRes.json();
          const nowMs = Date.now();
          const MAX_ACTIVE_WINDOW_MS = 72 * 60 * 60 * 1000;

          const activeAlerts = (logsJson.logs || []).filter((alert: { sent_at: string }) => {
            const sentTime = new Date(alert.sent_at).getTime();
            return Number.isFinite(sentTime) && sentTime <= nowMs &&
              nowMs - sentTime <= MAX_ACTIVE_WINDOW_MS;
          });
          // One alert per disaster event across branches; each branch entry
          // remains available in the informational notification center.
          const alertKey = (alert: { id: string; disaster_id?: string; disaster_type?: string }) =>
            alert.disaster_id ? `${alert.disaster_type || "disaster"}:${alert.disaster_id}` : alert.id;
          const freshAlerts = activeAlerts.filter(
            (alert: { id: string; disaster_id?: string; disaster_type?: string }) => {
              const key = alertKey(alert);
              if (seenNotificationIdsRef.current.has(key)) return false;
              seenNotificationIdsRef.current.add(key);
              return true;
            }
          );

          // First poll establishes the baseline; subsequent polls notify on new alerts.
          if (hasLoadedNotificationFeedRef.current && freshAlerts.length > 0) {
            playEmergencyChime();
            freshAlerts.forEach((alert: any) => {
              let sourceLabel = "SPARTA Siaga";
              if (alert.disaster_id?.includes("bmkg")) sourceLabel = "BMKG";
              else if (alert.disaster_id?.includes("usgs")) sourceLabel = "USGS";
              else if (alert.disaster_id?.includes("open-meteo") || alert.disaster_type === "heavy_rain") sourceLabel = "Open-Meteo";
              triggerDesktopPopup({
                id: alert.id,
                title: alert.title,
                body: alert.message,
                disasterType: alert.disaster_type,
                ticketNumber: alert.ticket_number,
                branch: alert.branch,
                source: sourceLabel,
                forceBypassBranchFilter: true,
                timestamp: new Date(alert.sent_at).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" }) + " WIB",
                isSimulation: alert.disaster_id?.includes("sim"),
                onClickDetail: () => {
                  setSelectedNotificationId(alert.id);
                  setIsNotificationCenterOpen(true);
                },
                onClickMap: () => handleFlyToIncident(alert),
              });
            });
          }
          hasLoadedNotificationFeedRef.current = true;
        }

        const disastersRes = await fetch("/api/disasters/earthquakes?refresh=true");
        if (disastersRes.ok) {
           const disastersJson = await disastersRes.json();
           setDisasterData(prev => prev ? ({
             ...disastersJson,
             floodReports: prev.floodReports || []
           }) : disastersJson);
        }
      } catch (err) {
        console.warn("[Fast Feeds Polling] Error:", err);
      }
    };

    // 2. Flood & Field Reports (3 minutes = 180s)
    const fetchFloodFeeds = async () => {
      try {
        const floodsRes = await fetch("/api/disasters/floods");
        if (floodsRes.ok) {
           const floodsJson = await floodsRes.json();
           setDisasterData(prev => {
             if (!prev) return prev;
             return { ...prev, floodReports: floodsJson.data || [] };
           });
        }
      } catch (err) {
        console.warn("[Flood Feeds Polling] Error:", err);
      }
    };

    // 3. Radar Metadata (5 minutes = 300s)
    const fetchRadarFeeds = async () => {
      try {
        const radarRes = await fetch("/api/weather/radar");
        if (radarRes.ok) {
          const radarJson = await radarRes.json();
          setRadarData(radarJson);
        }
      } catch (err) {
        console.warn("[Radar Feeds Polling] Error:", err);
      }
    };

    const fastTimer = setTimeout(fetchFastFeeds, 3000);
    const floodTimer = setTimeout(fetchFloodFeeds, 5000);
    const radarTimer = setTimeout(fetchRadarFeeds, 7000);

    const fastInterval = setInterval(fetchFastFeeds, 60000);
    const floodInterval = setInterval(fetchFloodFeeds, 180000);
    const radarInterval = setInterval(fetchRadarFeeds, 300000);

    // 4. Realtime Web Push broadcast from Service Worker
    const handleSwMessage = (event: MessageEvent) => {
      if (event.data?.type === "SPARTA_PUSH_RECEIVED") {
        const payload = event.data.data;
        const alertKey = payload.eventId
          ? `${payload.disasterType || "earthquake"}:${payload.eventId}`
          : (payload.tag || payload.title);

        if (seenNotificationIdsRef.current.has(alertKey)) return;
        seenNotificationIdsRef.current.add(alertKey);

        playEmergencyChime();
        triggerDesktopPopup({
          id: payload.eventId || payload.tag || `push-${Date.now()}`,
          tag: payload.tag,
          title: payload.title,
          body: payload.body,
          disasterType: payload.disasterType || "earthquake",
          ticketNumber: payload.ticketNumber,
          branch: payload.branch,
          source: payload.eventId?.includes("usgs") ? "USGS" : "BMKG",
          forceBypassBranchFilter: true,
          suppressNativeNotification: true, // OS-level notification already handled by Service Worker push event!
          timestamp: new Date().toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" }) + " WIB",
          onClickDetail: () => {
            if (payload.url && payload.url.startsWith("/")) {
              router.push(payload.url);
            } else {
              setIsNotificationCenterOpen(true);
            }
          },
          onClickMap: () => {
            if (payload.url && payload.url.startsWith("/")) {
              router.push(payload.url);
            }
          },
        });
      }
    };

    if (typeof navigator !== "undefined" && "serviceWorker" in navigator) {
      navigator.serviceWorker.addEventListener("message", handleSwMessage);
    }

    return () => {
      clearTimeout(fastTimer);
      clearTimeout(floodTimer);
      clearTimeout(radarTimer);
      clearInterval(fastInterval);
      clearInterval(floodInterval);
      clearInterval(radarInterval);
      if (typeof navigator !== "undefined" && "serviceWorker" in navigator) {
        navigator.serviceWorker.removeEventListener("message", handleSwMessage);
      }
    };
  }, [playEmergencyChime, router]);

  // Risk metrics calculation (Requirement 7: Danger / Monitor counts in focus context)
  const { dangerCount, warningCount, affectedStores } = useMemo(() => {
    let danger = 0;
    let warning = 0;
    const affected: Store[] = [];

    for (const store of computedStores) {
      if (
        store.visualStatus === "TERDAMPAK" ||
        store.visualStatus === "DALAM_PENANGANAN" ||
        store.spatialRisk === "PRIORITY_MONITOR"
      ) {
        danger++;
        affected.push(store);
      } else if (
        store.visualStatus === "PERLU_PERHATIAN" ||
        store.spatialRisk === "MONITOR"
      ) {
        warning++;
        affected.push(store);
      }
    }

    return { dangerCount: danger, warningCount: warning, affectedStores: affected };
  }, [computedStores]);

  const branchList = useMemo(() => {
    const branches = new Set<string>();
    rawStores.forEach((s) => {
      if (s.cabang) branches.add(s.cabang);
    });
    return Array.from(branches).sort();
  }, [rawStores]);

  const handleSelectStore = useCallback((store: Store | null) => {
    setSelectedStore(store);
    if (store) {
      setFlyToTarget({ lat: store.latitude, lng: store.longitude, zoom: 15 });
    }
  }, []);

  const handleFlyToLocation = useCallback(async (loc: {
    kode_toko?: string;
    nama_toko?: string;
    cabang?: string;
    latitude?: number;
    longitude?: number;
    isFacility?: boolean;
  }) => {
    setIsNotificationCenterOpen(false);

    // 1. Try to find store/facility from computedStores or rawStores
    let targetStore = computedStores.find((s) => {
      if (loc.kode_toko && s.id?.toLowerCase() === loc.kode_toko.toLowerCase()) return true;
      if (loc.nama_toko && s.nama_toko?.toLowerCase() === loc.nama_toko.toLowerCase()) return true;
      return false;
    });

    let lat = targetStore?.latitude ?? loc.latitude;
    let lng = targetStore?.longitude ?? loc.longitude;

    // 2. If not found and is DC/Facility or missing coordinates, try querying search API
    if ((!lat || !lng || isNaN(lat) || isNaN(lng) || (lat === 0 && lng === 0)) && (loc.isFacility || loc.nama_toko)) {
      try {
        const queryTerm = loc.nama_toko || (loc.cabang ? `DC ${loc.cabang}` : "");
        if (queryTerm) {
          const res = await fetch(`/api/stores/search?q=${encodeURIComponent(queryTerm)}&type=${loc.isFacility ? "dc" : "all"}`);
          if (res.ok) {
            const data = await res.json();
            const found = (data.stores || data.data || [])[0];
            if (found && found.latitude && found.longitude) {
              lat = found.latitude;
              lng = found.longitude;
            }
          }
        }
      } catch (err) {
        console.warn("[Layout] Failed to query facility coordinates:", err);
      }
    }

    if (!lat || !lng || isNaN(lat) || isNaN(lng) || (lat === 0 && lng === 0)) {
      toast.warning(`Koordinat untuk lokasi ${loc.nama_toko || loc.kode_toko || "terpilih"} tidak tersedia di master data.`);
      return;
    }

    router.push("/monitoring");

    if (targetStore) {
      setSelectedStore(targetStore);
      setFlyToTarget({ lat: targetStore.latitude, lng: targetStore.longitude, zoom: 16 });
    } else {
      setFlyToTarget({ lat, lng, zoom: 16 });
    }
  }, [computedStores, router]);

  const handleFocusDisaster = useCallback((eqOrLat: Earthquake | number, maybeLng?: number) => {
    setIncidentOnly(true);
    if (typeof eqOrLat === "number") {
      setFlyToTarget({ lat: eqOrLat, lng: maybeLng ?? 0, zoom: 10 });
    } else {
      setSelectedEarthquake(eqOrLat); // Requirement 7: Activates Event Focus Mode!
      setFlyToTarget({ lat: eqOrLat.latitude, lng: eqOrLat.longitude, zoom: 10 });
    }
  }, []);

  const clearEventFocus = useCallback(() => {
    setSelectedEarthquake(null);
    setSelectedCategory(null);
  }, []);

  const handleResetView = useCallback(() => {
    setSelectedEarthquake(null);
    setFlyToTarget({ lat: -2.548926, lng: 118.0148634, zoom: 5 });
  }, []);

  // Workflow Handlers
  const handleOpenReportModal = useCallback(() => {
    setIsManualModalOpen(true);
  }, []);

  const handleSelectIncidentForDetail = useCallback((inc: IncidentRecord) => {
    setSelectedReadOnlyIncident(inc);
  }, []);

  // Inspection and BnM approval are persisted by dedicated backend endpoints.
  // Refresh the authoritative report instead of writing an incomplete local
  // verification back through PATCH (which could erase inspection photo URLs).
  const handleConfirmVerification = async (
    incidentId: string,
    _isDamaged: boolean,
    _report?: Partial<DamageReport>
  ) => {
    try {
      const response = await fetch(`/api/incidents/${encodeURIComponent(incidentId)}`, {
        cache: "no-store",
      });
      if (!response.ok) {
        throw new Error(`Gagal memuat laporan terbaru (HTTP ${response.status})`);
      }
      const payload = await response.json();
      const saved = payload.data as IncidentRecord | undefined;
      if (!saved || saved.id !== incidentId) {
        throw new Error("Data laporan terbaru tidak valid");
      }
      setIncidents((prev) => prev.map((inc) => inc.id === incidentId ? saved : inc));
      setSelectedIncidentForAction((prev) => prev?.id === incidentId ? saved : prev);
      setSelectedReadOnlyIncident((prev) => prev?.id === incidentId ? saved : prev);
    } catch (error) {
      console.error("[SPARTA SIAGA] Gagal memuat laporan setelah konfirmasi:", error);
      toast.error("Pemeriksaan tersimpan, tetapi tampilan belum diperbarui. Muat ulang halaman.");
    }
  };

  // Progression updater for Maintenance
  const handleUpdateMaintenanceProgress = (
    incidentId: string,
    newProgress: number,
    notes?: string,
    technician?: string
  ) => {
    const timestamp = new Date().toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" }) + " WIB";

    const updated = incidents.map((inc) => {
      if (inc.id !== incidentId) return inc;

      const isResolved = newProgress >= 100;
      const nextStatus = isResolved ? ("resolved" as const) : ("in_maintenance" as const);

      return {
        ...inc,
        status: nextStatus,
        progress: newProgress,
        maintenanceTicket: {
          ...inc.maintenanceTicket,
          ticketId: inc.maintenanceTicket?.ticketId || `SPM-20260901-0042`,
          assignedTechnician: technician || inc.maintenanceTicket?.assignedTechnician,
          workDescription: notes || inc.maintenanceTicket?.workDescription,
          completedAt: isResolved ? timestamp : undefined,
        },
        timeline: [
          ...inc.timeline,
          {
            stage: isResolved ? "Selesai" : `Progress ${newProgress}%`,
            label: isResolved
              ? "Perbaikan Fisik Tuntas & Diverifikasi"
              : `Pengerjaan Fisik (${newProgress}%)`,
            timestamp,
            actor: technician || "Tim Sparta Maintenance",
            notes,
          },
        ],
        updatedAt: new Date().toISOString(),
        closedAt: isResolved ? new Date().toISOString() : inc.closedAt,
      };
    });

    handleUpdateIncidents(updated);
  };

  const contextValue = useMemo(() => ({
    rawStores, computedStores, disasterData, loading, isRefreshing,
    activeRole, setActiveRole, activeLayer, setActiveLayer,
    incidents, activeIncidents, archivedIncidents, incidentStats,
    handleUpdateIncidents, handleSelectIncidentForDetail, handleOpenReportModal, refreshIncidents,
    incidentOnly, setIncidentOnly, statusFilter, setStatusFilter,
    basemap, setBasemap, theme, handleToggleTheme,
    showRadar, setShowRadar, radarData, selectedStore, setSelectedStore,
    handleSelectStore, flyToTarget, setFlyToTarget, dangerCount, warningCount,
    handleResetView, handleFocusDisaster, selectedCategory, setSelectedCategory,
    setIsAffectedSheetOpen,
    mapTimeFilter, setMapTimeFilter,
    selectedEarthquake, setSelectedEarthquake, clearEventFocus,
  }), [
    rawStores, computedStores, disasterData, loading, isRefreshing,
    activeRole, setActiveRole, activeLayer, setActiveLayer,
    incidents, activeIncidents, archivedIncidents, incidentStats,
    handleUpdateIncidents, handleSelectIncidentForDetail, handleOpenReportModal, refreshIncidents,
    incidentOnly, setIncidentOnly, statusFilter, setStatusFilter,
    basemap, setBasemap, theme, handleToggleTheme,
    showRadar, setShowRadar, radarData, selectedStore, setSelectedStore,
    handleSelectStore, flyToTarget, setFlyToTarget, dangerCount, warningCount,
    handleResetView, handleFocusDisaster, selectedCategory, setSelectedCategory,
    setIsAffectedSheetOpen,
    mapTimeFilter, setMapTimeFilter,
    selectedEarthquake, setSelectedEarthquake, clearEventFocus,
  ]);

  return (
    <SiagaProvider value={contextValue}>
      <IncidentAppShell
        activeRole={activeRole}
        onRoleChange={setActiveRole}
        activeIncidentCount={activeIncidents.length}
        onOpenNotifications={() => setIsNotificationCenterOpen(true)}
        onSearchClick={() => setIsSearchOpen(true)}
        theme={theme}
        onToggleTheme={handleToggleTheme}
        onOpenReportModal={handleOpenReportModal}
      >
        {children}
      </IncidentAppShell>



      {/* DIALOGS, MODALS & SLIDING DRAWERS */}
      {/* Manual Incident Creation Modal */}
      <ManualIncidentModal
        isOpen={isManualModalOpen}
        onClose={() => setIsManualModalOpen(false)}
        activeRole={activeRole}
        currentUser={currentUser}
        rawStores={rawStores}
        activeEarthquakes={disasterData?.activeEarthquakes || []}
        onConfirm={(data) => {
          const timestamp = new Date().toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" }) + " WIB";
          const reporterInfo = data.reporter || {
            userId: currentUser?.id,
            name: currentUser?.name || "Pelapor Lapangan",
            nik: currentUser?.nik || null,
            role: currentUser?.systemRole === "ADMIN" ? "ADMIN" : (currentUser?.businessRole || currentUser?.role || activeRole),
            branch: currentUser?.branch || data.branch,
            storeId: data.storeId,
          };
          const isFacility = data.locationKind === "FACILITY"
            || data.tkpType === "dc"
            || data.tkpType === "DC"
            || (data.storeId && (String(data.storeId).startsWith("FACILITY:") || String(data.storeId).startsWith("FAC-")));
          const newIncident: IncidentRecord = {
            id: `INC-MAN-${Date.now()}`,
            storeId: data.storeId,
            storeName: data.storeName,
            branch: data.branch,
            locationCity: data.locationCity,
            locationKind: isFacility ? "FACILITY" : "STORE",
            locationId: data.locationId || (data.storeId ? String(data.storeId).replace(/^FACILITY:/, "") : undefined),
            locationCodeSnapshot: data.locationCodeSnapshot || data.storeId,
            locationNameSnapshot: data.locationNameSnapshot || data.storeName,
            locationTypeSnapshot: data.locationTypeSnapshot || (isFacility ? (data.facilityType || "DC") : "STORE"),
            disasterType: data.disasterType,
            reportOrigin: "manual",
            reporter: reporterInfo,
            earthquakeEventId: data.earthquakeEventId || undefined,
            earthquakeSource: data.earthquakeSource || (data.earthquakeEventId ? "BMKG" : undefined),
            earthquakeProvenance: data.earthquakeEventId ? `Ditautkan secara manual oleh pelapor ke kejadian ${data.earthquakeEventId}` : undefined,
            tkpType: isFacility ? "dc" : "toko",
            date: new Date().toLocaleDateString("id-ID", { day: 'numeric', month: 'short', year: 'numeric' }),
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            status: "verifying",
            progress: 15,
            verification: {
              confirmedBy: "",
              confirmedAt: "",
              isDamaged: true,
              categories: data.categories,
              severity: data.severity,
              operationalStatus: data.operationalStatus,
              notes: data.notes
            },
            fieldPhotos: data.photos ?? [],
            timeline: [
              {
                stage: "Laporan Dibuat",
                label: "Laporan insiden / kerusakan manual",
                timestamp,
                actor: reporterInfo.name ? `${reporterInfo.name} (${reporterInfo.role || "Pelapor"})` : "Pelapor Lapangan",
                notes: data.notes || undefined,
              }
            ]
          };
          const updated = [newIncident, ...incidents];
          handleUpdateIncidents(updated);
          setIsManualModalOpen(false);
        }}
      />

      {/* Verification Modal */}
      <StoreVerificationModal
        incident={selectedIncidentForAction}
        activeRole={activeRole}
        isOpen={isVerificationModalOpen}
        onClose={() => setIsVerificationModalOpen(false)}
        onConfirmVerification={handleConfirmVerification}
      />

      {/* Maintenance Tracking Modal */}
      <MaintenanceTrackingModal
        incident={selectedIncidentForAction}
        activeRole={activeRole}
        isOpen={isMaintenanceModalOpen}
        onClose={() => setIsMaintenanceModalOpen(false)}
        onUpdateProgress={handleUpdateMaintenanceProgress}
        onConfirmVerification={handleConfirmVerification}
      />

      {/* Read-Only Incident Detail Modal (History) */}
      <MaintenanceTrackingModal
        incident={selectedReadOnlyIncident}
        activeRole={activeRole}
        isOpen={!!selectedReadOnlyIncident}
        onClose={() => setSelectedReadOnlyIncident(null)}
        onUpdateProgress={() => {}}
        isReadOnly={true}
      />

      {/* Store Detail Drawer */}
      <StoreDetailSheet
        store={selectedStore}
        onClose={() => setSelectedStore(null)}
        theme={theme}
      />

      {/* Affected Stores Sheet */}
      <AffectedStoresSheet
        isOpen={isAffectedSheetOpen}
        onClose={() => setIsAffectedSheetOpen(false)}
        earthquake={selectedEarthquake || disasterData?.latestBmkgEarthquake}
        affectedStores={affectedStores}
        theme={theme}
        onSelectStore={(store) => {
          setIsAffectedSheetOpen(false);
          handleSelectStore(store);
        }}
      />

      {/* Spotlight Universal Search */}
      <SpotlightSearch
        isOpen={isSearchOpen}
        onClose={() => setIsSearchOpen(false)}
        stores={computedStores}
        theme={theme}
        onSelectStore={handleSelectStore}
        onSelectBranch={(branchName) => {
          const branchStores = rawStores.filter(
            (s) => s.cabang?.toLowerCase() === branchName.toLowerCase()
          );
          if (branchStores.length > 0) {
            const avgLat = branchStores.reduce((acc, s) => acc + s.latitude, 0) / branchStores.length;
            const avgLng = branchStores.reduce((acc, s) => acc + s.longitude, 0) / branchStores.length;
            setIncidentOnly(false);
            setFlyToTarget({ lat: avgLat, lng: avgLng, zoom: 11 });
          }
        }}
      />

      {/* Notification Center */}
      <NotificationCenterSheet
        isOpen={isNotificationCenterOpen}
        onClose={() => setIsNotificationCenterOpen(false)}
        selectedNotificationId={selectedNotificationId}
        onClearSelectedNotification={() => setSelectedNotificationId(null)}
        onOpenPermissionDialog={() => setIsPermissionDialogOpen(true)}
        theme={theme}
        activeIncidents={incidents}
        onFlyToIncident={handleFlyToIncident}
        onFlyToLocation={handleFlyToLocation}
        onOpenReport={handleSelectIncidentForDetail}
        userRole={activeRole}
        userBranch={monitoredBranch}
      />

      {/* Notification Permission Dialog */}
      <NotificationPermissionDialog
        isOpen={isPermissionDialogOpen}
        onClose={() => setIsPermissionDialogOpen(false)}
        onPermissionGranted={() => {
          setPermissionState(getNotificationPermission());
          setMonitoredBranch(getUserMonitoredBranch());
        }}
      />

      {/* System Settings Modal */}
      <SystemSettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        currentUser={currentUser}
        permissionState={permissionState}
        onRequestPermission={async () => {
          const perm = await requestDesktopNotificationPermission();
          setPermissionState(perm);
        }}
        monitoredBranch={monitoredBranch}
        onSelectMonitoredBranch={(b) => {
          setMonitoredBranch(b);
          if (typeof window !== "undefined") {
            localStorage.setItem("sparta_monitored_branch", b);
          }
        }}
        branchList={branchList}
        soundEnabled={soundEnabled}
        onToggleSound={(en) => {
          setSoundEnabled(en);
          if (typeof window !== "undefined") {
            localStorage.setItem("sparta_sound_alert", String(en));
          }
        }}
        onTestSound={playEmergencyChime}
        theme={theme}
        onSelectTheme={(t) => {
          setTheme(t);
          setBasemap(t === "dark" ? "esri-dark" : "esri-light");
        }}
        basemap={basemap}
        onSelectBasemap={(bm) => setBasemap(bm)}
        showRadar={showRadar}
        onToggleRadar={(sr) => setShowRadar(sr)}
      />
    </SiagaProvider>
  );
}
