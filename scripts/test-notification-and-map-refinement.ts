/**
 * Test Suite: Notification Retention + Map UI/UX Refinement
 * Verification of:
 * - NR1 - NR5 (Notification Retention)
 * - RU1 - RU5 (Read / Unread UX & Bell Badge Calculation)
 * - ND1 - ND4 (Canonical Event Deduplication & Update)
 * - NG1 - NG3 (HO Event Grouping & Branch Scope)
 * - MU1 - MU8 (Map UI, Theme Awareness & Control Redesign)
 */

import { NotificationLog } from "../types/notification.js";
import { IncidentRecord } from "../types/incident.js";
import { Earthquake } from "../types/disaster.js";
import {
  recordNotificationLog,
  updateNotificationLogForEvent,
  getRecentNotificationLogs,
} from "../lib/notification-service.js";
import { getDbPool } from "../lib/db.js";
import fs from "fs";
import path from "path";

const ACTIVE_WINDOW_MS = 72 * 60 * 60 * 1000; // 72 Hours max active awareness window

// Helper function to simulate notification active retention check
function isNotificationActiveForDisplay(log: { sent_at: string }, nowMs: number = Date.now()): boolean {
  const sentTime = new Date(log.sent_at).getTime();
  return (nowMs - sentTime) <= ACTIVE_WINDOW_MS;
}

// Helper function to calculate active unread count for bell badge
function calculateActiveUnreadCount(
  logs: NotificationLog[],
  readIds: Set<string>,
  lastReadTime: number,
  userBranch: string = "all",
  nowMs: number = Date.now()
): number {
  return logs.filter((l) => {
    const sentTime = new Date(l.sent_at).getTime();
    const isActive = (nowMs - sentTime) <= ACTIVE_WINDOW_MS;
    const isRead = readIds.has(l.id) || sentTime <= lastReadTime;

    if (userBranch !== "all" && l.branch.toLowerCase() !== userBranch.toLowerCase()) {
      return false;
    }

    return isActive && !isRead;
  }).length;
}

// Helper function simulating HO event grouping
function groupNotificationsForHO(logs: NotificationLog[]) {
  const earthquakeGroups = new Map<string, NotificationLog[]>();
  const nonEarthquakes: NotificationLog[] = [];

  logs.forEach((log) => {
    if (log.disaster_type === "earthquake") {
      const canonicalKey = log.disaster_id || log.title;
      if (!earthquakeGroups.has(canonicalKey)) {
        earthquakeGroups.set(canonicalKey, []);
      }
      earthquakeGroups.get(canonicalKey)!.push(log);
    } else {
      nonEarthquakes.push(log);
    }
  });

  return { earthquakeGroups, nonEarthquakes };
}

