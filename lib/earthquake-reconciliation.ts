/**
 * SPARTA SIAGA — Earthquake Reconciliation Engine (Phase 2)
 *
 * Implements automated, concurrency-safe reconciliation between manual branch reports
 * and authentic BMKG/USGS earthquake monitoring events.
 *
 * Capabilities:
 * 1. Automatic reconciliation using event identity, occurrence time, and store/facility geographic proximity.
 * 2. Handles manual-first and automatic-first workflows with zero duplicate incidents.
 * 3. Preserves inspection evidence, photos, reporter information, and audit timeline.
 * 4. Keeps distinct earthquakes and aftershocks separate via canonical event identities.
 * 5. Routes ambiguous candidate matches to authorized reconciliation review (never forces a merge).
 * 6. Enforces database-level uniqueness via advisory locking and unique indexes.
 */

import { getDbPool } from "./db";
import { calculateHaversineDistance, calculateSpartaMonitoringZone } from "./haversine";
import { createReconciliationCase } from "./reconciliation-service";
import { IncidentRecord, DamageReport } from "@/types/incident";
import { UserContext } from "./report-permissions";

export interface CandidateEarthquakeEvent {
  id: string; // canonical_event_id
  sourcePrimary: string;
  magnitude: number;
  depthKm: number;
  latitude: number;
  longitude: number;
  occurredAt: Date;
  title: string;
  distanceKm: number;
  monitoringRadiusKm: number;
  priorityRadiusKm: number;
  timeDifferenceMinutes: number;
}

export interface ReconcileManualSubmissionResult {
  outcome: "merged_into_existing" | "linked_to_earthquake" | "ambiguous_routed_to_reconciliation" | "created_unlinked";
  incident: IncidentRecord;
  mergedIncidentId?: string;
  canonicalEventId?: string;
  candidateCount?: number;
}

function getDamageNotes(body: IncidentRecord): string | undefined {
  return (body as any).damageNotes || (body as any).notes || body.verification?.notes || undefined;
}

/**
 * Finds all active BMKG/USGS earthquake events that encompass the target location
 * within the specified time window (default 120 minutes).
 */
export async function findMatchingEarthquakesForLocation(params: {
  latitude: number;
  longitude: number;
  reportTimestamp?: number | Date;
  windowMinutes?: number;
}): Promise<CandidateEarthquakeEvent[]> {
  const pool = getDbPool();
  const windowMinutes = params.windowMinutes ?? 120;
  const targetDate = params.reportTimestamp
    ? params.reportTimestamp instanceof Date
      ? params.reportTimestamp
      : new Date(params.reportTimestamp)
    : new Date();

  const minTime = new Date(targetDate.getTime() - windowMinutes * 60_000);
  const maxTime = new Date(targetDate.getTime() + windowMinutes * 60_000);

  const { rows } = await pool.query(
    `SELECT id, source_primary, magnitude, depth_km, latitude, longitude,
            occurred_at, title, priority_radius_km, monitoring_radius_km
       FROM earthquake_events
      WHERE occurred_at BETWEEN $1 AND $2
      ORDER BY occurred_at DESC`,
    [minTime.toISOString(), maxTime.toISOString()]
  );

  const candidates: CandidateEarthquakeEvent[] = [];

  for (const row of rows) {
    const eqLat = parseFloat(row.latitude);
    const eqLon = parseFloat(row.longitude);
    const mag = parseFloat(row.magnitude);
    const depth = parseFloat(row.depth_km) || 10;
    const occurredAt = new Date(row.occurred_at);

    const distanceKm = calculateHaversineDistance(eqLat, eqLon, params.latitude, params.longitude);
    if (!Number.isFinite(distanceKm)) continue;

    const dynamicZones = calculateSpartaMonitoringZone(mag, depth);
    const monitoringRadius = parseFloat(row.monitoring_radius_km) || dynamicZones.monitoringRadiusKm;
    const priorityRadius = parseFloat(row.priority_radius_km) || dynamicZones.priorityRadiusKm;

    if (distanceKm <= monitoringRadius) {
      const timeDiffMinutes = Math.abs(targetDate.getTime() - occurredAt.getTime()) / 60_000;
      candidates.push({
        id: row.id,
        sourcePrimary: row.source_primary || "UNVERIFIED",
        magnitude: mag,
        depthKm: depth,
        latitude: eqLat,
        longitude: eqLon,
        occurredAt,
        title: row.title,
        distanceKm,
        monitoringRadiusKm: monitoringRadius,
        priorityRadiusKm: priorityRadius,
        timeDifferenceMinutes: Math.round(timeDiffMinutes * 10) / 10,
      });
    }
  }

  // Sort candidates by closest occurrence time
  candidates.sort((a, b) => a.timeDifferenceMinutes - b.timeDifferenceMinutes);
  return candidates;
}

/**
 * Reconcile a manual incident submission with genuine BMKG/USGS earthquakes.
 * Handles both manual-first and automatic-first workflows with zero duplicate records.
 */
export async function reconcileManualEarthquakeSubmission(params: {
  sessionUser: UserContext;
  body: IncidentRecord;
  windowMinutes?: number;
}): Promise<ReconcileManualSubmissionResult> {
  const pool = getDbPool();
  const client = await pool.connect();
  const windowMinutes = params.windowMinutes ?? 120;
  const nowWib = new Date().toLocaleString("id-ID", { timeZone: "Asia/Jakarta" }) + " WIB";

  try {
    await client.query("BEGIN");

    // 1. Resolve Location Identity & Coordinates
    let locationKind = params.body.locationKind || "STORE";
    let locationId = params.body.locationId || params.body.storeId || "";
    let lat = params.body.latitudeSnapshot;
    let lon = params.body.longitudeSnapshot;
    let locationName = params.body.locationNameSnapshot || params.body.storeName || "";
    let branch = params.body.branchSnapshot || params.body.branch || "";

    if (locationKind === "FACILITY" || params.body.tkpType === "dc") {
      locationKind = "FACILITY";
      if (!lat || !lon) {
        const facRes = await client.query(
          `SELECT name, branch_id, latitude, longitude FROM facilities WHERE code = $1 LIMIT 1`,
          [locationId]
        );
        if (facRes.rows[0]) {
          lat = facRes.rows[0].latitude;
          lon = facRes.rows[0].longitude;
          locationName = locationName || facRes.rows[0].name;
          branch = branch || facRes.rows[0].branch_id;
        }
      }
    } else {
      locationKind = "STORE";
      if (!lat || !lon) {
        const storeRes = await client.query(
          `SELECT nama_toko, cabang, latitude, longitude FROM stores WHERE kode_toko = $1 LIMIT 1`,
          [locationId]
        );
        if (storeRes.rows[0]) {
          lat = parseFloat(storeRes.rows[0].latitude);
          lon = parseFloat(storeRes.rows[0].longitude);
          locationName = locationName || storeRes.rows[0].nama_toko;
          branch = branch || storeRes.rows[0].cabang;
        }
      }
    }

    // 2. Discover Candidate Earthquake Events
    let candidates: CandidateEarthquakeEvent[] = [];
    if (lat && lon && Number.isFinite(lat) && Number.isFinite(lon)) {
      candidates = await findMatchingEarthquakesForLocation({
        latitude: lat,
        longitude: lon,
        reportTimestamp: params.body.date ? new Date(params.body.date) : new Date(),
        windowMinutes,
      });
    }

    // -------------------------------------------------------------------------
    // SCENARIO A: EXACTLY ONE MATCHING EARTHQUAKE EVENT
    // -------------------------------------------------------------------------
    if (candidates.length === 1) {
      const match = candidates[0];

      // Concurrency protection: lock the specific earthquake location
      await client.query("SELECT lock_earthquake_location($1, $2, $3)", [
        match.id,
        locationKind,
        locationId,
      ]);

      // Check for an existing incident on this canonical earthquake and location
      const existingRes = await client.query(
        `SELECT * FROM incidents
          WHERE canonical_event_id = $1 AND location_kind = $2 AND location_id = $3
          LIMIT 1
          FOR UPDATE`,
        [match.id, locationKind, locationId]
      );

      // SUBCASE A.1: AUTOMATIC-FIRST (Merge manual report into existing automatic report)
      if (existingRes.rows.length > 0) {
        const existing = existingRes.rows[0];
        const existingTimeline = Array.isArray(existing.timeline) ? existing.timeline : [];
        const existingPhotos = Array.isArray(existing.field_photos) ? existing.field_photos : [];

        // Combine photos without duplication
        const incomingPhotos: string[] = Array.isArray(params.body.fieldPhotos)
          ? params.body.fieldPhotos.map((p) => (typeof p === "string" ? p : p.url))
          : [];
        const mergedPhotos = Array.from(new Set([...existingPhotos, ...incomingPhotos]));

        const timelineEntry = {
          stage: "Observasi Lapangan Ditambahkan",
          label: `Observasi lapangan dari ${params.sessionUser.name} (${params.sessionUser.role?.toUpperCase() || "BMS"}) digabungkan ke insiden gempa resmi ini.`,
          timestamp: nowWib,
          actor: params.sessionUser.name,
          notes: getDamageNotes(params.body),
        };

        const updatedTimeline = [...existingTimeline, timelineEntry];

        // If photos are provided, update verification and status to pending_bm_approval if unhandled
        let newStatus = existing.status;
        let updatedVerification = existing.verification;

        if (incomingPhotos.length > 0 && existing.status === "pending_confirmation") {
          newStatus = "pending_bm_approval";
          updatedVerification = {
            ...(existing.verification || {}),
            confirmedBy: `${params.sessionUser.name} (${params.sessionUser.role?.toUpperCase() || "BMS"})`,
            confirmedAt: nowWib,
            isDamaged: true,
            photos: mergedPhotos,
            notes: getDamageNotes(params.body) || "Observasi kerusakan lapangan diajukan.",
          };
        }

        await client.query(
          `UPDATE incidents
             SET field_photos = $2::jsonb,
                 timeline = $3::jsonb,
                 status = $4,
                 verification = $5::jsonb,
                 updated_at = NOW()
           WHERE id = $1`,
          [
            existing.id,
            JSON.stringify(mergedPhotos),
            JSON.stringify(updatedTimeline),
            newStatus,
            updatedVerification ? JSON.stringify(updatedVerification) : null,
          ]
        );

        await client.query("COMMIT");

        return {
          outcome: "merged_into_existing",
          incident: {
            ...existing,
            fieldPhotos: mergedPhotos,
            timeline: updatedTimeline,
            status: newStatus,
            verification: updatedVerification,
          },
          mergedIncidentId: existing.id,
          canonicalEventId: match.id,
        };
      }

      // SUBCASE A.2: MANUAL-FIRST (Link manual report to genuine earthquake event)
      const disasterMetadata = {
        magnitude: match.magnitude,
        depth: `${match.depthKm} km`,
        coordinates: [match.latitude, match.longitude] as [number, number],
        place: match.title,
        time: match.occurredAt.toISOString(),
      };

      const earthquakeProvenance = `Ditautkan otomatis ke event ${match.sourcePrimary} ${match.id} (jarak ${Math.round(match.distanceKm)}km, jendela ${windowMinutes}m).`;

      const manualReportId = params.body.id || `LAP-EQ-MAN-${locationId.toUpperCase()}-${Math.floor(1000 + Math.random() * 9000)}`;
      const fieldPhotos = Array.isArray(params.body.fieldPhotos)
        ? params.body.fieldPhotos.map((p) => (typeof p === "string" ? p : p.url))
        : [];

      const initialTimeline = [
        {
          stage: "Laporan Manual Diajukan",
          label: `Laporan kejadian gempa manual diajukan oleh ${params.sessionUser.name}.`,
          timestamp: nowWib,
          actor: params.sessionUser.name,
          notes: getDamageNotes(params.body),
        },
        {
          stage: "Rekonsiliasi Otomatis",
          label: `Laporan berhasil direkonsiliasi dan ditautkan ke kejadian gempa resmi ${match.sourcePrimary} (${match.title}).`,
          timestamp: nowWib,
          actor: "SYSTEM",
        },
      ];

      const initialStatus = fieldPhotos.length > 0 ? "pending_bm_approval" : "pending_confirmation";
      const initialVerification = fieldPhotos.length > 0
        ? {
            confirmedBy: `${params.sessionUser.name} (${params.sessionUser.role?.toUpperCase() || "BMS"})`,
            confirmedAt: nowWib,
            isDamaged: true,
            photos: fieldPhotos,
            notes: getDamageNotes(params.body) || "Hasil pemeriksaan observasi manual diajukan.",
          }
        : undefined;

      const reporterData = JSON.stringify({
        userId: params.sessionUser.id,
        name: params.sessionUser.name,
        role: params.sessionUser.role,
        branch: params.sessionUser.branch,
      });

      await client.query(
        `INSERT INTO incidents (
           id, date, disaster_type, report_origin, earthquake_event_id,
           canonical_event_id, earthquake_source, earthquake_provenance,
           disaster_metadata, tkp_type, store_id, store_name, branch,
           location_city, status, progress, field_photos, timeline,
           verification, location_kind, location_id, location_code_snapshot,
           location_name_snapshot, location_type_snapshot, latitude_snapshot,
           longitude_snapshot, branch_snapshot, reporter,
           created_at, updated_at
         ) VALUES (
           $1, $2, 'earthquake', 'manual', $3::text,
           $3::varchar, $4, $5,
           $6::jsonb, $7, $8, $9, $10,
           $11, $12, 0, $13::jsonb, $14::jsonb,
           $15::jsonb, $16, $17, $18,
           $19, $20, $21,
           $22, $23, $24::jsonb,
           NOW(), NOW()
         )
         ON CONFLICT (canonical_event_id, location_kind, location_id)
           WHERE disaster_type = 'earthquake'
             AND canonical_event_id IS NOT NULL
             AND location_kind IS NOT NULL
             AND location_id IS NOT NULL
         DO UPDATE SET
           field_photos = incidents.field_photos || EXCLUDED.field_photos,
           timeline = incidents.timeline || EXCLUDED.timeline,
           updated_at = NOW()
         RETURNING *`,
        [
          manualReportId,
          params.body.date || nowWib,
          match.id,
          match.sourcePrimary,
          earthquakeProvenance,
          JSON.stringify(disasterMetadata),
          locationKind === "STORE" ? "toko" : "dc",
          locationKind === "STORE" ? locationId : null,
          locationName,
          branch,
          branch,
          initialStatus,
          JSON.stringify(fieldPhotos),
          JSON.stringify(initialTimeline),
          initialVerification ? JSON.stringify(initialVerification) : null,
          locationKind,
          locationId,
          locationId,
          locationName,
          locationKind === "STORE" ? "Reguler" : "DC",
          lat ?? null,
          lon ?? null,
          branch,
          reporterData,
        ]
      );

      await client.query("COMMIT");

      return {
        outcome: "linked_to_earthquake",
        incident: {
          ...params.body,
          id: manualReportId,
          canonicalEventId: match.id,
          earthquakeEventId: match.id,
          earthquakeSource: match.sourcePrimary,
          earthquakeProvenance,
          disasterMetadata,
          status: initialStatus,
          verification: initialVerification,
          fieldPhotos,
          timeline: initialTimeline,
        },
        canonicalEventId: match.id,
      };
    }

    // -------------------------------------------------------------------------
    // SCENARIO B: MULTIPLE CANDIDATE EARTHQUAKES (Ambiguous match / Aftershocks)
    // -------------------------------------------------------------------------
    if (candidates.length > 1) {
      // Do NOT guess or force a merge: preserve distinct aftershocks and route to review
      const manualReportId = params.body.id || `LAP-EQ-AMB-${locationId.toUpperCase()}-${Math.floor(1000 + Math.random() * 9000)}`;
      const fieldPhotos = Array.isArray(params.body.fieldPhotos)
        ? params.body.fieldPhotos.map((p) => (typeof p === "string" ? p : p.url))
        : [];

      const initialTimeline = [
        {
          stage: "Laporan Manual Diajukan",
          label: `Laporan kejadian gempa manual diajukan oleh ${params.sessionUser.name}.`,
          timestamp: nowWib,
          actor: params.sessionUser.name,
          notes: getDamageNotes(params.body),
        },
        {
          stage: "Rekonsiliasi Ditinjau (Ambigu)",
          label: `Ditemukan ${candidates.length} kejadian gempa aktif yang mendekati lokasi. Laporan diteruskan ke antrean peninjauan rekonsiliasi.`,
          timestamp: nowWib,
          actor: "SYSTEM",
        },
      ];

      const initialStatus = fieldPhotos.length > 0 ? "pending_bm_approval" : "pending_confirmation";
      const initialVerification = fieldPhotos.length > 0
        ? {
            confirmedBy: `${params.sessionUser.name} (${params.sessionUser.role?.toUpperCase() || "BMS"})`,
            confirmedAt: nowWib,
            isDamaged: true,
            photos: fieldPhotos,
            notes: getDamageNotes(params.body) || "Observasi lapangan diajukan (menunggu verifikasi rekonsiliasi).",
          }
        : undefined;

      const reporterData = JSON.stringify({
        userId: params.sessionUser.id,
        name: params.sessionUser.name,
        role: params.sessionUser.role,
        branch: params.sessionUser.branch,
      });

      // Save as independent manual report (canonical_event_id left NULL)
      await client.query(
        `INSERT INTO incidents (
           id, date, disaster_type, report_origin,
           tkp_type, store_id, store_name, branch,
           location_city, status, progress, field_photos, timeline,
           verification, location_kind, location_id, location_code_snapshot,
           location_name_snapshot, location_type_snapshot, latitude_snapshot,
           longitude_snapshot, branch_snapshot, reporter,
           created_at, updated_at
         ) VALUES (
           $1, $2, 'earthquake', 'manual',
           $3, $4, $5, $6,
           $7, $8, 0, $9::jsonb, $10::jsonb,
           $11::jsonb, $12, $13, $14,
           $15, $16, $17,
           $18, $19, $20::jsonb,
           NOW(), NOW()
         )`,
        [
          manualReportId,
          params.body.date || nowWib,
          locationKind === "STORE" ? "toko" : "dc",
          locationKind === "STORE" ? locationId : null,
          locationName,
          branch,
          branch,
          initialStatus,
          JSON.stringify(fieldPhotos),
          JSON.stringify(initialTimeline),
          initialVerification ? JSON.stringify(initialVerification) : null,
          locationKind,
          locationId,
          locationId,
          locationName,
          locationKind === "STORE" ? "Reguler" : "DC",
          lat ?? null,
          lon ?? null,
          branch,
          reporterData,
        ]
      );

      // Create a reconciliation case for each candidate earthquake event
      for (const cand of candidates) {
        await client.query(
          `INSERT INTO earthquake_reconciliation_cases (
             incident_id, candidate_canonical_event_id, candidate_location_kind,
             candidate_location_id, reason, details
           ) VALUES ($1, $2, $3, $4, 'AMBIGUOUS_MANUAL_MATCH', $5::jsonb)
           ON CONFLICT DO NOTHING`,
          [
            manualReportId,
            cand.id,
            locationKind,
            locationId,
            JSON.stringify({
              matchCount: candidates.length,
              candidateTitle: cand.title,
              magnitude: cand.magnitude,
              distanceKm: cand.distanceKm,
              timeDifferenceMinutes: cand.timeDifferenceMinutes,
            }),
          ]
        );
      }

      await client.query("COMMIT");

      return {
        outcome: "ambiguous_routed_to_reconciliation",
        incident: {
          ...params.body,
          id: manualReportId,
          canonicalEventId: undefined,
          earthquakeEventId: undefined,
          status: initialStatus,
          verification: initialVerification,
          fieldPhotos,
          timeline: initialTimeline,
        },
        candidateCount: candidates.length,
      };
    }

    // -------------------------------------------------------------------------
    // SCENARIO C: NO MATCHING EARTHQUAKE EVENT (Local tremor / independent report)
    // -------------------------------------------------------------------------
    const manualReportId = params.body.id || `LAP-EQ-IND-${locationId.toUpperCase()}-${Math.floor(1000 + Math.random() * 9000)}`;
    const fieldPhotos = Array.isArray(params.body.fieldPhotos)
      ? params.body.fieldPhotos.map((p) => (typeof p === "string" ? p : p.url))
      : [];

    const initialTimeline = [
      {
        stage: "Laporan Manual Diajukan",
        label: `Laporan getaran/gempa manual diajukan oleh ${params.sessionUser.name} (belum terdeteksi BMKG).`,
        timestamp: nowWib,
        actor: params.sessionUser.name,
        notes: getDamageNotes(params.body),
      },
    ];

    const initialStatus = fieldPhotos.length > 0 ? "pending_bm_approval" : "pending_confirmation";
    const initialVerification = fieldPhotos.length > 0
      ? {
          confirmedBy: `${params.sessionUser.name} (${params.sessionUser.role?.toUpperCase() || "BMS"})`,
          confirmedAt: nowWib,
          isDamaged: true,
          photos: fieldPhotos,
          notes: getDamageNotes(params.body) || "Hasil pemeriksaan observasi manual diajukan.",
        }
      : undefined;

    const reporterData = JSON.stringify({
      userId: params.sessionUser.id,
      name: params.sessionUser.name,
      role: params.sessionUser.role,
      branch: params.sessionUser.branch,
    });

    await client.query(
      `INSERT INTO incidents (
         id, date, disaster_type, report_origin,
         tkp_type, store_id, store_name, branch,
         location_city, status, progress, field_photos, timeline,
         verification, location_kind, location_id, location_code_snapshot,
         location_name_snapshot, location_type_snapshot, latitude_snapshot,
         longitude_snapshot, branch_snapshot, reporter,
         created_at, updated_at
       ) VALUES (
         $1, $2, 'earthquake', 'manual',
         $3, $4, $5, $6,
         $7, $8, 0, $9::jsonb, $10::jsonb,
         $11::jsonb, $12, $13, $14,
         $15, $16, $17,
         $18, $19, $20::jsonb,
         NOW(), NOW()
       )`,
      [
        manualReportId,
        params.body.date || nowWib,
        locationKind === "STORE" ? "toko" : "dc",
        locationKind === "STORE" ? locationId : null,
        locationName,
        branch,
        branch,
        initialStatus,
        JSON.stringify(fieldPhotos),
        JSON.stringify(initialTimeline),
        initialVerification ? JSON.stringify(initialVerification) : null,
        locationKind,
        locationId,
        locationId,
        locationName,
        locationKind === "STORE" ? "Reguler" : "DC",
        lat ?? null,
        lon ?? null,
        branch,
        reporterData,
      ]
    );

    await client.query("COMMIT");

    return {
      outcome: "created_unlinked",
      incident: {
        ...params.body,
        id: manualReportId,
        canonicalEventId: undefined,
        earthquakeEventId: undefined,
        status: initialStatus,
        verification: initialVerification,
        fieldPhotos,
        timeline: initialTimeline,
      },
    };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