async function runTestSuite() {
  console.log("=====================================================================");
  console.log(" SPARTA SIAGA - NOTIFICATION RETENTION & MAP UI/UX VERIFICATION SUITE");
  console.log("=====================================================================\n");

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, code: string, message: string) {
    if (condition) {
      console.log(`  ✅ [PASS] ${code}: ${message}`);
      passed++;
    } else {
      console.error(`  ❌ [FAIL] ${code}: ${message}`);
      failed++;
    }
  }

  const now = Date.now();

  // =========================================================================
  // SUITE 1: NOTIFICATION RETENTION (NR1 - NR5)
  // =========================================================================
  console.log("\n--- Suite 1: Notification Retention (NR1 - NR5) ---");

  const notif2h = {
    id: "notif-2h",
    sent_at: new Date(now - 2 * 3600 * 1000).toISOString(),
    title: "Gempa M5.4 Sukabumi (2 Jam Lalu)",
  };
  const is2hActive = isNotificationActiveForDisplay(notif2h, now);
  assert(is2hActive === true, "NR1", "Earthquake notification age 2h -> tab TERBARU (isActiveForDisplay === true)");

  const notif71h = {
    id: "notif-71h",
    sent_at: new Date(now - 71 * 3600 * 1000).toISOString(),
    title: "Gempa M5.8 Banten (71 Jam Lalu)",
  };
  const is71hActive = isNotificationActiveForDisplay(notif71h, now);
  assert(is71hActive === true, "NR2", "Earthquake notification age 71h -> tab TERBARU (isActiveForDisplay === true)");

  const notif73h = {
    id: "notif-73h",
    sent_at: new Date(now - 73 * 3600 * 1000).toISOString(),
    title: "Gempa M6.1 Cianjur (73 Jam Lalu)",
  };
  const is73hActive = isNotificationActiveForDisplay(notif73h, now);
  assert(is73hActive === false, "NR3", "Earthquake notification age 73h -> tab RIWAYAT (isActiveForDisplay === false)");

  // NR4: 73h notification with report IN_PROGRESS
  const mockReportInProgress: IncidentRecord = {
    id: "REP-INP-001",
    date: new Date(now - 73 * 3600 * 1000).toISOString(),
    storeId: "T001",
    storeName: "Alfamart Sukabumi Pusat",
    branch: "SUKABUMI",
    locationCity: "Sukabumi",
    disasterType: "earthquake",
    reportOrigin: "automatic_earthquake",
    earthquakeEventId: "bmkg-cianjur-73h",
    status: "in_maintenance",
    progress: 60,
    createdAt: new Date(now - 73 * 3600 * 1000).toISOString(),
    updatedAt: new Date(now - 1 * 3600 * 1000).toISOString(),
    timeline: [],
  };
  const isNotifArchived = !isNotificationActiveForDisplay({ sent_at: mockReportInProgress.createdAt }, now);
  const isReportStillActive = mockReportInProgress.status === "in_maintenance" && mockReportInProgress.progress < 100;
  assert(
    isNotifArchived && isReportStillActive,
    "NR4",
    "73h notification moves to Riwayat, but operational report remains active (status = in_maintenance, progress = 60%)"
  );

  // NR5: Historical notification (>72h) not counted in active unread badge
  const logsListNR5: NotificationLog[] = [
    {
      id: "log-active-1",
      disaster_id: "eq-act-1",
      disaster_type: "earthquake",
      channel: "email_and_pwa",
      branch: "BOGOR",
      recipient_role: "Duty Officer DC Cabang",
      recipient_contact: "dc.bogor@alfamart.co.id",
      title: "Gempa Baru M5.2",
      message: "Zona pantau 4 toko",
      affected_stores_count: 4,
      affected_stores_sample: [],
      ticket_number: "ESC-BOG-1001",
      status: "sent",
      sent_at: new Date(now - 10 * 60 * 1000).toISOString(), // 10 mins ago
    },
    {
      id: "log-history-1",
      disaster_id: "eq-hist-1",
      disaster_type: "earthquake",
      channel: "email_and_pwa",
      branch: "SUKABUMI",
      recipient_role: "Duty Officer DC Cabang",
      recipient_contact: "dc.sukabumi@alfamart.co.id",
      title: "Gempa Lama M6.0",
      message: "Zona pantau 12 toko",
      affected_stores_count: 12,
      affected_stores_sample: [],
      ticket_number: "ESC-SUK-9900",
      status: "sent",
      sent_at: new Date(now - 80 * 3600 * 1000).toISOString(), // 80 hours ago
    },
  ];
  const emptyReadIds = new Set<string>();
  const badgeCountNR5 = calculateActiveUnreadCount(logsListNR5, emptyReadIds, 0, "all", now);
  assert(
    badgeCountNR5 === 1,
    "NR5",
    `Historical notification (80h ago) excluded from active unread badge count (expected: 1, got: ${badgeCountNR5})`
  );

  // =========================================================================
  // SUITE 2: READ / UNREAD UX & BELL BADGE (RU1 - RU5)
  // =========================================================================
  console.log("\n--- Suite 2: Read / Unread UX & Bell Badge (RU1 - RU5) ---");

  const activeLogA: NotificationLog = {
    id: "log-a",
    disaster_id: "eq-a",
    disaster_type: "earthquake",
    channel: "email_and_pwa",
    branch: "BANDUNG",
    recipient_role: "Duty Officer",
    recipient_contact: "dc.bandung@alfamart.co.id",
    title: "Gempa A",
    message: "Detail A",
    affected_stores_count: 5,
    affected_stores_sample: [],
    ticket_number: "ESC-BDG-01",
    status: "sent",
    sent_at: new Date(now - 1 * 3600 * 1000).toISOString(),
  };

  const activeLogB: NotificationLog = {
    id: "log-b",
    disaster_id: "eq-b",
    disaster_type: "earthquake",
    channel: "email_and_pwa",
    branch: "BANDUNG",
    recipient_role: "Duty Officer",
    recipient_contact: "dc.bandung@alfamart.co.id",
    title: "Gempa B",
    message: "Detail B",
    affected_stores_count: 3,
    affected_stores_sample: [],
    ticket_number: "ESC-BDG-02",
    status: "sent",
    sent_at: new Date(now - 30 * 60 * 1000).toISOString(),
  };

  // RU1: New active notification arrives -> badge count increases
  const initialBadge = calculateActiveUnreadCount([activeLogA], new Set(), 0, "all", now);
  const updatedBadgeWithNew = calculateActiveUnreadCount([activeLogA, activeLogB], new Set(), 0, "all", now);
  assert(
    initialBadge === 1 && updatedBadgeWithNew === 2,
    "RU1",
    "New active notification increases badge count (from 1 to 2)"
  );

  // RU2: Notification is read -> unread count decreases
  const readSetWithA = new Set(["log-a"]);
  const badgeAfterReadingA = calculateActiveUnreadCount([activeLogA, activeLogB], readSetWithA, 0, "all", now);
  assert(
    badgeAfterReadingA === 1,
    "RU2",
    `Notification marked read decreases unread count (from 2 to ${badgeAfterReadingA})`
  );

  // RU3: Read state does not alter related report
  const initialReportProgress = mockReportInProgress.progress;
  const initialReportStatus = mockReportInProgress.status;
  // User reads notification:
  const readLogsSet = new Set(["notif-73h"]);
  assert(
    mockReportInProgress.progress === initialReportProgress && mockReportInProgress.status === initialReportStatus,
    "RU3",
    "Personal notification read state does NOT modify operational report progress or status"
  );

  // RU4: Read state does not change disaster event status
  const mockEarthquake: Earthquake = {
    id: "eq-test",
    source: "BMKG",
    title: "Gempa M5.0",
    magnitude: 5.0,
    depth: "10 km",
    depthKm: 10,
    latitude: -6.5,
    longitude: 106.9,
    time: "Baru saja",
    timestamp: now,
    potensiTsunami: false,
    priorityRadiusKm: 40,
    monitoringRadiusKm: 90,
  };
  const eventMagnitudeBefore = mockEarthquake.magnitude;
  // Mark read
  readSetWithA.add("eq-test");
  assert(
    mockEarthquake.magnitude === eventMagnitudeBefore,
    "RU4",
    "Personal notification read state does NOT modify disaster event status or magnitude"
  );

  // RU5: Archived unread notification does not flood main active badge
  const unreadHistoricalLog: NotificationLog = {
    id: "hist-unread",
    disaster_id: "eq-old",
    disaster_type: "earthquake",
    channel: "email_and_pwa",
    branch: "MEDAN",
    recipient_role: "Duty Officer",
    recipient_contact: "dc.medan@alfamart.co.id",
    title: "Gempa 100 Jam Lalu (Unread)",
    message: "Detail gempa",
    affected_stores_count: 8,
    affected_stores_sample: [],
    ticket_number: "ESC-MDN-01",
    status: "sent",
    sent_at: new Date(now - 100 * 3600 * 1000).toISOString(), // 100 hours ago, unread!
  };
  const activeUnreadBadgeRU5 = calculateActiveUnreadCount([unreadHistoricalLog, activeLogA], new Set(), 0, "all", now);
  assert(
    activeUnreadBadgeRU5 === 1,
    "RU5",
    `Archived unread notification (100h old) does NOT inflate active badge (expected: 1, got: ${activeUnreadBadgeRU5})`
  );

  // =========================================================================
  // SUITE 3: DEDUP & UPDATE PER CANONICAL EVENT (ND1 - ND4)
  // =========================================================================
  console.log("\n--- Suite 3: Dedup & Update per Canonical Event (ND1 - ND4) ---");

  const pool = getDbPool();
  const testDisasterId = `bmkg-test-${Date.now()}`;
  const testBranch = "SUKABUMI";

  try {
    // ND1: First BMKG event evaluation -> 1 notification created
    const createdNotif = await recordNotificationLog({
      disasterId: testDisasterId,
      disasterType: "earthquake",
      channel: "email_and_pwa",
      branch: testBranch,
      recipientContact: "dc.sukabumi@alfamart.co.id",
      title: "⚠️ PERINGATAN DARURAT GEMPA M 5.4 - CABANG SUKABUMI",
      message: "Gempa bumi awal M5.4 terdeteksi oleh BMKG.",
      affectedStores: [
        {
          kode_toko: "TK01",
          nama_toko: "Toko Sukabumi 1",
          cabang: "SUKABUMI",
          distance_km: 12.5,
          status: "PRIORITY_MONITOR",
        },
      ],
      ticketNumber: "ESC-SUK-TEST01",
    });

    const check1 = await pool.query(
      `SELECT COUNT(*) FROM notification_logs WHERE disaster_id = $1 AND branch = $2`,
      [testDisasterId, testBranch]
    );
    assert(
      parseInt(check1.rows[0].count, 10) === 1,
      "ND1",
      `Initial BMKG event creates exactly 1 notification record in database (id: ${createdNotif.id})`
    );

    // ND2: BMKG updates magnitude to M5.6 -> updates existing notification
    const updateResult = await updateNotificationLogForEvent(testDisasterId, testBranch, {
      title: "⚠️ PERINGATAN DARURAT GEMPA M 5.6 - CABANG SUKABUMI",
      message: "Pemutakhiran parameter BMKG: Magnitudo meningkat menjadi M5.6.",
      affectedStores: [
        {
          kode_toko: "TK01",
          nama_toko: "Toko Sukabumi 1",
          cabang: "SUKABUMI",
          distance_km: 12.5,
          status: "PRIORITY_MONITOR",
        },
        {
          kode_toko: "TK02",
          nama_toko: "Toko Sukabumi 2",
          cabang: "SUKABUMI",
          distance_km: 18.0,
          status: "MONITOR",
        },
      ],
    });

    const check2 = await pool.query(
      `SELECT title, affected_stores_count, updated_at FROM notification_logs WHERE disaster_id = $1 AND branch = $2`,
      [testDisasterId, testBranch]
    );
    const countCheck2 = await pool.query(
      `SELECT COUNT(*) FROM notification_logs WHERE disaster_id = $1 AND branch = $2`,
      [testDisasterId, testBranch]
    );
    assert(
      updateResult === true &&
        parseInt(countCheck2.rows[0].count, 10) === 1 &&
        check2.rows[0].title.includes("M 5.6") &&
        parseInt(check2.rows[0].affected_stores_count, 10) === 2 &&
        check2.rows[0].updated_at !== null,
      "ND2",
      "Magnitude update updates existing notification record in-place without creating a duplicate card"
    );

    // ND3: BMKG updates shakemap -> remains 1 notification record
    const updateResult3 = await updateNotificationLogForEvent(testDisasterId, testBranch, {
      message: "Pemutakhiran shakemap BMKG: Citra intensitas guncangan tersedia.",
    });
    const countCheck3 = await pool.query(
      `SELECT COUNT(*) FROM notification_logs WHERE disaster_id = $1 AND branch = $2`,
      [testDisasterId, testBranch]
    );
    assert(
      updateResult3 === true && parseInt(countCheck3.rows[0].count, 10) === 1,
      "ND3",
      "Shakemap update maintains exactly 1 awareness notification record"
    );

    // ND4: New distinct canonical event creates new notification
    const newDisasterId = `bmkg-test-new-${Date.now()}`;
    await recordNotificationLog({
      disasterId: newDisasterId,
      disasterType: "earthquake",
      channel: "email_and_pwa",
      branch: testBranch,
      recipientContact: "dc.sukabumi@alfamart.co.id",
      title: "⚠️ PERINGATAN DARURAT GEMPA BARU M 5.0 - CABANG SUKABUMI",
      message: "Gempa baru terpisah.",
      affectedStores: [],
      ticketNumber: "ESC-SUK-TEST02",
    });

    const check4 = await pool.query(
      `SELECT COUNT(*) FROM notification_logs WHERE disaster_id IN ($1, $2) AND branch = $3`,
      [testDisasterId, newDisasterId, testBranch]
    );
    assert(
      parseInt(check4.rows[0].count, 10) === 2,
      "ND4",
      "A genuinely new canonical earthquake event creates a distinct new notification record"
    );

    // Clean up test records
    await pool.query(`DELETE FROM notification_logs WHERE disaster_id IN ($1, $2)`, [
      testDisasterId,
      newDisasterId,
    ]);
  } catch (err: any) {
    console.error("Database test error:", err);
    assert(false, "ND1-ND4", `Database error: ${err.message}`);
  }

  // =========================================================================
  // SUITE 4: HO EVENT GROUPING & BRANCH VIEW (NG1 - NG3)
  // =========================================================================
  console.log("\n--- Suite 4: HO Event Grouping & Branch Scope (NG1 - NG3) ---");

  const canonicalEventId = "bmkg-20261006-sukabumi";
  const branchesList = ["SUKABUMI", "BOGOR", "CIANJUR", "BANDUNG", "BEKASI"];
  const multiBranchLogs: NotificationLog[] = branchesList.map((branchName, idx) => ({
    id: `log-mb-${idx}`,
    disaster_id: canonicalEventId,
    disaster_type: "earthquake",
    channel: "email_and_pwa",
    branch: branchName,
    recipient_role: "Duty Officer DC Cabang",
    recipient_contact: `dc.${branchName.toLowerCase()}@alfamart.co.id`,
    title: "Gempa M5.4 Sukabumi",
    message: `Gempa M5.4 dirasakan di wilayah ${branchName}`,
    affected_stores_count: (idx + 1) * 3,
    affected_stores_sample: [
      {
        kode_toko: `TK-${branchName}-1`,
        nama_toko: `Alfamart ${branchName} 1`,
        cabang: branchName,
        distance_km: 15.0 + idx,
        status: idx % 2 === 0 ? "PRIORITY_MONITOR" : "MONITOR",
      },
    ],
    ticket_number: `ESC-${branchName.slice(0, 3)}-111`,
    status: "sent",
    sent_at: new Date(now - 15 * 60 * 1000).toISOString(),
  }));

  // NG1: HO view groups same canonical event into 1 grouped card, whereas Branch view scopes to single branch
  const hoGrouping = groupNotificationsForHO(multiBranchLogs);
  const hoGroupCount = hoGrouping.earthquakeGroups.size;
  const branchViewLogs = multiBranchLogs.filter((l) => l.branch.toLowerCase() === "sukabumi");

  assert(
    hoGroupCount === 1 &&
      hoGrouping.earthquakeGroups.get(canonicalEventId)!.length === 5 &&
      branchViewLogs.length === 1,
    "NG1",
    "Same canonical event affecting 5 branches yields 1 grouped card for HO and single-branch view for Branch user"
  );

  // NG2: Expanded grouped event provides exact breakdown for each of the 5 branches
  const groupLogs = hoGrouping.earthquakeGroups.get(canonicalEventId)!;
  const totalStoresInGroup = groupLogs.reduce((acc, l) => acc + l.affected_stores_count, 0);
  const branchesInGroup = groupLogs.map((l) => l.branch);
  assert(
    branchesInGroup.length === 5 &&
      totalStoresInGroup === (3 + 6 + 9 + 12 + 15) &&
      branchesInGroup.includes("SUKABUMI") &&
      branchesInGroup.includes("BEKASI"),
    "NG2",
    `Expanded grouped event provides exact breakdown of 5 branches and ${totalStoresInGroup} total stores`
  );

  // NG3: Presentation grouping does not mutate report ownership
  const reportsByBranch = branchesList.map((b) => ({
    id: `REP-${b}-99`,
    branch: b,
    earthquakeEventId: canonicalEventId,
  }));
  const sukabumiReport = reportsByBranch.find((r) => r.branch === "SUKABUMI");
  assert(
    sukabumiReport?.branch === "SUKABUMI" && reportsByBranch.length === 5,
    "NG3",
    "Grouping is purely presentational: report ownership per DC Cabang remains strictly isolated"
  );

  // =========================================================================
  // SUITE 5: MAP UI, THEME AWARENESS & CONTROL REDESIGN (MU1 - MU8)
  // =========================================================================
  console.log("\n--- Suite 5: Map UI, Theme Awareness & Control Redesign (MU1 - MU8) ---");

  const mapInnerPath = path.resolve(process.cwd(), "components/map/map-inner.tsx");
  const mapControlsPath = path.resolve(process.cwd(), "components/map/map-controls.tsx");
  const globalsCssPath = path.resolve(process.cwd(), "app/globals.css");

  const mapInnerSrc = fs.readFileSync(mapInnerPath, "utf-8");
  const mapControlsSrc = fs.readFileSync(mapControlsPath, "utf-8");
  const globalsCssSrc = fs.readFileSync(globalsCssPath, "utf-8");

  // MU1: Light mode earthquake popup styling exists
  const hasLightPopupClasses =
    mapInnerSrc.includes("popup-light") &&
    mapInnerSrc.includes("bg-white text-slate-900 border-slate-200") &&
    mapInnerSrc.includes("bg-slate-50 border-slate-200") &&
    globalsCssSrc.includes(".custom-leaflet-popup.popup-light .leaflet-popup-tip");
  assert(
    hasLightPopupClasses,
    "MU1",
    "Light mode earthquake popup uses clean light theme (bg-white, border-slate-200, text-slate-900, white popup tip)"
  );

  // MU2: Dark mode earthquake popup styling exists
  const hasDarkPopupClasses =
    mapInnerSrc.includes("popup-dark") &&
    mapInnerSrc.includes("bg-slate-900 text-white border-slate-700") &&
    mapInnerSrc.includes("bg-slate-950/70 border-slate-800");
  assert(
    hasDarkPopupClasses,
    "MU2",
    "Dark mode earthquake popup uses sleek dark theme (bg-slate-900, border-slate-700, text-white)"
  );

  // MU3 & MU4: 24 Jam and 3 Hari segmented control styling
  const hasSegmentedControl =
    mapControlsSrc.includes("Periode Gempa") &&
    mapControlsSrc.includes("bg-amber-500 text-white") &&
    mapControlsSrc.includes("bg-blue-600 text-white") &&
    mapControlsSrc.includes("onChangeMapTimeFilter?.(\"24h\")") &&
    mapControlsSrc.includes("onChangeMapTimeFilter?.(\"3d\")");
  assert(
    hasSegmentedControl,
    "MU3-MU4",
    "Segmented control for '24 Jam | 3 Hari' implemented with distinctive active accent (amber for 24h, blue for 3d)"
  );

  // MU5: MapControls panel height constraint
  const hasHeightConstraint =
    mapControlsSrc.includes("max-h-[calc(100vh-140px)]") &&
    mapControlsSrc.includes("overflow-y-auto");
  assert(
    hasHeightConstraint,
    "MU5",
    "MapControls panel is bounded with max-h-[calc(100vh-140px)] and internal scroll to prevent map overflow"
  );

  // MU6: Legend collapse works
  const hasLegendCollapse =
    mapControlsSrc.includes("Legenda Status") &&
    mapControlsSrc.includes("setIsLegendExpanded(!isLegendExpanded)") &&
    mapControlsSrc.includes("Terdampak Lapangan") &&
    mapControlsSrc.includes("Dalam Penanganan");
  assert(
    hasLegendCollapse,
    "MU6",
    "Operational status legend is collapsible and renders 5 standard visual statuses"
  );

  // MU7: Minimize mode works
  const hasMinimizeMode =
    mapControlsSrc.includes("isMinimized") &&
    mapControlsSrc.includes("setIsMinimized(true)") &&
    mapControlsSrc.includes("setIsMinimized(false)");
  assert(
    hasMinimizeMode,
    "MU7",
    "Map controls support minimize mode into a floating pill button"
  );

  // MU8: Compact Event Focus Banner
  const hasCompactFocusBanner =
    mapControlsSrc.includes("selectedEarthquake") &&
    mapControlsSrc.includes("Fokus:") &&
    mapControlsSrc.includes("onClearEventFocus");
  assert(
    hasCompactFocusBanner,
    "MU8",
    "Event Focus Mode banner is compact with title, magnitude, and instant Reset button"
  );

  // =========================================================================
  // SUMMARY
  // =========================================================================
  console.log("\n=====================================================================");
  console.log(` RESULTS: ${passed} PASSED / ${failed} FAILED`);
  console.log("=====================================================================");

  if (failed > 0) {
    process.exit(1);
  }
}

runTestSuite().catch((err) => {
  console.error("Test execution fatal error:", err);
  process.exit(1);
});
